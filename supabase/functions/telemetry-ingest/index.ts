import { createClient } from 'npm:@supabase/supabase-js@2';

type TelemetrySource = {
  id: string;
  product_id: string;
  source_key: string;
  source_type: 'browser' | 'server';
  environment: string;
  write_key_hash: string;
  allowed_origins: string[];
  status: 'draft' | 'active' | 'disabled' | 'compromised';
  sample_rate: number | string;
};

type EventDefinition = {
  event_name: string;
  category: 'session' | 'navigation' | 'feature' | 'business' | 'error' | 'performance' | 'system';
  allowed_property_keys: string[];
};

type ProductRecord = { id: string; key: string };

type ValidationIssue = { index: number; field: string; message: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const EVENT_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const MAX_REQUEST_BYTES = 262_144;
const MAX_BATCH_EVENTS = 100;
const MAX_REQUESTS_PER_MINUTE = 240;
const FUNCTION_VERSION = '1.0.0';

const BLOCKED_PROPERTY_KEYS = [
  /password/i,
  /passcode/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /patient/i,
  /diagnos/i,
  /symptom/i,
  /medical/i,
  /treatment/i,
  /anamnes/i,
  /phone/i,
  /email/i,
  /address/i,
  /^iin$/i,
  /credit.?card/i,
  /bank.?account/i,
  /comment/i,
  /note/i,
  /message/i,
  /query/i,
];

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeOrigin(value: string): string {
  return value.trim().toLowerCase().replace(/\/$/, '');
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-imds-source-key, x-imds-write-key, x-imds-request-id, x-imds-sdk-version',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
    vary: 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function safeUserLabel(value: unknown): string | null {
  const label = boundedString(value, 160);
  if (!label) return null;
  if (label.includes('@') || /\d{7,}/.test(label)) return null;
  return label;
}

function safeRoute(value: unknown): string | null {
  const route = boundedString(value, 500);
  if (!route) return null;
  try {
    const parsed = new URL(route, 'https://telemetry.invalid');
    return parsed.pathname.slice(0, 500);
  } catch {
    return route.split(/[?#]/, 1)[0].slice(0, 500);
  }
}

function safeInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  if (normalized < minimum || normalized > maximum) return null;
  return normalized;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 3) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      if (BLOCKED_PROPERTY_KEYS.some((pattern) => pattern.test(key))) continue;
      const sanitized = sanitizeValue(item, depth + 1);
      if (sanitized !== undefined) output[key.slice(0, 80)] = sanitized;
    }
    return output;
  }
  return undefined;
}

function sanitizeProperties(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  const sanitized = sanitizeValue(asObject(value), 0) as Record<string, unknown>;
  if (!allowedKeys.length) return {};
  return Object.fromEntries(Object.entries(sanitized).filter(([key]) => allowedKeys.includes(key)));
}

function sanitizeSessionMetadata(value: unknown): Record<string, unknown> {
  const allowed = new Set(['locale', 'deployment', 'release', 'workspaceMode']);
  const sanitized = sanitizeValue(asObject(value), 0) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(sanitized).filter(([key]) => allowed.has(key)));
}

function validateUuid(value: unknown): string | null {
  const candidate = boundedString(value, 36);
  return candidate && UUID_PATTERN.test(candidate) ? candidate : null;
}

function validateKey(value: unknown): string | null {
  const candidate = boundedString(value, 120)?.toLowerCase() ?? null;
  return candidate && KEY_PATTERN.test(candidate) ? candidate : null;
}

function validateTimestamp(value: unknown): string | null {
  const candidate = boundedString(value, 64);
  if (!candidate) return null;
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) return null;
  const now = Date.now();
  if (timestamp < now - 7 * 86_400_000 || timestamp > now + 10 * 60_000) return null;
  return new Date(timestamp).toISOString();
}

function detectDeviceType(value: unknown): string | null {
  const deviceType = boundedString(value, 40)?.toLowerCase() ?? null;
  return deviceType && ['desktop', 'mobile', 'tablet', 'server', 'unknown'].includes(deviceType) ? deviceType : null;
}

