import type { Json } from '../../lib/database.types';
import { getSupabase } from '../../lib/supabase';
import type { BillingInterval, BillingSupabaseClient, RenewalMode, SubscriptionStatus } from './billingDatabase.types';

export type Tariff = {
  id: string;
  code: string;
  name: string;
  description: string;
  currency: string;
  monthlyPrice: number;
  annualPrice: number | null;
  trialDays: number;
  graceDays: number;
  isCustom: boolean;
  isActive: boolean;
  archivedAt: string | null;
  productIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type Entitlement = {
  id: string;
  key: string;
  value: Json;
  source: string;
};

export type License = {
  id: string;
  productId: string;
  productName: string;
  status: string;
  externalTenantId: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  entitlements: Entitlement[];
};

export type Subscription = {
  id: string;
  organizationId: string;
  organizationName: string;
  tariffId: string | null;
  tariffName: string;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  renewalMode: RenewalMode;
  startsAt: string;
  trialEndsAt: string | null;
  periodEndsAt: string | null;
  graceEndsAt: string | null;
  cancelledAt: string | null;
  customPrice: number | null;
  effectivePrice: number;
  currency: string;
  activatedAt: string | null;
  licenses: License[];
  createdAt: string;
  updatedAt: string;
};

export type BillingOrganization = {
  id: string;
  name: string;
  status: string;
};

export type BillingProduct = {
  id: string;
  key: string;
  name: string;
  archivedAt: string | null;
};

export type BillingSnapshot = {
  tariffs: Tariff[];
  subscriptions: Subscription[];
  organizations: BillingOrganization[];
  products: BillingProduct[];
};

export type TariffInput = {
  id?: string | null;
  code: string;
  name: string;
  description: string;
  currency: string;
  monthlyPrice: number;
  annualPrice: number | null;
  trialDays: number;
  graceDays: number;
  isCustom: boolean;
  isActive: boolean;
  productIds: string[];
};

export type ActivateSubscriptionInput = {
  organizationId: string;
  tariffId: string;
  billingInterval: BillingInterval;
  renewalMode: RenewalMode;
  startsAt: string;
  customPrice: number | null;
  productIds: string[];
};

const STORAGE_KEY = 'imds-super-admin:billing:v1';
const DEMO_DATE = '2026-08-02T10:00:00.000Z';

const demoProducts: BillingProduct[] = [
  { id: 'mis', key: 'imds-mis', name: 'IMDS MIS', archivedAt: null },
  { id: 'crm', key: 'imds-crm', name: 'IMDS CRM', archivedAt: null },
  { id: 'marketing', key: 'imds-marketing', name: 'IMDS Marketing', archivedAt: null },
  { id: 'finance', key: 'imds-finance', name: 'IMDS Finance', archivedAt: null },
  { id: 'contract', key: 'imds-contract', name: 'IMDS Contract', archivedAt: null },
  { id: 'dashboard', key: 'imds-dashboard', name: 'IMDS Dashboard', archivedAt: null },
  { id: 'product-7', key: 'imds-product-7', name: 'IMDS Product 7', archivedAt: null },
  { id: 'product-8', key: 'imds-product-8', name: 'IMDS Product 8', archivedAt: null },
  { id: 'product-9', key: 'imds-product-9', name: 'IMDS Product 9', archivedAt: null },
  { id: 'product-10', key: 'imds-product-10', name: 'IMDS Product 10', archivedAt: null },
  { id: 'product-11', key: 'imds-product-11', name: 'IMDS Product 11', archivedAt: null },
];

const demoOrganizations: BillingOrganization[] = [
  { id: 'org-amanat', name: 'Amanat Medical Center', status: 'active' },
  { id: 'org-orda', name: 'Orda Clinic', status: 'trial' },
  { id: 'org-sapa', name: 'Sapa Med', status: 'past_due' },
  { id: 'org-nova', name: 'Nova Health', status: 'onboarding' },
];

function createDemoSubscription(
  id: string,
  organizationId: string,
  organizationName: string,
  tariffId: string,
  tariffName: string,
  status: SubscriptionStatus,
  productIds: string[],
): Subscription {
  const startsAt = status === 'trial' ? '2026-07-28T10:00:00.000Z' : '2026-07-01T10:00:00.000Z';
  return {
    id,
    organizationId,
    organizationName,
    tariffId,
    tariffName,
    status,
    billingInterval: 'monthly',
    renewalMode: 'manual',
    startsAt,
    trialEndsAt: status === 'trial' ? '2026-08-11T10:00:00.000Z' : null,
    periodEndsAt: '2026-08-31T10:00:00.000Z',
    graceEndsAt: status === 'past_due' ? '2026-08-08T10:00:00.000Z' : null,
    cancelledAt: null,
    customPrice: null,
    effectivePrice: 0,
    currency: 'KZT',
    activatedAt: status === 'active' || status === 'past_due' ? startsAt : null,
    licenses: productIds.map((productId) => ({
      id: `license-${organizationId}-${productId}`,
      productId,
      productName: demoProducts.find((product) => product.id === productId)?.name ?? productId,
      status: status === 'trial' ? 'pending' : 'active',
      externalTenantId: status === 'trial' ? null : `${organizationId}:${productId}`,
      activatedAt: status === 'trial' ? null : startsAt,
      expiresAt: '2026-08-31T10:00:00.000Z',
      entitlements: [],
    })),
    createdAt: startsAt,
    updatedAt: DEMO_DATE,
  };
}

const defaultSnapshot: BillingSnapshot = {
  products: demoProducts,
  organizations: demoOrganizations,
  tariffs: [
    {
      id: 'tariff-trial',
      code: 'trial',
      name: 'Trial',
      description: 'Демонстрационный доступ без фиксированной цены.',
      currency: 'KZT',
      monthlyPrice: 0,
      annualPrice: null,
      trialDays: 14,
      graceDays: 3,
      isCustom: false,
      isActive: true,
      archivedAt: null,
      productIds: ['crm', 'marketing', 'dashboard'],
      createdAt: DEMO_DATE,
      updatedAt: DEMO_DATE,
    },
    {
      id: 'tariff-business',
      code: 'business',
      name: 'Business',
      description: 'Пакет основных продуктов с индивидуальной коммерческой ценой.',
      currency: 'KZT',
      monthlyPrice: 0,
      annualPrice: null,
      trialDays: 0,
      graceDays: 7,
      isCustom: true,
      isActive: true,
      archivedAt: null,
      productIds: ['mis', 'crm', 'marketing', 'finance', 'contract', 'dashboard'],
      createdAt: DEMO_DATE,
      updatedAt: DEMO_DATE,
    },
    {
      id: 'tariff-enterprise',
      code: 'enterprise',
      name: 'Enterprise',
      description: 'Индивидуальный пакет продуктов, лимитов и условий.',
      currency: 'KZT',
      monthlyPrice: 0,
      annualPrice: null,
      trialDays: 0,
      graceDays: 10,
      isCustom: true,
      isActive: true,
      archivedAt: null,
      productIds: demoProducts.map((product) => product.id),
      createdAt: DEMO_DATE,
      updatedAt: DEMO_DATE,
    },
  ],
  subscriptions: [
    createDemoSubscription('subscription-amanat', 'org-amanat', 'Amanat Medical Center', 'tariff-business', 'Business', 'active', ['mis', 'crm', 'marketing', 'finance', 'contract', 'dashboard']),
    createDemoSubscription('subscription-orda', 'org-orda', 'Orda Clinic', 'tariff-trial', 'Trial', 'trial', ['crm', 'marketing', 'dashboard']),
    createDemoSubscription('subscription-sapa', 'org-sapa', 'Sapa Med', 'tariff-business', 'Business', 'past_due', ['crm', 'marketing', 'dashboard']),
  ],
};

function getBillingClient(): BillingSupabaseClient | null {
  return getSupabase() as unknown as BillingSupabaseClient | null;
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneDefaultSnapshot(): BillingSnapshot {
  return JSON.parse(JSON.stringify(defaultSnapshot)) as BillingSnapshot;
}

function readDemoSnapshot(): BillingSnapshot {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) {
      const initial = cloneDefaultSnapshot();
      writeDemoSnapshot(initial);
      return initial;
    }
    const parsed = JSON.parse(value) as BillingSnapshot;
    return parsed && Array.isArray(parsed.tariffs) && Array.isArray(parsed.subscriptions)
      ? parsed
      : cloneDefaultSnapshot();
  } catch {
    return cloneDefaultSnapshot();
  }
}

