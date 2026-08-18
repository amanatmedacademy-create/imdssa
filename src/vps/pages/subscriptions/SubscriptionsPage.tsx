import { useEffect, useMemo, useState } from 'react';
import { CreditCard, PackageCheck, Search, SlidersHorizontal } from 'lucide-react';
import type { Organization, Product } from '../../controlCenter';
import { api, EmptyState, Status } from '../../controlCenter';
import './subscriptionsPage.css';

type Subscription = {
  id: string;
  organization_id: string;
  product_id: string;
  plan_id: string | null;
  status: string;
  billing_period_months: number;
  base_price_kzt: string | number | null;
  addons_price_kzt: string | number;
  custom_price_kzt: string | number | null;
  payment_method: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  access_ends_at: string | null;
  organization_name: string;
  product_name: string;
  product_code: string;
  plan_name: string | null;
  item_count: number;
};

type Plan = { id: string; name: string; status: string; pricing_mode: 'fixed' | 'request'; prices: Record<string, string | number>; modules: Array<{ moduleId: string; mode: string }> };
type CommercialModule = { id: string; name: string; commercial_role: string; separately_sellable: boolean; prices: Record<string, string | number> };
type PaymentMethod = { method: string; enabled: boolean; is_default: boolean; display_name: string };
type Commercial = { plans: Plan[]; modules: CommercialModule[]; paymentMethods: PaymentMethod[] };

type Props = { organizations: Organization[]; products: Product[]; canManage: boolean };
const money = (value: unknown) => value == null || value === '' ? '—' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value));
const date = (value: string | null) => value ? new Date(value).toLocaleDateString('ru-RU') : '—';
const statusOptions = ['trial','pending_payment','active','past_due','grace','read_only','suspended','expired','canceled','free','beta'];
const statusLabels: Record<string, string> = {
  trial: 'Пробный период',
  pending_payment: 'Ожидает оплаты',
  active: 'Активна',
  past_due: 'Есть задолженность',
  grace: 'Льготный период',
  read_only: 'Только чтение',
  suspended: 'Приостановлена',
  expired: 'Истекла',
  canceled: 'Отменена',
  free: 'Бесплатная',
  beta: 'Бета',
};

