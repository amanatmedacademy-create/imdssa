import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  billingOperationsRepository,
  type AddInvoiceLineInput,
  type BillingOperationsSnapshot,
  type CreateInvoiceInput,
  type RecordPaymentInput,
} from './billingOperationsRepository';

type BillingOperationsContextValue = BillingOperationsSnapshot & {
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createInvoice: (input: CreateInvoiceInput) => Promise<boolean>;
  addInvoiceLine: (input: AddInvoiceLineInput) => Promise<boolean>;
  issueInvoice: (invoiceId: string) => Promise<boolean>;
  recordPayment: (input: RecordPaymentInput) => Promise<boolean>;
  allocatePayment: (paymentId: string, invoiceId: string, amount: number) => Promise<boolean>;
  requestRefund: (paymentId: string, amount: number, reason: string) => Promise<boolean>;
  completeRefund: (refundId: string, externalReference: string) => Promise<boolean>;
};

const emptySnapshot: BillingOperationsSnapshot = {
  accounts: [], invoices: [], payments: [], refunds: [], dunningCases: [], organizations: [], subscriptions: [],
};

const BillingOperationsContext = createContext<BillingOperationsContextValue | null>(null);

export function BillingOperationsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSnapshot(await billingOperationsRepository.list()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить Billing Operations.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const execute = useCallback(async (command: () => Promise<BillingOperationsSnapshot>) => {
    setSaving(true); setError(null);
    try { setSnapshot(await command()); return true; }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Финансовая операция не выполнена.'); return false; }
    finally { setSaving(false); }
  }, []);

  const value = useMemo<BillingOperationsContextValue>(() => ({
    ...snapshot, loading, saving, error, refresh,
    createInvoice: (input) => execute(() => billingOperationsRepository.createInvoice(input)),
    addInvoiceLine: (input) => execute(() => billingOperationsRepository.addInvoiceLine(input)),
    issueInvoice: (invoiceId) => execute(() => billingOperationsRepository.issueInvoice(invoiceId)),
    recordPayment: (input) => execute(() => billingOperationsRepository.recordPayment(input)),
    allocatePayment: (paymentId, invoiceId, amount) => execute(() => billingOperationsRepository.allocatePayment(paymentId, invoiceId, amount)),
    requestRefund: (paymentId, amount, reason) => execute(() => billingOperationsRepository.requestRefund(paymentId, amount, reason)),
    completeRefund: (refundId, externalReference) => execute(() => billingOperationsRepository.completeRefund(refundId, externalReference)),
  }), [snapshot, loading, saving, error, refresh, execute]);

  return <BillingOperationsContext.Provider value={value}>{children}</BillingOperationsContext.Provider>;
}

export function useBillingOperations() {
  const context = useContext(BillingOperationsContext);
  if (!context) throw new Error('useBillingOperations must be used inside BillingOperationsProvider.');
  return context;
}
