import {
  Activity,
  Ban,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  CloudCog,
  Cpu,
  DatabaseZap,
  Eye,
  FileWarning,
  Gauge,
  KeyRound,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ServerCog,
  ShieldCheck,
  TimerReset,
  Workflow,
  X,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import type { Json } from '../../lib/database.types';
import { useOperations } from './OperationsContext';
import type { ProductCommandStatus, ProductCommandType } from './operationsDatabase.types';
import type { OperationCommand, OperationsLicense } from './operationsRepository';

const commandLabels: Record<ProductCommandType, string> = {
  provision_tenant: 'Создать tenant',
  suspend_tenant: 'Приостановить tenant',
  resume_tenant: 'Возобновить tenant',
  revoke_tenant: 'Отозвать tenant',
  sync_entitlements: 'Синхронизировать доступы',
  invite_owner: 'Пригласить владельца',
};

const statusLabels: Record<ProductCommandStatus, string> = {
  queued: 'В очереди',
  processing: 'В обработке',
  succeeded: 'Выполнена',
  failed: 'Ошибка',
  dead_letter: 'Dead letter',
  cancelled: 'Отменена',
};

const allCommands = Object.keys(commandLabels) as ProductCommandType[];
const allStatuses = Object.keys(statusLabels) as ProductCommandStatus[];

function statusClass(status: ProductCommandStatus) {
  if (status === 'succeeded') return 'ok';
  if (status === 'queued') return 'info';
  if (status === 'processing') return 'processing';
  if (status === 'failed') return 'warn';
  if (status === 'dead_letter') return 'danger';
  return 'muted';
}

function allowedCommands(license: OperationsLicense): ProductCommandType[] {
  if (license.status === 'pending' || license.status === 'failed') {
    return ['provision_tenant', 'sync_entitlements', 'invite_owner'];
  }
  if (license.status === 'active') {
    return ['suspend_tenant', 'revoke_tenant', 'sync_entitlements', 'invite_owner'];
  }
  if (license.status === 'suspended') {
    return ['resume_tenant', 'revoke_tenant', 'sync_entitlements'];
  }
  return [];
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function safeJson(value: Json | null) {
  if (value === null) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parsePayload(value: string): Json {
  const trimmed = value.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed) as Json;
}

function commandIcon(command: ProductCommandType) {
  if (command === 'provision_tenant') return Plus;
  if (command === 'suspend_tenant') return Ban;
  if (command === 'resume_tenant') return RotateCcw;
  if (command === 'revoke_tenant') return FileWarning;
  if (command === 'sync_entitlements') return KeyRound;
  return ShieldCheck;
}

export function OperationsPage() {
  const { can, isDemo } = useAuth();
  const {
    commands,
    licenses,
    loading,
    saving,
    error,
    refresh,
    enqueueCommand,
    retryCommand,
    cancelCommand,
  } = useOperations();
  const commandDialog = useRef<HTMLDialogElement | null>(null);
  const detailsDialog = useRef<HTMLDialogElement | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProductCommandStatus>('all');
  const [commandFilter, setCommandFilter] = useState<'all' | ProductCommandType>('all');
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(null);
  const [licenseId, setLicenseId] = useState('');
  const [manualCommand, setManualCommand] = useState<ProductCommandType>('provision_tenant');
  const [reason, setReason] = useState('');
  const [payloadText, setPayloadText] = useState('{}');
  const [validation, setValidation] = useState('');
  const canManage = can('operations.manage');

  const selectedCommand = selectedCommandId
    ? commands.find((command) => command.id === selectedCommandId) ?? null
    : null;

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return commands.filter((command) => {
      if (statusFilter !== 'all' && command.status !== statusFilter) return false;
      if (commandFilter !== 'all' && command.command !== commandFilter) return false;
      if (!normalized) return true;
      return [
        command.organizationName,
        command.productName,
        command.productKey,
        command.id,
        command.correlationId,
        command.lastError,
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [commandFilter, commands, query, statusFilter]);

  const metrics = useMemo(() => ({
    queued: commands.filter((command) => command.status === 'queued').length,
    processing: commands.filter((command) => command.status === 'processing').length,
    failed: commands.filter((command) => command.status === 'failed').length,
    deadLetter: commands.filter((command) => command.status === 'dead_letter').length,
  }), [commands]);

  const openManualCommand = () => {
    const firstLicense = licenses.find((license) => allowedCommands(license).length > 0) ?? null;
    setLicenseId(firstLicense?.id ?? '');
    setManualCommand(firstLicense ? allowedCommands(firstLicense)[0] : 'provision_tenant');
    setReason('');
    setPayloadText('{}');
    setValidation('');
    commandDialog.current?.showModal();
  };

  const changeLicense = (nextLicenseId: string) => {
    const license = licenses.find((item) => item.id === nextLicenseId);
    setLicenseId(nextLicenseId);
    setManualCommand(license ? allowedCommands(license)[0] ?? 'sync_entitlements' : 'provision_tenant');
  };

  const submitManualCommand = async (event: FormEvent) => {
    event.preventDefault();
    const license = licenses.find((item) => item.id === licenseId);
    if (!license) {
      setValidation('Выберите лицензию.');
      return;
    }
    if (!allowedCommands(license).includes(manualCommand)) {
      setValidation('Команда недоступна для текущего состояния лицензии.');
      return;
    }
    if (reason.trim().length < 5) {
      setValidation('Укажите причину команды минимум из 5 символов.');
      return;
    }

    let payload: Json;
    try {
      payload = parsePayload(payloadText);
    } catch {
      setValidation('Payload содержит некорректный JSON.');
      return;
    }

    const success = await enqueueCommand({
      licenseId,
      command: manualCommand,
      reason: reason.trim(),
      payload,
    });
    if (success) commandDialog.current?.close();
  };

  const retry = async (command: OperationCommand) => {
    const retryReason = window.prompt(`Причина повторного запуска «${commandLabels[command.command]}»:`);
    if (!retryReason?.trim()) return;
    await retryCommand(command.id, retryReason.trim());
  };

  const cancel = async (command: OperationCommand) => {
    const cancelReason = window.prompt(`Причина отмены команды для ${command.organizationName}:`);
    if (!cancelReason?.trim()) return;
    await cancelCommand(command.id, cancelReason.trim());
  };

  const openDetails = (command: OperationCommand) => {
    setSelectedCommandId(command.id);
    detailsDialog.current?.showModal();
  };

  const selectedLicense = licenses.find((license) => license.id === licenseId) ?? null;
  const selectedLicenseCommands = selectedLicense ? allowedCommands(selectedLicense) : [];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Workflow & Provisioning Orchestrator</span>
          <h1>Operations Center</h1>
          <p>Durable outbox, worker leases, автоматический provisioning, retries и dead-letter контроль.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить</button>
          {canManage && <button className="primary-button" type="button" onClick={openManualCommand}><Play size={17} /> Новая команда</button>}
        </div>
      </div>

      {isDemo && <div className="mode-banner"><ShieldCheck size={18} /><div><strong>Демо-режим Operations Center</strong><span>Очередь сохраняется в браузере. В production команды создаются PostgreSQL-триггерами и исполняются Edge Function worker.</span></div></div>}
      {!canManage && <div className="mode-banner"><Activity size={18} /><div><strong>Режим просмотра</strong><span>Текущая роль может наблюдать workflow, но не может запускать, повторять или отменять команды.</span></div></div>}
      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span></div>}

      <section className="metrics operations-metrics">
        <article className="metric-card"><div className="metric-icon"><Clock3 size={21} /></div><div><span>В очереди</span><strong>{metrics.queued}</strong><small>ожидают worker</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Cpu size={21} /></div><div><span>В обработке</span><strong>{metrics.processing}</strong><small>активные leases</small></div></article>
        <article className="metric-card"><div className="metric-icon"><CircleAlert size={21} /></div><div><span>Ошибки</span><strong>{metrics.failed}</strong><small>доступен retry</small></div></article>
        <article className="metric-card"><div className="metric-icon"><FileWarning size={21} /></div><div><span>Dead letter</span><strong>{metrics.deadLetter}</strong><small>исчерпаны попытки</small></div></article>
      </section>

      <section className="orchestrator-flow">
        <article><div><DatabaseZap size={20} /></div><strong>1. Durable Outbox</strong><span>Команда и idempotency key фиксируются до вызова продукта.</span></article>
        <ChevronRight size={18} />
        <article><div><Cpu size={20} /></div><strong>2. Worker Lease</strong><span>SKIP LOCKED позволяет безопасно запускать несколько workers.</span></article>
        <ChevronRight size={18} />
        <article><div><ServerCog size={20} /></div><strong>3. Product Adapter</strong><span>Версионированный контракт и environment endpoint.</span></article>
        <ChevronRight size={18} />
        <article><div><TimerReset size={20} /></div><strong>4. Retry / DLQ</strong><span>Backoff, lease recovery и ручное восстановление.</span></article>
      </section>

      <section className="panel operations-panel">
        <div className="operations-toolbar">
          <div className="search registry-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Компания, продукт, command ID, correlation ID..." /></div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ProductCommandStatus)}><option value="all">Все статусы</option>{allStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>
          <select value={commandFilter} onChange={(event) => setCommandFilter(event.target.value as 'all' | ProductCommandType)}><option value="all">Все команды</option>{allCommands.map((command) => <option key={command} value={command}>{commandLabels[command]}</option>)}</select>
          <span>Найдено: {filteredCommands.length}</span>
        </div>

        {loading ? (
          <div className="inline-loading"><LoaderCircle className="spin" size={27} /><span>Загрузка workflow...</span></div>
        ) : filteredCommands.length === 0 ? (
          <div className="inline-empty"><Workflow size={30} /><h2>Команды не найдены</h2><p>Измените фильтры или запустите новую операцию.</p></div>
        ) : (
          <div className="table-wrap operations-table-wrap"><table className="operations-table"><thead><tr><th>Компания / продукт</th><th>Команда</th><th>Статус</th><th>Попытки</th><th>Adapter</th><th>Время</th><th>Ошибка</th><th /></tr></thead><tbody>{filteredCommands.map((command) => {
            const CommandIcon = commandIcon(command.command);
            return <tr key={command.id}>
              <td><div className="operation-entity"><div className="company-avatar">{command.productName.slice(0, 2).toUpperCase()}</div><div><strong>{command.organizationName}</strong><span>{command.productName} · {command.productKey}</span></div></div></td>
              <td><div className="operation-command"><CommandIcon size={15} /><div><strong>{commandLabels[command.command]}</strong><span>{command.id.slice(0, 12)}</span></div></div></td>
              <td><span className={`status ${statusClass(command.status)}`}>{statusLabels[command.status]}</span>{command.lockedBy && <small className="worker-label">{command.lockedBy}</small>}</td>
              <td><div className="attempt-cell"><strong>{command.attempts}/{command.maxAttempts}</strong><span>{command.status === 'queued' ? `после ${formatDateTime(command.availableAt)}` : command.workflowStatus}</span></div></td>
              <td><div className="adapter-checks"><span className={command.adapterConfigured ? 'ok' : 'bad'}><CloudCog size={13} /> adapter</span><span className={command.endpointConfigured ? 'ok' : 'bad'}><ServerCog size={13} /> endpoint</span></div></td>
              <td><div className="period-cell"><span><Clock3 size={13} /> {formatDateTime(command.createdAt)}</span><span><Activity size={13} /> {formatDateTime(command.updatedAt)}</span></div></td>
              <td><span className={`operation-error ${command.lastError ? 'has-error' : ''}`}>{command.lastError || '—'}</span></td>
              <td><div className="row-actions"><button className="row-button" type="button" title="Детали" onClick={() => openDetails(command)}><Eye size={15} /></button>{canManage && ['failed', 'dead_letter', 'cancelled'].includes(command.status) && <button className="row-button" type="button" title="Повторить" onClick={() => void retry(command)}><RotateCcw size={15} /></button>}{canManage && ['queued', 'failed', 'dead_letter'].includes(command.status) && <button className="row-button danger-text" type="button" title="Отменить" onClick={() => void cancel(command)}><Ban size={15} /></button>}</div></td>
            </tr>;
          })}</tbody></table></div>
        )}
      </section>

      <dialog ref={commandDialog} className="modal wide-modal" onCancel={() => commandDialog.current?.close()}>
        <form onSubmit={submitManualCommand}>
          <div className="modal-header"><div><span className="eyebrow">Manual Product Command</span><h2>Запустить команду</h2><p>Команда попадёт в durable outbox и будет выполнена доверенным worker.</p></div><button className="icon-button" type="button" onClick={() => commandDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-grid">
            <label className="span-2"><span>Лицензия *</span><select required value={licenseId} onChange={(event) => changeLicense(event.target.value)}><option value="">Выберите лицензию</option>{licenses.filter((license) => allowedCommands(license).length > 0).map((license) => <option key={license.id} value={license.id}>{license.organizationName} · {license.productName} · {license.status}</option>)}</select></label>
            <label><span>Команда *</span><select value={manualCommand} onChange={(event) => setManualCommand(event.target.value as ProductCommandType)}>{selectedLicenseCommands.map((command) => <option key={command} value={command}>{commandLabels[command]}</option>)}</select></label>
            <label><span>Состояние лицензии</span><input readOnly value={selectedLicense ? `${selectedLicense.status}${selectedLicense.externalTenantId ? ` · ${selectedLicense.externalTenantId}` : ''}` : '—'} /></label>
            <label className="span-2"><span>Причина *</span><input required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Повторное подключение после восстановления endpoint" /></label>
            <label className="span-2"><span>Дополнительный JSON payload</span><textarea rows={6} value={payloadText} onChange={(event) => setPayloadText(event.target.value)} spellCheck={false} /></label>
          </div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => commandDialog.current?.close()}>Отмена</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{saving ? 'Постановка...' : 'Поставить в очередь'}</button></div>
        </form>
      </dialog>

      <dialog ref={detailsDialog} className="modal operation-details-modal" onCancel={() => detailsDialog.current?.close()}>
        {selectedCommand && <div className="operation-details">
          <div className="modal-header"><div><span className="eyebrow">Workflow Details</span><h2>{commandLabels[selectedCommand.command]}</h2><p>{selectedCommand.organizationName} · {selectedCommand.productName}</p></div><button className="icon-button" type="button" onClick={() => detailsDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="operation-detail-facts">
            <div><span>Status</span><strong>{statusLabels[selectedCommand.status]}</strong></div>
            <div><span>Attempts</span><strong>{selectedCommand.attempts}/{selectedCommand.maxAttempts}</strong></div>
            <div><span>Correlation ID</span><code>{selectedCommand.correlationId}</code></div>
            <div><span>Idempotency key</span><code>{selectedCommand.idempotencyKey}</code></div>
          </div>
          {selectedCommand.lastError && <div className="operation-detail-error"><CircleAlert size={17} /><span>{selectedCommand.lastError}</span></div>}
          <div className="operation-detail-grid">
            <section><h3>Payload</h3><pre>{safeJson(selectedCommand.payload)}</pre></section>
            <section><h3>Response</h3><pre>{safeJson(selectedCommand.response)}</pre></section>
          </div>
          <section className="workflow-timeline"><h3>Timeline</h3>{[...selectedCommand.events].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()).map((event) => <article key={event.id}><div className="timeline-dot" /><div><strong>{event.eventType}</strong><span>{event.fromStatus ?? '—'} → {event.toStatus ?? '—'}</span><p>{event.message || 'Без дополнительного сообщения'}</p><small>{formatDateTime(event.occurredAt)}</small></div></article>)}</section>
        </div>}
      </dialog>
    </>
  );
}
