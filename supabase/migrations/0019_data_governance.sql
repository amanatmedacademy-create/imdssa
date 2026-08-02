-- IMDS Data Governance control plane.
-- This schema manages policy, approvals and evidence. Product-domain and patient
-- data remain inside their owning products and are never copied into Super Admin.

create type public.data_sensitivity as enum ('public', 'internal', 'confidential', 'restricted');
create type public.retention_action as enum ('archive', 'anonymize', 'soft_delete', 'hard_delete');
create type public.governance_request_status as enum (
  'draft', 'pending_approval', 'approved', 'queued', 'processing',
  'completed', 'rejected', 'failed', 'cancelled', 'expired'
);
create type public.data_export_format as enum ('json', 'csv', 'ndjson', 'zip');
create type public.backup_type as enum ('full', 'incremental', 'snapshot', 'logical', 'configuration');
create type public.backup_status as enum ('registered', 'running', 'completed', 'verified', 'failed', 'expired', 'deleted');
create type public.restore_status as enum ('requested', 'pending_approval', 'approved', 'queued', 'running', 'completed', 'failed', 'cancelled');
create type public.legal_hold_status as enum ('active', 'release_pending', 'released', 'expired');
create type public.dr_plan_status as enum ('draft', 'active', 'needs_review', 'retired');
create type public.dr_test_status as enum ('planned', 'running', 'passed', 'failed', 'cancelled');
create type public.privacy_request_type as enum ('access', 'export', 'correction', 'deletion', 'restriction', 'objection');
create type public.privacy_request_status as enum ('received', 'verified', 'in_progress', 'fulfilled', 'rejected', 'cancelled');
create type public.governance_job_type as enum (
  'retention_evaluation', 'export', 'deletion', 'backup_verification',
  'restore', 'dr_test', 'privacy_request'
);
create type public.governance_job_status as enum ('queued', 'processing', 'succeeded', 'failed', 'dead_letter', 'cancelled');

create table public.data_classifications (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  sensitivity public.data_sensitivity not null,
  contains_personal_data boolean not null default false,
  contains_health_data boolean not null default false,
  export_requires_approval boolean not null default false,
  deletion_requires_approval boolean not null default true,
  default_retention_days integer check (default_retention_days is null or default_retention_days between 1 and 36500),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.data_retention_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  organization_id uuid references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  classification_id uuid not null references public.data_classifications(id) on delete restrict,
  data_resource text not null,
  retention_days integer not null check (retention_days between 1 and 36500),
  action public.retention_action not null,
  grace_days integer not null default 30 check (grace_days between 0 and 365),
  legal_basis text,
  adapter_command text not null,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  last_evaluated_at timestamptz,
  next_evaluation_at timestamptz,
  created_by uuid references public.platform_users(id) on delete set null,
  updated_by uuid references public.platform_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (data_resource ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (adapter_command ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.legal_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  classification_id uuid references public.data_classifications(id) on delete set null,
  resource_type text,
  resource_reference text,
  status public.legal_hold_status not null default 'active',
  reason text not null,
  authority_reference text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  release_approval_request_id uuid references public.approval_requests(id) on delete set null,
  released_at timestamptz,
  released_by uuid references public.platform_users(id) on delete set null,
  created_by uuid references public.platform_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(reason)) >= 10),
  check (expires_at is null or expires_at > starts_at),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.organization_privacy_controls (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  data_residency_country text not null default 'KZ',
  cross_border_transfer_allowed boolean not null default false,
  analytics_processing_allowed boolean not null default true,
  ai_processing_allowed boolean not null default false,
  product_data_export_allowed boolean not null default true,
  data_processing_agreement_signed_at timestamptz,
  privacy_contact_name text,
  privacy_contact_email text,
  default_retention_days integer not null default 3650 check (default_retention_days between 1 and 36500),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references public.platform_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (data_residency_country ~ '^[A-Z]{2}$'),
  check (privacy_contact_email is null or privacy_contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.data_export_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  classification_id uuid references public.data_classifications(id) on delete set null,
  requested_by uuid references public.platform_users(id) on delete set null,
  status public.governance_request_status not null default 'pending_approval',
  export_format public.data_export_format not null default 'zip',
  reason text not null,
  scope jsonb not null default '{}'::jsonb,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  destination_reference text,
  checksum_sha256 text,
  object_count bigint check (object_count is null or object_count >= 0),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  download_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  error text,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(reason)) >= 10),
  check (jsonb_typeof(scope) = 'object'),
  check (jsonb_typeof(metadata) = 'object'),
  check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$')
);

