import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  operationsRepository,
  type EnqueueCommandInput,
  type OperationsSnapshot,
} from './operationsRepository';

const emptySnapshot: OperationsSnapshot = {
  commands: [],
  licenses: [],
};

type OperationsContextValue = OperationsSnapshot & {
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  enqueueCommand: (input: EnqueueCommandInput) => Promise<boolean>;
  retryCommand: (commandId: string, reason: string) => Promise<boolean>;
  cancelCommand: (commandId: string, reason: string) => Promise<boolean>;
};

const OperationsContext = createContext<OperationsContextValue | null>(null);

export function OperationsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await operationsRepository.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить очередь provisioning.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = useCallback(async (command: () => Promise<OperationsSnapshot>) => {
    setSaving(true);
    setError(null);
    try {
      setSnapshot(await command());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операционная команда не выполнена.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo<OperationsContextValue>(() => ({
    ...snapshot,
    loading,
    saving,
    error,
    refresh,
    enqueueCommand: (input) => execute(() => operationsRepository.enqueue(input)),
    retryCommand: (commandId, reason) => execute(() => operationsRepository.retry(commandId, reason)),
    cancelCommand: (commandId, reason) => execute(() => operationsRepository.cancel(commandId, reason)),
  }), [error, execute, loading, refresh, saving, snapshot]);

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations(): OperationsContextValue {
  const context = useContext(OperationsContext);
  if (!context) throw new Error('useOperations must be used inside OperationsProvider.');
  return context;
}
