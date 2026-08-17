import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import './vps.css';

type User = { id: string; email: string; fullName: string; role: string; scope: 'platform' | 'tenant'; memberships?: Array<{ organizationId: string; role: string }> };
type Overview = { organizations: number; products: number; modules: number; installations: number; platform_users: number; sync_pending: number };
type Organization = { id: string; name: string; legal_name: string | null; bin: string | null; city: string | null; status: string; products?: number; modules?: number };
type Product = { id: string; code: string; name: string; status: string; version: string | null; last_health: string; last_heartbeat_at: string | null; last_latency_ms?: number | null; last_error?: string | null; tenants: number };
type Module = { id: string; code: string; name: string; status: string; current_version: string | null; owner_product_id: string | null; owner_product_name: string | null; category: string };
type Installation = { id: string; organization_id: string; module_id: string; host_product_id: string; organization_name: string; module_code: string; module_name: string; host_product_name: string; status: string; health: string; version: string | null; actual_enabled: boolean | null; sync_status: string; last_applied_revision: number | null; updated_at: string };
type OrganizationProduct = { organization_id: string; product_id: string; organization_name: string; product_name: string; product_code: string; status: string; remote_tenant_id: string | null; desired_revision: number | null; actual_revision: number | null; sync_status: string | null; last_sync_at: string | null; last_error: string | null };
type ControlCommand = { id: string; command_type: string; desired_revision: number; status: string; attempts: number; last_error: string | null; organization_name: string; product_name: string; product_code: string; created_at: string; completed_at: string | null };
type Tab = 'overview' | 'organizations' | 'products' | 'modules' | 'installations' | 'sync' | 'realtime' | 'security';
type RealtimeState = 'connecting' | 'online' | 'offline';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'organizations', label: 'Организации' },
  { id: 'products', label: 'Продукты' },
  { id: 'modules', label: 'Модули' },
  { id: 'installations', label: 'Установки' },
  { id: 'sync', label: 'Синхронизация' },
  { id: 'realtime', label: 'События' },
  { id: 'security', label: 'Безопасность' },
];

const tabTitles: Record<Tab, string> = {
  overview: 'Обзор платформы', organizations: 'Организации', products: 'Продукты', modules: 'Управление модулями', installations: 'Установки модулей', sync: 'Синхронизация продуктов', realtime: 'События в реальном времени', security: 'Безопасность аккаунта',
};

const statusLabels: Record<string, string> = {
  active: 'Активен', suspended: 'Отключён', disabled: 'Отключён', published: 'Доступен', pending: 'Ожидание', synced: 'Синхронизировано',
  applying: 'Применяется', applied: 'Применено', completed: 'Выполнено', failed: 'Ошибка', retry: 'Повтор', healthy: 'Работает', degraded: 'Деградация',
  unavailable: 'Недоступен', unknown: 'Нет данных', offline: 'Офлайн', maintenance: 'Техработы', draft: 'Черновик', archived: 'Архив', read_only: 'Только чтение',
};

const categoryLabels: Record<string, string> = {
  sales: 'Продажи', communications: 'Коммуникации', operations: 'Операции', advertising: 'Реклама', analytics: 'Аналитика', automation: 'Автоматизация', telephony: 'Телефония',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers || {}) }, ...init });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function Login({ onReady }: { onReady: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    try { const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); onReady(result.user); }
    catch (e) { setError(e instanceof Error ? `Ошибка входа: ${e.message}` : 'Ошибка входа.'); }
  };
  return <main className="vps-login"><form className="vps-login-card" onSubmit={submit}><div className="vps-brand"><b>IMDS</b><span>Super Admin</span></div><div className="vps-login-copy"><span>CONTROL PLANE</span><h1>Вход в платформу</h1><p>Локальный VPS · PostgreSQL · реальное время</p></div><label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required /></label><label>Пароль<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>{error && <div className="vps-error">{error}</div>}<button className="vps-primary" type="submit">Войти</button></form></main>;
}

function Status({ value }: { value: string }) { const normalized = value || 'unknown'; return <span className={`vps-status ${normalized}`}>{statusLabels[normalized] || normalized}</span>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="vps-empty"><div className="vps-empty-mark">—</div><div><strong>{title}</strong><p>{text}</p></div></div>; }
function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) { return <article className="vps-metric"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</article>; }

