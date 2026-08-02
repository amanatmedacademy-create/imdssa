export type DemoOrganizationStatus = 'active' | 'suspended';
export type ModuleReleaseChannel = 'stable' | 'beta' | 'canary';
export type InstallationStatus =
  | 'validating'
  | 'provisioning'
  | 'active'
  | 'read_only'
  | 'suspended'
  | 'failed'
  | 'archived';
export type InstallationHealth = 'unknown' | 'healthy' | 'degraded' | 'failed';
export type InstallationOperation = 'install' | 'repair' | 'suspend' | 'resume' | 'uninstall';

export type DemoOrganization = {
  id: string;
  name: string;
  city: string;
  status: DemoOrganizationStatus;
  products: string[];
};

export type ModuleVersion = {
  id: string;
  version: string;
  channel: ModuleReleaseChannel;
  status: 'published' | 'draft';
  releasedAt: string;
};

export type PlatformModuleDefinition = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  ownerProductCode: string;
  ownerProductName: string;
  compatibleHostProducts: Array<{ code: string; name: string }>;
  defaultRoute: string;
  placement: string;
  permissions: string[];
  versions: ModuleVersion[];
  price: {
    code: string;
    monthlyAmountMinor: number;
    currency: 'KZT';
  };
  limits: Record<string, number>;
  provisioningPlan: string[];
};

export type InstallationEvent = {
  id: string;
  operation: InstallationOperation | 'health_check';
  status: 'succeeded' | 'failed';
  message: string;
  occurredAt: string;
};

export type ModuleInstallation = {
  id: string;
  organizationId: string;
  moduleCode: string;
  moduleName: string;
  moduleVersion: string;
  hostProductCode: string;
  hostProductName: string;
  route: string;
  placement: string;
  status: InstallationStatus;
  healthStatus: InstallationHealth;
  permissions: string[];
  limits: Record<string, number>;
  config: Record<string, unknown>;
  revision: number;
  idempotencyKey: string;
  workspaceId: string | null;
  pipelineId: string | null;
  createdAt: string;
  updatedAt: string;
  lastOperation: InstallationOperation;
  events: InstallationEvent[];
};

export type CompatibilityPreview = {
  compatible: boolean;
  organizationId: string;
  moduleCode: string;
  hostProductCode: string;
  selectedVersion: string;
  route: string;
  monthlyAmountMinor: number;
  currency: string;
  warnings: string[];
  errors: string[];
  permissions: string[];
  limits: Record<string, number>;
  provisioningPlan: string[];
};

export type InstallModuleInput = {
  organizationId: string;
  moduleCode: string;
  hostProductCode: string;
  route: string;
  idempotencyKey: string;
};

export type PlatformBootstrap = {
  tenant: { id: string; displayName: string };
  product: { code: string; shellVersion: string };
  modules: Array<{
    installationId: string;
    code: string;
    name: string;
    version: string;
    route: string;
    placement: string;
    permissions: string[];
    limits: Record<string, number>;
    config: Record<string, unknown>;
    healthStatus: InstallationHealth;
  }>;
};

export type AuthorizationDecision = {
  allowed: boolean;
  decision:
    | 'GRANTED'
    | 'TENANT_SUSPENDED'
    | 'INSTALLATION_NOT_FOUND'
    | 'MODULE_SUSPENDED'
    | 'MODULE_READ_ONLY'
    | 'PERMISSION_DENIED';
  installationId: string | null;
  effectiveLimits: Record<string, number>;
};

type RuntimeState = {
  version: 1;
  organizations: DemoOrganization[];
  installations: ModuleInstallation[];
};

const STORAGE_KEY = 'imds-super-admin:local-platform-runtime:v1';
const SEEDED_AT = '2026-08-02T15:00:00.000Z';

