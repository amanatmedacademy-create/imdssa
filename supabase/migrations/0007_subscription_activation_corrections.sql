-- Correct subscription activation so custom tariffs may select arbitrary active
-- products, while standard tariffs remain limited to their declared package.

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
  product_id_value uuid;
  product_limits jsonb;
  product_entitlements jsonb;
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
    select coalesce(array_agg(distinct product_id order by product_id), '{}'::uuid[])
      into selected_ids
    from public.tariff_products
    where tariff_id = target_tariff_id and included = true;
  else
    select coalesce(array_agg(distinct selected_id order by selected_id), '{}'::uuid[])
      into selected_ids
    from unnest(selected_product_ids) selected_id;
  end if;

  if cardinality(selected_ids) = 0 then
    raise exception 'Subscription must include at least one product';
  end if;

  if exists (
    select 1 from unnest(selected_ids) selected_id
    where not exists (
      select 1 from public.products p
      where p.id = selected_id and p.archived_at is null and p.status <> 'disabled'
    )
  ) then
    raise exception 'One or more subscription products do not exist, are disabled, or are archived';
  end if;

  if not tariff_record.is_custom and exists (
    select 1 from unnest(selected_ids) selected_id
    where not exists (
      select 1 from public.tariff_products tp
      where tp.tariff_id = target_tariff_id
        and tp.product_id = selected_id
        and tp.included = true
    )
  ) then
    raise exception 'Standard tariff can include only products declared in its package';
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

  foreach product_id_value in array selected_ids loop
    select
      coalesce(tp.limits, '{}'::jsonb),
      coalesce(tp.entitlements, '{}'::jsonb)
    into product_limits, product_entitlements
    from public.tariff_products tp
    where tp.tariff_id = target_tariff_id
      and tp.product_id = product_id_value;

    product_limits := coalesce(product_limits, '{}'::jsonb);
    product_entitlements := coalesce(product_entitlements, '{}'::jsonb);

    insert into public.licenses (
      organization_id, product_id, subscription_id, status, expires_at
    ) values (
      target_organization_id,
      product_id_value,
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
      select key, value from jsonb_each(product_entitlements)
    loop
      insert into public.entitlements (license_id, key, value, source)
      values (license_id_value, entitlement_record.key, entitlement_record.value, 'tariff')
      on conflict (license_id, key) do update
        set value = excluded.value,
            source = 'tariff';
    end loop;

    for entitlement_record in
      select key, value from jsonb_each(product_limits)
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
