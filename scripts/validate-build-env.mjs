const allowedEnvironments = new Set(['development', 'staging', 'production', 'demo']);
const environment = (process.env.VITE_APP_ENV || '').trim() || 'development';
const strict = process.env.IMDS_STRICT_ENV === 'true' || environment === 'production';
const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const appVersion = (process.env.VITE_APP_VERSION || '').trim();
const releaseSha = (process.env.VITE_RELEASE_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const errors = [];
const warnings = [];

if (!allowedEnvironments.has(environment)) errors.push(`VITE_APP_ENV must be one of: ${[...allowedEnvironments].join(', ')}`);
if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) errors.push('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be configured together.');

if (supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);
    if (strict && parsed.protocol !== 'https:') errors.push('Production Supabase URL must use HTTPS.');
    if (!['https:', 'http:'].includes(parsed.protocol)) errors.push('VITE_SUPABASE_URL must be an HTTP(S) URL.');
  } catch {
    errors.push('VITE_SUPABASE_URL is not a valid URL.');
  }
}

if (strict && (!supabaseUrl || !supabaseAnonKey)) errors.push('Production build requires Supabase public credentials.');
if (supabaseAnonKey && /service[_-]?role/i.test(supabaseAnonKey)) errors.push('A service-role key must never be exposed through VITE_SUPABASE_ANON_KEY.');
if (!appVersion) warnings.push('VITE_APP_VERSION is not set; package fallback will be displayed.');
if (!releaseSha) warnings.push('VITE_RELEASE_SHA is not set; deployments will not expose an exact release identifier.');
if (!strict && environment !== 'demo' && (!supabaseUrl || !supabaseAnonKey)) warnings.push('Supabase is not configured; the application will use demo fallback data.');

for (const warning of warnings) console.warn(`[env warning] ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`[env error] ${error}`);
  process.exit(1);
}

console.log(`[env] validated environment=${environment} strict=${strict} release=${releaseSha ? releaseSha.slice(0, 12) : 'unversioned'}`);
