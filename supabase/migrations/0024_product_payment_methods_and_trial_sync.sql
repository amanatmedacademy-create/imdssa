-- Per-product payment methods, billing entitlements and product-level renewal.
-- Keeps Super Admin as the commercial source of truth while each product only
-- receives the billing state that belongs to its own license.

alter table public.payments
  add column if not exists product_id uuid references public.products(id) on delete set null;

create index if not exists payments_product_received_idx
  on public.payments(product_id, received_at desc)
  where product_id is not null;

create table if not exists public.product_payment_methods (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  method public.payment_method not null,
  enabled boolean not null default true,
  is_default boolean not null default false,
  display_name text not null,
  instructions text,
  sort_order smallint not null default 100 check (sort_order between 0 and 1000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, method),
  check (char_length(btrim(display_name)) between 1 and 120),
  check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists product_payment_methods_one_default_idx
  on public.product_payment_methods(product_id)
  where enabled = true and is_default = true;

create index if not exists product_payment_methods_product_idx
  on public.product_payment_methods(product_id, enabled, sort_order, method);

create trigger product_payment_methods_set_updated_at
before update on public.product_payment_methods
for each row execute function public.set_updated_at();

-- Conservative defaults for Kazakhstan. Card/cash/other can be enabled per product
-- from Super Admin when the commercial flow is ready for that product.
insert into public.product_payment_methods(product_id, method, enabled, is_default, display_name, sort_order)
select p.id, 'bank_transfer'::public.payment_method, true, true, 'Банковский перевод', 10
from public.products p
where p.archived_at is null
on conflict(product_id, method) do nothing;

insert into public.product_payment_methods(product_id, method, enabled, is_default, display_name, sort_order)
select p.id, 'kaspi'::public.payment_method, true, false, 'Kaspi', 20
from public.products p
where p.archived_at is null
on conflict(product_id, method) do nothing;

-- The standard self-service trial is three days. Existing custom tariffs are not
-- touched; only the canonical trial tariff is normalized.
update public.tariffs
set trial_days = 3
where code = 'trial'
  and trial_days is distinct from 3;

create or replace function public.sync_license_billing_entitlements(target_license_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  license_record public.licenses%rowtype;
  subscription_record public.subscriptions%rowtype;
  tariff_record public.tariffs%rowtype;
  methods_value jsonb := '[]'::jsonb;
  default_method_value text;
  access_ends_at_value timestamptz;
  currency_value text := 'KZT';
  pair record;
begin
  select * into license_record
  from public.licenses
  where id = target_license_id;
  if not found or license_record.subscription_id is null then return; end if;

  select * into subscription_record
  from public.subscriptions
  where id = license_record.subscription_id;
  if not found then return; end if;

  if subscription_record.tariff_id is not null then
    select * into tariff_record
    from public.tariffs
    where id = subscription_record.tariff_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'method', ppm.method::text,
        'displayName', ppm.display_name,
        'instructions', ppm.instructions,
        'isDefault', ppm.is_default
      ) order by ppm.sort_order, ppm.method::text
    ),
    '[]'::jsonb
  ) into methods_value
  from public.product_payment_methods ppm
  where ppm.product_id = license_record.product_id
    and ppm.enabled = true;

  select ppm.method::text into default_method_value
  from public.product_payment_methods ppm
  where ppm.product_id = license_record.product_id
    and ppm.enabled = true
  order by ppm.is_default desc, ppm.sort_order, ppm.method::text
  limit 1;

  access_ends_at_value := case subscription_record.status
    when 'trial' then subscription_record.trial_ends_at
    when 'grace_period' then coalesce(subscription_record.grace_ends_at, license_record.expires_at, subscription_record.current_period_ends_at)
    else coalesce(license_record.expires_at, subscription_record.current_period_ends_at)
  end;

  currency_value := coalesce(
    nullif(subscription_record.metadata->>'currency', ''),
    nullif(tariff_record.currency, ''),
    'KZT'
  );

  for pair in
    select * from (values
      ('billing.subscription_status'::text, to_jsonb(subscription_record.status::text)),
      ('billing.trial_ends_at'::text, coalesce(to_jsonb(subscription_record.trial_ends_at), 'null'::jsonb)),
      ('billing.period_ends_at'::text, coalesce(to_jsonb(license_record.expires_at), to_jsonb(subscription_record.current_period_ends_at), 'null'::jsonb)),
      ('billing.grace_ends_at'::text, coalesce(to_jsonb(subscription_record.grace_ends_at), 'null'::jsonb)),
      ('billing.access_ends_at'::text, coalesce(to_jsonb(access_ends_at_value), 'null'::jsonb)),
      ('billing.renewal_mode'::text, to_jsonb(subscription_record.renewal_mode::text)),
      ('billing.currency'::text, to_jsonb(currency_value)),
      ('billing.payment_methods'::text, methods_value),
      ('billing.payment_method_default'::text, coalesce(to_jsonb(default_method_value), 'null'::jsonb))
    ) as valueset(key, value)
  loop
    insert into public.entitlements(license_id, key, value, source)
    values(target_license_id, pair.key, pair.value, 'billing')
    on conflict(license_id, key) do update
      set value = excluded.value,
          source = 'billing',
          updated_at = now()
      where public.entitlements.value is distinct from excluded.value
         or public.entitlements.source is distinct from 'billing';
  end loop;
