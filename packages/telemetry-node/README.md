# `@imds/telemetry-node`

Internal server-side SDK for sanitized API timing, error and feature events.

## Basic usage

```ts
import { createImdsTelemetryNode } from '@imds/telemetry-node';

export const telemetry = createImdsTelemetryNode({
  endpoint: process.env.IMDS_TELEMETRY_ENDPOINT!,
  sourceKey: process.env.IMDS_TELEMETRY_SOURCE_KEY!,
  writeKey: process.env.IMDS_TELEMETRY_WRITE_KEY!,
  productKey: 'imds-marketing',
  appVersion: process.env.APP_VERSION,
}).start();
```

Use a `server` telemetry source. Its write key is a backend secret and must never be exposed through `VITE_*`, `NEXT_PUBLIC_*`, client bundles, browser logs or error pages.

## HTTP middleware

The middleware uses structural request/response types and can be adapted to Express, Fastify or similar Node frameworks.

```ts
app.use(telemetry.createHttpMiddleware((request) => ({
  userKey: request.user?.id,
  userRole: request.user?.role,
  organizationId: request.tenant?.controlPlaneId,
  branchId: request.branch?.controlPlaneId,
  sessionId: request.headers['x-imds-session-id'],
  moduleKey: 'crm_api',
  moduleOwnerProductKey: 'imds-crm',
})));
```

Only the normalized route template, HTTP method, status code and duration are sent. Request bodies, response bodies, query strings and authorization headers are never sent.

## Timed operations

```ts
const result = await telemetry.measure(
  {
    eventName: 'api_request',
    route: '/integrations/meta/sync',
    moduleKey: 'meta_ads',
    properties: { method: 'POST' },
  },
  () => synchronizeMetaAccount(),
);
```

## Error events

Send stable, reviewed error codes. Do not send raw external-provider responses, SQL, stack traces containing secrets, patient data or arbitrary exception metadata.

## Shutdown

```ts
await telemetry.stop();
```

Register shutdown hooks in long-running workers so the in-memory queue is flushed before termination.
