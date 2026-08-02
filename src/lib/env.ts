export type RuntimeEnvironment = 'development' | 'staging' | 'production' | 'demo';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

if ((supabaseUrl && !supabaseAnonKey) || (!supabaseUrl && supabaseAnonKey)) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be configured together.');
}

export const env = {
  appEnv: (import.meta.env.VITE_APP_ENV?.trim() || (import.meta.env.PROD ? 'production' : 'development')) as RuntimeEnvironment,
  appVersion: import.meta.env.VITE_APP_VERSION?.trim() || '0.2.0',
  supabaseUrl,
  supabaseAnonKey,
  isSupabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
} as const;
