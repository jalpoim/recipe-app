import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase/browser'

type SearchParams = { code?: string; error?: string; error_description?: string }

export const Route = createFileRoute('/auth/callback')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    code: search.code as string | undefined,
    error: search.error as string | undefined,
    error_description: search.error_description as string | undefined,
  }),
  component: AuthCallback,
})

function AuthCallback() {
  const navigate = useNavigate()
  const { code, error, error_description } = useSearch({ from: '/auth/callback' })
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (error) {
      setErrorMsg(error_description ?? error)
      return
    }

    // Always listen for auth state — covers implicit flow and race conditions
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        navigate({ to: '/app' })
      }
    })

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
        if (!exchangeError) return // onAuthStateChange handles navigation

        // Exchange failed — check if a session already exists (e.g. email client
        // pre-fetched the link on a previous attempt, consuming the code)
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            navigate({ to: '/app' })
          } else {
            setErrorMsg(exchangeError.message)
          }
        })
      })
    }

    return () => listener.subscription.unsubscribe()
  }, [code, error, error_description, navigate])

  if (errorMsg) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-[#ef4444]/30 bg-[#1a1c22] p-6 text-center">
          <p className="font-semibold text-[#ef4444]">Erro ao autenticar</p>
          <p className="mt-2 text-sm text-[#6b7280]">{errorMsg}</p>
          <a
            href="/"
            className="mt-4 inline-block text-sm text-[#22c55e] hover:underline"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-[#6b7280]">A autenticar…</p>
    </div>
  )
}
