import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { handleInternalRegistrationEvent } from './registrationNotifications.js';
import { createSessionToken, hashPassword, hashToken, validatePassword, verifyPassword } from './security.js';

const { Pool, Client } = pg;
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8788);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const listeners = new Set<ServerResponse>();

type User = { id: string; email: string; full_name: string; global_role: string; is_active: boolean };
type LoginUser = User & { password_hash: string; failed_login_attempts: number; locked_until: string | null };

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function cookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function currentUser(req: IncomingMessage): Promise<User | null> {
  const token = cookie(req, 'imdssa_session');
  if (!token) return null;
  const tokenHash = hashToken(token);
  const result = await pool.query<User>(`select u.id,u.email,u.full_name,u.global_role,u.is_active
    from app.auth_sessions s join app.platform_users u on u.id=s.user_id
    where s.token_hash=$1 and s.expires_at>now() and u.is_active=true limit 1`, [tokenHash]);
  if (!result.rowCount) return null;
  await pool.query('update app.auth_sessions set last_seen_at=now() where token_hash=$1', [tokenHash]);
  return result.rows[0];
}

async function requireUser(req: IncomingMessage, res: ServerResponse): Promise<User | null> {
  const user = await currentUser(req);
  if (!user) json(res, 401, { error: 'AUTH_REQUIRED' });
  return user;
}

function canManage(user: User): boolean {
  return user.global_role === 'platform_owner' || user.global_role === 'platform_admin';
}

function requireManager(user: User, res: ServerResponse): boolean {
  if (canManage(user)) return true;
  json(res, 403, { error: 'PLATFORM_ADMIN_REQUIRED' });
  return false;
}

function sourceIp(req: IncomingMessage): string | null {
  const forwarded = req.headers['x-real-ip'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.trim();
  const remote = req.socket.remoteAddress || '';
  return remote.startsWith('::ffff:') ? remote.slice(7) : remote || null;
}

function userAgent(req: IncomingMessage): string | null {
  const value = req.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 512) : null;
}

function requestId(req: IncomingMessage): string {
  const value = req.headers['x-request-id'];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : randomUUID();
}

function mutationOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (typeof origin !== 'string') return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function setSessionCookie(res: ServerResponse, token: string) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `imdssa_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
}

function sse(res: ServerResponse, event: unknown) {
  res.write(`event: update\ndata: ${JSON.stringify(event)}\n\n`);
}

async function audit(req: IncomingMessage, userId: string, action: string, targetType: string, targetId: string | null, beforeState: unknown, afterState: unknown) {
  await pool.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,request_id,source_ip,before_state,after_state)
    values($1,$2,$3,$4,$5,$6::inet,$7::jsonb,$8::jsonb)`, [userId, action, targetType, targetId, requestId(req), sourceIp(req), beforeState ? JSON.stringify(beforeState) : null, afterState ? JSON.stringify(afterState) : null]);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';
  if (['POST','PUT','PATCH','DELETE'].includes(method) && url.pathname.startsWith('/api/') && !mutationOriginAllowed(req)) return json(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });

  if (url.pathname === '/healthz') {
    const db = await pool.query('select current_database() as database, now() as time');
    return json(res, 200, { status: 'healthy', service: 'imdssa-api', database: db.rows[0].database, time: db.rows[0].time });
  }

  if (await handleInternalRegistrationEvent(req, res, pool, url, method)) return;

  if (url.pathname === '/api/auth/login' && method === 'POST') {
    const data = await body(req);
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    const ip = sourceIp(req);
    if (!email || !password) return json(res, 401, { error: 'INVALID_CREDENTIALS' });

    if (ip) {
      const ipFailures = await pool.query<{ count: number }>(`select count(*)::int count from app.login_attempts where source_ip=$1::inet and succeeded=false and created_at>now()-interval '15 minutes'`, [ip]);
      if ((ipFailures.rows[0]?.count || 0) >= 20) return json(res, 429, { error: 'LOGIN_TEMPORARILY_LOCKED', retryAfterSeconds: 900 });
    }

    const result = await pool.query<LoginUser>(`select id,email,full_name,global_role,is_active,password_hash,failed_login_attempts,locked_until from app.platform_users where lower(email)=lower($1) limit 1`, [email]);
    const row = result.rows[0];
    if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) return json(res, 429, { error: 'LOGIN_TEMPORARILY_LOCKED', retryAfterSeconds: Math.max(1, Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 1000)) });

    const valid = Boolean(row?.is_active && verifyPassword(password, row.password_hash));
    await pool.query(`insert into app.login_attempts(normalized_email,source_ip,succeeded) values($1,$2::inet,$3)`, [email, ip, valid]);
    if (!valid) {
      if (row) await pool.query(`update app.platform_users set failed_login_attempts=failed_login_attempts+1,locked_until=case when failed_login_attempts+1>=5 then now()+interval '15 minutes' else locked_until end where id=$1`, [row.id]);
      return json(res, 401, { error: 'INVALID_CREDENTIALS' });
    }

    const session = createSessionToken();
    await pool.query(`insert into app.auth_sessions(user_id,token_hash,expires_at,source_ip,user_agent) values($1,$2,now()+interval '12 hours',$3::inet,$4)`, [row.id, session.hash, ip, userAgent(req)]);
    await pool.query('update app.platform_users set last_seen_at=now(),last_login_ip=$2::inet,failed_login_attempts=0,locked_until=null where id=$1', [row.id, ip]);
    setSessionCookie(res, session.token);
    return json(res, 200, { user: { id: row.id, email: row.email, fullName: row.full_name, role: row.global_role } });
  }

  if (url.pathname === '/api/auth/logout' && method === 'POST') {
    const token = cookie(req, 'imdssa_session');
    if (token) await pool.query('delete from app.auth_sessions where token_hash=$1', [hashToken(token)]);
    res.setHeader('Set-Cookie', 'imdssa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/auth/me' && method === 'GET') {
    const user = await requireUser(req, res); if (!user) return;
    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role } });
  }

  if (url.pathname === '/api/auth/change-password' && method === 'POST') {
    const user = await requireUser(req, res); if (!user) return;
    const data = await body(req);
    const currentPassword = String(data.currentPassword || '');
    const newPassword = String(data.newPassword || '');
    const policyError = validatePassword(newPassword);
    if (policyError) return json(res, 400, { error: policyError });
    const stored = await pool.query<{ password_hash: string }>('select password_hash from app.platform_users where id=$1 and is_active=true', [user.id]);
    const passwordHash = stored.rows[0]?.password_hash;
    if (!passwordHash || !verifyPassword(currentPassword, passwordHash)) return json(res, 401, { error: 'CURRENT_PASSWORD_INVALID' });
    if (verifyPassword(newPassword, passwordHash)) return json(res, 400, { error: 'PASSWORD_REUSE_NOT_ALLOWED' });

    const session = createSessionToken();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('update app.platform_users set password_hash=$2,password_changed_at=now(),failed_login_attempts=0,locked_until=null where id=$1', [user.id, hashPassword(newPassword)]);
      await client.query('delete from app.auth_sessions where user_id=$1', [user.id]);
      await client.query(`insert into app.auth_sessions(user_id,token_hash,expires_at,source_ip,user_agent) values($1,$2,now()+interval '12 hours',$3::inet,$4)`, [user.id, session.hash, sourceIp(req), userAgent(req)]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
    await audit(req, user.id, 'auth.password.change', 'platform_user', user.id, null, { sessionsRevoked: true });
    setSessionCookie(res, session.token);
    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role } });
  }

  if (url.pathname === '/events' && method === 'GET') {
    const user = await requireUser(req, res); if (!user) return;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    listeners.add(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => { clearInterval(heartbeat); listeners.delete(res); });
    return;
  }

  const user = await requireUser(req, res); if (!user) return;

  if (url.pathname === '/api/v1/notifications' && method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 20), 1), 100);
    const result = await pool.query(`select id,event_id,source_product_code,external_tenant_id,organization_id,company_name,owner_name,owner_email,owner_phone,
      trial_status,trial_started_at,trial_ends_at,telegram_status,telegram_error,read_at,created_at
      from app.registration_notifications order by created_at desc limit $1`, [limit]);
    const unread = await pool.query('select count(*)::int as count from app.registration_notifications where read_at is null');
    return json(res, 200, { items: result.rows, unread: unread.rows[0]?.count || 0 });
  }

  const notificationReadMatch = url.pathname.match(/^\/api\/v1\/notifications\/([0-9a-f-]+)\/read$/i);
  if (notificationReadMatch && method === 'PATCH') {
    const result = await pool.query('update app.registration_notifications set read_at=coalesce(read_at,now()),updated_at=now() where id=$1 returning id,read_at', [notificationReadMatch[1]]);
    if (!result.rowCount) return json(res, 404, { error: 'NOTIFICATION_NOT_FOUND' });
    return json(res, 200, result.rows[0]);
  }

  if (url.pathname === '/api/v1/overview' && method === 'GET') {
    const result = await pool.query(`select
      (select count(*)::int from app.organizations where status='active') organizations,
      (select count(*)::int from app.products where status<>'disabled') products,
      (select count(*)::int from app.modules where status='published') modules,
      (select count(*)::int from app.module_installations where status='active') installations,
      (select count(*)::int from app.platform_users where is_active=true) platform_users,
      (select count(*)::int from app.product_tenant_bindings where sync_status<>'synced') sync_pending`);
    return json(res, 200, result.rows[0]);
  }

  if (url.pathname === '/api/v1/organizations' && method === 'GET') {
    const result = await pool.query(`select o.id,o.external_key,o.name,o.legal_name,o.bin,o.city,o.status,o.metadata,o.created_at,o.updated_at,
      (select count(*)::int from app.organization_products op where op.organization_id=o.id and op.status='active') products,
      (select count(*)::int from app.module_installations mi where mi.organization_id=o.id and mi.status='active') modules
      from app.organizations o order by o.created_at desc`);
    return json(res, 200, { items: result.rows });
  }
  if (url.pathname === '/api/v1/organizations' && method === 'POST') {
    if (!requireManager(user, res)) return;
    const data = await body(req);
    const name = String(data.name || '').trim();
    if (!name) return json(res, 400, { error: 'ORGANIZATION_NAME_REQUIRED' });
    const result = await pool.query(`insert into app.organizations(external_key,name,legal_name,bin,city,status)
      values(nullif($1,''),$2,nullif($3,''),nullif($4,''),nullif($5,''),coalesce(nullif($6,''),'active')::app.organization_status)
      returning *`, [String(data.externalKey||''), name, String(data.legalName||''), String(data.bin||''), String(data.city||''), String(data.status||'active')]);
    await audit(req, user.id, 'organization.create', 'organization', result.rows[0].id, null, result.rows[0]);
    return json(res, 201, result.rows[0]);
  }

  const orgMatch = url.pathname.match(/^\/api\/v1\/organizations\/([0-9a-f-]+)$/i);
  if (orgMatch && method === 'PATCH') {
    if (!requireManager(user, res)) return;
    const data = await body(req);
    const before = await pool.query('select * from app.organizations where id=$1', [orgMatch[1]]);
    if (!before.rowCount) return json(res, 404, { error: 'ORGANIZATION_NOT_FOUND' });
    const result = await pool.query(`update app.organizations set
      name=coalesce(nullif($2,''),name), legal_name=coalesce($3,legal_name), bin=coalesce($4,bin), city=coalesce($5,city),
      status=coalesce(nullif($6,''),status::text)::app.organization_status where id=$1 returning *`,
      [orgMatch[1], String(data.name||''), data.legalName ?? null, data.bin ?? null, data.city ?? null, String(data.status||'')]);
    await audit(req, user.id, 'organization.update', 'organization', orgMatch[1], before.rows[0], result.rows[0]);
    return json(res, 200, result.rows[0]);
  }

  if (url.pathname === '/api/v1/products' && method === 'GET') {
    const result = await pool.query(`select p.*, (select count(*)::int from app.organization_products op where op.product_id=p.id and op.status='active') tenants from app.products p order by created_at desc`);
    return json(res, 200, { items: result.rows });
  }

  if (url.pathname === '/api/v1/modules' && method === 'GET') {
    const result = await pool.query(`select m.*,p.code owner_product_code,p.name owner_product_name from app.modules m left join app.products p on p.id=m.owner_product_id order by p.name,m.category,m.name`);
    return json(res, 200, { items: result.rows });
  }

  if (url.pathname === '/api/v1/organization-products' && method === 'GET') {
    const result = await pool.query(`select op.organization_id,op.product_id,op.status,op.config,op.created_at,op.updated_at,
      o.name organization_name,p.code product_code,p.name product_name,
      b.remote_tenant_id,b.desired_revision,b.actual_revision,b.sync_status,b.last_sync_at,b.last_error
      from app.organization_products op
      join app.organizations o on o.id=op.organization_id
      join app.products p on p.id=op.product_id
      left join app.product_tenant_bindings b on b.organization_id=op.organization_id and b.product_id=op.product_id
      order by o.name,p.name`);
    return json(res, 200, { items: result.rows });
  }
  if (url.pathname === '/api/v1/organization-products' && method === 'POST') {
    if (!requireManager(user, res)) return;
    const data = await body(req);
    const organizationId = String(data.organizationId || '');
    const productId = String(data.productId || '');
    if (!organizationId || !productId) return json(res, 400, { error: 'ORGANIZATION_AND_PRODUCT_REQUIRED' });
    const previous = await pool.query('select * from app.organization_products where organization_id=$1 and product_id=$2', [organizationId, productId]);
    const result = await pool.query(`insert into app.organization_products(organization_id,product_id,status,config)
      values($1,$2,coalesce(nullif($3,''),'active')::app.installation_status,$4::jsonb)
      on conflict(organization_id,product_id) do update set status=excluded.status,config=app.organization_products.config || excluded.config,updated_at=now() returning *`,
      [organizationId, productId, String(data.status || 'active'), JSON.stringify(data.config || {})]);
    await audit(req, user.id, 'organization_product.upsert', 'organization_product', `${organizationId}:${productId}`, previous.rows[0] || null, result.rows[0]);
    return json(res, 200, result.rows[0]);
  }

  if (url.pathname === '/api/v1/installations' && method === 'GET') {
    const result = await pool.query(`select i.*,o.name organization_name,m.code module_code,m.name module_name,p.code host_product_code,p.name host_product_name
      from app.module_installations i join app.organizations o on o.id=i.organization_id join app.modules m on m.id=i.module_id join app.products p on p.id=i.host_product_id
      order by o.name,m.name`);
    return json(res, 200, { items: result.rows });
  }
  if (url.pathname === '/api/v1/installations' && method === 'POST') {
    if (!requireManager(user, res)) return;
    const data = await body(req);
    const organizationId = String(data.organizationId || '');
    const moduleId = String(data.moduleId || '');
    const hostProductId = String(data.hostProductId || '');
    if (!organizationId || !moduleId || !hostProductId) return json(res, 400, { error: 'INSTALLATION_TARGET_REQUIRED' });
    const entitled = await pool.query(`select 1 from app.organization_products where organization_id=$1 and product_id=$2 and status='active'`, [organizationId, hostProductId]);
    if (!entitled.rowCount) return json(res, 409, { error: 'PRODUCT_NOT_ENABLED_FOR_ORGANIZATION' });
    const moduleRow = await pool.query('select * from app.modules where id=$1 and owner_product_id=$2 and status=$3', [moduleId, hostProductId, 'published']);
    if (!moduleRow.rowCount) return json(res, 409, { error: 'MODULE_NOT_AVAILABLE_FOR_PRODUCT' });
    const previous = await pool.query('select * from app.module_installations where organization_id=$1 and module_id=$2 and host_product_id=$3', [organizationId, moduleId, hostProductId]);
    const version = String(data.version || moduleRow.rows[0].current_version || '') || null;
    const result = await pool.query(`insert into app.module_installations(organization_id,module_id,host_product_id,version,status,health,route,placement,permissions,limits,config)
      values($1,$2,$3,$4,coalesce(nullif($5,''),'active')::app.installation_status,'unknown'::app.health_status,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)
      on conflict(organization_id,module_id,host_product_id) do update set version=excluded.version,status=excluded.status,route=excluded.route,placement=excluded.placement,
      permissions=excluded.permissions,limits=excluded.limits,config=excluded.config,revision=app.module_installations.revision+1,updated_at=now() returning *`,
      [organizationId,moduleId,hostProductId,version,String(data.status||'active'),moduleRow.rows[0].default_route,moduleRow.rows[0].placement,JSON.stringify(moduleRow.rows[0].permissions||[]),JSON.stringify(moduleRow.rows[0].limits||{}),JSON.stringify(data.config||{})]);
    await audit(req, user.id, 'module_installation.upsert', 'module_installation', result.rows[0].id, previous.rows[0] || null, result.rows[0]);
    return json(res, 200, result.rows[0]);
  }

  const installationMatch = url.pathname.match(/^\/api\/v1\/installations\/([0-9a-f-]+)$/i);
  if (installationMatch && method === 'PATCH') {
    if (!requireManager(user, res)) return;
    const data = await body(req);
    const before = await pool.query('select * from app.module_installations where id=$1', [installationMatch[1]]);
    if (!before.rowCount) return json(res, 404, { error: 'INSTALLATION_NOT_FOUND' });
    const result = await pool.query(`update app.module_installations set
      status=coalesce(nullif($2,''),status::text)::app.installation_status,
      config=coalesce($3::jsonb,config),revision=revision+1,updated_at=now()
      where id=$1 returning *`, [installationMatch[1], String(data.status||''), data.config === undefined ? null : JSON.stringify(data.config)]);
    await audit(req, user.id, 'module_installation.update', 'module_installation', installationMatch[1], before.rows[0], result.rows[0]);
    return json(res, 200, result.rows[0]);
  }

  if (url.pathname === '/api/v1/control-commands' && method === 'GET') {
    const result = await pool.query(`select c.id,c.command_type,c.desired_revision,c.status,c.attempts,c.last_error,c.created_at,c.updated_at,c.completed_at,
      o.name organization_name,p.name product_name,p.code product_code
      from app.control_commands c join app.organizations o on o.id=c.organization_id join app.products p on p.id=c.product_id
      order by c.created_at desc limit 100`);
    return json(res, 200, { items: result.rows });
  }

  if (url.pathname === '/api/v1/audit' && method === 'GET') {
    if (!['platform_owner','platform_admin','auditor'].includes(user.global_role)) return json(res, 403, { error: 'AUDIT_ACCESS_REQUIRED' });
    const result = await pool.query(`select a.*,u.email actor_email from app.audit_logs a left join app.platform_users u on u.id=a.actor_user_id order by a.created_at desc limit 100`);
    return json(res, 200, { items: result.rows });
  }

  return json(res, 404, { error: 'NOT_FOUND' });
}

const listener = new Client({ connectionString: databaseUrl });
await listener.connect();
await listener.query('LISTEN imds_realtime');
listener.on('notification', async (message) => {
  if (!message.payload) return;
  let event: unknown = { payload: message.payload };
  try {
    const parsed = JSON.parse(message.payload) as { id?: number };
    if (parsed.id) {
      const result = await pool.query('select * from app.realtime_events where id=$1', [parsed.id]);
      event = result.rows[0] || parsed;
    }
  } catch {}
  for (const res of listeners) sse(res, event);
});

setInterval(() => { void pool.query('delete from app.auth_sessions where expires_at<=now()'); void pool.query("delete from app.login_attempts where created_at<now()-interval '30 days'"); }, 300000).unref();

const server = http.createServer((req, res) => { void handle(req, res).catch((error: unknown) => { console.error(error); if (!res.headersSent) json(res, 500, { error: 'INTERNAL_ERROR' }); else res.end(); }); });
server.listen(port, host, () => console.log(`imdssa-api listening on http://${host}:${port}`));