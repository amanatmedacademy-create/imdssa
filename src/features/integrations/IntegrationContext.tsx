import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Json } from '../../lib/database.types';
import type {
  InboundWebhookEndpoint,
  ApiClientInput,
  ConnectionInput,
  EndpointInput,
  IntegrationMutationResult,
  IntegrationSnapshot,
  OneTimeCredential,
  OutboundSubscriptionInput,
  ProviderInput,
} from './integrationRepository';
import { integrationRepository } from './integrationRepository';
import type {
  IntegrationConnectionStatus,
  IntegrationJobType,
  OutboundWebhookSubscriptionStatus,
} from './integrationDatabase.types';

const emptySnapshot: IntegrationSnapshot = {
  providers: [],
  connections: [],
  endpoints: [],
  events: [],
  jobs: [],
  outboundSubscriptions: [],
  deliveries: [],
  apiClients: [],
  apiLogs: [],
  organizations: [],
  products: [],
  scopes: [],
};

type IntegrationContextValue = IntegrationSnapshot & {
  loading: boolean;
  saving: boolean;
  error: string | null;
  oneTimeCredential: OneTimeCredential | null;
  refresh: () => Promise<void>;
  clearCredential: () => void;
  saveProvider: (input: ProviderInput) => Promise<boolean>;
  archiveProvider: (providerId: string, reason: string) => Promise<boolean>;
  saveConnection: (input: ConnectionInput) => Promise<boolean>;
  setConnectionStatus: (connectionId: string, status: IntegrationConnectionStatus, reason: string) => Promise<boolean>;
  enqueueJob: (connectionId: string, jobType: IntegrationJobType, payload: Json, reason: string) => Promise<boolean>;
  retryJob: (jobId: string, reason: string) => Promise<boolean>;
  cancelJob: (jobId: string, reason: string) => Promise<boolean>;
  createEndpoint: (input: EndpointInput) => Promise<boolean>;
  rotateEndpointToken: (endpointId: string, reason: string) => Promise<boolean>;
  setEndpointStatus: (endpointId: string, status: InboundWebhookEndpoint['status'], reason: string) => Promise<boolean>;
  createOutboundSubscription: (input: OutboundSubscriptionInput) => Promise<boolean>;
  setOutboundStatus: (subscriptionId: string, status: OutboundWebhookSubscriptionStatus, reason: string) => Promise<boolean>;
  retryDelivery: (deliveryId: string, reason: string) => Promise<boolean>;
  createApiClient: (input: ApiClientInput) => Promise<boolean>;
  revokeApiClient: (clientId: string, reason: string) => Promise<boolean>;
};

const IntegrationContext = createContext<IntegrationContextValue | null>(null);

export function IntegrationProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oneTimeCredential, setOneTimeCredential] = useState<OneTimeCredential | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await integrationRepository.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить Integration Registry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = useCallback(async (command: () => Promise<IntegrationSnapshot>) => {
    setSaving(true);
    setError(null);
    try {
      setSnapshot(await command());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция Integration Registry не выполнена.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const executeWithCredential = useCallback(async (command: () => Promise<IntegrationMutationResult>) => {
    setSaving(true);
    setError(null);
    try {
      const result = await command();
      setSnapshot(result.snapshot);
      if (result.credential) setOneTimeCredential(result.credential);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция Integration Registry не выполнена.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo<IntegrationContextValue>(() => ({
    ...snapshot,
    loading,
    saving,
    error,
    oneTimeCredential,
    refresh,
    clearCredential: () => setOneTimeCredential(null),
    saveProvider: (input) => execute(() => integrationRepository.saveProvider(input)),
    archiveProvider: (providerId, reason) => execute(() => integrationRepository.archiveProvider(providerId, reason)),
    saveConnection: (input) => execute(() => integrationRepository.saveConnection(input)),
    setConnectionStatus: (connectionId, status, reason) => execute(() => integrationRepository.setConnectionStatus(connectionId, status, reason)),
    enqueueJob: (connectionId, jobType, payload, reason) => execute(() => integrationRepository.enqueueJob(connectionId, jobType, payload, reason)),
    retryJob: (jobId, reason) => execute(() => integrationRepository.retryJob(jobId, reason)),
    cancelJob: (jobId, reason) => execute(() => integrationRepository.cancelJob(jobId, reason)),
    createEndpoint: (input) => executeWithCredential(() => integrationRepository.createEndpoint(input)),
    rotateEndpointToken: (endpointId, reason) => executeWithCredential(() => integrationRepository.rotateEndpointToken(endpointId, reason)),
    setEndpointStatus: (endpointId, status, reason) => execute(() => integrationRepository.setEndpointStatus(endpointId, status, reason)),
    createOutboundSubscription: (input) => execute(() => integrationRepository.createOutboundSubscription(input)),
    setOutboundStatus: (subscriptionId, status, reason) => execute(() => integrationRepository.setOutboundStatus(subscriptionId, status, reason)),
    retryDelivery: (deliveryId, reason) => execute(() => integrationRepository.retryDelivery(deliveryId, reason)),
    createApiClient: (input) => executeWithCredential(() => integrationRepository.createApiClient(input)),
    revokeApiClient: (clientId, reason) => execute(() => integrationRepository.revokeApiClient(clientId, reason)),
  }), [error, execute, executeWithCredential, loading, oneTimeCredential, refresh, saving, snapshot]);

  return <IntegrationContext.Provider value={value}>{children}</IntegrationContext.Provider>;
}

export function useIntegrations(): IntegrationContextValue {
  const context = useContext(IntegrationContext);
  if (!context) throw new Error('useIntegrations must be used inside IntegrationProvider.');
  return context;
}
