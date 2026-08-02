import {
  BadgeDollarSign,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  CreditCard,
  Edit3,
  FileKey2,
  Gauge,
  KeyRound,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import type { Json } from '../../lib/database.types';
import type { BillingInterval, RenewalMode, SubscriptionStatus } from './billingDatabase.types';
import { useBilling } from './BillingContext';
import type { ActivateSubscriptionInput, Subscription, Tariff, TariffInput } from './billingRepository';

const subscriptionStatusLabels: Record<SubscriptionStatus, string> = {
  trial: 'Trial',
  active: 'Активна',
  past_due: 'Просрочка',
  grace_period: 'Grace period',
  suspended: 'Приостановлена',
  cancelled: 'Отменена',
  expired: 'Истекла',
};

const intervalLabels: Record<BillingInterval, string> = {
  monthly: 'Ежемесячно',
  annual: 'Ежегодно',
  custom: 'Индивидуально',
};

const renewalLabels: Record<RenewalMode, string> = {
  manual: 'Ручное продление',
  automatic: 'Автопродление',
};

const emptyTariff: TariffInput = {
  id: null,
  code: '',
  name: '',
  description: '',
  currency: 'KZT',
  monthlyPrice: 0,
  annualPrice: null,
  trialDays: 0,
  graceDays: 7,
  isCustom: false,
  isActive: true,
  productIds: [],
};

const emptySubscription: ActivateSubscriptionInput = {
  organizationId: '',
  tariffId: '',
  billingInterval: 'monthly',
  renewalMode: 'manual',
  startsAt: new Date().toISOString().slice(0, 10),
  customPrice: null,
  productIds: [],
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function statusClass(status: SubscriptionStatus) {
  if (status === 'active') return 'ok';
  if (status === 'trial') return 'info';
  if (status === 'past_due' || status === 'grace_period') return 'warn';
  if (status === 'suspended') return 'danger';
  return 'muted';
}

function licenseStatusClass(status: string) {
  if (status === 'active') return 'ok';
  if (status === 'pending' || status === 'provisioning') return 'info';
  if (status === 'suspended' || status === 'failed') return 'warn';
  return 'muted';
}

function formatMoney(value: number, currency: string, custom = false) {
  if (custom && value === 0) return 'Индивидуально';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function monthlyEquivalent(subscription: Subscription) {
  if (subscription.billingInterval === 'annual') return subscription.effectivePrice / 12;
  if (subscription.billingInterval === 'custom') return 0;
  return subscription.effectivePrice;
}

function allowedTransitions(status: SubscriptionStatus): SubscriptionStatus[] {
  switch (status) {
    case 'trial': return ['active', 'cancelled', 'expired'];
    case 'active': return ['past_due', 'suspended', 'cancelled', 'expired'];
    case 'past_due': return ['active', 'grace_period', 'suspended', 'cancelled'];
    case 'grace_period': return ['active', 'suspended', 'cancelled'];
    case 'suspended': return ['active', 'cancelled', 'expired'];
    default: return [];
  }
}

function parseEntitlementValue(value: string): Json {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed) as Json;
  } catch {
    return trimmed;
  }
}

export function SubscriptionsPage() {
  const { can, isDemo } = useAuth();
  const {
    tariffs,
    subscriptions,
    organizations,
    products,
    loading,
    saving,
    error,
    refresh,
    saveTariff,
    activateSubscription,
    transitionSubscription,
    setEntitlement,
  } = useBilling();
  const tariffDialog = useRef<HTMLDialogElement | null>(null);
  const subscriptionDialog = useRef<HTMLDialogElement | null>(null);
  const licensesDialog = useRef<HTMLDialogElement | null>(null);
  const [tab, setTab] = useState<'subscriptions' | 'tariffs'>('subscriptions');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SubscriptionStatus>('all');
  const [tariffForm, setTariffForm] = useState<TariffInput>(emptyTariff);
  const [subscriptionForm, setSubscriptionForm] = useState<ActivateSubscriptionInput>(emptySubscription);
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null);
  const [entitlementLicenseId, setEntitlementLicenseId] = useState('');
  const [entitlementKey, setEntitlementKey] = useState('');
  const [entitlementValue, setEntitlementValue] = useState('true');
  const [entitlementReason, setEntitlementReason] = useState('');
  const [validation, setValidation] = useState('');
  const canManage = can('subscriptions.manage');

  const selectedSubscription = selectedSubscriptionId
    ? subscriptions.find((subscription) => subscription.id === selectedSubscriptionId) ?? null
    : null;

  const filteredSubscriptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return subscriptions.filter((subscription) => {
      if (statusFilter !== 'all' && subscription.status !== statusFilter) return false;
      if (!normalized) return true;
      return [subscription.organizationName, subscription.tariffName, ...subscription.licenses.map((license) => license.productName)]
        .some((value) => value.toLowerCase().includes(normalized));
    });
  }, [query, statusFilter, subscriptions]);

  const metrics = useMemo(() => ({
    mrr: subscriptions
      .filter((subscription) => subscription.status === 'active')
      .reduce((sum, subscription) => sum + monthlyEquivalent(subscription), 0),
    active: subscriptions.filter((subscription) => subscription.status === 'active').length,
    attention: subscriptions.filter((subscription) => ['past_due', 'grace_period', 'suspended'].includes(subscription.status)).length,
    licenses: subscriptions.reduce((sum, subscription) => sum + subscription.licenses.filter((license) => license.status !== 'revoked').length, 0),
  }), [subscriptions]);

  const openTariff = (tariff?: Tariff) => {
    setTariffForm(tariff ? {
      id: tariff.id,
      code: tariff.code,
      name: tariff.name,
      description: tariff.description,
      currency: tariff.currency,
      monthlyPrice: tariff.monthlyPrice,
      annualPrice: tariff.annualPrice,
      trialDays: tariff.trialDays,
      graceDays: tariff.graceDays,
      isCustom: tariff.isCustom,
      isActive: tariff.isActive,
      productIds: tariff.productIds,
    } : emptyTariff);
    setValidation('');
    tariffDialog.current?.showModal();
  };

  const submitTariff = async (event: FormEvent) => {
    event.preventDefault();
    const normalized: TariffInput = {
      ...tariffForm,
      code: (tariffForm.code || slugify(tariffForm.name)).trim().toLowerCase(),
      name: tariffForm.name.trim(),
      description: tariffForm.description.trim(),
      currency: tariffForm.currency.trim().toUpperCase(),
      monthlyPrice: Number(tariffForm.monthlyPrice),
      annualPrice: tariffForm.annualPrice === null ? null : Number(tariffForm.annualPrice),
      trialDays: Number(tariffForm.trialDays),
      graceDays: Number(tariffForm.graceDays),
    };

    if (!normalized.name || !normalized.code) {
      setValidation('Название и код тарифа обязательны.');
      return;
    }
    if (!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(normalized.code)) {
      setValidation('Код тарифа может содержать латинские буквы, цифры, точку, дефис и подчёркивание.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(normalized.currency)) {
      setValidation('Валюта должна быть в формате KZT, USD или EUR.');
      return;
    }
    if (normalized.monthlyPrice < 0 || (normalized.annualPrice !== null && normalized.annualPrice < 0)) {
      setValidation('Цена не может быть отрицательной.');
      return;
    }
    if (normalized.productIds.length === 0) {
      setValidation('Добавьте в тариф минимум один продукт.');
      return;
    }
    const duplicate = tariffs.some((tariff) => tariff.id !== normalized.id && tariff.code === normalized.code);
    if (duplicate) {
      setValidation('Тариф с таким кодом уже существует.');
      return;
    }

    if (await saveTariff(normalized)) tariffDialog.current?.close();
  };

  const openSubscription = () => {
    const firstTariff = tariffs.find((tariff) => tariff.isActive && !tariff.archivedAt);
    setSubscriptionForm({
      ...emptySubscription,
      organizationId: organizations.find((organization) => organization.status !== 'archived')?.id ?? '',
      tariffId: firstTariff?.id ?? '',
      productIds: firstTariff?.productIds ?? [],
    });
    setValidation('');
    subscriptionDialog.current?.showModal();
  };

  const selectTariff = (tariffId: string) => {
    const tariff = tariffs.find((item) => item.id === tariffId);
    setSubscriptionForm({
      ...subscriptionForm,
      tariffId,
      productIds: tariff?.productIds ?? [],
      customPrice: tariff?.isCustom ? 0 : null,
    });
  };

  const submitSubscription = async (event: FormEvent) => {
    event.preventDefault();
    if (!subscriptionForm.organizationId || !subscriptionForm.tariffId) {
      setValidation('Выберите компанию и тариф.');
      return;
    }
    if (subscriptionForm.productIds.length === 0) {
      setValidation('Подписка должна включать минимум один продукт.');
      return;
    }
    if (!subscriptionForm.startsAt || Number.isNaN(new Date(subscriptionForm.startsAt).getTime())) {
      setValidation('Укажите корректную дату начала.');
      return;
    }
    if (subscriptionForm.customPrice !== null && subscriptionForm.customPrice < 0) {
      setValidation('Индивидуальная цена не может быть отрицательной.');
      return;
    }

    if (await activateSubscription(subscriptionForm)) subscriptionDialog.current?.close();
  };

  const transition = async (subscription: Subscription, status: SubscriptionStatus) => {
    const reason = window.prompt(`Причина перехода «${subscriptionStatusLabels[subscription.status]}» → «${subscriptionStatusLabels[status]}»:`);
    if (!reason?.trim()) return;
    await transitionSubscription(subscription.id, status, reason.trim());
  };

  const openLicenses = (subscription: Subscription) => {
    setSelectedSubscriptionId(subscription.id);
    setEntitlementLicenseId(subscription.licenses[0]?.id ?? '');
    setEntitlementKey('');
    setEntitlementValue('true');
    setEntitlementReason('');
    setValidation('');
    licensesDialog.current?.showModal();
  };

  const submitEntitlement = async (event: FormEvent) => {
    event.preventDefault();
    const key = entitlementKey.trim().toLowerCase();
    if (!entitlementLicenseId || !key) {
      setValidation('Выберите лицензию и укажите ключ entitlement.');
      return;
    }
    if (!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(key)) {
      setValidation('Ключ entitlement имеет неверный формат.');
      return;
    }
    if (entitlementReason.trim().length < 5) {
      setValidation('Укажите причину изменения минимум из 5 символов.');
      return;
    }

    const success = await setEntitlement(
      entitlementLicenseId,
      key,
      parseEntitlementValue(entitlementValue),
      entitlementReason.trim(),
    );
    if (success) {
      setEntitlementKey('');
      setEntitlementReason('');
      setValidation('');
    }
  };

  const toggleTariffProduct = (productId: string) => {
    const selected = tariffForm.productIds.includes(productId);
    setTariffForm({
      ...tariffForm,
      productIds: selected
        ? tariffForm.productIds.filter((id) => id !== productId)
        : [...tariffForm.productIds, productId],
    });
  };

  const toggleSubscriptionProduct = (productId: string) => {
    const selected = subscriptionForm.productIds.includes(productId);
    setSubscriptionForm({
      ...subscriptionForm,
      productIds: selected
        ? subscriptionForm.productIds.filter((id) => id !== productId)
        : [...subscriptionForm.productIds, productId],
    });
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Commercial Control Plane</span>
          <h1>Подписки и лицензии</h1>
          <p>Тарифы, продуктовые лицензии, жизненный цикл подписок и точечные entitlements.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || saving}><RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить</button>
          {canManage && (tab === 'subscriptions'
            ? <button className="primary-button" type="button" onClick={openSubscription}><Plus size={17} /> Новая подписка</button>
            : <button className="primary-button" type="button" onClick={() => openTariff()}><Plus size={17} /> Новый тариф</button>)}
        </div>
      </div>

      {isDemo && <div className="mode-banner"><ShieldCheck size={18} /><div><strong>Демо-режим коммерческого контура</strong><span>Данные сохраняются в браузере. После применения миграции команды выполняются через защищённые Supabase RPC.</span></div></div>}
      {!canManage && <div className="mode-banner"><BadgeDollarSign size={18} /><div><strong>Режим просмотра</strong><span>Текущая роль может видеть подписки и лицензии, но не изменять коммерческие условия.</span></div></div>}
      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span></div>}

      <section className="metrics billing-metrics">
        <article className="metric-card"><div className="metric-icon"><CreditCard size={21} /></div><div><span>Расчётный MRR</span><strong>{formatMoney(metrics.mrr, 'KZT')}</strong><small>без custom interval</small></div></article>
        <article className="metric-card"><div className="metric-icon"><CheckCircle2 size={21} /></div><div><span>Активные подписки</span><strong>{metrics.active}</strong><small>production-доступ</small></div></article>
        <article className="metric-card"><div className="metric-icon"><CircleAlert size={21} /></div><div><span>Требуют внимания</span><strong>{metrics.attention}</strong><small>оплата или блокировка</small></div></article>
        <article className="metric-card"><div className="metric-icon"><FileKey2 size={21} /></div><div><span>Лицензии</span><strong>{metrics.licenses}</strong><small>не отозваны</small></div></article>
      </section>

      <div className="section-tabs">
        <button className={tab === 'subscriptions' ? 'active' : ''} type="button" onClick={() => setTab('subscriptions')}><Layers3 size={16} /> Подписки <span>{subscriptions.length}</span></button>
        <button className={tab === 'tariffs' ? 'active' : ''} type="button" onClick={() => setTab('tariffs')}><SlidersHorizontal size={16} /> Тарифы <span>{tariffs.length}</span></button>
      </div>

      {tab === 'subscriptions' ? (
        <section className="panel billing-panel">
          <div className="billing-toolbar">
            <div className="search registry-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Компания, тариф или продукт..." /></div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | SubscriptionStatus)}><option value="all">Все статусы</option>{Object.entries(subscriptionStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select>
            <span>Найдено: {filteredSubscriptions.length}</span>
          </div>
          {loading ? <div className="inline-loading"><LoaderCircle className="spin" size={27} /><span>Загрузка подписок...</span></div> : filteredSubscriptions.length === 0 ? <div className="inline-empty"><BadgeDollarSign size={30} /><h2>Подписки не найдены</h2><p>Создайте подписку или измените фильтры.</p></div> : (
            <div className="table-wrap billing-table-wrap"><table className="billing-table"><thead><tr><th>Компания / тариф</th><th>Статус</th><th>Лицензии</th><th>Стоимость</th><th>Период</th><th>Продление</th><th /></tr></thead><tbody>{filteredSubscriptions.map((subscription) => <tr key={subscription.id}>
              <td><div className="subscription-company"><div className="company-avatar">{subscription.organizationName.slice(0, 2).toUpperCase()}</div><div><strong>{subscription.organizationName}</strong><span>{subscription.tariffName} · {intervalLabels[subscription.billingInterval]}</span></div></div></td>
              <td><span className={`status ${statusClass(subscription.status)}`}>{subscriptionStatusLabels[subscription.status]}</span></td>
              <td><button className="license-count-button" type="button" onClick={() => openLicenses(subscription)}><FileKey2 size={15} /><span><strong>{subscription.licenses.length}</strong><small>Открыть лицензии</small></span><ChevronRight size={14} /></button></td>
              <td><strong className="price-cell">{formatMoney(subscription.effectivePrice, subscription.currency, subscription.customPrice !== null || subscription.billingInterval === 'custom')}</strong></td>
              <td><div className="period-cell"><span><CalendarClock size={13} /> {formatDate(subscription.startsAt)}</span><span><Clock3 size={13} /> до {formatDate(subscription.trialEndsAt ?? subscription.graceEndsAt ?? subscription.periodEndsAt)}</span></div></td>
              <td><span className="renewal-cell">{renewalLabels[subscription.renewalMode]}</span></td>
              <td>{canManage && allowedTransitions(subscription.status).length > 0 && <select className="transition-select" defaultValue="" onChange={(event) => { const next = event.target.value as SubscriptionStatus; event.target.value = ''; if (next) void transition(subscription, next); }}><option value="">Изменить статус</option>{allowedTransitions(subscription.status).map((status) => <option key={status} value={status}>{subscriptionStatusLabels[status]}</option>)}</select>}</td>
            </tr>)}</tbody></table></div>
          )}
        </section>
      ) : (
        <div className="tariff-grid">{tariffs.map((tariff) => <article className={`tariff-card ${!tariff.isActive ? 'inactive' : ''}`} key={tariff.id}>
          <div className="tariff-card-header"><div><span className="eyebrow">{tariff.code}</span><h2>{tariff.name}</h2></div><span className={`status ${tariff.isActive ? 'ok' : 'muted'}`}>{tariff.isActive ? 'Активен' : 'Отключён'}</span></div>
          <p>{tariff.description || 'Описание тарифа не заполнено.'}</p>
          <div className="tariff-price"><strong>{formatMoney(tariff.monthlyPrice, tariff.currency, tariff.isCustom)}</strong><span>/ месяц</span>{tariff.annualPrice !== null && <small>{formatMoney(tariff.annualPrice, tariff.currency)} / год</small>}</div>
          <div className="tariff-terms"><span><Gauge size={14} /> Trial: {tariff.trialDays} дней</span><span><Clock3 size={14} /> Grace: {tariff.graceDays} дней</span><span><Boxes size={14} /> {tariff.productIds.length} продуктов</span></div>
          <div className="tariff-products">{tariff.productIds.map((productId) => <span key={productId}>{products.find((product) => product.id === productId)?.name ?? productId}</span>)}</div>
          {canManage && <button className="secondary-button" type="button" onClick={() => openTariff(tariff)}><Edit3 size={15} /> Изменить тариф</button>}
        </article>)}</div>
      )}

      <dialog ref={tariffDialog} className="modal wide-modal" onCancel={() => tariffDialog.current?.close()}>
        <form onSubmit={submitTariff}>
          <div className="modal-header"><div><span className="eyebrow">Tariff Definition</span><h2>{tariffForm.id ? 'Изменить тариф' : 'Новый тариф'}</h2><p>Тариф определяет коммерческие условия и набор доступных продуктов.</p></div><button className="icon-button" type="button" onClick={() => tariffDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-section"><h3>Основные параметры</h3><div className="form-grid">
            <label><span>Название *</span><input required value={tariffForm.name} onChange={(event) => setTariffForm({ ...tariffForm, name: event.target.value, code: tariffForm.id ? tariffForm.code : slugify(event.target.value) })} /></label>
            <label><span>Код *</span><input required value={tariffForm.code} onChange={(event) => setTariffForm({ ...tariffForm, code: slugify(event.target.value) })} /></label>
            <label className="span-2"><span>Описание</span><textarea rows={3} value={tariffForm.description} onChange={(event) => setTariffForm({ ...tariffForm, description: event.target.value })} /></label>
            <label><span>Валюта</span><input maxLength={3} value={tariffForm.currency} onChange={(event) => setTariffForm({ ...tariffForm, currency: event.target.value.toUpperCase() })} /></label>
            <label><span>Цена в месяц</span><input type="number" min="0" value={tariffForm.monthlyPrice} onChange={(event) => setTariffForm({ ...tariffForm, monthlyPrice: Number(event.target.value) })} /></label>
            <label><span>Цена в год</span><input type="number" min="0" value={tariffForm.annualPrice ?? ''} onChange={(event) => setTariffForm({ ...tariffForm, annualPrice: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <label><span>Trial, дней</span><input type="number" min="0" max="365" value={tariffForm.trialDays} onChange={(event) => setTariffForm({ ...tariffForm, trialDays: Number(event.target.value) })} /></label>
            <label><span>Grace period, дней</span><input type="number" min="0" max="90" value={tariffForm.graceDays} onChange={(event) => setTariffForm({ ...tariffForm, graceDays: Number(event.target.value) })} /></label>
            <label className="checkbox-field"><input type="checkbox" checked={tariffForm.isCustom} onChange={(event) => setTariffForm({ ...tariffForm, isCustom: event.target.checked })} /><span>Индивидуальная цена</span></label>
            <label className="checkbox-field"><input type="checkbox" checked={tariffForm.isActive} onChange={(event) => setTariffForm({ ...tariffForm, isActive: event.target.checked })} /><span>Тариф активен</span></label>
          </div></div>
          <div className="form-section"><h3>Продукты тарифа</h3><div className="product-selector-grid">{products.filter((product) => !product.archivedAt).map((product) => <label key={product.id}><input type="checkbox" checked={tariffForm.productIds.includes(product.id)} onChange={() => toggleTariffProduct(product.id)} /><span><strong>{product.name}</strong><small>{product.key}</small></span></label>)}</div></div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => tariffDialog.current?.close()}>Отмена</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Edit3 size={17} />}{saving ? 'Сохранение...' : 'Сохранить тариф'}</button></div>
        </form>
      </dialog>

      <dialog ref={subscriptionDialog} className="modal wide-modal" onCancel={() => subscriptionDialog.current?.close()}>
        <form onSubmit={submitSubscription}>
          <div className="modal-header"><div><span className="eyebrow">Subscription Activation</span><h2>Новая подписка</h2><p>После создания для каждого продукта будет сформирована лицензия со статусом pending.</p></div><button className="icon-button" type="button" onClick={() => subscriptionDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="form-grid">
            <label><span>Компания *</span><select required value={subscriptionForm.organizationId} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, organizationId: event.target.value })}><option value="">Выберите компанию</option>{organizations.filter((organization) => organization.status !== 'archived').map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
            <label><span>Тариф *</span><select required value={subscriptionForm.tariffId} onChange={(event) => selectTariff(event.target.value)}><option value="">Выберите тариф</option>{tariffs.filter((tariff) => tariff.isActive && !tariff.archivedAt).map((tariff) => <option key={tariff.id} value={tariff.id}>{tariff.name}</option>)}</select></label>
            <label><span>Период оплаты</span><select value={subscriptionForm.billingInterval} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, billingInterval: event.target.value as BillingInterval })}>{Object.entries(intervalLabels).map(([interval, label]) => <option key={interval} value={interval}>{label}</option>)}</select></label>
            <label><span>Продление</span><select value={subscriptionForm.renewalMode} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, renewalMode: event.target.value as RenewalMode })}>{Object.entries(renewalLabels).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select></label>
            <label><span>Дата начала</span><input type="date" value={subscriptionForm.startsAt} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, startsAt: event.target.value })} /></label>
            <label><span>Индивидуальная цена</span><input type="number" min="0" value={subscriptionForm.customPrice ?? ''} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, customPrice: event.target.value === '' ? null : Number(event.target.value) })} placeholder="Не задана" /></label>
          </div>
          <div className="form-section"><h3>Продукты подписки</h3><div className="product-selector-grid">{products.filter((product) => !product.archivedAt).map((product) => <label key={product.id}><input type="checkbox" checked={subscriptionForm.productIds.includes(product.id)} onChange={() => toggleSubscriptionProduct(product.id)} /><span><strong>{product.name}</strong><small>{product.key}</small></span></label>)}</div></div>
          {validation && <div className="form-message">{validation}</div>}
          <div className="modal-actions"><button className="secondary-button compact" type="button" onClick={() => subscriptionDialog.current?.close()}>Отмена</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{saving ? 'Активация...' : 'Активировать подписку'}</button></div>
        </form>
      </dialog>

      <dialog ref={licensesDialog} className="modal license-modal" onCancel={() => licensesDialog.current?.close()}>
        {selectedSubscription && <div className="license-dialog-content">
          <div className="modal-header"><div><span className="eyebrow">Licenses & Entitlements</span><h2>{selectedSubscription.organizationName}</h2><p>{selectedSubscription.tariffName} · {subscriptionStatusLabels[selectedSubscription.status]}</p></div><button className="icon-button" type="button" onClick={() => licensesDialog.current?.close()} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="license-list">{selectedSubscription.licenses.map((license) => <article key={license.id} className="license-card"><div className="license-card-header"><div className="product-symbol"><FileKey2 size={18} /></div><div><strong>{license.productName}</strong><span>{license.externalTenantId ?? 'Tenant ещё не создан'}</span></div><span className={`status ${licenseStatusClass(license.status)}`}>{license.status}</span></div><div className="entitlement-list">{license.entitlements.length ? license.entitlements.map((entitlement) => <div key={entitlement.id}><code>{entitlement.key}</code><span>{JSON.stringify(entitlement.value)}</span><small>{entitlement.source}</small></div>) : <p>Entitlements пока не назначены.</p>}</div></article>)}</div>
          {canManage && selectedSubscription.licenses.length > 0 && <form className="entitlement-form" onSubmit={submitEntitlement}><h3><KeyRound size={17} /> Переопределить entitlement</h3><div className="form-grid">
            <label><span>Лицензия</span><select value={entitlementLicenseId} onChange={(event) => setEntitlementLicenseId(event.target.value)}>{selectedSubscription.licenses.map((license) => <option key={license.id} value={license.id}>{license.productName}</option>)}</select></label>
            <label><span>Ключ</span><input value={entitlementKey} onChange={(event) => setEntitlementKey(event.target.value)} placeholder="crm.max_users" /></label>
            <label className="span-2"><span>JSON-значение</span><input value={entitlementValue} onChange={(event) => setEntitlementValue(event.target.value)} placeholder="true, 25, &quot;value&quot; или {...}" /></label>
            <label className="span-2"><span>Причина изменения</span><input value={entitlementReason} onChange={(event) => setEntitlementReason(event.target.value)} placeholder="Индивидуальное условие договора" /></label>
          </div>{validation && <div className="form-message">{validation}</div>}<button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />} Сохранить entitlement</button></form>}
        </div>}
      </dialog>
    </>
  );
}
