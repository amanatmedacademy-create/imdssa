# IMDS Product Analytics and Live Presence

## Назначение

Product Analytics отвечает на вопросы, которые внешний uptime-monitoring не закрывает:

- какой продукт и модуль используют сейчас;
- кто онлайн, кто реально активен, а кто оставил вкладку открытой;
- сколько активного времени приходится на пользователя, компанию и продукт;
- какие функции используются, а какие не получают adoption;
- где растёт доля ошибок;
- какие компании сокращают активность и входят в риск оттока;
- внутри какого host-продукта открыт модуль и какому продукту он принадлежит.

Checkmate остаётся источником истины для uptime, response time, SSL, портов, инфраструктуры и инцидентов. Product Analytics является источником истины для присутствия и использования функций.

```text
Checkmate
  -> Доступен ли продукт и инфраструктура?

@imds/telemetry-web + @imds/telemetry-node
  -> Кто, сколько и какими функциями пользуется?

IMDS Super Admin
  -> Единый операционный экран продуктов, компаний, инцидентов и usage.
```

## Реализованные компоненты

### База control plane

Миграция `supabase/migrations/0020_product_analytics.sql` добавляет:

- `telemetry_sources`;
- `telemetry_event_definitions`;
- `product_usage_sessions`;
- `product_usage_events`;
- `product_usage_daily_rollups`;
- `telemetry_ingestion_batches`;
- представления live-сессий и источников;
- RPC для конфигурации источников, ingestion и aggregate snapshot;
- функции session expiry, daily rollup и retention cleanup;
- RLS, явные Data API grants и append-only ограничения.

### Ingestion gateway

`supabase/functions/telemetry-ingest/index.ts` обеспечивает:

- source key + write key authentication;
- сравнение SHA-256-хэша write key;
- точный browser origin allow-list;
- rate limit на источник;
- лимит запроса 256 KiB и до 100 событий;
- разрешённый каталог event names;
- property allow-list;
- фильтрацию чувствительных полей;
- проверку UUID и временных меток;
- deterministic sampling;
- idempotency по request ID и event ID;
- аудит batch без хранения IP и raw request body.

### SDK

- `packages/telemetry-web` — browser session, heartbeat, active/idle time, navigation, module и feature events, offline queue.
- `packages/telemetry-node` — sanitized backend latency, status и error events.

### Super Admin

Раздел `/analytics` содержит:

- сводку по всей экосистеме;
- пользователей онлайн;
- active/idle session time;
- использование модулей и функций;
- активность компаний и риск;
- реестр telemetry sources;
- создание источника и одноразовую выдачу write key.

## Граница безопасности и приватности

Product telemetry не является хранилищем медицинских данных.

Запрещено отправлять:

- ФИО пациента, ИИН и идентификаторы пациента;
- диагнозы, симптомы, анамнез, лечение и медицинские заметки;
- телефоны, email и адреса;
- текст поиска, комментарии, сообщения и свободные значения форм;
- access tokens, cookies, passwords и authorization headers;
- request/response bodies, SQL и raw payload внешнего провайдера;
- URL query string и fragment.

Разрешённый пример:

```json
{
  "eventName": "feature_used",
  "moduleKey": "crm_kanban",
  "featureKey": "deal_moved",
  "outcome": "success",
  "properties": { "action": "move" }
}
```

SDK выполняет первую фильтрацию. Edge Function повторно валидирует payload и удаляет свойства, которых нет в event catalog.

## Модель сессии

### Статусы

- `active` — heartbeat не старше 90 секунд, вкладка видима, действие было не более 60 секунд назад;
- `idle` — heartbeat приходит, но активных действий нет;
- `offline` — вкладка выгружена или связь временно потеряна, сессия ещё может продолжиться;
- `closed` — logout или session timeout.

`pagehide` переводит browser session в `offline`, а не в `closed`, поэтому reload не закрывает её навсегда. Явный logout должен вызывать `telemetry.stop()`.

### Учёт времени

Active time увеличивается только когда:

- документ видим;
- недавно были keyboard, pointer, touch или scroll events;
- heartbeat принят ingestion layer;
- event ID ещё не был обработан.

Просто открытая вкладка не считается активной работой.

### Рекомендуемые значения

| Настройка | Значение |
|---|---:|
| Heartbeat | 30 секунд |
| Active threshold | 60 секунд |
| Idle threshold | 120 секунд |
| Online threshold | 90 секунд от heartbeat |
| Session timeout | 30 минут |
| Raw event retention | 90 дней |
| Browser batch | 25 событий |
| Server batch | 50 событий |
| Ingestion maximum | 100 событий |

## Host product и module owner

Модуль может отображаться внутри другого продукта. Всегда фиксируются две размерности.

Пример: CRM Kanban открыт внутри IMDS Marketing.

```ts
telemetry.module('crm_kanban', 'CRM Kanban', 'imds-crm');
```

Telemetry source определяет host product (`imds-marketing`), а `moduleOwnerProductKey` — владельца модуля (`imds-crm`). Это нужно для корректного usage metering, лицензирования и cross-product аналитики.

## Развёртывание Supabase

### Edge Function secrets

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Service role key хранится только в Edge Function secrets и никогда не попадает в Vite, browser bundle или логи клиента.

### Применение схемы

Примените миграции в числовом порядке и проверьте наличие версии:

```text
0020_product_analytics.sql
```

### Deploy функции

```bash
supabase functions deploy telemetry-ingest --no-verify-jwt
```

