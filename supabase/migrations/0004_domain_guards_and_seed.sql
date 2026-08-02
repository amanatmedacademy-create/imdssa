-- Domain invariants that cannot be enforced by frontend permissions alone.

create unique index if not exists legal_entities_bin_global_unique
  on public.legal_entities (bin)
  where bin is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists entitlements_set_updated_at on public.entitlements;
create trigger entitlements_set_updated_at
before update on public.entitlements
for each row execute function public.set_updated_at();

create or replace function public.guard_organization_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'archived' and new.status = 'archived' and not public.can_archive_organizations() then
    raise exception 'Only platform_owner or super_admin may archive organizations';
  end if;

  if old.status = 'archived' and new.status <> 'archived' and not public.can_archive_organizations() then
    raise exception 'Only platform_owner or super_admin may restore organizations';
  end if;

  if new.status = 'archived' and new.archived_at is null then
    raise exception 'Archived organization must have archived_at';
  end if;

  if new.status <> 'archived' and new.archived_at is not null then
    raise exception 'Only archived organization may have archived_at';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_organization_lifecycle() from public;

drop trigger if exists organizations_guard_lifecycle on public.organizations;
create trigger organizations_guard_lifecycle
before update on public.organizations
for each row execute function public.guard_organization_lifecycle();

create or replace function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Audit events are immutable';
end;
$$;

revoke all on function public.prevent_audit_event_mutation() from public;

drop trigger if exists audit_events_immutable_update on public.audit_events;
create trigger audit_events_immutable_update
before update or delete on public.audit_events
for each row execute function public.prevent_audit_event_mutation();

insert into public.products (
  key,
  name,
  description,
  status,
  current_version,
  adapter_key,
  is_system,
  metadata
) values
  ('imds-mis', 'IMDS MIS', 'Медицинская информационная система.', 'active', '3.8.4', 'mis', true, '{"position":1}'::jsonb),
  ('imds-crm', 'IMDS CRM', 'Управление клиентами, продажами и коммуникациями.', 'active', '2.4.1', 'crm', true, '{"position":2}'::jsonb),
  ('imds-marketing', 'IMDS Marketing', 'Рекламные кабинеты, каналы и маркетинговая аналитика.', 'degraded', '1.9.6', 'marketing', true, '{"position":3}'::jsonb),
  ('imds-finance', 'IMDS Finance', 'Финансовый учёт, платежи, ДДС и отчётность.', 'active', '1.3.0', 'finance', true, '{"position":4}'::jsonb),
  ('imds-contract', 'IMDS Contract', 'Договоры, шаблоны, согласования и документы.', 'active', '1.6.2', 'contract', true, '{"position":5}'::jsonb),
  ('imds-dashboard', 'IMDS Dashboard', 'Управленческие отчёты, KPI и аналитические панели.', 'active', '2.2.8', 'dashboard', true, '{"position":6}'::jsonb),
  ('imds-product-7', 'IMDS Product 7', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', 'product-7', true, '{"position":7,"placeholder":true}'::jsonb),
  ('imds-product-8', 'IMDS Product 8', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', 'product-8', true, '{"position":8,"placeholder":true}'::jsonb),
  ('imds-product-9', 'IMDS Product 9', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', 'product-9', true, '{"position":9,"placeholder":true}'::jsonb),
  ('imds-product-10', 'IMDS Product 10', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', 'product-10', true, '{"position":10,"placeholder":true}'::jsonb),
  ('imds-product-11', 'IMDS Product 11', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', 'product-11', true, '{"position":11,"placeholder":true}'::jsonb)
on conflict (key) do nothing;

comment on function public.guard_organization_lifecycle() is
  'Prevents bypassing privileged archive and restore transitions through direct table updates.';
comment on function public.prevent_audit_event_mutation() is
  'Enforces append-only audit history even when RLS is bypassed by a privileged database connection.';
