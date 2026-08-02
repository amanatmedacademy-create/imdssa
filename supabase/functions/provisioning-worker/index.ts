import { createClient } from 'npm:@supabase/supabase-js@2';

type CommandType =
  | 'provision_tenant'
  | 'suspend_tenant'
  | 'resume_tenant'
  | 'revoke_tenant'
  | 'sync_entitlements'
  | 'invite_owner';

type ProductCommand = {
  id: string;
  workflow_run_id: string;
  license_id: string;
  organization_id: string;
  product_id: string;
  adapter_id: string | null;
  endpoint_id: string | null;
  command: CommandType;
  status: string;
  idempotency_key: string;
  correlation_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  created_at: string;
};

type ProductAdapter = {
  id: string;
  adapter_key: string;
  contract_version: string;
  protocol: 'rest' | 'graphql' | 'worker' | 'internal';
  status: string;
};

type ProductEndpoint = {
  id: string;
  base_url: string | null;
  healthcheck_url: string | null;
  auth_mode: 'none' | 'service_token' | 'oauth2' | 'signed_request';
  secret_reference: string | null;
  timeout_ms: number;
  status: string;
  config: Record<string, unknown>;
};

type Product = {
  id: string;
  key: string;
  name: string;
};

type AdapterResult = {
  commandId?: string;
  status?: 'accepted' | 'completed' | 'failed';
  externalTenantId?: string | null;
  external_tenant_id?: string | null;
  retryable?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type ProcessResult = {
  commandId: string;
  productId: string;
  command: CommandType;
  outcome: 'succeeded' | 'requeued' | 'dead_letter' | 'failed_to_finalize';
  httpStatus?: number;
  error?: string;
};

class WorkerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly response: Record<string, unknown> | null = null,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}

const commandNames: Record<CommandType, string> = {
  provision_tenant: 'provisionTenant',
  suspend_tenant: 'suspendTenant',
  resume_tenant: 'resumeTenant',
  revoke_tenant: 'revokeTenant',
  sync_entitlements: 'syncEntitlements',
  invite_owner: 'inviteOwner',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function requireEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function constantTimeEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const max = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < max; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function authorize(request: Request): void {
  const expected = requireEnvironment('IMDS_PROVISIONING_WORKER_TOKEN');
  const received = request.headers.get('x-imds-worker-token') ?? '';
  if (!constantTimeEquals(expected, received)) throw new WorkerError('Unauthorized worker invocation', false);
}

function parseInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function getSecretMap(): Record<string, string> {
  const raw = Deno.env.get('IMDS_SECRET_REFERENCE_MAP')?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
    );
  } catch {
    throw new WorkerError('IMDS_SECRET_REFERENCE_MAP contains invalid JSON', false);
  }
}

function resolveSecret(reference: string | null): string {
  if (!reference) throw new WorkerError('Endpoint secret reference is missing', false);

  if (reference.startsWith('env://')) {
    const environmentName = reference.slice('env://'.length).trim();
    if (!environmentName) throw new WorkerError('Environment secret reference is invalid', false);
    const value = Deno.env.get(environmentName);
    if (!value) throw new WorkerError(`Secret environment variable is not configured for reference ${reference}`, false);
    return value;
  }

  if (reference.startsWith('vault://')) {
    const value = getSecretMap()[reference];
    if (!value) throw new WorkerError(`Secret vault reference is not mapped: ${reference}`, false);
    return value;
  }

  throw new WorkerError('Unsupported secret reference scheme. Use env:// or vault://.', false);
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      const normalizedKey = key.toLowerCase();
      result[key] = normalizedKey.includes('token') || normalizedKey.includes('secret') || normalizedKey.includes('authorization')
        ? '[redacted]'
        : sanitizeJson(child, depth + 1);
    }
    return result;
  }
  return String(value);
}

