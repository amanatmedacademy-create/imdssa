import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, PoolClient } from 'pg';

type User = { id: string; global_role: string | null };
type Json = (res: ServerResponse, status: number, body: unknown) => void;

type SubscriptionRow = {
  id: string;
  organization_id: string;
  product_id: string;
  plan_id: string | null;
  status: string;
  billing_period_months: number;
  currency: string;
  base_price_kzt: string | number | null;
  addons_price_kzt: string | number;
  custom_price_kzt: string | number | null;
  payment_method: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  access_ends_at: string | null;
  plan_snapshot: Record<string, unknown>;
  organization_name: string;
  legal_name: string | null;
  bin: string | null;
  product_name: string;
  product_code: string;
  plan_name: string | null;
};

function canManage(user: User): boolean { return user.global_role === 'platform_owner' || user.global_role === 'platform_admin'; }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function plusMonths(source: Date, months: number): Date { const date = new Date(source); date.setUTCMonth(date.getUTCMonth() + months); return date; }

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
}

async function audit(client: Pool | PoolClient, user: User, action: string, targetType: string, targetId: string, beforeState: unknown, afterState: unknown) {
  await client.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,before_state,after_state)
    values($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [user.id, action, targetType, targetId, JSON.stringify(beforeState ?? null), JSON.stringify(afterState ?? null)]);
}

async function subscriptionForBilling(client: Pool | PoolClient, subscriptionId: string): Promise<SubscriptionRow | null> {
  const result = await client.query<SubscriptionRow>(`select s.*,o.name organization_name,o.legal_name,o.bin,p.name product_name,p.code product_code,pp.name plan_name
    from app.product_subscriptions s
    join app.organizations o on o.id=s.organization_id
    join app.products p on p.id=s.product_id
    left join app.product_plans pp on pp.id=s.plan_id
    where s.id=$1`, [subscriptionId]);
  return result.rows[0] ?? null;
}

async function invoiceDetail(client: Pool | PoolClient, invoiceId: string) {
  const invoice = await client.query(`select i.*,o.name organization_name,p.name product_name,p.code product_code,
      pp.name plan_name,s.status subscription_status,s.billing_period_months,s.current_period_end subscription_period_end,
      greatest(i.total_kzt-i.paid_total_kzt,0) outstanding_kzt
    from app.billing_invoices i
    join app.organizations o on o.id=i.organization_id
    join app.product_subscriptions s on s.id=i.subscription_id
    join app.products p on p.id=s.product_id
    left join app.product_plans pp on pp.id=s.plan_id
    where i.id=$1`, [invoiceId]);
  if (!invoice.rowCount) return null;
  const lines = await client.query(`select l.*,m.name module_name,m.code module_code from app.billing_invoice_lines l left join app.modules m on m.id=l.module_id where l.invoice_id=$1 order by l.created_at,l.id`, [invoiceId]);
  const payments = await client.query(`select p.id,p.payment_number,p.status,p.method,p.amount_kzt,p.external_reference,p.payer_name,p.received_at,a.amount_kzt allocated_kzt
    from app.billing_payment_allocations a join app.billing_payments p on p.id=a.payment_id where a.invoice_id=$1 order by p.received_at desc nulls last,p.created_at desc`, [invoiceId]);
  return { ...invoice.rows[0], lines: lines.rows, payments: payments.rows };
}

async function ensureBillingAccount(client: PoolClient, subscription: SubscriptionRow): Promise<string> {
  const account = await client.query<{id:string}>(`insert into app.billing_accounts(organization_id,legal_name,bin_iin,currency)
    values($1,$2,$3,'KZT')
    on conflict(organization_id) do update set legal_name=coalesce(excluded.legal_name,app.billing_accounts.legal_name),bin_iin=coalesce(excluded.bin_iin,app.billing_accounts.bin_iin),updated_at=now()
    returning id`, [subscription.organization_id, subscription.legal_name, subscription.bin]);
  return account.rows[0].id;
}

