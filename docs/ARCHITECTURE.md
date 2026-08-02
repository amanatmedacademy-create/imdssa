# IMDS Super Admin — Architecture

## 1. Context architecture

```mermaid
flowchart TB
  Staff[IMDS Platform Staff] --> Web[Super Admin Web]
  Web --> Gateway[Admin API Gateway]
  Gateway --> Auth[Identity / SSO / MFA]
  Gateway --> Control[Control Plane]
  Control --> Registry[Product Registry]
  Control --> Billing[Billing & Usage Metering]
  Control --> Provisioning[Workflow & Provisioning]
  Control --> Security[Security / Approvals / Audit]
  Control --> Operations[Observability / Incident Center]
  Provisioning --> Adapters[Product Adapter Layer]
  Adapters --> P1[IMDS MIS]
  Adapters --> P2[IMDS CRM]
  Adapters --> P3[IMDS Marketing]
  Adapters --> P4[IMDS Finance]
  Adapters --> P5[IMDS Contract]
  Adapters --> P6[IMDS Dashboard]
  Adapters --> P7[IMDS Product 7]
  Adapters --> P8[IMDS Product 8]
  Adapters --> P9[IMDS Product 9]
  Adapters --> P10[IMDS Product 10]
  Adapters --> P11[IMDS Product 11]
  Control --> Events[Event Bus / Queues]
  Events --> Adapters
  Adapters --> External[Meta / WABA / TikTok / Google / Kaspi / Medvoice]
```

**Boundary:** Super Admin stores control-plane data. Operational, medical, CRM and financial records remain in their respective products.

## 2. Service architecture

```mermaid
flowchart LR
  UI[React Admin UI] --> API[Admin API]
  API --> IAM[IAM Service]
  API --> Tenant[Tenant Service]
  API --> Catalog[Product Catalog]
  API --> Entitlements[Entitlements Service]
  API --> Subscription[Subscription Service]
  API --> Workflow[Workflow Engine]
  API --> Support[Support Service]
  API --> Audit[Audit Service]
  API --> Search[Global Search]

  Tenant --> DB[(PostgreSQL)]
  Catalog --> DB
  Entitlements --> DB
  Subscription --> DB
  Support --> DB
  Audit --> AuditDB[(Append-only Audit Store)]
  Workflow --> Queue[(Redis / Queue)]
  Queue --> Workers[Background Workers]
  Workers --> Adapters[Product Adapters]
  Adapters --> Products[11 IMDS Products]
  API --> Metrics[Metrics / Logs / Traces]
  Workers --> Metrics
```

## 3. Multi-tenant domain model

```mermaid
erDiagram
  HOLDING ||--o{ ORGANIZATION : contains
  ORGANIZATION ||--o{ LEGAL_ENTITY : owns
  ORGANIZATION ||--o{ BRANCH : operates
  ORGANIZATION ||--o{ MEMBERSHIP : grants
  USER ||--o{ MEMBERSHIP : receives
  BRANCH ||--o{ MEMBERSHIP : scopes
  PRODUCT ||--o{ SUBSCRIPTION : sold_as
  ORGANIZATION ||--o{ SUBSCRIPTION : purchases
  SUBSCRIPTION ||--o{ LICENSE : provisions
  PRODUCT ||--o{ LICENSE : enables
  ORGANIZATION ||--o{ LICENSE : uses
  LICENSE ||--o{ ENTITLEMENT : defines
  PRODUCT ||--o{ PRODUCT_ADAPTER : integrates
```

Hierarchy:

```text
Holding
└── Organization / tenant
    ├── Legal entities (BIN)
    ├── Branches
    ├── Users and memberships
    ├── Subscriptions
    └── Product licenses and entitlements
```

## 4. Customer lifecycle

```mermaid
stateDiagram-v2
  [*] --> Lead
  Lead --> Demo
  Demo --> Onboarding
  Onboarding --> Trial
  Trial --> Active: payment / contract
  Trial --> Closed: rejected
  Active --> PastDue: payment overdue
  PastDue --> GracePeriod
  GracePeriod --> Active: payment received
  GracePeriod --> Suspended: deadline reached
  Suspended --> Active: reactivated
  Suspended --> Archived: termination
  Archived --> Deleted: retention expired + approval
```

## Core modules

1. Identity Directory and RBAC.
2. Companies, holdings, legal entities and branches.
3. Product Registry and adapter contracts.
4. Licenses, subscriptions, tariffs and entitlements.
5. Workflow and automated provisioning.
6. Usage metering and billing.
7. Event bus, webhooks and background jobs.
8. Security, approvals, impersonation and break-glass access.
9. Audit, observability, incidents and status management.
10. Customer onboarding, support, SLA and health score.
11. Data governance, retention, export, backup and disaster recovery.

## Mandatory security rules

- MFA for global administrators.
- Deny-by-default permissions.
- Tenant scoping on every control-plane entity.
- No direct browser access to product databases.
- Impersonation requires reason, time limit and immutable audit event.
- Secrets are encrypted and never returned in full.
- Dangerous commands require approval by a second authorized user.
- Audit events are append-only and retained separately from operational logs.
