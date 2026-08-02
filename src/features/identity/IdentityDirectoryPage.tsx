import {
  BadgeCheck,
  Ban,
  Boxes,
  Building2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Edit3,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  Users,
  X,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import { roleLabels } from '../../core/permissions';
import type { GlobalRole } from '../../lib/database.types';
import { useIdentity } from './IdentityContext';
import type {
  IdentityInvitation,
  IdentityMembership,
  IdentityUser,
  InviteIdentityInput,
  MembershipInput,
  UserAccessInput,
} from './identityRepository';

const globalRoles: GlobalRole[] = [
  'platform_owner',
  'super_admin',
  'support_admin',
  'finance_admin',
  'technical_admin',
  'sales_manager',
  'auditor',
];

const tenantRoles = [
  { key: 'owner', label: 'Владелец' },
  { key: 'admin', label: 'Администратор' },
  { key: 'manager', label: 'Руководитель' },
  { key: 'doctor', label: 'Врач' },
  { key: 'operator', label: 'Оператор' },
  { key: 'accountant', label: 'Бухгалтер' },
  { key: 'marketer', label: 'Маркетолог' },
  { key: 'viewer', label: 'Наблюдатель' },
];

const invitationLabels: Record<IdentityInvitation['status'], string> = {
  pending: 'Создаётся',
  sent: 'Отправлено',
  accepted: 'Принято',
  expired: 'Истекло',
  cancelled: 'Отменено',
  failed: 'Ошибка',
};

const emptyInvite: InviteIdentityInput = {
  email: '',
  fullName: '',
  globalRole: null,
  organizationId: null,
  branchId: null,
  membershipRoleKey: null,
  productScopes: [],
  redirectTo: null,
  expiresInHours: 168,
};

const emptyUserAccess: UserAccessInput = {
  userId: '',
  fullName: '',
  globalRole: null,
  mfaEnforced: false,
  isActive: true,
  reason: '',
};

const emptyMembership: MembershipInput = {
  userId: '',
  organizationId: '',
  branchId: null,
  roleKey: 'viewer',
  productScopes: [],
  isActive: true,
  reason: '',
};

function formatDate(value: string | null) {
  if (!value) return 'Никогда';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function invitationStatusClass(status: IdentityInvitation['status']) {
  if (status === 'accepted') return 'ok';
  if (status === 'sent' || status === 'pending') return 'info';
  if (status === 'failed' || status === 'expired') return 'warn';
  return 'muted';
}

function initials(user: Pick<IdentityUser, 'fullName' | 'email'>) {
  const value = user.fullName.trim() || user.email;
  const parts = value.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2)).toUpperCase();
}

function roleName(role: GlobalRole | null) {
  return role ? roleLabels[role] : 'Пользователь компании';
}

function membershipLabel(membership: IdentityMembership) {
  return tenantRoles.find((role) => role.key === membership.roleKey)?.label ?? membership.roleKey;
}

