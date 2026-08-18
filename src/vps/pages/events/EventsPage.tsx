import { useEffect, useMemo, useState } from 'react';
import { Activity, BellRing, Braces, DatabaseZap, Search, SlidersHorizontal, UserRoundCog, Workflow } from 'lucide-react';
import type { ControlCommand, Organization, Product, RealtimeState, User } from '../../controlCenter';
import { api, EmptyState, Status } from '../../controlCenter';
import './eventsPage.css';

export type RealtimeFeedEvent = {
  id?: number | string;
  topic?: string;
  event_type?: string;
  organization_id?: string | null;
  product_id?: string | null;
  module_installation_id?: string | null;
  payload?: unknown;
  created_at?: string;
};

type AuditLog = {
  id: number | string;
  actor_user_id: string | null;
  actor_email?: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  reason?: string | null;
  request_id?: string | null;
  source_ip?: string | null;
  before_state?: unknown;
  after_state?: unknown;
  created_at: string;
};

type FeedCategory = 'product' | 'commercial' | 'sync' | 'system';
type FeedSource = 'realtime' | 'audit' | 'command';

type FeedItem = {
  key: string;
  source: FeedSource;
  category: FeedCategory;
  title: string;
  subtitle: string;
  type: string;
  organizationId: string | null;
  organizationName: string | null;
  productId: string | null;
  productName: string | null;
  status: string | null;
  createdAt: string;
  payload: unknown;
};

type Props = {
  user: User;
  realtimeEvents: RealtimeFeedEvent[];
  commands: ControlCommand[];
  organizations: Organization[];
  products: Product[];
  realtimeState: RealtimeState;
};

const topicLabels: Record<string, string> = {
  organizations: 'Организация',
  products: 'Продукт',
  organization_products: 'Доступ к продукту',
  modules: 'Модуль',
  module_installations: 'Установка модуля',
  integration_connections: 'Интеграция',
  product_subscriptions: 'Подписка',
  billing_invoices: 'Счёт',
  billing_payments: 'Платёж',
  billing_refunds: 'Возврат',
};

const eventTypeLabels: Record<string, string> = { insert: 'Создано', update: 'Изменено', delete: 'Удалено' };
const categoryLabels: Record<FeedCategory, string> = { product: 'Продукты', commercial: 'Финансы', sync: 'Синхронизация', system: 'Система' };
const sourceLabels: Record<FeedSource, string> = { realtime: 'Автообновление', audit: 'Действия пользователей', command: 'Команды продуктам' };

function objectValue(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (candidate != null && candidate !== '') return String(candidate);
  }
  return null;
}

function commercialAction(value: string) {
  return /(billing|subscription|invoice|payment|refund|commercial|plan|price|trial)/i.test(value);
}

function categoryForTopic(topic: string): FeedCategory {
  return /(subscription|billing|invoice|payment|refund|commercial)/i.test(topic) ? 'commercial' : 'product';
}

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('ru-RU') : '—';
}

function safeJson(value: unknown) {
  try { return JSON.stringify(value ?? {}, null, 2); } catch { return String(value ?? ''); }
}

