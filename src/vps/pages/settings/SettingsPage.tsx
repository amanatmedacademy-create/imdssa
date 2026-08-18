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
  { key: 'registrationEnabled', title: 'Новая регистрация', text: 'Сообщить, когда новый клиент зарегистрировался и получил пробный доступ.' },
  { key: 'trialExpiringEnabled', title: 'Пробный доступ заканчивается', text: 'Напомнить заранее, что пробный период скоро закончится.' },
  { key: 'paymentReceivedEnabled', title: 'Оплата получена', text: 'Сообщить после подтверждения платежа.' },
  { key: 'paymentOverdueEnabled', title: 'Оплата просрочена', text: 'Сообщить, если счёт не оплачен в срок.' },
  { key: 'subscriptionExpiredEnabled', title: 'Подписка закончилась', text: 'Сообщить, когда коммерческий доступ завершён.' },
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
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить настройки');
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
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить настройки');
    } finally { setBusy(false); }
  };

  const test = async () => {
    if (!canManage) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/api/v1/settings/notifications/telegram/test', { method: 'POST', body: '{}' });
      await load();
      setMessage('Тестовое сообщение отправлено в Telegram.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отправить тестовое сообщение');
    } finally { setBusy(false); }
  };

  const toggle = (key: EventKey) => setSettings((current) => ({ ...current, [key]: !current[key] }));
  const enabledEvents = events.filter((item) => settings[item.key]).length;

  return <section className="settings-page">
    <div className="settings-kpis">
      <article><MessageCircle size={18}/><div><span>Telegram</span><strong>{settings.configured ? 'Подключён' : 'Не настроен'}</strong><small>{settings.tokenStored ? 'бот подключён' : 'нужно добавить токен на сервере'}</small></div></article>
      <article><BellRing size={18}/><div><span>Уведомления</span><strong>{enabledEvents} / {events.length}</strong><small>типов включено</small></div></article>
      <article><CircleDollarSign size={18}/><div><span>Валюта</span><strong>KZT</strong><small>для тарифов и платежей</small></div></article>
      <article><Database size={18}/><div><span>Основная база</span><strong>Control Center</strong><small>данные хранятся на VPS</small></div></article>
    </div>

    <div className="settings-layout">
      <div className="settings-main">
        <section className="settings-card">
          <div className="settings-card-head"><div><span>УВЕДОМЛЕНИЯ</span><h2>Telegram</h2><p>Выберите чат и события, о которых Control Center должен сообщать.</p></div><div className={`settings-connection ${settings.configured ? 'online' : 'offline'}`}>{settings.configured ? <CheckCircle2 size={16}/> : <ShieldCheck size={16}/>} {settings.configured ? 'Подключено' : 'Нужна настройка'}</div></div>

          <div className="settings-credential-note"><ServerCog size={18}/><div><strong>Токен бота хранится отдельно.</strong><p>Из соображений безопасности секретный токен Telegram на этой странице не показывается. Здесь настраивается только чат и список уведомлений.</p></div><a href="/infrastructure">Настроить на сервере</a></div>

          <label className="settings-field">ID чата Telegram<input value={settings.chatId || ''} onChange={(event) => setSettings((current) => ({ ...current, chatId: event.target.value }))} disabled={!canManage || loading || busy} placeholder="Например: -1001234567890"/><small>Можно использовать группу, канал или личный чат.</small></label>

          <div className="settings-event-list">{events.map((item) => <button key={item.key} type="button" className={settings[item.key] ? 'enabled' : ''} disabled={!canManage || busy} onClick={() => toggle(item.key)}>
            <span className="settings-switch"><i/></span><span><strong>{item.title}</strong><small>{item.text}</small></span>
          </button>)}</div>

          {error && <div className="vps-error">{error}</div>}
          {message && <div className="settings-success">{message}</div>}
          <div className="settings-actions"><button type="button" className="primary" disabled={!canManage || busy || loading} onClick={() => void save()}>{busy ? 'Сохранение…' : 'Сохранить настройки'}</button><button type="button" disabled={!canManage || busy || !settings.configured} onClick={() => void test()}><Send size={15}/>Отправить тест</button></div>
          <div className="settings-last-test"><span>Последняя проверка</span><strong>{settings.lastTestStatus || 'Ещё не запускалась'}</strong><small>{date(settings.lastTestedAt)}{settings.lastTestError ? ` · ${settings.lastTestError}` : ''}</small></div>
        </section>
      </div>

      <aside className="settings-side">
        <section className="settings-card compact"><div className="settings-card-head simple"><div><span>ТАРИФЫ И МОДУЛИ</span><h3>Настройки продуктов</h3></div></div><p>Цены, пробный период, тарифы, модули и лимиты настраиваются отдельно для каждого продукта.</p><button type="button" onClick={() => onNavigate('products')}><Boxes size={15}/>Перейти к продуктам</button></section>
        <section className="settings-card compact"><div className="settings-card-head simple"><div><span>ОПЛАТА</span><h3>Финансы</h3></div></div><p>Счета, платежи, возвраты и задолженность находятся в отдельном разделе «Биллинг».</p><button type="button" onClick={() => onNavigate('billing')}><CircleDollarSign size={15}/>Перейти в биллинг</button></section>
        <section className="settings-card compact policy"><div className="settings-card-head simple"><div><span>ГДЕ ЧТО НАСТРАИВАТЬ</span><h3>Структура управления</h3></div></div><ul><li>Уведомления — в этом разделе.</li><li>Тарифы и модули — в «Продукты».</li><li>Серверные секреты — в «Инфраструктура».</li><li>Роли сотрудников — в «Пользователи».</li><li>Сессии и пароль — в «Безопасность».</li></ul></section>
      </aside>
    </div>
  </section>;
}
