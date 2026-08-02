-- Identity, RBAC and organization provisioning foundation for the IMDS control plane.
-- The browser uses the authenticated role. Privileged mutations are performed through
-- guarded RPC functions and every destructive action writes an immutable audit event.

create or replace function public.current_global_role()
returns public.global_role
language sql
stable
security definer
set search_path = public
as $$
  select global_role
  from public.platform_users
  where id = auth.uid()
    and is_active = true
  limit 1;
$$;

create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_global_role() is not null;
$$;

create or replace function public.has_global_role(allowed_roles public.global_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_global_role() = any(allowed_roles);
$$;

create or replace function public.can_manage_organizations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'sales_manager'::public.global_role
  ]);
$$;

create or replace function public.can_archive_organizations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role
  ]);
$$;

create or replace function public.can_manage_products()
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

create or replace function public.can_manage_billing()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'finance_admin'::public.global_role
  ]);
$$;

create or replace function public.can_manage_operations()
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

revoke all on function public.current_global_role() from public;
revoke all on function public.is_platform_staff() from public;
revoke all on function public.has_global_role(public.global_role[]) from public;
revoke all on function public.can_manage_organizations() from public;
revoke all on function public.can_archive_organizations() from public;
revoke all on function public.can_manage_products() from public;
revoke all on function public.can_manage_billing() from public;
revoke all on function public.can_manage_operations() from public;
grant execute on function public.current_global_role() to authenticated;
grant execute on function public.is_platform_staff() to authenticated;
grant execute on function public.has_global_role(public.global_role[]) to authenticated;
grant execute on function public.can_manage_organizations() to authenticated;
grant execute on function public.can_archive_organizations() to authenticated;
grant execute on function public.can_manage_products() to authenticated;
grant execute on function public.can_manage_billing() to authenticated;
grant execute on function public.can_manage_operations() to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.platform_users (id, email, full_name, global_role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    null,
    true
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.platform_users.full_name, excluded.full_name);
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_auth_user();

-- One-time bootstrap: only the first authenticated account can claim platform_owner.
create or replace function public.bootstrap_platform_owner()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from public.platform_users
    where is_active = true and global_role is not null
  ) then
    raise exception 'A platform administrator already exists';
  end if;

  select email into current_email from auth.users where id = auth.uid();
  if current_email is null or current_email = '' then
    raise exception 'Authenticated account has no email';
  end if;

  insert into public.platform_users (id, email, full_name, global_role, mfa_enforced, is_active)
  values (auth.uid(), current_email, current_email, 'platform_owner', true, true)
  on conflict (id) do update
    set email = excluded.email,
        global_role = 'platform_owner',
        mfa_enforced = true,
        is_active = true;
end;
$$;

revoke all on function public.bootstrap_platform_owner() from public;
grant execute on function public.bootstrap_platform_owner() to authenticated;

