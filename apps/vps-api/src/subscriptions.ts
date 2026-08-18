import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, PoolClient } from 'pg';

type User = { id: string; global_role: string | null };
type Json = (res: ServerResponse, status: number, body: unknown) => void;
type PlanModule = { module_id: string; mode: 'included' | 'addon' | 'disabled'; price_override_kzt: string | number | null };

const statuses = new Set(['trial','pending_payment','active','past_due','grace','read_only','suspended','expired','canceled','free','beta']);
const accessStatuses = new Set(['trial','pending_payment','active','past_due','grace','read_only','expired','canceled','free','beta']);

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function numberOrNull(value: unknown): number | null { const valueNumber = Number(value); return value == null || value === '' || !Number.isFinite(valueNumber) ? null : valueNumber; }
function canManage(user: User): boolean { return user.global_role === 'platform_owner' || user.global_role === 'platform_admin'; }
function canAssignDraft(user: User): boolean { return user.global_role === 'platform_owner'; }
function iso(value: unknown): string | null { const raw = text(value); if (!raw) return null; const time = Date.parse(raw); return Number.isFinite(time) ? new Date(time).toISOString() : null; }
function plusDays(source: Date, days: number): string { const date = new Date(source); date.setUTCDate(date.getUTCDate() + days); return date.toISOString(); }
function plusMonths(source: Date, months: number): string { const date = new Date(source); date.setUTCMonth(date.getUTCMonth() + months); return date.toISOString(); }

async function audit(client: Pool | PoolClient, user: User, action: string, targetType: string, targetId: string, beforeState: unknown, afterState: unknown) {
  await client.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,before_state,after_state)
    values($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [user.id, action, targetType, targetId, JSON.stringify(beforeState ?? null), JSON.stringify(afterState ?? null)]);
}

async function subscriptionDetail(client: Pool | PoolClient, organizationId: string, productId: string) {
  const subscription = await client.query(`select s.*,o.name organization_name,p.name product_name,p.code product_code,
    pp.code plan_code,pp.name plan_name
    from app.product_subscriptions s
    join app.organizations o on o.id=s.organization_id
    join app.products p on p.id=s.product_id
    left join app.product_plans pp on pp.id=s.plan_id
    where s.organization_id=$1 and s.product_id=$2`, [organizationId, productId]);
  if (!subscription.rowCount) return null;
  const id = subscription.rows[0].id;
  const items = await client.query(`select i.*,m.code module_code,m.name module_name
    from app.product_subscription_items i join app.modules m on m.id=i.module_id
    where i.subscription_id=$1 order by i.mode,m.name`, [id]);
  const events = await client.query(`select id,event_type,payload,actor_user_id,created_at from app.product_subscription_events where subscription_id=$1 order by id desc limit 100`, [id]);
  return { ...subscription.rows[0], items: items.rows, events: events.rows };
}

