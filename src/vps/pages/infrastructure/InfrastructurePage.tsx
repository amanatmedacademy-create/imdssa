import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Boxes,
  Database,
  FileClock,
  Gauge,
  Globe2,
  KeyRound,
  Logs,
  Play,
  RefreshCw,
  RotateCcw,
  ServerCog,
  Square,
} from 'lucide-react';
import './infrastructurePage.css';

type InfraTab = 'overview' | 'metrics' | 'services' | 'logs' | 'database' | 'deployments' | 'domains' | 'variables' | 'audit';
type Service = { key: string; unit: string; label: string; mutable: boolean; kind: string; active: string; sub: string; pid: number; memoryBytes: number; tasks: number; activeSince: string | null };
type ListeningPort = { protocol: string; state: string; address: string; port: number; process: string | null; pid: number | null; exposure: 'public' | 'loopback' | 'private' | 'unknown' };
type Deployment = { label: string; path: string; release: string | null; deployedAt: string | null };
type Overview = {
  host: {
    hostname: string; platform: string; release: string; architecture: string; uptimeSeconds: number;
    cpuModel: string; cpuCores: number; cpuSpeedMHz: number; cpuPercent: number; loadAverage: number[];
    memory: { total: number; used: number; free: number; percent: number };
    disk: { total: number; used: number; available: number; percent: number };
  };
  database: { database: string; database_bytes: number; connections: number; active_connections: number };
  services: Service[];
  deployments: Deployment[];
  ports: ListeningPort[];
  time: string;
};
type VariablesResponse = { scopes: Array<{ id: string; label: string }>; items: Array<{ scope: string; scopeLabel: string; name: string; type: 'secret' | 'text'; configured: boolean; value: string | null; masked: string }> };
type DatabaseSnapshot = { primary: Record<string, unknown>; marketing: Record<string, unknown> | null; tables: Array<Record<string, unknown>>; activity: Array<Record<string, unknown>> };
type DomainsSnapshot = { configOk: boolean; configMessage: string; items: Array<{ site: string; domains: string[]; listens: string[] }> };
type AuditRow = { id?: string; action: string; target_type: string; target_id: string | null; actor_email: string | null; source_ip: string | null; created_at: string };
type Point = { time: number; cpu: number; memory: number; disk: number; dbConnections: number };
type AuthResponse = { user: { scope: 'platform' | 'tenant'; role: string; fullName: string; email: string } };

const tabs: Array<{ id: InfraTab; label: string; description: string; icon: typeof Gauge }> = [
  { id: 'overview', label: 'Обзор сервера', description: 'Состояние VPS и ключевых ресурсов', icon: Gauge },
  { id: 'metrics', label: 'Метрики', description: 'CPU, RAM, disk и соединения БД', icon: Activity },
  { id: 'services', label: 'Сервисы', description: 'systemd и процессы платформы', icon: ServerCog },
  { id: 'logs', label: 'Логи', description: 'Последние журналы сервисов', icon: Logs },
  { id: 'database', label: 'PostgreSQL', description: 'Размер, таблицы и активность', icon: Database },
  { id: 'deployments', label: 'Deployments', description: 'Активные релизы продуктов', icon: Boxes },
  { id: 'domains', label: 'Домены', description: 'Nginx sites, listen и server_name', icon: Globe2 },
  { id: 'variables', label: 'Переменные и секреты', description: 'Runtime configuration по продуктам', icon: KeyRound },
  { id: 'audit', label: 'Аудит', description: 'История инфраструктурных изменений', icon: FileClock },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function bytes(value: number | string | undefined) {
  const amount = Number(value || 0);
  if (!amount) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  return `${(amount / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
function duration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}д ${hours}ч ${minutes}м`;
}
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString('ru-RU') : '—'; }
function display(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function exposureLabel(value: ListeningPort['exposure']) {
  if (value === 'public') return 'Публичный';
  if (value === 'loopback') return 'Локальный';
  if (value === 'private') return 'Приватный';
  return 'Неизвестно';
}

function MetricChart({ points, field, suffix }: { points: Point[]; field: keyof Pick<Point, 'cpu' | 'memory' | 'disk' | 'dbConnections'>; suffix: string }) {
  const values = points.map((point) => point[field]);
  const max = Math.max(1, ...values);
  const width = 760;
  const height = 150;
  const path = points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * width;
    const y = height - (point[field] / max) * (height - 16);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return <div className="infra2-chart">
    <div><strong>{(values.at(-1) ?? 0).toFixed(field === 'dbConnections' ? 0 : 1)}{suffix}</strong><span>{points.length ? `${new Date(points[0].time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} → сейчас` : 'Сбор метрик начинается после открытия страницы'}</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><path d={path || `M0,${height} L${width},${height}`} /></svg>
  </div>;
}

function RecordTable({ rows, empty }: { rows: Array<Record<string, unknown>>; empty: string }) {
  if (!rows.length) return <div className="infra2-empty">{empty}</div>;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8);
  return <div className="infra2-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} title={display(row[column])}>{display(row[column])}</td>)}</tr>)}</tbody></table></div>;
}

