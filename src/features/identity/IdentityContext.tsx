import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  identityRepository,
  type IdentitySnapshot,
  type InviteIdentityInput,
  type MembershipInput,
  type UserAccessInput,
} from './identityRepository';

const emptySnapshot: IdentitySnapshot = {
  users: [],
  invitations: [],
  organizations: [],
  branches: [],
  products: [],
};

type IdentityContextValue = IdentitySnapshot & {
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  inviteUser: (input: InviteIdentityInput) => Promise<boolean>;
  cancelInvitation: (invitationId: string, reason: string) => Promise<boolean>;
  updateUser: (input: UserAccessInput) => Promise<boolean>;
  saveMembership: (input: MembershipInput) => Promise<boolean>;
};

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<IdentitySnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await identityRepository.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить Identity Directory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = useCallback(async (command: () => Promise<IdentitySnapshot>) => {
    setSaving(true);
    setError(null);
    try {
      setSnapshot(await command());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция Identity Directory не выполнена.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo<IdentityContextValue>(() => ({
    ...snapshot,
    loading,
    saving,
    error,
    refresh,
    inviteUser: (input) => execute(() => identityRepository.invite(input)),
    cancelInvitation: (invitationId, reason) => execute(() => identityRepository.cancelInvitation(invitationId, reason)),
    updateUser: (input) => execute(() => identityRepository.updateUser(input)),
    saveMembership: (input) => execute(() => identityRepository.saveMembership(input)),
  }), [error, execute, loading, refresh, saving, snapshot]);

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const context = useContext(IdentityContext);
  if (!context) throw new Error('useIdentity must be used inside IdentityProvider.');
  return context;
}
