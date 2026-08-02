-- Installation lifecycle guards and durable worker operations.

create or replace function public.preview_module_installation(
  organization_id_value uuid,
  module_code_value text,
  host_product_code_value text,
  price_code_value text,
  version_channel_value public.platform_module_channel,
  placement_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  org_record public.organizations%rowtype;
  module_record public.platform_modules%rowtype;
  host_record public.products%rowtype;
  version_record public.platform_module_versions%rowtype;
  price_record public.module_prices%rowtype;
  compatibility_record public.platform_module_compatibility%rowtype;
  compatibility_found boolean := false;
  dependency_codes text[] := '{}';
  errors text[] := '{}';
  warnings text[] := '{}';
  plan text[] := array['validate_entitlement','resolve_dependencies','ensure_workspace','ensure_main_pipeline','ensure_default_stages','ensure_owner_membership','register_event_subscriptions','health_check'];
begin
  if jsonb_typeof(coalesce(placement_value,'{}'::jsonb)) <> 'object' then
    errors := array_append(errors,'PLACEMENT_INVALID');
  elsif nullif(placement_value->>'route','') is null or (placement_value->>'route') !~ '^/' then
    errors := array_append(errors,'ROUTE_INVALID');
  elsif nullif(placement_value->>'slot','') is null then
    errors := array_append(errors,'PLACEMENT_SLOT_REQUIRED');
  end if;

  select * into org_record from public.organizations where id=organization_id_value and archived_at is null;
  if not found or org_record.status::text <> 'active' then errors := array_append(errors,'TENANT_NOT_ACTIVE'); end if;

  select * into module_record from public.platform_modules where code=module_code_value;
  if not found or module_record.status <> 'published' then errors := array_append(errors,'MODULE_NOT_PUBLISHED'); end if;

  select * into host_record from public.products where key=host_product_code_value and archived_at is null;
  if not found or host_record.status::text not in ('active','degraded','maintenance') then errors := array_append(errors,'HOST_PRODUCT_NOT_ACTIVE'); end if;

  if module_record.id is not null and host_record.id is not null then
    select * into compatibility_record
    from public.platform_module_compatibility
    where module_id=module_record.id and host_product_id=host_record.id;
    compatibility_found := found;
    if not compatibility_found or not compatibility_record.supported then
      errors := array_append(errors,'MODULE_NOT_COMPATIBLE');
    elsif cardinality(compatibility_record.placement_slots)>0
      and not ((placement_value->>'slot') = any(compatibility_record.placement_slots)) then
      errors := array_append(errors,'PLACEMENT_NOT_SUPPORTED');
    end if;
  end if;

  if module_record.id is not null then
    select * into version_record
    from public.platform_module_versions
    where module_id=module_record.id and channel=version_channel_value and status='published'
    order by published_at desc nulls last, created_at desc
    limit 1;
    if not found then errors := array_append(errors,'MODULE_VERSION_NOT_PUBLISHED'); end if;

    select coalesce(array_agg(m.code order by m.code),'{}') into dependency_codes
    from public.platform_module_dependencies d
    join public.platform_modules m on m.id=d.dependency_module_id
    where d.module_id=module_record.id and d.required;
  end if;

  select * into price_record
  from public.module_prices
  where code=price_code_value and status='active'
    and valid_from<=now() and (valid_to is null or valid_to>now());
  if not found or (module_record.id is not null and price_record.module_id<>module_record.id) then
    errors := array_append(errors,'PRICE_NOT_ACTIVE');
  end if;

  if module_record.id is not null and host_record.id is not null and exists(
    select 1 from public.module_installations
    where organization_id=organization_id_value and module_id=module_record.id
      and host_product_id=host_record.id and status not in ('archived','uninstalling')
  ) then errors:=array_append(errors,'INSTALLATION_ALREADY_EXISTS'); end if;

  if host_record.id is not null and nullif(placement_value->>'route','') is not null and exists(
    select 1 from public.module_installations
    where organization_id=organization_id_value and host_product_id=host_record.id
      and placement->>'route'=placement_value->>'route'
      and status not in ('archived','uninstalling')
  ) then errors:=array_append(errors,'ROUTE_CONFLICT'); end if;

  if cardinality(dependency_codes)>0 then
    warnings := array_append(warnings,'REQUIRED_DEPENDENCIES_WILL_BE_VALIDATED');
  end if;

  return jsonb_build_object(
    'compatible',cardinality(errors)=0,
    'selectedVersion',version_record.version,
    'dependencies',dependency_codes,
    'monthlyAmountMinor',price_record.amount_minor,
    'currency',price_record.currency,
    'warnings',warnings,
    'errors',errors,
    'provisioningPlan',plan
  );
end;
$$;

create or replace function public.guard_module_installation_transition()
returns trigger
language plpgsql
set search_path=public
as $$
declare allowed boolean := false;
begin
  if old.status = new.status then return new; end if;
  allowed := case old.status
    when 'draft' then new.status in ('pending_payment','validating','archived')
    when 'pending_payment' then new.status in ('validating','failed','archived')
    when 'validating' then new.status in ('provisioning','failed')
    when 'provisioning' then new.status in ('active','failed')
    when 'active' then new.status in ('read_only','suspended','failed','uninstalling')
    when 'read_only' then new.status in ('active','suspended','uninstalling')
    when 'suspended' then new.status in ('provisioning','active','uninstalling')
    when 'failed' then new.status in ('provisioning','archived')
    when 'uninstalling' then new.status='archived'
    else false
  end;
  if not allowed then raise exception 'Installation transition % -> % is not allowed',old.status,new.status; end if;
  if new.status='active' and new.health_status<>'healthy' then raise exception 'Healthy installation health is required before activation'; end if;
  if new.status='suspended' then new.suspended_at:=coalesce(new.suspended_at,now()); end if;
  if new.status='active' then new.suspended_at:=null; end if;
  if new.status='archived' then new.archived_at:=coalesce(new.archived_at,now()); end if;
  return new;
end;
$$;

drop trigger if exists module_installation_transition_guard on public.module_installations;
create trigger module_installation_transition_guard
before update of status on public.module_installations
for each row execute function public.guard_module_installation_transition();

create or replace function public.claim_installation_jobs(worker_id_value text,limit_value integer default 10)
returns setof public.installation_jobs
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
  if nullif(btrim(worker_id_value),'') is null then raise exception 'Worker ID is required'; end if;
  return query
  with claimed as (
    select id from public.installation_jobs
    where status in ('queued','failed') and available_at<=now() and attempt_count<max_attempts
      and (locked_at is null or locked_at<now()-interval '15 minutes')
    order by available_at,created_at
    for update skip locked
    limit greatest(1,least(limit_value,100))
  )
  update public.installation_jobs job
  set status='processing',locked_at=now(),locked_by=worker_id_value,
      started_at=coalesce(started_at,now()),attempt_count=attempt_count+1
  from claimed where job.id=claimed.id
  returning job.*;
end;
$$;

create or replace function public.complete_installation_job(
  job_id_value uuid,
  worker_id_value text,
  succeeded_value boolean,
  health_status_value public.installation_health_status default 'unknown',
  current_step_value text default null,
  result_value jsonb default '{}'::jsonb,
  error_value text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare job_record public.installation_jobs%rowtype; installation_record public.module_installations%rowtype; delay interval;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
  select * into job_record from public.installation_jobs where id=job_id_value for update;
  if not found then raise exception 'Installation job not found'; end if;
  if job_record.status<>'processing' or job_record.locked_by is distinct from worker_id_value then raise exception 'Worker does not own this job'; end if;
  select * into installation_record from public.module_installations where id=job_record.installation_id for update;

  if succeeded_value then
    if job_record.operation in ('install','upgrade','repair','resume') and health_status_value<>'healthy' then
      raise exception 'Successful provisioning requires healthy result';
    end if;
    update public.installation_jobs set status='succeeded',progress=100,current_step=coalesce(current_step_value,'completed'),
      result=coalesce(result_value,'{}'),last_error=null,locked_at=null,locked_by=null,finished_at=now()
    where id=job_id_value;

    if job_record.operation in ('install','upgrade','repair','resume') then
      update public.module_entitlements set status='active' where id=installation_record.entitlement_id;
      update public.module_installations set status='active',health_status=health_status_value,last_health_at=now(),last_error=null where id=installation_record.id;
    elsif job_record.operation='suspend' then
      update public.module_entitlements set status='suspended' where id=installation_record.entitlement_id;
      update public.module_installations set status='suspended',health_status=health_status_value where id=installation_record.id;
    elsif job_record.operation='uninstall' then
      update public.module_entitlements set status='revoked' where id=installation_record.entitlement_id;
      update public.module_installations set status='archived',health_status='unknown' where id=installation_record.id;
    elsif job_record.operation='health_check' then
      update public.module_installations set health_status=health_status_value,last_health_at=now(),last_error=null where id=installation_record.id;
    end if;
  else
    delay:=make_interval(secs=>least(900,30*power(2,greatest(job_record.attempt_count-1,0))::integer));
    update public.installation_jobs set
      status=case when attempt_count>=max_attempts then 'dead_letter' else 'failed' end,
      current_step=coalesce(current_step_value,current_step),last_error=nullif(error_value,''),
      result=coalesce(result_value,'{}'),available_at=now()+delay,locked_at=null,locked_by=null,
      finished_at=case when attempt_count>=max_attempts then now() else null end
    where id=job_id_value;
    update public.module_installations set status='failed',health_status='failed',last_error=error_value where id=installation_record.id;
  end if;

  insert into public.platform_outbox_events(event_type,aggregate_type,aggregate_id,organization_id,payload)
  values(
    case when succeeded_value then 'platform.installation.job_succeeded' else 'platform.installation.job_failed' end,
    'installation_job',job_id_value,installation_record.organization_id,
    jsonb_build_object('jobId',job_id_value,'installationId',installation_record.id,'operation',job_record.operation,'error',error_value)
  );
end;
$$;

create or replace function public.enqueue_installation_operation(
  installation_id_value uuid,
  operation_value public.installation_operation,
  reason_value text,
  idempotency_key_value text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare installation_record public.module_installations%rowtype; job_id_value uuid;
begin
  if not (public.can_manage_modules() or public.can_manage_operations()) then raise exception 'Insufficient permission'; end if;
  if char_length(btrim(reason_value))<10 then raise exception 'Administrative reason is required'; end if;
  select * into installation_record from public.module_installations where id=installation_id_value for update;
  if not found then raise exception 'Installation not found'; end if;
  if operation_value='suspend' and installation_record.status not in ('active','read_only') then raise exception 'Installation cannot be suspended'; end if;
  if operation_value='resume' and installation_record.status<>'suspended' then raise exception 'Installation cannot be resumed'; end if;
  if operation_value='uninstall' and installation_record.status not in ('active','read_only','suspended','failed') then raise exception 'Installation cannot be uninstalled'; end if;
  if operation_value in ('repair','upgrade') and installation_record.status not in ('active','failed','suspended') then raise exception 'Installation operation is not allowed'; end if;

  if operation_value in ('install','upgrade','repair','resume') then
    update public.module_installations set status='provisioning' where id=installation_id_value;
  elsif operation_value='uninstall' then
    update public.module_installations set status='uninstalling' where id=installation_id_value;
  end if;

  insert into public.installation_jobs(installation_id,operation,status,current_step,idempotency_key,payload)
  values(installation_id_value,operation_value,'queued','queued',idempotency_key_value,jsonb_build_object('installationId',installation_id_value,'reason',reason_value))
  on conflict(idempotency_key) do update set available_at=least(public.installation_jobs.available_at,now())
  returning id into job_id_value;

  insert into public.platform_outbox_events(event_type,aggregate_type,aggregate_id,organization_id,payload)
  values('platform.installation.operation_requested','module_installation',installation_id_value,installation_record.organization_id,jsonb_build_object('jobId',job_id_value,'operation',operation_value));
  perform public.write_audit_event('module_installation.operation_requested','module_installation',installation_id_value::text,installation_record.organization_id,btrim(reason_value),jsonb_build_object('status',installation_record.status),jsonb_build_object('operation',operation_value,'jobId',job_id_value));
  return job_id_value;
end;
$$;

revoke all on function public.claim_installation_jobs(text,integer) from public;
revoke all on function public.complete_installation_job(uuid,text,boolean,public.installation_health_status,text,jsonb,text) from public;
revoke all on function public.enqueue_installation_operation(uuid,public.installation_operation,text,text) from public;
grant execute on function public.claim_installation_jobs(text,integer) to service_role;
grant execute on function public.complete_installation_job(uuid,text,boolean,public.installation_health_status,text,jsonb,text) to service_role;
grant execute on function public.enqueue_installation_operation(uuid,public.installation_operation,text,text) to authenticated;
