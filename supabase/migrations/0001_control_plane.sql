create extension if not exists pgcrypto;

create type public.organization_status as enum ('lead','demo','onboarding','trial','active','past_due','grace_period','suspended','archived');
create type public.subscription_status as enum ('trial','active','past_due','grace_period','suspended','cancelled','expired');
create type public.product_status as enum ('draft','active','degraded','maintenance','disabled');
create type public.global_role as enum ('platform_owner','super_admin','support_admin','finance_admin','technical_admin','sales_manager','auditor');

create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid references public.holdings(id) on delete set null,
  name text not null,
  slug text not null unique,
  status public.organization_status not null default 'lead',
  country_code char(2) not null default 'KZ',
  city text,
  owner_user_id uuid,
  customer_health smallint not null default 100 check (customer_health between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  bin text,
  is_primary boolean not null default false,
  billing_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, bin)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legal_entity_id uuid references public.legal_entities(id) on delete set null,
  name text not null,
  city text,
  address text,
  timezone text not null default 'Asia/Almaty',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.platform_users (
  id uuid primary key,
  email text not null unique,
  full_name text,
  global_role public.global_role,
  mfa_enforced boolean not null default false,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  user_id uuid not null references public.platform_users(id) on delete cascade,
  role_key text not null,
  product_scopes text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, branch_id, user_id, role_key)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null unique,
  description text,
  status public.product_status not null default 'draft',
  current_version text,
  api_base_url text,
  healthcheck_url text,
  adapter_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tariffs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  name text not null,
  currency char(3) not null default 'KZT',
  monthly_price numeric(14,2) not null default 0,
  annual_price numeric(14,2),
  trial_days integer not null default 0,
  is_custom boolean not null default false,
  is_active boolean not null default true,
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tariff_id uuid references public.tariffs(id) on delete restrict,
  status public.subscription_status not null default 'trial',
  starts_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  grace_ends_at timestamptz,
  cancelled_at timestamptz,
  custom_price numeric(14,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  external_tenant_id text,
  status text not null default 'pending' check (status in ('pending','provisioning','active','suspended','failed','revoked')),
  activated_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, product_id)
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  key text not null,
  value jsonb not null,
  source text not null default 'tariff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (license_id, key)
);

create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  metric_key text not null,
  period_start date not null,
  period_end date not null,
  quantity numeric(18,4) not null default 0,
  updated_at timestamptz not null default now(),
  unique (license_id, metric_key, period_start, period_end)
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  provider_key text not null,
  status text not null default 'disconnected',
  secret_reference text,
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  workflow_key text not null,
  status text not null check (status in ('queued','running','waiting_approval','completed','failed','cancelled')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid references public.workflow_runs(id) on delete cascade,
  action_key text not null,
  requested_by uuid not null references public.platform_users(id),
  reviewed_by uuid references public.platform_users(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  reason text not null,
  decision_note text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (reviewed_by is null or reviewed_by <> requested_by)
);

create table public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.platform_users(id),
  organization_id uuid not null references public.organizations(id),
  target_user_id uuid references public.platform_users(id),
  reason text not null,
  read_only boolean not null default true,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  approved_request_id uuid references public.approval_requests(id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references public.platform_users(id),
  organization_id uuid references public.organizations(id),
  action text not null,
  resource_type text not null,
  resource_id text,
  reason text,
  ip inet,
  user_agent text,
  before_state jsonb,
  after_state jsonb,
  correlation_id uuid,
  hash text not null
);

create index organizations_status_idx on public.organizations(status);
create index memberships_user_idx on public.memberships(user_id);
create index subscriptions_org_status_idx on public.subscriptions(organization_id, status);
create index licenses_product_status_idx on public.licenses(product_id, status);
create index audit_events_org_time_idx on public.audit_events(organization_id, occurred_at desc);
create index workflow_runs_status_idx on public.workflow_runs(status, created_at);

alter table public.holdings enable row level security;
alter table public.organizations enable row level security;
alter table public.legal_entities enable row level security;
alter table public.branches enable row level security;
alter table public.platform_users enable row level security;
alter table public.memberships enable row level security;
alter table public.products enable row level security;
alter table public.tariffs enable row level security;
alter table public.subscriptions enable row level security;
alter table public.licenses enable row level security;
alter table public.entitlements enable row level security;
alter table public.usage_counters enable row level security;
alter table public.integrations enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.approval_requests enable row level security;
alter table public.impersonation_sessions enable row level security;
alter table public.audit_events enable row level security;

comment on table public.audit_events is 'Append-only security audit stream. Direct update and delete must be denied to application roles.';
comment on table public.products is 'Registry for all eleven IMDS products. Placeholder products must be renamed after official names are confirmed.';
