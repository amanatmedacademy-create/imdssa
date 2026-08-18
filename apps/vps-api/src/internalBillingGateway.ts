import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, PoolClient } from 'pg';

type JsonRecord = Record<string, unknown>;

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}
function bearer(req: IncomingMessage): string {
  const authorization = String(req.headers.authorization || '');
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
async function body(req: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRecord : {};
}

async function resolveTarget(pool: Pool | PoolClient, input: { organizationId?: string; externalTenantId?: string }) {
  const organizationId = text(input.organizationId);
  const externalTenantId = text(input.externalTenantId);
  const result = await pool.query(`select o.id organization_id,o.external_key,o.name organization_name,p.id product_id,p.code product_code,p.name product_name
    from app.organizations o cross join app.products p
    where p.code='imds-marketing'
      and (($1<>'' and o.id=$1::uuid) or ($1='' and $2<>'' and o.external_key=$2))
    limit 1`, [organizationId, externalTenantId]);
  return result.rows[0] ?? null;
}

async function invoiceList(pool: Pool | PoolClient, organizationId: string, productId: string) {
  const result = await pool.query(`select i.id,i.invoice_number number,i.status,i.total_kzt amount,i.currency,i.issued_at "issuedAt",i.due_at "dueAt",i.paid_at "paidAt",
      greatest(i.total_kzt-i.paid_total_kzt,0) "outstandingAmount"
    from app.billing_invoices i join app.product_subscriptions s on s.id=i.subscription_id
    where i.organization_id=$1 and s.product_id=$2
    order by i.created_at desc limit 100`, [organizationId,productId]);
  return result.rows;
}

async function center(pool: Pool, target: Record<string, unknown>) {
  const organizationId = String(target.organization_id);
  const productId = String(target.product_id);
  const subscriptionResult = await pool.query(`select s.*,pp.code plan_code,pp.name plan_name,pp.description plan_description
    from app.product_subscriptions s left join app.product_plans pp on pp.id=s.plan_id
    where s.organization_id=$1 and s.product_id=$2 limit 1`, [organizationId,productId]);
  const subscription = subscriptionResult.rows[0] ?? null;
  const plansResult = await pool.query(`select p.id,p.code,p.name,p.description,p.featured,p.limits,p.pricing_mode,
      coalesce((select jsonb_object_agg(pr.months::text,pr.amount_kzt order by pr.months) from app.product_plan_prices pr where pr.plan_id=p.id),'{}'::jsonb) prices
    from app.product_plans p where p.product_id=$1 and p.status='published' order by p.sort_order,p.name`, [productId]);
  const methodsResult = await pool.query(`select method,display_name "displayName",instructions,is_default "isDefault" from app.product_payment_methods where product_id=$1 and enabled=true order by sort_order,method`, [productId]);
  const addonsResult = await pool.query(`select m.code,m.name,m.description,
      coalesce((select jsonb_object_agg(mp.months::text,mp.amount_kzt order by mp.months) from app.product_module_prices mp where mp.product_id=$1 and mp.module_id=m.id),'{}'::jsonb) prices
    from app.modules m join app.product_module_commercial c on c.product_id=$1 and c.module_id=m.id
    where m.owner_product_id=$1 and m.status='published' and c.commercial_role='module' and c.separately_sellable=true
    order by c.sort_order,m.name`, [productId]);
  const invoices = await invoiceList(pool,organizationId,productId);
  const months = Number(subscription?.billing_period_months || 1);
  const currentPlanPrice = subscription ? (subscription.custom_price_kzt ?? (Number(subscription.base_price_kzt || 0) + Number(subscription.addons_price_kzt || 0))) : null;
  const plans = plansResult.rows.map((plan) => ({
    code: plan.code,name: plan.name,description: plan.description,amount: plan.pricing_mode==='fixed' ? number(plan.prices?.[String(months)]) : null,
    currency:'KZT',interval:`${months} мес.`,current: subscription?.plan_id===plan.id,recommended:Boolean(plan.featured),limits:plan.limits,prices:plan.prices,pricingMode:plan.pricing_mode,
  }));
  return {
    configured:true,gatewayAvailable:true,managed:true,
    tenantId:String(target.external_key || ''),organizationId,
    billing: subscription ? {
      subscriptionStatus:subscription.status,trialEndsAt:subscription.trial_ends_at,periodEndsAt:subscription.current_period_end,
      graceEndsAt:subscription.grace_ends_at,accessEndsAt:subscription.access_ends_at,renewalMode:subscription.renewal_mode,currency:subscription.currency || 'KZT',
      paymentMethods:methodsResult.rows,defaultPaymentMethod:subscription.payment_method,
    } : null,
    plan: subscription ? { code:subscription.plan_code || 'custom',name:subscription.plan_name || 'Без тарифа',description:subscription.plan_description,
      amount:number(currentPlanPrice),currency:subscription.currency || 'KZT',interval:`${months} мес.`,current:true,limits:subscription.limits } : null,
    plans,
    addOns:addonsResult.rows.map((addon) => ({ code:addon.code,name:addon.name,description:addon.description,amount:number(addon.prices?.[String(months)]),currency:'KZT',unit:`${months} мес.`,prices:addon.prices })),
    invoices,
    capabilities:{checkout:true,portal:false,invoices:true,addOns:false},
  };
}

async function ensureAccount(client: PoolClient, target: Record<string, unknown>): Promise<string> {
  const result = await client.query<{id:string}>(`insert into app.billing_accounts(organization_id,legal_name,bin_iin,currency)
    select id,legal_name,bin,'KZT' from app.organizations where id=$1
    on conflict(organization_id) do update set legal_name=coalesce(excluded.legal_name,app.billing_accounts.legal_name),bin_iin=coalesce(excluded.bin_iin,app.billing_accounts.bin_iin),updated_at=now()
    returning id`, [target.organization_id]);
  return result.rows[0].id;
}

async function checkout(pool: Pool, target: Record<string, unknown>, payload: JsonRecord) {
  if (payload.kind === 'addon') return { status:409, body:{ error:'ADDON_SELF_SERVICE_NOT_ENABLED' } };
  const planCode = text(payload.planCode);
  const months = Math.trunc(Number(payload.billingPeriodMonths || 1));
  if (!planCode) return { status:400, body:{ error:'PLAN_CODE_REQUIRED' } };
  if (![1,3,6,12].includes(months)) return { status:400, body:{ error:'INVALID_BILLING_PERIOD' } };

  const client = await pool.connect();
  try {
    await client.query('begin');
    const subscriptionResult = await client.query(`select s.* from app.product_subscriptions s where s.organization_id=$1 and s.product_id=$2 for update`, [target.organization_id,target.product_id]);
    if (!subscriptionResult.rowCount) { await client.query('rollback'); return { status:404, body:{error:'SUBSCRIPTION_NOT_FOUND'} }; }
    const subscription = subscriptionResult.rows[0];
    const planResult = await client.query(`select p.*,(select amount_kzt from app.product_plan_prices where plan_id=p.id and months=$3) period_price
      from app.product_plans p where p.product_id=$1 and p.code=$2 and p.status='published' limit 1`, [target.product_id,planCode,months]);
    if (!planResult.rowCount) { await client.query('rollback'); return { status:404, body:{error:'PLAN_NOT_FOUND'} }; }
    const plan = planResult.rows[0];
    if (plan.pricing_mode!=='fixed') { await client.query('rollback'); return { status:409, body:{error:'PLAN_REQUIRES_SALES_CONTACT'} }; }
    const price = number(plan.period_price);
    if (price == null || price <= 0) { await client.query('rollback'); return { status:409, body:{error:'PLAN_PRICE_NOT_CONFIGURED_FOR_PERIOD'} }; }
    const duplicate = await client.query(`select id,invoice_number from app.billing_invoices where subscription_id=$1 and status in ('draft','issued','partially_paid','overdue') order by created_at desc limit 1`, [subscription.id]);
    if (duplicate.rowCount) { await client.query('rollback'); return { status:409, body:{error:'OPEN_INVOICE_ALREADY_EXISTS',invoiceId:duplicate.rows[0].id,invoiceNumber:duplicate.rows[0].invoice_number} }; }
    const accountId = await ensureAccount(client,target);
    const document = await client.query<{value:string}>(`select app.next_billing_document_number('INV-','invoice') value`);
    const invoiceNumber = document.rows[0].value;
    const now = new Date(); const dueAt = new Date(now.getTime()+7*86400000);
    const periodStart = subscription.current_period_end && new Date(subscription.current_period_end)>now ? new Date(subscription.current_period_end) : now;
    const periodEnd = new Date(periodStart); periodEnd.setUTCMonth(periodEnd.getUTCMonth()+months);
    const snapshot = { pendingPlanId:plan.id,pendingPlanCode:plan.code,pendingPlanRevision:plan.revision,pendingBillingPeriodMonths:months,pendingLimits:plan.limits,source:'marketing_self_service' };
    const inserted = await client.query<{id:string}>(`insert into app.billing_invoices(billing_account_id,organization_id,subscription_id,invoice_number,status,currency,subtotal_kzt,total_kzt,period_start,period_end,issued_at,due_at,pricing_snapshot,metadata)
      values($1,$2,$3,$4,'issued','KZT',$5,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb) returning id`,
      [accountId,target.organization_id,subscription.id,invoiceNumber,price,periodStart.toISOString(),periodEnd.toISOString(),now.toISOString(),dueAt.toISOString(),JSON.stringify(snapshot),JSON.stringify({source:'marketing_self_service'})]);
    const invoiceId = inserted.rows[0].id;
    await client.query(`insert into app.billing_invoice_lines(invoice_id,line_type,product_id,description,quantity,unit_price_kzt,line_total_kzt,metadata)
      values($1,'subscription',$2,$3,1,$4,$4,$5::jsonb)`, [invoiceId,target.product_id,`${target.product_name} · ${plan.name} · ${months} мес.`,price,JSON.stringify({planCode:plan.code,months})]);
    await client.query(`insert into app.billing_events(organization_id,subscription_id,invoice_id,event_type,payload)
      values($1,$2,$3,'invoice.self_service_issued',$4::jsonb)`, [target.organization_id,subscription.id,invoiceId,JSON.stringify({invoiceNumber,planCode:plan.code,months,totalKzt:price})]);
    await client.query('commit');
    return { status:201, body:{ ok:true,invoiceCreated:true,invoiceId,invoiceNumber,status:'issued',amount:price,currency:'KZT',dueAt:dueAt.toISOString() } };
  } catch (error) {
    await client.query('rollback'); throw error;
  } finally { client.release(); }
}

export async function handleInternalBillingGateway(req: IncomingMessage,res: ServerResponse,pool: Pool,url: URL,method: string): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/billing/')) return false;
  const expected = String(process.env.IMDS_PLATFORM_CONTROL_TOKEN || '').trim();
  if (!expected || bearer(req)!==expected) { json(res,401,{error:'PLATFORM_CONTROL_UNAUTHORIZED'}); return true; }
  const input = method==='GET' ? Object.fromEntries(url.searchParams.entries()) : await body(req);
  const target = await resolveTarget(pool,{ organizationId:text(input.organizationId),externalTenantId:text(input.externalTenantId) });
  if (!target) { json(res,404,{error:'BILLING_TENANT_NOT_FOUND'}); return true; }

  if (url.pathname==='/v1/billing/center' && method==='GET') { json(res,200,await center(pool,target)); return true; }
  if (url.pathname==='/v1/billing/invoices' && method==='GET') { json(res,200,{items:await invoiceList(pool,String(target.organization_id),String(target.product_id))}); return true; }
  if (url.pathname==='/v1/billing/refresh' && method==='POST') { const refreshed=await pool.query(`select app.refresh_subscription_lifecycle() result`); json(res,200,{ok:true,lifecycle:refreshed.rows[0]?.result,center:await center(pool,target)}); return true; }
  if (url.pathname==='/v1/billing/checkout' && method==='POST') { const result=await checkout(pool,target,input); json(res,result.status,result.body); return true; }
  if (url.pathname==='/v1/billing/portal' && method==='POST') { json(res,409,{error:'PAYMENT_PORTAL_NOT_ENABLED'}); return true; }
  json(res,404,{error:'NOT_FOUND'}); return true;
}
