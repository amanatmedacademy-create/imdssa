-- Billing Operations: invoices, payments, allocations, credit notes, refunds,
-- dunning and proration. All financial mutations are performed through RPCs.

create type public.invoice_status as enum ('draft','issued','partially_paid','paid','overdue','void','written_off');
create type public.invoice_line_type as enum ('subscription','license','usage','discount','tax','adjustment','credit');
create type public.payment_status as enum ('pending','succeeded','failed','cancelled','refunded','partially_refunded');
create type public.payment_method as enum ('bank_transfer','kaspi','card','cash','manual','other');
create type public.refund_status as enum ('requested','pending_approval','approved','processing','succeeded','failed','rejected','cancelled');
create type public.credit_note_status as enum ('draft','issued','applied','void');
create type public.dunning_status as enum ('open','promised','resolved','cancelled');

create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  legal_name text,
  bin_iin text,
  billing_email text,
  currency text not null default 'KZT',
  payment_terms_days integer not null default 7 check (payment_terms_days between 0 and 365),
  tax_rate numeric(7,4) not null default 0 check (tax_rate between 0 and 100),
  credit_limit numeric(18,2) not null default 0 check (credit_limit >= 0),
  balance numeric(18,2) not null default 0,
  overdue_balance numeric(18,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (currency ~ '^[A-Z]{3}$'),
  check (bin_iin is null or bin_iin ~ '^[0-9]{10,12}$')
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  invoice_number text not null unique,
  status public.invoice_status not null default 'draft',
  currency text not null default 'KZT',
  subtotal numeric(18,2) not null default 0,
  discount_total numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  paid_total numeric(18,2) not null default 0,
  refunded_total numeric(18,2) not null default 0,
  outstanding_total numeric(18,2) generated always as (greatest(total - paid_total, 0)) stored,
  period_start timestamptz,
  period_end timestamptz,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (currency ~ '^[A-Z]{3}$'),
  check (subtotal >= 0 and discount_total >= 0 and tax_total >= 0 and total >= 0 and paid_total >= 0 and refunded_total >= 0),
  check (period_end is null or period_start is not null),
  check (period_end is null or period_end > period_start),
  check (due_at is null or issued_at is not null),
  check (due_at is null or due_at >= issued_at)
);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  line_type public.invoice_line_type not null,
  product_id uuid references public.products(id) on delete set null,
  license_id uuid references public.licenses(id) on delete set null,
  description text not null,
  quantity numeric(14,4) not null default 1 check (quantity > 0),
  unit_price numeric(18,4) not null default 0,
  discount_amount numeric(18,2) not null default 0 check (discount_amount >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate between 0 and 100),
  line_subtotal numeric(18,2) not null default 0,
  line_tax numeric(18,2) not null default 0,
  line_total numeric(18,2) not null default 0,
  service_period_start timestamptz,
  service_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(btrim(description)) > 0),
  check (service_period_end is null or service_period_start is not null),
  check (service_period_end is null or service_period_end > service_period_start)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_reference text,
  payment_number text not null unique,
  status public.payment_status not null default 'pending',
  method public.payment_method not null default 'manual',
  currency text not null default 'KZT',
  amount numeric(18,2) not null check (amount > 0),
  refunded_amount numeric(18,2) not null default 0 check (refunded_amount >= 0),
  received_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  payer_name text,
  payer_reference text,
  metadata jsonb not null default '{}'::jsonb,
  recorded_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, external_reference),
  check (currency ~ '^[A-Z]{3}$'),
  check (refunded_amount <= amount)
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  created_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete restrict,
  credit_number text not null unique,
  status public.credit_note_status not null default 'draft',
  currency text not null default 'KZT',
  amount numeric(18,2) not null check (amount > 0),
  reason text not null,
  issued_at timestamptz,
  applied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(reason)) >= 5)
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  refund_number text not null unique,
  status public.refund_status not null default 'requested',
  amount numeric(18,2) not null check (amount > 0),
  reason text not null,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  external_reference text,
  requested_by uuid not null references public.platform_users(id),
  approved_by uuid references public.platform_users(id),
  processed_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(reason)) >= 10)
);

