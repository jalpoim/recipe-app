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
      recipes: {
        Row: {
          id: string
          owner_id: string | null
          visibility: 'private' | 'household' | 'system' | 'public'
          name: string
          time_min: number | null
          servings: number
          macros_total: boolean
          calories: number | null
          protein: number | null
          carbs: number | null
          fat: number | null
          macros_source: 'manual' | 'computed' | null
          proteins: string[]
          tags: string[]
          user_tags: string[]
          pcal_ratio: number | null
          image_url: string | null
          image_thumb_url: string | null
          moderation_status: 'approved' | 'pending_review' | 'rejected'
          deleted_at: string | null
          like_count: number
          cook_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string | null
          visibility?: 'private' | 'household' | 'system' | 'public'
          name: string
          time_min?: number | null
          servings?: number
          macros_total?: boolean
          calories?: number | null
          protein?: number | null
          carbs?: number | null
          fat?: number | null
          macros_source?: 'manual' | 'computed' | null
          proteins?: string[]
          tags?: string[]
          user_tags?: string[]
          image_url?: string | null
          image_thumb_url?: string | null
          moderation_status?: 'approved' | 'pending_review' | 'rejected'
          deleted_at?: string | null
          like_count?: number
          cook_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string | null
          visibility?: 'private' | 'household' | 'system' | 'public'
          name?: string
          time_min?: number | null
          servings?: number
          macros_total?: boolean
          calories?: number | null
          protein?: number | null
          carbs?: number | null
          fat?: number | null
          macros_source?: 'manual' | 'computed' | null
          proteins?: string[]
          tags?: string[]
          user_tags?: string[]
          image_url?: string | null
          image_thumb_url?: string | null
          moderation_status?: 'approved' | 'pending_review' | 'rejected'
          deleted_at?: string | null
          like_count?: number
          cook_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      recipe_ingredients: {
        Row: {
          id: string
          recipe_id: string
          position: number
          raw_text: string
          quantity: number | null
          unit: string | null
          name: string | null
          category: string | null
          is_pantry: boolean
          is_optional: boolean
          section_label: string | null
        }
        Insert: {
          id?: string
          recipe_id: string
          position: number
          raw_text: string
          quantity?: number | null
          unit?: string | null
          name?: string | null
          category?: string | null
          is_pantry?: boolean
          is_optional?: boolean
          section_label?: string | null
        }
        Update: {
          id?: string
          recipe_id?: string
          position?: number
          raw_text?: string
          quantity?: number | null
          unit?: string | null
          name?: string | null
          category?: string | null
          is_pantry?: boolean
          is_optional?: boolean
          section_label?: string | null
        }
        Relationships: []
      }
      recipe_steps: {
        Row: {
          id: string
          recipe_id: string
          position: number
          text: string
          timer_seconds: number | null
        }
        Insert: {
          id?: string
          recipe_id: string
          position: number
          text: string
          timer_seconds?: number | null
        }
        Update: {
          id?: string
          recipe_id?: string
          position?: number
          text?: string
          timer_seconds?: number | null
        }
        Relationships: []
      }
      households: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
        Relationships: []
      }
      household_members: {
        Row: {
          household_id: string
          user_id: string
          role: 'owner' | 'member' | null
          joined_at: string | null
        }
        Insert: {
          household_id: string
          user_id: string
          role?: 'owner' | 'member' | null
          joined_at?: string | null
        }
        Update: {
          household_id?: string
          user_id?: string
          role?: 'owner' | 'member' | null
          joined_at?: string | null
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          owner_id: string
          household_id: string | null
          name: string
          default_multiplier: number
          archived_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          household_id?: string | null
          name?: string
          default_multiplier?: number
          archived_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          household_id?: string | null
          name?: string
          default_multiplier?: number
          archived_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      plan_items: {
        Row: {
          id: string
          plan_id: string
          recipe_id: string
          position: number
          assigned_protein: string | null
          portion_multiplier: number
          added_at: string | null
        }
        Insert: {
          id?: string
          plan_id: string
          recipe_id: string
          position: number
          assigned_protein?: string | null
          portion_multiplier?: number
          added_at?: string | null
        }
        Update: {
          id?: string
          plan_id?: string
          recipe_id?: string
          position?: number
          assigned_protein?: string | null
          portion_multiplier?: number
          added_at?: string | null
        }
        Relationships: []
      }
      shopping_check_state: {
        Row: {
          id: string
          plan_id: string
          item_key: string
          is_checked: boolean
          label: string | null
          category: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          plan_id: string
          item_key: string
          is_checked?: boolean
          label?: string | null
          category?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          plan_id?: string
          item_key?: string
          is_checked?: boolean
          label?: string | null
          category?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      recipe_translations: {
        Row: {
          recipe_id: string
          language: string
          name: string
        }
        Insert: {
          recipe_id: string
          language: string
          name: string
        }
        Update: {
          recipe_id?: string
          language?: string
          name?: string
        }
        Relationships: []
      }
      recipe_ingredient_translations: {
        Row: {
          ingredient_id: string
          language: string
          name: string | null
          unit: string | null
          raw_text: string
          section_label: string | null
        }
        Insert: {
          ingredient_id: string
          language: string
          name?: string | null
          unit?: string | null
          raw_text: string
          section_label?: string | null
        }
        Update: {
          ingredient_id?: string
          language?: string
          name?: string | null
          unit?: string | null
          raw_text?: string
          section_label?: string | null
        }
        Relationships: []
      }
      recipe_step_translations: {
        Row: {
          step_id: string
          language: string
          text: string
        }
        Insert: {
          step_id: string
          language: string
          text: string
        }
        Update: {
          step_id?: string
          language?: string
          text?: string
        }
        Relationships: []
      }
      ingredients: {
        Row: {
          id: string
          name: string
          category: string | null
          default_unit: string | null
          owner_id: string | null
          created_at: string
          calories_per_100g: number | null
          protein_per_100g: number | null
          carbs_per_100g: number | null
          fat_per_100g: number | null
          aliases: string[]
        }
        Insert: {
          id?: string
          name: string
          category?: string | null
          default_unit?: string | null
          owner_id?: string | null
          created_at?: string
          calories_per_100g?: number | null
          protein_per_100g?: number | null
          carbs_per_100g?: number | null
          fat_per_100g?: number | null
          aliases?: string[]
        }
        Update: {
          id?: string
          name?: string
          category?: string | null
          default_unit?: string | null
          owner_id?: string | null
          created_at?: string
          calories_per_100g?: number | null
          protein_per_100g?: number | null
          carbs_per_100g?: number | null
          fat_per_100g?: number | null
          aliases?: string[]
        }
        Relationships: []
      }
      user_ingredient_overrides: {
        Row: {
          user_id: string
          ingredient_id: string
          category: string
        }
        Insert: {
          user_id: string
          ingredient_id: string
          category: string
        }
        Update: {
          user_id?: string
          ingredient_id?: string
          category?: string
        }
        Relationships: []
      }
      household_invites: {
        Row: {
          id: string
          token: string
          household_id: string | null
          created_by: string | null
          used_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          token?: string
          household_id?: string | null
          created_by?: string | null
          used_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          token?: string
          household_id?: string | null
          created_by?: string | null
          used_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      user_category_overrides: {
        Row: {
          user_id: string
          ingredient_name: string
          category: string
          updated_at: string | null
        }
        Insert: {
          user_id: string
          ingredient_name: string
          category: string
          updated_at?: string | null
        }
        Update: {
          user_id?: string
          ingredient_name?: string
          category?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      cook_log: {
        Row: {
          id: string
          user_id: string
          recipe_id: string
          household_id: string | null
          cooked_at: string
          source: 'planned' | 'manual'
          rating: number | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          recipe_id: string
          household_id?: string | null
          cooked_at?: string
          source: 'planned' | 'manual'
          rating?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          recipe_id?: string
          household_id?: string | null
          cooked_at?: string
          source?: 'planned' | 'manual'
          rating?: number | null
          created_at?: string
        }
        Relationships: []
      }
      user_recipe_preferences: {
        Row: {
          user_id: string
          recipe_id: string
          preferred_servings: number
          updated_at: string
        }
        Insert: {
          user_id: string
          recipe_id: string
          preferred_servings: number
          updated_at?: string
        }
        Update: {
          user_id?: string
          recipe_id?: string
          preferred_servings?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_recipe_interactions: {
        Row: {
          id: string
          user_id: string
          recipe_id: string
          type: 'like' | 'save' | 'hide'
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          recipe_id: string
          type: 'like' | 'save' | 'hide'
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          recipe_id?: string
          type?: 'like' | 'save' | 'hide'
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          user_id: string
          username: string
          display_name: string
          avatar_url: string | null
          bio: string | null
          measurement_unit: 'metric' | 'imperial'
          created_at: string
        }
        Insert: {
          user_id: string
          username: string
          display_name: string
          avatar_url?: string | null
          bio?: string | null
          measurement_unit?: 'metric' | 'imperial'
          created_at?: string
        }
        Update: {
          user_id?: string
          username?: string
          display_name?: string
          avatar_url?: string | null
          bio?: string | null
          measurement_unit?: 'metric' | 'imperial'
          created_at?: string
        }
        Relationships: []
      }
      recipe_reports: {
        Row: {
          id: string
          recipe_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          id?: string
          recipe_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          id?: string
          recipe_id?: string
          user_id?: string
          created_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          user_id: string
          weekly_email_enabled: boolean
          updated_at: string
        }
        Insert: {
          user_id: string
          weekly_email_enabled?: boolean
          updated_at?: string
        }
        Update: {
          user_id?: string
          weekly_email_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      user_proteins: {
        Row: {
          id: string
          user_id: string
          slug: string
          display_name: string
          language: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          slug: string
          display_name: string
          language?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          slug?: string
          display_name?: string
          language?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      get_active_plan: {
        Args: { p_user_id: string; p_household_id?: string | null }
        Returns: Array<{
          id: string
          owner_id: string
          household_id: string | null
          name: string
          default_multiplier: number
          archived_at: string | null
          created_at: string
          item_count: number
        }>
      }
      get_recipe_cook_counts: {
        Args: { p_user_id: string; p_recipe_ids: string[] }
        Returns: Array<{ recipe_id: string; count: number }>
      }
      get_library_meta: {
        Args: Record<string, never>
        Returns: { proteins: string[]; tags: string[]; ingredients: string[] }
      }
    }
    Enums: Record<string, never>
  }
}

// Convenience row types
export type Recipe = Database['public']['Tables']['recipes']['Row']
export type RecipeInsert = Database['public']['Tables']['recipes']['Insert']
export type RecipeIngredient = Database['public']['Tables']['recipe_ingredients']['Row']
export type RecipeIngredientInsert = Database['public']['Tables']['recipe_ingredients']['Insert']
export type RecipeStep = Database['public']['Tables']['recipe_steps']['Row']
export type RecipeStepInsert = Database['public']['Tables']['recipe_steps']['Insert']
export type Plan = Database['public']['Tables']['plans']['Row']
export type PlanInsert = Database['public']['Tables']['plans']['Insert']
export type PlanItem = Database['public']['Tables']['plan_items']['Row']
export type PlanItemInsert = Database['public']['Tables']['plan_items']['Insert']
export type ShoppingCheckState = Database['public']['Tables']['shopping_check_state']['Row']
export type RecipeTranslation = Database['public']['Tables']['recipe_translations']['Row']
export type RecipeIngredientTranslation = Database['public']['Tables']['recipe_ingredient_translations']['Row']
export type RecipeStepTranslation = Database['public']['Tables']['recipe_step_translations']['Row']
export type Ingredient = Database['public']['Tables']['ingredients']['Row']
export type UserIngredientOverride = Database['public']['Tables']['user_ingredient_overrides']['Row']

export type HouseholdInvite = Database['public']['Tables']['household_invites']['Row']
export type HouseholdInviteInsert = Database['public']['Tables']['household_invites']['Insert']

// Joined types (not in DB schema — built by queries)
export type PlanItemWithRecipe = PlanItem & {
  recipe: Recipe & { recipe_ingredients: RecipeIngredient[] }
}
export type ActivePlanWithCount = Plan & { item_count: number }

export type HouseholdMemberWithEmail = {
  userId: string
  email: string
  role: 'owner' | 'member'
}

export type HouseholdInfo = {
  household: { id: string; name: string }
  members: HouseholdMemberWithEmail[]
  inviteToken: string | null
}

export type CookLog = Database['public']['Tables']['cook_log']['Row']
export type CookLogInsert = Database['public']['Tables']['cook_log']['Insert']
export type UserRecipeInteraction = Database['public']['Tables']['user_recipe_interactions']['Row']
export type NotificationPreferences = Database['public']['Tables']['notification_preferences']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type RecipeReport = Database['public']['Tables']['recipe_reports']['Row']
export type UserProtein = Database['public']['Tables']['user_proteins']['Row']
