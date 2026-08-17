import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import pg from 'pg';
import { createSessionToken, hashToken, verifyPassword } from './security.js';

const { Pool, Client } = pg;
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8788);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const listeners = new Set<ServerResponse>();

type User = { id: string; email: string; full_name: string; global_role: string; is_active: boolean };

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

function sse(res: ServerResponse, event: unknown) {
  res.write(`event: update\ndata: ${JSON.stringify(event)}\n\n`);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  if (url.pathname === '/healthz') {
    const db = await pool.query('select current_database() as database, now() as time');
    return json(res, 200, { status: 'healthy', service: 'imdssa-api', database: db.rows[0].database, time: db.rows[0].time });
  }

  if (url.pathname === '/api/auth/login' && method === 'POST') {
    const data = await body(req);
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    const result = await pool.query(`select id,email,full_name,global_role,is_active,password_hash from app.platform_users where lower(email)=lower($1) limit 1`, [email]);
    const row = result.rows[0];
    if (!row || !row.is_active || !verifyPassword(password, row.password_hash)) return json(res, 401, { error: 'INVALID_CREDENTIALS' });
    const session = createSessionToken();
    await pool.query(`insert into app.auth_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '12 hours')`, [row.id, session.hash]);
    await pool.query('update app.platform_users set last_seen_at=now() where id=$1', [row.id]);
    const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `imdssa_session=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
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

  if (url.pathname === '/api/v1/overview' && method === 'GET') {
    const result = await pool.query(`select
      (select count(*)::int from app.organizations where status='active') organizations,
      (select count(*)::int from app.products where status<>'disabled') products,
      (select count(*)::int from app.modules where status='published') modules,
      (select count(*)::int from app.module_installations where status='active') installations,
      (select count(*)::int from app.platform_users where is_active=true) platform_users`);
    return json(res, 200, result.rows[0]);
  }

  if (url.pathname === '/api/v1/organizations' && method === 'GET') {
    const result = await pool.query('select id,external_key,name,legal_name,bin,city,status,created_at,updated_at from app.organizations order by created_at desc');
    return json(res, 200, { items: result.rows });
  }
  if (url.pathname === '/api/v1/organizations' && method === 'POST') {
    const data = await body(req);
    const result = await pool.query(`insert into app.organizations(external_key,name,legal_name,bin,city,status)
      values(nullif($1,''),$2,nullif($3,''),nullif($4,''),nullif($5,''),coalesce(nullif($6,''),'active')::app.organization_status)
      returning *`, [String(data.externalKey||''), String(data.name||''), String(data.legalName||''), String(data.bin||''), String(data.city||''), String(data.status||'active')]);
    await pool.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,after_state) values($1,'organization.create','organization',$2,$3)`, [user.id, result.rows[0].id, result.rows[0]]);
    return json(res, 201, result.rows[0]);
  }

  if (url.pathname === '/api/v1/products' && method === 'GET') {
    const result = await pool.query(`select p.*, (select count(*)::int from app.organization_products op where op.product_id=p.id and op.status='active') tenants from app.products p order by created_at desc`);
    return json(res, 200, { items: result.rows });
  }
  if (url.pathname === '/api/v1/products' && method === 'POST') {
    const data = await body(req);
    const result = await pool.query(`insert into app.products(code,name,description,status,version,adapter_base_url,healthcheck_url)
      values($1,$2,$3,coalesce(nullif($4,''),'draft')::app.product_status,nullif($5,''),nullif($6,''),nullif($7,''))
      on conflict(code) do update set name=excluded.name,description=excluded.description,status=excluded.status,version=excluded.version,adapter_base_url=excluded.adapter_base_url,healthcheck_url=excluded.healthcheck_url
      returning *`, [String(data.code||''),String(data.name||''),String(data.description||''),String(data.status||'draft'),String(data.version||''),String(data.adapterBaseUrl||''),String(data.healthcheckUrl||'')]);
    return json(res, 200, result.rows[0]);
  }

  if (url.pathname === '/api/v1/modules' && method === 'GET') {
    const result = await pool.query(`select m.*,p.code owner_product_code,p.name owner_product_name from app.modules m left join app.products p on p.id=m.owner_product_id order by m.created_at desc`);
    return json(res, 200, { items: result.rows });
  }
  if (url.pathname === '/api/v1/modules' && method === 'POST') {
    const data = await body(req);
    const owner = String(data.ownerProductId||'') || null;
    const result = await pool.query(`insert into app.modules(code,name,description,category,owner_product_id,status,current_version,default_route,placement,permissions,limits)
      values($1,$2,$3,$4,$5,coalesce(nullif($6,''),'draft')::app.module_status,nullif($7,''),nullif($8,''),nullif($9,''),$10::jsonb,$11::jsonb)
      on conflict(code) do update set name=excluded.name,description=excluded.description,category=excluded.category,owner_product_id=excluded.owner_product_id,status=excluded.status,current_version=excluded.current_version,default_route=excluded.default_route,placement=excluded.placement,permissions=excluded.permissions,limits=excluded.limits returning *`, [String(data.code||''),String(data.name||''),String(data.description||''),String(data.category||'general'),owner,String(data.status||'draft'),String(data.version||''),String(data.defaultRoute||''),String(data.placement||''),JSON.stringify(data.permissions||[]),JSON.stringify(data.limits||{})]);
    return json(res, 200, result.rows[0]);
  }

  if (url.pathname === '/api/v1/installations' && method === 'GET') {
    const result = await pool.query(`select i.*,o.name organization_name,m.code module_code,m.name module_name,p.code host_product_code,p.name host_product_name from app.module_installations i join app.organizations o on o.id=i.organization_id join app.modules m on m.id=i.module_id join app.products p on p.id=i.host_product_id order by i.updated_at desc`);
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

setInterval(() => { void pool.query('delete from app.auth_sessions where expires_at<=now()'); }, 300000).unref();

const server = http.createServer((req, res) => { void handle(req, res).catch((error: unknown) => { console.error(error); if (!res.headersSent) json(res, 500, { error: 'INTERNAL_ERROR' }); else res.end(); }); });
server.listen(port, host, () => console.log(`imdssa-api listening on http://${host}:${port}`));
