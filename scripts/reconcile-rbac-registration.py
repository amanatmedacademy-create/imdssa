from pathlib import Path


def one(text: str, old: str, new: str, name: str) -> str:
    if old not in text:
        raise SystemExit(f'missing anchor: {name}')
    return text.replace(old, new, 1)

# Merge tenant RBAC into the current registration/Telegram API.
p = Path('apps/vps-api/src/index.ts')
s = p.read_text()
s = one(s,
    "import { handleNotificationSettingsApi } from './notificationSettings.js';\nimport { createSessionToken, hashPassword, hashToken, validatePassword, verifyPassword } from './security.js';\n",
    "import { handleNotificationSettingsApi } from './notificationSettings.js';\nimport { createSessionToken, hashPassword, hashToken, validatePassword, verifyPassword } from './security.js';\nimport { handleTenantApi } from './tenantRoutes.js';\nimport { loadTenantAccess, organizationIds, serializeMemberships } from './tenantAccess.js';\n",
    'tenant imports')
s = one(s,
    "const pool = new Pool({ connectionString: databaseUrl, max: 10 });\nconst listeners = new Set<ServerResponse>();\n\ntype User = { id: string; email: string; full_name: string; global_role: string; is_active: boolean };",
    "const pool = new Pool({ connectionString: databaseUrl, max: 10 });\ntype ListenerScope = { isPlatformUser: boolean; organizationIds: Set<string> };\nconst listeners = new Map<ServerResponse, ListenerScope>();\n\ntype User = { id: string; email: string; full_name: string; global_role: string | null; is_active: boolean };",
    'listener scope and user')
s = one(s,
    "    setSessionCookie(res, session.token);\n    return json(res, 200, { user: { id: row.id, email: row.email, fullName: row.full_name, role: row.global_role } });",
    "    const access = await loadTenantAccess(pool, row);\n    setSessionCookie(res, session.token);\n    return json(res, 200, { user: { id: row.id, email: row.email, fullName: row.full_name, role: row.global_role || access.memberships[0]?.role || 'member', scope: access.isPlatformUser ? 'platform' : 'tenant', memberships: serializeMemberships(access) } });",
    'login access')
s = one(s,
    "  if (url.pathname === '/api/auth/me' && method === 'GET') {\n    const user = await requireUser(req, res); if (!user) return;\n    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role } });\n  }",
    "  if (url.pathname === '/api/auth/me' && method === 'GET') {\n    const user = await requireUser(req, res); if (!user) return;\n    const access = await loadTenantAccess(pool, user);\n    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role || access.memberships[0]?.role || 'member', scope: access.isPlatformUser ? 'platform' : 'tenant', memberships: serializeMemberships(access) } });\n  }",
    'me access')
s = one(s,
    "    await audit(req, user.id, 'auth.password.change', 'platform_user', user.id, null, { sessionsRevoked: true });\n    setSessionCookie(res, session.token);\n    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role } });",
    "    await audit(req, user.id, 'auth.password.change', 'platform_user', user.id, null, { sessionsRevoked: true });\n    const access = await loadTenantAccess(pool, user);\n    setSessionCookie(res, session.token);\n    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role || access.memberships[0]?.role || 'member', scope: access.isPlatformUser ? 'platform' : 'tenant', memberships: serializeMemberships(access) } });",
    'password access')
s = one(s,
    "  if (url.pathname === '/events' && method === 'GET') {\n    const user = await requireUser(req, res); if (!user) return;\n    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });\n    listeners.add(res);\n    res.write(`event: ready\\ndata: ${JSON.stringify({ ok: true })}\\n\\n`);",
    "  if (url.pathname === '/events' && method === 'GET') {\n    const user = await requireUser(req, res); if (!user) return;\n    const access = await loadTenantAccess(pool, user);\n    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });\n    listeners.set(res, { isPlatformUser: access.isPlatformUser, organizationIds: new Set(organizationIds(access)) });\n    res.write(`event: ready\\ndata: ${JSON.stringify({ ok: true, scope: access.isPlatformUser ? 'platform' : 'tenant' })}\\n\\n`);",
    'event scope')
s = one(s,
    "  const user = await requireUser(req, res); if (!user) return;\n\n  if (await handleNotificationSettingsApi(req, res, pool, url, method, user)) return;",
    "  const user = await requireUser(req, res); if (!user) return;\n  const access = await loadTenantAccess(pool, user);\n  if (await handleTenantApi({ req, res, pool, url, method, user, scope: access, json })) return;\n  if (!access.isPlatformUser && url.pathname.startsWith('/api/v1/')) return json(res, 403, { error: 'TENANT_SCOPE_REQUIRED' });\n\n  if (await handleNotificationSettingsApi(req, res, pool, url, method, user)) return;",
    'tenant route dispatch')
