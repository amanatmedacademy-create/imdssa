export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OrganizationStatus = 'lead' | 'demo' | 'onboarding' | 'trial' | 'active' | 'past_due' | 'grace_period' | 'suspended' | 'archived';
export type GlobalRole = 'platform_owner' | 'super_admin' | 'support_admin' | 'finance_admin' | 'technical_admin' | 'sales_manager' | 'auditor';
export type ProductStatus = 'draft' | 'active' | 'degraded' | 'maintenance' | 'disabled';

export type Database = {
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
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          global_role?: GlobalRole | null;
          mfa_enforced?: boolean;
          is_active?: boolean;
          last_seen_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['platform_users']['Insert']>;
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          holding_id: string | null;
          name: string;
          slug: string;
          status: OrganizationStatus;
          country_code: string;
          city: string | null;
          owner_user_id: string | null;
          customer_health: number;
          metadata: Json;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          holding_id?: string | null;
          name: string;
          slug: string;
          status?: OrganizationStatus;
          country_code?: string;
          city?: string | null;
          owner_user_id?: string | null;
          customer_health?: number;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>;
        Relationships: [];
      };
      legal_entities: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          bin: string | null;
          is_primary: boolean;
          billing_details: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          bin?: string | null;
          is_primary?: boolean;
          billing_details?: Json;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['legal_entities']['Insert']>;
        Relationships: [];
      };
      branches: {
        Row: {
          id: string;
          organization_id: string;
          legal_entity_id: string | null;
          name: string;
          city: string | null;
          address: string | null;
          timezone: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          legal_entity_id?: string | null;
          name: string;
          city?: string | null;
          address?: string | null;
          timezone?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['branches']['Insert']>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          key: string;
          name: string;
          description: string | null;
          status: ProductStatus;
          current_version: string | null;
          api_base_url: string | null;
          healthcheck_url: string | null;
          adapter_key: string | null;
          metadata: Json;
          is_system: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          name: string;
          description?: string | null;
          status?: ProductStatus;
          current_version?: string | null;
          api_base_url?: string | null;
          healthcheck_url?: string | null;
          adapter_key?: string | null;
          metadata?: Json;
          is_system?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_organization_with_structure: {
        Args: {
          organization_name: string;
          organization_slug: string;
          organization_city?: string | null;
          legal_entity_name?: string | null;
          legal_entity_bin?: string | null;
          branch_name?: string | null;
          branch_address?: string | null;
        };
        Returns: string;
      };
      archive_organization: { Args: { target_organization_id: string; reason: string }; Returns: undefined };
      restore_organization: { Args: { target_organization_id: string; reason: string }; Returns: undefined };
      archive_product: { Args: { target_product_id: string }; Returns: undefined };
      restore_product: { Args: { target_product_id: string }; Returns: undefined };
      delete_custom_product: { Args: { target_product_id: string }; Returns: undefined };
    };
    Enums: {
      organization_status: OrganizationStatus;
      global_role: GlobalRole;
      product_status: ProductStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