function writeDemoSnapshot(snapshot: BillingSnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function getJsonString(value: Json, key: string): string {
  if (!value || Array.isArray(value) || typeof value !== 'object') return '';
  const item = value[key];
  return typeof item === 'string' ? item : '';
}

async function listFromSupabase(): Promise<BillingSnapshot> {
  const supabase = getBillingClient();
  if (!supabase) return readDemoSnapshot();

  const [
    tariffResult,
    tariffProductResult,
    subscriptionResult,
    licenseResult,
    entitlementResult,
    organizationResult,
    productResult,
  ] = await Promise.all([
    supabase.from('tariffs').select('*').order('created_at', { ascending: false }),
    supabase.from('tariff_products').select('*'),
    supabase.from('subscriptions').select('*').order('created_at', { ascending: false }),
    supabase.from('licenses').select('*'),
    supabase.from('entitlements').select('*'),
    supabase.from('organizations').select('*').order('name'),
    supabase.from('products').select('*').order('name'),
  ]);

  const firstError = tariffResult.error
    ?? tariffProductResult.error
    ?? subscriptionResult.error
    ?? licenseResult.error
    ?? entitlementResult.error
    ?? organizationResult.error
    ?? productResult.error;
  if (firstError) throw firstError;

  const tariffRows = tariffResult.data ?? [];
  const tariffProductRows = tariffProductResult.data ?? [];
  const subscriptionRows = subscriptionResult.data ?? [];
  const licenseRows = licenseResult.data ?? [];
  const entitlementRows = entitlementResult.data ?? [];
  const organizationRows = organizationResult.data ?? [];
  const productRows = productResult.data ?? [];

  const organizations: BillingOrganization[] = organizationRows.map((organization) => ({
    id: organization.id,
    name: organization.name,
    status: organization.status,
  }));
  const products: BillingProduct[] = productRows.map((product) => ({
    id: product.id,
    key: product.key,
    name: product.name,
    archivedAt: product.archived_at,
  }));
  const productNameById = new Map(products.map((product) => [product.id, product.name]));
  const organizationNameById = new Map(organizations.map((organization) => [organization.id, organization.name]));

  const tariffs: Tariff[] = tariffRows.map((tariff) => ({
    id: tariff.id,
    code: tariff.code,
    name: tariff.name,
    description: tariff.description ?? '',
    currency: tariff.currency,
    monthlyPrice: Number(tariff.monthly_price),
    annualPrice: tariff.annual_price === null ? null : Number(tariff.annual_price),
    trialDays: tariff.trial_days,
    graceDays: tariff.grace_days,
    isCustom: tariff.is_custom,
    isActive: tariff.is_active,
    archivedAt: tariff.archived_at,
    productIds: tariffProductRows
      .filter((item) => item.tariff_id === tariff.id && item.included)
      .map((item) => item.product_id),
    createdAt: tariff.created_at,
    updatedAt: tariff.updated_at,
  }));
  const tariffById = new Map(tariffs.map((tariff) => [tariff.id, tariff]));

  const subscriptions: Subscription[] = subscriptionRows.map((subscription) => {
    const tariff = subscription.tariff_id ? tariffById.get(subscription.tariff_id) : undefined;
    const metadataTariffName = getJsonString(subscription.metadata, 'tariff_name');
    const metadataCurrency = getJsonString(subscription.metadata, 'currency');
    const subscriptionLicenses = licenseRows
      .filter((license) => license.subscription_id === subscription.id)
      .map((license): License => ({
        id: license.id,
        productId: license.product_id,
        productName: productNameById.get(license.product_id) ?? license.product_id,
        status: license.status,
        externalTenantId: license.external_tenant_id,
        activatedAt: license.activated_at,
        expiresAt: license.expires_at,
        entitlements: entitlementRows
          .filter((entitlement) => entitlement.license_id === license.id)
          .map((entitlement) => ({
            id: entitlement.id,
            key: entitlement.key,
            value: entitlement.value,
            source: entitlement.source,
          })),
      }));
    const effectivePrice = subscription.custom_price !== null
      ? Number(subscription.custom_price)
      : subscription.billing_interval === 'annual'
        ? Number(tariff?.annualPrice ?? 0)
        : Number(tariff?.monthlyPrice ?? 0);

    return {
      id: subscription.id,
      organizationId: subscription.organization_id,
      organizationName: organizationNameById.get(subscription.organization_id) ?? subscription.organization_id,
      tariffId: subscription.tariff_id,
      tariffName: tariff?.name ?? (metadataTariffName || 'Индивидуальный'),
      status: subscription.status,
      billingInterval: subscription.billing_interval,
      renewalMode: subscription.renewal_mode,
      startsAt: subscription.starts_at,
      trialEndsAt: subscription.trial_ends_at,
      periodEndsAt: subscription.current_period_ends_at,
      graceEndsAt: subscription.grace_ends_at,
      cancelledAt: subscription.cancelled_at,
      customPrice: subscription.custom_price === null ? null : Number(subscription.custom_price),
      effectivePrice,
      currency: tariff?.currency ?? (metadataCurrency || 'KZT'),
      activatedAt: subscription.activated_at,
      licenses: subscriptionLicenses,
      createdAt: subscription.created_at,
      updatedAt: subscription.updated_at,
    };
  });

  return { tariffs, subscriptions, organizations, products };
}

function addPeriod(start: Date, interval: BillingInterval) {
  const next = new Date(start);
  if (interval === 'annual') next.setFullYear(next.getFullYear() + 1);
  if (interval === 'monthly') next.setMonth(next.getMonth() + 1);
  return interval === 'custom' ? null : next.toISOString();
}

export const billingRepository = {
  async list(): Promise<BillingSnapshot> {
    return listFromSupabase();
  },

  async saveTariff(input: TariffInput): Promise<BillingSnapshot> {
    const supabase = getBillingClient();
    if (supabase) {
      const { data: tariffId, error } = await supabase.rpc('upsert_tariff_definition', {
        tariff_code: input.code,
        tariff_name: input.name,
        tariff_description: input.description || null,
        currency_value: input.currency,
        monthly_price_value: input.monthlyPrice,
        annual_price_value: input.annualPrice,
        trial_days_value: input.trialDays,
        grace_days_value: input.graceDays,
        is_custom_value: input.isCustom,
        is_active_value: input.isActive,
        target_tariff_id: input.id || null,
      });
      if (error) throw error;
      const { error: productsError } = await supabase.rpc('set_tariff_products', {
        target_tariff_id: tariffId,
        product_ids: input.productIds,
      });
      if (productsError) throw productsError;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    const timestamp = new Date().toISOString();
    if (input.id) {
      snapshot.tariffs = snapshot.tariffs.map((tariff) => tariff.id === input.id
        ? { ...tariff, ...input, id: tariff.id, updatedAt: timestamp }
        : tariff);
    } else {
      snapshot.tariffs.unshift({
        ...input,
        id: createId('tariff'),
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async activateSubscription(input: ActivateSubscriptionInput): Promise<BillingSnapshot> {
    const supabase = getBillingClient();
    if (supabase) {
      const { error } = await supabase.rpc('activate_subscription', {
        target_organization_id: input.organizationId,
        target_tariff_id: input.tariffId,
        billing_interval_value: input.billingInterval,
        renewal_mode_value: input.renewalMode,
        starts_at_value: new Date(input.startsAt).toISOString(),
        custom_price_value: input.customPrice,
        selected_product_ids: input.productIds.length ? input.productIds : null,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    const tariff = snapshot.tariffs.find((item) => item.id === input.tariffId);
    const organization = snapshot.organizations.find((item) => item.id === input.organizationId);
    if (!tariff || !organization) throw new Error('Компания или тариф не найдены.');
    const timestamp = new Date().toISOString();
    const start = new Date(input.startsAt);
    const status: SubscriptionStatus = tariff.trialDays > 0 ? 'trial' : 'active';
    const productIds = input.productIds.length ? input.productIds : tariff.productIds;
    const subscriptionId = createId('subscription');
    const trialEndsAt = tariff.trialDays > 0
      ? new Date(start.getTime() + tariff.trialDays * 86400000).toISOString()
      : null;
    const effectivePrice = input.customPrice !== null
      ? input.customPrice
      : input.billingInterval === 'annual'
        ? tariff.annualPrice ?? 0
        : tariff.monthlyPrice;

    snapshot.subscriptions.unshift({
      id: subscriptionId,
      organizationId: organization.id,
      organizationName: organization.name,
      tariffId: tariff.id,
      tariffName: tariff.name,
      status,
      billingInterval: input.billingInterval,
      renewalMode: input.renewalMode,
      startsAt: start.toISOString(),
      trialEndsAt,
      periodEndsAt: addPeriod(start, input.billingInterval),
      graceEndsAt: null,
      cancelledAt: null,
      customPrice: input.customPrice,
      effectivePrice,
      currency: tariff.currency,
      activatedAt: status === 'active' ? start.toISOString() : null,
      licenses: productIds.map((productId) => ({
        id: createId('license'),
        productId,
        productName: snapshot.products.find((product) => product.id === productId)?.name ?? productId,
        status: 'pending',
        externalTenantId: null,
        activatedAt: null,
        expiresAt: addPeriod(start, input.billingInterval),
        entitlements: [],
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async transitionSubscription(id: string, status: SubscriptionStatus, reason: string): Promise<BillingSnapshot> {
    const supabase = getBillingClient();
    if (supabase) {
      const { error } = await supabase.rpc('transition_subscription', {
        target_subscription_id: id,
        new_status: status,
        reason,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    const timestamp = new Date().toISOString();
    snapshot.subscriptions = snapshot.subscriptions.map((subscription) => {
      if (subscription.id !== id) return subscription;
      return {
        ...subscription,
        status,
        activatedAt: status === 'active' ? subscription.activatedAt ?? timestamp : subscription.activatedAt,
        graceEndsAt: status === 'grace_period'
          ? new Date(Date.now() + 7 * 86400000).toISOString()
          : subscription.graceEndsAt,
        cancelledAt: status === 'cancelled' ? timestamp : subscription.cancelledAt,
        licenses: subscription.licenses.map((license) => ({
          ...license,
          status: status === 'suspended'
            ? 'suspended'
            : status === 'cancelled' || status === 'expired'
              ? 'revoked'
              : status === 'active' && license.status === 'suspended'
                ? license.externalTenantId ? 'active' : 'pending'
                : license.status,
        })),
        updatedAt: timestamp,
      };
    });
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async setEntitlement(licenseId: string, key: string, value: Json, reason: string): Promise<BillingSnapshot> {
    const supabase = getBillingClient();
    if (supabase) {
      const { error } = await supabase.rpc('set_license_entitlement', {
        target_license_id: licenseId,
        entitlement_key: key,
        entitlement_value: value,
        reason,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    snapshot.subscriptions = snapshot.subscriptions.map((subscription) => ({
      ...subscription,
      licenses: subscription.licenses.map((license) => {
        if (license.id !== licenseId) return license;
        const existing = license.entitlements.find((entitlement) => entitlement.key === key);
        return {
          ...license,
          entitlements: existing
            ? license.entitlements.map((entitlement) => entitlement.key === key ? { ...entitlement, value, source: 'override' } : entitlement)
            : [...license.entitlements, { id: createId('entitlement'), key, value, source: 'override' }],
        };
      }),
    }));
    writeDemoSnapshot(snapshot);
    return snapshot;
  },
};
