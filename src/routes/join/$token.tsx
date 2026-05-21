import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { fetchInviteInfo, acceptInvite } from '../../lib/supabase/household-queries'
import { supabase } from '../../lib/supabase/browser'

export const Route = createFileRoute('/join/$token')({
  loader: async ({ params }) => {
    const [info, sessionResult] = await Promise.all([
      fetchInviteInfo({ data: params.token }),
      supabase.auth.getSession().catch(() => ({ data: { session: null } })),
    ])
    const user = sessionResult.data.session?.user ?? null
    return { info, user, token: params.token }
  },
  component: JoinPage,
})

function JoinPage() {
  const { info, user, token } = Route.useLoaderData()
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!info) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex flex-col items-center justify-center px-4 text-center gap-4">
        <p className="text-4xl">🏠</p>
        <h1 className="text-xl font-semibold text-[#1A1A1A]">Convite inválido</h1>
        <p className="text-sm text-[#6B7280]">Este convite não é válido ou já foi utilizado.</p>
        <a
          href="/app/library"
          className="mt-2 rounded-lg bg-[#16A34A] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Ir para as receitas
        </a>
      </div>
    )
  }

  async function handleAccept() {
    setAccepting(true)
    setError(null)
    try {
      if (user) {
        await acceptInvite({ data: token })
        await supabase.auth.refreshSession()
        window.location.href = '/app/plan'
      } else {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('pendingInviteToken', token)
        }
        window.location.href = '/'
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao aceitar convite')
      setAccepting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex flex-col items-center justify-center px-4 text-center gap-5 max-w-md mx-auto">
      <p className="text-5xl">🏠</p>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-[#1A1A1A]">
          {info.inviterName} convidou-te para o household
        </h1>
        <p className="text-sm text-[#6B7280]">{info.householdName}</p>
      </div>

      {error && (
        <p className="text-sm text-[#DC2626] bg-[#fee2e2] rounded-lg px-4 py-2">{error}</p>
      )}

      <button
        onClick={handleAccept}
        disabled={accepting}
        className="w-full rounded-2xl bg-[#16A34A] px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
      >
        {accepting ? 'A aceitar…' : 'Aceitar convite'}
      </button>

      {!user && (
        <p className="text-xs text-[#6B7280]">
          Terás de iniciar sessão para aceitar o convite.
        </p>
      )}
    </div>
  )
}
