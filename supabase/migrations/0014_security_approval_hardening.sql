-- Security Approval Center hardening.
-- Adds service-side session validation, revocation, heartbeat and state-machine guards.

create unique index if not exists privileged_access_sessions_one_active_actor_org_idx
on public.privileged_access_sessions (actor_user_id, organization_id)
where status = 'active';

create or replace function public.current_session_has_aal2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke all on function public.current_session_has_aal2() from public;
grant execute on function public.current_session_has_aal2() to authenticated, service_role;

create or replace function public.write_audit_event(
  event_action text,
  event_resource_type text,
  event_resource_id text default null,
  event_organization_id uuid default null,
  event_reason text default null,
  event_before jsonb default null,
  event_after jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid := gen_random_uuid();
  event_time timestamptz := clock_timestamp();
  event_scope text := coalesce(event_organization_id::text, 'platform');
  event_sequence bigint;
  prior_hash text;
  event_hash text;
  actor_id uuid := auth.uid();
begin
  if auth.role() <> 'service_role' and not public.is_platform_staff() then
    raise exception 'Platform staff or service role required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(event_scope, 2147483647));

  select sequence_number, hash
    into event_sequence, prior_hash
  from public.audit_events
  where scope_key = event_scope
  order by sequence_number desc nulls last, occurred_at desc, id desc
  limit 1;

  event_sequence := coalesce(event_sequence, 0) + 1;

  event_hash := encode(
    digest(
      concat_ws(
        '|',
        event_id::text,
        event_time::text,
        actor_id::text,
        event_action,
        event_resource_type,
        coalesce(event_resource_id, ''),
        coalesce(event_reason, ''),
        coalesce(prior_hash, '')
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.audit_events (
    id,
    occurred_at,
    actor_user_id,
    organization_id,
    action,
    resource_type,
    resource_id,
    reason,
    before_state,
    after_state,
    correlation_id,
    hash,
    scope_key,
    sequence_number,
    previous_hash,
    integrity_version
  ) values (
    event_id,
    event_time,
    actor_id,
    event_organization_id,
    event_action,
    event_resource_type,
    event_resource_id,
    event_reason,
    event_before,
    event_after,
    gen_random_uuid(),
    event_hash,
    event_scope,
    event_sequence,
    prior_hash,
    2
  );

  return event_id;
end;
$$;

revoke all on function public.write_audit_event(text, text, text, uuid, text, jsonb, jsonb) from public;
grant execute on function public.write_audit_event(text, text, text, uuid, text, jsonb, jsonb) to authenticated, service_role;

create or replace function public.guard_security_approval_request_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.requested_by <> new.requested_by
     or old.policy_key is distinct from new.policy_key
     or old.organization_id is distinct from new.organization_id
     or old.product_id is distinct from new.product_id
     or old.resource_type is distinct from new.resource_type
     or old.resource_id is distinct from new.resource_id
     or old.requested_payload is distinct from new.requested_payload
     or old.required_approvals <> new.required_approvals
     or old.requested_duration_minutes is distinct from new.requested_duration_minutes
     or old.correlation_id <> new.correlation_id then
    raise exception 'Approval request identity and requested scope are immutable';
  end if;

  if old.status in ('rejected', 'expired', 'cancelled') and new.status <> old.status then
    raise exception 'Terminal approval request cannot be reopened';
  end if;

  if old.status = 'approved' and new.status <> 'approved' then
    raise exception 'Approved request status is immutable';
  end if;

  if new.approvals_received < old.approvals_received then
    raise exception 'Approval count cannot decrease';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_security_approval_request_state() from public;

drop trigger if exists approval_requests_security_state_guard on public.approval_requests;
create trigger approval_requests_security_state_guard
before update on public.approval_requests
for each row execute function public.guard_security_approval_request_state();

create or replace function public.guard_privileged_access_session_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.approval_request_id <> new.approval_request_id
     or old.session_type <> new.session_type
     or old.actor_user_id <> new.actor_user_id
     or old.organization_id <> new.organization_id
     or old.product_id is distinct from new.product_id
     or old.target_user_id is distinct from new.target_user_id
     or old.scope is distinct from new.scope
     or old.read_only <> new.read_only
     or old.requested_duration_minutes <> new.requested_duration_minutes
     or old.correlation_id <> new.correlation_id then
    raise exception 'Privileged session identity and approved scope are immutable';
  end if;

  if old.status = 'approved' and new.status not in ('approved', 'active', 'revoked', 'ended', 'failed') then
    raise exception 'Illegal privileged session transition';
  end if;

  if old.status = 'active' and new.status not in ('active', 'expired', 'revoked', 'ended', 'failed') then
    raise exception 'Illegal active privileged session transition';
  end if;

  if old.status in ('expired', 'revoked', 'ended', 'failed') and new.status <> old.status then
    raise exception 'Closed privileged session cannot be reopened';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_privileged_access_session_state() from public;

drop trigger if exists privileged_access_sessions_state_guard on public.privileged_access_sessions;
create trigger privileged_access_sessions_state_guard
before update on public.privileged_access_sessions
for each row execute function public.guard_privileged_access_session_state();

create or replace function public.heartbeat_privileged_access_session(
  session_id_value uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  session_record public.privileged_access_sessions%rowtype;
  heartbeat_time timestamptz := now();
begin
  select * into session_record
  from public.privileged_access_sessions
  where id = session_id_value
  for update;

  if not found then
    raise exception 'Privileged session not found';
  end if;

  if session_record.actor_user_id <> auth.uid() and not public.can_manage_security() then
    raise exception 'Session actor or security manager role required';
  end if;

  if not public.current_session_has_aal2() then
    raise exception 'AAL2 multi-factor authentication is required';
  end if;

  if session_record.status <> 'active' then
    raise exception 'Only active sessions accept heartbeat';
  end if;

  if session_record.expires_at is null or session_record.expires_at <= heartbeat_time then
    raise exception 'Privileged session has expired';
  end if;

  update public.privileged_access_sessions
  set last_heartbeat_at = heartbeat_time
  where id = session_id_value;

  if session_record.last_heartbeat_at is null
     or session_record.last_heartbeat_at <= heartbeat_time - interval '5 minutes' then
    insert into public.privileged_session_events (
      session_id,
      event_type,
      actor_user_id,
      payload
    ) values (
      session_id_value,
      'heartbeat',
      auth.uid(),
      jsonb_build_object('heartbeatAt', heartbeat_time)
    );
  end if;

  return heartbeat_time;
end;
$$;

create or replace function public.revoke_privileged_access_session(
  session_id_value uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_record public.privileged_access_sessions%rowtype;
begin
  if not public.can_manage_security() then
    raise exception 'Security manager role required';
  end if;

  if not public.current_session_has_aal2() then
    raise exception 'AAL2 multi-factor authentication is required';
  end if;

  if char_length(btrim(reason_value)) < 5 then
    raise exception 'Revocation reason must contain at least 5 characters';
  end if;

  select * into session_record
  from public.privileged_access_sessions
  where id = session_id_value
  for update;

  if not found then
    raise exception 'Privileged session not found';
  end if;

  if session_record.status not in ('approved', 'active') then
    raise exception 'Only approved or active sessions can be revoked';
  end if;

  update public.privileged_access_sessions
  set status = 'revoked',
      ended_at = now(),
      ended_by = auth.uid(),
      end_reason = btrim(reason_value)
  where id = session_id_value;

  insert into public.privileged_session_events (
    session_id,
    event_type,
    actor_user_id,
    payload
  ) values (
    session_id_value,
    'revoked',
    auth.uid(),
    jsonb_build_object('reason', btrim(reason_value))
  );

  if session_record.client_notification_required then
    insert into public.security_notification_outbox (
      organization_id,
      privileged_session_id,
      notification_key,
      payload
    ) values (
      session_record.organization_id,
      session_id_value,
      'privileged_access.revoked',
      jsonb_build_object('reason', btrim(reason_value))
    );
  end if;

  perform public.write_audit_event(
    'security.privileged_session.revoked',
    'privileged_access_session',
    session_id_value::text,
    session_record.organization_id,
    reason_value,
    jsonb_build_object('status', session_record.status),
    jsonb_build_object('status', 'revoked')
  );
end;
$$;

create or replace function public.validate_privileged_access_session(
  session_id_value uuid,
  required_scope_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_record public.privileged_access_sessions%rowtype;
  organization_status_value public.organization_status;
  actor_active boolean;
  is_authorized boolean;
  denial_reason text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into session_record
  from public.privileged_access_sessions
  where id = session_id_value;

  if not found then
    return jsonb_build_object('authorized', false, 'reason', 'session_not_found');
  end if;

  select status into organization_status_value
  from public.organizations
  where id = session_record.organization_id;

  select is_active into actor_active
  from public.platform_users
  where id = session_record.actor_user_id;

  is_authorized := true;
  denial_reason := null;

  if session_record.status <> 'active' then
    is_authorized := false;
    denial_reason := 'session_not_active';
  elsif session_record.expires_at is null or session_record.expires_at <= now() then
    is_authorized := false;
    denial_reason := 'session_expired';
  elsif actor_active is distinct from true then
    is_authorized := false;
    denial_reason := 'actor_inactive';
  elsif organization_status_value in ('suspended', 'archived') or organization_status_value is null then
    is_authorized := false;
    denial_reason := 'organization_unavailable';
  elsif session_record.client_notification_required and session_record.client_notified_at is null then
    is_authorized := false;
    denial_reason := 'client_notification_pending';
  elsif required_scope_value is not null
        and not required_scope_value = any(session_record.scope) then
    is_authorized := false;
    denial_reason := 'scope_not_granted';
  end if;

  return jsonb_build_object(
    'authorized', is_authorized,
    'reason', denial_reason,
    'sessionId', session_record.id,
    'sessionType', session_record.session_type,
    'actorUserId', session_record.actor_user_id,
    'organizationId', session_record.organization_id,
    'productId', session_record.product_id,
    'targetUserId', session_record.target_user_id,
    'readOnly', session_record.read_only,
    'scope', session_record.scope,
    'expiresAt', session_record.expires_at,
    'correlationId', session_record.correlation_id
  );
end;
$$;

create or replace function public.verify_audit_chain(
  target_scope_key text default null
)
returns table (
  scope_key text,
  checked_events bigint,
  is_valid boolean,
  first_invalid_sequence bigint,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_record record;
  event_record record;
  prior_hash text;
  expected_hash text;
  event_count bigint;
  invalid_sequence bigint;
  prior_event_exists boolean;
begin
  if not public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'auditor'::public.global_role
  ]) then
    raise exception 'Security manager or auditor role required';
  end if;

  for scope_record in
    select distinct audit.scope_key
    from public.audit_events audit
    where target_scope_key is null or audit.scope_key = target_scope_key
    order by audit.scope_key
  loop
    prior_hash := null;
    event_count := 0;
    invalid_sequence := null;

    for event_record in
      select *
      from public.audit_events audit
      where audit.scope_key = scope_record.scope_key
        and audit.integrity_version = 2
      order by audit.sequence_number, audit.occurred_at, audit.id
    loop
      event_count := event_count + 1;

      if event_count = 1 and event_record.previous_hash is not null then
        select exists (
          select 1
          from public.audit_events previous_event
          where previous_event.scope_key = scope_record.scope_key
            and previous_event.hash = event_record.previous_hash
            and previous_event.sequence_number < event_record.sequence_number
        ) into prior_event_exists;

        if not prior_event_exists then
          invalid_sequence := event_record.sequence_number;
          exit;
        end if;
      elsif event_count > 1 and event_record.previous_hash is distinct from prior_hash then
        invalid_sequence := event_record.sequence_number;
        exit;
      end if;

      expected_hash := encode(
        digest(
          concat_ws(
            '|',
            event_record.id::text,
            event_record.occurred_at::text,
            event_record.actor_user_id::text,
            event_record.action,
            event_record.resource_type,
            coalesce(event_record.resource_id, ''),
            coalesce(event_record.reason, ''),
            coalesce(event_record.previous_hash, '')
          ),
          'sha256'
        ),
        'hex'
      );

      if expected_hash <> event_record.hash then
        invalid_sequence := event_record.sequence_number;
        exit;
      end if;

      prior_hash := event_record.hash;
    end loop;

    scope_key := scope_record.scope_key;
    checked_events := event_count;
    is_valid := invalid_sequence is null;
    first_invalid_sequence := invalid_sequence;
    message := case
      when event_count = 0 then 'No version 2 audit events'
      when invalid_sequence is null then 'Audit chain is valid'
      else 'Audit chain verification failed'
    end;
    return next;
  end loop;
end;
$$;

revoke all on function public.heartbeat_privileged_access_session(uuid) from public;
revoke all on function public.revoke_privileged_access_session(uuid, text) from public;
revoke all on function public.validate_privileged_access_session(uuid, text) from public;
revoke all on function public.verify_audit_chain(text) from public;

grant execute on function public.heartbeat_privileged_access_session(uuid) to authenticated;
grant execute on function public.revoke_privileged_access_session(uuid, text) to authenticated;
grant execute on function public.validate_privileged_access_session(uuid, text) to service_role;
grant execute on function public.verify_audit_chain(text) to authenticated;

comment on function public.validate_privileged_access_session(uuid, text) is
  'Service-side authorization check that product adapters must call before honoring a privileged access token.';
comment on function public.revoke_privileged_access_session(uuid, text) is
  'Immediately revokes an approved or active privileged session and emits customer notification plus audit event.';
