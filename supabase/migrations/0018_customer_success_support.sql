-- Customer Success, onboarding, support tickets, SLA and diagnostic control plane.
-- This module stores operational service data only. It must not copy patient,
-- clinical or product-domain records into the Super Admin database.

create type public.support_ticket_type as enum (
  'incident', 'problem', 'question', 'request', 'onboarding', 'billing', 'integration'
);
create type public.support_ticket_priority as enum ('low', 'normal', 'high', 'urgent', 'critical');
create type public.support_ticket_status as enum (
  'new', 'open', 'in_progress', 'waiting_customer', 'waiting_internal',
  'resolved', 'closed', 'cancelled'
);
create type public.support_channel as enum ('portal', 'email', 'phone', 'whatsapp', 'system', 'internal');
create type public.support_author_type as enum ('customer', 'staff', 'system');
create type public.support_task_status as enum ('open', 'in_progress', 'blocked', 'completed', 'cancelled');
create type public.customer_risk_level as enum ('healthy', 'attention', 'at_risk', 'critical');
create type public.customer_lifecycle_stage as enum (
  'lead', 'contracting', 'onboarding', 'trial', 'active', 'renewal', 'paused', 'churned'
);
create type public.onboarding_stage as enum (
  'kickoff', 'configuration', 'data_migration', 'integrations', 'training',
  'pilot', 'go_live', 'hypercare', 'completed', 'on_hold', 'cancelled'
);
create type public.onboarding_step_status as enum ('pending', 'in_progress', 'blocked', 'completed', 'skipped');
create type public.customer_interaction_type as enum (
  'call', 'meeting', 'email', 'whatsapp', 'training', 'review', 'incident', 'note'
);

create sequence if not exists public.support_ticket_number_seq start 1;

create or replace function public.next_support_ticket_number()
returns text
language sql
volatile
set search_path = public
as $$
  select 'SUP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.support_ticket_number_seq')::text, 6, '0');
$$;

revoke all on function public.next_support_ticket_number() from public;

create table public.support_sla_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  priority public.support_ticket_priority not null,
  first_response_minutes integer not null check (first_response_minutes between 5 and 10080),
  resolution_minutes integer not null check (resolution_minutes between 15 and 43200),
  escalation_minutes integer not null check (escalation_minutes between 5 and 43200),
  business_hours_only boolean not null default false,
  is_default boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (jsonb_typeof(metadata) = 'object')
);

create unique index support_sla_default_priority_idx
on public.support_sla_policies(priority)
where is_default and is_active;

create table public.customer_success_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.platform_users(id) on delete set null,
  lifecycle_stage public.customer_lifecycle_stage not null default 'onboarding',
  segment text not null default 'standard',
  health_score integer not null default 70 check (health_score between 0 and 100),
  risk_level public.customer_risk_level not null default 'attention',
  adoption_score integer not null default 70 check (adoption_score between 0 and 100),
  support_score integer not null default 100 check (support_score between 0 and 100),
  billing_score integer not null default 100 check (billing_score between 0 and 100),
  reliability_score integer not null default 100 check (reliability_score between 0 and 100),
  onboarding_score integer not null default 0 check (onboarding_score between 0 and 100),
  last_contact_at timestamptz,
  next_contact_at timestamptz,
  renewal_at date,
  churn_reason text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default public.next_support_ticket_number(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  type public.support_ticket_type not null,
  priority public.support_ticket_priority not null default 'normal',
  status public.support_ticket_status not null default 'new',
  channel public.support_channel not null default 'portal',
  subject text not null,
  description text not null,
  requester_name text,
  requester_email text,
  requester_phone text,
  assigned_to uuid references public.platform_users(id) on delete set null,
  created_by uuid references public.platform_users(id) on delete set null,
  sla_policy_id uuid references public.support_sla_policies(id) on delete set null,
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  first_response_breached boolean not null default false,
  resolution_breached boolean not null default false,
  customer_visible boolean not null default true,
  correlation_id uuid not null default gen_random_uuid(),
  source_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(subject)) between 3 and 250),
  check (char_length(btrim(description)) >= 5),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_type public.support_author_type not null,
  author_user_id uuid references public.platform_users(id) on delete set null,
  author_name text,
  body text not null,
  is_internal boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(btrim(body)) >= 1),
  check (jsonb_typeof(attachments) = 'array'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references public.platform_users(id) on delete set null,
  from_status public.support_ticket_status,
  to_status public.support_ticket_status,
  note text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (event_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (jsonb_typeof(payload) = 'object')
);

create table public.support_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  title text not null,
  description text,
  status public.support_task_status not null default 'open',
  priority public.support_ticket_priority not null default 'normal',
  assigned_to uuid references public.platform_users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.platform_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(title)) >= 3),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.onboarding_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.platform_users(id) on delete set null,
  stage public.onboarding_stage not null default 'kickoff',
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  started_at timestamptz not null default now(),
  target_go_live_at date,
  actual_go_live_at date,
  completed_at timestamptz,
  blocked_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  onboarding_plan_id uuid not null references public.onboarding_plans(id) on delete cascade,
  step_key text not null,
  title text not null,
  description text,
  display_order integer not null default 0,
  status public.onboarding_step_status not null default 'pending',
  assigned_to uuid references public.platform_users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  completion_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (onboarding_plan_id, step_key),
  check (step_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.customer_interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid references public.support_tickets(id) on delete set null,
  interaction_type public.customer_interaction_type not null,
  channel public.support_channel not null default 'internal',
  summary text not null,
  occurred_at timestamptz not null default now(),
  next_action text,
  next_action_at timestamptz,
  actor_user_id uuid references public.platform_users(id) on delete set null,
  participants jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(btrim(summary)) >= 3),
  check (jsonb_typeof(participants) = 'array'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.customer_health_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  health_score integer not null check (health_score between 0 and 100),
  risk_level public.customer_risk_level not null,
  components jsonb not null,
  reason text,
  calculated_at timestamptz not null default now(),
  check (jsonb_typeof(components) = 'object')
);

