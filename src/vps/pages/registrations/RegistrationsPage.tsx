import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CheckCheck, Clock3, Mail, MessageCircle, Phone, RefreshCw, Search, TimerReset } from 'lucide-react';
import type { Organization } from '../../controlCenter';
import { api, EmptyState, Status } from '../../controlCenter';
import './registrationsPage.css';

type RegistrationItem = {
  id: string;
  event_id: string;
  source_product_code: string;
  external_tenant_id: string;
  organization_id: string;
  company_name: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  trial_status: string;
  trial_started_at: string;
  trial_ends_at: string;
  telegram_status: 'pending' | 'sent' | 'failed' | 'disabled';
  telegram_error: string | null;
  read_at: string | null;
  created_at: string;
};

type Props = {
  organizations: Organization[];
  realtimeTick: number;
  onOpenOrganization: (organizationId: string) => void;
};

type ReadFilter = 'all' | 'unread' | 'read';
type TrialFilter = 'all' | 'active' | 'expired';

const telegramLabels: Record<RegistrationItem['telegram_status'], string> = {
  sent: 'Доставлено',
  pending: 'Отправляется',
  failed: 'Не доставлено',
  disabled: 'Отключено',
};

function formatDate(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value)) : '—';
}

function trialActive(item: RegistrationItem) {
  return new Date(item.trial_ends_at).getTime() > Date.now();
}

function remaining(item: RegistrationItem) {
  const diff = new Date(item.trial_ends_at).getTime() - Date.now();
  if (diff <= 0) return 'Пробный доступ завершён';
  const hours = Math.ceil(diff / 3600000);
  if (hours < 24) return `${hours} ч.`;
  return `${Math.ceil(hours / 24)} дн.`;
}

