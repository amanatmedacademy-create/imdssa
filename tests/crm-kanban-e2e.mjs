import assert from 'node:assert/strict';

const required = [
  'PLATFORM_API_URL',
  'PLATFORM_ADMIN_TOKEN',
  'PLATFORM_TENANT_ID',
  'CRM_COMPANY_ID',
  'CRM_API_URL',
  'CRM_USER_TOKEN',
];

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

function adminHeaders(reason, idempotencyKey) {
  return {
    authorization: `Bearer ${adminToken}`,
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    'x-admin-reason': reason,
    'idempotency-key': idempotencyKey,
  };
}

async function waitForBootstrap(expectedPresent, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { response, body } = await request(`${platformUrl}/v1/platform/bootstrap?product=marketing`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-tenant-id': tenantId },
    });
    if (response.ok) {
      const modules = body?.data?.modules ?? [];
      const present = modules.some((module) => module.code === 'crm.kanban');
      if (present === expectedPresent) return body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for crm.kanban present=${expectedPresent}`);
}

console.log('1. Preview installation compatibility');
const preview = await request(`${platformUrl}/v1/admin/installations/preview`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${adminToken}`,
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
  },
  body: JSON.stringify({
    tenantId,
    moduleCode: 'crm.kanban',
    hostProductCode: 'marketing',
    priceCode: 'price.crm.kanban.kzt.monthly.v1',
    versionChannel: 'stable',
    placement: { slot: 'sidebar.route', route: '/crm/kanban', label: 'Канбан', order: 25 },
  }),
});
assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
assert.equal(preview.body.data.compatible, true, JSON.stringify(preview.body));

console.log('2. Create installation atomically');
const create = await request(`${platformUrl}/v1/admin/installations`, {
  method: 'POST',
  headers: adminHeaders('E2E CRM Kanban installation validation', installationKey),
  body: JSON.stringify({
    tenantId,
    moduleCode: 'crm.kanban',
    hostProductCode: 'marketing',
    priceCode: 'price.crm.kanban.kzt.monthly.v1',
    versionChannel: 'stable',
    startsAt: new Date().toISOString(),
    endsAt: null,
    placement: { slot: 'sidebar.route', route: '/crm/kanban', label: 'Канбан', order: 25 },
    config: { defaultPipelineCode: 'main', syncMarketingLeads: true, allowDealDeletion: false },
    limits: { maxPipelines: 3, maxUsers: 25 },
    permissions: ['crm.deals.read', 'crm.deals.create', 'crm.deals.update', 'crm.deals.move', 'crm.pipelines.read'],
  }),
});
assert.equal(create.response.status, 202, JSON.stringify(create.body));
const installationId = create.body.data.installationId;
assert.ok(installationId);

console.log('3. Verify idempotent create');
const duplicate = await request(`${platformUrl}/v1/admin/installations`, {
  method: 'POST',
  headers: adminHeaders('E2E repeated installation request check', installationKey),
  body: JSON.stringify({
    tenantId,
    moduleCode: 'crm.kanban',
    hostProductCode: 'marketing',
    priceCode: 'price.crm.kanban.kzt.monthly.v1',
    versionChannel: 'stable',
    startsAt: new Date().toISOString(),
    endsAt: null,
    placement: { slot: 'sidebar.route', route: '/crm/kanban', label: 'Канбан', order: 25 },
    config: {}, limits: {},
    permissions: ['crm.deals.read', 'crm.deals.create', 'crm.deals.update', 'crm.deals.move', 'crm.pipelines.read'],
  }),
});
assert.equal(duplicate.response.status, 202, JSON.stringify(duplicate.body));
assert.equal(duplicate.body.data.installationId, installationId);

console.log('4. Wait for provisioning and Product Shell bootstrap');
const bootstrap = await waitForBootstrap(true);
const installedModule = bootstrap.modules.find((module) => module.code === 'crm.kanban');
assert.equal(installedModule.placement.route, '/crm/kanban');
assert.equal(installedModule.healthStatus, 'healthy');

console.log('5. Verify CRM pipeline and create a deal');
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

console.log('6. Move the deal through authorize guard');
const moved = await request(`${crmUrl}/api/deals/${deal.body.id}/move`, {
  method: 'PATCH', headers: crmHeaders,
  body: JSON.stringify({ stageId: pipeline.stages[1].id, order: 1 }),
});
assert.equal(moved.response.status, 200, JSON.stringify(moved.body));

console.log('E2E core flow passed. Suspend/resume is validated by the lifecycle API test in deployment smoke checks.');
