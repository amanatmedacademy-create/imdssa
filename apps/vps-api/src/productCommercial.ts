import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, PoolClient } from 'pg';

type User = { id: string; global_role: string | null };
type Json = (res: ServerResponse, status: number, body: unknown) => void;

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
}
function canManage(user: User) { return user.global_role === 'platform_owner' || user.global_role === 'platform_admin'; }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function numberOrNull(value: unknown): number | null { const n = Number(value); return value === '' || value == null || !Number.isFinite(n) ? null : n; }
function bool(value: unknown, fallback = false) { return typeof value === 'boolean' ? value : fallback; }
async function audit(client: Pool | PoolClient, user: User, action: string, targetType: string, targetId: string, beforeState: unknown, afterState: unknown) {
  await client.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,before_state,after_state)
    values($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [user.id, action, targetType, targetId, JSON.stringify(beforeState ?? null), JSON.stringify(afterState ?? null)]);
}

export async function handleProductCommercialApi(args: { req: IncomingMessage; res: ServerResponse; pool: Pool; url: URL; method: string; user: User; json: Json }): Promise<boolean> {
  const { req,res,pool,url,method,user,json } = args;
  const root = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial$/i);
  if (root && method === 'GET') {
    const productId = root[1];
    const product = await pool.query(`select id,code,name,description,status,version,last_health,last_heartbeat_at,last_latency_ms,last_error,
      (select count(*)::int from app.organization_products op where op.product_id=p.id and op.status='active') active_organizations
      from app.products p where id=$1`, [productId]);
    if (!product.rowCount) { json(res,404,{error:'PRODUCT_NOT_FOUND'}); return true; }
    const settings = await pool.query(`select default_trial_days,currency from app.product_commercial_settings where product_id=$1`, [productId]);
    const limits = await pool.query(`select key,label,unit,period,sort_order,metadata from app.product_limit_catalog where product_id=$1 order by sort_order,key`, [productId]);
    const modules = await pool.query(`select m.id,m.code,m.name,m.description,m.category,m.status,
      coalesce(c.separately_sellable,false) separately_sellable,c.addon_price_kzt,
      coalesce(c.commercial_role,'module') commercial_role,c.parent_module_id,c.sort_order,
      coalesce((select jsonb_object_agg(mp.months::text,mp.amount_kzt order by mp.months) from app.product_module_prices mp where mp.product_id=$1 and mp.module_id=m.id),'{}'::jsonb) prices,
      coalesce((select jsonb_agg(jsonb_build_object('moduleId',d.depends_on_module_id,'type',d.dependency_type)) from app.product_module_dependencies d where d.product_id=$1 and d.module_id=m.id),'[]'::jsonb) dependencies,
      (select count(*)::int from app.product_plan_modules pm join app.product_plans pp on pp.id=pm.plan_id where pp.product_id=$1 and pm.module_id=m.id and pm.mode in ('included','addon')) plan_count
      from app.modules m left join app.product_module_commercial c on c.product_id=$1 and c.module_id=m.id
      where m.owner_product_id=$1 order by coalesce(c.sort_order,100),m.category,m.name`, [productId]);
    const plans = await pool.query(`select p.*,
      coalesce((select jsonb_object_agg(pp.months::text,pp.amount_kzt order by pp.months) from app.product_plan_prices pp where pp.plan_id=p.id),'{}'::jsonb) prices,
      coalesce((select jsonb_agg(jsonb_build_object('moduleId',pm.module_id,'mode',pm.mode,'priceOverrideKzt',pm.price_override_kzt) order by m.name)
        from app.product_plan_modules pm join app.modules m on m.id=pm.module_id where pm.plan_id=p.id),'[]'::jsonb) modules
      from app.product_plans p where p.product_id=$1 order by p.sort_order,p.created_at,p.name`, [productId]);
    const paymentMethods = await pool.query(`select method,enabled,is_default,display_name,instructions,sort_order from app.product_payment_methods where product_id=$1 order by sort_order,method`, [productId]);
    json(res,200,{ product: product.rows[0], settings: settings.rows[0] ?? { default_trial_days: 3, currency: 'KZT' }, limitCatalog: limits.rows, modules: modules.rows, plans: plans.rows, paymentMethods: paymentMethods.rows });
    return true;
  }

  const settingsMatch = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial\/settings$/i);
  if (settingsMatch && method === 'PUT') {
    if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }
    const data=await body(req); const trial=Number(data.defaultTrialDays ?? 3);
    if (!Number.isInteger(trial) || trial < 0 || trial > 365) { json(res,400,{error:'INVALID_TRIAL_DAYS'}); return true; }
    const before=await pool.query('select * from app.product_commercial_settings where product_id=$1',[settingsMatch[1]]);
    const after=await pool.query(`insert into app.product_commercial_settings(product_id,default_trial_days,currency,updated_at) values($1,$2,'KZT',now())
      on conflict(product_id) do update set default_trial_days=excluded.default_trial_days,updated_at=now() returning *`,[settingsMatch[1],trial]);
    await audit(pool,user,'product.commercial_settings.updated','product',settingsMatch[1],before.rows[0],after.rows[0]);
    json(res,200,{ok:true}); return true;
  }

  const moduleMatch = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial\/modules\/([0-9a-f-]+)$/i);
  if (moduleMatch && method === 'PUT') {
    if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }
    const data=await body(req); const client=await pool.connect();
    try {
      await client.query('begin');
      const before=await client.query(`select c.*,coalesce((select jsonb_object_agg(months::text,amount_kzt) from app.product_module_prices where product_id=$1 and module_id=$2),'{}'::jsonb) prices from app.product_module_commercial c where product_id=$1 and module_id=$2`,moduleMatch.slice(1));
      const role=['module','feature','hidden'].includes(text(data.commercialRole))?text(data.commercialRole):'module';
      await client.query(`insert into app.product_module_commercial(product_id,module_id,separately_sellable,addon_price_kzt,commercial_role,parent_module_id,sort_order,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,now()) on conflict(product_id,module_id) do update set separately_sellable=excluded.separately_sellable,addon_price_kzt=excluded.addon_price_kzt,commercial_role=excluded.commercial_role,parent_module_id=excluded.parent_module_id,sort_order=excluded.sort_order,updated_at=now()`,
        [moduleMatch[1],moduleMatch[2],bool(data.separatelySellable),numberOrNull(data.addonPriceKzt),role,text(data.parentModuleId)||null,Number(data.sortOrder ?? 100)]);
      await client.query('delete from app.product_module_prices where product_id=$1 and module_id=$2',moduleMatch.slice(1));
      const prices=data.prices && typeof data.prices==='object'?data.prices as Record<string,unknown>:{};
      for (const months of [1,3,6,12]) { const amount=numberOrNull(prices[String(months)]); if (amount!=null) await client.query('insert into app.product_module_prices(product_id,module_id,months,amount_kzt) values($1,$2,$3,$4)',[moduleMatch[1],moduleMatch[2],months,amount]); }
      const after=await client.query(`select c.*,coalesce((select jsonb_object_agg(months::text,amount_kzt) from app.product_module_prices where product_id=$1 and module_id=$2),'{}'::jsonb) prices from app.product_module_commercial c where product_id=$1 and module_id=$2`,moduleMatch.slice(1));
      await audit(client,user,'product.module_pricing.updated','module',moduleMatch[2],before.rows[0],after.rows[0]);
      await client.query('commit'); json(res,200,{ok:true});
    } catch(error){await client.query('rollback');throw error;} finally{client.release();}
    return true;
  }

  const plansRoot = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial\/plans$/i);
  if (plansRoot && method === 'POST') {
    if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }
    const data=await body(req); const code=text(data.code).toLowerCase().replace(/[^a-z0-9_-]+/g,'-'); const name=text(data.name);
    if (!code || !name) { json(res,400,{error:'PLAN_CODE_AND_NAME_REQUIRED'}); return true; }
    const created=await pool.query<{id:string}>(`insert into app.product_plans(product_id,code,name,description,status,trial_days,trial_mode,pricing_mode,featured,sort_order,limits)
      values($1,$2,$3,nullif($4,''),'draft',$5,'product_default','fixed',false,100,'{}'::jsonb) returning id`,[plansRoot[1],code,name,text(data.description),Number(data.trialDays ?? 3)]);
    await audit(pool,user,'product.plan.created','plan',created.rows[0].id,null,{productId:plansRoot[1],code,name});
    json(res,201,{id:created.rows[0].id}); return true;
  }

  const planMatch = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial\/plans\/([0-9a-f-]+)$/i);
  if (planMatch && method === 'PUT') {
    if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }
    const data=await body(req); const client=await pool.connect();
    try {
      await client.query('begin');
      const before=await planSnapshot(client,planMatch[2]);
      const pricingMode=['fixed','request'].includes(text(data.pricingMode))?text(data.pricingMode):'fixed';
      const trialMode=['product_default','custom','disabled'].includes(text(data.trialMode))?text(data.trialMode):'product_default';
      const nextRevision=Number(before?.revision ?? 0)+1;
      await client.query(`update app.product_plans set name=$3,description=nullif($4,''),status=$5,trial_days=$6,limits=$7::jsonb,pricing_mode=$8,featured=$9,sort_order=$10,trial_mode=$11,revision=$12,updated_at=now() where id=$1 and product_id=$2`,
        [planMatch[2],planMatch[1],text(data.name),text(data.description),text(data.status)||'draft',Number(data.trialDays ?? 3),JSON.stringify(data.limits&&typeof data.limits==='object'?data.limits:{}),pricingMode,bool(data.featured),Number(data.sortOrder ?? 100),trialMode,nextRevision]);
      await client.query('delete from app.product_plan_prices where plan_id=$1',[planMatch[2]]);
      const prices=data.prices&&typeof data.prices==='object'?data.prices as Record<string,unknown>:{};
      if (pricingMode==='fixed') for (const months of [1,3,6,12]) { const amount=numberOrNull(prices[String(months)]); if(amount!=null) await client.query('insert into app.product_plan_prices(plan_id,months,amount_kzt) values($1,$2,$3)',[planMatch[2],months,amount]); }
      await client.query('delete from app.product_plan_modules where plan_id=$1',[planMatch[2]]);
      for (const raw of Array.isArray(data.modules)?data.modules:[]) { const item=raw&&typeof raw==='object'?raw as Record<string,unknown>:{}; const moduleId=text(item.moduleId), mode=text(item.mode); if(moduleId&&['included','addon','disabled'].includes(mode)) await client.query('insert into app.product_plan_modules(plan_id,module_id,mode,price_override_kzt) values($1,$2,$3,$4)',[planMatch[2],moduleId,mode,numberOrNull(item.priceOverrideKzt)]); }
      const after=await planSnapshot(client,planMatch[2]);
      await client.query(`insert into app.product_plan_revisions(plan_id,revision,snapshot,actor_user_id) values($1,$2,$3::jsonb,$4) on conflict(plan_id,revision) do nothing`,[planMatch[2],nextRevision,JSON.stringify(after),user.id]);
      await audit(client,user,'product.plan.updated','plan',planMatch[2],before,after);
      await client.query('commit'); json(res,200,{ok:true,revision:nextRevision});
    } catch(error){await client.query('rollback');throw error;} finally{client.release();}
    return true;
  }

  const paymentMatch=url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial\/payment-methods$/i);
  if(paymentMatch&&method==='PUT'){
    if(!canManage(user)){json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'});return true;}
    const data=await body(req),items=Array.isArray(data.items)?data.items:[],client=await pool.connect();
    try{await client.query('begin');const before=await client.query('select * from app.product_payment_methods where product_id=$1 order by sort_order',[paymentMatch[1]]);await client.query('update app.product_payment_methods set is_default=false,updated_at=now() where product_id=$1',[paymentMatch[1]]);
      for(const raw of items){const item=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};const methodName=text(item.method);if(!['bank_transfer','kaspi','card'].includes(methodName))continue;await client.query(`insert into app.product_payment_methods(product_id,method,enabled,is_default,display_name,instructions,sort_order,updated_at) values($1,$2,$3,$4,$5,nullif($6,''),$7,now()) on conflict(product_id,method) do update set enabled=excluded.enabled,is_default=excluded.is_default,display_name=excluded.display_name,instructions=excluded.instructions,sort_order=excluded.sort_order,updated_at=now()`,[paymentMatch[1],methodName,item.enabled!==false,item.isDefault===true,text(item.displayName)||methodName,text(item.instructions),Number(item.sortOrder??100)]);}
      const after=await client.query('select * from app.product_payment_methods where product_id=$1 order by sort_order',[paymentMatch[1]]);await audit(client,user,'product.payment_methods.updated','product',paymentMatch[1],before.rows,after.rows);await client.query('commit');json(res,200,{ok:true});}catch(error){await client.query('rollback');throw error;}finally{client.release();}return true;
  }
  return false;
}

async function planSnapshot(client: Pool | PoolClient, planId: string): Promise<Record<string, unknown> | null> {
  const plan=await client.query(`select p.*,coalesce((select jsonb_object_agg(months::text,amount_kzt) from app.product_plan_prices where plan_id=p.id),'{}'::jsonb) prices,coalesce((select jsonb_agg(jsonb_build_object('moduleId',module_id,'mode',mode,'priceOverrideKzt',price_override_kzt)) from app.product_plan_modules where plan_id=p.id),'[]'::jsonb) modules from app.product_plans p where p.id=$1`,[planId]);
  return plan.rows[0] ?? null;
}
