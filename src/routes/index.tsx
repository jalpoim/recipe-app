import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { supabase, isPlaceholderConfig } from '../lib/supabase/browser'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M17.64 9.2045c0-.638-.0573-1.252-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9086C16.6582 14.2528 17.64 11.9455 17.64 9.2045z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9086-2.2582c-.8059.54-1.8368.8591-3.0478.8591-2.3441 0-4.3282-1.5832-5.0368-3.7105H.9573v2.3318C2.4382 15.9836 5.4818 18 9 18z" fill="#34A853"/>
      <path d="M3.9632 10.71A5.411 5.411 0 0 1 3.6682 9c0-.5945.1023-1.1727.295-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.9632 10.71z" fill="#FBBC05"/>
      <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5814-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0164.9573 4.9582L3.9632 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z" fill="#EA4335"/>
    </svg>
  )
}

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) throw redirect({ to: '/app' })
  },
  component: SignInPage,
})

function SignInPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [oauthLoading, setOauthLoading] = useState(false)

  const placeholder = isPlaceholderConfig()
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:3000'

  async function handleGoogleSignIn() {
    setOauthLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin}/auth/callback` },
    })
  }

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

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[#E5E7EB]" />
                  <span className="text-xs text-[#9CA3AF]">ou</span>
                  <div className="flex-1 h-px bg-[#E5E7EB]" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={oauthLoading}
                  className="w-full flex items-center justify-center gap-2.5 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-semibold text-[#1A1A1A] transition hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <GoogleIcon />
                  {oauthLoading ? 'A redirecionar…' : 'Continuar com Google'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
