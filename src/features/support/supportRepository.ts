import { getSupabase } from '../../lib/supabase';

export type SupportTicketStatus = 'new'|'open'|'in_progress'|'waiting_customer'|'waiting_internal'|'resolved'|'closed'|'cancelled';
export type SupportTicketPriority = 'low'|'normal'|'high'|'urgent'|'critical';
export type SupportTicket = { id:string; ticketNumber:string; organizationId:string; organizationName:string; productName:string; subject:string; description:string; status:SupportTicketStatus; priority:SupportTicketPriority; assignedTo:string; firstResponseDueAt:string|null; resolutionDueAt:string|null; firstResponseBreached:boolean; resolutionBreached:boolean; createdAt:string; };
export type CustomerProfile = { organizationId:string; organizationName:string; ownerName:string; lifecycleStage:string; healthScore:number; riskLevel:string; onboardingScore:number; lastContactAt:string|null; nextContactAt:string|null; };
export type OnboardingPlan = { id:string; organizationId:string; organizationName:string; stage:string; progressPercent:number; targetGoLiveAt:string|null; steps:{id:string; title:string; status:string; displayOrder:number}[] };
export type SupportSnapshot = { tickets:SupportTicket[]; customers:CustomerProfile[]; onboarding:OnboardingPlan[]; organizations:{id:string;name:string}[]; products:{id:string;name:string}[]; users:{id:string;name:string}[] };
export type CreateTicketInput = { organizationId:string; productId:string|null; type:string; priority:SupportTicketPriority; channel:string; subject:string; description:string; requesterName:string };

const STORAGE_KEY='imds-super-admin:support:v1';
const demo:SupportSnapshot={
  organizations:[{id:'org-amanat',name:'Amanat Medical Center'},{id:'org-orda',name:'Orda Clinic'},{id:'org-sapa',name:'Sapa Med'}],
  products:[{id:'crm',name:'IMDS CRM'},{id:'marketing',name:'IMDS Marketing'},{id:'mis',name:'IMDS MIS'}],
  users:[{id:'support-1',name:'Айдана Support'},{id:'support-2',name:'Technical Admin'}],
  customers:[
    {organizationId:'org-amanat',organizationName:'Amanat Medical Center',ownerName:'Айдана Support',lifecycleStage:'active',healthScore:92,riskLevel:'healthy',onboardingScore:100,lastContactAt:'2026-08-01T08:00:00Z',nextContactAt:'2026-08-08T08:00:00Z'},
    {organizationId:'org-orda',organizationName:'Orda Clinic',ownerName:'Айдана Support',lifecycleStage:'onboarding',healthScore:71,riskLevel:'attention',onboardingScore:56,lastContactAt:'2026-07-30T08:00:00Z',nextContactAt:'2026-08-03T08:00:00Z'},
    {organizationId:'org-sapa',organizationName:'Sapa Med',ownerName:'Technical Admin',lifecycleStage:'active',healthScore:43,riskLevel:'at_risk',onboardingScore:100,lastContactAt:'2026-07-25T08:00:00Z',nextContactAt:null},
  ],
  tickets:[
    {id:'ticket-1',ticketNumber:'SUP-2026-000121',organizationId:'org-sapa',organizationName:'Sapa Med',productName:'IMDS Marketing',subject:'Meta Ads синхронизация не завершается',description:'Ошибка фоновой синхронизации рекламного кабинета.',status:'in_progress',priority:'critical',assignedTo:'Technical Admin',firstResponseDueAt:'2026-08-02T10:00:00Z',resolutionDueAt:'2026-08-02T12:00:00Z',firstResponseBreached:false,resolutionBreached:true,createdAt:'2026-08-02T09:30:00Z'},
    {id:'ticket-2',ticketNumber:'SUP-2026-000122',organizationId:'org-orda',organizationName:'Orda Clinic',productName:'IMDS CRM',subject:'Нужна помощь с импортом сделок',description:'Подготовить шаблон и проверить импорт.',status:'waiting_customer',priority:'normal',assignedTo:'Айдана Support',firstResponseDueAt:'2026-08-02T16:00:00Z',resolutionDueAt:'2026-08-04T10:00:00Z',firstResponseBreached:false,resolutionBreached:false,createdAt:'2026-08-02T11:00:00Z'},
  ],
  onboarding:[{id:'plan-orda',organizationId:'org-orda',organizationName:'Orda Clinic',stage:'integrations',progressPercent:56,targetGoLiveAt:'2026-08-15',steps:[{id:'s1',title:'Kickoff и фиксация целей',status:'completed',displayOrder:10},{id:'s2',title:'Настройка компании и филиалов',status:'completed',displayOrder:20},{id:'s3',title:'Пользователи и роли',status:'completed',displayOrder:30},{id:'s4',title:'Импорт и проверка данных',status:'in_progress',displayOrder:40},{id:'s5',title:'Подключение интеграций',status:'pending',displayOrder:50}]}]
};
function readDemo(){try{const v=localStorage.getItem(STORAGE_KEY);return v?JSON.parse(v) as SupportSnapshot:structuredClone(demo)}catch{return structuredClone(demo)}}
function writeDemo(v:SupportSnapshot){localStorage.setItem(STORAGE_KEY,JSON.stringify(v));return v}
function client(){return getSupabase() as any}

