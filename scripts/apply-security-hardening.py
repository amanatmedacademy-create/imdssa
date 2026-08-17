from pathlib import Path


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


p = Path("apps/vps-api/src/index.ts")
text = p.read_text()
text = must_replace(
    text,
    "import http, { type IncomingMessage, type ServerResponse } from 'node:http';\nimport pg from 'pg';\nimport { createSessionToken, hashToken, verifyPassword } from './security.js';",
    "import http, { type IncomingMessage, type ServerResponse } from 'node:http';\nimport { randomUUID } from 'node:crypto';\nimport pg from 'pg';\nimport { createSessionToken, hashPassword, hashToken, validatePassword, verifyPassword } from './security.js';",
    "security imports",
)
text = must_replace(
    text,
    "type User = { id: string; email: string; full_name: string; global_role: string; is_active: boolean };",
    "type User = { id: string; email: string; full_name: string; global_role: string; is_active: boolean };\ntype LoginUser = User & { password_hash: string; failed_login_attempts: number; locked_until: string | null };",
    "login user type",
)

helper_marker = "function sse(res: ServerResponse, event: unknown) {"
helpers = """function sourceIp(req: IncomingMessage): string | null {
  const forwarded = req.headers['x-real-ip'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.trim();
  const remote = req.socket.remoteAddress || '';
  return remote.startsWith('::ffff:') ? remote.slice(7) : remote || null;
}

function userAgent(req: IncomingMessage): string | null {
  const value = req.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 512) : null;
}

function requestId(req: IncomingMessage): string {
  const value = req.headers['x-request-id'];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : randomUUID();
}

function mutationOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (typeof origin !== 'string') return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function setSessionCookie(res: ServerResponse, token: string) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `imdssa_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
}

"""
text = must_replace(text, helper_marker, helpers + helper_marker, "request security helpers")

audit_start = text.index("async function audit(")
handle_start = text.index("\n\nasync function handle", audit_start)
audit_new = """async function audit(req: IncomingMessage, userId: string, action: string, targetType: string, targetId: string | null, beforeState: unknown, afterState: unknown) {
  await pool.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,request_id,source_ip,before_state,after_state)
    values($1,$2,$3,$4,$5,$6::inet,$7::jsonb,$8::jsonb)`, [userId, action, targetType, targetId, requestId(req), sourceIp(req), beforeState ? JSON.stringify(beforeState) : null, afterState ? JSON.stringify(afterState) : null]);
}"""
text = text[:audit_start] + audit_new + text[handle_start:]
text = must_replace(
    text,
    "  const method = req.method || 'GET';\n",
    "  const method = req.method || 'GET';\n  if (['POST','PUT','PATCH','DELETE'].includes(method) && url.pathname.startsWith('/api/') && !mutationOriginAllowed(req)) return json(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });\n",
    "origin guard",
)

login_start = text.index("  if (url.pathname === '/api/auth/login' && method === 'POST') {")
logout_start = text.index("\n\n  if (url.pathname === '/api/auth/logout'", login_start)
login_new = """  if (url.pathname === '/api/auth/login' && method === 'POST') {
    const data = await body(req);
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    const ip = sourceIp(req);
    if (!email || !password) return json(res, 401, { error: 'INVALID_CREDENTIALS' });

    if (ip) {
      const ipFailures = await pool.query<{ count: number }>(`select count(*)::int count from app.login_attempts where source_ip=$1::inet and succeeded=false and created_at>now()-interval '15 minutes'`, [ip]);
      if ((ipFailures.rows[0]?.count || 0) >= 20) return json(res, 429, { error: 'LOGIN_TEMPORARILY_LOCKED', retryAfterSeconds: 900 });
    }

    const result = await pool.query<LoginUser>(`select id,email,full_name,global_role,is_active,password_hash,failed_login_attempts,locked_until from app.platform_users where lower(email)=lower($1) limit 1`, [email]);
    const row = result.rows[0];
    if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) return json(res, 429, { error: 'LOGIN_TEMPORARILY_LOCKED', retryAfterSeconds: Math.max(1, Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 1000)) });

    const valid = Boolean(row?.is_active && verifyPassword(password, row.password_hash));
    await pool.query(`insert into app.login_attempts(normalized_email,source_ip,succeeded) values($1,$2::inet,$3)`, [email, ip, valid]);
    if (!valid) {
      if (row) await pool.query(`update app.platform_users set failed_login_attempts=failed_login_attempts+1,locked_until=case when failed_login_attempts+1>=5 then now()+interval '15 minutes' else locked_until end where id=$1`, [row.id]);
      return json(res, 401, { error: 'INVALID_CREDENTIALS' });
    }

    const session = createSessionToken();
    await pool.query(`insert into app.auth_sessions(user_id,token_hash,expires_at,source_ip,user_agent) values($1,$2,now()+interval '12 hours',$3::inet,$4)`, [row.id, session.hash, ip, userAgent(req)]);
    await pool.query('update app.platform_users set last_seen_at=now(),last_login_ip=$2::inet,failed_login_attempts=0,locked_until=null where id=$1', [row.id, ip]);
    setSessionCookie(res, session.token);
    return json(res, 200, { user: { id: row.id, email: row.email, fullName: row.full_name, role: row.global_role } });
  }"""
text = text[:login_start] + login_new + text[logout_start:]

