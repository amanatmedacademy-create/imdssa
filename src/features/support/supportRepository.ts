import { getSupabase } from '../../lib/supabase';

export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';
export type SupportStatus = 'new' | 'open' | 'pending_customer' | 'pending_internal' | 'resolved' | 'closed';
export type SupportChannel = 'portal' | 'email' | 'whatsapp' | 'phone' | 'internal';

export type SupportTicket = {
  id: string;
  number: number;
  organizationId: string;
  organizationName: string;
  productId: string | null;
  productName: string;
  subject: string;
  description: string;
  category: string;
  priority: SupportPriority;
  status: SupportStatus;
  channel: SupportChannel;
  requesterName: string;
  requesterEmail: string;
  assigneeId: string | null;
  assigneeName: string;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type SupportMessage = {
  id: string;
  ticketId: string;
  authorName: string;
  authorType: 'customer' | 'staff' | 'system';
  body: string;
  internal: boolean;
  createdAt: string;
};

export type SupportReference = { id: string; name: string };

export type SupportSnapshot = {
  tickets: SupportTicket[];
  messages: SupportMessage[];
  organizations: SupportReference[];
  products: SupportReference[];
  staff: SupportReference[];
};

export type CreateTicketInput = {
  organizationId: string;
  productId: string | null;
  subject: string;
  description: string;
  category: string;
  priority: SupportPriority;
  channel: SupportChannel;
  requesterName: string;
  requesterEmail: string;
};

const STORAGE_KEY = 'imds-super-admin:support:v1';
const NOW = '2026-08-02T13:30:00.000Z';

const references = {
  organizations: [
    { id: 'org-amanat', name: 'Amanat Medical Center' },
    { id: 'org-orda', name: 'Orda Clinic' },
    { id: 'org-sapa', name: 'Sapa Med' },
    { id: 'org-nova', name: 'Nova Health' },
  ],
  products: [
    { id: 'mis', name: 'IMDS MIS' },
    { id: 'crm', name: 'IMDS CRM' },
    { id: 'marketing', name: 'IMDS Marketing' },
    { id: 'finance', name: 'IMDS Finance' },
    { id: 'contract', name: 'IMDS Contract' },
    { id: 'dashboard', name: 'IMDS Dashboard' },
  ],
  staff: [
    { id: 'user-support', name: 'Support Admin' },
    { id: 'user-owner', name: 'Platform Owner' },
  ],
};

const defaultSnapshot: SupportSnapshot = {
  ...references,
  tickets: [
    {
      id: 'ticket-1003', number: 1003, organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', productId: 'mis', productName: 'IMDS MIS',
      subject: 'Не открывается карта пациента', description: 'После обновления часть пользователей видит пустой экран.', category: 'Ошибка', priority: 'urgent', status: 'open', channel: 'portal',
      requesterName: 'Администратор клиники', requesterEmail: 'admin@amanat.example', assigneeId: 'user-support', assigneeName: 'Support Admin',
      firstResponseDueAt: '2026-08-02T13:45:00.000Z', resolutionDueAt: '2026-08-02T17:30:00.000Z', firstRespondedAt: '2026-08-02T13:36:00.000Z', resolvedAt: null,
      lastMessageAt: NOW, createdAt: '2026-08-02T13:30:00.000Z', updatedAt: NOW,
    },
    {
      id: 'ticket-1002', number: 1002, organizationId: 'org-orda', organizationName: 'Orda Clinic', productId: 'marketing', productName: 'IMDS Marketing',
      subject: 'Meta Ads не синхронизируется', description: 'Данные рекламного кабинета не обновлялись два часа.', category: 'Интеграция', priority: 'high', status: 'pending_internal', channel: 'whatsapp',
      requesterName: 'Маркетолог Orda', requesterEmail: 'marketing@orda.example', assigneeId: 'user-support', assigneeName: 'Support Admin',
      firstResponseDueAt: '2026-08-02T12:30:00.000Z', resolutionDueAt: '2026-08-02T20:00:00.000Z', firstRespondedAt: '2026-08-02T12:10:00.000Z', resolvedAt: null,
      lastMessageAt: '2026-08-02T12:50:00.000Z', createdAt: '2026-08-02T12:00:00.000Z', updatedAt: '2026-08-02T12:50:00.000Z',
    },
    {
      id: 'ticket-1001', number: 1001, organizationId: 'org-sapa', organizationName: 'Sapa Med', productId: 'finance', productName: 'IMDS Finance',
      subject: 'Нужна настройка категорий расходов', description: 'Просьба помочь подготовить структуру ФОТ и налогов.', category: 'Настройка', priority: 'normal', status: 'resolved', channel: 'email',
      requesterName: 'Финансовый менеджер', requesterEmail: 'finance@sapamed.kz', assigneeId: 'user-owner', assigneeName: 'Platform Owner',
      firstResponseDueAt: '2026-08-01T11:00:00.000Z', resolutionDueAt: '2026-08-02T11:00:00.000Z', firstRespondedAt: '2026-08-01T10:20:00.000Z', resolvedAt: '2026-08-02T09:15:00.000Z',
      lastMessageAt: '2026-08-02T09:15:00.000Z', createdAt: '2026-08-01T09:00:00.000Z', updatedAt: '2026-08-02T09:15:00.000Z',
    },
  ],
  messages: [
    { id: 'msg-1', ticketId: 'ticket-1003', authorName: 'Администратор клиники', authorType: 'customer', body: 'После входа карта пациента открывается пустой.', internal: false, createdAt: '2026-08-02T13:30:00.000Z' },
    { id: 'msg-2', ticketId: 'ticket-1003', authorName: 'Support Admin', authorType: 'staff', body: 'Приняли. Проверяем последнюю версию frontend и ошибки API.', internal: false, createdAt: '2026-08-02T13:36:00.000Z' },
    { id: 'msg-3', ticketId: 'ticket-1003', authorName: 'Support Admin', authorType: 'staff', body: 'Возможна связь с релизом 3.8.4. Нужна проверка observability.', internal: true, createdAt: NOW },
    { id: 'msg-4', ticketId: 'ticket-1002', authorName: 'Маркетолог Orda', authorType: 'customer', body: 'Последняя синхронизация была около 10:00.', internal: false, createdAt: '2026-08-02T12:00:00.000Z' },
  ],
};

function cloneDefault(): SupportSnapshot {
  return JSON.parse(JSON.stringify(defaultSnapshot)) as SupportSnapshot;
}

function readDemo(): SupportSnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const snapshot = cloneDefault();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      return snapshot;
    }
    return JSON.parse(raw) as SupportSnapshot;
  } catch {
    return cloneDefault();
  }
}

