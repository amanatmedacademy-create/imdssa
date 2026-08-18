import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BellRing,
  Boxes,
  Building2,
  CreditCard,
  FileCheck2,
  Layers3,
  LockKeyhole,
  PackageCheck,
  ServerCog,
  Settings2,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import { OverviewPage } from './overview/OverviewPage';
import { OrganizationsPage } from './organizations/OrganizationsPage';
import type { ControlCenterTab, ControlCommand, Installation, Organization, OrganizationProduct, Overview, Product, RealtimeState, User } from '../controlCenter';
import { api } from '../controlCenter';
import './controlCenterV2.css';

type NavigationItem = { id: ControlCenterTab; label: string; description: string; icon: typeof Building2 };

const businessNavigation: NavigationItem[] = [
  { id: 'overview', label: 'Обзор продуктов', description: 'Состояние продуктового контура', icon: Activity },
  { id: 'organizations', label: 'Организации', description: 'Клиники и компании', icon: Building2 },
  { id: 'registrations', label: 'Регистрации', description: 'Новые клиенты', icon: FileCheck2 },
  { id: 'products', label: 'Продукты', description: 'Продукты IMDS', icon: Boxes },
  { id: 'modules', label: 'Модули', description: 'Каталог и entitlement', icon: Layers3 },
  { id: 'subscriptions', label: 'Подписки', description: 'Тарифы и периоды', icon: PackageCheck },
  { id: 'billing', label: 'Биллинг', description: 'Счета и платежи', icon: CreditCard },
  { id: 'sync', label: 'Синхронизация', description: 'Ревизии и команды', icon: Workflow },
];

const administrationNavigation: NavigationItem[] = [
  { id: 'events', label: 'События', description: 'Realtime журнал', icon: BellRing },
  { id: 'users', label: 'Пользователи', description: 'Роли и доступ', icon: Users },
  { id: 'security', label: 'Безопасность', description: 'Сессии и пароль', icon: ShieldCheck },
  { id: 'settings', label: 'Настройки', description: 'Уведомления и defaults', icon: Settings2 },
];

const moduleSpecs: Record<Exclude<ControlCenterTab, 'overview' | 'organizations'>, { kicker: string; title: string; text: string; fields: string[] }> = {
  registrations: { kicker: 'ONBOARDING', title: 'Регистрации', text: 'Входящие регистрации из продуктов до создания или связывания организации.', fields: ['Источник регистрации', 'Компания и владелец', 'Контакты', 'Trial', 'Дата регистрации', 'Статус обработки'] },
  products: { kicker: 'PRODUCT REGISTRY', title: 'Продукты', text: 'Технический и коммерческий реестр всех продуктов IMDS.', fields: ['Health и heartbeat', 'Версия', 'Организации продукта', 'Тарифы продукта', 'Каталог модулей', 'Интеграция Control Center'] },
  modules: { kicker: 'ENTITLEMENTS', title: 'Модули', text: 'Каталог возможностей продуктов и фактический доступ организаций.', fields: ['Категория и версия', 'Владелец-продукт', 'Commercial role', 'Цена add-on', 'Установки', 'Desired / actual state'] },
  subscriptions: { kicker: 'COMMERCIAL ACCESS', title: 'Подписки', text: 'Центральный источник истины для тарифов, периодов и lifecycle доступа.', fields: ['Организация и продукт', 'Тариф', '1 / 3 / 6 / 12 месяцев', 'Add-ons', 'Trial / Active / Past Due', 'Current period / access end'] },
  billing: { kicker: 'FINANCE', title: 'Биллинг', text: 'Счета, фактические оплаты, возвраты и сверка.', fields: ['Открытые счета', 'Дебиторка', 'Просрочка', 'Платежи', 'Возвраты', 'Reconciliation'] },
  sync: { kicker: 'CONTROL COMMANDS', title: 'Синхронизация', text: 'Доставка desired state из Control Center в продуктовые runtime.', fields: ['Organization / product', 'Desired revision', 'Actual revision', 'Pending / applying / synced', 'Attempts', 'Последняя ошибка'] },
  events: { kicker: 'REALTIME', title: 'События', text: 'Единый оперативный поток изменений платформы.', fields: ['Источник', 'Организация', 'Продукт', 'Тип события', 'Payload summary', 'Время'] },
  users: { kicker: 'ACCESS CONTROL', title: 'Пользователи и доступ', text: 'Platform и tenant пользователи, роли и области доступа.', fields: ['Пользователь', 'Роль', 'Организации', 'Продукты и модули', 'Last login', 'Активные сессии'] },
  security: { kicker: 'SECURITY', title: 'Безопасность', text: 'Управление сессиями, паролями и событиями доступа.', fields: ['Активные устройства', 'IP / user agent', 'Последняя активность', 'Истечение сессии', 'Login attempts', 'Смена пароля'] },
  settings: { kicker: 'CONTROL CENTER', title: 'Настройки', text: 'Бизнес-настройки Control Center без серверных secrets.', fields: ['Telegram уведомления', 'Notification routing', 'Commercial defaults', 'Trial defaults', 'Системные параметры', 'Audit изменений'] },
};

