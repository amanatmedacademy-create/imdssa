import type { Json, OrganizationStatus } from '../../lib/database.types';
import { getSupabase } from '../../lib/supabase';

export type Organization = {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  countryCode: string;
  city: string;
  customerHealth: number;
  ownerName: string;
  ownerEmail: string;
  primaryBin: string;
  legalEntities: number;
  branches: number;
  products: number;
  users: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateOrganizationInput = {
  name: string;
  slug: string;
  city: string;
  ownerName: string;
  ownerEmail: string;
  legalEntityName: string;
  bin: string;
  branchName: string;
  branchAddress: string;
};

export type UpdateOrganizationInput = Partial<Pick<Organization, 'name' | 'slug' | 'city' | 'status' | 'customerHealth' | 'ownerName' | 'ownerEmail'>>;

const STORAGE_KEY = 'imds-super-admin:organizations:v1';

const demoOrganizations: Organization[] = [
  {
    id: 'org-amanat',
    name: 'Amanat Medical Center',
    slug: 'amanat-medical-center',
    status: 'active',
    countryCode: 'KZ',
    city: 'Алматы',
    customerHealth: 94,
    ownerName: 'Владелец Amanat',
    ownerEmail: 'owner@amanat-med.kz',
    primaryBin: '220740012345',
    legalEntities: 2,
    branches: 3,
    products: 6,
    users: 84,
    createdAt: '2026-01-15T09:00:00.000Z',
    updatedAt: '2026-08-01T12:30:00.000Z',
    archivedAt: null,
  },
  {
    id: 'org-orda',
    name: 'Orda Clinic',
    slug: 'orda-clinic',
    status: 'trial',
    countryCode: 'KZ',
    city: 'Астана',
    customerHealth: 82,
    ownerName: 'Айгуль С.',
    ownerEmail: 'owner@orda-clinic.kz',
    primaryBin: '230140009876',
    legalEntities: 1,
    branches: 2,
    products: 4,
    users: 31,
    createdAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-08-02T08:15:00.000Z',
    archivedAt: null,
  },
  {
    id: 'org-sapa',
    name: 'Sapa Med',
    slug: 'sapa-med',
    status: 'past_due',
    countryCode: 'KZ',
    city: 'Шымкент',
    customerHealth: 68,
    ownerName: 'Сапар М.',
    ownerEmail: 'director@sapamed.kz',
    primaryBin: '210940004321',
    legalEntities: 1,
    branches: 1,
    products: 3,
    users: 22,
    createdAt: '2026-03-18T07:30:00.000Z',
    updatedAt: '2026-07-30T16:00:00.000Z',
    archivedAt: null,
  },
  {
    id: 'org-nova',
    name: 'Nova Health',
    slug: 'nova-health',
    status: 'onboarding',
    countryCode: 'KZ',
    city: 'Алматы',
    customerHealth: 57,
    ownerName: 'Дана К.',
    ownerEmail: 'dana@novahealth.kz',
    primaryBin: '240540006789',
    legalEntities: 1,
    branches: 1,
    products: 2,
    users: 12,
    createdAt: '2026-07-22T11:45:00.000Z',
    updatedAt: '2026-08-02T09:10:00.000Z',
    archivedAt: null,
  },
];

function readDemoOrganizations(): Organization[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return demoOrganizations;
    const parsed = JSON.parse(stored) as Organization[];
    return Array.isArray(parsed) ? parsed : demoOrganizations;
  } catch {
    return demoOrganizations;
  }
}

