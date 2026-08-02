import { randomUUID } from 'node:crypto';

export type ServerTelemetryIdentity = {
  userKey?: string | null;
  userLabel?: string | null;
  userRole?: string | null;
  organizationId?: string | null;
  organizationKey?: string | null;
  branchId?: string | null;
  branchKey?: string | null;
};

export type ServerTelemetryEvent = ServerTelemetryIdentity & {
  eventName: string;
  sessionId?: string | null;
  route?: string | null;
  moduleKey?: string | null;
  moduleName?: string | null;
  moduleOwnerProductKey?: string | null;
  featureKey?: string | null;
  outcome?: 'neutral' | 'success' | 'failure';
  durationMs?: number | null;
  properties?: Record<string, unknown>;
};

export type TelemetryNodeConfig = {
  endpoint: string;
  sourceKey: string;
  writeKey: string;
  productKey: string;
  appVersion?: string;
  sdkVersion?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxQueueSize?: number;
  timeoutMs?: number;
  debug?: boolean;
};

export type RequestLike = {
  method?: string;
  url?: string;
  originalUrl?: string;
  route?: { path?: string } | string;
  headers?: Record<string, string | string[] | undefined>;
};

export type ResponseLike = {
  statusCode: number;
  on(event: 'finish' | 'close', listener: () => void): unknown;
};

export type RequestTelemetryContext = ServerTelemetryIdentity & {
  sessionId?: string | null;
  moduleKey?: string | null;
  moduleName?: string | null;
  moduleOwnerProductKey?: string | null;
};

const SDK_VERSION = '0.1.0';
const BLOCKED_KEYS = /password|passcode|secret|token|authorization|cookie|patient|diagnos|symptom|medical|treatment|anamnes|phone|email|address|iin|card|bank|comment|note|message|query|body|payload|response/i;

function safeRoute(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://telemetry.invalid');
    return url.pathname.slice(0, 500);
  } catch {
    return value.split(/[?#]/, 1)[0].slice(0, 500);
  }
}

function safeLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim().slice(0, 160) || null;
  if (!normalized || normalized.includes('@') || /\d{7,}/.test(normalized)) return null;
  return normalized;
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
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      if (BLOCKED_KEYS.test(key)) continue;
      const sanitized = sanitizeValue(item, depth + 1);
      if (sanitized !== undefined) output[key.slice(0, 80)] = sanitized;
    }
    return output;
  }
  return undefined;
}

function sanitizeProperties(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return (sanitizeValue(value ?? {}) as Record<string, unknown>) ?? {};
}

function routeFromRequest(request: RequestLike): string | null {
  const routePath = typeof request.route === 'string' ? request.route : request.route?.path;
  return safeRoute(routePath ?? request.originalUrl ?? request.url);
}

