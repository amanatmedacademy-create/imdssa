import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlobalRole, Json } from '../../lib/database.types';

export type IdentityInvitationStatus = 'pending' | 'sent' | 'accepted' | 'expired' | 'cancelled' | 'failed';

export type IdentityDatabase = {
  public: {
    Tables: {
      platform_users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          global_role: GlobalRole | null;
          mfa_enforced: boolean;
          is_active: boolean;
          last_seen_at: string | null;
          locale: string;
          timezone: string;
          metadata: Json;
          created_at: string;
          updated_at: string;
          deactivated_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      memberships: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string | null;
          user_id: string;
          role_key: string;
          product_scopes: string[];
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deactivated_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      platform_user_invitations: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          global_role: GlobalRole | null;
          organization_id: string | null;
          branch_id: string | null;
          membership_role_key: string | null;
          product_scopes: string[];
          status: IdentityInvitationStatus;
          auth_user_id: string | null;
          redirect_to: string | null;
          expires_at: string;
          invited_by: string;
          accepted_at: string | null;
          cancelled_at: string | null;
          last_error: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
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
      branches: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          city: string | null;
          is_active: boolean;
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
    };
    Views: Record<string, never>;
    Functions: {
      set_platform_user_access: {
        Args: {
          target_user_id: string;
          full_name_value: string;
          global_role_value: GlobalRole | null;
          mfa_enforced_value: boolean;
          is_active_value: boolean;
          reason_value: string;
        };
        Returns: undefined;
      };
      upsert_user_membership: {
        Args: {
          target_user_id: string;
          organization_id_value: string;
          branch_id_value: string | null;
          role_key_value: string;
          product_scopes_value: string[];
          is_active_value: boolean;
          reason_value: string;
        };
        Returns: string;
      };
      accept_my_identity_invitation: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
    Enums: {
      global_role: GlobalRole;
      identity_invitation_status: IdentityInvitationStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type IdentitySupabaseClient = SupabaseClient<IdentityDatabase>;
