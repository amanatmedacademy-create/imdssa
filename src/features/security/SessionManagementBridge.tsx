import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './sessionManagement.css';

type Session = {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  source_ip: string | null;
  user_agent: string | null;
  is_current: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers || {}) }, ...init });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function describeAgent(value: string | null): string {
  if (!value) return 'Неизвестное устройство';
  const browser = value.includes('Chrome/') ? 'Chrome' : value.includes('Firefox/') ? 'Firefox' : value.includes('Safari/') && !value.includes('Chrome/') ? 'Safari' : 'Браузер';
  const os = value.includes('Windows') ? 'Windows' : value.includes('Mac OS') ? 'macOS' : value.includes('Android') ? 'Android' : value.includes('iPhone') || value.includes('iPad') ? 'iOS' : value.includes('Linux') ? 'Linux' : '';
  return `${browser}${os ? ` · ${os}` : ''}`;
}

export function SessionManagementBridge() {
  const [active, setActive] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [items, setItems] = useState<Session[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    const sync = () => {
      if (stopped) return;
      const content = document.querySelector<HTMLElement>('.vps-content');
      const title = content?.querySelector('header h1')?.textContent?.trim();
      const shouldActivate = title === 'Безопасность аккаунта';
      setActive(shouldActivate);
      if (!content) return;
      let node = content.querySelector<HTMLElement>('.session-management-bridge-host');
      if (!node) {
        node = document.createElement('div');
        node.className = 'session-management-bridge-host';
        content.appendChild(node);
      }
      setHost(node);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    document.addEventListener('click', sync, true);
    return () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener('click', sync, true);
      document.querySelector<HTMLElement>('.session-management-bridge-host')?.remove();
    };
  }, []);

  const load = async () => {
    try {
      const result = await api<{ items: Session[] }>('/api/auth/sessions');
      setItems(result.items); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки сессий'); }
  };

  useEffect(() => { if (active) void load(); }, [active]);

  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try { await api(`/api/auth/sessions/${id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка отзыва сессии'); }
    finally { setBusy(false); }
  };

  const revokeOthers = async () => {
    setBusy(true); setError('');
    try { await api('/api/auth/sessions/revoke-others', { method: 'POST' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка отзыва сессий'); }
    finally { setBusy(false); }
  };

  if (!active || !host) return null;

  return createPortal(<section className="vps-card session-management-card">
    <div className="vps-card-head"><div><span>СЕССИИ</span><h2>Активные устройства</h2></div><button className="vps-mini" disabled={busy || items.length <= 1} onClick={() => void revokeOthers()}>Завершить все остальные</button></div>
    <p className="vps-note">Отозванная сессия сразу теряет доступ к Control Center и tenant API.</p>
    {error && <div className="vps-error">{error}</div>}
    {!items.length ? <div className="vps-empty"><div className="vps-empty-mark">—</div><div><strong>Активных сессий нет</strong><p>После следующего входа сессия появится здесь.</p></div></div> : <div className="vps-table-wrap"><table><thead><tr><th>Устройство</th><th>IP</th><th>Последняя активность</th><th>Истекает</th><th></th></tr></thead><tbody>{items.map((session) => <tr key={session.id}><td><strong>{describeAgent(session.user_agent)}</strong><small>{session.is_current ? 'Текущая сессия' : 'Другая сессия'}</small></td><td>{session.source_ip || '—'}</td><td>{new Date(session.last_seen_at).toLocaleString('ru-RU')}</td><td>{new Date(session.expires_at).toLocaleString('ru-RU')}</td><td>{session.is_current ? <span className="session-current">Текущая</span> : <button className="vps-mini" disabled={busy} onClick={() => void revoke(session.id)}>Завершить</button>}</td></tr>)}</tbody></table></div>}
  </section>, host);
}
