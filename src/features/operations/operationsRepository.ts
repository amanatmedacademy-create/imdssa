import type { Json } from '../../lib/database.types';
import { getSupabase } from '../../lib/supabase';
import type {
  OperationsSupabaseClient,
  ProductCommandStatus,
  ProductCommandType,
  WorkflowStatus,
} from './operationsDatabase.types';

export type WorkflowEvent = {
  id: string;
  workflowRunId: string;
  productCommandId: string | null;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  message: string;
  metadata: Json;
  occurredAt: string;
};

export type OperationCommand = {
  id: string;
  workflowRunId: string;
  licenseId: string;
  organizationId: string;
  organizationName: string;
  productId: string;
  productName: string;
  productKey: string;
  command: ProductCommandType;
  status: ProductCommandStatus;
  workflowStatus: WorkflowStatus;
  attempts: number;
  maxAttempts: number;
  adapterConfigured: boolean;
  endpointConfigured: boolean;
  availableAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string;
  payload: Json;
  response: Json | null;
  correlationId: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  events: WorkflowEvent[];
};

export type OperationsLicense = {
  id: string;
  organizationId: string;
  organizationName: string;
  productId: string;
  productName: string;
  productKey: string;
  subscriptionId: string | null;
  status: string;
  externalTenantId: string | null;
};

export type OperationsSnapshot = {
  commands: OperationCommand[];
  licenses: OperationsLicense[];
};

export type EnqueueCommandInput = {
  licenseId: string;
  command: ProductCommandType;
  reason: string;
  payload: Json;
};

const STORAGE_KEY = 'imds-super-admin:operations:v1';
const DEMO_NOW = '2026-08-02T10:00:00.000Z';

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEvent(
  commandId: string,
  workflowRunId: string,
  eventType: string,
  fromStatus: string | null,
  toStatus: string | null,
  message: string,
  occurredAt = DEMO_NOW,
): WorkflowEvent {
  return {
    id: createId('event'),
    workflowRunId,
    productCommandId: commandId,
    eventType,
    fromStatus,
    toStatus,
    message,
    metadata: {},
    occurredAt,
  };
}

const demoLicenses: OperationsLicense[] = [
  { id: 'license-amanat-mis', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', productId: 'mis', productName: 'IMDS MIS', productKey: 'imds-mis', subscriptionId: 'subscription-amanat', status: 'active', externalTenantId: 'amanat:mis' },
  { id: 'license-amanat-crm', organizationId: 'org-amanat', organizationName: 'Amanat Medical Center', productId: 'crm', productName: 'IMDS CRM', productKey: 'imds-crm', subscriptionId: 'subscription-amanat', status: 'active', externalTenantId: 'amanat:crm' },
  { id: 'license-orda-crm', organizationId: 'org-orda', organizationName: 'Orda Clinic', productId: 'crm', productName: 'IMDS CRM', productKey: 'imds-crm', subscriptionId: 'subscription-orda', status: 'pending', externalTenantId: null },
  { id: 'license-orda-marketing', organizationId: 'org-orda', organizationName: 'Orda Clinic', productId: 'marketing', productName: 'IMDS Marketing', productKey: 'imds-marketing', subscriptionId: 'subscription-orda', status: 'pending', externalTenantId: null },
  { id: 'license-sapa-dashboard', organizationId: 'org-sapa', organizationName: 'Sapa Med', productId: 'dashboard', productName: 'IMDS Dashboard', productKey: 'imds-dashboard', subscriptionId: 'subscription-sapa', status: 'suspended', externalTenantId: 'sapa:dashboard' },
];

function demoCommand(
  id: string,
  license: OperationsLicense,
  command: ProductCommandType,
  status: ProductCommandStatus,
  attempts: number,
  error = '',
): OperationCommand {
  const workflowRunId = `workflow-${id}`;
  const eventType = status === 'succeeded'
    ? 'command.succeeded'
    : status === 'dead_letter'
      ? 'command.failed'
      : status === 'processing'
        ? 'command.claimed'
        : 'command.enqueued';
  const events = [
    createEvent(id, workflowRunId, 'command.enqueued', null, 'queued', 'Command persisted in product outbox', '2026-08-02T09:55:00.000Z'),
  ];
  if (status !== 'queued') {
    events.push(createEvent(id, workflowRunId, eventType, 'queued', status, error || 'Worker updated command state', DEMO_NOW));
  }

  return {
    id,
    workflowRunId,
    licenseId: license.id,
    organizationId: license.organizationId,
    organizationName: license.organizationName,
    productId: license.productId,
    productName: license.productName,
    productKey: license.productKey,
    command,
    status,
    workflowStatus: status === 'succeeded' ? 'completed' : status === 'dead_letter' ? 'failed' : status === 'cancelled' ? 'cancelled' : 'queued',
    attempts,
    maxAttempts: 5,
    adapterConfigured: command !== 'provision_tenant' || license.productId !== 'marketing',
    endpointConfigured: command !== 'provision_tenant' || license.productId !== 'marketing',
    availableAt: DEMO_NOW,
    lockedAt: status === 'processing' ? DEMO_NOW : null,
    lockedBy: status === 'processing' ? 'edge-demo-worker' : null,
    lastError: error,
    payload: {
      organization_id: license.organizationId,
      product_id: license.productId,
      license_id: license.id,
      external_tenant_id: license.externalTenantId,
    },
    response: status === 'succeeded' ? { status: 'completed', externalTenantId: license.externalTenantId } : null,
    correlationId: createId('correlation'),
    idempotencyKey: `demo:${id}`,
    createdAt: '2026-08-02T09:55:00.000Z',
    updatedAt: DEMO_NOW,
    completedAt: status === 'succeeded' || status === 'dead_letter' ? DEMO_NOW : null,
    events,
  };
}

const defaultSnapshot: OperationsSnapshot = {
  licenses: demoLicenses,
  commands: [
    demoCommand('command-provision-crm', demoLicenses[2], 'provision_tenant', 'succeeded', 1),
    demoCommand('command-sync-amanat', demoLicenses[1], 'sync_entitlements', 'queued', 0),
    demoCommand('command-suspend-sapa', demoLicenses[4], 'suspend_tenant', 'processing', 1),
    demoCommand('command-provision-marketing', demoLicenses[3], 'provision_tenant', 'dead_letter', 5, 'Production endpoint is not configured or active'),
  ],
};

function cloneDefaultSnapshot(): OperationsSnapshot {
  return JSON.parse(JSON.stringify(defaultSnapshot)) as OperationsSnapshot;
}

function readDemoSnapshot(): OperationsSnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = cloneDefaultSnapshot();
      writeDemoSnapshot(initial);
      return initial;
    }
    const parsed = JSON.parse(raw) as OperationsSnapshot;
    return parsed && Array.isArray(parsed.commands) && Array.isArray(parsed.licenses)
      ? parsed
      : cloneDefaultSnapshot();
  } catch {
    return cloneDefaultSnapshot();
  }
}