create table public.dunning_cases (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  status public.dunning_status not null default 'open',
  stage smallint not null default 1 check (stage between 1 and 5),
  owner_user_id uuid references public.platform_users(id),
  promised_payment_at timestamptz,
  next_action_at timestamptz,
  last_contact_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  refund_id uuid references public.refunds(id) on delete set null,
  event_type text not null,
  actor_user_id uuid references public.platform_users(id),
  reason text,
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  check (event_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
);

create index invoices_org_status_due_idx on public.invoices(organization_id,status,due_at);
create index invoices_outstanding_idx on public.invoices(status,due_at) where status in ('issued','partially_paid','overdue');
create index payments_org_received_idx on public.payments(organization_id,received_at desc);
create index allocations_invoice_idx on public.payment_allocations(invoice_id);
create index refunds_status_idx on public.refunds(status,created_at desc);
create index dunning_open_idx on public.dunning_cases(status,next_action_at) where status in ('open','promised');
create index billing_events_org_time_idx on public.billing_events(organization_id,occurred_at desc);

create trigger billing_accounts_updated_at before update on public.billing_accounts for each row execute function public.set_updated_at();
create trigger invoices_updated_at before update on public.invoices for each row execute function public.set_updated_at();
create trigger payments_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger credit_notes_updated_at before update on public.credit_notes for each row execute function public.set_updated_at();
create trigger refunds_updated_at before update on public.refunds for each row execute function public.set_updated_at();
create trigger dunning_cases_updated_at before update on public.dunning_cases for each row execute function public.set_updated_at();

create or replace function public.prevent_billing_event_mutation() returns trigger language plpgsql as $$
begin raise exception 'Billing events are append-only'; end; $$;
create trigger billing_events_immutable before update or delete on public.billing_events for each row execute function public.prevent_billing_event_mutation();

create or replace function public.next_document_number(prefix text, document_table text)
returns text language plpgsql security definer set search_path=public as $$
declare result text;
begin
  perform pg_advisory_xact_lock(hashtextextended(prefix || ':' || to_char(now(),'YYYYMM'), 271828));
  execute format('select %L || to_char(now(),''YYYYMM'') || ''-'' || lpad((count(*)+1)::text,5,''0'') from public.%I where created_at >= date_trunc(''month'',now())', prefix, document_table) into result;
  return result;
end; $$;

create or replace function public.recalculate_invoice(target_invoice_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare sums record; paid numeric(18,2); invoice_record public.invoices%rowtype;
begin
  select * into invoice_record from public.invoices where id=target_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  select coalesce(sum(line_subtotal),0) subtotal, coalesce(sum(discount_amount),0) discount_total,
         coalesce(sum(line_tax),0) tax_total, coalesce(sum(line_total),0) total
    into sums from public.invoice_lines where invoice_id=target_invoice_id;
  select coalesce(sum(a.amount),0) into paid from public.payment_allocations a join public.payments p on p.id=a.payment_id where a.invoice_id=target_invoice_id and p.status in ('succeeded','partially_refunded','refunded');
  update public.invoices set subtotal=sums.subtotal,discount_total=sums.discount_total,tax_total=sums.tax_total,total=sums.total,paid_total=paid,
    status=case when status in ('void','written_off') then status when paid>=sums.total and sums.total>0 then 'paid'::public.invoice_status when paid>0 then 'partially_paid'::public.invoice_status when due_at is not null and due_at<now() and status<>'draft' then 'overdue'::public.invoice_status else status end,
    paid_at=case when paid>=sums.total and sums.total>0 then coalesce(paid_at,now()) else null end
  where id=target_invoice_id;
end; $$;

create or replace function public.create_invoice(
  organization_id_value uuid,
  subscription_id_value uuid,
  currency_value text,
  period_start_value timestamptz,
  period_end_value timestamptz,
  due_at_value timestamptz,
  notes_value text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare account_id uuid; invoice_id_value uuid; number_value text;
begin
  if not public.can_manage_billing() then raise exception 'Insufficient permission to create invoices'; end if;
  select id into account_id from public.billing_accounts where organization_id=organization_id_value;
  if account_id is null then
    insert into public.billing_accounts(organization_id,legal_name,currency,billing_email)
    select id,name,upper(currency_value),metadata->>'billing_email' from public.organizations where id=organization_id_value returning id into account_id;
  end if;
  if account_id is null then raise exception 'Organization not found'; end if;
  number_value:=public.next_document_number('INV-', 'invoices');
  insert into public.invoices(billing_account_id,organization_id,subscription_id,invoice_number,currency,period_start,period_end,due_at,notes,created_by)
  values(account_id,organization_id_value,subscription_id_value,number_value,upper(currency_value),period_start_value,period_end_value,due_at_value,nullif(btrim(notes_value),''),auth.uid()) returning id into invoice_id_value;
  insert into public.billing_events(organization_id,invoice_id,event_type,actor_user_id,payload) values(organization_id_value,invoice_id_value,'invoice.created',auth.uid(),jsonb_build_object('invoiceNumber',number_value));
  perform public.write_audit_event('billing.invoice.created','invoice',invoice_id_value::text,organization_id_value,'Invoice created',null,jsonb_build_object('invoiceNumber',number_value));
  return invoice_id_value;
end; $$;

create or replace function public.add_invoice_line(
  invoice_id_value uuid,
  line_type_value public.invoice_line_type,
  description_value text,
  quantity_value numeric,
  unit_price_value numeric,
  discount_amount_value numeric default 0,
  tax_rate_value numeric default 0,
  product_id_value uuid default null,
  license_id_value uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare line_id uuid; subtotal_value numeric; taxable_value numeric; tax_value numeric; total_value numeric; invoice_status_value public.invoice_status;
begin
  if not public.can_manage_billing() then raise exception 'Insufficient permission to add invoice lines'; end if;
  select status into invoice_status_value from public.invoices where id=invoice_id_value for update;
  if invoice_status_value is null then raise exception 'Invoice not found'; end if;
  if invoice_status_value<>'draft' then raise exception 'Only draft invoices can be edited'; end if;
  if quantity_value<=0 or unit_price_value<0 or discount_amount_value<0 or tax_rate_value<0 or tax_rate_value>100 then raise exception 'Invalid invoice line values'; end if;
  subtotal_value:=round(quantity_value*unit_price_value,2); taxable_value:=greatest(subtotal_value-discount_amount_value,0); tax_value:=round(taxable_value*tax_rate_value/100,2); total_value:=taxable_value+tax_value;
  insert into public.invoice_lines(invoice_id,line_type,product_id,license_id,description,quantity,unit_price,discount_amount,tax_rate,line_subtotal,line_tax,line_total)
  values(invoice_id_value,line_type_value,product_id_value,license_id_value,btrim(description_value),quantity_value,unit_price_value,discount_amount_value,tax_rate_value,subtotal_value,tax_value,total_value) returning id into line_id;
  perform public.recalculate_invoice(invoice_id_value); return line_id;
end; $$;

create or replace function public.issue_invoice(invoice_id_value uuid)
returns void language plpgsql security definer set search_path=public as $$
declare rec public.invoices%rowtype;
begin
  if not public.can_manage_billing() then raise exception 'Insufficient permission to issue invoices'; end if;
  select * into rec from public.invoices where id=invoice_id_value for update;
  if not found or rec.status<>'draft' then raise exception 'Draft invoice not found'; end if;
  perform public.recalculate_invoice(invoice_id_value);
  select * into rec from public.invoices where id=invoice_id_value;
  if rec.total<=0 then raise exception 'Invoice total must be positive'; end if;
  update public.invoices set status='issued',issued_at=now(),due_at=coalesce(due_at,now()+interval '7 days') where id=invoice_id_value;
  insert into public.billing_events(organization_id,invoice_id,event_type,actor_user_id,payload) values(rec.organization_id,invoice_id_value,'invoice.issued',auth.uid(),jsonb_build_object('total',rec.total));
  perform public.write_audit_event('billing.invoice.issued','invoice',invoice_id_value::text,rec.organization_id,'Invoice issued',jsonb_build_object('status','draft'),jsonb_build_object('status','issued','total',rec.total));
end; $$;

create or replace function public.record_payment(
  organization_id_value uuid,
  amount_value numeric,
  currency_value text,
  method_value public.payment_method,
  received_at_value timestamptz,
  external_reference_value text default null,
  payer_name_value text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare account_id uuid; payment_id_value uuid; number_value text;
begin
  if not public.can_manage_billing() then raise exception 'Insufficient permission to record payments'; end if;
  if amount_value<=0 then raise exception 'Payment amount must be positive'; end if;
  select id into account_id from public.billing_accounts where organization_id=organization_id_value;
  if account_id is null then raise exception 'Billing account not found'; end if;
  number_value:=public.next_document_number('PAY-', 'payments');
  insert into public.payments(billing_account_id,organization_id,external_reference,payment_number,status,method,currency,amount,received_at,payer_name,recorded_by)
  values(account_id,organization_id_value,nullif(btrim(external_reference_value),''),number_value,'succeeded',method_value,upper(currency_value),amount_value,coalesce(received_at_value,now()),nullif(btrim(payer_name_value),''),auth.uid()) returning id into payment_id_value;
  insert into public.billing_events(organization_id,payment_id,event_type,actor_user_id,payload) values(organization_id_value,payment_id_value,'payment.succeeded',auth.uid(),jsonb_build_object('amount',amount_value,'paymentNumber',number_value));
  perform public.write_audit_event('billing.payment.recorded','payment',payment_id_value::text,organization_id_value,'Payment recorded',null,jsonb_build_object('amount',amount_value,'paymentNumber',number_value));
  return payment_id_value;
end; $$;

create or replace function public.allocate_payment(payment_id_value uuid, invoice_id_value uuid, amount_value numeric)
returns void language plpgsql security definer set search_path=public as $$
declare payment_record public.payments%rowtype; invoice_record public.invoices%rowtype; allocated numeric; invoice_allocated numeric;
begin
  if not public.can_manage_billing() then raise exception 'Insufficient permission to allocate payments'; end if;
  select * into payment_record from public.payments where id=payment_id_value for update;
  select * into invoice_record from public.invoices where id=invoice_id_value for update;
  if not found or payment_record.status not in ('succeeded','partially_refunded') then raise exception 'Payment is unavailable'; end if;
  if invoice_record.organization_id<>payment_record.organization_id or invoice_record.currency<>payment_record.currency then raise exception 'Payment and invoice mismatch'; end if;
  if invoice_record.status in ('draft','void','written_off') then raise exception 'Invoice cannot receive payments'; end if;
  select coalesce(sum(amount),0) into allocated from public.payment_allocations where payment_id=payment_id_value;
  select coalesce(sum(amount),0) into invoice_allocated from public.payment_allocations where invoice_id=invoice_id_value;
  if amount_value<=0 or allocated+amount_value>payment_record.amount-payment_record.refunded_amount then raise exception 'Allocation exceeds available payment balance'; end if;
  if invoice_allocated+amount_value>invoice_record.total then raise exception 'Allocation exceeds invoice balance'; end if;
  insert into public.payment_allocations(payment_id,invoice_id,amount,created_by) values(payment_id_value,invoice_id_value,amount_value,auth.uid())
  on conflict(payment_id,invoice_id) do update set amount=public.payment_allocations.amount+excluded.amount;
  perform public.recalculate_invoice(invoice_id_value);
  insert into public.billing_events(organization_id,invoice_id,payment_id,event_type,actor_user_id,payload) values(invoice_record.organization_id,invoice_id_value,payment_id_value,'payment.allocated',auth.uid(),jsonb_build_object('amount',amount_value));
end; $$;

create or replace function public.request_refund(payment_id_value uuid, amount_value numeric, reason_value text)
returns uuid language plpgsql security definer set search_path=public as $$
declare payment_record public.payments%rowtype; refund_id_value uuid; number_value text; approval_id uuid; threshold numeric:=500000;
begin
  if not public.has_global_role(array['platform_owner'::public.global_role,'super_admin'::public.global_role,'finance_admin'::public.global_role]) then raise exception 'Finance role required'; end if;
  select * into payment_record from public.payments where id=payment_id_value for update;
  if not found or payment_record.status not in ('succeeded','partially_refunded') then raise exception 'Refundable payment not found'; end if;
  if amount_value<=0 or payment_record.refunded_amount+amount_value>payment_record.amount then raise exception 'Refund amount exceeds refundable balance'; end if;
  if char_length(btrim(reason_value))<10 then raise exception 'Refund reason must contain at least 10 characters'; end if;
  number_value:=public.next_document_number('REF-', 'refunds');
  if amount_value>=threshold then
    approval_id:=public.request_security_approval('billing.refund.large',reason_value,payment_record.organization_id,null,'payment',payment_id_value::text,60,jsonb_build_object('amount',amount_value,'paymentId',payment_id_value),number_value);
  end if;
  insert into public.refunds(payment_id,organization_id,refund_number,status,amount,reason,approval_request_id,requested_by)
  values(payment_id_value,payment_record.organization_id,number_value,case when approval_id is null then 'approved'::public.refund_status else 'pending_approval'::public.refund_status end,amount_value,btrim(reason_value),approval_id,auth.uid()) returning id into refund_id_value;
  insert into public.billing_events(organization_id,payment_id,refund_id,event_type,actor_user_id,payload) values(payment_record.organization_id,payment_id_value,refund_id_value,'refund.requested',auth.uid(),jsonb_build_object('amount',amount_value,'approvalRequestId',approval_id));
  return refund_id_value;
end; $$;

create or replace function public.complete_refund(refund_id_value uuid, external_reference_value text)
returns void language plpgsql security definer set search_path=public as $$
declare refund_record public.refunds%rowtype; payment_record public.payments%rowtype; approval_status text;
begin
  if not public.can_manage_billing() then raise exception 'Insufficient permission to process refunds'; end if;
  select * into refund_record from public.refunds where id=refund_id_value for update;
  if not found or refund_record.status not in ('approved','processing','pending_approval') then raise exception 'Refund is unavailable'; end if;
  if refund_record.approval_request_id is not null then select status into approval_status from public.approval_requests where id=refund_record.approval_request_id; if approval_status<>'approved' then raise exception 'Approved security request is required'; end if; end if;
  select * into payment_record from public.payments where id=refund_record.payment_id for update;
  update public.refunds set status='succeeded',external_reference=nullif(btrim(external_reference_value),''),processed_at=now(),approved_by=coalesce(approved_by,auth.uid()) where id=refund_id_value;
  update public.payments set refunded_amount=refunded_amount+refund_record.amount,status=case when refunded_amount+refund_record.amount>=amount then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end where id=payment_record.id;
  insert into public.billing_events(organization_id,payment_id,refund_id,event_type,actor_user_id,payload) values(refund_record.organization_id,payment_record.id,refund_id_value,'refund.succeeded',auth.uid(),jsonb_build_object('amount',refund_record.amount));
  perform public.write_audit_event('billing.refund.succeeded','refund',refund_id_value::text,refund_record.organization_id,'Refund completed',null,jsonb_build_object('amount',refund_record.amount));
end; $$;

create or replace function public.refresh_billing_balances()
returns jsonb language plpgsql security definer set search_path=public as $$
declare overdue_count integer; account_count integer;
begin
  if auth.role()<>'service_role' and not public.can_manage_billing() then raise exception 'Billing manager or service role required'; end if;
  update public.invoices set status='overdue' where status in ('issued','partially_paid') and due_at<now() and outstanding_total>0;
  get diagnostics overdue_count=row_count;
  update public.billing_accounts a set balance=coalesce(x.balance,0),overdue_balance=coalesce(x.overdue,0)
  from (select billing_account_id,sum(outstanding_total) balance,sum(case when status='overdue' then outstanding_total else 0 end) overdue from public.invoices where status not in ('draft','void','written_off') group by billing_account_id) x where a.id=x.billing_account_id;
  get diagnostics account_count=row_count;
  insert into public.dunning_cases(billing_account_id,organization_id,invoice_id,stage,next_action_at)
  select i.billing_account_id,i.organization_id,i.id,1,now() from public.invoices i where i.status='overdue' and not exists(select 1 from public.dunning_cases d where d.invoice_id=i.id and d.status in ('open','promised'));
  return jsonb_build_object('overdueInvoices',overdue_count,'accountsUpdated',account_count);
end; $$;

alter table public.billing_accounts enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.credit_notes enable row level security;
alter table public.refunds enable row level security;
alter table public.dunning_cases enable row level security;
alter table public.billing_events enable row level security;

create policy billing_accounts_staff_select on public.billing_accounts for select to authenticated using(public.is_platform_staff());
create policy invoices_staff_select on public.invoices for select to authenticated using(public.is_platform_staff());
create policy invoice_lines_staff_select on public.invoice_lines for select to authenticated using(public.is_platform_staff());
create policy payments_staff_select on public.payments for select to authenticated using(public.is_platform_staff());
create policy allocations_staff_select on public.payment_allocations for select to authenticated using(public.is_platform_staff());
create policy credit_notes_staff_select on public.credit_notes for select to authenticated using(public.is_platform_staff());
create policy refunds_staff_select on public.refunds for select to authenticated using(public.is_platform_staff());
create policy dunning_staff_select on public.dunning_cases for select to authenticated using(public.is_platform_staff());
create policy billing_events_staff_select on public.billing_events for select to authenticated using(public.is_platform_staff());

revoke insert,update,delete on public.billing_accounts,public.invoices,public.invoice_lines,public.payments,public.payment_allocations,public.credit_notes,public.refunds,public.dunning_cases,public.billing_events from authenticated;
grant select on public.billing_accounts,public.invoices,public.invoice_lines,public.payments,public.payment_allocations,public.credit_notes,public.refunds,public.dunning_cases,public.billing_events to authenticated;
grant all on public.billing_accounts,public.invoices,public.invoice_lines,public.payments,public.payment_allocations,public.credit_notes,public.refunds,public.dunning_cases,public.billing_events to service_role;

grant execute on function public.create_invoice(uuid,uuid,text,timestamptz,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.add_invoice_line(uuid,public.invoice_line_type,text,numeric,numeric,numeric,numeric,uuid,uuid) to authenticated;
grant execute on function public.issue_invoice(uuid) to authenticated;
grant execute on function public.record_payment(uuid,numeric,text,public.payment_method,timestamptz,text,text) to authenticated;
grant execute on function public.allocate_payment(uuid,uuid,numeric) to authenticated;
grant execute on function public.request_refund(uuid,numeric,text) to authenticated;
grant execute on function public.complete_refund(uuid,text) to authenticated;
grant execute on function public.refresh_billing_balances() to authenticated,service_role;
