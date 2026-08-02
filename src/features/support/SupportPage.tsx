import { AlertTriangle, CheckCircle2, Clock3, Headphones, MessageSquare, Plus, RefreshCw, Search, ShieldCheck, UserRound } from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import { useSupport } from './SupportContext';
import type { CreateTicketInput, SupportPriority, SupportStatus, SupportTicket } from './supportRepository';

const emptyTicket: CreateTicketInput = {
  organizationId: '', productId: null, subject: '', description: '', category: 'Ошибка', priority: 'normal', channel: 'portal', requesterName: '', requesterEmail: '',
};

const statusLabels: Record<SupportStatus, string> = {
  new: 'Новый', open: 'В работе', pending_customer: 'Ждём клиента', pending_internal: 'Внутренняя проверка', resolved: 'Решён', closed: 'Закрыт',
};
const priorityLabels: Record<SupportPriority, string> = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', urgent: 'Критический' };

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function isOverdue(value: string | null, completed: string | null) {
  return Boolean(value && !completed && new Date(value).getTime() < Date.now());
}

function ticketTone(ticket: SupportTicket) {
  if (ticket.priority === 'urgent') return 'danger';
  if (ticket.priority === 'high') return 'warn';
  if (ticket.status === 'resolved' || ticket.status === 'closed') return 'ok';
  return 'info';
}

