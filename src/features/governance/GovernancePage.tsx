import { ArchiveRestore, DatabaseBackup, FileDown, FileLock2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../../core/auth';
import { useGovernance } from './GovernanceContext';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatBytes(value: number | null) {
  if (value === null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function statusClass(status: string) {
  if (['completed', 'verified', 'active', 'approved'].includes(status)) return 'ok';
  if (['pending_approval', 'queued', 'processing', 'release_pending'].includes(status)) return 'warn';
  if (['failed', 'critical', 'dead_letter'].includes(status)) return 'danger';
  return 'muted';
}

export function GovernancePage() {
  const { can, isDemo } = useAuth();
  const { policies, holds, exports, deletions, backups, restores, loading, saving, error, refresh, createExport, createDeletion, createRestore } = useGovernance();
  const [tab, setTab] = useState<'retention' | 'requests' | 'backups'>('retention');
  const canManage = can('governance.manage');

  const metrics = useMemo(() => ({
    activePolicies: policies.filter((item) => item.isActive).length,
    legalHolds: holds.filter((item) => ['active', 'release_pending'].includes(item.status)).length,
    pendingRequests: [...exports, ...deletions].filter((item) => ['pending_approval', 'queued', 'processing'].includes(item.status)).length,
    verifiedBackups: backups.filter((item) => item.status === 'verified').length,
  }), [policies, holds, exports, deletions, backups]);

  const addExport = async () => {
    const reason = window.prompt('Причина экспорта данных:');
    if (!reason || reason.trim().length < 10) return;
    await createExport({ organizationName: 'Amanat Medical Center', productName: 'IMDS CRM', reason: reason.trim(), format: 'zip' });
  };

  const addDeletion = async () => {
    const reason = window.prompt('Причина удаления или анонимизации данных:');
    if (!reason || reason.trim().length < 10) return;
    await createDeletion({ organizationName: 'Amanat Medical Center', productName: 'IMDS CRM', reason: reason.trim(), mode: 'anonymize' });
  };

  const addRestore = async () => {
    const reason = window.prompt('Причина restore operation:');
    if (!reason || reason.trim().length < 10) return;
    await createRestore({ productName: 'IMDS CRM', environment: 'staging', reason: reason.trim(), dryRun: true });
  };

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Data Governance</span><h1>Управление данными и восстановлением</h1><p>Retention, legal hold, экспорт, удаление, backup registry, restore и disaster recovery.</p></div>
      <div className="heading-actions"><button className="secondary-button compact" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw size={16} className={loading ? 'spin' : ''}/> Обновить</button></div>
    </div>

    {isDemo && <div className="mode-banner"><ShieldCheck size={18}/><div><strong>Демо-режим Data Governance</strong><span>Production-операции выполняются только через Supabase RPC, Security Approval Center и доверенные workers.</span></div></div>}
    {error && <div className="error-banner">{error}</div>}

    <section className="metrics governance-metrics">
      <article className="metric-card"><div className="metric-icon"><FileLock2 size={21}/></div><div><span>Retention policies</span><strong>{metrics.activePolicies}</strong><small>активных политик</small></div></article>
      <article className="metric-card"><div className="metric-icon"><ShieldCheck size={21}/></div><div><span>Legal holds</span><strong>{metrics.legalHolds}</strong><small>блокируют удаление</small></div></article>
      <article className="metric-card"><div className="metric-icon"><FileDown size={21}/></div><div><span>Запросы</span><strong>{metrics.pendingRequests}</strong><small>ожидают выполнения</small></div></article>
      <article className="metric-card"><div className="metric-icon"><DatabaseBackup size={21}/></div><div><span>Проверенные backup</span><strong>{metrics.verifiedBackups}</strong><small>готовы к restore</small></div></article>
    </section>

    <div className="tab-bar governance-tabs">
      <button className={tab === 'retention' ? 'active' : ''} onClick={() => setTab('retention')}>Retention и Legal Hold</button>
      <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>Экспорт и удаление</button>
      <button className={tab === 'backups' ? 'active' : ''} onClick={() => setTab('backups')}>Backup и Restore</button>
    </div>

    {tab === 'retention' && <section className="content-grid">
      <article className="panel span-2"><div className="panel-header"><div><h2>Retention policies</h2><p>Политика хранится в control plane, выполнение происходит внутри продукта.</p></div></div><div className="table-wrap"><table><thead><tr><th>Политика</th><th>Продукт</th><th>Классификация</th><th>Срок</th><th>Действие</th><th>Следующая проверка</th></tr></thead><tbody>{policies.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><span>{item.key}</span></td><td>{item.productName}</td><td>{item.classificationName}</td><td>{item.retentionDays} дней</td><td><span className={`status ${item.isActive ? 'ok' : 'muted'}`}>{item.action}</span></td><td>{formatDate(item.nextEvaluationAt)}</td></tr>)}</tbody></table></div></article>
      <article className="panel"><div className="panel-header"><div><h2>Legal hold</h2><p>Приоритетнее retention и deletion.</p></div></div><div className="governance-list">{holds.map((item) => <div className="governance-list-item" key={item.id}><div><strong>{item.organizationName}</strong><span>{item.productName}</span><p>{item.reason}</p></div><span className={`status ${statusClass(item.status)}`}>{item.status}</span></div>)}</div></article>
    </section>}

    {tab === 'requests' && <section className="content-grid">
      <article className="panel span-2"><div className="panel-header"><div><h2>Экспорт данных</h2><p>Restricted exports проходят независимое согласование.</p></div>{canManage && <button className="primary-button" onClick={() => void addExport()}><FileDown size={16}/> Запросить экспорт</button>}</div><div className="table-wrap"><table><thead><tr><th>Компания</th><th>Продукт</th><th>Классификация</th><th>Формат</th><th>Статус</th><th>Создан</th></tr></thead><tbody>{exports.map((item) => <tr key={item.id}><td><strong>{item.organizationName}</strong><span>{item.reason}</span></td><td>{item.productName}</td><td>{item.classificationName}</td><td>{item.format}</td><td><span className={`status ${statusClass(item.status)}`}>{item.status}</span></td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div></article>
      <article className="panel"><div className="panel-header"><div><h2>Удаление</h2><p>Legal hold проверяется повторно перед выполнением.</p></div>{canManage && <button className="danger-button" onClick={() => void addDeletion()}><Trash2 size={16}/> Запросить</button>}</div><div className="governance-list">{deletions.map((item) => <div className="governance-list-item" key={item.id}><div><strong>{item.organizationName}</strong><span>{item.productName} · {item.mode}</span><p>{item.reason}</p></div><span className={`status ${statusClass(item.status)}`}>{item.status}</span></div>)}</div></article>
    </section>}

    {tab === 'backups' && <section className="content-grid">
      <article className="panel span-2"><div className="panel-header"><div><h2>Backup Registry</h2><p>Super Admin хранит метаданные; backup bytes остаются во внешнем хранилище.</p></div></div><div className="table-wrap"><table><thead><tr><th>Продукт</th><th>Environment</th><th>Тип</th><th>Провайдер</th><th>Размер</th><th>Статус</th><th>Проверен</th></tr></thead><tbody>{backups.map((item) => <tr key={item.id}><td><strong>{item.productName}</strong></td><td>{item.environment}</td><td>{item.backupType}</td><td>{item.provider}</td><td>{formatBytes(item.sizeBytes)}</td><td><span className={`status ${statusClass(item.status)}`}>{item.status}</span></td><td>{formatDate(item.verifiedAt)}</td></tr>)}</tbody></table></div></article>
      <article className="panel"><div className="panel-header"><div><h2>Restore operations</h2><p>Production restore требует two-person approval.</p></div>{canManage && <button className="primary-button" onClick={() => void addRestore()}><ArchiveRestore size={16}/> Dry-run restore</button>}</div><div className="governance-list">{restores.map((item) => <div className="governance-list-item" key={item.id}><div><strong>{item.productName}</strong><span>{item.targetEnvironment} · {item.dryRun ? 'dry-run' : 'restore'}</span><p>{item.reason}</p></div><span className={`status ${statusClass(item.status)}`}>{item.status}</span></div>)}</div></article>
    </section>}
  </>;
}
