import { FormEvent, useEffect, useMemo, useState } from 'react';
import './productCommercialCenter.css';

type Product = { id: string; code: string; name: string; status: string; version: string | null; last_health: string; tenants: number };
type CommercialModule = { id:string; code:string; name:string; description:string|null; category:string; status:string; separately_sellable:boolean; addon_price_kzt:number|string|null };
type PlanModule = { moduleId:string; mode:'included'|'addon'|'disabled'; priceOverrideKzt:number|string|null };
type Plan = { id:string; code:string; name:string; description:string|null; status:'draft'|'published'|'archived'; trial_days:number; limits:Record<string,number|null>; prices:Record<string,number|string>; modules:PlanModule[] };
type PaymentMethod = { method:'bank_transfer'|'kaspi'|'card'; enabled:boolean; is_default:boolean; display_name:string; instructions:string|null; sort_order:number };
type CommercialPayload = { product:{id:string;code:string;name:string;description:string|null;status:string}; modules:CommercialModule[]; plans:Plan[]; paymentMethods:PaymentMethod[] };
type DetailTab = 'overview'|'modules'|'plans'|'limits'|'payments';

const detailTabs: Array<{id:DetailTab;label:string}> = [
  {id:'overview',label:'Обзор'},{id:'modules',label:'Модули'},{id:'plans',label:'Тарифы'},{id:'limits',label:'Лимиты'},{id:'payments',label:'Способы оплаты'},
];
const standardLimits = [
  ['users','Пользователи'],['branches','Филиалы'],['whatsapp_channels','WhatsApp-каналы'],['telephony_channels','Телефонные каналы'],['ai_requests','AI-запросы'],['storage_gb','Хранилище, GB'],
] as const;

