-- Core module catalogue and installation runtime.
-- Product data remains in product systems. This migration stores commercial and
-- technical control-plane metadata only.

create type public.platform_module_status as enum ('draft','review','approved','published','deprecated','blocked','retired');
create type public.platform_module_channel as enum ('development','beta','canary','stable','deprecated');
create type public.platform_module_version_status as enum ('draft','approved','published','blocked');
create type public.module_installation_status as enum (
  'draft','pending_payment','validating','provisioning','active','read_only',
  'suspended','failed','uninstalling','archived'
);
create type public.installation_health_status as enum ('healthy','degraded','failed','unknown');
create type public.installation_operation as enum ('install','upgrade','repair','suspend','resume','uninstall','health_check');
create type public.installation_job_status as enum ('queued','processing','succeeded','failed','dead_letter','cancelled');
create type public.module_price_status as enum ('draft','active','archived');

create table public.platform_modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  owner_product_id uuid not null references public.products(id) on delete restrict,
  status public.platform_module_status not null default 'draft',
  permissions text[] not null default '{}',
  supported_placements text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.platform_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[a-z0-9]+([._-][a-z0-9]+)+$'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.platform_module_versions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.platform_modules(id) on delete cascade,
  version text not null,
  channel public.platform_module_channel not null,
  status public.platform_module_version_status not null default 'draft',
  shell_contract text not null,
  backend_api_range text,
  manifest jsonb not null,
  config_schema jsonb not null,
  integrity_hash text,
  release_notes text,
  rollback_target_id uuid references public.platform_module_versions(id) on delete set null,
  created_by uuid references public.platform_users(id) on delete set null,
  approved_by uuid references public.platform_users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (module_id, version),
  check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$'),
  check (jsonb_typeof(manifest) = 'object'),
  check (jsonb_typeof(config_schema) = 'object'),
  check (integrity_hash is null or integrity_hash ~ '^[a-f0-9]{64}$')
);

create table public.platform_module_requirements (
  module_id uuid not null references public.platform_modules(id) on delete cascade,
  capability text not null,
  required boolean not null default true,
  primary key (module_id, capability)
);

create table public.platform_module_dependencies (
  module_id uuid not null references public.platform_modules(id) on delete cascade,
  dependency_module_id uuid not null references public.platform_modules(id) on delete restrict,
  version_range text not null default '*',
  required boolean not null default true,
  primary key (module_id, dependency_module_id),
  check (module_id <> dependency_module_id)
);

create table public.platform_module_compatibility (
  module_id uuid not null references public.platform_modules(id) on delete cascade,
  host_product_id uuid not null references public.products(id) on delete cascade,
  supported boolean not null default true,
  shell_contract_range text not null default '*',
  placement_slots text[] not null default '{}',
  required_capabilities text[] not null default '{}',
  notes text,
  primary key (module_id, host_product_id)
);

