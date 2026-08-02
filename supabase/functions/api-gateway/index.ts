import { createClient } from 'npm:@supabase/supabase-js@2';

type GatewayRoute = {
  method: 'GET' | 'POST';
  path: string;
  scope: string;
};

type ClientAuthorization = {
  authorized: boolean;
  reason?: string;
  clientId?: string;
  organizationId?: string | null;
  scopes?: string[];
  rateLimit?: number;
  currentCount?: number;
};

class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'HttpError';
  }
}

const routes: GatewayRoute[] = [
  { method: 'GET', path: '/v1/health', scope: 'health.read' },
  { method: 'GET', path: '/v1/products', scope: 'products.read' },
  { method: 'GET', path: '/v1/organizations', scope: 'organizations.read' },
  { method: 'GET', path: '/v1/integrations', scope: 'integrations.read' },
  { method: 'GET', path: '/v1/subscriptions', scope: 'subscriptions.read' },
  { method: 'GET', path: '/v1/webhooks/deliveries', scope: 'webhooks.read' },
  { method: 'POST', path: '/v1/events', scope: 'events.publish' },
];

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function allowedOrigins(): string[] {
  return (Deno.env.get('IMDS_API_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') ?? '';
  const allowed = allowedOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] ?? '';
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-headers': 'authorization, content-type, x-api-key, x-request-id, idempotency-key',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function jsonResponse(request: Request, body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      ...extraHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function gatewayPath(request: Request): string {
  const url = new URL(request.url);
  const explicit = url.searchParams.get('route')?.trim();
  if (explicit) return explicit.startsWith('/') ? explicit : `/${explicit}`;
  const marker = '/api-gateway';
  const index = url.pathname.indexOf(marker);
  const suffix = index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname;
  return suffix && suffix !== '/' ? suffix.replace(/\/+$/, '') : '/';
}

function sourceIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? null;
}

function apiKey(request: Request): string | null {
  const header = request.headers.get('x-api-key')?.trim();
  if (header) return header;
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice('bearer '.length).trim();
  return null;
}

function findRoute(method: string, path: string): GatewayRoute {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) throw new HttpError('Gateway route not found', 404, 'route_not_found');
  return route;
}

function pageSize(url: URL): number {
  const value = Number(url.searchParams.get('limit') ?? '100');
  return Number.isFinite(value) ? Math.max(1, Math.min(500, Math.trunc(value))) : 100;
}