export const platformModules: PlatformModuleDefinition[] = [
  {
    id: 'module-crm-kanban',
    code: 'crm.kanban',
    name: 'CRM Kanban',
    description: 'Воронки, этапы, сделки, задачи и контроль продаж внутри host-продукта.',
    category: 'CRM',
    ownerProductCode: 'imds-crm',
    ownerProductName: 'IMDS CRM',
    compatibleHostProducts: [{ code: 'imds-marketing', name: 'IMDS Marketing' }],
    defaultRoute: '/crm/kanban',
    placement: 'sidebar.crm',
    permissions: ['crm.pipelines.read', 'crm.deals.read', 'crm.deals.create', 'crm.deals.update', 'crm.deals.move'],
    versions: [
      { id: 'crm-kanban-1-0-0', version: '1.0.0', channel: 'stable', status: 'published', releasedAt: SEEDED_AT },
      { id: 'crm-kanban-1-1-0-beta', version: '1.1.0-beta.1', channel: 'beta', status: 'published', releasedAt: SEEDED_AT },
    ],
    price: { code: 'crm-kanban-monthly-kzt', monthlyAmountMinor: 2_500_000, currency: 'KZT' },
    limits: { pipelines: 3, users: 25, automationRules: 20 },
    provisioningPlan: [
      'validate_entitlement',
      'ensure_workspace',
      'ensure_main_pipeline',
      'ensure_default_stages',
      'ensure_owner_membership',
      'register_event_subscriptions',
      'health_check',
    ],
  },
  {
    id: 'module-marketing-attribution',
    code: 'marketing.attribution',
    name: 'Сквозная атрибуция',
    description: 'Сводит рекламные расходы, лиды, продажи, ROAS и ROMI в одном интерфейсе.',
    category: 'Marketing',
    ownerProductCode: 'imds-marketing',
    ownerProductName: 'IMDS Marketing',
    compatibleHostProducts: [
      { code: 'imds-marketing', name: 'IMDS Marketing' },
      { code: 'imds-dashboard', name: 'IMDS Dashboard' },
    ],
    defaultRoute: '/analytics/attribution',
    placement: 'sidebar.analytics',
    permissions: ['analytics.attribution.read', 'analytics.attribution.export'],
    versions: [{ id: 'attribution-0-9-0', version: '0.9.0', channel: 'beta', status: 'published', releasedAt: SEEDED_AT }],
    price: { code: 'marketing-attribution-monthly-kzt', monthlyAmountMinor: 3_500_000, currency: 'KZT' },
    limits: { adAccounts: 10, dataRetentionDays: 365 },
    provisioningPlan: ['validate_entitlement', 'ensure_data_source', 'ensure_rollup_jobs', 'health_check'],
  },
  {
    id: 'module-contract-generator',
    code: 'contracts.generator',
    name: 'Генератор договоров',
    description: 'Шаблоны, переменные, согласование и выпуск документов из CRM или МИС.',
    category: 'Documents',
    ownerProductCode: 'imds-contract',
    ownerProductName: 'IMDS Contract',
    compatibleHostProducts: [
      { code: 'imds-crm', name: 'IMDS CRM' },
      { code: 'imds-mis', name: 'IMDS MIS' },
    ],
    defaultRoute: '/contracts/generator',
    placement: 'sidebar.documents',
    permissions: ['contracts.templates.read', 'contracts.documents.create', 'contracts.documents.sign'],
    versions: [{ id: 'contracts-generator-1-0-0', version: '1.0.0', channel: 'stable', status: 'published', releasedAt: SEEDED_AT }],
    price: { code: 'contracts-generator-monthly-kzt', monthlyAmountMinor: 3_000_000, currency: 'KZT' },
    limits: { templates: 50, documentsPerMonth: 500 },
    provisioningPlan: ['validate_entitlement', 'ensure_template_space', 'ensure_signing_policy', 'health_check'],
  },
];

