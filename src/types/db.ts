export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      cook_log: {
        Row: {
          cooked_at: string;
          created_at: string;
          household_id: string | null;
          id: string;
          rating: number | null;
          recipe_id: string;
          source: string;
          user_id: string;
        };
        Insert: {
          cooked_at?: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          rating?: number | null;
          recipe_id: string;
          source: string;
          user_id: string;
        };
        Update: {
          cooked_at?: string;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          rating?: number | null;
          recipe_id?: string;
          source?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cook_log_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cook_log_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      cook_log_completions: {
        Row: {
          checked_item_keys: string[];
          completed_at: string;
          deleted_item_keys: string[];
          id: string;
          plan_id: string | null;
          skipped_item_keys: string[];
          user_id: string;
        };
        Insert: {
          checked_item_keys?: string[];
          completed_at?: string;
          deleted_item_keys?: string[];
          id?: string;
          plan_id?: string | null;
          skipped_item_keys?: string[];
          user_id: string;
        };
        Update: {
          checked_item_keys?: string[];
          completed_at?: string;
          deleted_item_keys?: string[];
          id?: string;
          plan_id?: string | null;
          skipped_item_keys?: string[];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cook_log_completions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_ai_usage: {
        Row: {
          date: string;
          macro_calls: number;
          user_id: string;
        };
        Insert: {
          date?: string;
          macro_calls?: number;
          user_id: string;
        };
        Update: {
          date?: string;
          macro_calls?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      household_invites: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          household_id: string | null;
          id: string;
          token: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          household_id?: string | null;
          id?: string;
          token?: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          household_id?: string | null;
          id?: string;
          token?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "household_invites_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_members: {
        Row: {
          household_id: string;
          joined_at: string | null;
          role: string | null;
          user_id: string;
        };
        Insert: {
          household_id: string;
          joined_at?: string | null;
          role?: string | null;
          user_id: string;
        };
        Update: {
          household_id?: string;
          joined_at?: string | null;
          role?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      households: {
        Row: {
          created_at: string | null;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      ingredient_dislikes: {
        Row: {
          confirmed_at: string;
          ingredient_name: string;
          user_id: string;
        };
        Insert: {
          confirmed_at?: string;
          ingredient_name: string;
          user_id: string;
        };
        Update: {
          confirmed_at?: string;
          ingredient_name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      ingredient_translations: {
        Row: {
          created_at: string | null;
          id: string;
          ingredient_id: string;
          language: string;
          name: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          ingredient_id: string;
          language: string;
          name: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          ingredient_id?: string;
          language?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ingredient_translations_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
        ];
      };
      ingredients: {
        Row: {
          aliases: string[];
          calories_per_100g: number | null;
          carbs_per_100g: number | null;
          category: string | null;
          classification_source: string | null;
          contains_allergens: string[];
          created_at: string | null;
          cuisine_signals: string[];
          default_unit: string | null;
          dietary_flags: string[];
          fat_per_100g: number | null;
          flavor_notes: string[];
          heat_level: number;
          id: string;
          name: string;
          owner_id: string | null;
          protein_per_100g: number | null;
          signals_enriched_at: string | null;
        };
        Insert: {
          aliases?: string[];
          calories_per_100g?: number | null;
          carbs_per_100g?: number | null;
          category?: string | null;
          classification_source?: string | null;
          contains_allergens?: string[];
          created_at?: string | null;
          cuisine_signals?: string[];
          default_unit?: string | null;
          dietary_flags?: string[];
          fat_per_100g?: number | null;
          flavor_notes?: string[];
          heat_level?: number;
          id?: string;
          name: string;
          owner_id?: string | null;
          protein_per_100g?: number | null;
          signals_enriched_at?: string | null;
        };
        Update: {
          aliases?: string[];
          calories_per_100g?: number | null;
          carbs_per_100g?: number | null;
          category?: string | null;
          classification_source?: string | null;
          contains_allergens?: string[];
          created_at?: string | null;
          cuisine_signals?: string[];
          default_unit?: string | null;
          dietary_flags?: string[];
          fat_per_100g?: number | null;
          flavor_notes?: string[];
          heat_level?: number;
          id?: string;
          name?: string;
          owner_id?: string | null;
          protein_per_100g?: number | null;
          signals_enriched_at?: string | null;
        };
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          updated_at: string;
          user_id: string;
          weekly_email_enabled: boolean;
        };
        Insert: {
          updated_at?: string;
          user_id: string;
          weekly_email_enabled?: boolean;
        };
        Update: {
          updated_at?: string;
          user_id?: string;
          weekly_email_enabled?: boolean;
        };
        Relationships: [];
      };
      plan_items: {
        Row: {
          added_at: string | null;
          assigned_protein: string | null;
          id: string;
          plan_id: string;
          portion_multiplier: number;
          position: number;
          recipe_id: string;
        };
        Insert: {
          added_at?: string | null;
          assigned_protein?: string | null;
          id?: string;
          plan_id: string;
          portion_multiplier?: number;
          position: number;
          recipe_id: string;
        };
        Update: {
          added_at?: string | null;
          assigned_protein?: string | null;
          id?: string;
          plan_id?: string;
          portion_multiplier?: number;
          position?: number;
          recipe_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_items_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_items_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          archived_at: string | null;
          created_at: string | null;
          default_multiplier: number;
          household_id: string | null;
          id: string;
          name: string;
          owner_id: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string | null;
          default_multiplier?: number;
          household_id?: string | null;
          id?: string;
          name?: string;
          owner_id: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string | null;
          default_multiplier?: number;
          household_id?: string | null;
          id?: string;
          name?: string;
          owner_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plans_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_averages: {
        Row: {
          avg_cooking_time_min: number | null;
          avg_distinct_cuisines: number | null;
          avg_heat_level: number | null;
          avg_new_recipe_ratio: number | null;
          id: number;
          top_10_ingredients: string[];
          updated_at: string | null;
        };
        Insert: {
          avg_cooking_time_min?: number | null;
          avg_distinct_cuisines?: number | null;
          avg_heat_level?: number | null;
          avg_new_recipe_ratio?: number | null;
          id?: number;
          top_10_ingredients?: string[];
          updated_at?: string | null;
        };
        Update: {
          avg_cooking_time_min?: number | null;
          avg_distinct_cuisines?: number | null;
          avg_heat_level?: number | null;
          avg_new_recipe_ratio?: number | null;
          id?: number;
          top_10_ingredients?: string[];
          updated_at?: string | null;
        };
        Relationships: [];
      };
      unmatched_ingredients: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          normalized_name: string | null;
          recipe_id: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          normalized_name?: string | null;
          recipe_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          normalized_name?: string | null;
          recipe_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          cook_style: string | null;
          created_at: string;
          dietary_mode: string;
          display_name: string;
          email: string | null;
          flavor_narrative: string | null;
          flavor_narrative_generated_at: string | null;
          flavor_narrative_lang: string | null;
          flavor_profile_data: Json | null;
          heat_preference: number | null;
          intolerances: string[];
          measurement_unit: string;
          onboarding_completed: boolean;
          user_id: string;
          username: string;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          cook_style?: string | null;
          created_at?: string;
          dietary_mode?: string;
          display_name: string;
          email?: string | null;
          flavor_narrative?: string | null;
          flavor_narrative_generated_at?: string | null;
          flavor_narrative_lang?: string | null;
          flavor_profile_data?: Json | null;
          heat_preference?: number | null;
          intolerances?: string[];
          measurement_unit?: string;
          onboarding_completed?: boolean;
          user_id: string;
          username: string;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          cook_style?: string | null;
          created_at?: string;
          dietary_mode?: string;
          display_name?: string;
          email?: string | null;
          flavor_narrative?: string | null;
          flavor_narrative_generated_at?: string | null;
          flavor_narrative_lang?: string | null;
          flavor_profile_data?: Json | null;
          heat_preference?: number | null;
          intolerances?: string[];
          measurement_unit?: string;
          onboarding_completed?: boolean;
          user_id?: string;
          username?: string;
        };
        Relationships: [];
      };
      recipe_ingredient_translations: {
        Row: {
          ingredient_id: string;
          language: string;
          name: string | null;
          raw_text: string;
          section_label: string | null;
          unit: string | null;
        };
        Insert: {
          ingredient_id: string;
          language: string;
          name?: string | null;
          raw_text: string;
          section_label?: string | null;
          unit?: string | null;
        };
        Update: {
          ingredient_id?: string;
          language?: string;
          name?: string | null;
          raw_text?: string;
          section_label?: string | null;
          unit?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_ingredient_translations_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "recipe_ingredients";
            referencedColumns: ["id"];
          },
        ];
      };
      recipe_ingredients: {
        Row: {
          category: string | null;
          id: string;
          ingredient_id: string | null;
          is_optional: boolean;
          is_pantry: boolean;
          name: string | null;
          position: number;
          quantity: number | null;
          raw_text: string;
          recipe_id: string;
          section_label: string | null;
          unit: string | null;
        };
        Insert: {
          category?: string | null;
          id?: string;
          ingredient_id?: string | null;
          is_optional?: boolean;
          is_pantry?: boolean;
          name?: string | null;
          position: number;
          quantity?: number | null;
          raw_text: string;
          recipe_id: string;
          section_label?: string | null;
          unit?: string | null;
        };
        Update: {
          category?: string | null;
          id?: string;
          ingredient_id?: string | null;
          is_optional?: boolean;
          is_pantry?: boolean;
          name?: string | null;
          position?: number;
          quantity?: number | null;
          raw_text?: string;
          recipe_id?: string;
          section_label?: string | null;
          unit?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      recipe_reports: {
        Row: {
          created_at: string;
          id: string;
          recipe_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          recipe_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          recipe_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_reports_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      recipe_step_translations: {
        Row: {
          language: string;
          step_id: string;
          text: string;
        };
        Insert: {
          language: string;
          step_id: string;
          text: string;
        };
        Update: {
          language?: string;
          step_id?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_step_translations_step_id_fkey";
            columns: ["step_id"];
            isOneToOne: false;
            referencedRelation: "recipe_steps";
            referencedColumns: ["id"];
          },
        ];
      };
      recipe_steps: {
        Row: {
          id: string;
          position: number;
          recipe_id: string;
          text: string;
          timer_seconds: number | null;
        };
        Insert: {
          id?: string;
          position: number;
          recipe_id: string;
          text: string;
          timer_seconds?: number | null;
        };
        Update: {
          id?: string;
          position?: number;
          recipe_id?: string;
          text?: string;
          timer_seconds?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_steps_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      recipe_translations: {
        Row: {
          language: string;
          name: string;
          recipe_id: string;
        };
        Insert: {
          language: string;
          name: string;
          recipe_id: string;
        };
        Update: {
          language?: string;
          name?: string;
          recipe_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_translations_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      recipes: {
        Row: {
          calories: number | null;
          carbs: number | null;
          cook_count: number;
          cooking_method: string | null;
          created_at: string | null;
          cuisine_tags: string[];
          deleted_at: string | null;
          dietary_flags: string[];
          fat: number | null;
          flavor_notes: string[];
          id: string;
          image_thumb_url: string | null;
          image_url: string | null;
          is_featured: boolean;
          like_count: number;
          macros_source: string | null;
          macros_total: boolean;
          moderation_status: string;
          name: string;
          name_language: string | null;
          owner_id: string | null;
          pcal_ratio: number | null;
          popularity_score: number;
          protein: number | null;
          proteins: string[];
          save_count: number;
          servings: number;
          source: string | null;
          source_url: string | null;
          tags: string[];
          time_min: number | null;
          updated_at: string | null;
          user_tags: string[];
          visibility: string;
        };
        Insert: {
          calories?: number | null;
          carbs?: number | null;
          cook_count?: number;
          cooking_method?: string | null;
          created_at?: string | null;
          cuisine_tags?: string[];
          deleted_at?: string | null;
          dietary_flags?: string[];
          fat?: number | null;
          flavor_notes?: string[];
          id?: string;
          image_thumb_url?: string | null;
          image_url?: string | null;
          is_featured?: boolean;
          like_count?: number;
          macros_source?: string | null;
          macros_total?: boolean;
          moderation_status?: string;
          name: string;
          name_language?: string | null;
          owner_id?: string | null;
          pcal_ratio?: number | null;
          popularity_score?: number;
          protein?: number | null;
          proteins?: string[];
          save_count?: number;
          servings?: number;
          source?: string | null;
          source_url?: string | null;
          tags?: string[];
          time_min?: number | null;
          updated_at?: string | null;
          user_tags?: string[];
          visibility?: string;
        };
        Update: {
          calories?: number | null;
          carbs?: number | null;
          cook_count?: number;
          cooking_method?: string | null;
          created_at?: string | null;
          cuisine_tags?: string[];
          deleted_at?: string | null;
          dietary_flags?: string[];
          fat?: number | null;
          flavor_notes?: string[];
          id?: string;
          image_thumb_url?: string | null;
          image_url?: string | null;
          is_featured?: boolean;
          like_count?: number;
          macros_source?: string | null;
          macros_total?: boolean;
          moderation_status?: string;
          name?: string;
          name_language?: string | null;
          owner_id?: string | null;
          pcal_ratio?: number | null;
          popularity_score?: number;
          protein?: number | null;
          proteins?: string[];
          save_count?: number;
          servings?: number;
          source?: string | null;
          source_url?: string | null;
          tags?: string[];
          time_min?: number | null;
          updated_at?: string | null;
          user_tags?: string[];
          visibility?: string;
        };
        Relationships: [];
      };
      shopping_check_state: {
        Row: {
          category: string | null;
          id: string;
          is_checked: boolean;
          item_key: string;
          label: string | null;
          plan_id: string;
          updated_at: string | null;
        };
        Insert: {
          category?: string | null;
          id?: string;
          is_checked?: boolean;
          item_key: string;
          label?: string | null;
          plan_id: string;
          updated_at?: string | null;
        };
        Update: {
          category?: string | null;
          id?: string;
          is_checked?: boolean;
          item_key?: string;
          label?: string | null;
          plan_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shopping_check_state_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      tag_correction_reports: {
        Row: {
          created_at: string | null;
          id: string;
          recipe_id: string | null;
          reported_by: string | null;
          tag: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          recipe_id?: string | null;
          reported_by?: string | null;
          tag: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          recipe_id?: string | null;
          reported_by?: string | null;
          tag?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tag_correction_reports_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      user_category_overrides: {
        Row: {
          category: string;
          ingredient_name: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          category: string;
          ingredient_name: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          category?: string;
          ingredient_name?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      user_cook_profile: {
        Row: {
          creator_points: number;
          explored_cuisines: string[];
          explored_proteins: string[];
          explorer_score: number;
          last_computed_at: string | null;
          lifetime_cook_count: number;
          optimizer_score: number;
          planner_score: number;
          shopping_trip_count: number;
          specialty_badge_key: string | null;
          swift_score: number;
          user_id: string;
        };
        Insert: {
          creator_points?: number;
          explored_cuisines?: string[];
          explored_proteins?: string[];
          explorer_score?: number;
          last_computed_at?: string | null;
          lifetime_cook_count?: number;
          optimizer_score?: number;
          planner_score?: number;
          shopping_trip_count?: number;
          specialty_badge_key?: string | null;
          swift_score?: number;
          user_id: string;
        };
        Update: {
          creator_points?: number;
          explored_cuisines?: string[];
          explored_proteins?: string[];
          explorer_score?: number;
          last_computed_at?: string | null;
          lifetime_cook_count?: number;
          optimizer_score?: number;
          planner_score?: number;
          shopping_trip_count?: number;
          specialty_badge_key?: string | null;
          swift_score?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      user_ingredient_exclusions: {
        Row: {
          ingredient_id: string;
          user_id: string;
        };
        Insert: {
          ingredient_id: string;
          user_id: string;
        };
        Update: {
          ingredient_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_ingredient_exclusions_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
        ];
      };
      user_ingredient_overrides: {
        Row: {
          category: string;
          ingredient_id: string;
          user_id: string;
        };
        Insert: {
          category: string;
          ingredient_id: string;
          user_id: string;
        };
        Update: {
          category?: string;
          ingredient_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_ingredient_overrides_ingredient_id_fkey";
            columns: ["ingredient_id"];
            isOneToOne: false;
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
        ];
      };
      user_proteins: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          language: string;
          slug: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          id?: string;
          language?: string;
          slug: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          language?: string;
          slug?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_recipe_interactions: {
        Row: {
          created_at: string;
          id: string;
          recipe_id: string;
          type: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          recipe_id: string;
          type: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          recipe_id?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_recipe_interactions_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      user_recipe_preferences: {
        Row: {
          preferred_servings: number;
          recipe_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          preferred_servings?: number;
          recipe_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          preferred_servings?: number;
          recipe_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_recipe_preferences_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      compute_popularity_score: {
        Args: {
          p_cook_count: number;
          p_created_at: string;
          p_is_featured: boolean;
          p_like_count: number;
          p_save_count: number;
        };
        Returns: number;
      };
      get_active_plan: {
        Args: { p_household_id?: string; p_user_id: string };
        Returns: {
          archived_at: string;
          created_at: string;
          default_multiplier: number;
          household_id: string;
          id: string;
          item_count: number;
          name: string;
          owner_id: string;
        }[];
      };
      get_auth_household_id: { Args: never; Returns: string };
      get_library_meta:
        | { Args: never; Returns: Json }
        | { Args: { lang?: string }; Returns: Json };
      get_recipe_cook_counts: {
        Args: { p_recipe_ids: string[]; p_user_id: string };
        Returns: {
          count: number;
          recipe_id: string;
        }[];
      };
      is_in_same_household: {
        Args: { other_user_id: string };
        Returns: boolean;
      };
      search_ingredients_fuzzy:
        | {
            Args: { lang?: string; result_limit?: number; search_term: string };
            Returns: {
              id: string;
              name: string;
              similarity: number;
            }[];
          }
        | {
            Args: { result_limit?: number; search_term: string };
            Returns: {
              id: string;
              name: string;
              similarity: number;
            }[];
          };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      unaccent: { Args: { "": string }; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

// Convenience aliases
export type Ingredient = Database["public"]["Tables"]["ingredients"]["Row"];
export type IngredientTranslation =
  Database["public"]["Tables"]["ingredient_translations"]["Row"];
export type Recipe = Database["public"]["Tables"]["recipes"]["Row"];
export type RecipeInsert = Database["public"]["Tables"]["recipes"]["Insert"];
export type RecipeIngredient =
  Database["public"]["Tables"]["recipe_ingredients"]["Row"];
export type RecipeIngredientInsert =
  Database["public"]["Tables"]["recipe_ingredients"]["Insert"];
export type RecipeStep = Database["public"]["Tables"]["recipe_steps"]["Row"];
export type RecipeStepInsert =
  Database["public"]["Tables"]["recipe_steps"]["Insert"];
export type RecipeTranslation =
  Database["public"]["Tables"]["recipe_translations"]["Row"];
export type RecipeIngredientTranslation =
  Database["public"]["Tables"]["recipe_ingredient_translations"]["Row"];
export type RecipeStepTranslation =
  Database["public"]["Tables"]["recipe_step_translations"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];
export type Plan = Database["public"]["Tables"]["plans"]["Row"];
export type PlanInsert = Database["public"]["Tables"]["plans"]["Insert"];
export type PlanItem = Database["public"]["Tables"]["plan_items"]["Row"];
export type PlanItemInsert =
  Database["public"]["Tables"]["plan_items"]["Insert"];
export type PlanItemWithRecipe = PlanItem & {
  recipe: Recipe & { recipe_ingredients: RecipeIngredient[] };
};
export type ActivePlanWithCount = Plan & { item_count: number };
export type ShoppingCheckState =
  Database["public"]["Tables"]["shopping_check_state"]["Row"];
export type CookLog = Database["public"]["Tables"]["cook_log"]["Row"];
export type CookLogInsert = Database["public"]["Tables"]["cook_log"]["Insert"];
export type UserRecipeInteraction =
  Database["public"]["Tables"]["user_recipe_interactions"]["Row"];
export type NotificationPreferences =
  Database["public"]["Tables"]["notification_preferences"]["Row"];
export type CookLogCompletion =
  Database["public"]["Tables"]["cook_log_completions"]["Row"];
export type CookLogCompletionInsert =
  Database["public"]["Tables"]["cook_log_completions"]["Insert"];
export type IngredientDislike =
  Database["public"]["Tables"]["ingredient_dislikes"]["Row"];
export type RecipeReport =
  Database["public"]["Tables"]["recipe_reports"]["Row"];
export type UserProtein = Database["public"]["Tables"]["user_proteins"]["Row"];
export type UserIngredientOverride =
  Database["public"]["Tables"]["user_ingredient_overrides"]["Row"];
export type UserIngredientExclusion =
  Database["public"]["Tables"]["user_ingredient_exclusions"]["Row"];
export type TagCorrectionReport =
  Database["public"]["Tables"]["tag_correction_reports"]["Row"];
export type HouseholdInvite =
  Database["public"]["Tables"]["household_invites"]["Row"];
export type HouseholdInviteInsert =
  Database["public"]["Tables"]["household_invites"]["Insert"];
export type HouseholdMemberWithEmail = {
  userId: string;
  email: string;
  role: "owner" | "member";
};
export type HouseholdInfo = {
  household: { id: string; name: string };
  members: HouseholdMemberWithEmail[];
  inviteToken: string | null;
};
export type DietaryMode = "none" | "vegetarian" | "vegan" | "pescatarian";
export type CookStyle =
  | "optimizer"
  | "time_crunched"
  | "explorer"
  | "dietary"
  | "meal_prepper";
export type UserCookProfile =
  Database["public"]["Tables"]["user_cook_profile"]["Row"];
