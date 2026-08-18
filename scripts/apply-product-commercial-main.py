from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing anchor: {label}')
    return text.replace(old, new, 1)

# API integration.
p = Path('apps/vps-api/src/index.ts')
s = p.read_text()
if "./productCommercial.js" not in s:
    anchor = "import { handleNotificationSettingsApi } from './notificationSettings.js';\n"
    s = replace_once(s, anchor, anchor + "import { handleProductCommercialApi } from './productCommercial.js';\n", 'commercial api import')
if 'handleProductCommercialApi({ req, res, pool, url, method, user, json })' not in s:
    anchor = "  if (!access.isPlatformUser && url.pathname.startsWith('/api/v1/')) return json(res, 403, { error: 'TENANT_SCOPE_REQUIRED' });\n\n"
    s = replace_once(s, anchor, anchor + "  if (await handleProductCommercialApi({ req, res, pool, url, method, user, json })) return;\n\n", 'commercial api route')
p.write_text(s)

# UI integration. Platform users configure the product catalog. Tenant users retain a read-only product list.
p = Path('src/vps/VpsApp.tsx')
s = p.read_text()
if "ProductCommercialCenter" not in s:
    anchor = "import { TelegramNotificationSettings } from '../features/settings/TelegramNotificationSettings';\n"
    s = replace_once(s, anchor, anchor + "import { ProductCommercialCenter } from '../features/products/ProductCommercialCenter';\n", 'commercial UI import')
start = s.find("  {tab === 'products' &&")
end = s.find("\n  {tab === 'modules' &&", start)
if start < 0 or end < 0:
    raise SystemExit('missing products UI block')
tenant_products = "<section className=\"vps-card\"><div className=\"vps-card-head\"><div><span>ПРОДУКТЫ</span><h2>Доступные продукты</h2></div></div>{products.length === 0 ? <EmptyState title=\"Нет доступных продуктов\" text=\"Для вашей организации продукты ещё не подключены.\" /> : <div className=\"vps-table-wrap\"><table><thead><tr><th>Продукт</th><th>Статус</th><th>Состояние</th></tr></thead><tbody>{products.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.code}</small></td><td><Status value={x.status} /></td><td><Status value={x.last_health} /></td></tr>)}</tbody></table></div>}</section>"
replacement = "  {tab === 'products' && (user.scope === 'platform' ? <ProductCommercialCenter products={products} canManage={canManagePlatform} /> : " + tenant_products + ")}\n"
s = s[:start] + replacement + s[end:]
p.write_text(s)

# Normalize the current migration sequence and remove stale commercial migration numbers.
p = Path('deploy/vps/deploy-control-plane.sh')
s = p.read_text()
s = s.replace(' 008_product_commercial_catalog.sql', '')
s = s.replace(' 009_product_commercial_catalog.sql', '')
if '010_product_commercial_catalog.sql' not in s:
    marker = '009_tenant_user_access.sql; do'
    s = replace_once(s, marker, '009_tenant_user_access.sql 010_product_commercial_catalog.sql; do', 'deploy migration list')
p.write_text(s)

# Deployment staging and authenticated verification.
p = Path('.github/workflows/deploy-vps-control-plane.yml')
s = p.read_text()
s = s.replace('          cp deploy/vps/migrations/008_product_commercial_catalog.sql .deploy-stage/008_product_commercial_catalog.sql\n', '')
s = s.replace('          cp deploy/vps/migrations/009_product_commercial_catalog.sql .deploy-stage/009_product_commercial_catalog.sql\n', '')
if '010_product_commercial_catalog.sql .deploy-stage/010_product_commercial_catalog.sql' not in s:
    anchor = '          cp deploy/vps/migrations/009_tenant_user_access.sql .deploy-stage/009_tenant_user_access.sql\n'
    if anchor not in s:
        anchor = '          cp deploy/vps/migrations/007_notification_delivery_settings.sql .deploy-stage/007_notification_delivery_settings.sql\n'
    s = replace_once(s, anchor, anchor + '          cp deploy/vps/migrations/010_product_commercial_catalog.sql .deploy-stage/010_product_commercial_catalog.sql\n', 'stage commercial migration')
if "to_regclass('app.product_plans')" not in s:
    check = "          sudo -u postgres psql --dbname=imdssa --tuples-only --no-align --command=\"select to_regclass('app.product_plans') is not null and to_regclass('app.product_module_commercial') is not null\" | grep -q '^t$'\n"
    anchor = "          sudo -u postgres psql --dbname=imdssa --tuples-only --no-align --command=\"select to_regclass('app.organization_memberships') is not null\" | grep -q '^t$'\n"
    if anchor in s:
        s = s.replace(anchor, anchor + check, 1)
    else:
        pos = s.find('          done\n', s.find('Verify Super Admin authenticated runtime'))
        if pos < 0: raise SystemExit('missing deploy verification anchor')
        pos += len('          done\n')
        s = s[:pos] + check + s[pos:]
p.write_text(s)
