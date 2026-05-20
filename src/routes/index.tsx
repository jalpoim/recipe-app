import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { supabase, isPlaceholderConfig } from '../lib/supabase/browser'
import { getAuthUser } from '../lib/supabase/server'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const user = await getAuthUser()
    if (user) throw redirect({ to: '/app' })
  },
  component: SignInPage,
})

function SignInPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const placeholder = isPlaceholderConfig()
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:3000'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('loading')
    setErrorMsg('')

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${origin}/auth/callback` },
    })

    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
    } else {
      setStatus('sent')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 bg-[#FAFAF8]">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">🥗</div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-[#1A1A1A]">
            Meal Prep
          </h1>
          <p className="text-sm text-[#6B7280]">
            Planeia as tuas refeições da semana
          </p>
        </div>

        {placeholder ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-semibold">Configure o Supabase</p>
            <p className="mt-1 text-amber-700">
              Adiciona as credenciais reais ao ficheiro{' '}
              <code className="rounded bg-amber-100 px-1 font-mono text-xs">
                .env.local
              </code>{' '}
              para activar o login. Consulta o{' '}
              <code className="rounded bg-amber-100 px-1 font-mono text-xs">
                SETUP.md
              </code>{' '}
              para instruções.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm">
            {status === 'sent' ? (
              <div className="text-center">
                <div className="mb-3 text-3xl">✉️</div>
                <p className="font-semibold text-[#1A1A1A]">
                  Verifica o teu email
                </p>
                <p className="mt-2 text-sm text-[#6B7280]">
                  Enviámos um link de acesso para{' '}
                  <span className="font-medium text-[#1A1A1A]">{email}</span>.
                </p>
                <button
                  onClick={() => { setStatus('idle'); setEmail('') }}
                  className="mt-4 text-sm text-[#16A34A] hover:underline"
                >
                  Usar outro email
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-sm font-medium text-[#1A1A1A]"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="o.teu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={status === 'loading'}
                    className="w-full rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder-[#9CA3AF] outline-none focus:border-[#16A34A] focus-visible:ring-2 focus-visible:ring-[#16A34A]/30 disabled:opacity-50 transition-colors"
                  />
                </div>

                {status === 'error' && (
                  <p className="text-sm text-[#DC2626]">{errorMsg}</p>
                )}

                <button
                  type="submit"
                  disabled={status === 'loading' || !email.trim()}
                  className="w-full rounded-lg bg-[#16A34A] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#15803D] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {status === 'loading' ? 'A enviar…' : 'Entrar com magic link'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
