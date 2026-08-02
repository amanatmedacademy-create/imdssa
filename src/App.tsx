import {
  Activity, AlertTriangle, AppWindow, BadgeDollarSign, Bell, Boxes, Building2, ChevronRight,
  CircleDollarSign, CloudCog, DatabaseBackup, Gauge, Headphones, LayoutDashboard, LockKeyhole,
  LogOut, Network, PackageCheck, ReceiptText, Search, Settings, ShieldAlert, ShieldCheck, Users, Webhook,
} from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './core/auth';
import type { Permission } from './core/permissions';
import { roleLabels } from './core/permissions';
import { useBilling } from './features/billing/BillingContext';
import { SubscriptionsPage } from './features/billing/SubscriptionsPage';
import { BillingOperationsPage } from './features/billingOperations/BillingOperationsPage';
import { GovernancePage } from './features/governance/GovernancePage';
import { IdentityDirectoryPage } from './features/identity/IdentityDirectoryPage';
import { IntegrationCenterPage } from './features/integrations/IntegrationCenterPage';
import { ObservabilityPage } from './features/observability/ObservabilityPage';
import { CompaniesPage } from './features/organizations/CompaniesPage';
import { OperationsPage } from './features/operations/OperationsPage';
import { useProductCatalog } from './features/products/ProductCatalogContext';
import { ProductsPage } from './features/products/ProductsPage';
import type { ManagedProduct } from './features/products/productRepository';
import { SecurityCenterPage } from './features/security/SecurityCenterPage';
import { useSecurity } from './features/security/SecurityContext';
import { SupportPage } from './features/support/SupportPage';
import { env } from './lib/env';

