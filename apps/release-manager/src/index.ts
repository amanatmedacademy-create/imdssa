import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);
const { Pool } = pg;
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8791);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl, max: 3 });

const releaseStore = '/opt/imds-super-admin/release-bundles';
const incomingStore = `${releaseStore}/.incoming`;
const jobsStore = '/opt/imds-super-admin/local-deploy-jobs';
const deployRunner = '/opt/imds-super-admin/local-release-runner.sh';
const snapshotRunner = '/opt/imds-super-admin/snapshot-control-plane.sh';
const maxUploadBytes = 300 * 1024 * 1024;
const releaseIdPattern = /^[a-z0-9][a-z0-9._-]{2,79}$/;

const requiredStageFiles = [
  'web/index.html',
  'api/dist/index.js',
  'api/package.json',
  '002_auth_sessions.sql',
  '003_platform_management.sql',
  '004_control_plane_sync.sql',
  '005_registration_notifications.sql',
  '005_security_hardening.sql',
  '006_tenant_rbac.sql',
  '007_notification_delivery_settings.sql',
  '009_tenant_user_access.sql',
  '010_product_commercial_catalog.sql',
  '011_product_commercial_model.sql',
  '012_organization_product_subscriptions.sql',
  '014_billing_invoices_payments.sql',
  '015_subscription_lifecycle.sql',
  '016_paid_invoice_plan_application.sql',
  '017_verified_provider_payments.sql',
  '018_refunds_and_reconciliation.sql',
  '019_refund_aware_payment_engine.sql',
  '020_reconciliation_resilience.sql',
  'nginx.conf',
  'deploy-control-plane.sh',
  'product-monitor.sh',
  'product-monitor.service',
  'product-monitor.timer',
  'reconcile.service',
  'reconcile.timer',
  'subscription-lifecycle.service',
  'subscription-lifecycle.timer',
  'billing-reconciliation.service',
  'billing-reconciliation.timer',
];

const allowedTopLevelFiles = new Set([
  ...requiredStageFiles.filter((item) => !item.includes('/')),
  'local-release-runner.sh',
  'snapshot-control-plane.sh',
]);