async function hmacSignature(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseResponse(response: Response): Promise<AdapterResult> {
  const text = await response.text();
  if (!text) return {};

  try {
    return sanitizeJson(JSON.parse(text)) as AdapterResult;
  } catch {
    return { raw: text.length > 8000 ? `${text.slice(0, 8000)}…` : text };
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function buildHeaders(
  endpoint: ProductEndpoint,
  body: string,
  command: ProductCommand,
  adapter: ProductAdapter,
): Promise<Headers> {
  const headers = new Headers({
    'content-type': 'application/json',
    'accept': 'application/json',
    'x-imds-contract-version': adapter.contract_version,
    'x-imds-idempotency-key': command.idempotency_key,
    'x-imds-correlation-id': command.correlation_id,
    'user-agent': 'IMDS-Super-Admin-Provisioning-Worker/1.0',
  });

  if (endpoint.auth_mode === 'none') return headers;

  const secret = resolveSecret(endpoint.secret_reference);
  if (endpoint.auth_mode === 'service_token' || endpoint.auth_mode === 'oauth2') {
    headers.set('authorization', `Bearer ${secret}`);
    return headers;
  }

  const timestamp = new Date().toISOString();
  headers.set('x-imds-timestamp', timestamp);
  headers.set('x-imds-signature', await hmacSignature(secret, `${timestamp}.${body}`));
  return headers;
}

async function loadCommandConfiguration(
  supabase: ReturnType<typeof createClient>,
  command: ProductCommand,
): Promise<{ adapter: ProductAdapter; endpoint: ProductEndpoint; product: Product }> {
  if (!command.adapter_id || !command.endpoint_id) {
    throw new WorkerError('Command has no adapter or production endpoint', false);
  }

  const [adapterResult, endpointResult, productResult] = await Promise.all([
    supabase.from('product_adapters').select('id, adapter_key, contract_version, protocol, status').eq('id', command.adapter_id).single(),
    supabase.from('product_endpoints').select('id, base_url, healthcheck_url, auth_mode, secret_reference, timeout_ms, status, config').eq('id', command.endpoint_id).single(),
    supabase.from('products').select('id, key, name').eq('id', command.product_id).single(),
  ]);

  if (adapterResult.error) throw new WorkerError(`Adapter configuration unavailable: ${adapterResult.error.message}`, false);
  if (endpointResult.error) throw new WorkerError(`Endpoint configuration unavailable: ${endpointResult.error.message}`, false);
  if (productResult.error) throw new WorkerError(`Product configuration unavailable: ${productResult.error.message}`, false);

  const adapter = adapterResult.data as ProductAdapter;
  const endpoint = endpointResult.data as ProductEndpoint;
  const product = productResult.data as Product;

  if (!['active', 'degraded'].includes(adapter.status)) throw new WorkerError(`Adapter status is ${adapter.status}`, false);
  if (endpoint.status !== 'active') throw new WorkerError(`Production endpoint status is ${endpoint.status}`, true);
  if (!endpoint.base_url) throw new WorkerError('Production endpoint base URL is missing', false);
  if (adapter.protocol !== 'rest' && adapter.protocol !== 'worker') {
    throw new WorkerError(`Provisioning worker does not support adapter protocol ${adapter.protocol}`, false);
  }

  return { adapter, endpoint, product };
}

async function executeCommand(
  supabase: ReturnType<typeof createClient>,
  command: ProductCommand,
): Promise<{ response: AdapterResult; httpStatus: number }> {
  const { adapter, endpoint, product } = await loadCommandConfiguration(supabase, command);
  const commandPath = typeof endpoint.config?.command_path === 'string'
    ? endpoint.config.command_path
    : '/control-plane/v1/commands';
  const url = joinUrl(endpoint.base_url!, commandPath);
  const payload = command.payload ?? {};
  const requestBody = JSON.stringify({
    commandId: command.id,
    command: commandNames[command.command],
    contractVersion: adapter.contract_version,
    productKey: product.key,
    organizationId: command.organization_id,
    externalTenantId: typeof payload.external_tenant_id === 'string' ? payload.external_tenant_id : null,
    requestedAt: command.created_at,
    idempotencyKey: command.idempotency_key,
    correlationId: command.correlation_id,
    payload,
  });
  const headers = await buildHeaders(endpoint, requestBody, command, adapter);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), endpoint.timeout_ms);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: requestBody,
      signal: controller.signal,
      redirect: 'error',
    });
    const parsed = await parseResponse(response);

    if (!response.ok || parsed.status === 'failed') {
      const message = parsed.errorMessage
        ?? (typeof parsed.message === 'string' ? parsed.message : null)
        ?? `Product endpoint returned HTTP ${response.status}`;
      const retryable = typeof parsed.retryable === 'boolean' ? parsed.retryable : isRetryableStatus(response.status);
      throw new WorkerError(message, retryable, parsed, response.status);
    }

    return { response: parsed, httpStatus: response.status };
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new WorkerError(`Product endpoint timed out after ${endpoint.timeout_ms} ms`, true);
    }
    throw new WorkerError(error instanceof Error ? error.message : 'Unknown network error', true);
  } finally {
    clearTimeout(timeout);
  }
}

