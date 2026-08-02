-- Security Approval Center, time-boxed privileged access and tamper-evident audit chain.
-- All privileged mutations are exposed only through guarded security-definer RPCs.

create type public.approval_risk_level as enum ('low', 'medium', 'high', 'critical');
create type public.approval_decision as enum ('approved', 'rejected');
create type public.privileged_session_type as enum (
  'support_impersonation',
  'break_glass',
  'maintenance'
);
create type public.privileged_session_status as enum (
  'approved',
  'active',
  'expired',
  'revoked',
  'ended',
  'failed'
);
create type public.security_notification_status as enum (
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled'
);

create table public.approval_policies (
  key text primary key,
  title text not null,
  description text,
  risk_level public.approval_risk_level not null,
  required_approvals smallint not null default 1 check (required_approvals between 1 and 5),
  requester_roles public.global_role[] not null,
  approver_roles public.global_role[] not null,
  max_duration_minutes integer not null default 60 check (max_duration_minutes between 5 and 1440),
  approval_ttl_minutes integer not null default 1440 check (approval_ttl_minutes between 5 and 10080),
  organization_required boolean not null default false,
  product_required boolean not null default false,
  mfa_required boolean not null default true,
  client_notification_required boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (key ~ '^[a-z0-9][a-z0-9._-]+$'),
  check (cardinality(requester_roles) > 0),
  check (cardinality(approver_roles) > 0)
);

alter table public.approval_requests
  add column if not exists policy_key text references public.approval_policies(key),
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists resource_type text,
  add column if not exists resource_id text,
  add column if not exists risk_level public.approval_risk_level not null default 'high',
  add column if not exists required_approvals smallint not null default 1,
  add column if not exists approvals_received smallint not null default 0,
  add column if not exists requested_duration_minutes integer,
  add column if not exists requested_payload jsonb not null default '{}'::jsonb,
  add column if not exists requester_role public.global_role,
  add column if not exists idempotency_key text,
  add column if not exists correlation_id uuid not null default gen_random_uuid(),
  add column if not exists execution_status text not null default 'not_applicable',
  add column if not exists executed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.approval_requests
  drop constraint if exists approval_requests_status_check;

alter table public.approval_requests
  add constraint approval_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  add constraint approval_requests_approval_count_check
  check (
    required_approvals between 1 and 5
    and approvals_received between 0 and required_approvals
  ),
  add constraint approval_requests_duration_check
  check (requested_duration_minutes is null or requested_duration_minutes between 5 and 1440),
  add constraint approval_requests_execution_status_check
  check (execution_status in ('not_applicable', 'pending', 'ready', 'executed', 'failed', 'cancelled'));

create unique index approval_requests_requester_idempotency_idx
on public.approval_requests (requested_by, idempotency_key)
where idempotency_key is not null;

create index approval_requests_security_queue_idx
on public.approval_requests (status, risk_level, created_at desc);

create index approval_requests_organization_idx
on public.approval_requests (organization_id, created_at desc)
where organization_id is not null;

create table public.approval_request_decisions (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references public.approval_requests(id) on delete cascade,
  reviewer_user_id uuid not null references public.platform_users(id),
  reviewer_role public.global_role not null,
  decision public.approval_decision not null,
  note text not null,
  created_at timestamptz not null default now(),
  unique (approval_request_id, reviewer_user_id),
  check (char_length(btrim(note)) >= 5)
);

create index approval_request_decisions_request_idx
on public.approval_request_decisions (approval_request_id, created_at);

