import { createClient } from 'npm:@supabase/supabase-js@2';

type IntegrationJob = {
  job_id: string;
  integration_id: string;
  organization_id: string;
  product_id: string | null;
  provider_key: string;
  provider_name: string;
  environment: 'sandbox' | 'staging' | 'production';
  auth_type: 'oauth2' | 'api_key' | 'service_token' | 'hmac' | 'basic' | 'none';
  secret_reference: string | null;
  connection_config: Record<string, unknown>;
  external_account_id: string | null;
  job_type: string;
  payload: unknown;
  attempt_count: number;
  max_attempts: number;
  correlation_id: string;
};

type WebhookDelivery = {
  delivery_id: string;
  subscription_id: string;
  target_url: string;
  secret_reference: string | null;
  custom_headers: Record<string, unknown>;
  timeout_ms: number;
  allowed_response_codes: number[];
  event_id: string;
  event_type: string;
  organization_id: string | null;
  product_id: string | null;
  payload: unknown;
  idempotency_key: string;
  correlation_id: string;
  attempt_count: number;
  max_attempts: number;
};

type WorkerRequest = {
  workerId?: string;
  integrationBatchSize?: number;
  deliveryBatchSize?: number;
  staleAfterSeconds?: number;
};

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function secretReferenceMap(): Record<string, string> {
  const raw = Deno.env.get('IMDS_SECRET_REFERENCE_MAP')?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function resolveSecret(reference: string | null): string | null {
  if (!reference) return null;
  if (reference.startsWith('env://')) return Deno.env.get(reference.slice('env://'.length)) ?? null;
  return secretReferenceMap()[reference] ?? null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function clamp(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function sanitizedObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[max-depth]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 8000 ? `${value.slice(0, 8000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizedObject(item, depth + 1));
  if (typeof value !== 'object') return String(value);

  const blocked = new Set([
    'authorization',
    'access_token',
    'refresh_token',
    'api_key',
    'apikey',
    'secret',
    'password',
    'client_secret',
    'token',
  ]);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    output[key] = blocked.has(key.toLowerCase()) ? '[redacted]' : sanitizedObject(item, depth + 1);
  }
  return output;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseResponse(response: Response): Promise<{ body: unknown; text: string }> {
  const text = await response.text();
  if (!text) return { body: {}, text: '' };
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return { body: JSON.parse(text) as unknown, text };
    } catch {
      return { body: { raw: text }, text };
    }
  }
  return { body: { raw: text }, text };
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function configString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function configObject(config: Record<string, unknown>, key: string): Record<string, string> {
  const value = config[key];
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function joinUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\/+/, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function jobHeaders(job: IntegrationJob, body: string): Promise<Headers> {
  const headers = new Headers({
    'content-type': 'application/json',
    'accept': 'application/json',
    'x-imds-command-id': job.job_id,
    'x-imds-correlation-id': job.correlation_id,
    'idempotency-key': `integration-job:${job.job_id}`,
    ...configObject(job.connection_config, 'headers'),
  });
  const secret = resolveSecret(job.secret_reference);
  if (job.auth_type === 'none') return headers;
  if (!secret) throw new Error('Integration credential reference could not be resolved');

  if (job.auth_type === 'oauth2' || job.auth_type === 'service_token') {
    headers.set('authorization', `Bearer ${secret}`);
  } else if (job.auth_type === 'api_key') {
    headers.set(configString(job.connection_config, 'api_key_header') ?? 'x-api-key', secret);
  } else if (job.auth_type === 'basic') {
    headers.set('authorization', `Basic ${btoa(secret)}`);
  } else if (job.auth_type === 'hmac') {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers.set('x-imds-timestamp', timestamp);
    headers.set('x-imds-signature', `sha256=${await hmacHex(secret, `${timestamp}.${body}`)}`);
  }
  return headers;
}

async function processIntegrationJob(job: IntegrationJob) {
  const baseUrl = configString(job.connection_config, 'base_url')
    ?? configString(job.connection_config, 'adapter_url');
  if (!baseUrl) throw new Error('Integration connection config must define base_url or adapter_url');
  const parsedBase = new URL(baseUrl);
  if (job.environment === 'production' && parsedBase.protocol !== 'https:') {
    throw new Error('Production integration endpoints must use HTTPS');
  }
  const path = configString(job.connection_config, 'job_path') ?? '/control-plane/v1/integration-jobs';
  const url = joinUrl(baseUrl, path);
  const requestBody = {
    jobId: job.job_id,
    jobType: job.job_type,
    providerKey: job.provider_key,
    organizationId: job.organization_id,
    productId: job.product_id,
    externalAccountId: job.external_account_id,
    environment: job.environment,
    attempt: job.attempt_count,
    correlationId: job.correlation_id,
    payload: job.payload,
  };
  const body = JSON.stringify(requestBody);
  const headers = await jobHeaders(job, body);
  const timeoutMs = clamp(job.connection_config.timeout_ms, 30000, 1000, 120000);
  const response = await fetchWithTimeout(url, { method: 'POST', headers, body }, timeoutMs);
  const parsed = await parseResponse(response);
  const result = parsed.body && typeof parsed.body === 'object' && !Array.isArray(parsed.body)
    ? parsed.body as Record<string, unknown>
    : {};
  const explicitRetryable = typeof result.retryable === 'boolean' ? result.retryable : null;
  const succeeded = response.ok && result.status !== 'failed' && result.success !== false;
  return {
    succeeded,
    retryable: explicitRetryable ?? retryableStatus(response.status),
    response: sanitizedObject({ status: response.status, body: parsed.body }),
    error: succeeded ? null : String(result.error ?? result.message ?? `Integration endpoint returned HTTP ${response.status}`),
    externalAccountId: typeof result.externalAccountId === 'string' ? result.externalAccountId : null,
    externalAccountName: typeof result.externalAccountName === 'string' ? result.externalAccountName : null,
    tokenExpiresAt: typeof result.tokenExpiresAt === 'string' ? result.tokenExpiresAt : null,
    syncCursor: result.syncCursor && typeof result.syncCursor === 'object' ? result.syncCursor : null,
  };
}

async function processDelivery(delivery: WebhookDelivery) {
  const event = {
    id: delivery.event_id,
    type: delivery.event_type,
    organizationId: delivery.organization_id,
    productId: delivery.product_id,
    occurredAt: new Date().toISOString(),
    correlationId: delivery.correlation_id,
    data: delivery.payload,
  };
  const body = JSON.stringify(event);
  const headers = new Headers({
    'content-type': 'application/json',
    'accept': 'application/json',
    'user-agent': 'IMDS-Webhook/1.0',
    'x-imds-event-id': delivery.event_id,
    'x-imds-event-type': delivery.event_type,
    'x-imds-delivery-id': delivery.delivery_id,
    'x-imds-correlation-id': delivery.correlation_id,
    'idempotency-key': delivery.idempotency_key,
  });
  for (const [key, value] of Object.entries(delivery.custom_headers ?? {})) {
    if (typeof value !== 'string') continue;
    if (['authorization', 'cookie', 'set-cookie'].includes(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  const secret = resolveSecret(delivery.secret_reference);
  if (delivery.secret_reference && !secret) throw new Error('Outbound webhook secret reference could not be resolved');
  if (secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers.set('x-imds-timestamp', timestamp);
    headers.set('x-imds-signature', `v1=${await hmacHex(secret, `${timestamp}.${body}`)}`);
  }
  const response = await fetchWithTimeout(
    delivery.target_url,
    { method: 'POST', headers, body, redirect: 'error' },
    clamp(delivery.timeout_ms, 10000, 1000, 60000),
  );
  const parsed = await parseResponse(response);
  const accepted = delivery.allowed_response_codes.includes(response.status);
  return {
    succeeded: accepted,
    retryable: !accepted && retryableStatus(response.status),
    status: response.status,
    headers: Object.fromEntries(
      [...response.headers.entries()]
        .filter(([key]) => !['set-cookie', 'authorization'].includes(key.toLowerCase()))
        .slice(0, 100),
    ),
    body: parsed.text,
    error: accepted ? null : `Webhook target returned HTTP ${response.status}`,
  };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  try {
    const expectedToken = requiredEnvironment('IMDS_INTEGRATION_WORKER_TOKEN');
    const suppliedToken = request.headers.get('x-imds-worker-token')?.trim();
    if (!suppliedToken || suppliedToken !== expectedToken) throw new HttpError('Worker token is invalid', 401);

    const supabaseUrl = requiredEnvironment('SUPABASE_URL');
    const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-imds-service': 'integration-worker/1.0' } },
    });

    let input: WorkerRequest = {};
    try {
      input = await request.json() as WorkerRequest;
    } catch {
      input = {};
    }
    const workerId = input.workerId?.trim() || `integration-worker-${crypto.randomUUID()}`;
    const integrationBatchSize = clamp(input.integrationBatchSize, 10, 1, 100);
    const deliveryBatchSize = clamp(input.deliveryBatchSize, 20, 1, 100);
    const staleAfterSeconds = clamp(input.staleAfterSeconds, 300, 30, 3600);

    await Promise.all([
      serviceClient.rpc('requeue_stale_integration_jobs', { stale_after_seconds_value: staleAfterSeconds }),
      serviceClient.rpc('requeue_stale_outbound_webhook_deliveries', { stale_after_seconds_value: staleAfterSeconds }),
    ]);

    const [jobsResult, deliveriesResult] = await Promise.all([
      serviceClient.rpc('claim_integration_jobs', {
        worker_id_value: workerId,
        batch_size_value: integrationBatchSize,
      }),
      serviceClient.rpc('claim_outbound_webhook_deliveries', {
        worker_id_value: workerId,
        batch_size_value: deliveryBatchSize,
      }),
    ]);
    if (jobsResult.error) throw new Error(`Unable to claim integration jobs: ${jobsResult.error.message}`);
    if (deliveriesResult.error) throw new Error(`Unable to claim webhook deliveries: ${deliveriesResult.error.message}`);

    const jobs = (jobsResult.data ?? []) as IntegrationJob[];
    const deliveries = (deliveriesResult.data ?? []) as WebhookDelivery[];
    const jobResults: Array<Record<string, unknown>> = [];
    const deliveryResults: Array<Record<string, unknown>> = [];

    for (const job of jobs) {
      try {
        const result = await processIntegrationJob(job);
        const { data: nextStatus, error } = await serviceClient.rpc('complete_integration_job', {
          job_id_value: job.job_id,
          worker_id_value: workerId,
          succeeded_value: result.succeeded,
          retryable_value: result.retryable,
          response_value: result.response,
          error_value: result.error,
          external_account_id_value: result.externalAccountId,
          external_account_name_value: result.externalAccountName,
          token_expires_at_value: result.tokenExpiresAt,
          sync_cursor_value: result.syncCursor,
        });
        if (error) throw error;
        jobResults.push({ jobId: job.job_id, status: nextStatus });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected integration job failure';
        const retryable = error instanceof DOMException && error.name === 'AbortError';
        const { data: nextStatus, error: completionError } = await serviceClient.rpc('complete_integration_job', {
          job_id_value: job.job_id,
          worker_id_value: workerId,
          succeeded_value: false,
          retryable_value: retryable,
          response_value: {},
          error_value: message,
          external_account_id_value: null,
          external_account_name_value: null,
          token_expires_at_value: null,
          sync_cursor_value: null,
        });
        jobResults.push({
          jobId: job.job_id,
          status: nextStatus ?? 'completion_failed',
          error: completionError?.message ?? message,
        });
      }
    }

    for (const delivery of deliveries) {
      try {
        const result = await processDelivery(delivery);
        const { data: nextStatus, error } = await serviceClient.rpc('complete_outbound_webhook_delivery', {
          delivery_id_value: delivery.delivery_id,
          worker_id_value: workerId,
          succeeded_value: result.succeeded,
          retryable_value: result.retryable,
          response_status_value: result.status,
          response_headers_value: result.headers,
          response_body_value: result.body,
          error_value: result.error,
        });
        if (error) throw error;
        deliveryResults.push({ deliveryId: delivery.delivery_id, status: nextStatus });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected webhook delivery failure';
        const retryable = error instanceof DOMException && error.name === 'AbortError';
        const { data: nextStatus, error: completionError } = await serviceClient.rpc('complete_outbound_webhook_delivery', {
          delivery_id_value: delivery.delivery_id,
          worker_id_value: workerId,
          succeeded_value: false,
          retryable_value: retryable,
          response_status_value: null,
          response_headers_value: {},
          response_body_value: '',
          error_value: message,
        });
        deliveryResults.push({
          deliveryId: delivery.delivery_id,
          status: nextStatus ?? 'completion_failed',
          error: completionError?.message ?? message,
        });
      }
    }

    return jsonResponse({
      workerId,
      claimed: { integrationJobs: jobs.length, webhookDeliveries: deliveries.length },
      integrationJobs: jobResults,
      webhookDeliveries: deliveryResults,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected integration worker failure' }, status);
  }
});
