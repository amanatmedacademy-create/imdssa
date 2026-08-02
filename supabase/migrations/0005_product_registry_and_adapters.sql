-- Product Registry, adapter contracts and environment endpoints.
-- Super Admin stores control-plane configuration only. Product credentials remain
-- in an external secrets manager and are referenced through secret_reference.

create type public.product_adapter_status as enum ('draft', 'active', 'degraded', 'disabled');
create type public.product_adapter_protocol as enum ('rest', 'graphql', 'worker', 'internal');
create type public.product_endpoint_environment as enum ('development', 'staging', 'production', 'demo');
create type public.product_endpoint_status as enum ('draft', 'active', 'maintenance', 'disabled');
create type public.product_auth_mode as enum ('none', 'service_token', 'oauth2', 'signed_request');
create type public.product_health_status as enum ('unknown', 'healthy', 'degraded', 'unavailable');

create table public.product_adapters (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  adapter_key text not null unique,
  contract_version text not null default '1.0',
  protocol public.product_adapter_protocol not null default 'rest',
  status public.product_adapter_status not null default 'draft',
  capabilities text[] not null default '{}',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (adapter_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (contract_version ~ '^[0-9]+\.[0-9]+([.-][a-zA-Z0-9]+)*$')
);

create table public.product_endpoints (
  id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null references public.product_adapters(id) on delete cascade,
  environment public.product_endpoint_environment not null,
  base_url text,
  healthcheck_url text,
  auth_mode public.product_auth_mode not null default 'service_token',
  secret_reference text,
  timeout_ms integer not null default 10000 check (timeout_ms between 500 and 120000),
  status public.product_endpoint_status not null default 'draft',
  last_checked_at timestamptz,
  last_health_status public.product_health_status not null default 'unknown',
  last_latency_ms integer check (last_latency_ms is null or last_latency_ms >= 0),
  last_error text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adapter_id, environment),
  check (base_url is null or base_url ~ '^https?://'),
  check (healthcheck_url is null or healthcheck_url ~ '^https?://'),
  check (secret_reference is null or length(secret_reference) between 3 and 255)
);