create table public.privileged_access_sessions (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null unique references public.approval_requests(id) on delete restrict,
  session_type public.privileged_session_type not null,
  actor_user_id uuid not null references public.platform_users(id),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  target_user_id uuid references public.platform_users(id) on delete set null,
  scope text[] not null default '{}',
  read_only boolean not null default true,
  status public.privileged_session_status not null default 'approved',
  reason text not null,
  requested_duration_minutes integer not null check (requested_duration_minutes between 5 and 240),
  started_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.platform_users(id),
  end_reason text,
  client_notification_required boolean not null default true,
  client_notified_at timestamptz,
  last_heartbeat_at timestamptz,
  external_session_reference text,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(reason)) >= 10),
  check (expires_at is null or started_at is not null),
  check (expires_at is null or expires_at > started_at)
);

create index privileged_access_sessions_active_idx
on public.privileged_access_sessions (status, expires_at)
where status in ('approved', 'active');

create index privileged_access_sessions_organization_idx
on public.privileged_access_sessions (organization_id, created_at desc);

create table public.privileged_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.privileged_access_sessions(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references public.platform_users(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (event_type in (
    'materialized',
    'activated',
    'heartbeat',
    'client_notified',
    'ended',
    'expired',
    'revoked',
    'failed'
  ))
);

create index privileged_session_events_session_idx
on public.privileged_session_events (session_id, created_at);

create table public.security_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  privileged_session_id uuid references public.privileged_access_sessions(id) on delete cascade,
  notification_key text not null,
  channel text not null default 'in_app',
  recipient_reference text,
  payload jsonb not null default '{}'::jsonb,
  status public.security_notification_status not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel in ('in_app', 'email', 'sms', 'whatsapp', 'webhook')),
  check (attempt_count >= 0)
);

create index security_notification_outbox_queue_idx
on public.security_notification_outbox (status, available_at)
where status in ('pending', 'failed');

alter table public.audit_events
  add column if not exists scope_key text,
  add column if not exists sequence_number bigint,
  add column if not exists previous_hash text,
  add column if not exists integrity_version smallint not null default 1;

update public.audit_events
set scope_key = coalesce(organization_id::text, 'platform')
where scope_key is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by coalesce(organization_id::text, 'platform')
      order by occurred_at, id
    ) as sequence_number
  from public.audit_events
)
update public.audit_events target
set sequence_number = ranked.sequence_number
from ranked
where target.id = ranked.id
  and target.sequence_number is null;

alter table public.audit_events
  alter column scope_key set default 'platform';

create unique index audit_events_scope_sequence_idx
on public.audit_events (scope_key, sequence_number)
where sequence_number is not null;

create index audit_events_integrity_idx
on public.audit_events (scope_key, integrity_version, sequence_number);

create trigger approval_policies_set_updated_at
before update on public.approval_policies
for each row execute function public.set_updated_at();

create trigger approval_requests_security_set_updated_at
before update on public.approval_requests
for each row execute function public.set_updated_at();

create trigger privileged_access_sessions_set_updated_at
before update on public.privileged_access_sessions
for each row execute function public.set_updated_at();

create trigger security_notification_outbox_set_updated_at
before update on public.security_notification_outbox
for each row execute function public.set_updated_at();

create or replace function public.current_session_has_aal2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function public.can_manage_security()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role
  ]);
$$;

create or replace function public.can_request_privileged_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'support_admin'::public.global_role,
    'technical_admin'::public.global_role
  ]);
$$;

revoke all on function public.current_session_has_aal2() from public;
revoke all on function public.can_manage_security() from public;
revoke all on function public.can_request_privileged_access() from public;
grant execute on function public.current_session_has_aal2() to authenticated;
grant execute on function public.can_manage_security() to authenticated;
grant execute on function public.can_request_privileged_access() to authenticated;

create or replace function public.prevent_security_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Security history is append-only';
end;
$$;

revoke all on function public.prevent_security_history_mutation() from public;

create trigger approval_request_decisions_immutable
before update or delete on public.approval_request_decisions
for each row execute function public.prevent_security_history_mutation();

create trigger privileged_session_events_immutable
before update or delete on public.privileged_session_events
for each row execute function public.prevent_security_history_mutation();

