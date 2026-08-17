import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';
import { billingRepository } from './billingRepository';

export type ProductPaymentMethod = 'bank_transfer' | 'kaspi' | 'card' | 'cash' | 'manual' | 'other';

export type PaymentMethodOption = {
  method: ProductPaymentMethod;
  enabled: boolean;
  isDefault: boolean;
  displayName: string;
  instructions: string;
  sortOrder: number;
};

export type ProductPaymentSettings = {
  productId: string;
  productKey: string;
  productName: string;
  methods: PaymentMethodOption[];
};

export type ProductRenewalInput = {
  organizationId: string;
  subscriptionId: string;
  productId: string;
  amount: number;
  currency: string;
  method: ProductPaymentMethod;
  periodMonths: number;
  externalReference?: string;
  payerName?: string;
};

type PaymentDatabase = {
  public: {
    Tables: {
      product_payment_methods: {
        Row: {
          id: string;
          product_id: string;
          method: ProductPaymentMethod;
          enabled: boolean;
          is_default: boolean;
          display_name: string;
          instructions: string | null;
          sort_order: number;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      set_product_payment_methods: {
        Args: {
          target_product_id: string;
          methods_value: Array<{
            method: ProductPaymentMethod;
            enabled: boolean;
            isDefault: boolean;
            displayName: string;
            instructions: string | null;
            sortOrder: number;
          }>;
          reason_value?: string;
        };
        Returns: undefined;
      };
      record_product_payment_and_extend: {
        Args: {
          organization_id_value: string;
          product_id_value: string;
          subscription_id_value: string;
          amount_value: number;
          currency_value: string;
          method_value: ProductPaymentMethod;
          period_months_value: number;
          received_at_value?: string;
          external_reference_value?: string | null;
          payer_name_value?: string | null;
        };
        Returns: Record<string, unknown>;
      };
    };
    Enums: { payment_method: ProductPaymentMethod };
    CompositeTypes: Record<string, never>;
  };
};

const STORAGE_KEY = 'imds-super-admin:product-payment-methods:v1';

export const paymentMethodCatalog: Array<{ method: ProductPaymentMethod; label: string; hint: string }> = [
  { method: 'bank_transfer', label: 'Банковский перевод', hint: 'Оплата по счёту или реквизитам' },
  { method: 'kaspi', label: 'Kaspi', hint: 'Kaspi Pay / перевод с подтверждением' },
  { method: 'card', label: 'Банковская карта', hint: 'Карточный эквайринг' },
  { method: 'cash', label: 'Наличные', hint: 'Ручная фиксация кассовой оплаты' },
  { method: 'manual', label: 'Ручная отметка', hint: 'Администратор подтверждает оплату вручную' },
  { method: 'other', label: 'Другой способ', hint: 'Индивидуальный способ оплаты' },
];

function client(): SupabaseClient<PaymentDatabase> | null {
  return getSupabase() as unknown as SupabaseClient<PaymentDatabase> | null;
}

function defaults(): PaymentMethodOption[] {
  return paymentMethodCatalog.map((item, index) => ({
    method: item.method,
    enabled: item.method === 'bank_transfer' || item.method === 'kaspi',
    isDefault: item.method === 'bank_transfer',
    displayName: item.label,
    instructions: '',
    sortOrder: (index + 1) * 10,
  }));
}

function normalizeMethods(methods: PaymentMethodOption[]): PaymentMethodOption[] {
  const byMethod = new Map(methods.map((item) => [item.method, item]));
  const merged = paymentMethodCatalog.map((catalogItem, index) => {
    const existing = byMethod.get(catalogItem.method);
    return existing ?? {
      method: catalogItem.method,
      enabled: false,
      isDefault: false,
      displayName: catalogItem.label,
      instructions: '',
      sortOrder: (index + 1) * 10,
    };
  });
  const enabled = merged.filter((item) => item.enabled);
  if (enabled.length > 0 && !enabled.some((item) => item.isDefault)) {
    const first = enabled[0].method;
    return merged.map((item) => ({ ...item, isDefault: item.method === first }));
  }
  let defaultSeen = false;
  return merged.map((item) => {
    const shouldDefault = item.enabled && item.isDefault && !defaultSeen;
    if (shouldDefault) defaultSeen = true;
    return { ...item, isDefault: shouldDefault };
  });
}

function readDemo(): Record<string, PaymentMethodOption[]> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PaymentMethodOption[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeDemo(value: Record<string, PaymentMethodOption[]>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

async function listPaymentSettings(): Promise<ProductPaymentSettings[]> {
  const billing = await billingRepository.list();
  const activeProducts = billing.products.filter((product) => !product.archivedAt);
  const supabase = client();
  if (!supabase) {
    const saved = readDemo();
    return activeProducts.map((product) => ({
      productId: product.id,
      productKey: product.key,
      productName: product.name,
      methods: normalizeMethods(saved[product.id] ?? defaults()),
    }));
  }

  const { data, error } = await supabase
    .from('product_payment_methods')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const rows = data ?? [];

  return activeProducts.map((product) => ({
    productId: product.id,
    productKey: product.key,
    productName: product.name,
    methods: normalizeMethods(rows
      .filter((row) => row.product_id === product.id)
      .map((row) => ({
        method: row.method,
        enabled: row.enabled,
        isDefault: row.is_default,
        displayName: row.display_name,
        instructions: row.instructions ?? '',
        sortOrder: row.sort_order,
      }))),
  }));
}

export const productPaymentMethodsRepository = {
  list: listPaymentSettings,

  async save(productId: string, methods: PaymentMethodOption[]): Promise<ProductPaymentSettings[]> {
    const normalized = normalizeMethods(methods);
    const enabled = normalized.filter((item) => item.enabled);
    if (enabled.length === 0) throw new Error('Оставьте минимум один способ оплаты.');

    const supabase = client();
    if (supabase) {
      const { error } = await supabase.rpc('set_product_payment_methods', {
        target_product_id: productId,
        methods_value: normalized.map((item) => ({
          method: item.method,
          enabled: item.enabled,
          isDefault: item.isDefault,
          displayName: item.displayName,
          instructions: item.instructions.trim() || null,
          sortOrder: item.sortOrder,
        })),
        reason_value: 'Payment methods updated from Super Admin',
      });
      if (error) throw error;
    } else {
      const saved = readDemo();
      saved[productId] = normalized;
      writeDemo(saved);
    }
    return listPaymentSettings();
  },

  async renew(input: ProductRenewalInput): Promise<void> {
    if (input.amount <= 0) throw new Error('Сумма оплаты должна быть больше нуля.');
    if (![1, 3, 6, 12].includes(input.periodMonths)) throw new Error('Выберите период 1, 3, 6 или 12 месяцев.');
    const supabase = client();
    if (!supabase) return;
    const { error } = await supabase.rpc('record_product_payment_and_extend', {
      organization_id_value: input.organizationId,
      product_id_value: input.productId,
      subscription_id_value: input.subscriptionId,
      amount_value: input.amount,
      currency_value: input.currency.toUpperCase(),
      method_value: input.method,
      period_months_value: input.periodMonths,
      received_at_value: new Date().toISOString(),
      external_reference_value: input.externalReference?.trim() || null,
      payer_name_value: input.payerName?.trim() || null,
    });
    if (error) throw error;
  },
};
