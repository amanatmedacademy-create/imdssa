alter table public.products
  add column if not exists is_system boolean not null default false,
  add column if not exists archived_at timestamptz;

create index if not exists products_archived_at_idx
  on public.products (archived_at);

create or replace function public.archive_product(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_license_count integer;
begin
  select count(*)
    into active_license_count
  from public.licenses
  where product_id = target_product_id
    and status in ('pending', 'provisioning', 'active', 'suspended');

  if active_license_count > 0 then
    raise exception 'Product has % active or retained licenses and cannot be archived', active_license_count;
  end if;

  update public.products
  set status = 'disabled',
      archived_at = now(),
      updated_at = now()
  where id = target_product_id;
end;
$$;

create or replace function public.restore_product(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
  set status = 'draft',
      archived_at = null,
      updated_at = now()
  where id = target_product_id;
end;
$$;

create or replace function public.delete_custom_product(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  product_is_system boolean;
  retained_license_count integer;
  product_archived_at timestamptz;
begin
  select is_system, archived_at
    into product_is_system, product_archived_at
  from public.products
  where id = target_product_id;

  if not found then
    raise exception 'Product not found';
  end if;

  if product_is_system then
    raise exception 'System products cannot be permanently deleted';
  end if;

  if product_archived_at is null then
    raise exception 'Product must be archived before permanent deletion';
  end if;

  select count(*)
    into retained_license_count
  from public.licenses
  where product_id = target_product_id;

  if retained_license_count > 0 then
    raise exception 'Product has license history and cannot be permanently deleted';
  end if;

  delete from public.products where id = target_product_id;
end;
$$;

comment on column public.products.archived_at is 'Soft-delete marker. Archived products are hidden from active catalogues but retained for audit and history.';
comment on column public.products.is_system is 'Protects core IMDS products from permanent deletion.';
