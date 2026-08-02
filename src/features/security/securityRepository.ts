import type { GlobalRole, Json } from '../../lib/database.types';
import { getSupabase } from '../../lib/supabase';
import type {
  ApprovalDecision,
  ApprovalRequestStatus,
  ApprovalRiskLevel,
  AuditVerificationResult,
  PrivilegedSessionStatus,
  PrivilegedSessionType,
  SecuritySupabaseClient,
} from './securityDatabase.types';

export type SecurityPolicy = {
  key: string;
  title: string;
  description: string;
  riskLevel: ApprovalRiskLevel;
  requiredApprovals: number;
  requesterRoles: GlobalRole[];
  approverRoles: GlobalRole[];
  maxDurationMinutes: number;
  approvalTtlMinutes: number;
  organizationRequired: boolean;
  productRequired: boolean;
  mfaRequired: boolean;
  clientNotificationRequired: boolean;
  isActive: boolean;
  metadata: Json;
};

export type SecurityDecision = {
  id: string;
  reviewerUserId: string;
  reviewerName: string;
  reviewerRole: GlobalRole;
  decision: ApprovalDecision;
  note: string;
  createdAt: string;
};

export type SecurityApprovalRequest = {
  id: string;
  policyKey: string;
  policyTitle: string;
  organizationId: string | null;
  organizationName: string;
  productId: string | null;
  productName: string;
  resourceType: string | null;
  resourceId: string | null;
  requestedBy: string;
  requesterName: string;
  requesterRole: GlobalRole | null;
  status: ApprovalRequestStatus;
  reason: string;
  decisionNote: string;
  riskLevel: ApprovalRiskLevel;
  requiredApprovals: number;
  approvalsReceived: number;
  requestedDurationMinutes: number | null;
  requestedPayload: Json;
  correlationId: string;
  executionStatus: string;
  expiresAt: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisions: SecurityDecision[];
};

export type PrivilegedSessionEvent = {
  id: string;
  eventType: string;
  actorUserId: string | null;
  actorName: string;
  payload: Json;
  createdAt: string;
};

export type PrivilegedSession = {
  id: string;
  approvalRequestId: string;
  sessionType: PrivilegedSessionType;
  actorUserId: string;
  actorName: string;
  organizationId: string;
  organizationName: string;
  productId: string | null;
  productName: string;
  targetUserId: string | null;
  targetUserName: string;
  scope: string[];
  readOnly: boolean;
  status: PrivilegedSessionStatus;
  reason: string;
  requestedDurationMinutes: number;
  startedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  endReason: string;
  clientNotificationRequired: boolean;
  clientNotifiedAt: string | null;
  lastHeartbeatAt: string | null;
  correlationId: string;
  createdAt: string;
  events: PrivilegedSessionEvent[];
};

export type SecurityAuditEvent = {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorName: string;
  organizationId: string | null;
  organizationName: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  reason: string;
  correlationId: string | null;
  hash: string;
  previousHash: string | null;
  scopeKey: string;
  sequenceNumber: number | null;
  integrityVersion: number;
};

export type SecurityOrganization = { id: string; name: string; status: string };
export type SecurityProduct = { id: string; key: string; name: string; status: string };
export type SecurityUser = {
  id: string;
  email: string;
  fullName: string;
  globalRole: GlobalRole | null;
  mfaEnforced: boolean;
  isActive: boolean;
};

export type SecuritySnapshot = {
  policies: SecurityPolicy[];
  requests: SecurityApprovalRequest[];
  sessions: PrivilegedSession[];
  auditEvents: SecurityAuditEvent[];
  organizations: SecurityOrganization[];
  products: SecurityProduct[];
  users: SecurityUser[];
  pendingNotifications: number;
};

export type RequestSecurityApprovalInput = {
  policyKey: string;
  reason: string;
  organizationId: string | null;
  productId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  requestedDurationMinutes: number | null;
  requestedPayload: Json;
  idempotencyKey: string | null;
};

const STORAGE_KEY = 'imds-super-admin:security:v1';
const DEMO_NOW = '2026-08-02T12:00:00.000Z';

const demoUsers: SecurityUser[] = [
  { id: 'demo-platform-owner', email: 'owner@imdstech.net', fullName: 'Platform Owner', globalRole: 'platform_owner', mfaEnforced: true, isActive: true },
  { id: 'demo-super-admin', email: 'admin@imdstech.net', fullName: 'Super Admin', globalRole: 'super_admin', mfaEnforced: true, isActive: true },
  { id: 'user-support', email: 'support@imdstech.net', fullName: 'Support Admin', globalRole: 'support_admin', mfaEnforced: true, isActive: true },
  { id: 'user-tech', email: 'tech@imdstech.net', fullName: 'Technical Admin', globalRole: 'technical_admin', mfaEnforced: true, isActive: true },
  { id: 'user-finance', email: 'finance@imdstech.net', fullName: 'Finance Admin', globalRole: 'finance_admin', mfaEnforced: true, isActive: true },
  { id: 'user-clinic-admin', email: 'admin@amanat.example', fullName: 'Администратор клиники', globalRole: null, mfaEnforced: false, isActive: true },
];

