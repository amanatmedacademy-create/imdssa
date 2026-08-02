import type { GlobalRole } from '../../lib/database.types';
import { getSupabase } from '../../lib/supabase';
import type { IdentityInvitationStatus, IdentitySupabaseClient } from './identityDatabase.types';

export type IdentityMembership = {
  id: string;
  organizationId: string;
  organizationName: string;
  branchId: string | null;
  branchName: string;
  roleKey: string;
  productScopes: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type IdentityUser = {
  id: string;
  email: string;
  fullName: string;
  globalRole: GlobalRole | null;
  mfaEnforced: boolean;
  isActive: boolean;
  lastSeenAt: string | null;
  locale: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  memberships: IdentityMembership[];
};

export type IdentityInvitation = {
  id: string;
  email: string;
  fullName: string;
  globalRole: GlobalRole | null;
  organizationId: string | null;
  organizationName: string;
  branchId: string | null;
  branchName: string;
  membershipRoleKey: string | null;
  productScopes: string[];
  status: IdentityInvitationStatus;
  authUserId: string | null;
  expiresAt: string;
  invitedBy: string;
  invitedByName: string;
  acceptedAt: string | null;
  lastError: string;
  createdAt: string;
};

export type IdentityOrganization = {
  id: string;
  name: string;
  status: string;
};

export type IdentityBranch = {
  id: string;
  organizationId: string;
  name: string;
  city: string;
};

export type IdentityProduct = {
  id: string;
  key: string;
  name: string;
};

export type IdentitySnapshot = {
  users: IdentityUser[];
  invitations: IdentityInvitation[];
  organizations: IdentityOrganization[];
  branches: IdentityBranch[];
  products: IdentityProduct[];
};

export type InviteIdentityInput = {
  email: string;
  fullName: string;
  globalRole: GlobalRole | null;
  organizationId: string | null;
  branchId: string | null;
  membershipRoleKey: string | null;
  productScopes: string[];
  redirectTo: string | null;
  expiresInHours: number;
};

export type UserAccessInput = {
  userId: string;
  fullName: string;
  globalRole: GlobalRole | null;
  mfaEnforced: boolean;
  isActive: boolean;
  reason: string;
};

export type MembershipInput = {
  userId: string;
  organizationId: string;
  branchId: string | null;
  roleKey: string;
  productScopes: string[];
  isActive: boolean;
  reason: string;
};

const STORAGE_KEY = 'imds-super-admin:identity:v1';
const DEMO_NOW = '2026-08-02T10:00:00.000Z';

const demoOrganizations: IdentityOrganization[] = [
  { id: 'org-amanat', name: 'Amanat Medical Center', status: 'active' },
  { id: 'org-orda', name: 'Orda Clinic', status: 'trial' },
  { id: 'org-sapa', name: 'Sapa Med', status: 'past_due' },
  { id: 'org-nova', name: 'Nova Health', status: 'onboarding' },
];

const demoBranches: IdentityBranch[] = [
  { id: 'branch-amanat-center', organizationId: 'org-amanat', name: 'Центральный филиал', city: 'Алматы' },
  { id: 'branch-amanat-west', organizationId: 'org-amanat', name: 'Западный филиал', city: 'Алматы' },
  { id: 'branch-orda-center', organizationId: 'org-orda', name: 'Главная клиника', city: 'Астана' },
];

const demoProducts: IdentityProduct[] = [
  { id: 'mis', key: 'imds-mis', name: 'IMDS MIS' },
  { id: 'crm', key: 'imds-crm', name: 'IMDS CRM' },
  { id: 'marketing', key: 'imds-marketing', name: 'IMDS Marketing' },
  { id: 'finance', key: 'imds-finance', name: 'IMDS Finance' },
  { id: 'contract', key: 'imds-contract', name: 'IMDS Contract' },
  { id: 'dashboard', key: 'imds-dashboard', name: 'IMDS Dashboard' },
];

function membership(
  id: string,
  organizationId: string,
  branchId: string | null,
  roleKey: string,
  productScopes: string[],
): IdentityMembership {
  return {
    id,
    organizationId,
    organizationName: demoOrganizations.find((item) => item.id === organizationId)?.name ?? organizationId,
    branchId,
    branchName: branchId ? demoBranches.find((item) => item.id === branchId)?.name ?? branchId : 'Все филиалы',
    roleKey,
    productScopes,
    isActive: true,
    createdAt: DEMO_NOW,
    updatedAt: DEMO_NOW,
  };
}

const defaultSnapshot: IdentitySnapshot = {
  organizations: demoOrganizations,
  branches: demoBranches,
  products: demoProducts,
  users: [
    {
      id: 'user-owner',
      email: 'owner@imdstech.net',
      fullName: 'Platform Owner',
      globalRole: 'platform_owner',
      mfaEnforced: true,
      isActive: true,
      lastSeenAt: DEMO_NOW,
      locale: 'ru',
      timezone: 'Asia/Almaty',
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: DEMO_NOW,
      memberships: [],
    },
    {
      id: 'user-support',
      email: 'support@imdstech.net',
      fullName: 'Support Admin',
      globalRole: 'support_admin',
      mfaEnforced: true,
      isActive: true,
      lastSeenAt: '2026-08-02T09:40:00.000Z',
      locale: 'ru',
      timezone: 'Asia/Almaty',
      createdAt: '2026-07-05T10:00:00.000Z',
      updatedAt: DEMO_NOW,
      memberships: [],
    },
    {
      id: 'user-clinic-admin',
      email: 'admin@amanat.example',
      fullName: 'Администратор клиники',
      globalRole: null,
      mfaEnforced: false,
      isActive: true,
      lastSeenAt: '2026-08-01T16:20:00.000Z',
      locale: 'ru',
      timezone: 'Asia/Almaty',
      createdAt: '2026-07-10T10:00:00.000Z',
      updatedAt: DEMO_NOW,
      memberships: [membership('membership-amanat-admin', 'org-amanat', null, 'admin', ['imds-mis', 'imds-crm', 'imds-dashboard'])],
    },
    {
      id: 'user-marketer',
      email: 'marketing@orda.example',
      fullName: 'Маркетолог Orda',
      globalRole: null,
      mfaEnforced: false,
      isActive: true,
      lastSeenAt: null,
      locale: 'ru',
      timezone: 'Asia/Almaty',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: DEMO_NOW,
      memberships: [membership('membership-orda-marketing', 'org-orda', 'branch-orda-center', 'marketer', ['imds-marketing', 'imds-dashboard'])],
    },
  ],
  invitations: [
    {
      id: 'invitation-finance',
      email: 'finance@amanat.example',
      fullName: 'Финансовый менеджер',
      globalRole: null,
      organizationId: 'org-amanat',
      organizationName: 'Amanat Medical Center',
      branchId: null,
      branchName: 'Все филиалы',
      membershipRoleKey: 'accountant',
      productScopes: ['imds-finance', 'imds-dashboard'],
      status: 'sent',
      authUserId: 'invited-finance-user',
      expiresAt: '2026-08-08T10:00:00.000Z',
      invitedBy: 'user-owner',
      invitedByName: 'Platform Owner',
      acceptedAt: null,
      lastError: '',
      createdAt: DEMO_NOW,
    },
  ],
};

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneDefaultSnapshot(): IdentitySnapshot {
  return JSON.parse(JSON.stringify(defaultSnapshot)) as IdentitySnapshot;
}

function readDemoSnapshot(): IdentitySnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = cloneDefaultSnapshot();
      writeDemoSnapshot(initial);
      return initial;
    }
    const parsed = JSON.parse(raw) as IdentitySnapshot;
    return parsed && Array.isArray(parsed.users) && Array.isArray(parsed.invitations)
      ? parsed
      : cloneDefaultSnapshot();
  } catch {
    return cloneDefaultSnapshot();
  }
}

