export type TelemetryOutcome = 'neutral' | 'success' | 'failure';
export type PresenceStatus = 'active' | 'idle' | 'offline' | 'closed';

export type TelemetryIdentity = {
  userKey?: string | null;
  userLabel?: string | null;
  userRole?: string | null;
  organizationId?: string | null;
  organizationKey?: string | null;
  branchId?: string | null;
  branchKey?: string | null;
};

export type TelemetryContext = {
  route?: string | null;
  moduleKey?: string | null;
  moduleName?: string | null;
  moduleOwnerProductKey?: string | null;
};

export type TelemetryEventInput = TelemetryContext & {
  eventName: string;
  featureKey?: string | null;
  outcome?: TelemetryOutcome;
  durationMs?: number | null;
  properties?: Record<string, unknown>;
};

export type TelemetryWebConfig = {
  endpoint: string;
  sourceKey: string;
  writeKey: string;
  productKey: string;
  appVersion?: string;
  sdkVersion?: string;
  heartbeatIntervalMs?: number;
  idleTimeoutMs?: number;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxQueueSize?: number;
  storageKey?: string;
  sessionStorageKey?: string;
  debug?: boolean;
  identity?: TelemetryIdentity;
  context?: TelemetryContext;
  sessionMetadata?: Record<string, unknown>;
};

type QueuedEvent = {
  eventId: string;
  sessionId: string;
  eventName: string;
  occurredAt: string;
  sessionStartedAt: string;
  lastActivityAt: string;
  presenceStatus: PresenceStatus;
  activeSecondsDelta: number;
  idleSecondsDelta: number;
  tabVisible: boolean;
  route?: string | null;
  moduleKey?: string | null;
  moduleName?: string | null;
  moduleOwnerProductKey?: string | null;
  featureKey?: string | null;
  outcome: TelemetryOutcome;
  durationMs?: number | null;
  properties: Record<string, unknown>;
  userKey?: string | null;
  userLabel?: string | null;
  userRole?: string | null;
  organizationId?: string | null;
  organizationKey?: string | null;
  branchId?: string | null;
  branchKey?: string | null;
  appVersion?: string;
  sdkVersion: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browser: string;
  operatingSystem: string;
  timezone: string;
  sessionMetadata: Record<string, unknown>;
};

const SDK_VERSION = '0.1.0';
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_IDLE_MS = 120_000;
const DEFAULT_FLUSH_MS = 10_000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_QUEUE_SIZE = 500;
const BLOCKED_KEYS = /password|passcode|secret|token|authorization|cookie|patient|diagnos|symptom|medical|treatment|anamnes|phone|email|address|iin|card|bank|comment|note|message|query/i;

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeRoute(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.pathname.slice(0, 500);
  } catch {
    return value.split(/[?#]/, 1)[0].slice(0, 500);
  }
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      if (BLOCKED_KEYS.test(key)) continue;
      const sanitized = sanitizeValue(item, depth + 1);
      if (sanitized !== undefined) result[key.slice(0, 80)] = sanitized;
    }
    return result;
  }
  return undefined;
}

function sanitizeProperties(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return (sanitizeValue(value ?? {}) as Record<string, unknown>) ?? {};
}

function safeLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim().slice(0, 160) || null;
  if (!normalized || normalized.includes('@') || /\d{7,}/.test(normalized)) return null;
  return normalized;
}

