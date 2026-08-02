import {
  Activity,
  BarChart3,
  Boxes,
  CircleAlert,
  Clock3,
  Copy,
  Database,
  KeyRound,
  LoaderCircle,
  MousePointerClick,
  Plus,
  RefreshCw,
  ShieldCheck,
  Timer,
  Users,
  Wifi,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../core/auth';
import { useProductAnalytics } from './ProductAnalyticsContext';
import type { AnalyticsSource, CreatedTelemetryCredential, TelemetrySourceInput } from './productAnalyticsRepository';

type AnalyticsTab = 'overview' | 'live' | 'features' | 'tenants' | 'sources';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин`;
  return `${seconds} сек`;
}

function statusClass(value: string): string {
  if (['active', 'low'].includes(value)) return 'ok';
  if (['idle', 'draft', 'medium'].includes(value)) return 'warn';
  if (['compromised', 'high'].includes(value)) return 'danger';
  return 'muted';
}

function riskLabel(value: string): string {
  if (value === 'high') return 'Высокий риск';
  if (value === 'medium') return 'Средний риск';
  return 'Низкий риск';
}

function sourceStatusLabel(value: AnalyticsSource['status']): string {
  const labels: Record<AnalyticsSource['status'], string> = {
    active: 'Активен',
    draft: 'Черновик',
    disabled: 'Отключён',
    compromised: 'Скомпрометирован',
  };
  return labels[value];
}

function sourceKeyFor(productKey: string, sourceType: 'browser' | 'server', environment: string): string {
  return `${productKey}-${sourceType === 'browser' ? 'web' : 'server'}-${environment}`.replace(/[^a-z0-9._-]+/g, '-');
}

export function ProductAnalyticsPage() {
  const { can, isDemo } = useAuth();
  const {
    generatedAt,
    metrics,
    products,
    liveSessions,
    features,
    tenants,
    sources,
    series,
    catalog,
    periodDays,
    selectedProductId,
    loading,
    saving,
    error,
    setPeriodDays,
    setSelectedProductId,
    refresh,
    createSource,
  } = useProductAnalytics();
  const [tab, setTab] = useState<AnalyticsTab>('overview');
  const [validation, setValidation] = useState('');
  const [createdCredential, setCreatedCredential] = useState<CreatedTelemetryCredential | null>(null);
  const sourceDialog = useRef<HTMLDialogElement | null>(null);
  const canManage = can('analytics.manage');
  const firstProduct = catalog[0];
  const [sourceForm, setSourceForm] = useState<TelemetrySourceInput>({
    productId: '',
    productKey: '',
    productName: '',
    sourceKey: '',
    name: '',
    sourceType: 'browser',
    environment: 'production',
    allowedOrigins: [],
    sampleRate: 1,
    retentionDays: 90,
  });
  const [originText, setOriginText] = useState('');

  const maximumSeriesEvents = useMemo(
    () => Math.max(...series.map((item) => item.events), 1),
    [series],
  );

  const averageSessionSeconds = metrics.sessions > 0 ? metrics.activeSeconds / metrics.sessions : 0;
  const selectedProductName = selectedProductId
    ? catalog.find((item) => item.id === selectedProductId)?.name ?? 'Выбранный продукт'
    : 'Все продукты';

  const openSourceDialog = () => {
    const product = firstProduct;
    const productKey = product?.key ?? '';
    const environment = 'production' as const;
    const sourceType = 'browser' as const;
    setCreatedCredential(null);
    setValidation('');
    setOriginText('');
    setSourceForm({
      productId: product?.id ?? '',
      productKey,
      productName: product?.name ?? '',
      sourceKey: sourceKeyFor(productKey, sourceType, environment),
      name: product ? `${product.name} Web Production` : '',
      sourceType,
      environment,
      allowedOrigins: [],
      sampleRate: 1,
      retentionDays: 90,
    });
    sourceDialog.current?.showModal();
  };

  const selectSourceProduct = (productId: string) => {
    const product = catalog.find((item) => item.id === productId);
    if (!product) return;
    setSourceForm((current) => ({
      ...current,
      productId: product.id,
      productKey: product.key,
      productName: product.name,
      sourceKey: sourceKeyFor(product.key, current.sourceType, current.environment),
      name: `${product.name} ${current.sourceType === 'browser' ? 'Web' : 'Server'} ${current.environment === 'production' ? 'Production' : current.environment}`,
    }));
  };

  const changeSourceType = (sourceType: 'browser' | 'server') => {
    setSourceForm((current) => ({
      ...current,
      sourceType,
      sourceKey: sourceKeyFor(current.productKey, sourceType, current.environment),
      name: `${current.productName} ${sourceType === 'browser' ? 'Web' : 'Server'} ${current.environment === 'production' ? 'Production' : current.environment}`,
    }));
  };

  const changeEnvironment = (environment: TelemetrySourceInput['environment']) => {
    setSourceForm((current) => ({
      ...current,
      environment,
      sourceKey: sourceKeyFor(current.productKey, current.sourceType, environment),
      name: `${current.productName} ${current.sourceType === 'browser' ? 'Web' : 'Server'} ${environment === 'production' ? 'Production' : environment}`,
    }));
  };

  const submitSource = async (event: FormEvent) => {
    event.preventDefault();
    const allowedOrigins = originText
      .split(/[\n,]/)
      .map((item) => item.trim().replace(/\/$/, ''))
      .filter(Boolean);
    if (!sourceForm.productId) return setValidation('Выберите продукт.');
    if (!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(sourceForm.sourceKey)) return setValidation('Ключ источника содержит недопустимые символы.');
    if (!sourceForm.name.trim()) return setValidation('Укажите название источника.');
    if (sourceForm.sourceType === 'browser' && allowedOrigins.length === 0) return setValidation('Для браузерного источника укажите разрешённый origin.');
    if (sourceForm.sourceType === 'browser' && sourceForm.environment === 'production' && allowedOrigins.some((origin) => !origin.startsWith('https://'))) {
      return setValidation('Production origins должны использовать HTTPS.');
    }
    setValidation('');
    const credential = await createSource({ ...sourceForm, allowedOrigins });
    if (credential) setCreatedCredential(credential);
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Product Intelligence</span>
          <h1>Аналитика продуктов IMDS</h1>
          <p>Пользователи онлайн, активное время, использование функций, компании и качество клиентских сессий.</p>
        </div>
        <div className="heading-actions analytics-heading-actions">
          <label className="analytics-filter">
            <span>Продукт</span>
            <select value={selectedProductId ?? ''} onChange={(event) => setSelectedProductId(event.target.value || null)}>
              <option value="">Все продукты</option>
              {catalog.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label className="analytics-filter">
            <span>Период</span>
            <select value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))}>
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
            </select>
          </label>
          <button className="secondary-button compact" type="button" onClick={() => void refresh()} disabled={loading || saving}>
            <RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить
          </button>
          {canManage && <button className="primary-button" type="button" onClick={openSourceDialog}><Plus size={17} /> Подключить продукт</button>}
        </div>
      </div>

      {isDemo && <div className="mode-banner"><ShieldCheck size={18} /><div><strong>Демо-режим продуктовой аналитики</strong><span>Показываются модельные данные. Production-режим использует защищённый ingest gateway и RLS Supabase.</span></div></div>}
      {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span></div>}

      <section className="metrics analytics-metrics">
        <article className="metric-card"><div className="metric-icon"><Wifi size={21} /></div><div><span>Онлайн сейчас</span><strong>{formatNumber(metrics.onlineNow)}</strong><small>{formatNumber(metrics.activeNow)} активно работают</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Users size={21} /></div><div><span>DAU</span><strong>{formatNumber(metrics.dau)}</strong><small>{formatNumber(metrics.uniqueUsers)} за {periodDays} дней</small></div></article>
        <article className="metric-card"><div className="metric-icon"><Timer size={21} /></div><div><span>Средняя активная сессия</span><strong>{formatDuration(averageSessionSeconds)}</strong><small>{formatNumber(metrics.sessions)} сессий</small></div></article>
        <article className="metric-card"><div className="metric-icon"><ShieldCheck size={21} /></div><div><span>Сессии без ошибок</span><strong>{formatPercent(metrics.errorFreePercent)}</strong><small>{formatNumber(metrics.errors)} ошибок</small></div></article>
      </section>

      <div className="section-tabs analytics-tabs">
        <button className={tab === 'overview' ? 'active' : ''} type="button" onClick={() => setTab('overview')}><BarChart3 size={16} /> Обзор</button>
        <button className={tab === 'live' ? 'active' : ''} type="button" onClick={() => setTab('live')}><Wifi size={16} /> Сейчас онлайн <span>{liveSessions.length}</span></button>
        <button className={tab === 'features' ? 'active' : ''} type="button" onClick={() => setTab('features')}><MousePointerClick size={16} /> Функции <span>{features.length}</span></button>
        <button className={tab === 'tenants' ? 'active' : ''} type="button" onClick={() => setTab('tenants')}><Boxes size={16} /> Компании <span>{tenants.length}</span></button>
        <button className={tab === 'sources' ? 'active' : ''} type="button" onClick={() => setTab('sources')}><Database size={16} /> Источники <span>{sources.length}</span></button>
      </div>

      {tab === 'overview' && <>
        <section className="analytics-overview-grid">
          <article className="panel analytics-chart-panel">
            <div className="panel-header"><div><h2>Активность</h2><p>{selectedProductName} · последние {periodDays} дней</p></div><span className="analytics-updated">Обновлено {formatDate(generatedAt)}</span></div>
            <div className="analytics-series" aria-label="События по дням">
              {series.map((point) => <div className="analytics-series-column" key={point.date} title={`${point.date}: ${formatNumber(point.events)} событий`}>
                <div className="analytics-series-bar" style={{ height: `${Math.max(4, point.events / maximumSeriesEvents * 100)}%` }}><span /></div>
                <small>{new Date(`${point.date}T00:00:00`).getDate()}</small>
              </div>)}
            </div>
            <div className="analytics-chart-legend"><span><i /> {formatNumber(metrics.events)} событий</span><span>{formatDuration(metrics.activeSeconds)} активного времени</span></div>
          </article>

          <article className="panel analytics-quality-panel">
            <div className="panel-header"><div><h2>Качество данных</h2><p>Готовность к управленческим решениям</p></div></div>
            <div className="analytics-quality-list">
              <div><span>Продукты с источником</span><strong>{new Set(sources.map((item) => item.productId)).size}/{catalog.length}</strong></div>
              <div><span>Активные источники</span><strong>{sources.filter((item) => item.status === 'active').length}/{sources.length}</strong></div>
              <div><span>Источники с ошибкой</span><strong>{sources.filter((item) => item.lastError).length}</strong></div>
              <div><span>Последнее событие</span><strong>{formatDate(products.map((item) => item.lastEventAt).filter(Boolean).sort().at(-1) ?? null)}</strong></div>
            </div>
          </article>
        </section>

        <section className="analytics-product-grid">
          {products.map((product) => {
            const errorRate = product.eventCount > 0 ? product.errorCount / product.eventCount * 100 : 0;
            return <article className="analytics-product-card" key={product.id}>
              <div className="analytics-product-top"><div className="analytics-product-icon"><Activity size={19} /></div><span className={`status ${errorRate >= 5 ? 'danger' : errorRate >= 1 ? 'warn' : 'ok'}`}>{errorRate.toFixed(2)}% ошибок</span></div>
              <h2>{product.name}</h2>
              <p>{formatNumber(product.onlineNow)} онлайн · {formatNumber(product.activeNow)} активны</p>
              <div className="analytics-product-stats"><div><span>DAU</span><strong>{formatNumber(product.dau)}</strong></div><div><span>Сессии</span><strong>{formatNumber(product.sessions)}</strong></div><div><span>Активное время</span><strong>{formatDuration(product.activeSeconds)}</strong></div></div>
              <div className="analytics-product-footer"><span>{formatNumber(product.eventCount)} событий</span><span>{formatDate(product.lastEventAt)}</span></div>
            </article>;
          })}
          {!loading && products.length === 0 && <div className="inline-empty"><BarChart3 size={30} /><h2>Данные ещё не поступали</h2><p>Создайте источник и подключите SDK выбранного продукта.</p></div>}
        </section>
      </>}

      {tab === 'live' && <section className="panel">
        <div className="panel-header"><div><h2>Пользователи онлайн</h2><p>Heartbeat не старше 90 секунд; active — действие не старше 60 секунд.</p></div><span className="analytics-updated">Автообновление каждые 30 секунд</span></div>
        <div className="table-wrap"><table><thead><tr><th>Пользователь</th><th>Компания</th><th>Продукт / модуль</th><th>Статус</th><th>Активное время</th><th>Последнее действие</th></tr></thead><tbody>{liveSessions.map((session) => <tr key={session.id}><td><strong>{session.userLabel}</strong><span>{session.userRole || session.userKey || 'роль не указана'}</span></td><td><strong>{session.organizationName}</strong><span>{session.branchName}</span></td><td><strong>{session.productName}</strong><span>{session.moduleName || session.moduleKey || session.route || 'Обзор продукта'}{session.moduleOwnerProductName ? ` · владелец ${session.moduleOwnerProductName}` : ''}</span></td><td><span className={`status ${statusClass(session.status)}`}>{session.status === 'active' ? 'Активен' : 'Неактивен'}</span></td><td><strong>{formatDuration(session.activeSeconds)}</strong><span>idle {formatDuration(session.idleSeconds)}</span></td><td><strong>{formatDate(session.lastSeenAt)}</strong><span>{session.appVersion ? `v${session.appVersion}` : session.deviceType || '—'}</span></td></tr>)}</tbody></table></div>
        {!loading && liveSessions.length === 0 && <div className="inline-empty"><Wifi size={30} /><h2>Сейчас никого нет онлайн</h2><p>Live-сессии появятся после первого heartbeat.</p></div>}
      </section>}

      {tab === 'features' && <section className="panel">
        <div className="panel-header"><div><h2>Использование модулей и функций</h2><p>Host-продукт и владелец модуля считаются раздельно.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Функция</th><th>Продукт</th><th>Модуль</th><th>Пользователи</th><th>События</th><th>Успешность</th><th>Последнее использование</th></tr></thead><tbody>{features.map((feature) => <tr key={`${feature.productId}-${feature.moduleKey}-${feature.featureKey}`}><td><strong>{feature.featureKey}</strong></td><td><strong>{feature.productName}</strong><span>{feature.moduleOwnerProductName ? `Владелец: ${feature.moduleOwnerProductName}` : 'Нативная функция'}</span></td><td><strong>{feature.moduleName}</strong><span>{feature.moduleKey}</span></td><td>{formatNumber(feature.uniqueUsers)}</td><td>{formatNumber(feature.eventCount)}</td><td><span className={`status ${feature.successRate < 95 ? 'danger' : feature.successRate < 99 ? 'warn' : 'ok'}`}>{formatPercent(feature.successRate)}</span><span>{formatNumber(feature.failureCount)} ошибок</span></td><td>{formatDate(feature.lastUsedAt)}</td></tr>)}</tbody></table></div>
      </section>}

      {tab === 'tenants' && <section className="panel">
        <div className="panel-header"><div><h2>Активность компаний</h2><p>Использование, ошибки, последнее действие и ранний риск оттока.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Компания</th><th>Пользователи</th><th>Сессии</th><th>Активное время</th><th>События / ошибки</th><th>Последняя активность</th><th>Риск</th></tr></thead><tbody>{tenants.map((tenant) => <tr key={tenant.organizationId ?? tenant.organizationName}><td><strong>{tenant.organizationName}</strong></td><td>{formatNumber(tenant.uniqueUsers)}</td><td>{formatNumber(tenant.sessions)}</td><td>{formatDuration(tenant.activeSeconds)}</td><td><strong>{formatNumber(tenant.eventCount)}</strong><span>{formatNumber(tenant.errorCount)} ошибок</span></td><td>{formatDate(tenant.lastSeenAt)}</td><td><span className={`status ${statusClass(tenant.risk)}`}>{riskLabel(tenant.risk)}</span></td></tr>)}</tbody></table></div>
      </section>}

      {tab === 'sources' && <section className="analytics-source-grid">
        {sources.map((source) => <article className="panel analytics-source-card" key={source.id}>
          <div className="analytics-product-top"><div className="analytics-product-icon"><Database size={19} /></div><span className={`status ${statusClass(source.status)}`}>{sourceStatusLabel(source.status)}</span></div>
          <span className="eyebrow">{source.productName} · {source.environment}</span>
          <h2>{source.name}</h2>
          <code>{source.sourceKey}</code>
          <div className="analytics-source-facts"><span>Тип: {source.sourceType}</span><span>Sampling: {formatPercent(source.sampleRate * 100)}</span><span>Retention: {source.retentionDays} дней</span><span>Heartbeat: {source.heartbeatIntervalSeconds} сек</span></div>
          <div className="analytics-origin-list">{source.allowedOrigins.length ? source.allowedOrigins.map((origin) => <span key={origin}>{origin}</span>) : <span>Server-side source</span>}</div>
          {source.lastError && <div className="connection-error"><CircleAlert size={15} /> {source.lastError}</div>}
          <div className="analytics-product-footer"><span>Последнее событие</span><strong>{formatDate(source.lastEventAt)}</strong></div>
        </article>)}
        {!loading && sources.length === 0 && <div className="inline-empty"><Database size={30} /><h2>Источники не созданы</h2><p>Подключите первый продукт, затем установите браузерный или серверный SDK.</p></div>}
      </section>}

      <dialog ref={sourceDialog} className="modal wide-modal" onCancel={() => sourceDialog.current?.close()}>
        {!createdCredential ? <form onSubmit={submitSource}>
          <div className="modal-header"><div><span className="eyebrow">Telemetry Provisioning</span><h2>Подключить продукт</h2><p>Будет создан источник и одноразовый write key.</p></div><button type="button" className="icon-button" onClick={() => sourceDialog.current?.close()}>×</button></div>
          <div className="form-grid">
            <label><span>Продукт *</span><select value={sourceForm.productId} onChange={(event) => selectSourceProduct(event.target.value)}><option value="">Выберите продукт</option>{catalog.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
            <label><span>Тип источника</span><select value={sourceForm.sourceType} onChange={(event) => changeSourceType(event.target.value as 'browser' | 'server')}><option value="browser">Browser SDK</option><option value="server">Server SDK</option></select></label>
            <label><span>Среда</span><select value={sourceForm.environment} onChange={(event) => changeEnvironment(event.target.value as TelemetrySourceInput['environment'])}><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option><option value="demo">Demo</option></select></label>
            <label><span>Retention</span><select value={sourceForm.retentionDays} onChange={(event) => setSourceForm({ ...sourceForm, retentionDays: Number(event.target.value) })}><option value={30}>30 дней</option><option value={90}>90 дней</option><option value={180}>180 дней</option><option value={365}>365 дней</option></select></label>
            <label className="span-2"><span>Название *</span><input value={sourceForm.name} onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })} /></label>
            <label className="span-2"><span>Source key *</span><input value={sourceForm.sourceKey} onChange={(event) => setSourceForm({ ...sourceForm, sourceKey: event.target.value.toLowerCase() })} /></label>
            {sourceForm.sourceType === 'browser' && <label className="span-2"><span>Разрешённые origins *</span><textarea rows={4} placeholder={'https://marketing.imdstech.net\nhttps://staging-marketing.imdstech.net'} value={originText} onChange={(event) => setOriginText(event.target.value)} /></label>}
            <label><span>Sampling</span><select value={sourceForm.sampleRate} onChange={(event) => setSourceForm({ ...sourceForm, sampleRate: Number(event.target.value) })}><option value={1}>100%</option><option value={0.5}>50%</option><option value={0.25}>25%</option><option value={0.1}>10%</option></select></label>
          </div>
          <div className="privacy-notice"><ShieldCheck size={18} /><div><strong>Запрещённые данные</strong><span>Не отправляйте медицинские данные, формы, телефоны, email, токены, сообщения, поисковые запросы и содержимое API payload.</span></div></div>
          {validation && <div className="validation-error"><CircleAlert size={16} /> {validation}</div>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => sourceDialog.current?.close()}>Отмена</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />} Создать источник</button></div>
        </form> : <div className="analytics-credential">
          <div className="modal-header"><div><span className="eyebrow">One-time credential</span><h2>Write key создан</h2><p>После закрытия он больше не будет показан.</p></div><button type="button" className="icon-button" onClick={() => sourceDialog.current?.close()}>×</button></div>
          <div className="analytics-secret-block"><span>Source key</span><code>{createdCredential.sourceKey}</code><button type="button" className="secondary-button compact" onClick={() => void navigator.clipboard.writeText(createdCredential.sourceKey)}><Copy size={15} /> Копировать</button></div>
          <div className="analytics-secret-block"><span>Write key</span><code>{createdCredential.writeKey}</code><button type="button" className="secondary-button compact" onClick={() => void navigator.clipboard.writeText(createdCredential.writeKey)}><Copy size={15} /> Копировать</button></div>
          <div className="privacy-notice"><KeyRound size={18} /><div><strong>{createdCredential.sourceType === 'server' ? 'Храните как backend secret' : 'Browser ingestion credential'}</strong><span>{createdCredential.sourceType === 'server' ? 'Не добавляйте ключ в VITE_* или клиентский bundle.' : 'Безопасность дополнительно обеспечивают origin allow-list, rate limit и строгая схема событий.'}</span></div></div>
          <div className="modal-actions"><button type="button" className="primary-button" onClick={() => sourceDialog.current?.close()}>Готово</button></div>
        </div>}
      </dialog>
    </>
  );
}
