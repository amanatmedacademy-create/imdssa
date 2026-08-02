import type { GlobalRole, Json } from '../../lib/database.types';
import { getSupabase } from '../../lib/supabase';
import type {
  ApiClientStatus,
  InboundWebhookEventStatus,
  IntegrationAuthType,
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationJobStatus,
  IntegrationJobType,
  IntegrationProviderStatus,
  IntegrationSupabaseClient,
  OutboundWebhookDeliveryStatus,
  OutboundWebhookSubscriptionStatus,
  WebhookVerificationMode,
} from './integrationDatabase.types';

export type IntegrationProvider = {
  id: string;
  key: string;
  name: string;
  category: string;
  status: IntegrationProviderStatus;
  description: string;
  authTypes: IntegrationAuthType[];
  capabilities: string[];
  supportsWebhooks: boolean;
  supportsIncrementalSync: boolean;
  supportsTokenRefresh: boolean;
  documentationUrl: string;
  configSchema: Json;
  isSystem: boolean;
  archivedAt: string | null;
  updatedAt: string;
};

export type IntegrationConnection = {
  id: string;
  organizationId: string;
  organizationName: string;
  productId: string | null;
  productName: string;
  providerId: string;
  providerKey: string;
  providerName: string;
  displayName: string;
  environment: IntegrationEnvironment;
  authType: IntegrationAuthType;
  externalAccountId: string;
  externalAccountName: string;
  status: IntegrationConnectionStatus;
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy';
  secretReference: string;
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastError: string;
  connectedAt: string | null;
  config: Json;
  updatedAt: string;
};

export type InboundWebhookEndpoint = {
  id: string;
  integrationId: string;
  connectionName: string;
  providerName: string;
  publicKey: string;
  name: string;
  status: 'active' | 'paused' | 'disabled';
  verificationMode: WebhookVerificationMode;
  secretReference: string;
  signatureHeader: string;
  timestampHeader: string;
  allowedIpCidrs: string[];
  allowedEventTypes: string[];
  eventIdPath: string;
  eventTypePath: string;
  challengeField: string;
  maxPayloadBytes: number;
  lastReceivedAt: string | null;
  createdAt: string;
};

export type InboundWebhookEvent = {
  id: string;
  endpointId: string;
  endpointName: string;
  integrationId: string;
  connectionName: string;
  providerEventId: string;
  eventType: string;
  payload: Json;
  signatureValid: boolean;
  sourceIp: string;
  status: InboundWebhookEventStatus;
  attemptCount: number;
  maxAttempts: number;
  lastError: string;
  correlationId: string;
  receivedAt: string;
};

export type IntegrationJob = {
  id: string;
  integrationId: string;
  connectionName: string;
  providerName: string;
  jobType: IntegrationJobType;
  status: IntegrationJobStatus;
  payload: Json;
  response: Json | null;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string;
  correlationId: string;
  createdAt: string;
};

export type OutboundWebhookSubscription = {
  id: string;
  organizationId: string | null;
  organizationName: string;
  productId: string | null;
  productName: string;
  name: string;
  targetUrl: string;
  eventTypes: string[];
  secretReference: string;
  status: OutboundWebhookSubscriptionStatus;
  timeoutMs: number;
  maxAttempts: number;
  headers: Json;
  createdAt: string;
};