create or replace function public.write_audit_event(
  event_action text,
  event_resource_type text,
  event_resource_id text default null,
  event_organization_id uuid default null,
  event_reason text default null,
  event_before jsonb default null,
  event_after jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid := gen_random_uuid();
  event_time timestamptz := now();
  event_hash text;
begin
  if not public.is_platform_staff() then
    raise exception 'Platform staff role required';
  end if;

  event_hash := encode(
    digest(
      concat_ws('|', event_id::text, event_time::text, auth.uid()::text, event_action, event_resource_type, coalesce(event_resource_id, ''), coalesce(event_reason, '')),
      'sha256'
    ),
    'hex'
  );

  insert into public.audit_events (
    id,
    occurred_at,
    actor_user_id,
    organization_id,
    action,
    resource_type,
    resource_id,
    reason,
    before_state,
    after_state,
    correlation_id,
    hash
  ) values (
    event_id,
    event_time,
    auth.uid(),
    event_organization_id,
    event_action,
    event_resource_type,
    event_resource_id,
    event_reason,
    event_before,
    event_after,
    gen_random_uuid(),
    event_hash
  );

  return event_id;
end;
$$;

revoke all on function public.write_audit_event(text, text, text, uuid, text, jsonb, jsonb) from public;
grant execute on function public.write_audit_event(text, text, text, uuid, text, jsonb, jsonb) to authenticated;

create or replace function public.create_organization_with_structure(
  organization_name text,
  organization_slug text,
  organization_city text default null,
  legal_entity_name text default null,
  legal_entity_bin text default null,
  branch_name text default null,
  branch_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  organization_id uuid := gen_random_uuid();
  legal_entity_id uuid;
begin
  if not public.can_manage_organizations() then
    raise exception 'Insufficient permission to create organizations';
  end if;

  organization_name := nullif(btrim(organization_name), '');
  organization_slug := lower(nullif(btrim(organization_slug), ''));
  legal_entity_bin := nullif(regexp_replace(coalesce(legal_entity_bin, ''), '[^0-9]', '', 'g'), '');

  if organization_name is null then
    raise exception 'Organization name is required';
  end if;
  if organization_slug is null or organization_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Organization slug is invalid';
  end if;
  if legal_entity_bin is not null and legal_entity_bin !~ '^[0-9]{12}$' then
    raise exception 'BIN must contain 12 digits';
  end if;
  if exists (select 1 from public.organizations where slug = organization_slug) then
    raise exception 'Organization slug already exists';
  end if;
  if legal_entity_bin is not null and exists (select 1 from public.legal_entities where bin = legal_entity_bin) then
    raise exception 'Legal entity BIN already exists';
  end if;

  insert into public.organizations (
    id, name, slug, status, country_code, city, customer_health, metadata
  ) values (
    organization_id,
    organization_name,
    organization_slug,
    'onboarding',
    'KZ',
    nullif(btrim(organization_city), ''),
    100,
    '{}'::jsonb
  );

  if legal_entity_name is not null or legal_entity_bin is not null then
    legal_entity_id := gen_random_uuid();
    insert into public.legal_entities (
      id, organization_id, name, bin, is_primary
    ) values (
      legal_entity_id,
      organization_id,
      coalesce(nullif(btrim(legal_entity_name), ''), organization_name),
      legal_entity_bin,
      true
    );
  end if;

  insert into public.branches (
    organization_id, legal_entity_id, name, city, address, timezone, is_active
  ) values (
    organization_id,
    legal_entity_id,
    coalesce(nullif(btrim(branch_name), ''), 'Главный филиал'),
    nullif(btrim(organization_city), ''),
    nullif(btrim(branch_address), ''),
    'Asia/Almaty',
    true
  );

  perform public.write_audit_event(
    'organization.created',
    'organization',
    organization_id::text,
    organization_id,
    'Создание tenant и базовой структуры',
    null,
    jsonb_build_object('name', organization_name, 'slug', organization_slug, 'bin', legal_entity_bin)
  );

  return organization_id;
end;
$$;

revoke all on function public.create_organization_with_structure(text, text, text, text, text, text, text) from public;
grant execute on function public.create_organization_with_structure(text, text, text, text, text, text, text) to authenticated;

create or replace function public.archive_organization(target_organization_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  retained_license_count integer;
  before_record jsonb;
begin
  if not public.can_archive_organizations() then
    raise exception 'Insufficient permission to archive organizations';
  end if;
  if length(btrim(coalesce(reason, ''))) < 5 then
    raise exception 'Archive reason must contain at least 5 characters';
  end if;

  select to_jsonb(o) into before_record
  from public.organizations o
  where o.id = target_organization_id;
  if before_record is null then
    raise exception 'Organization not found';
  end if;

  select count(*) into retained_license_count
  from public.licenses
  where organization_id = target_organization_id
    and status in ('pending', 'provisioning', 'active', 'suspended');
  if retained_license_count > 0 then
    raise exception 'Organization has % active or retained licenses; suspend or revoke them before archiving', retained_license_count;
  end if;

  update public.organizations
  set status = 'archived', archived_at = now(), updated_at = now()
  where id = target_organization_id;

  perform public.write_audit_event(
    'organization.archived',
    'organization',
    target_organization_id::text,
    target_organization_id,
    btrim(reason),
    before_record,
    (select to_jsonb(o) from public.organizations o where o.id = target_organization_id)
  );
end;
$$;

create or replace function public.restore_organization(target_organization_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before_record jsonb;
begin
  if not public.can_archive_organizations() then
    raise exception 'Insufficient permission to restore organizations';
  end if;
  if length(btrim(coalesce(reason, ''))) < 5 then
    raise exception 'Restore reason must contain at least 5 characters';
  end if;

  select to_jsonb(o) into before_record
  from public.organizations o
  where o.id = target_organization_id and o.status = 'archived';
  if before_record is null then
    raise exception 'Archived organization not found';
  end if;

  update public.organizations
  set status = 'onboarding', archived_at = null, updated_at = now()
  where id = target_organization_id;

  perform public.write_audit_event(
    'organization.restored',
    'organization',
    target_organization_id::text,
    target_organization_id,
    btrim(reason),
    before_record,
    (select to_jsonb(o) from public.organizations o where o.id = target_organization_id)
  );
end;
$$;

revoke all on function public.archive_organization(uuid, text) from public;
revoke all on function public.restore_organization(uuid, text) from public;
grant execute on function public.archive_organization(uuid, text) to authenticated;
grant execute on function public.restore_organization(uuid, text) to authenticated;

-- Replace the product lifecycle RPCs from 0002 with authorization and audit checks.
create or replace function public.archive_product(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_license_count integer;
  before_record jsonb;
begin
  if not public.can_manage_products() then
    raise exception 'Insufficient permission to archive products';
  end if;

  select to_jsonb(p) into before_record from public.products p where p.id = target_product_id;
  if before_record is null then
    raise exception 'Product not found';
  end if;

  select count(*) into active_license_count
  from public.licenses
  where product_id = target_product_id
    and status in ('pending', 'provisioning', 'active', 'suspended');
  if active_license_count > 0 then
    raise exception 'Product has % active or retained licenses and cannot be archived', active_license_count;
  end if;

  update public.products
  set status = 'disabled', archived_at = now(), updated_at = now()
  where id = target_product_id;

  perform public.write_audit_event(
    'product.archived', 'product', target_product_id::text, null,
    'Product moved to archive', before_record,
    (select to_jsonb(p) from public.products p where p.id = target_product_id)
  );
end;
$$;

create or replace function public.restore_product(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before_record jsonb;
begin
  if not public.can_manage_products() then
    raise exception 'Insufficient permission to restore products';
  end if;

  select to_jsonb(p) into before_record from public.products p where p.id = target_product_id and p.archived_at is not null;
  if before_record is null then
    raise exception 'Archived product not found';
  end if;

  update public.products
  set status = 'draft', archived_at = null, updated_at = now()
  where id = target_product_id;

  perform public.write_audit_event(
    'product.restored', 'product', target_product_id::text, null,
    'Product restored from archive', before_record,
    (select to_jsonb(p) from public.products p where p.id = target_product_id)
  );
end;
$$;

create or replace function public.delete_custom_product(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  product_record public.products%rowtype;
  retained_license_count integer;
begin
  if not public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role
  ]) then
    raise exception 'Insufficient permission to permanently delete products';
  end if;

  select * into product_record from public.products where id = target_product_id;
  if not found then raise exception 'Product not found'; end if;
  if product_record.is_system then raise exception 'System products cannot be permanently deleted'; end if;
  if product_record.archived_at is null then raise exception 'Product must be archived before permanent deletion'; end if;

  select count(*) into retained_license_count from public.licenses where product_id = target_product_id;
  if retained_license_count > 0 then
    raise exception 'Product has license history and cannot be permanently deleted';
  end if;

  perform public.write_audit_event(
    'product.deleted', 'product', target_product_id::text, null,
    'Permanent deletion of archived custom product', to_jsonb(product_record), null
  );
  delete from public.products where id = target_product_id;
end;
$$;

revoke all on function public.archive_product(uuid) from public;
revoke all on function public.restore_product(uuid) from public;
revoke all on function public.delete_custom_product(uuid) from public;
grant execute on function public.archive_product(uuid) to authenticated;
grant execute on function public.restore_product(uuid) to authenticated;
grant execute on function public.delete_custom_product(uuid) to authenticated;

-- Deny by default: every control-plane table has RLS and only explicit staff policies below.

drop policy if exists platform_users_select on public.platform_users;
create policy platform_users_select on public.platform_users for select to authenticated
using (public.is_platform_staff());
drop policy if exists platform_users_manage on public.platform_users;
create policy platform_users_manage on public.platform_users for all to authenticated
using (public.has_global_role(array['platform_owner'::public.global_role, 'super_admin'::public.global_role]))
with check (public.has_global_role(array['platform_owner'::public.global_role, 'super_admin'::public.global_role]));

drop policy if exists holdings_select on public.holdings;
create policy holdings_select on public.holdings for select to authenticated using (public.is_platform_staff());
drop policy if exists holdings_manage on public.holdings;
create policy holdings_manage on public.holdings for all to authenticated
using (public.can_manage_organizations()) with check (public.can_manage_organizations());

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated using (public.is_platform_staff());
drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert on public.organizations for insert to authenticated with check (public.can_manage_organizations());
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update to authenticated
using (public.can_manage_organizations()) with check (public.can_manage_organizations());

drop policy if exists legal_entities_select on public.legal_entities;
create policy legal_entities_select on public.legal_entities for select to authenticated using (public.is_platform_staff());
drop policy if exists legal_entities_manage on public.legal_entities;
create policy legal_entities_manage on public.legal_entities for all to authenticated
using (public.can_manage_organizations()) with check (public.can_manage_organizations());

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated using (public.is_platform_staff());
drop policy if exists branches_manage on public.branches;
create policy branches_manage on public.branches for all to authenticated
using (public.can_manage_organizations()) with check (public.can_manage_organizations());

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated using (public.is_platform_staff());
drop policy if exists memberships_manage on public.memberships;
create policy memberships_manage on public.memberships for all to authenticated
using (public.has_global_role(array['platform_owner'::public.global_role, 'super_admin'::public.global_role]))
with check (public.has_global_role(array['platform_owner'::public.global_role, 'super_admin'::public.global_role]));

drop policy if exists products_select on public.products;
create policy products_select on public.products for select to authenticated using (public.is_platform_staff());
drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert to authenticated with check (public.can_manage_products());
drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated
using (public.can_manage_products()) with check (public.can_manage_products());

drop policy if exists tariffs_select on public.tariffs;
create policy tariffs_select on public.tariffs for select to authenticated using (public.is_platform_staff());
drop policy if exists tariffs_manage on public.tariffs;
create policy tariffs_manage on public.tariffs for all to authenticated
using (public.can_manage_billing()) with check (public.can_manage_billing());

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated using (public.is_platform_staff());
drop policy if exists subscriptions_manage on public.subscriptions;
create policy subscriptions_manage on public.subscriptions for all to authenticated
using (public.can_manage_billing()) with check (public.can_manage_billing());

drop policy if exists licenses_select on public.licenses;
create policy licenses_select on public.licenses for select to authenticated using (public.is_platform_staff());
drop policy if exists licenses_manage on public.licenses;
create policy licenses_manage on public.licenses for all to authenticated
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

drop policy if exists entitlements_select on public.entitlements;
create policy entitlements_select on public.entitlements for select to authenticated using (public.is_platform_staff());
drop policy if exists entitlements_manage on public.entitlements;
create policy entitlements_manage on public.entitlements for all to authenticated
using (public.has_global_role(array[
  'platform_owner'::public.global_role,
  'super_admin'::public.global_role,
  'technical_admin'::public.global_role
]))
with check (public.has_global_role(array[
  'platform_owner'::public.global_role,
  'super_admin'::public.global_role,
  'technical_admin'::public.global_role
]));

drop policy if exists usage_counters_select on public.usage_counters;
create policy usage_counters_select on public.usage_counters for select to authenticated using (public.is_platform_staff());
drop policy if exists usage_counters_manage on public.usage_counters;
create policy usage_counters_manage on public.usage_counters for all to authenticated
using (public.can_manage_billing() or public.can_manage_operations())
with check (public.can_manage_billing() or public.can_manage_operations());

drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations for select to authenticated using (public.is_platform_staff());
drop policy if exists integrations_manage on public.integrations;
create policy integrations_manage on public.integrations for all to authenticated
using (public.can_manage_operations()) with check (public.can_manage_operations());

drop policy if exists workflow_runs_select on public.workflow_runs;
create policy workflow_runs_select on public.workflow_runs for select to authenticated using (public.is_platform_staff());
drop policy if exists workflow_runs_manage on public.workflow_runs;
create policy workflow_runs_manage on public.workflow_runs for all to authenticated
using (public.can_manage_operations() or public.can_manage_organizations())
with check (public.can_manage_operations() or public.can_manage_organizations());

drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests for select to authenticated using (public.is_platform_staff());
drop policy if exists approval_requests_update on public.approval_requests;
create policy approval_requests_update on public.approval_requests for update to authenticated
using (public.has_global_role(array['platform_owner'::public.global_role, 'super_admin'::public.global_role]))
with check (public.has_global_role(array['platform_owner'::public.global_role, 'super_admin'::public.global_role]));

drop policy if exists impersonation_sessions_select on public.impersonation_sessions;
create policy impersonation_sessions_select on public.impersonation_sessions for select to authenticated
using (public.has_global_role(array[
  'platform_owner'::public.global_role,
  'super_admin'::public.global_role,
  'support_admin'::public.global_role,
  'auditor'::public.global_role
]));
drop policy if exists impersonation_sessions_insert on public.impersonation_sessions;
create policy impersonation_sessions_insert on public.impersonation_sessions for insert to authenticated
with check (public.has_global_role(array[
  'platform_owner'::public.global_role,
  'super_admin'::public.global_role,
  'support_admin'::public.global_role
]) and actor_user_id = auth.uid());
drop policy if exists impersonation_sessions_update on public.impersonation_sessions;
create policy impersonation_sessions_update on public.impersonation_sessions for update to authenticated
using (actor_user_id = auth.uid() or public.has_global_role(array['platform_owner'::public.global_role, 'super_admin'::public.global_role]))
with check (actor_user_id = auth.uid() or public.has_global_role(array['platform_owner'::public.global_role, 'super_admin'::public.global_role]));

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select to authenticated
using (public.has_global_role(array[
  'platform_owner'::public.global_role,
  'super_admin'::public.global_role,
  'support_admin'::public.global_role,
  'finance_admin'::public.global_role,
  'technical_admin'::public.global_role,
  'auditor'::public.global_role
]));

-- No direct INSERT, UPDATE or DELETE policy is intentionally created for audit_events.
-- Events are appended only through write_audit_event().