export function VpsApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [organizationProducts, setOrganizationProducts] = useState<OrganizationProduct[]>([]);
  const [commands, setCommands] = useState<ControlCommand[]>([]);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting');
  const [busy, setBusy] = useState(false);
  const [orgForm, setOrgForm] = useState({ name: '', legalName: '', bin: '', city: '' });
  const [entitlementForm, setEntitlementForm] = useState({ organizationId: '', productId: '', remoteTenantId: '' });
  const [installForm, setInstallForm] = useState({ organizationId: '', hostProductId: '', moduleId: '' });
  const [moduleOrganizationId, setModuleOrganizationId] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordMessage, setPasswordMessage] = useState('');
  const apiRoot = user?.scope === 'tenant' ? '/api/tenant/v1' : '/api/v1';

  const refresh = useCallback(async () => {
    try {
      const [o, org, prod, mod, inst, entitlements, commandList] = await Promise.all([
        api<Overview>(`${apiRoot}/overview`), api<{ items: Organization[] }>(`${apiRoot}/organizations`), api<{ items: Product[] }>(`${apiRoot}/products`), api<{ items: Module[] }>(`${apiRoot}/modules`), api<{ items: Installation[] }>(`${apiRoot}/installations`), api<{ items: OrganizationProduct[] }>(`${apiRoot}/organization-products`), api<{ items: ControlCommand[] }>(`${apiRoot}/control-commands`),
      ]);
      setOverview(o); setOrganizations(org.items); setProducts(prod.items); setModules(mod.items); setInstallations(inst.items); setOrganizationProducts(entitlements.items); setCommands(commandList.items); setError('');
      setModuleOrganizationId((current) => current || org.items[0]?.id || '');
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка API'); }
  }, [apiRoot]);

  useEffect(() => { api<{ user: User }>('/api/auth/me').then((x) => setUser(x.user)).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!user) return; void refresh(); const es = new EventSource('/events');
    es.addEventListener('ready', () => setRealtimeState('online'));
    es.addEventListener('update', (event) => { setRealtimeState('online'); try { setEvents((value) => [JSON.parse((event as MessageEvent).data), ...value].slice(0, 50)); } catch {} void refresh(); });
    es.onerror = () => setRealtimeState('offline'); return () => es.close();
  }, [user, refresh]);

  const healthyProducts = useMemo(() => products.filter((product) => product.last_health === 'healthy').length, [products]);
  const activeOrganizations = useMemo(() => organizations.filter((organization) => organization.status === 'active').length, [organizations]);
  const availableModules = useMemo(() => modules.filter((m) => !installForm.hostProductId || m.owner_product_id === installForm.hostProductId), [modules, installForm.hostProductId]);
  const selectedModuleOrganization = organizations.find((organization) => organization.id === moduleOrganizationId) ?? null;
  const selectedModuleRows = useMemo(() => modules.map((module) => {
    const installation = installations.find((item) => item.organization_id === moduleOrganizationId && item.module_id === module.id) ?? null;
    const productAccess = module.owner_product_id ? organizationProducts.find((item) => item.organization_id === moduleOrganizationId && item.product_id === module.owner_product_id) ?? null : null;
    return { module, installation, productAccess };
  }), [installations, moduleOrganizationId, modules, organizationProducts]);

  if (loading) return <div className="vps-loading">Проверка доступа…</div>;
  if (!user) return <Login onReady={setUser} />;
  const canManagePlatform = user.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role);

  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }); setUser(null); };
  const createOrganization = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await api('/api/v1/organizations', { method: 'POST', body: JSON.stringify(orgForm) }); setOrgForm({ name: '', legalName: '', bin: '', city: '' }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); } };
  const enableProduct = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { const config = entitlementForm.remoteTenantId.trim() ? { remoteTenantId: entitlementForm.remoteTenantId.trim() } : {}; await api('/api/v1/organization-products', { method: 'POST', body: JSON.stringify({ organizationId: entitlementForm.organizationId, productId: entitlementForm.productId, status: 'active', config }) }); setEntitlementForm((value) => ({ ...value, remoteTenantId: '' })); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); } };
  const setProductAccess = async (item: OrganizationProduct, status: string) => { setBusy(true); try { await api('/api/v1/organization-products', { method: 'POST', body: JSON.stringify({ organizationId: item.organization_id, productId: item.product_id, status, config: {} }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); } };
  const installModule = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await api('/api/v1/installations', { method: 'POST', body: JSON.stringify({ ...installForm, status: 'active' }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); } };
  const setInstallationStatus = async (id: string, status: string) => { setBusy(true); try { await api(`/api/v1/installations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); } };
  const setModuleAccess = async (module: Module, installation: Installation | null, enabled: boolean) => {
    if (!moduleOrganizationId || !module.owner_product_id) return;
    const productAccess = organizationProducts.find((item) => item.organization_id === moduleOrganizationId && item.product_id === module.owner_product_id);
    if (enabled && productAccess?.status !== 'active') { setError('Сначала включите продукт для выбранной организации.'); return; }
    setBusy(true); setError('');
    try {
      if (installation) {
        await api(`/api/v1/installations/${installation.id}`, { method: 'PATCH', body: JSON.stringify({ status: enabled ? 'active' : 'suspended' }) });
      } else if (enabled) {
        await api('/api/v1/installations', { method: 'POST', body: JSON.stringify({ organizationId: moduleOrganizationId, moduleId: module.id, hostProductId: module.owner_product_id, status: 'active' }) });
      }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка управления модулем'); }
    finally { setBusy(false); }
  };
  const setOrganizationStatus = async (id: string, status: string) => { setBusy(true); try { await api(`/api/v1/organizations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); } };
  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setPasswordMessage('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setError('Новый пароль и подтверждение не совпадают.'); return; }
    setBusy(true);
    try {
      const result = await api<{ user: User }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }) });
      setUser(result.user); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setPasswordMessage('Пароль изменён. Остальные сессии отозваны.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка смены пароля'); }
    finally { setBusy(false); }
  };

  return <div className="vps-shell"><aside className="vps-sidebar"><div className="vps-brand"><b>IMDS</b><span>Super Admin</span></div><nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav><div className="vps-user"><strong>{user.fullName}</strong><span>{user.email}</span><small>{user.scope === 'tenant' ? `Организация · ${user.role}` : user.role}</small><button onClick={() => void logout()}>Выйти</button></div></aside><main className="vps-content"><header className="vps-header"><div><span className="vps-eyebrow">ЦЕНТР УПРАВЛЕНИЯ IMDS</span><h1>{tabTitles[tab]}</h1></div><div className={`vps-live ${realtimeState}`}><i />{realtimeState === 'online' ? 'В РЕАЛЬНОМ ВРЕМЕНИ' : realtimeState === 'connecting' ? 'ПОДКЛЮЧЕНИЕ' : 'ОФЛАЙН'}</div></header>{error && <div className="vps-error">API: {error}</div>}{!canManagePlatform && user.scope === 'tenant' && <div className="vps-note">Tenant scope: доступны только назначенные организации, продукты и модули. Изменения entitlement выполняет IMDS Super Admin.</div>}

  {tab === 'overview' && <><section className="vps-metrics"><Metric label="Организации" value={overview?.organizations ?? 0} hint={`${activeOrganizations} активных`} /><Metric label="Продукты" value={overview?.products ?? 0} hint={`${healthyProducts} работают`} /><Metric label="Модули" value={overview?.modules ?? 0} hint="в каталоге" /><Metric label="Установки" value={overview?.installations ?? 0} hint="активных" /><Metric label="Синхронизация" value={overview?.sync_pending ?? 0} hint="ожидают подтверждения" /><Metric label="Пользователи платформы" value={overview?.platform_users ?? 0} hint="активных" /></section><section className="vps-card"><div className="vps-card-head"><div><span>МОНИТОРИНГ</span><h2>Состояние продуктов</h2></div></div>{products.length === 0 ? <EmptyState title="Продукты пока не подключены" text="После подключения продукта здесь появятся состояние, heartbeat и задержка." /> : <div className="vps-table-wrap"><table><thead><tr><th>Продукт</th><th>Организации</th><th>Задержка</th><th>Последний сигнал</th><th>Состояние</th></tr></thead><tbody>{products.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.code}</small></td><td>{p.tenants}</td><td>{p.last_latency_ms == null ? '—' : `${p.last_latency_ms} мс`}</td><td>{p.last_heartbeat_at ? new Date(p.last_heartbeat_at).toLocaleString('ru-RU') : 'Нет данных'}</td><td><Status value={p.last_health || 'unknown'} />{p.last_error && <small className="vps-inline-error">{p.last_error}</small>}</td></tr>)}</tbody></table></div>}</section></>}

  {tab === 'organizations' && <><section className="vps-card"><div className="vps-card-head"><div><span>КЛИЕНТСКИЙ КОНТУР</span><h2>Добавить организацию</h2></div></div><form className="vps-form-grid" onSubmit={createOrganization}><label>Название<input required value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} /></label><label>Юр. название<input value={orgForm.legalName} onChange={(e) => setOrgForm({ ...orgForm, legalName: e.target.value })} /></label><label>БИН<input value={orgForm.bin} onChange={(e) => setOrgForm({ ...orgForm, bin: e.target.value })} /></label><label>Город<input value={orgForm.city} onChange={(e) => setOrgForm({ ...orgForm, city: e.target.value })} /></label><button className="vps-action" disabled={busy}>Создать</button></form></section><section className="vps-card"><div className="vps-card-head"><div><span>ОРГАНИЗАЦИИ</span><h2>Доступ и состояние</h2></div></div>{organizations.length === 0 ? <EmptyState title="Организаций пока нет" text="Создайте первую реальную клинику или компанию." /> : <div className="vps-table-wrap"><table><thead><tr><th>Организация</th><th>Город</th><th>Продукты</th><th>Модули</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{organizations.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.bin || 'БИН не указан'}</small></td><td>{x.city || '—'}</td><td>{x.products ?? 0}</td><td>{x.modules ?? 0}</td><td><Status value={x.status} /></td><td><button className="vps-mini" disabled={busy} onClick={() => void setOrganizationStatus(x.id, x.status === 'active' ? 'suspended' : 'active')}>{x.status === 'active' ? 'Приостановить' : 'Активировать'}</button></td></tr>)}</tbody></table></div>}</section></>}

  {tab === 'products' && <><section className="vps-card"><div className="vps-card-head"><div><span>ДОСТУП К ПРОДУКТАМ</span><h2>Выдать продукт организации</h2></div></div><form className="vps-form-grid" onSubmit={enableProduct}><label>Организация<select required value={entitlementForm.organizationId} onChange={(e) => setEntitlementForm({ ...entitlementForm, organizationId: e.target.value })}><option value="">Выберите</option>{organizations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Продукт<select required value={entitlementForm.productId} onChange={(e) => setEntitlementForm({ ...entitlementForm, productId: e.target.value })}><option value="">Выберите</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Tenant UUID продукта<input value={entitlementForm.remoteTenantId} onChange={(e) => setEntitlementForm({ ...entitlementForm, remoteTenantId: e.target.value })} placeholder="Необязательно — автосопоставление по названию" /></label><button className="vps-action" disabled={busy}>Включить продукт</button></form><p className="vps-note">Если UUID не указан, центр управления сопоставит организацию с компанией Marketing только по точному совпадению названия. При неоднозначности синхронизация остановится без угадывания.</p></section><section className="vps-card"><div className="vps-card-head"><div><span>РЕЕСТР ПРОДУКТОВ</span><h2>Продукты IMDS</h2></div></div>{products.length === 0 ? <EmptyState title="Нет зарегистрированных продуктов" text="Центр управления не создаёт демонстрационные записи." /> : <div className="vps-table-wrap"><table><thead><tr><th>Продукт</th><th>Организации</th><th>Статус</th><th>Состояние</th></tr></thead><tbody>{products.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.code}</small></td><td>{x.tenants}</td><td><Status value={x.status} /></td><td><Status value={x.last_health} /></td></tr>)}</tbody></table></div>}</section>{organizationProducts.length > 0 && <section className="vps-card"><div className="vps-card-head"><div><span>ДОСТУПЫ</span><h2>Выданные продукты</h2></div></div><div className="vps-table-wrap"><table><thead><tr><th>Организация</th><th>Продукт</th><th>Требуется</th><th>Синхронизация</th><th>Ревизия</th><th>Tenant</th><th>Действие</th></tr></thead><tbody>{organizationProducts.map((x) => <tr key={`${x.organization_id}:${x.product_id}`}><td>{x.organization_name}</td><td><strong>{x.product_name}</strong><small>{x.product_code}</small></td><td><Status value={x.status} /></td><td><Status value={x.sync_status || 'pending'} />{x.last_error && <small className="vps-inline-error">{x.last_error}</small>}</td><td>{x.actual_revision ?? 0} / {x.desired_revision ?? 0}</td><td><small>{x.remote_tenant_id || 'автосопоставление'}</small></td><td><button className="vps-mini" disabled={busy} onClick={() => void setProductAccess(x, x.status === 'active' ? 'suspended' : 'active')}>{x.status === 'active' ? 'Отключить' : 'Включить'}</button></td></tr>)}</tbody></table></div></section>}</>}

  {tab === 'modules' && <><section className="vps-card"><div className="vps-card-head"><div><span>УПРАВЛЕНИЕ ДОСТУПОМ</span><h2>Модули организации</h2></div><button className="vps-mini" disabled={busy} onClick={() => void refresh()}>Обновить</button></div><div className="vps-form-grid"><label>Организация<select value={moduleOrganizationId} onChange={(e) => setModuleOrganizationId(e.target.value)}><option value="">Выберите</option>{organizations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div>{!selectedModuleOrganization ? <EmptyState title="Выберите организацию" text="После выбора появятся все модули, требуемое состояние и подтверждение из продукта." /> : <><p className="vps-note">Изменение записывает требуемое состояние в Super Admin. Модуль считается реально включённым или отключённым только после подтверждения Marketing.</p><div className="vps-table-wrap"><table><thead><tr><th>Модуль</th><th>Категория</th><th>Продукт</th><th>Требуется</th><th>Фактически</th><th>Синхронизация</th><th>Ревизия</th><th>Доступ</th></tr></thead><tbody>{selectedModuleRows.map(({ module, installation, productAccess }) => { const desiredEnabled = installation?.status === 'active'; const productEnabled = productAccess?.status === 'active'; return <tr key={module.id}><td><strong>{module.name}</strong><small>{module.code}</small></td><td>{categoryLabels[module.category] || module.category}</td><td><strong>{module.owner_product_name || '—'}</strong><small>{productEnabled ? 'продукт активен' : 'продукт отключён'}</small></td><td><Status value={desiredEnabled ? 'active' : 'suspended'} /></td><td>{installation?.actual_enabled == null ? <Status value="unknown" /> : <Status value={installation.actual_enabled ? 'active' : 'suspended'} />}</td><td><Status value={installation?.sync_status || (productEnabled ? 'pending' : 'disabled')} /></td><td>{installation?.last_applied_revision ?? 0}</td><td><button className="vps-mini" disabled={busy || (!desiredEnabled && !productEnabled)} onClick={() => void setModuleAccess(module, installation, !desiredEnabled)}>{desiredEnabled ? 'Отключить' : 'Включить'}</button></td></tr>; })}</tbody></table></div></>}</section><section className="vps-card"><div className="vps-card-head"><div><span>КАТАЛОГ МОДУЛЕЙ</span><h2>Доступные модули</h2></div></div>{modules.length === 0 ? <EmptyState title="Модули не зарегистрированы" text="Каталог формируется только из реально существующих модулей продуктов." /> : <div className="vps-table-wrap"><table><thead><tr><th>Модуль</th><th>Категория</th><th>Продукт</th><th>Статус</th></tr></thead><tbody>{modules.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.code}</small></td><td>{categoryLabels[x.category] || x.category}</td><td>{x.owner_product_name || '—'}</td><td><Status value={x.status} /></td></tr>)}</tbody></table></div>}</section></>}

  {tab === 'installations' && <><section className="vps-card"><div className="vps-card-head"><div><span>УСТАНОВКА</span><h2>Установить модуль</h2></div></div><form className="vps-form-grid" onSubmit={installModule}><label>Организация<select required value={installForm.organizationId} onChange={(e) => setInstallForm({ ...installForm, organizationId: e.target.value })}><option value="">Выберите</option>{organizations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Продукт<select required value={installForm.hostProductId} onChange={(e) => setInstallForm({ organizationId: installForm.organizationId, hostProductId: e.target.value, moduleId: '' })}><option value="">Выберите</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Модуль<select required value={installForm.moduleId} onChange={(e) => setInstallForm({ ...installForm, moduleId: e.target.value })}><option value="">Выберите</option>{availableModules.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><button className="vps-action" disabled={busy}>Установить</button></form><p className="vps-note">Требуемое состояние записывается сразу. Фактически активным модуль считается только после подтверждения продукта.</p></section><section className="vps-card"><div className="vps-card-head"><div><span>ФАКТИЧЕСКОЕ СОСТОЯНИЕ</span><h2>Установки модулей</h2></div></div>{installations.length === 0 ? <EmptyState title="Активных установок нет" text="После установки здесь появятся требуемое, фактическое состояние и синхронизация." /> : <div className="vps-table-wrap"><table><thead><tr><th>Организация / модуль</th><th>Продукт</th><th>Требуется</th><th>Фактически</th><th>Синхронизация</th><th>Ревизия</th><th>Действие</th></tr></thead><tbody>{installations.map((x) => <tr key={x.id}><td><strong>{x.organization_name}</strong><small>{x.module_name}</small></td><td>{x.host_product_name}</td><td><Status value={x.status} /></td><td>{x.actual_enabled == null ? <Status value="unknown" /> : <Status value={x.actual_enabled ? 'active' : 'suspended'} />}</td><td><Status value={x.sync_status || 'pending'} /></td><td>{x.last_applied_revision ?? 0}</td><td><button className="vps-mini" disabled={busy} onClick={() => void setInstallationStatus(x.id, x.status === 'active' ? 'suspended' : 'active')}>{x.status === 'active' ? 'Отключить' : 'Включить'}</button></td></tr>)}</tbody></table></div>}</section></>}

  {tab === 'sync' && <section className="vps-card"><div className="vps-card-head"><div><span>КОМАНДЫ УПРАВЛЕНИЯ</span><h2>Требуется → Фактически</h2></div><Status value={(overview?.sync_pending ?? 0) === 0 ? 'synced' : 'pending'} /></div>{commands.length === 0 ? <EmptyState title="Команд пока нет" text="После изменения продукта или модуля здесь появится команда и подтверждение продукта." /> : <div className="vps-table-wrap"><table><thead><tr><th>Организация</th><th>Продукт</th><th>Команда</th><th>Ревизия</th><th>Статус</th><th>Попытки</th><th>Ошибка</th></tr></thead><tbody>{commands.map((x) => <tr key={x.id}><td>{x.organization_name}</td><td><strong>{x.product_name}</strong><small>{x.product_code}</small></td><td>{x.command_type}</td><td>{x.desired_revision}</td><td><Status value={x.status} /></td><td>{x.attempts}</td><td>{x.last_error ? <small className="vps-inline-error">{x.last_error}</small> : '—'}</td></tr>)}</tbody></table></div>}</section>}

  {tab === 'security' && <section className="vps-card"><div className="vps-card-head"><div><span>АККАУНТ</span><h2>Смена пароля</h2></div></div><form className="vps-form-grid" onSubmit={changePassword}><label>Текущий пароль<input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} /></label><label>Новый пароль<input type="password" autoComplete="new-password" required minLength={16} value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} /></label><label>Подтверждение<input type="password" autoComplete="new-password" required minLength={16} value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} /></label><button className="vps-action" disabled={busy}>Изменить пароль</button></form><p className="vps-note">Минимум 16 символов: строчная и заглавная буквы, цифра и специальный символ. После смены все остальные сессии будут отозваны.</p>{passwordMessage && <div className="vps-success">{passwordMessage}</div>}</section>}

  {tab === 'realtime' && <section className="vps-card"><div className="vps-card-head"><div><span>ПОТОК СОБЫТИЙ</span><h2>События</h2></div><Status value={realtimeState === 'online' ? 'healthy' : realtimeState === 'offline' ? 'offline' : 'unknown'} /></div>{events.length === 0 ? <EmptyState title="Ожидание событий" text="Изменения PostgreSQL появятся здесь без обновления страницы." /> : <pre className="vps-events">{events.map((event, index) => `${index + 1}. ${JSON.stringify(event, null, 2)}\n`).join('\n')}</pre>}</section>}
  </main></div>;
}
