import {
  Activity,
  AlertTriangle,
  AppWindow,
  BadgeDollarSign,
  Bell,
  Boxes,
  Building2,
  ChevronRight,
  CircleDollarSign,
  CloudCog,
  FileCheck2,
  Gauge,
  Headphones,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LockKeyhole,
  Network,
  PackageCheck,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Webhook,
} from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Product, ProductRegistryPage, useProductRegistry } from './productRegistry';

const nav = [
  { to: '/', label: 'Обзор', icon: LayoutDashboard },
  { to: '/companies', label: 'Компании', icon: Building2 },
  { to: '/products', label: 'Продукты', icon: Boxes },
  { to: '/subscriptions', label: 'Подписки', icon: BadgeDollarSign },
  { to: '/users', label: 'Пользователи', icon: Users },
  { to: '/integrations', label: 'Интеграции', icon: Network },
  { to: '/operations', label: 'Операции', icon: Activity },
  { to: '/audit', label: 'Аудит', icon: ShieldCheck },
  { to: '/support', label: 'Поддержка', icon: Headphones },
  { to: '/settings', label: 'Настройки', icon: Settings },
];

const companies = [
  { name: 'Amanat Medical Center', city: 'Алматы', products: 6, users: 84, plan: 'Enterprise', health: 94 },
  { name: 'Orda Clinic', city: 'Астана', products: 4, users: 31, plan: 'Business', health: 82 },
  { name: 'Sapa Med', city: 'Шымкент', products: 3, users: 22, plan: 'Business', health: 68 },
  { name: 'Nova Health', city: 'Алматы', products: 2, users: 12, plan: 'Start', health: 57 },
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">I</div>
          <div>
            <strong>IMDS</strong>
            <span>Super Admin</span>
          </div>
        </div>
        <nav>
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="environment"><span /> Production</div>
          <small>Control plane v0.2.0</small>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="search"><Search size={17} /><input placeholder="Компания, БИН, пользователь, tenant ID..." /></div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Уведомления"><Bell size={18} /><span className="notification-dot" /></button>
            <div className="profile"><div className="avatar">SA</div><div><strong>Super Admin</strong><span>platform_owner</span></div></div>
          </div>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value, note }: { icon: React.ElementType; label: string; value: string; note: string }) {
  return <article className="metric-card"><div className="metric-icon"><Icon size={21} /></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

function StatusBadge({ value }: { value: Product['status'] }) {
  return <span className={`status ${value === 'Работает' ? 'ok' : value === 'Деградация' ? 'warn' : 'muted'}`}>{value}</span>;
}

function Dashboard({ products }: { products: Product[] }) {
  const activeProducts = products.filter((product) => !product.archivedAt);

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Платформа</span><h1>Центр управления IMDS</h1><p>Компании, продукты, лицензии, инфраструктура и операционный контроль.</p></div><button className="primary-button"><Building2 size={17} /> Создать компанию</button></div>
      <section className="metrics">
        <Metric icon={Building2} label="Активные компании" value="68" note="+6 за 30 дней" />
        <Metric icon={Users} label="Пользователи" value="1 284" note="1 042 активны" />
        <Metric icon={PackageCheck} label="Активные лицензии" value="219" note={`${activeProducts.length} продуктов в реестре`} />
        <Metric icon={CircleDollarSign} label="MRR" value="₸ 18,4 млн" note="+12,6% к прошлому месяцу" />
      </section>
      <section className="content-grid">
        <article className="panel span-2">
          <div className="panel-header"><div><h2>Состояние продуктов</h2><p>Версии, tenants и доступность сервисов</p></div><NavLink to="/products">Все продукты <ChevronRight size={16} /></NavLink></div>
          <div className="product-grid">
            {activeProducts.slice(0, 6).map((product) => <div className="product-card" key={product.id}><div className="product-symbol"><AppWindow size={20} /></div><div className="product-info"><strong>{product.name}</strong><span>{product.tenants} компаний · v{product.version}</span></div><StatusBadge value={product.status} /></div>)}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header"><div><h2>Операционный контроль</h2><p>Требует внимания</p></div></div>
          <div className="alerts">
            <div className="alert critical"><AlertTriangle size={18} /><div><strong>Meta Ads API</strong><span>Повышенный процент ошибок: 8,4%</span></div></div>
            <div className="alert"><Webhook size={18} /><div><strong>12 failed webhooks</strong><span>Ожидают повторной обработки</span></div></div>
            <div className="alert"><KeyRound size={18} /><div><strong>7 токенов истекают</strong><span>В течение ближайших 14 дней</span></div></div>
            <div className="alert"><BadgeDollarSign size={18} /><div><strong>4 просроченные подписки</strong><span>Общая сумма ₸ 940 000</span></div></div>
          </div>
        </article>
        <article className="panel span-2">
          <div className="panel-header"><div><h2>Компании</h2><p>Customer health и подключённые продукты</p></div><NavLink to="/companies">Открыть реестр <ChevronRight size={16} /></NavLink></div>
          <div className="table-wrap"><table><thead><tr><th>Компания</th><th>Тариф</th><th>Продукты</th><th>Пользователи</th><th>Health</th><th /></tr></thead><tbody>{companies.map((company) => <tr key={company.name}><td><strong>{company.name}</strong><span>{company.city}</span></td><td>{company.plan}</td><td>{company.products}</td><td>{company.users}</td><td><div className="health"><div><span style={{ width: `${company.health}%` }} /></div><b>{company.health}%</b></div></td><td><button className="row-button"><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div>
        </article>
        <article className="panel">
          <div className="panel-header"><div><h2>Быстрые действия</h2><p>Без перехода между разделами</p></div></div>
          <div className="quick-actions">
            <button><Building2 size={18} /><span><strong>Новая компания</strong><small>Создать tenant и владельца</small></span></button>
            <button><PackageCheck size={18} /><span><strong>Выдать лицензию</strong><small>Подключить продукт или trial</small></span></button>
            <button><LockKeyhole size={18} /><span><strong>Support session</strong><small>Безопасный вход от имени клиента</small></span></button>
            <button><CloudCog size={18} /><span><strong>Incident mode</strong><small>Ограничить проблемный сервис</small></span></button>
          </div>
        </article>
      </section>
    </>
  );
}

function Placeholder({ title, description, icon: Icon }: { title: string; description: string; icon: React.ElementType }) {
  return <><div className="page-heading"><div><span className="eyebrow">IMDS Control Plane</span><h1>{title}</h1><p>{description}</p></div></div><div className="empty-state"><div><Icon size={34} /></div><h2>Раздел подготовлен в архитектуре</h2><p>Следующий этап — подключение Supabase, RLS, API-команд и реальных данных.</p><button className="primary-button"><SlidersHorizontal size={17} /> Настроить модуль</button></div></>;
}

export function App() {
  const { products, setProducts } = useProductRegistry();

  return <Shell><Routes><Route path="/" element={<Dashboard products={products} />} /><Route path="/products" element={<ProductRegistryPage products={products} onChange={setProducts} />} /><Route path="/companies" element={<Placeholder title="Компании и tenants" description="Холдинги, юридические лица, филиалы, владельцы и статусы доступа." icon={Building2} />} /><Route path="/subscriptions" element={<Placeholder title="Тарифы и подписки" description="Лицензии, счета, платежи, grace period и лимиты использования." icon={BadgeDollarSign} />} /><Route path="/users" element={<Placeholder title="Identity Directory" description="Единый каталог пользователей, ролей, продуктов и филиалов." icon={Users} />} /><Route path="/integrations" element={<Placeholder title="Интеграции" description="API-адаптеры, webhooks, секреты, токены и фоновые синхронизации." icon={Network} />} /><Route path="/operations" element={<Placeholder title="Operations Center" description="Мониторинг, очереди, релизы, incidents и command center." icon={Gauge} />} /><Route path="/audit" element={<Placeholder title="Аудит и безопасность" description="Неизменяемый журнал действий, approvals и break-glass access." icon={FileCheck2} />} /><Route path="/support" element={<Placeholder title="Customer Success и Support" description="Онбординг, обращения, SLA, диагностика и health score." icon={LifeBuoy} />} /><Route path="/settings" element={<Placeholder title="Настройки платформы" description="Роли, feature flags, окружения, уведомления и политики хранения." icon={Settings} />} /></Routes></Shell>;
}