const demoOrganizations: SecurityOrganization[] = [
  { id: 'org-amanat', name: 'Amanat Medical Center', status: 'active' },
  { id: 'org-orda', name: 'Orda Clinic', status: 'trial' },
  { id: 'org-sapa', name: 'Sapa Med', status: 'past_due' },
];

const demoProducts: SecurityProduct[] = [
  { id: 'mis', key: 'imds-mis', name: 'IMDS MIS', status: 'active' },
  { id: 'crm', key: 'imds-crm', name: 'IMDS CRM', status: 'active' },
  { id: 'marketing', key: 'imds-marketing', name: 'IMDS Marketing', status: 'degraded' },
  { id: 'finance', key: 'imds-finance', name: 'IMDS Finance', status: 'active' },
  { id: 'contract', key: 'imds-contract', name: 'IMDS Contract', status: 'active' },
  { id: 'dashboard', key: 'imds-dashboard', name: 'IMDS Dashboard', status: 'active' },
];

const demoPolicies: SecurityPolicy[] = [
  {
    key: 'support.impersonation.readonly', title: 'Support session: read-only', description: 'Временный диагностический вход без изменения данных.', riskLevel: 'high', requiredApprovals: 1,
    requesterRoles: ['platform_owner', 'super_admin', 'support_admin'], approverRoles: ['platform_owner', 'super_admin'], maxDurationMinutes: 60, approvalTtlMinutes: 1440,
    organizationRequired: true, productRequired: false, mfaRequired: true, clientNotificationRequired: true, isActive: true, metadata: { category: 'support' },
  },
  {
    key: 'support.impersonation.write', title: 'Support session: write access', description: 'Исключительный доступ с ограниченными правами записи.', riskLevel: 'critical', requiredApprovals: 2,
    requesterRoles: ['platform_owner', 'super_admin', 'support_admin'], approverRoles: ['platform_owner', 'super_admin'], maxDurationMinutes: 30, approvalTtlMinutes: 720,
    organizationRequired: true, productRequired: true, mfaRequired: true, clientNotificationRequired: true, isActive: true, metadata: { category: 'support' },
  },
  {
    key: 'security.break_glass', title: 'Break-glass emergency access', description: 'Экстренный доступ для локализации и устранения критического инцидента.', riskLevel: 'critical', requiredApprovals: 2,
    requesterRoles: ['platform_owner', 'super_admin', 'technical_admin'], approverRoles: ['platform_owner', 'super_admin'], maxDurationMinutes: 30, approvalTtlMinutes: 240,
    organizationRequired: true, productRequired: true, mfaRequired: true, clientNotificationRequired: true, isActive: true, metadata: { category: 'security' },
  },
  {
    key: 'security.maintenance', title: 'Privileged maintenance window', description: 'Плановое окно технического обслуживания tenant.', riskLevel: 'high', requiredApprovals: 1,
    requesterRoles: ['platform_owner', 'super_admin', 'technical_admin'], approverRoles: ['platform_owner', 'super_admin'], maxDurationMinutes: 120, approvalTtlMinutes: 1440,
    organizationRequired: true, productRequired: true, mfaRequired: true, clientNotificationRequired: true, isActive: true, metadata: { category: 'security' },
  },
  {
    key: 'billing.refund.large', title: 'Large payment refund', description: 'Возврат платежа выше финансового порога.', riskLevel: 'critical', requiredApprovals: 2,
    requesterRoles: ['platform_owner', 'super_admin', 'finance_admin'], approverRoles: ['platform_owner', 'super_admin', 'finance_admin'], maxDurationMinutes: 60, approvalTtlMinutes: 1440,
    organizationRequired: true, productRequired: false, mfaRequired: true, clientNotificationRequired: false, isActive: true, metadata: { category: 'billing', thresholdKzt: 500000 },
  },
  {
    key: 'organization.delete', title: 'Permanent organization deletion', description: 'Необратимое удаление после выполнения retention и export требований.', riskLevel: 'critical', requiredApprovals: 2,
    requesterRoles: ['platform_owner', 'super_admin'], approverRoles: ['platform_owner', 'super_admin'], maxDurationMinutes: 60, approvalTtlMinutes: 1440,
    organizationRequired: true, productRequired: false, mfaRequired: true, clientNotificationRequired: true, isActive: true, metadata: { category: 'data_governance' },
  },
  {
    key: 'product.disable.global', title: 'Global product disable', description: 'Глобальное отключение продукта во время тяжёлого инцидента.', riskLevel: 'critical', requiredApprovals: 2,
    requesterRoles: ['platform_owner', 'super_admin', 'technical_admin'], approverRoles: ['platform_owner', 'super_admin'], maxDurationMinutes: 60, approvalTtlMinutes: 240,
    organizationRequired: false, productRequired: true, mfaRequired: true, clientNotificationRequired: false, isActive: true, metadata: { category: 'operations' },
  },
  {
    key: 'entitlement.override', title: 'Entitlement override', description: 'Временное изменение функции или лимита лицензии.', riskLevel: 'high', requiredApprovals: 1,
    requesterRoles: ['platform_owner', 'super_admin', 'finance_admin', 'technical_admin'], approverRoles: ['platform_owner', 'super_admin'], maxDurationMinutes: 1440, approvalTtlMinutes: 1440,
    organizationRequired: true, productRequired: true, mfaRequired: true, clientNotificationRequired: false, isActive: true, metadata: { category: 'licensing' },
  },
];

