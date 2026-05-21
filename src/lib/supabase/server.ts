import { createServerClient } from '@supabase/ssr'
import type { Database } from '../../types/db'
import { createServerFn } from '@tanstack/react-start'
import { getCookies, setCookie, setResponseHeader } from '@tanstack/react-start/server'

function createSupabaseServerClient() {
  const url = (import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY) as string

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        const cookies = getCookies()
        return Object.entries(cookies).map(([name, value]) => ({ name, value }))
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          setCookie(name, value, options as Parameters<typeof setCookie>[2])
        })
        if (headers) {
          Object.entries(headers).forEach(([name, value]) => {
            setResponseHeader(
              name as Parameters<typeof setResponseHeader>[0],
              value,
            )
          })
        }
      },
    },
  })
}

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  const supabase = createSupabaseServerClient()
  await supabase.auth.signOut()
  return { ok: true }
})

export const getAuthUser = createServerFn({ method: 'GET' }).handler(
  async () => {
    const supabase = createSupabaseServerClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session?.user ?? null
  },
)