export async function handleSubscriptionApi(args: { req: IncomingMessage; res: ServerResponse; pool: Pool; url: URL; method: string; user: User; json: Json }): Promise<boolean> {
  const { req,res,pool,url,method,user,json } = args;

  if (url.pathname === '/api/v1/subscriptions' && method === 'GET') {
    const organizationId = text(url.searchParams.get('organizationId'));
    const values: unknown[] = [];
    let where = '';
    if (organizationId) { values.push(organizationId); where = 'where s.organization_id=$1'; }
    const result = await pool.query(`select s.id,s.organization_id,s.product_id,s.plan_id,s.status,s.billing_period_months,s.currency,
      s.base_price_kzt,s.addons_price_kzt,s.custom_price_kzt,s.payment_method,s.renewal_mode,s.trial_ends_at,s.current_period_end,s.grace_ends_at,s.access_ends_at,s.updated_at,
      o.name organization_name,p.name product_name,p.code product_code,pp.code plan_code,pp.name plan_name,
      (select count(*)::int from app.product_subscription_items i where i.subscription_id=s.id and i.status='active') item_count
      from app.product_subscriptions s join app.organizations o on o.id=s.organization_id join app.products p on p.id=s.product_id left join app.product_plans pp on pp.id=s.plan_id
      ${where} order by s.updated_at desc limit 1000`, values);
    json(res,200,{items:result.rows}); return true;
  }

  const detailMatch = url.pathname.match(/^\/api\/v1\/organizations\/([0-9a-f-]+)\/products\/([0-9a-f-]+)\/subscription$/i);
  if (!detailMatch) return false;
  const organizationId = detailMatch[1], productId = detailMatch[2];

  if (method === 'GET') {
    const detail = await subscriptionDetail(pool, organizationId, productId);
    if (!detail) { json(res,404,{error:'SUBSCRIPTION_NOT_FOUND'}); return true; }
    json(res,200,detail); return true;
  }

  if (method !== 'PUT') { json(res,405,{error:'METHOD_NOT_ALLOWED'}); return true; }
  if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }

  const data = await body(req);
  const planId = text(data.planId) || null;
  const status = text(data.status) || 'active';
  const months = Number(data.billingPeriodMonths ?? 1);
  const selectedAddons = Array.isArray(data.addonModuleIds) ? [...new Set(data.addonModuleIds.map(text).filter(Boolean))] : [];
  const paymentMethod = text(data.paymentMethod) || null;
  const customPrice = numberOrNull(data.customPriceKzt);
  const renewalMode = text(data.renewalMode) === 'auto' ? 'auto' : 'manual';
  if (!statuses.has(status)) { json(res,400,{error:'INVALID_SUBSCRIPTION_STATUS'}); return true; }
  if (![1,3,6,12].includes(months)) { json(res,400,{error:'INVALID_BILLING_PERIOD'}); return true; }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const target = await client.query(`select o.id organization_id,p.id product_id,p.code product_code,
      coalesce(cs.default_trial_days,3) default_trial_days
      from app.organizations o cross join app.products p
      left join app.product_commercial_settings cs on cs.product_id=p.id
      where o.id=$1 and p.id=$2`, [organizationId, productId]);
    if (!target.rowCount) { await client.query('rollback'); json(res,404,{error:'ORGANIZATION_OR_PRODUCT_NOT_FOUND'}); return true; }

    let plan: Record<string, unknown> | null = null;
    let planModules: PlanModule[] = [];
    let basePrice: number | null = null;
    let limits: Record<string, unknown> = {};
    if (planId) {
      const planResult = await client.query(`select p.*,
        (select amount_kzt from app.product_plan_prices where plan_id=p.id and months=$3) period_price,
        coalesce((select jsonb_object_agg(months::text,amount_kzt order by months) from app.product_plan_prices where plan_id=p.id),'{}'::jsonb) prices
        from app.product_plans p where p.id=$1 and p.product_id=$2`, [planId,productId,months]);
      if (!planResult.rowCount) { await client.query('rollback'); json(res,400,{error:'PLAN_NOT_FOUND_FOR_PRODUCT'}); return true; }
      plan = planResult.rows[0];
      if (String(plan.status) === 'archived' || (String(plan.status) !== 'published' && !canAssignDraft(user))) { await client.query('rollback'); json(res,409,{error:'PLAN_NOT_ASSIGNABLE'}); return true; }
      if (String(plan.pricing_mode) === 'fixed') {
        basePrice = numberOrNull(plan.period_price);
        if (basePrice == null) { await client.query('rollback'); json(res,409,{error:'PLAN_PRICE_NOT_CONFIGURED_FOR_PERIOD'}); return true; }
      } else if (customPrice == null && status !== 'free' && status !== 'beta' && status !== 'trial') {
        await client.query('rollback'); json(res,409,{error:'CUSTOM_PRICE_REQUIRED_FOR_REQUEST_PLAN'}); return true;
      }
      limits = plan.limits && typeof plan.limits === 'object' && !Array.isArray(plan.limits) ? plan.limits as Record<string,unknown> : {};
      const modulesResult = await client.query<PlanModule>(`select module_id,mode,price_override_kzt from app.product_plan_modules where plan_id=$1`, [planId]);
      planModules = modulesResult.rows;
    }

    if (paymentMethod) {
      const payment = await client.query(`select 1 from app.product_payment_methods where product_id=$1 and method=$2 and enabled=true`, [productId,paymentMethod]);
      if (!payment.rowCount) { await client.query('rollback'); json(res,409,{error:'PAYMENT_METHOD_NOT_ALLOWED'}); return true; }
    }

    const included = new Set(planModules.filter((item) => item.mode === 'included').map((item) => item.module_id));
    const addonCandidates = await client.query(`select m.id,m.code,m.name,c.separately_sellable,c.commercial_role,
      (select amount_kzt from app.product_module_prices mp where mp.product_id=$1 and mp.module_id=m.id and mp.months=$3) period_price
      from app.modules m join app.product_module_commercial c on c.product_id=$1 and c.module_id=m.id
      where m.owner_product_id=$1 and m.id=any($2::uuid[])`, [productId,selectedAddons,months]);
    if (addonCandidates.rowCount !== selectedAddons.length || addonCandidates.rows.some((row) => !row.separately_sellable || row.commercial_role !== 'module')) {
      await client.query('rollback'); json(res,409,{error:'INVALID_ADDON_SELECTION'}); return true;
    }

    const planAddonMap = new Map(planModules.filter((item) => item.mode === 'addon').map((item) => [item.module_id, numberOrNull(item.price_override_kzt)]));
    const addonItems = addonCandidates.rows.map((row) => {
      const override = planAddonMap.get(row.id);
      const unitPrice = override != null ? override : numberOrNull(row.period_price);
      if (unitPrice == null) throw new Error(`ADDON_PRICE_NOT_CONFIGURED:${row.code}`);
      return { moduleId: row.id as string, code: row.code as string, name: row.name as string, unitPrice };
    });
    const addonsPrice = addonItems.reduce((sum,item) => sum + item.unitPrice, 0);

    const now = new Date();
    const defaultTrialDays = Number(target.rows[0].default_trial_days || 0);
    let trialDays = defaultTrialDays;
    if (plan) {
      if (String(plan.trial_mode) === 'disabled') trialDays = 0;
      else if (String(plan.trial_mode) === 'custom') trialDays = Number(plan.trial_days || 0);
    }
    const explicitTrialEnd = iso(data.trialEndsAt);
    const trialStartedAt = status === 'trial' ? now.toISOString() : null;
    const trialEndsAt = status === 'trial' ? (explicitTrialEnd || plusDays(now,trialDays)) : null;
    const periodStart = iso(data.currentPeriodStart) || (status === 'active' ? now.toISOString() : null);
    const periodEnd = iso(data.currentPeriodEnd) || (status === 'active' && periodStart ? plusMonths(new Date(periodStart),months) : null);
    const graceEndsAt = iso(data.graceEndsAt);
    const accessEndsAt = iso(data.accessEndsAt) || trialEndsAt || periodEnd || graceEndsAt;

    const before = await subscriptionDetail(client, organizationId, productId);
    const snapshot = plan ? {
      id: plan.id, code: plan.code, name: plan.name, revision: plan.revision, pricingMode: plan.pricing_mode,
      prices: plan.prices, trialMode: plan.trial_mode, trialDays: plan.trial_days, limits,
    } : { legacy: false, manual: true };
    const saved = await client.query<{id:string}>(`insert into app.product_subscriptions(
      organization_id,product_id,plan_id,plan_revision,status,billing_period_months,currency,base_price_kzt,addons_price_kzt,custom_price_kzt,payment_method,renewal_mode,
      trial_started_at,trial_ends_at,current_period_start,current_period_end,grace_ends_at,access_ends_at,limits,plan_snapshot,updated_at)
      values($1,$2,$3,$4,$5,$6,'KZT',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,now())
      on conflict(organization_id,product_id) do update set plan_id=excluded.plan_id,plan_revision=excluded.plan_revision,status=excluded.status,billing_period_months=excluded.billing_period_months,
      base_price_kzt=excluded.base_price_kzt,addons_price_kzt=excluded.addons_price_kzt,custom_price_kzt=excluded.custom_price_kzt,payment_method=excluded.payment_method,
      renewal_mode=excluded.renewal_mode,trial_started_at=excluded.trial_started_at,trial_ends_at=excluded.trial_ends_at,current_period_start=excluded.current_period_start,
      current_period_end=excluded.current_period_end,grace_ends_at=excluded.grace_ends_at,access_ends_at=excluded.access_ends_at,limits=excluded.limits,plan_snapshot=excluded.plan_snapshot,updated_at=now()
      returning id`, [organizationId,productId,planId,plan ? Number(plan.revision || 1) : null,status,months,basePrice,addonsPrice,customPrice,paymentMethod,renewalMode,trialStartedAt,trialEndsAt,periodStart,periodEnd,graceEndsAt,accessEndsAt,JSON.stringify(limits),JSON.stringify(snapshot)]);
    const subscriptionId = saved.rows[0].id;

    await client.query('delete from app.product_subscription_items where subscription_id=$1', [subscriptionId]);
    for (const moduleId of included) {
      await client.query(`insert into app.product_subscription_items(subscription_id,module_id,mode,status,unit_price_kzt,price_snapshot) values($1,$2,'included','active',0,$3::jsonb)`, [subscriptionId,moduleId,JSON.stringify({source:'plan',months})]);
    }
    for (const item of addonItems) {
      await client.query(`insert into app.product_subscription_items(subscription_id,module_id,mode,status,unit_price_kzt,price_snapshot) values($1,$2,'addon','active',$3,$4::jsonb)`, [subscriptionId,item.moduleId,item.unitPrice,JSON.stringify({source:'module_catalog',months,code:item.code,name:item.name})]);
    }

    const productAccess = accessStatuses.has(status) ? 'active' : 'suspended';
    await client.query(`insert into app.organization_products(organization_id,product_id,status,config,updated_at)
      values($1,$2,$3,jsonb_build_object('limits',$4::jsonb,'subscriptionId',$5::text),now())
      on conflict(organization_id,product_id) do update set status=excluded.status,
      config=app.organization_products.config || jsonb_build_object('limits',$4::jsonb,'subscriptionId',$5::text),updated_at=now()`,
      [organizationId,productId,productAccess,JSON.stringify(limits),subscriptionId]);

    const enabledModules = new Set([...included, ...addonItems.map((item) => item.moduleId)]);
    const commercialModules = await client.query(`select m.id,coalesce(m.current_version,'catalog') version from app.modules m
      left join app.product_module_commercial c on c.product_id=$1 and c.module_id=m.id
      where m.owner_product_id=$1 and m.status='published' and coalesce(c.commercial_role,'module')='module'`, [productId]);
    for (const module of commercialModules.rows) {
      const enabled = enabledModules.has(module.id) && accessStatuses.has(status);
      await client.query(`insert into app.module_installations(organization_id,module_id,host_product_id,version,status,health,permissions,limits,config,revision,updated_at)
        values($1,$2,$3,$4,$5,'unknown','[]'::jsonb,'{}'::jsonb,'{}'::jsonb,1,now())
        on conflict(organization_id,module_id,host_product_id) do update set status=excluded.status,version=excluded.version,revision=app.module_installations.revision+1,updated_at=now()`,
        [organizationId,module.id,productId,module.version,enabled?'active':'suspended']);
    }

    await client.query(`insert into app.product_subscription_events(subscription_id,event_type,payload,actor_user_id)
      values($1,'subscription.assigned',$2::jsonb,$3)`, [subscriptionId,JSON.stringify({planId,status,months,addonModuleIds:selectedAddons,paymentMethod}),user.id]);
    const after = await subscriptionDetail(client, organizationId, productId);
    await audit(client,user,'subscription.assigned','product_subscription',subscriptionId,before,after);
    await client.query('commit');
    json(res,200,after);
  } catch (error) {
    await client.query('rollback');
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('ADDON_PRICE_NOT_CONFIGURED:')) { json(res,409,{error:'ADDON_PRICE_NOT_CONFIGURED',module:message.split(':')[1]}); return true; }
    throw error;
  } finally { client.release(); }
  return true;
}
