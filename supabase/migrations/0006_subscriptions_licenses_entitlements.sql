-- Tariffs, subscriptions, licenses and entitlements.
-- This layer converts commercial plans into explicit product access without
-- placing operational product data in the Super Admin database.

create type public.billing_interval as enum ('monthly', 'annual', 'custom');
create type public.renewal_mode as enum ('manual', 'automatic');
create type public.entitlement_value_type as enum ('boolean', 'integer', 'number', 'string', 'json');

create or replace function public.guard_product_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived_at is not null and new.status <> 'disabled' then
    raise exception 'Archived product must remain disabled until restored through restore_product()';
  end if;

  if old.archived_at is not null and new.archived_at is null and not public.can_manage_products() then
    raise exception 'Insufficient permission to restore product';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_product_lifecycle() from public;

drop trigger if exists products_guard_lifecycle on public.products;
create trigger products_guard_lifecycle
before update on public.products
for each row execute function public.guard_product_lifecycle();

alter table public.tariffs
  add column if not exists code text,
  add column if not exists description text,
  add column if not exists grace_days integer not null default 7,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

update public.tariffs
set code = coalesce(
  nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''),
  'tariff-' || substr(id::text, 1, 8)
)
where code is null;

alter table public.tariffs alter column code set not null;
create unique index if not exists tariffs_code_unique on public.tariffs(code);

alter table public.subscriptions
  add column if not exists billing_interval public.billing_interval not null default 'monthly',
  add column if not exists renewal_mode public.renewal_mode not null default 'manual',
  add column if not exists activated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.licenses
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists suspended_at timestamptz,
  add column if not exists revoked_at timestamptz;

create trigger tariffs_set_updated_at
before update on public.tariffs
for each row execute function public.set_updated_at();

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create trigger licenses_set_updated_at
before update on public.licenses
for each row execute function public.set_updated_at();

create table public.tariff_products (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null references public.tariffs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  included boolean not null default true,
  limits jsonb not null default '{}'::jsonb,
  entitlements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tariff_id, product_id),
  check (jsonb_typeof(limits) = 'object'),
  check (jsonb_typeof(entitlements) = 'object')
);

create trigger tariff_products_set_updated_at
before update on public.tariff_products
for each row execute function public.set_updated_at();

create table public.entitlement_definitions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  value_type public.entitlement_value_type not null,
  default_value jsonb,
  is_metered boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, key),
  check (key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
);

create trigger entitlement_definitions_set_updated_at
before update on public.entitlement_definitions
for each row execute function public.set_updated_at();

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  from_status public.subscription_status,
  to_status public.subscription_status,
  reason text,
  actor_user_id uuid references public.platform_users(id),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index tariff_products_tariff_idx on public.tariff_products(tariff_id);
create index tariff_products_product_idx on public.tariff_products(product_id);
create index entitlement_definitions_product_idx on public.entitlement_definitions(product_id, is_active);
create index subscription_events_subscription_time_idx on public.subscription_events(subscription_id, occurred_at desc);
create index licenses_subscription_idx on public.licenses(subscription_id, status);

alter table public.tariff_products enable row level security;
alter table public.entitlement_definitions enable row level security;
alter table public.subscription_events enable row level security;

create policy tariff_products_select on public.tariff_products
for select to authenticated using (public.is_platform_staff());
create policy tariff_products_manage on public.tariff_products
for all to authenticated
using (public.can_manage_billing())
with check (public.can_manage_billing());

create policy entitlement_definitions_select on public.entitlement_definitions
for select to authenticated using (public.is_platform_staff());
create policy entitlement_definitions_manage on public.entitlement_definitions
for all to authenticated
using (public.has_global_role(array[
  'platform_owner'::public.global_role,
  'super_admin'::public.global_role,
  'finance_admin'::public.global_role,
  'technical_admin'::public.global_role
]))
with check (public.has_global_role(array[
  'platform_owner'::public.global_role,
  'super_admin'::public.global_role,
  'finance_admin'::public.global_role,
  'technical_admin'::public.global_role
]));

create policy subscription_events_select on public.subscription_events
for select to authenticated using (public.is_platform_staff());

