-- Explicitly maps a central organization to the tenant identifier owned by each product.
-- Cross-product code must never assume that control-plane and product UUIDs are equal.

create table public.product_tenant_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  environment public.product_endpoint_environment not null default 'production',
  external_tenant_id text not null,
  status text not null default 'active' check (status in ('pending','active','suspended','revoked')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.platform_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,product_id,environment),
  unique (product_id,environment,external_tenant_id),
  check (char_length(btrim(external_tenant_id)) between 1 and 255),
  check (jsonb_typeof(metadata)='object')
);

create index product_tenant_bindings_lookup_idx
  on public.product_tenant_bindings(organization_id,product_id,environment,status);

create trigger product_tenant_bindings_set_updated_at
before update on public.product_tenant_bindings
for each row execute function public.set_updated_at();

create or replace function public.upsert_product_tenant_binding(
  organization_id_value uuid,
  product_code_value text,
  environment_value public.product_endpoint_environment,
  external_tenant_id_value text,
  status_value text default 'active',
  reason_value text default 'Product tenant binding configured'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  product_record public.products%rowtype;
  binding_id_value uuid;
  before_record jsonb;
begin
  if not (public.can_manage_modules() or public.can_manage_operations()) then
    raise exception 'Insufficient permission to manage product tenant bindings';
  end if;
  if char_length(btrim(reason_value))<10 then raise exception 'Administrative reason is required'; end if;
  if nullif(btrim(external_tenant_id_value),'') is null then raise exception 'External tenant ID is required'; end if;
  if status_value not in ('pending','active','suspended','revoked') then raise exception 'Invalid binding status'; end if;

  select * into product_record
  from public.products
  where key=product_code_value and archived_at is null;
  if not found then raise exception 'Product not found'; end if;
  if not exists(select 1 from public.organizations where id=organization_id_value and archived_at is null) then
    raise exception 'Organization not found';
  end if;

  select to_jsonb(binding) into before_record
  from public.product_tenant_bindings binding
  where binding.organization_id=organization_id_value
    and binding.product_id=product_record.id
    and binding.environment=environment_value;

  insert into public.product_tenant_bindings(
    organization_id,product_id,environment,external_tenant_id,status,created_by
  ) values(
    organization_id_value,product_record.id,environment_value,btrim(external_tenant_id_value),status_value,auth.uid()
  )
  on conflict(organization_id,product_id,environment) do update
  set external_tenant_id=excluded.external_tenant_id,
      status=excluded.status
  returning id into binding_id_value;

  perform public.write_audit_event(
    'product_tenant_binding.upserted','product_tenant_binding',binding_id_value::text,
    organization_id_value,btrim(reason_value),before_record,
    (select to_jsonb(binding) from public.product_tenant_bindings binding where binding.id=binding_id_value)
  );
  return binding_id_value;
end;
$$;

revoke all on function public.upsert_product_tenant_binding(uuid,text,public.product_endpoint_environment,text,text,text) from public;
grant execute on function public.upsert_product_tenant_binding(uuid,text,public.product_endpoint_environment,text,text,text) to authenticated;

alter table public.product_tenant_bindings enable row level security;
create policy product_tenant_bindings_staff_select
on public.product_tenant_bindings for select to authenticated using(public.is_platform_staff());

grant select on public.product_tenant_bindings to authenticated;
grant all on public.product_tenant_bindings to service_role;
revoke insert,update,delete on public.product_tenant_bindings from authenticated;

comment on table public.product_tenant_bindings is
  'Maps an IMDS control-plane organization to the tenant identifier owned by a specific product and environment.';
