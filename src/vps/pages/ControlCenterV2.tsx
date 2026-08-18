import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BellRing,
  Boxes,
  Building2,
  CreditCard,
  FileCheck2,
  Layers3,
  LogOut,
  PackageCheck,
  ServerCog,
  Settings2,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import { OverviewPage } from './overview/OverviewPage';
import { OrganizationsPage } from './organizations/OrganizationsPage';
import { RegistrationsPage } from './registrations/RegistrationsPage';
import { ProductsPage } from './products/ProductsPage';
import { ModulesPage } from './modules/ModulesPage';
import { SubscriptionsPage } from './subscriptions/SubscriptionsPage';
import { BillingPage } from './billing/BillingPage';
import { SyncPage } from './sync/SyncPage';
import { EventsPage, type RealtimeFeedEvent } from './events/EventsPage';
import { UsersPage } from './users/UsersPage';
import { SecurityPage } from './security/SecurityPage';
import { SettingsPage } from './settings/SettingsPage';
import type { ControlCenterTab, ControlCommand, Installation, Module, Organization, OrganizationProduct, Overview, Product, RealtimeState, User } from '../controlCenter';
import { api } from '../controlCenter';
import './controlCenterV2.css';

type NavigationItem = { id: ControlCenterTab; label: string; description: string; icon: typeof Building2 };
type NavigationMode = 'push' | 'replace';

const businessNavigation: NavigationItem[] = [
  { id: 'overview', label: 'Обзор продуктов', description: 'Состояние продуктов, клиентов и текущих операций', icon: Activity },
  { id: 'organizations', label: 'Организации', description: 'Клиники, компании и подключённые продукты', icon: Building2 },
  { id: 'registrations', label: 'Регистрации', description: 'Новые заявки и подключения клиентов', icon: FileCheck2 },
  { id: 'products', label: 'Продукты', description: 'Управление продуктами IMDS', icon: Boxes },
  { id: 'modules', label: 'Модули', description: 'Доступные модули, функции и права организаций', icon: Layers3 },
  { id: 'subscriptions', label: 'Подписки', description: 'Тарифы, периоды и коммерческий доступ', icon: PackageCheck },
  { id: 'billing', label: 'Биллинг', description: 'Счета, платежи, возвраты и задолженность', icon: CreditCard },
  { id: 'sync', label: 'Синхронизация', description: 'Доставка настроек Control Center в продукты', icon: Workflow },
];

const administrationNavigation: NavigationItem[] = [
  { id: 'events', label: 'События', description: 'Журнал изменений и операций платформы', icon: BellRing },
  { id: 'users', label: 'Пользователи', description: 'Роли, права и доступ сотрудников', icon: Users },
  { id: 'security', label: 'Безопасность', description: 'Активные сессии, пароль и защита аккаунта', icon: ShieldCheck },
  { id: 'settings', label: 'Настройки', description: 'Уведомления и общие бизнес-параметры', icon: Settings2 },
];

const navigationIds = new Set<ControlCenterTab>([...businessNavigation, ...administrationNavigation].map((item) => item.id));
const roleLabels: Record<string, string> = {
  platform_owner: 'Владелец платформы',
  platform_admin: 'Администратор платформы',
  auditor: 'Аудитор',
  owner: 'Владелец организации',
  admin: 'Администратор',
  member: 'Сотрудник',
  viewer: 'Наблюдатель',
};

function tabFromLocation(): ControlCenterTab {
  const value = new URL(window.location.href).searchParams.get('section') as ControlCenterTab | null;
  return value && navigationIds.has(value) ? value : 'overview';
}