create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  classification_id uuid references public.data_classifications(id) on delete set null,
  requested_by uuid references public.platform_users(id) on delete set null,
  status public.governance_request_status not null default 'pending_approval',
  deletion_mode public.retention_action not null default 'anonymize',
  reason text not null,
  scope jsonb not null default '{}'::jsonb,
  dry_run_summary jsonb,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  result jsonb,
  error text,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deletion_mode in ('anonymize', 'soft_delete', 'hard_delete')),
  check (char_length(btrim(reason)) >= 10),
  check (jsonb_typeof(scope) = 'object'),
  check (dry_run_summary is null or jsonb_typeof(dry_run_summary) = 'object'),
  check (result is null or jsonb_typeof(result) = 'object'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.backup_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  environment text not null check (environment in ('development', 'staging', 'production')),
  backup_type public.backup_type not null,
  status public.backup_status not null default 'registered',
  provider text not null,
  external_backup_id text,
  storage_reference text not null,
  encrypted boolean not null default true,
  immutable_until timestamptz,
  retention_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  verified_at timestamptz,
  verification_status text check (verification_status is null or verification_status in ('pending', 'passed', 'failed')),
  checksum_sha256 text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  source_snapshot_at timestamptz,
  registered_by uuid references public.platform_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_backup_id),
  check (storage_reference ~ '^(s3|r2|gcs|azure|vault|provider)://'),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  check (retention_until is null or retention_until > created_at),
  check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.restore_operations (
  id uuid primary key default gen_random_uuid(),
  backup_id uuid not null references public.backup_assets(id) on delete restrict,
  target_environment text not null check (target_environment in ('development', 'staging', 'production')),
  target_reference text,
  requested_by uuid references public.platform_users(id) on delete set null,
  status public.restore_status not null default 'requested',
  reason text not null,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  dry_run boolean not null default true,
  validation_result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(reason)) >= 10),
  check (validation_result is null or jsonb_typeof(validation_result) = 'object'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.disaster_recovery_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  environment text not null check (environment in ('staging', 'production')),
  name text not null,
  status public.dr_plan_status not null default 'draft',
  owner_user_id uuid references public.platform_users(id) on delete set null,
  rpo_minutes integer not null check (rpo_minutes between 0 and 10080),
  rto_minutes integer not null check (rto_minutes between 1 and 43200),
  runbook_reference text not null,
  communication_plan_reference text,
  dependency_map jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  next_test_at timestamptz,
  last_test_status public.dr_test_status,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, environment),
  check (runbook_reference ~ '^(https://|github://|drive://|internal://)'),
  check (jsonb_typeof(dependency_map) = 'object'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.disaster_recovery_tests (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.disaster_recovery_plans(id) on delete cascade,
  status public.dr_test_status not null default 'planned',
  scenario text not null,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  achieved_rpo_minutes integer check (achieved_rpo_minutes is null or achieved_rpo_minutes >= 0),
  achieved_rto_minutes integer check (achieved_rto_minutes is null or achieved_rto_minutes >= 0),
  evidence_reference text,
  findings jsonb not null default '[]'::jsonb,
  corrective_actions jsonb not null default '[]'::jsonb,
  executed_by uuid references public.platform_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(scenario)) >= 5),
  check (jsonb_typeof(findings) = 'array'),
  check (jsonb_typeof(corrective_actions) = 'array')
);

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  request_type public.privacy_request_type not null,
  status public.privacy_request_status not null default 'received',
  subject_reference_hash text not null,
  verification_reference text,
  received_channel text not null default 'support' check (received_channel in ('support', 'email', 'portal', 'legal', 'internal')),
  due_at timestamptz not null,
  assigned_to uuid references public.platform_users(id) on delete set null,
  resolution_summary text,
  fulfilled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subject_reference_hash ~ '^[a-f0-9]{64}$'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.governance_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type public.governance_job_type not null,
  status public.governance_job_status not null default 'queued',
  organization_id uuid references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  retention_policy_id uuid references public.data_retention_policies(id) on delete cascade,
  export_request_id uuid references public.data_export_requests(id) on delete cascade,
  deletion_request_id uuid references public.data_deletion_requests(id) on delete cascade,
  restore_operation_id uuid references public.restore_operations(id) on delete cascade,
  privacy_request_id uuid references public.privacy_requests(id) on delete cascade,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object'),
  check (result is null or jsonb_typeof(result) = 'object')
);

create table public.governance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  event_type text not null,
  resource_type text not null,
  resource_id text,
  actor_user_id uuid references public.platform_users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (event_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (resource_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (jsonb_typeof(payload) = 'object')
);

create index data_retention_scope_idx on public.data_retention_policies(organization_id, product_id, is_active);
create index legal_holds_active_idx on public.legal_holds(organization_id, product_id, status)
where status in ('active', 'release_pending');
create index data_exports_queue_idx on public.data_export_requests(status, created_at desc);
create index data_deletions_queue_idx on public.data_deletion_requests(status, scheduled_for, created_at desc);
create index backup_assets_product_idx on public.backup_assets(product_id, environment, created_at desc);
create index backup_assets_retention_idx on public.backup_assets(retention_until, status);
create index restore_operations_queue_idx on public.restore_operations(status, created_at desc);
create index dr_tests_plan_idx on public.disaster_recovery_tests(plan_id, created_at desc);
create index privacy_requests_due_idx on public.privacy_requests(status, due_at);
create index governance_jobs_queue_idx on public.governance_jobs(status, available_at)
where status in ('queued', 'failed');
create index governance_events_time_idx on public.governance_events(occurred_at desc);

create trigger data_classifications_set_updated_at before update on public.data_classifications
for each row execute function public.set_updated_at();
create trigger data_retention_policies_set_updated_at before update on public.data_retention_policies
for each row execute function public.set_updated_at();
create trigger legal_holds_set_updated_at before update on public.legal_holds
for each row execute function public.set_updated_at();
create trigger organization_privacy_controls_set_updated_at before update on public.organization_privacy_controls
for each row execute function public.set_updated_at();
create trigger data_export_requests_set_updated_at before update on public.data_export_requests
for each row execute function public.set_updated_at();
create trigger data_deletion_requests_set_updated_at before update on public.data_deletion_requests
for each row execute function public.set_updated_at();
create trigger backup_assets_set_updated_at before update on public.backup_assets
for each row execute function public.set_updated_at();
create trigger restore_operations_set_updated_at before update on public.restore_operations
for each row execute function public.set_updated_at();
create trigger dr_plans_set_updated_at before update on public.disaster_recovery_plans
for each row execute function public.set_updated_at();
create trigger dr_tests_set_updated_at before update on public.disaster_recovery_tests
for each row execute function public.set_updated_at();
create trigger privacy_requests_set_updated_at before update on public.privacy_requests
for each row execute function public.set_updated_at();
create trigger governance_jobs_set_updated_at before update on public.governance_jobs
for each row execute function public.set_updated_at();

create or replace function public.can_manage_data_governance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'technical_admin'::public.global_role
  ]);
$$;

create or replace function public.can_review_data_governance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'technical_admin'::public.global_role,
    'auditor'::public.global_role
  ]);
$$;

revoke all on function public.can_manage_data_governance() from public;
revoke all on function public.can_review_data_governance() from public;
grant execute on function public.can_manage_data_governance() to authenticated;
grant execute on function public.can_review_data_governance() to authenticated;

create or replace function public.prevent_governance_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Governance history is append-only';
end;
$$;

revoke all on function public.prevent_governance_history_mutation() from public;
create trigger governance_events_immutable before update or delete on public.governance_events
for each row execute function public.prevent_governance_history_mutation();

