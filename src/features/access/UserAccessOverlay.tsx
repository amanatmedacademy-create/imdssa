import { FormEvent, useEffect, useMemo, useState } from 'react';
import { UserAccessManagement } from './UserAccessManagement';
import './userAccessOverlay.css';

type CurrentUser = { id: string; email: string; fullName: string; role: string; scope: 'platform' | 'tenant' };
type Organization = { id: string; name: string };
type Product = { code: string; name: string };
type Module = { code: string; name: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers || {}) }, ...init });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export function UserAccessOverlay() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ user: CurrentUser }>('/api/auth/me').then(async (result) => {
      setUser(result.user);
      if (result.user.scope === 'tenant') {
        const policy = await api<{ mustChangePassword: boolean }>('/api/tenant/v1/session-policy').catch(() => ({ mustChangePassword: false }));
        setMustChangePassword(policy.mustChangePassword);
      }
    }).catch(() => setUser(null));
  }, []);

  const canManage = useMemo(() => Boolean(user && ((user.scope === 'platform' && ['platform_owner','platform_admin'].includes(user.role)) || (user.scope === 'tenant' && ['owner','admin'].includes(user.role)))), [user]);

  useEffect(() => {
    if (!canManage || mustChangePassword) return;
    let stopped = false;
    const onUsersClick = () => setOpen(true);
    const syncNavigation = () => {
      if (stopped) return;
      const nav = document.querySelector<HTMLElement>('.vps-sidebar nav');
      if (!nav) return;
      let button = nav.querySelector<HTMLButtonElement>('button[data-user-access-nav="true"]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.userAccessNav = 'true';
        button.textContent = 'Пользователи';
        button.addEventListener('click', onUsersClick);
        const organizationButton = [...nav.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === 'Организации');
        if (organizationButton?.nextSibling) nav.insertBefore(button, organizationButton.nextSibling);
        else if (organizationButton) nav.appendChild(button);
        else nav.prepend(button);
      }
      button.classList.toggle('active', open);
      button.setAttribute('aria-current', open ? 'page' : 'false');
    };
    syncNavigation();
    const observer = new MutationObserver(syncNavigation);
    observer.observe(document.body, { subtree: true, childList: true });
    const closeOnNativeNavigation = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.vps-sidebar nav button') : null;
      if (target && target.dataset.userAccessNav !== 'true') setOpen(false);
    };
    document.addEventListener('click', closeOnNativeNavigation, true);
    return () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener('click', closeOnNativeNavigation, true);
      const button = document.querySelector<HTMLButtonElement>('.vps-sidebar nav button[data-user-access-nav="true"]');
      button?.removeEventListener('click', onUsersClick);
      button?.remove();
    };
  }, [canManage, mustChangePassword, open]);

  useEffect(() => {
    if (!user || (!open && !mustChangePassword)) return;
    const root = user.scope === 'platform' ? '/api/v1' : '/api/tenant/v1';
    Promise.all([
      api<{ items: Organization[] }>(`${root}/organizations`),
      api<{ items: Product[] }>(`${root}/products`),
      api<{ items: Module[] }>(`${root}/modules`),
    ]).then(([org, prod, mod]) => {
      setOrganizations(org.items); setProducts(prod.items); setModules(mod.items); setError('');
    }).catch((e) => {
      const message = e instanceof Error ? e.message : 'Ошибка загрузки доступа';
      if (!message.includes('PASSWORD_CHANGE_REQUIRED')) setError(message);
    });
  }, [open, mustChangePassword, user]);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setError('Пароли не совпадают.'); return; }
    setBusy(true);
    try {
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }) });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMustChangePassword(false);
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка смены пароля'); }
    finally { setBusy(false); }
  };

  if (!user) return null;

  if (mustChangePassword) return <div className="access-overlay access-overlay-force"><section className="access-dialog access-password-dialog"><span className="access-kicker">SECURITY</span><h2>Смените временный пароль</h2><p>До смены пароля доступ к данным организации заблокирован на сервере.</p>{error && <div className="vps-error">{error}</div>}<form className="access-password-form" onSubmit={changePassword}><label>Текущий пароль<input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((v) => ({ ...v, currentPassword: e.target.value }))} required /></label><label>Новый пароль<input type="password" minLength={16} value={passwordForm.newPassword} onChange={(e) => setPasswordForm((v) => ({ ...v, newPassword: e.target.value }))} required /></label><label>Подтверждение<input type="password" minLength={16} value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((v) => ({ ...v, confirmPassword: e.target.value }))} required /></label><button className="vps-primary" disabled={busy}>Сменить пароль</button></form></section></div>;

  if (!canManage || !open) return null;

  return <div className="access-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}><section className="access-dialog"><header className="access-dialog-head"><div><span className="access-kicker">CONTROL CENTER</span><h2>Пользователи и доступ</h2></div><button onClick={() => setOpen(false)}>Закрыть</button></header>{error && <div className="vps-error">{error}</div>}<UserAccessManagement user={user} organizations={organizations} products={products} modules={modules} /></section></div>;
}