export function ControlCenterV2() {
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<ControlCenterTab>(() => tabFromLocation());
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [organizationProducts, setOrganizationProducts] = useState<OrganizationProduct[]>([]);
  const [commands, setCommands] = useState<ControlCommand[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeFeedEvent[]>([]);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting');
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');

  const navigate = useCallback((target: ControlCenterTab, mode: NavigationMode = 'push') => {
    setTab(target);
    const url = new URL(window.location.href);
    if (target === 'overview') url.searchParams.delete('section');
    else url.searchParams.set('section', target);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      if (mode === 'replace') window.history.replaceState({ section: target }, '', nextUrl);
      else window.history.pushState({ section: target }, '', nextUrl);
    }
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }, []);

  useEffect(() => {
    const onPopState = () => setTab(tabFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const refresh = useCallback(async () => {
    const me = await api<{ user: User }>('/api/auth/me');
    setUser(me.user);
    const root = me.user.scope === 'tenant' ? '/api/tenant/v1' : '/api/v1';
    const [snapshot, orgs, productList, moduleList, installationList, organizationProductList, commandList] = await Promise.all([
      api<Overview>(`${root}/overview`),
      api<{ items: Organization[] }>(`${root}/organizations`),
      api<{ items: Product[] }>(`${root}/products`),
      api<{ items: Module[] }>(`${root}/modules`),
      api<{ items: Installation[] }>(`${root}/installations`),
      api<{ items: OrganizationProduct[] }>(`${root}/organization-products`),
      api<{ items: ControlCommand[] }>(`${root}/control-commands`),
    ]);
    setOverview(snapshot);
    setOrganizations(orgs.items);
    setProducts(productList.items);
    setModules(moduleList.items);
    setInstallations(installationList.items);
    setOrganizationProducts(organizationProductList.items);
    setCommands(commandList.items);
    setError('');
  }, []);

  useEffect(() => { void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить данные.')).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    if (!user) return;
    const stream = new EventSource('/events');
    stream.addEventListener('ready', () => setRealtimeState('online'));
    stream.addEventListener('update', (message) => {
      setRealtimeState('online');
      try {
        const event = JSON.parse((message as MessageEvent<string>).data) as RealtimeFeedEvent;
        setRealtimeEvents((current) => {
          const eventKey = event.id != null ? String(event.id) : `${event.topic || 'event'}:${event.created_at || Date.now()}`;
          const withoutDuplicate = current.filter((item) => (item.id != null ? String(item.id) : `${item.topic || 'event'}:${item.created_at || ''}`) !== eventKey);
          return [event, ...withoutDuplicate].slice(0, 250);
        });
      } catch {
        // Unknown producers must not break the operational refresh.
      }
      void refresh().catch(() => undefined);
    });
    stream.onerror = () => setRealtimeState('offline');
    return () => stream.close();
  }, [refresh, user]);

  const visibleBusiness = useMemo(() => user?.scope === 'tenant' ? businessNavigation.filter((item) => !['registrations', 'subscriptions', 'billing'].includes(item.id)) : businessNavigation, [user?.scope]);
  const visibleAdministration = useMemo(() => user?.scope === 'tenant' ? administrationNavigation.filter((item) => item.id !== 'settings') : administrationNavigation, [user?.scope]);
  const canManage = Boolean(user?.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role));

  useEffect(() => {
    if (!user) return;
    const allowed = new Set<ControlCenterTab>([...visibleBusiness, ...visibleAdministration].map((item) => item.id));
    if (!allowed.has(tab)) navigate('overview', 'replace');
  }, [navigate, tab, user, visibleAdministration, visibleBusiness]);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      // Reloading forces the auth boundary to re-check the server session.
    } finally {
      window.location.replace('/');
    }
  };

  if (loading) return <main className="ccv2-state">Загрузка Control Center…</main>;
  if (!user) return <main className="ccv2-state"><strong>Нужно войти в систему</strong><a href="/">Перейти ко входу</a></main>;

  const selected = [...businessNavigation, ...administrationNavigation].find((item) => item.id === tab) ?? businessNavigation[0];
  const scopeLabel = user.scope === 'platform' ? 'Платформа' : 'Организация';
  const roleLabel = roleLabels[user.role] || user.role;
  const realtimeLabel = realtimeState === 'online' ? 'Онлайн' : realtimeState === 'connecting' ? 'Подключение…' : 'Нет связи';

  return <div className="ccv2-shell">
    <aside className="ccv2-sidebar">
      <div className="ccv2-brand"><b>IMDS</b><span>Control Center</span></div>
      <div className="ccv2-nav-group"><span>ПРОДУКТЫ И КЛИЕНТЫ</span>{visibleBusiness.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={17} />{label}</button>)}</div>
      <div className="ccv2-nav-group"><span>АДМИНИСТРИРОВАНИЕ</span>{visibleAdministration.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={17} />{label}</button>)}</div>
      {user.scope === 'platform' && <div className="ccv2-nav-group ccv2-infra-link"><span>СЕРВЕР</span><a href="/infrastructure"><ServerCog size={17} />Инфраструктура</a><small>Сервер, база данных и сервисы</small></div>}
      <div className="ccv2-profile">
        <div className="ccv2-profile-copy"><strong>{user.fullName || user.email}</strong><span>{user.email}</span><small>{scopeLabel} · {roleLabel}</small></div>
        <button type="button" className="ccv2-logout" disabled={loggingOut} onClick={() => void logout()}><LogOut size={14}/>{loggingOut ? 'Выход…' : 'Выйти'}</button>
      </div>
    </aside>
    <main className="ccv2-main">
      <header className="ccv2-header"><div><span>IMDS CONTROL CENTER</span><h1>{selected.label}</h1><p>{selected.description}</p></div><div className={`ccv2-live ${realtimeState}`} title="Соединение с обновлениями в реальном времени"><i />{realtimeLabel}</div></header>
      {error && <div className="vps-error">{error}</div>}
      {tab === 'overview' && <OverviewPage overview={overview} organizations={organizations} products={products} installations={installations} commands={commands} realtimeState={realtimeState} onRefresh={() => void refresh()} onNavigate={navigate} />}
      {tab === 'organizations' && <OrganizationsPage user={user} organizations={organizations} organizationProducts={organizationProducts} installations={installations} canManage={canManage} selectedOrganizationId={selectedOrganizationId} onChanged={refresh} onNavigate={navigate} />}
      {tab === 'registrations' && user.scope === 'platform' && <RegistrationsPage organizations={organizations} realtimeTick={realtimeEvents.length} onOpenOrganization={(organizationId) => { setSelectedOrganizationId(organizationId); navigate('organizations'); }} />}
      {tab === 'products' && <ProductsPage user={user} products={products} organizationProducts={organizationProducts} installations={installations} canManage={canManage} />}
      {tab === 'modules' && <ModulesPage user={user} modules={modules} products={products} organizations={organizations} installations={installations} canManage={canManage} onChanged={refresh} onNavigateSync={() => navigate('sync')} />}
      {tab === 'subscriptions' && user.scope === 'platform' && <SubscriptionsPage organizations={organizations} products={products} canManage={canManage} />}
      {tab === 'billing' && user.scope === 'platform' && <BillingPage organizations={organizations} canManage={canManage} />}
      {tab === 'sync' && <SyncPage organizationProducts={organizationProducts} commands={commands} canManage={canManage} onChanged={refresh} />}
      {tab === 'events' && <EventsPage user={user} realtimeEvents={realtimeEvents} commands={commands} organizations={organizations} products={products} realtimeState={realtimeState} />}
      {tab === 'users' && <UsersPage user={user} organizations={organizations} products={products} modules={modules} />}
      {tab === 'security' && <SecurityPage user={user} />}
      {tab === 'settings' && user.scope === 'platform' && <SettingsPage canManage={canManage} onNavigate={navigate} />}
    </main>
  </div>;
}
