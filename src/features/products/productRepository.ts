import type {
  ProductAdapterProtocol,
  ProductAdapterStatus,
  ProductAuthMode,
  ProductEndpointEnvironment,
  ProductEndpointStatus,
  ProductHealthStatus,
  ProductStatus,
} from '../../lib/database.types';
import { getSupabase } from '../../lib/supabase';
import { productCapabilities, type ProductCapability } from './adapterContract';

export type ProductEndpoint = {
  id: string;
  environment: ProductEndpointEnvironment;
  baseUrl: string;
  healthcheckUrl: string;
  authMode: ProductAuthMode;
  hasSecretReference: boolean;
  secretReference: string;
  timeoutMs: number;
  status: ProductEndpointStatus;
  lastCheckedAt: string | null;
  lastHealthStatus: ProductHealthStatus;
  lastLatencyMs: number | null;
  lastError: string;
};

export type ProductAdapter = {
  id: string;
  adapterKey: string;
  contractVersion: string;
  protocol: ProductAdapterProtocol;
  status: ProductAdapterStatus;
  capabilities: ProductCapability[];
  endpoint: ProductEndpoint | null;
};

export type ManagedProduct = {
  id: string;
  key: string;
  name: string;
  description: string;
  status: ProductStatus;
  tenants: number;
  version: string;
  isSystem: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  adapter: ProductAdapter | null;
};

export type ProductDefinitionInput = {
  id?: string | null;
  key: string;
  name: string;
  description: string;
  status: ProductStatus;
  version: string;
};

export type ProductAdapterInput = {
  productId: string;
  adapterKey: string;
  contractVersion: string;
  protocol: ProductAdapterProtocol;
  status: ProductAdapterStatus;
  capabilities: ProductCapability[];
  environment: ProductEndpointEnvironment;
  baseUrl: string;
  healthcheckUrl: string;
  authMode: ProductAuthMode;
  secretReference: string;
  timeoutMs: number;
  endpointStatus: ProductEndpointStatus;
};

const STORAGE_KEY = 'imds-super-admin:product-catalog:v2';
const LEGACY_STORAGE_KEY = 'imds-super-admin:products:v1';

const now = '2026-08-02T10:00:00.000Z';

