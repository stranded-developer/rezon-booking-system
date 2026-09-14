export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_staff_id: string | null
          after: Json | null
          approver_staff_id: string | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          ip: unknown
          reason: string | null
        }
        Insert: {
          action: string
          actor_staff_id?: string | null
          after?: Json | null
          approver_staff_id?: string | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: never
          ip?: unknown
          reason?: string | null
        }
        Update: {
          action?: string
          actor_staff_id?: string | null
          after?: Json | null
          approver_staff_id?: string | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
          ip?: unknown
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_approver_staff_id_fkey"
            columns: ["approver_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cancel_reason: string | null
          cancel_token_hash: string | null
          cancelled_at: string | null
          cancelled_by_staff_id: string | null
          created_at: string
          customer_id: string
          free_minutes_used: number
          gst_cents: number | null
          hold_expires_at: string | null
          id: string
          member_id: string | null
          period: unknown
          pricing_snapshot: Json | null
          ref: string
          referral_code_id: string | null
          refund_cents: number | null
          resource_id: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          total_cents: number | null
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancel_token_hash?: string | null
          cancelled_at?: string | null
          cancelled_by_staff_id?: string | null
          created_at?: string
          customer_id: string
          free_minutes_used?: number
          gst_cents?: number | null
          hold_expires_at?: string | null
          id?: string
          member_id?: string | null
          period: unknown
          pricing_snapshot?: Json | null
          ref?: string
          referral_code_id?: string | null
          refund_cents?: number | null
          resource_id: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          total_cents?: number | null
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancel_token_hash?: string | null
          cancelled_at?: string | null
          cancelled_by_staff_id?: string | null
          created_at?: string
          customer_id?: string
          free_minutes_used?: number
          gst_cents?: number | null
          hold_expires_at?: string | null
          id?: string
          member_id?: string | null
          period?: unknown
          pricing_snapshot?: Json | null
          ref?: string
          referral_code_id?: string | null
          refund_cents?: number | null
          resource_id?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          total_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_cancelled_by_staff_id_fkey"
            columns: ["cancelled_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_balances"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "bookings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_referral_code_id_fkey"
            columns: ["referral_code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          kind: string
          payment_id: string | null
          reason: string | null
          refund_id: string | null
          shift_id: string
          staff_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          kind: string
          payment_id?: string | null
          reason?: string | null
          refund_id?: string | null
          shift_id: string
          staff_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          kind?: string
          payment_id?: string | null
          reason?: string | null
          refund_id?: string | null
          shift_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          created_at: string
          entity: string | null
          entity_id: string | null
          error: string | null
          id: string
          provider_id: string | null
          status: string
          template: string
          to_address: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          error?: string | null
          id?: string
          provider_id?: string | null
          status?: string
          template: string
          to_address: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          error?: string | null
          id?: string
          provider_id?: string | null
          status?: string
          template?: string
          to_address?: string
          updated_at?: string
        }
        Relationships: []
      }
      happy_hours: {
        Row: {
          active: boolean
          created_at: string
          days_of_week: number[]
          discount_bp: number
          end_time: string
          id: string
          name: string
          resource_type_ids: string[] | null
          start_time: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          days_of_week: number[]
          discount_bp: number
          end_time: string
          id?: string
          name: string
          resource_type_ids?: string[] | null
          start_time: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          days_of_week?: number[]
          discount_bp?: number
          end_time?: string
          id?: string
          name?: string
          resource_type_ids?: string[] | null
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      member_balance_ledger: {
        Row: {
          actor_staff_id: string | null
          booking_id: string | null
          created_at: string
          delta_minutes: number
          id: string
          kind: string
          member_id: string
          reason: string | null
          session_id: string | null
          stripe_invoice_id: string | null
        }
        Insert: {
          actor_staff_id?: string | null
          booking_id?: string | null
          created_at?: string
          delta_minutes: number
          id?: string
          kind: string
          member_id: string
          reason?: string | null
          session_id?: string | null
          stripe_invoice_id?: string | null
        }
        Update: {
          actor_staff_id?: string | null
          booking_id?: string | null
          created_at?: string
          delta_minutes?: number
          id?: string
          kind?: string
          member_id?: string
          reason?: string | null
          session_id?: string | null
          stripe_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_balance_ledger_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_balance_ledger_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_balance_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_balances"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_balance_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_balance_ledger_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          current_period_end: string | null
          customer_id: string
          ended_at: string | null
          id: string
          member_no: string
          pending_tier_id: string | null
          qr_token_hash: string | null
          status: string
          stripe_subscription_id: string | null
          tier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          customer_id: string
          ended_at?: string | null
          id?: string
          member_no?: string
          pending_tier_id?: string | null
          qr_token_hash?: string | null
          status?: string
          stripe_subscription_id?: string | null
          tier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          customer_id?: string
          ended_at?: string | null
          id?: string
          member_no?: string
          pending_tier_id?: string | null
          qr_token_hash?: string | null
          status?: string
          stripe_subscription_id?: string | null
          tier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_pending_tier_id_fkey"
            columns: ["pending_tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_tiers: {
        Row: {
          active: boolean
          created_at: string
          discount_bp: number
          id: string
          max_balance_minutes: number
          monthly_free_minutes: number
          monthly_price_cents: number
          name: string
          sort: number
          stripe_price_id: string | null
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          discount_bp: number
          id?: string
          max_balance_minutes: number
          monthly_free_minutes: number
          monthly_price_cents: number
          name: string
          sort?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          discount_bp?: number
          id?: string
          max_balance_minutes?: number
          monthly_free_minutes?: number
          monthly_price_cents?: number
          name?: string
          sort?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      opening_hours: {
        Row: {
          close_time: string
          closed: boolean
          created_at: string
          day_of_week: number
          open_time: string
          updated_at: string
        }
        Insert: {
          close_time: string
          closed?: boolean
          created_at?: string
          day_of_week: number
          open_time: string
          updated_at?: string
        }
        Update: {
          close_time?: string
          closed?: boolean
          created_at?: string
          day_of_week?: number
          open_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_cents: number
          booking_id: string | null
          created_at: string
          external_ref: string | null
          gst_cents: number
          id: string
          member_id: string | null
          method: string
          receipt_no: number
          session_id: string | null
          shift_id: string | null
          staff_id: string | null
        }
        Insert: {
          amount_cents: number
          booking_id?: string | null
          created_at?: string
          external_ref?: string | null
          gst_cents: number
          id?: string
          member_id?: string | null
          method: string
          receipt_no?: never
          session_id?: string | null
          shift_id?: string | null
          staff_id?: string | null
        }
        Update: {
          amount_cents?: number
          booking_id?: string | null
          created_at?: string
          external_ref?: string | null
          gst_cents?: number
          id?: string
          member_id?: string | null
          method?: string
          receipt_no?: never
          session_id?: string | null
          shift_id?: string | null
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_balances"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      price_overrides: {
        Row: {
          approved_by: string
          created_at: string
          id: string
          new_cents: number
          original_cents: number
          reason: string
          requested_by: string
          session_id: string
        }
        Insert: {
          approved_by: string
          created_at?: string
          id?: string
          new_cents: number
          original_cents: number
          reason: string
          requested_by: string
          session_id: string
        }
        Update: {
          approved_by?: string
          created_at?: string
          id?: string
          new_cents?: number
          original_cents?: number
          reason?: string
          requested_by?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_overrides_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_overrides_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_overrides_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_bands: {
        Row: {
          active: boolean
          created_at: string
          days_of_week: number[]
          end_time: string
          id: string
          rate_cents: number
          resource_type_id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          days_of_week: number[]
          end_time: string
          id?: string
          rate_cents: number
          resource_type_id: string
          start_time: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          days_of_week?: number[]
          end_time?: string
          id?: string
          rate_cents?: number
          resource_type_id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_bands_resource_type_id_fkey"
            columns: ["resource_type_id"]
            isOneToOne: false
            referencedRelation: "resource_types"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          discount_type: string
          discount_value: number
          id: string
          max_uses: number
          updated_at: string
          uses_count: number
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          discount_type: string
          discount_value: number
          id?: string
          max_uses: number
          updated_at?: string
          uses_count?: number
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          max_uses?: number
          updated_at?: string
          uses_count?: number
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_redemptions: {
        Row: {
          booking_id: string | null
          code_id: string
          created_at: string
          discount_cents: number
          id: string
          session_id: string | null
        }
        Insert: {
          booking_id?: string | null
          code_id: string
          created_at?: string
          discount_cents: number
          id?: string
          session_id?: string | null
        }
        Update: {
          booking_id?: string | null
          code_id?: string
          created_at?: string
          discount_cents?: number
          id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_redemptions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_redemptions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          payment_id: string
          reason: string
          shift_id: string | null
          staff_id: string | null
          stripe_refund_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          payment_id: string
          reason: string
          shift_id?: string | null
          staff_id?: string | null
          stripe_refund_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          payment_id?: string
          reason?: string
          shift_id?: string | null
          staff_id?: string | null
          stripe_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_types: {
        Row: {
          active: boolean
          base_rate_cents: number
          created_at: string
          id: string
          key: string
          min_minutes: number
          name: string
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_rate_cents: number
          created_at?: string
          id?: string
          key: string
          min_minutes: number
          name: string
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_rate_cents?: number
          created_at?: string
          id?: string
          key?: string
          min_minutes?: number
          name?: string
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      resources: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          resource_type_id: string
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          resource_type_id: string
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          resource_type_id?: string
          sort?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_resource_type_id_fkey"
            columns: ["resource_type_id"]
            isOneToOne: false
            referencedRelation: "resource_types"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          booking_id: string | null
          closed_at: string | null
          closed_by: string | null
          closed_in_shift_id: string | null
          created_at: string
          free_minutes_used: number
          gst_cents: number | null
          id: string
          kind: string
          member_id: string | null
          opened_at: string
          opened_by: string
          pricing_snapshot: Json | null
          referral_code_id: string | null
          resource_id: string
          status: string
          total_cents: number | null
          updated_at: string
          void_reason: string | null
        }
        Insert: {
          booking_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_in_shift_id?: string | null
          created_at?: string
          free_minutes_used?: number
          gst_cents?: number | null
          id?: string
          kind: string
          member_id?: string | null
          opened_at: string
          opened_by: string
          pricing_snapshot?: Json | null
          referral_code_id?: string | null
          resource_id: string
          status?: string
          total_cents?: number | null
          updated_at?: string
          void_reason?: string | null
        }
        Update: {
          booking_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_in_shift_id?: string | null
          created_at?: string
          free_minutes_used?: number
          gst_cents?: number | null
          id?: string
          kind?: string
          member_id?: string | null
          opened_at?: string
          opened_by?: string
          pricing_snapshot?: Json | null
          referral_code_id?: string | null
          resource_id?: string
          status?: string
          total_cents?: number | null
          updated_at?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_closed_in_shift_id_fkey"
            columns: ["closed_in_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_balances"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "sessions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_referral_code_id_fkey"
            columns: ["referral_code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          card_variance_cents: number | null
          cash_variance_cents: number | null
          closed_at: string | null
          closed_by: string | null
          counted_cash_cents: number | null
          created_at: string
          expected_cash_cents: number | null
          flagged: boolean
          id: string
          opened_at: string
          opening_float_cents: number
          pos_card_total_cents: number | null
          staff_id: string
          terminal_card_total_cents: number | null
          updated_at: string
        }
        Insert: {
          card_variance_cents?: number | null
          cash_variance_cents?: number | null
          closed_at?: string | null
          closed_by?: string | null
          counted_cash_cents?: number | null
          created_at?: string
          expected_cash_cents?: number | null
          flagged?: boolean
          id?: string
          opened_at?: string
          opening_float_cents: number
          pos_card_total_cents?: number | null
          staff_id: string
          terminal_card_total_cents?: number | null
          updated_at?: string
        }
        Update: {
          card_variance_cents?: number | null
          cash_variance_cents?: number | null
          closed_at?: string | null
          closed_by?: string | null
          counted_cash_cents?: number | null
          created_at?: string
          expected_cash_cents?: number | null
          flagged?: boolean
          id?: string
          opened_at?: string
          opening_float_cents?: number
          pos_card_total_cents?: number | null
          staff_id?: string
          terminal_card_total_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          auth_user_id: string
          created_at: string
          display_name: string
          id: string
          pin_failed_count: number
          pin_hash: string
          pin_locked_until: string | null
          role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          auth_user_id: string
          created_at?: string
          display_name: string
          id?: string
          pin_failed_count?: number
          pin_hash: string
          pin_locked_until?: string | null
          role: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string
          created_at?: string
          display_name?: string
          id?: string
          pin_failed_count?: number
          pin_hash?: string
          pin_locked_until?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          id: string
          payload: Json
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          id: string
          payload: Json
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          id?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      tier_prices: {
        Row: {
          amount_cents: number
          created_at: string
          effective_from: string
          id: string
          stripe_price_id: string | null
          tier_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          effective_from?: string
          id?: string
          stripe_price_id?: string | null
          tier_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          effective_from?: string
          id?: string
          stripe_price_id?: string | null
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_prices_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_settings: {
        Row: {
          abn: string | null
          balance_forfeit_days: number
          booking_window_days: number
          business_name: string | null
          cash_variance_threshold_cents: number
          created_at: string
          hold_ttl_minutes: number
          id: number
          no_show_hold_minutes: number
          online_cutoff_minutes: number
          timezone: string
          updated_at: string
          walkin_last_open_minutes: number
        }
        Insert: {
          abn?: string | null
          balance_forfeit_days?: number
          booking_window_days?: number
          business_name?: string | null
          cash_variance_threshold_cents?: number
          created_at?: string
          hold_ttl_minutes?: number
          id?: number
          no_show_hold_minutes?: number
          online_cutoff_minutes?: number
          timezone?: string
          updated_at?: string
          walkin_last_open_minutes?: number
        }
        Update: {
          abn?: string | null
          balance_forfeit_days?: number
          booking_window_days?: number
          business_name?: string | null
          cash_variance_threshold_cents?: number
          created_at?: string
          hold_ttl_minutes?: number
          id?: number
          no_show_hold_minutes?: number
          online_cutoff_minutes?: number
          timezone?: string
          updated_at?: string
          walkin_last_open_minutes?: number
        }
        Relationships: []
      }
    }
    Views: {
      member_balances: {
        Row: {
          balance_minutes: number | null
          member_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      expire_stale_holds: { Args: never; Returns: number }
      pos_arrive_booking: {
        Args: { p_booking: string; p_now?: string; p_staff: string }
        Returns: {
          booking_id: string | null
          closed_at: string | null
          closed_by: string | null
          closed_in_shift_id: string | null
          created_at: string
          free_minutes_used: number
          gst_cents: number | null
          id: string
          kind: string
          member_id: string | null
          opened_at: string
          opened_by: string
          pricing_snapshot: Json | null
          referral_code_id: string | null
          resource_id: string
          status: string
          total_cents: number | null
          updated_at: string
          void_reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pos_cash_movement: {
        Args: {
          p_amount_cents: number
          p_kind: string
          p_reason: string
          p_staff: string
        }
        Returns: {
          amount_cents: number
          created_at: string
          id: string
          kind: string
          payment_id: string | null
          reason: string | null
          refund_id: string | null
          shift_id: string
          staff_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pos_close_session: {
        Args: { p_payload: Json; p_session: string; p_staff: string }
        Returns: Json
      }
      pos_close_shift: {
        Args: {
          p_counted_cash_cents: number
          p_staff: string
          p_terminal_card_total_cents: number
        }
        Returns: {
          card_variance_cents: number | null
          cash_variance_cents: number | null
          closed_at: string | null
          closed_by: string | null
          counted_cash_cents: number | null
          created_at: string
          expected_cash_cents: number | null
          flagged: boolean
          id: string
          opened_at: string
          opening_float_cents: number
          pos_card_total_cents: number | null
          staff_id: string
          terminal_card_total_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pos_mark_no_show: {
        Args: { p_booking: string; p_now?: string; p_staff: string }
        Returns: {
          cancel_reason: string | null
          cancel_token_hash: string | null
          cancelled_at: string | null
          cancelled_by_staff_id: string | null
          created_at: string
          customer_id: string
          free_minutes_used: number
          gst_cents: number | null
          hold_expires_at: string | null
          id: string
          member_id: string | null
          period: unknown
          pricing_snapshot: Json | null
          ref: string
          referral_code_id: string | null
          refund_cents: number | null
          resource_id: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          total_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pos_open_shift: {
        Args: { p_opening_float_cents: number; p_staff: string }
        Returns: {
          card_variance_cents: number | null
          cash_variance_cents: number | null
          closed_at: string | null
          closed_by: string | null
          counted_cash_cents: number | null
          created_at: string
          expected_cash_cents: number | null
          flagged: boolean
          id: string
          opened_at: string
          opening_float_cents: number
          pos_card_total_cents: number | null
          staff_id: string
          terminal_card_total_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pos_open_walk_in: {
        Args: { p_now?: string; p_resource: string; p_staff: string }
        Returns: {
          booking_id: string | null
          closed_at: string | null
          closed_by: string | null
          closed_in_shift_id: string | null
          created_at: string
          free_minutes_used: number
          gst_cents: number | null
          id: string
          kind: string
          member_id: string | null
          opened_at: string
          opened_by: string
          pricing_snapshot: Json | null
          referral_code_id: string | null
          resource_id: string
          status: string
          total_cents: number | null
          updated_at: string
          void_reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pos_shift_totals: {
        Args: { p_shift: string }
        Returns: {
          expected_cash_cents: number
          pos_card_total_cents: number
        }[]
      }
      pos_void_session: {
        Args: {
          p_now?: string
          p_reason: string
          p_session: string
          p_staff: string
        }
        Returns: Json
      }
      register_pin_attempt: {
        Args: {
          p_lock_minutes?: number
          p_max_attempts?: number
          p_staff_id: string
          p_success: boolean
        }
        Returns: {
          accepted: boolean
          failed_count: number
          just_locked: boolean
          locked_until: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

