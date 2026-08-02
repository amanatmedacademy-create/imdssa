import {
  Activity, AlertTriangle, AppWindow, BadgeDollarSign, Bell, Boxes, Building2, ChevronRight,
  CircleDollarSign, CloudCog, Gauge, Headphones, LayoutDashboard, LockKeyhole,
  LogOut, Network, PackageCheck, ReceiptText, Search, Settings, ShieldAlert, ShieldCheck,
  SlidersHorizontal, Users, Webhook,
} from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './core/auth';
import type { Permission } from './core/permissions';
import { roleLabels } from './core/permissions';
import { useBilling } from './features/billing/BillingContext';
import { SubscriptionsPage } from './features/billing/SubscriptionsPage';
import { BillingOperationsPage } from './features/billingOperations/BillingOperationsPage';
import { IdentityDirectoryPage } from './features/identity/IdentityDirectoryPage';
import { ObservabilityPage } from './features/observability/ObservabilityPage';
import { CompaniesPage } from './features/organizations/CompaniesPage';
import { OperationsPage } from './features/operations/OperationsPage';
import { useProductCatalog } from './features/products/ProductCatalogContext';
import { ProductsPage } from './features/products/ProductsPage';
import type { ManagedProduct } from './features/products/productRepository';
import { SecurityCenterPage } from './features/security/SecurityCenterPage';
import { useSecurity } from './features/security/SecurityContext';
import { SupportPage } from './features/support/SupportPage';
import { env } from './lib/env';

type NavigationItem = { to: string; label: string; icon: React.ElementType; permission: Permission };

const nav: NavigationItem[] = [
  { to: '/', label: 'Обзор', icon: LayoutDashboard, permission: 'dashboard.read' },
  { to: '/companies', label: 'Компании', icon: Building2, permission: 'organizations.read' },
  { to: '/products', label: 'Продукты', icon: Boxes, permission: 'products.read' },
  { to: '/subscriptions', label: 'Подписки', icon: BadgeDollarSign, permission: 'subscriptions.read' },
  { to: '/billing', label: 'Биллинг', icon: ReceiptText, permission: 'billing.operations.read' },
  { to: '/users', label: 'Пользователи', icon: Users, permission: 'users.read' },
  { to: '/integrations', label: 'Интеграции', icon: Network, permission: 'integrations.read' },
  { to: '/operations', label: 'Операции', icon: Activity, permission: 'operations.read' },
  { to: '/observability', label: 'Мониторинг', icon: Gauge, permission: 'observability.read' },
  { to: '/security', label: 'Безопасность', icon: ShieldCheck, permission: 'security.read' },
  { to: '/support', label: 'Поддержка', icon: Headphones, permission: 'support.read' },
  { to: '/settings', label: 'Настройки', icon: Settings, permission: 'settings.read' },
];

const companies = [
  { name: 'Amanat Medical Center', city: 'Алматы', products: 6, users: 84, plan: 'Enterprise', health: 94 },
  { name: 'Orda Clinic', city: 'Астана', products: 4, users: 31, plan: 'Business', health: 82 },
  { name: 'Sapa Med', city: 'Шымкент', products: 3, users: 22, plan: 'Business', health: 68 },
  { name: 'Nova Health', city: 'Алматы', products: 2, users: 12, plan: 'Start', health: 57 },
];

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2)).toUpperCase();
}

