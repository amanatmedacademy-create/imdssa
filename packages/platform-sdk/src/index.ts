import type {
  ApiFailure,
  ApiSuccess,
  AuthorizeInput,
  AuthorizeResult,
  BootstrapResponse,
} from '../../platform-types/src/index';

export class PlatformApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}

export interface PlatformSdkOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string>;
  getTenantId: () => Promise<string> | string;
  fetchImpl?: typeof fetch;
}

export class PlatformSdk {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PlatformSdkOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const [token, tenantId] = await Promise.all([
      this.options.getAccessToken(),
      this.options.getTenantId(),
    ]);
    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-tenant-id': tenantId,
        ...init.headers,
      },
    });
    const body = await response.json() as ApiSuccess<T> | ApiFailure;
    if (!response.ok || 'error' in body) {
      const failure = body as ApiFailure;
      throw new PlatformApiError(
        failure.error?.code ?? 'PLATFORM_REQUEST_FAILED',
        failure.error?.message ?? 'Platform request failed',
        response.status,
        failure.error?.details,
      );
    }
    return (body as ApiSuccess<T>).data;
  }

  bootstrap(productCode: string): Promise<BootstrapResponse> {
    return this.request(`/v1/platform/bootstrap?product=${encodeURIComponent(productCode)}`);
  }

  authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    return this.request('/v1/platform/authorize', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  getModuleConfig<T = Record<string, unknown>>(installationId: string): Promise<T> {
    return this.request(`/v1/platform/module-config/${encodeURIComponent(installationId)}`);
  }

  publishEvent(event: { type: string; aggregateId?: string; payload: Record<string, unknown> }): Promise<{ accepted: true }> {
    return this.request('/v1/platform/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }
}
