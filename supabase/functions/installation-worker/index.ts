type InstallationJob = {
  id: string;
  installation_id: string;
  operation: 'install' | 'upgrade' | 'repair' | 'suspend' | 'resume' | 'uninstall' | 'health_check';
  trace_id: string;
  idempotency_key: string;
};

type Installation = {
  id: string;
  organization_id: string;
  module_id: string;
  module_version_id: string;
  host_product_id: string;
  config: Record<string, unknown>;
  limits: Record<string, unknown>;
};

type PlatformModule = { id: string; code: string; owner_product_id: string };
type ModuleVersion = { id: string; version: string };
type Product = { id: string; key: string };
type TenantBinding = { external_tenant_id: string };
type PermissionRow = { permission: string };
type ProductResult = { healthy?: boolean; [key: string]: unknown };

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  IMDS_INSTALLATION_WORKER_TOKEN: string;
  CRM_PLATFORM_API_URL: string;
  CRM_PLATFORM_TOKEN: string;
};

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function loadEnv(): Env {
  const values = {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    IMDS_INSTALLATION_WORKER_TOKEN: Deno.env.get('IMDS_INSTALLATION_WORKER_TOKEN') ?? '',
    CRM_PLATFORM_API_URL: Deno.env.get('CRM_PLATFORM_API_URL') ?? '',
    CRM_PLATFORM_TOKEN: Deno.env.get('CRM_PLATFORM_TOKEN') ?? '',
  };
  for (const [key, value] of Object.entries(values)) {
    if (!value) throw new Error(`Missing environment variable ${key}`);
  }
  return values;
}

async function rpc<T>(settings: Env, name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${settings.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: settings.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${settings.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text) as unknown; } catch { payload = text; }
  }
  if (!response.ok) throw new Error(`RPC ${name} failed: ${text}`);
  return payload as T;
}

