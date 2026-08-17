import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import './vps.css';

type User = { id: string; email: string; fullName: string; role: string };
type Overview = { organizations: number; products: number; modules: number; installations: number; platform_users: number };
type Organization = { id: string; name: string; legal_name: string | null; bin: string | null; city: string | null; status: string };
type Product = { id: string; code: string; name: string; status: string; version: string | null; last_health: string; last_heartbeat_at: string | null; tenants: number };
type Module = { id: string; code: string; name: string; status: string; current_version: string | null; owner_product_name: string | null };
type Installation = { id: string; organization_name: string; module_name: string; host_product_name: string; status: string; health: string; updated_at: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers || {}) }, ...init });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function Login({ onReady }: { onReady: (user: User) => void }) {
  const [email, setEmail] = useState('admin@imdstech.net');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    try { const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); onReady(result.user); }
    catch { setError('Неверный email или пароль.'); }
  };
  return <main className="vps-login"><form className="vps-login-card" onSubmit={submit}><div className="vps-brand">IMDS <span>Super Admin</span></div><h1>Вход в control plane</h1><p>Локальный VPS · PostgreSQL · realtime</p><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" required /></label><label>Пароль<input value={password} onChange={e=>setPassword(e.target.value)} type="password" required /></label>{error&&<div className="vps-error">{error}</div>}<button type="submit">Войти</button></form></main>;
}

function Status({ value }: { value: string }) { return <span className={`vps-status ${value}`}>{value.toUpperCase()}</span>; }

export function VpsApp() {
  const [user, setUser] = useState<User|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<Overview|null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [tab, setTab] = useState('overview');

  const refresh = useCallback(async () => {
    try {
      const [o, org, prod, mod, inst] = await Promise.all([
        api<Overview>('/api/v1/overview'), api<{items:Organization[]}>('/api/v1/organizations'), api<{items:Product[]}>('/api/v1/products'), api<{items:Module[]}>('/api/v1/modules'), api<{items:Installation[]}>('/api/v1/installations')
      ]);
      setOverview(o); setOrganizations(org.items); setProducts(prod.items); setModules(mod.items); setInstallations(inst.items); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка API'); }
  }, []);

  useEffect(() => { api<{user:User}>('/api/auth/me').then(x=>setUser(x.user)).catch(()=>setUser(null)).finally(()=>setLoading(false)); }, []);
  useEffect(() => { if (!user) return; void refresh(); const es = new EventSource('/events'); es.addEventListener('update', e => { try { setEvents(v=>[JSON.parse((e as MessageEvent).data),...v].slice(0,50)); } catch {} void refresh(); }); return ()=>es.close(); }, [user, refresh]);

  const health = useMemo(() => products.filter(p=>p.last_health==='healthy').length, [products]);
  if (loading) return <div className="vps-loading">Проверка доступа…</div>;
  if (!user) return <Login onReady={setUser}/>;

  const logout = async () => { await api('/api/auth/logout',{method:'POST'}); setUser(null); };
  return <div className="vps-shell"><aside><div className="vps-brand">IMDS <span>Super Admin</span></div><nav>{['overview','organizations','products','modules','installations','realtime'].map(x=><button key={x} className={tab===x?'active':''} onClick={()=>setTab(x)}>{x}</button>)}</nav><div className="vps-user"><strong>{user.fullName}</strong><span>{user.role}</span><button onClick={()=>void logout()}>Выйти</button></div></aside><main><header><div><span>VPS CONTROL PLANE</span><h1>{tab}</h1></div><div className="vps-live">● REALTIME</div></header>{error&&<div className="vps-error">{error}</div>}
  {tab==='overview'&&<><section className="vps-metrics"><article><span>Организации</span><strong>{overview?.organizations ?? '—'}</strong></article><article><span>Продукты</span><strong>{overview?.products ?? '—'}</strong></article><article><span>Модули</span><strong>{overview?.modules ?? '—'}</strong></article><article><span>Installations</span><strong>{overview?.installations ?? '—'}</strong></article><article><span>Healthy products</span><strong>{health}/{products.length}</strong></article></section><section className="vps-panel"><h2>Состояние продуктов</h2>{products.length===0?<p>NO DATA — продукты ещё не зарегистрированы.</p>:<table><tbody>{products.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small>{p.code}</small></td><td>v{p.version||'—'}</td><td>{p.tenants} tenants</td><td><Status value={p.last_health||'unknown'}/></td></tr>)}</tbody></table>}</section></>}
  {tab==='organizations'&&<section className="vps-panel"><h2>Организации</h2>{organizations.length===0?<p>NO DATA</p>:<table><tbody>{organizations.map(x=><tr key={x.id}><td><strong>{x.name}</strong><small>{x.bin||'BIN —'}</small></td><td>{x.city||'—'}</td><td><Status value={x.status}/></td></tr>)}</tbody></table>}</section>}
  {tab==='products'&&<section className="vps-panel"><h2>Продукты</h2>{products.length===0?<p>NO DATA</p>:<table><tbody>{products.map(x=><tr key={x.id}><td><strong>{x.name}</strong><small>{x.code}</small></td><td>{x.version||'—'}</td><td><Status value={x.status}/></td><td><Status value={x.last_health}/></td></tr>)}</tbody></table>}</section>}
  {tab==='modules'&&<section className="vps-panel"><h2>Модули</h2>{modules.length===0?<p>NOT INSTALLED / NO DATA</p>:<table><tbody>{modules.map(x=><tr key={x.id}><td><strong>{x.name}</strong><small>{x.code}</small></td><td>{x.owner_product_name||'—'}</td><td>{x.current_version||'—'}</td><td><Status value={x.status}/></td></tr>)}</tbody></table>}</section>}
  {tab==='installations'&&<section className="vps-panel"><h2>Installations</h2>{installations.length===0?<p>NOT INSTALLED</p>:<table><tbody>{installations.map(x=><tr key={x.id}><td><strong>{x.organization_name}</strong><small>{x.module_name}</small></td><td>{x.host_product_name}</td><td><Status value={x.status}/></td><td><Status value={x.health}/></td></tr>)}</tbody></table>}</section>}
  {tab==='realtime'&&<section className="vps-panel"><h2>Realtime events</h2>{events.length===0?<p>Ожидание реальных событий…</p>:<pre className="vps-events">{events.map((e,i)=>`${i+1}. ${JSON.stringify(e)}\n`).join('')}</pre>}</section>}
  </main></div>;
}
