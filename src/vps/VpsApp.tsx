import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import './vps.css';

type User = { id: string; email: string; fullName: string; role: string };
type Overview = { organizations: number; products: number; modules: number; installations: number; platform_users: number };
type Organization = { id: string; name: string; legal_name: string | null; bin: string | null; city: string | null; status: string };
type Product = { id: string; code: string; name: string; status: string; version: string | null; last_health: string; last_heartbeat_at: string | null; tenants: number };
type Module = { id: string; code: string; name: string; status: string; current_version: string | null; owner_product_name: string | null };
type Installation = { id: string; organization_name: string; module_name: string; host_product_name: string; status: string; health: string; updated_at: string };
type Tab = 'overview' | 'organizations' | 'products' | 'modules' | 'installations' | 'realtime';
type RealtimeState = 'connecting' | 'online' | 'offline';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'organizations', label: 'Организации' },
  { id: 'products', label: 'Продукты' },
  { id: 'modules', label: 'Модули' },
  { id: 'installations', label: 'Установки' },
  { id: 'realtime', label: 'События' },
];

const tabTitles: Record<Tab, string> = {
  overview: 'Обзор платформы',
  organizations: 'Организации',
  products: 'Продукты',
  modules: 'Модули',
  installations: 'Установки модулей',
  realtime: 'События в реальном времени',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function Login({ onReady }: { onReady: (user: User) => void }) {
  const [email, setEmail] = useState('admin@imds.kz');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      onReady(result.user);
    } catch (e) {
      setError(e instanceof Error ? `Ошибка входа: ${e.message}` : 'Ошибка входа.');
    }
  };

  return (
    <main className="vps-login">
      <form className="vps-login-card" onSubmit={submit}>
        <div className="vps-brand"><b>IMDS</b><span>Super Admin</span></div>
        <div className="vps-login-copy"><span>CONTROL PLANE</span><h1>Вход в платформу</h1><p>Локальный VPS · PostgreSQL · realtime</p></div>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required /></label>
        <label>Пароль<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>
        {error && <div className="vps-error">{error}</div>}
        <button className="vps-primary" type="submit">Войти</button>
      </form>
    </main>
  );
}

function Status({ value }: { value: string }) {
  const normalized = value || 'unknown';
  return <span className={`vps-status ${normalized}`}>{normalized.toUpperCase()}</span>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="vps-empty"><div className="vps-empty-mark">—</div><div><strong>{title}</strong><p>{text}</p></div></div>;
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <article className="vps-metric"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</article>;
}

