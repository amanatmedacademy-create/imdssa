-- Provider catalogue administration and database-level lifecycle guards.

alter table public.integration_providers
  add column if not exists is_system boolean not null default false,
  add column if not exists archived_at timestamptz;

update public.integration_providers
set is_system = true
where key in (
  'meta_ads',
  'whatsapp_business',
  'tiktok_ads',
  'google_ads',
  'kaspi',
  'medvoice',
  'email',
  'sms',
  'cloudflare',
  'workplace',
  'telephony'
);

create index integration_providers_active_idx
on public.integration_providers (status, category)
where archived_at is null;

create or replace function public.save_integration_provider(
  provider_id_value uuid,
  key_value text,
  name_value text,
  category_value text,
  status_value public.integration_provider_status,
  description_value text,
  auth_types_value public.integration_auth_type[],
  capabilities_value text[],
  supports_webhooks_value boolean,
  supports_incremental_sync_value boolean,
  supports_token_refresh_value boolean,
  documentation_url_value text,
  config_schema_value jsonb,
  reason_value text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  before_record jsonb;
  existing_record public.integration_providers%rowtype;
  normalized_key text := lower(btrim(coalesce(key_value, '')));
  normalized_category text := lower(btrim(coalesce(category_value, '')));
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if normalized_key !~ '^[a-z0-9][a-z0-9._-]+$' then
    raise exception 'Provider key format is invalid';
  end if;

  if normalized_category !~ '^[a-z0-9][a-z0-9._-]+$' then
    raise exception 'Provider category format is invalid';
  end if;

  if char_length(btrim(coalesce(name_value, ''))) < 2 then
    raise exception 'Provider name is required';
  end if;

  if cardinality(coalesce(auth_types_value, '{}'::public.integration_auth_type[])) = 0 then
    raise exception 'At least one authentication type is required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  if documentation_url_value is not null
     and btrim(documentation_url_value) <> ''
     and documentation_url_value !~ '^https://' then
    raise exception 'Documentation URL must use HTTPS';
  end if;

  if provider_id_value is null then
    insert into public.integration_providers (
      key,
      name,
      category,
      status,
      description,
      auth_types,
      capabilities,
      supports_webhooks,
      supports_incremental_sync,
      supports_token_refresh,
      documentation_url,
      config_schema,
      is_system
    ) values (
      normalized_key,
      btrim(name_value),
      normalized_category,
      status_value,
      nullif(btrim(description_value), ''),
      auth_types_value,
      coalesce(capabilities_value, '{}'::text[]),
      supports_webhooks_value,
      supports_incremental_sync_value,
      supports_token_refresh_value,
      nullif(btrim(documentation_url_value), ''),
      coalesce(config_schema_value, '{}'::jsonb),
      false
    ) returning id into result_id;
  else
    select * into existing_record
    from public.integration_providers
    where id = provider_id_value
      and archived_at is null
    for update;

    if not found then
      raise exception 'Integration provider not found';
    end if;

    if existing_record.is_system and normalized_key <> existing_record.key then
      raise exception 'System provider key is immutable';
    end if;

    before_record := to_jsonb(existing_record);

    update public.integration_providers
    set key = normalized_key,
        name = btrim(name_value),
        category = normalized_category,
        status = status_value,
        description = nullif(btrim(description_value), ''),
        auth_types = auth_types_value,
        capabilities = coalesce(capabilities_value, '{}'::text[]),
        supports_webhooks = supports_webhooks_value,
        supports_incremental_sync = supports_incremental_sync_value,
        supports_token_refresh = supports_token_refresh_value,
        documentation_url = nullif(btrim(documentation_url_value), ''),
        config_schema = coalesce(config_schema_value, '{}'::jsonb)
    where id = provider_id_value
    returning id into result_id;

    update public.integrations
    set provider_key = normalized_key
    where provider_id = provider_id_value;
  end if;

  perform public.write_audit_event(
    case when provider_id_value is null then 'integration.provider.created' else 'integration.provider.updated' end,
    'integration_provider',
    result_id::text,
    null,
    reason_value,
    before_record,
    (select to_jsonb(provider) from public.integration_providers provider where provider.id = result_id)
  );

  return result_id;
end;
$$;

create or replace function public.archive_integration_provider(
  provider_id_value uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_record public.integration_providers%rowtype;
  retained_connections integer;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into provider_record
  from public.integration_providers
  where id = provider_id_value
    and archived_at is null
  for update;

  if not found then
    raise exception 'Integration provider not found';
  end if;

  if provider_record.is_system then
    raise exception 'System provider cannot be archived';
  end if;

  select count(*) into retained_connections
  from public.integrations
  where provider_id = provider_id_value
    and archived_at is null;

  if retained_connections > 0 then
    raise exception 'Provider has % retained connections and cannot be archived', retained_connections;
  end if;

  update public.integration_providers
  set status = 'disabled',
      archived_at = now()
  where id = provider_id_value;

  perform public.write_audit_event(
    'integration.provider.archived',
    'integration_provider',
    provider_id_value::text,
    null,
    reason_value,
    to_jsonb(provider_record),
    jsonb_build_object('status', 'disabled', 'archivedAt', now())
  );
end;
$$;

create or replace function public.guard_integration_connection_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'Revoked integration connection cannot be reactivated';
  end if;

  if new.status = 'connected' and new.connected_at is null then
    raise exception 'Connected integration must have connected_at';
  end if;

  if new.status = 'revoked' and new.archived_at is null then
    raise exception 'Revoked integration must be archived';
  end if;

  if new.archived_at is not null and new.status <> 'revoked' then
    raise exception 'Only revoked integration may be archived';
  end if;

  return new;
end;
$$;

create trigger integrations_guard_state
before update on public.integrations
for each row execute function public.guard_integration_connection_state();

create or replace function public.guard_integration_job_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('succeeded','cancelled','dead_letter') and new.status <> old.status then
    if not (old.status = 'dead_letter' and new.status = 'queued') then
      raise exception 'Terminal integration job state cannot be reopened';
    end if;
  end if;

  if new.status = 'processing' and (new.locked_at is null or new.locked_by is null) then
    raise exception 'Processing integration job requires a worker lease';
  end if;

  if new.status <> 'processing' and (new.locked_at is not null or new.locked_by is not null) then
    raise exception 'Non-processing integration job cannot retain a worker lease';
  end if;

  return new;
end;
$$;

create trigger integration_jobs_guard_state
before update on public.integration_jobs
for each row execute function public.guard_integration_job_state();

create or replace function public.guard_outbound_delivery_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('succeeded','cancelled','dead_letter') and new.status <> old.status then
    if not (old.status = 'dead_letter' and new.status = 'queued') then
      raise exception 'Terminal webhook delivery state cannot be reopened';
    end if;
  end if;

  if new.status = 'processing' and (new.locked_at is null or new.locked_by is null) then
    raise exception 'Processing delivery requires a worker lease';
  end if;

  if new.status <> 'processing' and (new.locked_at is not null or new.locked_by is not null) then
    raise exception 'Non-processing delivery cannot retain a worker lease';
  end if;

  return new;
end;
$$;

create trigger outbound_webhook_deliveries_guard_state
before update on public.outbound_webhook_deliveries
for each row execute function public.guard_outbound_delivery_state();

revoke all on function public.save_integration_provider(uuid, text, text, text, public.integration_provider_status, text, public.integration_auth_type[], text[], boolean, boolean, boolean, text, jsonb, text) from public;
revoke all on function public.archive_integration_provider(uuid, text) from public;
revoke all on function public.guard_integration_connection_state() from public;
revoke all on function public.guard_integration_job_state() from public;
revoke all on function public.guard_outbound_delivery_state() from public;

grant execute on function public.save_integration_provider(uuid, text, text, text, public.integration_provider_status, text, public.integration_auth_type[], text[], boolean, boolean, boolean, text, jsonb, text) to authenticated;
grant execute on function public.archive_integration_provider(uuid, text) to authenticated;

comment on function public.save_integration_provider(uuid, text, text, text, public.integration_provider_status, text, public.integration_auth_type[], text[], boolean, boolean, boolean, text, jsonb, text) is
  'Creates or updates system/custom provider metadata without exposing credentials.';
comment on function public.archive_integration_provider(uuid, text) is
  'Archives custom providers only after all retained connections are removed.';
