import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Boxes, Database, FileClock, Gauge, Globe2, KeyRound, Logs, RefreshCw, ServerCog, Settings2, X } from 'lucide-react';
import './infrastructureCenter.css';

type InfraTab = 'overview' | 'metrics' | 'services' | 'logs' | 'database' | 'deployments' | 'domains' | 'variables' | 'audit';
type Service = { key: string; unit: string; label: string; mutable: boolean; kind: string; active: string; sub: string; pid: number; memoryBytes: number; tasks: number; activeSince: string | null };
type ListeningPort = { protocol: string; state: string; address: string; port: number; process: string | null; pid: number | null; exposure: 'public' | 'loopback' | 'private' | 'unknown' };
type Overview = { host: { hostname: string; platform: string; release: string; architecture: string; uptimeSeconds: number; cpuModel: string; cpuCores: number; cpuSpeedMHz: number; cpuPercent: number; loadAverage: number[]; memory: { total: number; used: number; free: number; percent: number }; disk: { total: number; used: number; available: number; percent: number } }; database: { database: string; database_bytes: number; connections: number; active_connections: number }; services: Service[]; deployments: Deployment[]; ports: ListeningPort[]; time: string };
type Deployment = { label: string; path: string; release: string | null; deployedAt: string | null };
type VariablesResponse = { scopes: Array<{ id: string; label: string }>; items: Array<{ scope: string; scopeLabel: string; name: string; type: 'secret' | 'text'; configured: boolean; value: string | null; masked: string }> };
type DatabaseSnapshot = { primary: Record<string, unknown>; marketing: Record<string, unknown> | null; tables: Array<Record<string, unknown>>; activity: Array<Record<string, unknown>> };
type DomainsSnapshot = { configOk: boolean; configMessage: string; items: Array<{ site: string; domains: string[]; listens: string[] }> };
type AuditRow = { id?: string; action: string; target_type: string; target_id: string | null; actor_email: string | null; source_ip: string | null; created_at: string };
type Point = { time: number; cpu: number; memory: number; disk: number; dbConnections: number };

