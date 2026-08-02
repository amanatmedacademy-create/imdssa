# IMDS Product Analytics and Live Presence

## Purpose

This module answers operational and product questions that external uptime monitoring cannot answer:

- which IMDS products are being used now;
- who is online and who is actively working;
- real active time versus an idle browser tab;
- DAU, unique users, sessions and usage trends;
- which modules and features are adopted;
- which companies have declining activity or elevated errors;
- which host product displayed a module and which product owns that module;
- whether browser and backend releases are producing failures.

Checkmate remains the source of truth for availability, response time, SSL, ports, infrastructure and incidents. Product Analytics is the source of truth for in-product usage and presence.

```text
Checkmate
  -> Is the product reachable and healthy?

@imds/telemetry-web + @imds/telemetry-node
  -> Who is using the product, for how long, and which approved features are used?

IMDS Super Admin
  -> One operational view of products, companies, incidents and usage.
```

## Components delivered

### Control-plane database

Migration `supabase/migrations/0017_product_analytics.sql` adds:

- `telemetry_sources`;
- `telemetry_event_definitions`;
- `product_usage_sessions`;
- `product_usage_events`;
- `product_usage_daily_rollups`;
- `telemetry_ingestion_batches`;
- live-presence and source metadata views;
- protected configuration and ingestion RPC functions;
- session expiry, daily rollup and retention functions;
- a period-aware analytics snapshot RPC;
- RLS, explicit grants and append-only protections.

### Ingestion gateway

`supabase/functions/telemetry-ingest/index.ts` provides:

- source-key and write-key authentication;
- SHA-256 write-key comparison;
- browser origin allow-lists;
- source-level rate limiting;
- 256 KiB request and 100-event batch limits;
- registered event-name enforcement;
- property allow-lists;
- sensitive-field filtering;
- UUID and timestamp validation;
- deterministic session-level sampling;
- idempotent request and event handling;
- request-level audit without IP addresses or raw payload storage.

### SDK packages

- `packages/telemetry-web` — browser sessions, heartbeat, active/idle time, navigation and feature events.
- `packages/telemetry-node` — sanitized backend timing and error events.

### Super Admin

Route `/analytics` contains:

- portfolio overview;
- live users;
- product and module usage;
- feature success/failure rates;
- company activity and risk;
- telemetry source inventory;
- source provisioning with a one-time write-key display.

## Security and privacy boundary

Product telemetry is not a medical data store.

Never emit:

- patient names, IINs or patient identifiers;
- diagnoses, symptoms, anamnesis, treatment plans or physician notes;
- phone numbers, email addresses or postal addresses;
- search text, chat messages, comments or free-form form values;
- access tokens, cookies, passwords, authorization headers or API secrets;
- request bodies, response bodies, SQL or raw external-provider payloads;
- URLs containing query strings or fragments.

Allowed examples:

```json
{
  "eventName": "feature_used",
  "moduleKey": "crm_kanban",
  "featureKey": "deal_moved",
  "outcome": "success",
  "properties": { "action": "move" }
}
```

Disallowed example:

```json
{
  "eventName": "feature_used",
  "properties": {
    "patientName": "...",
    "phone": "...",
    "diagnosis": "...",
    "comment": "..."
  }
}
```

The SDK applies a first filter. The Edge Function applies an independent server-side filter and discards properties not declared in the event catalog.

## Session model

### Derived status

- `active`: heartbeat received within 90 seconds, visible tab, and user interaction within 60 seconds;
- `idle`: heartbeat received within 90 seconds but no recent active interaction;
- `offline`: no current visible session; the last heartbeat can still be retained for history;
- `closed`: explicit logout or session timeout.

### Active time

Active time is incremented only when:

- the document is visible;
- the browser reports recent keyboard, pointer, touch or scroll activity;
- the periodic heartbeat is emitted;
- the event is accepted once by the idempotent ingestion layer.

An open tab does not automatically count as active work.

### Recommended defaults

| Setting | Value |
|---|---:|
| Heartbeat | 30 seconds |
| Active threshold | 60 seconds |
| Idle threshold | 120 seconds |
| Offline threshold | 90 seconds since heartbeat |
| Session timeout | 30 minutes |
| Raw event retention | 90 days |
| Batch size | 25 browser / 50 server |
| Ingestion batch maximum | 100 events |

