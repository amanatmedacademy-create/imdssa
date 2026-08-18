# Phase 1 — Foundation audit

Дата: 2026-08-18

Целевая схема: `docs/IMDS_PLATFORM_ARCHITECTURE.md`.

## Статус

### Уже соответствует целевой архитектуре

- Control Center хранит `product_tenant_bindings`, `desired_revision`, `actual_revision`, `control_commands` и `outbox_events`.
- `reconcile.ts` собирает полное entitlement-состояние: productEnabled, modules, limits, billing.
- Marketing принимает versioned entitlement через `/internal/platform/entitlements/apply`.
- Marketing отклоняет устаревшие revision и работает fail-closed для managed tenant, если entitlement недоступен.
- Межсервисный канал защищён `IMDS_PLATFORM_CONTROL_TOKEN`.
- Nginx маршрутизирует CloudPayments webhooks в Control Center.

## Несоответствия Phase 1

### P0 — Marketing всё ещё содержит собственный commercial/billing control plane

Файлы:
- `marketing/server/billingControlPlane.ts`
- `marketing/server/vpsScheduler.ts`
- локальные таблицы `imds_billing_*`

Проблема:
Marketing умеет самостоятельно хранить планы, подписки, add-ons и переводить lifecycle (`active -> past_due -> grace_period -> suspended`). Это нарушает правило: Control Center — единственный source of truth для коммерческого состояния.

Цель:
- Marketing должен только проксировать billing UX в Control Center;
- payment webhook, plan change, subscription lifecycle и add-on grant должны изменяться только в Control Center;
- Marketing получает результат только через entitlement revision.

### P0 — изменения subscription state в Control Center должны гарантированно создавать новую revision

Сейчас `queue_product_sync()` вызывается для organization_products, module_installations и organization updates. Нужна отдельная гарантия для `product_subscriptions` и изменений, которые меняют итоговый entitlement.

Цель:
Любое изменение plan/status/period/payment method/lifecycle/limits должно вызывать `app.queue_product_sync(organization_id, product_id, reason)`.

### P1 — lifecycle vocabulary не полностью нормализован

В Control Center целевая цепочка:
`trial -> active -> past_due -> grace -> read_only -> suspended`.

В локальном Marketing billing встречается `grace_period`, а отдельный local lifecycle не содержит полноценного `read_only` как master state.

Цель:
Один набор canonical status в Control Center. Продукт только применяет ограничения.

### P1 — local fallback допустим только для unmanaged tenant

Marketing уже fail-closed для `platform_managed_at`, это правильно. При дальнейшей миграции нельзя расширять local commercial fallback на managed tenants.

### P1 — два billing маршрута в одном Marketing runtime

`vpsRuntime.ts` одновременно монтирует:
- `handleBillingGatewayRequest` — правильный server-to-server gateway в Control Center;
- `handleBillingControlPlaneRequest` — локальный commercial engine.

Цель:
После миграции оставить только billing gateway и удалить локальный master commercial engine.

## Порядок исправления

1. Добавить DB-trigger в Control Center: изменения `product_subscriptions` -> новая sync revision.
2. Проверить, что lifecycle/payment/apply-plan изменения проходят через этот trigger.
3. Добавить regression tests на revision bump.
4. Перенести/подтвердить CloudPayments lifecycle полностью в Control Center.
5. Отключить локальный Marketing lifecycle scheduler.
6. Удалить `handleBillingControlPlaneRequest` из Marketing runtime после подтверждения production Control Center billing.
7. Оставить в Marketing только `/api/billing/*` gateway и entitlement enforcement.
8. Проверить fail-closed, stale revision, module/limit enforcement end-to-end.

## Definition of Done — Phase 1

- Ни один managed tenant не получает тариф/лимиты/модули из локального Marketing commercial store.
- Любое master commercial изменение в Control Center увеличивает `desired_revision`.
- `reconcile` доставляет полный snapshot.
- Marketing применяет только revision >= текущей.
- При недоступном entitlement managed tenant получает platform error, а не fallback.
- CI и VPS deploy проходят для обоих репозиториев.