export function IdentityDirectoryPage() {
  const { can, isDemo, role: currentRole } = useAuth();
  const {
    users,
    invitations,
    organizations,
    branches,
    products,
    loading,
    saving,
    error,
    refresh,
    inviteUser,
    cancelInvitation,
    updateUser,
    saveMembership,
  } = useIdentity();
  const inviteDialog = useRef<HTMLDialogElement | null>(null);
  const userDialog = useRef<HTMLDialogElement | null>(null);
  const membershipDialog = useRef<HTMLDialogElement | null>(null);
  const [tab, setTab] = useState<'users' | 'invitations' | 'roles'>('users');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [inviteForm, setInviteForm] = useState<InviteIdentityInput>(emptyInvite);
  const [userForm, setUserForm] = useState<UserAccessInput>(emptyUserAccess);
  const [membershipForm, setMembershipForm] = useState<MembershipInput>(emptyMembership);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [validation, setValidation] = useState('');
  const canManage = can('users.manage');

  const selectedUser = selectedUserId ? users.find((user) => user.id === selectedUserId) ?? null : null;

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      if (statusFilter === 'active' && !user.isActive) return false;
      if (statusFilter === 'inactive' && user.isActive) return false;
      if (!normalized) return true;
      return [
        user.fullName,
        user.email,
        roleName(user.globalRole),
        ...user.memberships.flatMap((membership) => [membership.organizationName, membership.branchName, membership.roleKey]),
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [query, statusFilter, users]);

  const metrics = useMemo(() => ({
    total: users.length,
    active: users.filter((user) => user.isActive).length,
    mfa: users.filter((user) => user.mfaEnforced).length,
    pending: invitations.filter((invitation) => ['pending', 'sent'].includes(invitation.status)).length,
  }), [invitations, users]);

  const openInvite = () => {
    setInviteForm(emptyInvite);
    setValidation('');
    inviteDialog.current?.showModal();
  };

  const setInviteOrganization = (organizationId: string) => {
    setInviteForm({
      ...inviteForm,
      organizationId: organizationId || null,
      branchId: null,
      membershipRoleKey: organizationId ? inviteForm.membershipRoleKey ?? 'viewer' : null,
      productScopes: organizationId ? inviteForm.productScopes : [],
    });
  };

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    const normalized: InviteIdentityInput = {
      ...inviteForm,
      email: inviteForm.email.trim().toLowerCase(),
      fullName: inviteForm.fullName.trim(),
      membershipRoleKey: inviteForm.organizationId ? inviteForm.membershipRoleKey : null,
      branchId: inviteForm.organizationId ? inviteForm.branchId : null,
      productScopes: inviteForm.organizationId ? inviteForm.productScopes : [],
    };

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
      setValidation('Укажите корректный email.');
      return;
    }
    if (!normalized.globalRole && !normalized.organizationId) {
      setValidation('Назначьте глобальную роль либо доступ к компании.');
      return;
    }
    if (normalized.organizationId && !normalized.membershipRoleKey) {
      setValidation('Выберите роль внутри компании.');
      return;
    }
    if (normalized.organizationId && normalized.productScopes.length === 0) {
      setValidation('Выберите минимум один продукт для доступа.');
      return;
    }
    if (normalized.expiresInHours < 1 || normalized.expiresInHours > 720) {
      setValidation('Срок приглашения должен быть от 1 до 720 часов.');
      return;
    }
    if (['platform_owner', 'super_admin'].includes(normalized.globalRole ?? '') && currentRole !== 'platform_owner') {
      setValidation('Только platform_owner может выдавать роль platform_owner или super_admin.');
      return;
    }

    if (await inviteUser(normalized)) inviteDialog.current?.close();
  };

  const openUser = (user: IdentityUser) => {
    setSelectedUserId(user.id);
    setUserForm({
      userId: user.id,
      fullName: user.fullName,
      globalRole: user.globalRole,
      mfaEnforced: user.mfaEnforced,
      isActive: user.isActive,
      reason: '',
    });
    setValidation('');
    userDialog.current?.showModal();
  };

  const submitUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!userForm.fullName.trim()) {
      setValidation('Укажите имя пользователя.');
      return;
    }
    if (userForm.reason.trim().length < 5) {
      setValidation('Укажите причину изменения минимум из 5 символов.');
      return;
    }
    if (['platform_owner', 'super_admin'].includes(userForm.globalRole ?? '') && currentRole !== 'platform_owner') {
      setValidation('Только platform_owner может назначать эту глобальную роль.');
      return;
    }

    if (await updateUser({ ...userForm, fullName: userForm.fullName.trim(), reason: userForm.reason.trim() })) {
      userDialog.current?.close();
    }
  };

  const openMembership = (user: IdentityUser, existing?: IdentityMembership) => {
    const firstOrganization = organizations[0]?.id ?? '';
    setSelectedUserId(user.id);
    setMembershipForm(existing ? {
      userId: user.id,
      organizationId: existing.organizationId,
      branchId: existing.branchId,
      roleKey: existing.roleKey,
      productScopes: existing.productScopes,
      isActive: existing.isActive,
      reason: '',
    } : {
      ...emptyMembership,
      userId: user.id,
      organizationId: firstOrganization,
    });
    setValidation('');
    membershipDialog.current?.showModal();
  };

  const setMembershipOrganization = (organizationId: string) => {
    setMembershipForm({ ...membershipForm, organizationId, branchId: null });
  };

  const submitMembership = async (event: FormEvent) => {
    event.preventDefault();
    if (!membershipForm.organizationId) {
      setValidation('Выберите компанию.');
      return;
    }
    if (!membershipForm.roleKey) {
      setValidation('Выберите роль внутри компании.');
      return;
    }
    if (membershipForm.productScopes.length === 0) {
      setValidation('Выберите минимум один продукт.');
      return;
    }
    if (membershipForm.reason.trim().length < 5) {
      setValidation('Укажите причину изменения минимум из 5 символов.');
      return;
    }

    if (await saveMembership({ ...membershipForm, reason: membershipForm.reason.trim() })) {
      membershipDialog.current?.close();
    }
  };

  const toggleInviteProduct = (productKey: string) => {
    setInviteForm({
      ...inviteForm,
      productScopes: inviteForm.productScopes.includes(productKey)
        ? inviteForm.productScopes.filter((key) => key !== productKey)
        : [...inviteForm.productScopes, productKey],
    });
  };

  const toggleMembershipProduct = (productKey: string) => {
    setMembershipForm({
      ...membershipForm,
      productScopes: membershipForm.productScopes.includes(productKey)
        ? membershipForm.productScopes.filter((key) => key !== productKey)
        : [...membershipForm.productScopes, productKey],
    });
  };

  const cancelOpenInvitation = async (invitation: IdentityInvitation) => {
    const reason = window.prompt(`Причина отмены приглашения для ${invitation.email}:`);
    if (!reason?.trim()) return;
    await cancelInvitation(invitation.id, reason.trim());
  };

  const availableBranches = branches.filter((branch) => branch.organizationId === inviteForm.organizationId);
  const membershipBranches = branches.filter((branch) => branch.organizationId === membershipForm.organizationId);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Identity & Access Management</span>
          <h1>Identity Directory</h1>
          <p>Глобальные роли, MFA, приглашения, компании, филиалы и продуктовые scopes.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить</button>
          {canManage && <button className="primary-button" type="button" onClick={openInvite}><UserPlus size={17} /> Пригласить пользователя</button>}
        </div>
      </div>

      {isDemo && <div className="mode-banner"><ShieldCheck size={18} /><div><strong>Демо-режим Identity Directory</strong><span>Данные сохраняются в браузере. В production приглашение отправляет защищённая Edge Function с service-role доступом.</span></div></div>}
      {!canManage && <div className="mode-banner"><Users size={18} /><div><strong>Режим просмотра</strong><span>Текущая роль видит пользователей и memberships, но не может изменять доступ.</span></div></div>}
      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span></div>}

      <section className="metrics identity-metrics">
        <article className="metric-card"><div className="metric-icon"><Users size={21} /></div><div><span>Пользователи</span><strong>{metrics.total}</strong><small>платформа и клиенты</small></div></article>
        <article className="metric-card"><div className="metric-icon"><UserRoundCheck size={21} /></div><div><span>Активны</span><strong>{metrics.active}</strong><small>{metrics.total - metrics.active} отключены</small></div></article>
        <article className="metric-card"><div className="metric-icon"><LockKeyhole size={21} /></div><div><span>MFA обязательно</span><strong>{metrics.mfa}</strong><small>для административных ролей</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Mail size={21} /></div><div><span>Ожидают входа</span><strong>{metrics.pending}</strong><small>открытые приглашения</small></div></article>
      </section>

      <div className="section-tabs identity-tabs">
        <button className={tab === 'users' ? 'active' : ''} type="button" onClick={() => setTab('users')}><Users size={16} /> Пользователи <span>{users.length}</span></button>
        <button className={tab === 'invitations' ? 'active' : ''} type="button" onClick={() => setTab('invitations')}><Mail size={16} /> Приглашения <span>{invitations.length}</span></button>
        <button className={tab === 'roles' ? 'active' : ''} type="button" onClick={() => setTab('roles')}><ShieldCheck size={16} /> Роли <span>{globalRoles.length}</span></button>
      </div>

      {tab === 'users' && <section className="panel identity-panel">
        <div className="identity-toolbar">
          <div className="search registry-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, email, роль, компания или филиал..." /></div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')}><option value="all">Все пользователи</option><option value="active">Только активные</option><option value="inactive">Только отключённые</option></select>
          <span>Найдено: {filteredUsers.length}</span>
        </div>
        {loading ? <div className="inline-loading"><LoaderCircle className="spin" size={27} /><span>Загрузка пользователей...</span></div> : filteredUsers.length === 0 ? <div className="inline-empty"><Users size={30} /><h2>Пользователи не найдены</h2><p>Измените фильтры или отправьте приглашение.</p></div> : <div className="identity-user-grid">{filteredUsers.map((user) => <article className={`identity-user-card ${!user.isActive ? 'inactive' : ''}`} key={user.id}>
          <div className="identity-user-header"><div className="identity-avatar">{initials(user)}</div><div><strong>{user.fullName || user.email}</strong><span>{user.email}</span></div><span className={`status ${user.isActive ? 'ok' : 'muted'}`}>{user.isActive ? 'Активен' : 'Отключён'}</span></div>
          <div className="identity-role-line"><ShieldCheck size={15} /><strong>{roleName(user.globalRole)}</strong>{user.mfaEnforced && <span><LockKeyhole size={12} /> MFA</span>}</div>
          <div className="identity-last-seen"><Clock3 size={13} /> Последняя активность: {formatDate(user.lastSeenAt)}</div>
          <div className="membership-summary">{user.memberships.length ? user.memberships.slice(0, 3).map((membership) => <button key={membership.id} type="button" onClick={() => canManage && openMembership(user, membership)}><Building2 size={13} /><span><strong>{membership.organizationName}</strong><small>{membership.branchName} · {membershipLabel(membership)} · {membership.productScopes.length} продуктов</small></span><ChevronRight size={13} /></button>) : <div className="no-membership"><Building2 size={14} /> Нет привязки к компании</div>}{user.memberships.length > 3 && <small>Ещё memberships: {user.memberships.length - 3}</small>}</div>
          <div className="identity-card-actions">{canManage && <button className="secondary-button" type="button" onClick={() => openUser(user)}><Edit3 size={15} /> Настроить доступ</button>}{canManage && <button className="secondary-button" type="button" onClick={() => openMembership(user)}><Plus size={15} /> Membership</button>}</div>
        </article>)}</div>}
      </section>}

      {tab === 'invitations' && <section className="panel identity-panel">
        <div className="table-wrap identity-table-wrap"><table className="identity-table"><thead><tr><th>Пользователь</th><th>Доступ</th><th>Компания / филиал</th><th>Продукты</th><th>Статус</th><th>Срок</th><th /></tr></thead><tbody>{invitations.map((invitation) => <tr key={invitation.id}>
          <td><strong>{invitation.fullName || invitation.email}</strong><span>{invitation.email}</span></td>
          <td>{roleName(invitation.globalRole)}{invitation.membershipRoleKey && <span>{tenantRoles.find((role) => role.key === invitation.membershipRoleKey)?.label ?? invitation.membershipRoleKey}</span>}</td>
          <td><strong>{invitation.organizationName}</strong><span>{invitation.branchName}</span></td>
          <td><div className="scope-chips">{invitation.productScopes.length ? invitation.productScopes.map((scope) => <span key={scope}>{products.find((product) => product.key === scope)?.name ?? scope}</span>) : <em>—</em>}</div></td>
          <td><span className={`status ${invitationStatusClass(invitation.status)}`}>{invitationLabels[invitation.status]}</span>{invitation.lastError && <span className="invitation-error">{invitation.lastError}</span>}</td>
          <td><span className="invitation-expiry">{formatDate(invitation.expiresAt)}</span></td>
          <td>{canManage && ['pending', 'sent', 'failed'].includes(invitation.status) && <button className="row-button danger-text" type="button" title="Отменить приглашение" onClick={() => void cancelOpenInvitation(invitation)}><Ban size={15} /></button>}</td>
        </tr>)}</tbody></table></div>
        {!loading && invitations.length === 0 && <div className="inline-empty"><Mail size={30} /><h2>Приглашений нет</h2><p>Новые пользователи появятся здесь после отправки приглашения.</p></div>}
      </section>}

      {tab === 'roles' && <div className="role-catalog-grid">{globalRoles.map((role) => <article key={role}><div className="role-icon"><BadgeCheck size={20} /></div><span className="eyebrow">{role}</span><h2>{roleLabels[role]}</h2><p>{role === 'platform_owner' ? 'Полный контроль платформы, критических ролей и системных настроек.' : role === 'super_admin' ? 'Управление компаниями, продуктами, пользователями и операционными процессами.' : role === 'support_admin' ? 'Поддержка клиентов, memberships и диагностический доступ без финансового контроля.' : role === 'finance_admin' ? 'Тарифы, подписки, платежи, лицензии и коммерческие условия.' : role === 'technical_admin' ? 'Интеграции, adapters, deployments, incidents и provisioning.' : role === 'sales_manager' ? 'Лиды, onboarding, демонстрации и коммерческие предложения.' : 'Только чтение аудита, конфигурации и истории действий.'}</p></article>)}</div>}

      <dialog ref={inviteDialog} className="modal wide-modal" onCancel={() => inviteDialog.current?.close()}>
        <form onSubmit={submitInvite}>
          <div className="modal-header"><div><span className="eyebrow">Secure Invitation</span><h2>Пригласить пользователя</h2><p>Auth-приглашение отправляется серверной Edge Function. Service role не попадает в браузер.</p></div><button className="icon-button" type="button" onClick={() => inviteDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-section"><h3>Профиль и глобальный доступ</h3><div className="form-grid">
            <label><span>Email *</span><input type="email" required value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} /></label>
            <label><span>Имя</span><input value={inviteForm.fullName} onChange={(event) => setInviteForm({ ...inviteForm, fullName: event.target.value })} /></label>
            <label><span>Глобальная роль</span><select value={inviteForm.globalRole ?? ''} onChange={(event) => setInviteForm({ ...inviteForm, globalRole: event.target.value ? event.target.value as GlobalRole : null })}><option value="">Без глобальной роли</option>{globalRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
            <label><span>Срок приглашения, часов</span><input type="number" min="1" max="720" value={inviteForm.expiresInHours} onChange={(event) => setInviteForm({ ...inviteForm, expiresInHours: Number(event.target.value) })} /></label>
          </div></div>
          <div className="form-section"><h3>Доступ к компании</h3><div className="form-grid">
            <label><span>Компания</span><select value={inviteForm.organizationId ?? ''} onChange={(event) => setInviteOrganization(event.target.value)}><option value="">Без привязки к компании</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
            <label><span>Филиал</span><select disabled={!inviteForm.organizationId} value={inviteForm.branchId ?? ''} onChange={(event) => setInviteForm({ ...inviteForm, branchId: event.target.value || null })}><option value="">Все филиалы</option>{availableBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.city ? ` · ${branch.city}` : ''}</option>)}</select></label>
            <label><span>Роль в компании</span><select disabled={!inviteForm.organizationId} value={inviteForm.membershipRoleKey ?? ''} onChange={(event) => setInviteForm({ ...inviteForm, membershipRoleKey: event.target.value || null })}><option value="">Выберите роль</option>{tenantRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}</select></label>
            <label><span>Redirect URL</span><input value={inviteForm.redirectTo ?? ''} onChange={(event) => setInviteForm({ ...inviteForm, redirectTo: event.target.value || null })} placeholder="По умолчанию из Edge Function" /></label>
          </div>{inviteForm.organizationId && <div className="product-selector-grid identity-product-selector">{products.map((product) => <label key={product.key}><input type="checkbox" checked={inviteForm.productScopes.includes(product.key)} onChange={() => toggleInviteProduct(product.key)} /><span><strong>{product.name}</strong><small>{product.key}</small></span></label>)}</div>}</div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => inviteDialog.current?.close()}>Отмена</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}{saving ? 'Отправка...' : 'Отправить приглашение'}</button></div>
        </form>
      </dialog>

      <dialog ref={userDialog} className="modal wide-modal" onCancel={() => userDialog.current?.close()}>
        {selectedUser && <form onSubmit={submitUser}>
          <div className="modal-header"><div><span className="eyebrow">Global Access</span><h2>{selectedUser.fullName || selectedUser.email}</h2><p>{selectedUser.email}</p></div><button className="icon-button" type="button" onClick={() => userDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-grid">
            <label><span>Имя *</span><input required value={userForm.fullName} onChange={(event) => setUserForm({ ...userForm, fullName: event.target.value })} /></label>
            <label><span>Глобальная роль</span><select value={userForm.globalRole ?? ''} onChange={(event) => setUserForm({ ...userForm, globalRole: event.target.value ? event.target.value as GlobalRole : null })}><option value="">Без глобальной роли</option>{globalRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
            <label className="checkbox-field"><input type="checkbox" checked={userForm.mfaEnforced} onChange={(event) => setUserForm({ ...userForm, mfaEnforced: event.target.checked })} /><span>MFA обязательно</span></label>
            <label className="checkbox-field"><input type="checkbox" checked={userForm.isActive} onChange={(event) => setUserForm({ ...userForm, isActive: event.target.checked })} /><span>Пользователь активен</span></label>
            <label className="span-2"><span>Причина изменения *</span><input required value={userForm.reason} onChange={(event) => setUserForm({ ...userForm, reason: event.target.value })} placeholder="Изменение роли по решению владельца платформы" /></label>
          </div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => userDialog.current?.close()}>Отмена</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Edit3 size={17} />}{saving ? 'Сохранение...' : 'Сохранить доступ'}</button></div>
        </form>}
      </dialog>

      <dialog ref={membershipDialog} className="modal wide-modal" onCancel={() => membershipDialog.current?.close()}>
        {selectedUser && <form onSubmit={submitMembership}>
          <div className="modal-header"><div><span className="eyebrow">Tenant Membership</span><h2>Доступ к компании</h2><p>{selectedUser.fullName || selectedUser.email}</p></div><button className="icon-button" type="button" onClick={() => membershipDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-grid">
            <label><span>Компания *</span><select required value={membershipForm.organizationId} onChange={(event) => setMembershipOrganization(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
            <label><span>Филиал</span><select value={membershipForm.branchId ?? ''} onChange={(event) => setMembershipForm({ ...membershipForm, branchId: event.target.value || null })}><option value="">Все филиалы</option>{membershipBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.city ? ` · ${branch.city}` : ''}</option>)}</select></label>
            <label><span>Роль *</span><select value={membershipForm.roleKey} onChange={(event) => setMembershipForm({ ...membershipForm, roleKey: event.target.value })}>{tenantRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}</select></label>
            <label className="checkbox-field"><input type="checkbox" checked={membershipForm.isActive} onChange={(event) => setMembershipForm({ ...membershipForm, isActive: event.target.checked })} /><span>Membership активен</span></label>
            <label className="span-2"><span>Причина изменения *</span><input required value={membershipForm.reason} onChange={(event) => setMembershipForm({ ...membershipForm, reason: event.target.value })} placeholder="Назначение доступа к продуктам компании" /></label>
          </div>
          <div className="form-section"><h3>Product scopes</h3><div className="product-selector-grid identity-product-selector">{products.map((product) => <label key={product.key}><input type="checkbox" checked={membershipForm.productScopes.includes(product.key)} onChange={() => toggleMembershipProduct(product.key)} /><span><strong>{product.name}</strong><small>{product.key}</small></span></label>)}</div></div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => membershipDialog.current?.close()}>Отмена</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}{saving ? 'Сохранение...' : 'Сохранить membership'}</button></div>
        </form>}
      </dialog>
    </>
  );
}
