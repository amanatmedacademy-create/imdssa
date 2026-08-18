const allowedEnvironments = new Set(['development', 'staging', 'production']);
const environment = (process.env.VITE_APP_ENV || '').trim() || 'development';
const runtime = (process.env.VITE_RUNTIME || '').trim() || 'vps';
const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const appVersion = (process.env.VITE_APP_VERSION || '').trim();
const releaseSha = (process.env.VITE_RELEASE_SHA || process.env.GITHUB_SHA || '').trim();
const errors = [];
const warnings = [];

if (!allowedEnvironments.has(environment)) errors.push(`VITE_APP_ENV must be one of: ${[...allowedEnvironments].join(', ')}`);
if (runtime !== 'vps') errors.push('IMDS Control Center supports only VITE_RUNTIME=vps.');
if (supabaseUrl || supabaseAnonKey) errors.push('Supabase frontend credentials are not allowed in the VPS-only Control Center runtime.');
if (!appVersion) warnings.push('VITE_APP_VERSION is not set; package fallback will be displayed.');
if (!releaseSha) warnings.push('VITE_RELEASE_SHA is not set; deployments will not expose an exact release identifier.');

for (const warning of warnings) console.warn(`[env warning] ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`[env error] ${error}`);
  process.exit(1);
}

console.log(`[env] validated environment=${environment} runtime=vps release=${releaseSha ? releaseSha.slice(0, 12) : 'unversioned'}`);
