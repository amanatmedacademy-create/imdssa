import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  productAnalyticsRepository,
  type CreatedTelemetryCredential,
  type ProductAnalyticsSnapshot,
  type TelemetrySourceInput,
} from './productAnalyticsRepository';

const emptySnapshot: ProductAnalyticsSnapshot = {
  generatedAt: new Date(0).toISOString(),
  periodDays: 30,
  targetProductId: null,
  metrics: {
    onlineNow: 0,
    activeNow: 0,
    dau: 0,
    uniqueUsers: 0,
    sessions: 0,
    activeSeconds: 0,
    events: 0,
    errors: 0,
    errorFreePercent: 100,
  },
  products: [],
  liveSessions: [],
  features: [],
  tenants: [],
  sources: [],
  series: [],
  catalog: [],
};

type ProductAnalyticsContextValue = ProductAnalyticsSnapshot & {
  periodDays: number;
  selectedProductId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  setPeriodDays: (value: number) => void;
  setSelectedProductId: (value: string | null) => void;
  refresh: () => Promise<void>;
  createSource: (input: TelemetrySourceInput) => Promise<CreatedTelemetryCredential | null>;
};

const ProductAnalyticsContext = createContext<ProductAnalyticsContextValue | null>(null);

export function ProductAnalyticsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ProductAnalyticsSnapshot>(emptySnapshot);
  const [periodDays, setPeriodDays] = useState(30);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await productAnalyticsRepository.list(periodDays, selectedProductId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить аналитику продуктов.');
    } finally {
      setLoading(false);
    }
  }, [periodDays, selectedProductId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void productAnalyticsRepository.list(periodDays, selectedProductId)
      .then(setSnapshot)
      .catch(() => undefined), 30_000);
    return () => window.clearInterval(timer);
  }, [periodDays, refresh, selectedProductId]);

  const createSource = useCallback(async (input: TelemetrySourceInput) => {
    setSaving(true);
    setError(null);
    try {
      const result = await productAnalyticsRepository.createSource(input, periodDays, selectedProductId);
      setSnapshot(result.snapshot);
      return result.credential;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать источник телеметрии.');
      return null;
    } finally {
      setSaving(false);
    }
  }, [periodDays, selectedProductId]);

  const value = useMemo<ProductAnalyticsContextValue>(() => ({
    ...snapshot,
    periodDays,
    selectedProductId,
    loading,
    saving,
    error,
    setPeriodDays,
    setSelectedProductId,
    refresh,
    createSource,
  }), [createSource, error, loading, periodDays, refresh, saving, selectedProductId, snapshot]);

  return <ProductAnalyticsContext.Provider value={value}>{children}</ProductAnalyticsContext.Provider>;
}

export function useProductAnalytics(): ProductAnalyticsContextValue {
  const context = useContext(ProductAnalyticsContext);
  if (!context) throw new Error('useProductAnalytics must be used inside ProductAnalyticsProvider.');
  return context;
}
