import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded';
export type RefundStatus = 'requested' | 'pending_approval' | 'approved' | 'processing' | 'succeeded' | 'failed' | 'rejected' | 'cancelled';
export type PaymentMethod = 'bank_transfer' | 'kaspi' | 'card' | 'cash' | 'manual' | 'other';

export type BillingAccount = {
  id: string;
  organizationId: string;
  organizationName: string;
  legalName: string;
  binIin: string;
  billingEmail: string;
  currency: string;
  paymentTermsDays: number;
  balance: number;
  overdueBalance: number;
};

export type Invoice = {
  id: string;
  organizationId: string;
  organizationName: string;
  subscriptionId: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paidTotal: number;
  outstandingTotal: number;
  issuedAt: string | null;
  dueAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string;
  lines: InvoiceLine[];
};

export type InvoiceLine = {
  id: string;
  invoiceId: string;
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  lineTotal: number;
};

export type Payment = {
  id: string;
  organizationId: string;
  organizationName: string;
  paymentNumber: string;
  status: PaymentStatus;
  method: PaymentMethod;
  currency: string;
  amount: number;
  refundedAmount: number;
  receivedAt: string | null;
  externalReference: string;
  allocatedAmount: number;
};

export type Refund = {
  id: string;
  paymentId: string;
  organizationName: string;
  refundNumber: string;
  status: RefundStatus;
  amount: number;
  reason: string;
  approvalRequestId: string | null;
  createdAt: string;
};

export type DunningCase = {
  id: string;
  organizationName: string;
  invoiceNumber: string;
  status: string;
  stage: number;
  nextActionAt: string | null;
  promisedPaymentAt: string | null;
  notes: string;
};

export type BillingOperationsSnapshot = {
  accounts: BillingAccount[];
  invoices: Invoice[];
  payments: Payment[];
  refunds: Refund[];
  dunningCases: DunningCase[];
  organizations: { id: string; name: string }[];
  subscriptions: { id: string; organizationId: string; label: string; currency: string }[];
};

export type CreateInvoiceInput = {
  organizationId: string;
  subscriptionId: string | null;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  notes: string;
};

export type AddInvoiceLineInput = {
  invoiceId: string;
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
};

export type RecordPaymentInput = {
  organizationId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  receivedAt: string;
  externalReference: string;
  payerName: string;
};

const STORAGE_KEY = 'imds-super-admin:billing-operations:v1';
const now = '2026-08-02T14:00:00.000Z';
const organizations = [
  { id: 'org-amanat', name: 'Amanat Medical Center' },
  { id: 'org-orda', name: 'Orda Clinic' },
  { id: 'org-sapa', name: 'Sapa Med' },
];