function userName(id: string | null, users = demoUsers) {
  if (!id) return 'Системный процесс';
  const user = users.find((item) => item.id === id);
  return user?.fullName || user?.email || id;
}

function organizationName(id: string | null, organizations = demoOrganizations) {
  if (!id) return 'Платформа';
  return organizations.find((item) => item.id === id)?.name ?? id;
}

function productName(id: string | null, products = demoProducts) {
  if (!id) return 'Все продукты';
  return products.find((item) => item.id === id)?.name ?? id;
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const defaultSnapshot: SecuritySnapshot = {
  policies: demoPolicies,
  organizations: demoOrganizations,
  products: demoProducts,
  users: demoUsers,
  pendingNotifications: 1,
  requests: [
    {
      id: 'approval-support-read', policyKey: 'support.impersonation.readonly', policyTitle: 'Support session: read-only', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center',
      productId: 'mis', productName: 'IMDS MIS', resourceType: 'tenant', resourceId: 'amanat-mis', requestedBy: 'user-support', requesterName: 'Support Admin', requesterRole: 'support_admin',
      status: 'pending', reason: 'Диагностика ошибки расписания клиники по обращению SUPPORT-2481.', decisionNote: '', riskLevel: 'high', requiredApprovals: 1, approvalsReceived: 0,
      requestedDurationMinutes: 45, requestedPayload: { readOnly: true, targetUserId: 'user-clinic-admin', scope: ['mis.schedule.read', 'mis.logs.read'] },
      correlationId: 'corr-support-read', executionStatus: 'pending', expiresAt: '2026-08-03T12:00:00.000Z', createdAt: '2026-08-02T11:30:00.000Z', decidedAt: null, decisions: [],
    },
    {
      id: 'approval-break-glass', policyKey: 'security.break_glass', policyTitle: 'Break-glass emergency access', organizationId: 'org-orda', organizationName: 'Orda Clinic',
      productId: 'crm', productName: 'IMDS CRM', resourceType: 'incident', resourceId: 'INC-2026-081', requestedBy: 'user-tech', requesterName: 'Technical Admin', requesterRole: 'technical_admin',
      status: 'pending', reason: 'Критическая деградация CRM API, требуется изоляция повреждённой очереди.', decisionNote: '', riskLevel: 'critical', requiredApprovals: 2, approvalsReceived: 1,
      requestedDurationMinutes: 30, requestedPayload: { readOnly: false, scope: ['crm.queue.manage', 'crm.integration.disable'] }, correlationId: 'corr-break-glass', executionStatus: 'pending',
      expiresAt: '2026-08-02T16:00:00.000Z', createdAt: '2026-08-02T11:10:00.000Z', decidedAt: null,
      decisions: [{ id: 'decision-break-glass-1', reviewerUserId: 'demo-super-admin', reviewerName: 'Super Admin', reviewerRole: 'super_admin', decision: 'approved', note: 'Инцидент подтверждён, первый допуск выдан.', createdAt: '2026-08-02T11:20:00.000Z' }],
    },
    {
      id: 'approval-entitlement', policyKey: 'entitlement.override', policyTitle: 'Entitlement override', organizationId: 'org-sapa', organizationName: 'Sapa Med',
      productId: 'dashboard', productName: 'IMDS Dashboard', resourceType: 'license', resourceId: 'license-sapa-dashboard', requestedBy: 'user-finance', requesterName: 'Finance Admin', requesterRole: 'finance_admin',
      status: 'approved', reason: 'Временное увеличение лимита экспорта до закрытия коммерческого дополнения.', decisionNote: 'Одобрено владельцем платформы.', riskLevel: 'high', requiredApprovals: 1, approvalsReceived: 1,
      requestedDurationMinutes: 1440, requestedPayload: { entitlement: 'dashboard.export_limit', value: 500 }, correlationId: 'corr-entitlement', executionStatus: 'ready',
      expiresAt: '2026-08-03T10:00:00.000Z', createdAt: '2026-08-02T09:00:00.000Z', decidedAt: '2026-08-02T09:20:00.000Z',
      decisions: [{ id: 'decision-entitlement', reviewerUserId: 'demo-platform-owner', reviewerName: 'Platform Owner', reviewerRole: 'platform_owner', decision: 'approved', note: 'Лимит согласован на 24 часа.', createdAt: '2026-08-02T09:20:00.000Z' }],
    },
  ],
  sessions: [
    {
      id: 'session-support-active', approvalRequestId: 'approval-support-completed', sessionType: 'support_impersonation', actorUserId: 'user-support', actorName: 'Support Admin',
      organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', productId: 'crm', productName: 'IMDS CRM', targetUserId: 'user-clinic-admin', targetUserName: 'Администратор клиники',
      scope: ['crm.deals.read', 'crm.logs.read'], readOnly: true, status: 'active', reason: 'Проверка пропавших лидов по заявке SUPPORT-2472.', requestedDurationMinutes: 30,
      startedAt: '2026-08-02T11:45:00.000Z', expiresAt: '2026-08-02T12:15:00.000Z', endedAt: null, endReason: '', clientNotificationRequired: true,
      clientNotifiedAt: '2026-08-02T11:44:00.000Z', lastHeartbeatAt: '2026-08-02T11:55:00.000Z', correlationId: 'corr-session-active', createdAt: '2026-08-02T11:40:00.000Z',
      events: [
        { id: 'session-event-1', eventType: 'materialized', actorUserId: 'demo-platform-owner', actorName: 'Platform Owner', payload: {}, createdAt: '2026-08-02T11:40:00.000Z' },
        { id: 'session-event-2', eventType: 'client_notified', actorUserId: 'user-support', actorName: 'Support Admin', payload: {}, createdAt: '2026-08-02T11:44:00.000Z' },
        { id: 'session-event-3', eventType: 'activated', actorUserId: 'user-support', actorName: 'Support Admin', payload: { durationMinutes: 30 }, createdAt: '2026-08-02T11:45:00.000Z' },
      ],
    },
  ],
  auditEvents: [
    { id: 'audit-3', occurredAt: '2026-08-02T11:45:00.000Z', actorUserId: 'user-support', actorName: 'Support Admin', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', action: 'security.privileged_session.activated', resourceType: 'privileged_access_session', resourceId: 'session-support-active', reason: 'Проверка пропавших лидов', correlationId: 'corr-session-active', hash: 'cc09f2b0f1a347d8fbb4303c633015fa', previousHash: '2a87e6ac48d44f18b1bcd5987b1a090d', scopeKey: 'org-amanat', sequenceNumber: 3, integrityVersion: 2 },
    { id: 'audit-2', occurredAt: '2026-08-02T11:40:00.000Z', actorUserId: 'demo-platform-owner', actorName: 'Platform Owner', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', action: 'security.approval.approved', resourceType: 'approval_request', resourceId: 'approval-support-completed', reason: 'Диагностический доступ подтверждён', correlationId: 'corr-session-active', hash: '2a87e6ac48d44f18b1bcd5987b1a090d', previousHash: '99dfe3d79a604b5d885b4cb147c8df71', scopeKey: 'org-amanat', sequenceNumber: 2, integrityVersion: 2 },
    { id: 'audit-1', occurredAt: '2026-08-02T11:30:00.000Z', actorUserId: 'user-support', actorName: 'Support Admin', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', action: 'security.approval.requested', resourceType: 'approval_request', resourceId: 'approval-support-read', reason: 'Диагностика ошибки расписания', correlationId: 'corr-support-read', hash: '99dfe3d79a604b5d885b4cb147c8df71', previousHash: null, scopeKey: 'org-amanat', sequenceNumber: 1, integrityVersion: 2 },
  ],
};

function cloneDefaultSnapshot() {
  return JSON.parse(JSON.stringify(defaultSnapshot)) as SecuritySnapshot;
}

function readDemoSnapshot(): SecuritySnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = cloneDefaultSnapshot();
      writeDemoSnapshot(initial);
      return initial;
    }
    return JSON.parse(raw) as SecuritySnapshot;
  } catch {
    return cloneDefaultSnapshot();
  }
}

function writeDemoSnapshot(snapshot: SecuritySnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function getSecurityClient(): SecuritySupabaseClient | null {
  return getSupabase() as unknown as SecuritySupabaseClient | null;
}

function asObject(value: Json): Record<string, Json | undefined> {
  return value && !Array.isArray(value) && typeof value === 'object' ? value : {};
}

function appendDemoAudit(
  snapshot: SecuritySnapshot,
  actorUserId: string,
  organizationId: string | null,
  action: string,
  resourceType: string,
  resourceId: string,
  reason: string,
) {
  const scopeKey = organizationId ?? 'platform';
  const previous = snapshot.auditEvents
    .filter((event) => event.scopeKey === scopeKey)
    .sort((left, right) => (right.sequenceNumber ?? 0) - (left.sequenceNumber ?? 0))[0];
  const sequenceNumber = (previous?.sequenceNumber ?? 0) + 1;
  snapshot.auditEvents.unshift({
    id: createId('audit'),
    occurredAt: new Date().toISOString(),
    actorUserId,
    actorName: userName(actorUserId, snapshot.users),
    organizationId,
    organizationName: organizationName(organizationId, snapshot.organizations),
    action,
    resourceType,
    resourceId,
    reason,
    correlationId: createId('correlation'),
    hash: createId('hash').replaceAll('-', ''),
    previousHash: previous?.hash ?? null,
    scopeKey,
    sequenceNumber,
    integrityVersion: 2,
  });
}

async function listSupabaseSnapshot(client: SecuritySupabaseClient): Promise<SecuritySnapshot> {
  const [
    policyResult,
    requestResult,
    decisionResult,
    sessionResult,
    sessionEventResult,
    notificationResult,
    auditResult,
    organizationResult,
    productResult,
    userResult,
  ] = await Promise.all([
    client.from('approval_policies').select('*').order('risk_level', { ascending: false }).order('title'),
    client.from('approval_requests').select('*').order('created_at', { ascending: false }).limit(250),
    client.from('approval_request_decisions').select('*').order('created_at', { ascending: true }).limit(500),
    client.from('privileged_access_sessions').select('*').order('created_at', { ascending: false }).limit(250),
    client.from('privileged_session_events').select('*').order('created_at', { ascending: true }).limit(1000),
    client.from('security_notification_outbox').select('*').order('created_at', { ascending: false }).limit(250),
    client.from('audit_events').select('*').order('occurred_at', { ascending: false }).limit(250),
    client.from('organizations').select('*').is('archived_at', null).order('name'),
    client.from('products').select('*').is('archived_at', null).order('name'),
    client.from('platform_users').select('*').order('full_name'),
  ]);

  const firstError = [policyResult.error, requestResult.error, decisionResult.error, sessionResult.error, sessionEventResult.error, notificationResult.error, auditResult.error, organizationResult.error, productResult.error, userResult.error].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const users: SecurityUser[] = (userResult.data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name ?? '',
    globalRole: row.global_role,
    mfaEnforced: row.mfa_enforced,
    isActive: row.is_active,
  }));
  const organizations: SecurityOrganization[] = (organizationResult.data ?? []).map((row) => ({ id: row.id, name: row.name, status: row.status }));
  const products: SecurityProduct[] = (productResult.data ?? []).map((row) => ({ id: row.id, key: row.key, name: row.name, status: row.status }));

  const policies: SecurityPolicy[] = (policyResult.data ?? []).map((row) => ({
    key: row.key,
    title: row.title,
    description: row.description ?? '',
    riskLevel: row.risk_level,
    requiredApprovals: row.required_approvals,
    requesterRoles: row.requester_roles,
    approverRoles: row.approver_roles,
    maxDurationMinutes: row.max_duration_minutes,
    approvalTtlMinutes: row.approval_ttl_minutes,
    organizationRequired: row.organization_required,
    productRequired: row.product_required,
    mfaRequired: row.mfa_required,
    clientNotificationRequired: row.client_notification_required,
    isActive: row.is_active,
    metadata: row.metadata,
  }));

  const decisions: SecurityDecision[] = (decisionResult.data ?? []).map((row) => ({
    id: row.id,
    reviewerUserId: row.reviewer_user_id,
    reviewerName: userName(row.reviewer_user_id, users),
    reviewerRole: row.reviewer_role,
    decision: row.decision,
    note: row.note,
    createdAt: row.created_at,
  }));

  const requests: SecurityApprovalRequest[] = (requestResult.data ?? []).map((row) => ({
    id: row.id,
    policyKey: row.policy_key ?? row.action_key,
    policyTitle: policies.find((policy) => policy.key === (row.policy_key ?? row.action_key))?.title ?? row.action_key,
    organizationId: row.organization_id,
    organizationName: organizationName(row.organization_id, organizations),
    productId: row.product_id,
    productName: productName(row.product_id, products),
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    requestedBy: row.requested_by,
    requesterName: userName(row.requested_by, users),
    requesterRole: row.requester_role,
    status: row.status,
    reason: row.reason,
    decisionNote: row.decision_note ?? '',
    riskLevel: row.risk_level,
    requiredApprovals: row.required_approvals,
    approvalsReceived: row.approvals_received,
    requestedDurationMinutes: row.requested_duration_minutes,
    requestedPayload: row.requested_payload,
    correlationId: row.correlation_id,
    executionStatus: row.execution_status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decisions: decisions.filter((decision) => (decisionResult.data ?? []).find((source) => source.id === decision.id)?.approval_request_id === row.id),
  }));

  const sessionEvents: PrivilegedSessionEvent[] = (sessionEventResult.data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    actorName: userName(row.actor_user_id, users),
    payload: row.payload,
    createdAt: row.created_at,
  }));

  const sessions: PrivilegedSession[] = (sessionResult.data ?? []).map((row) => ({
    id: row.id,
    approvalRequestId: row.approval_request_id,
    sessionType: row.session_type,
    actorUserId: row.actor_user_id,
    actorName: userName(row.actor_user_id, users),
    organizationId: row.organization_id,
    organizationName: organizationName(row.organization_id, organizations),
    productId: row.product_id,
    productName: productName(row.product_id, products),
    targetUserId: row.target_user_id,
    targetUserName: userName(row.target_user_id, users),
    scope: row.scope,
    readOnly: row.read_only,
    status: row.status,
    reason: row.reason,
    requestedDurationMinutes: row.requested_duration_minutes,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
    endReason: row.end_reason ?? '',
    clientNotificationRequired: row.client_notification_required,
    clientNotifiedAt: row.client_notified_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    events: sessionEvents.filter((event) => (sessionEventResult.data ?? []).find((source) => source.id === event.id)?.session_id === row.id),
  }));

  const auditEvents: SecurityAuditEvent[] = (auditResult.data ?? []).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id,
    actorName: userName(row.actor_user_id, users),
    organizationId: row.organization_id,
    organizationName: organizationName(row.organization_id, organizations),
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    reason: row.reason ?? '',
    correlationId: row.correlation_id,
    hash: row.hash,
    previousHash: row.previous_hash,
    scopeKey: row.scope_key ?? row.organization_id ?? 'platform',
    sequenceNumber: row.sequence_number,
    integrityVersion: row.integrity_version,
  }));

  return {
    policies,
    requests,
    sessions,
    auditEvents,
    organizations,
    products,
    users,
    pendingNotifications: (notificationResult.data ?? []).filter((row) => ['pending', 'failed'].includes(row.status)).length,
  };
}

