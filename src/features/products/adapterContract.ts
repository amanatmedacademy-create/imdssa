export const productCapabilities = [
  'tenant.provision',
  'tenant.suspend',
  'tenant.resume',
  'tenant.revoke',
  'owner.invite',
  'entitlements.sync',
  'usage.read',
  'health.read',
  'webhooks.receive',
] as const;

export type ProductCapability = (typeof productCapabilities)[number];

export type AdapterCommandName =
  | 'provisionTenant'
  | 'suspendTenant'
  | 'resumeTenant'
  | 'revokeTenant'
  | 'inviteOwner'
  | 'syncEntitlements'
  | 'readUsage'
  | 'readHealth';

export type AdapterCommand<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  commandId: string;
  command: AdapterCommandName;
  contractVersion: string;
  productKey: string;
  organizationId: string;
  externalTenantId?: string | null;
  requestedAt: string;
  idempotencyKey: string;
  correlationId: string;
  payload: TPayload;
};

export type AdapterCommandResult<TData extends Record<string, unknown> = Record<string, unknown>> = {
  commandId: string;
  status: 'accepted' | 'completed' | 'failed';
  externalTenantId?: string | null;
  completedAt?: string | null;
  retryable?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  data?: TData;
};

export type AdapterHealth = {
  status: 'healthy' | 'degraded' | 'unavailable';
  version: string;
  contractVersion: string;
  checkedAt: string;
  latencyMs?: number;
  dependencies?: Record<string, 'healthy' | 'degraded' | 'unavailable'>;
};

export type UsageMetric = {
  key: string;
  quantity: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
};

export interface ProductAdapterContract {
  readonly productKey: string;
  readonly contractVersion: string;
  readonly capabilities: readonly ProductCapability[];
  execute(command: AdapterCommand): Promise<AdapterCommandResult>;
  health(): Promise<AdapterHealth>;
  usage(organizationId: string, periodStart: string, periodEnd: string): Promise<UsageMetric[]>;
}