export function InfrastructurePage() {
  const [authState, setAuthState] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [user, setUser] = useState<AuthResponse['user'] | null>(null);
  const [tab, setTab] = useState<InfraTab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [variables, setVariables] = useState<VariablesResponse>({ scopes: [], items: [] });
  const [database, setDatabase] = useState<DatabaseSnapshot | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [domains, setDomains] = useState<DomainsSnapshot | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [logService, setLogService] = useState('super-admin-api');
  const [variableForm, setVariableForm] = useState({ scope: 'marketing', name: '', value: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refreshOverview = useCallback(async () => {
    const data = await api<Overview>('/infra-api/overview');
    setOverview(data);
    setServices(data.services);
    setDeployments(data.deployments);
    setHistory((current) => [...current, {
      time: Date.now(), cpu: data.host.cpuPercent, memory: data.host.memory.percent,
      disk: data.host.disk.percent, dbConnections: Number(data.database.connections || 0),
    }].slice(-120));
    return data;
  }, []);

  const loadTab = useCallback(async (nextTab: InfraTab) => {
    setError('');
    try {
      if (nextTab === 'overview' || nextTab === 'metrics') await refreshOverview();
      if (nextTab === 'services') setServices((await api<{ items: Service[] }>('/infra-api/services')).items);
      if (nextTab === 'logs') setLogs((await api<{ lines: string[] }>(`/infra-api/logs?service=${encodeURIComponent(logService)}&lines=250`)).lines);
      if (nextTab === 'database') setDatabase(await api<DatabaseSnapshot>('/infra-api/database'));
      if (nextTab === 'deployments') setDeployments((await api<{ items: Deployment[] }>('/infra-api/deployments')).items);
      if (nextTab === 'domains') setDomains(await api<DomainsSnapshot>('/infra-api/domains'));
      if (nextTab === 'variables') {
        const result = await api<VariablesResponse>('/infra-api/variables');
        setVariables(result);
        if (result.scopes.length) setVariableForm((current) => ({ ...current, scope: result.scopes.some((scope) => scope.id === current.scope) ? current.scope : result.scopes[0].id }));
      }
      if (nextTab === 'audit') setAudit((await api<{ items: AuditRow[] }>('/api/v1/audit')).items.filter((row) => row.action.startsWith('infrastructure.')));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка загрузки');
    }
  }, [logService, refreshOverview]);

  useEffect(() => {
    let cancelled = false;
    void api<AuthResponse>('/api/auth/me').then(async (result) => {
      if (cancelled) return;
      setUser(result.user);
      if (result.user.scope !== 'platform') { setAuthState('denied'); return; }
      setAuthState('allowed');
      try { await refreshOverview(); } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Infrastructure API недоступен'); }
    }).catch(() => { if (!cancelled) setAuthState('denied'); });
    return () => { cancelled = true; };
  }, [refreshOverview]);

  useEffect(() => {
    if (authState !== 'allowed') return;
    const timer = window.setInterval(() => void refreshOverview().catch(() => undefined), 10000);
    return () => window.clearInterval(timer);
  }, [authState, refreshOverview]);

  useEffect(() => {
    if (authState === 'allowed') void loadTab(tab);
  }, [authState, loadTab, tab]);

  useEffect(() => {
    if (authState === 'allowed' && tab === 'logs') void loadTab('logs');
  }, [authState, loadTab, logService, tab]);

  const healthyServices = useMemo(() => services.filter((item) => item.active === 'active').length, [services]);
  const publicPorts = useMemo(() => overview?.ports.filter((item) => item.exposure === 'public').length ?? 0, [overview?.ports]);
  const selectedTab = tabs.find((item) => item.id === tab) ?? tabs[0];

  const serviceAction = async (service: Service, action: 'start' | 'stop' | 'restart') => {
    if (!window.confirm(`${action === 'restart' ? 'Перезапустить' : action === 'stop' ? 'Остановить' : 'Запустить'} «${service.label}»?`)) return;
    setBusy(true); setError('');
    try {
      await api(`/infra-api/services/${service.key}/${action}`, { method: 'POST', body: '{}' });
      setServices((await api<{ items: Service[] }>('/infra-api/services')).items);
      await refreshOverview();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка управления сервисом'); }
    finally { setBusy(false); }
  };

  const saveVariable = async (event: FormEvent) => {
    event.preventDefault();
    const name = variableForm.name.trim().toUpperCase();
    if (!name) return;
    setBusy(true); setError('');
    try {
      await api(`/infra-api/variables/${encodeURIComponent(variableForm.scope)}/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ value: variableForm.value }) });
      setVariableForm((current) => ({ ...current, name: '', value: '' }));
      await loadTab('variables');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка сохранения переменной'); }
    finally { setBusy(false); }
  };

  const editVariable = async (item: VariablesResponse['items'][number]) => {
    const value = window.prompt(item.type === 'secret' ? `Новое значение ${item.name}. Текущее значение скрыто.` : `Значение ${item.name}`, item.type === 'secret' ? '' : item.value || '');
    if (value === null) return;
    setBusy(true); setError('');
    try { await api(`/infra-api/variables/${item.scope}/${item.name}`, { method: 'PUT', body: JSON.stringify({ value }) }); await loadTab('variables'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка изменения переменной'); }
    finally { setBusy(false); }
  };

  const deleteVariable = async (item: VariablesResponse['items'][number]) => {
    if (!window.confirm(`Удалить ${item.name} из «${item.scopeLabel}»?`)) return;
    setBusy(true); setError('');
    try { await api(`/infra-api/variables/${item.scope}/${item.name}`, { method: 'DELETE' }); await loadTab('variables'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка удаления переменной'); }
    finally { setBusy(false); }
  };

  if (authState === 'checking') return <main className="infra2-state">Проверка доступа к инфраструктуре…</main>;
  if (authState === 'denied') return <main className="infra2-state"><strong>Инфраструктура доступна только платформенному администратору.</strong><a href="/">Вернуться в Control Center</a></main>;

  return <div className="infra2-shell">
    <aside className="infra2-sidebar">
      <a className="infra2-back" href="/"><ArrowLeft size={15}/>Control Center</a>
      <div className="infra2-brand"><b>IMDS</b><span>Инфраструктура</span></div>
      <div className="infra2-nav-label">СЕРВЕР И RUNTIME</div>
      <nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16}/><span>{label}</span></button>)}</nav>
      <div className="infra2-sidebar-foot"><strong>{overview?.host.hostname || 'IMDS VPS'}</strong><span>{user?.email}</span><small>Технический контур · отдельно от продуктов</small></div>
    </aside>

    <main className="infra2-main">
      <header className="infra2-header"><div><span>IMDS INFRASTRUCTURE</span><h1>{selectedTab.label}</h1><p>{selectedTab.description}</p></div><button type="button" disabled={busy} onClick={() => void loadTab(tab)}><RefreshCw size={15}/>{busy ? 'Операция…' : 'Обновить'}</button></header>
      {error && <div className="infra2-error">{error}</div>}

      {tab === 'overview' && overview && <>
        <section className="infra2-kpis">
          <article><span>CPU</span><strong>{overview.host.cpuPercent}%</strong><small>{overview.host.cpuCores} vCPU · {(overview.host.cpuSpeedMHz / 1000).toFixed(2)} GHz</small></article>
          <article><span>RAM</span><strong>{overview.host.memory.percent}%</strong><small>{bytes(overview.host.memory.used)} / {bytes(overview.host.memory.total)}</small></article>
          <article><span>Disk</span><strong>{overview.host.disk.percent}%</strong><small>{bytes(overview.host.disk.used)} / {bytes(overview.host.disk.total)}</small></article>
          <article className={publicPorts > 4 ? 'warn' : ''}><span>Публичные порты</span><strong>{publicPorts}</strong><small>{overview.ports.length} listening всего</small></article>
          <article><span>Сервисы</span><strong>{healthyServices}/{services.length}</strong><small>active</small></article>
          <article><span>Uptime</span><strong>{duration(overview.host.uptimeSeconds)}</strong><small>{overview.host.platform} {overview.host.release}</small></article>
        </section>
        <section className="infra2-grid">
          <article className="infra2-card span2"><div className="infra2-card-head"><div><span>SERVER</span><h2>Характеристики VPS</h2></div></div><div className="infra2-facts"><div><span>CPU model</span><strong>{overview.host.cpuModel}</strong></div><div><span>Architecture</span><strong>{overview.host.architecture}</strong></div><div><span>Load average</span><strong>{overview.host.loadAverage.map((value) => value.toFixed(2)).join(' / ')}</strong></div><div><span>RAM свободно</span><strong>{bytes(overview.host.memory.free)}</strong></div><div><span>Disk свободно</span><strong>{bytes(overview.host.disk.available)}</strong></div><div><span>Snapshot</span><strong>{date(overview.time)}</strong></div></div></article>
          <article className="infra2-card"><div className="infra2-card-head"><div><span>POSTGRESQL</span><h2>{overview.database.database}</h2></div></div><div className="infra2-facts single"><div><span>Размер</span><strong>{bytes(overview.database.database_bytes)}</strong></div><div><span>Соединения</span><strong>{overview.database.connections}</strong></div><div><span>Активные</span><strong>{overview.database.active_connections}</strong></div></div></article>
          <article className="infra2-card span3"><div className="infra2-card-head"><div><span>NETWORK</span><h2>Listening ports</h2></div></div><div className="infra2-table-wrap"><table><thead><tr><th>Порт</th><th>Адрес</th><th>Доступ</th><th>Процесс</th><th>PID</th></tr></thead><tbody>{overview.ports.map((port, index) => <tr key={`${port.port}-${port.address}-${index}`}><td><strong>{port.port}/{port.protocol}</strong></td><td>{port.address}</td><td><span className={`infra2-pill ${port.exposure}`}>{exposureLabel(port.exposure)}</span></td><td>{port.process || '—'}</td><td>{port.pid || '—'}</td></tr>)}</tbody></table></div></article>
        </section>
      </>}

      {tab === 'metrics' && <section className="infra2-metric-grid"><article className="infra2-card"><div className="infra2-card-head"><div><span>CPU</span><h2>Загрузка процессора</h2></div></div><MetricChart points={history} field="cpu" suffix="%"/></article><article className="infra2-card"><div className="infra2-card-head"><div><span>MEMORY</span><h2>Использование RAM</h2></div></div><MetricChart points={history} field="memory" suffix="%"/></article><article className="infra2-card"><div className="infra2-card-head"><div><span>DISK</span><h2>Заполнение диска</h2></div></div><MetricChart points={history} field="disk" suffix="%"/></article><article className="infra2-card"><div className="infra2-card-head"><div><span>POSTGRESQL</span><h2>Соединения с БД</h2></div></div><MetricChart points={history} field="dbConnections" suffix=""/></article></section>}

      {tab === 'services' && <section className="infra2-card"><div className="infra2-card-head"><div><span>SYSTEMD</span><h2>Сервисы платформы</h2><p>Управление доступно только для разрешённых mutable units.</p></div></div><div className="infra2-service-list">{services.map((service) => <article key={service.key}><div className={`infra2-service-dot ${service.active === 'active' ? 'ok' : 'bad'}`}/><div className="infra2-service-copy"><strong>{service.label}</strong><span>{service.unit}</span><small>{service.active} · {service.sub} · PID {service.pid || '—'} · {bytes(service.memoryBytes)}</small></div>{service.mutable && <div className="infra2-service-actions"><button disabled={busy || service.active === 'active'} onClick={() => void serviceAction(service, 'start')} title="Запустить"><Play size={14}/></button><button disabled={busy} onClick={() => void serviceAction(service, 'restart')} title="Перезапустить"><RotateCcw size={14}/></button><button className="danger" disabled={busy || service.active !== 'active'} onClick={() => void serviceAction(service, 'stop')} title="Остановить"><Square size={14}/></button></div>}</article>)}</div></section>}

      {tab === 'logs' && <section className="infra2-card"><div className="infra2-card-head row"><div><span>JOURNAL</span><h2>Логи сервисов</h2></div><select value={logService} onChange={(event) => setLogService(event.target.value)}>{services.map((service) => <option key={service.key} value={service.key}>{service.label}</option>)}</select></div><pre className="infra2-logs">{logs.length ? logs.join('\n') : 'Логи не найдены.'}</pre></section>}

      {tab === 'database' && database && <section className="infra2-stack"><article className="infra2-card"><div className="infra2-card-head"><div><span>PRIMARY</span><h2>PostgreSQL</h2></div></div><div className="infra2-record-grid">{Object.entries(database.primary).map(([key, value]) => <div key={key}><span>{key}</span><strong>{display(value)}</strong></div>)}</div></article>{database.marketing && <article className="infra2-card"><div className="infra2-card-head"><div><span>MARKETING DATABASE</span><h2>Product database</h2></div></div><div className="infra2-record-grid">{Object.entries(database.marketing).map(([key, value]) => <div key={key}><span>{key}</span><strong>{display(value)}</strong></div>)}</div></article>}<article className="infra2-card"><div className="infra2-card-head"><div><span>TABLES</span><h2>Размеры таблиц</h2></div></div><RecordTable rows={database.tables} empty="Таблицы не найдены."/></article><article className="infra2-card"><div className="infra2-card-head"><div><span>ACTIVITY</span><h2>Активные подключения</h2></div></div><RecordTable rows={database.activity} empty="Активных подключений нет."/></article></section>}

      {tab === 'deployments' && <section className="infra2-deploy-grid">{deployments.length ? deployments.map((item) => <article className="infra2-card" key={`${item.label}-${item.path}`}><div className="infra2-card-head"><div><span>RELEASE</span><h2>{item.label}</h2></div></div><div className="infra2-facts single"><div><span>Текущий release</span><strong className="mono">{item.release || '—'}</strong></div><div><span>Путь</span><strong className="mono">{item.path}</strong></div><div><span>Время</span><strong>{date(item.deployedAt)}</strong></div></div></article>) : <div className="infra2-empty">Deployments не найдены.</div>}</section>}

      {tab === 'domains' && <section className="infra2-stack">{domains && <div className={`infra2-config-status ${domains.configOk ? 'ok' : 'bad'}`}><strong>{domains.configOk ? 'Nginx configuration OK' : 'Есть ошибка Nginx'}</strong><span>{domains.configMessage}</span></div>}{domains?.items.map((item) => <article className="infra2-card" key={item.site}><div className="infra2-card-head"><div><span>NGINX SITE</span><h2>{item.site}</h2></div></div><div className="infra2-facts single"><div><span>Домены</span><strong>{item.domains.join(', ') || '—'}</strong></div><div><span>Listen</span><strong>{item.listens.join(', ') || '—'}</strong></div></div></article>)}</section>}

      {tab === 'variables' && <section className="infra2-stack"><article className="infra2-card"><div className="infra2-card-head"><div><span>RUNTIME CONFIG</span><h2>Переменные и секреты</h2><p>Secret значения никогда не показываются полностью.</p></div></div><form className="infra2-variable-form" onSubmit={saveVariable}><select value={variableForm.scope} onChange={(event) => setVariableForm((current) => ({ ...current, scope: event.target.value }))}>{variables.scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.label}</option>)}</select><input value={variableForm.name} onChange={(event) => setVariableForm((current) => ({ ...current, name: event.target.value }))} placeholder="VARIABLE_NAME"/><input value={variableForm.value} onChange={(event) => setVariableForm((current) => ({ ...current, value: event.target.value }))} placeholder="Значение" type="password"/><button className="primary" disabled={busy || !variableForm.name.trim()} type="submit">Сохранить</button></form><div className="infra2-variable-list">{variables.items.map((item) => <article key={`${item.scope}-${item.name}`}><div><strong>{item.name}</strong><span>{item.scopeLabel} · {item.type === 'secret' ? 'secret' : 'text'}</span></div><code>{item.type === 'secret' ? item.masked : item.value || '—'}</code><span className={`infra2-pill ${item.configured ? 'private' : 'unknown'}`}>{item.configured ? 'Настроено' : 'Пусто'}</span><div><button disabled={busy} onClick={() => void editVariable(item)}>Изменить</button><button className="danger-text" disabled={busy || !item.configured} onClick={() => void deleteVariable(item)}>Удалить</button></div></article>)}</div></article></section>}

      {tab === 'audit' && <section className="infra2-card"><div className="infra2-card-head"><div><span>AUDIT</span><h2>Инфраструктурные изменения</h2></div></div>{audit.length ? <div className="infra2-table-wrap"><table><thead><tr><th>Дата</th><th>Действие</th><th>Объект</th><th>Пользователь</th><th>IP</th></tr></thead><tbody>{audit.map((row, index) => <tr key={row.id || `${row.action}-${index}`}><td>{date(row.created_at)}</td><td><strong>{row.action}</strong></td><td>{row.target_type}{row.target_id ? ` · ${row.target_id}` : ''}</td><td>{row.actor_email || 'system'}</td><td>{row.source_ip || '—'}</td></tr>)}</tbody></table></div> : <div className="infra2-empty">Инфраструктурных изменений пока нет.</div>}</section>}
    </main>
  </div>;
}
