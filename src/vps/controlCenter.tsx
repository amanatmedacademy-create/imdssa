export type User = { id: string; email: string; fullName: string; role: string; scope: 'platform' | 'tenant'; memberships?: Array<{ organizationId: string; role: string }> };
export type Overview = { organizations: number; products: number; modules: number; installations: number; platform_users: number; sync_pending: number };
export type Organization = { id: string; name: string; legal_name: string | null; bin: string | null; city: string | null; status: string; products?: number; modules?: number; created_at?: string | null; updated_at?: string | null };
export type Product = { id: string; code: string; name: string; status: string; version: string | null; last_health: string; last_heartbeat_at: string | null; last_latency_ms?: number | null; last_error?: string | null; tenants: number };
export type Module = { id: string; code: string; name: string; status: string; current_version: string | null; owner_product_id: string | null; owner_product_name: string | null; category: string };
export type Installation = { id: string; organization_id: string; module_id: string; host_product_id: string; organization_name: string; module_code: string; module_name: string; host_product_name: string; status: string; health: string; version: string | null; actual_enabled: boolean | null; sync_status: string; last_applied_revision: number | null; updated_at: string };
export type OrganizationProduct = { organization_id: string; product_id: string; organization_name: string; product_name: string; product_code: string; status: string; remote_tenant_id: string | null; desired_revision: number | null; actual_revision: number | null; sync_status: string | null; last_sync_at: string | null; last_error: string | null };
export type ControlCommand = { id: string; command_type: string; desired_revision: number; status: string; attempts: number; last_error: string | null; organization_name: string; product_name: string; product_code: string; created_at: string; completed_at: string | null };
export type RealtimeState = 'connecting' | 'online' | 'offline';
export type ControlCenterTab = 'overview' | 'organizations' | 'registrations' | 'products' | 'modules' | 'subscriptions' | 'billing' | 'sync' | 'events' | 'users' | 'security' | 'settings';

export const statusLabels: Record<string, string> = {
  active: 'Активен', suspended: 'Отключён', disabled: 'Отключён', published: 'Доступен', pending: 'Ожидание', synced: 'Синхронизировано',
  applying: 'Применяется', applied: 'Применено', completed: 'Выполнено', succeeded: 'Выполнено', failed: 'Ошибка', retry: 'Повтор', healthy: 'Работает', degraded: 'Деградация',
  unavailable: 'Недоступен', unknown: 'Нет данных', offline: 'Офлайн', maintenance: 'Техработы', draft: 'Черновик', archived: 'Архив', read_only: 'Только чтение',
  issued: 'Выставлен', partially_paid: 'Частично оплачен', paid: 'Оплачен', overdue: 'Просрочен', trial: 'Trial', pending_payment: 'Ожидает оплаты', past_due: 'Просрочена', grace: 'Льготный период', expired: 'Истекла', canceled: 'Отменена', free: 'Бесплатно', beta: 'Beta',
};

export const categoryLabels: Record<string, string> = {
  sales: 'Продажи', communications: 'Коммуникации', operations: 'Операции', advertising: 'Реклама', analytics: 'Аналитика', automation: 'Автоматизация', telephony: 'Телефония',
};

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers || {}) }, ...init });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export function Status({ value }: { value: string }) {
  const normalized = value || 'unknown';
  return <span className={`vps-status ${normalized}`}>{statusLabels[normalized] || normalized}</span>;
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="vps-empty"><div className="vps-empty-mark">—</div><div><strong>{title}</strong><p>{text}</p></div></div>;
}
