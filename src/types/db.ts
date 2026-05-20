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
          visibility: 'private' | 'household' | 'system'
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
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string | null
          visibility?: 'private' | 'household' | 'system'
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
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string | null
          visibility?: 'private' | 'household' | 'system'
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
          created_at?: string
          updated_at?: string
        }
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
        }
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
      }
      recipe_ingredient_translations: {
        Row: {
          ingredient_id: string
          language: string
          name: string | null
          unit: string | null
          raw_text: string
        }
        Insert: {
          ingredient_id: string
          language: string
          name?: string | null
          unit?: string | null
          raw_text: string
        }
        Update: {
          ingredient_id?: string
          language?: string
          name?: string | null
          unit?: string | null
          raw_text?: string
        }
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
      }
      ingredients: {
        Row: {
          id: string
          name: string
          category: string | null
          default_unit: string | null
          owner_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          category?: string | null
          default_unit?: string | null
          owner_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          category?: string | null
          default_unit?: string | null
          owner_id?: string | null
          created_at?: string
        }
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
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
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

// Joined types (not in DB schema — built by queries)
export type PlanItemWithRecipe = PlanItem & {
  recipe: Recipe & { recipe_ingredients: RecipeIngredient[] }
}
export type ActivePlanWithCount = Plan & { item_count: number }
