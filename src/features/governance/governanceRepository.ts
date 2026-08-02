import { getSupabase } from '../../lib/supabase';

export type GovernanceRisk = 'healthy' | 'attention' | 'critical';
export type GovernanceRequestStatus = 'pending_approval' | 'approved' | 'queued' | 'processing' | 'completed' | 'failed' | 'expired';

export type RetentionPolicy = {
  id: string;
  key: string;
  name: string;
  productName: string;
  classificationName: string;
  retentionDays: number;
  action: string;
  isActive: boolean;
  nextEvaluationAt: string | null;
};

export type LegalHold = {
  id: string;
  organizationName: string;
  productName: string;
  reason: string;
  status: string;
  startsAt: string;
  expiresAt: string | null;
};

export type DataExportRequest = {
  id: string;
  organizationName: string;
  productName: string;
  classificationName: string;
  format: string;
  status: GovernanceRequestStatus;
  reason: string;
  createdAt: string;
  completedAt: string | null;
};

export type DataDeletionRequest = {
  id: string;
  organizationName: string;
  productName: string;
  mode: string;
  status: GovernanceRequestStatus;
  reason: string;
  scheduledFor: string | null;
  createdAt: string;
};

export type BackupAsset = {
  id: string;
  productName: string;
  environment: string;
  backupType: string;
  status: string;
  provider: string;
  sizeBytes: number | null;
  completedAt: string | null;
  verifiedAt: string | null;
  retentionUntil: string | null;
};

export type RestoreOperation = {
  id: string;
  productName: string;
  targetEnvironment: string;
  status: string;
  dryRun: boolean;
  reason: string;
  createdAt: string;
};

export type GovernanceSnapshot = {
  policies: RetentionPolicy[];
  holds: LegalHold[];
  exports: DataExportRequest[];
  deletions: DataDeletionRequest[];
  backups: BackupAsset[];
  restores: RestoreOperation[];
};

const STORAGE_KEY = 'imds-super-admin:governance:v1';
const now = '2026-08-02T14:45:00.000Z';

const defaults: GovernanceSnapshot = {
  policies: [
    { id: 'rp-1', key: 'support-retention', name: 'Support records', productName: 'IMDS Super Admin', classificationName: 'Customer support records', retentionDays: 1825, action: 'archive', isActive: true, nextEvaluationAt: '2026-08-03T00:00:00.000Z' },
    { id: 'rp-2', key: 'audit-retention', name: 'Audit evidence', productName: 'IMDS Super Admin', classificationName: 'Platform audit', retentionDays: 3650, action: 'archive', isActive: true, nextEvaluationAt: '2026-08-03T00:00:00.000Z' },
    { id: 'rp-3', key: 'tenant-metadata', name: 'Tenant metadata', productName: 'IMDS CRM', classificationName: 'Product tenant metadata', retentionDays: 1825, action: 'anonymize', isActive: true, nextEvaluationAt: '2026-08-03T00:00:00.000Z' },
  ],
  holds: [
    { id: 'hold-1', organizationName: 'Amanat Medical Center', productName: 'IMDS CRM', reason: 'Contractual dispute evidence preservation', status: 'active', startsAt: '2026-07-21T08:00:00.000Z', expiresAt: null },
  ],
  exports: [
    { id: 'export-1', organizationName: 'Orda Clinic', productName: 'IMDS CRM', classificationName: 'Product tenant metadata', format: 'zip', status: 'pending_approval', reason: 'Customer portability request', createdAt: now, completedAt: null },
    { id: 'export-2', organizationName: 'Amanat Medical Center', productName: 'IMDS Dashboard', classificationName: 'Platform configuration', format: 'json', status: 'completed', reason: 'Configuration backup', createdAt: '2026-08-01T08:00:00.000Z', completedAt: '2026-08-01T08:07:00.000Z' },
  ],
  deletions: [
    { id: 'delete-1', organizationName: 'Sapa Med', productName: 'IMDS Marketing', mode: 'anonymize', status: 'pending_approval', reason: 'Completed offboarding and retention expiry', scheduledFor: null, createdAt: now },
  ],
  backups: [
    { id: 'backup-1', productName: 'IMDS CRM', environment: 'production', backupType: 'full', status: 'verified', provider: 'Cloudflare R2', sizeBytes: 2147483648, completedAt: '2026-08-02T01:20:00.000Z', verifiedAt: '2026-08-02T02:00:00.000Z', retentionUntil: '2026-11-02T01:20:00.000Z' },
    { id: 'backup-2', productName: 'IMDS MIS', environment: 'production', backupType: 'snapshot', status: 'completed', provider: 'Supabase', sizeBytes: 7516192768, completedAt: '2026-08-02T02:10:00.000Z', verifiedAt: null, retentionUntil: '2026-11-02T02:10:00.000Z' },
  ],
  restores: [
    { id: 'restore-1', productName: 'IMDS CRM', targetEnvironment: 'staging', status: 'completed', dryRun: true, reason: 'Quarterly restore validation', createdAt: '2026-07-28T11:00:00.000Z' },
  ],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readDemo(): GovernanceSnapshot {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      return clone(defaults);
    }
    return JSON.parse(value) as GovernanceSnapshot;
  } catch {
    return clone(defaults);
  }
}