export class ImdsTelemetryNode {
  private readonly config: Required<Pick<TelemetryNodeConfig,
    'sdkVersion' | 'flushIntervalMs' | 'maxBatchSize' | 'maxQueueSize' | 'timeoutMs' | 'debug'
  >> & TelemetryNodeConfig;
  private queue: Record<string, unknown>[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private retryAfterAt = 0;

  constructor(config: TelemetryNodeConfig) {
    if (!config.endpoint || !config.sourceKey || !config.writeKey || !config.productKey) {
      throw new Error('endpoint, sourceKey, writeKey and productKey are required.');
    }
    this.config = {
      ...config,
      endpoint: config.endpoint.replace(/\/+$/, ''),
      sdkVersion: config.sdkVersion ?? SDK_VERSION,
      flushIntervalMs: config.flushIntervalMs ?? 5_000,
      maxBatchSize: config.maxBatchSize ?? 50,
      maxQueueSize: config.maxQueueSize ?? 1_000,
      timeoutMs: config.timeoutMs ?? 8_000,
      debug: config.debug ?? false,
    };
  }

  start(): this {
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), this.config.flushIntervalMs);
      this.timer.unref?.();
    }
    return this;
  }

  track(event: ServerTelemetryEvent): void {
    const normalized = {
      eventId: randomUUID(),
      sessionId: event.sessionId ?? null,
      eventName: event.eventName,
      occurredAt: new Date().toISOString(),
      presenceStatus: 'offline',
      activeSecondsDelta: 0,
      idleSecondsDelta: 0,
      tabVisible: false,
      route: safeRoute(event.route),
      moduleKey: event.moduleKey ?? null,
      moduleName: event.moduleName ?? null,
      moduleOwnerProductKey: event.moduleOwnerProductKey ?? null,
      featureKey: event.featureKey ?? null,
      outcome: event.outcome ?? 'neutral',
      durationMs: event.durationMs ?? null,
      properties: sanitizeProperties(event.properties),
      userKey: event.userKey ?? null,
      userLabel: safeLabel(event.userLabel),
      userRole: event.userRole ?? null,
      organizationId: event.organizationId ?? null,
      organizationKey: event.organizationKey ?? null,
      branchId: event.branchId ?? null,
      branchKey: event.branchKey ?? null,
      appVersion: this.config.appVersion,
      sdkVersion: this.config.sdkVersion,
      deviceType: 'server',
      operatingSystem: process.platform,
      timezone: 'UTC',
      sessionMetadata: { deployment: process.env.NODE_ENV ?? 'unknown' },
    };
    this.queue.push(normalized);
    if (this.queue.length > this.config.maxQueueSize) this.queue.splice(0, this.queue.length - this.config.maxQueueSize);
    if (this.queue.length >= this.config.maxBatchSize) void this.flush();
  }

  createHttpMiddleware(resolveContext?: (request: RequestLike) => RequestTelemetryContext): (
    request: RequestLike,
    response: ResponseLike,
    next: () => void,
  ) => void {
    return (request, response, next) => {
      const startedAt = performance.now();
      let completed = false;
      const finish = () => {
        if (completed) return;
        completed = true;
        const context = resolveContext?.(request) ?? {};
        const statusCode = response.statusCode;
        const failed = statusCode >= 500;
        this.track({
          ...context,
          eventName: failed ? 'api_error' : 'api_request',
          route: routeFromRequest(request),
          outcome: failed ? 'failure' : 'success',
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          properties: {
            method: request.method?.toUpperCase() ?? 'UNKNOWN',
            statusCode,
            errorCode: failed ? `HTTP_${statusCode}` : undefined,
          },
          sessionId: context.sessionId ?? null,
        });
      };
      response.on('finish', finish);
      response.on('close', finish);
      next();
    };
  }

  async measure<T>(event: Omit<ServerTelemetryEvent, 'durationMs' | 'outcome'>, operation: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await operation();
      this.track({ ...event, outcome: 'success', durationMs: Math.round(performance.now() - startedAt) });
      return result;
    } catch (error) {
      this.track({
        ...event,
        eventName: event.eventName === 'api_request' ? 'api_error' : event.eventName,
        outcome: 'failure',
        durationMs: Math.round(performance.now() - startedAt),
        properties: {
          ...event.properties,
          errorCode: error instanceof Error ? error.name.slice(0, 80) : 'UNKNOWN_ERROR',
        },
      });
      throw error;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.queue.length || Date.now() < this.retryAfterAt) return;
    this.flushing = true;
    const batch = this.queue.slice(0, this.config.maxBatchSize);
    const requestId = randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    timeout.unref?.();

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-imds-source-key': this.config.sourceKey,
          'x-imds-write-key': this.config.writeKey,
          'x-imds-request-id': requestId,
          'x-imds-sdk-version': this.config.sdkVersion,
        },
        body: JSON.stringify({ requestId, events: batch }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0');
        this.retryAfterAt = Date.now() + (retryAfter > 0 ? retryAfter * 1_000 : 15_000);
        this.log('flush failed', response.status);
        return;
      }
      this.queue.splice(0, batch.length);
      this.retryAfterAt = 0;
      if (this.queue.length) queueMicrotask(() => void this.flush());
    } catch (error) {
      this.retryAfterAt = Date.now() + 15_000;
      this.log('flush error', error);
    } finally {
      clearTimeout(timeout);
      this.flushing = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  private log(...values: unknown[]): void {
    if (this.config.debug) console.debug('[IMDS telemetry node]', ...values);
  }
}

export function createImdsTelemetryNode(config: TelemetryNodeConfig): ImdsTelemetryNode {
  return new ImdsTelemetryNode(config);
}