export function RegistrationsPage({ organizations, realtimeTick, onOpenOrganization }: Props) {
  const [items, setItems] = useState<RegistrationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [query, setQuery] = useState('');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [trialFilter, setTrialFilter] = useState<TrialFilter>('all');
  const [productFilter, setProductFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ items: RegistrationItem[]; unread: number }>('/api/v1/notifications?limit=100');
      setItems(result.items || []);
      setUnread(result.unread || 0);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить регистрации');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, realtimeTick]);

  const products = useMemo(() => [...new Set(items.map((item) => item.source_product_code))].sort(), [items]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (readFilter === 'unread' && item.read_at) return false;
      if (readFilter === 'read' && !item.read_at) return false;
      if (trialFilter === 'active' && !trialActive(item)) return false;
      if (trialFilter === 'expired' && trialActive(item)) return false;
      if (productFilter !== 'all' && item.source_product_code !== productFilter) return false;
      if (!needle) return true;
      return [item.company_name, item.owner_name, item.owner_email, item.owner_phone, item.source_product_code, item.external_tenant_id]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [items, productFilter, query, readFilter, trialFilter]);

  useEffect(() => {
    if (!filtered.length) { setSelectedId(''); return; }
    if (!filtered.some((item) => item.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = items.find((item) => item.id === selectedId) || null;
  const activeTrials = items.filter(trialActive).length;
  const telegramFailed = items.filter((item) => item.telegram_status === 'failed').length;
  const provisioned = items.filter((item) => organizations.some((organization) => organization.id === item.organization_id)).length;

  const markRead = async (item: RegistrationItem) => {
    if (item.read_at) return;
    setBusy(true); setError('');
    try {
      await api(`/api/v1/notifications/${item.id}/read`, { method: 'PATCH', body: '{}' });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отметить регистрацию');
    } finally { setBusy(false); }
  };

  const markAllRead = async () => {
    const unreadItems = items.filter((item) => !item.read_at);
    if (!unreadItems.length) return;
    setBusy(true); setError('');
    try {
      for (const item of unreadItems) await api(`/api/v1/notifications/${item.id}/read`, { method: 'PATCH', body: '{}' });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отметить регистрации');
    } finally { setBusy(false); }
  };

  return <section className="registrations-page">
    <div className="registrations-kpis">
      <article><span>Регистрации</span><strong>{items.length}</strong><small>последние 100 записей</small></article>
      <article className={unread ? 'warn' : ''}><span>Новые</span><strong>{unread}</strong><small>ещё не просмотрены</small></article>
      <article><span>Пробный доступ</span><strong>{activeTrials}</strong><small>сейчас активен</small></article>
      <article className={telegramFailed ? 'danger' : ''}><span>Не доставлено</span><strong>{telegramFailed}</strong><small>уведомлений Telegram</small></article>
      <article><span>Организации созданы</span><strong>{provisioned}</strong><small>регистрация завершена</small></article>
    </div>

    <div className="registrations-toolbar">
      <label className="registrations-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Компания, владелец, email, телефон или ID клиента" /></label>
      <select value={productFilter} onChange={(event) => setProductFilter(event.target.value)}><option value="all">Все продукты</option>{products.map((product) => <option key={product} value={product}>{product}</option>)}</select>
      <select value={readFilter} onChange={(event) => setReadFilter(event.target.value as ReadFilter)}><option value="all">Все записи</option><option value="unread">Только новые</option><option value="read">Просмотренные</option></select>
      <select value={trialFilter} onChange={(event) => setTrialFilter(event.target.value as TrialFilter)}><option value="all">Любой доступ</option><option value="active">Пробный доступ активен</option><option value="expired">Пробный доступ завершён</option></select>
      <button type="button" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={15}/>{loading ? 'Обновление…' : 'Обновить'}</button>
      {unread > 0 && <button type="button" className="primary" onClick={() => void markAllRead()} disabled={busy}><CheckCheck size={15}/>Отметить всё просмотренным</button>}
    </div>

    {error && <div className="vps-error">{error}</div>}

    <div className="registrations-workspace">
      <div className="registrations-list-panel">
        <div className="registrations-panel-head"><div><span>НОВЫЕ КЛИЕНТЫ</span><h2>Регистрации</h2></div><small>{filtered.length}</small></div>
        {!filtered.length ? <EmptyState title="Регистраций нет" text="Новые регистрации появятся здесь автоматически." /> : <div className="registrations-list">{filtered.map((item) => <button key={item.id} type="button" className={`${selectedId === item.id ? 'active' : ''} ${!item.read_at ? 'unread' : ''}`} onClick={() => setSelectedId(item.id)}>
          <div className="registrations-list-icon"><Building2 size={17}/></div>
          <div className="registrations-list-copy"><div><strong>{item.company_name}</strong>{!item.read_at && <span className="registrations-new">Новая</span>}</div><span>{item.owner_name} · {item.source_product_code}</span><small>{item.owner_email}</small></div>
          <div className="registrations-list-meta"><Status value={trialActive(item) ? 'active' : 'expired'}/><small>{formatDate(item.created_at)}</small></div>
        </button>)}</div>}
      </div>

      <div className="registrations-detail-panel">
        {!selected ? <EmptyState title="Выберите регистрацию" text="Справа появятся контакты, пробный период и связанная организация." /> : <>
          <div className="registrations-detail-head"><div><span>КАРТОЧКА РЕГИСТРАЦИИ</span><h2>{selected.company_name}</h2><p>{selected.source_product_code} · ID {selected.external_tenant_id}</p></div><div>{!selected.read_at && <button type="button" disabled={busy} onClick={() => void markRead(selected)}><CheckCheck size={14}/>Отметить просмотренной</button>}</div></div>

          <div className="registrations-provision-note"><Building2 size={18}/><div><strong>Организация уже создаётся автоматически.</strong><p>После регистрации Control Center связывает клиента с продуктом и открывает пробный доступ. Здесь можно проверить результат и перейти в карточку организации.</p></div></div>

          <div className="registrations-facts">
            <div><span>Владелец</span><strong>{selected.owner_name}</strong></div>
            <div><span>Email</span><strong>{selected.owner_email}</strong></div>
            <div><span>Телефон</span><strong>{selected.owner_phone}</strong></div>
            <div><span>Продукт</span><strong>{selected.source_product_code}</strong></div>
            <div><span>ID клиента в продукте</span><strong>{selected.external_tenant_id}</strong></div>
            <div><span>Организация</span><strong>{organizations.find((item) => item.id === selected.organization_id)?.name || selected.organization_id}</strong></div>
          </div>

          <div className="registrations-trial-card">
            <div><TimerReset size={18}/><span><small>ПРОБНЫЙ ДОСТУП</small><strong>{selected.trial_status}</strong></span></div>
            <div><span>Начало</span><strong>{formatDate(selected.trial_started_at)}</strong></div>
            <div><span>Окончание</span><strong>{formatDate(selected.trial_ends_at)}</strong></div>
            <div className={trialActive(selected) ? 'active' : 'expired'}><Clock3 size={15}/><strong>{remaining(selected)}</strong></div>
          </div>

          <div className="registrations-contact-row">
            <a href={`mailto:${selected.owner_email}`}><Mail size={15}/>Написать email</a>
            <a href={`tel:${selected.owner_phone}`}><Phone size={15}/>Позвонить</a>
            <button type="button" onClick={() => onOpenOrganization(selected.organization_id)}><Building2 size={15}/>Открыть организацию</button>
          </div>

          <div className={`registrations-telegram-card ${selected.telegram_status}`}>
            <MessageCircle size={18}/><div><span>УВЕДОМЛЕНИЕ TELEGRAM</span><strong>{telegramLabels[selected.telegram_status]}</strong><small>{selected.telegram_error || 'Ошибок доставки нет'}</small></div>
          </div>

          <div className="registrations-meta"><span>Получено</span><strong>{formatDate(selected.created_at)}</strong><span>Просмотрено</span><strong>{formatDate(selected.read_at)}</strong></div>
        </>}
      </div>
    </div>
  </section>;
}
