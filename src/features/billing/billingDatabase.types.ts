import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json, OrganizationStatus, ProductStatus } from '../../lib/database.types';

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'grace_period' | 'suspended' | 'cancelled' | 'expired';
export type BillingInterval = 'monthly' | 'annual' | 'custom';
export type RenewalMode = 'manual' | 'automatic';

export type BillingDatabase = {
  public: {
    Tables: {
      tariffs: {
        Row: {
          id: string;
          product_id: string | null;
          code: string;
          name: string;
          description: string | null;
          currency: string;
          monthly_price: number;
          annual_price: number | null;
          trial_days: number;
          grace_days: number;
          is_custom: boolean;
          is_active: boolean;
          limits: Json;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      tariff_products: {
        Row: {
          id: string;
          tariff_id: string;
          product_id: string;
          included: boolean;
          limits: Json;
          entitlements: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          organization_id: string;
          tariff_id: string | null;
          status: SubscriptionStatus;
          starts_at: string;
          trial_ends_at: string | null;
          current_period_ends_at: string | null;
          grace_ends_at: string | null;
          cancelled_at: string | null;
          custom_price: number | null;
          billing_interval: BillingInterval;
          renewal_mode: RenewalMode;
          activated_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
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
      entitlements: {
        Row: {
          id: string;
          license_id: string;
          key: string;
          value: Json;
          source: string;
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
        Insert: Record<string, never>;
        Update: Record<string, never>;
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
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      upsert_tariff_definition: {
        Args: {
          tariff_code: string;
          tariff_name: string;
          tariff_description?: string | null;
          currency_value?: string;
          monthly_price_value?: number;
          annual_price_value?: number | null;
          trial_days_value?: number;
          grace_days_value?: number;
          is_custom_value?: boolean;
          is_active_value?: boolean;
          target_tariff_id?: string | null;
        };
        Returns: string;
      };
      set_tariff_products: {
        Args: { target_tariff_id: string; product_ids: string[] };
        Returns: undefined;
      };
      activate_subscription: {
        Args: {
          target_organization_id: string;
          target_tariff_id: string;
          billing_interval_value?: BillingInterval;
          renewal_mode_value?: RenewalMode;
          starts_at_value?: string;
          custom_price_value?: number | null;
          selected_product_ids?: string[] | null;
        };
        Returns: string;
      };
      transition_subscription: {
        Args: { target_subscription_id: string; new_status: SubscriptionStatus; reason: string };
        Returns: undefined;
      };
      set_license_entitlement: {
        Args: { target_license_id: string; entitlement_key: string; entitlement_value: Json; reason: string };
        Returns: undefined;
      };
    };
    Enums: {
      billing_interval: BillingInterval;
      renewal_mode: RenewalMode;
      subscription_status: SubscriptionStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type BillingSupabaseClient = SupabaseClient<BillingDatabase>;