async function api<T>(path:string, init?:RequestInit):Promise<T>{
  const response=await fetch(path,{credentials:'same-origin',headers:{'content-type':'application/json',...(init?.headers||{})},...init});
  if(!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}
const money=(value:number|string|null|undefined)=>value==null||value===''?'—':new Intl.NumberFormat('ru-RU',{style:'currency',currency:'KZT',maximumFractionDigits:0}).format(Number(value));

export function ProductCommercialCenter({products,canManage}:{products:Product[];canManage:boolean}){
  const [selectedId,setSelectedId]=useState<string>('');
  const [tab,setTab]=useState<DetailTab>('overview');
  const [data,setData]=useState<CommercialPayload|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [newPlan,setNewPlan]=useState({code:'',name:'',description:'',trialDays:3});

  useEffect(()=>{ if(!selectedId && products[0]?.id) setSelectedId(products[0].id); },[products,selectedId]);
  const load=async(id=selectedId)=>{ if(!id)return; setLoading(true); setError(''); try{setData(await api<CommercialPayload>(`/api/v1/products/${id}/commercial`));}catch(e){setError(e instanceof Error?e.message:'Ошибка загрузки');}finally{setLoading(false);} };
  useEffect(()=>{ void load(selectedId); },[selectedId]);
  const selectedProduct=products.find(p=>p.id===selectedId)??null;
  const sellableCount=useMemo(()=>data?.modules.filter(m=>m.separately_sellable).length??0,[data]);

  if(products.length===0) return <section className="vps-card"><div className="vps-empty"><div className="vps-empty-mark">—</div><div><strong>Продуктов пока нет</strong><p>После регистрации продукта он появится здесь.</p></div></div></section>;

  const saveModule=async(module:CommercialModule,patch:Partial<{separatelySellable:boolean;addonPriceKzt:string|number|null}>)=>{
    if(!canManage)return; const separatelySellable=patch.separatelySellable??module.separately_sellable; const addonPriceKzt=patch.addonPriceKzt===undefined?module.addon_price_kzt:patch.addonPriceKzt;
    await api(`/api/v1/products/${selectedId}/commercial/modules/${module.id}`,{method:'PUT',body:JSON.stringify({separatelySellable,addonPriceKzt})}); await load();
  };
  const createPlan=async(e:FormEvent)=>{e.preventDefault();if(!canManage)return;await api(`/api/v1/products/${selectedId}/commercial/plans`,{method:'POST',body:JSON.stringify(newPlan)});setNewPlan({code:'',name:'',description:'',trialDays:3});await load();};
  const savePlan=async(plan:Plan)=>{if(!canManage)return;await api(`/api/v1/products/${selectedId}/commercial/plans/${plan.id}`,{method:'PUT',body:JSON.stringify({name:plan.name,description:plan.description,status:plan.status,trialDays:plan.trial_days,limits:plan.limits,prices:plan.prices,modules:plan.modules})});await load();};
  const updatePlan=(id:string,mutate:(plan:Plan)=>Plan)=>setData(current=>current?{...current,plans:current.plans.map(p=>p.id===id?mutate(p):p)}:current);
  const savePayments=async()=>{if(!canManage||!data)return;await api(`/api/v1/products/${selectedId}/commercial/payment-methods`,{method:'PUT',body:JSON.stringify({items:data.paymentMethods.map(x=>({method:x.method,enabled:x.enabled,isDefault:x.is_default,displayName:x.display_name,instructions:x.instructions,sortOrder:x.sort_order}))})});await load();};

  return <div className="product-commercial-shell">
    <section className="vps-card product-list-card">
      <div className="vps-card-head"><div><span>ПРОДУКТЫ IMDS</span><h2>Продукты</h2><p>Тарифы, цены и лимиты настраиваются внутри конкретного продукта.</p></div></div>
      <div className="product-catalog-grid">{products.map(product=><button key={product.id} className={`product-tile ${product.id===selectedId?'active':''}`} onClick={()=>{setSelectedId(product.id);setTab('overview');}}><div><strong>{product.name}</strong><small>{product.code}</small></div><span>{product.tenants} орг.</span></button>)}</div>
    </section>

    {selectedProduct&&<section className="vps-card product-detail-card">
      <div className="product-detail-head"><div><span>ПРОДУКТ</span><h2>{selectedProduct.name}</h2><p>{selectedProduct.code} · {selectedProduct.status}</p></div><button className="vps-mini" onClick={()=>void load()}>Обновить</button></div>
      <div className="product-detail-tabs">{detailTabs.map(item=><button key={item.id} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)}>{item.label}</button>)}</div>
      {error&&<div className="vps-error">{error}</div>}{loading&&!data&&<div className="product-loading">Загрузка…</div>}

      {data&&tab==='overview'&&<div className="product-summary-grid">
        <article><span>Модули</span><strong>{data.modules.length}</strong><small>{sellableCount} продаются отдельно</small></article>
        <article><span>Тарифы</span><strong>{data.plans.length}</strong><small>{data.plans.filter(p=>p.status==='published').length} опубликовано</small></article>
        <article><span>Trial</span><strong>{data.plans.length?`${Math.max(...data.plans.map(p=>p.trial_days))} дн.`:'—'}</strong><small>задаётся по тарифу</small></article>
        <article><span>Оплата</span><strong>{data.paymentMethods.filter(x=>x.enabled).length}</strong><small>активных способов</small></article>
      </div>}

      {data&&tab==='modules'&&<div className="commercial-table-wrap"><table className="commercial-table"><thead><tr><th>Модуль</th><th>Категория</th><th>Отдельная продажа</th><th>Цена add-on</th><th></th></tr></thead><tbody>{data.modules.map(module=><tr key={module.id}><td><strong>{module.name}</strong><small>{module.code}</small></td><td>{module.category}</td><td><label className="switch-row"><input type="checkbox" disabled={!canManage} checked={module.separately_sellable} onChange={e=>void saveModule(module,{separatelySellable:e.target.checked})}/><span>{module.separately_sellable?'Да':'Нет'}</span></label></td><td><input className="commercial-number" type="number" min="0" step="100" disabled={!canManage||!module.separately_sellable} defaultValue={module.addon_price_kzt??''} placeholder="₸" onBlur={e=>{if(String(module.addon_price_kzt??'')!==e.target.value)void saveModule(module,{addonPriceKzt:e.target.value});}}/></td><td>{money(module.addon_price_kzt)}</td></tr>)}</tbody></table></div>}

      {data&&tab==='plans'&&<div className="plans-stack">
        {canManage&&<form className="new-plan-form" onSubmit={createPlan}><div><span>НОВЫЙ ТАРИФ</span><h3>Создать тариф для {selectedProduct.name}</h3></div><input required placeholder="Код: business" value={newPlan.code} onChange={e=>setNewPlan({...newPlan,code:e.target.value})}/><input required placeholder="Название" value={newPlan.name} onChange={e=>setNewPlan({...newPlan,name:e.target.value})}/><input type="number" min="0" max="365" value={newPlan.trialDays} onChange={e=>setNewPlan({...newPlan,trialDays:Number(e.target.value)})}/><button className="vps-action">Создать</button></form>}
        {data.plans.length===0&&<div className="vps-empty"><div className="vps-empty-mark">—</div><div><strong>Тарифов ещё нет</strong><p>Создайте первый тариф и соберите его из модулей продукта.</p></div></div>}
        {data.plans.map(plan=><PlanEditor key={plan.id} plan={plan} modules={data.modules} canManage={canManage} onChange={next=>updatePlan(plan.id,()=>next)} onSave={()=>void savePlan(plan)}/>) }
      </div>}

      {data&&tab==='limits'&&<div className="limits-overview">{data.plans.length===0?<p>Сначала создайте тариф.</p>:data.plans.map(plan=><article key={plan.id}><div><strong>{plan.name}</strong><small>{plan.status}</small></div>{standardLimits.map(([key,label])=><span key={key}><b>{label}</b>{plan.limits?.[key]??'∞'}</span>)}</article>)}</div>}

      {data&&tab==='payments'&&<div className="payments-editor"><p>Разрешённые способы оплаты именно для этого продукта.</p>{data.paymentMethods.map((item,index)=><label key={item.method} className="payment-row"><input type="checkbox" disabled={!canManage} checked={item.enabled} onChange={e=>setData({...data,paymentMethods:data.paymentMethods.map((x,i)=>i===index?{...x,enabled:e.target.checked}:x)})}/><strong>{item.display_name}</strong><input disabled={!canManage} value={item.instructions??''} placeholder="Инструкция / реквизиты" onChange={e=>setData({...data,paymentMethods:data.paymentMethods.map((x,i)=>i===index?{...x,instructions:e.target.value}:x)})}/><label><input type="radio" name="default-payment" disabled={!canManage||!item.enabled} checked={item.is_default} onChange={()=>setData({...data,paymentMethods:data.paymentMethods.map((x,i)=>({...x,is_default:i===index}))})}/> по умолчанию</label></label>)}{canManage&&<button className="vps-action" onClick={()=>void savePayments()}>Сохранить способы оплаты</button>}</div>}
    </section>}
  </div>;
}

