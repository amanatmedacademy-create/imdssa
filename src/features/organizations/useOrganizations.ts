import { useCallback, useEffect, useState } from 'react';
import {
  organizationRepository,
  type CreateOrganizationInput,
  type Organization,
  type UpdateOrganizationInput,
} from './organizationRepository';

export function useOrganizations() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrganizations(await organizationRepository.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить организации.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = useCallback(async (command: () => Promise<Organization[]>) => {
    setSaving(true);
    setError(null);
    try {
      const next = await command();
      setOrganizations(next);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция не выполнена.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    organizations,
    loading,
    saving,
    error,
    refresh,
    createOrganization: (input: CreateOrganizationInput) => execute(() => organizationRepository.create(input)),
    updateOrganization: (id: string, patch: UpdateOrganizationInput) => execute(() => organizationRepository.update(id, patch)),
    archiveOrganization: (id: string, reason: string) => execute(() => organizationRepository.archive(id, reason)),
    restoreOrganization: (id: string, reason: string) => execute(() => organizationRepository.restore(id, reason)),
  };
}