s = one(s,
    "    if (!['platform_owner','platform_admin','auditor'].includes(user.global_role)) return json(res, 403, { error: 'AUDIT_ACCESS_REQUIRED' });",
    "    if (!user.global_role || !['platform_owner','platform_admin','auditor'].includes(user.global_role)) return json(res, 403, { error: 'AUDIT_ACCESS_REQUIRED' });",
    'audit nullable role')
s = one(s,
    "  for (const res of listeners) sse(res, event);",
    "  const eventOrganizationId = typeof event === 'object' && event !== null && 'organization_id' in event ? String((event as { organization_id?: unknown }).organization_id || '') : '';\n  for (const [res, scope] of listeners) {\n    if (scope.isPlatformUser || (eventOrganizationId && scope.organizationIds.has(eventOrganizationId))) sse(res, event);\n  }",
    'scoped realtime')
p.write_text(s)

# Merge tenant-aware frontend routing while retaining registration/settings pages.
p = Path('src/vps/VpsApp.tsx')
s = p.read_text()
s = one(s,
    "type User = { id: string; email: string; fullName: string; role: string };",
    "type User = { id: string; email: string; fullName: string; role: string; scope: 'platform' | 'tenant'; memberships?: Array<{ organizationId: string; role: string }> };",
    'frontend user scope')
s = one(s,
    "  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });\n  const [passwordMessage, setPasswordMessage] = useState('');\n\n  const refresh = useCallback(async () => {",
    "  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });\n  const [passwordMessage, setPasswordMessage] = useState('');\n  const apiRoot = user?.scope === 'tenant' ? '/api/tenant/v1' : '/api/v1';\n  const visibleTabs = useMemo(() => user?.scope === 'tenant' ? tabs.filter((item) => !['registrations','settings'].includes(item.id)) : tabs, [user?.scope]);\n\n  const refresh = useCallback(async () => {",
    'frontend api root')
s = one(s,
    "        api<Overview>('/api/v1/overview'), api<{ items: Organization[] }>('/api/v1/organizations'), api<{ items: Product[] }>('/api/v1/products'), api<{ items: Module[] }>('/api/v1/modules'), api<{ items: Installation[] }>('/api/v1/installations'), api<{ items: OrganizationProduct[] }>('/api/v1/organization-products'), api<{ items: ControlCommand[] }>('/api/v1/control-commands'),",
    "        api<Overview>(`${apiRoot}/overview`), api<{ items: Organization[] }>(`${apiRoot}/organizations`), api<{ items: Product[] }>(`${apiRoot}/products`), api<{ items: Module[] }>(`${apiRoot}/modules`), api<{ items: Installation[] }>(`${apiRoot}/installations`), api<{ items: OrganizationProduct[] }>(`${apiRoot}/organization-products`), api<{ items: ControlCommand[] }>(`${apiRoot}/control-commands`),",
    'frontend refresh routes')
s = one(s, "  }, []);", "  }, [apiRoot]);", 'frontend refresh deps')
s = one(s,
    "  if (!user) return <Login onReady={setUser} />;\n\n  const logout = async () => {",
    "  if (!user) return <Login onReady={setUser} />;\n  const canManagePlatform = user.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role);\n\n  const logout = async () => {",
    'frontend manage scope')
s = one(s,
    "<nav>{tabs.map((item) => <button key={item.id}",
    "<nav>{visibleTabs.map((item) => <button key={item.id}",
    'visible tenant tabs')
s = one(s,
    "<small>{user.role}</small><button onClick={() => void logout()}>Выйти</button></div></aside><main className=\"vps-content\"><header",
    "<small>{user.scope === 'tenant' ? `Организация · ${user.role}` : user.role}</small><button onClick={() => void logout()}>Выйти</button></div></aside><main className=\"vps-content\"><header",
    'frontend role label')
s = one(s,
    "</header>{error && <div className=\"vps-error\">API: {error}</div>}\n",
    "</header>{error && <div className=\"vps-error\">API: {error}</div>}{!canManagePlatform && user.scope === 'tenant' && <div className=\"vps-note\">Tenant scope: доступны только назначенные организации, продукты и модули. Изменения entitlement выполняет IMDS Control Center.</div>}\n",
    'tenant scope note')
p.write_text(s)

# Deploy both migrations in deterministic order.
p = Path('deploy/vps/deploy-control-plane.sh')
s = p.read_text()
s = one(s,
    '005_registration_notifications.sql 005_security_hardening.sql 007_notification_delivery_settings.sql; do',
    '005_registration_notifications.sql 005_security_hardening.sql 006_tenant_rbac.sql 007_notification_delivery_settings.sql; do',
    'migration order')
p.write_text(s)
