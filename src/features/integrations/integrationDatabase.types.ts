import type { SupabaseClient } from '@supabase/supabase-js';

export type IntegrationProviderStatus = 'draft' | 'active' | 'degraded' | 'disabled';
export type IntegrationConnectionStatus = 'disconnected' | 'configuring' | 'connected' | 'degraded' | 'error' | 'suspended' | 'revoked';
export type IntegrationAuthType = 'oauth2' | 'api_key' | 'service_token' | 'hmac' | 'basic' | 'none';
export type IntegrationEnvironment = 'sandbox' | 'staging' | 'production';
export type IntegrationJobType = 'test_connection' | 'sync' | 'incremental_sync' | 'full_sync' | 'refresh_token' | 'disconnect' | 'process_webhook';
export type IntegrationJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled';
export type InboundWebhookEventStatus = 'received' | 'verified' | 'queued' | 'processing' | 'processed' | 'duplicate' | 'rejected' | 'failed' | 'dead_letter';
export type OutboundWebhookSubscriptionStatus = 'active' | 'paused' | 'disabled';
export type OutboundWebhookDeliveryStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled';
export type ApiClientStatus = 'active' | 'suspended' | 'revoked' | 'expired';
export type WebhookVerificationMode = 'none' | 'hmac_sha256' | 'hmac_sha1' | 'bearer_token' | 'query_token' | 'meta_verify_token';

// This feature is intentionally isolated from the generated global Database type.
// Its migration evolves independently and the repository maps database rows into
// strict domain models before they reach the UI.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IntegrationSupabaseClient = SupabaseClient<any>;