create table public.support_diagnostic_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  ticket_id uuid references public.support_tickets(id) on delete set null,
  overall_status text not null check (overall_status in ('healthy', 'attention', 'degraded', 'critical', 'unknown')),
  summary jsonb not null,
  generated_by uuid references public.platform_users(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(summary) = 'object')
);

create index support_tickets_queue_idx on public.support_tickets(status, priority, created_at desc);
create index support_tickets_org_idx on public.support_tickets(organization_id, created_at desc);
create index support_tickets_sla_idx on public.support_tickets(first_response_due_at, resolution_due_at)
where status not in ('resolved', 'closed', 'cancelled');
create index support_messages_ticket_idx on public.support_ticket_messages(ticket_id, created_at);
create index support_events_ticket_idx on public.support_ticket_events(ticket_id, occurred_at);
create index support_tasks_assignee_idx on public.support_tasks(assigned_to, status, due_at);
create index onboarding_steps_plan_idx on public.onboarding_steps(onboarding_plan_id, display_order);
create index customer_interactions_org_idx on public.customer_interactions(organization_id, occurred_at desc);
create index customer_health_history_org_idx on public.customer_health_history(organization_id, calculated_at desc);
create index support_diagnostics_org_idx on public.support_diagnostic_snapshots(organization_id, created_at desc);

create trigger support_sla_policies_set_updated_at before update on public.support_sla_policies
for each row execute function public.set_updated_at();
create trigger customer_success_profiles_set_updated_at before update on public.customer_success_profiles
for each row execute function public.set_updated_at();
create trigger support_tickets_set_updated_at before update on public.support_tickets
for each row execute function public.set_updated_at();
create trigger support_tasks_set_updated_at before update on public.support_tasks
for each row execute function public.set_updated_at();
create trigger onboarding_plans_set_updated_at before update on public.onboarding_plans
for each row execute function public.set_updated_at();
create trigger onboarding_steps_set_updated_at before update on public.onboarding_steps
for each row execute function public.set_updated_at();

create or replace function public.can_manage_support()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'support_admin'::public.global_role
  ]);
$$;

create or replace function public.can_manage_customer_success()
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
    'sales_manager'::public.global_role
  ]);
$$;

revoke all on function public.can_manage_support() from public;
revoke all on function public.can_manage_customer_success() from public;
grant execute on function public.can_manage_support() to authenticated;
grant execute on function public.can_manage_customer_success() to authenticated;

create or replace function public.prevent_support_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Support history is append-only';
end;
$$;

revoke all on function public.prevent_support_history_mutation() from public;

create trigger support_ticket_messages_immutable before update or delete on public.support_ticket_messages
for each row execute function public.prevent_support_history_mutation();
create trigger support_ticket_events_immutable before update or delete on public.support_ticket_events
for each row execute function public.prevent_support_history_mutation();
create trigger customer_interactions_immutable before update or delete on public.customer_interactions
for each row execute function public.prevent_support_history_mutation();
create trigger customer_health_history_immutable before update or delete on public.customer_health_history
for each row execute function public.prevent_support_history_mutation();
create trigger support_diagnostics_immutable before update or delete on public.support_diagnostic_snapshots
for each row execute function public.prevent_support_history_mutation();

