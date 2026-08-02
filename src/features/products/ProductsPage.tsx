import {
  Activity,
  AppWindow,
  Archive,
  Boxes,
  Cable,
  CircleAlert,
  CloudCog,
  Edit3,
  Gauge,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ServerCog,
  ShieldCheck,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import type {
  ProductAdapterProtocol,
  ProductAdapterStatus,
  ProductAuthMode,
  ProductEndpointEnvironment,
  ProductEndpointStatus,
  ProductStatus,
} from '../../lib/database.types';
import { productCapabilities, type ProductCapability } from './adapterContract';
import { useProductCatalog } from './ProductCatalogContext';
import type { ManagedProduct, ProductAdapterInput, ProductDefinitionInput } from './productRepository';

const productStatusLabels: Record<ProductStatus, string> = {
  draft: 'Настройка',
  active: 'Работает',
  degraded: 'Деградация',
  maintenance: 'Техработы',
  disabled: 'Отключён',
};

const adapterStatusLabels: Record<ProductAdapterStatus, string> = {
  draft: 'Черновик',
  active: 'Активен',
  degraded: 'Деградация',
  disabled: 'Отключён',
};

const endpointStatusLabels: Record<ProductEndpointStatus, string> = {
  draft: 'Черновик',
  active: 'Активен',
  maintenance: 'Техработы',
  disabled: 'Отключён',
};

const environmentLabels: Record<ProductEndpointEnvironment, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
  demo: 'Demo',
};

const capabilityLabels: Record<ProductCapability, string> = {
  'tenant.provision': 'Создание tenant',
  'tenant.suspend': 'Приостановка tenant',
  'tenant.resume': 'Возобновление tenant',
  'tenant.revoke': 'Отзыв tenant',
  'owner.invite': 'Приглашение владельца',
  'entitlements.sync': 'Синхронизация доступов',
  'usage.read': 'Получение usage',
  'health.read': 'Health check',
  'webhooks.receive': 'Приём webhooks',
};

const emptyProduct: ProductDefinitionInput = {
  id: null,
  key: '',
  name: '',
  description: '',
  status: 'draft',
  version: '0.1.0',
};

const emptyAdapter: ProductAdapterInput = {
  productId: '',
  adapterKey: '',
  contractVersion: '1.0',
  protocol: 'rest',
  status: 'draft',
  capabilities: [],
  environment: 'production',
  baseUrl: '',
  healthcheckUrl: '',
  authMode: 'service_token',
  secretReference: '',
  timeoutMs: 10000,
  endpointStatus: 'draft',
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/^imds\s+/i, 'imds-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function productStatusClass(status: ProductStatus) {
  if (status === 'active') return 'ok';
  if (status === 'degraded' || status === 'maintenance') return 'warn';
  return 'muted';
}

function healthStatusClass(status: ManagedProduct['adapter'] extends infer _T ? string : never) {
  if (status === 'healthy') return 'ok';
  if (status === 'degraded') return 'warn';
  if (status === 'unavailable') return 'danger';
  return 'muted';
}

