import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import './registerCrmProductCatalog';
import {
  moduleRuntimeRepository,
  platformModules,
  type AuthorizationDecision,
  type CompatibilityPreview,
  type DemoOrganization,
  type InstallModuleInput,
  type ModuleInstallation,
  type PlatformBootstrap,
  type PlatformModuleDefinition,
} from './moduleRuntimeRepository';

type RuntimeContextValue = {
  organizations: DemoOrganization[];
  modules: PlatformModuleDefinition[];
  installations: ModuleInstallation[];
  loading: boolean;
  error: string;
  preview: (input: Omit<InstallModuleInput, 'idempotencyKey'>) => Promise<CompatibilityPreview>;
  install: (input: InstallModuleInput) => Promise<ModuleInstallation>;
  suspend: (installationId: string) => Promise<ModuleInstallation>;
  resume: (installationId: string) => Promise<ModuleInstallation>;
  repair: (installationId: string) => Promise<ModuleInstallation>;
  uninstall: (installationId: string) => Promise<ModuleInstallation>;
  bootstrap: (organizationId: string, productCode: string) => Promise<PlatformBootstrap>;
  authorize: (organizationId: string, productCode: string, moduleCode: string, permission: string) => Promise<AuthorizationDecision>;
  refresh: () => Promise<void>;
  reset: () => Promise<void>;
};

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function ModuleRuntimeProvider({ children }: { children: ReactNode }) {
  const [organizations, setOrganizations] = useState<DemoOrganization[]>([]);
  const [installations, setInstallations] = useState<ModuleInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const snapshot = await moduleRuntimeRepository.snapshot();
      setOrganizations(snapshot.organizations);
      setInstallations(snapshot.installations);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить локальный runtime.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const execute = async (action: () => Promise<ModuleInstallation>) => {
    setError('');
    const result = await action();
    await refresh();
    return result;
  };

  const value = useMemo<RuntimeContextValue>(() => ({
    organizations,
    modules: platformModules,
    installations,
    loading,
    error,
    preview: (input) => moduleRuntimeRepository.preview(input),
    install: (input) => execute(() => moduleRuntimeRepository.install(input)),
    suspend: (installationId) => execute(() => moduleRuntimeRepository.setState(installationId, 'suspend')),
    resume: (installationId) => execute(() => moduleRuntimeRepository.setState(installationId, 'resume')),
    repair: (installationId) => execute(() => moduleRuntimeRepository.setState(installationId, 'repair')),
    uninstall: (installationId) => execute(() => moduleRuntimeRepository.setState(installationId, 'uninstall')),
    bootstrap: (organizationId, productCode) => moduleRuntimeRepository.bootstrap(organizationId, productCode),
    authorize: (organizationId, productCode, moduleCode, permission) => moduleRuntimeRepository.authorize(organizationId, productCode, moduleCode, permission),
    refresh,
    reset: async () => {
      await moduleRuntimeRepository.reset();
      await refresh();
    },
  }), [organizations, installations, loading, error]);

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useModuleRuntime() {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useModuleRuntime must be used inside ModuleRuntimeProvider');
  return value;
}