## Host product and module owner

A module can be displayed inside another product. Always record both dimensions.

Example: CRM Kanban opened inside IMDS Marketing.

```ts
telemetry.module('crm_kanban', 'CRM Kanban', 'imds-crm');
```

The telemetry source determines the host product (`imds-marketing`). `moduleOwnerProductKey` records the owner (`imds-crm`). This prevents double counting and supports cross-product licensing and usage metering.

## Environment setup

### Supabase Edge Function secrets

Required:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The service-role key is available only to the Edge Function. It must never be exposed to the Vite application or any product browser bundle.

### Deploy

```bash
supabase functions deploy telemetry-ingest --no-verify-jwt
```

The function is also declared in `supabase/config.toml` with `verify_jwt = false` because product applications authenticate with source-specific ingest credentials, not a Super Admin user JWT.

### Apply schema

Apply migrations in repository order using the normal IMDS deployment pipeline. Verify that migration `0017_product_analytics.sql` is present in the remote migration history.

### Data API access

The migration explicitly grants only the required columns and operations. Browser users cannot insert, update or delete telemetry tables. The write-key hash column is not granted to `authenticated`.

## Background schedule

Run these functions from a trusted scheduler using the service role.

### Every minute

```sql
select public.expire_stale_product_usage_sessions();
```

### Daily after UTC day close

```sql
select public.refresh_product_usage_rollups(current_date - 1);
```

### Daily retention job

```sql
select public.purge_expired_product_usage_data();
```

For a delayed or failed rollup, rerun `refresh_product_usage_rollups(<date>)`; it deletes and rebuilds that date idempotently.

## Creating a telemetry source

1. Open **Super Admin → Аналитика продуктов → Источники**.
2. Select **Подключить продукт**.
3. Choose the product, source type and environment.
4. For a browser source, add exact allowed origins.
5. Create the source.
6. Copy the source key and write key immediately.
7. Store a server write key in the deployment secret store.
8. Add a browser write key to the product deployment environment as an ingestion credential.

The database stores only the lowercase SHA-256 hash. A lost write key must be rotated; it cannot be recovered.

### Source naming

```text
<product-key>-web-<environment>
<product-key>-server-<environment>
```

Examples:

```text
imds-marketing-web-production
imds-marketing-server-production
imds-mis-web-staging
```

Use separate sources for browser and server traffic and separate sources for production and staging.

## Browser integration

```ts
import { createImdsTelemetry } from '@imds/telemetry-web';

export const telemetry = createImdsTelemetry({
  endpoint: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telemetry-ingest`,
  sourceKey: import.meta.env.VITE_IMDS_TELEMETRY_SOURCE_KEY,
  writeKey: import.meta.env.VITE_IMDS_TELEMETRY_WRITE_KEY,
  productKey: 'imds-marketing',
  appVersion: import.meta.env.VITE_APP_VERSION,
  identity: {
    userKey: currentUser.id,
    userLabel: currentUser.fullName,
    userRole: currentUser.role,
    organizationId: company.controlPlaneId,
    branchId: branch?.controlPlaneId,
  },
}).start();
```

Router hook:

```ts
telemetry.page(location.pathname);
```

Module hook:

```ts
telemetry.module('meta_ads', 'Meta Ads');
telemetry.module('crm_kanban', 'CRM Kanban', 'imds-crm');
```

Feature hook:

```ts
telemetry.feature('deal_moved', {
  outcome: 'success',
  properties: { action: 'move' },
});
```

Logout:

```ts
await telemetry.stop();
```

## Server integration

```ts
import { createImdsTelemetryNode } from '@imds/telemetry-node';

