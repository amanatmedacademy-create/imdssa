import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, RefreshCw, RotateCcw, SearchCheck, WalletCards } from 'lucide-react';
import type { Organization } from '../../controlCenter';
import { api, EmptyState, Status } from '../../controlCenter';
import './billingPage.css';

type Subscription = {
  id: string;
  organization_id: string;
  organization_name: string;
  product_name: string;
  product_code: string;
  plan_name: string | null;
  status: string;
  billing_period_months: number;
  base_price_kzt: string | number | null;
  addons_price_kzt: string | number;
  custom_price_kzt: string | number | null;
};

type Invoice = {
  id: string;
  invoice_number: string;
  organization_id: string;
  organization_name: string;
  product_name: string;
  product_code: string;
  plan_name: string | null;
  status: string;
  total_kzt: string | number;
  paid_total_kzt: string | number;
  outstanding_kzt: string | number;
  issued_at: string | null;
  due_at: string | null;
};

type Payment = {
  id: string;
  payment_number: string;
  organization_id: string;
  organization_name: string;
  status: string;
  method: string;
  amount_kzt: string | number;
  refunded_total_kzt?: string | number;
  external_reference: string | null;
  payer_name?: string | null;
  received_at: string | null;
};

type Refund = {
  id: string;
  refund_number: string;
  amount_kzt: string | number;
  provider: string;
  external_reference: string;
  payment_number: string;
  invoice_number: string;
  organization_name?: string | null;
  received_at: string;
};

type Reconciliation = {
  runs: Array<{ id: string; status: string; started_at: string; completed_at?: string | null; summary?: Record<string, unknown> }>;
  issues: Array<{ id: string; issue_type: string; severity: string; issue_key: string; organization_name?: string | null; invoice_number?: string | null }>;
};

type BillingOverview = {
  open_invoices: number;
  receivables_kzt: string | number;
  overdue_kzt: string | number;
  paid_this_month_kzt: string | number;
};

type View = 'invoices' | 'payments' | 'refunds' | 'reconciliation';
type Props = { organizations: Organization[]; canManage: boolean };

const money = (value: unknown) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(Number(value || 0));
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('ru-RU') : '—';
const openInvoiceStatuses = new Set(['issued', 'partially_paid', 'overdue']);
const refundableStatuses = new Set(['succeeded', 'partially_refunded']);
const methodLabels: Record<string, string> = { bank_transfer: 'Банковский перевод', kaspi: 'Kaspi', card: 'Карта', cash: 'Наличные', manual: 'Вручную', other: 'Другое' };