async function finalizeCommand(
  supabase: ReturnType<typeof createClient>,
  command: ProductCommand,
): Promise<ProcessResult> {
  try {
    const executed = await executeCommand(supabase, command);
    const externalTenantId = executed.response.externalTenantId ?? executed.response.external_tenant_id ?? null;
    const { data: finalStatus, error } = await supabase.rpc('complete_product_command', {
      target_command_id: command.id,
      succeeded: true,
      response_value: sanitizeJson(executed.response),
      error_value: null,
      external_tenant_id_value: typeof externalTenantId === 'string' ? externalTenantId : null,
      retryable_value: false,
    });
    if (error) throw error;

    return {
      commandId: command.id,
      productId: command.product_id,
      command: command.command,
      outcome: finalStatus === 'succeeded' ? 'succeeded' : 'failed_to_finalize',
      httpStatus: executed.httpStatus,
    };
  } catch (error) {
    const workerError = error instanceof WorkerError
      ? error
      : new WorkerError(error instanceof Error ? error.message : 'Unknown processing error', true);

    const { data: finalStatus, error: completionError } = await supabase.rpc('complete_product_command', {
      target_command_id: command.id,
      succeeded: false,
      response_value: sanitizeJson(workerError.response),
      error_value: workerError.message,
      external_tenant_id_value: null,
      retryable_value: workerError.retryable,
    });

    if (completionError) {
      return {
        commandId: command.id,
        productId: command.product_id,
        command: command.command,
        outcome: 'failed_to_finalize',
        httpStatus: workerError.httpStatus,
        error: `${workerError.message}; completion failed: ${completionError.message}`,
      };
    }

    return {
      commandId: command.id,
      productId: command.product_id,
      command: command.command,
      outcome: finalStatus === 'queued' ? 'requeued' : 'dead_letter',
      httpStatus: workerError.httpStatus,
      error: workerError.message,
    };
  }
}

Deno.serve(async (request) => {
  if (request.method === 'GET') {
    return jsonResponse({ service: 'imds-provisioning-worker', status: 'ready' });
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    authorize(request);
    const supabaseUrl = requireEnvironment('SUPABASE_URL');
    const serviceRoleKey = requireEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-imds-worker': 'provisioning-worker/1.0' } },
    });

    let input: Record<string, unknown> = {};
    try {
      input = await request.json() as Record<string, unknown>;
    } catch {
      input = {};
    }

    const batchSize = parseInteger(input.batchSize, 10, 1, 50);
    const staleAfterSeconds = parseInteger(input.staleAfterSeconds, 300, 60, 3600);
    const workerId = typeof input.workerId === 'string' && input.workerId.trim().length >= 3
      ? input.workerId.trim()
      : `edge-${crypto.randomUUID()}`;

    const { data: recovered, error: recoveryError } = await supabase.rpc('requeue_stale_product_commands', {
      stale_after_seconds: staleAfterSeconds,
    });
    if (recoveryError) throw new Error(`Lease recovery failed: ${recoveryError.message}`);

    const { data: commands, error: claimError } = await supabase.rpc('claim_product_commands', {
      worker_id_value: workerId,
      batch_size_value: batchSize,
    });
    if (claimError) throw new Error(`Command claim failed: ${claimError.message}`);

    const claimed = (commands ?? []) as ProductCommand[];
    const results: ProcessResult[] = [];
    for (const command of claimed) {
      results.push(await finalizeCommand(supabase, command));
    }

    return jsonResponse({
      workerId,
      recoveredStaleCommands: recovered ?? 0,
      claimed: claimed.length,
      results,
    });
  } catch (error) {
    const status = error instanceof WorkerError && !error.retryable && error.message.startsWith('Unauthorized') ? 401 : 500;
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unexpected provisioning worker failure',
    }, status);
  }
});
