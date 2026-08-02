import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../core/auth';
import type { ApprovalDecision, AuditVerificationResult } from './securityDatabase.types';
import {
  securityRepository,
  type RequestSecurityApprovalInput,
  type SecuritySnapshot,
} from './securityRepository';

const emptySnapshot: SecuritySnapshot = {
  policies: [],
  requests: [],
  sessions: [],
  auditEvents: [],
  organizations: [],
  products: [],
  users: [],
  pendingNotifications: 0,
};

type SecurityContextValue = SecuritySnapshot & {
  loading: boolean;
  saving: boolean;
  verifying: boolean;
  error: string | null;
  verification: AuditVerificationResult[];
  refresh: () => Promise<void>;
  requestApproval: (input: RequestSecurityApprovalInput) => Promise<boolean>;
  decideApproval: (requestId: string, decision: ApprovalDecision, note: string) => Promise<boolean>;
  cancelApproval: (requestId: string, reason: string) => Promise<boolean>;
  activateSession: (sessionId: string) => Promise<boolean>;
  endSession: (sessionId: string, reason: string) => Promise<boolean>;
  revokeSession: (sessionId: string, reason: string) => Promise<boolean>;
  heartbeatSession: (sessionId: string) => Promise<boolean>;
  markClientNotified: (sessionId: string) => Promise<boolean>;
  expireControls: () => Promise<boolean>;
  verifyAudit: (scopeKey: string | null) => Promise<boolean>;
};

const SecurityContext = createContext<SecurityContextValue | null>(null);

export function SecurityProvider({ children }: { children: ReactNode }) {
  const { profile, role } = useAuth();
  const [snapshot, setSnapshot] = useState<SecuritySnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<AuditVerificationResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const actorUserId = profile?.id ?? 'demo-platform-owner';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await securityRepository.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить Security Approval Center.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = useCallback(async (command: () => Promise<SecuritySnapshot>) => {
    setSaving(true);
    setError(null);
    try {
      setSnapshot(await command());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция безопасности не выполнена.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const verifyAudit = useCallback(async (scopeKey: string | null) => {
    setVerifying(true);
    setError(null);
    try {
      setVerification(await securityRepository.verifyAudit(scopeKey));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Проверка audit chain не выполнена.');
      return false;
    } finally {
      setVerifying(false);
    }
  }, []);

  const value = useMemo<SecurityContextValue>(() => ({
    ...snapshot,
    loading,
    saving,
    verifying,
    error,
    verification,
    refresh,
    requestApproval: (input) => execute(() => securityRepository.request(input, actorUserId, role)),
    decideApproval: (requestId, decision, note) => execute(() => securityRepository.decide(requestId, decision, note, actorUserId, role)),
    cancelApproval: (requestId, reason) => execute(() => securityRepository.cancel(requestId, reason, actorUserId, role)),
    activateSession: (sessionId) => execute(() => securityRepository.activateSession(sessionId, actorUserId, role)),
    endSession: (sessionId, reason) => execute(() => securityRepository.endSession(sessionId, reason, actorUserId, role)),
    revokeSession: (sessionId, reason) => execute(() => securityRepository.revokeSession(sessionId, reason, actorUserId, role)),
    heartbeatSession: (sessionId) => execute(() => securityRepository.heartbeatSession(sessionId, actorUserId, role)),
    markClientNotified: (sessionId) => execute(() => securityRepository.markClientNotified(sessionId, actorUserId)),
    expireControls: () => execute(() => securityRepository.expireControls()),
    verifyAudit,
  }), [actorUserId, error, execute, loading, refresh, role, saving, snapshot, verification, verifyAudit, verifying]);

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity(): SecurityContextValue {
  const context = useContext(SecurityContext);
  if (!context) throw new Error('useSecurity must be used inside SecurityProvider.');
  return context;
}