async function rest<T>(settings: Env, table: string, query: string): Promise<T> {
  const response = await fetch(`${settings.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: settings.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${settings.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`REST ${table} failed: ${text}`);
  return JSON.parse(text) as T;
}

async function one<T>(settings: Env, table: string, query: string, label: string): Promise<T> {
  const rows = await rest<T[]>(settings, table, `${query}&limit=1`);
  if (!rows[0]) throw new Error(`${label} not found`);
  return rows[0];
}

function endpointFor(operation: InstallationJob['operation']): { method: 'GET' | 'POST'; path: string } {
  if (operation === 'health_check') return { method: 'GET', path: '/internal/platform/modules/health' };
  return { method: 'POST', path: `/internal/platform/modules/${operation === 'install' ? 'provision' : operation}` };
}

async function loadContext(settings: Env, job: InstallationJob) {
  const installation = await one<Installation>(settings, 'module_installations',
    `select=id,organization_id,module_id,module_version_id,host_product_id,config,limits&id=eq.${job.installation_id}`,
    'Installation');
  const module = await one<PlatformModule>(settings, 'platform_modules',
    `select=id,code,owner_product_id&id=eq.${installation.module_id}`,
    'Module');
  const version = await one<ModuleVersion>(settings, 'platform_module_versions',
    `select=id,version&id=eq.${installation.module_version_id}`,
    'Module version');
  const hostProduct = await one<Product>(settings, 'products',
    `select=id,key&id=eq.${installation.host_product_id}`,
    'Host product');
  const ownerProduct = await one<Product>(settings, 'products',
    `select=id,key&id=eq.${module.owner_product_id}`,
    'Owner product');
  const permissions = await rest<PermissionRow[]>(settings, 'installation_permissions',
    `select=permission&installation_id=eq.${installation.id}&order=permission.asc`);

  let bindings = await rest<TenantBinding[]>(settings, 'product_tenant_bindings',
    `select=external_tenant_id&organization_id=eq.${installation.organization_id}&product_id=eq.${ownerProduct.id}&environment=eq.production&status=eq.active&limit=1`);
  if (!bindings[0]) {
    bindings = await rest<TenantBinding[]>(settings, 'product_tenant_bindings',
      `select=external_tenant_id&organization_id=eq.${installation.organization_id}&product_id=eq.${hostProduct.id}&environment=eq.production&status=eq.active&limit=1`);
  }
  if (!bindings[0]) throw new Error('Active product tenant binding is required before provisioning');

  return {
    installation,
    module,
    version,
    hostProduct,
    permissions: permissions.map((row) => row.permission),
    externalTenantId: bindings[0].external_tenant_id,
  };
}

async function executeProductCommand(settings: Env, job: InstallationJob): Promise<ProductResult> {
  const context = await loadContext(settings, job);
  if (context.module.code !== 'crm.kanban') throw new Error(`No provisioner registered for ${context.module.code}`);

  const endpoint = endpointFor(job.operation);
  const base = settings.CRM_PLATFORM_API_URL.replace(/\/$/, '');
  const url = endpoint.method === 'GET'
    ? `${base}${endpoint.path}?installationId=${encodeURIComponent(context.installation.id)}`
    : `${base}${endpoint.path}`;
  const body = {
    installationId: context.installation.id,
    organizationId: context.installation.organization_id,
    companyId: context.externalTenantId,
    moduleCode: context.module.code,
    moduleVersion: context.version.version,
    hostProductCode: context.hostProduct.key,
    config: context.installation.config,
    limits: context.installation.limits,
    permissions: context.permissions,
    idempotencyKey: job.idempotency_key,
    traceId: job.trace_id,
  };

  const response = await fetch(url, {
    method: endpoint.method,
    headers: {
      authorization: `Bearer ${settings.CRM_PLATFORM_TOKEN}`,
      accept: 'application/json',
      ...(endpoint.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      'x-idempotency-key': job.idempotency_key,
      'x-trace-id': job.trace_id,
    },
    body: endpoint.method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload: ProductResult = {};
  if (text) {
    try { payload = JSON.parse(text) as ProductResult; } catch { payload = { raw: text }; }
  }
  if (!response.ok) throw new Error(`CRM platform command failed (${response.status}): ${text}`);
  return payload;
}

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const settings = loadEnv();
    if (request.headers.get('x-imds-worker-token') !== settings.IMDS_INSTALLATION_WORKER_TOKEN) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const input = await request.json().catch(() => ({})) as { batchSize?: number; workerId?: string };
    const workerId = input.workerId?.trim() || 'crm-kanban-installation-worker';
    const batchSize = Math.max(1, Math.min(Number(input.batchSize ?? 10), 50));
    const jobs = await rpc<InstallationJob[]>(settings, 'claim_installation_jobs', {
      worker_id_value: workerId,
      limit_value: batchSize,
    });

    const results: Array<{ jobId: string; installationId: string; status: string; error?: string }> = [];
    for (const job of jobs) {
      try {
        const result = await executeProductCommand(settings, job);
        const healthyEnough = job.operation === 'suspend' || job.operation === 'uninstall' || result.healthy === true;
        if (!healthyEnough) throw new Error('Product command completed without a healthy result');
        await rpc(settings, 'complete_installation_job', {
          job_id_value: job.id,
          worker_id_value: workerId,
          succeeded_value: true,
          health_status_value: job.operation === 'uninstall' ? 'unknown' : 'healthy',
          current_step_value: 'completed',
          result_value: result,
          error_value: null,
        });
        results.push({ jobId: job.id, installationId: job.installation_id, status: 'succeeded' });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Unknown provisioning failure';
        await rpc(settings, 'complete_installation_job', {
          job_id_value: job.id,
          worker_id_value: workerId,
          succeeded_value: false,
          health_status_value: 'failed',
          current_step_value: 'product_command_failed',
          result_value: {},
          error_value: message.slice(0, 4000),
        }).catch(() => undefined);
        results.push({ jobId: job.id, installationId: job.installation_id, status: 'failed', error: message });
      }
    }

    return json({ claimed: jobs.length, results });
  } catch (caught) {
    return json({ error: caught instanceof Error ? caught.message : 'Installation worker failed' }, 500);
  }
});
