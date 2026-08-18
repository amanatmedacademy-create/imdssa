import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Check,
  KeyRound,
  Search,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import type { Module, Organization, Product, User } from '../../controlCenter';
import './usersPage.css';

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

type Props = {
  user: User;
  organizations: Organization[];
  products: Product[];
  modules: Module[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

const roleLabels: Record<Membership['role'], string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  member: 'Сотрудник',
  viewer: 'Наблюдатель',
};

const statusLabels: Record<Membership['status'], string> = {
  active: 'Активен',
  suspended: 'Отключён',
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'Ещё не входил';
}

export function UsersPage({ user, organizations, products, modules }: Props) {
  const [organizationId, setOrganizationId] = useState('');
  const [items, setItems] = useState<Membership[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdPassword, setCreatedPassword] = useState('');
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    role: 'member' as Membership['role'],
    allowedProductCodes: [] as string[],
    allowedModuleCodes: [] as string[],
  });

  const base = user.scope === 'platform' ? '/api/v1/access/users' : '/api/tenant/v1/access/users';
  const canManage = (user.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role))
    || (user.scope === 'tenant' && ['owner', 'admin'].includes(user.role));
  const canAssignOwner = user.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role);

  useEffect(() => {
    if (!organizationId && organizations[0]?.id) setOrganizationId(organizations[0].id);
  }, [organizationId, organizations]);

  const load = async () => {
    if (!organizationId) { setItems([]); return; }
    setLoading(true);
    try {
      const result = await api<{ items: Membership[] }>(`${base}?organizationId=${encodeURIComponent(organizationId)}`);
      setItems(result.items || []);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка загрузки пользователей');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [base, organizationId]);

  const selectedOrganization = organizations.find((item) => item.id === organizationId);
  const roleOptions = useMemo<Membership['role'][]>(() => canAssignOwner
    ? ['owner', 'admin', 'member', 'viewer']
    : ['admin', 'member', 'viewer'], [canAssignOwner]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => [item.full_name, item.email, item.role, item.status]
      .some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [items, query]);
  const activeCount = items.filter((item) => item.status === 'active').length;
  const adminCount = items.filter((item) => item.role === 'owner' || item.role === 'admin').length;

  const toggle = (key: 'allowedProductCodes' | 'allowedModuleCodes', code: string) => {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(code)
        ? current[key].filter((item) => item !== code)
        : [...current[key], code],
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId || !canManage) return;
    setBusy(true); setError(''); setCreatedPassword('');
    try {
      const result = await api<{ temporaryPassword: string | null }>(base, {
        method: 'POST',
        body: JSON.stringify({ organizationId, ...form }),
      });
      if (result.temporaryPassword) setCreatedPassword(result.temporaryPassword);
      setForm({ email: '', fullName: '', role: 'member', allowedProductCodes: [], allowedModuleCodes: [] });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка сохранения пользователя');
    } finally {
      setBusy(false);
    }
  };

  const updateMembership = async (item: Membership, patch: Record<string, unknown>) => {
    if (!canManage) return;
    setBusy(true); setError('');
    try {
      await api(`${base}/${item.organization_id}/${item.user_id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка изменения доступа');
    } finally {
      setBusy(false);
    }
  };

  return <section className="users-page">
    <div className="users-kpis">
      <article><Users size={18}/><div><span>Пользователи</span><strong>{items.length}</strong><small>{selectedOrganization?.name || 'Выберите организацию'}</small></div></article>
      <article><UserCog size={18}/><div><span>Активные</span><strong>{activeCount}</strong><small>{items.length - activeCount} отключено</small></div></article>
      <article><ShieldCheck size={18}/><div><span>Администраторы</span><strong>{adminCount}</strong><small>owner + admin</small></div></article>
    </div>

    <section className="users-workspace">
      <div className="users-workspace-head">
        <div><span>ACCESS CONTROL</span><h2>Пользователи и доступ</h2><p>Одна карточка пользователя — одна роль, статус и набор разрешённых продуктов и модулей.</p></div>
        <label className="users-org-select"><span>Организация</span><select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
      </div>

      {error && <div className="users-error">{error}</div>}
      {createdPassword && <div className="users-password"><KeyRound size={18}/><div><strong>Временный пароль создан</strong><code>{createdPassword}</code><small>Передайте пользователю безопасным каналом. После первого входа пароль необходимо заменить.</small></div></div>}

      <div className="users-toolbar">
        <label className="users-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, email, роль или статус"/></label>
        <span>{loading ? 'Обновление…' : `${filtered.length} из ${items.length}`}</span>
      </div>

      <div className="users-member-list">
        {!filtered.length && !loading ? <div className="users-empty"><Users size={22}/><strong>Пользователей пока нет</strong><span>Добавьте первого пользователя для выбранной организации.</span></div> : filtered.map((item) => <article className="users-member-card" key={`${item.organization_id}:${item.user_id}`}>
          <div className="users-avatar">{(item.full_name || item.email).slice(0, 1).toUpperCase()}</div>
          <div className="users-member-main">
            <div className="users-member-title"><div><strong>{item.full_name || 'Без имени'}</strong><span>{item.email}</span></div><div className="users-member-badges"><span className={`role ${item.role}`}>{roleLabels[item.role]}</span><span className={`status ${item.status}`}>{statusLabels[item.status]}</span></div></div>
            <div className="users-member-meta"><span>Последний вход: <strong>{formatDate(item.last_seen_at)}</strong></span>{item.must_change_password && <span className="warning">Нужно сменить пароль</span>}</div>
            <div className="users-scope-row"><div><small>Продукты</small><span>{item.allowed_product_codes.length ? item.allowed_product_codes.join(', ') : 'По роли'}</span></div><div><small>Модули</small><span>{item.allowed_module_codes.length ? item.allowed_module_codes.join(', ') : 'По роли'}</span></div></div>
          </div>
          <div className="users-member-actions">
            {item.user_id === user.id ? <span className="users-current">Текущий пользователь</span> : <>
              {item.role !== 'owner' && <select disabled={!canManage || busy} value={item.role} onChange={(event) => void updateMembership(item, { role: event.target.value })}>{roleOptions.filter((role) => role !== 'owner').map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>}
              <button type="button" disabled={!canManage || busy} className={item.status === 'active' ? 'danger' : 'success'} onClick={() => void updateMembership(item, { status: item.status === 'active' ? 'suspended' : 'active' })}>{item.status === 'active' ? 'Отключить' : 'Включить'}</button>
            </>}
          </div>
        </article>)}
      </div>
    </section>

    <section className="users-create-card">
      <div className="users-create-head"><div className="users-create-icon"><UserPlus size={19}/></div><div><span>NEW MEMBERSHIP</span><h2>Добавить пользователя</h2><p>{selectedOrganization ? `Доступ будет назначен организации «${selectedOrganization.name}».` : 'Сначала выберите организацию.'}</p></div></div>
      <form className="users-create-form" onSubmit={submit}>
        <label><span>Имя</span><input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} placeholder="Имя пользователя" required disabled={!canManage || busy}/></label>
        <label><span>Email</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="name@company.kz" required disabled={!canManage || busy}/></label>
        <label><span>Роль</span><select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Membership['role'] }))} disabled={!canManage || busy}>{roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>

        <div className="users-access-group"><div><strong>Продукты</strong><small>Пустой выбор означает доступ согласно роли.</small></div><div className="users-choice-grid">{products.map((product) => {
          const active = form.allowedProductCodes.includes(product.code);
          return <button type="button" key={product.code} className={active ? 'selected' : ''} disabled={!canManage || busy} onClick={() => toggle('allowedProductCodes', product.code)}><span className="users-choice-check">{active && <Check size={13}/>}</span><span><strong>{product.name}</strong><small>{product.code}</small></span></button>;
        })}</div></div>

        <div className="users-access-group"><div><strong>Модули</strong><small>Выберите только те модули, которые нужно ограничить явно.</small></div><div className="users-choice-grid modules">{modules.map((module) => {
          const active = form.allowedModuleCodes.includes(module.code);
          return <button type="button" key={module.code} className={active ? 'selected' : ''} disabled={!canManage || busy} onClick={() => toggle('allowedModuleCodes', module.code)}><span className="users-choice-check">{active && <Check size={13}/>}</span><span><strong>{module.name}</strong><small>{module.code}</small></span></button>;
        })}</div></div>

        <div className="users-create-actions"><div>{!canManage && <span>У вашей роли нет права изменять доступ.</span>}</div><button type="submit" disabled={!canManage || busy || !organizationId}><UserPlus size={15}/>{busy ? 'Сохранение…' : 'Добавить пользователя'}</button></div>
      </form>
    </section>
  </section>;
}