const tabs: Array<{ id: InfraTab; label: string; icon: typeof Gauge }> = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'metrics', label: 'Metrics', icon: Activity },
  { id: 'services', label: 'Services', icon: ServerCog },
  { id: 'logs', label: 'Logs', icon: Logs },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'deployments', label: 'Deployments', icon: Boxes },
  { id: 'domains', label: 'Domains', icon: Globe2 },
  { id: 'variables', label: 'Variables & Secrets', icon: KeyRound },
  { id: 'audit', label: 'Audit Log', icon: FileClock },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers || {}) }, ...init });
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
  const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}д ${hours}ч ${minutes}м`;
}
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString('ru-RU') : '—'; }
function statusClass(value: string) { return value === 'active' ? 'ok' : value === 'not-found' || value === 'failed' ? 'danger' : 'warn'; }
function portClass(value: ListeningPort['exposure']) { return value === 'public' ? 'danger' : value === 'loopback' || value === 'private' ? 'ok' : 'warn'; }
function exposureLabel(value: ListeningPort['exposure']) { return value === 'public' ? 'PUBLIC' : value === 'loopback' ? 'LOCAL' : value === 'private' ? 'PRIVATE' : 'UNKNOWN'; }
function LineChart({ points, value, suffix }: { points: Point[]; value: (point: Point) => number; suffix: string }) {
  const series = points.map(value); const max = Math.max(1, ...series); const width = 700; const height = 170;
  const path = points.map((point, index) => { const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * width; const y = height - (value(point) / max) * (height - 14); return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
  const latest = series.at(-1) ?? 0;
  return <div className="infra-chart"><div className="infra-chart-head"><strong>{latest.toFixed(1)}{suffix}</strong><span>{points.length ? new Date(points[0].time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'} → сейчас</span></div><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><path d={path || `M0,${height} L${width},${height}`} /></svg></div>;
}

export function InfrastructureCenter() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [variableForm, setVariableForm] = useState({ scope: 'marketing', name: '', value: '' });

  const refreshOverview = useCallback(async () => {
    const data = await api<Overview>('/infra-api/overview');
    setOverview(data); setServices(data.services); setDeployments(data.deployments); setAvailable(true);
    setHistory((current) => [...current, { time: Date.now(), cpu: data.host.cpuPercent, memory: data.host.memory.percent, disk: data.host.disk.percent, dbConnections: Number(data.database.connections || 0) }].slice(-120));
    return data;
  }, []);
  const loadTab = useCallback(async (nextTab: InfraTab) => {
    setError('');
    try {
      if (nextTab === 'variables') setVariables(await api<VariablesResponse>('/infra-api/variables'));
      if (nextTab === 'database') setDatabase(await api<DatabaseSnapshot>('/infra-api/database'));
      if (nextTab === 'deployments') setDeployments((await api<{ items: Deployment[] }>('/infra-api/deployments')).items);
      if (nextTab === 'domains') setDomains(await api<DomainsSnapshot>('/infra-api/domains'));
      if (nextTab === 'audit') setAudit((await api<{ items: AuditRow[] }>('/api/v1/audit')).items.filter((row) => row.action.startsWith('infrastructure.')));
      if (nextTab === 'services') setServices((await api<{ items: Service[] }>('/infra-api/services')).items);
      if (nextTab === 'logs') setLogs((await api<{ lines: string[] }>(`/infra-api/logs?service=${encodeURIComponent(logService)}&lines=250`)).lines);
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки'); }
  }, [logService]);

  useEffect(() => { api<Overview>('/infra-api/overview').then((data) => { setAvailable(true); setOverview(data); setServices(data.services); setDeployments(data.deployments); }).catch(() => setAvailable(false)); }, []);
  useEffect(() => {
    if (!open) return;
    void refreshOverview().catch((e) => setError(e instanceof Error ? e.message : 'Ошибка метрик'));
    const timer = window.setInterval(() => void refreshOverview().catch(() => undefined), 10000);
    return () => window.clearInterval(timer);
  }, [open, refreshOverview]);
  useEffect(() => { if (open) void loadTab(tab); }, [open, tab, loadTab]);

  const healthyServices = useMemo(() => services.filter((item) => item.active === 'active').length, [services]);
  const publicPorts = useMemo(() => overview?.ports.filter((item) => item.exposure === 'public').length ?? 0, [overview?.ports]);
  const serviceAction = async (service: Service, action: 'start' | 'stop' | 'restart') => {
    if (!window.confirm(`${action === 'restart' ? 'Перезапустить' : action === 'stop' ? 'Остановить' : 'Запустить'} ${service.label}?`)) return;
    setBusy(true); setError('');
    try { await api(`/infra-api/services/${service.key}/${action}`, { method: 'POST', body: '{}' }); setServices((await api<{ items: Service[] }>('/infra-api/services')).items); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка управления сервисом'); } finally { setBusy(false); }
  };
  const saveVariable = async (event: FormEvent) => {
    event.preventDefault(); if (!variableForm.name.trim()) return;
    setBusy(true); setError('');
    try { await api(`/infra-api/variables/${encodeURIComponent(variableForm.scope)}/${encodeURIComponent(variableForm.name.trim().toUpperCase())}`, { method: 'PUT', body: JSON.stringify({ value: variableForm.value }) }); setVariableForm((value) => ({ ...value, name: '', value: '' })); setVariables(await api<VariablesResponse>('/infra-api/variables')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения переменной'); } finally { setBusy(false); }
  };
  const editVariable = async (item: VariablesResponse['items'][number]) => {
    const value = window.prompt(item.type === 'secret' ? `Новое значение ${item.name}. Текущее значение не отображается.` : `Значение ${item.name}`, item.type === 'secret' ? '' : item.value || '');
    if (value === null) return;
    setBusy(true); try { await api(`/infra-api/variables/${item.scope}/${item.name}`, { method: 'PUT', body: JSON.stringify({ value }) }); setVariables(await api<VariablesResponse>('/infra-api/variables')); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); }
  };
  const deleteVariable = async (item: VariablesResponse['items'][number]) => {
    if (!window.confirm(`Удалить ${item.name} из ${item.scopeLabel}?`)) return;
    setBusy(true); try { await api(`/infra-api/variables/${item.scope}/${item.name}`, { method: 'DELETE' }); setVariables(await api<VariablesResponse>('/infra-api/variables')); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); }
  };

  if (!available) return null;
  return <>
    <button className="infra-launcher" type="button" onClick={() => setOpen(true)}><Settings2 size={17} /> Infrastructure</button>
    {open && <div className="infra-overlay"><div className="infra-shell">
      <aside className="infra-sidebar"><div className="infra-brand"><b>IMDS</b><span>Infrastructure Control</span></div><nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</nav></aside>
      <main className="infra-main"><header className="infra-header"><div><span>VPS CONTROL PLANE</span><h1>{tabs.find((item) => item.id === tab)?.label}</h1><p>{overview?.host.hostname || 'IMDS VPS'} · PostgreSQL · Nginx · systemd</p></div><div className="infra-header-actions"><button onClick={() => void refreshOverview()}><RefreshCw size={16} /> Обновить</button><button className="infra-close" onClick={() => setOpen(false)}><X size={18} /></button></div></header>{error && <div className="infra-error">{error}</div>}

      {tab === 'overview' && overview && <><section className="infra-metrics"><article><span>CPU</span><strong>{overview.host.cpuPercent}%</strong><small>{overview.host.cpuCores} vCPU · {(overview.host.cpuSpeedMHz / 1000).toFixed(2)} GHz</small></article><article><span>RAM</span><strong>{overview.host.memory.percent}%</strong><small>{bytes(overview.host.memory.used)} / {bytes(overview.host.memory.total)}</small></article><article><span>Disk</span><strong>{overview.host.disk.percent}%</strong><small>{bytes(overview.host.disk.used)} / {bytes(overview.host.disk.total)}</small></article><article><span>Ports</span><strong>{overview.ports.length}</strong><small>{publicPorts} public listening</small></article><article><span>Services</span><strong>{healthyServices}/{services.length}</strong><small>active</small></article><article><span>Uptime</span><strong>{duration(overview.host.uptimeSeconds)}</strong><small>{overview.host.platform} {overview.host.release}</small></article></section><section className="infra-grid"><div className="infra-card span-2"><div className="infra-card-head"><div><span>VPS CHARACTERISTICS</span><h2>Характеристики и загрузка</h2></div></div><div className="infra-facts"><div><span>CPU model</span><strong>{overview.host.cpuModel}</strong></div><div><span>Architecture</span><strong>{overview.host.architecture}</strong></div><div><span>vCPU</span><strong>{overview.host.cpuCores} · {(overview.host.cpuSpeedMHz / 1000).toFixed(2)} GHz</strong></div><div><span>CPU usage</span><strong>{overview.host.cpuPercent}% · load {overview.host.loadAverage.map((value) => value.toFixed(2)).join(' / ')}</strong></div><div><span>RAM</span><strong>{bytes(overview.host.memory.used)} used · {bytes(overview.host.memory.free)} free · {bytes(overview.host.memory.total)} total</strong></div><div><span>Disk /</span><strong>{bytes(overview.host.disk.used)} used · {bytes(overview.host.disk.available)} free · {bytes(overview.host.disk.total)} total</strong></div></div></div><div className="infra-card"><div className="infra-card-head"><div><span>DATABASE</span><h2>{overview.database.database}</h2></div></div><div className="infra-facts"><div><span>Size</span><strong>{bytes(overview.database.database_bytes)}</strong></div><div><span>Connections</span><strong>{overview.database.connections}</strong></div><div><span>Active</span><strong>{overview.database.active_connections}</strong></div></div></div><div className="infra-card span-3"><div className="infra-card-head"><div><span>LISTENING SOCKETS</span><h2>Активные порты</h2></div><span className={`infra-status ${publicPorts ? 'warn' : 'ok'}`}>{publicPorts} public</span></div><div className="infra-table-wrap"><table><thead><tr><th>Port</th><th>Protocol</th><th>Bind</th><th>Exposure</th><th>Process</th><th>PID</th></tr></thead><tbody>{overview.ports.map((item, index) => <tr key={`${item.protocol}:${item.address}:${item.port}:${index}`}><td><strong>{item.port}</strong></td><td>{item.protocol.toUpperCase()}</td><td><code>{item.address}</code></td><td><span className={`infra-status ${portClass(item.exposure)}`}>{exposureLabel(item.exposure)}</span></td><td>{item.process || '—'}</td><td>{item.pid || '—'}</td></tr>)}</tbody></table></div><p className="infra-note">PUBLIC означает, что процесс слушает все интерфейсы или внешний IP. LOCAL — только 127.0.0.1/::1. PRIVATE — приватная сеть VPS.</p></div><div className="infra-card span-2"><div className="infra-card-head"><div><span>SERVICES</span><h2>Runtime health</h2></div></div><div className="infra-service-list">{services.map((service) => <div key={service.key}><i className={statusClass(service.active)} /><div><strong>{service.label}</strong><small>{service.unit}</small></div><span>{service.active} / {service.sub}</span></div>)}</div></div><div className="infra-card"><div className="infra-card-head"><div><span>DEPLOYMENTS</span><h2>Current releases</h2></div></div><div className="infra-deploy-row">{deployments.map((item) => <div key={item.label}><strong>{item.label}</strong><span>{item.release || '—'}</span><small>{date(item.deployedAt)}</small></div>)}</div></div></section></>}

      {tab === 'metrics' && <section className="infra-grid"><div className="infra-card span-2"><div className="infra-card-head"><div><span>HOST</span><h2>CPU usage</h2></div></div><LineChart points={history} value={(point) => point.cpu} suffix="%" /></div><div className="infra-card"><div className="infra-card-head"><div><span>HOST</span><h2>Memory</h2></div></div><LineChart points={history} value={(point) => point.memory} suffix="%" /></div><div className="infra-card"><div className="infra-card-head"><div><span>STORAGE</span><h2>Disk</h2></div></div><LineChart points={history} value={(point) => point.disk} suffix="%" /></div><div className="infra-card span-2"><div className="infra-card-head"><div><span>POSTGRESQL</span><h2>Connections</h2></div></div><LineChart points={history} value={(point) => point.dbConnections} suffix="" /></div></section>}

      {tab === 'services' && <section className="infra-card"><div className="infra-card-head"><div><span>SYSTEMD</span><h2>Services & timers</h2></div><button onClick={() => void loadTab('services')}><RefreshCw size={14} /> Refresh</button></div><div className="infra-table-wrap"><table><thead><tr><th>Service</th><th>Status</th><th>PID</th><th>Memory</th><th>Tasks</th><th>Since</th><th>Actions</th></tr></thead><tbody>{services.map((service) => <tr key={service.key}><td><strong>{service.label}</strong><small>{service.unit}</small></td><td><span className={`infra-status ${statusClass(service.active)}`}>{service.active} / {service.sub}</span></td><td>{service.pid || '—'}</td><td>{bytes(service.memoryBytes)}</td><td>{service.tasks || '—'}</td><td>{service.activeSince || '—'}</td><td><div className="infra-actions">{service.mutable && <><button disabled={busy} onClick={() => void serviceAction(service, 'restart')}>Restart</button>{service.active === 'active' ? <button disabled={busy} onClick={() => void serviceAction(service, 'stop')}>Stop</button> : <button disabled={busy} onClick={() => void serviceAction(service, 'start')}>Start</button>}</>}</div></td></tr>)}</tbody></table></div></section>}

      {tab === 'logs' && <section className="infra-card"><div className="infra-card-head"><div><span>JOURNALD</span><h2>Service logs</h2></div><div className="infra-inline"><select value={logService} onChange={(e) => setLogService(e.target.value)}>{services.map((service) => <option key={service.key} value={service.key}>{service.label}</option>)}</select><button onClick={() => void loadTab('logs')}><RefreshCw size={14} /> Load</button></div></div><pre className="infra-logs">{logs.length ? logs.join('\n') : 'Нет данных.'}</pre></section>}

      {tab === 'database' && database && <><section className="infra-metrics"><article><span>Primary DB</span><strong>{String(database.primary.database || 'imdssa')}</strong><small>{bytes(database.primary.database_bytes as number)}</small></article><article><span>Connections</span><strong>{String(database.primary.connections || 0)}</strong><small>{String(database.primary.active_connections || 0)} active</small></article><article><span>Commits</span><strong>{String(database.primary.commits || 0)}</strong><small>transactions</small></article><article><span>Rollbacks</span><strong>{String(database.primary.rollbacks || 0)}</strong><small>transactions</small></article>{database.marketing && <article><span>Marketing DB</span><strong>{bytes(database.marketing.database_bytes as number)}</strong><small>{String(database.marketing.connections || 0)} connections</small></article>}</section><section className="infra-card"><div className="infra-card-head"><div><span>POSTGRESQL</span><h2>Largest tables</h2></div></div><div className="infra-table-wrap"><table><thead><tr><th>Schema</th><th>Table</th><th>Live rows</th><th>Dead rows</th></tr></thead><tbody>{database.tables.map((row, index) => <tr key={index}><td>{String(row.schemaname)}</td><td><strong>{String(row.table_name)}</strong></td><td>{String(row.live_rows)}</td><td>{String(row.dead_rows)}</td></tr>)}</tbody></table></div></section></>}

      {tab === 'deployments' && <section className="infra-card"><div className="infra-card-head"><div><span>RELEASES</span><h2>Active deployments</h2></div></div><div className="infra-deployments">{deployments.map((item) => <article key={item.label}><div><strong>{item.label}</strong><span>{item.release || 'Release not detected'}</span></div><small>{item.path}</small><time>{date(item.deployedAt)}</time></article>)}</div></section>}

      {tab === 'domains' && domains && <section className="infra-card"><div className="infra-card-head"><div><span>NGINX</span><h2>Domains & routing</h2></div><span className={`infra-status ${domains.configOk ? 'ok' : 'danger'}`}>{domains.configOk ? 'Configuration valid' : 'Configuration error'}</span></div><div className="infra-table-wrap"><table><thead><tr><th>Site</th><th>Domains</th><th>Listen</th></tr></thead><tbody>{domains.items.map((item) => <tr key={item.site}><td><strong>{item.site}</strong></td><td>{item.domains.length ? item.domains.join(', ') : 'IP / default'}</td><td>{item.listens.join(', ')}</td></tr>)}</tbody></table></div></section>}

      {tab === 'variables' && <><section className="infra-card"><div className="infra-card-head"><div><span>CONFIGURATION</span><h2>Add variable or secret</h2></div></div><form className="infra-variable-form" onSubmit={saveVariable}><select value={variableForm.scope} onChange={(e) => setVariableForm({ ...variableForm, scope: e.target.value })}>{variables.scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.label}</option>)}</select><input required pattern="[A-Z][A-Z0-9_]+" placeholder="VARIABLE_NAME" value={variableForm.name} onChange={(e) => setVariableForm({ ...variableForm, name: e.target.value.toUpperCase() })} /><input placeholder="Value" value={variableForm.value} onChange={(e) => setVariableForm({ ...variableForm, value: e.target.value })} /><button disabled={busy}>Add variable</button></form><p className="infra-note">Значения, определённые как секреты, API никогда не возвращает обратно в браузер. После изменения обычно нужен restart соответствующего сервиса.</p></section><section className="infra-card"><div className="infra-card-head"><div><span>ENVIRONMENT</span><h2>Variables & Secrets</h2></div><button onClick={() => void loadTab('variables')}><RefreshCw size={14} /> Refresh</button></div><div className="infra-table-wrap"><table><thead><tr><th>Type</th><th>Scope</th><th>Name</th><th>Value</th><th>Status</th><th>Actions</th></tr></thead><tbody>{variables.items.map((item) => <tr key={`${item.scope}:${item.name}`}><td><span className={`infra-type ${item.type}`}>{item.type}</span></td><td>{item.scopeLabel}</td><td><strong>{item.name}</strong></td><td><code>{item.type === 'secret' ? item.masked || 'not set' : item.value || '—'}</code></td><td><span className={`infra-status ${item.configured ? 'ok' : 'warn'}`}>{item.configured ? 'configured' : 'empty'}</span></td><td><div className="infra-actions"><button disabled={busy} onClick={() => void editVariable(item)}>Edit</button><button disabled={busy} onClick={() => void deleteVariable(item)}>Delete</button></div></td></tr>)}</tbody></table></div></section></>}

      {tab === 'audit' && <section className="infra-card"><div className="infra-card-head"><div><span>SECURITY</span><h2>Infrastructure audit</h2></div><button onClick={() => void loadTab('audit')}><RefreshCw size={14} /> Refresh</button></div><div className="infra-table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th></tr></thead><tbody>{audit.map((row, index) => <tr key={row.id || index}><td>{date(row.created_at)}</td><td>{row.actor_email || 'system'}</td><td><strong>{row.action}</strong></td><td>{row.target_type}<small>{row.target_id || ''}</small></td><td>{row.source_ip || '—'}</td></tr>)}</tbody></table></div></section>}
      </main>
    </div></div>}
  </>;
}
