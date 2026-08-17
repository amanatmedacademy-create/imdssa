-- PostgreSQL transition records NEW/OLD are not scalar values and should not be
-- passed through coalesce(). Handle DELETE explicitly so the trigger is valid
-- for INSERT, UPDATE and DELETE.

create or replace function public.handle_product_payment_method_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_product_billing_entitlements(old.product_id);
    return old;
  end if;

  perform public.sync_product_billing_entitlements(new.product_id);
  return new;
end;
$$;

revoke all on function public.handle_product_payment_method_sync() from public;