`verify_jwt = false` установлен осознанно: продукты авторизуются отдельными ingestion credentials, а не JWT пользователя Super Admin.

### Scheduler

Каждую минуту:

```sql
select public.expire_stale_product_usage_sessions();
```

После закрытия UTC-дня:

```sql
select public.refresh_product_usage_rollups(current_date - 1);
```

Ежедневно:

```sql
select public.purge_expired_product_usage_data();
```

Rollup конкретной даты можно безопасно пересобрать повторным вызовом функции.

## Создание telemetry source

1. Откройте **Super Admin → Аналитика продуктов → Источники**.
2. Нажмите **Подключить продукт**.
3. Выберите продукт, тип источника и environment.
4. Для browser source укажите точные origins.
5. Создайте источник.
6. Скопируйте source key и write key сразу.
7. Server key сохраните в backend secret store.
8. Browser key используйте только вместе с origin allow-list, rate limit и строгой schema validation.

База хранит только SHA-256-хэш. Потерянный ключ не восстанавливается и должен быть ротирован.

Рекомендуемый naming:

```text
<product-key>-web-<environment>
<product-key>-server-<environment>
```

Примеры:

```text
imds-marketing-web-production
imds-marketing-server-production
imds-mis-web-staging
```

Browser/server и production/staging должны иметь разные источники.

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

Router:

```ts
telemetry.page(location.pathname);
```

Modules:

```ts
telemetry.module('meta_ads', 'Meta Ads');
telemetry.module('crm_kanban', 'CRM Kanban', 'imds-crm');
```

Features:

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

```ts
app.use(telemetry.createHttpMiddleware((request) => ({
  userKey: request.user?.id,
  userRole: request.user?.role,
  organizationId: request.tenant?.controlPlaneId,
  moduleKey: 'crm_api',
  moduleOwnerProductKey: 'imds-crm',
})));
```

Browser session ID нельзя повторно использовать в server source: primary session identity привязана к одному telemetry source. Корреляция backend performance выполняется по product, tenant, user, route и release; distributed tracing остаётся задачей observability layer.

## Event catalog

| Event | Category | Назначение |
|---|---|---|
| `session_started` | session | Открытие session |
| `session_heartbeat` | session | Presence и active/idle delta |
| `session_ended` | session | Явное закрытие |
| `page_viewed` | navigation | Использование route |
| `module_opened` | navigation | Adoption модуля |
| `feature_used` | feature | Использование функции |
| `entity_created` | business | Счётчик создания сущностей |
| `entity_updated` | business | Счётчик изменения сущностей |
| `search_performed` | feature | Поиск без текста запроса |
| `export_started` | feature | Начало экспорта |
| `export_completed` | feature | Завершение экспорта |
| `api_request` | performance | Backend duration/status |
| `api_error` | error | Sanitized backend error |
| `frontend_error` | error | Sanitized browser error |
| `permission_denied` | system | Отказ авторизации |
| `subscription_limit_reached` | system | Достигнут entitlement limit |

Новое event name добавляется только через migration после privacy review и объявления разрешённых property keys.

## Порядок подключения продуктов

1. IMDS Marketing browser staging.
2. IMDS Marketing server staging.
3. Проверка session и event schema.
4. IMDS Marketing production.
5. IMDS CRM.
6. IMDS MIS.
7. IMDS Dashboard.
8. IMDS Finance.
9. IMDS Contract.
10. Остальные продукты.

Для каждого продукта:

1. Подтвердить canonical product key.
2. Сопоставить global user, organization и branch IDs.
3. Создать отдельные staging sources.
4. Сначала подключить session + router.
5. Проверить online и active/idle расчёт.
6. Добавить 5–10 критичных feature events.
7. Убедиться, что PHI/PII не отправляются.
8. Создать production sources.
9. При необходимости начать с sampling.
10. Перейти на 100% после проверки.

## Acceptance criteria

Продукт считается подключённым, когда:

- production browser source активен;
- production origin добавлен точно;
- heartbeat виден не позднее 60 секунд;
- reload не закрывает session;
- logout закрывает session;
- idle-вкладка не накапливает active time;
- заполнены user, organization и branch dimensions;
- host product и module owner корректны;
- routes не содержат query strings;
- инструментировано минимум пять approved features;
- errors используют стабильные коды;
- в raw events нет PHI/PII;
- scheduler успешно выполнил expiry, rollup и retention;
- фильтры Super Admin возвращают ожидаемый продукт.

## Диагностика

### События не поступают

Проверьте:

1. `telemetry_sources.status = active`;
2. точное совпадение source key;
3. правильный write key;
4. точное совпадение browser origin;
5. наличие event name в catalog;
6. размер batch;
7. control-plane IDs;
8. ошибки в `telemetry_ingestion_batches`.

### Online завышен

Проверьте duplicate SDK initialization, heartbeat interval, logout `stop()`, stale-session scheduler и количество реально открытых вкладок. Каждая вкладка является отдельной browser session.

### Active time завышен

Проверьте synthetic activity events, Page Visibility API, idle timeout, duplicate event IDs и повторное создание SDK instance.

### Errors растут

Product Analytics определяет product/module/feature/release/tenant. Checkmate и tracing layer используются для поиска infrastructure и request root cause.

## Retention и backup

Raw events хранятся по retention каждого source, по умолчанию 90 дней. Daily rollups предназначены для долгосрочной аналитики. Увеличение raw retention требует отдельного business justification и privacy review.
