import { createClient } from 'npm:@supabase/supabase-js@2';

type VerificationMode =
  | 'none'
  | 'hmac_sha256'
  | 'hmac_sha1'
  | 'bearer_token'
  | 'query_token'
  | 'meta_verify_token';

type EndpointRow = {
  id: string;
  public_key: string;
  status: string;
  verification_mode: VerificationMode;
  secret_reference: string | null;
  token_hash: string | null;
  signature_header: string;
  timestamp_header: string | null;
  allowed_ip_cidrs: string[];
  allowed_event_types: string[];
  event_id_path: string | null;
  event_type_path: string | null;
  challenge_field: string | null;
  max_payload_bytes: number;
  integration_id: string;
  archived_at: string | null;
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

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function endpointKey(request: Request): string {
  const url = new URL(request.url);
  const queryValue = url.searchParams.get('endpoint')?.trim();
  if (queryValue) return queryValue;
  const parts = url.pathname.split('/').filter(Boolean);
  const index = parts.lastIndexOf('integration-webhook');
  const pathValue = index >= 0 ? parts[index + 1] : parts.at(-1);
  if (!pathValue || pathValue === 'integration-webhook') throw new HttpError('Webhook endpoint key is required', 404);
  return decodeURIComponent(pathValue);
}

function sourceIp(request: Request): string | null {
  const candidate = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? null;
  if (!candidate) return null;
  return candidate.replace(/^\[|\]$/g, '').trim();
}

function sanitizedHeaders(request: Request): Record<string, string> {
  const blocked = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'proxy-authorization',
    'x-api-key',
  ]);
  const output: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    const normalized = key.toLowerCase();
    if (blocked.has(normalized)) continue;
    output[normalized] = value.length > 2048 ? `${value.slice(0, 2048)}…` : value;
  }
  return output;
}

function queryObject(url: URL): Record<string, string> {
  const blocked = new Set(['token', 'access_token', 'api_key', 'key', 'hub.verify_token']);
  const output: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (blocked.has(key.toLowerCase())) continue;
    output[key] = value.length > 2048 ? `${value.slice(0, 2048)}…` : value;
  }
  return output;
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

