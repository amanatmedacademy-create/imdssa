import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  observabilityRepository,
  type ConnectionInput,
  type ObservabilitySnapshot,
  type ServiceInput,
} from './observabilityRepository';

const emptySnapshot: ObservabilitySnapshot = {
  connections: [],
  services: [],
  incidents: [],
  syncRuns: [],
  products: [],
};

type ObservabilityContextValue = ObservabilitySnapshot & {
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveConnection: (input: ConnectionInput) => Promise<boolean>;
  saveService: (input: ServiceInput) => Promise<boolean>;
  enqueueSync: (connectionId: string, syncType: string) => Promise<boolean>;
  acknowledgeIncident: (incidentId: string, note: string) => Promise<boolean>;
};

const ObservabilityContext = createContext<ObservabilityContextValue | null>(null);

export function ObservabilityProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ObservabilitySnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await observabilityRepository.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить Observability Center.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = useCallback(async (command: () => Promise<ObservabilitySnapshot>) => {
    setSaving(true);
    setError(null);
    try {
      setSnapshot(await command());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция Observability Center не выполнена.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo<ObservabilityContextValue>(() => ({
    ...snapshot,
    loading,
    saving,
    error,
    refresh,
    saveConnection: (input) => execute(() => observabilityRepository.saveConnection(input)),
    saveService: (input) => execute(() => observabilityRepository.saveService(input)),
    enqueueSync: (connectionId, syncType) => execute(() => observabilityRepository.enqueueSync(connectionId, syncType)),
    acknowledgeIncident: (incidentId, note) => execute(() => observabilityRepository.acknowledgeIncident(incidentId, note)),
  }), [error, execute, loading, refresh, saving, snapshot]);

  return <ObservabilityContext.Provider value={value}>{children}</ObservabilityContext.Provider>;
}

export function useObservability(): ObservabilityContextValue {
  const context = useContext(ObservabilityContext);
  if (!context) throw new Error('useObservability must be used inside ObservabilityProvider.');
  return context;
}
