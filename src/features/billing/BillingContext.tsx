import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Json } from '../../lib/database.types';
import type { SubscriptionStatus } from './billingDatabase.types';
import {
  billingRepository,
  type ActivateSubscriptionInput,
  type BillingSnapshot,
  type TariffInput,
} from './billingRepository';

type BillingContextValue = BillingSnapshot & {
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveTariff: (input: TariffInput) => Promise<boolean>;
  activateSubscription: (input: ActivateSubscriptionInput) => Promise<boolean>;
  transitionSubscription: (id: string, status: SubscriptionStatus, reason: string) => Promise<boolean>;
  setEntitlement: (licenseId: string, key: string, value: Json, reason: string) => Promise<boolean>;
};

const emptySnapshot: BillingSnapshot = {
  tariffs: [],
  subscriptions: [],
  organizations: [],
  products: [],
};

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BillingSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await billingRepository.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить подписки и лицензии.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = useCallback(async (command: () => Promise<BillingSnapshot>) => {
    setSaving(true);
    setError(null);
    try {
      setSnapshot(await command());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция с подпиской не выполнена.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo<BillingContextValue>(() => ({
    ...snapshot,
    loading,
    saving,
    error,
    refresh,
    saveTariff: (input) => execute(() => billingRepository.saveTariff(input)),
    activateSubscription: (input) => execute(() => billingRepository.activateSubscription(input)),
    transitionSubscription: (id, status, reason) => execute(() => billingRepository.transitionSubscription(id, status, reason)),
    setEntitlement: (licenseId, key, entitlementValue, reason) => execute(() => billingRepository.setEntitlement(licenseId, key, entitlementValue, reason)),
  }), [error, execute, loading, refresh, saving, snapshot]);

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingContextValue {
  const context = useContext(BillingContext);
  if (!context) throw new Error('useBilling must be used inside BillingProvider.');
  return context;
}