const demoSnapshot: BillingOperationsSnapshot = {
  organizations,
  subscriptions: [
    { id: 'subscription-amanat', organizationId: 'org-amanat', label: 'Amanat · Business', currency: 'KZT' },
    { id: 'subscription-orda', organizationId: 'org-orda', label: 'Orda · Trial', currency: 'KZT' },
    { id: 'subscription-sapa', organizationId: 'org-sapa', label: 'Sapa · Business', currency: 'KZT' },
  ],
  accounts: [
    { id: 'account-amanat', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', legalName: 'ТОО Amanat Medical Center', binIin: '123456789012', billingEmail: 'finance@amanat.example', currency: 'KZT', paymentTermsDays: 7, balance: 350000, overdueBalance: 0 },
    { id: 'account-sapa', organizationId: 'org-sapa', organizationName: 'Sapa Med', legalName: 'ТОО Sapa Med', binIin: '123456789013', billingEmail: 'finance@sapa.example', currency: 'KZT', paymentTermsDays: 7, balance: 420000, overdueBalance: 420000 },
  ],
  invoices: [
    { id: 'invoice-amanat-aug', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', subscriptionId: 'subscription-amanat', invoiceNumber: 'INV-202608-00001', status: 'partially_paid', currency: 'KZT', subtotal: 500000, discountTotal: 0, taxTotal: 0, total: 500000, paidTotal: 150000, outstandingTotal: 350000, issuedAt: '2026-08-01T09:00:00.000Z', dueAt: '2026-08-08T09:00:00.000Z', periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z', notes: '', lines: [{ id: 'line-1', invoiceId: 'invoice-amanat-aug', lineType: 'subscription', description: 'IMDS Business — август 2026', quantity: 1, unitPrice: 500000, discountAmount: 0, taxRate: 0, lineTotal: 500000 }] },
    { id: 'invoice-sapa-jul', organizationId: 'org-sapa', organizationName: 'Sapa Med', subscriptionId: 'subscription-sapa', invoiceNumber: 'INV-202607-00008', status: 'overdue', currency: 'KZT', subtotal: 420000, discountTotal: 0, taxTotal: 0, total: 420000, paidTotal: 0, outstandingTotal: 420000, issuedAt: '2026-07-01T09:00:00.000Z', dueAt: '2026-07-08T09:00:00.000Z', periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-08-01T00:00:00.000Z', notes: 'Просрочка требует контроля.', lines: [{ id: 'line-2', invoiceId: 'invoice-sapa-jul', lineType: 'subscription', description: 'IMDS Business — июль 2026', quantity: 1, unitPrice: 420000, discountAmount: 0, taxRate: 0, lineTotal: 420000 }] },
  ],
  payments: [
    { id: 'payment-amanat', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', paymentNumber: 'PAY-202608-00001', status: 'succeeded', method: 'bank_transfer', currency: 'KZT', amount: 150000, refundedAmount: 0, receivedAt: '2026-08-02T08:30:00.000Z', externalReference: 'BANK-44291', allocatedAmount: 150000 },
  ],
  refunds: [],
  dunningCases: [
    { id: 'dunning-sapa', organizationName: 'Sapa Med', invoiceNumber: 'INV-202607-00008', status: 'open', stage: 2, nextActionAt: '2026-08-03T08:00:00.000Z', promisedPaymentAt: null, notes: 'Повторный контакт с финансовым директором.' },
  ],
};

function getClient(): SupabaseClient<any> | null {
  return getSupabase() as SupabaseClient<any> | null;
}

function cloneDemo() {
  return JSON.parse(JSON.stringify(demoSnapshot)) as BillingOperationsSnapshot;
}

function readDemo() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDemo();
    return JSON.parse(raw) as BillingOperationsSnapshot;
  } catch {
    return cloneDemo();
  }
}

function writeDemo(snapshot: BillingOperationsSnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

function createId(prefix: string) {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${prefix}-${Date.now()}`;
}

async function listFromSupabase(): Promise<BillingOperationsSnapshot> {
  const supabase = getClient();
  if (!supabase) return readDemo();

  const [accountResult, invoiceResult, lineResult, paymentResult, allocationResult, refundResult, dunningResult, orgResult, subscriptionResult, tariffResult] = await Promise.all([
    supabase.from('billing_accounts').select('*').order('updated_at', { ascending: false }),
    supabase.from('invoices').select('*').order('created_at', { ascending: false }),
    supabase.from('invoice_lines').select('*').order('created_at'),
    supabase.from('payments').select('*').order('received_at', { ascending: false }),
    supabase.from('payment_allocations').select('*'),
    supabase.from('refunds').select('*').order('created_at', { ascending: false }),
    supabase.from('dunning_cases').select('*').order('created_at', { ascending: false }),
    supabase.from('organizations').select('id,name').order('name'),
    supabase.from('subscriptions').select('id,organization_id,tariff_id,metadata'),
    supabase.from('tariffs').select('id,name,currency'),
  ]);
  const error = accountResult.error ?? invoiceResult.error ?? lineResult.error ?? paymentResult.error ?? allocationResult.error ?? refundResult.error ?? dunningResult.error ?? orgResult.error ?? subscriptionResult.error ?? tariffResult.error;
  if (error) throw error;

  const orgName = new Map((orgResult.data ?? []).map((row: any) => [row.id, row.name]));
  const tariffById = new Map((tariffResult.data ?? []).map((row: any) => [row.id, row]));
  const invoiceById = new Map((invoiceResult.data ?? []).map((row: any) => [row.id, row.invoice_number]));
  const payments = (paymentResult.data ?? []).map((row: any): Payment => ({
    id: row.id, organizationId: row.organization_id, organizationName: orgName.get(row.organization_id) ?? row.organization_id,
    paymentNumber: row.payment_number, status: row.status, method: row.method, currency: row.currency,
    amount: Number(row.amount), refundedAmount: Number(row.refunded_amount), receivedAt: row.received_at,
    externalReference: row.external_reference ?? '',
    allocatedAmount: (allocationResult.data ?? []).filter((item: any) => item.payment_id === row.id).reduce((sum: number, item: any) => sum + Number(item.amount), 0),
  }));

  return {
    organizations: orgResult.data ?? [],
    subscriptions: (subscriptionResult.data ?? []).map((row: any) => {
      const tariff = tariffById.get(row.tariff_id);
      return { id: row.id, organizationId: row.organization_id, label: `${orgName.get(row.organization_id) ?? row.organization_id} · ${tariff?.name ?? 'Индивидуальный'}`, currency: tariff?.currency ?? 'KZT' };
    }),
    accounts: (accountResult.data ?? []).map((row: any) => ({ id: row.id, organizationId: row.organization_id, organizationName: orgName.get(row.organization_id) ?? row.organization_id, legalName: row.legal_name ?? '', binIin: row.bin_iin ?? '', billingEmail: row.billing_email ?? '', currency: row.currency, paymentTermsDays: row.payment_terms_days, balance: Number(row.balance), overdueBalance: Number(row.overdue_balance) })),
    invoices: (invoiceResult.data ?? []).map((row: any): Invoice => ({ id: row.id, organizationId: row.organization_id, organizationName: orgName.get(row.organization_id) ?? row.organization_id, subscriptionId: row.subscription_id, invoiceNumber: row.invoice_number, status: row.status, currency: row.currency, subtotal: Number(row.subtotal), discountTotal: Number(row.discount_total), taxTotal: Number(row.tax_total), total: Number(row.total), paidTotal: Number(row.paid_total), outstandingTotal: Number(row.outstanding_total), issuedAt: row.issued_at, dueAt: row.due_at, periodStart: row.period_start, periodEnd: row.period_end, notes: row.notes ?? '', lines: (lineResult.data ?? []).filter((line: any) => line.invoice_id === row.id).map((line: any) => ({ id: line.id, invoiceId: line.invoice_id, lineType: line.line_type, description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unit_price), discountAmount: Number(line.discount_amount), taxRate: Number(line.tax_rate), lineTotal: Number(line.line_total) })) })),
    payments,
    refunds: (refundResult.data ?? []).map((row: any) => ({ id: row.id, paymentId: row.payment_id, organizationName: orgName.get(row.organization_id) ?? row.organization_id, refundNumber: row.refund_number, status: row.status, amount: Number(row.amount), reason: row.reason, approvalRequestId: row.approval_request_id, createdAt: row.created_at })),
    dunningCases: (dunningResult.data ?? []).map((row: any) => ({ id: row.id, organizationName: orgName.get(row.organization_id) ?? row.organization_id, invoiceNumber: invoiceById.get(row.invoice_id) ?? '—', status: row.status, stage: row.stage, nextActionAt: row.next_action_at, promisedPaymentAt: row.promised_payment_at, notes: row.notes ?? '' })),
  };
}

export const billingOperationsRepository = {
  list: listFromSupabase,
  async createInvoice(input: CreateInvoiceInput) {
    const supabase = getClient();
    if (supabase) {
      const { error } = await supabase.rpc('create_invoice', { organization_id_value: input.organizationId, subscription_id_value: input.subscriptionId, currency_value: input.currency, period_start_value: input.periodStart, period_end_value: input.periodEnd, due_at_value: input.dueAt, notes_value: input.notes });
      if (error) throw error;
      return listFromSupabase();
    }
    const snapshot = readDemo();
    const organizationName = snapshot.organizations.find((item) => item.id === input.organizationId)?.name ?? input.organizationId;
    snapshot.invoices.unshift({ id: createId('invoice'), organizationId: input.organizationId, organizationName, subscriptionId: input.subscriptionId, invoiceNumber: `INV-DEMO-${String(snapshot.invoices.length + 1).padStart(5, '0')}`, status: 'draft', currency: input.currency, subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0, paidTotal: 0, outstandingTotal: 0, issuedAt: null, dueAt: input.dueAt, periodStart: input.periodStart, periodEnd: input.periodEnd, notes: input.notes, lines: [] });
    return writeDemo(snapshot);
  },
  async addInvoiceLine(input: AddInvoiceLineInput) {
    const supabase = getClient();
    if (supabase) {
      const { error } = await supabase.rpc('add_invoice_line', { invoice_id_value: input.invoiceId, line_type_value: input.lineType, description_value: input.description, quantity_value: input.quantity, unit_price_value: input.unitPrice, discount_amount_value: input.discountAmount, tax_rate_value: input.taxRate, product_id_value: null, license_id_value: null });
      if (error) throw error;
      return listFromSupabase();
    }
    const snapshot = readDemo();
    const invoice = snapshot.invoices.find((item) => item.id === input.invoiceId);
    if (!invoice || invoice.status !== 'draft') throw new Error('Редактировать можно только черновик счёта.');
    const subtotal = input.quantity * input.unitPrice;
    const taxable = Math.max(subtotal - input.discountAmount, 0);
    const total = taxable + taxable * input.taxRate / 100;
    invoice.lines.push({ id: createId('line'), invoiceId: invoice.id, lineType: input.lineType, description: input.description, quantity: input.quantity, unitPrice: input.unitPrice, discountAmount: input.discountAmount, taxRate: input.taxRate, lineTotal: total });
    invoice.subtotal += subtotal; invoice.discountTotal += input.discountAmount; invoice.taxTotal += taxable * input.taxRate / 100; invoice.total += total; invoice.outstandingTotal = invoice.total;
    return writeDemo(snapshot);
  },
  async issueInvoice(invoiceId: string) {
    const supabase = getClient();
    if (supabase) { const { error } = await supabase.rpc('issue_invoice', { invoice_id_value: invoiceId }); if (error) throw error; return listFromSupabase(); }
    const snapshot = readDemo(); const invoice = snapshot.invoices.find((item) => item.id === invoiceId); if (!invoice || invoice.total <= 0) throw new Error('Добавьте позиции перед выставлением счёта.'); invoice.status = 'issued'; invoice.issuedAt = new Date().toISOString(); return writeDemo(snapshot);
  },
  async recordPayment(input: RecordPaymentInput) {
    const supabase = getClient();
    if (supabase) { const { error } = await supabase.rpc('record_payment', { organization_id_value: input.organizationId, amount_value: input.amount, currency_value: input.currency, method_value: input.method, received_at_value: input.receivedAt, external_reference_value: input.externalReference, payer_name_value: input.payerName }); if (error) throw error; return listFromSupabase(); }
    const snapshot = readDemo(); const organizationName = snapshot.organizations.find((item) => item.id === input.organizationId)?.name ?? input.organizationId; snapshot.payments.unshift({ id: createId('payment'), organizationId: input.organizationId, organizationName, paymentNumber: `PAY-DEMO-${snapshot.payments.length + 1}`, status: 'succeeded', method: input.method, currency: input.currency, amount: input.amount, refundedAmount: 0, receivedAt: input.receivedAt, externalReference: input.externalReference, allocatedAmount: 0 }); return writeDemo(snapshot);
  },
  async allocatePayment(paymentId: string, invoiceId: string, amount: number) {
    const supabase = getClient();
    if (supabase) { const { error } = await supabase.rpc('allocate_payment', { payment_id_value: paymentId, invoice_id_value: invoiceId, amount_value: amount }); if (error) throw error; return listFromSupabase(); }
    const snapshot = readDemo(); const payment = snapshot.payments.find((item) => item.id === paymentId); const invoice = snapshot.invoices.find((item) => item.id === invoiceId); if (!payment || !invoice) throw new Error('Платёж или счёт не найден.'); if (payment.organizationId !== invoice.organizationId) throw new Error('Платёж и счёт относятся к разным компаниям.'); if (amount <= 0 || payment.allocatedAmount + amount > payment.amount - payment.refundedAmount || amount > invoice.outstandingTotal) throw new Error('Сумма распределения превышает доступный остаток.'); payment.allocatedAmount += amount; invoice.paidTotal += amount; invoice.outstandingTotal = Math.max(invoice.total - invoice.paidTotal, 0); invoice.status = invoice.outstandingTotal === 0 ? 'paid' : 'partially_paid'; return writeDemo(snapshot);
  },
  async requestRefund(paymentId: string, amount: number, reason: string) {
    const supabase = getClient();
    if (supabase) { const { error } = await supabase.rpc('request_refund', { payment_id_value: paymentId, amount_value: amount, reason_value: reason }); if (error) throw error; return listFromSupabase(); }
    const snapshot = readDemo(); const payment = snapshot.payments.find((item) => item.id === paymentId); if (!payment || payment.refundedAmount + amount > payment.amount) throw new Error('Сумма возврата превышает доступный остаток.'); snapshot.refunds.unshift({ id: createId('refund'), paymentId, organizationName: payment.organizationName, refundNumber: `REF-DEMO-${snapshot.refunds.length + 1}`, status: amount >= 500000 ? 'pending_approval' : 'approved', amount, reason, approvalRequestId: amount >= 500000 ? 'demo-approval' : null, createdAt: now }); return writeDemo(snapshot);
  },
  async completeRefund(refundId: string, externalReference: string) {
    const supabase = getClient();
    if (supabase) { const { error } = await supabase.rpc('complete_refund', { refund_id_value: refundId, external_reference_value: externalReference }); if (error) throw error; return listFromSupabase(); }
    const snapshot = readDemo(); const refund = snapshot.refunds.find((item) => item.id === refundId); if (!refund || refund.status === 'pending_approval') throw new Error('Сначала необходимо одобрить возврат.'); const payment = snapshot.payments.find((item) => item.id === refund.paymentId); if (!payment) throw new Error('Платёж не найден.'); refund.status = 'succeeded'; payment.refundedAmount += refund.amount; payment.status = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded'; return writeDemo(snapshot);
  },
};