create table public.module_prices (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  module_id uuid not null references public.platform_modules(id) on delete cascade,
  currency text not null default 'KZT',
  amount_minor bigint not null check (amount_minor >= 0),
  billing_period text not null check (billing_period in ('one_time','monthly','quarterly','annual','custom')),
  pricing_model text not null default 'fixed_per_tenant',
  status public.module_price_status not null default 'draft',
  valid_from timestamptz not null,
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (currency ~ '^[A-Z]{3}$'),
  check (valid_to is null or valid_to > valid_from),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.module_subscription_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  price_id uuid not null references public.module_prices(id) on delete restrict,
  module_id uuid not null references public.platform_modules(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  status text not null default 'active' check (status in ('draft','active','past_due','read_only','suspended','cancelled','expired')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.module_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.platform_modules(id) on delete restrict,
  subscription_item_id uuid references public.module_subscription_items(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','active','read_only','suspended','expired','revoked')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, module_id, subscription_item_id),
  check (jsonb_typeof(limits) = 'object')
);

create table public.module_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entitlement_id uuid not null references public.module_entitlements(id) on delete restrict,
  module_id uuid not null references public.platform_modules(id) on delete restrict,
  module_version_id uuid not null references public.platform_module_versions(id) on delete restrict,
  host_product_id uuid not null references public.products(id) on delete restrict,
  status public.module_installation_status not null default 'draft',
  health_status public.installation_health_status not null default 'unknown',
  placement jsonb not null,
  config jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  last_health_at timestamptz,
  last_error text,
  created_by uuid references public.platform_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  suspended_at timestamptz,
  archived_at timestamptz,
  check (jsonb_typeof(placement) = 'object'),
  check (jsonb_typeof(config) = 'object'),
  check (jsonb_typeof(limits) = 'object'),
  check ((placement ->> 'route') ~ '^/')
);

create unique index module_installations_active_unique
on public.module_installations(organization_id,module_id,host_product_id)
where status not in ('archived','uninstalling');

create unique index module_installations_route_unique
on public.module_installations(organization_id,host_product_id,(placement ->> 'route'))
where status not in ('archived','uninstalling');

create table public.installation_revisions (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.module_installations(id) on delete cascade,
  revision integer not null,
  before_data jsonb,
  after_data jsonb not null,
  reason text not null,
  actor_user_id uuid references public.platform_users(id) on delete set null,
  trace_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (installation_id, revision),
  check (char_length(btrim(reason)) >= 5),
  check (before_data is null or jsonb_typeof(before_data) = 'object'),
  check (jsonb_typeof(after_data) = 'object')
);

create table public.installation_permissions (
  installation_id uuid not null references public.module_installations(id) on delete cascade,
  permission text not null,
  primary key (installation_id, permission)
);

create table public.installation_dependency_links (
  installation_id uuid not null references public.module_installations(id) on delete cascade,
  dependency_module_id uuid not null references public.platform_modules(id) on delete restrict,
  dependency_installation_id uuid references public.module_installations(id) on delete set null,
  required boolean not null default true,
  primary key (installation_id, dependency_module_id)
);

create table public.installation_jobs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.module_installations(id) on delete cascade,
  operation public.installation_operation not null,
  status public.installation_job_status not null default 'queued',
  current_step text,
  progress integer not null default 0 check (progress between 0 and 100),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  trace_id uuid not null default gen_random_uuid(),
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check (jsonb_typeof(payload) = 'object'),
  check (result is null or jsonb_typeof(result) = 'object')
);

create table public.platform_outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','publishing','published','failed','dead_letter')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  check (event_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (jsonb_typeof(payload) = 'object')
);

create index installation_jobs_claim_idx on public.installation_jobs(status,available_at,created_at);
create index platform_outbox_claim_idx on public.platform_outbox_events(status,available_at,created_at);
create index installations_org_status_idx on public.module_installations(organization_id,status,health_status);

create trigger platform_modules_set_updated_at before update on public.platform_modules for each row execute function public.set_updated_at();
create trigger module_subscription_items_set_updated_at before update on public.module_subscription_items for each row execute function public.set_updated_at();
create trigger module_entitlements_set_updated_at before update on public.module_entitlements for each row execute function public.set_updated_at();
create trigger module_installations_set_updated_at before update on public.module_installations for each row execute function public.set_updated_at();

create or replace function public.can_manage_modules()
returns boolean language sql stable security definer set search_path=public as $$
  select public.has_global_role(array['platform_owner'::public.global_role,'super_admin'::public.global_role,'technical_admin'::public.global_role]);
$$;
revoke all on function public.can_manage_modules() from public;
grant execute on function public.can_manage_modules() to authenticated;

