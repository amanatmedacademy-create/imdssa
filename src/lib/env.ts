export type RuntimeEnvironment = 'development' | 'staging' | 'production' | 'demo';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
const explicitAppEnv = import.meta.env.VITE_APP_ENV?.trim();
const appEnv = (
  explicitAppEnv
  || (isSupabaseConfigured ? (import.meta.env.PROD ? 'production' : 'development') : 'demo')
) as RuntimeEnvironment;
const releaseSha = import.meta.env.VITE_RELEASE_SHA?.trim() || import.meta.env.CF_PAGES_COMMIT_SHA?.trim() || '';

if ((supabaseUrl && !supabaseAnonKey) || (!supabaseUrl && supabaseAnonKey)) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be configured together.');
}

if (explicitAppEnv === 'production' && !isSupabaseConfigured) {
  throw new Error('Production runtime requires Supabase public credentials.');
}

export const env = {
  appEnv,
  appVersion: import.meta.env.VITE_APP_VERSION?.trim() || '0.4.0',
  releaseSha,
  releaseLabel: releaseSha ? releaseSha.slice(0, 12) : 'unversioned',
  supabaseUrl,
  supabaseAnonKey,
  isSupabaseConfigured,
  isProduction: appEnv === 'production',
} as const;