type NavigationItem={to:string;label:string;icon:React.ElementType;permission:Permission};
const nav:NavigationItem[]=[
 {to:'/',label:'Обзор',icon:LayoutDashboard,permission:'dashboard.read'},
 {to:'/companies',label:'Компании',icon:Building2,permission:'organizations.read'},
 {to:'/products',label:'Продукты',icon:Boxes,permission:'products.read'},
 {to:'/subscriptions',label:'Подписки',icon:BadgeDollarSign,permission:'subscriptions.read'},
 {to:'/billing',label:'Биллинг',icon:ReceiptText,permission:'billing.operations.read'},
 {to:'/users',label:'Пользователи',icon:Users,permission:'users.read'},
 {to:'/integrations',label:'Интеграции',icon:Network,permission:'integrations.read'},
 {to:'/operations',label:'Операции',icon:Activity,permission:'operations.read'},
 {to:'/observability',label:'Мониторинг',icon:Gauge,permission:'observability.read'},
 {to:'/security',label:'Безопасность',icon:ShieldCheck,permission:'security.read'},
 {to:'/support',label:'Поддержка',icon:Headphones,permission:'support.read'},
 {to:'/governance',label:'Data Governance',icon:DatabaseBackup,permission:'governance.read'},
 {to:'/settings',label:'Настройки',icon:Settings,permission:'settings.read'},
];
const companies=[
 {name:'Amanat Medical Center',city:'Алматы',products:6,users:84,plan:'Enterprise',health:94},
 {name:'Orda Clinic',city:'Астана',products:4,users:31,plan:'Business',health:82},
 {name:'Sapa Med',city:'Шымкент',products:3,users:22,plan:'Business',health:68},
];
function initials(v:string){const p=v.trim().split(/\s+/);return (p.length>1?`${p[0][0]}${p[1][0]}`:v.slice(0,2)).toUpperCase()}
function Shell({children}:{children:React.ReactNode}){const{profile,role,can,isDemo,signOut}=useAuth();const name=profile?.full_name||profile?.email||'Super Admin';return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">I</div><div><strong>IMDS</strong><span>Super Admin</span></div></div><nav>{nav.filter(i=>can(i.permission)).map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/' } className={({isActive})=>isActive?'nav-item active':'nav-item'}><Icon size={18}/><span>{label}</span></NavLink>)}</nav><div className="sidebar-footer"><div className={`environment ${isDemo?'demo':''}`}><span/>{isDemo?'Demo mode':env.appEnv}</div><small>Control plane v{env.appVersion}</small></div></aside><main className="main"><header className="topbar"><div className="search"><Search size={17}/><input placeholder="Компания, БИН, пользователь, tenant ID..."/></div><div className="top-actions"><button className="icon-button"><Bell size={18}/></button><div className="profile"><div className="avatar">{initials(name)}</div><div><strong>{name}</strong><span>{role?roleLabels[role]:'Нет роли'}</span></div></div>{!isDemo&&<button className="icon-button" onClick={()=>void signOut()}><LogOut size={18}/></button>}</div></header><div className="page">{children}</div></main></div>}
function RequirePermission({permission,children}:{permission:Permission;children:React.ReactNode}){const{can}=useAuth();return can(permission)?<>{children}</>:<div className="access-denied"><ShieldAlert size={34}/><h1>Недостаточно прав</h1><NavLink className="primary-button" to="/">Вернуться</NavLink></div>}
function Metric({icon:Icon,label,value,note}:{icon:React.ElementType;label:string;value:string;note:string}){return <article className="metric-card"><div className="metric-icon"><Icon size={21}/></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>}
function StatusBadge({value}:{value:ManagedProduct['status']}){const label=value==='active'?'Работает':value==='degraded'?'Деградация':value==='maintenance'?'Техработы':value==='disabled'?'Отключён':'Настройка';return <span className={`status ${value==='active'?'ok':value==='degraded'?'warn':'muted'}`}>{label}</span>}
function formatKzt(v:number){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(v)}
function Dashboard(){const{can,isDemo}=useAuth();const{products,loading:pl,error:pe}=useProductCatalog();const{subscriptions,loading:bl,error:be}=useBilling();const{requests,sessions,error:se}=useSecurity();const active=products.filter(p=>!p.archivedAt);const licenses=subscriptions.reduce((s,x)=>s+x.licenses.filter(l=>l.status!=='revoked').length,0);const mrr=subscriptions.filter(x=>x.status==='active').reduce((s,x)=>s+(x.billingInterval==='annual'?x.effectivePrice/12:x.billingInterval==='monthly'?x.effectivePrice:0),0);return <><div className="page-heading"><div><span className="eyebrow">Платформа</span><h1>Центр управления IMDS</h1><p>Компании, продукты, лицензии, инфраструктура и поддержка.</p></div>{can('organizations.create')&&<NavLink className="primary-button" to="/companies"><Building2 size={17}/> Создать компанию</NavLink>}</div>{isDemo&&<div className="mode-banner"><ShieldCheck size={18}/><div><strong>Демо-режим</strong><span>Подключите Supabase для production-контроля.</span></div></div>}{(pe||be||se)&&<div className="error-banner"><AlertTriangle size={18}/><span>{pe??be??se}</span></div>}<section className="metrics"><Metric icon={Building2} label="Активные компании" value="68" note="+6 за 30 дней"/><Metric icon={Users} label="Пользователи" value="1 284" note="1 042 активны"/><Metric icon={PackageCheck} label="Активные лицензии" value={bl?'…':String(licenses)} note={pl?'загрузка...':`${active.length} продуктов`}/><Metric icon={CircleDollarSign} label="MRR" value={bl?'…':formatKzt(mrr)} note="без custom interval"/></section><section className="content-grid"><article className="panel span-2"><div className="panel-header"><div><h2>Состояние продуктов</h2><p>Версии, tenants и доступность</p></div><NavLink to="/products">Все продукты <ChevronRight size={16}/></NavLink></div><div className="product-grid">{active.slice(0,6).map(p=><div className="product-card" key={p.id}><div className="product-symbol"><AppWindow size={20}/></div><div className="product-info"><strong>{p.name}</strong><span>{p.tenants} компаний · v{p.version||'—'}</span></div><StatusBadge value={p.status}/></div>)}</div></article><article className="panel"><div className="panel-header"><div><h2>Требует внимания</h2></div></div><div className="alerts"><NavLink className="alert critical" to="/observability"><AlertTriangle size={18}/><div><strong>Инциденты</strong><span>Проверить сервисы</span></div></NavLink><NavLink className="alert" to="/security"><ShieldAlert size={18}/><div><strong>{requests.filter(r=>r.status==='pending').length} согласований</strong><span>{sessions.filter(s=>s.status==='active').length} активных сессий</span></div></NavLink><NavLink className="alert" to="/support"><Headphones size={18}/><div><strong>Support Queue</strong><span>Обращения и SLA</span></div></NavLink><NavLink className="alert" to="/governance"><DatabaseBackup size={18}/><div><strong>Data Governance</strong><span>Retention, backup и privacy</span></div></NavLink></div></article><article className="panel span-2"><div className="panel-header"><div><h2>Компании</h2><p>Customer health</p></div><NavLink to="/support">Customer Success <ChevronRight size={16}/></NavLink></div><div className="table-wrap"><table><thead><tr><th>Компания</th><th>Тариф</th><th>Продукты</th><th>Пользователи</th><th>Health</th></tr></thead><tbody>{companies.map(c=><tr key={c.name}><td><strong>{c.name}</strong><span>{c.city}</span></td><td>{c.plan}</td><td>{c.products}</td><td>{c.users}</td><td><div className="health"><div><span style={{width:`${c.health}%`}}/></div><b>{c.health}%</b></div></td></tr>)}</tbody></table></div></article><article className="panel"><div className="panel-header"><div><h2>Быстрые действия</h2></div></div><div className="quick-actions"><NavLink to="/subscriptions"><PackageCheck size={18}/><span><strong>Выдать лицензию</strong><small>Активировать продукты</small></span></NavLink><NavLink to="/billing"><ReceiptText size={18}/><span><strong>Выставить счёт</strong><small>Платежи и задолженность</small></span></NavLink><NavLink to="/support"><Headphones size={18}/><span><strong>Обращение</strong><small>Создать ticket</small></span></NavLink><NavLink to="/security"><LockKeyhole size={18}/><span><strong>Support session</strong><small>Запросить доступ</small></span></NavLink><NavLink to="/governance"><DatabaseBackup size={18}/><span><strong>Backup registry</strong><small>Проверить backup и restore</small></span></NavLink></div></article></section></>}
function Placeholder({title}:{title:string}){return <div className="empty-state"><Settings size={34}/><h2>{title}</h2><p>Раздел будет подключён на следующем этапе.</p></div>}
export function App(){return <Shell><Routes>
 <Route path="/" element={<RequirePermission permission="dashboard.read"><Dashboard/></RequirePermission>}/>
 <Route path="/companies" element={<RequirePermission permission="organizations.read"><CompaniesPage/></RequirePermission>}/>
 <Route path="/products" element={<RequirePermission permission="products.read"><ProductsPage/></RequirePermission>}/>
 <Route path="/subscriptions" element={<RequirePermission permission="subscriptions.read"><SubscriptionsPage/></RequirePermission>}/>
 <Route path="/billing" element={<RequirePermission permission="billing.operations.read"><BillingOperationsPage/></RequirePermission>}/>
 <Route path="/users" element={<RequirePermission permission="users.read"><IdentityDirectoryPage/></RequirePermission>}/>
 <Route path="/integrations" element={<RequirePermission permission="integrations.read"><IntegrationCenterPage/></RequirePermission>}/>
 <Route path="/operations" element={<RequirePermission permission="operations.read"><OperationsPage/></RequirePermission>}/>
 <Route path="/observability" element={<RequirePermission permission="observability.read"><ObservabilityPage/></RequirePermission>}/>
 <Route path="/security" element={<RequirePermission permission="security.read"><SecurityCenterPage/></RequirePermission>}/>
 <Route path="/audit" element={<RequirePermission permission="security.read"><SecurityCenterPage/></RequirePermission>}/>
 <Route path="/support" element={<RequirePermission permission="support.read"><SupportPage/></RequirePermission>}/>
 <Route path="/governance" element={<RequirePermission permission="governance.read"><GovernancePage/></RequirePermission>}/>
 <Route path="/settings" element={<RequirePermission permission="settings.read"><Placeholder title="Настройки платформы"/></RequirePermission>}/>
</Routes></Shell>}