export function SubscriptionsPage({ organizations: _organizations, products: _products, canManage }: Props) {
  const [items, setItems] = useState<Subscription[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [commercial, setCommercial] = useState<Commercial | null>(null);
  const [form, setForm] = useState({ planId: '', months: 1, status: 'active', paymentMethod: '', addons: [] as string[], customPrice: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const result = await api<{ items: Subscription[] }>('/api/v1/subscriptions');
    setItems(result.items);
    setError('');
  };
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить подписки')); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => (statusFilter === 'all' || item.status === statusFilter) && (!needle || [item.organization_name, item.product_name, item.plan_name, item.product_code].some((value) => String(value || '').toLowerCase().includes(needle))));
  }, [items, query, statusFilter]);

  useEffect(() => {
    if (!filtered.length) { setSelectedId(''); return; }
    if (!filtered.some((item) => item.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected) { setCommercial(null); return; }
    let cancelled = false;
    api<Commercial>(`/api/v1/products/${selected.product_id}/commercial`).then((data) => {
      if (cancelled) return;
      setCommercial(data);
      setForm({ planId: selected.plan_id || '', months: selected.billing_period_months || 1, status: selected.status, paymentMethod: selected.payment_method || data.paymentMethods.find((item) => item.enabled && item.is_default)?.method || '', addons: [], customPrice: selected.custom_price_kzt == null ? '' : String(selected.custom_price_kzt) });
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить тарифы продукта'); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  const save = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await api(`/api/v1/organizations/${selected.organization_id}/products/${selected.product_id}/subscription`, { method: 'PUT', body: JSON.stringify({ planId: form.planId || null, billingPeriodMonths: form.months, status: form.status, paymentMethod: form.paymentMethod || null, addonModuleIds: form.addons, customPriceKzt: form.customPrice === '' ? null : Number(form.customPrice) }) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить подписку'); }
    finally { setBusy(false); }
  };

  const plan = commercial?.plans.find((item) => item.id === form.planId) ?? null;
  const included = new Set(plan?.modules.filter((item) => item.mode === 'included').map((item) => item.moduleId) || []);
  const sellable = commercial?.modules.filter((item) => item.commercial_role === 'module' && item.separately_sellable) || [];
  const estimate = plan?.pricing_mode === 'request' ? null : Number(plan?.prices?.[String(form.months)] || 0) + form.addons.reduce((sum, id) => sum + Number(sellable.find((item) => item.id === id)?.prices?.[String(form.months)] || 0), 0);
  const active = items.filter((item) => item.status === 'active').length;
  const trial = items.filter((item) => item.status === 'trial').length;
  const risk = items.filter((item) => ['past_due','grace','suspended','expired'].includes(item.status)).length;

  return <section className="subscriptions-page">
    <div className="subscriptions-kpis"><article><span>Подписки</span><strong>{items.length}</strong><small>всего</small></article><article><span>Активные</span><strong>{active}</strong><small>с действующим доступом</small></article><article><span>Пробный период</span><strong>{trial}</strong><small>тестовый доступ</small></article><article className={risk ? 'warn' : ''}><span>Требуют внимания</span><strong>{risk}</strong><small>задолженность, льготный период или приостановка</small></article></div>
    <div className="subscriptions-toolbar"><label><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Организация, продукт, тариф…"/></label><label><SlidersHorizontal size={15}/><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Все статусы</option>{statusOptions.map((status) => <option key={status} value={status}>{statusLabels[status] || status}</option>)}</select></label></div>
    {error && <div className="vps-error">{error}</div>}
    <div className="subscriptions-workspace">
      <div className="subscriptions-list-panel"><div className="subscriptions-head"><div><span>ДОСТУП К ПРОДУКТАМ</span><h2>Подписки</h2></div><small>{filtered.length} записей</small></div>{!filtered.length ? <EmptyState title="Подписок нет" text="Подписка появится после назначения продукта организации."/> : <div className="subscriptions-list">{filtered.map((item) => <button key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><div><strong>{item.organization_name}</strong><span>{item.product_name} · {item.plan_name || 'Без тарифа'}</span><small>{item.billing_period_months} мес. · доступ до {date(item.access_ends_at)}</small></div><Status value={item.status}/></button>)}</div>}</div>
      <div className="subscriptions-detail-panel">{!selected ? <EmptyState title="Выберите подписку" text="Здесь появятся тариф, срок и настройки доступа."/> : <><div className="subscriptions-detail-head"><div><span>ПОДПИСКА</span><h2>{selected.organization_name}</h2><p>{selected.product_name} · {selected.plan_name || 'Без тарифа'}</p></div><Status value={selected.status}/></div><div className="subscriptions-facts"><div><span>Период</span><strong>{selected.billing_period_months} мес.</strong></div><div><span>Стоимость тарифа</span><strong>{money(selected.base_price_kzt)}</strong></div><div><span>Доп. модули</span><strong>{money(selected.addons_price_kzt)}</strong></div><div><span>Индивидуальная цена</span><strong>{money(selected.custom_price_kzt)}</strong></div><div><span>Текущий период до</span><strong>{date(selected.current_period_end)}</strong></div><div><span>Доступ до</span><strong>{date(selected.access_ends_at)}</strong></div></div>
      {commercial && <div className="subscriptions-editor"><div className="subscriptions-editor-head"><PackageCheck size={16}/><div><strong>Управление доступом</strong><span>Тариф, период, дополнительные модули и статус подписки</span></div></div><div className="subscriptions-form-grid"><label>Тариф<select disabled={!canManage} value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value, addons: [] })}><option value="">Без тарифа</option>{commercial.plans.filter((item) => item.status !== 'archived').map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'published' ? ' · черновик' : ''}</option>)}</select></label><label>Период<select disabled={!canManage} value={form.months} onChange={(e) => setForm({ ...form, months: Number(e.target.value) })}>{[1,3,6,12].map((n) => <option key={n} value={n}>{n} мес.</option>)}</select></label><label>Статус<select disabled={!canManage} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{statusOptions.map((status) => <option key={status} value={status}>{statusLabels[status] || status}</option>)}</select></label><label>Оплата<select disabled={!canManage} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="">Не выбрана</option>{commercial.paymentMethods.filter((item) => item.enabled).map((item) => <option key={item.method} value={item.method}>{item.display_name}</option>)}</select></label>{plan?.pricing_mode === 'request' && <label>Индивидуальная цена<input disabled={!canManage} type="number" min="0" value={form.customPrice} onChange={(e) => setForm({ ...form, customPrice: e.target.value })}/></label>}</div><div className="subscriptions-addons"><strong>Модули</strong>{commercial.modules.filter((item) => item.commercial_role === 'module').map((item) => <label key={item.id} className={included.has(item.id) ? 'included' : ''}><input type="checkbox" disabled={!canManage || included.has(item.id) || !item.separately_sellable} checked={included.has(item.id) || form.addons.includes(item.id)} onChange={(e) => setForm({ ...form, addons: e.target.checked ? [...form.addons, item.id] : form.addons.filter((id) => id !== item.id) })}/><span><b>{item.name}</b><small>{included.has(item.id) ? 'Включён в тариф' : item.separately_sellable ? money(item.prices?.[String(form.months)]) : 'Не продаётся отдельно'}</small></span></label>)}</div><div className="subscriptions-summary"><div><CreditCard size={16}/><span>Расчёт</span></div><strong>{plan?.pricing_mode === 'request' ? (form.customPrice ? money(form.customPrice) : 'По запросу') : money(estimate)}</strong><small>{form.months} мес. · {statusLabels[form.status] || form.status}</small>{canManage && <button disabled={busy} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить подписку'}</button>}</div></div>}</>}</div>
    </div>
  </section>;
}
