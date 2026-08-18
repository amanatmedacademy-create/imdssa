import { useEffect, useMemo, useState } from 'react';
import { Boxes, Layers3, Search, SlidersHorizontal, Workflow } from 'lucide-react';
import type { Installation, Module, Organization, Product, User } from '../../controlCenter';
import { api, categoryLabels, EmptyState, Status } from '../../controlCenter';
import './modulesPage.css';

type CommercialModule = {
  id: string;
  code: string;
  name: string;
  category: string;
  commercial_role: 'module' | 'feature' | 'hidden';
  separately_sellable: boolean;
  prices: Record<string, string | number>;
  plan_count: number;
};

type ProductCommercial = { modules: CommercialModule[] };

type Props = {
  user: User;
  modules: Module[];
  products: Product[];
  organizations: Organization[];
  installations: Installation[];
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  onNavigateSync: () => void;
};

const money = (value: unknown) => value == null || value === '' ? '—' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value));

export function ModulesPage({ user, modules, products, organizations, installations, canManage, onChanged, onNavigateSync }: Props) {
  const [query, setQuery] = useState('');
  const [productId, setProductId] = useState('all');
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [commercial, setCommercial] = useState<Record<string, CommercialModule>>({});
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user.scope !== 'platform') { setCommercial({}); return; }
    let cancelled = false;
    Promise.all(products.map(async (product) => {
      try {
        const data = await api<ProductCommercial>(`/api/v1/products/${product.id}/commercial`);
        return data.modules;
      } catch {
        return [] as CommercialModule[];
      }
    })).then((groups) => {
      if (cancelled) return;
      const next: Record<string, CommercialModule> = {};
      for (const item of groups.flat()) next[item.id] = item;
      setCommercial(next);
    });
    return () => { cancelled = true; };
  }, [products, user.scope]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return modules.filter((item) => {
      if (productId !== 'all' && item.owner_product_id !== productId) return false;
      if (!needle) return true;
      return [item.name, item.code, item.category, item.owner_product_name].some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [modules, productId, query]);

  useEffect(() => {
    if (!filtered.length) { setSelectedModuleId(''); return; }
    if (!filtered.some((item) => item.id === selectedModuleId)) setSelectedModuleId(filtered[0].id);
  }, [filtered, selectedModuleId]);

  const selected = modules.find((item) => item.id === selectedModuleId) ?? null;
  const selectedInstallations = installations.filter((item) => item.module_id === selectedModuleId);
  const selectedCommercial = selected ? commercial[selected.id] : undefined;
  const activeInstallations = selectedInstallations.filter((item) => item.status === 'active').length;
  const runtimeMismatch = selectedInstallations.filter((item) => item.actual_enabled != null && (item.status === 'active') !== item.actual_enabled).length;
  const unhealthy = selectedInstallations.filter((item) => !['healthy', 'unknown'].includes(item.health)).length;

  const toggleInstallation = async (installation: Installation) => {
    if (!canManage) return;
    setBusyId(installation.id); setError('');
    try {
      const nextStatus = installation.status === 'active' ? 'suspended' : 'active';
      await api(`/api/v1/installations/${installation.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка изменения модуля');
    } finally { setBusyId(''); }
  };

  const totalActive = installations.filter((item) => item.status === 'active').length;
  const totalMismatches = installations.filter((item) => item.actual_enabled != null && (item.status === 'active') !== item.actual_enabled).length;

  return <section className="modules-page">
    <div className="modules-kpis">
      <article><span>Каталог</span><strong>{modules.length}</strong><small>модулей</small></article>
      <article><span>Активные установки</span><strong>{totalActive}</strong><small>по организациям</small></article>
      <article className={totalMismatches ? 'warn' : ''}><span>Desired / actual</span><strong>{totalMismatches}</strong><small>{totalMismatches ? 'расхождений' : 'совпадает'}</small></article>
      <article><span>Продукты</span><strong>{products.length}</strong><small>владельцев модулей</small></article>
    </div>

    <div className="modules-toolbar">
      <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, код, категория…" /></label>
      <label className="modules-filter"><SlidersHorizontal size={15} /><select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="all">Все продукты</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <button type="button" onClick={onNavigateSync}><Workflow size={15} />Синхронизация</button>
    </div>

    {error && <div className="vps-error">API: {error}</div>}

    <div className="modules-workspace">
      <div className="modules-list-panel">
        <div className="modules-panel-head"><div><span>MODULE CATALOG</span><h2>Модули</h2></div><small>{filtered.length} записей</small></div>
        {!filtered.length ? <EmptyState title="Модули не найдены" text="Измените фильтр или поисковый запрос." /> : <div className="modules-list">{filtered.map((item) => {
          const itemInstallations = installations.filter((installation) => installation.module_id === item.id);
          const active = itemInstallations.filter((installation) => installation.status === 'active').length;
          const mismatch = itemInstallations.some((installation) => installation.actual_enabled != null && (installation.status === 'active') !== installation.actual_enabled);
          return <button type="button" key={item.id} className={selectedModuleId === item.id ? 'active' : ''} onClick={() => setSelectedModuleId(item.id)}>
            <div className="modules-list-icon"><Layers3 size={17} /></div>
            <div><strong>{item.name}</strong><span>{item.code}</span><small>{item.owner_product_name || 'Без продукта'} · {categoryLabels[item.category] || item.category || 'Без категории'}</small></div>
            <div className="modules-list-state"><Status value={item.status} /><small>{active} актив.</small>{mismatch && <i title="Desired/actual mismatch" />}</div>
          </button>;
        })}</div>}
      </div>

      <div className="modules-detail-panel">
        {!selected ? <EmptyState title="Выберите модуль" text="Справа появятся установки, entitlement и коммерческие параметры." /> : <>
          <div className="modules-detail-head"><div><span>МОДУЛЬ</span><h2>{selected.name}</h2><p>{selected.code} · {selected.owner_product_name || 'Без продукта'}</p></div><Status value={selected.status} /></div>

          <div className="modules-facts">
            <div><span>Категория</span><strong>{categoryLabels[selected.category] || selected.category || '—'}</strong></div>
            <div><span>Версия</span><strong>{selected.current_version || '—'}</strong></div>
            <div><span>Установки</span><strong>{selectedInstallations.length}</strong></div>
            <div><span>Активные</span><strong>{activeInstallations}</strong></div>
            <div className={runtimeMismatch ? 'warn' : ''}><span>Mismatch</span><strong>{runtimeMismatch}</strong></div>
            <div className={unhealthy ? 'warn' : ''}><span>Health issues</span><strong>{unhealthy}</strong></div>
          </div>

          <div className="modules-section">
            <div className="modules-section-head"><div><Boxes size={16} /><span><strong>Коммерческая роль</strong><small>Как модуль продаётся внутри продукта</small></span></div></div>
            {user.scope !== 'platform' ? <div className="modules-section-empty">Коммерческие настройки доступны только platform-admin.</div> : !selectedCommercial ? <div className="modules-section-empty">Для этого модуля коммерческая конфигурация не задана.</div> : <div className="modules-commercial">
              <div><span>Role</span><strong>{selectedCommercial.commercial_role === 'module' ? 'Коммерческий модуль' : selectedCommercial.commercial_role === 'feature' ? 'Функция модуля' : 'Скрыт'}</strong></div>
              <div><span>Отдельная продажа</span><strong>{selectedCommercial.separately_sellable ? 'Да' : 'Нет'}</strong></div>
              <div><span>Тарифов</span><strong>{selectedCommercial.plan_count}</strong></div>
              {[1, 3, 6, 12].map((months) => <div key={months}><span>{months} мес.</span><strong>{money(selectedCommercial.prices?.[String(months)])}</strong></div>)}
            </div>}
          </div>

          <div className="modules-section">
            <div className="modules-section-head"><div><Layers3 size={16} /><span><strong>Установки по организациям</strong><small>Desired state, runtime и здоровье</small></span></div></div>
            {!selectedInstallations.length ? <div className="modules-section-empty">Модуль пока не установлен ни в одной организации.</div> : <div className="modules-installations">{selectedInstallations.map((installation) => {
              const organization = organizations.find((item) => item.id === installation.organization_id);
              const matches = installation.actual_enabled == null || (installation.status === 'active') === installation.actual_enabled;
              return <div key={installation.id}>
                <div><strong>{organization?.name || installation.organization_name}</strong><span>{installation.host_product_name}</span></div>
                <div><span>Desired</span><Status value={installation.status} /></div>
                <div><span>Actual</span><Status value={installation.actual_enabled == null ? 'unknown' : installation.actual_enabled ? 'active' : 'suspended'} /></div>
                <div><span>Health</span><Status value={installation.health || 'unknown'} /></div>
                <div><span>Revision</span><strong>{installation.last_applied_revision ?? 0}</strong></div>
                <div className={matches ? 'match' : 'mismatch'}>{matches ? 'Совпадает' : 'Расхождение'}</div>
                {canManage && <button type="button" disabled={busyId === installation.id} onClick={() => void toggleInstallation(installation)}>{installation.status === 'active' ? 'Отключить' : 'Включить'}</button>}
              </div>;
            })}</div>}
          </div>
        </>}
      </div>
    </div>
  </section>;
}