const demoOrganizations: DemoOrganization[] = [
  {
    id: 'org-amanat-medical-center',
    name: 'Amanat Medical Center',
    city: 'Алматы',
    status: 'active',
    products: ['imds-marketing', 'imds-crm', 'imds-mis', 'imds-dashboard', 'imds-contract'],
  },
  {
    id: 'org-orda-clinic',
    name: 'Orda Clinic',
    city: 'Астана',
    status: 'active',
    products: ['imds-marketing', 'imds-dashboard'],
  },
  {
    id: 'org-sapa-med',
    name: 'Sapa Med',
    city: 'Шымкент',
    status: 'suspended',
    products: ['imds-marketing', 'imds-crm'],
  },
];

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function seedInstallation(): ModuleInstallation {
  const module = platformModules[0];
  return {
    id: 'installation-demo-crm-kanban',
    organizationId: 'org-amanat-medical-center',
    moduleCode: module.code,
    moduleName: module.name,
    moduleVersion: '1.0.0',
    hostProductCode: 'imds-marketing',
    hostProductName: 'IMDS Marketing',
    route: module.defaultRoute,
    placement: module.placement,
    status: 'active',
    healthStatus: 'healthy',
    permissions: [...module.permissions],
    limits: { ...module.limits },
    config: { defaultPipelineName: 'Основная воронка', shellMode: 'embedded' },
    revision: 1,
    idempotencyKey: 'demo-crm-kanban-install',
    workspaceId: 'crm-workspace-amanat',
    pipelineId: 'crm-pipeline-main-amanat',
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    lastOperation: 'install',
    events: [
      {
        id: 'event-demo-install',
        operation: 'install',
        status: 'succeeded',
        message: 'CRM workspace, основная воронка и этапы созданы. Health check пройден.',
        occurredAt: SEEDED_AT,
      },
    ],
  };
}

function initialState(): RuntimeState {
  return { version: 1, organizations: demoOrganizations, installations: [seedInstallation()] };
}

function cloneState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

function readState(): RuntimeState {
  if (typeof window === 'undefined') return initialState();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const state = initialState();
      writeState(state);
      return state;
    }
    const parsed = JSON.parse(stored) as Partial<RuntimeState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.organizations) || !Array.isArray(parsed.installations)) {
      const state = initialState();
      writeState(state);
      return state;
    }
    return parsed as RuntimeState;
  } catch {
    return initialState();
  }
}

