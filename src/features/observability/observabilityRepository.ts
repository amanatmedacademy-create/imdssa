import { getSupabase } from '../../lib/supabase';

export type ObservabilityConnection = {
  id: string;
  name: string;
  environment: string;
  apiBaseUrl: string;
  status: string;
  lastTestedAt: string | null;
  lastSyncAt: string | null;
  lastLatencyMs: number | null;
  lastError: string;
};

export type ObservabilityService = {
  id: string;
  productId: string;
  productName: string;
  environment: string;
  serviceKey: string;
  name: string;
  kind: string;
  criticality: number;
  targetUrl: string;
  sloTargetPercent: number;
  monitorType: string;
  monitorIntervalMs: number;
  checkmateMonitorId: string | null;
  status: string;
  uptimePercent: number | null;
  latencyMs: number | null;
  lastCheckAt: string | null;
  lastSyncedAt: string | null;
  visibleOnStatusPage: boolean;
};

export type ObservabilityIncident = {
  id: string;
  serviceId: string | null;
  serviceName: string;
  productName: string;
  externalIncidentId: string;
  status: string;
  impact: string;
  title: string;
  message: string;
  httpStatus: number | null;
  startedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
};

export type ObservabilitySyncRun = {
  id: string;
  connectionId: string;
  connectionName: string;
  syncType: string;
  status: string;
  attemptCount: number;
  recordsReceived: number;
  recordsWritten: number;
  errorCount: number;
  error: string;
  createdAt: string;
  finishedAt: string | null;
};

export type ObservabilityProduct = { id: string; key: string; name: string };

export type ObservabilitySnapshot = {
  connections: ObservabilityConnection[];
  services: ObservabilityService[];
  incidents: ObservabilityIncident[];
  syncRuns: ObservabilitySyncRun[];
  products: ObservabilityProduct[];
};

export type ConnectionInput = {
  id?: string | null;
  name: string;
  environment: string;
  apiBaseUrl: string;
  secretReference: string;
  status: string;
  timeoutMs: number;
};

export type ServiceInput = {
  id?: string | null;
  productId: string;
  connectionId: string | null;
  environment: string;
  serviceKey: string;
  name: string;
  description: string;
  kind: string;
  ownerTeam: string;
  criticality: number;
  targetUrl: string;
  expectedHttpStatus: number | null;
  sloTargetPercent: number;
  monitorType: string;
  monitorIntervalMs: number;
  visibleOnStatusPage: boolean;
};

const STORAGE_KEY = 'imds-super-admin:observability:v1';
const NOW = '2026-08-02T12:00:00.000Z';

const defaultSnapshot: ObservabilitySnapshot = {
  products: [
    { id: 'mis', key: 'imds-mis', name: 'IMDS MIS' },
    { id: 'crm', key: 'imds-crm', name: 'IMDS CRM' },
    { id: 'marketing', key: 'imds-marketing', name: 'IMDS Marketing' },
    { id: 'finance', key: 'imds-finance', name: 'IMDS Finance' },
    { id: 'contract', key: 'imds-contract', name: 'IMDS Contract' },
    { id: 'dashboard', key: 'imds-dashboard', name: 'IMDS Dashboard' },
  ],
  connections: [
    {
      id: 'connection-checkmate-production',
      name: 'Checkmate Production',
      environment: 'production',
      apiBaseUrl: 'https://monitor.imdstech.net',
      status: 'active',
      lastTestedAt: NOW,
      lastSyncAt: NOW,
      lastLatencyMs: 186,
      lastError: '',
    },
  ],
  services: [
    { id: 'service-crm-api', productId: 'crm', productName: 'IMDS CRM', environment: 'production', serviceKey: 'crm-api', name: 'CRM API', kind: 'api', criticality: 5, targetUrl: 'https://crm.imdstech.net/api/health', sloTargetPercent: 99.9, monitorType: 'http', monitorIntervalMs: 60000, checkmateMonitorId: 'cm-crm-api', status: 'up', uptimePercent: 99.98, latencyMs: 142, lastCheckAt: NOW, lastSyncedAt: NOW, visibleOnStatusPage: true },
    { id: 'service-mis-api', productId: 'mis', productName: 'IMDS MIS', environment: 'production', serviceKey: 'mis-api', name: 'MIS API', kind: 'api', criticality: 5, targetUrl: 'https://mis.imdstech.net/api/health', sloTargetPercent: 99.95, monitorType: 'http', monitorIntervalMs: 60000, checkmateMonitorId: 'cm-mis-api', status: 'up', uptimePercent: 99.99, latencyMs: 128, lastCheckAt: NOW, lastSyncedAt: NOW, visibleOnStatusPage: true },
    { id: 'service-marketing-worker', productId: 'marketing', productName: 'IMDS Marketing', environment: 'production', serviceKey: 'marketing-worker', name: 'Marketing Worker', kind: 'worker', criticality: 4, targetUrl: 'https://marketing.imdstech.net/health', sloTargetPercent: 99.5, monitorType: 'http', monitorIntervalMs: 60000, checkmateMonitorId: 'cm-marketing-worker', status: 'degraded', uptimePercent: 97.82, latencyMs: 846, lastCheckAt: NOW, lastSyncedAt: NOW, visibleOnStatusPage: true },
  ],
  incidents: [
    { id: 'incident-meta-timeout', serviceId: 'service-marketing-worker', serviceName: 'Marketing Worker', productName: 'IMDS Marketing', externalIncidentId: 'cm-incident-1', status: 'open', impact: 'major', title: 'Meta API timeout', message: 'Синхронизация рекламных кабинетов превышает timeout.', httpStatus: 504, startedAt: '2026-08-02T10:42:00.000Z', resolvedAt: null, acknowledgedAt: null },
  ],
  syncRuns: [
    { id: 'sync-1', connectionId: 'connection-checkmate-production', connectionName: 'Checkmate Production', syncType: 'full', status: 'succeeded', attemptCount: 1, recordsReceived: 16, recordsWritten: 16, errorCount: 0, error: '', createdAt: NOW, finishedAt: NOW },
  ],
};

