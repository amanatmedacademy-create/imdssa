# CRM Kanban Cross-Product Runtime

## Identity boundary

Central `organizations.id` and product-owned CRM company IDs are distinct. `product_tenant_bindings` stores the explicit organization/product/environment mapping. Provisioning fails closed when no active binding exists.

## Installation worker

`supabase/functions/installation-worker/index.ts`:

1. claims installation jobs with `FOR UPDATE SKIP LOCKED`;
2. loads installation, module, version, permissions and product tenant binding;
3. invokes the protected CRM Internal API;
4. propagates idempotency and trace identifiers;
5. validates product health;
6. completes or retries the installation job.

Supported operations: `install`, `upgrade`, `repair`, `health_check`, `suspend`, `resume`, `uninstall`.

## Required secrets

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
IMDS_INSTALLATION_WORKER_TOKEN
CRM_PLATFORM_API_URL
CRM_PLATFORM_TOKEN
```

Invoke the protected worker once per minute:

```http
POST /functions/v1/installation-worker
x-imds-worker-token: <token>
content-type: application/json

{"workerId":"crm-kanban-installation-worker","batchSize":10}
```

## Product tenant prerequisite

```sql
select public.upsert_product_tenant_binding(
  '<platform-organization-uuid>',
  'imds-crm',
  'production',
  '<crm-company-uuid>',
  'active',
  'Bind CRM tenant for Kanban provisioning'
);
```

Use the actual CRM product key configured in Product Registry.

## Staging E2E

Run:

```bash
npm run test:e2e:crm-kanban
```

Required variables:

```text
PLATFORM_API_URL
PLATFORM_ADMIN_TOKEN
PLATFORM_TENANT_ID
CRM_API_URL
CRM_USER_TOKEN
```

The harness validates compatibility, atomic installation, idempotent retry, bootstrap delivery, pipeline availability, deal creation and authorized deal movement. It requires deployed staging services and is not executed against production from CI.
