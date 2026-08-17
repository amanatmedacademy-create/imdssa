from pathlib import Path


def one(text: str, old: str, new: str, name: str) -> str:
    if old not in text:
        raise SystemExit(f'missing anchor: {name}')
    return text.replace(old, new, 1)

# API routing
p = Path('apps/vps-api/src/index.ts')
s = p.read_text()
s = one(s,
    "import { handleInternalRegistrationEvent } from './registrationNotifications.js';\n",
    "import { handleInternalRegistrationEvent } from './registrationNotifications.js';\nimport { handleNotificationSettingsApi } from './notificationSettings.js';\n",
    'settings api import')
s = one(s,
    "  const user = await requireUser(req, res); if (!user) return;\n\n  if (url.pathname === '/api/v1/notifications' && method === 'GET') {",
    "  const user = await requireUser(req, res); if (!user) return;\n\n  if (await handleNotificationSettingsApi(req, res, pool, url, method, user)) return;\n\n  if (url.pathname === '/api/v1/notifications' && method === 'GET') {",
    'settings api route')
p.write_text(s)

# Registration delivery uses server-stored settings, with env fallback handled by the settings module.
p = Path('apps/vps-api/src/registrationNotifications.ts')
s = p.read_text()
s = one(s,
    "import type { Pool } from 'pg';\n",
    "import type { Pool } from 'pg';\nimport { loadTelegramDeliverySettings } from './notificationSettings.js';\n",
    'registration settings import')
s = one(s,
    "async function sendTelegram(event: RegistrationPayload): Promise<{ status: 'sent' | 'failed' | 'disabled'; messageId: string | null; error: string | null }> {\n  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();\n  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();\n  if (!token || !chatId) return { status: 'disabled', messageId: null, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured' };",
    "async function sendTelegram(pool: Pool, event: RegistrationPayload): Promise<{ status: 'sent' | 'failed' | 'disabled'; messageId: string | null; error: string | null }> {\n  const settings = await loadTelegramDeliverySettings(pool);\n  const token = settings.token;\n  const chatId = settings.chatId;\n  if (!settings.registrationEnabled) return { status: 'disabled', messageId: null, error: 'Registration Telegram notifications are disabled' };\n  if (!token || !chatId) return { status: 'disabled', messageId: null, error: 'Telegram is not configured' };",
    'registration telegram settings')
s = one(s, "  const telegram = await sendTelegram(event);", "  const telegram = await sendTelegram(pool, event);", 'registration telegram call')
p.write_text(s)

# VPS UI navigation
p = Path('src/vps/VpsApp.tsx')
s = p.read_text()
s = one(s,
    "import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';\nimport './vps.css';",
    "import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';\nimport { RegistrationCenter } from '../features/registrations/RegistrationCenter';\nimport { TelegramNotificationSettings } from '../features/settings/TelegramNotificationSettings';\nimport './vps.css';",
    'ui imports')
s = one(s,
    "type Tab = 'overview' | 'organizations' | 'products' | 'modules' | 'installations' | 'sync' | 'realtime' | 'security';",
    "type Tab = 'overview' | 'organizations' | 'registrations' | 'products' | 'modules' | 'installations' | 'sync' | 'realtime' | 'security' | 'settings';",
    'tab type')
s = one(s,
    "  { id: 'organizations', label: 'Организации' },\n  { id: 'products', label: 'Продукты' },",
    "  { id: 'organizations', label: 'Организации' },\n  { id: 'registrations', label: 'Регистрации' },\n  { id: 'products', label: 'Продукты' },",
    'registrations tab')
s = one(s,
    "  { id: 'security', label: 'Безопасность' },\n];",
    "  { id: 'security', label: 'Безопасность' },\n  { id: 'settings', label: 'Настройки' },\n];",
    'settings tab')
s = one(s,
    "  overview: 'Обзор платформы', organizations: 'Организации', products: 'Продукты', modules: 'Управление модулями', installations: 'Установки модулей', sync: 'Синхронизация продуктов', realtime: 'События в реальном времени', security: 'Безопасность аккаунта',",
    "  overview: 'Обзор платформы', organizations: 'Организации', registrations: 'Новые регистрации', products: 'Продукты', modules: 'Управление модулями', installations: 'Установки модулей', sync: 'Синхронизация продуктов', realtime: 'События в реальном времени', security: 'Безопасность аккаунта', settings: 'Настройки уведомлений',",
    'tab titles')
s = one(s,
    "  {tab === 'security' && <section className=\"vps-card\">",
    "  {tab === 'registrations' && <RegistrationCenter />}\n\n  {tab === 'settings' && <TelegramNotificationSettings />}\n\n  {tab === 'security' && <section className=\"vps-card\">",
    'ui panels')
p.write_text(s)

# Production deployment includes settings schema.
p = Path('deploy/vps/deploy-control-plane.sh')
s = p.read_text()
s = one(s,
    '005_registration_notifications.sql 005_security_hardening.sql; do',
    '005_registration_notifications.sql 005_security_hardening.sql 007_notification_delivery_settings.sql; do',
    'deploy migration list')
p.write_text(s)

p = Path('.github/workflows/deploy-vps-control-plane.yml')
s = p.read_text()
s = one(s,
    '          cp deploy/vps/migrations/005_security_hardening.sql .deploy-stage/005_security_hardening.sql\n',
    '          cp deploy/vps/migrations/005_security_hardening.sql .deploy-stage/005_security_hardening.sql\n          cp deploy/vps/migrations/007_notification_delivery_settings.sql .deploy-stage/007_notification_delivery_settings.sql\n',
    'workflow migration stage')
p.write_text(s)