function normalizeEvent(
  value: unknown,
  index: number,
  definitions: Map<string, EventDefinition>,
  products: Map<string, string>,
  requestSdkVersion: string | null,
): { event?: Record<string, unknown>; issues: ValidationIssue[] } {
  const input = asObject(value);
  const issues: ValidationIssue[] = [];
  const eventId = validateUuid(input.eventId);
  const sessionId = input.sessionId === null || input.sessionId === undefined ? null : validateUuid(input.sessionId);
  const eventName = boundedString(input.eventName, 80)?.toLowerCase() ?? null;
  const occurredAt = validateTimestamp(input.occurredAt);
  const definition = eventName ? definitions.get(eventName) : undefined;

  if (!eventId) issues.push({ index, field: 'eventId', message: 'A valid UUID eventId is required.' });
  if (input.sessionId !== null && input.sessionId !== undefined && !sessionId) issues.push({ index, field: 'sessionId', message: 'sessionId must be a UUID.' });
  if (!eventName || !EVENT_PATTERN.test(eventName)) issues.push({ index, field: 'eventName', message: 'eventName is invalid.' });
  else if (!definition) issues.push({ index, field: 'eventName', message: 'eventName is not registered or is disabled.' });
  if (!occurredAt) issues.push({ index, field: 'occurredAt', message: 'occurredAt is invalid or outside the accepted window.' });

  const moduleKey = input.moduleKey === null || input.moduleKey === undefined ? null : validateKey(input.moduleKey);
  const featureKey = input.featureKey === null || input.featureKey === undefined ? null : validateKey(input.featureKey);
  if (input.moduleKey !== null && input.moduleKey !== undefined && !moduleKey) issues.push({ index, field: 'moduleKey', message: 'moduleKey is invalid.' });
  if (input.featureKey !== null && input.featureKey !== undefined && !featureKey) issues.push({ index, field: 'featureKey', message: 'featureKey is invalid.' });

  const moduleOwnerProductKey = input.moduleOwnerProductKey === null || input.moduleOwnerProductKey === undefined
    ? null
    : validateKey(input.moduleOwnerProductKey);
  const moduleOwnerProductId = moduleOwnerProductKey ? products.get(moduleOwnerProductKey) ?? null : null;
  if (moduleOwnerProductKey && !moduleOwnerProductId) {
    issues.push({ index, field: 'moduleOwnerProductKey', message: 'The module owner product is not registered.' });
  }

  const outcome = boundedString(input.outcome, 20)?.toLowerCase() ?? 'neutral';
  if (!['neutral', 'success', 'failure'].includes(outcome)) issues.push({ index, field: 'outcome', message: 'outcome is invalid.' });

  const presenceStatus = boundedString(input.presenceStatus, 20)?.toLowerCase() ?? 'active';
  if (!['active', 'idle', 'offline', 'closed'].includes(presenceStatus)) {
    issues.push({ index, field: 'presenceStatus', message: 'presenceStatus is invalid.' });
  }

  const organizationValue = boundedString(input.organizationId, 160);
  const branchValue = boundedString(input.branchId, 160);
  const organizationId = organizationValue && UUID_PATTERN.test(organizationValue) ? organizationValue : null;
  const branchId = branchValue && UUID_PATTERN.test(branchValue) ? branchValue : null;
  const organizationKey = organizationId ? boundedString(input.organizationKey, 160) : organizationValue ?? boundedString(input.organizationKey, 160);
  const branchKey = branchId ? boundedString(input.branchKey, 160) : branchValue ?? boundedString(input.branchKey, 160);

  const activeSecondsDelta = safeInteger(input.activeSecondsDelta ?? 0, 0, 300);
  const idleSecondsDelta = safeInteger(input.idleSecondsDelta ?? 0, 0, 1800);
  const durationMs = input.durationMs === null || input.durationMs === undefined ? null : safeInteger(input.durationMs, 0, 86_400_000);
  if (activeSecondsDelta === null) issues.push({ index, field: 'activeSecondsDelta', message: 'activeSecondsDelta is invalid.' });
  if (idleSecondsDelta === null) issues.push({ index, field: 'idleSecondsDelta', message: 'idleSecondsDelta is invalid.' });
  if (input.durationMs !== null && input.durationMs !== undefined && durationMs === null) issues.push({ index, field: 'durationMs', message: 'durationMs is invalid.' });

  const sessionStartedAt = input.sessionStartedAt ? validateTimestamp(input.sessionStartedAt) : occurredAt;
  const lastActivityAt = input.lastActivityAt ? validateTimestamp(input.lastActivityAt) : null;
  if (input.sessionStartedAt && !sessionStartedAt) issues.push({ index, field: 'sessionStartedAt', message: 'sessionStartedAt is invalid.' });
  if (input.lastActivityAt && !lastActivityAt) issues.push({ index, field: 'lastActivityAt', message: 'lastActivityAt is invalid.' });

  if (issues.length || !eventId || !eventName || !occurredAt || !definition) return { issues };

  const normalized: Record<string, unknown> = {
    eventId,
    sessionId,
    eventName,
    category: definition.category,
    occurredAt,
    sessionStartedAt,
    lastActivityAt,
    presenceStatus,
    outcome,
    organizationId,
    organizationKey,
    branchId,
    branchKey,
    userKey: boundedString(input.userKey, 160),
    userLabel: safeUserLabel(input.userLabel),
    userRole: boundedString(input.userRole, 80),
    moduleOwnerProductId,
    route: safeRoute(input.route),
    moduleKey,
    moduleName: boundedString(input.moduleName, 120),
    featureKey,
    durationMs,
    activeSecondsDelta,
    idleSecondsDelta,
    properties: sanitizeProperties(input.properties, definition.allowed_property_keys ?? []),
    appVersion: boundedString(input.appVersion, 80),
    sdkVersion: boundedString(input.sdkVersion, 80) ?? requestSdkVersion,
    tabVisible: typeof input.tabVisible === 'boolean' ? input.tabVisible : true,
    deviceType: detectDeviceType(input.deviceType),
    browser: boundedString(input.browser, 80),
    operatingSystem: boundedString(input.operatingSystem, 80),
    timezone: boundedString(input.timezone, 80),
    sessionMetadata: sanitizeSessionMetadata(input.sessionMetadata),
  };

  if (JSON.stringify(normalized).length > 8192) {
    return { issues: [{ index, field: 'event', message: 'The normalized event exceeds 8 KiB.' }] };
  }

  return { event: normalized, issues: [] };
}

