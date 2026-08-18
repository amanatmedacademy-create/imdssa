import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import pg from 'pg';

const execFileAsync = promisify(execFile);
const { Pool } = pg;
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8790);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl, max: 5 });

type User = { id: string; email: string; full_name: string; global_role: string | null; is_active: boolean };
type ServiceSpec = { key: string; unit: string; label: string; mutable: boolean; kind: 'service' | 'timer' };
type ListeningPort = { protocol: string; state: string; address: string; port: number; process: string | null; pid: number | null; exposure: 'public' | 'loopback' | 'private' | 'unknown' };
const services: ServiceSpec[] = [
  { key: 'super-admin-api', unit: 'imds-super-admin-api.service', label: 'Super Admin API', mutable: true, kind: 'service' },
  { key: 'marketing', unit: 'imds-marketing.service', label: 'IMDS Marketing', mutable: true, kind: 'service' },
  { key: 'marketing-scheduler', unit: 'imds-marketing-scheduler.service', label: 'Marketing Scheduler', mutable: true, kind: 'service' },
  { key: 'postgresql', unit: 'postgresql.service', label: 'PostgreSQL', mutable: true, kind: 'service' },
  { key: 'nginx', unit: 'nginx.service', label: 'Nginx', mutable: true, kind: 'service' },
  { key: 'product-monitor', unit: 'imdssa-product-monitor.timer', label: 'Product Monitor', mutable: true, kind: 'timer' },
  { key: 'reconcile', unit: 'imdssa-reconcile.timer', label: 'Reconciliation', mutable: true, kind: 'timer' },
  { key: 'subscription-lifecycle', unit: 'imdssa-subscription-lifecycle.timer', label: 'Subscription Lifecycle', mutable: true, kind: 'timer' },
  { key: 'billing-reconciliation', unit: 'imdssa-billing-reconciliation.timer', label: 'Billing Reconciliation', mutable: true, kind: 'timer' },
  { key: 'infrastructure-api', unit: 'imds-infrastructure-api.service', label: 'Infrastructure API', mutable: false, kind: 'service' },
];