async function mutateReal(command: (client: SecuritySupabaseClient) => Promise<{ error: { message: string } | null }>) {
  const client = getSecurityClient();
  if (!client) throw new Error('Supabase Security client is not configured.');
  const result = await command(client);
  if (result.error) throw new Error(result.error.message);
  return listSupabaseSnapshot(client);
}

export const securityRepository = {
  async list(): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    return client ? listSupabaseSnapshot(client) : readDemoSnapshot();
  },

  async request(input: RequestSecurityApprovalInput, actorUserId: string, actorRole: GlobalRole | null): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    if (client) {
      const { error } = await client.rpc('request_security_approval', {
        policy_key_value: input.policyKey,
        reason_value: input.reason,
        organization_id_value: input.organizationId,
        product_id_value: input.productId,
        resource_type_value: input.resourceType,
        resource_id_value: input.resourceId,
        requested_duration_minutes_value: input.requestedDurationMinutes,
        payload_value: input.requestedPayload,
        idempotency_key_value: input.idempotencyKey,
      });
      if (error) throw new Error(error.message);
      return listSupabaseSnapshot(client);
    }

    const snapshot = readDemoSnapshot();
    const policy = snapshot.policies.find((item) => item.key === input.policyKey && item.isActive);
    if (!policy) throw new Error('Политика согласования не найдена.');
    if (!actorRole || !policy.requesterRoles.includes(actorRole)) throw new Error('Текущая роль не может запрашивать это действие.');
    const id = createId('approval');
    snapshot.requests.unshift({
      id,
      policyKey: policy.key,
      policyTitle: policy.title,
      organizationId: input.organizationId,
      organizationName: organizationName(input.organizationId, snapshot.organizations),
      productId: input.productId,
      productName: productName(input.productId, snapshot.products),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestedBy: actorUserId,
      requesterName: userName(actorUserId, snapshot.users),
      requesterRole: actorRole,
      status: 'pending',
      reason: input.reason,
      decisionNote: '',
      riskLevel: policy.riskLevel,
      requiredApprovals: policy.requiredApprovals,
      approvalsReceived: 0,
      requestedDurationMinutes: input.requestedDurationMinutes ?? policy.maxDurationMinutes,
      requestedPayload: input.requestedPayload,
      correlationId: createId('correlation'),
      executionStatus: 'pending',
      expiresAt: new Date(Date.now() + policy.approvalTtlMinutes * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      decidedAt: null,
      decisions: [],
    });
    appendDemoAudit(snapshot, actorUserId, input.organizationId, 'security.approval.requested', 'approval_request', id, input.reason);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async decide(requestId: string, decision: ApprovalDecision, note: string, actorUserId: string, actorRole: GlobalRole | null): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    if (client) {
      const { error } = await client.rpc('decide_security_approval', {
        approval_request_id_value: requestId,
        decision_value: decision,
        note_value: note,
      });
      if (error) throw new Error(error.message);
      return listSupabaseSnapshot(client);
    }

    const snapshot = readDemoSnapshot();
    const request = snapshot.requests.find((item) => item.id === requestId);
    if (!request) throw new Error('Заявка не найдена.');
    const policy = snapshot.policies.find((item) => item.key === request.policyKey);
    if (!policy || !actorRole || !policy.approverRoles.includes(actorRole)) throw new Error('Текущая роль не может рассматривать эту заявку.');
    if (request.requestedBy === actorUserId) throw new Error('Инициатор не может согласовать собственную заявку.');
    if (request.status !== 'pending') throw new Error('Заявка уже закрыта.');
    if (request.decisions.some((item) => item.reviewerUserId === actorUserId)) throw new Error('Вы уже приняли решение по этой заявке.');

    request.decisions.push({
      id: createId('decision'), reviewerUserId: actorUserId, reviewerName: userName(actorUserId, snapshot.users), reviewerRole: actorRole,
      decision, note, createdAt: new Date().toISOString(),
    });

    if (decision === 'rejected') {
      request.status = 'rejected';
      request.decisionNote = note;
      request.decidedAt = new Date().toISOString();
      request.executionStatus = 'cancelled';
    } else {
      request.approvalsReceived = request.decisions.filter((item) => item.decision === 'approved').length;
      if (request.approvalsReceived >= request.requiredApprovals) {
        request.status = 'approved';
        request.decisionNote = note;
        request.decidedAt = new Date().toISOString();
        request.executionStatus = 'ready';

        if (['support.impersonation.readonly', 'support.impersonation.write', 'security.break_glass', 'security.maintenance'].includes(request.policyKey)) {
          const payload = asObject(request.requestedPayload);
          const scope = Array.isArray(payload.scope) ? payload.scope.filter((item): item is string => typeof item === 'string') : [];
          const sessionType: PrivilegedSessionType = request.policyKey.startsWith('support.') ? 'support_impersonation' : request.policyKey === 'security.break_glass' ? 'break_glass' : 'maintenance';
          const sessionId = createId('session');
          snapshot.sessions.unshift({
            id: sessionId,
            approvalRequestId: request.id,
            sessionType,
            actorUserId: request.requestedBy,
            actorName: request.requesterName,
            organizationId: request.organizationId ?? '',
            organizationName: request.organizationName,
            productId: request.productId,
            productName: request.productName,
            targetUserId: typeof payload.targetUserId === 'string' ? payload.targetUserId : null,
            targetUserName: typeof payload.targetUserId === 'string' ? userName(payload.targetUserId, snapshot.users) : 'Не указан',
            scope,
            readOnly: typeof payload.readOnly === 'boolean' ? payload.readOnly : true,
            status: 'approved',
            reason: request.reason,
            requestedDurationMinutes: request.requestedDurationMinutes ?? policy.maxDurationMinutes,
            startedAt: null,
            expiresAt: null,
            endedAt: null,
            endReason: '',
            clientNotificationRequired: policy.clientNotificationRequired,
            clientNotifiedAt: null,
            lastHeartbeatAt: null,
            correlationId: request.correlationId,
            createdAt: new Date().toISOString(),
            events: [{ id: createId('event'), eventType: 'materialized', actorUserId, actorName: userName(actorUserId, snapshot.users), payload: { approvalRequestId: request.id }, createdAt: new Date().toISOString() }],
          });
          if (policy.clientNotificationRequired) snapshot.pendingNotifications += 1;
        }
      }
    }

    appendDemoAudit(snapshot, actorUserId, request.organizationId, `security.approval.${decision}`, 'approval_request', request.id, note);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async cancel(requestId: string, reason: string, actorUserId: string, actorRole: GlobalRole | null): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    if (client) return mutateReal((target) => target.rpc('cancel_security_approval', { approval_request_id_value: requestId, reason_value: reason }));
    const snapshot = readDemoSnapshot();
    const request = snapshot.requests.find((item) => item.id === requestId);
    if (!request) throw new Error('Заявка не найдена.');
    if (request.requestedBy !== actorUserId && !['platform_owner', 'super_admin'].includes(actorRole ?? '')) throw new Error('Недостаточно прав для отмены заявки.');
    if (request.status !== 'pending') throw new Error('Можно отменить только ожидающую заявку.');
    request.status = 'cancelled';
    request.executionStatus = 'cancelled';
    request.decisionNote = reason;
    appendDemoAudit(snapshot, actorUserId, request.organizationId, 'security.approval.cancelled', 'approval_request', request.id, reason);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async activateSession(sessionId: string, actorUserId: string, actorRole: GlobalRole | null): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    if (client) return mutateReal((target) => target.rpc('activate_privileged_access_session', { session_id_value: sessionId }));
    const snapshot = readDemoSnapshot();
    const session = snapshot.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error('Привилегированная сессия не найдена.');
    if (session.actorUserId !== actorUserId && !['platform_owner', 'super_admin'].includes(actorRole ?? '')) throw new Error('Недостаточно прав для запуска сессии.');
    if (session.status !== 'approved') throw new Error('Сессия не готова к запуску.');
    if (snapshot.sessions.some((item) => item.id !== session.id && item.actorUserId === session.actorUserId && item.organizationId === session.organizationId && item.status === 'active')) throw new Error('У пользователя уже есть активная сессия в этой компании.');
    const startedAt = new Date();
    session.status = 'active';
    session.startedAt = startedAt.toISOString();
    session.expiresAt = new Date(startedAt.getTime() + session.requestedDurationMinutes * 60_000).toISOString();
    session.lastHeartbeatAt = session.startedAt;
    session.events.push({ id: createId('event'), eventType: 'activated', actorUserId, actorName: userName(actorUserId, snapshot.users), payload: { durationMinutes: session.requestedDurationMinutes }, createdAt: session.startedAt });
    if (session.clientNotificationRequired) snapshot.pendingNotifications += 1;
    appendDemoAudit(snapshot, actorUserId, session.organizationId, 'security.privileged_session.activated', 'privileged_access_session', session.id, session.reason);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async endSession(sessionId: string, reason: string, actorUserId: string, actorRole: GlobalRole | null): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    if (client) return mutateReal((target) => target.rpc('end_privileged_access_session', { session_id_value: sessionId, reason_value: reason }));
    const snapshot = readDemoSnapshot();
    const session = snapshot.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error('Сессия не найдена.');
    if (session.actorUserId !== actorUserId && !['platform_owner', 'super_admin'].includes(actorRole ?? '')) throw new Error('Недостаточно прав для завершения сессии.');
    if (!['approved', 'active'].includes(session.status)) throw new Error('Сессия уже закрыта.');
    session.status = 'ended';
    session.endedAt = new Date().toISOString();
    session.endReason = reason;
    session.events.push({ id: createId('event'), eventType: 'ended', actorUserId, actorName: userName(actorUserId, snapshot.users), payload: { reason }, createdAt: session.endedAt });
    appendDemoAudit(snapshot, actorUserId, session.organizationId, 'security.privileged_session.ended', 'privileged_access_session', session.id, reason);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async revokeSession(sessionId: string, reason: string, actorUserId: string, actorRole: GlobalRole | null): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    if (client) return mutateReal((target) => target.rpc('revoke_privileged_access_session', { session_id_value: sessionId, reason_value: reason }));
    if (!['platform_owner', 'super_admin'].includes(actorRole ?? '')) throw new Error('Только security manager может отозвать сессию.');
    const snapshot = readDemoSnapshot();
    const session = snapshot.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error('Сессия не найдена.');
    if (!['approved', 'active'].includes(session.status)) throw new Error('Сессию уже нельзя отозвать.');
    session.status = 'revoked';
    session.endedAt = new Date().toISOString();
    session.endReason = reason;
    session.events.push({ id: createId('event'), eventType: 'revoked', actorUserId, actorName: userName(actorUserId, snapshot.users), payload: { reason }, createdAt: session.endedAt });
    appendDemoAudit(snapshot, actorUserId, session.organizationId, 'security.privileged_session.revoked', 'privileged_access_session', session.id, reason);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async heartbeatSession(sessionId: string, actorUserId: string, actorRole: GlobalRole | null): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    if (client) return mutateReal((target) => target.rpc('heartbeat_privileged_access_session', { session_id_value: sessionId }));
    const snapshot = readDemoSnapshot();
    const session = snapshot.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error('Сессия не найдена.');
    if (session.actorUserId !== actorUserId && !['platform_owner', 'super_admin'].includes(actorRole ?? '')) throw new Error('Недостаточно прав.');
    if (session.status !== 'active') throw new Error('Heartbeat доступен только активной сессии.');
    session.lastHeartbeatAt = new Date().toISOString();
    session.events.push({ id: createId('event'), eventType: 'heartbeat', actorUserId, actorName: userName(actorUserId, snapshot.users), payload: {}, createdAt: session.lastHeartbeatAt });
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async markClientNotified(sessionId: string, actorUserId: string): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    if (client) return mutateReal((target) => target.rpc('mark_privileged_session_client_notified', { session_id_value: sessionId }));
    const snapshot = readDemoSnapshot();
    const session = snapshot.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error('Сессия не найдена.');
    if (!session.clientNotifiedAt) {
      session.clientNotifiedAt = new Date().toISOString();
      session.events.push({ id: createId('event'), eventType: 'client_notified', actorUserId, actorName: userName(actorUserId, snapshot.users), payload: {}, createdAt: session.clientNotifiedAt });
      snapshot.pendingNotifications = Math.max(0, snapshot.pendingNotifications - 1);
    }
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async expireControls(): Promise<SecuritySnapshot> {
    const client = getSecurityClient();
    if (client) return mutateReal((target) => target.rpc('expire_security_controls', {}));
    const snapshot = readDemoSnapshot();
    const now = Date.now();
    snapshot.requests.forEach((request) => {
      if (request.status === 'pending' && request.expiresAt && new Date(request.expiresAt).getTime() <= now) {
        request.status = 'expired';
        request.executionStatus = 'cancelled';
      }
    });
    snapshot.sessions.forEach((session) => {
      if (session.status === 'active' && session.expiresAt && new Date(session.expiresAt).getTime() <= now) {
        session.status = 'expired';
        session.endedAt = new Date().toISOString();
        session.endReason = 'Automatic expiry';
      }
    });
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async verifyAudit(scopeKey: string | null): Promise<AuditVerificationResult[]> {
    const client = getSecurityClient();
    if (client) {
      const { data, error } = await client.rpc('verify_audit_chain', { target_scope_key: scopeKey });
      if (error) throw new Error(error.message);
      return data ?? [];
    }
    const snapshot = readDemoSnapshot();
    const scopes = [...new Set(snapshot.auditEvents.map((event) => event.scopeKey))].filter((scope) => !scopeKey || scope === scopeKey);
    return scopes.map((scope) => ({
      scope_key: scope,
      checked_events: snapshot.auditEvents.filter((event) => event.scopeKey === scope && event.integrityVersion === 2).length,
      is_valid: true,
      first_invalid_sequence: null,
      message: 'Audit chain is valid',
    }));
  },
};