export function VpsApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting');

  const refresh = useCallback(async () => {
    try {
      const [o, org, prod, mod, inst] = await Promise.all([
        api<Overview>('/api/v1/overview'),
        api<{ items: Organization[] }>('/api/v1/organizations'),
        api<{ items: Product[] }>('/api/v1/products'),
        api<{ items: Module[] }>('/api/v1/modules'),
        api<{ items: Installation[] }>('/api/v1/installations'),
      ]);
      setOverview(o);
      setOrganizations(org.items);
      setProducts(prod.items);
      setModules(mod.items);
      setInstallations(inst.items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка API');
    }
  }, []);

  useEffect(() => {
    api<{ user: User }>('/api/auth/me').then((x) => setUser(x.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh();
    const es = new EventSource('/events');
    es.addEventListener('ready', () => setRealtimeState('online'));
    es.addEventListener('update', (event) => {
      setRealtimeState('online');
      try { setEvents((value) => [JSON.parse((event as MessageEvent).data), ...value].slice(0, 50)); } catch {}
      void refresh();
    });
    es.onerror = () => setRealtimeState('offline');
    return () => es.close();
  }, [user, refresh]);

  const healthyProducts = useMemo(() => products.filter((product) => product.last_health === 'healthy').length, [products]);
  const activeOrganizations = useMemo(() => organizations.filter((organization) => organization.status === 'active').length, [organizations]);

  if (loading) return <div className="vps-loading">Проверка доступа…</div>;
  if (!user) return <Login onReady={setUser} />;

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  return (
    <div className="vps-shell">
      <aside className="vps-sidebar">
        <div className="vps-brand"><b>IMDS</b><span>Super Admin</span></div>
        <nav>
          {tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </nav>
        <div className="vps-user">
          <strong>{user.fullName}</strong>
          <span>{user.email}</span>
          <small>{user.role}</small>
          <button onClick={() => void logout()}>Выйти</button>
        </div>
      </aside>

      <main className="vps-content">
        <header className="vps-header">
          <div><span className="vps-eyebrow">VPS CONTROL PLANE</span><h1>{tabTitles[tab]}</h1></div>
          <div className={`vps-live ${realtimeState}`}><i />{realtimeState === 'online' ? 'REALTIME' : realtimeState === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</div>
        </header>

        {error && <div className="vps-error">API: {error}</div>}

        {tab === 'overview' && <>
          <section className="vps-metrics">
            <Metric label="Организации" value={overview?.organizations ?? 0} hint={`${activeOrganizations} активных`} />
            <Metric label="Продукты" value={overview?.products ?? 0} hint={`${healthyProducts} healthy`} />
            <Metric label="Модули" value={overview?.modules ?? 0} hint="опубликовано" />
            <Metric label="Установки" value={overview?.installations ?? 0} hint="активных" />
            <Metric label="Пользователи платформы" value={overview?.platform_users ?? 0} hint="активных" />
          </section>
          <section className="vps-card">
            <div className="vps-card-head"><div><span>МОНИТОРИНГ</span><h2>Состояние продуктов</h2></div></div>
            {products.length === 0 ? <EmptyState title="Продукты пока не подключены" text="После подключения первого product adapter здесь появятся его статус, версия, heartbeat и количество организаций." /> :
              <div className="vps-table-wrap"><table><thead><tr><th>Продукт</th><th>Версия</th><th>Организации</th><th>Heartbeat</th><th>Health</th></tr></thead><tbody>{products.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.code}</small></td><td>{p.version || '—'}</td><td>{p.tenants}</td><td>{p.last_heartbeat_at ? new Date(p.last_heartbeat_at).toLocaleString('ru-RU') : 'Нет данных'}</td><td><Status value={p.last_health || 'unknown'} /></td></tr>)}</tbody></table></div>}
          </section>
        </>}

        {tab === 'organizations' && <section className="vps-card"><div className="vps-card-head"><div><span>КЛИЕНТСКИЙ КОНТУР</span><h2>Организации</h2></div></div>{organizations.length === 0 ? <EmptyState title="Организаций пока нет" text="Здесь будут отображаться реальные клиники и компании, зарегистрированные в control plane." /> : <div className="vps-table-wrap"><table><thead><tr><th>Организация</th><th>Город</th><th>Статус</th></tr></thead><tbody>{organizations.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.bin || 'БИН не указан'}</small></td><td>{x.city || '—'}</td><td><Status value={x.status} /></td></tr>)}</tbody></table></div>}</section>}

        {tab === 'products' && <section className="vps-card"><div className="vps-card-head"><div><span>PRODUCT REGISTRY</span><h2>Продукты IMDS</h2></div></div>{products.length === 0 ? <EmptyState title="Нет зарегистрированных продуктов" text="Control plane не создаёт демонстрационные записи. После подключения реального продукта он появится здесь автоматически." /> : <div className="vps-table-wrap"><table><thead><tr><th>Продукт</th><th>Версия</th><th>Статус</th><th>Health</th></tr></thead><tbody>{products.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.code}</small></td><td>{x.version || '—'}</td><td><Status value={x.status} /></td><td><Status value={x.last_health} /></td></tr>)}</tbody></table></div>}</section>}

        {tab === 'modules' && <section className="vps-card"><div className="vps-card-head"><div><span>MODULE CATALOG</span><h2>Модули</h2></div></div>{modules.length === 0 ? <EmptyState title="Модули не зарегистрированы" text="Здесь появятся реальные модули после публикации в каталоге control plane." /> : <div className="vps-table-wrap"><table><thead><tr><th>Модуль</th><th>Продукт</th><th>Версия</th><th>Статус</th></tr></thead><tbody>{modules.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.code}</small></td><td>{x.owner_product_name || '—'}</td><td>{x.current_version || '—'}</td><td><Status value={x.status} /></td></tr>)}</tbody></table></div>}</section>}

        {tab === 'installations' && <section className="vps-card"><div className="vps-card-head"><div><span>RUNTIME</span><h2>Установки модулей</h2></div></div>{installations.length === 0 ? <EmptyState title="Активных установок нет" text="После установки модуля в организацию здесь будет виден его runtime status и health." /> : <div className="vps-table-wrap"><table><thead><tr><th>Организация / модуль</th><th>Host product</th><th>Статус</th><th>Health</th></tr></thead><tbody>{installations.map((x) => <tr key={x.id}><td><strong>{x.organization_name}</strong><small>{x.module_name}</small></td><td>{x.host_product_name}</td><td><Status value={x.status} /></td><td><Status value={x.health} /></td></tr>)}</tbody></table></div>}</section>}

        {tab === 'realtime' && <section className="vps-card"><div className="vps-card-head"><div><span>EVENT STREAM</span><h2>События</h2></div><Status value={realtimeState === 'online' ? 'healthy' : realtimeState === 'offline' ? 'offline' : 'unknown'} /></div>{events.length === 0 ? <EmptyState title="Ожидание событий" text="Подключение к realtime-каналу активно. Новые изменения PostgreSQL появятся здесь без обновления страницы." /> : <pre className="vps-events">{events.map((event, index) => `${index + 1}. ${JSON.stringify(event, null, 2)}\n`).join('\n')}</pre>}</section>}
      </main>
    </div>
  );
}
