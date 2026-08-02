import { AlertCircle, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useAuth } from './auth';

export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, isDemo, session, profile, error, signIn, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <main className="auth-screen">
        <section className="auth-card loading-card">
          <LoaderCircle className="spin" size={34} />
          <h1>Проверка доступа</h1>
          <p>Загружается защищённый профиль IMDS Super Admin.</p>
        </section>
      </main>
    );
  }

  if (isDemo || profile) return <>{children}</>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch {
      // The auth context exposes a normalized error message.
    } finally {
      setSubmitting(false);
    }
  };

  if (session && !profile) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-symbol danger"><AlertCircle size={28} /></div>
          <span className="eyebrow">Доступ закрыт</span>
          <h1>Нет роли Super Admin</h1>
          <p>{error ?? 'Аккаунт прошёл авторизацию, но не имеет активной глобальной роли платформы.'}</p>
          <button className="secondary-button" type="button" onClick={() => void signOut()}>Выйти из аккаунта</button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">I</div>
          <div><strong>IMDS</strong><span>Super Admin</span></div>
        </div>
        <div className="auth-symbol"><ShieldCheck size={30} /></div>
        <span className="eyebrow">Защищённый контур</span>
        <h1>Вход в платформу</h1>
        <p>Используйте аккаунт сотрудника IMDS с назначенной глобальной ролью.</p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@imdstech.net" />
          </label>
          <label>
            <span>Пароль</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" />
          </label>
          {error && <div className="auth-error"><AlertCircle size={16} /><span>{error}</span></div>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />}
            {submitting ? 'Вход...' : 'Войти'}
          </button>
        </form>
        <small>Для production требуется MFA и активный профиль в platform_users.</small>
      </section>
    </main>
  );
}
