-- Identity Directory: platform users, secure invitations, global roles and
-- organization/branch/product memberships.

create type public.identity_invitation_status as enum (
  'pending',
  'sent',
  'accepted',
  'expired',
  'cancelled',
  'failed'
);

alter table public.platform_users
  add column if not exists locale text not null default 'ru',
  add column if not exists timezone text not null default 'Asia/Almaty',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deactivated_at timestamptz;

create trigger platform_users_set_updated_at
before update on public.platform_users
for each row execute function public.set_updated_at();

alter table public.memberships
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deactivated_at timestamptz;

create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function public.set_updated_at();

create unique index if not exists memberships_unique_scope_idx
on public.memberships (
  organization_id,
  coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
  user_id,
  role_key
);

create unique index if not exists platform_users_email_lower_unique_idx
on public.platform_users (lower(email));

create table public.platform_user_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  global_role public.global_role,
  organization_id uuid references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  membership_role_key text,
  product_scopes text[] not null default '{}',
  status public.identity_invitation_status not null default 'pending',
  auth_user_id uuid,
  redirect_to text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  invited_by uuid not null references public.platform_users(id),
  accepted_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email = lower(btrim(email))),
  check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  check (membership_role_key is null or membership_role_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (branch_id is null or organization_id is not null),
  check (expires_at > created_at)
);

create trigger platform_user_invitations_set_updated_at
before update on public.platform_user_invitations
for each row execute function public.set_updated_at();

create unique index platform_user_invitations_open_email_idx
on public.platform_user_invitations (lower(email))
where status in ('pending', 'sent');

create index platform_user_invitations_status_idx
on public.platform_user_invitations(status, expires_at);
create index memberships_organization_user_idx
on public.memberships(organization_id, user_id, is_active);

alter table public.platform_user_invitations enable row level security;

create policy platform_user_invitations_select on public.platform_user_invitations
for select to authenticated using (public.is_platform_staff());

create or replace function public.can_manage_identity()
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

create or replace function public.can_manage_memberships()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'support_admin'::public.global_role
  ]);
$$;

revoke all on function public.can_manage_identity() from public;
revoke all on function public.can_manage_memberships() from public;
grant execute on function public.can_manage_identity() to authenticated;
grant execute on function public.can_manage_memberships() to authenticated;

