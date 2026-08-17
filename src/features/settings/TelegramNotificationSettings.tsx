import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Send, ShieldCheck } from 'lucide-react';
import './telegramNotificationSettings.css';

type SettingsPayload = {
  configured: boolean;
  tokenStored: boolean;
  chatId: string;
  registrationEnabled: boolean;
  trialExpiringEnabled: boolean;
  paymentReceivedEnabled: boolean;
  paymentOverdueEnabled: boolean;
  subscriptionExpiredEnabled: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
};

const initial: SettingsPayload = {
  configured: false,
  tokenStored: false,
  chatId: '',
  registrationEnabled: true,
  trialExpiringEnabled: true,
  paymentReceivedEnabled: true,
  paymentOverdueEnabled: true,
  subscriptionExpiredEnabled: true,
  lastTestedAt: null,
  lastTestStatus: null,
  lastTestError: null,
};

export function TelegramNotificationSettings() {
  const [settings, setSettings] = useState<SettingsPayload>(initial);
  const [botToken, setBotToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/settings/notifications/telegram', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setSettings(await response.json() as SettingsPayload);
  }, []);

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/v1/settings/notifications/telegram', {
        method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          botToken, chatId: settings.chatId,
          registrationEnabled: settings.registrationEnabled,
          trialExpiringEnabled: settings.trialExpiringEnabled,
          paymentReceivedEnabled: settings.paymentReceivedEnabled,
          paymentOverdueEnabled: settings.paymentOverdueEnabled,
          subscriptionExpiredEnabled: settings.subscriptionExpiredEnabled,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setBotToken(''); await load(); setMessage('Настройки сохранены.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : String(saveError)); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/v1/settings/notifications/telegram/test', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error(await response.text());
      await load(); setMessage('Тестовое сообщение отправлено в Telegram.');
    } catch (testError) { setError(testError instanceof Error ? testError.message : String(testError)); }
    finally { setBusy(false); }
  }

  const toggle = (key: keyof Pick<SettingsPayload,'registrationEnabled'|'trialExpiringEnabled'|'paymentReceivedEnabled'|'paymentOverdueEnabled'|'subscriptionExpiredEnabled'>, label: string) =>
    <label className="telegram-toggle"><input type="checkbox" checked={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}/><span><b>{label}</b></span></label>;

  return <section className="telegram-settings">
    <div className="telegram-status-card">
      <div><span className={`telegram-dot ${settings.configured ? 'online' : ''}`}/><div><strong>{settings.configured ? 'Telegram подключён' : 'Telegram не настроен'}</strong><small>Bot Token хранится только в зашифрованном виде на сервере.</small></div></div>
      {settings.configured && <CheckCircle2 size={20}/>} 
    </div>

    <form onSubmit={save} className="telegram-form">
      <div className="telegram-grid">
        <label>Bot Token<input type="password" autoComplete="off" placeholder={settings.tokenStored ? '••••••••••••••••  (уже сохранён)' : '123456:ABC...'} value={botToken} onChange={(e) => setBotToken(e.target.value)}/><small>Оставьте пустым, чтобы сохранить текущий токен.</small></label>
        <label>Chat ID<input placeholder="-1001234567890" value={settings.chatId || ''} onChange={(e) => setSettings({ ...settings, chatId: e.target.value })}/><small>Группа, канал или личный чат, куда будут уходить уведомления.</small></label>
      </div>

      <div className="telegram-events"><div className="telegram-section-title"><ShieldCheck size={17}/><div><strong>События</strong><small>Выберите, какие события Control Center отправляет в Telegram.</small></div></div>
        {toggle('registrationEnabled','Новая регистрация + Trial')}
        {toggle('trialExpiringEnabled','Trial скоро закончится')}
        {toggle('paymentReceivedEnabled','Оплата получена')}
        {toggle('paymentOverdueEnabled','Оплата просрочена')}
        {toggle('subscriptionExpiredEnabled','Подписка закончилась')}
      </div>

      {error && <div className="telegram-error">{error}</div>}
      {message && <div className="telegram-success">{message}</div>}
      {settings.lastTestStatus && <div className="telegram-last-test">Последний тест: <b>{settings.lastTestStatus === 'success' ? 'успешно' : 'ошибка'}</b>{settings.lastTestError ? ` · ${settings.lastTestError}` : ''}</div>}

      <div className="telegram-actions"><button type="submit" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить настройки'}</button><button type="button" className="secondary" disabled={busy || !settings.configured} onClick={() => void test()}><Send size={15}/>Отправить тест</button></div>
    </form>
  </section>;
}