export function SupportPage() {
  const { can, isDemo } = useAuth();
  const { tickets, messages, organizations, products, staff, loading, saving, error, refresh, createTicket, addMessage, updateTicket } = useSupport();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SupportStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ticketForm, setTicketForm] = useState<CreateTicketInput>(emptyTicket);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [validation, setValidation] = useState('');
  const dialog = useRef<HTMLDialogElement | null>(null);
  const canManage = can('support.manage');

  const filtered = useMemo(() => tickets.filter((ticket) => {
    const haystack = `${ticket.number} ${ticket.subject} ${ticket.organizationName} ${ticket.productName} ${ticket.requesterName}`.toLowerCase();
    return (statusFilter === 'all' || ticket.status === statusFilter) && haystack.includes(query.toLowerCase());
  }), [tickets, query, statusFilter]);

  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? filtered[0] ?? null;
  const selectedMessages = selected ? messages.filter((message) => message.ticketId === selected.id) : [];
  const metrics = useMemo(() => ({
    active: tickets.filter((item) => !['resolved', 'closed'].includes(item.status)).length,
    overdue: tickets.filter((item) => isOverdue(item.firstResponseDueAt, item.firstRespondedAt) || isOverdue(item.resolutionDueAt, item.resolvedAt)).length,
    unassigned: tickets.filter((item) => !item.assigneeId && !['resolved', 'closed'].includes(item.status)).length,
    resolved: tickets.filter((item) => item.status === 'resolved').length,
  }), [tickets]);

  const submitTicket = async (event: FormEvent) => {
    event.preventDefault();
    if (!ticketForm.organizationId || !ticketForm.subject.trim() || !ticketForm.description.trim()) return setValidation('Компания, тема и описание обязательны.');
    if (await createTicket(ticketForm)) { dialog.current?.close(); setTicketForm(emptyTicket); setValidation(''); }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    if (await addMessage(selected.id, reply.trim(), internal)) { setReply(''); setInternal(false); }
  };

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">Customer Success</span><h1>Центр поддержки</h1><p>Тикеты, SLA, переписка, эскалации и контекст клиента в одном окне.</p></div>
        <div className="heading-actions">
          <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить</button>
          {canManage && <button className="primary-button" type="button" onClick={() => { setTicketForm({ ...emptyTicket, organizationId: organizations[0]?.id ?? '' }); dialog.current?.showModal(); }}><Plus size={17} /> Создать обращение</button>}
        </div>
      </div>

      {isDemo && <div className="mode-banner"><ShieldCheck size={18} /><div><strong>Демо-режим поддержки</strong><span>Изменения сохраняются локально. После применения миграции данные будут работать через Supabase и RLS.</span></div></div>}
      {error && <div className="error-banner"><AlertTriangle size={18} /><span>{error}</span></div>}

      <section className="metrics support-metrics">
        <article className="metric-card"><div className="metric-icon"><Headphones size={21} /></div><div><span>Активные</span><strong>{metrics.active}</strong><small>не закрыты</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Clock3 size={21} /></div><div><span>SLA просрочен</span><strong>{metrics.overdue}</strong><small>нужна реакция</small></div></article>
        <article className="metric-card"><div className="metric-icon"><UserRound size={21} /></div><div><span>Без ответственного</span><strong>{metrics.unassigned}</strong><small>требуют назначения</small></div></article>
        <article className="metric-card"><div className="metric-icon"><CheckCircle2 size={21} /></div><div><span>Решено</span><strong>{metrics.resolved}</strong><small>за весь период</small></div></article>
      </section>

      <section className="support-toolbar panel">
        <div className="search support-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, компания, продукт, тема..." /></div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | SupportStatus)}>
          <option value="all">Все статусы</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </section>

      <section className="support-layout">
        <div className="support-list panel">
          {filtered.map((ticket) => <button type="button" key={ticket.id} className={`support-ticket ${selected?.id === ticket.id ? 'active' : ''}`} onClick={() => setSelectedId(ticket.id)}>
            <div><span className={`status ${ticketTone(ticket)}`}>#{ticket.number} · {priorityLabels[ticket.priority]}</span><time>{formatDate(ticket.lastMessageAt)}</time></div>
            <strong>{ticket.subject}</strong><span>{ticket.organizationName} · {ticket.productName}</span>
            <footer><span>{statusLabels[ticket.status]}</span><span>{ticket.assigneeName}</span></footer>
          </button>)}
          {!loading && filtered.length === 0 && <div className="inline-empty"><Headphones size={30} /><h2>Обращений нет</h2><p>Фильтр не нашёл подходящих тикетов.</p></div>}
        </div>

        <div className="support-detail panel">
          {selected ? <>
            <header className="support-detail-header">
              <div><span className="eyebrow">#{selected.number} · {selected.organizationName}</span><h2>{selected.subject}</h2><p>{selected.description}</p></div>
              <span className={`status ${ticketTone(selected)}`}>{priorityLabels[selected.priority]}</span>
            </header>
            <div className="support-facts">
              <div><span>Продукт</span><strong>{selected.productName}</strong></div><div><span>Канал</span><strong>{selected.channel}</strong></div>
              <div><span>Первый ответ</span><strong className={isOverdue(selected.firstResponseDueAt, selected.firstRespondedAt) ? 'overdue' : ''}>{formatDate(selected.firstResponseDueAt)}</strong></div>
              <div><span>Решение</span><strong className={isOverdue(selected.resolutionDueAt, selected.resolvedAt) ? 'overdue' : ''}>{formatDate(selected.resolutionDueAt)}</strong></div>
            </div>
            {canManage && <div className="support-controls">
              <label><span>Статус</span><select value={selected.status} onChange={(event) => void updateTicket(selected.id, event.target.value as SupportStatus, selected.priority, selected.assigneeId)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Приоритет</span><select value={selected.priority} onChange={(event) => void updateTicket(selected.id, selected.status, event.target.value as SupportPriority, selected.assigneeId)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Ответственный</span><select value={selected.assigneeId ?? ''} onChange={(event) => void updateTicket(selected.id, selected.status, selected.priority, event.target.value || null)}><option value="">Не назначен</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </div>}
            <div className="support-thread">
              {selectedMessages.map((message) => <article key={message.id} className={`support-message ${message.internal ? 'internal' : ''}`}><div><strong>{message.authorName}</strong><span>{message.internal ? 'Внутренняя заметка' : message.authorType === 'customer' ? 'Клиент' : 'Поддержка'} · {formatDate(message.createdAt)}</span></div><p>{message.body}</p></article>)}
            </div>
            {canManage && <div className="support-composer"><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Ответ клиенту или внутренняя заметка..." /><div><label className="checkbox-line"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Внутренняя заметка</label><button className="primary-button" type="button" onClick={() => void sendReply()} disabled={saving || !reply.trim()}><MessageSquare size={16} /> Отправить</button></div></div>}
          </> : <div className="inline-empty"><Headphones size={32} /><h2>Выберите обращение</h2><p>Справа появится история и управление SLA.</p></div>}
        </div>
      </section>

      <dialog ref={dialog} className="modal wide-modal"><form onSubmit={submitTicket}><div className="modal-header"><div><span className="eyebrow">Support request</span><h2>Новое обращение</h2><p>SLA будет рассчитан автоматически по приоритету.</p></div><button type="button" className="icon-button" onClick={() => dialog.current?.close()}>×</button></div>
        <div className="form-grid"><label><span>Компания *</span><select value={ticketForm.organizationId} onChange={(event) => setTicketForm({ ...ticketForm, organizationId: event.target.value })}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Продукт</span><select value={ticketForm.productId ?? ''} onChange={(event) => setTicketForm({ ...ticketForm, productId: event.target.value || null })}><option value="">Общий вопрос</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="span-2"><span>Тема *</span><input value={ticketForm.subject} onChange={(event) => setTicketForm({ ...ticketForm, subject: event.target.value })} /></label>
          <label><span>Категория</span><select value={ticketForm.category} onChange={(event) => setTicketForm({ ...ticketForm, category: event.target.value })}><option>Ошибка</option><option>Интеграция</option><option>Настройка</option><option>Обучение</option><option>Оплата</option><option>Другое</option></select></label>
          <label><span>Приоритет</span><select value={ticketForm.priority} onChange={(event) => setTicketForm({ ...ticketForm, priority: event.target.value as SupportPriority })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Имя клиента</span><input value={ticketForm.requesterName} onChange={(event) => setTicketForm({ ...ticketForm, requesterName: event.target.value })} /></label>
          <label><span>Email</span><input type="email" value={ticketForm.requesterEmail} onChange={(event) => setTicketForm({ ...ticketForm, requesterEmail: event.target.value })} /></label>
          <label className="span-2"><span>Описание *</span><textarea rows={5} value={ticketForm.description} onChange={(event) => setTicketForm({ ...ticketForm, description: event.target.value })} /></label></div>
        {validation && <div className="form-error">{validation}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>Отмена</button><button type="submit" className="primary-button" disabled={saving}>Создать тикет</button></div></form></dialog>
    </>
  );
}