function Shell({ children }: { children: React.ReactNode }) {
  const { profile, role, can, isDemo, signOut } = useAuth();
  const visibleNavigation = nav.filter((item) => can(item.permission));
  const displayName = profile?.full_name || profile?.email || 'Super Admin';
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">I</div><div><strong>IMDS</strong><span>Super Admin</span></div></div>
      <nav>{visibleNavigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-footer"><div className={`environment ${isDemo ? 'demo' : ''}`}><span/> {isDemo ? 'Demo mode' : env.appEnv}</div><small>Control plane v{env.appVersion}</small></div>
    </aside>
    <main className="main"><header className="topbar"><div className="search"><Search size={17}/><input placeholder="Компания, БИН, пользователь, tenant ID..."/></div><div className="top-actions"><button className="icon-button" aria-label="Уведомления"><Bell size={18}/><span className="notification-dot"/></button><div className="profile"><div className="avatar">{initials(displayName)}</div><div><strong>{displayName}</strong><span>{role ? roleLabels[role] : 'Нет роли'}</span></div></div>{!isDemo && <button className="icon-button" type="button" aria-label="Выйти" title="Выйти" onClick={() => void signOut()}><LogOut size={18}/></button>}</div></header><div className="page">{children}</div></main>
  </div>;
}

function RequirePermission({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;
  return <div className="access-denied"><div><ShieldAlert size={34}/></div><span className="eyebrow">RBAC</span><h1>Недостаточно прав</h1><p>Текущая глобальная роль не разрешает открывать этот раздел.</p><NavLink className="primary-button" to="/">Вернуться на обзор</NavLink></div>;
}

function Metric({ icon: Icon, label, value, note }: { icon: React.ElementType; label: string; value: string; note: string }) {
  return <article className="metric-card"><div className="metric-icon"><Icon size={21}/></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

function StatusBadge({ value }: { value: ManagedProduct['status'] }) {
  const label = value === 'active' ? 'Работает' : value === 'degraded' ? 'Деградация' : value === 'maintenance' ? 'Техработы' : value === 'disabled' ? 'Отключён' : 'Настройка';
  const className = value === 'active' ? 'ok' : value === 'degraded' || value === 'maintenance' ? 'warn' : 'muted';
  return <span className={`status ${className}`}>{label}</span>;
}

function formatKzt(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(value);
}

function Dashboard() {
  const { can, isDemo } = useAuth();
  const { products, loading: productsLoading, error: productsError } = useProductCatalog();
  const { subscriptions, loading: billingLoading, error: billingError } = useBilling();
  const { requests: securityRequests, sessions: securitySessions, error: securityError } = useSecurity();
  const activeProducts = products.filter((product) => !product.archivedAt);
  const activeLicenses = subscriptions.reduce((sum, subscription) => sum + subscription.licenses.filter((license) => license.status !== 'revoked').length, 0);
  const mrr = subscriptions.filter((subscription) => subscription.status === 'active').reduce((sum, subscription) => sum + (subscription.billingInterval === 'annual' ? subscription.effectivePrice / 12 : subscription.billingInterval === 'monthly' ? subscription.effectivePrice : 0), 0);
  const pendingApprovals = securityRequests.filter((request) => request.status === 'pending').length;
  const activePrivilegedSessions = securitySessions.filter((session) => session.status === 'active').length;
  const problemSubscriptions = subscriptions.filter((subscription) => ['past_due', 'grace_period'].includes(subscription.status)).length;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Платформа</span><h1>Центр управления IMDS</h1><p>Компании, продукты, лицензии, инфраструктура и операционный контроль.</p></div>{can('organizations.create') && <NavLink className="primary-button" to="/companies"><Building2 size={17}/> Создать компанию</NavLink>}</div>
    {isDemo && <div className="mode-banner"><ShieldCheck size={18}/><div><strong>Интерфейс работает в демо-режиме</strong><span>Укажите Supabase URL и anon key, примените миграции и создайте platform_owner для включения production-контроля.</span></div></div>}
    {(productsError || billingError || securityError) && <div className="error-banner"><AlertTriangle size={18}/><span>{productsError ?? billingError ?? securityError}</span></div>}
    <section className="metrics"><Metric icon={Building2} label="Активные компании" value="68" note="+6 за 30 дней"/><Metric icon={Users} label="Пользователи" value="1 284" note="1 042 активны"/><Metric icon={PackageCheck} label="Активные лицензии" value={billingLoading ? '…' : String(activeLicenses)} note={productsLoading ? 'загрузка каталога...' : `${activeProducts.length} продуктов в реестре`}/><Metric icon={CircleDollarSign} label="Расчётный MRR" value={billingLoading ? '…' : formatKzt(mrr)} note="без custom interval"/></section>
    <section className="content-grid">
      <article className="panel span-2"><div className="panel-header"><div><h2>Состояние продуктов</h2><p>Версии, tenants, адаптеры и доступность сервисов</p></div><NavLink to="/products">Все продукты <ChevronRight size={16}/></NavLink></div><div className="product-grid">{activeProducts.slice(0, 6).map((product) => <div className="product-card" key={product.id}><div className="product-symbol"><AppWindow size={20}/></div><div className="product-info"><strong>{product.name}</strong><span>{product.tenants} компаний · v{product.version || '—'} · {product.adapter ? `adapter ${product.adapter.contractVersion}` : 'без адаптера'}</span></div><StatusBadge value={product.status}/></div>)}{!productsLoading && activeProducts.length === 0 && <div className="dashboard-empty">Product Registry пуст.</div>}</div></article>
      <article className="panel"><div className="panel-header"><div><h2>Операционный контроль</h2><p>Требует внимания</p></div></div><div className="alerts"><NavLink className="alert critical" to="/observability"><AlertTriangle size={18}/><div><strong>Meta Ads API</strong><span>Повышенный процент ошибок: 8,4%</span></div></NavLink><NavLink className="alert" to="/security"><ShieldAlert size={18}/><div><strong>{pendingApprovals} заявок на согласование</strong><span>{activePrivilegedSessions} привилегированных сессий активны</span></div></NavLink><div className="alert"><Webhook size={18}/><div><strong>12 failed webhooks</strong><span>Ожидают повторной обработки</span></div></div><NavLink className="alert" to="/billing"><BadgeDollarSign size={18}/><div><strong>{problemSubscriptions} проблемных подписок</strong><span>Проверить счета и поступления</span></div></NavLink></div></article>
      <article className="panel span-2"><div className="panel-header"><div><h2>Компании</h2><p>Customer health и подключённые продукты</p></div><NavLink to="/companies">Открыть реестр <ChevronRight size={16}/></NavLink></div><div className="table-wrap"><table><thead><tr><th>Компания</th><th>Тариф</th><th>Продукты</th><th>Пользователи</th><th>Health</th><th/></tr></thead><tbody>{companies.map((company) => <tr key={company.name}><td><strong>{company.name}</strong><span>{company.city}</span></td><td>{company.plan}</td><td>{company.products}</td><td>{company.users}</td><td><div className="health"><div><span style={{ width: `${company.health}%` }}/></div><b>{company.health}%</b></div></td><td><button className="row-button"><ChevronRight size={16}/></button></td></tr>)}</tbody></table></div></article>
      <article className="panel"><div className="panel-header"><div><h2>Быстрые действия</h2><p>Без перехода между разделами</p></div></div><div className="quick-actions"><NavLink to="/companies"><Building2 size={18}/><span><strong>Новая компания</strong><small>Создать tenant и владельца</small></span></NavLink><NavLink to="/subscriptions"><PackageCheck size={18}/><span><strong>Выдать лицензию</strong><small>Активировать тариф и продукты</small></span></NavLink><NavLink to="/billing"><ReceiptText size={18}/><span><strong>Выставить счёт</strong><small>Счета, платежи и задолженность</small></span></NavLink><NavLink to="/security"><LockKeyhole size={18}/><span><strong>Support session</strong><small>Запросить согласованный вход</small></span></NavLink><NavLink to="/observability"><CloudCog size={18}/><span><strong>Incident Center</strong><small>Проверить сервисы и инциденты</small></span></NavLink></div></article>
    </section>
  </>;
}

function Placeholder({ title, description, icon: Icon }: { title: string; description: string; icon: React.ElementType }) {
  return <><div className="page-heading"><div><span className="eyebrow">IMDS Control Plane</span><h1>{title}</h1><p>{description}</p></div></div><div className="empty-state"><div><Icon size={34}/></div><h2>Раздел подготовлен в архитектуре</h2><p>Модуль будет подключён к Supabase, RLS, API-командам и реальным данным на следующем этапе.</p><button className="primary-button"><SlidersHorizontal size={17}/> Настроить модуль</button></div></>;
}

export function App() {
  return <Shell><Routes>
    <Route path="/" element={<RequirePermission permission="dashboard.read"><Dashboard/></RequirePermission>}/>
    <Route path="/companies" element={<RequirePermission permission="organizations.read"><CompaniesPage/></RequirePermission>}/>
    <Route path="/products" element={<RequirePermission permission="products.read"><ProductsPage/></RequirePermission>}/>
    <Route path="/subscriptions" element={<RequirePermission permission="subscriptions.read"><SubscriptionsPage/></RequirePermission>}/>
    <Route path="/billing" element={<RequirePermission permission="billing.operations.read"><BillingOperationsPage/></RequirePermission>}/>
    <Route path="/users" element={<RequirePermission permission="users.read"><IdentityDirectoryPage/></RequirePermission>}/>
    <Route path="/integrations" element={<RequirePermission permission="integrations.read"><Placeholder title="Интеграции" description="API-адаптеры, webhooks, секреты, токены и фоновые синхронизации." icon={Network}/></RequirePermission>}/>
    <Route path="/operations" element={<RequirePermission permission="operations.read"><OperationsPage/></RequirePermission>}/>
    <Route path="/observability" element={<RequirePermission permission="observability.read"><ObservabilityPage/></RequirePermission>}/>
    <Route path="/security" element={<RequirePermission permission="security.read"><SecurityCenterPage/></RequirePermission>}/>
    <Route path="/audit" element={<RequirePermission permission="security.read"><SecurityCenterPage/></RequirePermission>}/>
    <Route path="/support" element={<RequirePermission permission="support.read"><SupportPage/></RequirePermission>}/>
    <Route path="/settings" element={<RequirePermission permission="settings.read"><Placeholder title="Настройки платформы" description="Роли, feature flags, окружения, уведомления и политики хранения." icon={Settings}/></RequirePermission>}/>
  </Routes></Shell>;
}
