import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '../../types/db'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY) as string

export const supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)

export function isPlaceholderConfig() {
  return (
    !supabaseUrl ||
    supabaseUrl.includes('placeholder') ||
    !supabaseAnonKey ||
    supabaseAnonKey.includes('placeholder')
  )
}