const envScopes: Record<string, { label: string; file: string }> = {
  marketing: { label: 'Marketing', file: '/etc/imds-marketing.env' },
  'super-admin': { label: 'Super Admin API', file: '/etc/imds-super-admin/api.env' },
  telegram: { label: 'Telegram', file: '/etc/imds-super-admin/telegram.env' },
  'platform-control': { label: 'Platform Control', file: '/etc/imds-platform-control.env' },
  billing: { label: 'Billing Provider', file: '/etc/imds-billing-provider.env' },
  cloudpayments: { label: 'CloudPayments', file: '/etc/imds-cloudpayments.env' },
};
const secretPattern = /(TOKEN|SECRET|PASSWORD|PASS|KEY|DATABASE_URL|SERVICE_ROLE|OPENAI|PRIVATE|CREDENTIAL)/i;

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
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
async function audit(req: IncomingMessage, user: User, action: string, targetType: string, targetId: string | null, beforeState: unknown, afterState: unknown) {
  await pool.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,request_id,source_ip,before_state,after_state) values($1,$2,$3,$4,$5,$6::inet,$7::jsonb,$8::jsonb)`, [user.id, action, targetType, targetId, req.headers['x-request-id'] || null, sourceIp(req), beforeState ? JSON.stringify(beforeState) : null, afterState ? JSON.stringify(afterState) : null]);
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}
async function command(file: string, args: string[], timeout = 8000): Promise<string> {
  const { stdout } = await execFileAsync(file, args, { timeout, maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim();
}
async function cpuPercent(): Promise<number> {
  const sample = () => {
    const values = os.cpus().map((cpu) => cpu.times);
    const idle = values.reduce((sum, x) => sum + x.idle, 0);
    const total = values.reduce((sum, x) => sum + x.user + x.nice + x.sys + x.idle + x.irq, 0);
    return { idle, total };
  };
  const first = sample();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const second = sample();
  const total = second.total - first.total;
  const idle = second.idle - first.idle;
  return total > 0 ? Math.max(0, Math.min(100, ((total - idle) / total) * 100)) : 0;
}
async function diskUsage() {
  try {
    const raw = await command('/usr/bin/df', ['-B1', '--output=size,used,avail,pcent', '/']);
    const row = raw.split('\n').slice(-1)[0].trim().split(/\s+/);
    return { total: Number(row[0]) || 0, used: Number(row[1]) || 0, available: Number(row[2]) || 0, percent: Number(String(row[3] || '0').replace('%', '')) || 0 };
  } catch { return { total: 0, used: 0, available: 0, percent: 0 }; }
}
function endpoint(value: string): { address: string; port: number } | null {
  const index = value.lastIndexOf(':');
  if (index < 0) return null;
  const portNumber = Number(value.slice(index + 1));
  if (!Number.isFinite(portNumber) || portNumber < 1 || portNumber > 65535) return null;
  const address = value.slice(0, index).replace(/^\[/, '').replace(/\]$/, '') || '*';
  return { address, port: portNumber };
}
function portExposure(address: string): ListeningPort['exposure'] {
  const normalized = address.split('%')[0].replace(/^\[/, '').replace(/\]$/, '');
  if (normalized === '*' || normalized === '0.0.0.0' || normalized === '::') return 'public';
  if (normalized === '::1' || normalized.startsWith('127.')) return 'loopback';
  if (/^10\./.test(normalized) || /^192\.168\./.test(normalized) || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) || /^fe80:/i.test(normalized)) return 'private';
  if (/^[0-9a-f:]+$/i.test(normalized) || /^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) return 'public';
  return 'unknown';
}
async function listeningPorts(): Promise<ListeningPort[]> {
  try {
    const raw = await command('/usr/bin/ss', ['-H', '-lntup'], 10000);
    const items = raw.split('\n').filter(Boolean).flatMap((line): ListeningPort[] => {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 6) return [];
      const local = endpoint(columns[4]);
      if (!local) return [];
      const processText = columns.slice(6).join(' ');
      const processMatch = processText.match(/\(\("([^"]+)",pid=(\d+)/);
      return [{
        protocol: columns[0].toLowerCase(),
        state: columns[1],
        address: local.address,
        port: local.port,
        process: processMatch?.[1] || null,
        pid: processMatch?.[2] ? Number(processMatch[2]) : null,
        exposure: portExposure(local.address),
      }];
    });
    return items.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol) || a.address.localeCompare(b.address));
  } catch { return []; }
}
async function serviceState(spec: ServiceSpec) {
  try {
    const output = await command('/usr/bin/systemctl', ['show', spec.unit, '--property=ActiveState,SubState,MainPID,ActiveEnterTimestamp,MemoryCurrent,TasksCurrent', '--no-pager']);
    const values = Object.fromEntries(output.split('\n').map((line) => { const index = line.indexOf('='); return index > -1 ? [line.slice(0, index), line.slice(index + 1)] : ['', '']; }).filter(([key]) => key));
    return { ...spec, active: values.ActiveState || 'unknown', sub: values.SubState || 'unknown', pid: Number(values.MainPID) || 0, memoryBytes: Number(values.MemoryCurrent) || 0, tasks: Number(values.TasksCurrent) || 0, activeSince: values.ActiveEnterTimestamp || null };
  } catch { return { ...spec, active: 'not-found', sub: 'unknown', pid: 0, memoryBytes: 0, tasks: 0, activeSince: null }; }
}
function parseEnv(text: string) {
  const entries: Array<{ name: string; value: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const name = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    entries.push({ name, value });
  }
  return entries;
}
async function readEnvScope(scope: string) {
  const spec = envScopes[scope];
  if (!spec) return null;
  try {
    const text = await readFile(spec.file, 'utf8');
    return { ...spec, text, entries: parseEnv(text) };
  } catch { return { ...spec, text: '', entries: [] as Array<{ name: string; value: string }> }; }
}
function encodeEnvValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
async function updateEnv(scope: string, name: string, value: string | null) {
  const current = await readEnvScope(scope);
  if (!current) throw new Error('UNKNOWN_SCOPE');
  if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(name)) throw new Error('INVALID_VARIABLE_NAME');
  if (value !== null && /[\r\n\0]/.test(value)) throw new Error('INVALID_VARIABLE_VALUE');
  const lines = current.text ? current.text.split(/\r?\n/) : [];
  let found = false;
  const next = lines.flatMap((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=/);
    if (match?.[1] !== name) return [line];
    found = true;
    return value === null ? [] : [`${name}=${encodeEnvValue(value)}`];
  });
  if (!found && value !== null) next.push(`${name}=${encodeEnvValue(value)}`);
  const normalized = `${next.filter((line, index, all) => !(index === all.length - 1 && line === '')).join('\n')}\n`;
  await writeFile(current.file, normalized, { encoding: 'utf8', mode: 0o640 });
  return { existed: current.entries.some((item) => item.name === name), configured: value !== null && value.length > 0 };
}
async function releaseInfo(label: string, path: string) {
  try {
    const resolved = await realpath(path);
    const info = await stat(resolved);
    return { label, path, release: resolved.split('/').filter(Boolean).slice(-1)[0], deployedAt: info.mtime.toISOString() };
  } catch { return { label, path, release: null, deployedAt: null }; }
}
async function domains() {
  const root = '/etc/nginx/sites-enabled';
  try {
    const files = await readdir(root);
    const items = [] as Array<{ site: string; domains: string[]; listens: string[] }>;
    for (const site of files) {
      try {
        const text = await readFile(`${root}/${site}`, 'utf8');
        const domainMatches = [...text.matchAll(/server_name\s+([^;]+);/g)].flatMap((match) => match[1].trim().split(/\s+/)).filter((x) => x !== '_');
        const listenMatches = [...text.matchAll(/listen\s+([^;]+);/g)].map((match) => match[1].trim());
        items.push({ site, domains: [...new Set(domainMatches)], listens: [...new Set(listenMatches)] });
      } catch {}
    }
    let configOk = true; let configMessage = 'nginx configuration is valid';
    try { await command('/usr/sbin/nginx', ['-t']); } catch (error) { configOk = false; configMessage = error instanceof Error ? error.message : 'nginx -t failed'; }
    return { configOk, configMessage, items };
  } catch { return { configOk: false, configMessage: 'nginx sites are unavailable', items: [] }; }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';
  if (url.pathname === '/infra-api/healthz') return json(res, 200, { status: 'healthy', service: 'imds-infrastructure-api' });
  const user = await currentUser(req);
  if (!user) return json(res, 401, { error: 'AUTH_REQUIRED' });
  if (!canRead(user)) return json(res, 403, { error: 'PLATFORM_INFRASTRUCTURE_ACCESS_REQUIRED' });

  if (url.pathname === '/infra-api/overview' && method === 'GET') {
    const [cpu, disk, db, serviceRows, deployments, ports] = await Promise.all([
      cpuPercent(),
      diskUsage(),
      pool.query(`select current_database() database,pg_database_size(current_database())::bigint database_bytes,(select count(*)::int from pg_stat_activity where datname=current_database()) connections,(select count(*)::int from pg_stat_activity where datname=current_database() and state='active') active_connections`),
      Promise.all(services.map(serviceState)),
      Promise.all([releaseInfo('Super Admin', '/var/www/imds-super-admin/current'), releaseInfo('Marketing', '/opt/imds-marketing/current')]),
      listeningPorts(),
    ]);
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const cpuRows = os.cpus();
    const cpuModel = cpuRows[0]?.model.trim() || 'unknown';
    const cpuSpeedMHz = cpuRows.reduce((max, row) => Math.max(max, Number(row.speed) || 0), 0);
    return json(res, 200, {
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        architecture: os.arch(),
        uptimeSeconds: os.uptime(),
        cpuModel,
        cpuCores: cpuRows.length,
        cpuSpeedMHz,
        cpuPercent: Number(cpu.toFixed(1)),
        loadAverage: os.loadavg(),
        memory: { total: totalMemory, used: totalMemory - freeMemory, free: freeMemory, percent: Number((((totalMemory - freeMemory) / totalMemory) * 100).toFixed(1)) },
        disk,
      },
      database: db.rows[0],
      services: serviceRows,
      deployments,
      ports,
      time: new Date().toISOString(),
    });
  }

  if (url.pathname === '/infra-api/services' && method === 'GET') return json(res, 200, { items: await Promise.all(services.map(serviceState)) });
  const serviceAction = url.pathname.match(/^\/infra-api\/services\/([a-z0-9-]+)\/(start|stop|restart)$/);
  if (serviceAction && method === 'POST') {
    if (!canManage(user)) return json(res, 403, { error: 'PLATFORM_ADMIN_REQUIRED' });
    const spec = services.find((item) => item.key === serviceAction[1]);
    if (!spec || !spec.mutable) return json(res, 400, { error: 'SERVICE_ACTION_NOT_ALLOWED' });
    const action = serviceAction[2];
    if (spec.key === 'nginx') { try { await command('/usr/sbin/nginx', ['-t']); } catch { return json(res, 409, { error: 'NGINX_CONFIG_INVALID' }); } }
    const before = await serviceState(spec);
    await command('/usr/bin/systemctl', [action, spec.unit], 20000);
    const after = await serviceState(spec);
    await audit(req, user, `infrastructure.service.${action}`, 'systemd_unit', spec.unit, { active: before.active, sub: before.sub }, { active: after.active, sub: after.sub });
    return json(res, 200, after);
  }

  if (url.pathname === '/infra-api/logs' && method === 'GET') {
    const spec = services.find((item) => item.key === url.searchParams.get('service'));
    if (!spec) return json(res, 400, { error: 'UNKNOWN_SERVICE' });
    const lines = Math.min(Math.max(Number(url.searchParams.get('lines') || 200), 20), 500);
    let output = '';
    try { output = await command('/usr/bin/journalctl', ['-u', spec.unit, '-n', String(lines), '--no-pager', '-o', 'short-iso'], 10000); } catch (error) { output = error instanceof Error ? error.message : 'journalctl failed'; }
    return json(res, 200, { service: spec.key, unit: spec.unit, lines: output.split('\n').filter(Boolean) });
  }

  if (url.pathname === '/infra-api/variables' && method === 'GET') {
    const items = [] as Array<Record<string, unknown>>;
    for (const [scope, spec] of Object.entries(envScopes)) {
      const data = await readEnvScope(scope);
      for (const entry of data?.entries || []) {
        const secret = secretPattern.test(entry.name);
        items.push({ scope, scopeLabel: spec.label, name: entry.name, type: secret ? 'secret' : 'text', configured: entry.value.length > 0, value: secret ? null : entry.value, masked: secret && entry.value.length > 0 ? '••••••••' : '' });
      }
    }
    return json(res, 200, { scopes: Object.entries(envScopes).map(([id, value]) => ({ id, label: value.label })), items });
  }
  const variableMatch = url.pathname.match(/^\/infra-api\/variables\/([a-z0-9-]+)\/([A-Z][A-Z0-9_]*)$/);
  if (variableMatch && (method === 'PUT' || method === 'DELETE')) {
    if (!canManage(user)) return json(res, 403, { error: 'PLATFORM_ADMIN_REQUIRED' });
    const [scope, name] = [variableMatch[1], variableMatch[2]];
    if (!envScopes[scope]) return json(res, 404, { error: 'UNKNOWN_SCOPE' });
    const previous = await readEnvScope(scope);
    const wasConfigured = previous?.entries.some((entry) => entry.name === name && entry.value.length > 0) || false;
    const data = method === 'PUT' ? await body(req) : {};
    const value = method === 'DELETE' ? null : String(data.value ?? '');
    const result = await updateEnv(scope, name, value);
    await audit(req, user, method === 'DELETE' ? 'infrastructure.variable.delete' : 'infrastructure.variable.update', 'environment_variable', `${scope}:${name}`, { configured: wasConfigured }, { configured: result.configured });
    return json(res, 200, { ok: true, scope, name, configured: result.configured, restartRecommended: true });
  }

  if (url.pathname === '/infra-api/database' && method === 'GET') {
    const [overview, tables, activity] = await Promise.all([
      pool.query(`select current_database() database,pg_database_size(current_database())::bigint database_bytes,(select count(*)::int from pg_stat_activity where datname=current_database()) connections,(select count(*)::int from pg_stat_activity where datname=current_database() and state='active') active_connections,(select xact_commit from pg_stat_database where datname=current_database()) commits,(select xact_rollback from pg_stat_database where datname=current_database()) rollbacks`),
      pool.query(`select schemaname,relname table_name,n_live_tup::bigint live_rows,n_dead_tup::bigint dead_rows from pg_stat_user_tables order by n_live_tup desc limit 20`),
      pool.query(`select pid,usename,state,wait_event_type,wait_event,extract(epoch from (now()-query_start))::int query_seconds,left(query,180) query from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() order by query_start nulls last limit 25`),
    ]);
    let marketing: Record<string, unknown> | null = null;
    try {
      const raw = await command('/usr/bin/docker', ['exec', 'imds-postgres', 'psql', '-At', '-U', 'imds_owner', '-d', 'imds_marketing', '-c', "select json_build_object('database','imds_marketing','database_bytes',pg_database_size(current_database()),'connections',(select count(*) from pg_stat_activity where datname=current_database()));"], 10000);
      marketing = JSON.parse(raw) as Record<string, unknown>;
    } catch {}
    return json(res, 200, { primary: overview.rows[0], marketing, tables: tables.rows, activity: activity.rows });
  }

  if (url.pathname === '/infra-api/deployments' && method === 'GET') return json(res, 200, { items: await Promise.all([releaseInfo('Super Admin', '/var/www/imds-super-admin/current'), releaseInfo('Marketing', '/opt/imds-marketing/current')]) });
  if (url.pathname === '/infra-api/domains' && method === 'GET') return json(res, 200, await domains());
  return json(res, 404, { error: 'NOT_FOUND' });
}

const server = http.createServer((req, res) => { void handle(req, res).catch((error: unknown) => { console.error(error); if (!res.headersSent) json(res, 500, { error: 'INTERNAL_ERROR' }); else res.end(); }); });
server.listen(port, host, () => console.log(`imds-infrastructure-api listening on http://${host}:${port}`));