function detectRuntime(): Pick<QueuedEvent, 'deviceType' | 'browser' | 'operatingSystem' | 'timezone'> {
  const userAgent = navigator.userAgent;
  const deviceType = /ipad|tablet/i.test(userAgent)
    ? 'tablet'
    : /android|iphone|mobile/i.test(userAgent)
      ? 'mobile'
      : 'desktop';
  const browser = /edg/i.test(userAgent)
    ? 'Edge'
    : /firefox/i.test(userAgent)
      ? 'Firefox'
      : /safari/i.test(userAgent) && !/chrome|chromium/i.test(userAgent)
        ? 'Safari'
        : /chrome|chromium/i.test(userAgent)
          ? 'Chrome'
          : 'Other';
  const operatingSystem = /windows/i.test(userAgent)
    ? 'Windows'
    : /mac os|macintosh/i.test(userAgent)
      ? 'macOS'
      : /android/i.test(userAgent)
        ? 'Android'
        : /iphone|ipad|ios/i.test(userAgent)
          ? 'iOS'
          : /linux/i.test(userAgent)
            ? 'Linux'
            : 'Other';
  return {
    deviceType,
    browser,
    operatingSystem,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

export class ImdsTelemetryWeb {
  private readonly config: Required<Pick<TelemetryWebConfig,
    'heartbeatIntervalMs' | 'idleTimeoutMs' | 'flushIntervalMs' | 'maxBatchSize' | 'maxQueueSize' | 'storageKey' | 'sessionStorageKey' | 'debug'
  >> & TelemetryWebConfig;
  private identity: TelemetryIdentity;
  private context: TelemetryContext;
  private queue: QueuedEvent[] = [];
  private sessionId = '';
  private sessionStartedAt = '';
  private lastActivityAt = Date.now();
  private lastHeartbeatAt = Date.now();
  private heartbeatTimer: number | null = null;
  private flushTimer: number | null = null;
  private flushing = false;
  private started = false;
  private retryAfterAt = 0;
  private readonly runtime = detectRuntime();

  constructor(config: TelemetryWebConfig) {
    if (typeof window === 'undefined') throw new Error('@imds/telemetry-web requires a browser runtime.');
    if (!config.endpoint || !config.sourceKey || !config.writeKey || !config.productKey) {
      throw new Error('endpoint, sourceKey, writeKey and productKey are required.');
    }
    this.config = {
      ...config,
      endpoint: normalizeEndpoint(config.endpoint),
      sdkVersion: config.sdkVersion ?? SDK_VERSION,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS,
      idleTimeoutMs: config.idleTimeoutMs ?? DEFAULT_IDLE_MS,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_MS,
      maxBatchSize: config.maxBatchSize ?? DEFAULT_BATCH_SIZE,
      maxQueueSize: config.maxQueueSize ?? DEFAULT_QUEUE_SIZE,
      storageKey: config.storageKey ?? `imds:telemetry:queue:${config.sourceKey}`,
      sessionStorageKey: config.sessionStorageKey ?? `imds:telemetry:session:${config.sourceKey}`,
      debug: config.debug ?? false,
    };
    this.identity = { ...config.identity };
    this.context = { route: normalizeRoute(window.location.href), ...config.context };
  }

  start(): this {
    if (this.started) return this;
    this.started = true;
    this.restoreQueue();
    this.openSession();
    this.bindActivityListeners();
    this.trackInternal('session_started', 'neutral', {}, 'active', 0, 0);
    this.heartbeatTimer = window.setInterval(() => this.heartbeat(), this.config.heartbeatIntervalMs);
    this.flushTimer = window.setInterval(() => void this.flush(), this.config.flushIntervalMs);
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('pagehide', this.handlePageHide);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    void this.flush();
    return this;
  }

  identify(identity: TelemetryIdentity): void {
    this.identity = { ...this.identity, ...identity, userLabel: safeLabel(identity.userLabel ?? this.identity.userLabel) };
  }

  setContext(context: TelemetryContext): void {
    this.context = {
      ...this.context,
      ...context,
      route: normalizeRoute(context.route ?? this.context.route),
    };
  }

  page(route: string, properties: Record<string, unknown> = {}): void {
    this.setContext({ route });
    this.track({ eventName: 'page_viewed', properties });
  }

  module(moduleKey: string, moduleName: string, moduleOwnerProductKey?: string | null): void {
    this.setContext({ moduleKey, moduleName, moduleOwnerProductKey });
    this.track({ eventName: 'module_opened' });
  }

  feature(featureKey: string, options: Omit<TelemetryEventInput, 'eventName' | 'featureKey'> = {}): void {
    this.track({ ...options, eventName: 'feature_used', featureKey });
  }

  track(input: TelemetryEventInput): void {
    if (!this.started) this.start();
    const status = this.currentPresence();
    this.enqueue({
      eventName: input.eventName,
      outcome: input.outcome ?? 'neutral',
      durationMs: input.durationMs ?? null,
      properties: sanitizeProperties(input.properties),
      route: normalizeRoute(input.route ?? this.context.route),
      moduleKey: input.moduleKey ?? this.context.moduleKey,
      moduleName: input.moduleName ?? this.context.moduleName,
      moduleOwnerProductKey: input.moduleOwnerProductKey ?? this.context.moduleOwnerProductKey,
      featureKey: input.featureKey ?? null,
      presenceStatus: status,
      activeSecondsDelta: 0,
      idleSecondsDelta: 0,
    });
  }

  async flush(keepalive = false): Promise<void> {
    if (!this.started || this.flushing || !this.queue.length || Date.now() < this.retryAfterAt || !navigator.onLine) return;
    this.flushing = true;
    const batch = this.queue.slice(0, this.config.maxBatchSize);
    const requestId = createUuid();
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-imds-source-key': this.config.sourceKey,
          'x-imds-write-key': this.config.writeKey,
          'x-imds-request-id': requestId,
          'x-imds-sdk-version': this.config.sdkVersion ?? SDK_VERSION,
        },
        body: JSON.stringify({ requestId, events: batch }),
        keepalive,
        credentials: 'omit',
      });
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0');
        this.retryAfterAt = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 15_000);
        this.log('flush failed', response.status);
        return;
      }
      this.queue.splice(0, batch.length);
      this.persistQueue();
      this.retryAfterAt = 0;
      if (this.queue.length) window.queueMicrotask(() => void this.flush(keepalive));
    } catch (error) {
      this.retryAfterAt = Date.now() + 15_000;
      this.log('flush error', error);
    } finally {
      this.flushing = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.heartbeat('closed');
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    if (this.flushTimer !== null) window.clearInterval(this.flushTimer);
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('pagehide', this.handlePageHide);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.unbindActivityListeners();
    await this.flush(true);
    this.started = false;
    sessionStorage.removeItem(this.config.sessionStorageKey);
  }

  private openSession(): void {
    const stored = sessionStorage.getItem(this.config.sessionStorageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { id?: string; startedAt?: string };
        if (parsed.id && parsed.startedAt) {
          this.sessionId = parsed.id;
          this.sessionStartedAt = parsed.startedAt;
          return;
        }
      } catch {
        sessionStorage.removeItem(this.config.sessionStorageKey);
      }
    }
    this.sessionId = createUuid();
    this.sessionStartedAt = new Date().toISOString();
    sessionStorage.setItem(this.config.sessionStorageKey, JSON.stringify({ id: this.sessionId, startedAt: this.sessionStartedAt }));
  }

  private currentPresence(): PresenceStatus {
    if (document.visibilityState !== 'visible') return 'idle';
    return Date.now() - this.lastActivityAt <= this.config.idleTimeoutMs ? 'active' : 'idle';
  }

  private heartbeat(forcedStatus?: PresenceStatus): void {
    if (!this.started) return;
    const now = Date.now();
    const elapsedSeconds = Math.min(300, Math.max(0, Math.round((now - this.lastHeartbeatAt) / 1000)));
    const status = forcedStatus ?? this.currentPresence();
    const activeSeconds = status === 'active' ? elapsedSeconds : 0;
    const idleSeconds = status === 'idle' || status === 'offline' ? Math.min(1800, elapsedSeconds) : 0;
    this.lastHeartbeatAt = now;
    this.trackInternal(
      forcedStatus === 'closed' ? 'session_ended' : 'session_heartbeat',
      'neutral',
      {},
      status,
      activeSeconds,
      idleSeconds,
    );
    void this.flush(forcedStatus === 'closed');
  }

  private trackInternal(
    eventName: string,
    outcome: TelemetryOutcome,
    properties: Record<string, unknown>,
    presenceStatus: PresenceStatus,
    activeSecondsDelta: number,
    idleSecondsDelta: number,
  ): void {
    this.enqueue({
      eventName,
      outcome,
      properties,
      presenceStatus,
      activeSecondsDelta,
      idleSecondsDelta,
      route: normalizeRoute(this.context.route),
      moduleKey: this.context.moduleKey,
      moduleName: this.context.moduleName,
      moduleOwnerProductKey: this.context.moduleOwnerProductKey,
      featureKey: null,
      durationMs: null,
    });
  }

  private enqueue(input: Omit<QueuedEvent,
    'eventId' | 'sessionId' | 'occurredAt' | 'sessionStartedAt' | 'lastActivityAt' |
    'tabVisible' | 'userKey' | 'userLabel' | 'userRole' | 'organizationId' |
    'organizationKey' | 'branchId' | 'branchKey' | 'appVersion' | 'sdkVersion' |
    'deviceType' | 'browser' | 'operatingSystem' | 'timezone' | 'sessionMetadata'
  >): void {
    const event: QueuedEvent = {
      ...input,
      eventId: createUuid(),
      sessionId: this.sessionId,
      occurredAt: new Date().toISOString(),
      sessionStartedAt: this.sessionStartedAt,
      lastActivityAt: new Date(this.lastActivityAt).toISOString(),
      tabVisible: document.visibilityState === 'visible',
      userKey: this.identity.userKey ?? null,
      userLabel: safeLabel(this.identity.userLabel),
      userRole: this.identity.userRole ?? null,
      organizationId: this.identity.organizationId ?? null,
      organizationKey: this.identity.organizationKey ?? null,
      branchId: this.identity.branchId ?? null,
      branchKey: this.identity.branchKey ?? null,
      appVersion: this.config.appVersion,
      sdkVersion: this.config.sdkVersion ?? SDK_VERSION,
      ...this.runtime,
      sessionMetadata: sanitizeProperties(this.config.sessionMetadata),
    };
    this.queue.push(event);
    if (this.queue.length > this.config.maxQueueSize) this.queue.splice(0, this.queue.length - this.config.maxQueueSize);
    this.persistQueue();
    if (this.queue.length >= this.config.maxBatchSize) void this.flush();
  }

  private restoreQueue(): void {
    try {
      const value = localStorage.getItem(this.config.storageKey);
      if (!value) return;
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) this.queue = parsed.slice(-this.config.maxQueueSize) as QueuedEvent[];
    } catch {
      localStorage.removeItem(this.config.storageKey);
    }
  }

  private persistQueue(): void {
    try {
      localStorage.setItem(this.config.storageKey, JSON.stringify(this.queue));
    } catch {
      this.log('queue persistence unavailable');
    }
  }

  private markActivity = (): void => {
    this.lastActivityAt = Date.now();
  };

  private handleOnline = (): void => {
    this.retryAfterAt = 0;
    void this.flush();
  };

  private handlePageHide = (): void => {
    this.heartbeat('offline');
    void this.flush(true);
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') this.markActivity();
    this.heartbeat();
  };

  private bindActivityListeners(): void {
    const options: AddEventListenerOptions = { passive: true };
    window.addEventListener('pointerdown', this.markActivity, options);
    window.addEventListener('keydown', this.markActivity);
    window.addEventListener('scroll', this.markActivity, options);
    window.addEventListener('touchstart', this.markActivity, options);
  }

  private unbindActivityListeners(): void {
    window.removeEventListener('pointerdown', this.markActivity);
    window.removeEventListener('keydown', this.markActivity);
    window.removeEventListener('scroll', this.markActivity);
    window.removeEventListener('touchstart', this.markActivity);
  }

  private log(...values: unknown[]): void {
    if (this.config.debug) console.debug('[IMDS telemetry]', ...values);
  }
}

export function createImdsTelemetry(config: TelemetryWebConfig): ImdsTelemetryWeb {
  return new ImdsTelemetryWeb(config);
}
