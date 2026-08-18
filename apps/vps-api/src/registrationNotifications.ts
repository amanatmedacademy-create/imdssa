import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { loadTelegramDeliverySettings } from './notificationSettings.js';

type RegistrationPayload = {
  eventId: string;
  eventType: 'organization.registered';
  source: string;
  occurredAt: string;
  company: { externalTenantId: string; name: string };
  owner: { name: string; email: string; phone: string };
  trial: { productCode: string; status: string; startsAt: string; endsAt: string; days: number };
};

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

async function requestBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredText(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function parseEvent(input: Record<string, unknown>): RegistrationPayload {
  const company = record(input.company);
  const owner = record(input.owner);
  const trial = record(input.trial);
  const eventType = requiredText(input.eventType, 'eventType');
  if (eventType !== 'organization.registered') throw new Error('Unsupported eventType');
  const startsAt = requiredText(trial.startsAt, 'trial.startsAt');
  const endsAt = requiredText(trial.endsAt, 'trial.endsAt');
  if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error('Invalid trial period');
  }
  return {
    eventId: requiredText(input.eventId, 'eventId'),
    eventType: 'organization.registered',
    source: requiredText(input.source, 'source'),
    occurredAt: requiredText(input.occurredAt, 'occurredAt'),
    company: {
      externalTenantId: requiredText(company.externalTenantId, 'company.externalTenantId'),
      name: requiredText(company.name, 'company.name'),
    },
    owner: {
      name: requiredText(owner.name, 'owner.name'),
      email: requiredText(owner.email, 'owner.email'),
      phone: requiredText(owner.phone, 'owner.phone'),
    },
    trial: {
      productCode: requiredText(trial.productCode, 'trial.productCode'),
      status: requiredText(trial.status, 'trial.status'),
      startsAt,
      endsAt,
      days: Number(trial.days || 3),
    },
  };
}

function bearer(req: IncomingMessage): string {
  const authorization = String(req.headers.authorization || '');
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
}

function telegramDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function telegramText(event: RegistrationPayload): string {
  return [
    'Новая регистрация IMDS',
    '',
    `Организация: ${event.company.name}`,
    `Пользователь: ${event.owner.name}`,
    `Телефон: ${event.owner.phone}`,
    `Email: ${event.owner.email}`,
    `Продукт: IMDS Marketing`,
    `Статус: Trial (${event.trial.days} дня)`,
    `Trial до: ${telegramDate(event.trial.endsAt)}`,
  ].join('\n');
}

async function sendTelegram(pool: Pool, event: RegistrationPayload): Promise<{ status: 'sent' | 'failed' | 'disabled'; messageId: string | null; error: string | null }> {
  const settings = await loadTelegramDeliverySettings(pool);
  const token = settings.token;
  const chatId = settings.chatId;
  if (!settings.registrationEnabled) return { status: 'disabled', messageId: null, error: 'Registration Telegram notifications are disabled' };
  if (!token || !chatId) return { status: 'disabled', messageId: null, error: 'Telegram is not configured' };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: telegramText(event), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!response.ok || payload.ok !== true) return { status: 'failed', messageId: null, error: payload.description || `Telegram HTTP ${response.status}` };
    return { status: 'sent', messageId: payload.result?.message_id ? String(payload.result.message_id) : null, error: null };
  } catch (error) {
    return { status: 'failed', messageId: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleInternalRegistrationEvent(req: IncomingMessage, res: ServerResponse, pool: Pool, url: URL, method: string): Promise<boolean> {
  if (url.pathname !== '/internal/platform/events/registration') return false;
  if (method !== 'POST') { json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return true; }
  const expected = String(process.env.IMDS_PLATFORM_CONTROL_TOKEN || '').trim();
  if (!expected || bearer(req) !== expected) { json(res, 401, { error: 'PLATFORM_CONTROL_UNAUTHORIZED' }); return true; }

  let event: RegistrationPayload;
  try { event = parseEvent(await requestBody(req)); }
  catch (error) { json(res, 400, { error: 'INVALID_REGISTRATION_EVENT', message: error instanceof Error ? error.message : String(error) }); return true; }

  const client = await pool.connect();
  let notificationId: string;
  try {
    await client.query('BEGIN');
    const organization = await client.query<{ id: string }>(`insert into app.organizations(external_key,name,status,metadata)
      values($1,$2,'active'::app.organization_status,jsonb_build_object('owner_name',$3::text,'owner_email',$4::text,'owner_phone',$5::text,'registration_source',$6::text,'trial_status',$7::text,'trial_started_at',$8::text,'trial_ends_at',$9::text))
      on conflict(external_key) do update set name=excluded.name, metadata=app.organizations.metadata || excluded.metadata, updated_at=now()
      returning id`, [event.company.externalTenantId, event.company.name, event.owner.name, event.owner.email, event.owner.phone, event.source, event.trial.status, event.trial.startsAt, event.trial.endsAt]);
    const organizationId = organization.rows[0].id;
    const notification = await client.query<{ id: string }>(`insert into app.registration_notifications(
      event_id,source_product_code,external_tenant_id,organization_id,company_name,owner_name,owner_email,owner_phone,trial_status,trial_started_at,trial_ends_at,payload)
      values($1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12::jsonb)
      on conflict(event_id) do update set payload=excluded.payload, updated_at=now()
      returning id`, [event.eventId, event.trial.productCode, event.company.externalTenantId, organizationId, event.company.name, event.owner.name, event.owner.email, event.owner.phone, event.trial.status, event.trial.startsAt, event.trial.endsAt, JSON.stringify(event)]);
    notificationId = notification.rows[0].id;

    const product = await client.query<{ id: string }>('select id from app.products where code=$1 limit 1', [event.trial.productCode]);
    if (product.rowCount) {
      const productId = product.rows[0].id;
      await client.query(`insert into app.organization_products(organization_id,product_id,status,config)
        values($1,$2,'active'::app.installation_status,jsonb_build_object('subscriptionStatus',$3::text,'trialStartsAt',$4::text,'trialEndsAt',$5::text,'source','registration'))
        on conflict(organization_id,product_id) do update set status='active'::app.installation_status,config=app.organization_products.config || excluded.config,updated_at=now()`,
      [organizationId, productId, event.trial.status, event.trial.startsAt, event.trial.endsAt]);
      await client.query(`insert into app.product_subscriptions(
        organization_id,product_id,status,billing_period_months,currency,trial_started_at,trial_ends_at,access_ends_at,plan_snapshot,metadata)
        values($1,$2,case when $4::timestamptz>now() then 'trial' else 'expired' end,1,'KZT',$3::timestamptz,$4::timestamptz,$4::timestamptz,
          jsonb_build_object('registrationTrial',true,'days',$5::int),jsonb_build_object('source','registration','eventId',$6::text))
        on conflict(organization_id,product_id) do nothing`,
      [organizationId, productId, event.trial.startsAt, event.trial.endsAt, event.trial.days, event.eventId]);
    }
    await client.query(`insert into app.realtime_events(topic,event_type,organization_id,payload)
      values('registration_notifications','organization.registered',$1,$2::jsonb)`, [organizationId, JSON.stringify({ notificationId, ...event })]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
  client.release();

  const telegram = await sendTelegram(pool, event);
  await pool.query(`update app.registration_notifications set telegram_status=$2,telegram_message_id=$3,telegram_error=$4,updated_at=now() where id=$1`,
    [notificationId, telegram.status, telegram.messageId, telegram.error]);
  json(res, 202, { accepted: true, notificationId, telegramStatus: telegram.status });
  return true;
}