function writeDemoOrganizations(organizations: Organization[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(organizations));
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `org-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getMetadataText(metadata: Json, key: string): string {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return '';
  const value = metadata[key];
  return typeof value === 'string' ? value : '';
}

async function listFromSupabase(): Promise<Organization[]> {
  const supabase = getSupabase();
  if (!supabase) return readDemoOrganizations();

  const { data: organizations, error } = await supabase
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!organizations.length) return [];

  const ids = organizations.map((organization) => organization.id);
  const [{ data: legalEntities, error: legalError }, { data: branches, error: branchError }] = await Promise.all([
    supabase.from('legal_entities').select('organization_id, bin, is_primary').in('organization_id', ids),
    supabase.from('branches').select('organization_id, is_active').in('organization_id', ids),
  ]);

  if (legalError) throw legalError;
  if (branchError) throw branchError;

  return organizations.map((organization) => {
    const organizationLegalEntities = legalEntities.filter((item) => item.organization_id === organization.id);
    const organizationBranches = branches.filter((item) => item.organization_id === organization.id && item.is_active);
    const primaryLegalEntity = organizationLegalEntities.find((item) => item.is_primary) ?? organizationLegalEntities[0];

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      countryCode: organization.country_code,
      city: organization.city ?? '',
      customerHealth: organization.customer_health,
      ownerName: getMetadataText(organization.metadata, 'owner_name'),
      ownerEmail: getMetadataText(organization.metadata, 'owner_email'),
      primaryBin: primaryLegalEntity?.bin ?? '',
      legalEntities: organizationLegalEntities.length,
      branches: organizationBranches.length,
      products: Number(getMetadataText(organization.metadata, 'products_count')) || 0,
      users: Number(getMetadataText(organization.metadata, 'users_count')) || 0,
      createdAt: organization.created_at,
      updatedAt: organization.updated_at,
      archivedAt: organization.archived_at,
    };
  });
}

async function createInSupabase(input: CreateOrganizationInput): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('create_organization_with_structure', {
    organization_name: input.name,
    organization_slug: input.slug,
    organization_city: input.city || null,
    legal_entity_name: input.legalEntityName || input.name,
    legal_entity_bin: input.bin || null,
    branch_name: input.branchName || 'Главный филиал',
    branch_address: input.branchAddress || null,
  });

  if (error) throw error;

  const { error: metadataError } = await supabase
    .from('organizations')
    .update({
      metadata: {
        owner_name: input.ownerName,
        owner_email: input.ownerEmail,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', data);

  if (metadataError) throw metadataError;
  return data;
}

export const organizationRepository = {
  async list(): Promise<Organization[]> {
    return listFromSupabase();
  },

  async create(input: CreateOrganizationInput): Promise<Organization[]> {
    const supabase = getSupabase();
    if (supabase) {
      await createInSupabase(input);
      return listFromSupabase();
    }

    const organizations = readDemoOrganizations();
    const now = new Date().toISOString();
    const next: Organization = {
      id: createId(),
      name: input.name,
      slug: input.slug,
      status: 'onboarding',
      countryCode: 'KZ',
      city: input.city,
      customerHealth: 100,
      ownerName: input.ownerName,
      ownerEmail: input.ownerEmail,
      primaryBin: input.bin,
      legalEntities: 1,
      branches: 1,
      products: 0,
      users: input.ownerEmail ? 1 : 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    const result = [next, ...organizations];
    writeDemoOrganizations(result);
    return result;
  },

  async update(id: string, patch: UpdateOrganizationInput): Promise<Organization[]> {
    const supabase = getSupabase();
    if (supabase) {
      const current = (await listFromSupabase()).find((organization) => organization.id === id);
      if (!current) throw new Error('Организация не найдена.');

      const metadata: Json = {
        owner_name: patch.ownerName ?? current.ownerName,
        owner_email: patch.ownerEmail ?? current.ownerEmail,
      };

      const { error } = await supabase
        .from('organizations')
        .update({
          name: patch.name,
          slug: patch.slug,
          city: patch.city,
          status: patch.status,
          customer_health: patch.customerHealth,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
      return listFromSupabase();
    }

    const result = readDemoOrganizations().map((organization) => organization.id === id
      ? { ...organization, ...patch, updatedAt: new Date().toISOString() }
      : organization);
    writeDemoOrganizations(result);
    return result;
  },

  async archive(id: string, reason: string): Promise<Organization[]> {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.rpc('archive_organization', { target_organization_id: id, reason });
      if (error) throw error;
      return listFromSupabase();
    }

    const now = new Date().toISOString();
    const result = readDemoOrganizations().map((organization) => organization.id === id
      ? { ...organization, status: 'archived' as const, archivedAt: now, updatedAt: now }
      : organization);
    writeDemoOrganizations(result);
    return result;
  },

  async restore(id: string, reason: string): Promise<Organization[]> {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase.rpc('restore_organization', { target_organization_id: id, reason });
      if (error) throw error;
      return listFromSupabase();
    }

    const now = new Date().toISOString();
    const result = readDemoOrganizations().map((organization) => organization.id === id
      ? { ...organization, status: 'onboarding' as const, archivedAt: null, updatedAt: now }
      : organization);
    writeDemoOrganizations(result);
    return result;
  },
};
