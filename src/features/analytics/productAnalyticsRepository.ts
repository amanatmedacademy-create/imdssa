import { getSupabase } from '../../lib/supabase';

export type AnalyticsMetrics = {
  onlineNow: number;
  activeNow: number;
  dau: number;
  uniqueUsers: number;
  sessions: number;
  activeSeconds: number;
  events: number;
  errors: number;
  errorFreePercent: number;
};

export type AnalyticsProduct = {
  id: string;
  key: string;
  name: string;
  onlineNow: number;
  activeNow: number;
  dau: number;
  sessions: number;
  uniqueUsers: number;
  activeSeconds: number;
  eventCount: number;
  errorCount: number;
  lastEventAt: string | null;
};

export type AnalyticsLiveSession = {
  id: string;
  userKey: string | null;
  userLabel: string;
  userRole: string | null;
  organizationId: string | null;
  organizationName: string;
  branchName: string;
  productId: string;
  productName: string;
  moduleOwnerProductName: string | null;
  moduleKey: string | null;
  moduleName: string | null;
  route: string | null;
  status: 'active' | 'idle';
  startedAt: string;
  lastSeenAt: string;
  activeSeconds: number;
  idleSeconds: number;
  appVersion: string | null;
  deviceType: string | null;
};

export type AnalyticsFeature = {
  productId: string;
  productName: string;
  moduleOwnerProductId: string | null;
  moduleOwnerProductName: string | null;
  moduleKey: string;
  moduleName: string;
  featureKey: string;
  eventCount: number;
  uniqueUsers: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  lastUsedAt: string | null;
};

export type AnalyticsTenant = {
  organizationId: string | null;
  organizationName: string;
  uniqueUsers: number;
  sessions: number;
  activeSeconds: number;
  eventCount: number;
  errorCount: number;
  lastSeenAt: string | null;
  risk: 'low' | 'medium' | 'high';
};

