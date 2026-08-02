import { useMemo, useState } from 'react';
import { Activity, Boxes, CheckCircle2, CirclePause, Play, RefreshCw, RotateCcw, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { useModuleRuntime } from './ModuleRuntimeContext';
import type { CompatibilityPreview, ModuleInstallation } from './moduleRuntimeRepository';

const money = new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });
const statusLabels: Record<ModuleInstallation['status'], string> = {
  validating: 'Проверка', provisioning: 'Установка', active: 'Активен', read_only: 'Только чтение',
  suspended: 'Приостановлен', failed: 'Ошибка', archived: 'Архив',
};

export function ModulesPage() {
  const runtime = useModuleRuntime();
  const [organizationId, setOrganizationId] = useState('org-amanat-medical-center');
  const [moduleCode, setModuleCode] = useState('crm.kanban');
  const [hostProductCode, setHostProductCode] = useState('imds-marketing');
  const [route, setRoute] = useState('/crm/kanban');
  const [preview, setPreview] = useState<CompatibilityPreview | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const selectedModule = runtime.modules.find((item) => item.code === moduleCode) ?? runtime.modules[0];
  const visibleInstallations = useMemo(() => runtime.installations
    .filter((item) => !organizationId || item.organizationId === organizationId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [runtime.installations, organizationId]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setNotice('');
    try { await action(); setNotice(success); }
    catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Операция не выполнена.'); }
    finally { setBusy(''); }
  };

  const updateModule = (value: string) => {
    setModuleCode(value);
    const next = runtime.modules.find((item) => item.code === value);
    if (next) { setHostProductCode(next.compatibleHostProducts[0]?.code ?? ''); setRoute(next.defaultRoute); }
    setPreview(null);
  };

  return <div className="modules-page">
    <div className="page-heading">
      <div><span className="eyebrow">Platform Runtime</span><h1>Модули и установки</h1><p>Полный локальный сценарий без Supabase: preview, install, bootstrap, authorize, suspend и resume.</p></div>
      <button className="secondary-button" onClick={() => void run('reset', runtime.reset, 'Локальный runtime сброшен.')} disabled={Boolean(busy)}><RotateCcw size={16}/> Сбросить демо</button>
    </div>

    {notice && <div className="mode-banner"><ShieldCheck size={18}/><div><strong>Runtime</strong><span>{notice}</span></div></div>}

    <section className="module-runtime-grid">
      <article className="panel module-install-card">
        <div className="panel-header"><div><h2>Подключить модуль</h2><p>Совместимость проверяется до создания installation.</p></div><Boxes size={20}/></div>
        <label>Компания<select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setPreview(null); }}>{runtime.organizations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.city}</option>)}</select></label>
        <label>Модуль<select value={moduleCode} onChange={(event) => updateModule(event.target.value)}>{runtime.modules.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <label>Host-продукт<select value={hostProductCode} onChange={(event) => { setHostProductCode(event.target.value); setPreview(null); }}>{selectedModule.compatibleHostProducts.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <label>Route<input value={route} onChange={(event) => { setRoute(event.target.value); setPreview(null); }}/></label>
        <div className="module-actions">
          <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void run('preview', async () => setPreview(await runtime.preview({ organizationId, moduleCode, hostProductCode, route })), 'Проверка совместимости завершена.')}><Activity size={16}/> Проверить</button>
          <button className="primary-button" disabled={Boolean(busy) || preview?.compatible !== true} onClick={() => void run('install', () => runtime.install({ organizationId, moduleCode, hostProductCode, route, idempotencyKey: crypto.randomUUID() }), 'Модуль установлен и активирован.')}><CheckCircle2 size={16}/> Подключить</button>
        </div>
        {preview && <div className={`compatibility-result ${preview.compatible ? 'ok' : 'error'}`}><strong>{preview.compatible ? 'Совместимо' : 'Подключение заблокировано'}</strong><span>Версия {preview.selectedVersion} · {money.format(preview.monthlyAmountMinor / 100)}/мес.</span>{preview.errors.map((item) => <small key={item}>{item}</small>)}{preview.warnings.map((item) => <small key={item}>{item}</small>)}</div>}
      </article>

      <article className="panel module-catalog-card">
        <div className="panel-header"><div><h2>Каталог</h2><p>{runtime.modules.length} модулей</p></div></div>
        <div className="module-catalog-list">{runtime.modules.map((item) => <button key={item.code} className={item.code === moduleCode ? 'active' : ''} onClick={() => updateModule(item.code)}><div><strong>{item.name}</strong><span>{item.code} · {item.ownerProductName}</span></div><b>{money.format(item.price.monthlyAmountMinor / 100)}</b><small>{item.compatibleHostProducts.map((host) => host.name).join(', ')}</small></button>)}</div>
      </article>
    </section>

    <section className="panel installations-panel">
      <div className="panel-header"><div><h2>Installations</h2><p>Состояние сохраняется в localStorage.</p></div><button className="icon-button" onClick={() => void runtime.refresh()}><RefreshCw size={16}/></button></div>
      <div className="installation-list">{visibleInstallations.length === 0 ? <div className="empty-state">Установок нет</div> : visibleInstallations.map((installation) => <article key={installation.id}>
        <div className="installation-main"><div><strong>{installation.moduleName}</strong><span>{installation.hostProductName} · {installation.route}</span></div><span className={`status ${installation.status === 'active' ? 'ok' : installation.status === 'suspended' ? 'warn' : 'muted'}`}>{statusLabels[installation.status]}</span></div>
        <div className="installation-meta"><span>v{installation.moduleVersion}</span><span>Health: {installation.healthStatus}</span><span>Revision: {installation.revision}</span><span>Workspace: {installation.workspaceId ?? '—'}</span></div>
        <div className="installation-actions">
          {installation.status === 'active' && <button onClick={() => void run(installation.id, () => runtime.suspend(installation.id), 'Модуль приостановлен.')} disabled={Boolean(busy)}><CirclePause size={15}/> Suspend</button>}
          {installation.status === 'suspended' && <button onClick={() => void run(installation.id, () => runtime.resume(installation.id), 'Модуль снова активен.')} disabled={Boolean(busy)}><Play size={15}/> Resume</button>}
          {installation.status !== 'archived' && <button onClick={() => void run(installation.id, () => runtime.repair(installation.id), 'Repair завершён.')} disabled={Boolean(busy)}><Wrench size={15}/> Repair</button>}
          {installation.status !== 'archived' && <button className="danger" onClick={() => void run(installation.id, () => runtime.uninstall(installation.id), 'Installation архивирована.')} disabled={Boolean(busy)}><Trash2 size={15}/> Uninstall</button>}
        </div>
        {installation.events[0] && <small className="installation-event">{installation.events[0].message}</small>}
      </article>)}</div>
    </section>
  </div>;
}