create or replace function public.assert_identity_role_grant(
  requested_role public.global_role
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_identity() then
    raise exception 'Insufficient permission to manage global roles';
  end if;

  if requested_role in ('platform_owner', 'super_admin')
     and not public.has_global_role(array['platform_owner'::public.global_role]) then
    raise exception 'Only platform_owner may grant platform_owner or super_admin';
  end if;
end;
$$;

revoke all on function public.assert_identity_role_grant(public.global_role) from public;

create or replace function public.validate_identity_scope(
  organization_id_value uuid,
  branch_id_value uuid,
  product_scopes_value text[]
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if organization_id_value is not null and not exists (
    select 1 from public.organizations organization
    where organization.id = organization_id_value
      and organization.archived_at is null
  ) then
    raise exception 'Organization not found or archived';
  end if;

  if branch_id_value is not null and not exists (
    select 1 from public.branches branch
    where branch.id = branch_id_value
      and branch.organization_id = organization_id_value
      and branch.is_active = true
  ) then
    raise exception 'Branch does not belong to organization or is inactive';
  end if;

  if exists (
    select 1 from unnest(coalesce(product_scopes_value, '{}'::text[])) product_key
    where not exists (
      select 1 from public.products product
      where product.key = product_key
        and product.archived_at is null
        and product.status <> 'disabled'
    )
  ) then
    raise exception 'One or more product scopes are unknown, disabled or archived';
  end if;
end;
$$;

revoke all on function public.validate_identity_scope(uuid, uuid, text[]) from public;

create or replace function public.create_identity_invitation(
  email_value text,
  full_name_value text default null,
  global_role_value public.global_role default null,
  organization_id_value uuid default null,
  branch_id_value uuid default null,
  membership_role_key_value text default null,
  product_scopes_value text[] default '{}',
  redirect_to_value text default null,
  expires_in_hours integer default 168
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_id_value uuid;
  normalized_email text;
  normalized_role_key text;
  normalized_product_scopes text[];
begin
  if not public.can_manage_identity() then
    raise exception 'Insufficient permission to invite platform users';
  end if;

  normalized_email := lower(btrim(coalesce(email_value, '')));
  if normalized_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Email address is invalid';
  end if;
  if expires_in_hours < 1 or expires_in_hours > 720 then
    raise exception 'Invitation expiration must be between 1 and 720 hours';
  end if;

  perform public.assert_identity_role_grant(global_role_value);

  normalized_role_key := lower(nullif(btrim(membership_role_key_value), ''));
  if normalized_role_key is not null and normalized_role_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Membership role key is invalid';
  end if;
  if organization_id_value is not null and normalized_role_key is null then
    raise exception 'Membership role is required when organization is selected';
  end if;
  if organization_id_value is null and (branch_id_value is not null or normalized_role_key is not null) then
    raise exception 'Organization is required for branch membership';
  end if;

  select coalesce(array_agg(distinct lower(scope) order by lower(scope)), '{}'::text[])
    into normalized_product_scopes
  from unnest(coalesce(product_scopes_value, '{}'::text[])) scope
  where nullif(btrim(scope), '') is not null;

  perform public.validate_identity_scope(
    organization_id_value,
    branch_id_value,
    normalized_product_scopes
  );

  if exists (
    select 1 from public.platform_users user_profile
    where lower(user_profile.email) = normalized_email
  ) then
    raise exception 'Platform user with this email already exists';
  end if;

  if exists (
    select 1 from public.platform_user_invitations invitation
    where invitation.email = normalized_email
      and invitation.status in ('pending', 'sent')
  ) then
    raise exception 'Open invitation for this email already exists';
  end if;

  insert into public.platform_user_invitations (
    email,
    full_name,
    global_role,
    organization_id,
    branch_id,
    membership_role_key,
    product_scopes,
    redirect_to,
    expires_at,
    invited_by
  ) values (
    normalized_email,
    nullif(btrim(full_name_value), ''),
    global_role_value,
    organization_id_value,
    branch_id_value,
    normalized_role_key,
    normalized_product_scopes,
    nullif(btrim(redirect_to_value), ''),
    now() + make_interval(hours => expires_in_hours),
    auth.uid()
  ) returning id into invitation_id_value;

  perform public.write_audit_event(
    'identity.invitation_created',
    'platform_user_invitation',
    invitation_id_value::text,
    organization_id_value,
    'Platform user invitation created',
    null,
    (select to_jsonb(invitation) from public.platform_user_invitations invitation where invitation.id = invitation_id_value)
  );

  return invitation_id_value;
end;
$$;

revoke all on function public.create_identity_invitation(text, text, public.global_role, uuid, uuid, text, text[], text, integer) from public;
grant execute on function public.create_identity_invitation(text, text, public.global_role, uuid, uuid, text, text[], text, integer) to authenticated;

create or replace function public.finalize_identity_invitation(
  target_invitation_id uuid,
  auth_user_id_value uuid default null,
  delivery_error_value text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_record public.platform_user_invitations%rowtype;
begin
  select * into invitation_record
  from public.platform_user_invitations
  where id = target_invitation_id
  for update;
  if not found then raise exception 'Identity invitation not found'; end if;
  if invitation_record.status <> 'pending' then
    raise exception 'Identity invitation is not pending';
  end if;

  if nullif(btrim(delivery_error_value), '') is not null then
    update public.platform_user_invitations
    set status = 'failed',
        last_error = left(btrim(delivery_error_value), 2000)
    where id = target_invitation_id;
    return;
  end if;

  if auth_user_id_value is null then
    raise exception 'Auth user id is required after successful invitation delivery';
  end if;

  insert into public.platform_users (
    id,
    email,
    full_name,
    global_role,
    mfa_enforced,
    is_active
  ) values (
    auth_user_id_value,
    invitation_record.email,
    invitation_record.full_name,
    invitation_record.global_role,
    false,
    true
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.platform_users.full_name),
        global_role = excluded.global_role,
        is_active = true,
        deactivated_at = null;

  if invitation_record.organization_id is not null then
    update public.memberships
    set product_scopes = invitation_record.product_scopes,
        is_active = true,
        deactivated_at = null
    where organization_id = invitation_record.organization_id
      and branch_id is not distinct from invitation_record.branch_id
      and user_id = auth_user_id_value
      and role_key = invitation_record.membership_role_key;

    if not found then
      insert into public.memberships (
        organization_id,
        branch_id,
        user_id,
        role_key,
        product_scopes,
        is_active
      ) values (
        invitation_record.organization_id,
        invitation_record.branch_id,
        auth_user_id_value,
        invitation_record.membership_role_key,
        invitation_record.product_scopes,
        true
      );
    end if;
  end if;

  update public.platform_user_invitations
  set status = 'sent',
      auth_user_id = auth_user_id_value,
      last_error = null
  where id = target_invitation_id;
end;
$$;

revoke all on function public.finalize_identity_invitation(uuid, uuid, text) from public;
grant execute on function public.finalize_identity_invitation(uuid, uuid, text) to service_role;

create or replace function public.cancel_identity_invitation(
  target_invitation_id uuid,
  reason_value text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_record public.platform_user_invitations%rowtype;
begin
  if not public.can_manage_identity() then
    raise exception 'Insufficient permission to cancel invitations';
  end if;
  if length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Cancellation reason must contain at least 5 characters';
  end if;

  select * into invitation_record
  from public.platform_user_invitations
  where id = target_invitation_id
  for update;
  if not found then raise exception 'Identity invitation not found'; end if;
  if invitation_record.status not in ('pending', 'sent', 'failed') then
    raise exception 'Invitation cannot be cancelled in its current state';
  end if;

  update public.platform_user_invitations
  set status = 'cancelled',
      cancelled_at = now(),
      last_error = btrim(reason_value)
  where id = target_invitation_id;

  if invitation_record.auth_user_id is not null
     and not exists (
       select 1 from public.platform_user_invitations accepted
       where accepted.auth_user_id = invitation_record.auth_user_id
         and accepted.status = 'accepted'
     ) then
    update public.platform_users
    set is_active = false,
        deactivated_at = now()
    where id = invitation_record.auth_user_id;
  end if;

  perform public.write_audit_event(
    'identity.invitation_cancelled',
    'platform_user_invitation',
    target_invitation_id::text,
    invitation_record.organization_id,
    btrim(reason_value),
    to_jsonb(invitation_record),
    (select to_jsonb(invitation) from public.platform_user_invitations invitation where invitation.id = target_invitation_id)
  );

  return invitation_record.auth_user_id;
end;
$$;

revoke all on function public.cancel_identity_invitation(uuid, text) from public;
grant execute on function public.cancel_identity_invitation(uuid, text) to authenticated;

create or replace function public.accept_my_identity_invitation()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  update public.platform_user_invitations
  set status = 'accepted',
      accepted_at = now(),
      last_error = null
  where auth_user_id = auth.uid()
    and status = 'sent'
    and expires_at > now();

  get diagnostics accepted_count = row_count;

  update public.platform_users
  set last_seen_at = now()
  where id = auth.uid();

  return accepted_count;
end;
$$;

revoke all on function public.accept_my_identity_invitation() from public;
grant execute on function public.accept_my_identity_invitation() to authenticated;

create or replace function public.set_platform_user_access(
  target_user_id uuid,
  full_name_value text,
  global_role_value public.global_role,
  mfa_enforced_value boolean,
  is_active_value boolean,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_record public.platform_users%rowtype;
  active_owner_count integer;
begin
  if not public.can_manage_identity() then
    raise exception 'Insufficient permission to manage platform users';
  end if;
  if length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Change reason must contain at least 5 characters';
  end if;

  select * into current_record
  from public.platform_users
  where id = target_user_id
  for update;
  if not found then raise exception 'Platform user not found'; end if;

  perform public.assert_identity_role_grant(global_role_value);

  if current_record.global_role = 'platform_owner'
     and (global_role_value is distinct from 'platform_owner' or not is_active_value) then
    select count(*) into active_owner_count
    from public.platform_users
    where global_role = 'platform_owner'
      and is_active = true;
    if active_owner_count <= 1 then
      raise exception 'The last active platform_owner cannot be removed or deactivated';
    end if;
  end if;

  update public.platform_users
  set full_name = nullif(btrim(full_name_value), ''),
      global_role = global_role_value,
      mfa_enforced = mfa_enforced_value,
      is_active = is_active_value,
      deactivated_at = case when is_active_value then null else coalesce(deactivated_at, now()) end
  where id = target_user_id;

  if not is_active_value then
    update public.memberships
    set is_active = false,
        deactivated_at = coalesce(deactivated_at, now())
    where user_id = target_user_id
      and is_active = true;
  end if;

  perform public.write_audit_event(
    'identity.user_access_changed',
    'platform_user',
    target_user_id::text,
    null,
    btrim(reason_value),
    to_jsonb(current_record),
    (select to_jsonb(user_profile) from public.platform_users user_profile where user_profile.id = target_user_id)
  );
end;
$$;

revoke all on function public.set_platform_user_access(uuid, text, public.global_role, boolean, boolean, text) from public;
grant execute on function public.set_platform_user_access(uuid, text, public.global_role, boolean, boolean, text) to authenticated;

create or replace function public.upsert_user_membership(
  target_user_id uuid,
  organization_id_value uuid,
  branch_id_value uuid,
  role_key_value text,
  product_scopes_value text[],
  is_active_value boolean,
  reason_value text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_id_value uuid;
  normalized_role_key text;
  normalized_product_scopes text[];
  before_record jsonb;
begin
  if not public.can_manage_memberships() then
    raise exception 'Insufficient permission to manage memberships';
  end if;
  if length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Change reason must contain at least 5 characters';
  end if;
  if not exists (select 1 from public.platform_users where id = target_user_id) then
    raise exception 'Platform user not found';
  end if;

  normalized_role_key := lower(nullif(btrim(role_key_value), ''));
  if normalized_role_key is null or normalized_role_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Membership role key is invalid';
  end if;

  select coalesce(array_agg(distinct lower(scope) order by lower(scope)), '{}'::text[])
    into normalized_product_scopes
  from unnest(coalesce(product_scopes_value, '{}'::text[])) scope
  where nullif(btrim(scope), '') is not null;

  perform public.validate_identity_scope(
    organization_id_value,
    branch_id_value,
    normalized_product_scopes
  );

  select id, to_jsonb(membership) into membership_id_value, before_record
  from public.memberships membership
  where membership.organization_id = organization_id_value
    and membership.branch_id is not distinct from branch_id_value
    and membership.user_id = target_user_id
    and membership.role_key = normalized_role_key
  limit 1;

  if membership_id_value is null then
    insert into public.memberships (
      organization_id,
      branch_id,
      user_id,
      role_key,
      product_scopes,
      is_active,
      deactivated_at
    ) values (
      organization_id_value,
      branch_id_value,
      target_user_id,
      normalized_role_key,
      normalized_product_scopes,
      is_active_value,
      case when is_active_value then null else now() end
    ) returning id into membership_id_value;
  else
    update public.memberships
    set product_scopes = normalized_product_scopes,
        is_active = is_active_value,
        deactivated_at = case when is_active_value then null else coalesce(deactivated_at, now()) end
    where id = membership_id_value;
  end if;

  perform public.write_audit_event(
    'identity.membership_changed',
    'membership',
    membership_id_value::text,
    organization_id_value,
    btrim(reason_value),
    before_record,
    (select to_jsonb(membership) from public.memberships membership where membership.id = membership_id_value)
  );

  return membership_id_value;
end;
$$;

revoke all on function public.upsert_user_membership(uuid, uuid, uuid, text, text[], boolean, text) from public;
grant execute on function public.upsert_user_membership(uuid, uuid, uuid, text, text[], boolean, text) to authenticated;

comment on table public.platform_user_invitations is
  'Invitation lifecycle for platform staff and tenant users. Auth delivery is executed by a trusted Edge Function.';
comment on function public.set_platform_user_access(uuid, text, public.global_role, boolean, boolean, text) is
  'Changes global access with last-owner protection and immutable audit.';
