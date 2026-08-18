import {
  Activity,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  CircleAlert,
  Database,
  HardDrive,
  Layers3,
  MemoryStick,
  RefreshCw,
  Server,
  ServerCog,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import './overviewPage.css';

type OverviewSnapshot = {
  organizations: number;
  products: number;
  modules: number;
  installations: number;
  platform_users: number;
  sync_pending: number;
};

type Organization = { id: string; name: string; status: string };
type Product = { id: string; code: string; name: string; status: string; last_health: string; last_heartbeat_at: string | null; last_latency_ms?: number | null; last_error?: string | null; tenants: number };
type Installation = { id: string; status: string; sync_status: string };
type ControlCommand = { id: string; command_type: string; status: string; attempts: number; last_error: string | null; organization_name: string; product_name: string; product_code: string; created_at: string };
type InfrastructureSnapshot = {
  host: { hostname: string; uptimeSeconds: number; cpuPercent: number; memory: { total: number; used: number; percent: number }; disk: { total: number; used: number; percent: number } };
  database: { database: string; connections: number; active_connections: number };
  services: Array<{ key: string; label: string; active: string }>;
  ports: Array<{ exposure: 'public' | 'loopback' | 'private' | 'unknown' }>;
};

type RealtimeState = 'connecting' | 'online' | 'offline';
type OverviewTarget = 'organizations' | 'products' | 'modules' | 'sync';

type Props = {
  overview: OverviewSnapshot | null;
  organizations: Organization[];
  products: Product[];
  installations: Installation[];
  commands: ControlCommand[];
  infrastructure: InfrastructureSnapshot | null;
  realtimeState: RealtimeState;
  onRefresh: () => void;
  onNavigate: (target: OverviewTarget) => void;
};

const healthLabel: Record<string, string> = { healthy: 'Работает', degraded: 'Деградация', offline: 'Офлайн', unavailable: 'Недоступен', unknown: 'Нет данных' };

function HealthPill({ value }: { value: string }) {
  const normalized = value || 'unknown';
  return <span className={`overview-health overview-health-${normalized}`}>{healthLabel[normalized] || normalized}</span>;
}

function Kpi({ icon: Icon, label, value, detail, tone = 'neutral' }: { icon: typeof Building2; label: string; value: string | number; detail: string; tone?: 'neutral' | 'good' | 'warn' }) {
  return <article className={`overview-kpi overview-kpi-${tone}`}><div className="overview-kpi-icon"><Icon size={18} /></div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function formatHeartbeat(value: string | null) {
  if (!value) return 'Сигнал не получен';
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatEventTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function duration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}д ${hours}ч`;
}

export function OverviewPage({ overview, organizations, products, installations, commands, infrastructure, realtimeState, onRefresh, onNavigate }: Props) {
  const activeOrganizations = organizations.filter((item) => item.status === 'active').length;
  const healthyProducts = products.filter((item) => item.last_health === 'healthy').length;
  const unhealthyProducts = products.filter((item) => ['offline', 'unavailable'].includes(item.last_health)).length;
  const degradedProducts = products.filter((item) => item.last_health === 'degraded').length;
  const pendingCommands = commands.filter((item) => ['pending', 'applying', 'retry'].includes(item.status));
  const failedCommands = commands.filter((item) => item.status === 'failed');
  const activeInstallations = installations.filter((item) => item.status === 'active').length;
  const unsyncedInstallations = installations.filter((item) => item.sync_status && item.sync_status !== 'synced').length;
  const syncPending = overview?.sync_pending ?? 0;
  const healthyServices = infrastructure?.services.filter((item) => item.active === 'active').length ?? 0;
  const publicPorts = infrastructure?.ports.filter((item) => item.exposure === 'public').length ?? 0;
  const infrastructureWarn = Boolean(infrastructure && (infrastructure.host.cpuPercent >= 85 || infrastructure.host.memory.percent >= 90 || infrastructure.host.disk.percent >= 90 || healthyServices < infrastructure.services.length));

  const platformState = unhealthyProducts > 0 || failedCommands.length > 0
    ? { tone: 'danger', title: 'Требуется внимание', text: 'Есть недоступные продукты или ошибки команд управления.', icon: CircleAlert }
    : degradedProducts > 0 || syncPending > 0 || realtimeState !== 'online' || infrastructureWarn
      ? { tone: 'warn', title: 'Есть отклонения', text: 'Платформа работает, но есть незавершённая синхронизация, деградация или инфраструктурное предупреждение.', icon: Activity }
      : { tone: 'good', title: 'Контур стабилен', text: 'Control Center, продукты, инфраструктура и синхронизация работают без критичных отклонений.', icon: ShieldCheck };

  const orderedProducts = [...products].sort((a, b) => {
    const score = (value: string) => value === 'offline' || value === 'unavailable' ? 0 : value === 'degraded' ? 1 : value === 'unknown' ? 2 : 3;
    return score(a.last_health) - score(b.last_health);
  });
  const recentCommands = [...commands].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 5);
  const StateIcon = platformState.icon;

  return <section className="overview-page">
    <div className={`overview-status overview-status-${platformState.tone}`}><div className="overview-status-mark"><StateIcon size={20} /></div><div className="overview-status-copy"><span>СОСТОЯНИЕ ПЛАТФОРМЫ</span><strong>{platformState.title}</strong><p>{platformState.text}</p></div><div className="overview-status-meta"><span className={`overview-realtime overview-realtime-${realtimeState}`}><i />{realtimeState === 'online' ? 'Realtime online' : realtimeState === 'connecting' ? 'Подключение' : 'Realtime offline'}</span><button type="button" onClick={onRefresh}><RefreshCw size={15} />Обновить</button></div></div>

    <div className="overview-kpis">
      <Kpi icon={Building2} label="Организации" value={overview?.organizations ?? organizations.length} detail={`${activeOrganizations} активных`} tone="good" />
      <Kpi icon={ServerCog} label="Продукты" value={`${healthyProducts}/${overview?.products ?? products.length}`} detail={unhealthyProducts ? `${unhealthyProducts} недоступно` : degradedProducts ? `${degradedProducts} с деградацией` : 'в рабочем состоянии'} tone={unhealthyProducts || degradedProducts ? 'warn' : 'good'} />
      <Kpi icon={Layers3} label="Модули" value={overview?.modules ?? 0} detail={`${activeInstallations} активных установок`} />
      <Kpi icon={Workflow} label="Синхронизация" value={syncPending} detail={syncPending || unsyncedInstallations ? `${pendingCommands.length} команд в работе` : 'очередь чистая'} tone={syncPending || unsyncedInstallations ? 'warn' : 'good'} />
    </div>

    {infrastructure && <article className="overview-panel overview-infra-panel"><div className="overview-panel-head"><div><span>VPS INFRASTRUCTURE</span><h2>Инфраструктура</h2><p>{infrastructure.host.hostname} · PostgreSQL · systemd · локальный VPS</p></div><strong className={infrastructureWarn ? 'overview-infra-state warn' : 'overview-infra-state ok'}>{infrastructureWarn ? 'Требует внимания' : 'Стабильно'}</strong></div><div className="overview-infra-grid"><div><Server size={16} /><span>CPU</span><strong>{infrastructure.host.cpuPercent}%</strong></div><div><MemoryStick size={16} /><span>RAM</span><strong>{infrastructure.host.memory.percent}%</strong></div><div><HardDrive size={16} /><span>Disk</span><strong>{infrastructure.host.disk.percent}%</strong></div><div><ServerCog size={16} /><span>Services</span><strong>{healthyServices}/{infrastructure.services.length}</strong></div><div><Database size={16} /><span>DB connections</span><strong>{infrastructure.database.connections}</strong></div><div><Activity size={16} /><span>Uptime</span><strong>{duration(infrastructure.host.uptimeSeconds)}</strong></div></div><div className="overview-infra-foot"><span>{publicPorts} public listening ports</span><small>Подробные Metrics, Services, Logs, Database, Deployments, Domains, Variables & Secrets и Audit остаются отдельным разделом Infrastructure.</small></div></article>}

    <div className="overview-grid">
      <article className="overview-panel overview-panel-products"><div className="overview-panel-head"><div><span>PRODUCT HEALTH</span><h2>Состояние продуктов</h2><p>Heartbeat, задержка и доступность каждого продуктового контура.</p></div><button type="button" onClick={() => onNavigate('products')}>Все продукты <ArrowUpRight size={15} /></button></div>{orderedProducts.length === 0 ? <div className="overview-empty"><ServerCog size={22} /><strong>Продукты не зарегистрированы</strong><span>После подключения продукта здесь появится его состояние.</span></div> : <div className="overview-product-list">{orderedProducts.slice(0, 6).map((product) => <div className="overview-product-row" key={product.id}><div className="overview-product-name"><strong>{product.name}</strong><span>{product.code} · {product.tenants} орг.</span></div><div className="overview-product-signal"><strong>{product.last_latency_ms == null ? '—' : `${product.last_latency_ms} мс`}</strong><span>{formatHeartbeat(product.last_heartbeat_at)}</span></div><div className="overview-product-state"><HealthPill value={product.last_health || 'unknown'} />{product.last_error && <span className="overview-product-error">{product.last_error}</span>}</div></div>)}</div>}</article>

      <aside className="overview-panel overview-panel-control"><div className="overview-panel-head"><div><span>CONTROL PLANE</span><h2>Операционный контур</h2><p>Ключевые показатели управления платформой.</p></div></div><div className="overview-facts"><div><span><CheckCircle2 size={15} />Активные установки</span><strong>{overview?.installations ?? activeInstallations}</strong></div><div><span><Users size={15} />Пользователи платформы</span><strong>{overview?.platform_users ?? 0}</strong></div><div><span><Workflow size={15} />Команды в работе</span><strong>{pendingCommands.length}</strong></div><div className={failedCommands.length ? 'is-danger' : ''}><span><CircleAlert size={15} />Ошибки команд</span><strong>{failedCommands.length}</strong></div></div><div className="overview-control-note"><span>Источник истины</span><strong>Control Center · PostgreSQL</strong><small>Коммерческое состояние и entitlement управляются только центральным контуром.</small></div></aside>
    </div>

    <div className="overview-grid overview-grid-bottom">
      <article className="overview-panel"><div className="overview-panel-head"><div><span>RECENT CONTROL ACTIVITY</span><h2>Последние команды</h2><p>Самые свежие изменения, отправленные продуктовым контурам.</p></div><button type="button" onClick={() => onNavigate('sync')}>Синхронизация <ArrowUpRight size={15} /></button></div>{recentCommands.length === 0 ? <div className="overview-empty compact"><Workflow size={20} /><strong>Команд пока нет</strong><span>Новые изменения появятся здесь автоматически.</span></div> : <div className="overview-command-list">{recentCommands.map((command) => <div key={command.id} className="overview-command-row"><div><strong>{command.organization_name}</strong><span>{command.product_name} · {command.command_type}</span></div><div><span>{formatEventTime(command.created_at)}</span><strong className={`overview-command-state overview-command-${command.status}`}>{command.status}</strong></div></div>)}</div>}</article>

      <aside className="overview-panel overview-panel-shortcuts"><div className="overview-panel-head"><div><span>БЫСТРЫЙ ДОСТУП</span><h2>Управление</h2><p>Переход к основным объектам платформы.</p></div></div><div className="overview-shortcuts"><button type="button" onClick={() => onNavigate('organizations')}><Building2 size={17} /><span><strong>Организации</strong><small>Клиники и компании</small></span><ArrowUpRight size={15} /></button><button type="button" onClick={() => onNavigate('products')}><ServerCog size={17} /><span><strong>Продукты</strong><small>Доступ и состояние</small></span><ArrowUpRight size={15} /></button><button type="button" onClick={() => onNavigate('modules')}><Layers3 size={17} /><span><strong>Модули</strong><small>Entitlement и установки</small></span><ArrowUpRight size={15} /></button><button type="button" onClick={() => onNavigate('sync')}><Workflow size={17} /><span><strong>Синхронизация</strong><small>Ревизии и команды</small></span><ArrowUpRight size={15} /></button></div></aside>
    </div>
  </section>;
}
