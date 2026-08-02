import type { GlobalRole } from '../lib/database.types';

export type Permission =
  | 'dashboard.read'
  | 'organizations.read'
  | 'organizations.create'
  | 'organizations.update'
  | 'organizations.archive'
  | 'products.read'
  | 'products.manage'
  | 'subscriptions.read'
  | 'subscriptions.manage'
  | 'billing.operations.read'
  | 'billing.operations.manage'
  | 'users.read'
  | 'users.manage'
  | 'integrations.read'
  | 'integrations.manage'
  | 'operations.read'
  | 'operations.manage'
  | 'observability.read'
  | 'observability.manage'
  | 'analytics.read'
  | 'analytics.manage'
  | 'security.read'
  | 'security.request'
  | 'security.sessions.manage'
  | 'audit.read'
  | 'audit.verify'
  | 'support.read'
  | 'support.manage'
  | 'governance.read'
  | 'governance.manage'
  | 'settings.read'
  | 'settings.manage'
  | 'impersonation.start'
  | 'approvals.review';

const allPermissions: Permission[] = [
  'dashboard.read','organizations.read','organizations.create','organizations.update','organizations.archive',
  'products.read','products.manage','subscriptions.read','subscriptions.manage',
  'billing.operations.read','billing.operations.manage','users.read','users.manage',
  'integrations.read','integrations.manage','operations.read','operations.manage',
  'observability.read','observability.manage','analytics.read','analytics.manage',
  'security.read','security.request','security.sessions.manage',
  'audit.read','audit.verify','support.read','support.manage','governance.read','governance.manage',
  'settings.read','settings.manage','impersonation.start','approvals.review',
];

const rolePermissions: Record<GlobalRole, ReadonlySet<Permission>> = {
  platform_owner: new Set(allPermissions),
  super_admin: new Set(allPermissions),
  support_admin: new Set([
    'dashboard.read','organizations.read','products.read','subscriptions.read','billing.operations.read',
    'users.read','integrations.read','operations.read','observability.read','analytics.read',
    'security.read','security.request','audit.read','support.read','support.manage','governance.read','impersonation.start',
  ]),
  finance_admin: new Set([
    'dashboard.read','organizations.read','products.read','subscriptions.read','subscriptions.manage',
    'billing.operations.read','billing.operations.manage','observability.read','security.read','security.request',
    'approvals.review','audit.read','support.read','governance.read',
  ]),
  technical_admin: new Set([
    'dashboard.read','organizations.read','products.read','products.manage','subscriptions.read',
    'billing.operations.read','integrations.read','integrations.manage','operations.read','operations.manage',
    'observability.read','observability.manage','analytics.read','analytics.manage',
    'security.read','security.request','audit.read','support.read','support.manage',
    'governance.read','governance.manage','settings.read',
  ]),
  sales_manager: new Set([
    'dashboard.read','organizations.read','organizations.create','organizations.update','products.read',
    'subscriptions.read','billing.operations.read','observability.read','support.read','support.manage',
    'governance.read',
  ]),
  auditor: new Set([
    'dashboard.read','organizations.read','products.read','subscriptions.read','billing.operations.read',
    'users.read','integrations.read','operations.read','observability.read','analytics.read','security.read',
    'audit.read','audit.verify','support.read','governance.read','settings.read',
  ]),
};

export function hasPermission(role: GlobalRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return rolePermissions[role]?.has(permission) ?? false;
}

export function getRolePermissions(role: GlobalRole | null | undefined): Permission[] {
  if (!role) return [];
  return [...(rolePermissions[role] ?? [])];
}

export const roleLabels: Record<GlobalRole, string> = {
  platform_owner: 'Владелец платформы',
  super_admin: 'Супер-администратор',
  support_admin: 'Администратор поддержки',
  finance_admin: 'Финансовый администратор',
  technical_admin: 'Технический администратор',
  sales_manager: 'Менеджер продаж',
  auditor: 'Аудитор',
};
