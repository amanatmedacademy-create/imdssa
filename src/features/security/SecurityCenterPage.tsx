import {
  Activity,
  AlertTriangle,
  Ban,
  BellRing,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  FileCheck2,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TimerReset,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import { roleLabels } from '../../core/permissions';
import type { GlobalRole, Json } from '../../lib/database.types';
import { useSecurity } from './SecurityContext';
import type { ApprovalDecision, ApprovalRequestStatus, ApprovalRiskLevel, PrivilegedSessionStatus } from './securityDatabase.types';
import type { PrivilegedSession, RequestSecurityApprovalInput, SecurityApprovalRequest, SecurityPolicy } from './securityRepository';

type SecurityTab = 'approvals' | 'sessions' | 'policies' | 'audit';

type RequestFormState = {
  policyKey: string;
  organizationId: string;
  productId: string;
  resourceType: string;
  resourceId: string;
  durationMinutes: number;
  reason: string;
  targetUserId: string;
  readOnly: boolean;
  scopeText: string;
  payloadText: string;
};

const emptyRequestForm: RequestFormState = {
  policyKey: '',
  organizationId: '',
  productId: '',
  resourceType: '',
  resourceId: '',
  durationMinutes: 30,
  reason: '',
  targetUserId: '',
  readOnly: true,
  scopeText: '',
  payloadText: '{}',
};

const riskLabels: Record<ApprovalRiskLevel, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
};

const approvalStatusLabels: Record<ApprovalRequestStatus, string> = {
  pending: 'Ожидает решения',
  approved: 'Одобрено',
  rejected: 'Отклонено',
  expired: 'Истекло',
  cancelled: 'Отменено',
};

const sessionStatusLabels: Record<PrivilegedSessionStatus, string> = {
  approved: 'Готова к запуску',
  active: 'Активна',
  expired: 'Истекла',
  revoked: 'Отозвана',
  ended: 'Завершена',
  failed: 'Ошибка',
};

const sessionTypeLabels: Record<PrivilegedSession['sessionType'], string> = {
  support_impersonation: 'Support impersonation',
  break_glass: 'Break-glass',
  maintenance: 'Maintenance',
};

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function shortHash(value: string | null) {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

function statusClass(status: ApprovalRequestStatus | PrivilegedSessionStatus) {
  if (status === 'approved' || status === 'active') return 'ok';
  if (status === 'pending') return 'info';
  if (status === 'rejected' || status === 'revoked' || status === 'failed') return 'danger';
  if (status === 'expired') return 'warn';
  return 'muted';
}

function riskClass(risk: ApprovalRiskLevel) {
  if (risk === 'critical') return 'danger';
  if (risk === 'high') return 'warn';
  if (risk === 'medium') return 'info';
  return 'muted';
}

function isPrivilegedSessionPolicy(policyKey: string) {
  return policyKey.startsWith('support.impersonation.')
    || policyKey === 'security.break_glass'
    || policyKey === 'security.maintenance';
}

function safeJson(value: Json) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(value: string): Json {
  const trimmed = value.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed) as Json;
}

function splitScope(value: string) {
  return [...new Set(value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))];
}

function ApprovalProgress({ request }: { request: SecurityApprovalRequest }) {
  return (
    <div className="approval-progress" aria-label={`${request.approvalsReceived} из ${request.requiredApprovals} согласований`}>
      {Array.from({ length: request.requiredApprovals }, (_, index) => (
        <span className={index < request.approvalsReceived ? 'complete' : ''} key={index} />
      ))}
      <b>{request.approvalsReceived}/{request.requiredApprovals}</b>
    </div>
  );
}

