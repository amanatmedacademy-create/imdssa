# IMDS Observability with Checkmate

## Boundary

Checkmate is deployed as a separate monitoring service. Its AGPL source code is not copied into the proprietary IMDS Super Admin repository.

```text
IMDS Super Admin
  -> Supabase control plane
  -> Checkmate Adapter Edge Function
  -> Checkmate /api/v1
  -> MongoDB, Redis, workers and Capture agents
```

The IMDS database stores only configuration and normalized operational projections:

- Checkmate connection metadata;
- external secret references;
- IMDS product and service mappings;
- current service status, uptime and latency;
- synchronized incidents;
- maintenance windows;
- status-page references;
- synchronization history and append-only events.

Checkmate remains the source of truth for raw monitoring checks and its internal operational history.

## Product and service model

Each IMDS product can register multiple services for each environment:

```text
IMDS CRM
  production
    crm-frontend
    crm-api
    crm-worker
    crm-database
  staging
    crm-api
```

A service maps to a Checkmate monitor through `checkmate_monitor_id`.

Recommended Checkmate tags:

```text
imds-product:imds-crm
imds-service:crm-api
```

These tags allow the adapter to match an existing Checkmate monitor to the correct IMDS product and service without embedding IMDS database identifiers in Checkmate.

## Adapter API usage

The worker uses the Checkmate `/api/v1` routes documented by its OpenAPI specification:

- `GET /monitors/team`;
- `GET /incidents/team`;
- `GET /maintenance-window/team`;
- `GET /status-page/team`.

The adapter is intentionally isolated behind a Supabase Edge Function. The browser never receives the Checkmate JWT.

## Secrets

Connection records contain only a secret reference:

```text
env://CHECKMATE_API_TOKEN
vault://imds/observability/checkmate/production
```

`env://` resolves from Edge Function environment variables.

`vault://` currently resolves through `IMDS_SECRET_REFERENCE_MAP`. A dedicated vault implementation can replace this resolver without changing database records.

## Durable synchronization

Synchronization is driven through `observability_sync_runs`.

Lifecycle:

```text
queued -> running -> succeeded
                  -> partial
                  -> failed -> retry
```

The worker claims jobs with PostgreSQL `FOR UPDATE SKIP LOCKED`. Each run records:

- sync type;
- worker lease;
- attempts and maximum attempts;
- records received and written;
- errors;
- correlation ID;
- execution details.

Stale worker leases are returned to the queue by `requeue_stale_observability_sync_runs()`.

## Sync types

- `connection_test`;
- `monitors`;
- `incidents`;
- `maintenance`;
- `status_pages`;
- `full`.

A full sync continues when one resource fails and finishes as `partial`. A dedicated resource sync fails atomically and is retried.

## Edge Function configuration

Required:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
IMDS_OBSERVABILITY_WORKER_TOKEN
CHECKMATE_API_TOKEN
```

Optional vault mapping:

```text
IMDS_SECRET_REFERENCE_MAP={"vault://imds/observability/checkmate/production":"token-value"}
```

Invocation:

```http
POST /functions/v1/checkmate-adapter
x-imds-worker-token: <IMDS_OBSERVABILITY_WORKER_TOKEN>
content-type: application/json

{
  "workerId": "checkmate-adapter-1",
  "batchSize": 5,
  "staleAfterSeconds": 600
}
```

Recommended schedule: once per minute. Checkmate itself performs monitoring checks independently; the IMDS schedule only synchronizes current state and incidents.

## Security

- production Checkmate URLs must use HTTPS;
- secrets are never returned to the frontend;
- browser writes to observability tables are denied;
- configuration changes use guarded RPC functions;
- worker queue functions require `service_role`;
- observability events are append-only;
- platform owner, super admin and technical admin can change configuration;
- support, finance, sales and audit roles receive read-only access according to RBAC.

## Deployment

Recommended external service topology:

```text
Cloudflare / reverse proxy
  -> monitor.imdstech.net
  -> Checkmate container :52345
  -> MongoDB
  -> Redis / BullMQ
  -> optional Capture agents
```

Checkmate requires at minimum:

```text
DB_CONNECTION_STRING
CLIENT_HOST
JWT_SECRET
```

The Checkmate API token referenced by IMDS must belong to a dedicated service account. Do not reuse a human administrator token.

## Remaining production tasks

1. Deploy Checkmate and MongoDB/Redis separately.
2. Create the dedicated Checkmate service account.
3. Store its token in the Edge Function secret store.
4. Apply migrations `0015` and `0016`.
5. Deploy `checkmate-adapter`.
6. Schedule the worker invocation.
7. Register product services and add the recommended tags to Checkmate monitors.
8. Configure notification channels and public status pages inside Checkmate.
