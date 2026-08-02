# IMDS Super Admin

Central control plane for the IMDS product ecosystem.

## Current scope

- Working React + TypeScript administration interface prototype.
- Product registry for eleven IMDS products.
- Companies, subscriptions, identity, integrations, operations, audit and support navigation.
- Four architecture views: context, services, multi-tenancy and customer lifecycle.
- Initial Supabase/PostgreSQL control-plane schema.
- Security foundations for MFA, RBAC, approvals, impersonation and immutable audit.

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
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Repository structure

```text
src/                       Frontend prototype
supabase/migrations/       Control-plane database schema
docs/ARCHITECTURE.md       Architecture diagrams and security rules
```

## Architecture principle

The Super Admin is a separate control plane. It stores companies, users, roles, subscriptions, licenses, entitlements, integration state and audit data. Medical, CRM, marketing and financial operational records remain inside their respective products and are accessed only through versioned APIs and product adapters.

## Next implementation phase

1. Create the Supabase project and apply the migration.
2. Add authentication, MFA and global RBAC.
3. Replace prototype data with typed API queries.
4. Implement tenant provisioning workflows and product adapters.
5. Add usage metering, billing and subscription lifecycle automation.
6. Add append-only audit, approval workflows and safe impersonation.
7. Connect monitoring, incidents, queues and deployment health.