create table public.product_health_checks (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.product_endpoints(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status public.product_health_status not null,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  http_status integer check (http_status is null or http_status between 100 and 599),
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create index product_adapters_status_idx on public.product_adapters(status);
create index product_endpoints_environment_status_idx on public.product_endpoints(environment, status);
create index product_health_checks_endpoint_time_idx on public.product_health_checks(endpoint_id, checked_at desc);

alter table public.product_adapters enable row level security;
alter table public.product_endpoints enable row level security;
alter table public.product_health_checks enable row level security;

create trigger product_adapters_set_updated_at
before update on public.product_adapters
for each row execute function public.set_updated_at();

create trigger product_endpoints_set_updated_at
before update on public.product_endpoints
for each row execute function public.set_updated_at();

create or replace function public.upsert_product_definition(
  product_key text,
  product_name text,
  product_description text default null,
  product_status public.product_status default 'draft',
  product_version text default null,
  target_product_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  current_record public.products%rowtype;
  before_record jsonb;
begin
  if not public.can_manage_products() then
    raise exception 'Insufficient permission to manage products';
  end if;

  product_key := lower(nullif(btrim(product_key), ''));
  product_name := nullif(btrim(product_name), '');
  product_description := nullif(btrim(product_description), '');
  product_version := nullif(btrim(product_version), '');

  if product_key is null or product_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Product key is invalid';
  end if;
  if product_name is null then
    raise exception 'Product name is required';
  end if;
  if product_version is not null and product_version !~ '^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9]+)*$' then
    raise exception 'Product version must follow semantic version format';
  end if;

  if target_product_id is null then
    if exists (select 1 from public.products where key = product_key or lower(name) = lower(product_name)) then
      raise exception 'Product key or name already exists';
    end if;

    insert into public.products (
      key, name, description, status, current_version, is_system
    ) values (
      product_key, product_name, product_description, product_status, product_version, false
    ) returning id into result_id;

    perform public.write_audit_event(
      'product.created',
      'product',
      result_id::text,
      null,
      'Product Registry creation',
      null,
      (select to_jsonb(p) from public.products p where p.id = result_id)
    );
  else
    select * into current_record from public.products where id = target_product_id;
    if not found then raise exception 'Product not found'; end if;

    if current_record.is_system and current_record.key <> product_key then
      raise exception 'System product key cannot be changed';
    end if;

    if exists (
      select 1 from public.products
      where id <> target_product_id
        and (key = product_key or lower(name) = lower(product_name))
    ) then
      raise exception 'Product key or name already exists';
    end if;

    before_record := to_jsonb(current_record);

    update public.products
    set key = product_key,
        name = product_name,
        description = product_description,
        status = product_status,
        current_version = product_version
    where id = target_product_id
    returning id into result_id;

    perform public.write_audit_event(
      'product.updated',
      'product',
      result_id::text,
      null,
      'Product Registry update',
      before_record,
      (select to_jsonb(p) from public.products p where p.id = result_id)
    );
  end if;

  return result_id;
end;
$$;

revoke all on function public.upsert_product_definition(text, text, text, public.product_status, text, uuid) from public;
grant execute on function public.upsert_product_definition(text, text, text, public.product_status, text, uuid) to authenticated;

create or replace function public.configure_product_adapter(
  target_product_id uuid,
  adapter_key_value text,
  contract_version_value text default '1.0',
  protocol_value public.product_adapter_protocol default 'rest',
  adapter_status_value public.product_adapter_status default 'draft',
  capabilities_value text[] default '{}',
  endpoint_environment_value public.product_endpoint_environment default 'production',
  endpoint_base_url_value text default null,
  endpoint_healthcheck_url_value text default null,
  endpoint_auth_mode_value public.product_auth_mode default 'service_token',
  endpoint_secret_reference_value text default null,
  endpoint_timeout_ms_value integer default 10000,
  endpoint_status_value public.product_endpoint_status default 'draft'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  adapter_id_value uuid;
  before_adapter jsonb;
  before_endpoint jsonb;
  normalized_base_url text;
  normalized_healthcheck_url text;
begin
  if not public.can_manage_products() then
    raise exception 'Insufficient permission to configure product adapters';
  end if;
  if not exists (select 1 from public.products where id = target_product_id) then
    raise exception 'Product not found';
  end if;

  adapter_key_value := lower(nullif(btrim(adapter_key_value), ''));
  contract_version_value := nullif(btrim(contract_version_value), '');
  normalized_base_url := nullif(rtrim(btrim(endpoint_base_url_value), '/'), '');
  normalized_healthcheck_url := nullif(btrim(endpoint_healthcheck_url_value), '');
  endpoint_secret_reference_value := nullif(btrim(endpoint_secret_reference_value), '');

  if adapter_key_value is null or adapter_key_value !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Adapter key is invalid';
  end if;
  if contract_version_value is null or contract_version_value !~ '^[0-9]+\.[0-9]+([.-][a-zA-Z0-9]+)*$' then
    raise exception 'Adapter contract version is invalid';
  end if;
  if normalized_base_url is not null and normalized_base_url !~ '^https?://' then
    raise exception 'Endpoint base URL is invalid';
  end if;
  if normalized_healthcheck_url is not null and normalized_healthcheck_url !~ '^https?://' then
    raise exception 'Healthcheck URL is invalid';
  end if;
  if endpoint_environment_value = 'production' and normalized_base_url is not null and normalized_base_url !~ '^https://' then
    raise exception 'Production endpoint must use HTTPS';
  end if;
  if endpoint_status_value = 'active' and normalized_base_url is null then
    raise exception 'Active endpoint requires a base URL';
  end if;
  if endpoint_timeout_ms_value < 500 or endpoint_timeout_ms_value > 120000 then
    raise exception 'Endpoint timeout is outside the allowed range';
  end if;

  select to_jsonb(a), a.id
    into before_adapter, adapter_id_value
  from public.product_adapters a
  where a.product_id = target_product_id;

  insert into public.product_adapters (
    product_id,
    adapter_key,
    contract_version,
    protocol,
    status,
    capabilities
  ) values (
    target_product_id,
    adapter_key_value,
    contract_version_value,
    protocol_value,
    adapter_status_value,
    coalesce(capabilities_value, '{}')
  )
  on conflict (product_id) do update
    set adapter_key = excluded.adapter_key,
        contract_version = excluded.contract_version,
        protocol = excluded.protocol,
        status = excluded.status,
        capabilities = excluded.capabilities
  returning id into adapter_id_value;

  select to_jsonb(e)
    into before_endpoint
  from public.product_endpoints e
  where e.adapter_id = adapter_id_value
    and e.environment = endpoint_environment_value;

  insert into public.product_endpoints (
    adapter_id,
    environment,
    base_url,
    healthcheck_url,
    auth_mode,
    secret_reference,
    timeout_ms,
    status
  ) values (
    adapter_id_value,
    endpoint_environment_value,
    normalized_base_url,
    normalized_healthcheck_url,
    endpoint_auth_mode_value,
    endpoint_secret_reference_value,
    endpoint_timeout_ms_value,
    endpoint_status_value
  )
  on conflict (adapter_id, environment) do update
    set base_url = excluded.base_url,
        healthcheck_url = excluded.healthcheck_url,
        auth_mode = excluded.auth_mode,
        secret_reference = excluded.secret_reference,
        timeout_ms = excluded.timeout_ms,
        status = excluded.status;

  update public.products
  set adapter_key = adapter_key_value,
      api_base_url = normalized_base_url,
      healthcheck_url = normalized_healthcheck_url
  where id = target_product_id;

  perform public.write_audit_event(
    'product.adapter_configured',
    'product_adapter',
    adapter_id_value::text,
    null,
    concat('Adapter environment: ', endpoint_environment_value::text),
    jsonb_build_object('adapter', before_adapter, 'endpoint', before_endpoint),
    jsonb_build_object(
      'adapter', (select to_jsonb(a) from public.product_adapters a where a.id = adapter_id_value),
      'endpoint', (
        select to_jsonb(e) - 'secret_reference'
        from public.product_endpoints e
        where e.adapter_id = adapter_id_value and e.environment = endpoint_environment_value
      ),
      'has_secret_reference', endpoint_secret_reference_value is not null
    )
  );

  return adapter_id_value;
end;
$$;

revoke all on function public.configure_product_adapter(uuid, text, text, public.product_adapter_protocol, public.product_adapter_status, text[], public.product_endpoint_environment, text, text, public.product_auth_mode, text, integer, public.product_endpoint_status) from public;
grant execute on function public.configure_product_adapter(uuid, text, text, public.product_adapter_protocol, public.product_adapter_status, text[], public.product_endpoint_environment, text, text, public.product_auth_mode, text, integer, public.product_endpoint_status) to authenticated;

create or replace function public.record_product_health(
  target_endpoint_id uuid,
  health_status_value public.product_health_status,
  latency_ms_value integer default null,
  http_status_value integer default null,
  error_value text default null,
  metadata_value jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  health_check_id uuid;
begin
  if target_endpoint_id is null then raise exception 'Endpoint is required'; end if;
  if latency_ms_value is not null and latency_ms_value < 0 then raise exception 'Latency cannot be negative'; end if;
  if http_status_value is not null and (http_status_value < 100 or http_status_value > 599) then
    raise exception 'HTTP status is invalid';
  end if;

  insert into public.product_health_checks (
    endpoint_id, status, latency_ms, http_status, error, metadata
  ) values (
    target_endpoint_id,
    health_status_value,
    latency_ms_value,
    http_status_value,
    nullif(btrim(error_value), ''),
    coalesce(metadata_value, '{}'::jsonb)
  ) returning id into health_check_id;

  update public.product_endpoints
  set last_checked_at = now(),
      last_health_status = health_status_value,
      last_latency_ms = latency_ms_value,
      last_error = nullif(btrim(error_value), '')
  where id = target_endpoint_id;

  return health_check_id;
end;
$$;

revoke all on function public.record_product_health(uuid, public.product_health_status, integer, integer, text, jsonb) from public;
grant execute on function public.record_product_health(uuid, public.product_health_status, integer, integer, text, jsonb) to service_role;

create policy product_adapters_select on public.product_adapters
for select to authenticated using (public.is_platform_staff());
create policy product_adapters_manage on public.product_adapters
for all to authenticated
using (public.can_manage_products())
with check (public.can_manage_products());

create policy product_endpoints_select on public.product_endpoints
for select to authenticated using (public.is_platform_staff());
create policy product_endpoints_manage on public.product_endpoints
for all to authenticated
using (public.can_manage_products())
with check (public.can_manage_products());

create policy product_health_checks_select on public.product_health_checks
for select to authenticated using (public.is_platform_staff());
create policy product_health_checks_service_insert on public.product_health_checks
for insert to service_role with check (true);

comment on table public.product_adapters is
  'Versioned adapter contract registered for one IMDS product.';
comment on table public.product_endpoints is
  'Environment-specific product endpoint. Secrets are stored externally and referenced only by secret_reference.';
comment on table public.product_health_checks is
  'Append-oriented health history written by a trusted backend worker.';
