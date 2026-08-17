from pathlib import Path


def one(text: str, old: str, new: str, name: str) -> str:
    if old not in text:
        raise SystemExit(f'missing anchor: {name}')
    return text.replace(old, new, 1)


p = Path('apps/vps-api/src/index.ts')
s = p.read_text()
s = one(s, "import { createSessionToken, hashPassword, hashToken, validatePassword, verifyPassword } from './security.js';\n", "import { createSessionToken, hashPassword, hashToken, validatePassword, verifyPassword } from './security.js';\nimport { handleTenantApi } from './tenantRoutes.js';\nimport { loadTenantAccess, organizationIds, serializeMemberships } from './tenantAccess.js';\n", 'imports')
s = one(s, "const listeners = new Set<ServerResponse>();\n\ntype User = { id: string; email: string; full_name: string; global_role: string; is_active: boolean };", "type ListenerScope = { isPlatformUser: boolean; organizationIds: Set<string> };\nconst listeners = new Map<ServerResponse, ListenerScope>();\n\ntype User = { id: string; email: string; full_name: string; global_role: string | null; is_active: boolean };", 'listeners')
s = one(s, "    setSessionCookie(res, session.token);\n    return json(res, 200, { user: { id: row.id, email: row.email, fullName: row.full_name, role: row.global_role } });\n", "    const access = await loadTenantAccess(pool, row);\n    setSessionCookie(res, session.token);\n    return json(res, 200, { user: { id: row.id, email: row.email, fullName: row.full_name, role: row.global_role || access.memberships[0]?.role || 'member', scope: access.isPlatformUser ? 'platform' : 'tenant', memberships: serializeMemberships(access) } });\n", 'login')
s = one(s, "    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role } });\n", "    const access = await loadTenantAccess(pool, user);\n    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role || access.memberships[0]?.role || 'member', scope: access.isPlatformUser ? 'platform' : 'tenant', memberships: serializeMemberships(access) } });\n", 'me')
s = one(s, "    setSessionCookie(res, session.token);\n    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role } });\n  }\n\n  if (url.pathname === '/events' && method === 'GET') {", "    const access = await loadTenantAccess(pool, user);\n    setSessionCookie(res, session.token);\n    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role || access.memberships[0]?.role || 'member', scope: access.isPlatformUser ? 'platform' : 'tenant', memberships: serializeMemberships(access) } });\n  }\n\n  if (url.pathname === '/events' && method === 'GET') {", 'password response')
old = """  if (url.pathname === '/events' && method === 'GET') {
    const user = await requireUser(req, res); if (!user) return;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    listeners.add(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => { clearInterval(heartbeat); listeners.delete(res); });
    return;
  }

  const user = await requireUser(req, res); if (!user) return;
"""
new = """  if (url.pathname === '/events' && method === 'GET') {
    const user = await requireUser(req, res); if (!user) return;
    const access = await loadTenantAccess(pool, user);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    listeners.set(res, { isPlatformUser: access.isPlatformUser, organizationIds: new Set(organizationIds(access)) });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, scope: access.isPlatformUser ? 'platform' : 'tenant' })}\n\n`);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => { clearInterval(heartbeat); listeners.delete(res); });
    return;
  }

  const user = await requireUser(req, res); if (!user) return;
  const access = await loadTenantAccess(pool, user);
  if (await handleTenantApi({ req, res, pool, url, method, user, scope: access, json })) return;
  if (!access.isPlatformUser && url.pathname.startsWith('/api/v1/')) return json(res, 403, { error: 'TENANT_SCOPE_REQUIRED' });
"""
s = one(s, old, new, 'events')
s = s.replace("if (!['platform_owner','platform_admin','auditor'].includes(user.global_role))", "if (!user.global_role || !['platform_owner','platform_admin','auditor'].includes(user.global_role))")
s = one(s, "  for (const res of listeners) sse(res, event);\n});\n", "  const eventOrganizationId = typeof event === 'object' && event !== null && 'organization_id' in event ? String((event as { organization_id?: unknown }).organization_id || '') : '';\n  for (const [res, scope] of listeners) {\n    if (scope.isPlatformUser || (eventOrganizationId && scope.organizationIds.has(eventOrganizationId))) sse(res, event);\n  }\n});\n", 'listener delivery')
p.write_text(s)

p = Path('deploy/vps/deploy-control-plane.sh')
s = p.read_text()
s = one(s, '005_registration_notifications.sql 005_security_hardening.sql; do', '005_registration_notifications.sql 005_security_hardening.sql 006_tenant_rbac.sql; do', 'migration deploy')
p.write_text(s)

p = Path('src/vps/VpsApp.tsx')
s = p.read_text()
s = one(s, "type User = { id: string; email: string; fullName: string; role: string };", "type User = { id: string; email: string; fullName: string; role: string; scope: 'platform' | 'tenant'; memberships?: Array<{ organizationId: string; role: string }> };", 'user scope')
s = one(s, "  const [passwordMessage, setPasswordMessage] = useState('');\n\n  const refresh = useCallback(async () => {", "  const [passwordMessage, setPasswordMessage] = useState('');\n  const apiRoot = user?.scope === 'tenant' ? '/api/tenant/v1' : '/api/v1';\n\n  const refresh = useCallback(async () => {", 'api root')
s = one(s, "api<Overview>('/api/v1/overview'), api<{ items: Organization[] }>('/api/v1/organizations'), api<{ items: Product[] }>('/api/v1/products'), api<{ items: Module[] }>('/api/v1/modules'), api<{ items: Installation[] }>('/api/v1/installations'), api<{ items: OrganizationProduct[] }>('/api/v1/organization-products'), api<{ items: ControlCommand[] }>('/api/v1/control-commands'),", "api<Overview>(`${apiRoot}/overview`), api<{ items: Organization[] }>(`${apiRoot}/organizations`), api<{ items: Product[] }>(`${apiRoot}/products`), api<{ items: Module[] }>(`${apiRoot}/modules`), api<{ items: Installation[] }>(`${apiRoot}/installations`), api<{ items: OrganizationProduct[] }>(`${apiRoot}/organization-products`), api<{ items: ControlCommand[] }>(`${apiRoot}/control-commands`),", 'scoped refresh')
s = one(s, "  }, []);\n\n  useEffect(() => { api<{ user: User }>('/api/auth/me')", "  }, [apiRoot]);\n\n  useEffect(() => { api<{ user: User }>('/api/auth/me')", 'refresh deps')
s = one(s, "  if (!user) return <Login onReady={setUser} />;\n\n  const logout", "  if (!user) return <Login onReady={setUser} />;\n  const canManagePlatform = user.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role);\n\n  const logout", 'management flag')
s = s.replace("<small>{user.role}</small>", "<small>{user.scope === 'tenant' ? `Организация · ${user.role}` : user.role}</small>", 1)
s = s.replace("{error && <div className=\"vps-error\">API: {error}</div>}", "{error && <div className=\"vps-error\">API: {error}</div>}{!canManagePlatform && user.scope === 'tenant' && <div className=\"vps-note\">Tenant scope: доступны только назначенные организации, продукты и модули. Изменения entitlement выполняет IMDS Super Admin.</div>}", 1)
p.write_text(s)
