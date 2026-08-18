import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { hashPassword, validatePassword } from './security.js';
import { canManageOrganization, membershipFor, type PlatformUser, type TenantAccessScope } from './tenantAccess.js';

type JsonResponder = (res: ServerResponse, status: number, body: unknown) => void;
type Role = 'owner' | 'admin' | 'member' | 'viewer';
type Status = 'active' | 'suspended';

type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  pool: Pool;
  url: URL;
  method: string;
  user: PlatformUser;
  scope: TenantAccessScope;
  json: JsonResponder;
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
}

function sourceIp(req: IncomingMessage): string | null {
  const value = req.headers['x-real-ip'];
  if (typeof value === 'string' && value.trim()) return value.trim();
  const remote = req.socket.remoteAddress || '';
  return remote.startsWith('::ffff:') ? remote.slice(7) : remote || null;
}

async function audit(pool: Pool, req: IncomingMessage, actorUserId: string, action: string, targetId: string, beforeState: unknown, afterState: unknown) {
  const requestId = typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim() ? req.headers['x-request-id'].trim().slice(0, 128) : randomUUID();
  await pool.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,request_id,source_ip,before_state,after_state)
    values($1,$2,'organization_membership',$3,$4,$5::inet,$6::jsonb,$7::jsonb)`, [actorUserId, action, targetId, requestId, sourceIp(req), beforeState ? JSON.stringify(beforeState) : null, afterState ? JSON.stringify(afterState) : null]);
}

function isPlatformManager(user: PlatformUser): boolean {
  return user.global_role === 'platform_owner' || user.global_role === 'platform_admin';
}

function normalizeCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].sort();
}

function makeTemporaryPassword(): string {
  return `Imds!${randomBytes(12).toString('base64url')}9aA`;
}

async function assertOrganizationExists(pool: Pool, organizationId: string): Promise<boolean> {
  const result = await pool.query('select 1 from app.organizations where id=$1', [organizationId]);
  return Boolean(result.rowCount);
}

async function allowedCodesForTenantManager(pool: Pool, organizationId: string, scope: TenantAccessScope): Promise<{ products: Set<string>; modules: Set<string> }> {
  const membership = membershipFor(scope, organizationId);
  if (!membership) return { products: new Set(), modules: new Set() };
  if (membership.role === 'owner' || membership.role === 'admin') {
    const products = await pool.query<{ code: string }>(`select p.code from app.organization_products op join app.products p on p.id=op.product_id where op.organization_id=$1 and op.status='active'`, [organizationId]);
    const modules = await pool.query<{ code: string }>(`select distinct m.code from app.module_installations i join app.modules m on m.id=i.module_id where i.organization_id=$1 and i.status in ('active','read_only','suspended')`, [organizationId]);
    return { products: new Set(products.rows.map((row) => row.code)), modules: new Set(modules.rows.map((row) => row.code)) };
  }
  return { products: new Set(membership.allowed_product_codes), modules: new Set(membership.allowed_module_codes) };
}

async function listMemberships(pool: Pool, organizationIds: string[]) {
  if (!organizationIds.length) return [];
  const result = await pool.query(`select om.organization_id,om.user_id,om.role,om.status,om.allowed_product_codes,om.allowed_module_codes,om.created_at,om.updated_at,
      o.name organization_name,u.email,u.full_name,u.is_active,u.last_seen_at,u.must_change_password
    from app.organization_memberships om
    join app.organizations o on o.id=om.organization_id
    join app.platform_users u on u.id=om.user_id
    where om.organization_id = any($1::uuid[])
    order by o.name, case om.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end, lower(u.full_name), lower(u.email)`, [organizationIds]);
  return result.rows;
}

async function protectLastOwner(pool: Pool, organizationId: string, userId: string, nextRole: Role, nextStatus: Status): Promise<boolean> {
  const current = await pool.query<{ role: Role; status: Status }>('select role,status from app.organization_memberships where organization_id=$1 and user_id=$2', [organizationId, userId]);
  if (!current.rowCount || current.rows[0].role !== 'owner' || current.rows[0].status !== 'active') return true;
  if (nextRole === 'owner' && nextStatus === 'active') return true;
  const owners = await pool.query<{ count: number }>(`select count(*)::int count from app.organization_memberships where organization_id=$1 and role='owner' and status='active'`, [organizationId]);
  return (owners.rows[0]?.count || 0) > 1;
}

export async function handleUserAccessApi(context: Context): Promise<boolean> {
  const { req, res, pool, url, method, user, scope, json } = context;
  const platformBase = '/api/v1/access/users';
  const tenantBase = '/api/tenant/v1/access/users';
  const isPlatformPath = url.pathname === platformBase || url.pathname.startsWith(`${platformBase}/`);
  const isTenantPath = url.pathname === tenantBase || url.pathname.startsWith(`${tenantBase}/`);
  if (!isPlatformPath && !isTenantPath) return false;

  if (isPlatformPath && !isPlatformManager(user)) { json(res, 403, { error: 'PLATFORM_ADMIN_REQUIRED' }); return true; }
  if (isTenantPath && scope.isPlatformUser) { json(res, 404, { error: 'TENANT_ROUTE_NOT_FOUND' }); return true; }

  const base = isPlatformPath ? platformBase : tenantBase;
  const requestedOrganizationId = String(url.searchParams.get('organizationId') || '').trim();

  if (url.pathname === base && method === 'GET') {
    const ids = isPlatformPath
      ? requestedOrganizationId ? [requestedOrganizationId] : (await pool.query<{ id: string }>('select id from app.organizations order by name')).rows.map((row) => row.id)
      : requestedOrganizationId
        ? (canManageOrganization(scope, requestedOrganizationId) ? [requestedOrganizationId] : [])
        : scope.memberships.filter((membership) => membership.role === 'owner' || membership.role === 'admin').map((membership) => membership.organization_id);
    if (requestedOrganizationId && !ids.length) { json(res, 403, { error: 'ORGANIZATION_ADMIN_REQUIRED' }); return true; }
    json(res, 200, { items: await listMemberships(pool, ids) });
    return true;
  }

  if (url.pathname === base && method === 'POST') {
    const data = await readBody(req);
    const organizationId = String(data.organizationId || '').trim();
    const email = String(data.email || '').trim().toLowerCase();
    const fullName = String(data.fullName || '').trim();
    const requestedRole = String(data.role || 'member') as Role;
    const status = String(data.status || 'active') as Status;
    const allowedProductCodes = normalizeCodes(data.allowedProductCodes);
    const allowedModuleCodes = normalizeCodes(data.allowedModuleCodes);
    if (!organizationId || !email || !fullName) { json(res, 400, { error: 'ORGANIZATION_EMAIL_NAME_REQUIRED' }); return true; }
    if (!['owner','admin','member','viewer'].includes(requestedRole) || !['active','suspended'].includes(status)) { json(res, 400, { error: 'INVALID_MEMBERSHIP' }); return true; }
    if (!await assertOrganizationExists(pool, organizationId)) { json(res, 404, { error: 'ORGANIZATION_NOT_FOUND' }); return true; }
    if (!isPlatformPath && !canManageOrganization(scope, organizationId)) { json(res, 403, { error: 'ORGANIZATION_ADMIN_REQUIRED' }); return true; }
    if (!isPlatformPath && requestedRole === 'owner') { json(res, 403, { error: 'PLATFORM_ADMIN_REQUIRED_FOR_OWNER' }); return true; }

    if (!isPlatformPath) {
      const allowed = await allowedCodesForTenantManager(pool, organizationId, scope);
      if (allowedProductCodes.some((code) => !allowed.products.has(code)) || allowedModuleCodes.some((code) => !allowed.modules.has(code))) {
        json(res, 403, { error: 'ACCESS_EXCEEDS_MANAGER_SCOPE' }); return true;
      }
    }

    const existing = await pool.query<{ id: string; global_role: string | null; full_name: string }>('select id,global_role,full_name from app.platform_users where lower(email)=lower($1) limit 1', [email]);
    if (existing.rows[0]?.global_role) { json(res, 409, { error: 'ACCOUNT_IS_PLATFORM_USER' }); return true; }
    const temporaryPassword = existing.rowCount ? null : makeTemporaryPassword();
    if (temporaryPassword && validatePassword(temporaryPassword)) throw new Error('Generated password failed policy');

    const client = await pool.connect();
    let userId = existing.rows[0]?.id || '';
    try {
      await client.query('begin');
      if (!userId) {
        const created = await client.query<{ id: string }>(`insert into app.platform_users(email,password_hash,full_name,global_role,is_active,must_change_password)
          values($1,$2,$3,null,true,true) returning id`, [email, hashPassword(temporaryPassword as string), fullName]);
        userId = created.rows[0].id;
      } else if (fullName !== existing.rows[0].full_name) {
        await client.query('update app.platform_users set full_name=$2 where id=$1', [userId, fullName]);
      }
      await client.query(`insert into app.organization_memberships(user_id,organization_id,role,status,allowed_product_codes,allowed_module_codes)
        values($1,$2,$3::app.organization_role,$4::app.membership_status,$5::text[],$6::text[])
        on conflict(user_id,organization_id) do update set role=excluded.role,status=excluded.status,allowed_product_codes=excluded.allowed_product_codes,allowed_module_codes=excluded.allowed_module_codes,updated_at=now()`,
        [userId, organizationId, requestedRole, status, allowedProductCodes, allowedModuleCodes]);
      await client.query('delete from app.auth_sessions where user_id=$1', [userId]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }

    await audit(pool, req, user.id, 'organization_membership.upsert', `${organizationId}:${userId}`, null, { organizationId, userId, email, role: requestedRole, status, allowedProductCodes, allowedModuleCodes });
    json(res, existing.rowCount ? 200 : 201, { userId, email, temporaryPassword, mustChangePassword: Boolean(temporaryPassword) });
    return true;
  }

  const match = url.pathname.match(new RegExp(`^${base.replaceAll('/', '\\/')}\\/([0-9a-f-]+)\\/([0-9a-f-]+)$`, 'i'));
  if (match && method === 'PATCH') {
    const organizationId = match[1];
    const targetUserId = match[2];
    const data = await readBody(req);
    const current = await pool.query<{ role: Role; status: Status; allowed_product_codes: string[]; allowed_module_codes: string[] }>('select role,status,allowed_product_codes,allowed_module_codes from app.organization_memberships where organization_id=$1 and user_id=$2', [organizationId, targetUserId]);
    if (!current.rowCount) { json(res, 404, { error: 'MEMBERSHIP_NOT_FOUND' }); return true; }
    if (!isPlatformPath && !canManageOrganization(scope, organizationId)) { json(res, 403, { error: 'ORGANIZATION_ADMIN_REQUIRED' }); return true; }
    if (!isPlatformPath && targetUserId === user.id) { json(res, 403, { error: 'SELF_MEMBERSHIP_CHANGE_NOT_ALLOWED' }); return true; }

    const role = String(data.role || current.rows[0].role) as Role;
    const status = String(data.status || current.rows[0].status) as Status;
    const allowedProductCodes = data.allowedProductCodes === undefined ? current.rows[0].allowed_product_codes : normalizeCodes(data.allowedProductCodes);
    const allowedModuleCodes = data.allowedModuleCodes === undefined ? current.rows[0].allowed_module_codes : normalizeCodes(data.allowedModuleCodes);
    if (!['owner','admin','member','viewer'].includes(role) || !['active','suspended'].includes(status)) { json(res, 400, { error: 'INVALID_MEMBERSHIP' }); return true; }
    if (!isPlatformPath && (role === 'owner' || current.rows[0].role === 'owner')) { json(res, 403, { error: 'PLATFORM_ADMIN_REQUIRED_FOR_OWNER' }); return true; }
    if (!await protectLastOwner(pool, organizationId, targetUserId, role, status)) { json(res, 409, { error: 'LAST_OWNER_REQUIRED' }); return true; }

    if (!isPlatformPath) {
      const allowed = await allowedCodesForTenantManager(pool, organizationId, scope);
      if (allowedProductCodes.some((code) => !allowed.products.has(code)) || allowedModuleCodes.some((code) => !allowed.modules.has(code))) {
        json(res, 403, { error: 'ACCESS_EXCEEDS_MANAGER_SCOPE' }); return true;
      }
    }

    await pool.query(`update app.organization_memberships set role=$3::app.organization_role,status=$4::app.membership_status,allowed_product_codes=$5::text[],allowed_module_codes=$6::text[],updated_at=now()
      where organization_id=$1 and user_id=$2`, [organizationId, targetUserId, role, status, allowedProductCodes, allowedModuleCodes]);
    await pool.query('delete from app.auth_sessions where user_id=$1', [targetUserId]);
    await audit(pool, req, user.id, 'organization_membership.update', `${organizationId}:${targetUserId}`, current.rows[0], { role, status, allowedProductCodes, allowedModuleCodes });
    json(res, 200, { ok: true });
    return true;
  }

  json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  return true;
}
