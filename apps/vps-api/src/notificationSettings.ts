import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { handleProductCommercialApi } from './productCommercial.js';
import { handleSessionApi } from './sessionRoutes.js';

type PlatformUser = { id: string; global_role: string | null };

type TelegramSettingsRow = {
  telegram_bot_token_ciphertext: string | null;
  telegram_chat_id: string | null;
  registration_enabled: boolean;
  trial_expiring_enabled: boolean;
  payment_received_enabled: boolean;
  payment_overdue_enabled: boolean;
  subscription_expired_enabled: boolean;
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
  updated_at: string;
};

export type TelegramDeliverySettings = {
  token: string;
  chatId: string;
  registrationEnabled: boolean;
};

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
}

function canManage(user: PlatformUser): boolean {
  return user.global_role === 'platform_owner' || user.global_role === 'platform_admin';
}

function cryptoKey(): Buffer {
  const root = String(process.env.IMDS_PLATFORM_CONTROL_TOKEN || '').trim();
  if (!root) throw new Error('IMDS_PLATFORM_CONTROL_TOKEN is required for notification secret encryption');
  return createHash('sha256').update(`imdssa:notification-settings:v1:${root}`).digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decrypt(value: string | null): string {
  if (!value) return '';
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) throw new Error('Unsupported notification secret format');
  const decipher = createDecipheriv('aes-256-gcm', cryptoKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, 'base64url')), decipher.final()]).toString('utf8');
}

async function getRow(pool: Pool): Promise<TelegramSettingsRow> {
  const result = await pool.query<TelegramSettingsRow>(`select telegram_bot_token_ciphertext,telegram_chat_id,registration_enabled,trial_expiring_enabled,
    payment_received_enabled,payment_overdue_enabled,subscription_expired_enabled,last_tested_at,last_test_status,last_test_error,updated_at
    from app.notification_delivery_settings where id=1`);
  if (result.rowCount) return result.rows[0];
  const inserted = await pool.query<TelegramSettingsRow>(`insert into app.notification_delivery_settings(id) values(1) returning
    telegram_bot_token_ciphertext,telegram_chat_id,registration_enabled,trial_expiring_enabled,payment_received_enabled,payment_overdue_enabled,
    subscription_expired_enabled,last_tested_at,last_test_status,last_test_error,updated_at`);
  return inserted.rows[0];
}

export async function loadTelegramDeliverySettings(pool: Pool): Promise<TelegramDeliverySettings> {
  try {
    const row = await getRow(pool);
    const dbToken = decrypt(row.telegram_bot_token_ciphertext);
    return {
      token: dbToken || String(process.env.TELEGRAM_BOT_TOKEN || '').trim(),
      chatId: String(row.telegram_chat_id || process.env.TELEGRAM_CHAT_ID || '').trim(),
      registrationEnabled: row.registration_enabled,
    };
  } catch (error) {
    console.error('notification settings load failed', error);
    return {
      token: String(process.env.TELEGRAM_BOT_TOKEN || '').trim(),
      chatId: String(process.env.TELEGRAM_CHAT_ID || '').trim(),
      registrationEnabled: true,
    };
  }
}

async function telegramRequest(token: string, method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; description?: string; result?: unknown };
  if (!response.ok || result.ok !== true) throw new Error(result.description || `Telegram HTTP ${response.status}`);
  return result;
}

export async function handleNotificationSettingsApi(req: IncomingMessage, res: ServerResponse, pool: Pool, url: URL, method: string, user: PlatformUser): Promise<boolean> {
  if (await handleSessionApi({ req, res, pool, url, method, user, json })) return true;
  if (await handleProductCommercialApi({ req, res, pool, url, method, user, json })) return true;

  const path = '/api/v1/settings/notifications/telegram';
  if (url.pathname !== path && url.pathname !== `${path}/test`) return false;
  if (!canManage(user)) { json(res, 403, { error: 'PLATFORM_ADMIN_REQUIRED' }); return true; }

  if (url.pathname === path && method === 'GET') {
    const row = await getRow(pool);
    const envToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const envChatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
    json(res, 200, {
      configured: Boolean(row.telegram_bot_token_ciphertext || envToken) && Boolean(row.telegram_chat_id || envChatId),
      tokenStored: Boolean(row.telegram_bot_token_ciphertext || envToken),
      chatId: row.telegram_chat_id || envChatId,
      registrationEnabled: row.registration_enabled,
      trialExpiringEnabled: row.trial_expiring_enabled,
      paymentReceivedEnabled: row.payment_received_enabled,
      paymentOverdueEnabled: row.payment_overdue_enabled,
      subscriptionExpiredEnabled: row.subscription_expired_enabled,
      lastTestedAt: row.last_tested_at,
      lastTestStatus: row.last_test_status,
      lastTestError: row.last_test_error,
      updatedAt: row.updated_at,
    });
    return true;
  }

  if (url.pathname === path && method === 'PUT') {
    const data = await body(req);
    const botToken = String(data.botToken || '').trim();
    const chatId = String(data.chatId || '').trim();
    const clearToken = data.clearToken === true;
    const current = await getRow(pool);
    const encryptedToken = clearToken ? null : botToken ? encrypt(botToken) : current.telegram_bot_token_ciphertext;
    await pool.query(`update app.notification_delivery_settings set
      telegram_bot_token_ciphertext=$1,telegram_chat_id=nullif($2,''),registration_enabled=$3,trial_expiring_enabled=$4,
      payment_received_enabled=$5,payment_overdue_enabled=$6,subscription_expired_enabled=$7,updated_by=$8,updated_at=now()
      where id=1`, [
      encryptedToken, chatId,
      data.registrationEnabled !== false,
      data.trialExpiringEnabled !== false,
      data.paymentReceivedEnabled !== false,
      data.paymentOverdueEnabled !== false,
      data.subscriptionExpiredEnabled !== false,
      user.id,
    ]);
    json(res, 200, { ok: true, configured: Boolean(encryptedToken) && Boolean(chatId) });
    return true;
  }

  if (url.pathname === `${path}/test` && method === 'POST') {
    const settings = await loadTelegramDeliverySettings(pool);
    if (!settings.token || !settings.chatId) { json(res, 400, { error: 'TELEGRAM_NOT_CONFIGURED' }); return true; }
    try {
      await telegramRequest(settings.token, 'sendMessage', {
        chat_id: settings.chatId,
        text: 'IMDS Control Center\n\nТестовое уведомление Telegram успешно отправлено.',
        disable_web_page_preview: true,
      });
      await pool.query(`update app.notification_delivery_settings set last_tested_at=now(),last_test_status='success',last_test_error=null,updated_at=now() where id=1`);
      json(res, 200, { ok: true, status: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await pool.query(`update app.notification_delivery_settings set last_tested_at=now(),last_test_status='failed',last_test_error=$1,updated_at=now() where id=1`, [message]);
      json(res, 502, { error: 'TELEGRAM_TEST_FAILED', message });
    }
    return true;
  }

  json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  return true;
}
