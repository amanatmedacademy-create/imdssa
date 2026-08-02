export type ModuleStatus = 'draft' | 'review' | 'approved' | 'published' | 'deprecated' | 'blocked' | 'retired';
export type ModuleVersionChannel = 'development' | 'beta' | 'canary' | 'stable' | 'deprecated';
export type ModuleVersionStatus = 'draft' | 'approved' | 'published' | 'blocked';
export type InstallationStatus = 'draft' | 'pending_payment' | 'validating' | 'provisioning' | 'active' | 'read_only' | 'suspended' | 'failed' | 'uninstalling' | 'archived';
export type InstallationHealthStatus = 'healthy' | 'degraded' | 'failed' | 'unknown';

export interface ModulePlacement {
  slot: string;
  group: string;
  label: string;
  icon: string;
  route: string;
  order: number;
}

export interface CreateInstallationInput {
  tenantId: string;
  moduleCode: string;
  hostProductCode: string;
  priceCode: string;
  versionChannel: 'stable' | 'canary' | 'beta';
  startsAt: string;
  endsAt: string | null;
  placement: ModulePlacement;
  config: Record<string, unknown>;
  limits: Record<string, number>;
  permissions: string[];
}

export interface InstallationPreview {
  compatible: boolean;
  selectedVersion: string | null;
  dependencies: string[];
  monthlyAmountMinor: number | null;
  currency: string | null;
  warnings: string[];
  errors: string[];
  provisioningPlan: string[];
}

export interface CreateInstallationResult {
  tenantId: string;
  installationId: string;
  subscriptionItemId: string;
  entitlementId: string;
  provisioningJobId: string;
  status: InstallationStatus;
}

export interface BootstrapModule {
  installationId: string;
  code: string;
  version: string;
  status: InstallationStatus;
  healthStatus: InstallationHealthStatus;
  placement: ModulePlacement;
  permissions: string[];
  limits: Record<string, number>;
  config: Record<string, unknown>;
}

export interface BootstrapResponse {
  tenant: { id: string; displayName: string };
  product: { code: string; shellVersion: string };
  modules: BootstrapModule[];
}

export interface AuthorizeInput {
  tenantId: string;
  hostProductCode: string;
  moduleCode: string;
  permission: string;
  resource?: { type: string; id: string };
}

export type AuthorizationReason = 'GRANTED' | 'TENANT_SUSPENDED' | 'MODULE_SUSPENDED' | 'MODULE_READ_ONLY' | 'LIMIT_EXCEEDED' | 'PERMISSION_DENIED' | 'INSTALLATION_NOT_FOUND';

export interface AuthorizeResult {
  allowed: boolean;
  installationId: string | null;
  reason: AuthorizationReason;
  effectiveLimits: Record<string, number>;
}

export interface ApiMeta {
  requestId: string;
  traceId: string;
  serverTime: string;
}

export interface ApiSuccess<T> { data: T; meta: ApiMeta }
export interface ApiFailure {
  error: { code: string; message: string; details?: unknown };
  meta: ApiMeta;
}