function writeDemo(snapshot: SupportSnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function listSupabase(): Promise<SupportSnapshot> {
  const client = getSupabase() as any;
  if (!client) return readDemo();

  const [ticketResult, messageResult, organizationResult, productResult, staffResult] = await Promise.all([
    client.from('support_ticket_overview').select('*').order('last_message_at', { ascending: false }).limit(500),
    client.from('support_messages').select('*').order('created_at', { ascending: true }).limit(2000),
    client.from('organizations').select('id,name').is('archived_at', null).order('name'),
    client.from('products').select('id,name').is('archived_at', null).order('name'),
    client.from('platform_users').select('id,full_name,email').eq('is_active', true).order('full_name'),
  ]);
  const error = ticketResult.error ?? messageResult.error ?? organizationResult.error ?? productResult.error ?? staffResult.error;
  if (error) throw new Error(error.message);

  return {
    organizations: (organizationResult.data ?? []).map((item: any) => ({ id: item.id, name: item.name })),
    products: (productResult.data ?? []).map((item: any) => ({ id: item.id, name: item.name })),
    staff: (staffResult.data ?? []).map((item: any) => ({ id: item.id, name: item.full_name || item.email })),
    tickets: (ticketResult.data ?? []).map((item: any): SupportTicket => ({
      id: item.id, number: item.ticket_number, organizationId: item.organization_id, organizationName: item.organization_name,
      productId: item.product_id, productName: item.product_name ?? 'Общий вопрос', subject: item.subject, description: item.description ?? '', category: item.category,
      priority: item.priority, status: item.status, channel: item.channel, requesterName: item.requester_name ?? '', requesterEmail: item.requester_email ?? '',
      assigneeId: item.assignee_id, assigneeName: item.assignee_name ?? 'Не назначен', firstResponseDueAt: item.first_response_due_at, resolutionDueAt: item.resolution_due_at,
      firstRespondedAt: item.first_responded_at, resolvedAt: item.resolved_at, lastMessageAt: item.last_message_at, createdAt: item.created_at, updatedAt: item.updated_at,
    })),
    messages: (messageResult.data ?? []).map((item: any): SupportMessage => ({
      id: item.id, ticketId: item.ticket_id, authorName: item.author_name || 'Система', authorType: item.author_type, body: item.body, internal: item.is_internal, createdAt: item.created_at,
    })),
  };
}

export const supportRepository = {
  list: listSupabase,

  async createTicket(input: CreateTicketInput): Promise<SupportSnapshot> {
    const client = getSupabase() as any;
    if (client) {
      const { error } = await client.rpc('create_support_ticket', {
        organization_id_value: input.organizationId,
        product_id_value: input.productId,
        subject_value: input.subject,
        description_value: input.description,
        category_value: input.category,
        priority_value: input.priority,
        channel_value: input.channel,
        requester_name_value: input.requesterName,
        requester_email_value: input.requesterEmail,
      });
      if (error) throw new Error(error.message);
      return listSupabase();
    }

    const snapshot = readDemo();
    const now = new Date().toISOString();
    const number = Math.max(1000, ...snapshot.tickets.map((item) => item.number)) + 1;
    const organizationName = snapshot.organizations.find((item) => item.id === input.organizationId)?.name ?? input.organizationId;
    const productName = input.productId ? snapshot.products.find((item) => item.id === input.productId)?.name ?? input.productId : 'Общий вопрос';
    const responseMinutes = input.priority === 'urgent' ? 15 : input.priority === 'high' ? 60 : input.priority === 'normal' ? 240 : 480;
    const resolutionHours = input.priority === 'urgent' ? 4 : input.priority === 'high' ? 8 : input.priority === 'normal' ? 24 : 48;
    const id = createId('ticket');
    snapshot.tickets.unshift({
      id, number, organizationId: input.organizationId, organizationName, productId: input.productId, productName,
      subject: input.subject, description: input.description, category: input.category, priority: input.priority, status: 'new', channel: input.channel,
      requesterName: input.requesterName, requesterEmail: input.requesterEmail, assigneeId: null, assigneeName: 'Не назначен',
      firstResponseDueAt: new Date(Date.now() + responseMinutes * 60000).toISOString(), resolutionDueAt: new Date(Date.now() + resolutionHours * 3600000).toISOString(),
      firstRespondedAt: null, resolvedAt: null, lastMessageAt: now, createdAt: now, updatedAt: now,
    });
    snapshot.messages.push({ id: createId('message'), ticketId: id, authorName: input.requesterName || 'Клиент', authorType: 'customer', body: input.description, internal: false, createdAt: now });
    writeDemo(snapshot);
    return snapshot;
  },

  async addMessage(ticketId: string, body: string, internal: boolean): Promise<SupportSnapshot> {
    const client = getSupabase() as any;
    if (client) {
      const { error } = await client.rpc('add_support_message', { ticket_id_value: ticketId, body_value: body, is_internal_value: internal });
      if (error) throw new Error(error.message);
      return listSupabase();
    }
    const snapshot = readDemo();
    const now = new Date().toISOString();
    snapshot.messages.push({ id: createId('message'), ticketId, authorName: 'Support Admin', authorType: 'staff', body, internal, createdAt: now });
    snapshot.tickets = snapshot.tickets.map((ticket) => ticket.id === ticketId ? {
      ...ticket, status: ticket.status === 'new' ? 'open' : ticket.status, firstRespondedAt: ticket.firstRespondedAt ?? now, lastMessageAt: now, updatedAt: now,
    } : ticket);
    writeDemo(snapshot);
    return snapshot;
  },

  async updateTicket(ticketId: string, status: SupportStatus, priority: SupportPriority, assigneeId: string | null): Promise<SupportSnapshot> {
    const client = getSupabase() as any;
    if (client) {
      const { error } = await client.rpc('update_support_ticket', { ticket_id_value: ticketId, status_value: status, priority_value: priority, assignee_id_value: assigneeId });
      if (error) throw new Error(error.message);
      return listSupabase();
    }
    const snapshot = readDemo();
    const now = new Date().toISOString();
    const assigneeName = assigneeId ? snapshot.staff.find((item) => item.id === assigneeId)?.name ?? assigneeId : 'Не назначен';
    snapshot.tickets = snapshot.tickets.map((ticket) => ticket.id === ticketId ? {
      ...ticket, status, priority, assigneeId, assigneeName, resolvedAt: status === 'resolved' || status === 'closed' ? ticket.resolvedAt ?? now : null, updatedAt: now,
    } : ticket);
    writeDemo(snapshot);
    return snapshot;
  },
};