export type OutboundWebhookDelivery = {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  eventId: string;
  eventType: string;
  status: OutboundWebhookDeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  responseStatus: number | null;
  lastError: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

export type ApiClient = {
  id: string;
  organizationId: string | null;
  organizationName: string;
  name: string;
  keyPrefix: string;
  status: ApiClientStatus;
  scopes: string[];
  allowedIpCidrs: string[];
  rateLimitPerMinute: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type ApiRequestLog = {
  id: string;
  apiClientId: string | null;
  apiClientName: string;
  requestId: string;
  method: string;
  path: string;
  requiredScope: string;
  sourceIp: string;
  statusCode: number;
  durationMs: number | null;
  correlationId: string;
  createdAt: string;
};

export type IntegrationOrganization = { id: string; name: string; status: string };
export type IntegrationProduct = { id: string; key: string; name: string; status: string };
export type ApiScope = { key: string; description: string; riskLevel: string; isActive: boolean };

export type IntegrationSnapshot = {
  providers: IntegrationProvider[];
  connections: IntegrationConnection[];
  endpoints: InboundWebhookEndpoint[];
  events: InboundWebhookEvent[];
  jobs: IntegrationJob[];
  outboundSubscriptions: OutboundWebhookSubscription[];
  deliveries: OutboundWebhookDelivery[];
  apiClients: ApiClient[];
  apiLogs: ApiRequestLog[];
  organizations: IntegrationOrganization[];
  products: IntegrationProduct[];
  scopes: ApiScope[];
};

export type ProviderInput = {
  id?: string | null;
  key: string;
  name: string;
  category: string;
  status: IntegrationProviderStatus;
  description: string;
  authTypes: IntegrationAuthType[];
  capabilities: string[];
  supportsWebhooks: boolean;
  supportsIncrementalSync: boolean;
  supportsTokenRefresh: boolean;
  documentationUrl: string;
  configSchema: Json;
  reason: string;
};

export type ConnectionInput = {
  id?: string | null;
  organizationId: string;
  productId: string | null;
  providerKey: string;
  displayName: string;
  environment: IntegrationEnvironment;
  authType: IntegrationAuthType;
  externalAccountId: string;
  externalAccountName: string;
  secretReference: string;
  config: Json;
  reason: string;
};

export type EndpointInput = {
  integrationId: string;
  name: string;
  verificationMode: WebhookVerificationMode;
  secretReference: string;
  signatureHeader: string;
  timestampHeader: string;
  allowedIpCidrs: string[];
  allowedEventTypes: string[];
  eventIdPath: string;
  eventTypePath: string;
  challengeField: string;
  maxPayloadBytes: number;
  reason: string;
};

export type OutboundSubscriptionInput = {
  organizationId: string | null;
  productId: string | null;
  name: string;
  targetUrl: string;
  eventTypes: string[];
  secretReference: string;
  timeoutMs: number;
  maxAttempts: number;
  headers: Json;
  reason: string;
};

export type ApiClientInput = {
  organizationId: string | null;
  name: string;
  scopes: string[];
  allowedIpCidrs: string[];
  rateLimitPerMinute: number;
  expiresAt: string | null;
  reason: string;
};

export type OneTimeCredential = {
  kind: 'webhook_token' | 'api_key';
  title: string;
  value: string;
  referenceId: string;
};

export type IntegrationMutationResult = {
  snapshot: IntegrationSnapshot;
  credential?: OneTimeCredential;
};

const STORAGE_KEY = 'imds-super-admin:integrations:v2';
const DEMO_NOW = '2026-08-02T12:00:00.000Z';

const demoOrganizations: IntegrationOrganization[] = [
  { id: 'org-amanat', name: 'Amanat Medical Center', status: 'active' },
  { id: 'org-orda', name: 'Orda Clinic', status: 'trial' },
  { id: 'org-sapa', name: 'Sapa Med', status: 'past_due' },
  { id: 'org-nova', name: 'Nova Health', status: 'onboarding' },
];

const demoProducts: IntegrationProduct[] = [
  { id: 'mis', key: 'imds-mis', name: 'IMDS MIS', status: 'active' },
  { id: 'crm', key: 'imds-crm', name: 'IMDS CRM', status: 'active' },
  { id: 'marketing', key: 'imds-marketing', name: 'IMDS Marketing', status: 'degraded' },
  { id: 'finance', key: 'imds-finance', name: 'IMDS Finance', status: 'active' },
  { id: 'contract', key: 'imds-contract', name: 'IMDS Contract', status: 'active' },
  { id: 'dashboard', key: 'imds-dashboard', name: 'IMDS Dashboard', status: 'active' },
];

const providerSeed: Array<Omit<IntegrationProvider, 'id' | 'updatedAt' | 'archivedAt'>> = [
  { key: 'meta_ads', name: 'Meta Ads', category: 'advertising', status: 'active', description: 'Рекламные кабинеты, кампании, лиды и статистика.', authTypes: ['oauth2', 'service_token'], capabilities: ['accounts.read', 'campaigns.read', 'campaigns.manage', 'insights.read', 'leads.read'], supportsWebhooks: true, supportsIncrementalSync: true, supportsTokenRefresh: true, documentationUrl: 'https://developers.facebook.com/docs/marketing-apis/', configSchema: {}, isSystem: true },
  { key: 'whatsapp_business', name: 'WhatsApp Business', category: 'messaging', status: 'active', description: 'WABA, номера, шаблоны, сообщения и статусы доставки.', authTypes: ['oauth2', 'service_token'], capabilities: ['messages.send', 'messages.read', 'templates.manage'], supportsWebhooks: true, supportsIncrementalSync: false, supportsTokenRefresh: true, documentationUrl: 'https://developers.facebook.com/docs/whatsapp/', configSchema: {}, isSystem: true },
  { key: 'tiktok_ads', name: 'TikTok Ads', category: 'advertising', status: 'active', description: 'Рекламные аккаунты, кампании, лиды и отчёты.', authTypes: ['oauth2', 'service_token'], capabilities: ['accounts.read', 'campaigns.read', 'insights.read', 'leads.read'], supportsWebhooks: true, supportsIncrementalSync: true, supportsTokenRefresh: true, documentationUrl: 'https://business-api.tiktok.com/portal/docs', configSchema: {}, isSystem: true },
  { key: 'google_ads', name: 'Google Ads', category: 'advertising', status: 'active', description: 'Клиенты, кампании, конверсии и аналитика.', authTypes: ['oauth2'], capabilities: ['accounts.read', 'campaigns.read', 'insights.read', 'conversions.write'], supportsWebhooks: false, supportsIncrementalSync: true, supportsTokenRefresh: true, documentationUrl: 'https://developers.google.com/google-ads/api/docs/start', configSchema: {}, isSystem: true },
  { key: 'kaspi', name: 'Kaspi', category: 'payments', status: 'active', description: 'Платежи, сверка транзакций и уведомления.', authTypes: ['api_key', 'service_token', 'hmac'], capabilities: ['payments.read', 'payments.reconcile', 'refunds.read'], supportsWebhooks: true, supportsIncrementalSync: true, supportsTokenRefresh: false, documentationUrl: '', configSchema: {}, isSystem: true },
  { key: 'medvoice', name: 'Medvoice', category: 'medical', status: 'active', description: 'Синхронизация записей, пациентов и статусов посещений.', authTypes: ['api_key', 'service_token'], capabilities: ['appointments.read', 'appointments.write', 'patients.read'], supportsWebhooks: true, supportsIncrementalSync: true, supportsTokenRefresh: false, documentationUrl: '', configSchema: {}, isSystem: true },
  { key: 'email', name: 'Email', category: 'communications', status: 'active', description: 'Транзакционные письма и статусы доставки.', authTypes: ['api_key', 'service_token'], capabilities: ['messages.send', 'delivery.read', 'templates.manage'], supportsWebhooks: true, supportsIncrementalSync: false, supportsTokenRefresh: false, documentationUrl: '', configSchema: {}, isSystem: true },
  { key: 'sms', name: 'SMS', category: 'communications', status: 'active', description: 'SMS-сообщения и delivery callbacks.', authTypes: ['api_key', 'service_token'], capabilities: ['messages.send', 'delivery.read'], supportsWebhooks: true, supportsIncrementalSync: false, supportsTokenRefresh: false, documentationUrl: '', configSchema: {}, isSystem: true },
  { key: 'cloudflare', name: 'Cloudflare', category: 'infrastructure', status: 'active', description: 'Workers, Pages, DNS, deployments и health.', authTypes: ['api_key', 'service_token'], capabilities: ['workers.read', 'workers.deploy', 'pages.read', 'dns.read'], supportsWebhooks: true, supportsIncrementalSync: true, supportsTokenRefresh: false, documentationUrl: 'https://developers.cloudflare.com/api/', configSchema: {}, isSystem: true },
  { key: 'workplace', name: 'Workplace', category: 'operations', status: 'active', description: 'Авторизация и операционные процессы сотрудников.', authTypes: ['oauth2', 'service_token'], capabilities: ['users.read', 'groups.read', 'notifications.send'], supportsWebhooks: true, supportsIncrementalSync: true, supportsTokenRefresh: true, documentationUrl: '', configSchema: {}, isSystem: true },
  { key: 'telephony', name: 'Telephony', category: 'communications', status: 'active', description: 'Звонки, записи разговоров и статусы операторов.', authTypes: ['api_key', 'service_token', 'hmac'], capabilities: ['calls.read', 'calls.create', 'recordings.read'], supportsWebhooks: true, supportsIncrementalSync: true, supportsTokenRefresh: false, documentationUrl: '', configSchema: {}, isSystem: true },
];

const demoScopes: ApiScope[] = [
  { key: 'health.read', description: 'Состояние платформы и продуктов.', riskLevel: 'low', isActive: true },
  { key: 'products.read', description: 'Чтение Product Registry.', riskLevel: 'low', isActive: true },
  { key: 'organizations.read', description: 'Чтение данных компании.', riskLevel: 'medium', isActive: true },
  { key: 'integrations.read', description: 'Чтение статуса интеграций.', riskLevel: 'medium', isActive: true },
  { key: 'events.publish', description: 'Публикация платформенных событий.', riskLevel: 'high', isActive: true },
  { key: 'webhooks.read', description: 'Чтение webhook deliveries.', riskLevel: 'medium', isActive: true },
  { key: 'subscriptions.read', description: 'Чтение подписок и лицензий.', riskLevel: 'high', isActive: true },
];

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function organizationName(id: string | null, organizations: IntegrationOrganization[]) {
  if (!id) return 'Платформа IMDS';
  return organizations.find((item) => item.id === id)?.name ?? id;
}

function productName(id: string | null, products: IntegrationProduct[]) {
  if (!id) return 'Все продукты';
  return products.find((item) => item.id === id)?.name ?? id;
}

function providerName(id: string, providers: IntegrationProvider[]) {
  return providers.find((item) => item.id === id)?.name ?? id;
}

function connectionName(id: string, connections: IntegrationConnection[]) {
  return connections.find((item) => item.id === id)?.displayName ?? id;
}

function defaultSnapshot(): IntegrationSnapshot {
  const providers: IntegrationProvider[] = providerSeed.map((provider, index) => ({
    ...provider,
    id: provider.key,
    archivedAt: null,
    updatedAt: DEMO_NOW,
    configSchema: { position: index + 1 },
  }));
  const connections: IntegrationConnection[] = [
    {
      id: 'connection-meta-amanat', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', productId: 'marketing', productName: 'IMDS Marketing', providerId: 'meta_ads', providerKey: 'meta_ads', providerName: 'Meta Ads', displayName: 'Meta Ads · Amanat', environment: 'production', authType: 'oauth2', externalAccountId: 'act_100001', externalAccountName: 'Amanat Ads', status: 'degraded', healthStatus: 'degraded', secretReference: 'vault://imds/integrations/meta/amanat', tokenExpiresAt: '2026-08-12T10:00:00.000Z', lastSyncAt: '2026-08-02T11:48:00.000Z', nextSyncAt: '2026-08-02T12:48:00.000Z', lastError: 'Meta API rate limit: retry scheduled', connectedAt: '2026-07-20T10:00:00.000Z', config: { base_url: 'https://graph.facebook.com', job_path: '/v23.0/control-plane' }, updatedAt: DEMO_NOW,
    },
    {
      id: 'connection-waba-amanat', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', productId: 'crm', productName: 'IMDS CRM', providerId: 'whatsapp_business', providerKey: 'whatsapp_business', providerName: 'WhatsApp Business', displayName: 'WABA · Call Center', environment: 'production', authType: 'service_token', externalAccountId: 'waba_200001', externalAccountName: 'Amanat WhatsApp', status: 'connected', healthStatus: 'healthy', secretReference: 'vault://imds/integrations/waba/amanat', tokenExpiresAt: null, lastSyncAt: '2026-08-02T11:57:00.000Z', nextSyncAt: null, lastError: '', connectedAt: '2026-07-22T10:00:00.000Z', config: { base_url: 'https://graph.facebook.com' }, updatedAt: DEMO_NOW,
    },
    {
      id: 'connection-kaspi-amanat', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', productId: 'finance', productName: 'IMDS Finance', providerId: 'kaspi', providerKey: 'kaspi', providerName: 'Kaspi', displayName: 'Kaspi Payments', environment: 'production', authType: 'hmac', externalAccountId: 'merchant-amanat', externalAccountName: 'IMDS TECH LLP', status: 'connected', healthStatus: 'healthy', secretReference: 'vault://imds/integrations/kaspi/amanat', tokenExpiresAt: null, lastSyncAt: '2026-08-02T11:55:00.000Z', nextSyncAt: '2026-08-02T12:10:00.000Z', lastError: '', connectedAt: '2026-07-25T10:00:00.000Z', config: { base_url: 'https://payments.internal.example' }, updatedAt: DEMO_NOW,
    },
    {
      id: 'connection-tiktok-orda', organizationId: 'org-orda', organizationName: 'Orda Clinic', productId: 'marketing', productName: 'IMDS Marketing', providerId: 'tiktok_ads', providerKey: 'tiktok_ads', providerName: 'TikTok Ads', displayName: 'TikTok · Orda', environment: 'sandbox', authType: 'oauth2', externalAccountId: 'adv_300001', externalAccountName: 'Orda Sandbox', status: 'configuring', healthStatus: 'unknown', secretReference: 'env://TIKTOK_ORDA_SANDBOX_TOKEN', tokenExpiresAt: null, lastSyncAt: null, nextSyncAt: null, lastError: '', connectedAt: null, config: { base_url: 'https://sandbox-business-api.tiktok.com' }, updatedAt: DEMO_NOW,
    },
  ];
  const endpoints: InboundWebhookEndpoint[] = [
    { id: 'endpoint-waba', integrationId: 'connection-waba-amanat', connectionName: 'WABA · Call Center', providerName: 'WhatsApp Business', publicKey: 'wh_demo_waba_amanat', name: 'WABA messages', status: 'active', verificationMode: 'hmac_sha256', secretReference: 'vault://imds/webhooks/waba/amanat', signatureHeader: 'x-hub-signature-256', timestampHeader: '', allowedIpCidrs: [], allowedEventTypes: ['messages', 'message_template_status_update'], eventIdPath: 'entry.0.id', eventTypePath: 'object', challengeField: 'hub.challenge', maxPayloadBytes: 1048576, lastReceivedAt: '2026-08-02T11:59:00.000Z', createdAt: '2026-07-22T10:10:00.000Z' },
    { id: 'endpoint-kaspi', integrationId: 'connection-kaspi-amanat', connectionName: 'Kaspi Payments', providerName: 'Kaspi', publicKey: 'wh_demo_kaspi_amanat', name: 'Kaspi payment notifications', status: 'active', verificationMode: 'hmac_sha256', secretReference: 'vault://imds/webhooks/kaspi/amanat', signatureHeader: 'x-kaspi-signature', timestampHeader: 'x-kaspi-timestamp', allowedIpCidrs: ['185.100.0.0/16'], allowedEventTypes: ['payment.succeeded', 'payment.refunded'], eventIdPath: 'id', eventTypePath: 'type', challengeField: '', maxPayloadBytes: 262144, lastReceivedAt: '2026-08-02T11:52:00.000Z', createdAt: '2026-07-25T10:20:00.000Z' },
  ];
  const events: InboundWebhookEvent[] = [
    { id: 'event-waba-1', endpointId: 'endpoint-waba', endpointName: 'WABA messages', integrationId: 'connection-waba-amanat', connectionName: 'WABA · Call Center', providerEventId: 'wamid.demo.1', eventType: 'messages', payload: { object: 'whatsapp_business_account' }, signatureValid: true, sourceIp: '31.13.70.1', status: 'processed', attemptCount: 1, maxAttempts: 8, lastError: '', correlationId: 'corr-waba-1', receivedAt: '2026-08-02T11:59:00.000Z' },
    { id: 'event-kaspi-1', endpointId: 'endpoint-kaspi', endpointName: 'Kaspi payment notifications', integrationId: 'connection-kaspi-amanat', connectionName: 'Kaspi Payments', providerEventId: 'payment-demo-1', eventType: 'payment.succeeded', payload: { amount: 237000, currency: 'KZT' }, signatureValid: true, sourceIp: '185.100.10.20', status: 'queued', attemptCount: 0, maxAttempts: 8, lastError: '', correlationId: 'corr-kaspi-1', receivedAt: '2026-08-02T11:52:00.000Z' },
    { id: 'event-kaspi-rejected', endpointId: 'endpoint-kaspi', endpointName: 'Kaspi payment notifications', integrationId: 'connection-kaspi-amanat', connectionName: 'Kaspi Payments', providerEventId: 'payment-demo-bad', eventType: 'payment.succeeded', payload: {}, signatureValid: false, sourceIp: '203.0.113.10', status: 'rejected', attemptCount: 0, maxAttempts: 8, lastError: 'source_ip_not_allowed', correlationId: 'corr-kaspi-bad', receivedAt: '2026-08-02T10:43:00.000Z' },
  ];
  const jobs: IntegrationJob[] = [
    { id: 'job-meta-sync', integrationId: 'connection-meta-amanat', connectionName: 'Meta Ads · Amanat', providerName: 'Meta Ads', jobType: 'incremental_sync', status: 'failed', payload: { since: '2026-08-02T10:00:00Z' }, response: null, attemptCount: 2, maxAttempts: 8, availableAt: '2026-08-02T12:05:00.000Z', startedAt: '2026-08-02T11:48:00.000Z', finishedAt: null, lastError: 'HTTP 429 rate limit', correlationId: 'corr-meta-sync', createdAt: '2026-08-02T11:47:00.000Z' },
    { id: 'job-kaspi-event', integrationId: 'connection-kaspi-amanat', connectionName: 'Kaspi Payments', providerName: 'Kaspi', jobType: 'process_webhook', status: 'queued', payload: { eventId: 'event-kaspi-1' }, response: null, attemptCount: 0, maxAttempts: 8, availableAt: '2026-08-02T11:52:00.000Z', startedAt: null, finishedAt: null, lastError: '', correlationId: 'corr-kaspi-1', createdAt: '2026-08-02T11:52:00.000Z' },
  ];
  const outboundSubscriptions: OutboundWebhookSubscription[] = [
    { id: 'outbound-amanat-crm', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', productId: 'crm', productName: 'IMDS CRM', name: 'CRM events to BI', targetUrl: 'https://client.example/webhooks/imds', eventTypes: ['crm.deal.created', 'crm.deal.updated'], secretReference: 'vault://imds/outbound/amanat-bi', status: 'active', timeoutMs: 10000, maxAttempts: 8, headers: { 'x-client': 'amanat-bi' }, createdAt: '2026-07-27T10:00:00.000Z' },
  ];
  const deliveries: OutboundWebhookDelivery[] = [
    { id: 'delivery-crm-1', subscriptionId: 'outbound-amanat-crm', subscriptionName: 'CRM events to BI', eventId: 'platform-event-1', eventType: 'crm.deal.updated', status: 'failed', attemptCount: 3, maxAttempts: 8, responseStatus: 503, lastError: 'Target returned HTTP 503', correlationId: 'corr-delivery-1', createdAt: '2026-08-02T11:40:00.000Z', updatedAt: DEMO_NOW },
  ];
  const apiClients: ApiClient[] = [
    { id: 'api-client-amanat-bi', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', name: 'Amanat BI export', keyPrefix: 'imds_live_43d9ab1', status: 'active', scopes: ['organizations.read', 'integrations.read', 'subscriptions.read'], allowedIpCidrs: ['203.0.113.0/24'], rateLimitPerMinute: 120, expiresAt: '2027-08-02T10:00:00.000Z', lastUsedAt: '2026-08-02T11:50:00.000Z', revokedAt: null, createdAt: '2026-07-29T10:00:00.000Z' },
  ];
  const apiLogs: ApiRequestLog[] = [
    { id: 'api-log-1', apiClientId: 'api-client-amanat-bi', apiClientName: 'Amanat BI export', requestId: 'req-demo-1', method: 'GET', path: '/v1/integrations', requiredScope: 'integrations.read', sourceIp: '203.0.113.25', statusCode: 200, durationMs: 84, correlationId: 'corr-api-1', createdAt: '2026-08-02T11:50:00.000Z' },
  ];
  return { providers, connections, endpoints, events, jobs, outboundSubscriptions, deliveries, apiClients, apiLogs, organizations: demoOrganizations, products: demoProducts, scopes: demoScopes };
}

function cloneSnapshot(snapshot: IntegrationSnapshot): IntegrationSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as IntegrationSnapshot;
}

function readDemoSnapshot(): IntegrationSnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = defaultSnapshot();
      writeDemoSnapshot(initial);
      return initial;
    }
    const parsed = JSON.parse(raw) as IntegrationSnapshot;
    return parsed && Array.isArray(parsed.providers) && Array.isArray(parsed.connections)
      ? parsed
      : defaultSnapshot();
  } catch {
    return defaultSnapshot();
  }
}