function writeState(state: RuntimeState) {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function selectedVersion(module: PlatformModuleDefinition) {
  return module.versions.find((version) => version.status === 'published' && version.channel === 'stable')
    ?? module.versions.find((version) => version.status === 'published')
    ?? null;
}

function getOrganization(state: RuntimeState, organizationId: string) {
  return state.organizations.find((organization) => organization.id === organizationId) ?? null;
}

function getModule(moduleCode: string) {
  return platformModules.find((module) => module.code === moduleCode) ?? null;
}

function operationEvent(operation: InstallationOperation, message: string, status: 'succeeded' | 'failed' = 'succeeded'): InstallationEvent {
  return { id: createId('event'), operation, status, message, occurredAt: new Date().toISOString() };
}

function replaceInstallation(state: RuntimeState, next: ModuleInstallation) {
  return {
    ...state,
    installations: state.installations.map((installation) => installation.id === next.id ? next : installation),
  };
}

export const moduleRuntimeRepository = {
  async snapshot() {
    return cloneState(readState());
  },

  async preview(input: Omit<InstallModuleInput, 'idempotencyKey'>): Promise<CompatibilityPreview> {
    const state = readState();
    const organization = getOrganization(state, input.organizationId);
    const module = getModule(input.moduleCode);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!organization) errors.push('Компания не найдена.');
    if (organization?.status !== 'active') errors.push('Компания приостановлена. Установка модулей запрещена.');
    if (!module) errors.push('Модуль не найден в каталоге.');

    const version = module ? selectedVersion(module) : null;
    if (!version) errors.push('Нет опубликованной версии модуля.');
    if (version?.channel !== 'stable') warnings.push(`Будет установлена версия канала ${version?.channel}.`);

    const host = module?.compatibleHostProducts.find((product) => product.code === input.hostProductCode) ?? null;
    if (module && !host) errors.push('Выбранный host-продукт несовместим с модулем.');
    if (organization && !organization.products.includes(input.hostProductCode)) {
      errors.push('У компании нет активного host-продукта.');
    }

    const route = input.route.trim() || module?.defaultRoute || '/';
    if (!route.startsWith('/')) errors.push('Route должен начинаться с /.');

    const duplicate = state.installations.find((installation) =>
      installation.organizationId === input.organizationId
      && installation.moduleCode === input.moduleCode
      && installation.hostProductCode === input.hostProductCode
      && installation.status !== 'archived');
    if (duplicate) errors.push('Для этой компании уже существует активная или приостановленная установка модуля.');

    const routeConflict = state.installations.find((installation) =>
      installation.organizationId === input.organizationId
      && installation.hostProductCode === input.hostProductCode
      && installation.route === route
      && installation.status !== 'archived');
    if (routeConflict) errors.push(`Route ${route} уже используется модулем ${routeConflict.moduleName}.`);

    return {
      compatible: errors.length === 0,
      organizationId: input.organizationId,
      moduleCode: input.moduleCode,
      hostProductCode: input.hostProductCode,
      selectedVersion: version?.version ?? '—',
      route,
      monthlyAmountMinor: module?.price.monthlyAmountMinor ?? 0,
      currency: module?.price.currency ?? 'KZT',
      warnings,
      errors,
      permissions: module ? [...module.permissions] : [],
      limits: module ? { ...module.limits } : {},
      provisioningPlan: module ? [...module.provisioningPlan] : [],
    };
  },

  async install(input: InstallModuleInput): Promise<ModuleInstallation> {
    let state = readState();
    const existingByKey = state.installations.find((installation) => installation.idempotencyKey === input.idempotencyKey);
    if (existingByKey) return existingByKey;

    const preview = await this.preview(input);
    if (!preview.compatible) throw new Error(preview.errors.join(' '));

    const organization = getOrganization(state, input.organizationId);
    const module = getModule(input.moduleCode);
    const host = module?.compatibleHostProducts.find((product) => product.code === input.hostProductCode);
    if (!organization || !module || !host) throw new Error('Compatibility context is incomplete.');

    const timestamp = new Date().toISOString();
    let installation: ModuleInstallation = {
      id: createId('installation'),
      organizationId: organization.id,
      moduleCode: module.code,
      moduleName: module.name,
      moduleVersion: preview.selectedVersion,
      hostProductCode: host.code,
      hostProductName: host.name,
      route: preview.route,
      placement: module.placement,
      status: 'validating',
      healthStatus: 'unknown',
      permissions: [...preview.permissions],
      limits: { ...preview.limits },
      config: { shellMode: 'embedded', releaseChannel: selectedVersion(module)?.channel ?? 'stable' },
      revision: 1,
      idempotencyKey: input.idempotencyKey,
      workspaceId: null,
      pipelineId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOperation: 'install',
      events: [],
    };
    state = { ...state, installations: [...state.installations, installation] };
    writeState(state);

    await wait(180);
    installation = { ...installation, status: 'provisioning', updatedAt: new Date().toISOString() };
    state = replaceInstallation(readState(), installation);
    writeState(state);

    await wait(260);
    const completedAt = new Date().toISOString();
    installation = {
      ...installation,
      status: 'active',
      healthStatus: 'healthy',
      workspaceId: createId('workspace'),
      pipelineId: module.code === 'crm.kanban' ? createId('pipeline') : null,
      updatedAt: completedAt,
      events: [operationEvent('install', `${module.provisioningPlan.length} шагов provisioning выполнены. Health check пройден.`)],
    };
    state = replaceInstallation(readState(), installation);
    writeState(state);
    return installation;
  },

  async setState(installationId: string, operation: Exclude<InstallationOperation, 'install'>): Promise<ModuleInstallation> {
    let state = readState();
    const current = state.installations.find((installation) => installation.id === installationId);
    if (!current) throw new Error('Installation не найдена.');
    if (current.status === 'archived' && operation !== 'resume') throw new Error('Архивную installation нельзя изменить.');

    const timestamp = new Date().toISOString();
    let next: ModuleInstallation;
    if (operation === 'suspend') {
      next = {
        ...current,
        status: 'suspended',
        healthStatus: 'healthy',
        revision: current.revision + 1,
        updatedAt: timestamp,
        lastOperation: operation,
        events: [operationEvent(operation, 'Модуль приостановлен. Данные и CRM workspace сохранены.'), ...current.events],
      };
    } else if (operation === 'resume') {
      next = {
        ...current,
        status: 'active',
        healthStatus: 'healthy',
        revision: current.revision + 1,
        updatedAt: timestamp,
        lastOperation: operation,
        events: [operationEvent(operation, 'Доступ восстановлен без повторного создания workspace и pipeline.'), ...current.events],
      };
    } else if (operation === 'uninstall') {
      next = {
        ...current,
        status: 'archived',
        healthStatus: 'unknown',
        revision: current.revision + 1,
        updatedAt: timestamp,
        lastOperation: operation,
        events: [operationEvent(operation, 'Installation архивирована. Локальные данные оставлены для контролируемого восстановления.'), ...current.events],
      };
    } else {
      next = {
        ...current,
        status: 'provisioning',
        healthStatus: 'unknown',
        updatedAt: timestamp,
        lastOperation: operation,
      };
      state = replaceInstallation(state, next);
      writeState(state);
      await wait(300);
      next = {
        ...next,
        status: 'active',
        healthStatus: 'healthy',
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        events: [operationEvent(operation, 'Конфигурация проверена, зависимости восстановлены, health check пройден.'), ...current.events],
      };
    }

    state = replaceInstallation(readState(), next);
    writeState(state);
    return next;
  },

  async bootstrap(organizationId: string, productCode: string): Promise<PlatformBootstrap> {
    const state = readState();
    const organization = getOrganization(state, organizationId);
    if (!organization) throw new Error('Компания не найдена.');
    return {
      tenant: { id: organization.id, displayName: organization.name },
      product: { code: productCode, shellVersion: 'local-demo-1' },
      modules: state.installations
        .filter((installation) =>
          installation.organizationId === organizationId
          && installation.hostProductCode === productCode
          && installation.status === 'active'
          && installation.healthStatus === 'healthy')
        .map((installation) => ({
          installationId: installation.id,
          code: installation.moduleCode,
          name: installation.moduleName,
          version: installation.moduleVersion,
          route: installation.route,
          placement: installation.placement,
          permissions: [...installation.permissions],
          limits: { ...installation.limits },
          config: { ...installation.config },
          healthStatus: installation.healthStatus,
        })),
    };
  },

  async authorize(organizationId: string, productCode: string, moduleCode: string, permission: string): Promise<AuthorizationDecision> {
    const state = readState();
    const organization = getOrganization(state, organizationId);
    if (!organization || organization.status !== 'active') {
      return { allowed: false, decision: 'TENANT_SUSPENDED', installationId: null, effectiveLimits: {} };
    }

    const installation = state.installations.find((candidate) =>
      candidate.organizationId === organizationId
      && candidate.hostProductCode === productCode
      && candidate.moduleCode === moduleCode
      && candidate.status !== 'archived');
    if (!installation) return { allowed: false, decision: 'INSTALLATION_NOT_FOUND', installationId: null, effectiveLimits: {} };
    if (installation.status === 'suspended') {
      return { allowed: false, decision: 'MODULE_SUSPENDED', installationId: installation.id, effectiveLimits: { ...installation.limits } };
    }
    if (installation.status === 'read_only' && !permission.endsWith('.read')) {
      return { allowed: false, decision: 'MODULE_READ_ONLY', installationId: installation.id, effectiveLimits: { ...installation.limits } };
    }
    if (installation.status !== 'active' && installation.status !== 'read_only') {
      return { allowed: false, decision: 'INSTALLATION_NOT_FOUND', installationId: installation.id, effectiveLimits: { ...installation.limits } };
    }
    if (!installation.permissions.includes(permission)) {
      return { allowed: false, decision: 'PERMISSION_DENIED', installationId: installation.id, effectiveLimits: { ...installation.limits } };
    }
    return { allowed: true, decision: 'GRANTED', installationId: installation.id, effectiveLimits: { ...installation.limits } };
  },

  async reset() {
    const state = initialState();
    writeState(state);
    return cloneState(state);
  },
};
