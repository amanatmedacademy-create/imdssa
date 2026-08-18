import { Activity, Boxes, Building2, Layers3, Radio, Workflow } from 'lucide-react';
import { ProductCommercialCenterV2 } from '../../../features/products/ProductCommercialCenterV2';
import type { Installation, OrganizationProduct, Product, User } from '../../controlCenter';
import { EmptyState, Status } from '../../controlCenter';
import './productsPage.css';

type Props = {
  user: User;
  products: Product[];
  organizationProducts: OrganizationProduct[];
  installations: Installation[];
  canManage: boolean;
};

const heartbeat = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Сигнал не получен';

export function ProductsPage({ user, products, organizationProducts, installations, canManage }: Props) {
  const healthy = products.filter((item) => item.last_health === 'healthy').length;
  const degraded = products.filter((item) => item.last_health === 'degraded').length;
  const unavailable = products.filter((item) => ['offline', 'unavailable'].includes(item.last_health)).length;
  const syncIssues = organizationProducts.filter((item) => item.sync_status && item.sync_status !== 'synced').length;

  if (!products.length) return <EmptyState title="Продукты не зарегистрированы" text="После подключения продукта он появится в реестре Control Center." />;

  return <section className="products-page">
    <div className="products-kpis">
      <article><Boxes size={18} /><span>Продукты</span><strong>{products.length}</strong><small>в реестре IMDS</small></article>
      <article className="good"><Activity size={18} /><span>Работают</span><strong>{healthy}</strong><small>healthy</small></article>
      <article className={degraded ? 'warn' : ''}><Radio size={18} /><span>Деградация</span><strong>{degraded}</strong><small>требуют наблюдения</small></article>
      <article className={unavailable || syncIssues ? 'danger' : ''}><Workflow size={18} /><span>Проблемы</span><strong>{unavailable + syncIssues}</strong><small>{unavailable} offline · {syncIssues} sync</small></article>
    </div>

    <div className="products-registry">
      <div className="products-registry-head"><div><span>PRODUCT REGISTRY</span><h2>Техническое состояние продуктов</h2><p>Heartbeat, версия, latency, организации и состояние синхронизации каждого продуктового контура.</p></div></div>
      <div className="products-grid">{products.map((product) => {
        const access = organizationProducts.filter((item) => item.product_id === product.id);
        const productInstallations = installations.filter((item) => item.host_product_id === product.id);
        const issues = access.filter((item) => item.sync_status && item.sync_status !== 'synced').length;
        return <article key={product.id} className="product-card-v2">
          <div className="product-card-v2-head"><div><strong>{product.name}</strong><span>{product.code}</span></div><Status value={product.last_health || 'unknown'} /></div>
          <div className="product-card-v2-facts">
            <div><span>Версия</span><strong>{product.version || '—'}</strong></div>
            <div><span>Latency</span><strong>{product.last_latency_ms == null ? '—' : `${product.last_latency_ms} мс`}</strong></div>
            <div><span><Building2 size={14} />Организации</span><strong>{access.filter((item) => item.status === 'active').length}</strong></div>
            <div><span><Layers3 size={14} />Модули</span><strong>{productInstallations.filter((item) => item.status === 'active').length}</strong></div>
          </div>
          <div className="product-card-v2-heartbeat"><span>Последний heartbeat</span><strong>{heartbeat(product.last_heartbeat_at)}</strong></div>
          <div className="product-card-v2-sync"><span>Control Center sync</span><strong className={issues ? 'warn' : 'ok'}>{issues ? `${issues} проблем` : 'Синхронизировано'}</strong></div>
          {product.last_error && <div className="product-card-v2-error">{product.last_error}</div>}
        </article>;
      })}</div>
    </div>

    {user.scope === 'platform' ? <div className="products-commercial"><div className="products-commercial-title"><span>PRODUCT CONFIGURATION</span><h2>Коммерческая конфигурация</h2><p>Тарифы, модули, лимиты, Trial и способы оплаты хранятся внутри конкретного продукта.</p></div><ProductCommercialCenterV2 products={products} canManage={canManage} /></div> : <div className="products-tenant-note"><strong>Коммерческая конфигурация скрыта.</strong><span>Tenant-пользователь видит только продукты, доступные его организации.</span></div>}
  </section>;
}