async function activatePaidSubscription(client: PoolClient, subscriptionId: string, invoiceId: string, user: User) {
  const subscription = await subscriptionForBilling(client, subscriptionId);
  if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
  const before = { status: subscription.status, currentPeriodStart: subscription.current_period_start, currentPeriodEnd: subscription.current_period_end, accessEndsAt: subscription.access_ends_at };
  const now = new Date();
  const currentEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  const renewal = currentEnd && Number.isFinite(currentEnd.getTime()) && currentEnd > now;
  const periodStart = renewal ? (subscription.current_period_start ? new Date(subscription.current_period_start) : now) : now;
  const periodEnd = plusMonths(renewal ? currentEnd! : now, Number(subscription.billing_period_months || 1));

  await client.query(`update app.product_subscriptions set status='active',trial_started_at=null,trial_ends_at=null,
    current_period_start=$2,current_period_end=$3,grace_ends_at=null,access_ends_at=$3,updated_at=now() where id=$1`,
    [subscriptionId, periodStart.toISOString(), periodEnd.toISOString()]);
  await client.query(`update app.organization_products set status='active',config=config || jsonb_build_object('subscriptionStatus','active','subscriptionId',$3::text,'billingInvoiceId',$4::text),updated_at=now()
    where organization_id=$1 and product_id=$2`, [subscription.organization_id, subscription.product_id, subscriptionId, invoiceId]);
  await client.query(`insert into app.product_subscription_events(subscription_id,event_type,payload,actor_user_id)
    values($1,'subscription.payment_activated',$2::jsonb,$3)`, [subscriptionId, JSON.stringify({ invoiceId, periodEnd: periodEnd.toISOString(), renewal }), user.id]);
  await client.query(`insert into app.billing_events(organization_id,subscription_id,invoice_id,event_type,payload,actor_user_id)
    values($1,$2,$3,'subscription.activated_from_payment',$4::jsonb,$5)`, [subscription.organization_id, subscriptionId, invoiceId, JSON.stringify({ periodEnd: periodEnd.toISOString(), renewal }), user.id]);
  await audit(client,user,'subscription.payment_activated','product_subscription',subscriptionId,before,{status:'active',currentPeriodStart:periodStart.toISOString(),currentPeriodEnd:periodEnd.toISOString(),accessEndsAt:periodEnd.toISOString()});
}

async function refreshInvoice(client: PoolClient, invoiceId: string, user: User) {
  const locked = await client.query(`select * from app.billing_invoices where id=$1 for update`, [invoiceId]);
  if (!locked.rowCount) throw new Error('INVOICE_NOT_FOUND');
  const invoice = locked.rows[0];
  const paid = await client.query<{amount:string}>(`select coalesce(sum(a.amount_kzt),0)::text amount from app.billing_payment_allocations a join app.billing_payments p on p.id=a.payment_id where a.invoice_id=$1 and p.status in ('succeeded','partially_refunded')`, [invoiceId]);
  const paidTotal = Number(paid.rows[0]?.amount || 0);
  const total = Number(invoice.total_kzt || 0);
  const nextStatus = paidTotal >= total && total > 0 ? 'paid' : paidTotal > 0 ? 'partially_paid' : (invoice.due_at && new Date(invoice.due_at).getTime() < Date.now() ? 'overdue' : invoice.status === 'draft' ? 'draft' : 'issued');
  await client.query(`update app.billing_invoices set paid_total_kzt=$2,status=$3,paid_at=case when $3='paid' then coalesce(paid_at,now()) else null end,updated_at=now() where id=$1`, [invoiceId, paidTotal, nextStatus]);
  if (nextStatus === 'paid' && invoice.status !== 'paid') await activatePaidSubscription(client, invoice.subscription_id, invoiceId, user);
}

