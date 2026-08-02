import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CloudCog,
  Gauge,
  LoaderCircle,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Siren,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import { useObservability } from './ObservabilityContext';
import type { ConnectionInput, ServiceInput } from './observabilityRepository';

const emptyConnection: ConnectionInput = {
  name: 'Checkmate Production',
  environment: 'production',
  apiBaseUrl: 'https://monitor.imdstech.net',
  secretReference: 'env://CHECKMATE_API_TOKEN',
  status: 'active',
  timeoutMs: 15000,
};

const emptyService: ServiceInput = {
  productId: '',
  connectionId: null,
  environment: 'production',
  serviceKey: '',
  name: '',
  description: '',
  kind: 'api',
  ownerTeam: '',
  criticality: 3,
  targetUrl: '',
  expectedHttpStatus: 200,
  sloTargetPercent: 99.9,
  monitorType: 'http',
  monitorIntervalMs: 60000,
  visibleOnStatusPage: true,
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusClass(value: string) {
  if (['active', 'up', 'succeeded', 'resolved'].includes(value)) return 'ok';
  if (['queued', 'running', 'initializing'].includes(value)) return 'info';
  if (['degraded', 'partial', 'major'].includes(value)) return 'warn';
  if (['down', 'failed', 'critical', 'open'].includes(value)) return 'danger';
  return 'muted';
}

function serviceStatusLabel(value: string) {
  const labels: Record<string, string> = {
    up: 'Работает',
    down: 'Недоступен',
    degraded: 'Деградация',
    paused: 'Приостановлен',
    maintenance: 'Техработы',
    initializing: 'Инициализация',
    unknown: 'Неизвестно',
  };
  return labels[value] ?? value;
}

export function ObservabilityPage() {
  const { can, isDemo } = useAuth();
  const {
    connections,
    services,
    incidents,
    syncRuns,
    products,
    loading,
    saving,
    error,
    refresh,
    saveConnection,
    saveService,
    enqueueSync,
    acknowledgeIncident,
  } = useObservability();
  const [tab, setTab] = useState<'services' | 'incidents' | 'connections' | 'sync'>('services');
  const [connectionForm, setConnectionForm] = useState<ConnectionInput>(emptyConnection);
  const [serviceForm, setServiceForm] = useState<ServiceInput>(emptyService);
  const [validation, setValidation] = useState('');
  const connectionDialog = useRef<HTMLDialogElement | null>(null);
  const serviceDialog = useRef<HTMLDialogElement | null>(null);
  const canManage = can('observability.manage');

  const metrics = useMemo(() => {
    const activeServices = services.filter((item) => item.status === 'up').length;
    const openIncidents = incidents.filter((item) => item.status === 'open').length;
    const healthyConnections = connections.filter((item) => item.status === 'active').length;
    const uptimeValues = services.map((item) => item.uptimePercent).filter((item): item is number => item !== null);
    const averageUptime = uptimeValues.length ? uptimeValues.reduce((sum, value) => sum + value, 0) / uptimeValues.length : 0;
    return { activeServices, openIncidents, healthyConnections, averageUptime };
  }, [connections, incidents, services]);

  const submitConnection = async (event: FormEvent) => {
    event.preventDefault();
    if (!connectionForm.name.trim()) return setValidation('Укажите название подключения.');
    if (!/^https:\/\//.test(connectionForm.apiBaseUrl) && connectionForm.environment === 'production') {
      return setValidation('Production-подключение должно использовать HTTPS.');
    }
    if (!/^(env|vault):\/\//.test(connectionForm.secretReference)) {
      return setValidation('Секрет должен быть ссылкой env:// или vault://.');
    }
    if (await saveConnection(connectionForm)) connectionDialog.current?.close();
  };

  const submitService = async (event: FormEvent) => {
    event.preventDefault();
    if (!serviceForm.productId) return setValidation('Выберите продукт.');
    if (!serviceForm.name.trim() || !serviceForm.serviceKey.trim()) return setValidation('Название и ключ сервиса обязательны.');
    if (serviceForm.monitorType === 'http' && !/^https?:\/\//.test(serviceForm.targetUrl)) {
      return setValidation('Для HTTP-монитора нужен корректный URL.');
    }
    if (await saveService(serviceForm)) serviceDialog.current?.close();
  };

  const acknowledge = async (incidentId: string) => {
    const note = window.prompt('Комментарий подтверждения инцидента:');
    if (!note?.trim()) return;
    await acknowledgeIncident(incidentId, note.trim());
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Checkmate Adapter</span>
          <h1>Observability Center</h1>
          <p>Сервисы, uptime, latency, инциденты, maintenance и status pages для продуктов IMDS.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить</button>
          {canManage && <button className="secondary-button compact" type="button" onClick={() => { setValidation(''); setConnectionForm(emptyConnection); connectionDialog.current?.showModal(); }}><CloudCog size={16} /> Подключение</button>}
          {canManage && <button className="primary-button" type="button" onClick={() => { setValidation(''); setServiceForm({ ...emptyService, productId: products[0]?.id ?? '', connectionId: connections[0]?.id ?? null }); serviceDialog.current?.showModal(); }}><Plus size={17} /> Добавить сервис</button>}
        </div>
      </div>

      {isDemo && <div className="mode-banner"><ShieldCheck size={18} /><div><strong>Демо-режим Observability Center</strong><span>Показываются локальные данные. После настройки Supabase синхронизацию выполняет защищённая Checkmate Edge Function.</span></div></div>}
      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span></div>}

      <section className="metrics observability-metrics">
        <article className="metric-card"><div className="metric-icon"><ServerCog size={21} /></div><div><span>Сервисы</span><strong>{services.length}</strong><small>{metrics.activeServices} работают</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Gauge size={21} /></div><div><span>Средний uptime</span><strong>{metrics.averageUptime.toFixed(2)}%</strong><small>по активным мониторам</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Siren size={21} /></div><div><span>Открытые инциденты</span><strong>{metrics.openIncidents}</strong><small>требуют реакции</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Wifi size={21} /></div><div><span>Checkmate connections</span><strong>{metrics.healthyConnections}/{connections.length}</strong><small>активные подключения</small></div></article>
      </section>

      <div className="section-tabs observability-tabs">
        <button className={tab === 'services' ? 'active' : ''} type="button" onClick={() => setTab('services')}><ServerCog size={16} /> Сервисы <span>{services.length}</span></button>
        <button className={tab === 'incidents' ? 'active' : ''} type="button" onClick={() => setTab('incidents')}><Siren size={16} /> Инциденты <span>{incidents.length}</span></button>
        <button className={tab === 'connections' ? 'active' : ''} type="button" onClick={() => setTab('connections')}><CloudCog size={16} /> Подключения <span>{connections.length}</span></button>
        <button className={tab === 'sync' ? 'active' : ''} type="button" onClick={() => setTab('sync')}><Activity size={16} /> Синхронизация <span>{syncRuns.length}</span></button>
      </div>

      {tab === 'services' && <section className="observability-service-grid">
        {services.map((service) => <article className="observability-service-card" key={service.id}>
          <div className="observability-card-top"><div className="service-icon">{service.status === 'down' ? <WifiOff size={20} /> : <ServerCog size={20} />}</div><span className={`status ${statusClass(service.status)}`}>{serviceStatusLabel(service.status)}</span></div>
          <span className="eyebrow">{service.productName} · {service.environment}</span>
          <h2>{service.name}</h2>
          <p>{service.targetUrl || 'Target URL не указан'}</p>
          <div className="service-stats"><div><span>Uptime</span><strong>{service.uptimePercent === null ? '—' : `${service.uptimePercent.toFixed(2)}%`}</strong></div><div><span>Latency</span><strong>{service.latencyMs === null ? '—' : `${service.latencyMs} ms`}</strong></div><div><span>SLO</span><strong>{service.sloTargetPercent}%</strong></div></div>
          <div className="service-meta"><span><Clock3 size={13} /> {formatDate(service.lastCheckAt)}</span><span>Criticality: {service.criticality}/5</span><span>{service.checkmateMonitorId ? `Monitor: ${service.checkmateMonitorId}` : 'Ожидает provisioning'}</span></div>
        </article>)}
        {!loading && services.length === 0 && <div className="inline-empty"><ServerCog size={30} /><h2>Сервисы не зарегистрированы</h2><p>Добавьте frontend, API, worker и инфраструктурные сервисы продуктов.</p></div>}
      </section>}

      {tab === 'incidents' && <section className="panel">
        <div className="table-wrap"><table><thead><tr><th>Инцидент</th><th>Продукт / сервис</th><th>Impact</th><th>Начало</th><th>Статус</th><th /></tr></thead><tbody>{incidents.map((incident) => <tr key={incident.id}><td><strong>{incident.title}</strong><span>{incident.message || incident.externalIncidentId}</span></td><td><strong>{incident.productName}</strong><span>{incident.serviceName}</span></td><td><span className={`status ${statusClass(incident.impact)}`}>{incident.impact}</span></td><td>{formatDate(incident.startedAt)}</td><td><span className={`status ${statusClass(incident.status)}`}>{incident.status === 'open' ? 'Открыт' : 'Закрыт'}</span>{incident.acknowledgedAt && <span>Подтверждён {formatDate(incident.acknowledgedAt)}</span>}</td><td>{incident.status === 'open' && !incident.acknowledgedAt && <button className="secondary-button compact" type="button" onClick={() => void acknowledge(incident.id)}>Подтвердить</button>}</td></tr>)}</tbody></table></div>
      </section>}

      {tab === 'connections' && <section className="observability-connection-grid">{connections.map((connection) => <article className="panel" key={connection.id}><div className="observability-card-top"><div><span className="eyebrow">{connection.environment}</span><h2>{connection.name}</h2></div><span className={`status ${statusClass(connection.status)}`}>{connection.status}</span></div><p>{connection.apiBaseUrl}</p><div className="connection-facts"><span>Latency: {connection.lastLatencyMs ?? '—'} ms</span><span>Последний тест: {formatDate(connection.lastTestedAt)}</span><span>Последняя sync: {formatDate(connection.lastSyncAt)}</span></div>{connection.lastError && <div className="connection-error"><AlertTriangle size={15} /> {connection.lastError}</div>}{canManage && <div className="observability-actions"><button className="secondary-button compact" type="button" onClick={() => void enqueueSync(connection.id, 'connection_test')}>Проверить</button><button className="primary-button" type="button" onClick={() => void enqueueSync(connection.id, 'full')}>Полная синхронизация</button></div>}</article>)}</section>}

      {tab === 'sync' && <section className="panel"><div className="table-wrap"><table><thead><tr><th>Подключение</th><th>Тип</th><th>Статус</th><th>Записи</th><th>Попытки</th><th>Дата</th></tr></thead><tbody>{syncRuns.map((run) => <tr key={run.id}><td><strong>{run.connectionName}</strong><span>{run.error}</span></td><td>{run.syncType}</td><td><span className={`status ${statusClass(run.status)}`}>{run.status}</span></td><td>{run.recordsWritten}/{run.recordsReceived}</td><td>{run.attemptCount}</td><td>{formatDate(run.createdAt)}</td></tr>)}</tbody></table></div></section>}

      <dialog ref={connectionDialog} className="modal wide-modal" onCancel={() => connectionDialog.current?.close()}><form onSubmit={submitConnection}><div className="modal-header"><div><span className="eyebrow">External Monitoring Engine</span><h2>Подключить Checkmate</h2><p>JWT хранится только через ссылку на секрет.</p></div><button type="button" className="icon-button" onClick={() => connectionDialog.current?.close()}>×</button></div><div className="form-grid"><label><span>Название *</span><input value={connectionForm.name} onChange={(event) => setConnectionForm({ ...connectionForm, name: event.target.value })} /></label><label><span>Среда</span><select value={connectionForm.environment} onChange={(event) => setConnectionForm({ ...connectionForm, environment: event.target.value })}><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option><option value="demo">Demo</option></select></label><label className="span-2"><span>Checkmate URL *</span><input value={connectionForm.apiBaseUrl} onChange={(event) => setConnectionForm({ ...connectionForm, apiBaseUrl: event.target.value })} /></label><label className="span-2"><span>Secret reference *</span><input value={connectionForm.secretReference} onChange={(event) => setConnectionForm({ ...connectionForm, secretReference: event.target.value })} /></label><label><span>Статус</span><select value={connectionForm.status} onChange={(event) => setConnectionForm({ ...connectionForm, status: event.target.value })}><option value="draft">Draft</option><option value="active">Active</option><option value="degraded">Degraded</option><option value="disabled">Disabled</option></select></label><label><span>Timeout, ms</span><input type="number" min="1000" max="120000" value={connectionForm.timeoutMs} onChange={(event) => setConnectionForm({ ...connectionForm, timeoutMs: Number(event.target.value) })} /></label></div>{validation && <div className="form-message">{validation}</div>}<div className="modal-actions"><button type="button" className="secondary-button compact" onClick={() => connectionDialog.current?.close()}>Отмена</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} Сохранить</button></div></form></dialog>

      <dialog ref={serviceDialog} className="modal wide-modal" onCancel={() => serviceDialog.current?.close()}><form onSubmit={submitService}><div className="modal-header"><div><span className="eyebrow">Service Registry</span><h2>Добавить сервис</h2><p>После сохранения Checkmate Adapter создаст или свяжет монитор.</p></div><button type="button" className="icon-button" onClick={() => serviceDialog.current?.close()}>×</button></div><div className="form-grid"><label><span>Продукт *</span><select value={serviceForm.productId} onChange={(event) => setServiceForm({ ...serviceForm, productId: event.target.value })}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label><span>Подключение</span><select value={serviceForm.connectionId ?? ''} onChange={(event) => setServiceForm({ ...serviceForm, connectionId: event.target.value || null })}><option value="">Без подключения</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label><label><span>Название *</span><input value={serviceForm.name} onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value, serviceKey: serviceForm.serviceKey || event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></label><label><span>Системный ключ *</span><input value={serviceForm.serviceKey} onChange={(event) => setServiceForm({ ...serviceForm, serviceKey: event.target.value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-') })} /></label><label><span>Тип сервиса</span><select value={serviceForm.kind} onChange={(event) => setServiceForm({ ...serviceForm, kind: event.target.value })}><option value="frontend">Frontend</option><option value="api">API</option><option value="worker">Worker</option><option value="database">Database</option><option value="queue">Queue</option><option value="infrastructure">Infrastructure</option><option value="other">Other</option></select></label><label><span>Monitor type</span><select value={serviceForm.monitorType} onChange={(event) => setServiceForm({ ...serviceForm, monitorType: event.target.value })}><option value="http">HTTP</option><option value="ping">Ping</option><option value="port">Port</option><option value="pagespeed">PageSpeed</option><option value="hardware">Hardware</option><option value="docker">Docker</option><option value="grpc">gRPC</option><option value="dns">DNS</option></select></label><label className="span-2"><span>Target URL</span><input value={serviceForm.targetUrl} onChange={(event) => setServiceForm({ ...serviceForm, targetUrl: event.target.value })} /></label><label><span>SLO, %</span><input type="number" step="0.001" min="0" max="100" value={serviceForm.sloTargetPercent} onChange={(event) => setServiceForm({ ...serviceForm, sloTargetPercent: Number(event.target.value) })} /></label><label><span>Criticality</span><input type="number" min="1" max="5" value={serviceForm.criticality} onChange={(event) => setServiceForm({ ...serviceForm, criticality: Number(event.target.value) })} /></label></div>{validation && <div className="form-message">{validation}</div>}<div className="modal-actions"><button type="button" className="secondary-button compact" onClick={() => serviceDialog.current?.close()}>Отмена</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Добавить сервис</button></div></form></dialog>
    </>
  );
}
