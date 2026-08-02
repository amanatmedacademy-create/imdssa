import { createClient } from 'npm:@supabase/supabase-js@2';

type SyncType = 'connection_test' | 'monitors' | 'incidents' | 'maintenance' | 'status_pages' | 'full';

type SyncRun = {
  id: string;
  connection_id: string;
  sync_type: SyncType;
  attempt_count: number;
  max_attempts: number;
};

type Connection = {
  id: string;
  api_base_url: string;
  secret_reference: string;
  timeout_ms: number;
  verify_tls: boolean;
};

type Product = { id: string; key: string; name: string };

type Service = {
  id: string;
  product_id: string;
  environment: string;
  service_key: string;
  name: string;
  connection_id: string | null;
  checkmate_monitor_id: string | null;
  monitor_type: string;
  target_url: string | null;
  monitor_interval_ms: number;
  desired_monitor_state: string;
  monitor_config: Record<string, unknown>;
};

class WorkerError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
    this.name = 'WorkerError';
  }
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function resolveSecret(reference: string): string {
  if (reference.startsWith('env://')) {
    return requiredEnv(reference.slice('env://'.length));
  }

  if (reference.startsWith('vault://')) {
    const mapping = Deno.env.get('IMDS_SECRET_REFERENCE_MAP');
    if (!mapping) throw new WorkerError('Vault mapping is not configured', false);
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(mapping) as Record<string, string>;
    } catch {
      throw new WorkerError('IMDS_SECRET_REFERENCE_MAP is invalid JSON', false);
    }
    const value = parsed[reference];
    if (!value) throw new WorkerError(`Secret mapping not found for ${reference}`, false);
    return value;
  }

  throw new WorkerError('Unsupported secret reference', false);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

