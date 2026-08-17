import { BadgeDollarSign, Building2, CheckCircle2, CreditCard, LoaderCircle, RefreshCw, Save, WalletCards } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../core/auth';
import { useBilling } from './BillingContext';
import {
  paymentMethodCatalog,
  productPaymentMethodsRepository,
  type PaymentMethodOption,
  type ProductPaymentMethod,
  type ProductPaymentSettings,
} from './productPaymentMethodsRepository';

function methodHint(method: PaymentMethodOption['method']) {
  return paymentMethodCatalog.find((item) => item.method === method)?.hint ?? '';
}

export function ProductPaymentMethodsPage() {
  const { can, isDemo } = useAuth();
  const { subscriptions, refresh: refreshBilling } = useBilling();
  const [items, setItems] = useState<ProductPaymentSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedProductId, setSavedProductId] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [renewalSuccess, setRenewalSuccess] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState('');
  const [productId, setProductId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ProductPaymentMethod>('bank_transfer');
  const [amount, setAmount] = useState(0);
  const [periodMonths, setPeriodMonths] = useState(1);
  const [externalReference, setExternalReference] = useState('');
  const canManage = can('subscriptions.manage');

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await productPaymentMethodsRepository.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить способы оплаты.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const enabledCount = useMemo(
    () => items.reduce((sum, item) => sum + item.methods.filter((method) => method.enabled).length, 0),
    [items],
  );
  const selectedSubscription = subscriptions.find((subscription) => subscription.id === subscriptionId) ?? null;
  const availableLicenses = selectedSubscription?.licenses ?? [];
  const selectedProductSettings = items.find((item) => item.productId === productId) ?? null;
  const enabledMethods = selectedProductSettings?.methods.filter((method) => method.enabled) ?? [];

  useEffect(() => {
    if (!subscriptionId && subscriptions.length > 0) setSubscriptionId(subscriptions[0].id);
  }, [subscriptionId, subscriptions]);

  useEffect(() => {
    if (!selectedSubscription) return;
    if (!availableLicenses.some((license) => license.productId === productId)) {
      setProductId(availableLicenses[0]?.productId ?? '');
    }
  }, [availableLicenses, productId, selectedSubscription]);

  useEffect(() => {
    const preferred = enabledMethods.find((method) => method.isDefault) ?? enabledMethods[0];
    if (preferred && !enabledMethods.some((method) => method.method === paymentMethod)) setPaymentMethod(preferred.method);
  }, [enabledMethods, paymentMethod]);

  const updateMethod = (targetProductId: string, method: PaymentMethodOption['method'], patch: Partial<PaymentMethodOption>) => {
    setSavedProductId(null);
    setItems((current) => current.map((product) => {
      if (product.productId !== targetProductId) return product;
      let methods = product.methods.map((item) => item.method === method ? { ...item, ...patch } : item);
      if (patch.isDefault === true) methods = methods.map((item) => ({ ...item, isDefault: item.method === method }));
      if (patch.enabled === false) {
        const disabled = methods.find((item) => item.method === method);
        if (disabled?.isDefault) {
          const firstEnabled = methods.find((item) => item.enabled && item.method !== method);
          methods = methods.map((item) => ({ ...item, isDefault: Boolean(firstEnabled && item.method === firstEnabled.method) }));
        }
      }
      if (patch.enabled === true && !methods.some((item) => item.enabled && item.isDefault)) {
        methods = methods.map((item) => ({ ...item, isDefault: item.method === method }));
      }
      return { ...product, methods };
    }));
  };

  const save = async (product: ProductPaymentSettings) => {
    if (product.methods.filter((method) => method.enabled).length === 0) {
      setError(`Для ${product.productName} нужно оставить минимум один способ оплаты.`);
      return;
    }
    setSavingProductId(product.productId);
    setSavedProductId(null);
    setError(null);
    try {
      setItems(await productPaymentMethodsRepository.save(product.productId, product.methods));
      setSavedProductId(product.productId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить способы оплаты.');
    } finally {
      setSavingProductId(null);
    }
  };

  const renew = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSubscription || !productId || !paymentMethod) {
      setError('Выберите подписку, продукт и способ оплаты.');
      return;
    }
    if (amount <= 0) {
      setError('Укажите сумму оплаты.');
      return;
    }
    setRenewing(true);
    setError(null);
    setRenewalSuccess(null);
    try {
      await productPaymentMethodsRepository.renew({
        organizationId: selectedSubscription.organizationId,
        subscriptionId: selectedSubscription.id,
        productId,
        amount,
        currency: selectedSubscription.currency || 'KZT',
        method: paymentMethod,
        periodMonths,
        externalReference,
        payerName: selectedSubscription.organizationName,
      });
      await refreshBilling();
      setExternalReference('');
      setRenewalSuccess(`${selectedProductSettings?.productName ?? 'Продукт'} продлён на ${periodMonths} мес.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось подтвердить оплату и продлить продукт.');
    } finally {
      setRenewing(false);
    }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">Product Billing</span><h1>Оплата и продление продуктов</h1><p>У каждого продукта IMDS собственные способы оплаты. Оплата продлевает только выбранную продуктовую лицензию.</p></div><button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || Boolean(savingProductId)}><RefreshCw className={loading ? 'spin' : ''} size={16}/> Обновить</button></div>
    {isDemo && <div className="mode-banner"><Building2 size={18}/><div><strong>Демо-режим</strong><span>Настройки сохраняются в браузере. Production использует централизованный billing Super Admin.</span></div></div>}
    {!canManage && <div className="mode-banner"><CreditCard size={18}/><div><strong>Только просмотр</strong><span>Изменять оплату может роль с правом управления подписками.</span></div></div>}
    {error && <div className="error-banner"><BadgeDollarSign size={18}/><span>{error}</span></div>}
    {renewalSuccess && <div className="mode-banner"><CheckCircle2 size={18}/><div><strong>Оплата подтверждена</strong><span>{renewalSuccess}</span></div></div>}

    <section className="metrics billing-metrics"><article className="metric-card"><div className="metric-icon"><WalletCards size={21}/></div><div><span>Продукты</span><strong>{items.length}</strong><small>с отдельными правилами оплаты</small></div></article><article className="metric-card"><div className="metric-icon"><CreditCard size={21}/></div><div><span>Активные способы</span><strong>{enabledCount}</strong><small>по всем продуктам</small></div></article><article className="metric-card"><div className="metric-icon"><CheckCircle2 size={21}/></div><div><span>Trial по умолчанию</span><strong>3 дня</strong><small>для новых организаций</small></div></article></section>

    {canManage && <section className="panel billing-panel" style={{ marginBottom: 20 }}><div className="panel-header"><div><h2>Подтвердить оплату и продлить</h2><p>Период добавляется к текущему сроку конкретного продукта.</p></div></div><form onSubmit={renew} className="form-grid" style={{ padding: 18 }}>
      <label className="span-2"><span>Компания / подписка</span><select value={subscriptionId} onChange={(event) => setSubscriptionId(event.target.value)}>{subscriptions.map((subscription) => <option key={subscription.id} value={subscription.id}>{subscription.organizationName} · {subscription.tariffName} · {subscription.status}</option>)}</select></label>
      <label><span>Продукт</span><select value={productId} onChange={(event) => setProductId(event.target.value)}>{availableLicenses.map((license) => <option key={license.id} value={license.productId}>{license.productName}</option>)}</select></label>
      <label><span>Способ оплаты</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as ProductPaymentMethod)}>{enabledMethods.map((method) => <option key={method.method} value={method.method}>{method.displayName}{method.isDefault ? ' · основной' : ''}</option>)}</select></label>
      <label><span>Сумма</span><input type="number" min="1" step="1" value={amount || ''} onChange={(event) => setAmount(Number(event.target.value))} placeholder="150000"/></label>
      <label><span>Период</span><select value={periodMonths} onChange={(event) => setPeriodMonths(Number(event.target.value))}><option value={1}>1 месяц</option><option value={3}>3 месяца</option><option value={6}>6 месяцев</option><option value={12}>12 месяцев</option></select></label>
      <label className="span-2"><span>Номер платежа / комментарий</span><input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} placeholder="Kaspi ID, номер платёжного поручения или комментарий"/></label>
      <div className="span-2"><button className="primary-button" type="submit" disabled={renewing || !selectedSubscription || !productId || enabledMethods.length === 0}>{renewing ? <LoaderCircle className="spin" size={16}/> : <CreditCard size={16}/>} {renewing ? 'Подтверждаем...' : 'Подтвердить оплату и продлить'}</button></div>
    </form></section>}

    {loading ? <div className="inline-loading"><LoaderCircle className="spin" size={27}/><span>Загрузка способов оплаты...</span></div> : <div className="tariff-grid">{items.map((product) => <article className="tariff-card" key={product.productId}>
      <div className="tariff-card-header"><div><span className="eyebrow">{product.productKey}</span><h2>{product.productName}</h2></div><span className="status ok">{product.methods.filter((method) => method.enabled).length} способов</span></div><p>Выберите доступные способы. Один из включённых вариантов должен быть основным.</p>
      <div className="form-section" style={{ marginTop: 12 }}>{product.methods.map((method) => <div key={method.method} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) auto', gap: 12, alignItems: 'start', padding: '12px 0', borderBottom: '1px solid var(--border)' }}><div><label className="checkbox-field" style={{ margin: 0 }}><input type="checkbox" checked={method.enabled} disabled={!canManage || savingProductId === product.productId} onChange={(event) => updateMethod(product.productId, method.method, { enabled: event.target.checked })}/><span><strong>{method.displayName}</strong><small style={{ display: 'block', marginTop: 3 }}>{methodHint(method.method)}</small></span></label>{method.enabled && <label style={{ display: 'block', marginTop: 8 }}><span>Инструкция клиенту</span><input value={method.instructions} disabled={!canManage || savingProductId === product.productId} placeholder="Например: оплатить по выставленному счёту" onChange={(event) => updateMethod(product.productId, method.method, { instructions: event.target.value })}/></label>}</div><label style={{ display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="radio" name={`default-${product.productId}`} checked={method.enabled && method.isDefault} disabled={!canManage || !method.enabled || savingProductId === product.productId} onChange={() => updateMethod(product.productId, method.method, { isDefault: true })}/><span>Основной</span></label></div>)}</div>
      {canManage && <button className="primary-button" type="button" disabled={savingProductId === product.productId} onClick={() => void save(product)}>{savingProductId === product.productId ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}{savingProductId === product.productId ? 'Сохраняем...' : savedProductId === product.productId ? 'Сохранено' : 'Сохранить'}</button>}
    </article>)}</div>}
  </>;
}
