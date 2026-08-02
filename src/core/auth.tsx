import type { Session, User } from '@supabase/supabase-js';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Database, GlobalRole } from '../lib/database.types';
import { env } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { hasPermission, type Permission } from './permissions';

type PlatformProfile = Database['public']['Tables']['platform_users']['Row'];

type AuthContextValue = {
  loading: boolean;
  isDemo: boolean;
  session: Session | null;
  user: User | null;
  profile: PlatformProfile | null;
  role: GlobalRole | null;
  error: string | null;
  can: (permission: Permission) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const demoProfile: PlatformProfile = {
  id: 'demo-platform-owner',
  email: 'owner@imdstech.net',
  full_name: 'Platform Owner',
  global_role: 'platform_owner',
  mfa_enforced: true,
  is_active: true,
  last_seen_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const [loading, setLoading] = useState(Boolean(supabase));
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PlatformProfile | null>(supabase ? null : demoProfile);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (nextUser: User | null) => {
    if (!supabase) {
      setUser(null);
      setProfile(demoProfile);
      setError(null);
      setLoading(false);
      return;
    }

    setUser(nextUser);
    if (!nextUser) {
      setProfile(null);
      setError(null);
      setLoading(false);
      return;
    }

    const { data, error: profileError } = await supabase
      .from('platform_users')
      .select('*')
      .eq('id', nextUser.id)
      .maybeSingle();

    if (profileError) {
      setProfile(null);
      setError(`Не удалось загрузить профиль платформы: ${profileError.message}`);
      setLoading(false);
      return;
    }

    if (!data || !data.is_active || !data.global_role) {
      setProfile(null);
      setError('Аккаунт не зарегистрирован как активный сотрудник IMDS Super Admin.');
      setLoading(false);
      return;
    }

    setProfile(data);
    setError(null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) {
        setError(sessionError.message);
        setLoading(false);
        return;
      }
      setSession(data.session);
      void loadProfile(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      queueMicrotask(() => {
        if (mounted) void loadProfile(nextSession?.user ?? null);
      });
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile, supabase]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setLoading(false);
      setError(signInError.message);
      throw signInError;
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      throw signOutError;
    }
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    await loadProfile(user);
  }, [loadProfile, user]);

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    isDemo: !env.isSupabaseConfigured,
    session,
    user,
    profile,
    role: profile?.global_role ?? null,
    error,
    can: (permission) => hasPermission(profile?.global_role, permission),
    signIn,
    signOut,
    refreshProfile,
  }), [error, loading, profile, refreshProfile, session, signIn, signOut, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