function ModuleLanding({ tab, onOpenLegacy }: { tab: Exclude<ControlCenterTab, 'overview' | 'organizations'>; onOpenLegacy: () => void }) {
  const spec = moduleSpecs[tab];
  return <section className="ccv2-module">
    <div className="ccv2-module-intro"><div><span>{spec.kicker}</span><h2>{spec.title}</h2><p>{spec.text}</p></div><button type="button" onClick={onOpenLegacy}>Открыть текущий рабочий экран</button></div>
    <div className="ccv2-module-grid">{spec.fields.map((field) => <article key={field}><span>Показываем</span><strong>{field}</strong></article>)}</div>
    <div className="ccv2-migration-note"><LockKeyhole size={18} /><div><strong>Модуль выделен в отдельный контур.</strong><p>До завершения переноса его рабочие действия остаются в текущем production-экране. Данные и API не дублируются.</p></div></div>
  </section>;
}

const legacyTabIndex: Partial<Record<ControlCenterTab, number>> = {
  registrations: 2,
  products: 3,
  modules: 4,
  subscriptions: 1,
  billing: 1,
  sync: 6,
  events: 7,
  security: 8,
  settings: 9,
};

export function ControlCenterV2() {
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<ControlCenterTab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [organizationProducts, setOrganizationProducts] = useState<OrganizationProduct[]>([]);
  const [commands, setCommands] = useState<ControlCommand[]>([]);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const me = await api<{ user: User }>('/api/auth/me');
    setUser(me.user);
    const root = me.user.scope === 'tenant' ? '/api/tenant/v1' : '/api/v1';
    const [snapshot, orgs, productList, installationList, organizationProductList, commandList] = await Promise.all([
      api<Overview>(`${root}/overview`),
      api<{ items: Organization[] }>(`${root}/organizations`),
      api<{ items: Product[] }>(`${root}/products`),
      api<{ items: Installation[] }>(`${root}/installations`),
      api<{ items: OrganizationProduct[] }>(`${root}/organization-products`),
      api<{ items: ControlCommand[] }>(`${root}/control-commands`),
    ]);
    setOverview(snapshot);
    setOrganizations(orgs.items);
    setProducts(productList.items);
    setInstallations(installationList.items);
    setOrganizationProducts(organizationProductList.items);
    setCommands(commandList.items);
    setError('');
  }, []);

  useEffect(() => { void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки')).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    if (!user) return;
    const stream = new EventSource('/events');
    stream.addEventListener('ready', () => setRealtimeState('online'));
    stream.addEventListener('update', () => { setRealtimeState('online'); void refresh().catch(() => undefined); });
    stream.onerror = () => setRealtimeState('offline');
    return () => stream.close();
  }, [refresh, user]);

  const visibleBusiness = useMemo(() => user?.scope === 'tenant' ? businessNavigation.filter((item) => !['registrations', 'subscriptions', 'billing'].includes(item.id)) : businessNavigation, [user?.scope]);
  const visibleAdministration = useMemo(() => user?.scope === 'tenant' ? administrationNavigation.filter((item) => item.id !== 'settings') : administrationNavigation, [user?.scope]);
  const canManage = Boolean(user?.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role));

  const openLegacy = (target: ControlCenterTab) => {
    if (target === 'users') { window.location.href = '/'; return; }
    const index = legacyTabIndex[target];
    if (typeof index === 'number') sessionStorage.setItem('imdssa:legacy-tab-index', String(index));
    window.location.href = '/';
  };

  if (loading) return <main className="ccv2-state">Загрузка Control Center…</main>;
  if (!user) return <main className="ccv2-state"><strong>Требуется авторизация</strong><a href="/">Перейти ко входу</a></main>;

  const selected = [...businessNavigation, ...administrationNavigation].find((item) => item.id === tab) ?? businessNavigation[0];
  return <div className="ccv2-shell">
    <aside className="ccv2-sidebar">
      <div className="ccv2-brand"><b>IMDS</b><span>Control Center v2</span></div>
      <div className="ccv2-nav-group"><span>ПРОДУКТЫ И КЛИЕНТЫ</span>{visibleBusiness.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}</div>
      <div className="ccv2-nav-group"><span>АДМИНИСТРИРОВАНИЕ</span>{visibleAdministration.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}</div>
      {user.scope === 'platform' && <div className="ccv2-nav-group ccv2-infra-link"><span>СЕРВЕР</span><a href="/"><ServerCog size={17} />Инфраструктура</a><small>Отдельный технический контур</small></div>}
      <div className="ccv2-profile"><strong>{user.fullName}</strong><span>{user.email}</span><a href="/">Production UI</a></div>
    </aside>
    <main className="ccv2-main">
      <header className="ccv2-header"><div><span>IMDS CONTROL CENTER</span><h1>{selected.label}</h1><p>{selected.description}</p></div><div className={`ccv2-live ${realtimeState}`}><i />{realtimeState === 'online' ? 'Realtime' : realtimeState === 'connecting' ? 'Connecting' : 'Offline'}</div></header>
      {error && <div className="vps-error">API: {error}</div>}
      {tab === 'overview' && <OverviewPage overview={overview} organizations={organizations} products={products} installations={installations} commands={commands} realtimeState={realtimeState} onRefresh={() => void refresh()} onNavigate={(target) => setTab(target)} />}
      {tab === 'organizations' && <OrganizationsPage user={user} organizations={organizations} organizationProducts={organizationProducts} installations={installations} canManage={canManage} onChanged={refresh} onNavigate={setTab} />}
      {tab !== 'overview' && tab !== 'organizations' && <ModuleLanding tab={tab} onOpenLegacy={() => openLegacy(tab)} />}
    </main>
  </div>;
}
