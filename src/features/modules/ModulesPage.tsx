import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  CirclePause,
  PackageOpen,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useModuleRuntime } from './ModuleRuntimeContext';
import type {
  CompatibilityPreview,
  ModuleInstallation,
  PlatformModuleDefinition,
} from './moduleRuntimeRepository';

const money = new Intl.NumberFormat('ru-KZ', {
  style: 'currency',
  currency: 'KZT',
  maximumFractionDigits: 0,
});

const statusLabels: Record<ModuleInstallation['status'], string> = {
  validating: 'Проверка',
  provisioning: 'Установка',
  active: 'Активен',
  read_only: 'Только чтение',
  suspended: 'Приостановлен',
  failed: 'Ошибка',
  archived: 'Архив',
};

type ProductModuleCatalog = {
  code: string;
  name: string;
  modules: PlatformModuleDefinition[];
};

export function ModulesPage() {
  const runtime = useModuleRuntime();
  const [organizationId, setOrganizationId] = useState('org-amanat-medical-center');
  const [selectedProductCode, setSelectedProductCode] = useState('imds-crm');
  const [moduleCode, setModuleCode] = useState('crm.kanban');
  const [hostProductCode, setHostProductCode] = useState('imds-marketing');
  const [route, setRoute] = useState('/crm/kanban');
  const [preview, setPreview] = useState<CompatibilityPreview | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const productCatalog = useMemo<ProductModuleCatalog[]>(() => {
    const grouped = new Map<string, ProductModuleCatalog>();

    runtime.modules.forEach((module) => {
      const current = grouped.get(module.ownerProductCode);
      if (current) {
        current.modules.push(module);
        return;
      }

      grouped.set(module.ownerProductCode, {
        code: module.ownerProductCode,
        name: module.ownerProductName,
        modules: [module],
      });
    });

    return [...grouped.values()].sort((left, right) => {
      if (left.code === 'imds-crm') return -1;
      if (right.code === 'imds-crm') return 1;
      return left.name.localeCompare(right.name, 'ru');
    });
  }, [runtime.modules]);

  const selectedProduct = productCatalog.find((product) => product.code === selectedProductCode)
    ?? productCatalog[0];
  const selectedModule = selectedProduct?.modules.find((module) => module.code === moduleCode)
    ?? selectedProduct?.modules[0]
    ?? runtime.modules[0];

  const visibleInstallations = useMemo(() => {
    const moduleCodes = new Set(selectedProduct?.modules.map((module) => module.code) ?? []);
    return runtime.installations
      .filter((installation) => (!organizationId || installation.organizationId === organizationId)
        && moduleCodes.has(installation.moduleCode))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [runtime.installations, organizationId, selectedProduct]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setNotice('');
    try {
      await action();
      setNotice(success);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Операция не выполнена.');
    } finally {
      setBusy('');
    }
  };

  const updateModule = (value: string) => {
    const next = runtime.modules.find((module) => module.code === value);
    if (!next) return;
    setModuleCode(next.code);
    setHostProductCode(next.compatibleHostProducts[0]?.code ?? '');
    setRoute(next.defaultRoute);
    setPreview(null);
  };

  const openProductCatalog = (product: ProductModuleCatalog) => {
    setSelectedProductCode(product.code);
    const firstModule = product.modules[0];
    if (firstModule) updateModule(firstModule.code);
  };

  if (!selectedProduct || !selectedModule) {
    return <div className="empty-state"><PackageOpen size={34}/><h2>Каталог модулей пуст</h2></div>;
  }

  const selectedVersion = selectedModule.versions.find((version) => version.channel === 'stable' && version.status === 'published')
    ?? selectedModule.versions.find((version) => version.status === 'published');

  return <div className="modules-page">
    <div className="page-heading">
      <div>
        <span className="eyebrow">Product Module Catalog</span>
        <h1>Каталог продуктов и модулей</h1>
        <p>Сначала выберите продукт-владелец, затем его модуль и продукт, куда модуль нужно подключить.</p>
      </div>
      <button
        className="secondary-button"
        onClick={() => void run('reset', runtime.reset, 'Локальный каталог и installations сброшены.')}
        disabled={Boolean(busy)}
      >
        <RotateCcw size={16}/> Сбросить демо
      </button>
    </div>

    {notice && <div className="mode-banner">
      <ShieldCheck size={18}/>
      <div><strong>Каталог</strong><span>{notice}</span></div>
    </div>}

    <section className="owner-product-catalog" aria-label="Каталоги продуктов">
      {productCatalog.map((product) => {
        const moduleCodes = new Set(product.modules.map((module) => module.code));
        const activeInstallations = runtime.installations.filter((installation) =>
          installation.status !== 'archived' && moduleCodes.has(installation.moduleCode)).length;
        const minimumPrice = Math.min(...product.modules.map((module) => module.price.monthlyAmountMinor));

        return <button
          key={product.code}
          className={product.code === selectedProduct.code ? 'owner-product-card active' : 'owner-product-card'}
          onClick={() => openProductCatalog(product)}
        >
          <div className="owner-product-icon"><Boxes size={21}/></div>
          <div className="owner-product-copy">
            <span>Каталог продукта</span>
            <strong>{product.name}</strong>
            <small>{product.modules.length} модулей · от {money.format(minimumPrice / 100)}/мес.</small>
          </div>
          <div className="owner-product-meta">
            <b>{activeInstallations}</b>
            <span>подключено</span>
            <ArrowRight size={17}/>
          </div>
        </button>;
      })}
    </section>

    <section className="selected-product-heading">
      <div className="selected-product-symbol"><PackageOpen size={24}/></div>
      <div>
        <span>Продукт-владелец</span>
        <h2>{selectedProduct.name}</h2>
        <p>Выберите модуль из каталога {selectedProduct.name}. После выбора справа задаются компания и host-продукт.</p>
      </div>
      <div className="selected-product-count"><strong>{selectedProduct.modules.length}</strong><span>модулей</span></div>
    </section>

    <section className="module-runtime-grid">
      <article className="panel module-catalog-card">
        <div className="panel-header">
          <div><h2>Модули {selectedProduct.name}</h2><p>Каждый модуль имеет собственную цену, версию и список совместимых продуктов.</p></div>
        </div>

        <div className="module-catalog-list">
          {selectedProduct.modules.map((module) => {
            const version = module.versions.find((item) => item.channel === 'stable' && item.status === 'published')
              ?? module.versions.find((item) => item.status === 'published');
            return <button
              key={module.code}
              className={module.code === selectedModule.code ? 'active' : ''}
              onClick={() => updateModule(module.code)}
            >
              <div className="module-catalog-main">
                <span>{module.category}</span>
                <strong>{module.name}</strong>
                <p>{module.description}</p>
              </div>
              <div className="module-catalog-price">
                <b>{money.format(module.price.monthlyAmountMinor / 100)}</b>
                <span>в месяц</span>
              </div>
              <div className="module-catalog-footer">
                <small>{module.code} · v{version?.version ?? '—'}</small>
                <small>Можно подключить: {module.compatibleHostProducts.map((host) => host.name).join(', ')}</small>
              </div>
            </button>;
          })}
        </div>
      </article>

      <article className="panel module-install-card">
        <div className="panel-header">
          <div><h2>Подключить выбранный модуль</h2><p>Модуль берётся из каталога {selectedProduct.name}.</p></div>
          <CheckCircle2 size={20}/>
        </div>

        <div className="selected-module-summary">
          <div><span>Выбранный модуль</span><strong>{selectedModule.name}</strong><small>{selectedModule.code} · v{selectedVersion?.version ?? '—'}</small></div>
          <b>{money.format(selectedModule.price.monthlyAmountMinor / 100)}/мес.</b>
        </div>

        <label>
          Компания
          <select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setPreview(null); }}>
            {runtime.organizations.map((organization) => <option key={organization.id} value={organization.id}>
              {organization.name} · {organization.city}
            </option>)}
          </select>
        </label>

        <label>
          Подключить в продукт
          <select value={hostProductCode} onChange={(event) => { setHostProductCode(event.target.value); setPreview(null); }}>
            {selectedModule.compatibleHostProducts.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}
          </select>
        </label>

        <label>
          Route
          <input value={route} onChange={(event) => { setRoute(event.target.value); setPreview(null); }}/>
        </label>

        <div className="module-permissions-preview">
          <span>Permissions</span>
          <div>{selectedModule.permissions.map((permission) => <small key={permission}>{permission}</small>)}</div>
        </div>

        <div className="module-actions">
          <button
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() => void run('preview', async () => {
              setPreview(await runtime.preview({
                organizationId,
                moduleCode: selectedModule.code,
                hostProductCode,
                route,
              }));
            }, 'Проверка совместимости завершена.')}
          >
            <Activity size={16}/> Проверить
          </button>
          <button
            className="primary-button"
            disabled={Boolean(busy) || preview?.compatible !== true}
            onClick={() => void run('install', () => runtime.install({
              organizationId,
              moduleCode: selectedModule.code,
              hostProductCode,
              route,
              idempotencyKey: crypto.randomUUID(),
            }), `${selectedModule.name} установлен и активирован.`)}
          >
            <CheckCircle2 size={16}/> Подключить
          </button>
        </div>

        {preview && <div className={`compatibility-result ${preview.compatible ? 'ok' : 'error'}`}>
          <strong>{preview.compatible ? 'Совместимо' : 'Подключение заблокировано'}</strong>
          <span>Версия {preview.selectedVersion} · {money.format(preview.monthlyAmountMinor / 100)}/мес.</span>
          {preview.errors.map((error) => <small key={error}>{error}</small>)}
          {preview.warnings.map((warning) => <small key={warning}>{warning}</small>)}
        </div>}
      </article>
    </section>

    <section className="panel installations-panel">
      <div className="panel-header">
        <div><h2>Подключения из {selectedProduct.name}</h2><p>Показаны installations выбранной компании и модулей текущего каталога.</p></div>
        <button className="icon-button" onClick={() => void runtime.refresh()}><RefreshCw size={16}/></button>
      </div>

      <div className="installation-list">
        {visibleInstallations.length === 0
          ? <div className="empty-state">У компании пока нет подключённых модулей из {selectedProduct.name}</div>
          : visibleInstallations.map((installation) => <article key={installation.id}>
            <div className="installation-main">
              <div><strong>{installation.moduleName}</strong><span>{installation.hostProductName} · {installation.route}</span></div>
              <span className={`status ${installation.status === 'active' ? 'ok' : installation.status === 'suspended' ? 'warn' : 'muted'}`}>
                {statusLabels[installation.status]}
              </span>
            </div>
            <div className="installation-meta">
              <span>v{installation.moduleVersion}</span>
              <span>Health: {installation.healthStatus}</span>
              <span>Revision: {installation.revision}</span>
              <span>Workspace: {installation.workspaceId ?? '—'}</span>
            </div>
            <div className="installation-actions">
              {installation.status === 'active' && <button
                onClick={() => void run(installation.id, () => runtime.suspend(installation.id), 'Модуль приостановлен.')}
                disabled={Boolean(busy)}
              ><CirclePause size={15}/> Suspend</button>}
              {installation.status === 'suspended' && <button
                onClick={() => void run(installation.id, () => runtime.resume(installation.id), 'Модуль снова активен.')}
                disabled={Boolean(busy)}
              ><Play size={15}/> Resume</button>}
              {installation.status !== 'archived' && <button
                onClick={() => void run(installation.id, () => runtime.repair(installation.id), 'Repair завершён.')}
                disabled={Boolean(busy)}
              ><Wrench size={15}/> Repair</button>}
              {installation.status !== 'archived' && <button
                className="danger"
                onClick={() => void run(installation.id, () => runtime.uninstall(installation.id), 'Installation архивирована.')}
                disabled={Boolean(busy)}
              ><Trash2 size={15}/> Uninstall</button>}
            </div>
            {installation.events[0] && <small className="installation-event">{installation.events[0].message}</small>}
          </article>)}
      </div>
    </section>
  </div>;
}
