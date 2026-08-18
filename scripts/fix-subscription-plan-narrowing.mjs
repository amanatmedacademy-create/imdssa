import fs from 'node:fs';

const path = 'apps/vps-api/src/subscriptions.ts';
let source = fs.readFileSync(path, 'utf8');
const oldBlock = `      plan = planResult.rows[0];
      if (String(plan.status) === 'archived' || (String(plan.status) !== 'published' && !canAssignDraft(user))) { await client.query('rollback'); json(res,409,{error:'PLAN_NOT_ASSIGNABLE'}); return true; }
      if (String(plan.pricing_mode) === 'fixed') {
        basePrice = numberOrNull(plan.period_price);
        if (basePrice == null) { await client.query('rollback'); json(res,409,{error:'PLAN_PRICE_NOT_CONFIGURED_FOR_PERIOD'}); return true; }
      } else if (customPrice == null && status !== 'free' && status !== 'beta' && status !== 'trial') {
        await client.query('rollback'); json(res,409,{error:'CUSTOM_PRICE_REQUIRED_FOR_REQUEST_PLAN'}); return true;
      }
      limits = plan.limits && typeof plan.limits === 'object' && !Array.isArray(plan.limits) ? plan.limits as Record<string,unknown> : {};
`;
const newBlock = `      const loadedPlan = planResult.rows[0] as Record<string, unknown>;
      plan = loadedPlan;
      if (String(loadedPlan.status) === 'archived' || (String(loadedPlan.status) !== 'published' && !canAssignDraft(user))) { await client.query('rollback'); json(res,409,{error:'PLAN_NOT_ASSIGNABLE'}); return true; }
      if (String(loadedPlan.pricing_mode) === 'fixed') {
        basePrice = numberOrNull(loadedPlan.period_price);
        if (basePrice == null) { await client.query('rollback'); json(res,409,{error:'PLAN_PRICE_NOT_CONFIGURED_FOR_PERIOD'}); return true; }
      } else if (customPrice == null && status !== 'free' && status !== 'beta' && status !== 'trial') {
        await client.query('rollback'); json(res,409,{error:'CUSTOM_PRICE_REQUIRED_FOR_REQUEST_PLAN'}); return true;
      }
      limits = loadedPlan.limits && typeof loadedPlan.limits === 'object' && !Array.isArray(loadedPlan.limits) ? loadedPlan.limits as Record<string,unknown> : {};
`;
if (!source.includes(oldBlock)) throw new Error('subscription narrowing anchor not found');
source = source.replace(oldBlock, newBlock);
const includedAnchor = `    const included = new Set(planModules.filter((item) => item.mode === 'included').map((item) => item.module_id));\n`;
const overlapBlock = `${includedAnchor}    if (selectedAddons.some((moduleId) => included.has(moduleId))) {\n      await client.query('rollback'); json(res,409,{error:'INVALID_ADDON_SELECTION'}); return true;\n    }\n`;
if (!source.includes(includedAnchor)) throw new Error('included module anchor not found');
source = source.replace(includedAnchor, overlapBlock);
fs.writeFileSync(path, source);