async function hexDigest(algorithm: 'SHA-1' | 'SHA-256', value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest(algorithm, bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(algorithm: 'SHA-1' | 'SHA-256', secret: string, value: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, value);
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizedSignature(value: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  const separator = trimmed.indexOf('=');
  return separator >= 0 ? trimmed.slice(separator + 1).trim().toLowerCase() : trimmed.toLowerCase();
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  return authorization.slice('bearer '.length).trim();
}

async function verifyRequest(
  request: Request,
  endpoint: EndpointRow,
  url: URL,
  rawBody: Uint8Array,
): Promise<{ valid: boolean; reason: string | null }> {
  if (endpoint.verification_mode === 'none') return { valid: true, reason: null };

  if (endpoint.verification_mode === 'bearer_token') {
    const token = bearerToken(request);
    if (!token || !endpoint.token_hash) return { valid: false, reason: 'bearer_token_missing' };
    return {
      valid: timingSafeEqual(await hexDigest('SHA-256', token), endpoint.token_hash),
      reason: 'bearer_token_invalid',
    };
  }

  if (endpoint.verification_mode === 'query_token') {
    const token = url.searchParams.get('token') ?? url.searchParams.get('access_token');
    if (!token || !endpoint.token_hash) return { valid: false, reason: 'query_token_missing' };
    return {
      valid: timingSafeEqual(await hexDigest('SHA-256', token), endpoint.token_hash),
      reason: 'query_token_invalid',
    };
  }

  const secret = resolveSecret(endpoint.secret_reference);
  if (!secret) return { valid: false, reason: 'verification_secret_unavailable' };

  const signatureHeader = endpoint.verification_mode === 'meta_verify_token'
    ? 'x-hub-signature-256'
    : endpoint.signature_header;
  const supplied = normalizedSignature(request.headers.get(signatureHeader));
  if (!supplied) return { valid: false, reason: 'signature_missing' };

  const algorithm = endpoint.verification_mode === 'hmac_sha1' ? 'SHA-1' : 'SHA-256';
  let signingBytes = rawBody;
  if (endpoint.timestamp_header) {
    const timestamp = request.headers.get(endpoint.timestamp_header)?.trim();
    if (!timestamp) return { valid: false, reason: 'timestamp_missing' };
    const parsedTimestamp = Number(timestamp);
    if (Number.isFinite(parsedTimestamp)) {
      const milliseconds = parsedTimestamp > 10_000_000_000 ? parsedTimestamp : parsedTimestamp * 1000;
      if (Math.abs(Date.now() - milliseconds) > 5 * 60 * 1000) {
        return { valid: false, reason: 'timestamp_outside_tolerance' };
      }
    }
    const prefix = new TextEncoder().encode(`${timestamp}.`);
    const combined = new Uint8Array(prefix.length + rawBody.length);
    combined.set(prefix, 0);
    combined.set(rawBody, prefix.length);
    signingBytes = combined;
  }

  const expected = await hmacHex(algorithm, secret, signingBytes);
  return {
    valid: timingSafeEqual(expected, supplied),
    reason: 'signature_invalid',
  };
}

function valueAtPath(value: unknown, path: string | null): unknown {
  if (!path) return null;
  const segments = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cursor: unknown = value;
  for (const segment of segments) {
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return null;
      cursor = cursor[index];
      continue;
    }
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

async function readBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError('Webhook payload exceeds endpoint limit', 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new HttpError('Webhook payload exceeds endpoint limit', 413);
  return bytes;
}

function parsePayload(rawBody: Uint8Array, contentType: string): unknown {
  const text = new TextDecoder().decode(rawBody);
  if (!text) return {};
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HttpError('Webhook body is not valid JSON', 400);
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return { raw: text };
}

async function loadEndpoint(serviceClient: ReturnType<typeof createClient>, key: string): Promise<EndpointRow> {
  const { data, error } = await serviceClient
    .from('inbound_webhook_endpoints')
    .select('id, public_key, status, verification_mode, secret_reference, token_hash, signature_header, timestamp_header, allowed_ip_cidrs, allowed_event_types, event_id_path, event_type_path, challenge_field, max_payload_bytes, integration_id, archived_at')
    .eq('public_key', key)
    .maybeSingle();
  if (error) throw new HttpError(`Unable to load webhook endpoint: ${error.message}`, 500);
  if (!data || data.status !== 'active' || data.archived_at) throw new HttpError('Webhook endpoint not found', 404);
  return data as EndpointRow;
}

async function handleChallenge(request: Request, endpoint: EndpointRow): Promise<Response> {
  const url = new URL(request.url);
  if (endpoint.verification_mode !== 'meta_verify_token') {
    throw new HttpError('Challenge is not enabled for this endpoint', 405);
  }
  const token = url.searchParams.get('hub.verify_token') ?? url.searchParams.get('verify_token');
  const challenge = url.searchParams.get('hub.challenge')
    ?? (endpoint.challenge_field ? url.searchParams.get(endpoint.challenge_field) : null);
  if (!token || !endpoint.token_hash || !challenge) throw new HttpError('Challenge parameters are incomplete', 400);
  const valid = timingSafeEqual(await hexDigest('SHA-256', token), endpoint.token_hash);
  if (!valid) throw new HttpError('Challenge token is invalid', 403);
  return new Response(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  try {
    const supabaseUrl = requiredEnvironment('SUPABASE_URL');
    const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-imds-service': 'integration-webhook/1.0' } },
    });
    const key = endpointKey(request);
    const endpoint = await loadEndpoint(serviceClient, key);

    if (request.method === 'GET') return await handleChallenge(request, endpoint);
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed', requestId }, 405, { allow: 'GET, POST' });

    const url = new URL(request.url);
    const rawBody = await readBody(request, endpoint.max_payload_bytes);
    const payload = parsePayload(rawBody, request.headers.get('content-type')?.toLowerCase() ?? '');
    const verification = await verifyRequest(request, endpoint, url, rawBody);
    const providerEventId = stringValue(valueAtPath(payload, endpoint.event_id_path));
    const eventType = stringValue(valueAtPath(payload, endpoint.event_type_path));
    const payloadHash = await hexDigest('SHA-256', new TextDecoder().decode(rawBody));

    const { data, error } = await serviceClient.rpc('register_inbound_webhook_event', {
      endpoint_public_key_value: key,
      provider_event_id_value: providerEventId,
      event_type_value: eventType,
      headers_value: sanitizedHeaders(request),
      query_params_value: queryObject(url),
      payload_value: payload,
      payload_hash_value: payloadHash,
      signature_valid_value: verification.valid,
      source_ip_value: sourceIp(request),
      rejection_reason_value: verification.valid ? null : verification.reason,
    });
    if (error) throw new HttpError(`Webhook persistence failed: ${error.message}`, 500);

    const result = data as Record<string, unknown> | null;
    if (!verification.valid) {
      return jsonResponse({ accepted: false, reason: verification.reason, requestId, eventId: result?.eventId ?? null }, 401);
    }
    return jsonResponse({ ...(result ?? {}), requestId }, result?.duplicate ? 200 : 202);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unexpected webhook gateway failure',
      requestId,
    }, status);
  }
});
