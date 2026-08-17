import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import type { PlatformUser, TenantAccessScope } from './tenantAccess.js';

type JsonResponder = (res: ServerResponse, status: number, body: unknown) => void;

type TenantRouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  pool: Pool;
  url: URL;
  method: string;
  user: PlatformUser;
  scope: TenantAccessScope;
  json: JsonResponder;
};

const PRODUCT_VISIBLE = `(om.role in ('owner','admin') or p.code = any(om.allowed_product_codes))`;
const MODULE_VISIBLE = `(om.role in ('owner','admin') or m.code = any(om.allowed_module_codes))`;

export async function handleTenantApi(context: TenantRouteContext): Promise<boolean> {
  const { res, pool, url, method, user, scope, json } = context;
  if (scope.isPlatformUser || !url.pathname.startsWith('/api/tenant/v1/')) return false;

  if (url.pathname === '/api/tenant/v1/context' && method === 'GET') {
    const memberships = await pool.query(`select om.organization_id,om.role,om.allowed_product_codes,om.allowed_module_codes,o.name organization_name
      from app.organization_memberships om join app.organizations o on o.id=om.organization_id
      where om.user_id=$1 and om.status='active' order by o.name`, [user.id]);
    json(res, 200, { scope: 'tenant', memberships: memberships.rows });
    return true;
  }

  if (url.pathname === '/api/tenant/v1/overview' && method === 'GET') {
    const result = await pool.query(`select
      (select count(*)::int from app.organization_memberships om join app.organizations o on o.id=om.organization_id where om.user_id=$1 and om.status='active' and o.status='active') organizations,
      (select count(distinct p.id)::int from app.organization_memberships om join app.organization_products op on op.organization_id=om.organization_id join app.products p on p.id=op.product_id where om.user_id=$1 and om.status='active' and op.status='active' and ${PRODUCT_VISIBLE}) products,
      (select count(distinct m.id)::int from app.organization_memberships om join app.module_installations i on i.organization_id=om.organization_id join app.modules m on m.id=i.module_id where om.user_id=$1 and om.status='active' and i.status='active' and ${MODULE_VISIBLE}) modules,
      (select count(*)::int from app.organization_memberships om join app.module_installations i on i.organization_id=om.organization_id join app.modules m on m.id=i.module_id where om.user_id=$1 and om.status='active' and i.status='active' and ${MODULE_VISIBLE}) installations,
      (select count(distinct om2.user_id)::int from app.organization_memberships mine join app.organization_memberships om2 on om2.organization_id=mine.organization_id and om2.status='active' where mine.user_id=$1 and mine.status='active') platform_users,
      (select count(*)::int from app.organization_memberships om join app.product_tenant_bindings b on b.organization_id=om.organization_id join app.products p on p.id=b.product_id where om.user_id=$1 and om.status='active' and b.sync_status<>'synced' and ${PRODUCT_VISIBLE}) sync_pending`, [user.id]);
    json(res, 200, result.rows[0] || { organizations: 0, products: 0, modules: 0, installations: 0, platform_users: 0, sync_pending: 0 });
    return true;
  }

  if (url.pathname === '/api/tenant/v1/organizations' && method === 'GET') {
    const result = await pool.query(`select o.id,o.external_key,o.name,o.legal_name,o.bin,o.city,o.status,o.metadata,o.created_at,o.updated_at,om.role membership_role,
      (select count(*)::int from app.organization_products op where op.organization_id=o.id and op.status='active') products,
      (select count(*)::int from app.module_installations mi where mi.organization_id=o.id and mi.status='active') modules
      from app.organization_memberships om join app.organizations o on o.id=om.organization_id
      where om.user_id=$1 and om.status='active' order by o.name`, [user.id]);
    json(res, 200, { items: result.rows });
    return true;
  }

  if (url.pathname === '/api/tenant/v1/products' && method === 'GET') {
    const result = await pool.query(`select p.*,
      count(distinct op.organization_id)::int tenants
      from app.organization_memberships om
      join app.organization_products op on op.organization_id=om.organization_id and op.status='active'
      join app.products p on p.id=op.product_id
      where om.user_id=$1 and om.status='active' and ${PRODUCT_VISIBLE}
      group by p.id order by p.name`, [user.id]);
    json(res, 200, { items: result.rows });
    return true;
  }

  if (url.pathname === '/api/tenant/v1/modules' && method === 'GET') {
    const result = await pool.query(`select distinct m.*,p.code owner_product_code,p.name owner_product_name
      from app.organization_memberships om
      join app.module_installations i on i.organization_id=om.organization_id and i.status in ('active','read_only','suspended')
      join app.modules m on m.id=i.module_id
      left join app.products p on p.id=m.owner_product_id
      where om.user_id=$1 and om.status='active' and ${MODULE_VISIBLE}
      order by p.name,m.category,m.name`, [user.id]);
    json(res, 200, { items: result.rows });
    return true;
  }

  if (url.pathname === '/api/tenant/v1/organization-products' && method === 'GET') {
    const result = await pool.query(`select op.organization_id,op.product_id,op.status,op.config,op.created_at,op.updated_at,
      o.name organization_name,p.code product_code,p.name product_name,
      b.remote_tenant_id,b.desired_revision,b.actual_revision,b.sync_status,b.last_sync_at,b.last_error
      from app.organization_memberships om
      join app.organization_products op on op.organization_id=om.organization_id
      join app.organizations o on o.id=op.organization_id
      join app.products p on p.id=op.product_id
      left join app.product_tenant_bindings b on b.organization_id=op.organization_id and b.product_id=op.product_id
      where om.user_id=$1 and om.status='active' and ${PRODUCT_VISIBLE}
      order by o.name,p.name`, [user.id]);
    json(res, 200, { items: result.rows });
    return true;
  }

  if (url.pathname === '/api/tenant/v1/installations' && method === 'GET') {
    const result = await pool.query(`select i.*,o.name organization_name,m.code module_code,m.name module_name,p.code host_product_code,p.name host_product_name
      from app.organization_memberships om
      join app.module_installations i on i.organization_id=om.organization_id
      join app.organizations o on o.id=i.organization_id
      join app.modules m on m.id=i.module_id
      join app.products p on p.id=i.host_product_id
      where om.user_id=$1 and om.status='active' and ${MODULE_VISIBLE}
        and (om.role in ('owner','admin') or p.code = any(om.allowed_product_codes))
      order by o.name,m.name`, [user.id]);
    json(res, 200, { items: result.rows });
    return true;
  }

  if (url.pathname === '/api/tenant/v1/control-commands' && method === 'GET') {
    json(res, 200, { items: [] });
    return true;
  }

  if (url.pathname === '/api/tenant/v1/memberships' && method === 'GET') {
    const result = await pool.query(`select om.organization_id,om.role,om.status,om.allowed_product_codes,om.allowed_module_codes,o.name organization_name
      from app.organization_memberships om join app.organizations o on o.id=om.organization_id
      where om.user_id=$1 and om.status='active' order by o.name`, [user.id]);
    json(res, 200, { items: result.rows });
    return true;
  }

  json(res, 404, { error: 'TENANT_ROUTE_NOT_FOUND' });
  return true;
}
