# IMDS Super Admin

Central control plane for the IMDS product ecosystem.

## Implemented scope

- React 19 + TypeScript administration interface.
- Optional Supabase client with a safe local demo fallback.
- Supabase Auth gate and platform staff profile loading.
- Deny-by-default global RBAC for seven platform roles.
- Tenant/company registry with search, lifecycle filters and customer health.
- Atomic creation of an organization, primary legal entity and first branch.
- Organization editing, privileged archive and restore commands.
- Product registry for eleven IMDS products with archive safeguards.
- Subscription, license and entitlement control-plane foundation.
- Billing Operations, invoices, payments and collection workflows.
- Identity directory, security approvals and privileged-session controls.
- Integration registry, API gateway, workers and webhook foundation.
- Checkmate adapter, service registry, incidents and observability center.
- Product Analytics Center with users online, active/idle sessions, feature adoption and tenant activity.
- Browser and Node telemetry SDK packages with a protected Supabase Edge Function ingestion gateway.
- Customer Success, support cases, SLA and account health foundation.
- Data Governance, retention, backup and restore registry foundation.
- RLS policies and explicit Data API grants for control-plane tables.
- Guarded security-definer RPC functions for privileged mutations and aggregate reporting.
- Append-only audit and telemetry events with controlled retention.
- Strict environment validation, repository safety checks, Cloudflare security headers and release metadata.
- CI validation for the application and both telemetry SDK packages.

## Known product names

1. IMDS MIS
2. IMDS CRM
3. IMDS Marketing
4. IMDS Finance
5. IMDS Contract
6. IMDS Dashboard
7. IMDS Product 7 — placeholder
8. IMDS Product 8 — placeholder
9. IMDS Product 9 — placeholder
10. IMDS Product 10 — placeholder
11. IMDS Product 11 — placeholder

Placeholders must be renamed after the official product list is confirmed.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Repository validation and development build:

```bash
npm run check
```

Strict production build:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon-key> \
VITE_APP_VERSION=0.3.0 \
VITE_RELEASE_SHA=<commit-sha> \
npm run build:production
```

Without Supabase variables, non-production environments use demo fallback data. Production builds require valid Supabase public credentials.

## Supabase activation

1. Create a dedicated Supabase project for the IMDS control plane.
2. Apply migrations from `supabase/migrations` in repository order.
3. Configure authentication providers and create the first staff account.
4. Sign in once so the `platform_users` profile is created by the auth trigger.
5. Execute `select public.bootstrap_platform_owner();` as that authenticated account through an RPC-capable client.
6. Add the project URL and anon key to the deployment environment:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_APP_ENV=production
VITE_APP_VERSION=0.3.0
VITE_RELEASE_SHA
```

The service role key must never be exposed to the frontend.

## Edge Functions

The control plane includes protected worker and ingestion functions:

- `provisioning-worker`;
- `integration-webhook`;
- `integration-worker`;
- `api-gateway`;
- `checkmate-adapter`;
- `telemetry-ingest`.

Product telemetry setup and privacy rules are documented in [`docs/PRODUCT_ANALYTICS.md`](docs/PRODUCT_ANALYTICS.md). Checkmate deployment and synchronization are documented in [`docs/OBSERVABILITY_CHECKMATE.md`](docs/OBSERVABILITY_CHECKMATE.md).

## Repository structure

```text
src/core/                         Auth and RBAC
src/features/organizations/      Tenant/company management
src/features/observability/      Checkmate projections and incidents
src/features/analytics/          Product usage and live presence UI
src/features/support/            Customer Success and support
src/features/governance/         Retention, backup and restore controls
src/lib/                          Environment, database types, Supabase client
packages/telemetry-web/           Browser telemetry SDK
packages/telemetry-node/          Backend telemetry SDK
supabase/functions/               Trusted workers and ingestion gateways
supabase/migrations/              Control-plane database and security
scripts/                          Build and repository validation
docs/                             Architecture and deployment runbooks
```

## Architecture principle

The Super Admin is a separate control plane. It stores companies, users, roles, subscriptions, licenses, entitlements, integration state, normalized monitoring projections, product telemetry, billing operations, support state, governance metadata and audit data. Medical, CRM, marketing and financial operational records remain inside their respective products and are accessed only through versioned APIs and product adapters.

Product telemetry must never contain medical records, diagnoses, patient notes, phone numbers, email addresses, form content, search text, messages, access tokens or API payloads.

## Delivery state

1. Identity, RBAC and companies — implemented foundation.
2. Product Registry and adapter contracts — implemented foundation.
3. Tariffs, subscriptions, licenses and entitlements — implemented foundation.
4. Workflow engine and automated tenant provisioning — implemented foundation.
5. Billing Operations — implemented foundation.
6. Integration registry, webhooks and background jobs — implemented foundation.
7. Audit UI, approvals, impersonation and break-glass access — implemented foundation.
8. Monitoring, Checkmate adapter, incidents and status management — implemented foundation.
9. Usage metering and Product Analytics — implemented foundation.
10. Customer Success, support, SLA and health score — implemented foundation.
11. Data governance, retention, backup and disaster recovery — implemented foundation.
12. Product-by-product production onboarding and operational validation — pending deployment.
