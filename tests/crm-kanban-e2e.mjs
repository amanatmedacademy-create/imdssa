import assert from 'node:assert/strict';

const required = ['PLATFORM_API_URL','PLATFORM_ADMIN_TOKEN','PLATFORM_TENANT_ID','CRM_API_URL','CRM_USER_TOKEN'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing E2E environment variables: ${missing.join(', ')}`);
  process.exit(2);
}

const platformUrl = process.env.PLATFORM_API_URL.replace(/\/$/, '');
const crmUrl = process.env.CRM_API_URL.replace(/\/$/, '');
const tenantId = process.env.PLATFORM_TENANT_ID;
const adminToken = process.env.PLATFORM_ADMIN_TOKEN;
const crmToken = process.env.CRM_USER_TOKEN;
const installationKey = crypto.randomUUID();

async function request(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

const placement = { slot: 'sidebar.route', route: '/crm/kanban', label: 'Канбан', order: 25 };
const installationBody = {
  tenantId,
  moduleCode: 'crm.kanban',
  hostProductCode: 'marketing',
  priceCode: 'price.crm.kanban.kzt.monthly.v1',
  versionChannel: 'stable',
  startsAt: new Date().toISOString(),
  endsAt: null,
  placement,
  config: { defaultPipelineCode: 'main', syncMarketingLeads: true, allowDealDeletion: false },
  limits: { maxPipelines: 3, maxUsers: 25 },
  permissions: ['crm.deals.read','crm.deals.create','crm.deals.update','crm.deals.move','crm.pipelines.read'],
};

const preview = await request(`${platformUrl}/v1/admin/installations/preview`, {
  method: 'POST',
  headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json', 'x-tenant-id': tenantId },
  body: JSON.stringify(installationBody),
});
assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
assert.equal(preview.body.data.compatible, true, JSON.stringify(preview.body));

const headers = {
  authorization: `Bearer ${adminToken}`,
  'content-type': 'application/json',
  'x-tenant-id': tenantId,
  'x-admin-reason': 'Staging E2E CRM Kanban installation validation',
  'idempotency-key': installationKey,
};
const created = await request(`${platformUrl}/v1/admin/installations`, {
  method: 'POST', headers, body: JSON.stringify(installationBody),
});
assert.equal(created.response.status, 202, JSON.stringify(created.body));
const installationId = created.body.data.installationId;
assert.ok(installationId);

const duplicate = await request(`${platformUrl}/v1/admin/installations`, {
  method: 'POST', headers, body: JSON.stringify(installationBody),
});
assert.equal(duplicate.response.status, 202, JSON.stringify(duplicate.body));
assert.equal(duplicate.body.data.installationId, installationId);

const deadline = Date.now() + 120_000;
let module = null;
while (Date.now() < deadline && !module) {
  const bootstrap = await request(`${platformUrl}/v1/platform/bootstrap?product=marketing`, {
    headers: { authorization: `Bearer ${adminToken}`, 'x-tenant-id': tenantId },
  });
  module = bootstrap.body?.data?.modules?.find((item) => item.code === 'crm.kanban') ?? null;
  if (!module) await new Promise((resolve) => setTimeout(resolve, 3000));
}
assert.ok(module, 'crm.kanban did not appear in bootstrap');
assert.equal(module.placement.route, '/crm/kanban');
assert.equal(module.healthStatus, 'healthy');

const crmHeaders = { authorization: `Bearer ${crmToken}`, 'content-type': 'application/json' };
const pipelines = await request(`${crmUrl}/api/pipelines`, { headers: crmHeaders });
assert.equal(pipelines.response.status, 200, JSON.stringify(pipelines.body));
assert.ok(Array.isArray(pipelines.body) && pipelines.body.length > 0);
const pipeline = pipelines.body[0];
assert.ok(pipeline.stages.length >= 5);

const deal = await request(`${crmUrl}/api/deals`, {
  method: 'POST', headers: crmHeaders,
  body: JSON.stringify({ title: `E2E deal ${Date.now()}`, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: 1000 }),
});
assert.equal(deal.response.status, 201, JSON.stringify(deal.body));

const moved = await request(`${crmUrl}/api/deals/${deal.body.id}/move`, {
  method: 'PATCH', headers: crmHeaders,
  body: JSON.stringify({ stageId: pipeline.stages[1].id, order: 1 }),
});
assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
console.log(`CRM Kanban E2E passed for installation ${installationId}`);
