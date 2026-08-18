import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Building2, ChevronRight, CirclePlus, CreditCard, Layers3, PackageCheck, Pencil, Search, Workflow } from 'lucide-react';
import type { ControlCenterTab, Installation, Organization, OrganizationProduct, User } from '../../controlCenter';
import { api, EmptyState, Status } from '../../controlCenter';
import './organizationsPage.css';

type SubscriptionSummary = {
  id: string;
  organization_id: string;
  product_id: string;
  status: string;
  billing_period_months: number;
  base_price_kzt: string | number | null;
  addons_price_kzt: string | number;
  custom_price_kzt: string | number | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  access_ends_at: string | null;
  product_name: string;
  product_code: string;
  plan_name: string | null;
};

type InvoiceSummary = {
  id: string;
  invoice_number: string;
  status: string;
  total_kzt: string | number;
  paid_total_kzt: string | number;
  outstanding_kzt: string | number;
  issued_at: string | null;
  due_at: string | null;
  product_name: string;
  product_code: string;
  plan_name: string | null;
};

type Props = {
  user: User;
  organizations: Organization[];
  organizationProducts: OrganizationProduct[];
  installations: Installation[];
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  onNavigate: (tab: ControlCenterTab) => void;
};

const money = (value: unknown) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export function OrganizationsPage({ user, organizations, organizationProducts, installations, canManage, onChanged, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [subscriptions, setSubscriptions] = useState<SubscriptionSummary[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [commercialLoading, setCommercialLoading] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', legalName: '', bin: '', city: '' });
  const [editForm, setEditForm] = useState({ name: '', legalName: '', bin: '', city: '' });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return organizations;
    return organizations.filter((item) => [item.name, item.legal_name, item.bin, item.city].some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [organizations, query]);

  useEffect(() => {
    if (!organizations.length) { setSelectedId(''); return; }
    if (!organizations.some((item) => item.id === selectedId)) setSelectedId(organizations[0].id);
  }, [organizations, selectedId]);

  const selected = organizations.find((item) => item.id === selectedId) ?? null;
  const selectedProducts = organizationProducts.filter((item) => item.organization_id === selectedId);
  const selectedInstallations = installations.filter((item) => item.organization_id === selectedId);
  const activeOrganizations = organizations.filter((item) => item.status === 'active').length;
  const suspendedOrganizations = organizations.filter((item) => item.status !== 'active').length;
  const syncIssues = organizationProducts.filter((item) => item.sync_status && item.sync_status !== 'synced').length;

  useEffect(() => {
    if (!selected || user.scope !== 'platform') { setSubscriptions([]); setInvoices([]); return; }
    let cancelled = false;
    setCommercialLoading(true);
    setError('');
    Promise.all([
      api<{ items: SubscriptionSummary[] }>(`/api/v1/subscriptions?organizationId=${encodeURIComponent(selected.id)}`),
      api<{ items: InvoiceSummary[] }>(`/api/v1/billing/invoices?organizationId=${encodeURIComponent(selected.id)}`),
    ]).then(([subscriptionResult, invoiceResult]) => {
      if (cancelled) return;
      setSubscriptions(subscriptionResult.items);
      setInvoices(invoiceResult.items);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки коммерческого состояния');
    }).finally(() => { if (!cancelled) setCommercialLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.id, user.scope]);

  useEffect(() => {
    if (!selected) return;
    setEditForm({ name: selected.name || '', legalName: selected.legal_name || '', bin: selected.bin || '', city: selected.city || '' });
    setEditOpen(false);
  }, [selected?.id]);

  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения'); }
    finally { setBusy(false); }
  };

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      await api('/api/v1/organizations', { method: 'POST', body: JSON.stringify(createForm) });
      setCreateForm({ name: '', legalName: '', bin: '', city: '' });
      setCreateOpen(false);
    });
  };

  const saveOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    await mutate(async () => {
      await api(`/api/v1/organizations/${selected.id}`, { method: 'PATCH', body: JSON.stringify(editForm) });
      setEditOpen(false);
    });
  };

  const toggleStatus = async () => {
    if (!selected) return;
    await mutate(() => api(`/api/v1/organizations/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ status: selected.status === 'active' ? 'suspended' : 'active' }) }));
  };

  const openInvoices = invoices.filter((item) => ['issued', 'partially_paid', 'overdue'].includes(item.status));
  const outstanding = openInvoices.reduce((sum, item) => sum + Number(item.outstanding_kzt || 0), 0);
  const overdue = invoices.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + Number(item.outstanding_kzt || 0), 0);

  return <section className="org-page">
    <div className="org-kpis">
      <article><span>Организации</span><strong>{organizations.length}</strong><small>в Control Center</small></article>
      <article><span>Активные</span><strong>{activeOrganizations}</strong><small>с доступом</small></article>
      <article><span>Приостановлены</span><strong>{suspendedOrganizations}</strong><small>без активного статуса</small></article>
      <article className={syncIssues ? 'warn' : ''}><span>Sync issues</span><strong>{syncIssues}</strong><small>{syncIssues ? 'требуют проверки' : 'всё синхронизировано'}</small></article>
    </div>

    <div className="org-toolbar">
      <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, БИН, город…" /></label>
      {canManage && <button type="button" onClick={() => setCreateOpen((value) => !value)}><CirclePlus size={16} />Добавить организацию</button>}
    </div>

    {error && <div className="vps-error">API: {error}</div>}

    {createOpen && <form className="org-create" onSubmit={createOrganization}>
      <div><span>НОВАЯ ОРГАНИЗАЦИЯ</span><h2>Создать клиента</h2><p>Создаётся только реальная запись организации. Продукты и подписки назначаются отдельно.</p></div>
      <label>Название<input required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} /></label>
      <label>Юр. название<input value={createForm.legalName} onChange={(e) => setCreateForm({ ...createForm, legalName: e.target.value })} /></label>
      <label>БИН<input value={createForm.bin} onChange={(e) => setCreateForm({ ...createForm, bin: e.target.value })} /></label>
      <label>Город<input value={createForm.city} onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })} /></label>
      <div className="org-create-actions"><button type="button" onClick={() => setCreateOpen(false)}>Отмена</button><button className="primary" disabled={busy}>Создать</button></div>
    </form>}

    <div className="org-workspace">
      <div className="org-list-panel">
        <div className="org-panel-head"><div><span>CLIENT REGISTRY</span><h2>Организации</h2></div><small>{filtered.length} записей</small></div>
        {!filtered.length ? <EmptyState title="Организации не найдены" text="Измените поисковый запрос или создайте новую организацию." /> : <div className="org-list">{filtered.map((item) => {
          const access = organizationProducts.filter((product) => product.organization_id === item.id);
          const hasIssue = access.some((product) => product.sync_status && product.sync_status !== 'synced');
          return <button type="button" key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
            <div className="org-list-icon"><Building2 size={17} /></div><div><strong>{item.name}</strong><span>{item.bin || 'БИН не указан'} · {item.city || 'город не указан'}</span><small>{item.products ?? 0} продуктов · {item.modules ?? 0} модулей</small></div><div className="org-list-state"><Status value={item.status} />{hasIssue && <i title="Есть ошибка синхронизации" />}</div><ChevronRight size={16} />
          </button>;
        })}</div>}
      </div>

      <div className="org-detail-panel">
        {!selected ? <EmptyState title="Выберите организацию" text="Справа появится полная карточка клиента." /> : <>
          <div className="org-detail-head"><div><span>ОРГАНИЗАЦИЯ</span><h2>{selected.name}</h2><p>{selected.legal_name || 'Юридическое название не указано'}</p></div><div><Status value={selected.status} />{canManage && <button type="button" onClick={() => setEditOpen((value) => !value)}><Pencil size={14} />Редактировать</button>}</div></div>

          {editOpen && <form className="org-edit" onSubmit={saveOrganization}>
            <label>Название<input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></label>
            <label>Юр. название<input value={editForm.legalName} onChange={(e) => setEditForm({ ...editForm, legalName: e.target.value })} /></label>
            <label>БИН<input value={editForm.bin} onChange={(e) => setEditForm({ ...editForm, bin: e.target.value })} /></label>
            <label>Город<input value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} /></label>
            <div><button type="button" onClick={() => setEditOpen(false)}>Отмена</button><button className="primary" disabled={busy}>Сохранить</button></div>
          </form>}

          <div className="org-facts">
            <div><span>БИН</span><strong>{selected.bin || '—'}</strong></div>
            <div><span>Город</span><strong>{selected.city || '—'}</strong></div>
            <div><span>Продукты</span><strong>{selectedProducts.filter((item) => item.status === 'active').length}</strong></div>
            <div><span>Модули</span><strong>{selectedInstallations.filter((item) => item.status === 'active').length}</strong></div>
            <div><span>Создана</span><strong>{date(selected.created_at)}</strong></div>
          </div>

          <div className="org-section">
            <div className="org-section-head"><div><PackageCheck size={16} /><span><strong>Продукты и доступ</strong><small>Desired state и подтверждение runtime</small></span></div><button type="button" onClick={() => onNavigate('products')}>Управлять</button></div>
            {!selectedProducts.length ? <div className="org-section-empty">Продукты не назначены.</div> : <div className="org-access-list">{selectedProducts.map((item) => <div key={item.product_id}><div><strong>{item.product_name}</strong><span>{item.product_code}</span></div><Status value={item.status} /><div><span>Sync</span><Status value={item.sync_status || 'pending'} /></div><div><span>Revision</span><strong>{item.actual_revision ?? 0} / {item.desired_revision ?? 0}</strong></div></div>)}</div>}
          </div>

          <div className="org-section">
            <div className="org-section-head"><div><Layers3 size={16} /><span><strong>Модули</strong><small>Установленные возможности организации</small></span></div><button type="button" onClick={() => onNavigate('modules')}>Управлять</button></div>
            {!selectedInstallations.length ? <div className="org-section-empty">Модули не установлены.</div> : <div className="org-module-list">{selectedInstallations.slice(0, 8).map((item) => <div key={item.id}><div><strong>{item.module_name}</strong><span>{item.host_product_name}</span></div><Status value={item.status} /><div><span>Фактически</span><Status value={item.actual_enabled == null ? 'unknown' : item.actual_enabled ? 'active' : 'suspended'} /></div></div>)}</div>}
          </div>

          {user.scope === 'platform' && <div className="org-commercial-grid">
            <div className="org-section">
              <div className="org-section-head"><div><PackageCheck size={16} /><span><strong>Подписки</strong><small>Тарифы и lifecycle</small></span></div><button type="button" onClick={() => onNavigate('subscriptions')}>Открыть</button></div>
              {commercialLoading ? <div className="org-section-empty">Загрузка…</div> : !subscriptions.length ? <div className="org-section-empty">Подписок пока нет.</div> : <div className="org-subscription-list">{subscriptions.map((item) => <div key={item.id}><div><strong>{item.product_name}</strong><span>{item.plan_name || 'Без тарифа'} · {item.billing_period_months} мес.</span></div><Status value={item.status} /><small>Доступ до {date(item.access_ends_at || item.current_period_end || item.trial_ends_at)}</small></div>)}</div>}
            </div>

            <div className="org-section">
              <div className="org-section-head"><div><CreditCard size={16} /><span><strong>Финансовый статус</strong><small>Счета этой организации</small></span></div><button type="button" onClick={() => onNavigate('billing')}>Биллинг</button></div>
              <div className="org-finance"><div><span>Открытые счета</span><strong>{openInvoices.length}</strong></div><div><span>К оплате</span><strong>{money(outstanding)}</strong></div><div className={overdue ? 'danger' : ''}><span>Просрочено</span><strong>{money(overdue)}</strong></div></div>
              {!!invoices.length && <div className="org-invoice-list">{invoices.slice(0, 4).map((item) => <div key={item.id}><div><strong>{item.invoice_number}</strong><span>{item.product_name}</span></div><Status value={item.status} /><strong>{money(item.outstanding_kzt)}</strong></div>)}</div>}
            </div>
          </div>}

          <div className="org-footer-actions">
            <button type="button" onClick={() => onNavigate('sync')}><Workflow size={15} />Синхронизация</button>
            {canManage && <button type="button" className={selected.status === 'active' ? 'danger' : 'primary'} disabled={busy} onClick={() => void toggleStatus()}>{selected.status === 'active' ? 'Приостановить организацию' : 'Активировать организацию'}</button>}
          </div>
        </>}
      </div>
    </div>
  </section>;
}
