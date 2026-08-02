export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OrganizationStatus = 'lead' | 'demo' | 'onboarding' | 'trial' | 'active' | 'past_due' | 'grace_period' | 'suspended' | 'archived';
export type GlobalRole = 'platform_owner' | 'super_admin' | 'support_admin' | 'finance_admin' | 'technical_admin' | 'sales_manager' | 'auditor';
export type ProductStatus = 'draft' | 'active' | 'degraded' | 'maintenance' | 'disabled';
export type ProductAdapterStatus = 'draft' | 'active' | 'degraded' | 'disabled';
export type ProductAdapterProtocol = 'rest' | 'graphql' | 'worker' | 'internal';
export type ProductEndpointEnvironment = 'development' | 'staging' | 'production' | 'demo';
export type ProductEndpointStatus = 'draft' | 'active' | 'maintenance' | 'disabled';
export type ProductAuthMode = 'none' | 'service_token' | 'oauth2' | 'signed_request';
export type ProductHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'unavailable';

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
        };
        Insert: {
          id?: string;
          organization_id: string;
          product_id: string;
          subscription_id?: string | null;
          external_tenant_id?: string | null;
          status?: string;
          activated_at?: string | null;
          expires_at?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['licenses']['Insert']>;
        Relationships: [];
      };
      product_adapters: {
        Row: {
          id: string;
          product_id: string;
          adapter_key: string;
          contract_version: string;
          protocol: ProductAdapterProtocol;
          status: ProductAdapterStatus;
          capabilities: string[];
          config: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          adapter_key: string;
          contract_version?: string;
          protocol?: ProductAdapterProtocol;
          status?: ProductAdapterStatus;
          capabilities?: string[];
          config?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['product_adapters']['Insert']>;
        Relationships: [];
      };
      product_endpoints: {
        Row: {
          id: string;
          adapter_id: string;
          environment: ProductEndpointEnvironment;
          base_url: string | null;
          healthcheck_url: string | null;
          auth_mode: ProductAuthMode;
          secret_reference: string | null;
          timeout_ms: number;
          status: ProductEndpointStatus;
          last_checked_at: string | null;
          last_health_status: ProductHealthStatus;
          last_latency_ms: number | null;
          last_error: string | null;
          config: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          adapter_id: string;
          environment: ProductEndpointEnvironment;
          base_url?: string | null;
          healthcheck_url?: string | null;
          auth_mode?: ProductAuthMode;
          secret_reference?: string | null;
          timeout_ms?: number;
          status?: ProductEndpointStatus;
          last_checked_at?: string | null;
          last_health_status?: ProductHealthStatus;
          last_latency_ms?: number | null;
          last_error?: string | null;
          config?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['product_endpoints']['Insert']>;
        Relationships: [];
      };
      product_health_checks: {
        Row: {
          id: string;
          endpoint_id: string;
          checked_at: string;
          status: ProductHealthStatus;
          latency_ms: number | null;
          http_status: number | null;
          error: string | null;
          metadata: Json;
        };
        Insert: {
          id?: string;
          endpoint_id: string;
          checked_at?: string;
          status: ProductHealthStatus;
          latency_ms?: number | null;
          http_status?: number | null;
          error?: string | null;
          metadata?: Json;
        };
        Update: Partial<Database['public']['Tables']['product_health_checks']['Insert']>;
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
      upsert_product_definition: {
        Args: {
          product_key: string;
          product_name: string;
          product_description?: string | null;
          product_status?: ProductStatus;
          product_version?: string | null;
          target_product_id?: string | null;
        };
        Returns: string;
      };
      configure_product_adapter: {
        Args: {
          target_product_id: string;
          adapter_key_value: string;
          contract_version_value?: string;
          protocol_value?: ProductAdapterProtocol;
          adapter_status_value?: ProductAdapterStatus;
          capabilities_value?: string[];
          endpoint_environment_value?: ProductEndpointEnvironment;
          endpoint_base_url_value?: string | null;
          endpoint_healthcheck_url_value?: string | null;
          endpoint_auth_mode_value?: ProductAuthMode;
          endpoint_secret_reference_value?: string | null;
          endpoint_timeout_ms_value?: number;
          endpoint_status_value?: ProductEndpointStatus;
        };
        Returns: string;
      };
      record_product_health: {
        Args: {
          target_endpoint_id: string;
          health_status_value: ProductHealthStatus;
          latency_ms_value?: number | null;
          http_status_value?: number | null;
          error_value?: string | null;
          metadata_value?: Json;
        };
        Returns: string;
      };
    };
    Enums: {
      organization_status: OrganizationStatus;
      global_role: GlobalRole;
      product_status: ProductStatus;
      product_adapter_status: ProductAdapterStatus;
      product_adapter_protocol: ProductAdapterProtocol;
      product_endpoint_environment: ProductEndpointEnvironment;
      product_endpoint_status: ProductEndpointStatus;
      product_auth_mode: ProductAuthMode;
      product_health_status: ProductHealthStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
