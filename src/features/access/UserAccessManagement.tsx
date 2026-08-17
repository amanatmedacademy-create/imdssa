import { FormEvent, useEffect, useMemo, useState } from 'react';

type Organization = { id: string; name: string };
type Product = { code: string; name: string };
type Module = { code: string; name: string };
type Membership = {
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'suspended';
  allowed_product_codes: string[];
  allowed_module_codes: string[];
  organization_name: string;
  email: string;
  full_name: string;
  is_active: boolean;
  last_seen_at: string | null;
  must_change_password: boolean;
};
type CurrentUser = { id: string; scope: 'platform' | 'tenant'; role: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers || {}) }, ...init });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export function UserAccessManagement({ user, organizations, products, modules }: { user: CurrentUser; organizations: Organization[]; products: Product[]; modules: Module[] }) {
  const [organizationId, setOrganizationId] = useState('');
  const [items, setItems] = useState<Membership[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createdPassword, setCreatedPassword] = useState('');
  const [form, setForm] = useState({ email: '', fullName: '', role: 'member', allowedProductCodes: [] as string[], allowedModuleCodes: [] as string[] });
  const base = user.scope === 'platform' ? '/api/v1/access/users' : '/api/tenant/v1/access/users';
  const canAssignOwner = user.scope === 'platform' && ['platform_owner','platform_admin'].includes(user.role);

  useEffect(() => { if (!organizationId && organizations[0]?.id) setOrganizationId(organizations[0].id); }, [organizationId, organizations]);
  const load = async () => {
    if (!organizationId) { setItems([]); return; }
    try { const result = await api<{ items: Membership[] }>(`${base}?organizationId=${encodeURIComponent(organizationId)}`); setItems(result.items); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки пользователей'); }
  };
  useEffect(() => { void load(); }, [base, organizationId]);

  const selectedOrganization = organizations.find((item) => item.id === organizationId);
  const roleOptions = useMemo(() => canAssignOwner ? ['owner','admin','member','viewer'] : ['admin','member','viewer'], [canAssignOwner]);
  const toggle = (key: 'allowedProductCodes' | 'allowedModuleCodes', code: string) => setForm((value) => ({ ...value, [key]: value[key].includes(code) ? value[key].filter((item) => item !== code) : [...value[key], code] }));

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!organizationId) return;
    setBusy(true); setError(''); setCreatedPassword('');
    try {
      const result = await api<{ temporaryPassword: string | null }>(base, { method: 'POST', body: JSON.stringify({ organizationId, ...form }) });
      if (result.temporaryPassword) setCreatedPassword(result.temporaryPassword);
      setForm({ email: '', fullName: '', role: 'member', allowedProductCodes: [], allowedModuleCodes: [] });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения пользователя'); }
    finally { setBusy(false); }
  };

  const updateMembership = async (item: Membership, patch: Record<string, unknown>) => {
    setBusy(true); setError('');
    try {
      await api(`${base}/${item.organization_id}/${item.user_id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка изменения доступа'); }
    finally { setBusy(false); }
  };

  return <div className="vps-stack">
    <section className="vps-panel">
      <div className="vps-section-head"><div><span>USERS & ACCESS</span><h3>Пользователи организаций</h3></div><small>RBAC · session revocation · tenant scope</small></div>
      <label>Организация<select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {selectedOrganization && <p className="vps-muted">Управление доступом: {selectedOrganization.name}</p>}
      {error && <div className="vps-error">{error}</div>}
      {createdPassword && <div className="vps-note"><strong>Временный пароль создан.</strong><br/><code>{createdPassword}</code><br/>Передайте его пользователю безопасным каналом. После первого входа пароль нужно заменить.</div>}
    </section>

    <section className="vps-panel">
      <div className="vps-section-head"><div><span>NEW MEMBERSHIP</span><h3>Добавить пользователя</h3></div></div>
      <form className="vps-form-grid" onSubmit={submit}>
        <label>Имя<input value={form.fullName} onChange={(e) => setForm((v) => ({ ...v, fullName: e.target.value }))} required /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))} required /></label>
        <label>Роль<select value={form.role} onChange={(e) => setForm((v) => ({ ...v, role: e.target.value }))}>{roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
        <div className="vps-form-wide"><strong>Продукты</strong><div className="vps-chip-grid">{products.map((item) => <label key={item.code}><input type="checkbox" checked={form.allowedProductCodes.includes(item.code)} onChange={() => toggle('allowedProductCodes', item.code)} /> {item.name}</label>)}</div></div>
        <div className="vps-form-wide"><strong>Модули</strong><div className="vps-chip-grid">{modules.map((item) => <label key={item.code}><input type="checkbox" checked={form.allowedModuleCodes.includes(item.code)} onChange={() => toggle('allowedModuleCodes', item.code)} /> {item.name}</label>)}</div></div>
        <div className="vps-form-wide"><button className="vps-primary" disabled={busy || !organizationId}>Добавить доступ</button></div>
      </form>
    </section>

    <section className="vps-panel">
      <div className="vps-section-head"><div><span>MEMBERSHIPS</span><h3>Текущий доступ</h3></div><small>{items.length}</small></div>
      {!items.length ? <div className="vps-empty"><div className="vps-empty-mark">—</div><div><strong>Пользователей нет</strong><p>Для этой организации ещё не назначены пользователи.</p></div></div> : <div className="vps-table-wrap"><table><thead><tr><th>Пользователь</th><th>Роль</th><th>Статус</th><th>Scope</th><th>Последний вход</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={`${item.organization_id}:${item.user_id}`}><td><strong>{item.full_name}</strong><small>{item.email}</small>{item.must_change_password && <small>Нужно сменить пароль</small>}</td><td>{item.role}</td><td>{item.status}</td><td><small>P: {item.allowed_product_codes.join(', ') || 'все по роли'}<br/>M: {item.allowed_module_codes.join(', ') || 'все по роли'}</small></td><td>{item.last_seen_at ? new Date(item.last_seen_at).toLocaleString('ru-RU') : '—'}</td><td>{item.user_id === user.id ? <small>текущий пользователь</small> : <div className="vps-actions">{item.role !== 'owner' && <select disabled={busy} value={item.role} onChange={(e) => void updateMembership(item, { role: e.target.value })}>{roleOptions.filter((role) => role !== 'owner').map((role) => <option key={role} value={role}>{role}</option>)}</select>}<button disabled={busy} onClick={() => void updateMembership(item, { status: item.status === 'active' ? 'suspended' : 'active' })}>{item.status === 'active' ? 'Отключить' : 'Включить'}</button></div>}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