function PlanEditor({plan,modules,canManage,onChange,onSave}:{plan:Plan;modules:CommercialModule[];canManage:boolean;onChange:(plan:Plan)=>void;onSave:()=>void}){
  const set=(patch:Partial<Plan>)=>onChange({...plan,...patch});
  const moduleState=(id:string)=>plan.modules.find(x=>x.moduleId===id)??{moduleId:id,mode:'disabled' as const,priceOverrideKzt:null};
  const setModule=(id:string,patch:Partial<PlanModule>)=>{const current=moduleState(id);const next={...current,...patch};set({modules:[...plan.modules.filter(x=>x.moduleId!==id),next]});};
  return <article className="plan-editor">
    <div className="plan-editor-head"><div><input className="plan-title-input" disabled={!canManage} value={plan.name} onChange={e=>set({name:e.target.value})}/><small>{plan.code}</small></div><select disabled={!canManage} value={plan.status} onChange={e=>set({status:e.target.value as Plan['status']})}><option value="draft">Черновик</option><option value="published">Опубликован</option><option value="archived">Архив</option></select></div>
    <div className="price-grid">{[1,3,6,12].map(months=><label key={months}>{months} мес.<input disabled={!canManage} type="number" min="0" step="100" placeholder="₸" value={plan.prices?.[String(months)]??''} onChange={e=>set({prices:{...plan.prices,[String(months)]:e.target.value}})}/></label>)}<label>Trial, дней<input disabled={!canManage} type="number" min="0" max="365" value={plan.trial_days} onChange={e=>set({trial_days:Number(e.target.value)})}/></label></div>
    <div className="limit-grid">{standardLimits.map(([key,label])=><label key={key}>{label}<input disabled={!canManage} type="number" min="0" value={plan.limits?.[key]??''} placeholder="∞" onChange={e=>set({limits:{...plan.limits,[key]:e.target.value===''?null:Number(e.target.value)}})}/></label>)}</div>
    <div className="plan-modules"><strong>Состав тарифа</strong>{modules.map(module=>{const state=moduleState(module.id);return <div key={module.id}><span><b>{module.name}</b><small>{module.code}</small></span><select disabled={!canManage} value={state.mode} onChange={e=>setModule(module.id,{mode:e.target.value as PlanModule['mode']})}><option value="disabled">Не входит</option><option value="included">Включён</option><option value="addon">Доп. модуль</option></select><span>{state.mode==='addon'?money(state.priceOverrideKzt??module.addon_price_kzt):state.mode==='included'?'В цене тарифа':'—'}</span></div>})}</div>
    {canManage&&<div className="plan-actions"><button className="vps-action" onClick={onSave}>Сохранить тариф</button></div>}
  </article>;
}
