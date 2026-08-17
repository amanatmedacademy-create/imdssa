import { Bell, Check, Phone, TimerReset, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type RegistrationNotification = {
  id: string;
  company_name: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  trial_status: string;
  trial_started_at: string;
  trial_ends_at: string;
  telegram_status: 'pending' | 'sent' | 'failed' | 'disabled';
  read_at: string | null;
  created_at: string;
};

type NotificationResponse = { items: RegistrationNotification[]; unread: number };

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RegistrationNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/notifications?limit=20', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as NotificationResponse;
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setUnread(Number(payload.unread || 0));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    const events = new EventSource('/events', { withCredentials: true });
    events.addEventListener('update', () => void load());
    const onFocus = () => void load();
    const onOutside = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('mousedown', onOutside);
    return () => {
      window.clearInterval(timer);
      events.close();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [load]);

  async function markRead(item: RegistrationNotification) {
    if (item.read_at) return;
    const response = await fetch(`/api/v1/notifications/${encodeURIComponent(item.id)}/read`, { method: 'PATCH', credentials: 'include' });
    if (response.ok) await load();
  }

  return <div className="notification-bell" ref={root}>
    <button className="icon-button notification-trigger" aria-label="Уведомления" onClick={() => { setOpen((value) => !value); void load(); }}>
      <Bell size={18}/>{unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <div className="notification-popover">
      <div className="notification-header"><div><strong>Уведомления</strong><span>{unread ? `${unread} новых` : 'Новых нет'}</span></div></div>
      {error && <div className="notification-empty">Не удалось загрузить: {error}</div>}
      {!error && items.length === 0 && <div className="notification-empty">Новых регистраций пока нет.</div>}
      <div className="notification-list">{items.map((item) => <button key={item.id} className={`notification-item ${item.read_at ? '' : 'unread'}`} onClick={() => void markRead(item)}>
        <div className="notification-item-top"><strong>Новая регистрация · Trial</strong><span>{formatDate(item.created_at)}</span></div>
        <b>{item.company_name}</b>
        <span><UserRound size={14}/>{item.owner_name} · {item.owner_email}</span>
        <span><Phone size={14}/>{item.owner_phone}</span>
        <span><TimerReset size={14}/>Trial до {formatDate(item.trial_ends_at)}</span>
        <small>{item.telegram_status === 'sent' ? 'Telegram отправлен' : item.telegram_status === 'failed' ? 'Ошибка Telegram' : item.telegram_status === 'disabled' ? 'Telegram не настроен' : 'Telegram ожидает отправки'}</small>
        {!item.read_at && <i><Check size={13}/> отметить прочитанным</i>}
      </button>)}</div>
    </div>}
  </div>;
}