const demoProducts: ManagedProduct[] = [
  createDemoProduct('mis', 'imds-mis', 'IMDS MIS', 'Медицинская информационная система.', 'active', '3.8.4', true, 42, 'mis'),
  createDemoProduct('crm', 'imds-crm', 'IMDS CRM', 'Управление клиентами, продажами и коммуникациями.', 'active', '2.4.1', true, 56, 'crm'),
  createDemoProduct('marketing', 'imds-marketing', 'IMDS Marketing', 'Рекламные кабинеты, каналы и маркетинговая аналитика.', 'degraded', '1.9.6', true, 31, 'marketing'),
  createDemoProduct('finance', 'imds-finance', 'IMDS Finance', 'Финансовый учёт, платежи, ДДС и отчётность.', 'active', '1.3.0', true, 19, 'finance'),
  createDemoProduct('contract', 'imds-contract', 'IMDS Contract', 'Договоры, шаблоны, согласования и документы.', 'active', '1.6.2', true, 24, 'contract'),
  createDemoProduct('dashboard', 'imds-dashboard', 'IMDS Dashboard', 'Управленческие отчёты, KPI и аналитические панели.', 'active', '2.2.8', true, 47, 'dashboard'),
  createDemoProduct('product-7', 'imds-product-7', 'IMDS Product 7', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', true, 0, null),
  createDemoProduct('product-8', 'imds-product-8', 'IMDS Product 8', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', true, 0, null),
  createDemoProduct('product-9', 'imds-product-9', 'IMDS Product 9', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', true, 0, null),
  createDemoProduct('product-10', 'imds-product-10', 'IMDS Product 10', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', true, 0, null),
  createDemoProduct('product-11', 'imds-product-11', 'IMDS Product 11', 'Официальное название ещё не зафиксировано.', 'draft', '0.1.0', true, 0, null),
];

function createDemoProduct(
  id: string,
  key: string,
  name: string,
  description: string,
  status: ProductStatus,
  version: string,
  isSystem: boolean,
  tenants: number,
  adapterKey: string | null,
): ManagedProduct {
  return {
    id,
    key,
    name,
    description,
    status,
    tenants,
    version,
    isSystem,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    adapter: adapterKey ? {
      id: `adapter-${id}`,
      adapterKey,
      contractVersion: '1.0',
      protocol: 'rest',
      status: 'draft',
      capabilities: [...productCapabilities],
      endpoint: {
        id: `endpoint-${id}-production`,
        environment: 'production',
        baseUrl: '',
        healthcheckUrl: '',
        authMode: 'service_token',
        hasSecretReference: false,
        secretReference: '',
        timeoutMs: 10000,
        status: 'draft',
        lastCheckedAt: null,
        lastHealthStatus: 'unknown',
        lastLatencyMs: null,
        lastError: '',
      },
    } : null,
  };
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mapLegacyStatus(value: unknown): ProductStatus {
  if (value === 'Работает' || value === 'active') return 'active';
  if (value === 'Деградация' || value === 'degraded') return 'degraded';
  if (value === 'Отключён' || value === 'disabled') return 'disabled';
  if (value === 'maintenance') return 'maintenance';
  return 'draft';
}

function readDemoProducts(): ManagedProduct[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ManagedProduct[];
      if (Array.isArray(parsed)) return parsed;
    }

    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Array<Record<string, unknown>>;
      if (Array.isArray(parsed)) {
        const migrated = parsed.map((item, index): ManagedProduct => ({
          id: typeof item.id === 'string' ? item.id : createId('product'),
          key: typeof item.key === 'string' ? item.key : `product-${index + 1}`,
          name: typeof item.name === 'string' ? item.name : `Product ${index + 1}`,
          description: typeof item.description === 'string' ? item.description : '',
          status: mapLegacyStatus(item.status),
          tenants: typeof item.tenants === 'number' ? item.tenants : 0,
          version: typeof item.version === 'string' ? item.version : '0.1.0',
          isSystem: item.isSystem === true,
          archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : null,
          createdAt: now,
          updatedAt: now,
          adapter: typeof item.apiBaseUrl === 'string' || typeof item.key === 'string'
            ? {
                id: `adapter-${String(item.id ?? index)}`,
                adapterKey: typeof item.key === 'string' ? item.key.replace(/^imds-/, '') : `product-${index + 1}`,
                contractVersion: '1.0',
                protocol: 'rest',
                status: 'draft',
                capabilities: [],
                endpoint: {
                  id: `endpoint-${String(item.id ?? index)}-production`,
                  environment: 'production',
                  baseUrl: typeof item.apiBaseUrl === 'string' ? item.apiBaseUrl : '',
                  healthcheckUrl: '',
                  authMode: 'service_token',
                  hasSecretReference: false,
                  secretReference: '',
                  timeoutMs: 10000,
                  status: 'draft',
                  lastCheckedAt: null,
                  lastHealthStatus: 'unknown',
                  lastLatencyMs: null,
                  lastError: '',
                },
              }
            : null,
        }));
        writeDemoProducts(migrated);
        return migrated;
      }
    }
  } catch {
    return demoProducts;
  }

  writeDemoProducts(demoProducts);
  return demoProducts;
}

function writeDemoProducts(products: ManagedProduct[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

function isCapability(value: string): value is ProductCapability {
  return (productCapabilities as readonly string[]).includes(value);
}

async function listFromSupabase(): Promise<ManagedProduct[]> {
  const supabase = getSupabase();
  if (!supabase) return readDemoProducts();

  const [productsResult, licensesResult, adaptersResult, endpointsResult] = await Promise.all([
    supabase.from('products').select('*').order('created_at', { ascending: true }),
    supabase.from('licenses').select('product_id, status'),
    supabase.from('product_adapters').select('*'),
    supabase.from('product_endpoints').select('*'),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (licensesResult.error) throw licensesResult.error;
  if (adaptersResult.error) throw adaptersResult.error;
  if (endpointsResult.error) throw endpointsResult.error;

  const retainedLicenseStatuses = new Set(['pending', 'provisioning', 'active', 'suspended']);

  return productsResult.data.map((product): ManagedProduct => {
    const adapter = adaptersResult.data.find((item) => item.product_id === product.id) ?? null;
    const adapterEndpoints = adapter
      ? endpointsResult.data.filter((endpoint) => endpoint.adapter_id === adapter.id)
      : [];
    const endpoint = adapterEndpoints.find((item) => item.environment === 'production')
      ?? adapterEndpoints.find((item) => item.environment === 'staging')
      ?? adapterEndpoints[0]
      ?? null;

    return {
      id: product.id,
      key: product.key,
      name: product.name,
      description: product.description ?? '',
      status: product.status,
      tenants: licensesResult.data.filter((license) => license.product_id === product.id && retainedLicenseStatuses.has(license.status)).length,
      version: product.current_version ?? '',
      isSystem: product.is_system,
      archivedAt: product.archived_at,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
      adapter: adapter ? {
        id: adapter.id,
        adapterKey: adapter.adapter_key,
        contractVersion: adapter.contract_version,
        protocol: adapter.protocol,
        status: adapter.status,
        capabilities: adapter.capabilities.filter(isCapability),
        endpoint: endpoint ? {
          id: endpoint.id,
          environment: endpoint.environment,
          baseUrl: endpoint.base_url ?? '',
          healthcheckUrl: endpoint.healthcheck_url ?? '',
          authMode: endpoint.auth_mode,
          hasSecretReference: Boolean(endpoint.secret_reference),
          secretReference: endpoint.secret_reference ?? '',
          timeoutMs: endpoint.timeout_ms,
          status: endpoint.status,
          lastCheckedAt: endpoint.last_checked_at,
          lastHealthStatus: endpoint.last_health_status,
          lastLatencyMs: endpoint.last_latency_ms,
          lastError: endpoint.last_error ?? '',
        } : null,
      } : null,
    };
  });
}

export const productRepository = {
  async list(): Promise<ManagedProduct[]> {
    return listFromSupabase();
  },

  async saveDefinition(input: ProductDefinitionInput): Promise<ManagedProduct[]> {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.rpc('upsert_product_definition', {
        product_key: input.key,
        product_name: input.name,
        product_description: input.description || null,
        product_status: input.status,
        product_version: input.version || null,
        target_product_id: input.id || null,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const products = readDemoProducts();
    const timestamp = new Date().toISOString();
    let result: ManagedProduct[];

    if (input.id) {
      result = products.map((product) => product.id === input.id
        ? {
            ...product,
            key: product.isSystem ? product.key : input.key,
            name: input.name,
            description: input.description,
            status: input.status,
            version: input.version,
            updatedAt: timestamp,
          }
        : product);
    } else {
      result = [
        ...products,
        {
          id: createId('product'),
          key: input.key,
          name: input.name,
          description: input.description,
          status: input.status,
          tenants: 0,
          version: input.version,
          isSystem: false,
          archivedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          adapter: null,
        },
      ];
    }

    writeDemoProducts(result);
    return result;
  },

  async configureAdapter(input: ProductAdapterInput): Promise<ManagedProduct[]> {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.rpc('configure_product_adapter', {
        target_product_id: input.productId,
        adapter_key_value: input.adapterKey,
        contract_version_value: input.contractVersion,
        protocol_value: input.protocol,
        adapter_status_value: input.status,
        capabilities_value: input.capabilities,
        endpoint_environment_value: input.environment,
        endpoint_base_url_value: input.baseUrl || null,
        endpoint_healthcheck_url_value: input.healthcheckUrl || null,
        endpoint_auth_mode_value: input.authMode,
        endpoint_secret_reference_value: input.secretReference || null,
        endpoint_timeout_ms_value: input.timeoutMs,
        endpoint_status_value: input.endpointStatus,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const timestamp = new Date().toISOString();
    const result = readDemoProducts().map((product): ManagedProduct => {
      if (product.id !== input.productId) return product;
      const adapterId = product.adapter?.id ?? createId('adapter');
      return {
        ...product,
        updatedAt: timestamp,
        adapter: {
          id: adapterId,
          adapterKey: input.adapterKey,
          contractVersion: input.contractVersion,
          protocol: input.protocol,
          status: input.status,
          capabilities: input.capabilities,
          endpoint: {
            id: product.adapter?.endpoint?.id ?? createId('endpoint'),
            environment: input.environment,
            baseUrl: input.baseUrl,
            healthcheckUrl: input.healthcheckUrl,
            authMode: input.authMode,
            hasSecretReference: Boolean(input.secretReference),
            secretReference: input.secretReference,
            timeoutMs: input.timeoutMs,
            status: input.endpointStatus,
            lastCheckedAt: product.adapter?.endpoint?.lastCheckedAt ?? null,
            lastHealthStatus: product.adapter?.endpoint?.lastHealthStatus ?? 'unknown',
            lastLatencyMs: product.adapter?.endpoint?.lastLatencyMs ?? null,
            lastError: product.adapter?.endpoint?.lastError ?? '',
          },
        },
      };
    });
    writeDemoProducts(result);
    return result;
  },

  async archive(id: string): Promise<ManagedProduct[]> {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.rpc('archive_product', { target_product_id: id });
      if (error) throw error;
      return listFromSupabase();
    }

    const product = readDemoProducts().find((item) => item.id === id);
    if (!product) throw new Error('Продукт не найден.');
    if (product.tenants > 0) throw new Error('Сначала отключите или отзовите активные лицензии продукта.');
    const timestamp = new Date().toISOString();
    const result = readDemoProducts().map((item) => item.id === id
      ? { ...item, status: 'disabled' as const, archivedAt: timestamp, updatedAt: timestamp }
      : item);
    writeDemoProducts(result);
    return result;
  },

  async restore(id: string): Promise<ManagedProduct[]> {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.rpc('restore_product', { target_product_id: id });
      if (error) throw error;
      return listFromSupabase();
    }

    const timestamp = new Date().toISOString();
    const result = readDemoProducts().map((item) => item.id === id
      ? { ...item, status: 'draft' as const, archivedAt: null, updatedAt: timestamp }
      : item);
    writeDemoProducts(result);
    return result;
  },

  async deleteCustom(id: string): Promise<ManagedProduct[]> {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.rpc('delete_custom_product', { target_product_id: id });
      if (error) throw error;
      return listFromSupabase();
    }

    const product = readDemoProducts().find((item) => item.id === id);
    if (!product) throw new Error('Продукт не найден.');
    if (product.isSystem) throw new Error('Системный продукт нельзя удалить.');
    if (!product.archivedAt) throw new Error('Сначала переместите продукт в архив.');
    if (product.tenants > 0) throw new Error('У продукта осталась история лицензий.');
    const result = readDemoProducts().filter((item) => item.id !== id);
    writeDemoProducts(result);
    return result;
  },
};