function offsetValue(url: URL): number {
  const value = Number(url.searchParams.get('offset') ?? '0');
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function gatewayErrorStatus(reason: string | undefined): number {
  if (reason === 'scope_denied' || reason === 'source_ip_denied') return 403;
  if (reason === 'rate_limit_exceeded') return 429;
  return 401;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected API gateway failure';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });

  const startedAt = performance.now();
  const requestId = request.headers.get('x-request-id')?.trim() || crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  let clientId: string | null = null;
  let route: GatewayRoute | null = null;
  let responseStatus = 500;
  const path = gatewayPath(request);
  const ip = sourceIp(request);

  try {
    route = findRoute(request.method, path);
    const key = apiKey(request);
    if (!key) throw new HttpError('API key is required', 401, 'api_key_required');

    const supabaseUrl = requiredEnvironment('SUPABASE_URL');
    const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-imds-service': 'api-gateway/1.0' } },
    });

    const { data: authorizationData, error: authorizationError } = await serviceClient.rpc('authenticate_api_client', {
      api_key_value: key,
      source_ip_value: ip,
      required_scope_value: route.scope,
      request_id_value: requestId,
      method_value: request.method,
      path_value: path,
    });
    if (authorizationError) throw new HttpError(`API client validation failed: ${authorizationError.message}`, 500);
    const authorization = authorizationData as ClientAuthorization;
    if (!authorization.authorized) {
      throw new HttpError('API client authorization denied', gatewayErrorStatus(authorization.reason), authorization.reason);
    }
    clientId = authorization.clientId ?? null;
    const organizationId = authorization.organizationId ?? null;
    const url = new URL(request.url);
    let body: unknown;

    if (route.path === '/v1/health') {
      const [productResult, connectionResult, jobResult, deliveryResult] = await Promise.all([
        serviceClient.from('products').select('status', { count: 'exact', head: false }).is('archived_at', null),
        serviceClient.from('integrations').select('status, health_status', { count: 'exact', head: false }).is('archived_at', null),
        serviceClient.from('integration_jobs').select('status', { count: 'exact', head: false }).in('status', ['queued', 'processing', 'failed', 'dead_letter']),
        serviceClient.from('outbound_webhook_deliveries').select('status', { count: 'exact', head: false }).in('status', ['queued', 'processing', 'failed', 'dead_letter']),
      ]);
      const firstError = productResult.error ?? connectionResult.error ?? jobResult.error ?? deliveryResult.error;
      if (firstError) throw firstError;
      body = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        products: {
          total: productResult.data?.length ?? 0,
          degraded: productResult.data?.filter((item) => ['degraded', 'maintenance'].includes(item.status)).length ?? 0,
        },
        integrations: {
          total: connectionResult.data?.length ?? 0,
          unhealthy: connectionResult.data?.filter((item) => ['degraded', 'unhealthy'].includes(item.health_status)).length ?? 0,
        },
        queues: {
          integrationJobs: jobResult.data?.length ?? 0,
          webhookDeliveries: deliveryResult.data?.length ?? 0,
        },
      };
    } else if (route.path === '/v1/products') {
      const from = offsetValue(url);
      const to = from + pageSize(url) - 1;
      const { data, error } = await serviceClient
        .from('products')
        .select('id, key, name, description, status, current_version, metadata, updated_at')
        .is('archived_at', null)
        .order('name')
        .range(from, to);
      if (error) throw error;
      body = { data: data ?? [], paging: { offset: from, limit: pageSize(url) } };
    } else if (route.path === '/v1/organizations') {
      const from = offsetValue(url);
      const to = from + pageSize(url) - 1;
      let query = serviceClient
        .from('organizations')
        .select('id, name, slug, status, country_code, city, customer_health, created_at, updated_at')
        .is('archived_at', null)
        .order('name')
        .range(from, to);
      if (organizationId) query = query.eq('id', organizationId);
      const { data, error } = await query;
      if (error) throw error;
      body = { data: data ?? [], paging: { offset: from, limit: pageSize(url) } };
    } else if (route.path === '/v1/integrations') {
      const from = offsetValue(url);
      const to = from + pageSize(url) - 1;
      let query = serviceClient
        .from('integrations')
        .select('id, organization_id, product_id, provider_key, display_name, environment, auth_type, external_account_id, external_account_name, status, health_status, token_expires_at, last_sync_at, next_sync_at, last_error, connected_at, updated_at')
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .range(from, to);
      if (organizationId) query = query.eq('organization_id', organizationId);
      const { data, error } = await query;
      if (error) throw error;
      body = { data: data ?? [], paging: { offset: from, limit: pageSize(url) } };
    } else if (route.path === '/v1/subscriptions') {
      const from = offsetValue(url);
      const to = from + pageSize(url) - 1;
      let query = serviceClient
        .from('subscriptions')
        .select('id, organization_id, tariff_id, status, billing_interval, renewal_mode, starts_at, trial_ends_at, current_period_ends_at, grace_ends_at, cancelled_at, custom_price, effective_price, currency, activated_at, created_at, updated_at')
        .order('created_at', { ascending: false })
        .range(from, to);
      if (organizationId) query = query.eq('organization_id', organizationId);
      const { data, error } = await query;
      if (error) throw error;
      body = { data: data ?? [], paging: { offset: from, limit: pageSize(url) } };
    } else if (route.path === '/v1/webhooks/deliveries') {
      const from = offsetValue(url);
      const to = from + pageSize(url) - 1;
      let query = serviceClient
        .from('outbound_webhook_deliveries')
        .select('id, status, attempt_count, max_attempts, response_status, last_error, created_at, updated_at, outbound_webhook_subscriptions!inner(id, name, organization_id, product_id, target_url), platform_events!inner(id, event_type, organization_id, product_id, created_at)')
        .order('created_at', { ascending: false })
        .range(from, to);
      if (organizationId) query = query.eq('outbound_webhook_subscriptions.organization_id', organizationId);
      const { data, error } = await query;
      if (error) throw error;
      body = { data: data ?? [], paging: { offset: from, limit: pageSize(url) } };
    } else if (route.path === '/v1/events') {
      let input: Record<string, unknown>;
      try {
        input = await request.json() as Record<string, unknown>;
      } catch {
        throw new HttpError('Request body must be valid JSON', 400, 'invalid_json');
      }
      const requestedOrganizationId = typeof input.organizationId === 'string' ? input.organizationId : organizationId;
      if (organizationId && requestedOrganizationId !== organizationId) {
        throw new HttpError('API client cannot publish events for another organization', 403, 'organization_scope_denied');
      }
      const eventType = typeof input.eventType === 'string' ? input.eventType.trim() : '';
      const idempotencyKey = request.headers.get('idempotency-key')?.trim()
        || (typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '');
      if (!eventType || !/^[a-z0-9]+([._-][a-z0-9]+)+$/.test(eventType)) {
        throw new HttpError('eventType is invalid', 400, 'event_type_invalid');
      }
      if (idempotencyKey.length < 8) throw new HttpError('Idempotency-Key is required', 400, 'idempotency_key_required');
      const { data, error } = await serviceClient.rpc('publish_platform_event', {
        organization_id_value: requestedOrganizationId,
        product_id_value: typeof input.productId === 'string' ? input.productId : null,
        event_type_value: eventType,
        subject_type_value: typeof input.subjectType === 'string' ? input.subjectType : null,
        subject_id_value: typeof input.subjectId === 'string' ? input.subjectId : null,
        payload_value: input.data && typeof input.data === 'object' ? input.data : {},
        idempotency_key_value: idempotencyKey,
        correlation_id_value: correlationId,
      });
      if (error) throw error;
      body = { eventId: data, accepted: true, correlationId };
    } else {
      throw new HttpError('Gateway route not implemented', 501, 'route_not_implemented');
    }

    responseStatus = route.method === 'POST' ? 202 : 200;
    if (clientId) {
      await serviceClient.rpc('log_api_request', {
        api_client_id_value: clientId,
        request_id_value: requestId,
        method_value: request.method,
        path_value: path,
        required_scope_value: route.scope,
        source_ip_value: ip,
        status_code_value: responseStatus,
        duration_ms_value: Math.round(performance.now() - startedAt),
        correlation_id_value: correlationId,
      });
    }
    return jsonResponse(request, { requestId, correlationId, ...(body && typeof body === 'object' && !Array.isArray(body) ? body : { data: body }) }, responseStatus);
  } catch (error) {
    responseStatus = error instanceof HttpError ? error.status : 500;
    try {
      if (clientId) {
        const supabaseUrl = requiredEnvironment('SUPABASE_URL');
        const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
        const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await serviceClient.rpc('log_api_request', {
          api_client_id_value: clientId,
          request_id_value: requestId,
          method_value: request.method,
          path_value: path,
          required_scope_value: route?.scope ?? null,
          source_ip_value: ip,
          status_code_value: responseStatus,
          duration_ms_value: Math.round(performance.now() - startedAt),
          correlation_id_value: correlationId,
        });
      }
    } catch {
      // Logging failure must not replace the original gateway response.
    }
    return jsonResponse(request, {
      error: safeError(error),
      code: error instanceof HttpError ? error.code ?? 'gateway_error' : 'internal_error',
      requestId,
      correlationId,
    }, responseStatus);
  }
});