export type AnalyticsSource = {
  id: string;
  productId: string;
  productName: string;
  sourceKey: string;
  name: string;
  sourceType: 'browser' | 'server';
  environment: string;
  allowedOrigins: string[];
  status: 'draft' | 'active' | 'disabled' | 'compromised';
  sampleRate: number;
  heartbeatIntervalSeconds: number;
  idleTimeoutSeconds: number;
  sessionTimeoutSeconds: number;
  retentionDays: number;
  lastEventAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type AnalyticsSeriesPoint = {
  date: string;
  users: number;
  sessions: number;
  events: number;
  errors: number;
  activeSeconds: number;
};

export type AnalyticsCatalogProduct = { id: string; key: string; name: string };

export type ProductAnalyticsSnapshot = {
  generatedAt: string;
  periodDays: number;
  targetProductId: string | null;
  metrics: AnalyticsMetrics;
  products: AnalyticsProduct[];
  liveSessions: AnalyticsLiveSession[];
  features: AnalyticsFeature[];
  tenants: AnalyticsTenant[];
  sources: AnalyticsSource[];
  series: AnalyticsSeriesPoint[];
  catalog: AnalyticsCatalogProduct[];
};

export type TelemetrySourceInput = {
  productId: string;
  productKey: string;
  productName: string;
  sourceKey: string;
  name: string;
  sourceType: 'browser' | 'server';
  environment: 'development' | 'staging' | 'production' | 'demo';
  allowedOrigins: string[];
  sampleRate: number;
  retentionDays: number;
};

export type CreatedTelemetryCredential = {
  sourceId: string;
  sourceKey: string;
  writeKey: string;
  productName: string;
  sourceType: 'browser' | 'server';
};

const DEMO_SOURCE_KEY = 'imds-super-admin:analytics-sources:v1';

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createWriteKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const encoded = Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
  return `imds_tw_${encoded}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSnapshot(value: unknown): ProductAnalyticsSnapshot {
  const input = value && typeof value === 'object' ? value as Partial<ProductAnalyticsSnapshot> : {};
  const metrics = input.metrics ?? {} as AnalyticsMetrics;
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    periodDays: numberValue(input.periodDays, 30),
    targetProductId: input.targetProductId ?? null,
    metrics: {
      onlineNow: numberValue(metrics.onlineNow),
      activeNow: numberValue(metrics.activeNow),
      dau: numberValue(metrics.dau),
      uniqueUsers: numberValue(metrics.uniqueUsers),
      sessions: numberValue(metrics.sessions),
      activeSeconds: numberValue(metrics.activeSeconds),
      events: numberValue(metrics.events),
      errors: numberValue(metrics.errors),
      errorFreePercent: numberValue(metrics.errorFreePercent, 100),
    },
    products: Array.isArray(input.products) ? input.products.map((item) => ({
      ...item,
      onlineNow: numberValue(item.onlineNow),
      activeNow: numberValue(item.activeNow),
      dau: numberValue(item.dau),
      sessions: numberValue(item.sessions),
      uniqueUsers: numberValue(item.uniqueUsers),
      activeSeconds: numberValue(item.activeSeconds),
      eventCount: numberValue(item.eventCount),
      errorCount: numberValue(item.errorCount),
    })) : [],
    liveSessions: Array.isArray(input.liveSessions) ? input.liveSessions.map((item) => ({
      ...item,
      activeSeconds: numberValue(item.activeSeconds),
      idleSeconds: numberValue(item.idleSeconds),
    })) : [],
    features: Array.isArray(input.features) ? input.features.map((item) => ({
      ...item,
      eventCount: numberValue(item.eventCount),
      uniqueUsers: numberValue(item.uniqueUsers),
      successCount: numberValue(item.successCount),
      failureCount: numberValue(item.failureCount),
      successRate: numberValue(item.successRate, 100),
    })) : [],
    tenants: Array.isArray(input.tenants) ? input.tenants.map((item) => ({
      ...item,
      uniqueUsers: numberValue(item.uniqueUsers),
      sessions: numberValue(item.sessions),
      activeSeconds: numberValue(item.activeSeconds),
      eventCount: numberValue(item.eventCount),
      errorCount: numberValue(item.errorCount),
    })) : [],
    sources: Array.isArray(input.sources) ? input.sources.map((item) => ({
      ...item,
      allowedOrigins: Array.isArray(item.allowedOrigins) ? item.allowedOrigins : [],
      sampleRate: numberValue(item.sampleRate, 1),
      heartbeatIntervalSeconds: numberValue(item.heartbeatIntervalSeconds, 30),
      idleTimeoutSeconds: numberValue(item.idleTimeoutSeconds, 120),
      sessionTimeoutSeconds: numberValue(item.sessionTimeoutSeconds, 1800),
      retentionDays: numberValue(item.retentionDays, 90),
    })) : [],
    series: Array.isArray(input.series) ? input.series.map((item) => ({
      ...item,
      users: numberValue(item.users),
      sessions: numberValue(item.sessions),
      events: numberValue(item.events),
      errors: numberValue(item.errors),
      activeSeconds: numberValue(item.activeSeconds),
    })) : [],
    catalog: Array.isArray(input.catalog) ? input.catalog : [],
  };
}

function readDemoSources(): AnalyticsSource[] {
  try {
    const raw = window.localStorage.getItem(DEMO_SOURCE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AnalyticsSource[] : [];
  } catch {
    return [];
  }
}

function writeDemoSources(sources: AnalyticsSource[]): void {
  window.localStorage.setItem(DEMO_SOURCE_KEY, JSON.stringify(sources));
}

function isoDaysAgo(days: number, hours = 0): string {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();
}

function demoSnapshot(periodDays: number, productId: string | null): ProductAnalyticsSnapshot {
  const catalog: AnalyticsCatalogProduct[] = [
    { id: 'mis', key: 'imds-mis', name: 'IMDS MIS' },
    { id: 'crm', key: 'imds-crm', name: 'IMDS CRM' },
    { id: 'marketing', key: 'imds-marketing', name: 'IMDS Marketing' },
    { id: 'finance', key: 'imds-finance', name: 'IMDS Finance' },
    { id: 'contract', key: 'imds-contract', name: 'IMDS Contract' },
    { id: 'dashboard', key: 'imds-dashboard', name: 'IMDS Dashboard' },
  ];
  const allProducts: AnalyticsProduct[] = [
    { id: 'mis', key: 'imds-mis', name: 'IMDS MIS', onlineNow: 84, activeNow: 61, dau: 619, sessions: 2884, uniqueUsers: 812, activeSeconds: 1_940_400, eventCount: 142_842, errorCount: 443, lastEventAt: new Date().toISOString() },
    { id: 'crm', key: 'imds-crm', name: 'IMDS CRM', onlineNow: 37, activeNow: 28, dau: 284, sessions: 1221, uniqueUsers: 391, activeSeconds: 733_800, eventCount: 62_470, errorCount: 452, lastEventAt: new Date().toISOString() },
    { id: 'marketing', key: 'imds-marketing', name: 'IMDS Marketing', onlineNow: 26, activeNow: 17, dau: 191, sessions: 904, uniqueUsers: 248, activeSeconds: 486_900, eventCount: 47_221, errorCount: 1134, lastEventAt: new Date().toISOString() },
    { id: 'finance', key: 'imds-finance', name: 'IMDS Finance', onlineNow: 11, activeNow: 9, dau: 73, sessions: 341, uniqueUsers: 98, activeSeconds: 188_100, eventCount: 16_023, errorCount: 13, lastEventAt: new Date().toISOString() },
    { id: 'contract', key: 'imds-contract', name: 'IMDS Contract', onlineNow: 4, activeNow: 3, dau: 42, sessions: 187, uniqueUsers: 59, activeSeconds: 91_200, eventCount: 8_944, errorCount: 67, lastEventAt: isoDaysAgo(0, 1) },
    { id: 'dashboard', key: 'imds-dashboard', name: 'IMDS Dashboard', onlineNow: 15, activeNow: 12, dau: 108, sessions: 512, uniqueUsers: 142, activeSeconds: 257_400, eventCount: 21_814, errorCount: 26, lastEventAt: new Date().toISOString() },
  ];
  const products = productId ? allProducts.filter((item) => item.id === productId) : allProducts;
  const liveSessions: AnalyticsLiveSession[] = [
    { id: 'session-1', userKey: 'user-alia', userLabel: 'Алия С.', userRole: 'manager', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', branchName: 'Центральный филиал', productId: 'marketing', productName: 'IMDS Marketing', moduleOwnerProductName: 'IMDS CRM', moduleKey: 'crm_kanban', moduleName: 'CRM Kanban', route: '/crm/kanban', status: 'active', startedAt: isoDaysAgo(0, 1), lastSeenAt: new Date().toISOString(), activeSeconds: 2040, idleSeconds: 180, appVersion: '2.8.1', deviceType: 'desktop' },
    { id: 'session-2', userKey: 'user-arman', userLabel: 'Арман К.', userRole: 'doctor', organizationId: 'org-orda', organizationName: 'Orda Clinic', branchName: 'Главная клиника', productId: 'mis', productName: 'IMDS MIS', moduleOwnerProductName: null, moduleKey: 'patient_card', moduleName: 'Карта пациента', route: '/patients/current', status: 'active', startedAt: isoDaysAgo(0, 0.5), lastSeenAt: new Date().toISOString(), activeSeconds: 960, idleSeconds: 30, appVersion: '4.2.0', deviceType: 'desktop' },
    { id: 'session-3', userKey: 'user-dinara', userLabel: 'Динара Т.', userRole: 'administrator', organizationId: 'org-sapa', organizationName: 'Sapa Med', branchName: 'Все филиалы', productId: 'crm', productName: 'IMDS CRM', moduleOwnerProductName: null, moduleKey: 'deals', moduleName: 'Сделки', route: '/deals', status: 'idle', startedAt: isoDaysAgo(0, 2), lastSeenAt: new Date().toISOString(), activeSeconds: 2460, idleSeconds: 720, appVersion: '3.1.4', deviceType: 'desktop' },
  ].filter((item) => !productId || item.productId === productId);
  const features: AnalyticsFeature[] = [
    { productId: 'marketing', productName: 'IMDS Marketing', moduleOwnerProductId: 'crm', moduleOwnerProductName: 'IMDS CRM', moduleKey: 'crm_kanban', moduleName: 'CRM Kanban', featureKey: 'deal_moved', eventCount: 12842, uniqueUsers: 172, successCount: 12621, failureCount: 221, successRate: 98.28, lastUsedAt: new Date().toISOString() },
    { productId: 'mis', productName: 'IMDS MIS', moduleOwnerProductId: null, moduleOwnerProductName: null, moduleKey: 'patient_card', moduleName: 'Карта пациента', featureKey: 'entity_updated', eventCount: 11811, uniqueUsers: 483, successCount: 11792, failureCount: 19, successRate: 99.84, lastUsedAt: new Date().toISOString() },
    { productId: 'dashboard', productName: 'IMDS Dashboard', moduleOwnerProductId: null, moduleOwnerProductName: null, moduleKey: 'reports', moduleName: 'Отчёты', featureKey: 'export_completed', eventCount: 4201, uniqueUsers: 98, successCount: 4074, failureCount: 127, successRate: 96.98, lastUsedAt: isoDaysAgo(0, 1) },
    { productId: 'finance', productName: 'IMDS Finance', moduleOwnerProductId: null, moduleOwnerProductName: null, moduleKey: 'cashflow', moduleName: 'ДДС', featureKey: 'entity_created', eventCount: 2889, uniqueUsers: 64, successCount: 2887, failureCount: 2, successRate: 99.93, lastUsedAt: new Date().toISOString() },
  ].filter((item) => !productId || item.productId === productId);
  const tenants: AnalyticsTenant[] = [
    { organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', uniqueUsers: 84, sessions: 1104, activeSeconds: 938_400, eventCount: 74_128, errorCount: 188, lastSeenAt: new Date().toISOString(), risk: 'low' },
    { organizationId: 'org-orda', organizationName: 'Orda Clinic', uniqueUsers: 31, sessions: 402, activeSeconds: 301_800, eventCount: 22_914, errorCount: 126, lastSeenAt: new Date().toISOString(), risk: 'low' },
    { organizationId: 'org-sapa', organizationName: 'Sapa Med', uniqueUsers: 22, sessions: 211, activeSeconds: 139_200, eventCount: 10_841, errorCount: 891, lastSeenAt: isoDaysAgo(1), risk: 'medium' },
    { organizationId: 'org-nova', organizationName: 'Nova Health', uniqueUsers: 5, sessions: 28, activeSeconds: 12_600, eventCount: 811, errorCount: 7, lastSeenAt: isoDaysAgo(10), risk: 'medium' },
  ];
  const series: AnalyticsSeriesPoint[] = Array.from({ length: Math.min(periodDays, 30) }, (_, index) => {
    const daysAgo = Math.min(periodDays, 30) - index - 1;
    const factor = 0.72 + ((index * 17) % 25) / 100;
    return {
      date: new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10),
      users: Math.round(740 * factor),
      sessions: Math.round(1360 * factor),
      events: Math.round(9100 * factor),
      errors: Math.round(68 * (1.1 - factor / 2)),
      activeSeconds: Math.round(82_000 * factor),
    };
  });
  const sources = [
    { id: 'source-mis-web', productId: 'mis', productName: 'IMDS MIS', sourceKey: 'imds-mis-web-production', name: 'MIS Web Production', sourceType: 'browser' as const, environment: 'production', allowedOrigins: ['https://mis.imdstech.net'], status: 'active' as const, sampleRate: 1, heartbeatIntervalSeconds: 30, idleTimeoutSeconds: 120, sessionTimeoutSeconds: 1800, retentionDays: 90, lastEventAt: new Date().toISOString(), lastError: null, createdAt: isoDaysAgo(20) },
    { id: 'source-marketing-web', productId: 'marketing', productName: 'IMDS Marketing', sourceKey: 'imds-marketing-web-production', name: 'Marketing Web Production', sourceType: 'browser' as const, environment: 'production', allowedOrigins: ['https://marketing.imdstech.net'], status: 'active' as const, sampleRate: 1, heartbeatIntervalSeconds: 30, idleTimeoutSeconds: 120, sessionTimeoutSeconds: 1800, retentionDays: 90, lastEventAt: new Date().toISOString(), lastError: null, createdAt: isoDaysAgo(18) },
    ...readDemoSources(),
  ].filter((item) => !productId || item.productId === productId);
  const metrics = products.reduce<AnalyticsMetrics>((result, item) => ({
    onlineNow: result.onlineNow + item.onlineNow,
    activeNow: result.activeNow + item.activeNow,
    dau: result.dau + item.dau,
    uniqueUsers: result.uniqueUsers + item.uniqueUsers,
    sessions: result.sessions + item.sessions,
    activeSeconds: result.activeSeconds + item.activeSeconds,
    events: result.events + item.eventCount,
    errors: result.errors + item.errorCount,
    errorFreePercent: 0,
  }), { onlineNow: 0, activeNow: 0, dau: 0, uniqueUsers: 0, sessions: 0, activeSeconds: 0, events: 0, errors: 0, errorFreePercent: 0 });
  metrics.errorFreePercent = metrics.events ? Math.max(0, 100 - metrics.errors / metrics.events * 100) : 100;
  return { generatedAt: new Date().toISOString(), periodDays, targetProductId: productId, metrics, products, liveSessions, features, tenants, sources, series, catalog };
}

async function listSupabase(periodDays: number, productId: string | null): Promise<ProductAnalyticsSnapshot> {
  const client = getSupabase() as any;
  if (!client) return demoSnapshot(periodDays, productId);
  const { data, error } = await client.rpc('get_product_analytics_snapshot', {
    period_days_value: periodDays,
    target_product_id: productId,
  });
  if (error) throw new Error(error.message);
  return normalizeSnapshot(data);
}

export const productAnalyticsRepository = {
  list: listSupabase,

  async createSource(input: TelemetrySourceInput, periodDays: number, productId: string | null): Promise<{ snapshot: ProductAnalyticsSnapshot; credential: CreatedTelemetryCredential }> {
    const writeKey = createWriteKey();
    const credential: CreatedTelemetryCredential = {
      sourceId: '',
      sourceKey: input.sourceKey,
      writeKey,
      productName: input.productName,
      sourceType: input.sourceType,
    };
    const client = getSupabase() as any;
    if (client) {
      const writeKeyHash = await sha256Hex(writeKey);
      const { data, error } = await client.rpc('configure_telemetry_source', {
        target_source_id: null,
        product_id_value: input.productId,
        source_key_value: input.sourceKey,
        source_name_value: input.name,
        source_type_value: input.sourceType,
        environment_value: input.environment,
        write_key_hash_value: writeKeyHash,
        allowed_origins_value: input.allowedOrigins,
        status_value: 'active',
        sample_rate_value: input.sampleRate,
        heartbeat_interval_seconds_value: 30,
        idle_timeout_seconds_value: 120,
        session_timeout_seconds_value: 1800,
        retention_days_value: input.retentionDays,
        config_value: { productKey: input.productKey },
      });
      if (error) throw new Error(error.message);
      credential.sourceId = String(data);
      return { snapshot: await listSupabase(periodDays, productId), credential };
    }

    credential.sourceId = createId();
    const sources = readDemoSources();
    sources.unshift({
      id: credential.sourceId,
      productId: input.productId,
      productName: input.productName,
      sourceKey: input.sourceKey,
      name: input.name,
      sourceType: input.sourceType,
      environment: input.environment,
      allowedOrigins: input.allowedOrigins,
      status: 'active',
      sampleRate: input.sampleRate,
      heartbeatIntervalSeconds: 30,
      idleTimeoutSeconds: 120,
      sessionTimeoutSeconds: 1800,
      retentionDays: input.retentionDays,
      lastEventAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    });
    writeDemoSources(sources);
    return { snapshot: demoSnapshot(periodDays, productId), credential };
  },
};
