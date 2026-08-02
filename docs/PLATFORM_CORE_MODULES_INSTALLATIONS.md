# Platform Core: modules, installations and product runtime

This phase implements the primary control-plane chain required by the IMDS Superadmin specification:

```text
Module catalogue
→ immutable module version
→ compatibility preview
→ price
→ subscription item
→ entitlement
→ installation
→ durable provisioning job
→ outbox event
→ Product Shell bootstrap
→ server-side authorization
```

## Repository transition

The existing frontend remains at the repository root during the non-destructive monorepo transition. New independently deployable components are introduced under:

```text
apps/platform-api
packages/platform-types
packages/platform-sdk
```

Moving the existing frontend into `apps/superadmin-web` is a later mechanical migration and must preserve its current routes and deployment behavior.

## Platform API

Implemented routes:

```text
GET  /healthz
GET  /v1/platform/bootstrap?product={productCode}
POST /v1/platform/authorize
POST /v1/admin/installations/preview
POST /v1/admin/installations
```

Administrative mutations require:

```text
Authorization: Bearer <admin JWT>
Idempotency-Key: <UUID>
X-Admin-Reason: <minimum 10 characters>
```

Every response contains `requestId`, `traceId` and `serverTime`.

## Module catalogue

The database stores:

- module ownership and lifecycle;
- immutable published versions;
- manifest and configuration schema;
- declared permissions;
- requirements and dependencies;
- host-product compatibility;
- supported placement slots;
- versioned module prices.

The initial seed registers `crm.kanban` version `1.0.0`, its stable monthly price and compatibility with IMDS Marketing.

## Installation transaction

`create_module_installation()` validates the request and atomically creates:

1. module subscription item;
2. module entitlement;
3. module installation;
4. installation permissions;
5. dependency links;
6. revision 1;
7. provisioning job;
8. outbox event;
9. audit event.

A repeated `Idempotency-Key` returns the existing installation job instead of creating duplicates.

## Compatibility preview

`preview_module_installation()` checks:

- active organization;
- active host product;
- published module and version;
- active price;
- declared host compatibility;
- supported placement slot;
- valid route;
- existing installation conflicts;
- route conflicts;
- required dependencies.

The preview returns the selected version, commercial amount, dependency list, warnings, errors and provisioning plan.

## Installation lifecycle

```text
draft → pending_payment → validating → provisioning → active
                                  ↘ failed → provisioning
active → read_only → active
active/read_only → suspended → provisioning → active
active/read_only/suspended/failed → uninstalling → archived
```

An installation cannot become `active` unless provisioning reports `healthy`.

## Durable worker

Trusted workers use:

```text
claim_installation_jobs(workerId, limit)
complete_installation_job(...)
```

Claims use `FOR UPDATE SKIP LOCKED`. Failed work is retried with exponential backoff and moves to `dead_letter` after exhausting attempts.

## Product Shell bootstrap

`platform_bootstrap()` returns only installations where both installation and entitlement are active. The response includes placement, route, permissions, limits and configuration. Suspended or failed installations are excluded automatically.

## Authorization

`platform_authorize()` enforces tenant state, installation state, entitlement state and declared permission. It returns deterministic reasons such as:

```text
GRANTED
TENANT_SUSPENDED
INSTALLATION_NOT_FOUND
MODULE_SUSPENDED
MODULE_READ_ONLY
PERMISSION_DENIED
```

Product APIs must call authorization server-side. Hiding a frontend menu item is not an authorization control.

## CRM Kanban provisioning contract

The first vertical scenario uses these idempotent adapter steps:

```text
validate_entitlement
resolve_dependencies
ensure_workspace
ensure_main_pipeline
ensure_default_stages
ensure_owner_membership
register_event_subscriptions
health_check
```

The current phase creates the control-plane contract and queue. The CRM adapter implementation and Marketing Product Shell consumption are the next cross-repository delivery step.

## Required secrets

Platform API Worker:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_JWT_AUDIENCE
```

`SUPABASE_SERVICE_ROLE_KEY` is a Worker secret and must never be exposed through frontend environment variables.
