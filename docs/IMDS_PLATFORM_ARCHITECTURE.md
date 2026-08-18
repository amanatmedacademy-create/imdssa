# IMDS Platform — целевая архитектура

## 1. Главный принцип

`IMDS Control Center (Super Admin)` — единственный источник истины для коммерческого и платформенного состояния продуктов IMDS.

Продукты (`IMDS Marketing`, `IMDS Dashboard`, `IMDS Contract` и будущие продукты) не должны самостоятельно определять:

- доступность продукта для организации;
- тариф и статус подписки;
- доступные модули;
- лимиты и квоты;
- billing lifecycle;
- коммерческие add-ons;
- платформенные блокировки.

Они только получают и применяют утверждённое состояние из Control Center.

---

## 2. Владение данными

### Control Center владеет

- Organizations / Clinics
- Product subscriptions
- Plans
- Product modules
- Module assignments
- Limits / quotas
- Billing state
- Payment methods
- Product enable / suspend state
- Sync revisions
- Control commands
- Audit log

### Продукт владеет

Только своими операционными данными.

Пример для `IMDS Marketing`:

- CRM leads
- deals / funnel
- tasks
- calls
- chats
- WhatsApp data
- Meta Ads operational data
- analytics facts
- integrations credentials
- schedules / campaigns

Marketing не является источником истины для тарифа, модулей и лимитов.

---

## 3. Основные сущности

```text
Organization
  └── ProductSubscription
       ├── Plan
       ├── Modules[]
       ├── Limits{}
       ├── BillingState
       └── SyncRevision
```

Минимальный entitlement-контракт продукта:

```json
{
  "organizationId": "uuid",
  "tenantId": "product-tenant-id",
  "revision": 42,
  "productEnabled": true,
  "modules": {
    "marketing.crm": true,
    "marketing.whatsapp-business": true,
    "marketing.meta-ads": false
  },
  "limits": {
    "users": 20,
    "branches": 3,
    "waba_accounts": 1,
    "telephony_channels": 5,
    "ai_requests": 10000
  },
  "billing": {
    "subscriptionStatus": "active",
    "trialEndsAt": null,
    "periodEndsAt": "2026-09-18T00:00:00Z",
    "graceEndsAt": null,
    "accessEndsAt": null,
    "renewalMode": "manual",
    "currency": "KZT"
  }
}
```

---

## 4. Поток изменения

Любое коммерческое изменение происходит только в Control Center.

```text
Super Admin
   ↓
Изменение организации / подписки / тарифа / модуля / лимита
   ↓
Создание новой desired_revision
   ↓
Control Command / Outbox Event
   ↓
Reconcile / Sync Service
   ↓
Product Adapter
   ↓
IMDS Marketing / Dashboard / Contract
   ↓
Применение revision
   ↓
Подтверждение actual_revision
   ↓
Audit + sync status
```

---

## 5. Правила синхронизации

### Revision

Каждое изменение entitlement-состояния увеличивает `desired_revision`.

Продукт хранит последнюю успешно применённую `actual_revision`.

Устаревшая ревизия не должна перезаписывать новую.

### Idempotency

Повторная доставка одной и той же команды не должна менять состояние повторно или создавать дубли.

### Fail closed

Если организация уже управляется Control Center, но актуальный entitlement недоступен, продукт не должен тихо переходить на локальные коммерческие настройки.

Возвращается временная ошибка платформенного состояния.

### Audit

Все изменения должны фиксировать:

- actor;
- organization;
- product;
- before state;
- after state;
- revision;
- timestamp;
- результат синхронизации.

---

## 6. Модули

Модуль является платформенной сущностью.

Пример:

```text
IMDS Marketing
├── CRM
├── Tasks
├── WhatsApp Business
├── Telephony
├── Meta Ads
├── Analytics
├── Automation
└── AI
```

Control Center определяет, какие модули включены организации.

Продукт только проверяет entitlement перед выполнением API / UI-функции.

---

## 7. Лимиты

Лимиты задаются в Control Center и передаются продукту вместе с entitlement.

Примеры:

- clinics
- branches
- users
- leads
- open_tasks
- integrations
- whatsapp_channels
- waba_accounts
- whatsapp_numbers
- telephony_channels
- call_minutes
- transcription_minutes
- call_recording_days
- ai_requests
- automation_runs
- storage_gb
- meta_ad_accounts
- meta_pages
- meta_datasets

Продукт считает usage, но лимит получает из Control Center.

---

## 8. Billing lifecycle

Целевой lifecycle:

```text
trial
  ↓
active
  ↓
past_due
  ↓
grace
  ↓
read_only
  ↓
suspended
```

Control Center владеет статусом lifecycle.

Продукт применяет ограничения:

- `active` — полный доступ;
- `past_due` / `grace` — согласно политике продукта;
- `read_only` — чтение разрешено, коммерческие изменения блокируются;
- `suspended` — продукт заблокирован.

---

## 9. Сетевой контур

```text
Browser
   ↓
Control Center :8080
   ├── Web UI
   └── API :8788

Control Center API
   ↓ internal token
Sync / Reconcile
   ↓
Marketing local runtime
   ↓
Marketing operational DB
```

Внутренний control channel не должен быть публичным без авторизации.

Для межсервисных вызовов используется отдельный `IMDS_PLATFORM_CONTROL_TOKEN`.

---

## 10. Что запрещаем

После завершения миграции нельзя:

- хранить отдельный независимый тариф внутри Marketing;
- вручную включать коммерческий модуль только в Marketing;
- иметь разные лимиты в Super Admin и продукте;
- восстанавливать entitlement из локальных fallback-настроек для managed tenant;
- менять subscription state без создания новой sync revision;
- позволять продукту менять master commercial state напрямую.

---

## 11. Порядок реализации

### Phase 1 — Foundation

1. Зафиксировать единый entitlement contract.
2. Control Center сделать master source of truth.
3. Все subscription/module/limit изменения должны создавать новую revision.
4. Reconcile должен доставлять полное состояние продукта.
5. Marketing должен fail-closed для managed tenant.

### Phase 2 — Modules & Limits

1. Нормализовать module codes.
2. Удалить локальные дубли коммерческих модулей.
3. Подключить hard/soft quota enforcement.
4. Добавить usage reporting обратно в Control Center.

### Phase 3 — Billing

1. Единый billing lifecycle.
2. Invoices.
3. Payments.
4. Plan changes.
5. Add-ons.
6. Payment reconciliation.

### Phase 4 — Users & Access

1. Organization membership.
2. Product access.
3. Roles / permissions.
4. Platform owner/admin controls.

### Phase 5 — Realtime & Operations

1. Event bus / outbox.
2. Realtime sync state.
3. Retry / dead-letter handling.
4. Health monitoring.
5. Unified audit.

### Phase 6 — Production Edge

1. Domain names.
2. HTTPS.
3. Reverse proxy hardening.
4. Rate limiting.
5. Backup / restore.
6. Monitoring / alerts.

---

## 12. Итоговая модель

```text
                  IMDS CONTROL CENTER
                  Source of Truth
                         │
         ┌───────────────┼────────────────┐
         │               │                │
    Organization     Subscription       Modules
         │               │                │
         └───────────────┼────────────────┘
                         │
                     Limits/Billing
                         │
                    Sync Revision
                         │
                    Reconcile Layer
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   IMDS Marketing  IMDS Dashboard  IMDS Contract
          │              │              │
      Operational    Operational    Operational
         Data           Data           Data
```

**Правило:** Control Center решает, что организации разрешено. Продукт решает только, как выполнить разрешённую функцию.