create or replace function public.prevent_subscription_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Subscription events are append-only';
end;
$$;

revoke all on function public.prevent_subscription_event_mutation() from public;

create trigger subscription_events_immutable
before update or delete on public.subscription_events
for each row execute function public.prevent_subscription_event_mutation();

create or replace function public.upsert_tariff_definition(
  tariff_code text,
  tariff_name text,
  tariff_description text default null,
  currency_value text default 'KZT',
  monthly_price_value numeric default 0,
  annual_price_value numeric default null,
  trial_days_value integer default 0,
  grace_days_value integer default 7,
  is_custom_value boolean default false,
  is_active_value boolean default true,
  target_tariff_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  before_record jsonb;
begin
  if not public.can_manage_billing() then
    raise exception 'Insufficient permission to manage tariffs';
  end if;

  tariff_code := lower(nullif(btrim(tariff_code), ''));
  tariff_name := nullif(btrim(tariff_name), '');
  tariff_description := nullif(btrim(tariff_description), '');
  currency_value := upper(nullif(btrim(currency_value), ''));

  if tariff_code is null or tariff_code !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Tariff code is invalid';
  end if;
  if tariff_name is null then raise exception 'Tariff name is required'; end if;
  if currency_value is null or currency_value !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code';
  end if;
  if monthly_price_value < 0 or coalesce(annual_price_value, 0) < 0 then
    raise exception 'Tariff price cannot be negative';
  end if;
  if trial_days_value < 0 or trial_days_value > 365 then
    raise exception 'Trial days are outside the allowed range';
  end if;
  if grace_days_value < 0 or grace_days_value > 90 then
    raise exception 'Grace days are outside the allowed range';
  end if;

  if target_tariff_id is null then
    if exists (select 1 from public.tariffs where code = tariff_code) then
      raise exception 'Tariff code already exists';
    end if;

    insert into public.tariffs (
      code, name, description, currency, monthly_price, annual_price,
      trial_days, grace_days, is_custom, is_active, limits
    ) values (
      tariff_code, tariff_name, tariff_description, currency_value,
      monthly_price_value, annual_price_value, trial_days_value,
      grace_days_value, is_custom_value, is_active_value, '{}'::jsonb
    ) returning id into result_id;

    perform public.write_audit_event(
      'tariff.created', 'tariff', result_id::text, null,
      'Commercial tariff created', null,
      (select to_jsonb(t) from public.tariffs t where t.id = result_id)
    );
  else
    select to_jsonb(t) into before_record
    from public.tariffs t where t.id = target_tariff_id;
    if before_record is null then raise exception 'Tariff not found'; end if;

    if exists (select 1 from public.tariffs where id <> target_tariff_id and code = tariff_code) then
      raise exception 'Tariff code already exists';
    end if;

    update public.tariffs
    set code = tariff_code,
        name = tariff_name,
        description = tariff_description,
        currency = currency_value,
        monthly_price = monthly_price_value,
        annual_price = annual_price_value,
        trial_days = trial_days_value,
        grace_days = grace_days_value,
        is_custom = is_custom_value,
        is_active = is_active_value
    where id = target_tariff_id
    returning id into result_id;

    perform public.write_audit_event(
      'tariff.updated', 'tariff', result_id::text, null,
      'Commercial tariff updated', before_record,
      (select to_jsonb(t) from public.tariffs t where t.id = result_id)
    );
  end if;

  return result_id;
end;
$$;

revoke all on function public.upsert_tariff_definition(text, text, text, text, numeric, numeric, integer, integer, boolean, boolean, uuid) from public;
grant execute on function public.upsert_tariff_definition(text, text, text, text, numeric, numeric, integer, integer, boolean, boolean, uuid) to authenticated;

create or replace function public.set_tariff_products(
  target_tariff_id uuid,
  product_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  product_id_value uuid;
  normalized_ids uuid[] := coalesce(product_ids, '{}'::uuid[]);
begin
  if not public.can_manage_billing() then
    raise exception 'Insufficient permission to manage tariff products';
  end if;
  if not exists (select 1 from public.tariffs where id = target_tariff_id) then
    raise exception 'Tariff not found';
  end if;
  if exists (
    select 1 from unnest(normalized_ids) selected_id
    where not exists (select 1 from public.products p where p.id = selected_id and p.archived_at is null)
  ) then
    raise exception 'One or more selected products do not exist or are archived';
  end if;

  delete from public.tariff_products
  where tariff_id = target_tariff_id
    and not (product_id = any(normalized_ids));

  foreach product_id_value in array normalized_ids loop
    insert into public.tariff_products (tariff_id, product_id, included)
    values (target_tariff_id, product_id_value, true)
    on conflict (tariff_id, product_id) do update
      set included = true;
  end loop;

  perform public.write_audit_event(
    'tariff.products_changed', 'tariff', target_tariff_id::text, null,
    'Tariff product composition updated', null,
    jsonb_build_object('product_ids', to_jsonb(normalized_ids))
  );
end;
$$;

revoke all on function public.set_tariff_products(uuid, uuid[]) from public;
grant execute on function public.set_tariff_products(uuid, uuid[]) to authenticated;

create or replace function public.set_tariff_product_config(
  target_tariff_id uuid,
  target_product_id uuid,
  limits_value jsonb default '{}'::jsonb,
  entitlements_value jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_billing() then
    raise exception 'Insufficient permission to configure tariff product';
  end if;
  if jsonb_typeof(coalesce(limits_value, '{}'::jsonb)) <> 'object' then
    raise exception 'Limits must be a JSON object';
  end if;
  if jsonb_typeof(coalesce(entitlements_value, '{}'::jsonb)) <> 'object' then
    raise exception 'Entitlements must be a JSON object';
  end if;

  insert into public.tariff_products (
    tariff_id, product_id, included, limits, entitlements
  ) values (
    target_tariff_id, target_product_id, true,
    coalesce(limits_value, '{}'::jsonb),
    coalesce(entitlements_value, '{}'::jsonb)
  )
  on conflict (tariff_id, product_id) do update
    set included = true,
        limits = excluded.limits,
        entitlements = excluded.entitlements;
end;
$$;

revoke all on function public.set_tariff_product_config(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.set_tariff_product_config(uuid, uuid, jsonb, jsonb) to authenticated;

create or replace function public.activate_subscription(
  target_organization_id uuid,
  target_tariff_id uuid,
  billing_interval_value public.billing_interval default 'monthly',
  renewal_mode_value public.renewal_mode default 'manual',
  starts_at_value timestamptz default now(),
  custom_price_value numeric default null,
  selected_product_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tariff_record public.tariffs%rowtype;
  subscription_id_value uuid := gen_random_uuid();
  initial_status public.subscription_status;
  trial_end_value timestamptz;
  period_end_value timestamptz;
  selected_ids uuid[];
  tariff_product_record record;
  entitlement_record record;
  license_id_value uuid;
begin
  if not public.can_manage_billing() then
    raise exception 'Insufficient permission to activate subscriptions';
  end if;
  if not exists (select 1 from public.organizations where id = target_organization_id and status <> 'archived') then
    raise exception 'Active organization not found';
  end if;

  select * into tariff_record
  from public.tariffs
  where id = target_tariff_id and is_active = true and archived_at is null;
  if not found then raise exception 'Active tariff not found'; end if;

  if custom_price_value is not null and custom_price_value < 0 then
    raise exception 'Custom price cannot be negative';
  end if;

  if selected_product_ids is null or cardinality(selected_product_ids) = 0 then
    select coalesce(array_agg(product_id order by product_id), '{}'::uuid[])
      into selected_ids
    from public.tariff_products
    where tariff_id = target_tariff_id and included = true;
  else
    selected_ids := selected_product_ids;
  end if;

  if cardinality(selected_ids) = 0 then
    raise exception 'Subscription must include at least one product';
  end if;

  if exists (
    select 1 from unnest(selected_ids) selected_id
    where not exists (select 1 from public.products p where p.id = selected_id and p.archived_at is null)
  ) then
    raise exception 'One or more subscription products do not exist or are archived';
  end if;

  initial_status := case when tariff_record.trial_days > 0 then 'trial' else 'active' end;
  trial_end_value := case
    when tariff_record.trial_days > 0 then starts_at_value + make_interval(days => tariff_record.trial_days)
    else null
  end;
  period_end_value := case billing_interval_value
    when 'annual' then starts_at_value + interval '1 year'
    when 'monthly' then starts_at_value + interval '1 month'
    else null
  end;

  insert into public.subscriptions (
    id, organization_id, tariff_id, status, starts_at, trial_ends_at,
    current_period_ends_at, custom_price, billing_interval, renewal_mode,
    activated_at, metadata
  ) values (
    subscription_id_value,
    target_organization_id,
    target_tariff_id,
    initial_status,
    starts_at_value,
    trial_end_value,
    period_end_value,
    custom_price_value,
    billing_interval_value,
    renewal_mode_value,
    case when initial_status = 'active' then starts_at_value else null end,
    jsonb_build_object('currency', tariff_record.currency)
  );

  for tariff_product_record in
    select tp.product_id, tp.limits, tp.entitlements
    from public.tariff_products tp
    where tp.tariff_id = target_tariff_id
      and tp.product_id = any(selected_ids)
  loop
    insert into public.licenses (
      organization_id, product_id, subscription_id, status, expires_at
    ) values (
      target_organization_id,
      tariff_product_record.product_id,
      subscription_id_value,
      'pending',
      period_end_value
    )
    on conflict (organization_id, product_id) do update
      set subscription_id = excluded.subscription_id,
          status = case when public.licenses.status = 'active' then 'active' else 'pending' end,
          expires_at = excluded.expires_at,
          revoked_at = null,
          suspended_at = null
    returning id into license_id_value;

    for entitlement_record in
      select key, value from jsonb_each(coalesce(tariff_product_record.entitlements, '{}'::jsonb))
    loop
      insert into public.entitlements (license_id, key, value, source)
      values (license_id_value, entitlement_record.key, entitlement_record.value, 'tariff')
      on conflict (license_id, key) do update
        set value = excluded.value,
            source = 'tariff';
    end loop;

    for entitlement_record in
      select key, value from jsonb_each(coalesce(tariff_product_record.limits, '{}'::jsonb))
    loop
      insert into public.entitlements (license_id, key, value, source)
      values (license_id_value, 'limit.' || entitlement_record.key, entitlement_record.value, 'tariff')
      on conflict (license_id, key) do update
        set value = excluded.value,
            source = 'tariff';
    end loop;
  end loop;

  insert into public.subscription_events (
    subscription_id, organization_id, event_type, from_status, to_status,
    reason, actor_user_id, metadata
  ) values (
    subscription_id_value,
    target_organization_id,
    'subscription.created',
    null,
    initial_status,
    'Subscription activated from tariff',
    auth.uid(),
    jsonb_build_object('tariff_id', target_tariff_id, 'product_ids', to_jsonb(selected_ids))
  );

  perform public.write_audit_event(
    'subscription.created', 'subscription', subscription_id_value::text,
    target_organization_id, 'Subscription activated from tariff', null,
    (select to_jsonb(s) from public.subscriptions s where s.id = subscription_id_value)
  );

  return subscription_id_value;
end;
$$;

revoke all on function public.activate_subscription(uuid, uuid, public.billing_interval, public.renewal_mode, timestamptz, numeric, uuid[]) from public;
grant execute on function public.activate_subscription(uuid, uuid, public.billing_interval, public.renewal_mode, timestamptz, numeric, uuid[]) to authenticated;

create or replace function public.transition_subscription(
  target_subscription_id uuid,
  new_status public.subscription_status,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_record public.subscriptions%rowtype;
  transition_allowed boolean := false;
begin
  if not public.can_manage_billing() then
    raise exception 'Insufficient permission to transition subscriptions';
  end if;
  if length(btrim(coalesce(reason, ''))) < 5 then
    raise exception 'Transition reason must contain at least 5 characters';
  end if;

  select * into current_record
  from public.subscriptions
  where id = target_subscription_id
  for update;
  if not found then raise exception 'Subscription not found'; end if;
  if current_record.status = new_status then return; end if;

  transition_allowed := case current_record.status
    when 'trial' then new_status in ('active', 'cancelled', 'expired')
    when 'active' then new_status in ('past_due', 'suspended', 'cancelled', 'expired')
    when 'past_due' then new_status in ('active', 'grace_period', 'suspended', 'cancelled')
    when 'grace_period' then new_status in ('active', 'suspended', 'cancelled')
    when 'suspended' then new_status in ('active', 'cancelled', 'expired')
    when 'cancelled' then false
    when 'expired' then false
    else false
  end;

  if not transition_allowed then
    raise exception 'Transition from % to % is not allowed', current_record.status, new_status;
  end if;

  update public.subscriptions
  set status = new_status,
      activated_at = case when new_status = 'active' then coalesce(activated_at, now()) else activated_at end,
      grace_ends_at = case when new_status = 'grace_period' then now() + make_interval(days => coalesce((select grace_days from public.tariffs where id = current_record.tariff_id), 7)) else grace_ends_at end,
      cancelled_at = case when new_status = 'cancelled' then now() else cancelled_at end
  where id = target_subscription_id;

  if new_status = 'suspended' then
    update public.licenses
    set status = 'suspended', suspended_at = now()
    where subscription_id = target_subscription_id
      and status in ('pending', 'provisioning', 'active');
  elsif new_status = 'active' then
    update public.licenses
    set status = case when external_tenant_id is null then 'pending' else 'active' end,
        suspended_at = null,
        revoked_at = null
    where subscription_id = target_subscription_id
      and status = 'suspended';
  elsif new_status in ('cancelled', 'expired') then
    update public.licenses
    set status = 'revoked', revoked_at = now()
    where subscription_id = target_subscription_id
      and status <> 'revoked';
  end if;

  insert into public.subscription_events (
    subscription_id, organization_id, event_type, from_status, to_status,
    reason, actor_user_id
  ) values (
    target_subscription_id,
    current_record.organization_id,
    'subscription.status_changed',
    current_record.status,
    new_status,
    btrim(reason),
    auth.uid()
  );

  perform public.write_audit_event(
    'subscription.status_changed', 'subscription', target_subscription_id::text,
    current_record.organization_id, btrim(reason), to_jsonb(current_record),
    (select to_jsonb(s) from public.subscriptions s where s.id = target_subscription_id)
  );
end;
$$;

revoke all on function public.transition_subscription(uuid, public.subscription_status, text) from public;
grant execute on function public.transition_subscription(uuid, public.subscription_status, text) to authenticated;

create or replace function public.set_license_entitlement(
  target_license_id uuid,
  entitlement_key text,
  entitlement_value jsonb,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  license_record public.licenses%rowtype;
  before_record jsonb;
begin
  if not public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'finance_admin'::public.global_role,
    'technical_admin'::public.global_role
  ]) then
    raise exception 'Insufficient permission to override entitlements';
  end if;

  entitlement_key := lower(nullif(btrim(entitlement_key), ''));
  if entitlement_key is null or entitlement_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Entitlement key is invalid';
  end if;
  if length(btrim(coalesce(reason, ''))) < 5 then
    raise exception 'Override reason must contain at least 5 characters';
  end if;

  select * into license_record from public.licenses where id = target_license_id;
  if not found then raise exception 'License not found'; end if;

  select to_jsonb(e) into before_record
  from public.entitlements e
  where e.license_id = target_license_id and e.key = entitlement_key;

  insert into public.entitlements (license_id, key, value, source)
  values (target_license_id, entitlement_key, entitlement_value, 'override')
  on conflict (license_id, key) do update
    set value = excluded.value,
        source = 'override';

  perform public.write_audit_event(
    'license.entitlement_overridden', 'license', target_license_id::text,
    license_record.organization_id, btrim(reason), before_record,
    (select to_jsonb(e) from public.entitlements e where e.license_id = target_license_id and e.key = entitlement_key)
  );
end;
$$;

revoke all on function public.set_license_entitlement(uuid, text, jsonb, text) from public;
grant execute on function public.set_license_entitlement(uuid, text, jsonb, text) to authenticated;

comment on table public.tariff_products is
  'Products, limits and default entitlements included in a commercial tariff.';
comment on table public.entitlement_definitions is
  'Typed catalogue of product features and limits available for licensing.';
comment on table public.subscription_events is
  'Append-only commercial lifecycle history for one subscription.';