function formatUrl(value: string) {
  if (!value) return 'URL не настроен';
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function defaultAdapterFor(product: ManagedProduct): ProductAdapterInput {
  const endpoint = product.adapter?.endpoint;
  return {
    productId: product.id,
    adapterKey: product.adapter?.adapterKey || product.key.replace(/^imds-/, ''),
    contractVersion: product.adapter?.contractVersion || '1.0',
    protocol: product.adapter?.protocol || 'rest',
    status: product.adapter?.status || 'draft',
    capabilities: product.adapter?.capabilities || [],
    environment: endpoint?.environment || 'production',
    baseUrl: endpoint?.baseUrl || '',
    healthcheckUrl: endpoint?.healthcheckUrl || '',
    authMode: endpoint?.authMode || 'service_token',
    secretReference: endpoint?.secretReference || '',
    timeoutMs: endpoint?.timeoutMs || 10000,
    endpointStatus: endpoint?.status || 'draft',
  };
}

export function ProductsPage() {
  const { can, isDemo } = useAuth();
  const {
    products,
    loading,
    saving,
    error,
    refresh,
    saveProduct,
    configureAdapter,
    archiveProduct,
    restoreProduct,
    deleteProduct,
  } = useProductCatalog();
  const productDialog = useRef<HTMLDialogElement | null>(null);
  const adapterDialog = useRef<HTMLDialogElement | null>(null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [productForm, setProductForm] = useState<ProductDefinitionInput>(emptyProduct);
  const [adapterForm, setAdapterForm] = useState<ProductAdapterInput>(emptyAdapter);
  const [selectedProduct, setSelectedProduct] = useState<ManagedProduct | null>(null);
  const [validation, setValidation] = useState('');
  const canManage = can('products.manage');

  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return products.filter((product) => {
      if (!showArchived && product.archivedAt) return false;
      if (!normalized) return true;
      return [product.name, product.key, product.description, product.adapter?.adapterKey ?? '']
        .some((value) => value.toLowerCase().includes(normalized));
    });
  }, [products, query, showArchived]);

  const metrics = useMemo(() => ({
    active: products.filter((product) => !product.archivedAt && product.status === 'active').length,
    adapters: products.filter((product) => !product.archivedAt && product.adapter).length,
    incidents: products.filter((product) => {
      const health = product.adapter?.endpoint?.lastHealthStatus;
      return product.status === 'degraded' || health === 'degraded' || health === 'unavailable';
    }).length,
    tenants: products.filter((product) => !product.archivedAt).reduce((sum, product) => sum + product.tenants, 0),
  }), [products]);

  const openCreate = () => {
    setSelectedProduct(null);
    setProductForm(emptyProduct);
    setValidation('');
    productDialog.current?.showModal();
  };

  const openEdit = (product: ManagedProduct) => {
    setSelectedProduct(product);
    setProductForm({
      id: product.id,
      key: product.key,
      name: product.name,
      description: product.description,
      status: product.status,
      version: product.version,
    });
    setValidation('');
    productDialog.current?.showModal();
  };

  const submitProduct = async (event: FormEvent) => {
    event.preventDefault();
    const normalized: ProductDefinitionInput = {
      ...productForm,
      key: (productForm.key || slugify(productForm.name)).trim().toLowerCase(),
      name: productForm.name.trim(),
      description: productForm.description.trim(),
      version: productForm.version.trim(),
    };

    if (!normalized.name || !normalized.key) {
      setValidation('Название и системный ключ обязательны.');
      return;
    }
    if (!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(normalized.key)) {
      setValidation('Системный ключ может содержать латинские буквы, цифры, точку, дефис и подчёркивание.');
      return;
    }
    if (normalized.version && !/^\d+\.\d+\.\d+([.-][a-zA-Z0-9]+)*$/.test(normalized.version)) {
      setValidation('Версия должна соответствовать формату 1.2.3.');
      return;
    }
    const duplicate = products.some((product) => product.id !== normalized.id && (product.key === normalized.key || product.name.toLowerCase() === normalized.name.toLowerCase()));
    if (duplicate) {
      setValidation('Продукт с таким названием или ключом уже существует.');
      return;
    }

    if (await saveProduct(normalized)) productDialog.current?.close();
  };

  const openAdapter = (product: ManagedProduct) => {
    setSelectedProduct(product);
    setAdapterForm(defaultAdapterFor(product));
    setValidation('');
    adapterDialog.current?.showModal();
  };

  const submitAdapter = async (event: FormEvent) => {
    event.preventDefault();
    const normalized: ProductAdapterInput = {
      ...adapterForm,
      adapterKey: adapterForm.adapterKey.trim().toLowerCase(),
      contractVersion: adapterForm.contractVersion.trim(),
      baseUrl: adapterForm.baseUrl.trim().replace(/\/$/, ''),
      healthcheckUrl: adapterForm.healthcheckUrl.trim(),
      secretReference: adapterForm.secretReference.trim(),
      timeoutMs: Number(adapterForm.timeoutMs),
    };

    if (!normalized.adapterKey || !/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(normalized.adapterKey)) {
      setValidation('Укажите корректный ключ адаптера.');
      return;
    }
    if (!/^\d+\.\d+([.-][a-zA-Z0-9]+)*$/.test(normalized.contractVersion)) {
      setValidation('Версия контракта должна соответствовать формату 1.0.');
      return;
    }
    if (normalized.environment === 'production' && normalized.baseUrl && !normalized.baseUrl.startsWith('https://')) {
      setValidation('Production endpoint должен использовать HTTPS.');
      return;
    }
    if (normalized.endpointStatus === 'active' && !normalized.baseUrl) {
      setValidation('Для активного endpoint необходим Base URL.');
      return;
    }
    if (normalized.timeoutMs < 500 || normalized.timeoutMs > 120000) {
      setValidation('Timeout должен быть от 500 до 120000 мс.');
      return;
    }

    if (await configureAdapter(normalized)) adapterDialog.current?.close();
  };

  const archive = async (product: ManagedProduct) => {
    if (product.tenants > 0) {
      window.alert(`Нельзя убрать ${product.name}: продукт используется ${product.tenants} tenants. Сначала отключите лицензии.`);
      return;
    }
    if (!window.confirm(`Переместить «${product.name}» в архив?`)) return;
    await archiveProduct(product.id);
  };

  const restore = async (product: ManagedProduct) => {
    if (!window.confirm(`Восстановить «${product.name}» в Product Registry?`)) return;
    await restoreProduct(product.id);
  };

  const remove = async (product: ManagedProduct) => {
    if (!window.confirm(`Удалить «${product.name}» навсегда? Это действие необратимо.`)) return;
    await deleteProduct(product.id);
  };

  const toggleCapability = (capability: ProductCapability) => {
    const exists = adapterForm.capabilities.includes(capability);
    setAdapterForm({
      ...adapterForm,
      capabilities: exists
        ? adapterForm.capabilities.filter((item) => item !== capability)
        : [...adapterForm.capabilities, capability],
    });
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Product Registry & Adapter Layer</span>
          <h1>Продукты IMDS</h1>
          <p>Каталог продуктов, версии API-контрактов, environment endpoints и состояние интеграций.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить</button>
          {canManage && <button className="primary-button" type="button" onClick={openCreate}><Plus size={17} /> Добавить продукт</button>}
        </div>
      </div>

      {isDemo && <div className="mode-banner"><ShieldCheck size={18} /><div><strong>Демо-режим Product Registry</strong><span>Каталог и адаптеры сохраняются в браузере. В production операции выполняются защищёнными PostgreSQL RPC.</span></div></div>}
      {!canManage && <div className="mode-banner"><AppWindow size={18} /><div><strong>Режим просмотра</strong><span>Текущая роль не может менять продукты и конфигурацию адаптеров.</span></div></div>}
      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span></div>}

      <section className="metrics product-metrics">
        <article className="metric-card"><div className="metric-icon"><Boxes size={21} /></div><div><span>Активные продукты</span><strong>{metrics.active}</strong><small>из {products.filter((product) => !product.archivedAt).length}</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Cable size={21} /></div><div><span>Адаптеры</span><strong>{metrics.adapters}</strong><small>зарегистрировано</small></div></article>
        <article className="metric-card"><div className="metric-icon"><CircleAlert size={21} /></div><div><span>Деградации</span><strong>{metrics.incidents}</strong><small>требуют проверки</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Gauge size={21} /></div><div><span>Подключения tenants</span><strong>{metrics.tenants}</strong><small>активные и retained</small></div></article>
      </section>

      <div className="product-registry-toolbar">
        <div className="search registry-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, ключ, адаптер..." /></div>
        <label className="toggle-control"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>Показывать архив</span></label>
        <span>Найдено: {visibleProducts.length}</span>
      </div>

      {loading ? (
        <div className="inline-loading"><LoaderCircle className="spin" size={28} /><span>Загрузка Product Registry...</span></div>
      ) : (
        <div className="adapter-product-grid">
          {visibleProducts.map((product) => {
            const endpoint = product.adapter?.endpoint;
            return (
              <article className={`adapter-product-card ${product.archivedAt ? 'archived' : ''}`} key={product.id}>
                <div className="adapter-card-header">
                  <div className="product-symbol large"><AppWindow size={22} /></div>
                  <span className={`status ${productStatusClass(product.status)}`}>{productStatusLabels[product.status]}</span>
                </div>
                <div className="adapter-card-title"><div><h2>{product.name}</h2><code>{product.key}</code></div>{product.isSystem && <span className="system-label">System</span>}</div>
                <p className="adapter-card-description">{product.description || 'Описание продукта не заполнено.'}</p>

                <div className="product-facts">
                  <div><span>Версия</span><strong>{product.version || '—'}</strong></div>
                  <div><span>Tenants</span><strong>{product.tenants}</strong></div>
                  <div><span>Обновлён</span><strong>{new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(product.updatedAt))}</strong></div>
                </div>

                <div className="adapter-summary">
                  <div className="adapter-summary-title"><div><ServerCog size={17} /><strong>{product.adapter ? product.adapter.adapterKey : 'Адаптер не создан'}</strong></div>{product.adapter && <span>{adapterStatusLabels[product.adapter.status]}</span>}</div>
                  {product.adapter ? (
                    <>
                      <div className="adapter-meta"><span>Contract v{product.adapter.contractVersion}</span><span>{product.adapter.protocol.toUpperCase()}</span><span>{product.adapter.capabilities.length} capabilities</span></div>
                      <div className="endpoint-row">
                        <div className={`health-dot ${healthStatusClass(endpoint?.lastHealthStatus ?? 'unknown')}`} />
                        <div><strong>{endpoint ? environmentLabels[endpoint.environment] : 'Endpoint отсутствует'}</strong><span>{endpoint ? formatUrl(endpoint.baseUrl) : 'Настройте environment endpoint'}</span></div>
                        {endpoint && <div className="endpoint-state"><span>{endpointStatusLabels[endpoint.status]}</span>{endpoint.lastLatencyMs !== null && <small>{endpoint.lastLatencyMs} ms</small>}</div>}
                      </div>
                    </>
                  ) : (
                    <div className="adapter-empty"><Unplug size={18} /><span>Продукт ещё не подключён к Product Adapter Layer.</span></div>
                  )}
                </div>

                {canManage && <div className="adapter-card-actions">
                  <button className="secondary-button" type="button" onClick={() => openEdit(product)}><Edit3 size={15} /> Продукт</button>
                  <button className="secondary-button" type="button" onClick={() => openAdapter(product)}><CloudCog size={15} /> Адаптер</button>
                  {product.archivedAt
                    ? <button className="secondary-button" type="button" onClick={() => void restore(product)}><RotateCcw size={15} /> Восстановить</button>
                    : <button className="danger-button" type="button" disabled={product.tenants > 0} onClick={() => void archive(product)}><Archive size={15} /> Убрать</button>}
                  {product.archivedAt && !product.isSystem && product.tenants === 0 && <button className="icon-danger-button" type="button" title="Удалить навсегда" onClick={() => void remove(product)}><Trash2 size={16} /></button>}
                </div>}
              </article>
            );
          })}
        </div>
      )}

      <dialog ref={productDialog} className="modal" onCancel={() => productDialog.current?.close()}>
        <form onSubmit={submitProduct}>
          <div className="modal-header"><div><span className="eyebrow">Product Definition</span><h2>{selectedProduct ? 'Изменить продукт' : 'Добавить продукт'}</h2></div><button className="icon-button" type="button" onClick={() => productDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-grid">
            <label><span>Название *</span><input required value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value, key: selectedProduct ? productForm.key : slugify(event.target.value) })} placeholder="IMDS Новый продукт" /></label>
            <label><span>Системный ключ *</span><input required disabled={Boolean(selectedProduct?.isSystem)} value={productForm.key} onChange={(event) => setProductForm({ ...productForm, key: slugify(event.target.value) })} placeholder="imds-new-product" /></label>
            <label><span>Версия</span><input value={productForm.version} onChange={(event) => setProductForm({ ...productForm, version: event.target.value })} placeholder="1.0.0" /></label>
            <label><span>Статус</span><select value={productForm.status} onChange={(event) => setProductForm({ ...productForm, status: event.target.value as ProductStatus })}>{Object.entries(productStatusLabels).filter(([status]) => status !== 'disabled' || selectedProduct?.archivedAt).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
            <label className="span-2"><span>Описание</span><textarea rows={4} value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} /></label>
          </div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => productDialog.current?.close()}>Отмена</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Edit3 size={17} />}{saving ? 'Сохранение...' : 'Сохранить'}</button></div>
        </form>
      </dialog>

      <dialog ref={adapterDialog} className="modal wide-modal" onCancel={() => adapterDialog.current?.close()}>
        <form onSubmit={submitAdapter}>
          <div className="modal-header"><div><span className="eyebrow">Product Adapter Contract</span><h2>{selectedProduct?.name}</h2><p>Секреты не вводятся напрямую. Используется только ссылка на секрет в защищённом хранилище.</p></div><button className="icon-button" type="button" onClick={() => adapterDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-section"><h3>Контракт адаптера</h3><div className="form-grid">
            <label><span>Adapter key *</span><input required value={adapterForm.adapterKey} onChange={(event) => setAdapterForm({ ...adapterForm, adapterKey: slugify(event.target.value) })} /></label>
            <label><span>Contract version *</span><input required value={adapterForm.contractVersion} onChange={(event) => setAdapterForm({ ...adapterForm, contractVersion: event.target.value })} placeholder="1.0" /></label>
            <label><span>Протокол</span><select value={adapterForm.protocol} onChange={(event) => setAdapterForm({ ...adapterForm, protocol: event.target.value as ProductAdapterProtocol })}><option value="rest">REST</option><option value="graphql">GraphQL</option><option value="worker">Worker</option><option value="internal">Internal</option></select></label>
            <label><span>Статус адаптера</span><select value={adapterForm.status} onChange={(event) => setAdapterForm({ ...adapterForm, status: event.target.value as ProductAdapterStatus })}>{Object.entries(adapterStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
          </div></div>
          <div className="form-section"><h3>Capabilities</h3><div className="capability-grid">{productCapabilities.map((capability) => <label key={capability}><input type="checkbox" checked={adapterForm.capabilities.includes(capability)} onChange={() => toggleCapability(capability)} /><span><strong>{capabilityLabels[capability]}</strong><small>{capability}</small></span></label>)}</div></div>
          <div className="form-section"><h3>Environment endpoint</h3><div className="form-grid">
            <label><span>Среда</span><select value={adapterForm.environment} onChange={(event) => setAdapterForm({ ...adapterForm, environment: event.target.value as ProductEndpointEnvironment })}>{Object.entries(environmentLabels).map(([environment, label]) => <option key={environment} value={environment}>{label}</option>)}</select></label>
            <label><span>Статус endpoint</span><select value={adapterForm.endpointStatus} onChange={(event) => setAdapterForm({ ...adapterForm, endpointStatus: event.target.value as ProductEndpointStatus })}>{Object.entries(endpointStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
            <label className="span-2"><span>Base URL</span><input value={adapterForm.baseUrl} onChange={(event) => setAdapterForm({ ...adapterForm, baseUrl: event.target.value })} placeholder="https://api.product.imds24.com" /></label>
            <label className="span-2"><span>Healthcheck URL</span><input value={adapterForm.healthcheckUrl} onChange={(event) => setAdapterForm({ ...adapterForm, healthcheckUrl: event.target.value })} placeholder="https://api.product.imds24.com/health" /></label>
            <label><span>Auth mode</span><select value={adapterForm.authMode} onChange={(event) => setAdapterForm({ ...adapterForm, authMode: event.target.value as ProductAuthMode })}><option value="service_token">Service token</option><option value="oauth2">OAuth 2.0</option><option value="signed_request">Signed request</option><option value="none">Без авторизации</option></select></label>
            <label><span>Timeout, мс</span><input type="number" min="500" max="120000" step="100" value={adapterForm.timeoutMs} onChange={(event) => setAdapterForm({ ...adapterForm, timeoutMs: Number(event.target.value) })} /></label>
            <label className="span-2"><span>Secret reference</span><div className="input-with-icon"><KeyRound size={16} /><input value={adapterForm.secretReference} onChange={(event) => setAdapterForm({ ...adapterForm, secretReference: event.target.value })} placeholder="vault://imds/products/crm/production" /></div></label>
          </div></div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => adapterDialog.current?.close()}>Отмена</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <ServerCog size={17} />}{saving ? 'Сохранение...' : 'Сохранить адаптер'}</button></div>
        </form>
      </dialog>
    </>
  );
}
