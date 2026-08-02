import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '../../lib/database.types';

export type ProductCommandType =
  | 'provision_tenant'
  | 'suspend_tenant'
  | 'resume_tenant'
  | 'revoke_tenant'
  | 'sync_entitlements'
  | 'invite_owner';

export type ProductCommandStatus =
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'dead_letter'
  | 'cancelled';

export type WorkflowStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export type OperationsDatabase = {
  public: {
    Tables: {
      product_commands: {
        Row: {
          id: string;
          workflow_run_id: string;
          license_id: string;
          organization_id: string;
          product_id: string;
          adapter_id: string | null;
          endpoint_id: string | null;
          command: ProductCommandType;
          status: ProductCommandStatus;
          idempotency_key: string;
          correlation_id: string;
          payload: Json;
          response: Json | null;
          attempts: number;
          max_attempts: number;
          available_at: string;
          locked_at: string | null;
          locked_by: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      workflow_runs: {
        Row: {
          id: string;
          organization_id: string | null;
          workflow_key: string;
          status: WorkflowStatus;
          input: Json;
          output: Json | null;
          error: string | null;
          created_by: string | null;
          created_at: string;
          finished_at: string | null;
          correlation_id: string;
          idempotency_key: string;
          current_step: string | null;
          attempts: number;
          max_attempts: number;
          scheduled_at: string;
          updated_at: string;
          locked_at: string | null;
          locked_by: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      workflow_events: {
        Row: {
          id: string;
          workflow_run_id: string;
          product_command_id: string | null;
          event_type: string;
          from_status: string | null;
          to_status: string | null;
          message: string | null;
          metadata: Json;
          occurred_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          status: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          key: string;
          name: string;
          status: string;
          archived_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      licenses: {
        Row: {
          id: string;
          organization_id: string;
          product_id: string;
          subscription_id: string | null;
          external_tenant_id: string | null;
          status: string;
          activated_at: string | null;
          expires_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
          suspended_at: string | null;
          revoked_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      retry_product_command: {
        Args: { target_command_id: string; reason_value: string };
        Returns: undefined;
      };
      cancel_product_command: {
        Args: { target_command_id: string; reason_value: string };
        Returns: undefined;
      };
      enqueue_license_command: {
        Args: {
          target_license_id: string;
          command_value: ProductCommandType;
          reason_value: string;
          payload_value?: Json;
        };
        Returns: string;
      };
      enqueue_subscription_provisioning: {
        Args: { target_subscription_id: string; reason_value?: string };
        Returns: number;
      };
    };
    Enums: {
      product_command_type: ProductCommandType;
      product_command_status: ProductCommandStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type OperationsSupabaseClient = SupabaseClient<OperationsDatabase>;