const telemetry = createImdsTelemetryNode({
  endpoint: process.env.IMDS_TELEMETRY_ENDPOINT!,
  sourceKey: process.env.IMDS_TELEMETRY_SOURCE_KEY!,
  writeKey: process.env.IMDS_TELEMETRY_WRITE_KEY!,
  productKey: 'imds-marketing',
  appVersion: process.env.APP_VERSION,
}).start();
```

Middleware should use normalized route templates and stable error codes. Do not emit request or response data.

```ts
app.use(telemetry.createHttpMiddleware((request) => ({
  userKey: request.user?.id,
  userRole: request.user?.role,
  organizationId: request.tenant?.controlPlaneId,
  moduleKey: 'crm_api',
  moduleOwnerProductKey: 'imds-crm',
})));
```

Browser session identifiers must not be reused as server-source session identifiers. Cross-service request tracing belongs in the observability trace layer; Product Analytics records aggregated backend timing and outcomes.

## Event catalog

Events are rejected unless registered in `telemetry_event_definitions`.

Built-in events:

| Event | Category | Purpose |
|---|---|---|
| `session_started` | session | Open session |
| `session_heartbeat` | session | Presence and active/idle delta |
| `session_ended` | session | Explicit close |
| `page_viewed` | navigation | Route usage |
| `module_opened` | navigation | Module adoption |
| `feature_used` | feature | Named feature action |
| `entity_created` | business | Sanitized entity creation count |
| `entity_updated` | business | Sanitized entity update count |
| `search_performed` | feature | Search count without query text |
| `export_started` | feature | Export attempt |
| `export_completed` | feature | Successful export |
| `api_request` | performance | Backend duration and status |
| `api_error` | error | Sanitized backend error |
| `frontend_error` | error | Sanitized browser error |
| `permission_denied` | system | Authorization denial |
| `subscription_limit_reached` | system | Entitlement limit reached |

To add an event, review it for privacy, define the allowed property keys, add it through a migration, instrument it in the product and verify the resulting dashboard row.

## Product rollout sequence

Recommended order:

1. IMDS Marketing browser source.
2. IMDS Marketing server source.
3. IMDS CRM browser and server sources.
4. IMDS MIS browser source.
5. IMDS Dashboard.
6. IMDS Finance.
7. IMDS Contract.
8. Remaining products.

For each product:

1. Confirm the canonical product key in Product Registry.
2. Confirm global user, company and branch identifiers.
3. Create staging sources.
4. Instrument sessions and router only.
5. Validate online and active/idle calculations.
6. Add 5–10 business-critical feature events.
7. Verify no sensitive fields are emitted.
8. Create production sources.
9. Deploy to 5–10% of users if sampling is needed.
10. Move to full collection after validation.

## Acceptance criteria

A product is considered connected when:

- production browser source is active;
- the exact production origin is allow-listed;
- heartbeat appears within 60 seconds;
- logout closes the session;
- idle tabs stop accumulating active time;
- user, organization and branch dimensions are populated;
- host product and module owner are correct;
- page routes contain no query strings;
- at least five approved features are instrumented;
- frontend and backend errors use stable codes;
- no protected health information is visible in raw events;
- daily rollup and retention jobs have completed successfully;
- Super Admin filters and live-user table return the expected product.

## Operational diagnostics

### No events appear

Check:

1. source status is `active`;
2. source key matches exactly;
3. write key was copied before the dialog closed;
4. browser origin matches the allow-list exactly;
5. event name exists and is active;
6. request is below 256 KiB and 100 events;
7. product IDs are the control-plane UUIDs or external keys;
8. `telemetry_ingestion_batches` contains a validation error.

### Online count is too high

Check:

- heartbeat interval;
- duplicate SDK initialization;
- whether logout calls `stop()`;
- stale-session scheduler execution;
- users opening multiple legitimate tabs. Each tab is intentionally a separate session.

### Active time is too high

Check:

- activity listeners are not triggered by synthetic application loops;
- the tab visibility API is available;
- idle timeout has not been overridden;
- duplicate heartbeat events are deduplicated by event ID;
- the product is not generating new sessions repeatedly.

### Elevated errors

Use Product Analytics to identify product, module, feature, release and company. Use Observability/Checkmate and the tracing layer to determine infrastructure and request root cause.

## Backup and retention

Raw events are retained per source, default 90 days. Daily rollups are retained for long-range reporting. Backups must follow the main control-plane backup policy. Do not extend raw retention without a documented business need and privacy review.