async function fetchJson<T>(connection: Connection, path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), connection.timeout_ms);

  try {
    const response = await fetch(`${normalizeBaseUrl(connection.api_base_url)}/api/v1${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'x-imds-client': 'super-admin-checkmate-adapter/1.0',
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      throw new WorkerError(`Checkmate ${path} returned HTTP ${response.status}`, retryable);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new WorkerError(`Checkmate ${path} timed out`);
    }
    throw new WorkerError(error instanceof Error ? error.message : `Checkmate ${path} request failed`);
  } finally {
    clearTimeout(timer);
  }
}

function unwrapList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const key of ['data', 'monitors', 'incidents', 'maintenanceWindows', 'statusPages', 'items']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function monitorStatus(value: unknown, active: boolean | null): string {
  if (active === false) return 'paused';
  const status = asString(value)?.toLowerCase();
  if (status === 'up') return 'up';
  if (status === 'down' || status === 'breached') return 'down';
  if (status === 'paused') return 'paused';
  if (status === 'initializing') return 'initializing';
  return 'unknown';
}

function incidentImpact(statusCode: number | null, message: string | null): string {
  if (statusCode !== null && statusCode >= 500) return 'critical';
  const normalized = (message ?? '').toLowerCase();
  if (normalized.includes('timeout') || normalized.includes('unreachable')) return 'major';
  return 'minor';
}

function sanitizePayload(value: unknown): Record<string, unknown> {
  const input = asRecord(value);
  const blocked = new Set(['token', 'accessToken', 'password', 'secret', 'authorization']);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    if (blocked.has(key)) continue;
    if (typeof item === 'string') output[key] = item.slice(0, 4000);
    else if (typeof item === 'number' || typeof item === 'boolean' || item === null) output[key] = item;
  }
  return output;
}

async function syncMonitors(
  admin: ReturnType<typeof createClient>,
  connection: Connection,
  token: string,
): Promise<{ received: number; written: number }> {
  const payload = await fetchJson<unknown>(connection, '/monitors/team', token);
  const monitors = unwrapList(payload);

  const [{ data: services, error: serviceError }, { data: products, error: productError }] = await Promise.all([
    admin.from('observability_services').select('*').eq('connection_id', connection.id),
    admin.from('products').select('id,key,name'),
  ]);
  if (serviceError) throw new WorkerError(serviceError.message, false);
  if (productError) throw new WorkerError(productError.message, false);

  const serviceRows = (services ?? []) as Service[];
  const productRows = (products ?? []) as Product[];
  const serviceByExternalId = new Map(serviceRows.filter((item) => item.checkmate_monitor_id).map((item) => [item.checkmate_monitor_id as string, item]));
  const serviceByKey = new Map(serviceRows.map((item) => [item.service_key, item]));
  const productByKey = new Map(productRows.map((item) => [item.key, item]));
  let written = 0;

  for (const rawMonitor of monitors) {
    const monitor = asRecord(rawMonitor);
    const externalId = asString(monitor._id ?? monitor.id);
    if (!externalId) continue;

    const tags = Array.isArray(monitor.tags) ? monitor.tags.filter((item): item is string => typeof item === 'string') : [];
    const imdsProductTag = tags.find((tag) => tag.startsWith('imds-product:'));
    const imdsServiceTag = tags.find((tag) => tag.startsWith('imds-service:'));
    const serviceKey = imdsServiceTag?.slice('imds-service:'.length) ?? asString(monitor.name)?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? externalId;
    const existing = serviceByExternalId.get(externalId) ?? serviceByKey.get(serviceKey);
    const product = imdsProductTag ? productByKey.get(imdsProductTag.slice('imds-product:'.length)) : null;
    const active = asBoolean(monitor.isActive);
    const status = monitorStatus(monitor.status, active);
    const uptime = asNumber(monitor.uptimePercentage);
    const latency = asNumber(monitor.responseTime ?? monitor.latency ?? monitor.averageResponseTime);
    const lastCheck = asString(monitor.lastCheckedAt ?? monitor.updatedAt);

    if (existing) {
      const { error } = await admin.from('observability_services').update({
        checkmate_monitor_id: externalId,
        name: asString(monitor.name) ?? existing.name,
        monitor_type: asString(monitor.type) ?? existing.monitor_type,
        target_url: asString(monitor.url) ?? existing.target_url,
        status,
        desired_monitor_state: active === false ? 'paused' : existing.desired_monitor_state,
        current_uptime_percent: uptime,
        current_latency_ms: latency,
        last_check_at: lastCheck,
        last_synced_at: new Date().toISOString(),
        last_error: null,
        metadata: sanitizePayload(monitor),
      }).eq('id', existing.id);
      if (error) throw new WorkerError(error.message, false);
      written += 1;
      continue;
    }

    if (!product) continue;

    const { error } = await admin.from('observability_services').insert({
      product_id: product.id,
      connection_id: connection.id,
      environment: 'production',
      service_key: serviceKey,
      name: asString(monitor.name) ?? serviceKey,
      description: asString(monitor.description),
      kind: 'other',
      criticality: 3,
      target_url: asString(monitor.url),
      slo_target_percent: 99.9,
      monitor_type: asString(monitor.type) ?? 'http',
      monitor_interval_ms: asNumber(monitor.interval) ?? 60000,
      desired_monitor_state: active === false ? 'paused' : 'active',
      checkmate_monitor_id: externalId,
      status,
      current_uptime_percent: uptime,
      current_latency_ms: latency,
      last_check_at: lastCheck,
      last_synced_at: new Date().toISOString(),
      visible_on_status_page: true,
      monitor_config: {},
      metadata: sanitizePayload(monitor),
    });
    if (error) throw new WorkerError(error.message, false);
    written += 1;
  }

  return { received: monitors.length, written };
}

async function syncIncidents(
  admin: ReturnType<typeof createClient>,
  connection: Connection,
  token: string,
): Promise<{ received: number; written: number }> {
  const payload = await fetchJson<unknown>(connection, '/incidents/team', token);
  const incidents = unwrapList(payload);
  const { data: services, error: serviceError } = await admin
    .from('observability_services')
    .select('id,checkmate_monitor_id')
    .eq('connection_id', connection.id);
  if (serviceError) throw new WorkerError(serviceError.message, false);
  const serviceByMonitor = new Map((services ?? []).map((service) => [service.checkmate_monitor_id as string, service.id as string]));
  let written = 0;

  for (const rawIncident of incidents) {
    const incident = asRecord(rawIncident);
    const externalIncidentId = asString(incident.id ?? incident._id);
    const externalMonitorId = asString(incident.monitorId ?? incident.monitor_id);
    const startedAt = asString(incident.startTime ?? incident.startedAt ?? incident.createdAt);
    if (!externalIncidentId || !startedAt) continue;

    const resolved = asBoolean(incident.status) === true || Boolean(asString(incident.endTime ?? incident.resolvedAt));
    const statusCode = asNumber(incident.statusCode);
    const message = asString(incident.message);
    const serviceId = externalMonitorId ? serviceByMonitor.get(externalMonitorId) ?? null : null;
    const title = message ?? `Checkmate incident ${externalIncidentId}`;

    const { error } = await admin.from('observability_incidents').upsert({
      connection_id: connection.id,
      service_id: serviceId,
      external_incident_id: externalIncidentId,
      external_monitor_id: externalMonitorId,
      status: resolved ? 'resolved' : 'open',
      impact: resolved ? 'none' : incidentImpact(statusCode, message),
      title,
      message,
      http_status: statusCode,
      started_at: startedAt,
      resolved_at: asString(incident.endTime ?? incident.resolvedAt),
      resolution_type: asString(incident.resolutionType),
      resolved_by: asString(incident.resolvedByEmail ?? incident.resolvedBy),
      last_synced_at: new Date().toISOString(),
      raw_payload: sanitizePayload(incident),
    }, { onConflict: 'connection_id,external_incident_id' });
    if (error) throw new WorkerError(error.message, false);
    written += 1;
  }

  return { received: incidents.length, written };
}

async function syncMaintenance(
  admin: ReturnType<typeof createClient>,
  connection: Connection,
  token: string,
): Promise<{ received: number; written: number }> {
  const payload = await fetchJson<unknown>(connection, '/maintenance-window/team', token);
  const windows = unwrapList(payload);
  let written = 0;

  for (const rawWindow of windows) {
    const windowRecord = asRecord(rawWindow);
    const externalId = asString(windowRecord.id ?? windowRecord._id);
    const startsAt = asString(windowRecord.start ?? windowRecord.startsAt);
    const endsAt = asString(windowRecord.end ?? windowRecord.endsAt);
    if (!externalId || !startsAt || !endsAt) continue;

    const active = asBoolean(windowRecord.active) ?? true;
    const now = Date.now();
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();
    const status = !active ? 'cancelled' : now < startMs ? 'scheduled' : now <= endMs ? 'active' : 'completed';
    const duration = asNumber(windowRecord.duration) ?? 0;
    const unit = asString(windowRecord.durationUnit) ?? 'seconds';
    const multiplier = unit === 'days' ? 86400 : unit === 'hours' ? 3600 : unit === 'minutes' ? 60 : 1;

    const { error } = await admin.from('observability_maintenance_windows').upsert({
      connection_id: connection.id,
      external_window_id: externalId,
      name: asString(windowRecord.name) ?? `Maintenance ${externalId}`,
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      repeat_seconds: (asNumber(windowRecord.repeat) ?? 0) * multiplier,
      expires_at: asString(windowRecord.expiry),
      active,
      last_synced_at: new Date().toISOString(),
      raw_payload: sanitizePayload(windowRecord),
    }, { onConflict: 'connection_id,external_window_id' });
    if (error) throw new WorkerError(error.message, false);
    written += 1;
  }

  return { received: windows.length, written };
}

async function syncStatusPages(
  admin: ReturnType<typeof createClient>,
  connection: Connection,
  token: string,
): Promise<{ received: number; written: number }> {
  const payload = await fetchJson<unknown>(connection, '/status-page/team', token);
  const pages = unwrapList(payload);
  let written = 0;

  for (const rawPage of pages) {
    const page = asRecord(rawPage);
    const externalId = asString(page.id ?? page._id);
    const slug = asString(page.url ?? page.slug);
    if (!externalId || !slug) continue;

    const { error } = await admin.from('observability_status_pages').upsert({
      connection_id: connection.id,
      external_page_id: externalId,
      name: asString(page.name) ?? slug,
      slug,
      custom_domain: asString(page.customDomain),
      public_url: asString(page.publicUrl),
      theme: asString(page.theme),
      is_published: asBoolean(page.isPublished ?? page.published) ?? true,
      last_synced_at: new Date().toISOString(),
      raw_payload: sanitizePayload(page),
    }, { onConflict: 'connection_id,external_page_id' });
    if (error) throw new WorkerError(error.message, false);
    written += 1;
  }

  return { received: pages.length, written };
}

async function processRun(admin: ReturnType<typeof createClient>, run: SyncRun): Promise<void> {
  const { data: connectionData, error: connectionError } = await admin
    .from('observability_connections')
    .select('*')
    .eq('id', run.connection_id)
    .single();
  if (connectionError || !connectionData) throw new WorkerError(connectionError?.message ?? 'Connection not found', false);

  const connection = connectionData as Connection;
  const token = resolveSecret(connection.secret_reference);
  const startedAt = performance.now();
  let received = 0;
  let written = 0;
  let partial = false;
  const details: Record<string, unknown> = {};

  try {
    if (run.sync_type === 'connection_test') {
      await fetchJson(connection, '/monitors/team?limit=1', token);
      details.connectionTest = 'ok';
    } else {
      const tasks: Array<{ key: string; enabled: boolean; execute: () => Promise<{ received: number; written: number }> }> = [
        { key: 'monitors', enabled: run.sync_type === 'full' || run.sync_type === 'monitors', execute: () => syncMonitors(admin, connection, token) },
        { key: 'incidents', enabled: run.sync_type === 'full' || run.sync_type === 'incidents', execute: () => syncIncidents(admin, connection, token) },
        { key: 'maintenance', enabled: run.sync_type === 'full' || run.sync_type === 'maintenance', execute: () => syncMaintenance(admin, connection, token) },
        { key: 'statusPages', enabled: run.sync_type === 'full' || run.sync_type === 'status_pages', execute: () => syncStatusPages(admin, connection, token) },
      ];

      for (const task of tasks.filter((item) => item.enabled)) {
        try {
          const result = await task.execute();
          received += result.received;
          written += result.written;
          details[task.key] = result;
        } catch (error) {
          if (run.sync_type !== 'full') throw error;
          partial = true;
          details[task.key] = { error: error instanceof Error ? error.message : 'Unknown sync error' };
        }
      }
    }

    const latency = Math.round(performance.now() - startedAt);
    await admin.from('observability_connections').update({
      last_tested_at: new Date().toISOString(),
      last_latency_ms: latency,
      last_error: null,
      status: partial ? 'degraded' : 'active',
    }).eq('id', connection.id);

    const { error: completeError } = await admin.rpc('complete_observability_sync_run', {
      target_run_id: run.id,
      succeeded_value: true,
      partial_value: partial,
      records_received_value: received,
      records_written_value: written,
      error_count_value: partial ? 1 : 0,
      error_value: partial ? 'One or more Checkmate resources failed to synchronize' : null,
      details_value: { ...details, latencyMs: latency },
      retry_after_seconds: 60,
    });
    if (completeError) throw new WorkerError(completeError.message, false);
  } catch (error) {
    const workerError = error instanceof WorkerError ? error : new WorkerError(error instanceof Error ? error.message : 'Unexpected adapter failure');
    const retrySeconds = Math.min(3600, Math.max(60, 2 ** Math.max(run.attempt_count, 1) * 30));
    await admin.rpc('complete_observability_sync_run', {
      target_run_id: run.id,
      succeeded_value: false,
      partial_value: false,
      records_received_value: received,
      records_written_value: written,
      error_count_value: 1,
      error_value: workerError.message,
      details_value: { ...details, retryable: workerError.retryable },
      retry_after_seconds: workerError.retryable ? retrySeconds : 3600,
    });
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const expectedToken = requiredEnv('IMDS_OBSERVABILITY_WORKER_TOKEN');
  if (request.headers.get('x-imds-worker-token') !== expectedToken) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-imds-service': 'checkmate-adapter/1.0' } },
    });

    let body: Record<string, unknown> = {};
    try {
      body = asRecord(await request.json());
    } catch {
      body = {};
    }

    const workerId = asString(body.workerId) ?? `checkmate-adapter-${crypto.randomUUID()}`;
    const batchSize = Math.max(1, Math.min(10, Math.trunc(asNumber(body.batchSize) ?? 5)));
    const staleAfterSeconds = Math.max(60, Math.min(3600, Math.trunc(asNumber(body.staleAfterSeconds) ?? 600)));

    await admin.rpc('requeue_stale_observability_sync_runs', { stale_after_seconds: staleAfterSeconds });
    const { data: runs, error: claimError } = await admin.rpc('claim_observability_sync_runs', {
      worker_id_value: workerId,
      batch_size_value: batchSize,
    });
    if (claimError) throw claimError;

    const claimedRuns = (runs ?? []) as SyncRun[];
    for (const run of claimedRuns) await processRun(admin, run);

    return jsonResponse({ workerId, claimed: claimedRuns.length, runIds: claimedRuns.map((run) => run.id) });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected Checkmate adapter failure' }, 500);
  }
});
