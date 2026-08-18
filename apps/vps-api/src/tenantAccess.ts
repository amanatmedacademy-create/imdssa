import type { Pool } from 'pg';

export type PlatformUser = {
  id: string;
  email: string;
  full_name: string;
  global_role: string | null;
  is_active: boolean;
};

export type OrganizationMembership = {
  organization_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'suspended';
  allowed_product_codes: string[];
  allowed_module_codes: string[];
};

export type TenantAccessScope = {
  isPlatformUser: boolean;
  memberships: OrganizationMembership[];
};

export async function loadTenantAccess(pool: Pool, user: PlatformUser): Promise<TenantAccessScope> {
  if (user.global_role) return { isPlatformUser: true, memberships: [] };
  const security = await pool.query<{ must_change_password: boolean }>('select must_change_password from app.platform_users where id=$1 and is_active=true', [user.id]);
  if (security.rows[0]?.must_change_password) return { isPlatformUser: false, memberships: [] };
  const result = await pool.query<OrganizationMembership>(`
    select organization_id,role,status,allowed_product_codes,allowed_module_codes
    from app.organization_memberships
    where user_id=$1 and status='active'
    order by created_at asc`, [user.id]);
  return { isPlatformUser: false, memberships: result.rows };
}

export function organizationIds(scope: TenantAccessScope): string[] {
  return scope.memberships.map((membership) => membership.organization_id);
}

export function canManageOrganization(scope: TenantAccessScope, organizationId: string): boolean {
  return scope.memberships.some((membership) => membership.organization_id === organizationId && (membership.role === 'owner' || membership.role === 'admin'));
}

export function membershipFor(scope: TenantAccessScope, organizationId: string): OrganizationMembership | null {
  return scope.memberships.find((membership) => membership.organization_id === organizationId) || null;
}

export function serializeMemberships(scope: TenantAccessScope) {
  return scope.memberships.map((membership) => ({
    organizationId: membership.organization_id,
    role: membership.role,
    allowedProductCodes: membership.allowed_product_codes,
    allowedModuleCodes: membership.allowed_module_codes,
  }));
}
