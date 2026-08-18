import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';

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

export async function handleProductCommercialApi(args: {
  req: IncomingMessage; res: ServerResponse; pool: Pool; url: URL; method: string; user: User; json: Json;
}): Promise<boolean> {
  const { req,res,pool,url,method,user,json } = args;
  const root = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial$/i);
  if (root && method === 'GET') {
    const productId = root[1];
    const product = await pool.query('select id,code,name,description,status from app.products where id=$1', [productId]);
    if (!product.rowCount) { json(res,404,{error:'PRODUCT_NOT_FOUND'}); return true; }
    const modules = await pool.query(`select m.id,m.code,m.name,m.description,m.category,m.status,
      coalesce(c.separately_sellable,false) separately_sellable,c.addon_price_kzt
      from app.modules m left join app.product_module_commercial c on c.product_id=$1 and c.module_id=m.id
      where m.owner_product_id=$1 order by m.category,m.name`, [productId]);
    const plans = await pool.query(`select p.*,
      coalesce((select jsonb_object_agg(pp.months::text,pp.amount_kzt order by pp.months) from app.product_plan_prices pp where pp.plan_id=p.id),'{}'::jsonb) prices,
      coalesce((select jsonb_agg(jsonb_build_object('moduleId',pm.module_id,'mode',pm.mode,'priceOverrideKzt',pm.price_override_kzt) order by m.name)
        from app.product_plan_modules pm join app.modules m on m.id=pm.module_id where pm.plan_id=p.id),'[]'::jsonb) modules
      from app.product_plans p where p.product_id=$1 order by p.created_at,p.name`, [productId]);
    const paymentMethods = await pool.query(`select method,enabled,is_default,display_name,instructions,sort_order
      from app.product_payment_methods where product_id=$1 order by sort_order,method`, [productId]);
    json(res,200,{ product: product.rows[0], modules: modules.rows, plans: plans.rows, paymentMethods: paymentMethods.rows }); return true;
  }

  const moduleMatch = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial\/modules\/([0-9a-f-]+)$/i);
  if (moduleMatch && method === 'PUT') {
    if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }
    const data = await body(req); const price = numberOrNull(data.addonPriceKzt);
    if (price != null && price < 0) { json(res,400,{error:'INVALID_PRICE'}); return true; }
    await pool.query(`insert into app.product_module_commercial(product_id,module_id,separately_sellable,addon_price_kzt,updated_at)
      values($1,$2,$3,$4,now()) on conflict(product_id,module_id) do update set separately_sellable=excluded.separately_sellable,addon_price_kzt=excluded.addon_price_kzt,updated_at=now()`,
      [moduleMatch[1],moduleMatch[2],data.separatelySellable === true,price]);
    json(res,200,{ok:true}); return true;
  }

  const plansRoot = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial\/plans$/i);
  if (plansRoot && method === 'POST') {
    if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }
    const data = await body(req); const code=text(data.code).toLowerCase().replace(/[^a-z0-9_-]+/g,'-'); const name=text(data.name);
    if (!code || !name) { json(res,400,{error:'PLAN_CODE_AND_NAME_REQUIRED'}); return true; }
    const created = await pool.query<{id:string}>(`insert into app.product_plans(product_id,code,name,description,status,trial_days,limits)
      values($1,$2,$3,nullif($4,''),$5,$6,$7::jsonb) returning id`, [plansRoot[1],code,name,text(data.description),text(data.status)||'draft',Number(data.trialDays ?? 3),JSON.stringify(data.limits && typeof data.limits==='object' ? data.limits : {})]);
    json(res,201,{id:created.rows[0].id}); return true;
  }

  const planMatch = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial\/plans\/([0-9a-f-]+)$/i);
  if (planMatch && method === 'PUT') {
    if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }
    const data = await body(req); const client=await pool.connect();
    try {
      await client.query('begin');
      await client.query(`update app.product_plans set name=$3,description=nullif($4,''),status=$5,trial_days=$6,limits=$7::jsonb,updated_at=now() where id=$1 and product_id=$2`,
        [planMatch[2],planMatch[1],text(data.name),text(data.description),text(data.status)||'draft',Number(data.trialDays ?? 3),JSON.stringify(data.limits && typeof data.limits==='object' ? data.limits : {})]);
      await client.query('delete from app.product_plan_prices where plan_id=$1',[planMatch[2]]);
      const prices = data.prices && typeof data.prices==='object' ? data.prices as Record<string,unknown> : {};
      for (const months of [1,3,6,12]) { const amount=numberOrNull(prices[String(months)]); if (amount != null) await client.query('insert into app.product_plan_prices(plan_id,months,amount_kzt) values($1,$2,$3)',[planMatch[2],months,amount]); }
      await client.query('delete from app.product_plan_modules where plan_id=$1',[planMatch[2]]);
      const modules = Array.isArray(data.modules) ? data.modules : [];
      for (const raw of modules) { const item = raw && typeof raw==='object' ? raw as Record<string,unknown> : {}; const moduleId=text(item.moduleId); const mode=text(item.mode); if (!moduleId || !['included','addon','disabled'].includes(mode)) continue; await client.query('insert into app.product_plan_modules(plan_id,module_id,mode,price_override_kzt) values($1,$2,$3,$4)',[planMatch[2],moduleId,mode,numberOrNull(item.priceOverrideKzt)]); }
      await client.query('commit'); json(res,200,{ok:true});
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    return true;
  }

  const paymentMatch = url.pathname.match(/^\/api\/v1\/products\/([0-9a-f-]+)\/commercial\/payment-methods$/i);
  if (paymentMatch && method === 'PUT') {
    if (!canManage(user)) { json(res,403,{error:'PLATFORM_ADMIN_REQUIRED'}); return true; }
    const data=await body(req); const items=Array.isArray(data.items)?data.items:[]; const client=await pool.connect();
    try {
      await client.query('begin');
      await client.query('update app.product_payment_methods set is_default=false,updated_at=now() where product_id=$1 and is_default=true',[paymentMatch[1]]);
      for (const raw of items) {
        const item=raw && typeof raw==='object' ? raw as Record<string,unknown> : {};
        const methodName=text(item.method);
        if (!['bank_transfer','kaspi','card'].includes(methodName)) continue;
        await client.query(`insert into app.product_payment_methods(product_id,method,enabled,is_default,display_name,instructions,sort_order,updated_at)
          values($1,$2,$3,$4,$5,nullif($6,''),$7,now()) on conflict(product_id,method) do update set enabled=excluded.enabled,is_default=excluded.is_default,display_name=excluded.display_name,instructions=excluded.instructions,sort_order=excluded.sort_order,updated_at=now()`,
          [paymentMatch[1],methodName,item.enabled!==false,item.isDefault===true,text(item.displayName)||methodName,text(item.instructions),Number(item.sortOrder ?? 100)]);
      }
      await client.query('commit'); json(res,200,{ok:true});
    } catch(error){await client.query('rollback');throw error;} finally{client.release();}
    return true;
  }

  return false;
}