-- Replace the audit writer with a per-tenant hash chain. Version 1 events remain
-- valid historical anchors; version 2 events include the previous event hash.
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
begin
  if not public.is_platform_staff() then
    raise exception 'Platform staff role required';
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
        auth.uid()::text,
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
    auth.uid(),
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
grant execute on function public.write_audit_event(text, text, text, uuid, text, jsonb, jsonb) to authenticated;

create or replace function public.request_security_approval(
  policy_key_value text,
  reason_value text,
  organization_id_value uuid default null,
  product_id_value uuid default null,
  resource_type_value text default null,
  resource_id_value text default null,
  requested_duration_minutes_value integer default null,
  payload_value jsonb default '{}'::jsonb,
  idempotency_key_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role public.global_role := public.current_global_role();
  policy_record public.approval_policies%rowtype;
  approval_id uuid;
  duration_minutes integer;
begin
  if auth.uid() is null or current_role is null then
    raise exception 'Active platform staff account required';
  end if;

  select * into policy_record
  from public.approval_policies
  where key = policy_key_value
    and is_active = true;

  if not found then
    raise exception 'Approval policy is unavailable';
  end if;

  if not current_role = any(policy_record.requester_roles) then
    raise exception 'Current role cannot request this approval';
  end if;

  if policy_record.mfa_required and not public.current_session_has_aal2() then
    raise exception 'AAL2 multi-factor authentication is required';
  end if;

  if char_length(btrim(reason_value)) < 10 then
    raise exception 'Reason must contain at least 10 characters';
  end if;

  if policy_record.organization_required and organization_id_value is null then
    raise exception 'Organization is required by this policy';
  end if;

  if policy_record.product_required and product_id_value is null then
    raise exception 'Product is required by this policy';
  end if;

  if organization_id_value is not null and not exists (
    select 1 from public.organizations where id = organization_id_value and status <> 'archived'
  ) then
    raise exception 'Organization is unavailable';
  end if;

  if product_id_value is not null and not exists (
    select 1 from public.products where id = product_id_value and archived_at is null
  ) then
    raise exception 'Product is unavailable';
  end if;

  duration_minutes := coalesce(requested_duration_minutes_value, policy_record.max_duration_minutes);
  if duration_minutes < 5 or duration_minutes > policy_record.max_duration_minutes then
    raise exception 'Requested duration exceeds policy limit';
  end if;

  if idempotency_key_value is not null then
    select id into approval_id
    from public.approval_requests
    where requested_by = auth.uid()
      and idempotency_key = idempotency_key_value
    limit 1;

    if approval_id is not null then
      return approval_id;
    end if;
  end if;

  insert into public.approval_requests (
    action_key,
    policy_key,
    organization_id,
    product_id,
    resource_type,
    resource_id,
    requested_by,
    requester_role,
    status,
    reason,
    risk_level,
    required_approvals,
    approvals_received,
    requested_duration_minutes,
    requested_payload,
    idempotency_key,
    correlation_id,
    execution_status,
    expires_at
  ) values (
    policy_record.key,
    policy_record.key,
    organization_id_value,
    product_id_value,
    resource_type_value,
    resource_id_value,
    auth.uid(),
    current_role,
    'pending',
    btrim(reason_value),
    policy_record.risk_level,
    policy_record.required_approvals,
    0,
    duration_minutes,
    coalesce(payload_value, '{}'::jsonb),
    nullif(btrim(idempotency_key_value), ''),
    gen_random_uuid(),
    'pending',
    now() + make_interval(mins => policy_record.approval_ttl_minutes)
  ) returning id into approval_id;

  perform public.write_audit_event(
    'security.approval.requested',
    'approval_request',
    approval_id::text,
    organization_id_value,
    reason_value,
    null,
    jsonb_build_object(
      'policyKey', policy_record.key,
      'riskLevel', policy_record.risk_level,
      'requiredApprovals', policy_record.required_approvals,
      'requestedDurationMinutes', duration_minutes
    )
  );

  return approval_id;
end;
$$;

create or replace function public.decide_security_approval(
  approval_request_id_value uuid,
  decision_value public.approval_decision,
  note_value text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role public.global_role := public.current_global_role();
  request_record public.approval_requests%rowtype;
  policy_record public.approval_policies%rowtype;
  approved_count integer;
  resolved_status text;
  session_type_value public.privileged_session_type;
  session_id_value uuid;
  scope_values text[] := '{}';
  target_user_id_value uuid;
  read_only_value boolean := true;
begin
  if auth.uid() is null or current_role is null then
    raise exception 'Active platform staff account required';
  end if;

  if char_length(btrim(note_value)) < 5 then
    raise exception 'Decision note must contain at least 5 characters';
  end if;

  select * into request_record
  from public.approval_requests
  where id = approval_request_id_value
  for update;

  if not found then
    raise exception 'Approval request not found';
  end if;

  if request_record.status <> 'pending' then
    raise exception 'Approval request is no longer pending';
  end if;

  if request_record.expires_at is not null and request_record.expires_at <= now() then
    raise exception 'Approval request has expired';
  end if;

  if request_record.requested_by = auth.uid() then
    raise exception 'Requester cannot approve or reject their own request';
  end if;

  select * into policy_record
  from public.approval_policies
  where key = request_record.policy_key
    and is_active = true;

  if not found then
    raise exception 'Approval policy is unavailable';
  end if;

  if not current_role = any(policy_record.approver_roles) then
    raise exception 'Current role cannot review this approval';
  end if;

  if policy_record.mfa_required and not public.current_session_has_aal2() then
    raise exception 'AAL2 multi-factor authentication is required';
  end if;

  insert into public.approval_request_decisions (
    approval_request_id,
    reviewer_user_id,
    reviewer_role,
    decision,
    note
  ) values (
    approval_request_id_value,
    auth.uid(),
    current_role,
    decision_value,
    btrim(note_value)
  );

  if decision_value = 'rejected' then
    update public.approval_requests
    set status = 'rejected',
        reviewed_by = auth.uid(),
        decision_note = btrim(note_value),
        decided_at = now(),
        execution_status = 'cancelled'
    where id = approval_request_id_value;
    resolved_status := 'rejected';
  else
    select count(*) into approved_count
    from public.approval_request_decisions
    where approval_request_id = approval_request_id_value
      and decision = 'approved';

    update public.approval_requests
    set approvals_received = least(approved_count, required_approvals),
        reviewed_by = auth.uid(),
        decision_note = btrim(note_value),
        status = case when approved_count >= required_approvals then 'approved' else 'pending' end,
        decided_at = case when approved_count >= required_approvals then now() else decided_at end,
        execution_status = case when approved_count >= required_approvals then 'ready' else execution_status end
    where id = approval_request_id_value
    returning status into resolved_status;
  end if;

  if resolved_status = 'approved' and request_record.action_key in (
    'support.impersonation.readonly',
    'support.impersonation.write',
    'security.break_glass',
    'security.maintenance'
  ) then
    session_type_value := case
      when request_record.action_key like 'support.impersonation.%' then 'support_impersonation'::public.privileged_session_type
      when request_record.action_key = 'security.break_glass' then 'break_glass'::public.privileged_session_type
      else 'maintenance'::public.privileged_session_type
    end;

    if jsonb_typeof(request_record.requested_payload -> 'scope') = 'array' then
      select coalesce(array_agg(value), '{}')
      into scope_values
      from jsonb_array_elements_text(request_record.requested_payload -> 'scope') as scope_item(value);
    end if;

    if coalesce(request_record.requested_payload ->> 'targetUserId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      target_user_id_value := (request_record.requested_payload ->> 'targetUserId')::uuid;
    end if;

    read_only_value := coalesce((request_record.requested_payload ->> 'readOnly')::boolean, true);

    insert into public.privileged_access_sessions (
      approval_request_id,
      session_type,
      actor_user_id,
      organization_id,
      product_id,
      target_user_id,
      scope,
      read_only,
      status,
      reason,
      requested_duration_minutes,
      client_notification_required,
      correlation_id,
      metadata
    ) values (
      approval_request_id_value,
      session_type_value,
      request_record.requested_by,
      request_record.organization_id,
      request_record.product_id,
      target_user_id_value,
      scope_values,
      read_only_value,
      'approved',
      request_record.reason,
      least(coalesce(request_record.requested_duration_minutes, policy_record.max_duration_minutes), 240),
      policy_record.client_notification_required,
      request_record.correlation_id,
      jsonb_build_object('policyKey', request_record.policy_key)
    )
    on conflict (approval_request_id) do nothing
    returning id into session_id_value;

    if session_id_value is not null then
      insert into public.privileged_session_events (
        session_id,
        event_type,
        actor_user_id,
        payload
      ) values (
        session_id_value,
        'materialized',
        auth.uid(),
        jsonb_build_object('approvalRequestId', approval_request_id_value)
      );

      if policy_record.client_notification_required then
        insert into public.security_notification_outbox (
          organization_id,
          privileged_session_id,
          notification_key,
          payload
        ) values (
          request_record.organization_id,
          session_id_value,
          'privileged_access.approved',
          jsonb_build_object(
            'sessionType', session_type_value,
            'readOnly', read_only_value,
            'durationMinutes', request_record.requested_duration_minutes
          )
        );
      end if;
    end if;
  end if;

  perform public.write_audit_event(
    'security.approval.' || decision_value::text,
    'approval_request',
    approval_request_id_value::text,
    request_record.organization_id,
    note_value,
    jsonb_build_object('status', request_record.status),
    jsonb_build_object('status', resolved_status)
  );

  return resolved_status;
end;
$$;

create or replace function public.cancel_security_approval(
  approval_request_id_value uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record public.approval_requests%rowtype;
begin
  if char_length(btrim(reason_value)) < 5 then
    raise exception 'Cancellation reason must contain at least 5 characters';
  end if;

  select * into request_record
  from public.approval_requests
  where id = approval_request_id_value
  for update;

  if not found then
    raise exception 'Approval request not found';
  end if;

  if request_record.status <> 'pending' then
    raise exception 'Only pending approvals can be cancelled';
  end if;

  if request_record.requested_by <> auth.uid() and not public.can_manage_security() then
    raise exception 'Requester or security manager role required';
  end if;

  update public.approval_requests
  set status = 'cancelled',
      execution_status = 'cancelled',
      cancelled_at = now(),
      decision_note = btrim(reason_value)
  where id = approval_request_id_value;

  perform public.write_audit_event(
    'security.approval.cancelled',
    'approval_request',
    approval_request_id_value::text,
    request_record.organization_id,
    reason_value,
    jsonb_build_object('status', request_record.status),
    jsonb_build_object('status', 'cancelled')
  );
end;
$$;

create or replace function public.activate_privileged_access_session(
  session_id_value uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_record public.privileged_access_sessions%rowtype;
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

  if session_record.status <> 'approved' then
    raise exception 'Only approved sessions can be activated';
  end if;

  if not exists (
    select 1 from public.approval_requests
    where id = session_record.approval_request_id
      and status = 'approved'
  ) then
    raise exception 'Approved request is required';
  end if;

  update public.privileged_access_sessions
  set status = 'active',
      started_at = now(),
      expires_at = now() + make_interval(mins => session_record.requested_duration_minutes),
      last_heartbeat_at = now()
  where id = session_id_value;

  insert into public.privileged_session_events (
    session_id,
    event_type,
    actor_user_id,
    payload
  ) values (
    session_id_value,
    'activated',
    auth.uid(),
    jsonb_build_object('durationMinutes', session_record.requested_duration_minutes)
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
      'privileged_access.started',
      jsonb_build_object('sessionType', session_record.session_type)
    );
  end if;

  perform public.write_audit_event(
    'security.privileged_session.activated',
    'privileged_access_session',
    session_id_value::text,
    session_record.organization_id,
    session_record.reason,
    jsonb_build_object('status', session_record.status),
    jsonb_build_object('status', 'active')
  );
end;
$$;

create or replace function public.end_privileged_access_session(
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
  if char_length(btrim(reason_value)) < 5 then
    raise exception 'End reason must contain at least 5 characters';
  end if;

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

  if session_record.status not in ('approved', 'active') then
    raise exception 'Session is already closed';
  end if;

  update public.privileged_access_sessions
  set status = 'ended',
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
    'ended',
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
      'privileged_access.ended',
      jsonb_build_object('reason', btrim(reason_value))
    );
  end if;

  perform public.write_audit_event(
    'security.privileged_session.ended',
    'privileged_access_session',
    session_id_value::text,
    session_record.organization_id,
    reason_value,
    jsonb_build_object('status', session_record.status),
    jsonb_build_object('status', 'ended')
  );
end;
$$;

create or replace function public.mark_privileged_session_client_notified(
  session_id_value uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_record public.privileged_access_sessions%rowtype;
begin
  if not public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'support_admin'::public.global_role
  ]) then
    raise exception 'Support or security manager role required';
  end if;

  select * into session_record
  from public.privileged_access_sessions
  where id = session_id_value
  for update;

  if not found then
    raise exception 'Privileged session not found';
  end if;

  update public.privileged_access_sessions
  set client_notified_at = coalesce(client_notified_at, now())
  where id = session_id_value;

  insert into public.privileged_session_events (
    session_id,
    event_type,
    actor_user_id,
    payload
  ) values (
    session_id_value,
    'client_notified',
    auth.uid(),
    '{}'::jsonb
  );

  perform public.write_audit_event(
    'security.privileged_session.client_notified',
    'privileged_access_session',
    session_id_value::text,
    session_record.organization_id,
    'Client notification confirmed',
    null,
    jsonb_build_object('clientNotifiedAt', now())
  );
end;
$$;

create or replace function public.expire_security_controls()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_approval_count integer := 0;
  expired_session_count integer := 0;
begin
  if auth.role() <> 'service_role' and not public.can_manage_security() then
    raise exception 'Service role or security manager role required';
  end if;

  update public.approval_requests
  set status = 'expired',
      execution_status = 'cancelled',
      decided_at = now()
  where status = 'pending'
    and expires_at is not null
    and expires_at <= now();
  get diagnostics expired_approval_count = row_count;

  with expired as (
    update public.privileged_access_sessions
    set status = 'expired',
        ended_at = now(),
        end_reason = 'Automatic expiry'
    where status = 'active'
      and expires_at is not null
      and expires_at <= now()
    returning id, organization_id
  )
  insert into public.privileged_session_events (
    session_id,
    event_type,
    actor_user_id,
    payload
  )
  select id, 'expired', auth.uid(), jsonb_build_object('reason', 'Automatic expiry')
  from expired;
  get diagnostics expired_session_count = row_count;

  return jsonb_build_object(
    'expiredApprovals', expired_approval_count,
    'expiredSessions', expired_session_count
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

      if event_count = 1 then
        prior_hash := event_record.previous_hash;
      elsif event_record.previous_hash is distinct from prior_hash then
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

revoke all on function public.request_security_approval(text, text, uuid, uuid, text, text, integer, jsonb, text) from public;
revoke all on function public.decide_security_approval(uuid, public.approval_decision, text) from public;
revoke all on function public.cancel_security_approval(uuid, text) from public;
revoke all on function public.activate_privileged_access_session(uuid) from public;
revoke all on function public.end_privileged_access_session(uuid, text) from public;
revoke all on function public.mark_privileged_session_client_notified(uuid) from public;
revoke all on function public.expire_security_controls() from public;
revoke all on function public.verify_audit_chain(text) from public;

grant execute on function public.request_security_approval(text, text, uuid, uuid, text, text, integer, jsonb, text) to authenticated;
grant execute on function public.decide_security_approval(uuid, public.approval_decision, text) to authenticated;
grant execute on function public.cancel_security_approval(uuid, text) to authenticated;
grant execute on function public.activate_privileged_access_session(uuid) to authenticated;
grant execute on function public.end_privileged_access_session(uuid, text) to authenticated;
grant execute on function public.mark_privileged_session_client_notified(uuid) to authenticated;
grant execute on function public.expire_security_controls() to authenticated, service_role;
grant execute on function public.verify_audit_chain(text) to authenticated;

alter table public.approval_policies enable row level security;
alter table public.approval_request_decisions enable row level security;
alter table public.privileged_access_sessions enable row level security;
alter table public.privileged_session_events enable row level security;
alter table public.security_notification_outbox enable row level security;

drop policy if exists approval_policies_platform_staff_select on public.approval_policies;
create policy approval_policies_platform_staff_select
on public.approval_policies for select
to authenticated
using (public.is_platform_staff());

drop policy if exists approval_requests_platform_staff_select on public.approval_requests;
create policy approval_requests_platform_staff_select
on public.approval_requests for select
to authenticated
using (public.is_platform_staff());

drop policy if exists approval_decisions_platform_staff_select on public.approval_request_decisions;
create policy approval_decisions_platform_staff_select
on public.approval_request_decisions for select
to authenticated
using (public.is_platform_staff());

drop policy if exists privileged_sessions_platform_staff_select on public.privileged_access_sessions;
create policy privileged_sessions_platform_staff_select
on public.privileged_access_sessions for select
to authenticated
using (public.is_platform_staff());

drop policy if exists privileged_session_events_platform_staff_select on public.privileged_session_events;
create policy privileged_session_events_platform_staff_select
on public.privileged_session_events for select
to authenticated
using (public.is_platform_staff());

drop policy if exists security_notifications_platform_staff_select on public.security_notification_outbox;
create policy security_notifications_platform_staff_select
on public.security_notification_outbox for select
to authenticated
using (public.is_platform_staff());

revoke insert, update, delete on public.approval_policies from authenticated;
revoke insert, update, delete on public.approval_requests from authenticated;
revoke insert, update, delete on public.approval_request_decisions from authenticated;
revoke insert, update, delete on public.privileged_access_sessions from authenticated;
revoke insert, update, delete on public.privileged_session_events from authenticated;
revoke insert, update, delete on public.security_notification_outbox from authenticated;

grant select on public.approval_policies to authenticated;
grant select on public.approval_requests to authenticated;
grant select on public.approval_request_decisions to authenticated;
grant select on public.privileged_access_sessions to authenticated;
grant select on public.privileged_session_events to authenticated;
grant select on public.security_notification_outbox to authenticated;

insert into public.approval_policies (
  key,
  title,
  description,
  risk_level,
  required_approvals,
  requester_roles,
  approver_roles,
  max_duration_minutes,
  approval_ttl_minutes,
  organization_required,
  product_required,
  mfa_required,
  client_notification_required,
  metadata
) values
  (
    'support.impersonation.readonly',
    'Support session: read-only',
    'Time-boxed support access without mutation rights.',
    'high',
    1,
    array['platform_owner','super_admin','support_admin']::public.global_role[],
    array['platform_owner','super_admin']::public.global_role[],
    60,
    1440,
    true,
    false,
    true,
    true,
    '{"category":"support"}'::jsonb
  ),
  (
    'support.impersonation.write',
    'Support session: write access',
    'Exceptional support session with narrowly scoped mutation rights.',
    'critical',
    2,
    array['platform_owner','super_admin','support_admin']::public.global_role[],
    array['platform_owner','super_admin']::public.global_role[],
    30,
    720,
    true,
    true,
    true,
    true,
    '{"category":"support"}'::jsonb
  ),
  (
    'security.break_glass',
    'Break-glass emergency access',
    'Emergency access for incident containment and recovery.',
    'critical',
    2,
    array['platform_owner','super_admin','technical_admin']::public.global_role[],
    array['platform_owner','super_admin']::public.global_role[],
    30,
    240,
    true,
    true,
    true,
    true,
    '{"category":"security"}'::jsonb
  ),
  (
    'security.maintenance',
    'Privileged maintenance window',
    'Planned time-boxed maintenance access to a product tenant.',
    'high',
    1,
    array['platform_owner','super_admin','technical_admin']::public.global_role[],
    array['platform_owner','super_admin']::public.global_role[],
    120,
    1440,
    true,
    true,
    true,
    true,
    '{"category":"security"}'::jsonb
  ),
  (
    'billing.refund.large',
    'Large payment refund',
    'Refund above the configured financial threshold.',
    'critical',
    2,
    array['platform_owner','super_admin','finance_admin']::public.global_role[],
    array['platform_owner','super_admin','finance_admin']::public.global_role[],
    60,
    1440,
    true,
    false,
    true,
    false,
    '{"category":"billing","thresholdKzt":500000}'::jsonb
  ),
  (
    'organization.delete',
    'Permanent organization deletion',
    'Irreversible deletion after retention and export requirements are satisfied.',
    'critical',
    2,
    array['platform_owner','super_admin']::public.global_role[],
    array['platform_owner','super_admin']::public.global_role[],
    60,
    1440,
    true,
    false,
    true,
    true,
    '{"category":"data_governance"}'::jsonb
  ),
  (
    'product.disable.global',
    'Global product disable',
    'Disable a product across all tenants during a severe incident.',
    'critical',
    2,
    array['platform_owner','super_admin','technical_admin']::public.global_role[],
    array['platform_owner','super_admin']::public.global_role[],
    60,
    240,
    false,
    true,
    true,
    false,
    '{"category":"operations"}'::jsonb
  ),
  (
    'entitlement.override',
    'Entitlement override',
    'Temporary override of a licensed feature or usage limit.',
    'high',
    1,
    array['platform_owner','super_admin','finance_admin','technical_admin']::public.global_role[],
    array['platform_owner','super_admin']::public.global_role[],
    1440,
    1440,
    true,
    true,
    true,
    false,
    '{"category":"licensing"}'::jsonb
  )
on conflict (key) do update
set title = excluded.title,
    description = excluded.description,
    risk_level = excluded.risk_level,
    required_approvals = excluded.required_approvals,
    requester_roles = excluded.requester_roles,
    approver_roles = excluded.approver_roles,
    max_duration_minutes = excluded.max_duration_minutes,
    approval_ttl_minutes = excluded.approval_ttl_minutes,
    organization_required = excluded.organization_required,
    product_required = excluded.product_required,
    mfa_required = excluded.mfa_required,
    client_notification_required = excluded.client_notification_required,
    metadata = excluded.metadata,
    updated_at = now();

comment on table public.approval_policies is
  'Four-eyes policies for destructive, financial and privileged-access actions.';
comment on table public.approval_request_decisions is
  'Append-only reviewer decisions. The requester can never review their own request.';
comment on table public.privileged_access_sessions is
  'Time-boxed control-plane authorization. Product adapters must validate the session id before issuing downstream access.';
comment on table public.security_notification_outbox is
  'Durable notifications for customers affected by privileged access sessions.';
comment on function public.verify_audit_chain(text) is
  'Verifies version 2 hash-linked audit events by platform or organization scope.';
comment on table public.impersonation_sessions is
  'Legacy table retained for compatibility. New support and break-glass access uses privileged_access_sessions.';
