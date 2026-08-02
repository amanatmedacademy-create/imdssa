# CRM Kanban Cross-Product Runtime

This phase connects the control-plane installation domain to the CRM product runtime and the Marketing Product Shell.

## Identity boundary

A central `organizations.id` is not the same identifier as a product-owned CRM company ID.

`product_tenant_bindings` stores the explicit mapping:

```text
IMDS organization
  + product
  + environment
  -> external product tenant ID
```

Provisioning fails closed when an active binding is absent.

## Installation worker

`supabase/functions/installation-worker/index.ts`:

1. claims durable installation jobs with `FOR UPDATE SKIP LOCKED`;
2. loads installation, module, version, products, permissions and tenant binding;
3. invokes the protected CRM Internal API;
4. propagates idempotency and trace identifiers;
5. validates the product health result;
6. completes or retries the installation job through `complete_installation_job`.

Supported operations:

```text
install
upgrade
repair
health_check
suspend
resume
uninstall
```

## Required secrets

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
IMDS_INSTALLATION_WORKER_TOKEN
CRM_PLATFORM_API_URL
CRM_PLATFORM_TOKEN
```

Invoke from a protected scheduler:

```http
POST /functions/v1/installation-worker
x-imds-worker-token: <token>
content-type: application/json

{
  "workerId": "crm-kanban-installation-worker",
  "batchSize": 10
}
```

Recommended cadence: once per minute.

## Provisioning prerequisite

Before creating the installation, configure the external CRM company ID:

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

Use the actual CRM product key from Product Registry (`imds-crm` or `crm`).

## E2E harness

```bash
npm run test:e2e:crm-kanban
```

Required variables:

```text
PLATFORM_API_URL
PLATFORM_ADMIN_TOKEN
PLATFORM_TENANT_ID
CRM_COMPANY_ID
CRM_API_URL
CRM_USER_TOKEN
```

The harness validates compatibility, atomic installation, idempotent retry, bootstrap delivery, pipeline availability, deal creation and authorized deal movement. It is intended for staging after migrations, workers and secrets are deployed.