function writeDemo(snapshot: GovernanceSnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function createId(prefix: string) {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${prefix}-${Date.now()}`;
}

async function listFromSupabase(): Promise<GovernanceSnapshot> {
  const supabase = getSupabase();
  if (!supabase) return readDemo();

  const [policyResult, holdResult, exportResult, deletionResult, backupResult, restoreResult, productsResult, organizationsResult, classificationsResult] = await Promise.all([
    supabase.from('data_retention_policies').select('*').order('created_at', { ascending: false }),
    supabase.from('legal_holds').select('*').order('created_at', { ascending: false }),
    supabase.from('data_export_requests').select('*').order('created_at', { ascending: false }),
    supabase.from('data_deletion_requests').select('*').order('created_at', { ascending: false }),
    supabase.from('backup_assets').select('*').order('created_at', { ascending: false }),
    supabase.from('restore_operations').select('*').order('created_at', { ascending: false }),
    supabase.from('products').select('id,name'),
    supabase.from('organizations').select('id,name'),
    supabase.from('data_classifications').select('id,name'),
  ]);

  const error = policyResult.error ?? holdResult.error ?? exportResult.error ?? deletionResult.error ?? backupResult.error ?? restoreResult.error ?? productsResult.error ?? organizationsResult.error ?? classificationsResult.error;
  if (error) throw error;

  const productNames = new Map((productsResult.data ?? []).map((row: any) => [row.id, row.name]));
  const organizationNames = new Map((organizationsResult.data ?? []).map((row: any) => [row.id, row.name]));
  const classificationNames = new Map((classificationsResult.data ?? []).map((row: any) => [row.id, row.name]));

  return {
    policies: (policyResult.data ?? []).map((row: any) => ({ id: row.id, key: row.key, name: row.name, productName: productNames.get(row.product_id) ?? 'Platform', classificationName: classificationNames.get(row.classification_id) ?? '—', retentionDays: row.retention_days, action: row.action, isActive: row.is_active, nextEvaluationAt: row.next_evaluation_at })),
    holds: (holdResult.data ?? []).map((row: any) => ({ id: row.id, organizationName: organizationNames.get(row.organization_id) ?? row.organization_id, productName: productNames.get(row.product_id) ?? 'All products', reason: row.reason, status: row.status, startsAt: row.starts_at, expiresAt: row.expires_at })),
    exports: (exportResult.data ?? []).map((row: any) => ({ id: row.id, organizationName: organizationNames.get(row.organization_id) ?? row.organization_id, productName: productNames.get(row.product_id) ?? 'All products', classificationName: classificationNames.get(row.classification_id) ?? '—', format: row.export_format, status: row.status, reason: row.reason, createdAt: row.created_at, completedAt: row.completed_at })),
    deletions: (deletionResult.data ?? []).map((row: any) => ({ id: row.id, organizationName: organizationNames.get(row.organization_id) ?? row.organization_id, productName: productNames.get(row.product_id) ?? 'All products', mode: row.deletion_mode, status: row.status, reason: row.reason, scheduledFor: row.scheduled_for, createdAt: row.created_at })),
    backups: (backupResult.data ?? []).map((row: any) => ({ id: row.id, productName: productNames.get(row.product_id) ?? row.product_id, environment: row.environment, backupType: row.backup_type, status: row.status, provider: row.provider, sizeBytes: row.size_bytes, completedAt: row.completed_at, verifiedAt: row.verified_at, retentionUntil: row.retention_until })),
    restores: (restoreResult.data ?? []).map((row: any) => ({ id: row.id, productName: 'Backup restore', targetEnvironment: row.target_environment, status: row.status, dryRun: row.dry_run, reason: row.reason, createdAt: row.created_at })),
  };
}

export const governanceRepository = {
  async list() {
    return listFromSupabase();
  },

  async createDemoExport(input: { organizationName: string; productName: string; reason: string; format: string }) {
    const snapshot = readDemo();
    snapshot.exports.unshift({
      id: createId('export'), organizationName: input.organizationName, productName: input.productName,
      classificationName: 'Restricted data', format: input.format, status: 'pending_approval',
      reason: input.reason, createdAt: new Date().toISOString(), completedAt: null,
    });
    writeDemo(snapshot);
    return snapshot;
  },

  async createDemoDeletion(input: { organizationName: string; productName: string; reason: string; mode: string }) {
    const snapshot = readDemo();
    snapshot.deletions.unshift({
      id: createId('delete'), organizationName: input.organizationName, productName: input.productName,
      mode: input.mode, status: 'pending_approval', reason: input.reason,
      scheduledFor: null, createdAt: new Date().toISOString(),
    });
    writeDemo(snapshot);
    return snapshot;
  },

  async createDemoRestore(input: { productName: string; environment: string; reason: string; dryRun: boolean }) {
    const snapshot = readDemo();
    snapshot.restores.unshift({
      id: createId('restore'), productName: input.productName, targetEnvironment: input.environment,
      status: input.environment === 'production' ? 'pending_approval' : 'approved', dryRun: input.dryRun,
      reason: input.reason, createdAt: new Date().toISOString(),
    });
    writeDemo(snapshot);
    return snapshot;
  },
};