create or replace function public.preview_module_installation(
  organization_id_value uuid,
  module_code_value text,
  host_product_code_value text,
  price_code_value text,
  version_channel_value public.platform_module_channel,
  placement_value jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  org_record public.organizations%rowtype;
  module_record public.platform_modules%rowtype;
  host_record public.products%rowtype;
  version_record public.platform_module_versions%rowtype;
  price_record public.module_prices%rowtype;
  compatibility_record public.platform_module_compatibility%rowtype;
  dependency_codes text[] := '{}';
  errors text[] := '{}';
  warnings text[] := '{}';
  plan text[] := array['validate_entitlement','resolve_dependencies','create_installation','provision_module','health_check'];
begin
  select * into org_record from public.organizations where id=organization_id_value and archived_at is null;
  if not found or org_record.status::text <> 'active' then errors := array_append(errors,'TENANT_NOT_ACTIVE'); end if;
  select * into module_record from public.platform_modules where code=module_code_value;
  if not found or module_record.status <> 'published' then errors := array_append(errors,'MODULE_NOT_PUBLISHED'); end if;
  select * into host_record from public.products where key=host_product_code_value and archived_at is null;
  if not found or host_record.status::text not in ('active','degraded','maintenance') then errors := array_append(errors,'HOST_PRODUCT_NOT_ACTIVE'); end if;
  if module_record.id is not null and host_record.id is not null then
    select * into compatibility_record from public.platform_module_compatibility where module_id=module_record.id and host_product_id=host_record.id;
    if not found or not compatibility_record.supported then errors := array_append(errors,'MODULE_NOT_COMPATIBLE'); end if;
    if compatibility_record.id is not null and not ((placement_value->>'slot') = any(compatibility_record.placement_slots)) then errors := array_append(errors,'PLACEMENT_NOT_SUPPORTED'); end if;
  end if;
  if module_record.id is not null then
    select * into version_record from public.platform_module_versions
    where module_id=module_record.id and channel=version_channel_value and status='published'
    order by published_at desc nulls last,created_at desc limit 1;
    if not found then errors := array_append(errors,'MODULE_VERSION_NOT_PUBLISHED'); end if;
    select coalesce(array_agg(m.code order by m.code),'{}') into dependency_codes
    from public.platform_module_dependencies d join public.platform_modules m on m.id=d.dependency_module_id
    where d.module_id=module_record.id and d.required;
  end if;
  select * into price_record from public.module_prices where code=price_code_value and status='active' and valid_from<=now() and (valid_to is null or valid_to>now());
  if not found or (module_record.id is not null and price_record.module_id<>module_record.id) then errors := array_append(errors,'PRICE_NOT_ACTIVE'); end if;
  if exists(select 1 from public.module_installations where organization_id=organization_id_value and module_id=module_record.id and host_product_id=host_record.id and status not in ('archived','uninstalling')) then errors:=array_append(errors,'INSTALLATION_ALREADY_EXISTS'); end if;
  if exists(select 1 from public.module_installations where organization_id=organization_id_value and host_product_id=host_record.id and placement->>'route'=placement_value->>'route' and status not in ('archived','uninstalling')) then errors:=array_append(errors,'ROUTE_CONFLICT'); end if;
  return jsonb_build_object(
    'compatible',cardinality(errors)=0,'selectedVersion',version_record.version,
    'dependencies',dependency_codes,'monthlyAmountMinor',price_record.amount_minor,
    'currency',price_record.currency,'warnings',warnings,'errors',errors,'provisioningPlan',plan
  );
end;
$$;
revoke all on function public.preview_module_installation(uuid,text,text,text,public.platform_module_channel,jsonb) from public;
grant execute on function public.preview_module_installation(uuid,text,text,text,public.platform_module_channel,jsonb) to authenticated,service_role;

create or replace function public.create_module_installation(
  organization_id_value uuid,
  module_code_value text,
  host_product_code_value text,
  price_code_value text,
  version_channel_value public.platform_module_channel,
  starts_at_value timestamptz,
  ends_at_value timestamptz,
  placement_value jsonb,
  config_value jsonb,
  limits_value jsonb,
  permissions_value text[],
  reason_value text,
  idempotency_key_value text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  preview jsonb;
  module_record public.platform_modules%rowtype;
  host_record public.products%rowtype;
  version_record public.platform_module_versions%rowtype;
  price_record public.module_prices%rowtype;
  item_id uuid; entitlement_id_value uuid; installation_id_value uuid; job_id_value uuid;
  permission_value text; dependency_record record;
  existing_job public.installation_jobs%rowtype;
begin
  if not public.can_manage_modules() then raise exception 'Insufficient permission to create module installation'; end if;
  if char_length(btrim(reason_value))<10 then raise exception 'Administrative reason is required'; end if;
  if nullif(btrim(idempotency_key_value),'') is null then raise exception 'Idempotency key is required'; end if;
  select * into existing_job from public.installation_jobs where idempotency_key=idempotency_key_value;
  if found then
    return jsonb_build_object('installationId',existing_job.installation_id,'provisioningJobId',existing_job.id,'status',(select status from public.module_installations where id=existing_job.installation_id));
  end if;
  preview := public.preview_module_installation(organization_id_value,module_code_value,host_product_code_value,price_code_value,version_channel_value,placement_value);
  if not coalesce((preview->>'compatible')::boolean,false) then raise exception 'Installation validation failed: %',preview->'errors'; end if;
  select * into module_record from public.platform_modules where code=module_code_value;
  select * into host_record from public.products where key=host_product_code_value;
  select * into version_record from public.platform_module_versions where module_id=module_record.id and channel=version_channel_value and status='published' order by published_at desc nulls last,created_at desc limit 1;
  select * into price_record from public.module_prices where code=price_code_value;

  insert into public.module_subscription_items(organization_id,price_id,module_id,unit_amount_minor,status,starts_at,ends_at)
  values(organization_id_value,price_record.id,module_record.id,price_record.amount_minor,'active',starts_at_value,ends_at_value) returning id into item_id;
  insert into public.module_entitlements(organization_id,module_id,subscription_item_id,status,starts_at,ends_at,limits)
  values(organization_id_value,module_record.id,item_id,'pending',starts_at_value,ends_at_value,coalesce(limits_value,'{}')) returning id into entitlement_id_value;
  insert into public.module_installations(organization_id,entitlement_id,module_id,module_version_id,host_product_id,status,placement,config,limits,created_by)
  values(organization_id_value,entitlement_id_value,module_record.id,version_record.id,host_record.id,'validating',placement_value,coalesce(config_value,'{}'),coalesce(limits_value,'{}'),auth.uid()) returning id into installation_id_value;
  foreach permission_value in array coalesce(permissions_value,'{}') loop
    if not permission_value=any(module_record.permissions) then raise exception 'Permission % is not declared by module',permission_value; end if;
    insert into public.installation_permissions values(installation_id_value,permission_value);
  end loop;
  for dependency_record in select d.dependency_module_id,d.required from public.platform_module_dependencies d where d.module_id=module_record.id loop
    insert into public.installation_dependency_links(installation_id,dependency_module_id,dependency_installation_id,required)
    values(installation_id_value,dependency_record.dependency_module_id,
      (select id from public.module_installations where organization_id=organization_id_value and module_id=dependency_record.dependency_module_id and status='active' limit 1),dependency_record.required);
  end loop;
  insert into public.installation_revisions(installation_id,revision,after_data,reason,actor_user_id)
  values(installation_id_value,1,(select to_jsonb(i) from public.module_installations i where i.id=installation_id_value),btrim(reason_value),auth.uid());
  insert into public.installation_jobs(installation_id,operation,status,current_step,idempotency_key,payload)
  values(installation_id_value,'install','queued','validate_entitlement',idempotency_key_value,jsonb_build_object('installationId',installation_id_value,'moduleCode',module_code_value,'version',version_record.version)) returning id into job_id_value;
  insert into public.platform_outbox_events(event_type,aggregate_type,aggregate_id,organization_id,payload)
  values('platform.installation.requested','module_installation',installation_id_value,organization_id_value,jsonb_build_object('installationId',installation_id_value,'jobId',job_id_value));
  perform public.write_audit_event('module_installation.created','module_installation',installation_id_value::text,organization_id_value,btrim(reason_value),null,(select to_jsonb(i) from public.module_installations i where i.id=installation_id_value));
  return jsonb_build_object('tenantId',organization_id_value,'installationId',installation_id_value,'subscriptionItemId',item_id,'entitlementId',entitlement_id_value,'provisioningJobId',job_id_value,'status','validating');
end;
$$;
revoke all on function public.create_module_installation(uuid,text,text,text,public.platform_module_channel,timestamptz,timestamptz,jsonb,jsonb,jsonb,text[],text,text) from public;
grant execute on function public.create_module_installation(uuid,text,text,text,public.platform_module_channel,timestamptz,timestamptz,jsonb,jsonb,jsonb,text[],text,text) to authenticated;

create or replace function public.platform_bootstrap(organization_id_value uuid,product_code_value text)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'tenant',jsonb_build_object('id',o.id,'displayName',o.display_name),
    'product',jsonb_build_object('code',p.key,'shellVersion',coalesce(p.version,'0.0.0')),
    'modules',coalesce((select jsonb_agg(jsonb_build_object(
      'installationId',i.id,'code',m.code,'version',v.version,'status',i.status,
      'healthStatus',i.health_status,'placement',i.placement,
      'permissions',(select coalesce(jsonb_agg(ip.permission order by ip.permission),'[]') from public.installation_permissions ip where ip.installation_id=i.id),
      'limits',i.limits,'config',i.config
    ) order by coalesce((i.placement->>'order')::int,0))
    from public.module_installations i
    join public.platform_modules m on m.id=i.module_id
    join public.platform_module_versions v on v.id=i.module_version_id
    join public.module_entitlements e on e.id=i.entitlement_id
    where i.organization_id=o.id and i.host_product_id=p.id and i.status='active' and e.status='active'),'[]'::jsonb)
  )
  from public.organizations o cross join public.products p
  where o.id=organization_id_value and o.status::text='active' and o.archived_at is null and p.key=product_code_value and p.archived_at is null;
$$;
revoke all on function public.platform_bootstrap(uuid,text) from public;
grant execute on function public.platform_bootstrap(uuid,text) to authenticated,service_role;

create or replace function public.platform_authorize(
  organization_id_value uuid,host_product_code_value text,module_code_value text,permission_value text
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare installation_record public.module_installations%rowtype; entitlement_record public.module_entitlements%rowtype;
begin
  if not exists(select 1 from public.organizations where id=organization_id_value and status::text='active' and archived_at is null) then
    return jsonb_build_object('allowed',false,'installationId',null,'reason','TENANT_SUSPENDED','effectiveLimits','{}'::jsonb);
  end if;
  select i.* into installation_record from public.module_installations i join public.platform_modules m on m.id=i.module_id join public.products p on p.id=i.host_product_id
  where i.organization_id=organization_id_value and m.code=module_code_value and p.key=host_product_code_value and i.status not in ('archived','uninstalling') limit 1;
  if not found then return jsonb_build_object('allowed',false,'installationId',null,'reason','INSTALLATION_NOT_FOUND','effectiveLimits','{}'::jsonb); end if;
  select * into entitlement_record from public.module_entitlements where id=installation_record.entitlement_id;
  if installation_record.status='suspended' or entitlement_record.status='suspended' then return jsonb_build_object('allowed',false,'installationId',installation_record.id,'reason','MODULE_SUSPENDED','effectiveLimits',installation_record.limits); end if;
  if installation_record.status='read_only' or entitlement_record.status='read_only' then return jsonb_build_object('allowed',false,'installationId',installation_record.id,'reason','MODULE_READ_ONLY','effectiveLimits',installation_record.limits); end if;
  if installation_record.status<>'active' or entitlement_record.status<>'active' then return jsonb_build_object('allowed',false,'installationId',installation_record.id,'reason','PERMISSION_DENIED','effectiveLimits',installation_record.limits); end if;
  if not exists(select 1 from public.installation_permissions where installation_id=installation_record.id and permission=permission_value) then return jsonb_build_object('allowed',false,'installationId',installation_record.id,'reason','PERMISSION_DENIED','effectiveLimits',installation_record.limits); end if;
  return jsonb_build_object('allowed',true,'installationId',installation_record.id,'reason','GRANTED','effectiveLimits',installation_record.limits);
end;
$$;
revoke all on function public.platform_authorize(uuid,text,text,text) from public;
grant execute on function public.platform_authorize(uuid,text,text,text) to authenticated,service_role;

create or replace function public.prevent_published_module_version_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status='published' then raise exception 'Published module versions are immutable'; end if;
  return new;
end;
$$;
create trigger published_module_versions_immutable before update or delete on public.platform_module_versions for each row execute function public.prevent_published_module_version_mutation();

create or replace function public.prevent_installation_revision_mutation()
returns trigger language plpgsql set search_path=public as $$ begin raise exception 'Installation revisions are append-only'; end; $$;
create trigger installation_revisions_immutable before update or delete on public.installation_revisions for each row execute function public.prevent_installation_revision_mutation();

alter table public.platform_modules enable row level security;
alter table public.platform_module_versions enable row level security;
alter table public.platform_module_requirements enable row level security;
alter table public.platform_module_dependencies enable row level security;
alter table public.platform_module_compatibility enable row level security;
alter table public.module_prices enable row level security;
alter table public.module_subscription_items enable row level security;
alter table public.module_entitlements enable row level security;
alter table public.module_installations enable row level security;
alter table public.installation_revisions enable row level security;
alter table public.installation_permissions enable row level security;
alter table public.installation_dependency_links enable row level security;
alter table public.installation_jobs enable row level security;
alter table public.platform_outbox_events enable row level security;

create policy modules_staff_select on public.platform_modules for select to authenticated using(public.is_platform_staff());
create policy module_versions_staff_select on public.platform_module_versions for select to authenticated using(public.is_platform_staff());
create policy module_requirements_staff_select on public.platform_module_requirements for select to authenticated using(public.is_platform_staff());
create policy module_dependencies_staff_select on public.platform_module_dependencies for select to authenticated using(public.is_platform_staff());
create policy module_compatibility_staff_select on public.platform_module_compatibility for select to authenticated using(public.is_platform_staff());
create policy module_prices_staff_select on public.module_prices for select to authenticated using(public.is_platform_staff());
create policy module_subscription_items_staff_select on public.module_subscription_items for select to authenticated using(public.is_platform_staff());
create policy module_entitlements_staff_select on public.module_entitlements for select to authenticated using(public.is_platform_staff());
create policy installations_staff_select on public.module_installations for select to authenticated using(public.is_platform_staff());
create policy installation_revisions_staff_select on public.installation_revisions for select to authenticated using(public.is_platform_staff());
create policy installation_permissions_staff_select on public.installation_permissions for select to authenticated using(public.is_platform_staff());
create policy installation_dependencies_staff_select on public.installation_dependency_links for select to authenticated using(public.is_platform_staff());
create policy installation_jobs_staff_select on public.installation_jobs for select to authenticated using(public.is_platform_staff());
create policy platform_outbox_staff_select on public.platform_outbox_events for select to authenticated using(public.is_platform_staff());

grant select on public.platform_modules,public.platform_module_versions,public.platform_module_requirements,public.platform_module_dependencies,public.platform_module_compatibility,public.module_prices,public.module_subscription_items,public.module_entitlements,public.module_installations,public.installation_revisions,public.installation_permissions,public.installation_dependency_links,public.installation_jobs,public.platform_outbox_events to authenticated;
grant all on public.platform_modules,public.platform_module_versions,public.platform_module_requirements,public.platform_module_dependencies,public.platform_module_compatibility,public.module_prices,public.module_subscription_items,public.module_entitlements,public.module_installations,public.installation_revisions,public.installation_permissions,public.installation_dependency_links,public.installation_jobs,public.platform_outbox_events to service_role;

insert into public.platform_modules(code,name,description,owner_product_id,status,permissions,supported_placements,metadata)
select 'crm.kanban','CRM Kanban','CRM deal pipeline embedded into a compatible host product.',id,'published',
  array['crm.deals.read','crm.deals.create','crm.deals.update','crm.deals.move','crm.pipelines.read'],
  array['sidebar.route'],jsonb_build_object('provisioner','crm.kanban')
from public.products where key in ('imds-crm','crm') order by case when key='imds-crm' then 0 else 1 end limit 1
on conflict(code) do nothing;

insert into public.platform_module_versions(module_id,version,channel,status,shell_contract,backend_api_range,manifest,config_schema,release_notes,published_at)
select id,'1.0.0','stable','published','>=1.0.0 <2.0.0','>=1.0.0 <2.0.0',
  '{"entry":"crm.kanban","placements":["sidebar.route"],"provisioner":"crm.kanban"}'::jsonb,
  '{"type":"object","properties":{"defaultPipelineCode":{"type":"string"},"syncMarketingLeads":{"type":"boolean"},"allowDealDeletion":{"type":"boolean"}},"additionalProperties":false}'::jsonb,
  'Initial CRM Kanban release.',now()
from public.platform_modules where code='crm.kanban'
on conflict(module_id,version) do nothing;

insert into public.platform_module_compatibility(module_id,host_product_id,supported,shell_contract_range,placement_slots,required_capabilities)
select m.id,p.id,true,'>=1.0.0 <2.0.0',array['sidebar.route'],array['tenant.provision','entitlements.sync']
from public.platform_modules m join public.products p on p.key in ('imds-marketing','marketing')
where m.code='crm.kanban'
on conflict(module_id,host_product_id) do update set supported=true,placement_slots=excluded.placement_slots,required_capabilities=excluded.required_capabilities;

insert into public.module_prices(code,module_id,currency,amount_minor,billing_period,pricing_model,status,valid_from)
select 'price.crm.kanban.kzt.monthly.v1',id,'KZT',2500000,'monthly','fixed_per_tenant','active',now()
from public.platform_modules where code='crm.kanban'
on conflict(code) do nothing;
