import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, Phone, RefreshCw, TimerReset } from 'lucide-react';
import './registrationCenter.css';

type RegistrationItem = {
  id: string;
  source_product_code: string;
  company_name: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  trial_status: string;
  trial_started_at: string;
  trial_ends_at: string;
  telegram_status: 'pending' | 'sent' | 'failed' | 'disabled';
  telegram_error: string | null;
  read_at: string | null;
  created_at: string;
};

type ResponsePayload = { items: RegistrationItem[]; unread: number };

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function remainingDays(value: string) {
  const diff = new Date(value).getTime() - Date.now();
  if (diff <= 0) return 'Завершён';
  const days = Math.ceil(diff / 86400000);
  return `${days} дн.`;
}

export function RegistrationCenter() {
  const [items, setItems] = useState<RegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/notifications?limit=100', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as ResponsePayload;
      setItems(payload.items || []);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const events = new EventSource('/events', { withCredentials: true });
    events.addEventListener('update', () => void load());
    return () => events.close();
  }, [load]);

  const activeTrials = useMemo(() => items.filter((item) => new Date(item.trial_ends_at).getTime() > Date.now()).length, [items]);
  const telegramSent = useMemo(() => items.filter((item) => item.telegram_status === 'sent').length, [items]);

  return <section className="registration-center">
    <div className="registration-summary">
      <article><span>Всего регистраций</span><strong>{items.length}</strong></article>
      <article><span>Активный Trial</span><strong>{activeTrials}</strong></article>
      <article><span>Telegram отправлен</span><strong>{telegramSent}</strong></article>
      <button onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? 'Обновление…' : 'Обновить'}</button>
    </div>

    {error && <div className="registration-error">Не удалось загрузить регистрации: {error}</div>}
    {!error && !loading && items.length === 0 && <div className="registration-empty">Новых регистраций пока нет.</div>}

    {items.length > 0 && <div className="registration-table-wrap"><table className="registration-table">
      <thead><tr><th>Организация</th><th>Владелец</th><th>Контакты</th><th>Продукт</th><th>Trial</th><th>Telegram</th><th>Регистрация</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}>
        <td><strong>{item.company_name}</strong>{!item.read_at && <small className="registration-new">Новая</small>}</td>
        <td>{item.owner_name}</td>
        <td><span className="registration-contact"><Phone size={13}/>{item.owner_phone}</span><span className="registration-contact"><Mail size={13}/>{item.owner_email}</span></td>
        <td>{item.source_product_code}</td>
        <td><span className="registration-trial"><TimerReset size={13}/>{remainingDays(item.trial_ends_at)}</span><small>до {formatDate(item.trial_ends_at)}</small></td>
        <td><span className={`registration-telegram ${item.telegram_status}`}>{item.telegram_status === 'sent' ? 'Отправлен' : item.telegram_status === 'failed' ? 'Ошибка' : item.telegram_status === 'disabled' ? 'Не настроен' : 'Ожидает'}</span>{item.telegram_error && <small title={item.telegram_error}>Есть ошибка</small>}</td>
        <td>{formatDate(item.created_at)}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