type User = { id: string; email: string; full_name: string; global_role: string | null; is_active: boolean };
type ReleaseMetadata = {
  id: string;
  source: 'github' | 'upload' | 'recovery' | 'unknown';
  createdAt: string;
  sizeBytes?: number;
  sha256?: string | null;
  uploadedBy?: string | null;
  originalName?: string | null;
};
type JobState = {
  id: string;
  releaseId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  currentRelease?: string | null;
  log?: string[];
};

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function cookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
async function currentUser(req: IncomingMessage): Promise<User | null> {
  const token = cookie(req, 'imdssa_session');
  if (!token) return null;
  const result = await pool.query<User>(`select u.id,u.email,u.full_name,u.global_role,u.is_active from app.auth_sessions s join app.platform_users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and u.is_active=true limit 1`, [hashToken(token)]);
  return result.rows[0] || null;
}
function canRead(user: User) { return ['platform_owner', 'platform_admin', 'auditor'].includes(user.global_role || ''); }
function canManage(user: User) { return ['platform_owner', 'platform_admin'].includes(user.global_role || ''); }
function sourceIp(req: IncomingMessage): string | null {
  const forwarded = req.headers['x-real-ip'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.trim();
  const remote = req.socket.remoteAddress || '';
  return remote.startsWith('::ffff:') ? remote.slice(7) : remote || null;
}
async function audit(req: IncomingMessage, user: User, action: string, targetId: string | null, beforeState: unknown, afterState: unknown) {
  await pool.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,request_id,source_ip,before_state,after_state) values($1,$2,'release',$3,$4,$5::inet,$6::jsonb,$7::jsonb)`, [user.id, action, targetId, req.headers['x-request-id'] || null, sourceIp(req), beforeState ? JSON.stringify(beforeState) : null, afterState ? JSON.stringify(afterState) : null]);
}
async function command(file: string, args: string[], timeout = 15000, maxBuffer = 8 * 1024 * 1024): Promise<string> {
  const { stdout } = await execFileAsync(file, args, { timeout, maxBuffer });
  return stdout.trim();
}
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function ensureStores() {
  await mkdir(releaseStore, { recursive: true, mode: 0o750 });
  await mkdir(incomingStore, { recursive: true, mode: 0o750 });
  await mkdir(jobsStore, { recursive: true, mode: 0o750 });
}
async function currentRelease(pathname: string) {
  try {
    const resolved = await realpath(pathname);
    const info = await stat(resolved);
    return { path: pathname, release: path.basename(resolved), deployedAt: info.mtime.toISOString() };
  } catch { return { path: pathname, release: null, deployedAt: null }; }
}
async function stageSize(stageDir: string) {
  try { const raw = await command('/usr/bin/du', ['-sb', stageDir]); return Number(raw.split(/\s+/)[0]) || 0; } catch { return 0; }
}
async function isDeployable(stageDir: string) {
  for (const file of requiredStageFiles) if (!(await exists(path.join(stageDir, file)))) return false;
  return true;
}
async function readMetadata(releaseDir: string, id: string): Promise<ReleaseMetadata> {
  try {
    const parsed = JSON.parse(await readFile(path.join(releaseDir, 'release.json'), 'utf8')) as Partial<ReleaseMetadata>;
    return { id, source: parsed.source || 'unknown', createdAt: parsed.createdAt || (await stat(releaseDir)).mtime.toISOString(), sizeBytes: parsed.sizeBytes, sha256: parsed.sha256 || null, uploadedBy: parsed.uploadedBy || null, originalName: parsed.originalName || null };
  } catch { return { id, source: 'unknown', createdAt: (await stat(releaseDir)).mtime.toISOString() }; }
}
async function listReleases(activeRelease: string | null) {
  await ensureStores();
  const entries = await readdir(releaseStore, { withFileTypes: true });
  const items = [] as Array<ReleaseMetadata & { active: boolean; deployable: boolean; sizeBytes: number }>;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || !releaseIdPattern.test(entry.name)) continue;
    const releaseDir = path.join(releaseStore, entry.name);
    const stageDir = path.join(releaseDir, 'stage');
    const metadata = await readMetadata(releaseDir, entry.name);
    const deployable = await isDeployable(stageDir);
    const sizeBytes = metadata.sizeBytes || (deployable ? await stageSize(stageDir) : 0);
    items.push({ ...metadata, sizeBytes, deployable, active: entry.name === activeRelease });
  }
  items.sort((a, b) => Number(b.active) - Number(a.active) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}
async function readJob(jobId: string): Promise<JobState | null> {
  if (!releaseIdPattern.test(jobId)) return null;
  const root = path.join(jobsStore, jobId);
  try {
    const parsed = JSON.parse(await readFile(path.join(root, 'status.json'), 'utf8')) as JobState;
    let log: string[] = [];
    try { log = (await readFile(path.join(root, 'deploy.log'), 'utf8')).split(/\r?\n/).filter(Boolean).slice(-80); } catch {}
    return { ...parsed, log };
  } catch { return null; }
}
async function latestJob() {
  await ensureStores();
  const entries = await readdir(jobsStore, { withFileTypes: true });
  const candidates: Array<{ id: string; mtime: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !releaseIdPattern.test(entry.name)) continue;
    try { candidates.push({ id: entry.name, mtime: (await stat(path.join(jobsStore, entry.name))).mtimeMs }); } catch {}
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] ? readJob(candidates[0].id) : null;
}
async function statePayload() {
  const controlCenter = await currentRelease('/var/www/imds-super-admin/current');
  const marketing = await currentRelease('/opt/imds-marketing/current');
  return { githubIndependent: true, uploadLimitBytes: maxUploadBytes, current: { controlCenter: { label: 'Control Center', ...controlCenter }, marketing: { label: 'Marketing', ...marketing } }, releases: await listReleases(controlCenter.release), latestJob: await latestJob() };
}
function normalizeArchivePath(value: string) { return value.replace(/^\.\/+/, '').replace(/\/+$/, ''); }
function archivePathAllowed(value: string) {
  const normalized = normalizeArchivePath(value);
  if (!normalized) return true;
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return false;
  if (normalized === 'web' || normalized.startsWith('web/')) return true;
  if (normalized === 'api' || normalized.startsWith('api/')) return true;
  if (allowedTopLevelFiles.has(normalized)) return true;
  if (/^\d{3}_[a-z0-9_]+\.sql$/i.test(normalized)) return true;
  return false;
}
async function validateArchive(archivePath: string) {
  const listing = await command('/usr/bin/tar', ['-tzf', archivePath], 30000, 16 * 1024 * 1024);
  const entries = listing.split(/\r?\n/).filter(Boolean);
  if (!entries.length) throw new Error('EMPTY_ARCHIVE');
  for (const entry of entries) if (!archivePathAllowed(entry)) throw new Error(`UNSUPPORTED_ARCHIVE_PATH:${entry}`);
  const verbose = await command('/usr/bin/tar', ['-tvzf', archivePath], 30000, 16 * 1024 * 1024);
  for (const line of verbose.split(/\r?\n/).filter(Boolean)) if (line[0] === 'l' || line[0] === 'h') throw new Error('ARCHIVE_LINKS_NOT_ALLOWED');
}
async function receiveArchive(req: IncomingMessage, target: string) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxUploadBytes) throw new Error('UPLOAD_TOO_LARGE');
  const stream = createWriteStream(target, { flags: 'wx', mode: 0o600 });
  const hash = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxUploadBytes) throw new Error('UPLOAD_TOO_LARGE');
      hash.update(buffer);
      if (!stream.write(buffer)) await once(stream, 'drain');
    }
    stream.end(); await once(stream, 'finish');
    if (!size) throw new Error('EMPTY_UPLOAD');
    return { size, sha256: hash.digest('hex') };
  } catch (error) { stream.destroy(); await rm(target, { force: true }); throw error; }
}
async function uploadRelease(req: IncomingMessage, user: User, releaseId: string, originalName: string | null) {
  await ensureStores();
  const id = releaseId.toLowerCase();
  if (!releaseIdPattern.test(id)) throw new Error('INVALID_RELEASE_ID');
  const finalRoot = path.join(releaseStore, id);
  if (await exists(finalRoot)) throw new Error('RELEASE_ALREADY_EXISTS');
  const incomingRoot = path.join(incomingStore, `${id}-${randomBytes(5).toString('hex')}`);
  const archivePath = path.join(incomingRoot, 'release.tar.gz');
  const stageDir = path.join(incomingRoot, 'stage');
  await mkdir(stageDir, { recursive: true, mode: 0o750 });
  try {
    const received = await receiveArchive(req, archivePath);
    const expectedHashHeader = req.headers['x-release-sha256'];
    const expectedHash = typeof expectedHashHeader === 'string' ? expectedHashHeader.trim().toLowerCase() : '';
    if (expectedHash && !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('INVALID_EXPECTED_SHA256');
    if (expectedHash && expectedHash !== received.sha256) throw new Error('SHA256_MISMATCH');
    await validateArchive(archivePath);
    await command('/usr/bin/tar', ['-xzf', archivePath, '-C', stageDir, '--no-same-owner', '--no-same-permissions'], 60000, 16 * 1024 * 1024);
    if (!(await isDeployable(stageDir))) throw new Error('INCOMPLETE_RELEASE_BUNDLE');
    const metadata: ReleaseMetadata = { id, source: 'upload', createdAt: new Date().toISOString(), sizeBytes: await stageSize(stageDir), sha256: received.sha256, uploadedBy: user.email, originalName };
    await writeFile(path.join(incomingRoot, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o640 });
    await rm(archivePath, { force: true });
    await rename(incomingRoot, finalRoot);
    return metadata;
  } catch (error) { await rm(incomingRoot, { recursive: true, force: true }); throw error; }
}
async function snapshotCurrent() {
  const output = await command(snapshotRunner, [], 120000, 2 * 1024 * 1024);
  const match = output.match(/SNAPSHOT_ID=([a-z0-9._-]+)/);
  if (!match) throw new Error('SNAPSHOT_FAILED');
  return match[1];
}
async function queueDeploy(releaseId: string) {
  const id = releaseId.toLowerCase();
  if (!releaseIdPattern.test(id)) throw new Error('INVALID_RELEASE_ID');
  const stageDir = path.join(releaseStore, id, 'stage');
  if (!(await isDeployable(stageDir))) throw new Error('RELEASE_NOT_DEPLOYABLE');
  const activeJob = await latestJob();
  if (activeJob && ['queued', 'running'].includes(activeJob.status)) throw new Error('DEPLOY_ALREADY_RUNNING');
  const jobId = `job-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
  const jobDir = path.join(jobsStore, jobId);
  await mkdir(jobDir, { recursive: true, mode: 0o750 });
  const initial: JobState = { id: jobId, releaseId: id, status: 'queued', createdAt: new Date().toISOString() };
  await writeFile(path.join(jobDir, 'status.json'), `${JSON.stringify(initial, null, 2)}\n`, { mode: 0o640 });
  const child = spawn(deployRunner, [jobId, id], { detached: true, stdio: 'ignore' }); child.unref();
  return initial;
}
function errorCode(error: unknown) { return error instanceof Error ? error.message : 'INTERNAL_ERROR'; }
function statusForError(code: string) {
  if (code === 'UPLOAD_TOO_LARGE') return 413;
  if (['RELEASE_ALREADY_EXISTS', 'DEPLOY_ALREADY_RUNNING', 'SHA256_MISMATCH', 'RELEASE_ALREADY_ACTIVE', 'ACTIVE_RELEASE_CANNOT_BE_DELETED'].includes(code)) return 409;
  if (['INVALID_RELEASE_ID', 'INVALID_EXPECTED_SHA256', 'EMPTY_UPLOAD', 'EMPTY_ARCHIVE', 'INCOMPLETE_RELEASE_BUNDLE', 'ARCHIVE_LINKS_NOT_ALLOWED'].includes(code) || code.startsWith('UNSUPPORTED_ARCHIVE_PATH:')) return 400;
  if (['RELEASE_NOT_DEPLOYABLE', 'RELEASE_NOT_FOUND', 'JOB_NOT_FOUND'].includes(code)) return 404;
  return 500;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';
  if (url.pathname === '/release-api/healthz') return json(res, 200, { status: 'healthy', service: 'imds-release-manager', githubIndependent: true });
  const user = await currentUser(req);
  if (!user) return json(res, 401, { error: 'AUTH_REQUIRED' });
  if (!canRead(user)) return json(res, 403, { error: 'PLATFORM_INFRASTRUCTURE_ACCESS_REQUIRED' });
  if (url.pathname === '/release-api/releases' && method === 'GET') return json(res, 200, await statePayload());
  if (url.pathname === '/release-api/jobs/latest' && method === 'GET') return json(res, 200, { item: await latestJob() });
  const jobMatch = url.pathname.match(/^\/release-api\/jobs\/([a-z0-9._-]+)$/);
  if (jobMatch && method === 'GET') { const item = await readJob(jobMatch[1]); return item ? json(res, 200, { item }) : json(res, 404, { error: 'JOB_NOT_FOUND' }); }
  if (!canManage(user)) return json(res, 403, { error: 'PLATFORM_ADMIN_REQUIRED' });
  if (url.pathname === '/release-api/releases/snapshot' && method === 'POST') {
    const before = await currentRelease('/var/www/imds-super-admin/current');
    const snapshotId = await snapshotCurrent();
    await audit(req, user, 'infrastructure.release.snapshot', snapshotId, before, { snapshotId });
    return json(res, 201, { ok: true, snapshotId, state: await statePayload() });
  }
  if (url.pathname === '/release-api/releases/upload' && method === 'POST') {
    const releaseId = String(url.searchParams.get('releaseId') || '');
    const originalNameHeader = req.headers['x-release-filename'];
    const originalName = typeof originalNameHeader === 'string' ? originalNameHeader.slice(0, 180) : null;
    const metadata = await uploadRelease(req, user, releaseId, originalName);
    await audit(req, user, 'infrastructure.release.upload', metadata.id, null, { source: metadata.source, sizeBytes: metadata.sizeBytes, sha256: metadata.sha256 });
    return json(res, 201, { ok: true, release: metadata, state: await statePayload() });
  }
  const deployMatch = url.pathname.match(/^\/release-api\/releases\/([a-z0-9._-]+)\/deploy$/);
  if (deployMatch && method === 'POST') {
    const target = deployMatch[1];
    const current = await currentRelease('/var/www/imds-super-admin/current');
    if (current.release === target) return json(res, 409, { error: 'RELEASE_ALREADY_ACTIVE' });
    const job = await queueDeploy(target);
    await audit(req, user, 'infrastructure.release.deploy.requested', target, current, { jobId: job.id, target });
    return json(res, 202, { ok: true, job });
  }
  const releaseMatch = url.pathname.match(/^\/release-api\/releases\/([a-z0-9._-]+)$/);
  if (releaseMatch && method === 'DELETE') {
    const id = releaseMatch[1];
    const current = await currentRelease('/var/www/imds-super-admin/current');
    if (current.release === id) return json(res, 409, { error: 'ACTIVE_RELEASE_CANNOT_BE_DELETED' });
    const releaseDir = path.join(releaseStore, id);
    if (!(await exists(releaseDir))) return json(res, 404, { error: 'RELEASE_NOT_FOUND' });
    const metadata = await readMetadata(releaseDir, id);
    await rm(releaseDir, { recursive: true, force: true });
    await audit(req, user, 'infrastructure.release.delete', id, metadata, null);
    return json(res, 200, { ok: true, state: await statePayload() });
  }
  return json(res, 404, { error: 'NOT_FOUND' });
}

await ensureStores();
const server = http.createServer((req, res) => { void handle(req, res).catch((error: unknown) => { const code = errorCode(error); console.error('release-manager', code, error); if (!res.headersSent) json(res, statusForError(code), { error: code }); else res.end(); }); });
server.listen(port, host, () => console.log(`imds-release-manager listening on http://${host}:${port}`));
