import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { governanceRepository, type GovernanceSnapshot } from './governanceRepository';

type GovernanceContextValue = GovernanceSnapshot & {
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createExport: (input: { organizationName: string; productName: string; reason: string; format: string }) => Promise<boolean>;
  createDeletion: (input: { organizationName: string; productName: string; reason: string; mode: string }) => Promise<boolean>;
  createRestore: (input: { productName: string; environment: string; reason: string; dryRun: boolean }) => Promise<boolean>;
};

const empty: GovernanceSnapshot = { policies: [], holds: [], exports: [], deletions: [], backups: [], restores: [] };
const GovernanceContext = createContext<GovernanceContextValue | null>(null);

export function GovernanceProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<GovernanceSnapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSnapshot(await governanceRepository.list()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить Data Governance.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (operation: () => Promise<GovernanceSnapshot>) => {
    setSaving(true); setError(null);
    try { setSnapshot(await operation()); return true; }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Операция Data Governance не выполнена.'); return false; }
    finally { setSaving(false); }
  }, []);

  const value = useMemo<GovernanceContextValue>(() => ({
    ...snapshot, loading, saving, error, refresh,
    createExport: (input) => run(() => governanceRepository.createDemoExport(input)),
    createDeletion: (input) => run(() => governanceRepository.createDemoDeletion(input)),
    createRestore: (input) => run(() => governanceRepository.createDemoRestore(input)),
  }), [snapshot, loading, saving, error, refresh, run]);

  return <GovernanceContext.Provider value={value}>{children}</GovernanceContext.Provider>;
}

export function useGovernance() {
  const context = useContext(GovernanceContext);
  if (!context) throw new Error('useGovernance must be used inside GovernanceProvider.');
  return context;
}