async function shouldSample(source: TelemetrySource, sessionOrRequestId: string): Promise<boolean> {
  const sampleRate = Number(source.sample_rate);
  if (!Number.isFinite(sampleRate) || sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  const hash = await sha256Hex(`${source.id}:${sessionOrRequestId}`);
  const bucket = Number.parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  return bucket <= sampleRate;
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get('origin');
  const normalizedRequestOrigin = requestOrigin ? normalizeOrigin(requestOrigin) : null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(requestOrigin) });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, requestOrigin);
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: 'Telemetry request exceeds 256 KiB.' }, 413, requestOrigin);
  }

  const sourceKey = boundedString(request.headers.get('x-imds-source-key'), 120)?.toLowerCase() ?? null;
  const writeKey = boundedString(request.headers.get('x-imds-write-key'), 256);
  const requestSdkVersion = boundedString(request.headers.get('x-imds-sdk-version'), 80);
  let requestId = validateUuid(request.headers.get('x-imds-request-id')) ?? crypto.randomUUID();
  let source: TelemetrySource | null = null;
  let rawEventCount = 0;
  const startedAt = performance.now();

  if (!sourceKey || !KEY_PATTERN.test(sourceKey) || !writeKey) {
    return jsonResponse({ error: 'Telemetry source credentials are required.' }, 401, requestOrigin);
  }

  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: sourceData, error: sourceError } = await admin
      .from('telemetry_sources')
      .select('id,product_id,source_key,source_type,environment,write_key_hash,allowed_origins,status,sample_rate')
      .eq('source_key', sourceKey)
      .maybeSingle();

    if (sourceError) throw new Error(sourceError.message);
    source = sourceData as TelemetrySource | null;
    if (!source || source.status !== 'active') {
      return jsonResponse({ error: 'Telemetry source is unavailable.' }, 401, requestOrigin);
    }

    const suppliedHash = await sha256Hex(writeKey);
    if (!constantTimeEqual(suppliedHash, source.write_key_hash)) {
      return jsonResponse({ error: 'Telemetry source credentials are invalid.' }, 401, requestOrigin);
    }

    const allowedOrigins = (source.allowed_origins ?? []).map(normalizeOrigin);
    if (source.source_type === 'browser') {
      if (!normalizedRequestOrigin || !allowedOrigins.includes(normalizedRequestOrigin)) {
        return jsonResponse({ error: 'Origin is not allowed for this telemetry source.' }, 403, requestOrigin);
      }
    } else if (normalizedRequestOrigin && allowedOrigins.length && !allowedOrigins.includes(normalizedRequestOrigin)) {
      return jsonResponse({ error: 'Origin is not allowed for this server telemetry source.' }, 403, requestOrigin);
    }

    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentRequestCount, error: rateError } = await admin
      .from('telemetry_ingestion_batches')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', source.id)
      .gte('created_at', minuteAgo);
    if (rateError) throw new Error(rateError.message);
    if ((recentRequestCount ?? 0) >= MAX_REQUESTS_PER_MINUTE) {
      return jsonResponse({ error: 'Telemetry rate limit exceeded.', retryAfterSeconds: 60 }, 429, requestOrigin);
    }

    const rawText = await request.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: 'Telemetry request exceeds 256 KiB.' }, 413, requestOrigin);
    }

    let body: Record<string, unknown>;
    try {
      body = asObject(JSON.parse(rawText));
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON.' }, 400, requestOrigin);
    }

    requestId = validateUuid(body.requestId) ?? requestId;
    const rawEvents = Array.isArray(body.events) ? body.events : [];
    rawEventCount = rawEvents.length;
    if (rawEvents.length < 1 || rawEvents.length > MAX_BATCH_EVENTS) {
      return jsonResponse({ error: 'A batch must contain between 1 and 100 events.' }, 400, requestOrigin);
    }

    const samplingKey = validateUuid(asObject(rawEvents[0]).sessionId) ?? requestId;
    if (!(await shouldSample(source, samplingKey))) {
      return jsonResponse({ requestId, accepted: 0, duplicates: 0, rejected: 0, sampledOut: true }, 202, requestOrigin);
    }

    const [{ data: definitionRows, error: definitionError }, { data: productRows, error: productError }] = await Promise.all([
      admin.from('telemetry_event_definitions').select('event_name,category,allowed_property_keys').eq('is_active', true),
      admin.from('products').select('id,key').is('archived_at', null),
    ]);
    if (definitionError) throw new Error(definitionError.message);
    if (productError) throw new Error(productError.message);

    const definitions = new Map((definitionRows ?? []).map((item: EventDefinition) => [item.event_name, item]));
    const products = new Map((productRows ?? []).map((item: ProductRecord) => [item.key, item.id]));
    const normalizedEvents: Record<string, unknown>[] = [];
    const issues: ValidationIssue[] = [];

    rawEvents.forEach((event, index) => {
      const normalized = normalizeEvent(event, index, definitions, products, requestSdkVersion);
      if (normalized.event) normalizedEvents.push(normalized.event);
      issues.push(...normalized.issues);
    });

    if (issues.length) {
      const processingMs = Math.max(0, Math.round(performance.now() - startedAt));
      await admin.rpc('record_failed_telemetry_batch', {
        target_source_id: source.id,
        request_id_value: requestId,
        origin_value: normalizedRequestOrigin,
        sdk_version_value: requestSdkVersion,
        event_count_value: rawEventCount,
        processing_ms_value: processingMs,
        errors_value: issues.slice(0, 50),
        request_metadata_value: { functionVersion: FUNCTION_VERSION, reason: 'validation_failed' },
      });
      return jsonResponse({ error: 'Telemetry validation failed.', requestId, issues: issues.slice(0, 50) }, 422, requestOrigin);
    }

    const processingMs = Math.max(0, Math.round(performance.now() - startedAt));
    const { data, error } = await admin.rpc('ingest_product_telemetry_batch', {
      target_source_id: source.id,
      request_id_value: requestId,
      events_value: normalizedEvents,
      origin_value: normalizedRequestOrigin,
      sdk_version_value: requestSdkVersion,
      processing_ms_value: processingMs,
      request_metadata_value: { functionVersion: FUNCTION_VERSION, sourceType: source.source_type },
    });
    if (error) throw new Error(error.message);

    return jsonResponse({ ...asObject(data), sampledOut: false }, 202, requestOrigin);
  } catch (error) {
    const processingMs = Math.max(0, Math.round(performance.now() - startedAt));
    const safeMessage = error instanceof Error ? error.message.slice(0, 500) : 'Unexpected telemetry ingestion failure';

    if (source) {
      await admin.rpc('record_failed_telemetry_batch', {
        target_source_id: source.id,
        request_id_value: requestId,
        origin_value: normalizedRequestOrigin,
        sdk_version_value: requestSdkVersion,
        event_count_value: rawEventCount,
        processing_ms_value: processingMs,
        errors_value: [{ message: safeMessage }],
        request_metadata_value: { functionVersion: FUNCTION_VERSION, reason: 'ingestion_failed' },
      }).catch(() => undefined);
    }

    return jsonResponse({ error: 'Telemetry ingestion failed.', requestId }, 500, requestOrigin);
  }
});