function writeDemoSnapshot(snapshot: OperationsSnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function getOperationsClient(): OperationsSupabaseClient | null {
  return getSupabase() as unknown as OperationsSupabaseClient | null;
}

async function listFromSupabase(): Promise<OperationsSnapshot> {
  const supabase = getOperationsClient();
  if (!supabase) return readDemoSnapshot();

  const [
    commandResult,
    workflowResult,
    eventResult,
    organizationResult,
    productResult,
    licenseResult,
  ] = await Promise.all([
    supabase.from('product_commands').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('workflow_runs').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('workflow_events').select('*').order('occurred_at', { ascending: false }).limit(2000),
    supabase.from('organizations').select('id, name, status'),
    supabase.from('products').select('id, key, name, status, archived_at'),
    supabase.from('licenses').select('*'),
  ]);

  const firstError = commandResult.error
    ?? workflowResult.error
    ?? eventResult.error
    ?? organizationResult.error
    ?? productResult.error
    ?? licenseResult.error;
  if (firstError) throw firstError;

  const commandRows = commandResult.data ?? [];
  const workflowRows = workflowResult.data ?? [];
  const eventRows = eventResult.data ?? [];
  const organizationRows = organizationResult.data ?? [];
  const productRows = productResult.data ?? [];
  const licenseRows = licenseResult.data ?? [];
  const organizationNameById = new Map(organizationRows.map((row) => [row.id, row.name]));
  const productById = new Map(productRows.map((row) => [row.id, row]));
  const workflowById = new Map(workflowRows.map((row) => [row.id, row]));

  const licenses: OperationsLicense[] = licenseRows.map((license) => {
    const product = productById.get(license.product_id);
    return {
      id: license.id,
      organizationId: license.organization_id,
      organizationName: organizationNameById.get(license.organization_id) ?? license.organization_id,
      productId: license.product_id,
      productName: product?.name ?? license.product_id,
      productKey: product?.key ?? license.product_id,
      subscriptionId: license.subscription_id,
      status: license.status,
      externalTenantId: license.external_tenant_id,
    };
  });

  const commands: OperationCommand[] = commandRows.map((command) => {
    const product = productById.get(command.product_id);
    const workflow = workflowById.get(command.workflow_run_id);
    const events: WorkflowEvent[] = eventRows
      .filter((event) => event.workflow_run_id === command.workflow_run_id)
      .map((event) => ({
        id: event.id,
        workflowRunId: event.workflow_run_id,
        productCommandId: event.product_command_id,
        eventType: event.event_type,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        message: event.message ?? '',
        metadata: event.metadata,
        occurredAt: event.occurred_at,
      }));

    return {
      id: command.id,
      workflowRunId: command.workflow_run_id,
      licenseId: command.license_id,
      organizationId: command.organization_id,
      organizationName: organizationNameById.get(command.organization_id) ?? command.organization_id,
      productId: command.product_id,
      productName: product?.name ?? command.product_id,
      productKey: product?.key ?? command.product_id,
      command: command.command,
      status: command.status,
      workflowStatus: workflow?.status ?? 'queued',
      attempts: command.attempts,
      maxAttempts: command.max_attempts,
      adapterConfigured: Boolean(command.adapter_id),
      endpointConfigured: Boolean(command.endpoint_id),
      availableAt: command.available_at,
      lockedAt: command.locked_at,
      lockedBy: command.locked_by,
      lastError: command.last_error ?? workflow?.error ?? '',
      payload: command.payload,
      response: command.response,
      correlationId: command.correlation_id,
      idempotencyKey: command.idempotency_key,
      createdAt: command.created_at,
      updatedAt: command.updated_at,
      completedAt: command.completed_at,
      events,
    };
  });

  return { commands, licenses };
}

export const operationsRepository = {
  async list(): Promise<OperationsSnapshot> {
    return listFromSupabase();
  },

  async enqueue(input: EnqueueCommandInput): Promise<OperationsSnapshot> {
    const supabase = getOperationsClient();
    if (supabase) {
      const { error } = await supabase.rpc('enqueue_license_command', {
        target_license_id: input.licenseId,
        command_value: input.command,
        reason_value: input.reason,
        payload_value: input.payload,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    const license = snapshot.licenses.find((item) => item.id === input.licenseId);
    if (!license) throw new Error('Лицензия не найдена.');
    const timestamp = new Date().toISOString();
    const id = createId('command');
    const workflowRunId = createId('workflow');
    snapshot.commands.unshift({
      id,
      workflowRunId,
      licenseId: license.id,
      organizationId: license.organizationId,
      organizationName: license.organizationName,
      productId: license.productId,
      productName: license.productName,
      productKey: license.productKey,
      command: input.command,
      status: 'queued',
      workflowStatus: 'queued',
      attempts: 0,
      maxAttempts: 5,
      adapterConfigured: true,
      endpointConfigured: true,
      availableAt: timestamp,
      lockedAt: null,
      lockedBy: null,
      lastError: '',
      payload: input.payload,
      response: null,
      correlationId: createId('correlation'),
      idempotencyKey: `manual:${license.id}:${input.command}:${Date.now()}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      events: [createEvent(id, workflowRunId, 'command.enqueued', null, 'queued', input.reason, timestamp)],
    });
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async retry(commandId: string, reason: string): Promise<OperationsSnapshot> {
    const supabase = getOperationsClient();
    if (supabase) {
      const { error } = await supabase.rpc('retry_product_command', {
        target_command_id: commandId,
        reason_value: reason,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    const timestamp = new Date().toISOString();
    snapshot.commands = snapshot.commands.map((command) => command.id === commandId
      ? {
          ...command,
          status: 'queued' as const,
          workflowStatus: 'queued' as const,
          attempts: 0,
          availableAt: timestamp,
          lockedAt: null,
          lockedBy: null,
          lastError: '',
          completedAt: null,
          updatedAt: timestamp,
          events: [
            createEvent(command.id, command.workflowRunId, 'command.retried', command.status, 'queued', reason, timestamp),
            ...command.events,
          ],
        }
      : command);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },

  async cancel(commandId: string, reason: string): Promise<OperationsSnapshot> {
    const supabase = getOperationsClient();
    if (supabase) {
      const { error } = await supabase.rpc('cancel_product_command', {
        target_command_id: commandId,
        reason_value: reason,
      });
      if (error) throw error;
      return listFromSupabase();
    }

    const snapshot = readDemoSnapshot();
    const timestamp = new Date().toISOString();
    snapshot.commands = snapshot.commands.map((command) => command.id === commandId
      ? {
          ...command,
          status: 'cancelled' as const,
          workflowStatus: 'cancelled' as const,
          lastError: reason,
          completedAt: timestamp,
          updatedAt: timestamp,
          events: [
            createEvent(command.id, command.workflowRunId, 'command.cancelled', command.status, 'cancelled', reason, timestamp),
            ...command.events,
          ],
        }
      : command);
    writeDemoSnapshot(snapshot);
    return snapshot;
  },
};
