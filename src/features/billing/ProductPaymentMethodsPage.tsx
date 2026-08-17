import { BadgeDollarSign, Building2, CheckCircle2, CreditCard, LoaderCircle, RefreshCw, Save, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../core/auth';
import {
  paymentMethodCatalog,
  productPaymentMethodsRepository,
  type PaymentMethodOption,
  type ProductPaymentSettings,
} from './productPaymentMethodsRepository';

function methodHint(method: PaymentMethodOption['method']) {
  return paymentMethodCatalog.find((item) => item.method === method)?.hint ?? '';
}

export function ProductPaymentMethodsPage() {
  const { can, isDemo } = useAuth();
  const [items, setItems] = useState<ProductPaymentSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedProductId, setSavedProductId] = useState<string | null>(null);
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

  const updateMethod = (productId: string, method: PaymentMethodOption['method'], patch: Partial<PaymentMethodOption>) => {
    setSavedProductId(null);
    setItems((current) => current.map((product) => {
      if (product.productId !== productId) return product;
      let methods = product.methods.map((item) => item.method === method ? { ...item, ...patch } : item);
      if (patch.isDefault === true) {
        methods = methods.map((item) => ({ ...item, isDefault: item.method === method }));
      }
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
    const enabled = product.methods.filter((method) => method.enabled);
    if (enabled.length === 0) {
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

  return <>
    <div className="page-heading">
      <div>
        <span className="eyebrow">Product Billing</span>
        <h1>Способы оплаты по продуктам</h1>
        <p>Для каждого продукта IMDS задаются собственные способы оплаты. Эти варианты передаются клиенту вместе с подпиской и доступами.</p>
      </div>
      <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || Boolean(savingProductId)}>
        <RefreshCw className={loading ? 'spin' : ''} size={16}/> Обновить
      </button>
    </div>

    {isDemo && <div className="mode-banner"><Building2 size={18}/><div><strong>Демо-режим</strong><span>Настройки сохраняются в браузере. В production они хранятся централизованно в Super Admin.</span></div></div>}
    {!canManage && <div className="mode-banner"><CreditCard size={18}/><div><strong>Только просмотр</strong><span>Изменять способы оплаты может роль с правом управления подписками.</span></div></div>}
    {error && <div className="error-banner"><BadgeDollarSign size={18}/><span>{error}</span></div>}

    <section className="metrics billing-metrics">
      <article className="metric-card"><div className="metric-icon"><WalletCards size={21}/></div><div><span>Продукты</span><strong>{items.length}</strong><small>с отдельными правилами оплаты</small></div></article>
      <article className="metric-card"><div className="metric-icon"><CreditCard size={21}/></div><div><span>Активные способы</span><strong>{enabledCount}</strong><small>по всем продуктам</small></div></article>
      <article className="metric-card"><div className="metric-icon"><CheckCircle2 size={21}/></div><div><span>Trial по умолчанию</span><strong>3 дня</strong><small>для новых организаций</small></div></article>
    </section>

    {loading ? <div className="inline-loading"><LoaderCircle className="spin" size={27}/><span>Загрузка способов оплаты...</span></div> : (
      <div className="tariff-grid">
        {items.map((product) => <article className="tariff-card" key={product.productId}>
          <div className="tariff-card-header">
            <div><span className="eyebrow">{product.productKey}</span><h2>{product.productName}</h2></div>
            <span className="status ok">{product.methods.filter((method) => method.enabled).length} способов</span>
          </div>
          <p>Выберите доступные способы. Один из включённых вариантов должен быть основным.</p>

          <div className="form-section" style={{ marginTop: 12 }}>
            {product.methods.map((method) => <div key={method.method} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) auto', gap: 12, alignItems: 'start', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <label className="checkbox-field" style={{ margin: 0 }}>
                  <input type="checkbox" checked={method.enabled} disabled={!canManage || savingProductId === product.productId} onChange={(event) => updateMethod(product.productId, method.method, { enabled: event.target.checked })}/>
                  <span><strong>{method.displayName}</strong><small style={{ display: 'block', marginTop: 3 }}>{methodHint(method.method)}</small></span>
                </label>
                {method.enabled && <label style={{ display: 'block', marginTop: 8 }}><span>Инструкция клиенту</span><input value={method.instructions} disabled={!canManage || savingProductId === product.productId} placeholder="Например: оплатить по выставленному счёту" onChange={(event) => updateMethod(product.productId, method.method, { instructions: event.target.value })}/></label>}
              </div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                <input type="radio" name={`default-${product.productId}`} checked={method.enabled && method.isDefault} disabled={!canManage || !method.enabled || savingProductId === product.productId} onChange={() => updateMethod(product.productId, method.method, { isDefault: true })}/>
                <span>Основной</span>
              </label>
            </div>)}
          </div>

          {canManage && <button className="primary-button" type="button" disabled={savingProductId === product.productId} onClick={() => void save(product)}>
            {savingProductId === product.productId ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}
            {savingProductId === product.productId ? 'Сохраняем...' : savedProductId === product.productId ? 'Сохранено' : 'Сохранить'}
          </button>}
        </article>)}
      </div>
    )}
  </>;
}