end;
$$;

revoke all on function public.sync_license_billing_entitlements(uuid) from public;

create or replace function public.sync_product_billing_entitlements(target_product_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  license_record record;
  synced integer := 0;
begin
  for license_record in
    select id from public.licenses where product_id = target_product_id
  loop
    perform public.sync_license_billing_entitlements(license_record.id);
    synced := synced + 1;
  end loop;
  return synced;
end;
$$;

revoke all on function public.sync_product_billing_entitlements(uuid) from public;

create or replace function public.handle_product_payment_method_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_product_billing_entitlements(coalesce(new.product_id, old.product_id));
  return coalesce(new, old);
end;
$$;

revoke all on function public.handle_product_payment_method_sync() from public;

drop trigger if exists product_payment_methods_sync_licenses on public.product_payment_methods;
create trigger product_payment_methods_sync_licenses
after insert or update or delete on public.product_payment_methods
for each row execute function public.handle_product_payment_method_sync();

create or replace function public.handle_subscription_billing_entitlement_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  license_record record;
begin
  for license_record in
    select id from public.licenses where subscription_id = new.id
  loop
    perform public.sync_license_billing_entitlements(license_record.id);
  end loop;
  return new;
end;
$$;

revoke all on function public.handle_subscription_billing_entitlement_sync() from public;

drop trigger if exists subscriptions_sync_billing_entitlements on public.subscriptions;
create trigger subscriptions_sync_billing_entitlements
after insert or update of status, trial_ends_at, current_period_ends_at, grace_ends_at, renewal_mode, metadata
on public.subscriptions
for each row execute function public.handle_subscription_billing_entitlement_sync();

create or replace function public.handle_license_billing_entitlement_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_license_billing_entitlements(new.id);
  return new;
end;
$$;

revoke all on function public.handle_license_billing_entitlement_sync() from public;

drop trigger if exists licenses_sync_billing_entitlements on public.licenses;
create trigger licenses_sync_billing_entitlements
after insert or update of subscription_id, expires_at
on public.licenses
for each row execute function public.handle_license_billing_entitlement_sync();

create or replace function public.set_product_payment_methods(
  target_product_id uuid,
  methods_value jsonb,
  reason_value text default 'Product payment methods updated'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  method_value public.payment_method;
  enabled_value boolean;
  default_value boolean;
  display_name_value text;
  instructions_value text;
  sort_order_value smallint;
  enabled_count integer;
  default_count integer;
begin
  if not public.can_manage_billing() then
    raise exception 'Insufficient permission to manage product payment methods';
  end if;
  if not exists(select 1 from public.products where id = target_product_id and archived_at is null) then
    raise exception 'Active product not found';
  end if;
  if jsonb_typeof(coalesce(methods_value, 'null'::jsonb)) <> 'array' then
    raise exception 'Payment methods must be a JSON array';
  end if;
  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Administrative reason is required';
  end if;

  update public.product_payment_methods
  set enabled = false,
      is_default = false
  where product_id = target_product_id;

  for item in select value from jsonb_array_elements(methods_value)
  loop
    method_value := (item->>'method')::public.payment_method;
    enabled_value := coalesce((item->>'enabled')::boolean, true);
    default_value := coalesce((item->>'isDefault')::boolean, false) and enabled_value;
    display_name_value := coalesce(nullif(btrim(item->>'displayName'), ''), initcap(replace(method_value::text, '_', ' ')));
    instructions_value := nullif(btrim(item->>'instructions'), '');
    sort_order_value := greatest(0, least(1000, coalesce((item->>'sortOrder')::smallint, 100)));

    insert into public.product_payment_methods(
      product_id, method, enabled, is_default, display_name, instructions, sort_order
    ) values(
      target_product_id, method_value, enabled_value, default_value,
      display_name_value, instructions_value, sort_order_value
    )
    on conflict(product_id, method) do update
      set enabled = excluded.enabled,
          is_default = excluded.is_default,
          display_name = excluded.display_name,
          instructions = excluded.instructions,
          sort_order = excluded.sort_order;
  end loop;

  select count(*) into enabled_count
  from public.product_payment_methods
  where product_id = target_product_id and enabled = true;
  if enabled_count = 0 then raise exception 'At least one payment method must remain enabled'; end if;

  select count(*) into default_count
  from public.product_payment_methods
  where product_id = target_product_id and enabled = true and is_default = true;
  if default_count > 1 then raise exception 'Only one default payment method is allowed'; end if;
  if default_count = 0 then
    update public.product_payment_methods
    set is_default = true
    where id = (
      select id from public.product_payment_methods
      where product_id = target_product_id and enabled = true
      order by sort_order, method::text
      limit 1
    );
  end if;

  perform public.sync_product_billing_entitlements(target_product_id);
  perform public.write_audit_event(
    'billing.product_payment_methods.updated', 'product', target_product_id::text,
    null, btrim(reason_value), null,
    jsonb_build_object('methods', methods_value)
  );
end;
$$;

revoke all on function public.set_product_payment_methods(uuid, jsonb, text) from public;
grant execute on function public.set_product_payment_methods(uuid, jsonb, text) to authenticated;

create or replace function public.record_product_payment_and_extend(
  organization_id_value uuid,
  product_id_value uuid,
  subscription_id_value uuid,
  amount_value numeric,
  currency_value text,
  method_value public.payment_method,
  period_months_value integer,
  received_at_value timestamptz default now(),
  external_reference_value text default null,
  payer_name_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  license_record public.licenses%rowtype;
  subscription_record public.subscriptions%rowtype;
  billing_account_id_value uuid;
  payment_id_value uuid;
  new_expires_at timestamptz;
begin
  if not public.can_manage_billing() then
    raise exception 'Insufficient permission to record product payment';
  end if;
  if amount_value <= 0 then raise exception 'Payment amount must be positive'; end if;
  if period_months_value < 1 or period_months_value > 24 then
    raise exception 'Renewal period must be between 1 and 24 months';
  end if;
  if not exists(
    select 1 from public.product_payment_methods ppm
    where ppm.product_id = product_id_value
      and ppm.method = method_value
      and ppm.enabled = true
  ) then
    raise exception 'Selected payment method is disabled for this product';
  end if;

  select * into subscription_record
  from public.subscriptions
  where id = subscription_id_value
    and organization_id = organization_id_value
  for update;
  if not found then raise exception 'Subscription not found'; end if;
  if subscription_record.status = 'cancelled' then
    raise exception 'Cancelled subscription requires a new subscription';
  end if;

  select * into license_record
  from public.licenses
  where organization_id = organization_id_value
    and product_id = product_id_value
    and subscription_id = subscription_id_value
  for update;
  if not found then raise exception 'Product license not found in subscription'; end if;

  select id into billing_account_id_value
  from public.billing_accounts
  where organization_id = organization_id_value;
  if billing_account_id_value is null then
    insert into public.billing_accounts(organization_id, legal_name, currency, billing_email)
    select id, name, upper(currency_value), metadata->>'billing_email'
    from public.organizations
    where id = organization_id_value
    returning id into billing_account_id_value;
  end if;
  if billing_account_id_value is null then raise exception 'Organization not found'; end if;

  payment_id_value := public.record_payment(
    organization_id_value,
    amount_value,
    upper(currency_value),
    method_value,
    coalesce(received_at_value, now()),
    external_reference_value,
    payer_name_value
  );

  update public.payments
  set product_id = product_id_value,
      metadata = metadata || jsonb_build_object(
        'subscriptionId', subscription_id_value,
        'licenseId', license_record.id,
        'renewalMonths', period_months_value
      )
  where id = payment_id_value;

  new_expires_at := greatest(coalesce(license_record.expires_at, now()), now())
    + make_interval(months => period_months_value);

  update public.licenses
  set expires_at = new_expires_at,
      status = case when external_tenant_id is null then 'pending' else 'active' end,
      suspended_at = null,
      revoked_at = null
  where id = license_record.id;

  update public.subscriptions
  set status = 'active',
      activated_at = coalesce(activated_at, now()),
      current_period_ends_at = greatest(coalesce(current_period_ends_at, new_expires_at), new_expires_at),
      grace_ends_at = null
  where id = subscription_id_value;

  update public.organizations
  set status = 'active'
  where id = organization_id_value
    and status in ('trial','past_due','grace_period','suspended','onboarding');

  if license_record.external_tenant_id is not null and license_record.status in ('suspended','revoked','failed') then
    perform public.enqueue_license_command_internal(
      license_record.id,
      'resume_tenant',
      'Product access restored after successful payment',
      auth.uid(),
      jsonb_build_object('payment_id', payment_id_value),
      concat('payment:', payment_id_value::text, ':license:', license_record.id::text, ':resume')
    );
  end if;

  perform public.sync_license_billing_entitlements(license_record.id);

  insert into public.subscription_events(
    subscription_id, organization_id, event_type, from_status, to_status,
    reason, actor_user_id, metadata
  ) values(
    subscription_id_value, organization_id_value,
    'subscription.product_renewed', subscription_record.status, 'active',
    'Product renewed after payment', auth.uid(),
    jsonb_build_object(
      'product_id', product_id_value,
      'license_id', license_record.id,
      'payment_id', payment_id_value,
      'payment_method', method_value::text,
      'period_months', period_months_value,
      'expires_at', new_expires_at
    )
  );

  perform public.write_audit_event(
    'billing.product_renewed', 'license', license_record.id::text,
    organization_id_value, 'Product renewed after payment',
    to_jsonb(license_record),
    jsonb_build_object(
      'paymentId', payment_id_value,
      'paymentMethod', method_value::text,
      'renewalMonths', period_months_value,
      'expiresAt', new_expires_at
    )
  );

  return jsonb_build_object(
    'payment_id', payment_id_value,
    'license_id', license_record.id,
    'subscription_id', subscription_id_value,
    'product_id', product_id_value,
    'expires_at', new_expires_at,
    'status', 'active'
  );
end;
$$;

revoke all on function public.record_product_payment_and_extend(uuid, uuid, uuid, numeric, text, public.payment_method, integer, timestamptz, text, text) from public;
grant execute on function public.record_product_payment_and_extend(uuid, uuid, uuid, numeric, text, public.payment_method, integer, timestamptz, text, text) to authenticated;

alter table public.product_payment_methods enable row level security;
create policy product_payment_methods_staff_select
on public.product_payment_methods
for select to authenticated
using(public.is_platform_staff());

grant select on public.product_payment_methods to authenticated;
grant all on public.product_payment_methods to service_role;
revoke insert, update, delete on public.product_payment_methods from authenticated;

-- Materialize billing metadata for licenses that predate this migration.
do $$
declare license_record record;
begin
  for license_record in select id from public.licenses loop
    perform public.sync_license_billing_entitlements(license_record.id);
  end loop;
end;
$$;

comment on table public.product_payment_methods is
  'Payment methods enabled for a specific IMDS product. The configuration is synchronized to that product as billing entitlements.';
