import {
  Archive,
  Building2,
  ChevronRight,
  CircleAlert,
  Edit3,
  GitBranch,
  Landmark,
  LoaderCircle,
  Mail,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import type { OrganizationStatus } from '../../lib/database.types';
import type { CreateOrganizationInput, Organization } from './organizationRepository';
import { useOrganizations } from './useOrganizations';

const statusOptions: Array<{ value: OrganizationStatus; label: string }> = [
  { value: 'lead', label: 'Лид' },
  { value: 'demo', label: 'Демо' },
  { value: 'onboarding', label: 'Внедрение' },
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Активна' },
  { value: 'past_due', label: 'Просрочка' },
  { value: 'grace_period', label: 'Grace period' },
  { value: 'suspended', label: 'Приостановлена' },
  { value: 'archived', label: 'Архив' },
];

const createInitial: CreateOrganizationInput = {
  name: '',
  slug: '',
  city: '',
  ownerName: '',
  ownerEmail: '',
  legalEntityName: '',
  bin: '',
  branchName: 'Главный филиал',
  branchAddress: '',
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

function getStatusLabel(status: OrganizationStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

function OrganizationStatusBadge({ status }: { status: OrganizationStatus }) {
  const className = status === 'active'
    ? 'ok'
    : ['past_due', 'grace_period', 'suspended'].includes(status)
      ? 'danger'
      : status === 'archived'
        ? 'muted'
        : 'warn';
  return <span className={`status organization-status ${className}`}>{getStatusLabel(status)}</span>;
}

function HealthBar({ value }: { value: number }) {
  const state = value >= 80 ? 'healthy' : value >= 60 ? 'attention' : 'critical';
  return (
    <div className={`health health-${state}`}>
      <div><span style={{ width: `${value}%` }} /></div>
      <b>{value}%</b>
    </div>
  );
}

export function CompaniesPage() {
  const { can, isDemo } = useAuth();
  const {
    organizations,
    loading,
    saving,
    error,
    refresh,
    createOrganization,
    updateOrganization,
    archiveOrganization,
    restoreOrganization,
  } = useOrganizations();
  const createDialog = useRef<HTMLDialogElement>(null);
  const editDialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrganizationStatus>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [createForm, setCreateForm] = useState<CreateOrganizationInput>(createInitial);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [validation, setValidation] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return organizations.filter((organization) => {
      if (!showArchived && organization.status === 'archived') return false;
      if (statusFilter !== 'all' && organization.status !== statusFilter) return false;
      if (!query) return true;
      return [organization.name, organization.slug, organization.primaryBin, organization.city, organization.ownerEmail]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [organizations, search, showArchived, statusFilter]);

  const metrics = useMemo(() => ({
    active: organizations.filter((organization) => organization.status === 'active').length,
    implementation: organizations.filter((organization) => ['onboarding', 'trial', 'demo'].includes(organization.status)).length,
    attention: organizations.filter((organization) => ['past_due', 'grace_period', 'suspended'].includes(organization.status)).length,
    branches: organizations.filter((organization) => organization.status !== 'archived').reduce((sum, organization) => sum + organization.branches, 0),
  }), [organizations]);

  const openCreate = () => {
    setCreateForm(createInitial);
    setValidation('');
    createDialog.current?.showModal();
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = {
      ...createForm,
      name: createForm.name.trim(),
      slug: (createForm.slug || slugify(createForm.name)).trim(),
      city: createForm.city.trim(),
      ownerName: createForm.ownerName.trim(),
      ownerEmail: createForm.ownerEmail.trim(),
      legalEntityName: (createForm.legalEntityName || createForm.name).trim(),
      bin: createForm.bin.trim(),
      branchName: (createForm.branchName || 'Главный филиал').trim(),
      branchAddress: createForm.branchAddress.trim(),
    };

    if (!normalized.name || !normalized.slug || !normalized.city || !normalized.bin) {
      setValidation('Заполните название, системный slug, город и БИН.');
      return;
    }

    const duplicate = organizations.some((organization) => organization.slug === normalized.slug || (normalized.bin && organization.primaryBin === normalized.bin));
    if (duplicate) {
      setValidation('Компания с таким slug или БИН уже существует.');
      return;
    }

    if (await createOrganization(normalized)) createDialog.current?.close();
  };

  const openEdit = (organization: Organization) => {
    setEditing({ ...organization });
    setValidation('');
    editDialog.current?.showModal();
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (!editing.name.trim() || !editing.slug.trim()) {
      setValidation('Название и slug обязательны.');
      return;
    }

    const success = await updateOrganization(editing.id, {
      name: editing.name.trim(),
      slug: editing.slug.trim(),
      city: editing.city.trim(),
      status: editing.status,
      customerHealth: editing.customerHealth,
      ownerName: editing.ownerName.trim(),
      ownerEmail: editing.ownerEmail.trim(),
    });
    if (success) editDialog.current?.close();
  };

  const archive = async (organization: Organization) => {
    const reason = window.prompt(`Причина архивации «${organization.name}». Действие попадёт в аудит:`);
    if (!reason?.trim()) return;
    await archiveOrganization(organization.id, reason.trim());
  };

  const restore = async (organization: Organization) => {
    if (!window.confirm(`Восстановить «${organization.name}» в статус «Внедрение»?`)) return;
    await restoreOrganization(organization.id, 'Восстановление компании из архива');
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Tenant Management</span>
          <h1>Компании и tenants</h1>
          <p>Холдинги, юридические лица, филиалы, владельцы и жизненный цикл клиентов.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить</button>
          {can('organizations.create') && <button className="primary-button" type="button" onClick={openCreate}><Plus size={17} /> Создать компанию</button>}
        </div>
      </div>

      {isDemo && <div className="mode-banner"><ShieldCheck size={18} /><div><strong>Демо-режим</strong><span>Изменения сохраняются в браузере. После настройки Supabase команды будут выполняться в control-plane базе.</span></div></div>}
      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span></div>}

      <section className="metrics company-metrics">
        <article className="metric-card"><div className="metric-icon"><Building2 size={21} /></div><div><span>Активные компании</span><strong>{metrics.active}</strong><small>production-доступ</small></div></article>
        <article className="metric-card"><div className="metric-icon"><GitBranch size={21} /></div><div><span>Демо и внедрение</span><strong>{metrics.implementation}</strong><small>до запуска</small></div></article>
        <article className="metric-card"><div className="metric-icon"><CircleAlert size={21} /></div><div><span>Требуют внимания</span><strong>{metrics.attention}</strong><small>оплата или доступ</small></div></article>
        <article className="metric-card"><div className="metric-icon"><MapPin size={21} /></div><div><span>Активные филиалы</span><strong>{metrics.branches}</strong><small>во всех tenants</small></div></article>
      </section>

      <section className="panel company-registry-panel">
        <div className="registry-toolbar">
          <div className="search registry-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, БИН, город, владелец..." /></div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | OrganizationStatus)}>
            <option value="all">Все статусы</option>
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label className="toggle-control"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>Показывать архив</span></label>
          <span className="registry-count">Найдено: {filtered.length}</span>
        </div>

        {loading ? (
          <div className="inline-loading"><LoaderCircle className="spin" size={26} /><span>Загрузка компаний...</span></div>
        ) : filtered.length === 0 ? (
          <div className="inline-empty"><Building2 size={30} /><h2>Компании не найдены</h2><p>Измените фильтры или создайте новую организацию.</p></div>
        ) : (
          <div className="table-wrap company-table-wrap">
            <table className="company-table">
              <thead><tr><th>Компания</th><th>Статус</th><th>Структура</th><th>Продукты / пользователи</th><th>Health</th><th>Обновлена</th><th /></tr></thead>
              <tbody>
                {filtered.map((organization) => (
                  <tr key={organization.id} className={organization.status === 'archived' ? 'archived-row' : ''}>
                    <td>
                      <div className="company-name-cell"><div className="company-avatar">{organization.name.slice(0, 2).toUpperCase()}</div><div><strong>{organization.name}</strong><span>{organization.primaryBin ? `БИН ${organization.primaryBin}` : organization.slug}</span><small><MapPin size={11} /> {organization.city || 'Город не указан'} · <Mail size={11} /> {organization.ownerEmail || 'Владелец не указан'}</small></div></div>
                    </td>
                    <td><OrganizationStatusBadge status={organization.status} /></td>
                    <td><div className="structure-stats"><span><Landmark size={14} /> {organization.legalEntities} юр. лиц</span><span><GitBranch size={14} /> {organization.branches} филиалов</span></div></td>
                    <td><div className="structure-stats"><span><ShieldCheck size={14} /> {organization.products} продуктов</span><span><Users size={14} /> {organization.users} пользователей</span></div></td>
                    <td><HealthBar value={organization.customerHealth} /></td>
                    <td><span className="date-cell">{new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(organization.updatedAt))}</span></td>
                    <td>
                      <div className="row-actions">
                        {can('organizations.update') && organization.status !== 'archived' && <button className="row-button" type="button" title="Изменить" onClick={() => openEdit(organization)}><Edit3 size={15} /></button>}
                        {can('organizations.archive') && (organization.status === 'archived'
                          ? <button className="row-button" type="button" title="Восстановить" onClick={() => void restore(organization)}><RotateCcw size={15} /></button>
                          : <button className="row-button danger-text" type="button" title="Архивировать" onClick={() => void archive(organization)}><Archive size={15} /></button>)}
                        <button className="row-button" type="button" title="Открыть карточку"><ChevronRight size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <dialog ref={createDialog} className="modal wide-modal" onCancel={() => createDialog.current?.close()}>
        <form onSubmit={submitCreate}>
          <div className="modal-header"><div><span className="eyebrow">Provisioning</span><h2>Создать компанию</h2><p>Будут созданы tenant, юридическое лицо и первый филиал.</p></div><button type="button" className="icon-button" onClick={() => createDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-section"><h3>Компания</h3><div className="form-grid">
            <label><span>Название *</span><input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value, slug: slugify(event.target.value), legalEntityName: event.target.value })} placeholder="Amanat Medical Center" /></label>
            <label><span>Системный slug *</span><input required value={createForm.slug} onChange={(event) => setCreateForm({ ...createForm, slug: slugify(event.target.value) })} placeholder="amanat-medical-center" /></label>
            <label><span>Город *</span><input required value={createForm.city} onChange={(event) => setCreateForm({ ...createForm, city: event.target.value })} placeholder="Алматы" /></label>
            <label><span>Владелец</span><input value={createForm.ownerName} onChange={(event) => setCreateForm({ ...createForm, ownerName: event.target.value })} placeholder="ФИО владельца" /></label>
            <label className="span-2"><span>Email владельца</span><input type="email" value={createForm.ownerEmail} onChange={(event) => setCreateForm({ ...createForm, ownerEmail: event.target.value })} placeholder="owner@company.kz" /></label>
          </div></div>
          <div className="form-section"><h3>Юридическое лицо и филиал</h3><div className="form-grid">
            <label><span>Наименование юр. лица</span><input value={createForm.legalEntityName} onChange={(event) => setCreateForm({ ...createForm, legalEntityName: event.target.value })} placeholder="ТОО Компания" /></label>
            <label><span>БИН *</span><input required inputMode="numeric" maxLength={12} value={createForm.bin} onChange={(event) => setCreateForm({ ...createForm, bin: event.target.value.replace(/\D/g, '') })} placeholder="123456789012" /></label>
            <label><span>Название филиала</span><input value={createForm.branchName} onChange={(event) => setCreateForm({ ...createForm, branchName: event.target.value })} placeholder="Главный филиал" /></label>
            <label><span>Адрес филиала</span><input value={createForm.branchAddress} onChange={(event) => setCreateForm({ ...createForm, branchAddress: event.target.value })} placeholder="ул. Абая, 10" /></label>
          </div></div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button type="button" className="secondary-button compact" onClick={() => createDialog.current?.close()}>Отмена</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{saving ? 'Создание...' : 'Создать tenant'}</button></div>
        </form>
      </dialog>

      <dialog ref={editDialog} className="modal" onCancel={() => editDialog.current?.close()}>
        {editing && <form onSubmit={submitEdit}>
          <div className="modal-header"><div><span className="eyebrow">Tenant Management</span><h2>Настройки компании</h2></div><button type="button" className="icon-button" onClick={() => editDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-grid">
            <label><span>Название *</span><input required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
            <label><span>Slug *</span><input required value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: slugify(event.target.value) })} /></label>
            <label><span>Город</span><input value={editing.city} onChange={(event) => setEditing({ ...editing, city: event.target.value })} /></label>
            <label><span>Статус</span><select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as OrganizationStatus })}>{statusOptions.filter((option) => option.value !== 'archived').map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>Customer Health</span><input type="number" min="0" max="100" value={editing.customerHealth} onChange={(event) => setEditing({ ...editing, customerHealth: Number(event.target.value) })} /></label>
            <label><span>Владелец</span><input value={editing.ownerName} onChange={(event) => setEditing({ ...editing, ownerName: event.target.value })} /></label>
            <label className="span-2"><span>Email владельца</span><input type="email" value={editing.ownerEmail} onChange={(event) => setEditing({ ...editing, ownerEmail: event.target.value })} /></label>
          </div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button type="button" className="secondary-button compact" onClick={() => editDialog.current?.close()}>Отмена</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Edit3 size={17} />}{saving ? 'Сохранение...' : 'Сохранить'}</button></div>
        </form>}
      </dialog>
    </>
  );
}
