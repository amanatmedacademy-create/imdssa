import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supportRepository, type CreateTicketInput, type SupportPriority, type SupportSnapshot, type SupportStatus } from './supportRepository';

const emptySnapshot: SupportSnapshot = { tickets: [], messages: [], organizations: [], products: [], staff: [] };

type SupportContextValue = SupportSnapshot & {
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createTicket: (input: CreateTicketInput) => Promise<boolean>;
  addMessage: (ticketId: string, body: string, internal: boolean) => Promise<boolean>;
  updateTicket: (ticketId: string, status: SupportStatus, priority: SupportPriority, assigneeId: string | null) => Promise<boolean>;
};

const SupportContext = createContext<SupportContextValue | null>(null);

export function SupportProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setSnapshot(await supportRepository.list()); setError(null); }
    catch (value) { setError(value instanceof Error ? value.message : 'Не удалось загрузить поддержку.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (operation: () => Promise<SupportSnapshot>) => {
    setSaving(true);
    try { setSnapshot(await operation()); setError(null); return true; }
    catch (value) { setError(value instanceof Error ? value.message : 'Операция поддержки не выполнена.'); return false; }
    finally { setSaving(false); }
  }, []);

  const value = useMemo<SupportContextValue>(() => ({
    ...snapshot, loading, saving, error, refresh,
    createTicket: (input) => run(() => supportRepository.createTicket(input)),
    addMessage: (ticketId, body, internal) => run(() => supportRepository.addMessage(ticketId, body, internal)),
    updateTicket: (ticketId, status, priority, assigneeId) => run(() => supportRepository.updateTicket(ticketId, status, priority, assigneeId)),
  }), [snapshot, loading, saving, error, refresh, run]);

  return <SupportContext.Provider value={value}>{children}</SupportContext.Provider>;
}

export function useSupport() {
  const context = useContext(SupportContext);
  if (!context) throw new Error('useSupport must be used inside SupportProvider.');
  return context;
}
