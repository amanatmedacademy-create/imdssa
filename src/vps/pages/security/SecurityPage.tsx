import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { KeyRound, Laptop2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import type { User } from '../../controlCenter';
import { api, EmptyState } from '../../controlCenter';
import './securityPage.css';

type Session = {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  source_ip: string | null;
  user_agent: string | null;
  is_current: boolean;
};

type Props = { user: User };

function describeAgent(value: string | null): string {
  if (!value) return 'Неизвестное устройство';
  const browser = value.includes('Chrome/') ? 'Chrome' : value.includes('Firefox/') ? 'Firefox' : value.includes('Safari/') && !value.includes('Chrome/') ? 'Safari' : 'Браузер';
  const os = value.includes('Windows') ? 'Windows' : value.includes('Mac OS') ? 'macOS' : value.includes('Android') ? 'Android' : value.includes('iPhone') || value.includes('iPad') ? 'iOS' : value.includes('Linux') ? 'Linux' : '';
  return `${browser}${os ? ` · ${os}` : ''}`;
}

const date = (value: string) => new Date(value).toLocaleString('ru-RU');

export function SecurityPage({ user }: Props) {
  const [items, setItems] = useState<Session[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const load = async () => {
    setLoading(true);
    try {
      const result = await api<{ items: Session[] }>('/api/auth/sessions');
      setItems(result.items);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка загрузки сессий');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const otherSessions = useMemo(() => items.filter((item) => !item.is_current), [items]);
  const current = items.find((item) => item.is_current) || null;

  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try { await api(`/api/auth/sessions/${id}`, { method: 'DELETE' }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка завершения сессии'); }
    finally { setBusy(false); }
  };

  const revokeOthers = async () => {
    setBusy(true); setError('');
    try { await api('/api/auth/sessions/revoke-others', { method: 'POST' }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка завершения сессий'); }
    finally { setBusy(false); }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setMessage('');
    if (form.newPassword !== form.confirmPassword) { setError('Новый пароль и подтверждение не совпадают.'); return; }
    setBusy(true);
    try {
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage('Пароль изменён. Остальные сессии отозваны.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка смены пароля'); }
    finally { setBusy(false); }
  };

  return <section className="security-page">
    <div className="security-kpis">
      <article><ShieldCheck size={18}/><div><span>Аккаунт</span><strong>{user.role}</strong><small>{user.email}</small></div></article>
      <article><Laptop2 size={18}/><div><span>Активные сессии</span><strong>{items.length}</strong><small>{otherSessions.length} других устройств</small></div></article>
      <article><KeyRound size={18}/><div><span>Текущая сессия</span><strong>{current ? describeAgent(current.user_agent) : '—'}</strong><small>{current?.source_ip || 'IP не определён'}</small></div></article>
    </div>

    {error && <div className="vps-error">API: {error}</div>}
    {message && <div className="security-success">{message}</div>}

    <div className="security-grid">
      <section className="security-card">
        <div className="security-card-head"><div><span>SESSIONS</span><h2>Активные устройства</h2></div><button type="button" disabled={busy || loading} onClick={() => void load()}><RefreshCw size={14}/>Обновить</button></div>
        <p>Отозванная сессия сразу теряет доступ к Control Center и tenant API.</p>
        {otherSessions.length > 0 && <button type="button" className="security-danger" disabled={busy} onClick={() => void revokeOthers()}><LogOut size={14}/>Завершить все остальные</button>}
        {loading ? <div className="security-loading">Загрузка сессий…</div> : !items.length ? <EmptyState title="Активных сессий нет" text="После входа сессия появится здесь."/> : <div className="security-session-list">{items.map((session) => <article key={session.id}>
          <div><strong>{describeAgent(session.user_agent)}</strong><span>{session.is_current ? 'Текущая сессия' : 'Другая сессия'}</span></div>
          <div><span>IP</span><strong>{session.source_ip || '—'}</strong></div>
          <div><span>Последняя активность</span><strong>{date(session.last_seen_at)}</strong></div>
          <div><span>Истекает</span><strong>{date(session.expires_at)}</strong></div>
          <div>{session.is_current ? <span className="security-current">Текущая</span> : <button type="button" disabled={busy} onClick={() => void revoke(session.id)}>Завершить</button>}</div>
        </article>)}</div>}
      </section>

      <section className="security-card">
        <div className="security-card-head"><div><span>PASSWORD</span><h2>Смена пароля</h2></div><KeyRound size={18}/></div>
        <p>После смены пароля все остальные активные сессии автоматически завершаются.</p>
        <form className="security-password-form" onSubmit={changePassword}>
          <label>Текущий пароль<input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm((value) => ({ ...value, currentPassword: event.target.value }))} required/></label>
          <label>Новый пароль<input type="password" autoComplete="new-password" minLength={16} value={form.newPassword} onChange={(event) => setForm((value) => ({ ...value, newPassword: event.target.value }))} required/></label>
          <label>Подтверждение<input type="password" autoComplete="new-password" minLength={16} value={form.confirmPassword} onChange={(event) => setForm((value) => ({ ...value, confirmPassword: event.target.value }))} required/></label>
          <button type="submit" disabled={busy}>Изменить пароль</button>
        </form>
      </section>
    </div>
  </section>;
}
