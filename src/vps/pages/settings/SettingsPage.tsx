import { useCallback, useEffect, useState } from 'react';
import { BellRing, Boxes, CheckCircle2, CircleDollarSign, Database, MessageCircle, Send, ServerCog, ShieldCheck } from 'lucide-react';
import type { ControlCenterTab } from '../../controlCenter';
import { api } from '../../controlCenter';
import './settingsPage.css';

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
  updatedAt?: string | null;
};

type EventKey = 'registrationEnabled' | 'trialExpiringEnabled' | 'paymentReceivedEnabled' | 'paymentOverdueEnabled' | 'subscriptionExpiredEnabled';
type Props = { canManage: boolean; onNavigate: (tab: ControlCenterTab) => void };

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

const events: Array<{ key: EventKey; title: string; text: string }> = [
  { key: 'registrationEnabled', title: 'Новая регистрация + Trial', text: 'Первичный onboarding организации из продукта.' },
  { key: 'trialExpiringEnabled', title: 'Trial скоро закончится', text: 'Коммерческое напоминание до окончания доступа.' },
  { key: 'paymentReceivedEnabled', title: 'Оплата получена', text: 'Подтвержденный платёж в центральном биллинге.' },
  { key: 'paymentOverdueEnabled', title: 'Оплата просрочена', text: 'Счёт перешёл в overdue и требует внимания.' },
  { key: 'subscriptionExpiredEnabled', title: 'Подписка закончилась', text: 'Коммерческий доступ завершён согласно Control Center.' },
];

const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('ru-RU') : '—';

export function SettingsPage({ canManage, onNavigate }: Props) {
  const [settings, setSettings] = useState<SettingsPayload>(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await api<SettingsPayload>('/api/v1/settings/notifications/telegram'));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка загрузки настроек');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!canManage) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/api/v1/settings/notifications/telegram', {
        method: 'PUT',
        body: JSON.stringify({
          botToken: '',
          chatId: settings.chatId,
          registrationEnabled: settings.registrationEnabled,
          trialExpiringEnabled: settings.trialExpiringEnabled,
          paymentReceivedEnabled: settings.paymentReceivedEnabled,
          paymentOverdueEnabled: settings.paymentOverdueEnabled,
          subscriptionExpiredEnabled: settings.subscriptionExpiredEnabled,
        }),
      });
      await load();
      setMessage('Настройки уведомлений сохранены.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка сохранения настроек');
    } finally { setBusy(false); }
  };

  const test = async () => {
    if (!canManage) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/api/v1/settings/notifications/telegram/test', { method: 'POST', body: '{}' });
      await load();
      setMessage('Тестовое сообщение отправлено.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ошибка теста Telegram');
    } finally { setBusy(false); }
  };

  const toggle = (key: EventKey) => setSettings((current) => ({ ...current, [key]: !current[key] }));

  return <section className="settings-page">
    <div className="settings-kpis">
      <article><MessageCircle size={18}/><div><span>Telegram</span><strong>{settings.configured ? 'Подключён' : 'Не настроен'}</strong><small>{settings.tokenStored ? 'credential сохранён' : 'credential отсутствует'}</small></div></article>
      <article><BellRing size={18}/><div><span>Routing</span><strong>{events.filter((item) => settings[item.key]).length} / {events.length}</strong><small>активных типов событий</small></div></article>
      <article><CircleDollarSign size={18}/><div><span>Валюта платформы</span><strong>KZT</strong><small>коммерческий контур</small></div></article>
      <article><Database size={18}/><div><span>Source of truth</span><strong>Control Center</strong><small>PostgreSQL на VPS</small></div></article>
    </div>

    <div className="settings-layout">
      <div className="settings-main">
        <section className="settings-card">
          <div className="settings-card-head"><div><span>NOTIFICATIONS</span><h2>Telegram routing</h2><p>Настройка получателя и типов бизнес-событий. Bot Token здесь не отображается и не редактируется.</p></div><div className={`settings-connection ${settings.configured ? 'online' : 'offline'}`}>{settings.configured ? <CheckCircle2 size={16}/> : <ShieldCheck size={16}/>} {settings.configured ? 'Configured' : 'Credential required'}</div></div>

          <div className="settings-credential-note"><ServerCog size={18}/><div><strong>Credential отделён от бизнес-настроек.</strong><p>Telegram Bot Token относится к серверным secrets. Его хранение и ротация выполняются в инфраструктурном контуре; Control Center сохраняет только routing и policy событий.</p></div><a href="/infrastructure">Инфраструктура</a></div>

          <label className="settings-field">Telegram Chat ID<input value={settings.chatId || ''} onChange={(event) => setSettings((current) => ({ ...current, chatId: event.target.value }))} disabled={!canManage || loading || busy} placeholder="-1001234567890"/><small>Группа, канал или личный чат для уведомлений.</small></label>

          <div className="settings-event-list">{events.map((item) => <button key={item.key} type="button" className={settings[item.key] ? 'enabled' : ''} disabled={!canManage || busy} onClick={() => toggle(item.key)}>
            <span className="settings-switch"><i/></span><span><strong>{item.title}</strong><small>{item.text}</small></span>
          </button>)}</div>

          {error && <div className="vps-error">API: {error}</div>}
          {message && <div className="settings-success">{message}</div>}
          <div className="settings-actions"><button type="button" className="primary" disabled={!canManage || busy || loading} onClick={() => void save()}>{busy ? 'Сохранение…' : 'Сохранить routing'}</button><button type="button" disabled={!canManage || busy || !settings.configured} onClick={() => void test()}><Send size={15}/>Отправить тест</button></div>
          <div className="settings-last-test"><span>Последний тест</span><strong>{settings.lastTestStatus || 'Не выполнялся'}</strong><small>{date(settings.lastTestedAt)}{settings.lastTestError ? ` · ${settings.lastTestError}` : ''}</small></div>
        </section>
      </div>

      <aside className="settings-side">
        <section className="settings-card compact"><div className="settings-card-head simple"><div><span>COMMERCIAL OWNERSHIP</span><h3>Коммерческие defaults</h3></div></div><p>Тарифы, Trial, модули, add-ons, лимиты и цены принадлежат конкретному продукту. Глобальная копия этих значений в Settings не создаётся.</p><button type="button" onClick={() => onNavigate('products')}><Boxes size={15}/>Открыть продукты</button></section>
        <section className="settings-card compact"><div className="settings-card-head simple"><div><span>BILLING OWNERSHIP</span><h3>Финансовые правила</h3></div></div><p>Счета, оплаты, возвраты и reconciliation остаются в центральном Billing. Settings не дублирует финансовое состояние.</p><button type="button" onClick={() => onNavigate('billing')}><CircleDollarSign size={15}/>Открыть биллинг</button></section>
        <section className="settings-card compact policy"><div className="settings-card-head simple"><div><span>PLATFORM POLICY</span><h3>Границы настроек</h3></div></div><ul><li>Бизнес-настройки — здесь.</li><li>Product commercial model — в «Продукты».</li><li>Secrets и runtime variables — в «Инфраструктура».</li><li>Доступ пользователей — в «Пользователи».</li><li>Сессии и пароль — в «Безопасность».</li></ul></section>
      </aside>
    </div>
  </section>;
}
