import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlobalRole, Json } from '../../lib/database.types';

export type ApprovalRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export type ApprovalDecision = 'approved' | 'rejected';
export type PrivilegedSessionType = 'support_impersonation' | 'break_glass' | 'maintenance';
export type PrivilegedSessionStatus = 'approved' | 'active' | 'expired' | 'revoked' | 'ended' | 'failed';
export type SecurityNotificationStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

export type AuditVerificationResult = {
  scope_key: string;
  checked_events: number;
  is_valid: boolean;
  first_invalid_sequence: number | null;
  message: string;
};

export type SecurityDatabase = {
  public: {
    Tables: {
      approval_policies: {
        Row: {
          key: string;
          title: string;
          description: string | null;
          risk_level: ApprovalRiskLevel;
          required_approvals: number;
          requester_roles: GlobalRole[];
          approver_roles: GlobalRole[];
          max_duration_minutes: number;
          approval_ttl_minutes: number;
          organization_required: boolean;
          product_required: boolean;
          mfa_required: boolean;
          client_notification_required: boolean;
          is_active: boolean;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      approval_requests: {
        Row: {
          id: string;
          workflow_run_id: string | null;
          action_key: string;
          policy_key: string | null;
          organization_id: string | null;
          product_id: string | null;
          resource_type: string | null;
          resource_id: string | null;
          requested_by: string;
          requester_role: GlobalRole | null;
          reviewed_by: string | null;
          status: ApprovalRequestStatus;
          reason: string;
          decision_note: string | null;
          risk_level: ApprovalRiskLevel;
          required_approvals: number;
          approvals_received: number;
          requested_duration_minutes: number | null;
          requested_payload: Json;
          idempotency_key: string | null;
          correlation_id: string;
          execution_status: string;
          expires_at: string | null;
          created_at: string;
          decided_at: string | null;
          executed_at: string | null;
          cancelled_at: string | null;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      approval_request_decisions: {
        Row: {
          id: string;
          approval_request_id: string;
          reviewer_user_id: string;
          reviewer_role: GlobalRole;
          decision: ApprovalDecision;
          note: string;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      privileged_access_sessions: {
        Row: {
          id: string;
          approval_request_id: string;
          session_type: PrivilegedSessionType;
          actor_user_id: string;
          organization_id: string;
          product_id: string | null;
          target_user_id: string | null;
          scope: string[];
          read_only: boolean;
          status: PrivilegedSessionStatus;
          reason: string;
          requested_duration_minutes: number;
          started_at: string | null;
          expires_at: string | null;
          ended_at: string | null;
          ended_by: string | null;
          end_reason: string | null;
          client_notification_required: boolean;
          client_notified_at: string | null;
          last_heartbeat_at: string | null;
          external_session_reference: string | null;
          correlation_id: string;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      privileged_session_events: {
        Row: {
          id: string;
          session_id: string;
          event_type: string;
          actor_user_id: string | null;
          payload: Json;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      security_notification_outbox: {
        Row: {
          id: string;
          organization_id: string;
          privileged_session_id: string | null;
          notification_key: string;
          channel: string;
          recipient_reference: string | null;
          payload: Json;
          status: SecurityNotificationStatus;
          attempt_count: number;
          available_at: string;
          locked_at: string | null;
          locked_by: string | null;
          sent_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: string;
          occurred_at: string;
          actor_user_id: string | null;
          organization_id: string | null;
          action: string;
          resource_type: string;
          resource_id: string | null;
          reason: string | null;
          ip: string | null;
          user_agent: string | null;
          before_state: Json | null;
          after_state: Json | null;
          correlation_id: string | null;
          hash: string;
          scope_key: string | null;
          sequence_number: number | null;
          previous_hash: string | null;
          integrity_version: number;
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
          archived_at: string | null;
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
      platform_users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          global_role: GlobalRole | null;
          mfa_enforced: boolean;
          is_active: boolean;
          last_seen_at: string | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      request_security_approval: {
        Args: {
          policy_key_value: string;
          reason_value: string;
          organization_id_value: string | null;
          product_id_value: string | null;
          resource_type_value: string | null;
          resource_id_value: string | null;
          requested_duration_minutes_value: number | null;
          payload_value: Json;
          idempotency_key_value: string | null;
        };
        Returns: string;
      };
      decide_security_approval: {
        Args: {
          approval_request_id_value: string;
          decision_value: ApprovalDecision;
          note_value: string;
        };
        Returns: string;
      };
      cancel_security_approval: {
        Args: {
          approval_request_id_value: string;
          reason_value: string;
        };
        Returns: undefined;
      };
      activate_privileged_access_session: {
        Args: { session_id_value: string };
        Returns: undefined;
      };
      end_privileged_access_session: {
        Args: { session_id_value: string; reason_value: string };
        Returns: undefined;
      };
      revoke_privileged_access_session: {
        Args: { session_id_value: string; reason_value: string };
        Returns: undefined;
      };
      heartbeat_privileged_access_session: {
        Args: { session_id_value: string };
        Returns: string;
      };
      mark_privileged_session_client_notified: {
        Args: { session_id_value: string };
        Returns: undefined;
      };
      expire_security_controls: {
        Args: Record<string, never>;
        Returns: Json;
      };
      verify_audit_chain: {
        Args: { target_scope_key: string | null };
        Returns: AuditVerificationResult[];
      };
    };
    Enums: {
      global_role: GlobalRole;
      approval_risk_level: ApprovalRiskLevel;
      approval_decision: ApprovalDecision;
      privileged_session_type: PrivilegedSessionType;
      privileged_session_status: PrivilegedSessionStatus;
      security_notification_status: SecurityNotificationStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type SecuritySupabaseClient = SupabaseClient<SecurityDatabase>;