function cloneDefault(): ObservabilitySnapshot {
  return JSON.parse(JSON.stringify(defaultSnapshot)) as ObservabilitySnapshot;
}

function readDemo(): ObservabilitySnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const snapshot = cloneDefault();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      return snapshot;
    }
    return JSON.parse(raw) as ObservabilitySnapshot;
  } catch {
    return cloneDefault();
  }
}

function writeDemo(snapshot: ObservabilitySnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function listSupabase(): Promise<ObservabilitySnapshot> {
  const client = getSupabase() as any;
  if (!client) return readDemo();

  const [connectionResult, serviceResult, incidentResult, syncResult, productResult] = await Promise.all([
    client.from('observability_connections').select('*').order('created_at', { ascending: false }),
    client.from('observability_services').select('*').is('archived_at', null).order('created_at', { ascending: false }),
    client.from('observability_incidents').select('*').order('started_at', { ascending: false }).limit(200),
    client.from('observability_sync_runs').select('*').order('created_at', { ascending: false }).limit(100),
    client.from('products').select('id,key,name').is('archived_at', null).order('name'),
  ]);

  const error = connectionResult.error ?? serviceResult.error ?? incidentResult.error ?? syncResult.error ?? productResult.error;
  if (error) throw new Error(error.message);

  const products: ObservabilityProduct[] = (productResult.data ?? []).map((item: any) => ({ id: item.id, key: item.key, name: item.name }));
  const productName = new Map(products.map((item) => [item.id, item.name]));
  const serviceRows = serviceResult.data ?? [];
  const services: ObservabilityService[] = serviceRows.map((item: any) => ({
    id: item.id,
    productId: item.product_id,
    productName: productName.get(item.product_id) ?? item.product_id,
    environment: item.environment,
    serviceKey: item.service_key,
    name: item.name,
    kind: item.kind,
    criticality: item.criticality,
    targetUrl: item.target_url ?? '',
    sloTargetPercent: Number(item.slo_target_percent),
    monitorType: item.monitor_type,
    monitorIntervalMs: item.monitor_interval_ms,
    checkmateMonitorId: item.checkmate_monitor_id,
    status: item.status,
    uptimePercent: item.current_uptime_percent === null ? null : Number(item.current_uptime_percent),
    latencyMs: item.current_latency_ms,
    lastCheckAt: item.last_check_at,
    lastSyncedAt: item.last_synced_at,
    visibleOnStatusPage: item.visible_on_status_page,
  }));
  const serviceById = new Map(services.map((item) => [item.id, item]));
  const connections: ObservabilityConnection[] = (connectionResult.data ?? []).map((item: any) => ({
    id: item.id,
    name: item.name,
    environment: item.environment,
    apiBaseUrl: item.api_base_url,
    status: item.status,
    lastTestedAt: item.last_tested_at,
    lastSyncAt: item.last_sync_at,
    lastLatencyMs: item.last_latency_ms,
    lastError: item.last_error ?? '',
  }));
  const connectionName = new Map(connections.map((item) => [item.id, item.name]));
  const incidents: ObservabilityIncident[] = (incidentResult.data ?? []).map((item: any) => {
    const service = item.service_id ? serviceById.get(item.service_id) : null;
    return {
      id: item.id,
      serviceId: item.service_id,
      serviceName: service?.name ?? item.external_monitor_id ?? 'Неизвестный сервис',
      productName: service?.productName ?? 'Без продукта',
      externalIncidentId: item.external_incident_id,
      status: item.status,
      impact: item.impact,
      title: item.title,
      message: item.message ?? '',
      httpStatus: item.http_status,
      startedAt: item.started_at,
      resolvedAt: item.resolved_at,
      acknowledgedAt: item.acknowledged_at,
    };
  });
  const syncRuns: ObservabilitySyncRun[] = (syncResult.data ?? []).map((item: any) => ({
    id: item.id,
    connectionId: item.connection_id,
    connectionName: connectionName.get(item.connection_id) ?? item.connection_id,
    syncType: item.sync_type,
    status: item.status,
    attemptCount: item.attempt_count ?? 0,
    recordsReceived: item.records_received,
    recordsWritten: item.records_written,
    errorCount: item.error_count,
    error: item.error ?? '',
    createdAt: item.created_at,
    finishedAt: item.finished_at,
  }));

  return { connections, services, incidents, syncRuns, products };
}

export const observabilityRepository = {
  list: listSupabase,

  async saveConnection(input: ConnectionInput): Promise<ObservabilitySnapshot> {
    const client = getSupabase() as any;
    if (client) {
      const { error } = await client.rpc('configure_observability_connection', {
        target_connection_id: input.id ?? null,
        connection_name: input.name,
        environment_value: input.environment,
        api_base_url_value: input.apiBaseUrl,
        secret_reference_value: input.secretReference,
        status_value: input.status,
        timeout_ms_value: input.timeoutMs,
        verify_tls_value: true,
      });
      if (error) throw new Error(error.message);
      return listSupabase();
    }

    const snapshot = readDemo();
    const id = input.id ?? createId('connection');
    const next: ObservabilityConnection = {
      id,
      name: input.name,
      environment: input.environment,
      apiBaseUrl: input.apiBaseUrl,
      status: input.status,
      lastTestedAt: null,
      lastSyncAt: null,
      lastLatencyMs: null,
      lastError: '',
    };
    snapshot.connections = input.id
      ? snapshot.connections.map((item) => item.id === input.id ? next : item)
      : [next, ...snapshot.connections];
    writeDemo(snapshot);
    return snapshot;
  },

  async saveService(input: ServiceInput): Promise<ObservabilitySnapshot> {
    const client = getSupabase() as any;
    if (client) {
      const { error } = await client.rpc('upsert_observability_service', {
        target_service_id: input.id ?? null,
        product_id_value: input.productId,
        connection_id_value: input.connectionId,
        environment_value: input.environment,
        service_key_value: input.serviceKey,
        name_value: input.name,
        description_value: input.description,
        kind_value: input.kind,
        owner_team_value: input.ownerTeam,
        criticality_value: input.criticality,
        target_url_value: input.targetUrl,
        expected_http_status_value: input.expectedHttpStatus,
        slo_target_percent_value: input.sloTargetPercent,
        monitor_type_value: input.monitorType,
        monitor_interval_ms_value: input.monitorIntervalMs,
        visible_on_status_page_value: input.visibleOnStatusPage,
        monitor_config_value: {},
      });
      if (error) throw new Error(error.message);
      return listSupabase();
    }

    const snapshot = readDemo();
    const productName = snapshot.products.find((item) => item.id === input.productId)?.name ?? input.productId;
    const id = input.id ?? createId('service');
    const existing = snapshot.services.find((item) => item.id === id);
    const next: ObservabilityService = {
      id,
      productId: input.productId,
      productName,
      environment: input.environment,
      serviceKey: input.serviceKey,
      name: input.name,
      kind: input.kind,
      criticality: input.criticality,
      targetUrl: input.targetUrl,
      sloTargetPercent: input.sloTargetPercent,
      monitorType: input.monitorType,
      monitorIntervalMs: input.monitorIntervalMs,
      checkmateMonitorId: existing?.checkmateMonitorId ?? null,
      status: existing?.status ?? 'unknown',
      uptimePercent: existing?.uptimePercent ?? null,
      latencyMs: existing?.latencyMs ?? null,
      lastCheckAt: existing?.lastCheckAt ?? null,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      visibleOnStatusPage: input.visibleOnStatusPage,
    };
    snapshot.services = input.id
      ? snapshot.services.map((item) => item.id === input.id ? next : item)
      : [next, ...snapshot.services];
    writeDemo(snapshot);
    return snapshot;
  },

  async enqueueSync(connectionId: string, syncType: string): Promise<ObservabilitySnapshot> {
    const client = getSupabase() as any;
    if (client) {
      const { error } = await client.rpc('enqueue_observability_sync', {
        target_connection_id: connectionId,
        sync_type_value: syncType,
      });
      if (error) throw new Error(error.message);
      return listSupabase();
    }

    const snapshot = readDemo();
    snapshot.syncRuns.unshift({
      id: createId('sync'),
      connectionId,
      connectionName: snapshot.connections.find((item) => item.id === connectionId)?.name ?? connectionId,
      syncType,
      status: 'queued',
      attemptCount: 0,
      recordsReceived: 0,
      recordsWritten: 0,
      errorCount: 0,
      error: '',
      createdAt: new Date().toISOString(),
      finishedAt: null,
    });
    writeDemo(snapshot);
    return snapshot;
  },

  async acknowledgeIncident(incidentId: string, note: string): Promise<ObservabilitySnapshot> {
    const client = getSupabase() as any;
    if (client) {
      const { error } = await client.rpc('acknowledge_observability_incident', {
        target_incident_id: incidentId,
        note_value: note,
      });
      if (error) throw new Error(error.message);
      return listSupabase();
    }

    const snapshot = readDemo();
    snapshot.incidents = snapshot.incidents.map((item) => item.id === incidentId ? { ...item, acknowledgedAt: new Date().toISOString() } : item);
    writeDemo(snapshot);
    return snapshot;
  },
};