async function list():Promise<SupportSnapshot>{
 const supabase=client(); if(!supabase) return readDemo();
 const [tickets,profiles,plans,steps,orgs,products,users]=await Promise.all([
  supabase.from('support_tickets').select('*').order('created_at',{ascending:false}),
  supabase.from('customer_success_profiles').select('*'),
  supabase.from('onboarding_plans').select('*'),
  supabase.from('onboarding_steps').select('*').order('display_order'),
  supabase.from('organizations').select('id,name'),
  supabase.from('products').select('id,name'),
  supabase.from('platform_users').select('id,full_name,email')
 ]);
 const error=tickets.error??profiles.error??plans.error??steps.error??orgs.error??products.error??users.error;if(error)throw error;
 const orgName=new Map((orgs.data??[]).map((x:any)=>[x.id,x.name]));const productName=new Map((products.data??[]).map((x:any)=>[x.id,x.name]));const userName=new Map((users.data??[]).map((x:any)=>[x.id,x.full_name||x.email]));
 return {
  organizations:(orgs.data??[]).map((x:any)=>({id:x.id,name:x.name})),products:(products.data??[]).map((x:any)=>({id:x.id,name:x.name})),users:(users.data??[]).map((x:any)=>({id:x.id,name:x.full_name||x.email})),
  tickets:(tickets.data??[]).map((x:any)=>({id:x.id,ticketNumber:x.ticket_number,organizationId:x.organization_id,organizationName:orgName.get(x.organization_id)||x.organization_id,productName:productName.get(x.product_id)||'Без продукта',subject:x.subject,description:x.description,status:x.status,priority:x.priority,assignedTo:userName.get(x.assigned_to)||'Не назначен',firstResponseDueAt:x.first_response_due_at,resolutionDueAt:x.resolution_due_at,firstResponseBreached:x.first_response_breached,resolutionBreached:x.resolution_breached,createdAt:x.created_at})),
  customers:(profiles.data??[]).map((x:any)=>({organizationId:x.organization_id,organizationName:orgName.get(x.organization_id)||x.organization_id,ownerName:userName.get(x.owner_user_id)||'Не назначен',lifecycleStage:x.lifecycle_stage,healthScore:x.health_score,riskLevel:x.risk_level,onboardingScore:x.onboarding_score,lastContactAt:x.last_contact_at,nextContactAt:x.next_contact_at})),
  onboarding:(plans.data??[]).map((x:any)=>({id:x.id,organizationId:x.organization_id,organizationName:orgName.get(x.organization_id)||x.organization_id,stage:x.stage,progressPercent:x.progress_percent,targetGoLiveAt:x.target_go_live_at,steps:(steps.data??[]).filter((s:any)=>s.onboarding_plan_id===x.id).map((s:any)=>({id:s.id,title:s.title,status:s.status,displayOrder:s.display_order}))}))
 };
}

export const supportRepository={
 list,
 async createTicket(input:CreateTicketInput){const supabase=client();if(!supabase){const s=readDemo();s.tickets.unshift({id:crypto.randomUUID(),ticketNumber:`SUP-2026-${String(123+s.tickets.length).padStart(6,'0')}`,organizationId:input.organizationId,organizationName:s.organizations.find(x=>x.id===input.organizationId)?.name||'',productName:s.products.find(x=>x.id===input.productId)?.name||'Без продукта',subject:input.subject,description:input.description,status:'new',priority:input.priority,assignedTo:'Не назначен',firstResponseDueAt:null,resolutionDueAt:null,firstResponseBreached:false,resolutionBreached:false,createdAt:new Date().toISOString()});return writeDemo(s)}const {error}=await supabase.rpc('create_support_ticket',{organization_id_value:input.organizationId,product_id_value:input.productId,type_value:input.type,priority_value:input.priority,channel_value:input.channel,subject_value:input.subject,description_value:input.description,requester_name_value:input.requesterName});if(error)throw error;return list()},
 async transition(id:string,status:SupportTicketStatus,reason:string){const supabase=client();if(!supabase){const s=readDemo();const t=s.tickets.find(x=>x.id===id);if(t)t.status=status;return writeDemo(s)}const {error}=await supabase.rpc('transition_support_ticket',{ticket_id_value:id,status_value:status,reason_value:reason});if(error)throw error;return list()},
 async createOnboarding(organizationId:string,targetGoLiveAt:string|null){const supabase=client();if(!supabase){const s=readDemo();const org=s.organizations.find(x=>x.id===organizationId);if(org&&!s.onboarding.some(x=>x.organizationId===organizationId))s.onboarding.push({id:crypto.randomUUID(),organizationId,organizationName:org.name,stage:'kickoff',progressPercent:0,targetGoLiveAt,steps:[]});return writeDemo(s)}const {error}=await supabase.rpc('create_onboarding_plan',{organization_id_value:organizationId,target_go_live_at_value:targetGoLiveAt});if(error)throw error;return list()},
 async updateStep(id:string,status:string,note:string){const supabase=client();if(!supabase){const s=readDemo();for(const p of s.onboarding){const step=p.steps.find(x=>x.id===id);if(step)step.status=status;p.progressPercent=p.steps.length?Math.round(p.steps.filter(x=>['completed','skipped'].includes(x.status)).length*100/p.steps.length):0}return writeDemo(s)}const {error}=await supabase.rpc('update_onboarding_step',{onboarding_step_id_value:id,status_value:status,note_value:note});if(error)throw error;return list()},
 async refreshScores(){const supabase=client();if(!supabase)return readDemo();const {error}=await supabase.rpc('refresh_customer_health_scores');if(error)throw error;return list()}
};
