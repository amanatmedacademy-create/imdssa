# `@imds/telemetry-web`

Internal browser SDK for IMDS product usage analytics and live presence.

## What it collects

- session start, heartbeat and explicit end;
- active versus idle time;
- page and module navigation;
- named feature usage;
- sanitized success/failure outcomes;
- product version and coarse device/runtime information.

## What it must never collect

- patient names or identifiers;
- diagnoses, symptoms, anamnesis, treatment plans or medical notes;
- phone numbers, email addresses or postal addresses;
- access tokens, cookies, passwords or request authorization headers;
- form values, search text, chat messages, request bodies or response bodies;
- full URLs containing query strings or fragments.

The SDK removes query strings from routes and filters common sensitive property names. The ingestion gateway applies a second independent validation and sanitization layer.

## Installation

The package currently lives in the Super Admin repository as the canonical source. Publish it to the private IMDS package registry or copy it into the target product workspace.

```bash
npm install @imds/telemetry-web
```

## Basic integration

```ts
import { createImdsTelemetry } from '@imds/telemetry-web';

export const telemetry = createImdsTelemetry({
  endpoint: 'https://<project-ref>.supabase.co/functions/v1/telemetry-ingest',
  sourceKey: 'imds-marketing-web-production',
  writeKey: import.meta.env.VITE_IMDS_TELEMETRY_WRITE_KEY,
  productKey: 'imds-marketing',
  appVersion: import.meta.env.VITE_APP_VERSION,
  identity: {
    userKey: currentUser.id,
    userLabel: currentUser.fullName,
    userRole: currentUser.role,
    organizationId: currentCompany.controlPlaneId,
    branchId: currentBranch?.controlPlaneId,
  },
}).start();
```

A browser write key is an ingestion credential, not an administrative secret. It can be inspected by a signed-in browser user. Security therefore also relies on the source-specific origin allow-list, rate limiting, strict event schemas, payload caps and the absence of direct table write permissions.

## Navigation

Call the SDK from the application router after a route transition:

```ts
telemetry.page('/crm/deals');
telemetry.module('crm_kanban', 'CRM Kanban', 'imds-crm');
```

The third parameter records that the module is owned by IMDS CRM even when it is displayed inside IMDS Marketing.

## Feature usage

```ts
telemetry.feature('deal_moved', {
  outcome: 'success',
  properties: { action: 'move' },
});
```

Only properties explicitly allowed by the server-side event definition survive ingestion. Do not put entity content, names, comments or search strings into properties.

## Errors

```ts
telemetry.track({
  eventName: 'frontend_error',
  outcome: 'failure',
  properties: {
    errorCode: 'KANBAN_RENDER_FAILED',
    component: 'DealBoard',
  },
});
```

Send stable error codes, not raw API payloads or unreviewed stack traces.

## Shutdown

```ts
await telemetry.stop();
```

Normal browser navigation is handled as an offline heartbeat. Explicit logout should call `stop()` so the session is closed immediately.

## Product onboarding checklist

1. Create the telemetry source in IMDS Super Admin.
2. Copy the write key shown once after creation.
3. Add the production and staging origins separately.
4. Set `userKey`, `organizationId` and `branchId` from the shared IMDS identity model.
5. Instrument the router and only the approved business-critical features.
6. Verify online presence, event counts and errors in Super Admin.
7. Review the event catalog before adding custom events.
8. Confirm that no protected health information or arbitrary form data is emitted.
