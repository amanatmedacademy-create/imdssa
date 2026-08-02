import { readdir, readFile } from 'node:fs/promises';

const errors = [];
const warnings = [];
const migrationDir = new URL('../supabase/migrations/', import.meta.url);
const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
const seenPrefixes = new Map();

for (const file of files) {
  const match = /^(\d{4})_/.exec(file);
  if (!match) {
    errors.push(`Migration filename must start with a four-digit sequence: ${file}`);
    continue;
  }
  const existing = seenPrefixes.get(match[1]);
  if (existing) warnings.push(`Legacy migration prefix collision ${match[1]}: ${existing}, ${file}. Supabase will apply them lexicographically; new migrations must use a fresh prefix.`);
  seenPrefixes.set(match[1], file);

  const content = await readFile(new URL(file, migrationDir), 'utf8');
  if (/service[_-]?role\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/i.test(content)) errors.push(`Possible plaintext service-role secret in ${file}`);
  if (/BEGIN\s+(RSA|OPENSSH)\s+PRIVATE\s+KEY/i.test(content)) errors.push(`Private key material detected in ${file}`);
}

const publicDir = new URL('../public/', import.meta.url);
for (const required of ['_headers']) {
  try {
    await readFile(new URL(required, publicDir), 'utf8');
  } catch {
    errors.push(`Missing production deployment file: public/${required}`);
  }
}

const functionsDir = new URL('../supabase/functions/', import.meta.url);
for (const entry of await readdir(functionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const indexPath = new URL(`${entry.name}/index.ts`, functionsDir);
  try {
    const content = await readFile(indexPath, 'utf8');
    if (!content.includes('cache-control')) warnings.push(`Edge Function ${entry.name} does not explicitly set cache-control.`);
  } catch {
    errors.push(`Edge Function ${entry.name} is missing index.ts`);
  }
}

for (const warning of warnings) console.warn(`[repository warning] ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`[repository error] ${error}`);
  process.exit(1);
}
console.log(`[repository] validated ${files.length} migrations and deployment invariants`);
