import { type FormEvent, useEffect, useState } from 'react';
import type { User } from '../controlCenter';
import { api } from '../controlCenter';
import '../vps.css';
import { ControlCenterV2 } from './ControlCenterV2';

function ProductionLogin({ onReady }: { onReady: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onReady();
    } catch (reason) {
      setError(reason instanceof Error ? `Ошибка входа: ${reason.message}` : 'Ошибка входа.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="vps-login">
    <form className="vps-login-card" onSubmit={submit}>
      <div className="vps-brand"><b>IMDS</b><span>Control Center</span></div>
      <div className="vps-login-copy"><span>CONTROL PLANE</span><h1>Вход в платформу</h1><p>VPS · PostgreSQL · realtime</p></div>
      <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label>
      <label>Пароль<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
      {error && <div className="vps-error">{error}</div>}
      <button className="vps-primary" type="submit" disabled={busy}>{busy ? 'Вход…' : 'Войти'}</button>
    </form>
  </main>;
}

export function RootApp() {
  const [state, setState] = useState<'checking' | 'authenticated' | 'guest'>('checking');

  useEffect(() => {
    let cancelled = false;
    api<{ user: User }>('/api/auth/me')
      .then(() => { if (!cancelled) setState('authenticated'); })
      .catch(() => { if (!cancelled) setState('guest'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'checking') return <main className="ccv2-state">Проверка доступа…</main>;
  if (state === 'guest') return <ProductionLogin onReady={() => setState('authenticated')} />;
  return <ControlCenterV2 />;
}