export async function handleBillingApi(args: { req: IncomingMessage; res: ServerResponse; pool: Pool; url: URL; method: string; user: User; json: Json }): Promise<boolean> {
  const { req,res,pool,url,method,user,json } = args;
  if (!url.pathname.startsWith('/api/v1/billing/')) return false;
  if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }

  if (url.pathname === '/api/v1/billing/overview' && method === 'GET') {
    await pool.query(`update app.billing_invoices set status='overdue',updated_at=now() where status in ('issued','partially_paid') and due_at<now() and paid_total_kzt<total_kzt`);
    const result = await pool.query(`select
      (select count(*)::int from app.billing_invoices where status in ('issued','partially_paid','overdue')) open_invoices,
      (select coalesce(sum(total_kzt-paid_total_kzt),0) from app.billing_invoices where status in ('issued','partially_paid','overdue')) receivables_kzt,
      (select coalesce(sum(total_kzt-paid_total_kzt),0) from app.billing_invoices where status='overdue') overdue_kzt,
      (select coalesce(sum(amount_kzt),0) from app.billing_payments where status='succeeded' and received_at>=date_trunc('month',now())) paid_this_month_kzt`);
    json(res,200,result.rows[0]); return true;
  }

  if (url.pathname === '/api/v1/billing/invoices' && method === 'GET') {
    const organizationId=text(url.searchParams.get('organizationId')); const values:unknown[]=[]; let where='';
    if(organizationId){values.push(organizationId);where='where i.organization_id=$1';}
    const result=await pool.query(`select i.*,o.name organization_name,p.name product_name,p.code product_code,pp.name plan_name,greatest(i.total_kzt-i.paid_total_kzt,0) outstanding_kzt
      from app.billing_invoices i join app.organizations o on o.id=i.organization_id join app.product_subscriptions s on s.id=i.subscription_id join app.products p on p.id=s.product_id left join app.product_plans pp on pp.id=s.plan_id
      ${where} order by i.created_at desc limit 500`,values);
    json(res,200,{items:result.rows}); return true;
  }

  if (url.pathname === '/api/v1/billing/payments' && method === 'GET') {
    const organizationId=text(url.searchParams.get('organizationId')); const values:unknown[]=[]; let where='';
    if(organizationId){values.push(organizationId);where='where p.organization_id=$1';}
    const result=await pool.query(`select p.*,o.name organization_name from app.billing_payments p join app.organizations o on o.id=p.organization_id ${where} order by p.received_at desc nulls last,p.created_at desc limit 500`,values);
    json(res,200,{items:result.rows}); return true;
  }

  const invoiceDetailMatch=url.pathname.match(/^\/api\/v1\/billing\/invoices\/([0-9a-f-]+)$/i);
  if(invoiceDetailMatch&&method==='GET'){
    const detail=await invoiceDetail(pool,invoiceDetailMatch[1]); if(!detail){json(res,404,{error:'INVOICE_NOT_FOUND'});return true;} json(res,200,detail);return true;
  }

  if (url.pathname === '/api/v1/billing/invoices' && method === 'POST') {
    const data=await body(req); const subscriptionId=text(data.subscriptionId); const issue=data.issue!==false; const dueDaysRaw=number(data.dueDays); const dueDays=dueDaysRaw==null?7:Math.trunc(dueDaysRaw);
    if(!subscriptionId){json(res,400,{error:'SUBSCRIPTION_REQUIRED'});return true;} if(dueDays<0||dueDays>365){json(res,400,{error:'INVALID_DUE_DAYS'});return true;}
    const client=await pool.connect();
    try{
      await client.query('begin'); const subscription=await subscriptionForBilling(client,subscriptionId); if(!subscription){await client.query('rollback');json(res,404,{error:'SUBSCRIPTION_NOT_FOUND'});return true;}
      if(['free','beta','canceled'].includes(subscription.status)){await client.query('rollback');json(res,409,{error:'SUBSCRIPTION_NOT_BILLABLE'});return true;}
      const custom=number(subscription.custom_price_kzt); const base=number(subscription.base_price_kzt)||0; const addons=number(subscription.addons_price_kzt)||0; const total=custom!=null?custom:base+addons;
      if(total<=0){await client.query('rollback');json(res,409,{error:'SUBSCRIPTION_PRICE_NOT_CONFIGURED'});return true;}
      const duplicate=await client.query(`select id from app.billing_invoices where subscription_id=$1 and status in ('draft','issued','partially_paid','overdue') order by created_at desc limit 1`,[subscriptionId]);
      if(duplicate.rowCount){await client.query('rollback');json(res,409,{error:'OPEN_INVOICE_ALREADY_EXISTS',invoiceId:duplicate.rows[0].id});return true;}
      const accountId=await ensureBillingAccount(client,subscription); const numberResult=await client.query<{value:string}>(`select app.next_billing_document_number('INV-','invoice') value`); const invoiceNumber=numberResult.rows[0].value;
      const now=new Date(); const dueAt=new Date(now.getTime()+dueDays*86400000); const periodStart=subscription.current_period_end&&new Date(subscription.current_period_end)>now?new Date(subscription.current_period_end):now; const periodEnd=plusMonths(periodStart,Number(subscription.billing_period_months||1));
      const inserted=await client.query<{id:string}>(`insert into app.billing_invoices(billing_account_id,organization_id,subscription_id,invoice_number,status,currency,subtotal_kzt,total_kzt,period_start,period_end,issued_at,due_at,notes,pricing_snapshot,created_by)
        values($1,$2,$3,$4,$5,'KZT',$6,$6,$7,$8,$9,$10,nullif($11,''),$12::jsonb,$13) returning id`,[accountId,subscription.organization_id,subscriptionId,invoiceNumber,issue?'issued':'draft',total,periodStart.toISOString(),periodEnd.toISOString(),issue?now.toISOString():null,issue?dueAt.toISOString():null,text(data.notes),JSON.stringify({planId:subscription.plan_id,planName:subscription.plan_name,basePriceKzt:base,addonsPriceKzt:addons,customPriceKzt:custom,billingPeriodMonths:subscription.billing_period_months,planSnapshot:subscription.plan_snapshot}),user.id]);
      const invoiceId=inserted.rows[0].id;
      if(custom!=null){await client.query(`insert into app.billing_invoice_lines(invoice_id,line_type,product_id,description,quantity,unit_price_kzt,line_total_kzt,metadata) values($1,'subscription',$2,$3,1,$4,$4,$5::jsonb)`,[invoiceId,subscription.product_id,`${subscription.product_name} · ${subscription.plan_name||'индивидуальный тариф'}`,custom,JSON.stringify({customPrice:true})]);}
      else{
        if(base>0)await client.query(`insert into app.billing_invoice_lines(invoice_id,line_type,product_id,description,quantity,unit_price_kzt,line_total_kzt) values($1,'subscription',$2,$3,1,$4,$4)`,[invoiceId,subscription.product_id,`${subscription.product_name} · ${subscription.plan_name||'тариф'}`,base]);
        const addonRows=await client.query(`select i.module_id,i.unit_price_kzt,m.name,m.code from app.product_subscription_items i join app.modules m on m.id=i.module_id where i.subscription_id=$1 and i.mode='addon' and i.status='active' order by m.name`,[subscriptionId]);
        for(const addon of addonRows.rows){const price=Number(addon.unit_price_kzt||0);if(price>0)await client.query(`insert into app.billing_invoice_lines(invoice_id,line_type,product_id,module_id,description,quantity,unit_price_kzt,line_total_kzt) values($1,'addon',$2,$3,$4,1,$5,$5)`,[invoiceId,subscription.product_id,addon.module_id,addon.name,price]);}
      }
      if(issue&&subscription.status==='trial') await client.query(`update app.product_subscriptions set status='pending_payment',updated_at=now() where id=$1`,[subscriptionId]);
      await client.query(`insert into app.billing_events(organization_id,subscription_id,invoice_id,event_type,payload,actor_user_id) values($1,$2,$3,$4,$5::jsonb,$6)`,[subscription.organization_id,subscriptionId,invoiceId,issue?'invoice.issued':'invoice.created',JSON.stringify({invoiceNumber,totalKzt:total,dueAt:issue?dueAt.toISOString():null}),user.id]);
      await audit(client,user,issue?'billing.invoice.issued':'billing.invoice.created','billing_invoice',invoiceId,null,{invoiceNumber,totalKzt:total,subscriptionId}); await client.query('commit'); json(res,201,await invoiceDetail(client,invoiceId));
    }catch(error){await client.query('rollback');throw error;}finally{client.release();} return true;
  }

  const issueMatch=url.pathname.match(/^\/api\/v1\/billing\/invoices\/([0-9a-f-]+)\/issue$/i);
  if(issueMatch&&method==='POST'){
    const data=await body(req);const dueDays=Math.trunc(number(data.dueDays)??7);if(dueDays<0||dueDays>365){json(res,400,{error:'INVALID_DUE_DAYS'});return true;}
    const result=await pool.query(`update app.billing_invoices set status='issued',issued_at=now(),due_at=now()+($2::text||' days')::interval,updated_at=now() where id=$1 and status='draft' returning id`,[issueMatch[1],dueDays]);
    if(!result.rowCount){json(res,409,{error:'DRAFT_INVOICE_REQUIRED'});return true;} await audit(pool,user,'billing.invoice.issued','billing_invoice',issueMatch[1],{status:'draft'},{status:'issued'});json(res,200,await invoiceDetail(pool,issueMatch[1]));return true;
  }

  if(url.pathname==='/api/v1/billing/payments'&&method==='POST'){
    const data=await body(req);const invoiceId=text(data.invoiceId);const methodName=text(data.method)||'manual';const allowed=new Set(['bank_transfer','kaspi','card','cash','manual','other']);if(!invoiceId||!allowed.has(methodName)){json(res,400,{error:'INVOICE_AND_VALID_METHOD_REQUIRED'});return true;}
    const client=await pool.connect();
    try{
      await client.query('begin');const invoiceResult=await client.query(`select * from app.billing_invoices where id=$1 for update`,[invoiceId]);if(!invoiceResult.rowCount){await client.query('rollback');json(res,404,{error:'INVOICE_NOT_FOUND'});return true;}const invoice=invoiceResult.rows[0];
      if(['draft','paid','void','written_off'].includes(invoice.status)){await client.query('rollback');json(res,409,{error:'INVOICE_CANNOT_RECEIVE_PAYMENT'});return true;}
      const outstanding=Number(invoice.total_kzt)-Number(invoice.paid_total_kzt);const requested=number(data.amountKzt);const amount=requested==null?outstanding:requested;if(amount<=0||amount>outstanding+0.001){await client.query('rollback');json(res,409,{error:'PAYMENT_EXCEEDS_OUTSTANDING',outstandingKzt:outstanding});return true;}
      const externalReference=text(data.externalReference)||null;if(externalReference){const existing=await client.query(`select id from app.billing_payments where organization_id=$1 and external_reference=$2`,[invoice.organization_id,externalReference]);if(existing.rowCount){await client.query('rollback');json(res,409,{error:'PAYMENT_REFERENCE_ALREADY_EXISTS',paymentId:existing.rows[0].id});return true;}}
      const numberResult=await client.query<{value:string}>(`select app.next_billing_document_number('PAY-','payment') value`);const paymentNumber=numberResult.rows[0].value;const receivedAt=text(data.receivedAt);const receivedDate=receivedAt&&Number.isFinite(Date.parse(receivedAt))?new Date(receivedAt):new Date();
      const payment=await client.query<{id:string}>(`insert into app.billing_payments(billing_account_id,organization_id,payment_number,status,method,currency,amount_kzt,external_reference,payer_name,received_at,recorded_by,metadata)
        values($1,$2,$3,'succeeded',$4,'KZT',$5,$6,nullif($7,''),$8,$9,$10::jsonb) returning id`,[invoice.billing_account_id,invoice.organization_id,paymentNumber,methodName,amount,externalReference,text(data.payerName),receivedDate.toISOString(),user.id,JSON.stringify({source:'control_center_manual_confirmation'})]);
      const paymentId=payment.rows[0].id;await client.query(`insert into app.billing_payment_allocations(payment_id,invoice_id,amount_kzt,created_by) values($1,$2,$3,$4)`,[paymentId,invoiceId,amount,user.id]);
      await client.query(`insert into app.billing_events(organization_id,subscription_id,invoice_id,payment_id,event_type,payload,actor_user_id) values($1,$2,$3,$4,'payment.confirmed',$5::jsonb,$6)`,[invoice.organization_id,invoice.subscription_id,invoiceId,paymentId,JSON.stringify({paymentNumber,amountKzt:amount,method:methodName,externalReference}),user.id]);
      await refreshInvoice(client,invoiceId,user);await audit(client,user,'billing.payment.confirmed','billing_payment',paymentId,null,{paymentNumber,invoiceId,amountKzt:amount,method:methodName});await client.query('commit');json(res,201,{paymentId,paymentNumber,invoice:await invoiceDetail(client,invoiceId)});
    }catch(error){await client.query('rollback');throw error;}finally{client.release();}return true;
  }

  json(res,404,{error:'NOT_FOUND'});return true;
}
