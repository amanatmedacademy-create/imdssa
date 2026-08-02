type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_JWT_AUDIENCE: string;
  ALLOWED_ORIGINS?: string;
};

type ApiMeta = { requestId: string; traceId: string; serverTime: string };

class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400, readonly details?: unknown) {
    super(message);
  }
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function meta(requestId: string, traceId: string): ApiMeta {
  return { requestId, traceId, serverTime: new Date().toISOString() };
}

function json(body: unknown, status: number, origin: string | null, env: Env): Response {
  const allowed = (env.ALLOWED_ORIGINS ?? 'https://admin.imds24.com,https://staging-admin.imds24.com')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  if (origin && allowed.includes(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function rpc<T>(env: Env, name: string, body: Record<string, unknown>, token?: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${token || env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) throw new ApiError('DATABASE_OPERATION_FAILED', 'Platform database operation failed', 502, payload);
  return payload as T;
}

function bearer(request: Request): string {
  const value = request.headers.get('authorization') ?? '';
  if (!value.startsWith('Bearer ') || value.length < 20) throw new ApiError('AUTHENTICATION_REQUIRED', 'Bearer token is required', 401);
  return value.slice(7);
}

function tenantHeader(request: Request): string {
  const value = request.headers.get('x-tenant-id')?.trim();
  if (!value) throw new ApiError('TENANT_REQUIRED', 'X-Tenant-Id is required', 400);
  return value;
}

function adminMutationHeaders(request: Request): { reason: string; idempotencyKey: string } {
  const reason = request.headers.get('x-admin-reason')?.trim() ?? '';
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
  if (reason.length < 10) throw new ApiError('REASON_REQUIRED', 'X-Admin-Reason must contain at least 10 characters', 422);
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED', 'A UUID Idempotency-Key is required', 422);
  return { reason, idempotencyKey };
}

async function handle(request: Request, env: Env, requestId: string, traceId: string): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    const response = json({}, 204, origin, env);
    response.headers.set('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
    response.headers.set('access-control-allow-headers', 'Authorization,Content-Type,Idempotency-Key,X-Admin-Reason,X-Tenant-Id');
    return response;
  }

  if (url.pathname === '/healthz') {
    return json({ data: { status: 'healthy', service: 'platform-api' }, meta: meta(requestId, traceId) }, 200, origin, env);
  }

  if (url.pathname === '/v1/platform/bootstrap' && request.method === 'GET') {
    const token = bearer(request);
    const tenantId = tenantHeader(request);
    const product = url.searchParams.get('product')?.trim();
    if (!product) throw new ApiError('PRODUCT_REQUIRED', 'Product query parameter is required', 400);
    const data = await rpc<unknown>(env, 'platform_bootstrap', {
      organization_id_value: tenantId,
      product_code_value: product,
    }, token);
    if (!data) throw new ApiError('TENANT_OR_PRODUCT_NOT_FOUND', 'Tenant or product is unavailable', 404);
    return json({ data, meta: meta(requestId, traceId) }, 200, origin, env);
  }

  if (url.pathname === '/v1/platform/authorize' && request.method === 'POST') {
    const token = bearer(request);
    const body = await request.json() as Record<string, unknown>;
    const data = await rpc<unknown>(env, 'platform_authorize', {
      organization_id_value: body.tenantId,
      host_product_code_value: body.hostProductCode,
      module_code_value: body.moduleCode,
      permission_value: body.permission,
    }, token);
    return json({ data, meta: meta(requestId, traceId) }, 200, origin, env);
  }

  if (url.pathname === '/v1/admin/installations/preview' && request.method === 'POST') {
    const token = bearer(request);
    const body = await request.json() as Record<string, unknown>;
    const data = await rpc<unknown>(env, 'preview_module_installation', {
      organization_id_value: body.tenantId,
      module_code_value: body.moduleCode,
      host_product_code_value: body.hostProductCode,
      price_code_value: body.priceCode,
      version_channel_value: body.versionChannel,
      placement_value: body.placement,
    }, token);
    return json({ data, meta: meta(requestId, traceId) }, 200, origin, env);
  }

  if (url.pathname === '/v1/admin/installations' && request.method === 'POST') {
    const token = bearer(request);
    const { reason, idempotencyKey } = adminMutationHeaders(request);
    const body = await request.json() as Record<string, unknown>;
    const data = await rpc<unknown>(env, 'create_module_installation', {
      organization_id_value: body.tenantId,
      module_code_value: body.moduleCode,
      host_product_code_value: body.hostProductCode,
      price_code_value: body.priceCode,
      version_channel_value: body.versionChannel,
      starts_at_value: body.startsAt,
      ends_at_value: body.endsAt,
      placement_value: body.placement,
      config_value: body.config,
      limits_value: body.limits,
      permissions_value: body.permissions,
      reason_value: reason,
      idempotency_key_value: idempotencyKey,
    }, token);
    return json({ data, meta: meta(requestId, traceId) }, 202, origin, env);
  }

  throw new ApiError('ROUTE_NOT_FOUND', 'Route not found', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = request.headers.get('x-request-id')?.trim() || id('req');
    const traceId = request.headers.get('traceparent')?.trim() || id('trc');
    try {
      const response = await handle(request, env, requestId, traceId);
      response.headers.set('x-request-id', requestId);
      response.headers.set('x-trace-id', traceId);
      return response;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 'Unexpected platform error', 500);
      return json({
        error: { code: apiError.code, message: apiError.message, details: apiError.details },
        meta: meta(requestId, traceId),
      }, apiError.status, request.headers.get('origin'), env);
    }
  },
};
