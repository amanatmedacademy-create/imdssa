import { useCallback, useEffect, useState } from 'react';
import { OverviewPage } from './OverviewPage';

type User = { id: string; email: string; fullName: string; role: string; scope: 'platform' | 'tenant' };
type OverviewSnapshot = { organizations: number; products: number; modules: number; installations: number; platform_users: number; sync_pending: number };
type Organization = { id: string; name: string; status: string };
type Product = { id: string; code: string; name: string; status: string; last_health: string; last_heartbeat_at: string | null; last_latency_ms?: number | null; last_error?: string | null; tenants: number };
type Installation = { id: string; status: string; sync_status: string };
type ControlCommand = { id: string; command_type: string; status: string; attempts: number; last_error: string | null; organization_name: string; product_name: string; product_code: string; created_at: string };
type RealtimeState = 'connecting' | 'online' | 'offline';
type Target = 'organizations' | 'products' | 'modules' | 'sync';

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

const legacyTabIndex: Record<Target, number> = { organizations: 1, products: 3, modules: 4, sync: 6 };

export function OverviewPreviewApp() {
  const [user, setUser] = useState<User | null>(null);
  const [overview, setOverview] = useState<OverviewSnapshot | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [commands, setCommands] = useState<ControlCommand[]>([]);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    const me = await api<{ user: User }>('/api/auth/me');
    setUser(me.user);
    const root = me.user.scope === 'tenant' ? '/api/tenant/v1' : '/api/v1';
    const [snapshot, organizationList, productList, installationList, commandList] = await Promise.all([
      api<OverviewSnapshot>(`${root}/overview`),
      api<{ items: Organization[] }>(`${root}/organizations`),
      api<{ items: Product[] }>(`${root}/products`),
      api<{ items: Installation[] }>(`${root}/installations`),
      api<{ items: ControlCommand[] }>(`${root}/control-commands`),
    ]);
    setOverview(snapshot);
    setOrganizations(organizationList.items);
    setProducts(productList.items);
    setInstallations(installationList.items);
    setCommands(commandList.items);
  }, []);

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки')).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const stream = new EventSource('/events');
    stream.addEventListener('ready', () => setRealtimeState('online'));
    stream.addEventListener('update', () => { setRealtimeState('online'); void refresh().catch(() => undefined); });
    stream.onerror = () => setRealtimeState('offline');
    return () => stream.close();
  }, [refresh, user]);

  const navigate = (target: Target) => {
    sessionStorage.setItem('imdssa:legacy-tab-index', String(legacyTabIndex[target]));
    window.location.href = '/';
  };

  if (loading) return <main className="overview-preview-state">Загрузка нового обзора…</main>;
  if (!user) return <main className="overview-preview-state"><strong>Требуется авторизация</strong><a href="/">Вернуться к входу</a></main>;

  return <div className="overview-preview-shell">
    <header className="overview-preview-header">
      <div><span>IMDS CONTROL CENTER</span><h1>Обзор платформы</h1><p>Новая структура главного экрана · VPS-only · PostgreSQL</p></div>
      <div><a href="/">Вернуться в Control Center</a></div>
    </header>
    {error && <div className="overview-preview-error">{error}</div>}
    <OverviewPage overview={overview} organizations={organizations} products={products} installations={installations} commands={commands} realtimeState={realtimeState} onRefresh={() => void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Ошибка обновления'))} onNavigate={navigate} />
  </div>;
}