function writeDemoSnapshot(snapshot: IntegrationSnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function getIntegrationClient(): IntegrationSupabaseClient | null {
  return getSupabase() as unknown as IntegrationSupabaseClient | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && !Array.isArray(value) && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asJson(value: unknown): Json {
  return value as Json;
}

async function listSupabaseSnapshot(client: IntegrationSupabaseClient): Promise<IntegrationSnapshot> {
  const [
    providerResult,
    connectionResult,
    endpointResult,
    eventResult,
    jobResult,
    outboundResult,
    deliveryResult,
    apiClientResult,
    apiLogResult,
    organizationResult,
    productResult,
    scopeResult,
  ] = await Promise.all([
    client.from('integration_providers').select('id, key, name, category, status, description, auth_types, capabilities, supports_webhooks, supports_incremental_sync, supports_token_refresh, documentation_url, config_schema, is_system, archived_at, updated_at').order('name'),
    client.from('integrations').select('id, organization_id, product_id, provider_id, provider_key, display_name, environment, auth_type, external_account_id, external_account_name, status, health_status, secret_reference, token_expires_at, last_sync_at, next_sync_at, last_error, connected_at, config, archived_at, updated_at').is('archived_at', null).order('updated_at', { ascending: false }),
    client.from('inbound_webhook_endpoints').select('id, integration_id, public_key, name, status, verification_mode, secret_reference, signature_header, timestamp_header, allowed_ip_cidrs, allowed_event_types, event_id_path, event_type_path, challenge_field, max_payload_bytes, last_received_at, created_at, archived_at').is('archived_at', null).order('created_at', { ascending: false }),
    client.from('inbound_webhook_events').select('id, endpoint_id, integration_id, provider_event_id, event_type, payload, signature_valid, source_ip, status, attempt_count, max_attempts, last_error, correlation_id, received_at').order('received_at', { ascending: false }).limit(500),
    client.from('integration_jobs').select('id, integration_id, job_type, status, payload, response, attempt_count, max_attempts, available_at, started_at, finished_at, last_error, correlation_id, created_at').order('created_at', { ascending: false }).limit(500),
    client.from('outbound_webhook_subscriptions').select('id, organization_id, product_id, name, target_url, event_types, secret_reference, status, timeout_ms, max_attempts, headers, created_at, archived_at').is('archived_at', null).order('created_at', { ascending: false }),
    client.from('outbound_webhook_deliveries').select('id, subscription_id, platform_event_id, status, attempt_count, max_attempts, response_status, last_error, correlation_id, created_at, updated_at').order('created_at', { ascending: false }).limit(500),
    client.from('api_clients').select('id, organization_id, name, key_prefix, status, scopes, allowed_ip_cidrs, rate_limit_per_minute, expires_at, last_used_at, revoked_at, created_at').order('created_at', { ascending: false }),
    client.from('api_request_logs').select('id, api_client_id, request_id, method, path, required_scope, source_ip, status_code, duration_ms, correlation_id, created_at').order('created_at', { ascending: false }).limit(500),
    client.from('organizations').select('id, name, status, archived_at').is('archived_at', null).order('name'),
    client.from('products').select('id, key, name, status, archived_at').is('archived_at', null).order('name'),
    client.from('api_scope_catalog').select('key, description, risk_level, is_active').eq('is_active', true).order('key'),
  ]);

  const firstError = providerResult.error
    ?? connectionResult.error
    ?? endpointResult.error
    ?? eventResult.error
    ?? jobResult.error
    ?? outboundResult.error
    ?? deliveryResult.error
    ?? apiClientResult.error
    ?? apiLogResult.error
    ?? organizationResult.error
    ?? productResult.error
    ?? scopeResult.error;
  if (firstError) throw firstError;

  const providerRows = providerResult.data ?? [];
  const organizationRows = organizationResult.data ?? [];
  const productRows = productResult.data ?? [];
  const organizations: IntegrationOrganization[] = organizationRows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    name: String(row.name),
    status: String(row.status),
  }));
  const products: IntegrationProduct[] = productRows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    status: String(row.status),
  }));
  const providers: IntegrationProvider[] = providerRows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    category: String(row.category),
    status: row.status as IntegrationProviderStatus,
    description: typeof row.description === 'string' ? row.description : '',
    authTypes: asStringArray(row.auth_types) as IntegrationAuthType[],
    capabilities: asStringArray(row.capabilities),
    supportsWebhooks: Boolean(row.supports_webhooks),
    supportsIncrementalSync: Boolean(row.supports_incremental_sync),
    supportsTokenRefresh: Boolean(row.supports_token_refresh),
    documentationUrl: typeof row.documentation_url === 'string' ? row.documentation_url : '',
    configSchema: asJson(row.config_schema ?? {}),
    isSystem: Boolean(row.is_system),
    archivedAt: typeof row.archived_at === 'string' ? row.archived_at : null,
    updatedAt: String(row.updated_at),
  }));
  const providerById = new Map(providers.map((item) => [item.id, item]));
  const orgById = new Map(organizations.map((item) => [item.id, item]));
  const productById = new Map(products.map((item) => [item.id, item]));

  const connections: IntegrationConnection[] = (connectionResult.data ?? []).map((row: Record<string, unknown>) => {
    const provider = providerById.get(String(row.provider_id));
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      organizationName: orgById.get(String(row.organization_id))?.name ?? String(row.organization_id),
      productId: typeof row.product_id === 'string' ? row.product_id : null,
      productName: typeof row.product_id === 'string' ? productById.get(row.product_id)?.name ?? row.product_id : 'Все продукты',
      providerId: String(row.provider_id),
      providerKey: String(row.provider_key),
      providerName: provider?.name ?? String(row.provider_key),
      displayName: typeof row.display_name === 'string' ? row.display_name : provider?.name ?? String(row.provider_key),
      environment: row.environment as IntegrationEnvironment,
      authType: row.auth_type as IntegrationAuthType,
      externalAccountId: typeof row.external_account_id === 'string' ? row.external_account_id : '',
      externalAccountName: typeof row.external_account_name === 'string' ? row.external_account_name : '',
      status: row.status as IntegrationConnectionStatus,
      healthStatus: row.health_status as IntegrationConnection['healthStatus'],
      secretReference: typeof row.secret_reference === 'string' ? row.secret_reference : '',
      tokenExpiresAt: typeof row.token_expires_at === 'string' ? row.token_expires_at : null,
      lastSyncAt: typeof row.last_sync_at === 'string' ? row.last_sync_at : null,
      nextSyncAt: typeof row.next_sync_at === 'string' ? row.next_sync_at : null,
      lastError: typeof row.last_error === 'string' ? row.last_error : '',
      connectedAt: typeof row.connected_at === 'string' ? row.connected_at : null,
      config: asJson(row.config ?? {}),
      updatedAt: String(row.updated_at),
    };
  });
  const connectionById = new Map(connections.map((item) => [item.id, item]));

  const endpoints: InboundWebhookEndpoint[] = (endpointResult.data ?? []).map((row: Record<string, unknown>) => {
    const connection = connectionById.get(String(row.integration_id));
    return {
      id: String(row.id),
      integrationId: String(row.integration_id),
      connectionName: connection?.displayName ?? String(row.integration_id),
      providerName: connection?.providerName ?? '',
      publicKey: String(row.public_key),
      name: String(row.name),
      status: row.status as InboundWebhookEndpoint['status'],
      verificationMode: row.verification_mode as WebhookVerificationMode,
      secretReference: typeof row.secret_reference === 'string' ? row.secret_reference : '',
      signatureHeader: String(row.signature_header),
      timestampHeader: typeof row.timestamp_header === 'string' ? row.timestamp_header : '',
      allowedIpCidrs: asStringArray(row.allowed_ip_cidrs),
      allowedEventTypes: asStringArray(row.allowed_event_types),
      eventIdPath: typeof row.event_id_path === 'string' ? row.event_id_path : '',
      eventTypePath: typeof row.event_type_path === 'string' ? row.event_type_path : '',
      challengeField: typeof row.challenge_field === 'string' ? row.challenge_field : '',
      maxPayloadBytes: Number(row.max_payload_bytes),
      lastReceivedAt: typeof row.last_received_at === 'string' ? row.last_received_at : null,
      createdAt: String(row.created_at),
    };
  });
  const endpointById = new Map(endpoints.map((item) => [item.id, item]));

  const events: InboundWebhookEvent[] = (eventResult.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    endpointId: String(row.endpoint_id),
    endpointName: endpointById.get(String(row.endpoint_id))?.name ?? String(row.endpoint_id),
    integrationId: String(row.integration_id),
    connectionName: connectionById.get(String(row.integration_id))?.displayName ?? String(row.integration_id),
    providerEventId: typeof row.provider_event_id === 'string' ? row.provider_event_id : '',
    eventType: typeof row.event_type === 'string' ? row.event_type : '',
    payload: asJson(row.payload ?? {}),
    signatureValid: Boolean(row.signature_valid),
    sourceIp: typeof row.source_ip === 'string' ? row.source_ip : '',
    status: row.status as InboundWebhookEventStatus,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    lastError: typeof row.last_error === 'string' ? row.last_error : '',
    correlationId: String(row.correlation_id),
    receivedAt: String(row.received_at),
  }));

  const jobs: IntegrationJob[] = (jobResult.data ?? []).map((row: Record<string, unknown>) => {
    const connection = connectionById.get(String(row.integration_id));
    return {
      id: String(row.id),
      integrationId: String(row.integration_id),
      connectionName: connection?.displayName ?? String(row.integration_id),
      providerName: connection?.providerName ?? '',
      jobType: row.job_type as IntegrationJobType,
      status: row.status as IntegrationJobStatus,
      payload: asJson(row.payload ?? {}),
      response: row.response === null || row.response === undefined ? null : asJson(row.response),
      attemptCount: Number(row.attempt_count),
      maxAttempts: Number(row.max_attempts),
      availableAt: String(row.available_at),
      startedAt: typeof row.started_at === 'string' ? row.started_at : null,
      finishedAt: typeof row.finished_at === 'string' ? row.finished_at : null,
      lastError: typeof row.last_error === 'string' ? row.last_error : '',
      correlationId: String(row.correlation_id),
      createdAt: String(row.created_at),
    };
  });

  const outboundSubscriptions: OutboundWebhookSubscription[] = (outboundResult.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    organizationId: typeof row.organization_id === 'string' ? row.organization_id : null,
    organizationName: typeof row.organization_id === 'string' ? orgById.get(row.organization_id)?.name ?? row.organization_id : 'Платформа IMDS',
    productId: typeof row.product_id === 'string' ? row.product_id : null,
    productName: typeof row.product_id === 'string' ? productById.get(row.product_id)?.name ?? row.product_id : 'Все продукты',
    name: String(row.name),
    targetUrl: String(row.target_url),
    eventTypes: asStringArray(row.event_types),
    secretReference: typeof row.secret_reference === 'string' ? row.secret_reference : '',
    status: row.status as OutboundWebhookSubscriptionStatus,
    timeoutMs: Number(row.timeout_ms),
    maxAttempts: Number(row.max_attempts),
    headers: asJson(row.headers ?? {}),
    createdAt: String(row.created_at),
  }));
  const subscriptionById = new Map(outboundSubscriptions.map((item) => [item.id, item]));

  const platformEventIds = [...new Set((deliveryResult.data ?? []).map((row: Record<string, unknown>) => String(row.platform_event_id)))];
  const platformEventResult = platformEventIds.length
    ? await client.from('platform_events').select('id, event_type').in('id', platformEventIds)
    : { data: [], error: null };
  if (platformEventResult.error) throw platformEventResult.error;
  const eventTypeById = new Map((platformEventResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), String(row.event_type)]));

  const deliveries: OutboundWebhookDelivery[] = (deliveryResult.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    subscriptionName: subscriptionById.get(String(row.subscription_id))?.name ?? String(row.subscription_id),
    eventId: String(row.platform_event_id),
    eventType: eventTypeById.get(String(row.platform_event_id)) ?? '',
    status: row.status as OutboundWebhookDeliveryStatus,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    responseStatus: typeof row.response_status === 'number' ? row.response_status : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : '',
    correlationId: String(row.correlation_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));

  const apiClients: ApiClient[] = (apiClientResult.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    organizationId: typeof row.organization_id === 'string' ? row.organization_id : null,
    organizationName: typeof row.organization_id === 'string' ? orgById.get(row.organization_id)?.name ?? row.organization_id : 'Платформа IMDS',
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    status: row.status as ApiClientStatus,
    scopes: asStringArray(row.scopes),
    allowedIpCidrs: asStringArray(row.allowed_ip_cidrs),
    rateLimitPerMinute: Number(row.rate_limit_per_minute),
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
    lastUsedAt: typeof row.last_used_at === 'string' ? row.last_used_at : null,
    revokedAt: typeof row.revoked_at === 'string' ? row.revoked_at : null,
    createdAt: String(row.created_at),
  }));
  const clientById = new Map(apiClients.map((item) => [item.id, item]));

  const apiLogs: ApiRequestLog[] = (apiLogResult.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    apiClientId: typeof row.api_client_id === 'string' ? row.api_client_id : null,
    apiClientName: typeof row.api_client_id === 'string' ? clientById.get(row.api_client_id)?.name ?? row.api_client_id : 'Unknown client',
    requestId: String(row.request_id),
    method: String(row.method),
    path: String(row.path),
    requiredScope: typeof row.required_scope === 'string' ? row.required_scope : '',
    sourceIp: typeof row.source_ip === 'string' ? row.source_ip : '',
    statusCode: Number(row.status_code),
    durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : null,
    correlationId: String(row.correlation_id),
    createdAt: String(row.created_at),
  }));

  const scopes: ApiScope[] = (scopeResult.data ?? []).map((row: Record<string, unknown>) => ({
    key: String(row.key),
    description: String(row.description),
    riskLevel: String(row.risk_level),
    isActive: Boolean(row.is_active),
  }));

  return { providers, connections, endpoints, events, jobs, outboundSubscriptions, deliveries, apiClients, apiLogs, organizations, products, scopes };
}