export function EventsPage({ user, realtimeEvents, commands, organizations, products, realtimeState }: Props) {
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [auditError, setAuditError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | FeedCategory>('all');
  const [source, setSource] = useState<'all' | FeedSource>('all');
  const [organizationId, setOrganizationId] = useState('all');
  const [productId, setProductId] = useState('all');
  const [selectedKey, setSelectedKey] = useState('');

  const canViewAudit = user.scope === 'platform' && ['platform_owner', 'platform_admin', 'auditor'].includes(user.role);

  useEffect(() => {
    if (!canViewAudit) { setAudit([]); setAuditError(''); return; }
    let cancelled = false;
    api<{ items: AuditLog[] }>('/api/v1/audit')
      .then((result) => { if (!cancelled) { setAudit(result.items); setAuditError(''); } })
      .catch((error) => { if (!cancelled) setAuditError(error instanceof Error ? error.message : 'Не удалось загрузить историю действий'); });
    return () => { cancelled = true; };
  }, [canViewAudit, realtimeEvents.length]);

  const feed = useMemo<FeedItem[]>(() => {
    const organizationMap = new Map(organizations.map((item) => [item.id, item.name]));
    const productMap = new Map(products.map((item) => [item.id, item.name]));

    const live: FeedItem[] = realtimeEvents.map((item, index) => {
      const topic = item.topic || 'realtime';
      const nestedData = item.payload && typeof item.payload === 'object' ? (item.payload as Record<string, unknown>).data : null;
      const organizationFromPayload = objectValue(nestedData, ['organization_id', 'organizationId']);
      const productFromPayload = objectValue(nestedData, ['product_id', 'productId', 'host_product_id']);
      const organizationIdValue = item.organization_id ?? organizationFromPayload ?? null;
      const productIdValue = item.product_id ?? productFromPayload ?? null;
      return {
        key: `realtime:${item.id ?? `${item.created_at || 'now'}:${index}`}`,
        source: 'realtime',
        category: categoryForTopic(topic),
        title: topicLabels[topic] || topic,
        subtitle: eventTypeLabels[item.event_type || ''] || item.event_type || 'Событие',
        type: `${topic}.${item.event_type || 'event'}`,
        organizationId: organizationIdValue,
        organizationName: organizationIdValue ? organizationMap.get(organizationIdValue) || organizationIdValue : null,
        productId: productIdValue,
        productName: productIdValue ? productMap.get(productIdValue) || productIdValue : null,
        status: null,
        createdAt: item.created_at || new Date().toISOString(),
        payload: item.payload,
      };
    });

    const audited: FeedItem[] = audit.map((item) => {
      const organizationIdValue = objectValue(item.after_state, ['organization_id', 'organizationId']) || objectValue(item.before_state, ['organization_id', 'organizationId']);
      const productIdValue = objectValue(item.after_state, ['product_id', 'productId']) || objectValue(item.before_state, ['product_id', 'productId']);
      return {
        key: `audit:${item.id}`,
        source: 'audit',
        category: commercialAction(item.action) ? 'commercial' : 'system',
        title: item.action,
        subtitle: `${item.target_type}${item.actor_email ? ` · ${item.actor_email}` : ''}`,
        type: item.action,
        organizationId: organizationIdValue,
        organizationName: organizationIdValue ? organizationMap.get(organizationIdValue) || organizationIdValue : null,
        productId: productIdValue,
        productName: productIdValue ? productMap.get(productIdValue) || productIdValue : null,
        status: null,
        createdAt: item.created_at,
        payload: { targetId: item.target_id, reason: item.reason, requestId: item.request_id, sourceIp: item.source_ip, before: item.before_state, after: item.after_state },
      };
    });

    const control: FeedItem[] = commands.map((item) => ({
      key: `command:${item.id}`,
      source: 'command',
      category: 'sync',
      title: item.command_type,
      subtitle: `${item.organization_name} · ${item.product_name}`,
      type: `control_command.${item.status}`,
      organizationId: organizations.find((organization) => organization.name === item.organization_name)?.id || null,
      organizationName: item.organization_name,
      productId: products.find((product) => product.code === item.product_code)?.id || null,
      productName: item.product_name,
      status: item.status,
      createdAt: item.created_at,
      payload: { desiredRevision: item.desired_revision, attempts: item.attempts, lastError: item.last_error, completedAt: item.completed_at, productCode: item.product_code },
    }));

    return [...live, ...audited, ...control].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [audit, commands, organizations, products, realtimeEvents]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return feed.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (source !== 'all' && item.source !== source) return false;
      if (organizationId !== 'all' && item.organizationId !== organizationId) return false;
      if (productId !== 'all' && item.productId !== productId) return false;
      if (!needle) return true;
      return [item.title, item.subtitle, item.type, item.organizationName, item.productName, safeJson(item.payload)]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [category, feed, organizationId, productId, query, source]);

  useEffect(() => {
    if (!filtered.length) { setSelectedKey(''); return; }
    if (!filtered.some((item) => item.key === selectedKey)) setSelectedKey(filtered[0].key);
  }, [filtered, selectedKey]);

  const selected = feed.find((item) => item.key === selectedKey) || null;
  const liveCount = feed.filter((item) => item.source === 'realtime').length;
  const commercialCount = feed.filter((item) => item.category === 'commercial').length;
  const failedCommands = commands.filter((item) => item.status === 'failed').length;
  const connectionLabel = realtimeState === 'online' ? 'Онлайн' : realtimeState === 'connecting' ? 'Подключение…' : 'Нет связи';

  return <section className="events-page">
    <div className="events-kpis">
      <article><span>Новые изменения</span><strong>{liveCount}</strong><small>за текущий сеанс</small></article>
      <article><span>Действия пользователей</span><strong>{audit.length}</strong><small>{canViewAudit ? 'последние записи' : 'недоступно для роли'}</small></article>
      <article><span>Финансовые события</span><strong>{commercialCount}</strong><small>подписки и платежи</small></article>
      <article className={failedCommands ? 'danger' : ''}><span>Ошибки синхронизации</span><strong>{failedCommands}</strong><small>команд с ошибкой</small></article>
      <article><span>Обновления</span><strong className={`events-live-state ${realtimeState}`}>{connectionLabel}</strong><small>автоматическое получение изменений</small></article>
    </div>

    <div className="events-toolbar">
      <label className="events-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти событие, организацию или продукт"/></label>
      <label><SlidersHorizontal size={15}/><select value={category} onChange={(event) => setCategory(event.target.value as 'all' | FeedCategory)}><option value="all">Все категории</option>{Object.entries(categoryLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label><DatabaseZap size={15}/><select value={source} onChange={(event) => setSource(event.target.value as 'all' | FeedSource)}><option value="all">Все источники</option>{Object.entries(sourceLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label><select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}><option value="all">Все организации</option>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="all">Все продукты</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>

    {auditError && <div className="events-note"><UserRoundCog size={16}/><span>История действий временно недоступна: {auditError}. Новые события продолжают поступать.</span></div>}

    <div className="events-workspace">
      <div className="events-list-panel">
        <div className="events-panel-head"><div><span>ЖУРНАЛ</span><h2>Последние события</h2></div><small>{filtered.length} записей</small></div>
        {!filtered.length ? <EmptyState title="Событий нет" text="Новые изменения появятся здесь автоматически."/> : <div className="events-list">{filtered.map((item) => <button key={item.key} type="button" className={selectedKey === item.key ? 'active' : ''} onClick={() => setSelectedKey(item.key)}>
          <div className={`events-source-icon ${item.source}`}>{item.source === 'realtime' ? <BellRing size={16}/> : item.source === 'audit' ? <UserRoundCog size={16}/> : <Workflow size={16}/>}</div>
          <div className="events-list-copy"><div><strong>{item.title}</strong><span className={`events-category ${item.category}`}>{categoryLabels[item.category]}</span></div><span>{item.subtitle}</span><small>{[item.organizationName, item.productName].filter(Boolean).join(' · ') || sourceLabels[item.source]}</small></div>
          <div className="events-list-meta">{item.status ? <Status value={item.status}/> : <span>{sourceLabels[item.source]}</span>}<small>{date(item.createdAt)}</small></div>
        </button>)}</div>}
      </div>

      <div className="events-detail-panel">
        {!selected ? <EmptyState title="Выберите событие" text="Здесь появятся время, организация, продукт и дополнительные сведения."/> : <>
          <div className="events-detail-head"><div><span>{sourceLabels[selected.source].toUpperCase()}</span><h2>{selected.title}</h2><p>{selected.subtitle}</p></div><span className={`events-category ${selected.category}`}>{categoryLabels[selected.category]}</span></div>
          <div className="events-facts">
            <div><span>Время</span><strong>{date(selected.createdAt)}</strong></div>
            <div><span>Источник</span><strong>{sourceLabels[selected.source]}</strong></div>
            <div><span>Организация</span><strong>{selected.organizationName || '—'}</strong></div>
            <div><span>Продукт</span><strong>{selected.productName || '—'}</strong></div>
            <div><span>Тип события</span><strong>{selected.type}</strong></div>
            <div><span>Статус</span>{selected.status ? <Status value={selected.status}/> : <strong>—</strong>}</div>
          </div>
          <details className="events-payload">
            <summary className="events-section-head"><span><Braces size={16}/><span><strong>Технические детали</strong><small>Показать исходные данные события</small></span></span></summary>
            <pre>{safeJson(selected.payload)}</pre>
          </details>
          <div className="events-source-note"><Activity size={16}/><div><strong>Все события собраны в одном журнале.</strong><p>Здесь видны изменения данных, действия администраторов и доставка настроек в продукты. Источник каждого события указан отдельно.</p></div></div>
        </>}
      </div>
    </div>
  </section>;
}
