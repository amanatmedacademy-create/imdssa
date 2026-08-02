export type RuntimeEnvironment = 'development' | 'staging' | 'production' | 'demo';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const appEnv = (import.meta.env.VITE_APP_ENV?.trim() || (import.meta.env.PROD ? 'production' : 'development')) as RuntimeEnvironment;
const releaseSha = import.meta.env.VITE_RELEASE_SHA?.trim() || import.meta.env.CF_PAGES_COMMIT_SHA?.trim() || '';

if ((supabaseUrl && !supabaseAnonKey) || (!supabaseUrl && supabaseAnonKey)) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be configured together.');
}

if (appEnv === 'production' && (!supabaseUrl || !supabaseAnonKey)) {
  throw new Error('Production runtime requires Supabase public credentials.');
}

export const env = {
  appEnv,
  appVersion: import.meta.env.VITE_APP_VERSION?.trim() || '0.3.0',
  releaseSha,
  releaseLabel: releaseSha ? releaseSha.slice(0, 12) : 'unversioned',
  supabaseUrl,
  supabaseAnonKey,
  isSupabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  isProduction: appEnv === 'production',
} as const;
