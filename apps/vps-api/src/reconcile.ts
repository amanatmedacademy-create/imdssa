import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const controlToken = process.env.IMDS_PLATFORM_CONTROL_TOKEN;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!controlToken) throw new Error('IMDS_PLATFORM_CONTROL_TOKEN is required');

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

type CommandRow = {
  id: string;
  organization_id: string;
  product_id: string;
  desired_revision: number;
  attempts: number;
  code: string;
  adapter_base_url: string | null;
};

type BindingRow = {
  remote_tenant_id: string | null;
  desired_revision: number;
  actual_revision: number;
  organization_status: string;
  organization_name: string;
  organization_external_key: string | null;
  product_status: string;
  entitlement_status: string | null;
};

type SubscriptionRow = {
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  access_ends_at: string | null;
  renewal_mode: string | null;
  currency: string;
  payment_method: string | null;
  limits: Record<string, unknown> | null;
};

type RemoteTenant = { id: string; name: string; slug: string };

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

async function platformFetch(baseUrl: string, pathname: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(`${baseUrl.replace(/\/$/, '')}${pathname}`, {
      ...init,
      headers: { authorization: `Bearer ${controlToken}`, ...(init?.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function failCommand(command: CommandRow, message: string) {
  const delaySeconds = Math.min(300, Math.max(10, 2 ** Math.min(command.attempts + 1, 8)));
  await pool.query(`update app.control_commands set status='failed',last_error=$2,next_attempt_at=now()+($3::text||' seconds')::interval,updated_at=now() where id=$1`, [command.id, message.slice(0, 1000), delaySeconds]);
  await pool.query(`update app.product_tenant_bindings set sync_status='failed',last_error=$3,updated_at=now() where organization_id=$1 and product_id=$2`, [command.organization_id, command.product_id, message.slice(0, 1000)]);
  await pool.query(`update app.module_installations set sync_status='failed',updated_at=now() where organization_id=$1 and host_product_id=$2`, [command.organization_id, command.product_id]);
}

async function resolveRemoteTenant(command: CommandRow, binding: BindingRow): Promise<string> {
  if (binding.remote_tenant_id) return binding.remote_tenant_id;
  if (!command.adapter_base_url) throw new Error('ADAPTER_BASE_URL_REQUIRED');

  const response = await platformFetch(command.adapter_base_url, '/internal/platform/tenants');
  const text = await response.text();
  if (!response.ok) throw new Error(`TENANT_DIRECTORY_${response.status}:${text.slice(0, 500)}`);
  const payload = (text ? JSON.parse(text) : {}) as { items?: RemoteTenant[] };
  const tenants = Array.isArray(payload.items) ? payload.items : [];
  const targetName = normalized(binding.organization_name);
  const matches = tenants.filter((tenant) => normalized(String(tenant.name || '')) === targetName);
  if (matches.length !== 1) throw new Error(matches.length > 1 ? 'TENANT_MAPPING_AMBIGUOUS' : 'TENANT_MAPPING_REQUIRED');

  const remoteTenantId = String(matches[0].id || '').trim();
  if (!remoteTenantId) throw new Error('TENANT_MAPPING_REQUIRED');
  await pool.query(`update app.product_tenant_bindings set remote_tenant_id=$3,sync_status='pending',last_error=null,updated_at=now()
    where organization_id=$1 and product_id=$2`, [command.organization_id, command.product_id, remoteTenantId]);
  await pool.query(`update app.organization_products set config=jsonb_set(config,'{remoteTenantId}',to_jsonb($3::text),true),updated_at=now()
    where organization_id=$1 and product_id=$2`, [command.organization_id, command.product_id, remoteTenantId]);
  return remoteTenantId;
}

async function processCommand(command: CommandRow) {
  const bindingResult = await pool.query<BindingRow>(`select b.remote_tenant_id,b.desired_revision,b.actual_revision,o.status::text organization_status,o.name organization_name,o.external_key organization_external_key,p.status::text product_status,op.status::text entitlement_status
    from app.product_tenant_bindings b
    join app.organizations o on o.id=b.organization_id
    join app.products p on p.id=b.product_id
    left join app.organization_products op on op.organization_id=b.organization_id and op.product_id=b.product_id
    where b.organization_id=$1 and b.product_id=$2`, [command.organization_id, command.product_id]);
  const binding = bindingResult.rows[0];
  if (!binding) throw new Error('BINDING_NOT_FOUND');

  if (command.desired_revision < binding.desired_revision) {
    await pool.query(`update app.control_commands set status='succeeded',completed_at=now(),last_error='SUPERSEDED',updated_at=now() where id=$1`, [command.id]);
    return;
  }
  if (command.code !== 'imds-marketing') throw new Error(`UNSUPPORTED_PRODUCT:${command.code}`);
  if (!command.adapter_base_url) throw new Error('ADAPTER_BASE_URL_REQUIRED');

  const remoteTenantId = await resolveRemoteTenant(command, binding);
  const subscriptionResult = await pool.query<SubscriptionRow>(`select status,trial_ends_at,current_period_end,grace_ends_at,access_ends_at,renewal_mode,currency,payment_method,limits
    from app.product_subscriptions where organization_id=$1 and product_id=$2`, [command.organization_id,command.product_id]);
  const subscription = subscriptionResult.rows[0] ?? null;
  const subscriptionAllowsProduct = !subscription || subscription.status !== 'suspended';
  const productEnabled = binding.organization_status === 'active' && binding.product_status !== 'disabled' && binding.entitlement_status === 'active' && subscriptionAllowsProduct;

  const moduleRows = await pool.query<{ code: string; enabled: boolean }>(`select m.code,
    (coalesce(mi.status::text,'')='active' and $3::boolean) enabled
    from app.modules m
    left join app.module_installations mi on mi.module_id=m.id and mi.organization_id=$1 and mi.host_product_id=$2
    where m.owner_product_id=$2 and m.status='published'
    order by m.code`, [command.organization_id, command.product_id, productEnabled]);
  const modules = Object.fromEntries(moduleRows.rows.map((row) => [row.code, productEnabled && row.enabled]));

  const paymentRows = await pool.query<{method:string;display_name:string;instructions:string|null;is_default:boolean}>(`select method,display_name,instructions,is_default
    from app.product_payment_methods where product_id=$1 and enabled=true order by sort_order,method`, [command.product_id]);
  const paymentMethods = paymentRows.rows.map((row) => ({ method:row.method,displayName:row.display_name,instructions:row.instructions,isDefault:row.is_default }));
  const defaultPaymentMethod = subscription?.payment_method || paymentRows.rows.find((row) => row.is_default)?.method || null;
  const billingStatus = subscription?.status === 'canceled' ? 'cancelled' : subscription?.status ?? null;
  const billing = subscription ? {
    subscriptionStatus: billingStatus,
    trialEndsAt: subscription.trial_ends_at,
    periodEndsAt: subscription.current_period_end,
    graceEndsAt: subscription.grace_ends_at,
    accessEndsAt: subscription.access_ends_at,
    renewalMode: subscription.renewal_mode,
    currency: subscription.currency || 'KZT',
    paymentMethods,
    defaultPaymentMethod,
  } : null;
  const limits = subscription?.limits && typeof subscription.limits === 'object' ? subscription.limits : {};

  const payload = {
    organizationId: command.organization_id,
    tenantId: remoteTenantId,
    revision: binding.desired_revision,
    productEnabled,
    modules,
    limits,
    billing,
  };

  const response = await platformFetch(command.adapter_base_url, '/internal/platform/entitlements/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  if (!response.ok && response.status !== 409) throw new Error(`ADAPTER_${response.status}:${responseText.slice(0, 600)}`);
  const actual = responseText ? JSON.parse(responseText) as Record<string, unknown> : {};

  await pool.query('BEGIN');
  try {
    await pool.query(`update app.product_tenant_bindings set remote_tenant_id=$3,actual_revision=$4,sync_status='synced',actual_state=$5::jsonb,last_sync_at=now(),last_error=null,updated_at=now()
      where organization_id=$1 and product_id=$2`, [command.organization_id, command.product_id, remoteTenantId, binding.desired_revision, JSON.stringify(actual)]);
    await pool.query(`update app.module_installations mi set actual_enabled=(mi.status='active' and $3::boolean),sync_status='synced',last_applied_revision=$4,updated_at=now()
      where mi.organization_id=$1 and mi.host_product_id=$2`, [command.organization_id, command.product_id, productEnabled, binding.desired_revision]);
    await pool.query(`update app.control_commands set status='succeeded',completed_at=now(),last_error=null,updated_at=now() where id=$1`, [command.id]);
    await pool.query(`insert into app.outbox_events(aggregate_type,aggregate_id,event_type,payload,published_at)
      values('control_command',$1,'actual_state.applied',$2::jsonb,now())`, [command.id, JSON.stringify(payload)]);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const commands = await pool.query<CommandRow>(`select c.id,c.organization_id,c.product_id,c.desired_revision,c.attempts,p.code,p.adapter_base_url
    from app.control_commands c join app.products p on p.id=c.product_id
    where c.status in ('pending','failed') and c.next_attempt_at<=now()
    order by c.created_at asc limit 25`);

  for (const command of commands.rows) {
    const claimed = await pool.query(`update app.control_commands set status='applying',attempts=attempts+1,started_at=now(),updated_at=now() where id=$1 and status in ('pending','failed') returning id`, [command.id]);
    if (!claimed.rowCount) continue;
    try {
      await processCommand(command);
    } catch (error) {
      await failCommand(command, error instanceof Error ? error.message : String(error));
    }
  }
}

try {
  await main();
} finally {
  await pool.end();
}
