import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCcw, Search, Workflow } from 'lucide-react';
import type { ControlCommand, OrganizationProduct } from '../../controlCenter';
import { api, EmptyState, Status } from '../../controlCenter';
import './syncPage.css';

type Props = {
  organizationProducts: OrganizationProduct[];
  commands: ControlCommand[];
  canManage: boolean;
  onChanged: () => Promise<void> | void;
};

const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('ru-RU') : '—';
const keyOf = (item: OrganizationProduct) => `${item.organization_id}:${item.product_id}`;

export function SyncPage({ organizationProducts, commands, canManage, onChanged }: Props) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [selectedKey, setSelectedKey] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');

  const productOptions = useMemo(() => {
    const map = new Map<string, string>();
    organizationProducts.forEach((item) => map.set(item.product_code, item.product_name));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [organizationProducts]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return organizationProducts.filter((item) => {
      const status = item.sync_status || 'pending';
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (productFilter !== 'all' && item.product_code !== productFilter) return false;
      if (!needle) return true;
      return [item.organization_name, item.product_name, item.product_code, item.remote_tenant_id, item.last_error]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [organizationProducts, productFilter, query, statusFilter]);

  useEffect(() => {
    if (!filtered.length) { setSelectedKey(''); return; }
    if (!filtered.some((item) => keyOf(item) === selectedKey)) setSelectedKey(keyOf(filtered[0]));
  }, [filtered, selectedKey]);

  const selected = organizationProducts.find((item) => keyOf(item) === selectedKey) || null;
  const selectedCommands = useMemo(() => {
    if (!selected) return [];
    return commands
      .filter((item) => item.organization_name === selected.organization_name && item.product_code === selected.product_code)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [commands, selected]);

  const synced = organizationProducts.filter((item) => item.sync_status === 'synced').length;
  const pending = organizationProducts.filter((item) => ['pending', 'applying'].includes(item.sync_status || 'pending')).length;
  const failed = organizationProducts.filter((item) => item.sync_status === 'failed').length;
  const lagging = organizationProducts.filter((item) => Number(item.desired_revision || 0) !== Number(item.actual_revision || 0)).length;
  const commandFailures = commands.filter((item) => item.status === 'failed').length;

  const retry = async (item: OrganizationProduct) => {
    if (!canManage) return;
    const key = keyOf(item);
    setBusyKey(key); setError('');
    try {
      await api('/api/v1/organization-products', {
        method: 'POST',
        body: JSON.stringify({ organizationId: item.organization_id, productId: item.product_id, status: item.status, config: {} }),
      });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка повторной синхронизации');
    } finally { setBusyKey(''); }
  };

  const retryAllFailed = async () => {
    if (!canManage) return;
    const items = organizationProducts.filter((item) => item.sync_status === 'failed');
    if (!items.length) return;
    setBusyKey('all'); setError('');
    try {
      for (const item of items) {
        await api('/api/v1/organization-products', {
          method: 'POST',
          body: JSON.stringify({ organizationId: item.organization_id, productId: item.product_id, status: item.status, config: {} }),
        });
      }
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка массового повтора');
    } finally { setBusyKey(''); }
  };

  return <section className="sync-page">
    <div className="sync-kpis">
      <article><span>Bindings</span><strong>{organizationProducts.length}</strong><small>organization → product</small></article>
      <article><span>Синхронизировано</span><strong>{synced}</strong><small>desired = actual</small></article>
      <article className={pending ? 'warn' : ''}><span>В очереди</span><strong>{pending}</strong><small>pending / applying</small></article>
      <article className={failed ? 'danger' : ''}><span>Ошибки</span><strong>{failed}</strong><small>bindings failed</small></article>
      <article className={lagging ? 'warn' : ''}><span>Revision lag</span><strong>{lagging}</strong><small>desired ≠ actual</small></article>
      <article className={commandFailures ? 'danger' : ''}><span>Failed commands</span><strong>{commandFailures}</strong><small>в последних 100 командах</small></article>
    </div>

    <div className="sync-toolbar">
      <label><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Организация, продукт, tenant, ошибка…"/></label>
      <label><Workflow size={15}/><select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}><option value="all">Все продукты</option>{productOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label><Clock3 size={15}/><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Все статусы</option><option value="synced">Synced</option><option value="pending">Pending</option><option value="applying">Applying</option><option value="failed">Failed</option></select></label>
      {canManage && failed > 0 && <button type="button" className="danger" disabled={Boolean(busyKey)} onClick={() => void retryAllFailed()}><RefreshCcw size={15}/>{busyKey === 'all' ? 'Повтор…' : 'Повторить все ошибки'}</button>}
    </div>

    {error && <div className="vps-error">API: {error}</div>}

    <div className="sync-workspace">
      <div className="sync-list-panel">
        <div className="sync-panel-head"><div><span>DESIRED / ACTUAL</span><h2>Состояние синхронизации</h2></div><small>{filtered.length} связей</small></div>
        {!filtered.length ? <EmptyState title="Нет данных" text="По выбранным фильтрам bindings не найдены."/> : <div className="sync-list">{filtered.map((item) => {
          const key = keyOf(item);
          const desired = Number(item.desired_revision || 0);
          const actual = Number(item.actual_revision || 0);
          const mismatch = desired !== actual;
          return <button key={key} type="button" className={selectedKey === key ? 'active' : ''} onClick={() => setSelectedKey(key)}>
            <div className={`sync-icon ${item.sync_status || 'pending'}`}>{item.sync_status === 'synced' ? <CheckCircle2 size={17}/> : item.sync_status === 'failed' ? <AlertTriangle size={17}/> : <Workflow size={17}/>}</div>
            <div><strong>{item.organization_name}</strong><span>{item.product_name} · {item.product_code}</span><small>{item.remote_tenant_id || 'tenant mapping не задан'}</small></div>
            <div className="sync-list-meta"><Status value={item.sync_status || 'pending'}/><small className={mismatch ? 'mismatch' : ''}>rev {actual} / {desired}</small></div>
          </button>;
        })}</div>}
      </div>

      <div className="sync-detail-panel">
        {!selected ? <EmptyState title="Выберите binding" text="Справа появятся revision, ошибка и история команд."/> : <>
          <div className="sync-detail-head"><div><span>PRODUCT TENANT BINDING</span><h2>{selected.organization_name}</h2><p>{selected.product_name} · {selected.product_code}</p></div><div><Status value={selected.sync_status || 'pending'}/>{canManage && <button type="button" disabled={Boolean(busyKey)} onClick={() => void retry(selected)}><RefreshCcw size={14}/>{busyKey === keyOf(selected) ? 'Создаю revision…' : 'Повторить синхронизацию'}</button>}</div></div>

          <div className="sync-revision-card">
            <div><span>Desired revision</span><strong>{selected.desired_revision ?? 0}</strong><small>источник истины Control Center</small></div>
            <div className="sync-revision-arrow">→</div>
            <div><span>Actual revision</span><strong>{selected.actual_revision ?? 0}</strong><small>подтверждено продуктом</small></div>
            <div className={Number(selected.desired_revision || 0) === Number(selected.actual_revision || 0) ? 'sync-match' : 'sync-mismatch'}>{Number(selected.desired_revision || 0) === Number(selected.actual_revision || 0) ? 'Совпадает' : `Lag ${Math.max(0, Number(selected.desired_revision || 0) - Number(selected.actual_revision || 0))}`}</div>
          </div>

          <div className="sync-facts">
            <div><span>Remote tenant</span><strong>{selected.remote_tenant_id || 'Не сопоставлен'}</strong></div>
            <div><span>Product access</span><Status value={selected.status}/></div>
            <div><span>Last sync</span><strong>{date(selected.last_sync_at)}</strong></div>
            <div><span>Command history</span><strong>{selectedCommands.length}</strong></div>
          </div>

          {selected.last_error && <div className="sync-error-card"><AlertTriangle size={18}/><div><span>ПОСЛЕДНЯЯ ОШИБКА</span><strong>{selected.last_error}</strong><small>После ручного retry создаётся новая desired revision; старый failed command остаётся в истории.</small></div></div>}

          <div className="sync-history">
            <div className="sync-section-head"><div><Workflow size={16}/><span><strong>История control commands</strong><small>Последние команды для этой организации и продукта</small></span></div></div>
            {!selectedCommands.length ? <EmptyState title="Команд пока нет" text="После изменения entitlement здесь появится sync_entitlements."/> : <div className="sync-command-list">{selectedCommands.map((command) => <article key={command.id}>
              <div><strong>{command.command_type}</strong><span>rev {command.desired_revision}</span></div>
              <Status value={command.status}/>
              <div><span>Attempts</span><strong>{command.attempts}</strong></div>
              <div><span>Создана</span><strong>{date(command.created_at)}</strong></div>
              <div><span>Завершена</span><strong>{date(command.completed_at)}</strong></div>
              {command.last_error && <p>{command.last_error}</p>}
            </article>)}</div>}
          </div>
        </>}
      </div>
    </div>
  </section>;
}