async function currentSnapshot(): Promise<IntegrationSnapshot> {
  const client = getIntegrationClient();
  return client ? listSupabaseSnapshot(client) : readDemoSnapshot();
}

function demoCredential(kind: OneTimeCredential['kind'], title: string, referenceId: string) {
  return {
    kind,
    title,
    referenceId,
    value: kind === 'api_key'
      ? `imds_live_${createId('key').replace(/-/g, '')}`
      : createId('token').replace(/-/g, ''),
  } satisfies OneTimeCredential;
}

export const integrationRepository = {
  async list(): Promise<IntegrationSnapshot> {
    return currentSnapshot();
  },

  async saveProvider(input: ProviderInput): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('save_integration_provider', {
        provider_id_value: input.id ?? null,
        key_value: input.key,
        name_value: input.name,
        category_value: input.category,
        status_value: input.status,
        description_value: input.description,
        auth_types_value: input.authTypes,
        capabilities_value: input.capabilities,
        supports_webhooks_value: input.supportsWebhooks,
        supports_incremental_sync_value: input.supportsIncrementalSync,
        supports_token_refresh_value: input.supportsTokenRefresh,
        documentation_url_value: input.documentationUrl || null,
        config_schema_value: input.configSchema,
        reason_value: input.reason,
      });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }

    const snapshot = readDemoSnapshot();
    const existing = input.id ? snapshot.providers.find((item) => item.id === input.id) : null;
    const next: IntegrationProvider = {
      id: existing?.id ?? createId('provider'),
      key: input.key,
      name: input.name,
      category: input.category,
      status: input.status,
      description: input.description,
      authTypes: input.authTypes,
      capabilities: input.capabilities,
      supportsWebhooks: input.supportsWebhooks,
      supportsIncrementalSync: input.supportsIncrementalSync,
      supportsTokenRefresh: input.supportsTokenRefresh,
      documentationUrl: input.documentationUrl,
      configSchema: input.configSchema,
      isSystem: existing?.isSystem ?? false,
      archivedAt: null,
      updatedAt: new Date().toISOString(),
    };
    snapshot.providers = existing
      ? snapshot.providers.map((item) => item.id === existing.id ? next : item)
      : [...snapshot.providers, next];
    snapshot.connections = snapshot.connections.map((item) => item.providerId === next.id
      ? { ...item, providerKey: next.key, providerName: next.name }
      : item);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async archiveProvider(providerId: string, reason: string): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('archive_integration_provider', {
        provider_id_value: providerId,
        reason_value: reason,
      });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    const provider = snapshot.providers.find((item) => item.id === providerId);
    if (!provider) throw new Error('Провайдер не найден.');
    if (provider.isSystem) throw new Error('Системного провайдера нельзя архивировать.');
    if (snapshot.connections.some((item) => item.providerId === providerId && item.status !== 'revoked')) {
      throw new Error('Сначала уберите подключения этого провайдера.');
    }
    snapshot.providers = snapshot.providers.map((item) => item.id === providerId
      ? { ...item, status: 'disabled', archivedAt: new Date().toISOString() }
      : item);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async saveConnection(input: ConnectionInput): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('save_integration_connection', {
        integration_id_value: input.id ?? null,
        organization_id_value: input.organizationId,
        product_id_value: input.productId,
        provider_key_value: input.providerKey,
        display_name_value: input.displayName,
        environment_value: input.environment,
        auth_type_value: input.authType,
        external_account_id_value: input.externalAccountId,
        external_account_name_value: input.externalAccountName,
        secret_reference_value: input.secretReference,
        config_value: input.config,
        reason_value: input.reason,
      });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }

    const snapshot = readDemoSnapshot();
    const provider = snapshot.providers.find((item) => item.key === input.providerKey && !item.archivedAt);
    if (!provider) throw new Error('Провайдер не найден.');
    const existing = input.id ? snapshot.connections.find((item) => item.id === input.id) : null;
    const next: IntegrationConnection = {
      id: existing?.id ?? createId('connection'),
      organizationId: input.organizationId,
      organizationName: organizationName(input.organizationId, snapshot.organizations),
      productId: input.productId,
      productName: productName(input.productId, snapshot.products),
      providerId: provider.id,
      providerKey: provider.key,
      providerName: provider.name,
      displayName: input.displayName,
      environment: input.environment,
      authType: input.authType,
      externalAccountId: input.externalAccountId,
      externalAccountName: input.externalAccountName,
      status: existing?.status ?? 'configuring',
      healthStatus: existing?.healthStatus ?? 'unknown',
      secretReference: input.secretReference || existing?.secretReference || '',
      tokenExpiresAt: existing?.tokenExpiresAt ?? null,
      lastSyncAt: existing?.lastSyncAt ?? null,
      nextSyncAt: existing?.nextSyncAt ?? null,
      lastError: existing?.lastError ?? '',
      connectedAt: existing?.connectedAt ?? null,
      config: input.config,
      updatedAt: new Date().toISOString(),
    };
    snapshot.connections = existing
      ? snapshot.connections.map((item) => item.id === existing.id ? next : item)
      : [next, ...snapshot.connections];
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async setConnectionStatus(connectionId: string, status: IntegrationConnectionStatus, reason: string): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('set_integration_connection_status', {
        integration_id_value: connectionId,
        status_value: status,
        reason_value: reason,
      });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    snapshot.connections = snapshot.connections.map((item) => item.id === connectionId
      ? {
          ...item,
          status,
          healthStatus: status === 'connected' ? 'healthy' : status === 'degraded' ? 'degraded' : ['error', 'revoked'].includes(status) ? 'unhealthy' : item.healthStatus,
          connectedAt: status === 'connected' ? item.connectedAt ?? new Date().toISOString() : item.connectedAt,
          updatedAt: new Date().toISOString(),
        }
      : item);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async enqueueJob(connectionId: string, jobType: IntegrationJobType, payload: Json, reason: string): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('enqueue_integration_job', {
        integration_id_value: connectionId,
        job_type_value: jobType,
        payload_value: payload,
        reason_value: reason,
        idempotency_key_value: null,
      });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    const connection = snapshot.connections.find((item) => item.id === connectionId);
    if (!connection) throw new Error('Подключение не найдено.');
    snapshot.jobs.unshift({
      id: createId('job'),
      integrationId: connection.id,
      connectionName: connection.displayName,
      providerName: connection.providerName,
      jobType,
      status: 'queued',
      payload,
      response: null,
      attemptCount: 0,
      maxAttempts: 8,
      availableAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      lastError: '',
      correlationId: createId('correlation'),
      createdAt: new Date().toISOString(),
    });
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async retryJob(jobId: string, reason: string): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('retry_integration_job', { job_id_value: jobId, reason_value: reason });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    snapshot.jobs = snapshot.jobs.map((item) => item.id === jobId
      ? { ...item, status: 'queued', availableAt: new Date().toISOString(), lastError: '', finishedAt: null }
      : item);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async cancelJob(jobId: string, reason: string): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('cancel_integration_job', { job_id_value: jobId, reason_value: reason });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    snapshot.jobs = snapshot.jobs.map((item) => item.id === jobId
      ? { ...item, status: 'cancelled', finishedAt: new Date().toISOString(), lastError: reason }
      : item);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async createEndpoint(input: EndpointInput): Promise<IntegrationMutationResult> {
    const client = getIntegrationClient();
    if (client) {
      const { data, error } = await client.rpc('create_inbound_webhook_endpoint', {
        integration_id_value: input.integrationId,
        name_value: input.name,
        verification_mode_value: input.verificationMode,
        secret_reference_value: input.secretReference || null,
        signature_header_value: input.signatureHeader,
        timestamp_header_value: input.timestampHeader || null,
        allowed_ip_cidrs_value: input.allowedIpCidrs,
        allowed_event_types_value: input.allowedEventTypes,
        event_id_path_value: input.eventIdPath || null,
        event_type_path_value: input.eventTypePath || null,
        challenge_field_value: input.challengeField || null,
        max_payload_bytes_value: input.maxPayloadBytes,
        reason_value: input.reason,
      });
      if (error) throw error;
      const result = asRecord(data);
      const credential = typeof result.verificationToken === 'string' && result.verificationToken
        ? { kind: 'webhook_token' as const, title: 'Webhook verification token', value: result.verificationToken, referenceId: String(result.endpointId) }
        : undefined;
      return { snapshot: await listSupabaseSnapshot(client), credential };
    }
    const snapshot = readDemoSnapshot();
    const connection = snapshot.connections.find((item) => item.id === input.integrationId);
    if (!connection) throw new Error('Подключение не найдено.');
    const id = createId('endpoint');
    snapshot.endpoints.unshift({
      id,
      integrationId: input.integrationId,
      connectionName: connection.displayName,
      providerName: connection.providerName,
      publicKey: `wh_${createId('public').replace(/-/g, '')}`,
      name: input.name,
      status: 'active',
      verificationMode: input.verificationMode,
      secretReference: input.secretReference,
      signatureHeader: input.signatureHeader,
      timestampHeader: input.timestampHeader,
      allowedIpCidrs: input.allowedIpCidrs,
      allowedEventTypes: input.allowedEventTypes,
      eventIdPath: input.eventIdPath,
      eventTypePath: input.eventTypePath,
      challengeField: input.challengeField,
      maxPayloadBytes: input.maxPayloadBytes,
      lastReceivedAt: null,
      createdAt: new Date().toISOString(),
    });
    writeDemoSnapshot(snapshot);
    const requiresToken = ['bearer_token', 'query_token', 'meta_verify_token'].includes(input.verificationMode);
    return { snapshot, credential: requiresToken ? demoCredential('webhook_token', 'Webhook verification token', id) : undefined };
  },

  async rotateEndpointToken(endpointId: string, reason: string): Promise<IntegrationMutationResult> {
    const client = getIntegrationClient();
    if (client) {
      const { data, error } = await client.rpc('rotate_inbound_webhook_token', { endpoint_id_value: endpointId, reason_value: reason });
      if (error) throw error;
      return {
        snapshot: await listSupabaseSnapshot(client),
        credential: { kind: 'webhook_token', title: 'Rotated webhook token', value: String(data), referenceId: endpointId },
      };
    }
    return { snapshot: readDemoSnapshot(), credential: demoCredential('webhook_token', 'Rotated webhook token', endpointId) };
  },

  async setEndpointStatus(endpointId: string, status: InboundWebhookEndpoint['status'], reason: string): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('set_inbound_webhook_endpoint_status', { endpoint_id_value: endpointId, status_value: status, reason_value: reason });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    snapshot.endpoints = snapshot.endpoints.map((item) => item.id === endpointId ? { ...item, status } : item);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async createOutboundSubscription(input: OutboundSubscriptionInput): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('create_outbound_webhook_subscription', {
        organization_id_value: input.organizationId,
        product_id_value: input.productId,
        name_value: input.name,
        target_url_value: input.targetUrl,
        event_types_value: input.eventTypes,
        secret_reference_value: input.secretReference || null,
        timeout_ms_value: input.timeoutMs,
        max_attempts_value: input.maxAttempts,
        headers_value: input.headers,
        reason_value: input.reason,
      });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    snapshot.outboundSubscriptions.unshift({
      id: createId('outbound'),
      organizationId: input.organizationId,
      organizationName: organizationName(input.organizationId, snapshot.organizations),
      productId: input.productId,
      productName: productName(input.productId, snapshot.products),
      name: input.name,
      targetUrl: input.targetUrl,
      eventTypes: input.eventTypes,
      secretReference: input.secretReference,
      status: 'active',
      timeoutMs: input.timeoutMs,
      maxAttempts: input.maxAttempts,
      headers: input.headers,
      createdAt: new Date().toISOString(),
    });
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async setOutboundStatus(subscriptionId: string, status: OutboundWebhookSubscriptionStatus, reason: string): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('set_outbound_webhook_subscription_status', { subscription_id_value: subscriptionId, status_value: status, reason_value: reason });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    snapshot.outboundSubscriptions = snapshot.outboundSubscriptions.map((item) => item.id === subscriptionId ? { ...item, status } : item);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async retryDelivery(deliveryId: string, reason: string): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('retry_outbound_webhook_delivery', { delivery_id_value: deliveryId, reason_value: reason });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    snapshot.deliveries = snapshot.deliveries.map((item) => item.id === deliveryId
      ? { ...item, status: 'queued', lastError: '', responseStatus: null, updatedAt: new Date().toISOString() }
      : item);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async createApiClient(input: ApiClientInput): Promise<IntegrationMutationResult> {
    const client = getIntegrationClient();
    if (client) {
      const { data, error } = await client.rpc('create_api_client', {
        organization_id_value: input.organizationId,
        name_value: input.name,
        scopes_value: input.scopes,
        allowed_ip_cidrs_value: input.allowedIpCidrs,
        rate_limit_per_minute_value: input.rateLimitPerMinute,
        expires_at_value: input.expiresAt,
        reason_value: input.reason,
      });
      if (error) throw error;
      const result = asRecord(data);
      return {
        snapshot: await listSupabaseSnapshot(client),
        credential: {
          kind: 'api_key',
          title: 'API key',
          value: String(result.apiKey),
          referenceId: String(result.clientId),
        },
      };
    }
    const snapshot = readDemoSnapshot();
    const id = createId('api-client');
    const credential = demoCredential('api_key', 'API key', id);
    snapshot.apiClients.unshift({
      id,
      organizationId: input.organizationId,
      organizationName: organizationName(input.organizationId, snapshot.organizations),
      name: input.name,
      keyPrefix: credential.value.slice(0, 18),
      status: 'active',
      scopes: input.scopes,
      allowedIpCidrs: input.allowedIpCidrs,
      rateLimitPerMinute: input.rateLimitPerMinute,
      expiresAt: input.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    });
    writeDemoSnapshot(snapshot);
    return { snapshot, credential };
  },

  async revokeApiClient(clientId: string, reason: string): Promise<IntegrationSnapshot> {
    const client = getIntegrationClient();
    if (client) {
      const { error } = await client.rpc('revoke_api_client', { api_client_id_value: clientId, reason_value: reason });
      if (error) throw error;
      return listSupabaseSnapshot(client);
    }
    const snapshot = readDemoSnapshot();
    snapshot.apiClients = snapshot.apiClients.map((item) => item.id === clientId
      ? { ...item, status: 'revoked', revokedAt: new Date().toISOString() }
      : item);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },
};

export function canRoleManageProviders(role: GlobalRole | null) {
  return role === 'platform_owner' || role === 'super_admin' || role === 'technical_admin';
}