create or replace function public.upsert_retention_policy(
  target_policy_id uuid,
  policy_key_value text,
  name_value text,
  description_value text,
  organization_id_value uuid,
  product_id_value uuid,
  classification_id_value uuid,
  data_resource_value text,
  retention_days_value integer,
  action_value public.retention_action,
  grace_days_value integer,
  legal_basis_value text,
  adapter_command_value text,
  is_active_value boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  policy_id_value uuid;
  before_record jsonb;
  normalized_key text := lower(nullif(btrim(policy_key_value), ''));
  normalized_resource text := lower(nullif(btrim(data_resource_value), ''));
  normalized_command text := lower(nullif(btrim(adapter_command_value), ''));
begin
  if not public.can_manage_data_governance() then raise exception 'Data Governance manager role required'; end if;
  if normalized_key is null or normalized_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then raise exception 'Policy key is invalid'; end if;
  if nullif(btrim(name_value), '') is null then raise exception 'Policy name is required'; end if;
  if normalized_resource is null or normalized_resource !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then raise exception 'Data resource is invalid'; end if;
  if normalized_command is null or normalized_command !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then raise exception 'Adapter command is invalid'; end if;
  if retention_days_value < 1 or retention_days_value > 36500 then raise exception 'Retention period is invalid'; end if;
  if grace_days_value < 0 or grace_days_value > 365 then raise exception 'Grace period is invalid'; end if;
  if not exists (select 1 from public.data_classifications where id = classification_id_value and is_active) then raise exception 'Classification is unavailable'; end if;
  if organization_id_value is not null and not exists (select 1 from public.organizations where id = organization_id_value and archived_at is null) then raise exception 'Organization is unavailable'; end if;
  if product_id_value is not null and not exists (select 1 from public.products where id = product_id_value and archived_at is null) then raise exception 'Product is unavailable'; end if;

  if target_policy_id is null then
    insert into public.data_retention_policies(
      key, name, description, organization_id, product_id, classification_id,
      data_resource, retention_days, action, grace_days, legal_basis,
      adapter_command, is_active, created_by, updated_by,
      next_evaluation_at
    ) values (
      normalized_key, btrim(name_value), nullif(btrim(description_value), ''),
      organization_id_value, product_id_value, classification_id_value,
      normalized_resource, retention_days_value, action_value, grace_days_value,
      nullif(btrim(legal_basis_value), ''), normalized_command, is_active_value,
      auth.uid(), auth.uid(), now()
    ) returning id into policy_id_value;
  else
    select to_jsonb(policy) into before_record
    from public.data_retention_policies policy where policy.id = target_policy_id;
    if before_record is null then raise exception 'Retention policy not found'; end if;

    update public.data_retention_policies
    set key = normalized_key,
        name = btrim(name_value),
        description = nullif(btrim(description_value), ''),
        organization_id = organization_id_value,
        product_id = product_id_value,
        classification_id = classification_id_value,
        data_resource = normalized_resource,
        retention_days = retention_days_value,
        action = action_value,
        grace_days = grace_days_value,
        legal_basis = nullif(btrim(legal_basis_value), ''),
        adapter_command = normalized_command,
        is_active = is_active_value,
        version = version + 1,
        updated_by = auth.uid(),
        next_evaluation_at = case when is_active_value then least(coalesce(next_evaluation_at, now()), now()) else null end
    where id = target_policy_id
    returning id into policy_id_value;
  end if;

  insert into public.governance_events(organization_id, product_id, event_type, resource_type, resource_id, actor_user_id, payload)
  values (
    organization_id_value, product_id_value,
    case when target_policy_id is null then 'retention.policy.created' else 'retention.policy.updated' end,
    'retention_policy', policy_id_value::text, auth.uid(),
    jsonb_build_object('retentionDays', retention_days_value, 'action', action_value, 'versionChanged', target_policy_id is not null)
  );

  perform public.write_audit_event(
    case when target_policy_id is null then 'governance.retention_policy.created' else 'governance.retention_policy.updated' end,
    'data_retention_policy', policy_id_value::text, organization_id_value,
    'Data retention policy configuration', before_record,
    (select to_jsonb(policy) from public.data_retention_policies policy where policy.id = policy_id_value)
  );
  return policy_id_value;
end;
$$;

create or replace function public.place_legal_hold(
  organization_id_value uuid,
  product_id_value uuid,
  classification_id_value uuid,
  resource_type_value text,
  resource_reference_value text,
  reason_value text,
  authority_reference_value text default null,
  expires_at_value timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hold_id_value uuid;
begin
  if not public.can_manage_data_governance() then raise exception 'Data Governance manager role required'; end if;
  if char_length(btrim(reason_value)) < 10 then raise exception 'Legal hold reason is too short'; end if;
  if not exists (select 1 from public.organizations where id = organization_id_value and archived_at is null) then raise exception 'Organization is unavailable'; end if;
  if expires_at_value is not null and expires_at_value <= now() then raise exception 'Legal hold expiry must be in the future'; end if;

  insert into public.legal_holds(
    organization_id, product_id, classification_id, resource_type, resource_reference,
    reason, authority_reference, expires_at, created_by
  ) values (
    organization_id_value, product_id_value, classification_id_value,
    nullif(btrim(resource_type_value), ''), nullif(btrim(resource_reference_value), ''),
    btrim(reason_value), nullif(btrim(authority_reference_value), ''), expires_at_value, auth.uid()
  ) returning id into hold_id_value;

  insert into public.governance_events(organization_id, product_id, event_type, resource_type, resource_id, actor_user_id, payload)
  values (organization_id_value, product_id_value, 'legal_hold.placed', 'legal_hold', hold_id_value::text, auth.uid(), jsonb_build_object('reason', reason_value));

  perform public.write_audit_event(
    'governance.legal_hold.placed', 'legal_hold', hold_id_value::text,
    organization_id_value, reason_value, null,
    jsonb_build_object('productId', product_id_value, 'expiresAt', expires_at_value)
  );
  return hold_id_value;
end;
$$;

create or replace function public.request_legal_hold_release(
  hold_id_value uuid,
  reason_value text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hold_record public.legal_holds%rowtype;
  approval_id_value uuid;
begin
  if not public.can_manage_data_governance() then raise exception 'Data Governance manager role required'; end if;
  if char_length(btrim(reason_value)) < 10 then raise exception 'Release reason is too short'; end if;
  select * into hold_record from public.legal_holds where id = hold_id_value for update;
  if not found then raise exception 'Legal hold not found'; end if;
  if hold_record.status <> 'active' then raise exception 'Only active legal holds can be released'; end if;

  approval_id_value := public.request_security_approval(
    'data.legal_hold.release', reason_value, hold_record.organization_id,
    hold_record.product_id, 'legal_hold', hold_id_value::text, 60,
    jsonb_build_object('holdId', hold_id_value, 'authorityReference', hold_record.authority_reference),
    'legal-hold-release:' || hold_id_value::text
  );

  update public.legal_holds
  set status = 'release_pending', release_approval_request_id = approval_id_value
  where id = hold_id_value;
  return approval_id_value;
end;
$$;

create or replace function public.complete_legal_hold_release(
  hold_id_value uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hold_record public.legal_holds%rowtype;
begin
  if not public.can_manage_data_governance() then raise exception 'Data Governance manager role required'; end if;
  select * into hold_record from public.legal_holds where id = hold_id_value for update;
  if not found then raise exception 'Legal hold not found'; end if;
  if hold_record.status <> 'release_pending' then raise exception 'Legal hold is not pending release'; end if;
  if not exists (
    select 1 from public.approval_requests
    where id = hold_record.release_approval_request_id and status = 'approved'
  ) then raise exception 'Approved release request is required'; end if;

  update public.legal_holds
  set status = 'released', released_at = now(), released_by = auth.uid()
  where id = hold_id_value;

  insert into public.governance_events(organization_id, product_id, event_type, resource_type, resource_id, actor_user_id, payload)
  values (hold_record.organization_id, hold_record.product_id, 'legal_hold.released', 'legal_hold', hold_id_value::text, auth.uid(), '{}'::jsonb);

  perform public.write_audit_event(
    'governance.legal_hold.released', 'legal_hold', hold_id_value::text,
    hold_record.organization_id, 'Approved legal hold release',
    jsonb_build_object('status', hold_record.status), jsonb_build_object('status', 'released')
  );
end;
$$;

create or replace function public.request_data_export(
  organization_id_value uuid,
  product_id_value uuid,
  classification_id_value uuid,
  export_format_value public.data_export_format,
  reason_value text,
  scope_value jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  export_id_value uuid;
  approval_id_value uuid;
  classification_record public.data_classifications%rowtype;
begin
  if not public.can_review_data_governance() then raise exception 'Data Governance access required'; end if;
  if char_length(btrim(reason_value)) < 10 then raise exception 'Export reason is too short'; end if;
  if jsonb_typeof(coalesce(scope_value, '{}'::jsonb)) <> 'object' then raise exception 'Export scope must be an object'; end if;
  if not exists (select 1 from public.organizations where id = organization_id_value and archived_at is null) then raise exception 'Organization is unavailable'; end if;
  if exists (
    select 1 from public.organization_privacy_controls
    where organization_id = organization_id_value and not product_data_export_allowed
  ) then raise exception 'Organization privacy policy blocks product data export'; end if;

  select * into classification_record from public.data_classifications where id = classification_id_value and is_active;
  if not found then raise exception 'Classification is unavailable'; end if;

  insert into public.data_export_requests(
    organization_id, product_id, classification_id, requested_by, status,
    export_format, reason, scope
  ) values (
    organization_id_value, product_id_value, classification_id_value, auth.uid(),
    case when classification_record.export_requires_approval then 'pending_approval' else 'approved' end,
    export_format_value, btrim(reason_value), coalesce(scope_value, '{}'::jsonb)
  ) returning id into export_id_value;

  if classification_record.export_requires_approval then
    approval_id_value := public.request_security_approval(
      'data.export.restricted', reason_value, organization_id_value, product_id_value,
      'data_export_request', export_id_value::text, 120,
      jsonb_build_object('exportRequestId', export_id_value, 'classification', classification_record.key, 'format', export_format_value),
      'data-export:' || export_id_value::text
    );
    update public.data_export_requests set approval_request_id = approval_id_value where id = export_id_value;
  else
    insert into public.governance_jobs(
      job_type, organization_id, product_id, export_request_id, idempotency_key, payload
    ) values (
      'export', organization_id_value, product_id_value, export_id_value,
      'export:' || export_id_value::text,
      jsonb_build_object('exportRequestId', export_id_value, 'format', export_format_value, 'scope', scope_value)
    );
    update public.data_export_requests set status = 'queued' where id = export_id_value;
  end if;

  perform public.write_audit_event(
    'governance.data_export.requested', 'data_export_request', export_id_value::text,
    organization_id_value, reason_value, null,
    jsonb_build_object('classification', classification_record.key, 'format', export_format_value)
  );
  return export_id_value;
end;
$$;

create or replace function public.queue_approved_data_export(export_id_value uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  export_record public.data_export_requests%rowtype;
  job_id_value uuid;
begin
  if not public.can_manage_data_governance() then raise exception 'Data Governance manager role required'; end if;
  select * into export_record from public.data_export_requests where id = export_id_value for update;
  if not found then raise exception 'Export request not found'; end if;
  if export_record.status <> 'pending_approval' then raise exception 'Export is not pending approval'; end if;
  if not exists (select 1 from public.approval_requests where id = export_record.approval_request_id and status = 'approved') then
    raise exception 'Approved request is required';
  end if;

  insert into public.governance_jobs(
    job_type, organization_id, product_id, export_request_id, idempotency_key, payload
  ) values (
    'export', export_record.organization_id, export_record.product_id, export_id_value,
    'export:' || export_id_value::text,
    jsonb_build_object('exportRequestId', export_id_value, 'format', export_record.export_format, 'scope', export_record.scope)
  ) on conflict (idempotency_key) do update set available_at = least(governance_jobs.available_at, now())
  returning id into job_id_value;

  update public.data_export_requests set status = 'queued' where id = export_id_value;
  return job_id_value;
end;
$$;

create or replace function public.request_data_deletion(
  organization_id_value uuid,
  product_id_value uuid,
  classification_id_value uuid,
  deletion_mode_value public.retention_action,
  reason_value text,
  scope_value jsonb default '{}'::jsonb,
  dry_run_summary_value jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  deletion_id_value uuid;
  approval_id_value uuid;
begin
  if not public.can_manage_data_governance() then raise exception 'Data Governance manager role required'; end if;
  if deletion_mode_value not in ('anonymize','soft_delete','hard_delete') then raise exception 'Invalid deletion mode'; end if;
  if char_length(btrim(reason_value)) < 10 then raise exception 'Deletion reason is too short'; end if;
  if exists (
    select 1 from public.legal_holds hold
    where hold.organization_id = organization_id_value
      and hold.status in ('active','release_pending')
      and (hold.product_id is null or product_id_value is null or hold.product_id = product_id_value)
      and (hold.classification_id is null or classification_id_value is null or hold.classification_id = classification_id_value)
      and (hold.expires_at is null or hold.expires_at > now())
  ) then raise exception 'Active legal hold blocks data deletion'; end if;

  insert into public.data_deletion_requests(
    organization_id, product_id, classification_id, requested_by, status,
    deletion_mode, reason, scope, dry_run_summary
  ) values (
    organization_id_value, product_id_value, classification_id_value, auth.uid(),
    'pending_approval', deletion_mode_value, btrim(reason_value),
    coalesce(scope_value, '{}'::jsonb), dry_run_summary_value
  ) returning id into deletion_id_value;

  approval_id_value := public.request_security_approval(
    'data.delete.organization', reason_value, organization_id_value, product_id_value,
    'data_deletion_request', deletion_id_value::text, 120,
    jsonb_build_object('deletionRequestId', deletion_id_value, 'mode', deletion_mode_value, 'scope', scope_value),
    'data-deletion:' || deletion_id_value::text
  );
  update public.data_deletion_requests set approval_request_id = approval_id_value where id = deletion_id_value;

  perform public.write_audit_event(
    'governance.data_deletion.requested', 'data_deletion_request', deletion_id_value::text,
    organization_id_value, reason_value, null,
    jsonb_build_object('mode', deletion_mode_value, 'productId', product_id_value)
  );
  return deletion_id_value;
end;
$$;

create or replace function public.queue_approved_data_deletion(
  deletion_id_value uuid,
  scheduled_for_value timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  deletion_record public.data_deletion_requests%rowtype;
  job_id_value uuid;
begin
  if not public.can_manage_data_governance() then raise exception 'Data Governance manager role required'; end if;
  select * into deletion_record from public.data_deletion_requests where id = deletion_id_value for update;
  if not found then raise exception 'Deletion request not found'; end if;
  if deletion_record.status <> 'pending_approval' then raise exception 'Deletion is not pending approval'; end if;
  if not exists (select 1 from public.approval_requests where id = deletion_record.approval_request_id and status = 'approved') then
    raise exception 'Approved deletion request is required';
  end if;
  if exists (
    select 1 from public.legal_holds hold
    where hold.organization_id = deletion_record.organization_id
      and hold.status in ('active','release_pending')
      and (hold.product_id is null or deletion_record.product_id is null or hold.product_id = deletion_record.product_id)
      and (hold.expires_at is null or hold.expires_at > now())
  ) then raise exception 'Active legal hold blocks data deletion'; end if;

  insert into public.governance_jobs(
    job_type, organization_id, product_id, deletion_request_id, idempotency_key, payload, available_at
  ) values (
    'deletion', deletion_record.organization_id, deletion_record.product_id, deletion_id_value,
    'deletion:' || deletion_id_value::text,
    jsonb_build_object('deletionRequestId', deletion_id_value, 'mode', deletion_record.deletion_mode, 'scope', deletion_record.scope),
    greatest(scheduled_for_value, now())
  ) on conflict (idempotency_key) do update set available_at = excluded.available_at
  returning id into job_id_value;

  update public.data_deletion_requests
  set status = 'queued', scheduled_for = greatest(scheduled_for_value, now())
  where id = deletion_id_value;
  return job_id_value;
end;
$$;

create or replace function public.register_backup_asset(
  organization_id_value uuid,
  product_id_value uuid,
  environment_value text,
  backup_type_value public.backup_type,
  provider_value text,
  external_backup_id_value text,
  storage_reference_value text,
  started_at_value timestamptz,
  completed_at_value timestamptz,
  retention_until_value timestamptz,
  immutable_until_value timestamptz,
  size_bytes_value bigint default null,
  checksum_sha256_value text default null,
  metadata_value jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  backup_id_value uuid;
begin
  if auth.role() <> 'service_role' and not public.can_manage_data_governance() then
    raise exception 'Service role or Data Governance manager role required';
  end if;
  if environment_value not in ('development','staging','production') then raise exception 'Invalid backup environment'; end if;
  if storage_reference_value !~ '^(s3|r2|gcs|azure|vault|provider)://' then raise exception 'Invalid storage reference'; end if;
  if completed_at_value is not null and started_at_value is not null and completed_at_value < started_at_value then raise exception 'Backup completion precedes start'; end if;

  insert into public.backup_assets(
    organization_id, product_id, environment, backup_type, status, provider,
    external_backup_id, storage_reference, immutable_until, retention_until,
    started_at, completed_at, checksum_sha256, size_bytes, registered_by, metadata
  ) values (
    organization_id_value, product_id_value, environment_value, backup_type_value,
    case when completed_at_value is null then 'running' else 'completed' end,
    btrim(provider_value), nullif(btrim(external_backup_id_value), ''), btrim(storage_reference_value),
    immutable_until_value, retention_until_value, started_at_value, completed_at_value,
    nullif(lower(btrim(checksum_sha256_value)), ''), size_bytes_value, auth.uid(), coalesce(metadata_value, '{}'::jsonb)
  )
  on conflict (provider, external_backup_id) do update
    set status = excluded.status,
        storage_reference = excluded.storage_reference,
        immutable_until = excluded.immutable_until,
        retention_until = excluded.retention_until,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        checksum_sha256 = excluded.checksum_sha256,
        size_bytes = excluded.size_bytes,
        metadata = excluded.metadata
  returning id into backup_id_value;

  insert into public.governance_events(organization_id, product_id, event_type, resource_type, resource_id, actor_user_id, payload)
  values (organization_id_value, product_id_value, 'backup.registered', 'backup_asset', backup_id_value::text, auth.uid(), jsonb_build_object('environment', environment_value, 'provider', provider_value));
  return backup_id_value;
end;
$$;

create or replace function public.request_restore_operation(
  backup_id_value uuid,
  target_environment_value text,
  target_reference_value text,
  reason_value text,
  dry_run_value boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  backup_record public.backup_assets%rowtype;
  restore_id_value uuid;
  approval_id_value uuid;
begin
  if not public.can_manage_data_governance() then raise exception 'Data Governance manager role required'; end if;
  if char_length(btrim(reason_value)) < 10 then raise exception 'Restore reason is too short'; end if;
  select * into backup_record from public.backup_assets where id = backup_id_value;
  if not found or backup_record.status not in ('completed','verified') then raise exception 'Completed backup is required'; end if;

  insert into public.restore_operations(
    backup_id, target_environment, target_reference, requested_by, status, reason, dry_run
  ) values (
    backup_id_value, target_environment_value, nullif(btrim(target_reference_value), ''),
    auth.uid(), case when target_environment_value = 'production' then 'pending_approval' else 'approved' end,
    btrim(reason_value), dry_run_value
  ) returning id into restore_id_value;

  if target_environment_value = 'production' then
    approval_id_value := public.request_security_approval(
      'backup.restore.production', reason_value, backup_record.organization_id, backup_record.product_id,
      'restore_operation', restore_id_value::text, 120,
      jsonb_build_object('restoreOperationId', restore_id_value, 'backupId', backup_id_value, 'dryRun', dry_run_value),
      'restore:' || restore_id_value::text
    );
    update public.restore_operations set approval_request_id = approval_id_value where id = restore_id_value;
  else
    insert into public.governance_jobs(
      job_type, organization_id, product_id, restore_operation_id, idempotency_key, payload
    ) values (
      'restore', backup_record.organization_id, backup_record.product_id, restore_id_value,
      'restore:' || restore_id_value::text,
      jsonb_build_object('restoreOperationId', restore_id_value, 'backupId', backup_id_value, 'targetEnvironment', target_environment_value, 'dryRun', dry_run_value)
    );
    update public.restore_operations set status = 'queued' where id = restore_id_value;
  end if;

  perform public.write_audit_event(
    'governance.restore.requested', 'restore_operation', restore_id_value::text,
    backup_record.organization_id, reason_value, null,
    jsonb_build_object('backupId', backup_id_value, 'targetEnvironment', target_environment_value, 'dryRun', dry_run_value)
  );
  return restore_id_value;
end;
$$;

create or replace function public.queue_approved_restore(restore_id_value uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  restore_record public.restore_operations%rowtype;
  backup_record public.backup_assets%rowtype;
  job_id_value uuid;
begin
  if not public.can_manage_data_governance() then raise exception 'Data Governance manager role required'; end if;
  select * into restore_record from public.restore_operations where id = restore_id_value for update;
  if not found then raise exception 'Restore operation not found'; end if;
  select * into backup_record from public.backup_assets where id = restore_record.backup_id;
  if restore_record.status <> 'pending_approval' then raise exception 'Restore is not pending approval'; end if;
  if not exists (select 1 from public.approval_requests where id = restore_record.approval_request_id and status = 'approved') then raise exception 'Approved restore request is required'; end if;

  insert into public.governance_jobs(
    job_type, organization_id, product_id, restore_operation_id, idempotency_key, payload
  ) values (
    'restore', backup_record.organization_id, backup_record.product_id, restore_id_value,
    'restore:' || restore_id_value::text,
    jsonb_build_object('restoreOperationId', restore_id_value, 'backupId', restore_record.backup_id, 'targetEnvironment', restore_record.target_environment, 'dryRun', restore_record.dry_run)
  ) on conflict (idempotency_key) do update set available_at = least(governance_jobs.available_at, now())
  returning id into job_id_value;
  update public.restore_operations set status = 'queued' where id = restore_id_value;
  return job_id_value;
end;
$$;

create or replace function public.schedule_retention_evaluations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  scheduled_count integer := 0;
  policy_record record;
  job_key text;
begin
  if auth.role() <> 'service_role' and not public.can_manage_data_governance() then
    raise exception 'Service role or Data Governance manager role required';
  end if;

  for policy_record in
    select policy.*
    from public.data_retention_policies policy
    where policy.is_active
      and coalesce(policy.next_evaluation_at, now()) <= now()
      and not exists (
        select 1 from public.legal_holds hold
        where hold.status in ('active','release_pending')
          and (hold.expires_at is null or hold.expires_at > now())
          and (policy.organization_id is null or hold.organization_id = policy.organization_id)
          and (hold.product_id is null or policy.product_id is null or hold.product_id = policy.product_id)
          and (hold.classification_id is null or hold.classification_id = policy.classification_id)
      )
  loop
    job_key := 'retention:' || policy_record.id::text || ':' || to_char(current_date, 'YYYYMMDD');
    insert into public.governance_jobs(
      job_type, organization_id, product_id, retention_policy_id, idempotency_key, payload
    ) values (
      'retention_evaluation', policy_record.organization_id, policy_record.product_id,
      policy_record.id, job_key,
      jsonb_build_object(
        'policyId', policy_record.id,
        'dataResource', policy_record.data_resource,
        'retentionDays', policy_record.retention_days,
        'graceDays', policy_record.grace_days,
        'action', policy_record.action,
        'adapterCommand', policy_record.adapter_command,
        'policyVersion', policy_record.version
      )
    ) on conflict (idempotency_key) do nothing;
    if found then scheduled_count := scheduled_count + 1; end if;
    update public.data_retention_policies
    set last_evaluated_at = now(), next_evaluation_at = now() + interval '1 day'
    where id = policy_record.id;
  end loop;
  return scheduled_count;
end;
$$;

create or replace function public.claim_governance_jobs(
  worker_id_value text,
  limit_value integer default 10
)
returns setof public.governance_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if nullif(btrim(worker_id_value), '') is null then raise exception 'Worker ID is required'; end if;
  return query
  with claimed as (
    select id from public.governance_jobs
    where status in ('queued','failed')
      and available_at <= now()
      and attempt_count < max_attempts
      and (locked_at is null or locked_at < now() - interval '15 minutes')
    order by available_at, created_at
    for update skip locked
    limit greatest(1, least(limit_value, 100))
  )
  update public.governance_jobs job
  set status = 'processing', locked_at = now(), locked_by = worker_id_value,
      started_at = coalesce(started_at, now()), attempt_count = attempt_count + 1
  from claimed where job.id = claimed.id
  returning job.*;
end;
$$;

create or replace function public.complete_governance_job(
  job_id_value uuid,
  worker_id_value text,
  succeeded_value boolean,
  result_value jsonb default '{}'::jsonb,
  error_value text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_record public.governance_jobs%rowtype;
  retry_delay interval;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  select * into job_record from public.governance_jobs where id = job_id_value for update;
  if not found then raise exception 'Governance job not found'; end if;
  if job_record.status <> 'processing' or job_record.locked_by is distinct from worker_id_value then raise exception 'Worker does not own this job'; end if;

  if succeeded_value then
    update public.governance_jobs
    set status = 'succeeded', result = coalesce(result_value, '{}'::jsonb), completed_at = now(),
        locked_at = null, locked_by = null, last_error = null
    where id = job_id_value;

    if job_record.export_request_id is not null then
      update public.data_export_requests
      set status = 'completed', started_at = coalesce(started_at, job_record.started_at), completed_at = now(),
          destination_reference = result_value ->> 'destinationReference',
          checksum_sha256 = nullif(result_value ->> 'checksumSha256', ''),
          object_count = nullif(result_value ->> 'objectCount', '')::bigint,
          size_bytes = nullif(result_value ->> 'sizeBytes', '')::bigint,
          download_expires_at = nullif(result_value ->> 'downloadExpiresAt', '')::timestamptz
      where id = job_record.export_request_id;
    elsif job_record.deletion_request_id is not null then
      update public.data_deletion_requests
      set status = 'completed', started_at = coalesce(started_at, job_record.started_at), completed_at = now(), result = result_value
      where id = job_record.deletion_request_id;
    elsif job_record.restore_operation_id is not null then
      update public.restore_operations
      set status = 'completed', started_at = coalesce(started_at, job_record.started_at), completed_at = now(), validation_result = result_value
      where id = job_record.restore_operation_id;
    end if;
  else
    retry_delay := make_interval(mins => least(1440, power(2, greatest(job_record.attempt_count, 1))::integer));
    update public.governance_jobs
    set status = case when attempt_count >= max_attempts then 'dead_letter' else 'failed' end,
        available_at = now() + retry_delay,
        last_error = nullif(error_value, ''),
        result = coalesce(result_value, '{}'::jsonb),
        locked_at = null, locked_by = null,
        completed_at = case when attempt_count >= max_attempts then now() else null end
    where id = job_id_value;

    if job_record.export_request_id is not null then
      update public.data_export_requests set status = 'failed', failed_at = now(), error = error_value where id = job_record.export_request_id;
    elsif job_record.deletion_request_id is not null then
      update public.data_deletion_requests set status = 'failed', failed_at = now(), error = error_value where id = job_record.deletion_request_id;
    elsif job_record.restore_operation_id is not null then
      update public.restore_operations set status = 'failed', error = error_value where id = job_record.restore_operation_id;
    end if;
  end if;

  insert into public.governance_events(organization_id, product_id, event_type, resource_type, resource_id, payload, correlation_id)
  values (
    job_record.organization_id, job_record.product_id,
    case when succeeded_value then 'governance_job.succeeded' else 'governance_job.failed' end,
    'governance_job', job_id_value::text,
    jsonb_build_object('jobType', job_record.job_type, 'attemptCount', job_record.attempt_count, 'error', error_value),
    job_record.correlation_id
  );
end;
$$;

create or replace function public.expire_governance_records()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_exports integer := 0;
  expired_holds integer := 0;
  expired_backups integer := 0;
begin
  if auth.role() <> 'service_role' and not public.can_manage_data_governance() then
    raise exception 'Service role or Data Governance manager role required';
  end if;

  update public.data_export_requests
  set status = 'expired'
  where status = 'completed' and download_expires_at is not null and download_expires_at <= now();
  get diagnostics expired_exports = row_count;

  update public.legal_holds
  set status = 'expired'
  where status = 'active' and expires_at is not null and expires_at <= now();
  get diagnostics expired_holds = row_count;

  update public.backup_assets
  set status = 'expired'
  where status in ('completed','verified')
    and retention_until is not null and retention_until <= now()
    and (immutable_until is null or immutable_until <= now());
  get diagnostics expired_backups = row_count;

  return jsonb_build_object('exports', expired_exports, 'legalHolds', expired_holds, 'backups', expired_backups);
end;
$$;

revoke all on function public.upsert_retention_policy(uuid,text,text,text,uuid,uuid,uuid,text,integer,public.retention_action,integer,text,text,boolean) from public;
revoke all on function public.place_legal_hold(uuid,uuid,uuid,text,text,text,text,timestamptz) from public;
revoke all on function public.request_legal_hold_release(uuid,text) from public;
revoke all on function public.complete_legal_hold_release(uuid) from public;
revoke all on function public.request_data_export(uuid,uuid,uuid,public.data_export_format,text,jsonb) from public;
revoke all on function public.queue_approved_data_export(uuid) from public;
revoke all on function public.request_data_deletion(uuid,uuid,uuid,public.retention_action,text,jsonb,jsonb) from public;
revoke all on function public.queue_approved_data_deletion(uuid,timestamptz) from public;
revoke all on function public.register_backup_asset(uuid,uuid,text,public.backup_type,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,bigint,text,jsonb) from public;
revoke all on function public.request_restore_operation(uuid,text,text,text,boolean) from public;
revoke all on function public.queue_approved_restore(uuid) from public;
revoke all on function public.schedule_retention_evaluations() from public;
revoke all on function public.claim_governance_jobs(text,integer) from public;
revoke all on function public.complete_governance_job(uuid,text,boolean,jsonb,text) from public;
revoke all on function public.expire_governance_records() from public;

grant execute on function public.upsert_retention_policy(uuid,text,text,text,uuid,uuid,uuid,text,integer,public.retention_action,integer,text,text,boolean) to authenticated;
grant execute on function public.place_legal_hold(uuid,uuid,uuid,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.request_legal_hold_release(uuid,text) to authenticated;
grant execute on function public.complete_legal_hold_release(uuid) to authenticated;
grant execute on function public.request_data_export(uuid,uuid,uuid,public.data_export_format,text,jsonb) to authenticated;
grant execute on function public.queue_approved_data_export(uuid) to authenticated;
grant execute on function public.request_data_deletion(uuid,uuid,uuid,public.retention_action,text,jsonb,jsonb) to authenticated;
grant execute on function public.queue_approved_data_deletion(uuid,timestamptz) to authenticated;
grant execute on function public.register_backup_asset(uuid,uuid,text,public.backup_type,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,bigint,text,jsonb) to authenticated, service_role;
grant execute on function public.request_restore_operation(uuid,text,text,text,boolean) to authenticated;
grant execute on function public.queue_approved_restore(uuid) to authenticated;
grant execute on function public.schedule_retention_evaluations() to authenticated, service_role;
grant execute on function public.claim_governance_jobs(text,integer) to service_role;
grant execute on function public.complete_governance_job(uuid,text,boolean,jsonb,text) to service_role;
grant execute on function public.expire_governance_records() to authenticated, service_role;

alter table public.data_classifications enable row level security;
alter table public.data_retention_policies enable row level security;
alter table public.legal_holds enable row level security;
alter table public.organization_privacy_controls enable row level security;
alter table public.data_export_requests enable row level security;
alter table public.data_deletion_requests enable row level security;
alter table public.backup_assets enable row level security;
alter table public.restore_operations enable row level security;
alter table public.disaster_recovery_plans enable row level security;
alter table public.disaster_recovery_tests enable row level security;
alter table public.privacy_requests enable row level security;
alter table public.governance_jobs enable row level security;
alter table public.governance_events enable row level security;

create policy data_classifications_staff_select on public.data_classifications for select to authenticated using (public.is_platform_staff());
create policy retention_policies_staff_select on public.data_retention_policies for select to authenticated using (public.is_platform_staff());
create policy legal_holds_staff_select on public.legal_holds for select to authenticated using (public.is_platform_staff());
create policy privacy_controls_staff_select on public.organization_privacy_controls for select to authenticated using (public.is_platform_staff());
create policy data_exports_staff_select on public.data_export_requests for select to authenticated using (public.is_platform_staff());
create policy data_deletions_staff_select on public.data_deletion_requests for select to authenticated using (public.is_platform_staff());
create policy backup_assets_staff_select on public.backup_assets for select to authenticated using (public.is_platform_staff());
create policy restore_operations_staff_select on public.restore_operations for select to authenticated using (public.is_platform_staff());
create policy dr_plans_staff_select on public.disaster_recovery_plans for select to authenticated using (public.is_platform_staff());
create policy dr_tests_staff_select on public.disaster_recovery_tests for select to authenticated using (public.is_platform_staff());
create policy privacy_requests_staff_select on public.privacy_requests for select to authenticated using (public.is_platform_staff());
create policy governance_jobs_staff_select on public.governance_jobs for select to authenticated using (public.is_platform_staff());
create policy governance_events_staff_select on public.governance_events for select to authenticated using (public.is_platform_staff());

revoke insert,update,delete on public.data_classifications from authenticated;
revoke insert,update,delete on public.data_retention_policies from authenticated;
revoke insert,update,delete on public.legal_holds from authenticated;
revoke insert,update,delete on public.organization_privacy_controls from authenticated;
revoke insert,update,delete on public.data_export_requests from authenticated;
revoke insert,update,delete on public.data_deletion_requests from authenticated;
revoke insert,update,delete on public.backup_assets from authenticated;
revoke insert,update,delete on public.restore_operations from authenticated;
revoke insert,update,delete on public.disaster_recovery_plans from authenticated;
revoke insert,update,delete on public.disaster_recovery_tests from authenticated;
revoke insert,update,delete on public.privacy_requests from authenticated;
revoke insert,update,delete on public.governance_jobs from authenticated;
revoke insert,update,delete on public.governance_events from authenticated;

grant select on public.data_classifications to authenticated;
grant select on public.data_retention_policies to authenticated;
grant select on public.legal_holds to authenticated;
grant select on public.organization_privacy_controls to authenticated;
grant select on public.data_export_requests to authenticated;
grant select on public.data_deletion_requests to authenticated;
grant select on public.backup_assets to authenticated;
grant select on public.restore_operations to authenticated;
grant select on public.disaster_recovery_plans to authenticated;
grant select on public.disaster_recovery_tests to authenticated;
grant select on public.privacy_requests to authenticated;
grant select on public.governance_jobs to authenticated;
grant select on public.governance_events to authenticated;

grant all on public.data_classifications to service_role;
grant all on public.data_retention_policies to service_role;
grant all on public.legal_holds to service_role;
grant all on public.organization_privacy_controls to service_role;
grant all on public.data_export_requests to service_role;
grant all on public.data_deletion_requests to service_role;
grant all on public.backup_assets to service_role;
grant all on public.restore_operations to service_role;
grant all on public.disaster_recovery_plans to service_role;
grant all on public.disaster_recovery_tests to service_role;
grant all on public.privacy_requests to service_role;
grant all on public.governance_jobs to service_role;
grant all on public.governance_events to service_role;

insert into public.data_classifications(
  key,name,description,sensitivity,contains_personal_data,contains_health_data,
  export_requires_approval,deletion_requires_approval,default_retention_days
) values
  ('platform.configuration','Platform configuration','Control-plane configuration without product-domain records.','internal',false,false,false,true,3650),
  ('platform.audit','Platform audit','Immutable audit, approval and privileged-access evidence.','restricted',true,false,true,true,3650),
  ('customer.commercial','Customer commercial records','Contracts, invoices, payments and subscription evidence.','confidential',true,false,true,true,3650),
  ('customer.support','Customer support records','Tickets, communications, SLA and diagnostic metadata.','confidential',true,false,true,true,1825),
  ('product.tenant_metadata','Product tenant metadata','Tenant identifiers, entitlements and provisioning state.','confidential',true,false,true,true,1825),
  ('product.health_data','Health and patient data','Product-owned medical and patient records. Super Admin stores policy only.','restricted',true,true,true,true,3650)
on conflict (key) do update
set name=excluded.name,description=excluded.description,sensitivity=excluded.sensitivity,
    contains_personal_data=excluded.contains_personal_data,contains_health_data=excluded.contains_health_data,
    export_requires_approval=excluded.export_requires_approval,deletion_requires_approval=excluded.deletion_requires_approval,
    default_retention_days=excluded.default_retention_days,is_active=true,updated_at=now();

insert into public.approval_policies(
  key,title,description,risk_level,required_approvals,requester_roles,approver_roles,
  max_duration_minutes,approval_ttl_minutes,organization_required,product_required,
  mfa_required,client_notification_required,metadata
) values
  ('data.export.restricted','Restricted data export','Export of confidential or restricted organization data.','critical',1,
   array['platform_owner','super_admin','technical_admin','auditor']::public.global_role[],
   array['platform_owner','super_admin','auditor']::public.global_role[],120,1440,true,false,true,true,'{"category":"data_governance"}'::jsonb),
  ('data.delete.organization','Organization data deletion','Anonymization or deletion of organization-scoped data through product adapters.','critical',2,
   array['platform_owner','super_admin','technical_admin']::public.global_role[],
   array['platform_owner','super_admin']::public.global_role[],120,1440,true,false,true,true,'{"category":"data_governance"}'::jsonb),
  ('data.legal_hold.release','Legal hold release','Release of a legal hold after independent review.','critical',2,
   array['platform_owner','super_admin','technical_admin']::public.global_role[],
   array['platform_owner','super_admin','auditor']::public.global_role[],60,1440,true,false,true,false,'{"category":"data_governance"}'::jsonb),
  ('backup.restore.production','Production backup restore','Restore a registered backup into a production environment.','critical',2,
   array['platform_owner','super_admin','technical_admin']::public.global_role[],
   array['platform_owner','super_admin']::public.global_role[],120,720,false,true,true,true,'{"category":"disaster_recovery"}'::jsonb)
on conflict (key) do update
set title=excluded.title,description=excluded.description,risk_level=excluded.risk_level,
    required_approvals=excluded.required_approvals,requester_roles=excluded.requester_roles,
    approver_roles=excluded.approver_roles,max_duration_minutes=excluded.max_duration_minutes,
    approval_ttl_minutes=excluded.approval_ttl_minutes,organization_required=excluded.organization_required,
    product_required=excluded.product_required,mfa_required=excluded.mfa_required,
    client_notification_required=excluded.client_notification_required,metadata=excluded.metadata,
    is_active=true,updated_at=now();

comment on table public.data_retention_policies is 'Policy definitions only. Product adapters perform evaluation and deletion inside product systems.';
comment on table public.legal_holds is 'Legal holds override retention and deletion for matching organization/product/classification scopes.';
comment on table public.backup_assets is 'Backup metadata registry. Backup bytes and credentials remain in external storage providers.';
comment on table public.organization_privacy_controls is 'Organization-level contractual privacy controls; individual patient consent remains in product systems.';
comment on table public.governance_jobs is 'Durable adapter command queue for export, deletion, restore, retention and verification operations.';