function writeDemoSnapshot(snapshot: IdentitySnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function getIdentityClient(): IdentitySupabaseClient | null {
  return getSupabase() as unknown as IdentitySupabaseClient | null;
}

async function listFromSupabase(): Promise<IdentitySnapshot> {
  const supabase = getIdentityClient();
  if (!supabase) return readDemoSnapshot();

  const [userResult, membershipResult, invitationResult, organizationResult, branchResult, productResult] = await Promise.all([
    supabase.from('platform_users').select('*').order('created_at', { ascending: false }),
    supabase.from('memberships').select('*').order('created_at', { ascending: false }),
    supabase.from('platform_user_invitations').select('*').order('created_at', { ascending: false }),
    supabase.from('organizations').select('id, name, status, archived_at').order('name'),
    supabase.from('branches').select('id, organization_id, name, city, is_active').order('name'),
    supabase.from('products').select('id, key, name, status, archived_at').order('name'),
  ]);

  const firstError = userResult.error
    ?? membershipResult.error
    ?? invitationResult.error
    ?? organizationResult.error
    ?? branchResult.error
    ?? productResult.error;
  if (firstError) throw firstError;

  const userRows = userResult.data ?? [];
  const membershipRows = membershipResult.data ?? [];
  const invitationRows = invitationResult.data ?? [];
  const organizationRows = organizationResult.data ?? [];
  const branchRows = branchResult.data ?? [];
  const productRows = productResult.data ?? [];
  const organizationName = new Map(organizationRows.map((item) => [item.id, item.name]));
  const branchName = new Map(branchRows.map((item) => [item.id, item.name]));
  const userName = new Map(userRows.map((item) => [item.id, item.full_name || item.email]));

  const organizations: IdentityOrganization[] = organizationRows
    .filter((item) => !item.archived_at)
    .map((item) => ({ id: item.id, name: item.name, status: item.status }));
  const branches: IdentityBranch[] = branchRows
    .filter((item) => item.is_active)
    .map((item) => ({
      id: item.id,
      organizationId: item.organization_id,
      name: item.name,
      city: item.city ?? '',
    }));
  const products: IdentityProduct[] = productRows
    .filter((item) => !item.archived_at && item.status !== 'disabled')
    .map((item) => ({ id: item.id, key: item.key, name: item.name }));

  const users: IdentityUser[] = userRows.map((user) => ({
    id: user.id,
    email: user.email,
    fullName: user.full_name ?? '',
    globalRole: user.global_role,
    mfaEnforced: user.mfa_enforced,
    isActive: user.is_active,
    lastSeenAt: user.last_seen_at,
    locale: user.locale,
    timezone: user.timezone,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    memberships: membershipRows
      .filter((item) => item.user_id === user.id)
      .map((item) => ({
        id: item.id,
        organizationId: item.organization_id,
        organizationName: organizationName.get(item.organization_id) ?? item.organization_id,
        branchId: item.branch_id,
        branchName: item.branch_id ? branchName.get(item.branch_id) ?? item.branch_id : 'Все филиалы',
        roleKey: item.role_key,
        productScopes: item.product_scopes,
        isActive: item.is_active,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
  }));

  const invitations: IdentityInvitation[] = invitationRows.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    fullName: invitation.full_name ?? '',
    globalRole: invitation.global_role,
    organizationId: invitation.organization_id,
    organizationName: invitation.organization_id ? organizationName.get(invitation.organization_id) ?? invitation.organization_id : 'Платформа IMDS',
    branchId: invitation.branch_id,
    branchName: invitation.branch_id ? branchName.get(invitation.branch_id) ?? invitation.branch_id : 'Все филиалы',
    membershipRoleKey: invitation.membership_role_key,
    productScopes: invitation.product_scopes,
    status: invitation.status,
    authUserId: invitation.auth_user_id,
    expiresAt: invitation.expires_at,
    invitedBy: invitation.invited_by,
    invitedByName: userName.get(invitation.invited_by) ?? invitation.invited_by,
    acceptedAt: invitation.accepted_at,
    lastError: invitation.last_error ?? '',
    createdAt: invitation.created_at,
  }));

  return { users, invitations, organizations, branches, products };
}

export const identityRepository = {
  async list(): Promise<IdentitySnapshot> {
    return listFromSupabase();
  },

  async invite(input: InviteIdentityInput): Promise<IdentitySnapshot> {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.functions.invoke('identity-admin', {
        body: {
          action: 'invite',
          email: input.email,
          fullName: input.fullName || null,
          globalRole: input.globalRole,
          organizationId: input.organizationId,
          branchId: input.branchId,
          membershipRoleKey: input.membershipRoleKey,
          productScopes: input.productScopes,
          redirectTo: input.redirectTo,
          expiresInHours: input.expiresInHours,
        },
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    if (snapshot.users.some((user) => user.email.toLowerCase() === input.email.toLowerCase())) {
      throw new Error('Пользователь с таким email уже существует.');
    }
    if (snapshot.invitations.some((invitation) => invitation.email.toLowerCase() === input.email.toLowerCase() && ['pending', 'sent'].includes(invitation.status))) {
      throw new Error('Для этого email уже есть открытое приглашение.');
    }
    const now = new Date();
    snapshot.invitations.unshift({
      id: createId('invitation'),
      email: input.email.trim().toLowerCase(),
      fullName: input.fullName.trim(),
      globalRole: input.globalRole,
      organizationId: input.organizationId,
      organizationName: input.organizationId ? snapshot.organizations.find((item) => item.id === input.organizationId)?.name ?? input.organizationId : 'Платформа IMDS',
      branchId: input.branchId,
      branchName: input.branchId ? snapshot.branches.find((item) => item.id === input.branchId)?.name ?? input.branchId : 'Все филиалы',
      membershipRoleKey: input.membershipRoleKey,
      productScopes: input.productScopes,
      status: 'sent',
      authUserId: createId('auth-user'),
      expiresAt: new Date(now.getTime() + input.expiresInHours * 3600000).toISOString(),
      invitedBy: 'user-owner',
      invitedByName: 'Platform Owner',
      acceptedAt: null,
      lastError: '',
      createdAt: now.toISOString(),
    });
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async cancelInvitation(invitationId: string, reason: string): Promise<IdentitySnapshot> {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.functions.invoke('identity-admin', {
        body: { action: 'cancel', invitationId, reason },
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    snapshot.invitations = snapshot.invitations.map((invitation) => invitation.id === invitationId
      ? { ...invitation, status: 'cancelled' as const, lastError: reason }
      : invitation);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async updateUser(input: UserAccessInput): Promise<IdentitySnapshot> {
    const supabase = getIdentityClient();
    if (supabase) {
      const { error } = await supabase.rpc('set_platform_user_access', {
        target_user_id: input.userId,
        full_name_value: input.fullName,
        global_role_value: input.globalRole,
        mfa_enforced_value: input.mfaEnforced,
        is_active_value: input.isActive,
        reason_value: input.reason,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    const timestamp = new Date().toISOString();
    snapshot.users = snapshot.users.map((user) => user.id === input.userId
      ? {
          ...user,
          fullName: input.fullName,
          globalRole: input.globalRole,
          mfaEnforced: input.mfaEnforced,
          isActive: input.isActive,
          updatedAt: timestamp,
          memberships: input.isActive ? user.memberships : user.memberships.map((item) => ({ ...item, isActive: false, updatedAt: timestamp })),
        }
      : user);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async saveMembership(input: MembershipInput): Promise<IdentitySnapshot> {
    const supabase = getIdentityClient();
    if (supabase) {
      const { error } = await supabase.rpc('upsert_user_membership', {
        target_user_id: input.userId,
        organization_id_value: input.organizationId,
        branch_id_value: input.branchId,
        role_key_value: input.roleKey,
        product_scopes_value: input.productScopes,
        is_active_value: input.isActive,
        reason_value: input.reason,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    const timestamp = new Date().toISOString();
    snapshot.users = snapshot.users.map((user) => {
      if (user.id !== input.userId) return user;
      const existing = user.memberships.find((item) => item.organizationId === input.organizationId && item.branchId === input.branchId && item.roleKey === input.roleKey);
      const nextMembership: IdentityMembership = {
        id: existing?.id ?? createId('membership'),
        organizationId: input.organizationId,
        organizationName: snapshot.organizations.find((item) => item.id === input.organizationId)?.name ?? input.organizationId,
        branchId: input.branchId,
        branchName: input.branchId ? snapshot.branches.find((item) => item.id === input.branchId)?.name ?? input.branchId : 'Все филиалы',
        roleKey: input.roleKey,
        productScopes: input.productScopes,
        isActive: input.isActive,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      return {
        ...user,
        memberships: existing
          ? user.memberships.map((item) => item.id === existing.id ? nextMembership : item)
          : [...user.memberships, nextMembership],
      };
    });
    writeDemoSnapshot(snapshot);
    return snapshot;
  },
};