me_block = "  if (url.pathname === '/api/auth/me' && method === 'GET') {\n    const user = await requireUser(req, res); if (!user) return;\n    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role } });\n  }\n"
password_block = """

  if (url.pathname === '/api/auth/change-password' && method === 'POST') {
    const user = await requireUser(req, res); if (!user) return;
    const data = await body(req);
    const currentPassword = String(data.currentPassword || '');
    const newPassword = String(data.newPassword || '');
    const policyError = validatePassword(newPassword);
    if (policyError) return json(res, 400, { error: policyError });
    const stored = await pool.query<{ password_hash: string }>('select password_hash from app.platform_users where id=$1 and is_active=true', [user.id]);
    const passwordHash = stored.rows[0]?.password_hash;
    if (!passwordHash || !verifyPassword(currentPassword, passwordHash)) return json(res, 401, { error: 'CURRENT_PASSWORD_INVALID' });
    if (verifyPassword(newPassword, passwordHash)) return json(res, 400, { error: 'PASSWORD_REUSE_NOT_ALLOWED' });

    const session = createSessionToken();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('update app.platform_users set password_hash=$2,password_changed_at=now(),failed_login_attempts=0,locked_until=null where id=$1', [user.id, hashPassword(newPassword)]);
      await client.query('delete from app.auth_sessions where user_id=$1', [user.id]);
      await client.query(`insert into app.auth_sessions(user_id,token_hash,expires_at,source_ip,user_agent) values($1,$2,now()+interval '12 hours',$3::inet,$4)`, [user.id, session.hash, sourceIp(req), userAgent(req)]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
    await audit(req, user.id, 'auth.password.change', 'platform_user', user.id, null, { sessionsRevoked: true });
    setSessionCookie(res, session.token);
    return json(res, 200, { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.global_role } });
  }
"""
text = must_replace(text, me_block, me_block + password_block, "password endpoint")
text = text.replace("await audit(user.id,", "await audit(req, user.id,")

audit_route = "  if (url.pathname === '/api/v1/audit' && method === 'GET') {\n"
text = must_replace(
    text,
    audit_route,
    audit_route + "    if (!['platform_owner','platform_admin','auditor'].includes(user.global_role)) return json(res, 403, { error: 'AUDIT_ACCESS_REQUIRED' });\n",
    "audit rbac",
)
text = must_replace(
    text,
    "setInterval(() => { void pool.query('delete from app.auth_sessions where expires_at<=now()'); }, 300000).unref();",
    "setInterval(() => { void pool.query('delete from app.auth_sessions where expires_at<=now()'); void pool.query(\"delete from app.login_attempts where created_at<now()-interval '30 days'\"); }, 300000).unref();",
    "security cleanup",
)
p.write_text(text)

p = Path("src/vps/VpsApp.tsx")
text = p.read_text()
text = must_replace(
    text,
    "type Tab = 'overview' | 'organizations' | 'products' | 'modules' | 'installations' | 'sync' | 'realtime';",
    "type Tab = 'overview' | 'organizations' | 'products' | 'modules' | 'installations' | 'sync' | 'realtime' | 'security';",
    "security tab type",
)
text = must_replace(text, "  { id: 'realtime', label: 'События' },", "  { id: 'realtime', label: 'События' },\n  { id: 'security', label: 'Безопасность' },", "security tab")
text = must_replace(text, "realtime: 'События в реальном времени',", "realtime: 'События в реальном времени', security: 'Безопасность аккаунта',", "security title")
text = must_replace(text, "const [email, setEmail] = useState('admin@imds.kz');", "const [email, setEmail] = useState('');", "remove production email default")
text = must_replace(
    text,
    "  const [moduleOrganizationId, setModuleOrganizationId] = useState('');",
    "  const [moduleOrganizationId, setModuleOrganizationId] = useState('');\n  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });\n  const [passwordMessage, setPasswordMessage] = useState('');",
    "password state",
)
marker = "  const setOrganizationStatus = async (id: string, status: string) => { setBusy(true); try { await api(`/api/v1/organizations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setBusy(false); } };"
handler = marker + """
  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setPasswordMessage('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setError('Новый пароль и подтверждение не совпадают.'); return; }
    setBusy(true);
    try {
      const result = await api<{ user: User }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }) });
      setUser(result.user); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setPasswordMessage('Пароль изменён. Остальные сессии отозваны.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка смены пароля'); }
    finally { setBusy(false); }
  };"""
text = must_replace(text, marker, handler, "password handler")
security_ui = """  {tab === 'security' && <section className=\"vps-card\"><div className=\"vps-card-head\"><div><span>АККАУНТ</span><h2>Смена пароля</h2></div></div><form className=\"vps-form-grid\" onSubmit={changePassword}><label>Текущий пароль<input type=\"password\" autoComplete=\"current-password\" required value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} /></label><label>Новый пароль<input type=\"password\" autoComplete=\"new-password\" required minLength={16} value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} /></label><label>Подтверждение<input type=\"password\" autoComplete=\"new-password\" required minLength={16} value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} /></label><button className=\"vps-action\" disabled={busy}>Изменить пароль</button></form><p className=\"vps-note\">Минимум 16 символов: строчная и заглавная буквы, цифра и специальный символ. После смены все остальные сессии будут отозваны.</p>{passwordMessage && <div className=\"vps-success\">{passwordMessage}</div>}</section>}

"""
realtime_marker = "  {tab === 'realtime' &&"
if realtime_marker not in text:
    raise SystemExit("missing realtime UI marker")
text = text.replace(realtime_marker, security_ui + realtime_marker, 1)
p.write_text(text)

p = Path("deploy/vps/deploy-control-plane.sh")
text = p.read_text()
text = must_replace(
    text,
    "for migration in 002_auth_sessions.sql 003_platform_management.sql 004_control_plane_sync.sql; do",
    "for migration in 002_auth_sessions.sql 003_platform_management.sql 004_control_plane_sync.sql 005_security_hardening.sql; do",
    "migration loop",
)
p.write_text(text)