export function BillingPage({ organizations, canManage }: Props) {
  const [view, setView] = useState<View>('invoices');
  const [organizationId, setOrganizationId] = useState('all');
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [reconciliation, setReconciliation] = useState<Reconciliation>({ runs: [], issues: [] });
  const [subscriptionId, setSubscriptionId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [payerName, setPayerName] = useState('');
  const [refundPaymentId, setRefundPaymentId] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReference, setRefundReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const filterQuery = organizationId === 'all' ? '' : `?organizationId=${encodeURIComponent(organizationId)}`;

  const load = async () => {
    setLoading(true);
    try {
      const [overviewResult, subscriptionResult, invoiceResult, paymentResult, refundResult, reconciliationResult] = await Promise.all([
        api<BillingOverview>('/api/v1/billing/overview'),
        api<{ items: Subscription[] }>(`/api/v1/subscriptions${filterQuery}`),
        api<{ items: Invoice[] }>(`/api/v1/billing/invoices${filterQuery}`),
        api<{ items: Payment[] }>(`/api/v1/billing/payments${filterQuery}`),
        api<{ items: Refund[] }>(`/api/v1/billing/refunds${filterQuery}`),
        api<Reconciliation>('/api/v1/billing/reconciliation'),
      ]);
      setOverview(overviewResult);
      setSubscriptions(subscriptionResult.items);
      setInvoices(invoiceResult.items);
      setPayments(paymentResult.items);
      setRefunds(refundResult.items);
      setReconciliation(reconciliationResult);
      setError('');

      setSubscriptionId((current) => subscriptionResult.items.some((item) => item.id === current) ? current : subscriptionResult.items[0]?.id || '');
      const openInvoice = invoiceResult.items.find((item) => openInvoiceStatuses.has(item.status));
      setInvoiceId((current) => invoiceResult.items.some((item) => item.id === current && openInvoiceStatuses.has(item.status)) ? current : openInvoice?.id || '');
      setPaymentAmount(openInvoice ? String(openInvoice.outstanding_kzt) : '');
      const refundable = paymentResult.items.find((item) => refundableStatuses.has(item.status) && Number(item.amount_kzt) > Number(item.refunded_total_kzt || 0));
      setRefundPaymentId((current) => paymentResult.items.some((item) => item.id === current) ? current : refundable?.id || '');
      setRefundAmount(refundable ? String(Number(refundable.amount_kzt) - Number(refundable.refunded_total_kzt || 0)) : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки биллинга');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [organizationId]);

  const selectedInvoice = useMemo(() => invoices.find((item) => item.id === invoiceId) || null, [invoices, invoiceId]);
  const selectedRefundPayment = useMemo(() => payments.find((item) => item.id === refundPaymentId) || null, [payments, refundPaymentId]);
  const refundablePayments = useMemo(() => payments.filter((item) => refundableStatuses.has(item.status) && Number(item.amount_kzt) > Number(item.refunded_total_kzt || 0)), [payments]);

  useEffect(() => { if (selectedInvoice) setPaymentAmount(String(selectedInvoice.outstanding_kzt)); }, [selectedInvoice?.id]);
  useEffect(() => { if (selectedRefundPayment) setRefundAmount(String(Math.max(0, Number(selectedRefundPayment.amount_kzt) - Number(selectedRefundPayment.refunded_total_kzt || 0)))); }, [selectedRefundPayment?.id]);

  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка операции'); }
    finally { setBusy(false); }
  };

  const createInvoice = async () => {
    if (!subscriptionId) return;
    await mutate(() => api('/api/v1/billing/invoices', { method: 'POST', body: JSON.stringify({ subscriptionId, issue: true, dueDays: 7 }) }));
  };

  const confirmPayment = async () => {
    if (!invoiceId || !Number(paymentAmount)) return;
    await mutate(async () => {
      await api('/api/v1/billing/payments', { method: 'POST', body: JSON.stringify({ invoiceId, amountKzt: Number(paymentAmount), method: paymentMethod, externalReference: paymentReference || null, payerName: payerName || null }) });
      setPaymentReference(''); setPayerName('');
    });
  };

  const confirmRefund = async () => {
    if (!refundPaymentId || !Number(refundAmount) || !refundReference) return;
    await mutate(async () => {
      await api('/api/v1/billing/refunds', { method: 'POST', body: JSON.stringify({ paymentId: refundPaymentId, amountKzt: Number(refundAmount), provider: 'manual', externalReference: refundReference }) });
      setRefundReference('');
    });
  };

  const runReconciliation = async () => {
    await mutate(() => api('/api/v1/billing/reconciliation/run', { method: 'POST', body: '{}' }));
  };

  const selectedSubscription = subscriptions.find((item) => item.id === subscriptionId) || null;

  return <section className="ccbilling-page">
    <div className="ccbilling-kpis">
      <article><span>Открытые счета</span><strong>{overview?.open_invoices ?? 0}</strong><small>issued / partial / overdue</small></article>
      <article><span>Дебиторка</span><strong>{money(overview?.receivables_kzt)}</strong><small>всего к получению</small></article>
      <article className={Number(overview?.overdue_kzt || 0) > 0 ? 'warn' : ''}><span>Просрочено</span><strong>{money(overview?.overdue_kzt)}</strong><small>требует внимания</small></article>
      <article><span>Оплачено в этом месяце</span><strong>{money(overview?.paid_this_month_kzt)}</strong><small>фактические платежи</small></article>
      <article className={reconciliation.issues.length ? 'warn' : ''}><span>Расхождения</span><strong>{reconciliation.issues.length}</strong><small>по сверке</small></article>
    </div>

    <div className="ccbilling-toolbar">
      <label><SearchCheck size={16}/><select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}><option value="all">Все организации</option>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button type="button" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15}/>{loading ? 'Загрузка…' : 'Обновить'}</button>
      {canManage && <button type="button" className="primary" disabled={busy} onClick={() => void runReconciliation()}><SearchCheck size={15}/>Сверить платежи</button>}
    </div>

    {error && <div className="vps-error">API: {error}</div>}

    {canManage && <div className="ccbilling-actions">
      <article>
        <div className="ccbilling-action-head"><WalletCards size={17}/><div><strong>Выставить счёт</strong><span>По действующей подписке</span></div></div>
        <label>Подписка<select value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)}><option value="">Не выбрана</option>{subscriptions.map((item) => <option key={item.id} value={item.id}>{item.organization_name ? `${item.organization_name} · ` : ''}{item.product_name} · {item.plan_name || 'Без тарифа'} · {item.status}</option>)}</select></label>
        <div className="ccbilling-action-summary"><span>Период</span><strong>{selectedSubscription ? `${selectedSubscription.billing_period_months} мес.` : '—'}</strong><span>Цена</span><strong>{selectedSubscription ? money(selectedSubscription.custom_price_kzt ?? (Number(selectedSubscription.base_price_kzt || 0) + Number(selectedSubscription.addons_price_kzt || 0))) : '—'}</strong></div>
        <button type="button" className="primary" disabled={busy || !subscriptionId} onClick={() => void createInvoice()}>Выставить счёт</button>
      </article>

      <article>
        <div className="ccbilling-action-head"><Banknote size={17}/><div><strong>Подтвердить оплату</strong><span>Полная оплата активирует / продлевает подписку</span></div></div>
        <label>Счёт<select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}><option value="">Нет открытых счетов</option>{invoices.filter((item) => openInvoiceStatuses.has(item.status)).map((item) => <option key={item.id} value={item.id}>{item.invoice_number} · {item.organization_name} · {money(item.outstanding_kzt)}</option>)}</select></label>
        <div className="ccbilling-form-grid"><label>Сумма, KZT<input type="number" min="1" max={selectedInvoice ? Number(selectedInvoice.outstanding_kzt) : undefined} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}/></label><label>Способ<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>{Object.entries(methodLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Референс<input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Номер транзакции"/></label><label>Плательщик<input value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="Компания / ФИО"/></label></div>
        <button type="button" className="primary" disabled={busy || !invoiceId || !Number(paymentAmount)} onClick={() => void confirmPayment()}>Подтвердить оплату</button>
      </article>

      <article>
        <div className="ccbilling-action-head"><RotateCcw size={17}/><div><strong>Возврат</strong><span>Пересчитывает net paid и lifecycle</span></div></div>
        <label>Платёж<select value={refundPaymentId} onChange={(e) => setRefundPaymentId(e.target.value)}><option value="">Нет доступных платежей</option>{refundablePayments.map((item) => <option key={item.id} value={item.id}>{item.payment_number} · {item.organization_name} · {money(Number(item.amount_kzt) - Number(item.refunded_total_kzt || 0))}</option>)}</select></label>
        <div className="ccbilling-form-grid compact"><label>Сумма, KZT<input type="number" min="1" max={selectedRefundPayment ? Math.max(0, Number(selectedRefundPayment.amount_kzt) - Number(selectedRefundPayment.refunded_total_kzt || 0)) : undefined} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)}/></label><label>Референс возврата<input value={refundReference} onChange={(e) => setRefundReference(e.target.value)} placeholder="Номер возврата"/></label></div>
        <button type="button" className="danger" disabled={busy || !refundPaymentId || !Number(refundAmount) || !refundReference} onClick={() => void confirmRefund()}>Подтвердить возврат</button>
      </article>
    </div>}

    <div className="ccbilling-ledger">
      <div className="ccbilling-tabs">
        <button type="button" className={view === 'invoices' ? 'active' : ''} onClick={() => setView('invoices')}><CreditCard size={15}/>Счета</button>
        <button type="button" className={view === 'payments' ? 'active' : ''} onClick={() => setView('payments')}><Banknote size={15}/>Платежи</button>
        <button type="button" className={view === 'refunds' ? 'active' : ''} onClick={() => setView('refunds')}><RotateCcw size={15}/>Возвраты</button>
        <button type="button" className={view === 'reconciliation' ? 'active' : ''} onClick={() => setView('reconciliation')}><SearchCheck size={15}/>Сверка</button>
      </div>

      {view === 'invoices' && (!invoices.length ? <EmptyState title="Счетов пока нет" text="После выставления счета он появится здесь." /> : <div className="ccbilling-table"><table><thead><tr><th>Счёт</th><th>Организация / продукт</th><th>Статус</th><th>Сумма</th><th>Оплачено</th><th>Остаток</th><th>Срок</th></tr></thead><tbody>{invoices.map((item) => <tr key={item.id}><td><strong>{item.invoice_number}</strong><small>{date(item.issued_at)}</small></td><td><strong>{item.organization_name}</strong><small>{item.product_name} · {item.plan_name || item.product_code}</small></td><td><Status value={item.status}/></td><td>{money(item.total_kzt)}</td><td>{money(item.paid_total_kzt)}</td><td>{money(item.outstanding_kzt)}</td><td>{date(item.due_at)}</td></tr>)}</tbody></table></div>)}
      {view === 'payments' && (!payments.length ? <EmptyState title="Платежей пока нет" text="Подтвержденные платежи появятся здесь." /> : <div className="ccbilling-table"><table><thead><tr><th>Платёж</th><th>Организация</th><th>Статус</th><th>Способ</th><th>Сумма</th><th>Возвращено</th><th>Получен</th></tr></thead><tbody>{payments.map((item) => <tr key={item.id}><td><strong>{item.payment_number}</strong><small>{item.external_reference || 'Без внешнего ID'}</small></td><td>{item.organization_name}</td><td><Status value={item.status}/></td><td>{methodLabels[item.method] || item.method}</td><td>{money(item.amount_kzt)}</td><td>{money(item.refunded_total_kzt)}</td><td>{date(item.received_at)}</td></tr>)}</tbody></table></div>)}
      {view === 'refunds' && (!refunds.length ? <EmptyState title="Возвратов пока нет" text="История возвратов появится здесь." /> : <div className="ccbilling-table"><table><thead><tr><th>Возврат</th><th>Организация</th><th>Платёж / счёт</th><th>Сумма</th><th>Provider</th><th>Дата</th></tr></thead><tbody>{refunds.map((item) => <tr key={item.id}><td><strong>{item.refund_number}</strong><small>{item.external_reference}</small></td><td>{item.organization_name || '—'}</td><td><strong>{item.payment_number}</strong><small>{item.invoice_number}</small></td><td>{money(item.amount_kzt)}</td><td>{item.provider}</td><td>{date(item.received_at)}</td></tr>)}</tbody></table></div>)}
      {view === 'reconciliation' && <div className="ccbilling-reconciliation"><section><div className="ccbilling-ledger-head"><strong>Последние сверки</strong><small>{reconciliation.runs.length}</small></div>{!reconciliation.runs.length ? <EmptyState title="Сверок пока нет" text="Запустите ручную сверку платежей." /> : reconciliation.runs.map((run) => <article key={run.id}><div><strong>{date(run.started_at)}</strong><small>{run.completed_at ? `Завершена ${date(run.completed_at)}` : 'Выполняется'}</small></div><Status value={run.status}/><pre>{JSON.stringify(run.summary || {}, null, 2)}</pre></article>)}</section><section><div className="ccbilling-ledger-head"><strong>Расхождения</strong><small>{reconciliation.issues.length}</small></div>{!reconciliation.issues.length ? <EmptyState title="Расхождений нет" text="Состояние платежей согласовано." /> : reconciliation.issues.map((issue) => <article key={issue.id} className="issue"><div><strong>{issue.issue_type}</strong><small>{issue.organization_name || issue.invoice_number || issue.issue_key}</small></div><Status value={issue.severity}/></article>)}</section></div>}
    </div>
  </section>;
}
