import { createClient } from 'npm:@supabase/supabase-js@2';

type GlobalRole =
  | 'platform_owner'
  | 'super_admin'
  | 'support_admin'
  | 'finance_admin'
  | 'technical_admin'
  | 'sales_manager'
  | 'auditor';

type InviteRequest = {
  action: 'invite';
  email: string;
  fullName?: string | null;
  globalRole?: GlobalRole | null;
  organizationId?: string | null;
  branchId?: string | null;
  membershipRoleKey?: string | null;
  productScopes?: string[];
  redirectTo?: string | null;
  expiresInHours?: number;
};

type CancelRequest = {
  action: 'cancel';
  invitationId: string;
  reason: string;
};

type IdentityRequest = InviteRequest | CancelRequest;

type CallerProfile = {
  id: string;
  email: string;
  global_role: GlobalRole | null;
  is_active: boolean;
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

function allowedOrigins(): string[] {
  return (Deno.env.get('IMDS_ALLOWED_APP_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(request: Request): HeadersInit {
  const requestOrigin = request.headers.get('origin') ?? '';
  const origins = allowedOrigins();
  const allowOrigin = origins.includes(requestOrigin) ? requestOrigin : origins[0] ?? '';

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError('Email is required', 400);
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError('Email is invalid', 400);
  return email;
}

function normalizeRedirect(value: unknown): string {
  const configuredDefault = requiredEnvironment('IMDS_INVITE_REDIRECT_URL');
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : configuredDefault;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new HttpError('Invitation redirect URL is invalid', 400);
  }

  const allowed = new Set(allowedOrigins());
  allowed.add(new URL(configuredDefault).origin);
  if (!allowed.has(url.origin)) throw new HttpError('Invitation redirect origin is not allowed', 400);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new HttpError('Invitation redirect must use HTTPS', 400);
  }
  return url.toString();
}

function parseBody(value: unknown): IdentityRequest {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new HttpError('JSON request body is required', 400);
  }
  const input = value as Record<string, unknown>;
  if (input.action === 'invite') {
    return {
      action: 'invite',
      email: normalizeEmail(input.email),
      fullName: typeof input.fullName === 'string' ? input.fullName.trim() || null : null,
      globalRole: typeof input.globalRole === 'string' ? input.globalRole as GlobalRole : null,
      organizationId: typeof input.organizationId === 'string' ? input.organizationId : null,
      branchId: typeof input.branchId === 'string' ? input.branchId : null,
      membershipRoleKey: typeof input.membershipRoleKey === 'string' ? input.membershipRoleKey : null,
      productScopes: Array.isArray(input.productScopes)
        ? input.productScopes.filter((item): item is string => typeof item === 'string')
        : [],
      redirectTo: typeof input.redirectTo === 'string' ? input.redirectTo : null,
      expiresInHours: typeof input.expiresInHours === 'number' ? input.expiresInHours : 168,
    };
  }
  if (input.action === 'cancel') {
    if (typeof input.invitationId !== 'string' || !input.invitationId.trim()) {
      throw new HttpError('Invitation id is required', 400);
    }
    if (typeof input.reason !== 'string' || input.reason.trim().length < 5) {
      throw new HttpError('Cancellation reason must contain at least 5 characters', 400);
    }
    return {
      action: 'cancel',
      invitationId: input.invitationId.trim(),
      reason: input.reason.trim(),
    };
  }
  throw new HttpError('Unsupported identity action', 400);
}

async function authenticateCaller(request: Request, supabaseUrl: string, anonKey: string) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.toLowerCase().startsWith('bearer ')) {
    throw new HttpError('Authorization bearer token is required', 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) throw new HttpError('Authentication session is invalid', 401);
  return { userClient, authUser: authData.user };
}

async function assertCallerAccess(
  serviceClient: ReturnType<typeof createClient>,
  callerId: string,
): Promise<CallerProfile> {
  const { data, error } = await serviceClient
    .from('platform_users')
    .select('id, email, global_role, is_active')
    .eq('id', callerId)
    .single();
  if (error || !data) throw new HttpError('Platform profile is missing', 403);

  const profile = data as CallerProfile;
  if (!profile.is_active) throw new HttpError('Platform profile is inactive', 403);
  if (!['platform_owner', 'super_admin'].includes(profile.global_role ?? '')) {
    throw new HttpError('Global role cannot manage Identity Directory', 403);
  }
  return profile;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = requiredEnvironment('SUPABASE_URL');
    const anonKey = requiredEnvironment('SUPABASE_ANON_KEY');
    const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const { userClient, authUser } = await authenticateCaller(request, supabaseUrl, anonKey);
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-imds-service': 'identity-admin/1.0' } },
    });
    await assertCallerAccess(serviceClient, authUser.id);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new HttpError('Request body must be valid JSON', 400);
    }
    const input = parseBody(rawBody);

    if (input.action === 'invite') {
      const redirectTo = normalizeRedirect(input.redirectTo);
      const { data: invitationId, error: invitationError } = await userClient.rpc('create_identity_invitation', {
        email_value: input.email,
        full_name_value: input.fullName,
        global_role_value: input.globalRole,
        organization_id_value: input.organizationId,
        branch_id_value: input.branchId,
        membership_role_key_value: input.membershipRoleKey,
        product_scopes_value: input.productScopes,
        redirect_to_value: redirectTo,
        expires_in_hours: Math.max(1, Math.min(720, Math.trunc(input.expiresInHours ?? 168))),
      });
      if (invitationError || !invitationId) {
        throw new HttpError(invitationError?.message ?? 'Unable to create invitation record', 400);
      }

      const { data: invited, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(input.email, {
        data: { full_name: input.fullName },
        redirectTo,
      });

      const { error: finalizeError } = await serviceClient.rpc('finalize_identity_invitation', {
        target_invitation_id: invitationId,
        auth_user_id_value: invited.user?.id ?? null,
        delivery_error_value: inviteError?.message ?? null,
      });
      if (finalizeError) throw new HttpError(`Invitation finalization failed: ${finalizeError.message}`, 500);
      if (inviteError || !invited.user) throw new HttpError(inviteError?.message ?? 'Invitation delivery failed', 502);

      return jsonResponse(request, {
        invitationId,
        authUserId: invited.user.id,
        status: 'sent',
      }, 201);
    }

    const { data: invitedAuthUserId, error: cancellationError } = await userClient.rpc('cancel_identity_invitation', {
      target_invitation_id: input.invitationId,
      reason_value: input.reason,
    });
    if (cancellationError) throw new HttpError(cancellationError.message, 400);

    if (typeof invitedAuthUserId === 'string' && invitedAuthUserId) {
      const { error: deleteError } = await serviceClient.auth.admin.deleteUser(invitedAuthUserId, false);
      if (deleteError) {
        return jsonResponse(request, {
          invitationId: input.invitationId,
          status: 'cancelled',
          warning: 'Invitation was cancelled, but the unaccepted Auth user could not be removed.',
        });
      }
    }

    return jsonResponse(request, {
      invitationId: input.invitationId,
      status: 'cancelled',
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return jsonResponse(request, {
      error: error instanceof Error ? error.message : 'Unexpected Identity Directory failure',
    }, status);
  }
});