create or replace function public.create_support_ticket(
  organization_id_value uuid,
  product_id_value uuid,
  type_value public.support_ticket_type,
  priority_value public.support_ticket_priority,
  channel_value public.support_channel,
  subject_value text,
  description_value text,
  requester_name_value text default null,
  requester_email_value text default null,
  requester_phone_value text default null,
  source_reference_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket_id_value uuid;
  policy_record public.support_sla_policies%rowtype;
begin
  if not public.can_manage_support() then
    raise exception 'Support manager role required';
  end if;
  if not exists (select 1 from public.organizations where id = organization_id_value and archived_at is null) then
    raise exception 'Organization is unavailable';
  end if;
  if product_id_value is not null and not exists (select 1 from public.products where id = product_id_value and archived_at is null) then
    raise exception 'Product is unavailable';
  end if;
  if char_length(btrim(subject_value)) < 3 then raise exception 'Subject is too short'; end if;
  if char_length(btrim(description_value)) < 5 then raise exception 'Description is too short'; end if;

  select * into policy_record
  from public.support_sla_policies
  where priority = priority_value and is_active and is_default
  order by created_at
  limit 1;

  insert into public.support_tickets (
    organization_id, product_id, type, priority, status, channel,
    subject, description, requester_name, requester_email, requester_phone,
    assigned_to, created_by, sla_policy_id, first_response_due_at,
    resolution_due_at, source_reference
  ) values (
    organization_id_value, product_id_value, type_value, priority_value, 'new', channel_value,
    btrim(subject_value), btrim(description_value), nullif(btrim(requester_name_value), ''),
    nullif(lower(btrim(requester_email_value)), ''), nullif(btrim(requester_phone_value), ''),
    null, auth.uid(), policy_record.id,
    case when policy_record.id is null then null else now() + make_interval(mins => policy_record.first_response_minutes) end,
    case when policy_record.id is null then null else now() + make_interval(mins => policy_record.resolution_minutes) end,
    nullif(btrim(source_reference_value), '')
  ) returning id into ticket_id_value;

  insert into public.support_ticket_events(ticket_id, event_type, actor_user_id, to_status, note)
  values (ticket_id_value, 'ticket.created', auth.uid(), 'new', 'Support ticket created');

  perform public.write_audit_event(
    'support.ticket.created', 'support_ticket', ticket_id_value::text, organization_id_value,
    'Support ticket created', null,
    jsonb_build_object('priority', priority_value, 'type', type_value, 'productId', product_id_value)
  );
  return ticket_id_value;
end;
$$;

create or replace function public.assign_support_ticket(
  ticket_id_value uuid,
  assigned_to_value uuid,
  note_value text default 'Ticket assigned'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket_record public.support_tickets%rowtype;
begin
  if not public.can_manage_support() then raise exception 'Support manager role required'; end if;
  if not exists (select 1 from public.platform_users where id = assigned_to_value and is_active) then
    raise exception 'Active platform user not found';
  end if;
  select * into ticket_record from public.support_tickets where id = ticket_id_value for update;
  if not found then raise exception 'Ticket not found'; end if;
  if ticket_record.status in ('resolved','closed','cancelled') then raise exception 'Closed ticket cannot be assigned'; end if;

  update public.support_tickets
  set assigned_to = assigned_to_value,
      status = case when status = 'new' then 'open' else status end
  where id = ticket_id_value;

  insert into public.support_ticket_events(ticket_id, event_type, actor_user_id, from_status, to_status, note, payload)
  values (
    ticket_id_value, 'ticket.assigned', auth.uid(), ticket_record.status,
    case when ticket_record.status = 'new' then 'open' else ticket_record.status end,
    nullif(btrim(note_value), ''), jsonb_build_object('assignedTo', assigned_to_value)
  );

  perform public.write_audit_event(
    'support.ticket.assigned', 'support_ticket', ticket_id_value::text, ticket_record.organization_id,
    note_value, jsonb_build_object('assignedTo', ticket_record.assigned_to),
    jsonb_build_object('assignedTo', assigned_to_value)
  );
end;
$$;

create or replace function public.add_support_ticket_message(
  ticket_id_value uuid,
  body_value text,
  is_internal_value boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  message_id_value uuid;
  ticket_record public.support_tickets%rowtype;
begin
  if not public.can_manage_support() then raise exception 'Support manager role required'; end if;
  if char_length(btrim(body_value)) < 1 then raise exception 'Message body is required'; end if;
  select * into ticket_record from public.support_tickets where id = ticket_id_value for update;
  if not found then raise exception 'Ticket not found'; end if;
  if ticket_record.status in ('closed','cancelled') then raise exception 'Closed ticket does not accept messages'; end if;

  insert into public.support_ticket_messages(ticket_id, author_type, author_user_id, body, is_internal)
  values (ticket_id_value, 'staff', auth.uid(), btrim(body_value), is_internal_value)
  returning id into message_id_value;

  if not is_internal_value then
    update public.support_tickets
    set first_response_at = coalesce(first_response_at, now()),
        status = case when status in ('new','open','in_progress','waiting_internal') then 'waiting_customer' else status end
    where id = ticket_id_value;
  end if;

  insert into public.support_ticket_events(ticket_id, event_type, actor_user_id, note, payload)
  values (
    ticket_id_value,
    case when is_internal_value then 'message.internal_added' else 'message.customer_reply_added' end,
    auth.uid(), null, jsonb_build_object('messageId', message_id_value)
  );
  return message_id_value;
end;
$$;

create or replace function public.transition_support_ticket(
  ticket_id_value uuid,
  status_value public.support_ticket_status,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket_record public.support_tickets%rowtype;
  transition_allowed boolean := false;
begin
  if not public.can_manage_support() then raise exception 'Support manager role required'; end if;
  if char_length(btrim(reason_value)) < 3 then raise exception 'Transition reason is required'; end if;
  select * into ticket_record from public.support_tickets where id = ticket_id_value for update;
  if not found then raise exception 'Ticket not found'; end if;

  transition_allowed := case ticket_record.status
    when 'new' then status_value in ('open','in_progress','cancelled')
    when 'open' then status_value in ('in_progress','waiting_customer','waiting_internal','resolved','cancelled')
    when 'in_progress' then status_value in ('waiting_customer','waiting_internal','resolved','cancelled')
    when 'waiting_customer' then status_value in ('in_progress','resolved','cancelled')
    when 'waiting_internal' then status_value in ('in_progress','waiting_customer','resolved','cancelled')
    when 'resolved' then status_value in ('open','closed')
    else false
  end;
  if not transition_allowed then raise exception 'Ticket status transition is not allowed'; end if;

  update public.support_tickets
  set status = status_value,
      resolved_at = case when status_value = 'resolved' then now() when ticket_record.status = 'resolved' and status_value = 'open' then null else resolved_at end,
      closed_at = case when status_value = 'closed' then now() else closed_at end,
      cancelled_at = case when status_value = 'cancelled' then now() else cancelled_at end
  where id = ticket_id_value;

  insert into public.support_ticket_events(ticket_id, event_type, actor_user_id, from_status, to_status, note)
  values (ticket_id_value, 'ticket.status_changed', auth.uid(), ticket_record.status, status_value, btrim(reason_value));

  perform public.write_audit_event(
    'support.ticket.status_changed', 'support_ticket', ticket_id_value::text, ticket_record.organization_id,
    reason_value, jsonb_build_object('status', ticket_record.status), jsonb_build_object('status', status_value)
  );
end;
$$;

create or replace function public.create_onboarding_plan(
  organization_id_value uuid,
  owner_user_id_value uuid default null,
  target_go_live_at_value date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_id_value uuid;
begin
  if not public.can_manage_customer_success() then raise exception 'Customer Success manager role required'; end if;
  if not exists (select 1 from public.organizations where id = organization_id_value and archived_at is null) then
    raise exception 'Organization is unavailable';
  end if;
  if owner_user_id_value is not null and not exists (select 1 from public.platform_users where id = owner_user_id_value and is_active) then
    raise exception 'Active owner user not found';
  end if;

  insert into public.onboarding_plans(organization_id, owner_user_id, target_go_live_at)
  values (organization_id_value, owner_user_id_value, target_go_live_at_value)
  on conflict (organization_id) do update
    set owner_user_id = coalesce(excluded.owner_user_id, onboarding_plans.owner_user_id),
        target_go_live_at = coalesce(excluded.target_go_live_at, onboarding_plans.target_go_live_at)
  returning id into plan_id_value;

  insert into public.onboarding_steps(onboarding_plan_id, step_key, title, display_order)
  values
    (plan_id_value, 'kickoff', 'Kickoff и фиксация целей', 10),
    (plan_id_value, 'company_structure', 'Настройка компании и филиалов', 20),
    (plan_id_value, 'users_roles', 'Пользователи и роли', 30),
    (plan_id_value, 'data_migration', 'Импорт и проверка данных', 40),
    (plan_id_value, 'integrations', 'Подключение интеграций', 50),
    (plan_id_value, 'training', 'Обучение команды клиента', 60),
    (plan_id_value, 'pilot', 'Пилотная эксплуатация', 70),
    (plan_id_value, 'go_live', 'Переход в production', 80),
    (plan_id_value, 'hypercare', 'Период hypercare', 90)
  on conflict (onboarding_plan_id, step_key) do nothing;

  insert into public.customer_success_profiles(organization_id, owner_user_id, lifecycle_stage, onboarding_score)
  values (organization_id_value, owner_user_id_value, 'onboarding', 0)
  on conflict (organization_id) do update
    set owner_user_id = coalesce(excluded.owner_user_id, customer_success_profiles.owner_user_id),
        lifecycle_stage = case when customer_success_profiles.lifecycle_stage = 'lead' then 'onboarding' else customer_success_profiles.lifecycle_stage end;

  perform public.write_audit_event(
    'customer_success.onboarding.created', 'onboarding_plan', plan_id_value::text, organization_id_value,
    'Onboarding plan created', null, jsonb_build_object('targetGoLiveAt', target_go_live_at_value)
  );
  return plan_id_value;
end;
$$;

create or replace function public.update_onboarding_step(
  onboarding_step_id_value uuid,
  status_value public.onboarding_step_status,
  note_value text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  step_record public.onboarding_steps%rowtype;
  plan_record public.onboarding_plans%rowtype;
  completed_count integer;
  total_count integer;
  progress_value integer;
begin
  if not public.can_manage_customer_success() then raise exception 'Customer Success manager role required'; end if;
  select * into step_record from public.onboarding_steps where id = onboarding_step_id_value for update;
  if not found then raise exception 'Onboarding step not found'; end if;
  select * into plan_record from public.onboarding_plans where id = step_record.onboarding_plan_id for update;

  update public.onboarding_steps
  set status = status_value,
      completed_at = case when status_value in ('completed','skipped') then now() else null end,
      completion_note = nullif(btrim(note_value), '')
  where id = onboarding_step_id_value;

  select count(*), count(*) filter (where status in ('completed','skipped'))
  into total_count, completed_count
  from public.onboarding_steps where onboarding_plan_id = step_record.onboarding_plan_id;
  progress_value := case when total_count = 0 then 0 else round(completed_count * 100.0 / total_count)::integer end;

  update public.onboarding_plans
  set progress_percent = progress_value,
      stage = case when progress_value = 100 then 'completed' else stage end,
      completed_at = case when progress_value = 100 then coalesce(completed_at, now()) else null end,
      actual_go_live_at = case when step_record.step_key = 'go_live' and status_value = 'completed' then current_date else actual_go_live_at end
  where id = step_record.onboarding_plan_id;

  update public.customer_success_profiles
  set onboarding_score = progress_value,
      lifecycle_stage = case when progress_value = 100 then 'active' else lifecycle_stage end
  where organization_id = plan_record.organization_id;

  perform public.write_audit_event(
    'customer_success.onboarding_step.updated', 'onboarding_step', onboarding_step_id_value::text,
    plan_record.organization_id, coalesce(note_value, 'Onboarding step updated'),
    jsonb_build_object('status', step_record.status), jsonb_build_object('status', status_value, 'progress', progress_value)
  );
end;
$$;

create or replace function public.log_customer_interaction(
  organization_id_value uuid,
  interaction_type_value public.customer_interaction_type,
  channel_value public.support_channel,
  summary_value text,
  next_action_value text default null,
  next_action_at_value timestamptz default null,
  ticket_id_value uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  interaction_id_value uuid;
begin
  if not public.can_manage_customer_success() then raise exception 'Customer Success manager role required'; end if;
  if char_length(btrim(summary_value)) < 3 then raise exception 'Interaction summary is required'; end if;
  insert into public.customer_interactions(
    organization_id, ticket_id, interaction_type, channel, summary,
    next_action, next_action_at, actor_user_id
  ) values (
    organization_id_value, ticket_id_value, interaction_type_value, channel_value,
    btrim(summary_value), nullif(btrim(next_action_value), ''), next_action_at_value, auth.uid()
  ) returning id into interaction_id_value;

  update public.customer_success_profiles
  set last_contact_at = now(), next_contact_at = next_action_at_value
  where organization_id = organization_id_value;
  return interaction_id_value;
end;
$$;

create or replace function public.refresh_support_sla()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  first_response_breaches integer := 0;
  resolution_breaches integer := 0;
begin
  if auth.role() <> 'service_role' and not public.can_manage_support() then
    raise exception 'Service role or support manager role required';
  end if;

  update public.support_tickets
  set first_response_breached = true
  where status not in ('resolved','closed','cancelled')
    and first_response_at is null
    and first_response_due_at is not null
    and first_response_due_at < now()
    and not first_response_breached;
  get diagnostics first_response_breaches = row_count;

  update public.support_tickets
  set resolution_breached = true
  where status not in ('resolved','closed','cancelled')
    and resolution_due_at is not null
    and resolution_due_at < now()
    and not resolution_breached;
  get diagnostics resolution_breaches = row_count;

  insert into public.support_tasks(organization_id, ticket_id, title, description, priority, due_at, created_by, metadata)
  select t.organization_id, t.id, 'SLA breach: ' || t.ticket_number,
         'Review breached support ticket and define recovery action.',
         case when t.priority in ('critical','urgent') then t.priority else 'high'::public.support_ticket_priority end,
         now() + interval '1 hour', auth.uid(), jsonb_build_object('source', 'sla_monitor')
  from public.support_tickets t
  where (t.first_response_breached or t.resolution_breached)
    and t.status not in ('resolved','closed','cancelled')
    and not exists (
      select 1 from public.support_tasks task
      where task.ticket_id = t.id and task.status in ('open','in_progress','blocked')
        and task.metadata ->> 'source' = 'sla_monitor'
    );

  return jsonb_build_object(
    'firstResponseBreaches', first_response_breaches,
    'resolutionBreaches', resolution_breaches
  );
end;
$$;

create or replace function public.refresh_customer_health_scores()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
  organization_record record;
  open_critical integer;
  open_high integer;
  sla_breaches integer;
  onboarding_value integer;
  support_value integer;
  billing_value integer;
  reliability_value integer;
  adoption_value integer;
  total_score integer;
  risk_value public.customer_risk_level;
begin
  if auth.role() <> 'service_role' and not public.can_manage_customer_success() then
    raise exception 'Service role or Customer Success manager role required';
  end if;

  for organization_record in
    select id, customer_health, status::text as organization_status
    from public.organizations where archived_at is null
  loop
    select
      count(*) filter (where status not in ('resolved','closed','cancelled') and priority in ('critical','urgent')),
      count(*) filter (where status not in ('resolved','closed','cancelled') and priority = 'high'),
      count(*) filter (where status not in ('resolved','closed','cancelled') and (first_response_breached or resolution_breached))
    into open_critical, open_high, sla_breaches
    from public.support_tickets where organization_id = organization_record.id;

    select coalesce(progress_percent, 100) into onboarding_value
    from public.onboarding_plans where organization_id = organization_record.id;
    onboarding_value := coalesce(onboarding_value, 100);

    support_value := greatest(0, 100 - open_critical * 20 - open_high * 8 - sla_breaches * 12);
    billing_value := case when organization_record.organization_status in ('suspended') then 20 else 100 end;
    reliability_value := 100;
    adoption_value := greatest(0, least(100, coalesce(organization_record.customer_health, 70)));
    total_score := round(adoption_value * 0.30 + support_value * 0.25 + billing_value * 0.20 + reliability_value * 0.10 + onboarding_value * 0.15);
    risk_value := case
      when total_score >= 80 then 'healthy'::public.customer_risk_level
      when total_score >= 60 then 'attention'::public.customer_risk_level
      when total_score >= 40 then 'at_risk'::public.customer_risk_level
      else 'critical'::public.customer_risk_level
    end;

    insert into public.customer_success_profiles(
      organization_id, health_score, risk_level, adoption_score, support_score,
      billing_score, reliability_score, onboarding_score,
      lifecycle_stage
    ) values (
      organization_record.id, total_score, risk_value, adoption_value, support_value,
      billing_value, reliability_value, onboarding_value,
      case when organization_record.organization_status = 'active' then 'active'::public.customer_lifecycle_stage else 'onboarding'::public.customer_lifecycle_stage end
    )
    on conflict (organization_id) do update
      set health_score = excluded.health_score,
          risk_level = excluded.risk_level,
          adoption_score = excluded.adoption_score,
          support_score = excluded.support_score,
          billing_score = excluded.billing_score,
          reliability_score = excluded.reliability_score,
          onboarding_score = excluded.onboarding_score;

    update public.organizations set customer_health = total_score where id = organization_record.id;

    insert into public.customer_health_history(organization_id, health_score, risk_level, components, reason)
    values (
      organization_record.id, total_score, risk_value,
      jsonb_build_object(
        'adoption', adoption_value,
        'support', support_value,
        'billing', billing_value,
        'reliability', reliability_value,
        'onboarding', onboarding_value,
        'openCritical', open_critical,
        'openHigh', open_high,
        'slaBreaches', sla_breaches
      ),
      'Scheduled customer health calculation'
    );
    updated_count := updated_count + 1;
  end loop;
  return updated_count;
end;
$$;

create or replace function public.generate_support_diagnostic_snapshot(
  organization_id_value uuid,
  product_id_value uuid default null,
  ticket_id_value uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_id_value uuid;
  active_license_count integer;
  failed_license_count integer;
  monitored_service_count integer;
  degraded_service_count integer;
  open_incident_count integer;
  integration_error_count integer;
  overall_status_value text;
  summary_value jsonb;
begin
  if not public.can_manage_support() then raise exception 'Support manager role required'; end if;
  if not exists (select 1 from public.organizations where id = organization_id_value and archived_at is null) then
    raise exception 'Organization is unavailable';
  end if;

  select
    count(*) filter (where status in ('active','pending','provisioning')),
    count(*) filter (where status = 'failed')
  into active_license_count, failed_license_count
  from public.licenses
  where organization_id = organization_id_value
    and (product_id_value is null or product_id = product_id_value);

  select
    count(*),
    count(*) filter (where status in ('degraded','down'))
  into monitored_service_count, degraded_service_count
  from public.observability_services
  where archived_at is null
    and (product_id_value is null or product_id = product_id_value);

  select count(*) into open_incident_count
  from public.observability_incidents incident
  join public.observability_services service on service.id = incident.service_id
  where incident.status = 'open'
    and (product_id_value is null or service.product_id = product_id_value);

  select count(*) into integration_error_count
  from public.integration_connections
  where organization_id = organization_id_value
    and status in ('degraded','error','suspended')
    and (product_id_value is null or product_id = product_id_value);

  overall_status_value := case
    when failed_license_count > 0 or open_incident_count > 0 then 'critical'
    when degraded_service_count > 0 or integration_error_count > 0 then 'degraded'
    when active_license_count = 0 then 'attention'
    else 'healthy'
  end;

  summary_value := jsonb_build_object(
    'generatedAt', now(),
    'organizationId', organization_id_value,
    'productId', product_id_value,
    'licenses', jsonb_build_object('active', active_license_count, 'failed', failed_license_count),
    'observability', jsonb_build_object('services', monitored_service_count, 'degraded', degraded_service_count, 'openIncidents', open_incident_count),
    'integrations', jsonb_build_object('errors', integration_error_count),
    'dataBoundary', 'Control-plane metadata only; no patient or product-domain records included'
  );

  insert into public.support_diagnostic_snapshots(
    organization_id, product_id, ticket_id, overall_status, summary, generated_by
  ) values (
    organization_id_value, product_id_value, ticket_id_value, overall_status_value, summary_value, auth.uid()
  ) returning id into snapshot_id_value;

  perform public.write_audit_event(
    'support.diagnostic.generated', 'support_diagnostic_snapshot', snapshot_id_value::text,
    organization_id_value, 'Support diagnostic generated', null,
    jsonb_build_object('overallStatus', overall_status_value, 'productId', product_id_value)
  );
  return snapshot_id_value;
end;
$$;

revoke all on function public.create_support_ticket(uuid, uuid, public.support_ticket_type, public.support_ticket_priority, public.support_channel, text, text, text, text, text, text) from public;
revoke all on function public.assign_support_ticket(uuid, uuid, text) from public;
revoke all on function public.add_support_ticket_message(uuid, text, boolean) from public;
revoke all on function public.transition_support_ticket(uuid, public.support_ticket_status, text) from public;
revoke all on function public.create_onboarding_plan(uuid, uuid, date) from public;
revoke all on function public.update_onboarding_step(uuid, public.onboarding_step_status, text) from public;
revoke all on function public.log_customer_interaction(uuid, public.customer_interaction_type, public.support_channel, text, text, timestamptz, uuid) from public;
revoke all on function public.refresh_support_sla() from public;
revoke all on function public.refresh_customer_health_scores() from public;
revoke all on function public.generate_support_diagnostic_snapshot(uuid, uuid, uuid) from public;

grant execute on function public.create_support_ticket(uuid, uuid, public.support_ticket_type, public.support_ticket_priority, public.support_channel, text, text, text, text, text, text) to authenticated;
grant execute on function public.assign_support_ticket(uuid, uuid, text) to authenticated;
grant execute on function public.add_support_ticket_message(uuid, text, boolean) to authenticated;
grant execute on function public.transition_support_ticket(uuid, public.support_ticket_status, text) to authenticated;
grant execute on function public.create_onboarding_plan(uuid, uuid, date) to authenticated;
grant execute on function public.update_onboarding_step(uuid, public.onboarding_step_status, text) to authenticated;
grant execute on function public.log_customer_interaction(uuid, public.customer_interaction_type, public.support_channel, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.refresh_support_sla() to authenticated, service_role;
grant execute on function public.refresh_customer_health_scores() to authenticated, service_role;
grant execute on function public.generate_support_diagnostic_snapshot(uuid, uuid, uuid) to authenticated;

alter table public.support_sla_policies enable row level security;
alter table public.customer_success_profiles enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.support_tasks enable row level security;
alter table public.onboarding_plans enable row level security;
alter table public.onboarding_steps enable row level security;
alter table public.customer_interactions enable row level security;
alter table public.customer_health_history enable row level security;
alter table public.support_diagnostic_snapshots enable row level security;

create policy support_sla_staff_select on public.support_sla_policies for select to authenticated using (public.is_platform_staff());
create policy customer_success_profiles_staff_select on public.customer_success_profiles for select to authenticated using (public.is_platform_staff());
create policy support_tickets_staff_select on public.support_tickets for select to authenticated using (public.is_platform_staff());
create policy support_messages_staff_select on public.support_ticket_messages for select to authenticated using (public.is_platform_staff());
create policy support_events_staff_select on public.support_ticket_events for select to authenticated using (public.is_platform_staff());
create policy support_tasks_staff_select on public.support_tasks for select to authenticated using (public.is_platform_staff());
create policy onboarding_plans_staff_select on public.onboarding_plans for select to authenticated using (public.is_platform_staff());
create policy onboarding_steps_staff_select on public.onboarding_steps for select to authenticated using (public.is_platform_staff());
create policy customer_interactions_staff_select on public.customer_interactions for select to authenticated using (public.is_platform_staff());
create policy customer_health_history_staff_select on public.customer_health_history for select to authenticated using (public.is_platform_staff());
create policy support_diagnostics_staff_select on public.support_diagnostic_snapshots for select to authenticated using (public.is_platform_staff());

revoke insert, update, delete on public.support_sla_policies from authenticated;
revoke insert, update, delete on public.customer_success_profiles from authenticated;
revoke insert, update, delete on public.support_tickets from authenticated;
revoke insert, update, delete on public.support_ticket_messages from authenticated;
revoke insert, update, delete on public.support_ticket_events from authenticated;
revoke insert, update, delete on public.support_tasks from authenticated;
revoke insert, update, delete on public.onboarding_plans from authenticated;
revoke insert, update, delete on public.onboarding_steps from authenticated;
revoke insert, update, delete on public.customer_interactions from authenticated;
revoke insert, update, delete on public.customer_health_history from authenticated;
revoke insert, update, delete on public.support_diagnostic_snapshots from authenticated;

grant select on public.support_sla_policies to authenticated;
grant select on public.customer_success_profiles to authenticated;
grant select on public.support_tickets to authenticated;
grant select on public.support_ticket_messages to authenticated;
grant select on public.support_ticket_events to authenticated;
grant select on public.support_tasks to authenticated;
grant select on public.onboarding_plans to authenticated;
grant select on public.onboarding_steps to authenticated;
grant select on public.customer_interactions to authenticated;
grant select on public.customer_health_history to authenticated;
grant select on public.support_diagnostic_snapshots to authenticated;

grant all on public.support_sla_policies to service_role;
grant all on public.customer_success_profiles to service_role;
grant all on public.support_tickets to service_role;
grant all on public.support_ticket_messages to service_role;
grant all on public.support_ticket_events to service_role;
grant all on public.support_tasks to service_role;
grant all on public.onboarding_plans to service_role;
grant all on public.onboarding_steps to service_role;
grant all on public.customer_interactions to service_role;
grant all on public.customer_health_history to service_role;
grant all on public.support_diagnostic_snapshots to service_role;

insert into public.support_sla_policies(
  key, name, priority, first_response_minutes, resolution_minutes,
  escalation_minutes, business_hours_only, is_default
) values
  ('sla.low', 'Low priority', 'low', 1440, 10080, 2880, true, true),
  ('sla.normal', 'Standard support', 'normal', 480, 2880, 960, true, true),
  ('sla.high', 'High priority', 'high', 120, 960, 240, false, true),
  ('sla.urgent', 'Urgent incident', 'urgent', 30, 240, 60, false, true),
  ('sla.critical', 'Critical outage', 'critical', 10, 120, 20, false, true)
on conflict (key) do update
set name = excluded.name,
    priority = excluded.priority,
    first_response_minutes = excluded.first_response_minutes,
    resolution_minutes = excluded.resolution_minutes,
    escalation_minutes = excluded.escalation_minutes,
    business_hours_only = excluded.business_hours_only,
    is_default = excluded.is_default,
    is_active = true,
    updated_at = now();

comment on table public.support_tickets is 'Central IMDS support queue with SLA deadlines and product/organization scope.';
comment on table public.customer_success_profiles is 'Current customer lifecycle, owner, health score and risk projection.';
comment on table public.onboarding_plans is 'One controlled onboarding plan per organization.';
comment on table public.support_diagnostic_snapshots is 'Sanitized control-plane diagnostics; patient and product-domain data are prohibited.';