export function SecurityCenterPage() {
  const { profile, role, can, isDemo } = useAuth();
  const {
    policies,
    requests,
    sessions,
    auditEvents,
    organizations,
    products,
    users,
    pendingNotifications,
    loading,
    saving,
    verifying,
    error,
    verification,
    refresh,
    requestApproval,
    decideApproval,
    cancelApproval,
    activateSession,
    endSession,
    revokeSession,
    heartbeatSession,
    markClientNotified,
    expireControls,
    verifyAudit,
  } = useSecurity();

  const requestDialog = useRef<HTMLDialogElement | null>(null);
  const decisionDialog = useRef<HTMLDialogElement | null>(null);
  const requestDetailsDialog = useRef<HTMLDialogElement | null>(null);
  const sessionDetailsDialog = useRef<HTMLDialogElement | null>(null);
  const [tab, setTab] = useState<SecurityTab>('approvals');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ApprovalRequestStatus>('all');
  const [riskFilter, setRiskFilter] = useState<'all' | ApprovalRiskLevel>('all');
  const [requestForm, setRequestForm] = useState<RequestFormState>(emptyRequestForm);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [decision, setDecision] = useState<ApprovalDecision>('approved');
  const [decisionNote, setDecisionNote] = useState('');
  const [validation, setValidation] = useState('');
  const [auditScope, setAuditScope] = useState('');

  const currentUserId = profile?.id ?? 'demo-platform-owner';
  const canRequest = can('security.request') || can('impersonation.start');
  const canReview = can('approvals.review');
  const canManageSessions = can('security.sessions.manage');
  const canVerifyAudit = can('audit.verify');
  const selectedPolicy = policies.find((policy) => policy.key === requestForm.policyKey) ?? null;
  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ?? null;
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;

  const requestablePolicies = useMemo(
    () => policies.filter((policy) => policy.isActive && Boolean(role && policy.requesterRoles.includes(role))),
    [policies, role],
  );

  const filteredRequests = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return requests.filter((request) => {
      if (statusFilter !== 'all' && request.status !== statusFilter) return false;
      if (riskFilter !== 'all' && request.riskLevel !== riskFilter) return false;
      if (!normalized) return true;
      return [request.policyTitle, request.policyKey, request.requesterName, request.organizationName, request.productName, request.reason, request.resourceId ?? '']
        .some((value) => value.toLowerCase().includes(normalized));
    });
  }, [query, requests, riskFilter, statusFilter]);

  const metrics = useMemo(() => ({
    pending: requests.filter((request) => request.status === 'pending').length,
    critical: requests.filter((request) => request.status === 'pending' && request.riskLevel === 'critical').length,
    activeSessions: sessions.filter((session) => session.status === 'active').length,
    notificationQueue: pendingNotifications,
  }), [pendingNotifications, requests, sessions]);

  const openRequest = () => {
    const first = requestablePolicies[0];
    setRequestForm({
      ...emptyRequestForm,
      policyKey: first?.key ?? '',
      durationMinutes: Math.min(30, first?.maxDurationMinutes ?? 30),
      readOnly: first?.key !== 'support.impersonation.write' && first?.key !== 'security.break_glass',
    });
    setValidation('');
    requestDialog.current?.showModal();
  };

  const selectPolicy = (policyKey: string) => {
    const policy = policies.find((item) => item.key === policyKey);
    setRequestForm({
      ...requestForm,
      policyKey,
      organizationId: policy?.organizationRequired ? requestForm.organizationId : '',
      productId: policy?.productRequired ? requestForm.productId : '',
      durationMinutes: Math.min(requestForm.durationMinutes || 30, policy?.maxDurationMinutes ?? 30),
      readOnly: policyKey !== 'support.impersonation.write' && policyKey !== 'security.break_glass',
    });
  };

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    const policy = selectedPolicy;
    if (!policy) {
      setValidation('Выберите политику согласования.');
      return;
    }
    if (policy.organizationRequired && !requestForm.organizationId) {
      setValidation('Для этой политики необходимо выбрать компанию.');
      return;
    }
    if (policy.productRequired && !requestForm.productId) {
      setValidation('Для этой политики необходимо выбрать продукт.');
      return;
    }
    if (requestForm.reason.trim().length < 10) {
      setValidation('Причина должна содержать минимум 10 символов.');
      return;
    }
    if (requestForm.durationMinutes < 5 || requestForm.durationMinutes > policy.maxDurationMinutes) {
      setValidation(`Допустимая длительность: от 5 до ${policy.maxDurationMinutes} минут.`);
      return;
    }

    let requestedPayload: Json;
    try {
      if (isPrivilegedSessionPolicy(policy.key)) {
        requestedPayload = {
          readOnly: requestForm.readOnly,
          targetUserId: requestForm.targetUserId || null,
          scope: splitScope(requestForm.scopeText),
        };
      } else {
        requestedPayload = parseJson(requestForm.payloadText);
      }
    } catch {
      setValidation('Payload должен быть корректным JSON.');
      return;
    }

    const input: RequestSecurityApprovalInput = {
      policyKey: policy.key,
      reason: requestForm.reason.trim(),
      organizationId: requestForm.organizationId || null,
      productId: requestForm.productId || null,
      resourceType: requestForm.resourceType.trim() || null,
      resourceId: requestForm.resourceId.trim() || null,
      requestedDurationMinutes: requestForm.durationMinutes,
      requestedPayload,
      idempotencyKey: `ui:${policy.key}:${Date.now()}`,
    };

    if (await requestApproval(input)) requestDialog.current?.close();
  };

  const openDecision = (request: SecurityApprovalRequest, nextDecision: ApprovalDecision) => {
    setSelectedRequestId(request.id);
    setDecision(nextDecision);
    setDecisionNote('');
    setValidation('');
    decisionDialog.current?.showModal();
  };

  const submitDecision = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedRequest) return;
    if (decisionNote.trim().length < 5) {
      setValidation('Комментарий должен содержать минимум 5 символов.');
      return;
    }
    if (await decideApproval(selectedRequest.id, decision, decisionNote.trim())) decisionDialog.current?.close();
  };

  const openRequestDetails = (request: SecurityApprovalRequest) => {
    setSelectedRequestId(request.id);
    requestDetailsDialog.current?.showModal();
  };

  const openSessionDetails = (session: PrivilegedSession) => {
    setSelectedSessionId(session.id);
    sessionDetailsDialog.current?.showModal();
  };

  const cancelPendingRequest = async (request: SecurityApprovalRequest) => {
    const reason = window.prompt(`Причина отмены заявки «${request.policyTitle}»:`);
    if (!reason?.trim()) return;
    await cancelApproval(request.id, reason.trim());
  };

  const endActiveSession = async (session: PrivilegedSession) => {
    const reason = window.prompt(`Причина завершения сессии ${session.id}:`);
    if (!reason?.trim()) return;
    await endSession(session.id, reason.trim());
  };

  const revokeOpenSession = async (session: PrivilegedSession) => {
    const reason = window.prompt(`Причина немедленного отзыва сессии ${session.id}:`);
    if (!reason?.trim()) return;
    await revokeSession(session.id, reason.trim());
  };

  const canReviewRequest = (request: SecurityApprovalRequest) => {
    if (!canReview || request.status !== 'pending' || request.requestedBy === currentUserId || !role) return false;
    const policy = policies.find((item) => item.key === request.policyKey);
    return Boolean(policy?.approverRoles.includes(role) && !request.decisions.some((item) => item.reviewerUserId === currentUserId));
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Security Control Plane</span>
          <h1>Security Approval Center</h1>
          <p>Four-eyes согласования, MFA, support impersonation, break-glass, привилегированные сессии и audit integrity.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить</button>
          {canManageSessions && <button className="secondary-button compact" type="button" onClick={() => void expireControls()} disabled={saving}><TimerReset size={16} /> Закрыть истёкшие</button>}
          {canRequest && <button className="primary-button" type="button" onClick={openRequest} disabled={!requestablePolicies.length}><Plus size={17} /> Новая заявка</button>}
        </div>
      </div>

      {isDemo && <div className="mode-banner"><ShieldCheck size={18} /><div><strong>Демо-режим Security Center</strong><span>Заявки и сессии сохраняются в браузере. Production использует RLS, AAL2 и guarded PostgreSQL RPC.</span></div></div>}
      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span></div>}

      <section className="metrics security-metrics">
        <article className="metric-card"><div className="metric-icon"><FileCheck2 size={21} /></div><div><span>Ожидают решения</span><strong>{metrics.pending}</strong><small>approval requests</small></div></article>
        <article className="metric-card"><div className="metric-icon danger-icon"><ShieldAlert size={21} /></div><div><span>Критические</span><strong>{metrics.critical}</strong><small>требуют приоритета</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Activity size={21} /></div><div><span>Активные сессии</span><strong>{metrics.activeSessions}</strong><small>time-boxed access</small></div></article>
        <article className="metric-card"><div className="metric-icon"><BellRing size={21} /></div><div><span>Уведомления</span><strong>{metrics.notificationQueue}</strong><small>pending или failed</small></div></article>
      </section>

      <div className="section-tabs security-tabs">
        <button className={tab === 'approvals' ? 'active' : ''} type="button" onClick={() => setTab('approvals')}><FileCheck2 size={16} /> Согласования <span>{requests.length}</span></button>
        <button className={tab === 'sessions' ? 'active' : ''} type="button" onClick={() => setTab('sessions')}><KeyRound size={16} /> Привилегированные сессии <span>{sessions.length}</span></button>
        <button className={tab === 'policies' ? 'active' : ''} type="button" onClick={() => setTab('policies')}><ShieldCheck size={16} /> Политики <span>{policies.length}</span></button>
        <button className={tab === 'audit' ? 'active' : ''} type="button" onClick={() => setTab('audit')}><Fingerprint size={16} /> Audit integrity <span>{auditEvents.length}</span></button>
      </div>

      {tab === 'approvals' && <section className="panel security-panel">
        <div className="security-toolbar">
          <div className="search registry-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Политика, инициатор, компания, продукт или причина..." /></div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ApprovalRequestStatus)}><option value="all">Все статусы</option>{Object.entries(approvalStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as 'all' | ApprovalRiskLevel)}><option value="all">Все риски</option>{Object.entries(riskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <span>Найдено: {filteredRequests.length}</span>
        </div>

        {loading ? <div className="inline-loading"><LoaderCircle className="spin" size={27} /><span>Загрузка очереди согласований...</span></div> : filteredRequests.length === 0 ? <div className="inline-empty"><FileCheck2 size={30} /><h2>Заявки не найдены</h2><p>Измените фильтры или создайте новую заявку.</p></div> : <div className="approval-list">{filteredRequests.map((request) => <article className={`approval-card risk-${request.riskLevel}`} key={request.id}>
          <div className="approval-card-main">
            <div className="approval-card-heading">
              <div><span className="eyebrow">{request.policyKey}</span><h2>{request.policyTitle}</h2></div>
              <div className="approval-badges"><span className={`status ${riskClass(request.riskLevel)}`}>{riskLabels[request.riskLevel]}</span><span className={`status ${statusClass(request.status)}`}>{approvalStatusLabels[request.status]}</span></div>
            </div>
            <p>{request.reason}</p>
            <div className="approval-facts">
              <span><Users size={14} /><strong>{request.requesterName}</strong><small>{request.requesterRole ? roleLabels[request.requesterRole] : 'Без глобальной роли'}</small></span>
              <span><ShieldCheck size={14} /><strong>{request.organizationName}</strong><small>{request.productName}</small></span>
              <span><Clock3 size={14} /><strong>{request.requestedDurationMinutes ?? '—'} мин.</strong><small>до {formatDateTime(request.expiresAt)}</small></span>
              <span><Fingerprint size={14} /><strong>{shortHash(request.correlationId)}</strong><small>{request.resourceType ?? 'resource'} · {request.resourceId ?? '—'}</small></span>
            </div>
          </div>
          <div className="approval-card-side">
            <ApprovalProgress request={request} />
            <div className="approval-actions">
              <button className="secondary-button compact" type="button" onClick={() => openRequestDetails(request)}><Eye size={15} /> Детали</button>
              {canReviewRequest(request) && <button className="approve-button" type="button" onClick={() => openDecision(request, 'approved')}><CheckCircle2 size={15} /> Одобрить</button>}
              {canReviewRequest(request) && <button className="reject-button" type="button" onClick={() => openDecision(request, 'rejected')}><ShieldX size={15} /> Отклонить</button>}
              {request.status === 'pending' && (request.requestedBy === currentUserId || can('security.sessions.manage')) && <button className="row-button danger-text" type="button" title="Отменить заявку" onClick={() => void cancelPendingRequest(request)}><Ban size={15} /></button>}
            </div>
          </div>
        </article>)}</div>}
      </section>}

      {tab === 'sessions' && <section className="panel security-panel">
        {!canManageSessions && <div className="mode-banner inline-banner"><LockKeyhole size={18} /><div><strong>Ограниченное управление</strong><span>Запустить или завершить свою сессию можно только после одобрения. Отзыв доступен security manager.</span></div></div>}
        {loading ? <div className="inline-loading"><LoaderCircle className="spin" size={27} /><span>Загрузка привилегированных сессий...</span></div> : sessions.length === 0 ? <div className="inline-empty"><KeyRound size={30} /><h2>Сессий нет</h2><p>После полного согласования support или break-glass заявки здесь появится time-boxed session.</p></div> : <div className="session-grid">{sessions.map((session) => <article className={`session-card session-${session.status}`} key={session.id}>
          <div className="session-card-header"><div className="session-icon"><KeyRound size={20} /></div><div><span className="eyebrow">{sessionTypeLabels[session.sessionType]}</span><h2>{session.organizationName}</h2><p>{session.productName}</p></div><span className={`status ${statusClass(session.status)}`}>{sessionStatusLabels[session.status]}</span></div>
          <div className="session-scope"><strong>{session.readOnly ? 'Только чтение' : 'Разрешена запись'}</strong><div>{session.scope.length ? session.scope.map((scope) => <span key={scope}>{scope}</span>) : <em>Scope не указан</em>}</div></div>
          <dl className="session-facts"><div><dt>Исполнитель</dt><dd>{session.actorName}</dd></div><div><dt>Целевой пользователь</dt><dd>{session.targetUserName}</dd></div><div><dt>Начало</dt><dd>{formatDateTime(session.startedAt)}</dd></div><div><dt>Окончание</dt><dd>{formatDateTime(session.expiresAt ?? session.endedAt)}</dd></div><div><dt>Heartbeat</dt><dd>{formatDateTime(session.lastHeartbeatAt)}</dd></div><div><dt>Клиент уведомлён</dt><dd>{session.clientNotifiedAt ? formatDateTime(session.clientNotifiedAt) : 'Нет'}</dd></div></dl>
          <div className="session-actions">
            <button className="secondary-button compact" type="button" onClick={() => openSessionDetails(session)}><Eye size={15} /> События</button>
            {session.clientNotificationRequired && !session.clientNotifiedAt && (canManageSessions || session.actorUserId === currentUserId) && <button className="secondary-button compact" type="button" onClick={() => void markClientNotified(session.id)} disabled={saving}><BellRing size={15} /> Подтвердить уведомление</button>}
            {session.status === 'approved' && (canManageSessions || session.actorUserId === currentUserId) && <button className="approve-button" type="button" onClick={() => void activateSession(session.id)} disabled={saving}><Play size={15} /> Запустить</button>}
            {session.status === 'active' && (canManageSessions || session.actorUserId === currentUserId) && <button className="secondary-button compact" type="button" onClick={() => void heartbeatSession(session.id)} disabled={saving}><Activity size={15} /> Heartbeat</button>}
            {['approved', 'active'].includes(session.status) && (canManageSessions || session.actorUserId === currentUserId) && <button className="secondary-button compact" type="button" onClick={() => void endActiveSession(session)} disabled={saving}><TimerReset size={15} /> Завершить</button>}
            {['approved', 'active'].includes(session.status) && canManageSessions && <button className="reject-button" type="button" onClick={() => void revokeOpenSession(session)} disabled={saving}><Ban size={15} /> Отозвать</button>}
          </div>
        </article>)}</div>}
      </section>}

      {tab === 'policies' && <div className="security-policy-grid">{policies.map((policy) => <article className={`security-policy-card risk-${policy.riskLevel}`} key={policy.key}>
        <div className="policy-heading"><div className="policy-icon"><ShieldCheck size={20} /></div><div><span className="eyebrow">{policy.key}</span><h2>{policy.title}</h2></div><span className={`status ${riskClass(policy.riskLevel)}`}>{riskLabels[policy.riskLevel]}</span></div>
        <p>{policy.description}</p>
        <dl><div><dt>Согласования</dt><dd>{policy.requiredApprovals}</dd></div><div><dt>Макс. длительность</dt><dd>{policy.maxDurationMinutes} мин.</dd></div><div><dt>TTL заявки</dt><dd>{policy.approvalTtlMinutes} мин.</dd></div><div><dt>MFA</dt><dd>{policy.mfaRequired ? 'AAL2 обязательно' : 'Не требуется'}</dd></div></dl>
        <div className="policy-role-block"><strong>Могут запросить</strong><div>{policy.requesterRoles.map((item) => <span key={item}>{roleLabels[item]}</span>)}</div></div>
        <div className="policy-role-block"><strong>Могут согласовать</strong><div>{policy.approverRoles.map((item) => <span key={item}>{roleLabels[item]}</span>)}</div></div>
        <div className="policy-flags">{policy.organizationRequired && <span>Компания обязательна</span>}{policy.productRequired && <span>Продукт обязателен</span>}{policy.clientNotificationRequired && <span>Уведомление клиента</span>}</div>
      </article>)}</div>}

      {tab === 'audit' && <section className="panel security-panel">
        <div className="audit-toolbar">
          <div><span className="eyebrow">Tamper-evident audit</span><h2>Проверка цепочки событий</h2><p>Каждое новое событие содержит sequence number, previous hash и SHA-256 текущего события.</p></div>
          <select value={auditScope} onChange={(event) => setAuditScope(event.target.value)}><option value="">Все scopes</option><option value="platform">Платформа</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select>
          {canVerifyAudit && <button className="primary-button" type="button" onClick={() => void verifyAudit(auditScope || null)} disabled={verifying}>{verifying ? <LoaderCircle className="spin" size={16} /> : <Fingerprint size={16} />}{verifying ? 'Проверка...' : 'Проверить chain'}</button>}
        </div>
        {verification.length > 0 && <div className="audit-verification-grid">{verification.map((result) => <article className={result.is_valid ? 'valid' : 'invalid'} key={result.scope_key}>{result.is_valid ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}<div><strong>{result.scope_key}</strong><span>{result.message}</span><small>Проверено событий: {result.checked_events}{result.first_invalid_sequence ? ` · ошибка на #${result.first_invalid_sequence}` : ''}</small></div></article>)}</div>}
        <div className="table-wrap"><table className="audit-table"><thead><tr><th>Seq</th><th>Событие</th><th>Actor / scope</th><th>Ресурс</th><th>Hash chain</th><th>Время</th></tr></thead><tbody>{auditEvents.map((event) => <tr key={event.id}><td><strong>#{event.sequenceNumber ?? '—'}</strong><span>v{event.integrityVersion}</span></td><td><strong>{event.action}</strong><span>{event.reason}</span></td><td><strong>{event.actorName}</strong><span>{event.organizationName} · {event.scopeKey}</span></td><td><strong>{event.resourceType}</strong><span>{event.resourceId ?? '—'}</span></td><td><code>{shortHash(event.hash)}</code><span>prev {shortHash(event.previousHash)}</span></td><td>{formatDateTime(event.occurredAt)}</td></tr>)}</tbody></table></div>
        {!loading && auditEvents.length === 0 && <div className="inline-empty"><Fingerprint size={30} /><h2>Audit events отсутствуют</h2><p>События появятся после административных действий.</p></div>}
      </section>}

      <dialog ref={requestDialog} className="modal wide-modal" onCancel={() => requestDialog.current?.close()}>
        <form onSubmit={submitRequest}>
          <div className="modal-header"><div><span className="eyebrow">Four-eyes workflow</span><h2>Новая заявка на согласование</h2><p>Доступ не выдаётся до получения всех решений, проверки MFA и создания time-boxed session.</p></div><button className="icon-button" type="button" onClick={() => requestDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-section"><h3>Политика и область действия</h3><div className="form-grid">
            <label className="span-2"><span>Политика *</span><select required value={requestForm.policyKey} onChange={(event) => selectPolicy(event.target.value)}><option value="">Выберите политику</option>{requestablePolicies.map((policy) => <option key={policy.key} value={policy.key}>{policy.title} · {riskLabels[policy.riskLevel]} · {policy.requiredApprovals} соглас.</option>)}</select></label>
            <label><span>Компания{selectedPolicy?.organizationRequired ? ' *' : ''}</span><select required={selectedPolicy?.organizationRequired} value={requestForm.organizationId} onChange={(event) => setRequestForm({ ...requestForm, organizationId: event.target.value })}><option value="">Не выбрана</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
            <label><span>Продукт{selectedPolicy?.productRequired ? ' *' : ''}</span><select required={selectedPolicy?.productRequired} value={requestForm.productId} onChange={(event) => setRequestForm({ ...requestForm, productId: event.target.value })}><option value="">Не выбран / все продукты</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
            <label><span>Тип ресурса</span><input value={requestForm.resourceType} onChange={(event) => setRequestForm({ ...requestForm, resourceType: event.target.value })} placeholder="tenant, incident, license" /></label>
            <label><span>ID ресурса</span><input value={requestForm.resourceId} onChange={(event) => setRequestForm({ ...requestForm, resourceId: event.target.value })} placeholder="INC-2026-001 или UUID" /></label>
            <label><span>Длительность, минут *</span><input type="number" min="5" max={selectedPolicy?.maxDurationMinutes ?? 1440} value={requestForm.durationMinutes} onChange={(event) => setRequestForm({ ...requestForm, durationMinutes: Number(event.target.value) })} /></label>
            <label><span>Максимум политики</span><input value={selectedPolicy ? `${selectedPolicy.maxDurationMinutes} минут` : '—'} disabled /></label>
            <label className="span-2"><span>Причина *</span><textarea rows={3} required value={requestForm.reason} onChange={(event) => setRequestForm({ ...requestForm, reason: event.target.value })} placeholder="Инцидент, номер обращения, ожидаемый результат и обоснование доступа" /></label>
          </div></div>
          {selectedPolicy && isPrivilegedSessionPolicy(selectedPolicy.key) && <div className="form-section"><h3>Параметры привилегированной сессии</h3><div className="form-grid">
            <label><span>Целевой пользователь</span><select value={requestForm.targetUserId} onChange={(event) => setRequestForm({ ...requestForm, targetUserId: event.target.value })}><option value="">Не указан</option>{users.filter((user) => user.isActive).map((user) => <option key={user.id} value={user.id}>{user.fullName || user.email}</option>)}</select></label>
            <label className="checkbox-field"><input type="checkbox" checked={requestForm.readOnly} onChange={(event) => setRequestForm({ ...requestForm, readOnly: event.target.checked })} /><span>Только чтение</span></label>
            <label className="span-2"><span>Scopes</span><textarea rows={3} value={requestForm.scopeText} onChange={(event) => setRequestForm({ ...requestForm, scopeText: event.target.value })} placeholder={'crm.deals.read\ncrm.logs.read'} /></label>
          </div></div>}
          {selectedPolicy && !isPrivilegedSessionPolicy(selectedPolicy.key) && <div className="form-section"><h3>Payload действия</h3><label className="json-field"><span>JSON payload</span><textarea rows={6} value={requestForm.payloadText} onChange={(event) => setRequestForm({ ...requestForm, payloadText: event.target.value })} /></label></div>}
          {selectedPolicy && <div className="approval-policy-summary"><ShieldCheck size={18} /><div><strong>{selectedPolicy.requiredApprovals} независимых согласования · MFA {selectedPolicy.mfaRequired ? 'обязательно' : 'не требуется'}</strong><span>{selectedPolicy.clientNotificationRequired ? 'Клиент будет уведомлён о начале и завершении доступа.' : 'Уведомление клиента политикой не требуется.'}</span></div></div>}
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => requestDialog.current?.close()}>Отмена</button><button className="primary-button" type="submit" disabled={saving || !selectedPolicy}>{saving ? <LoaderCircle className="spin" size={17} /> : <FileCheck2 size={17} />}{saving ? 'Создание...' : 'Отправить на согласование'}</button></div>
        </form>
      </dialog>

      <dialog ref={decisionDialog} className="modal" onCancel={() => decisionDialog.current?.close()}>
        {selectedRequest && <form onSubmit={submitDecision}>
          <div className="modal-header"><div><span className="eyebrow">Independent review</span><h2>{decision === 'approved' ? 'Одобрить заявку' : 'Отклонить заявку'}</h2><p>{selectedRequest.policyTitle} · {selectedRequest.organizationName}</p></div><button className="icon-button" type="button" onClick={() => decisionDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className={`decision-warning ${decision}`}>
            {decision === 'approved' ? <UserCheck size={22} /> : <ShieldX size={22} />}
            <div><strong>{decision === 'approved' ? 'Вы подтверждаете необходимость действия' : 'Действие будет остановлено'}</strong><span>Решение записывается в append-only history и не может быть изменено.</span></div>
          </div>
          <label className="json-field"><span>Комментарий решения *</span><textarea rows={4} required value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Проверенные основания, ограничения и номер инцидента" /></label>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => decisionDialog.current?.close()}>Отмена</button><button className={decision === 'approved' ? 'approve-button large' : 'reject-button large'} type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : decision === 'approved' ? <CheckCircle2 size={17} /> : <ShieldX size={17} />}{saving ? 'Сохранение...' : decision === 'approved' ? 'Подтвердить одобрение' : 'Подтвердить отклонение'}</button></div>
        </form>}
      </dialog>

      <dialog ref={requestDetailsDialog} className="modal wide-modal" onCancel={() => requestDetailsDialog.current?.close()}>
        {selectedRequest && <div className="details-dialog">
          <div className="modal-header"><div><span className="eyebrow">{selectedRequest.policyKey}</span><h2>{selectedRequest.policyTitle}</h2><p>{selectedRequest.organizationName} · {selectedRequest.productName}</p></div><button className="icon-button" type="button" onClick={() => requestDetailsDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="detail-facts"><div><span>Статус</span><strong>{approvalStatusLabels[selectedRequest.status]}</strong></div><div><span>Риск</span><strong>{riskLabels[selectedRequest.riskLevel]}</strong></div><div><span>Инициатор</span><strong>{selectedRequest.requesterName}</strong></div><div><span>Согласования</span><strong>{selectedRequest.approvalsReceived}/{selectedRequest.requiredApprovals}</strong></div><div><span>Создана</span><strong>{formatDateTime(selectedRequest.createdAt)}</strong></div><div><span>Истекает</span><strong>{formatDateTime(selectedRequest.expiresAt)}</strong></div></div>
          <div className="detail-section"><h3>Обоснование</h3><p>{selectedRequest.reason}</p></div>
          <div className="detail-section"><h3>Requested payload</h3><pre>{safeJson(selectedRequest.requestedPayload)}</pre></div>
          <div className="detail-section"><h3>Decisions</h3>{selectedRequest.decisions.length ? <div className="decision-history">{selectedRequest.decisions.map((item) => <article key={item.id}>{item.decision === 'approved' ? <CheckCircle2 size={18} /> : <ShieldX size={18} />}<div><strong>{item.reviewerName}</strong><span>{roleLabels[item.reviewerRole]} · {formatDateTime(item.createdAt)}</span><p>{item.note}</p></div></article>)}</div> : <p>Решений пока нет.</p>}</div>
        </div>}
      </dialog>

      <dialog ref={sessionDetailsDialog} className="modal wide-modal" onCancel={() => sessionDetailsDialog.current?.close()}>
        {selectedSession && <div className="details-dialog">
          <div className="modal-header"><div><span className="eyebrow">{sessionTypeLabels[selectedSession.sessionType]}</span><h2>{selectedSession.organizationName}</h2><p>{selectedSession.productName} · {selectedSession.actorName}</p></div><button className="icon-button" type="button" onClick={() => sessionDetailsDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="detail-facts"><div><span>Статус</span><strong>{sessionStatusLabels[selectedSession.status]}</strong></div><div><span>Режим</span><strong>{selectedSession.readOnly ? 'Read-only' : 'Write enabled'}</strong></div><div><span>Длительность</span><strong>{selectedSession.requestedDurationMinutes} мин.</strong></div><div><span>Correlation</span><strong>{shortHash(selectedSession.correlationId)}</strong></div></div>
          <div className="detail-section"><h3>Scope</h3><div className="scope-chips">{selectedSession.scope.map((scope) => <span key={scope}>{scope}</span>)}</div></div>
          <div className="detail-section"><h3>Session events</h3><div className="session-event-timeline">{selectedSession.events.map((item) => <article key={item.id}><span /><div><strong>{item.eventType}</strong><small>{item.actorName} · {formatDateTime(item.createdAt)}</small><pre>{safeJson(item.payload)}</pre></div></article>)}</div></div>
        </div>}
      </dialog>
    </>
  );
}
