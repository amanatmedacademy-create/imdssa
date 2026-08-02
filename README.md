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
- RLS policies for control-plane tables.
- Guarded security-definer RPC functions for privileged mutations.
- Append-only audit events with mutation prevention.
- Product seed data and domain integrity triggers.
- Architecture views for context, services, multi-tenancy and customer lifecycle.

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

Production build:

```bash
npm run lint
npm run build
```

Without Supabase variables, the UI runs in demo mode and stores editable registry data in the browser.

## Supabase activation

1. Create a dedicated Supabase project for the IMDS control plane.
2. Apply migrations from `supabase/migrations` in numeric order.
3. Configure authentication providers and create the first staff account.
4. Sign in once so the `platform_users` profile is created by the auth trigger.
5. Execute `select public.bootstrap_platform_owner();` as that authenticated account through an RPC-capable client.
6. Add the project URL and anon key to the deployment environment:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_APP_ENV=production
VITE_APP_VERSION=0.2.0
```

The service role key must never be exposed to the frontend.

## Repository structure

```text
src/core/                         Auth and RBAC
src/features/organizations/      Tenant/company management
src/lib/                          Environment, database types, Supabase client
src/productRegistry.tsx           Product registry UI
supabase/migrations/              Control-plane database and security
 docs/ARCHITECTURE.md              Architecture diagrams and rules
```

## Architecture principle

The Super Admin is a separate control plane. It stores companies, users, roles, subscriptions, licenses, entitlements, integration state and audit data. Medical, CRM, marketing and financial operational records remain inside their respective products and are accessed only through versioned APIs and product adapters.

## Delivery order

1. Identity, RBAC and companies — implemented foundation.
2. Product Registry connected to Supabase and adapter contracts.
3. Tariffs, subscriptions, licenses and entitlements.
4. Workflow engine and automated tenant provisioning.
5. Usage metering and billing.
6. Integration registry, webhooks and background jobs.
7. Audit UI, approvals, impersonation and break-glass access.
8. Monitoring, incidents, release management and status page.
9. Customer onboarding, support, SLA and health score.
10. Data governance, retention, backup and disaster recovery.
