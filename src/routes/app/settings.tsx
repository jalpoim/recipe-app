import { createFileRoute, Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { ArrowLeft, Check, Copy, Loader2, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import i18n from '../../i18n'
import { signOut } from '../../lib/supabase/server'
import { fetchMyProfile, saveMeasurementUnit } from '../../lib/supabase/profile-queries'
import {
  fetchHouseholdInfo,
  createHousehold,
  generateInviteToken,
  revokeInviteToken,
  leaveHousehold,
} from '../../lib/supabase/household-queries'
import type { HouseholdInfo } from '../../types/db'
import type { MeasurementUnit } from '../../lib/detect-locale'

export const Route = createFileRoute('/app/settings')({
  component: SettingsPage,
})

function useTheme() {
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    return (localStorage.getItem('theme') as 'light' | 'dark') ?? 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  return { theme, setTheme: setThemeState }
}

function InviteLinkBox({
  token,
  onRevoke,
}: {
  token: string
  onRevoke: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${token}`

  async function handleCopy() {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[#6B7280]">{t('settings.householdInviteLink')}</p>
      <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
        <span className="flex-1 truncate text-xs text-[#1A1A1A] font-mono">{link}</span>
        <button
          onClick={handleCopy}
          className="shrink-0 text-[#16A34A] focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
          aria-label={t('settings.householdCopyLink')}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      {copied && (
        <p className="text-xs text-[#16A34A]">{t('settings.householdLinkCopied')}</p>
      )}
      <button
        onClick={onRevoke}
        className="text-xs text-[#6B7280] underline underline-offset-2 hover:text-[#1A1A1A] transition-colors"
      >
        {t('settings.householdRevokeInvite')}
      </button>
    </div>
  )
}

function HouseholdSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [leaveConfirm, setLeaveConfirm] = useState(false)

  const { data: info, isLoading } = useQuery<HouseholdInfo | null>({
    queryKey: ['household-info'],
    queryFn: () => fetchHouseholdInfo(),
  })

  const [mutationError, setMutationError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async () => {
      await createHousehold()
      const token = await generateInviteToken()
      return token
    },
    onSuccess: () => {
      setMutationError(null)
      queryClient.invalidateQueries({ queryKey: ['household-info'] })
    },
    onError: (err) => setMutationError(err instanceof Error ? err.message : 'Erro ao criar household'),
  })

  const generateTokenMutation = useMutation({
    mutationFn: () => generateInviteToken(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household-info'] }),
  })

  const revokeMutation = useMutation({
    mutationFn: (token: string) => revokeInviteToken({ data: token }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household-info'] }),
  })

  const leaveMutation = useMutation({
    mutationFn: () => leaveHousehold(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household-info'] })
      queryClient.invalidateQueries({ queryKey: ['active-plan'] })
      setLeaveConfirm(false)
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 size={20} className="animate-spin text-[#6B7280]" />
      </div>
    )
  }

  // No household yet
  if (!info) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="w-full rounded-2xl bg-[#16A34A] py-3.5 text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        >
          {createMutation.isPending ? t('settings.householdCreating') : t('settings.householdCreate')}
        </button>
        <p className="text-xs text-[#6B7280] text-center">{t('settings.householdCreateHint')}</p>
        {mutationError && (
          <p className="text-xs text-[#DC2626] text-center">{mutationError}</p>
        )}
      </div>
    )
  }

  const memberCount = info.members.length
  const hasInviteToken = !!info.inviteToken

  // In household, waiting for second member
  if (memberCount < 2) {
    return (
      <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4 space-y-4">
        <div>
          <p className="font-semibold text-[#1A1A1A] text-sm">{info.household.name}</p>
          <p className="text-xs text-[#6B7280] mt-0.5">{t('settings.householdWaiting')}</p>
          <p className="text-xs text-[#9CA3AF] mt-0.5">{t('settings.householdWaitingHint')}</p>
        </div>

        {hasInviteToken ? (
          <InviteLinkBox
            token={info.inviteToken!}
            onRevoke={() => revokeMutation.mutate(info.inviteToken!)}
          />
        ) : (
          <button
            onClick={() => generateTokenMutation.mutate()}
            disabled={generateTokenMutation.isPending}
            className="text-sm text-[#16A34A] font-medium disabled:opacity-50"
          >
            {generateTokenMutation.isPending ? 'A gerar…' : 'Gerar link de convite'}
          </button>
        )}
      </div>
    )
  }

  // Full household (2 members)
  return (
    <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4 space-y-4">
      <p className="font-semibold text-[#1A1A1A] text-sm">{info.household.name}</p>

      <div className="space-y-2">
        {info.members.map((m) => (
          <div
            key={m.userId}
            className="flex items-center gap-2 rounded-xl bg-[#F9FAFB] border border-[#F3F4F6] px-3 py-2"
          >
            <span className="flex-1 text-sm text-[#1A1A1A]">{m.email.split('@')[0]}</span>
            {m.role === 'owner' && (
              <span className="text-[10px] font-medium text-[#6B7280] bg-[#F3F4F6] rounded px-1.5 py-0.5">
                owner
              </span>
            )}
          </div>
        ))}
      </div>

      {leaveConfirm ? (
        <div className="space-y-3">
          <p className="text-xs text-[#6B7280]">{t('settings.householdLeaveConfirm')}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setLeaveConfirm(false)}
              className="flex-1 rounded-xl border border-[#E5E7EB] py-2.5 text-sm font-medium text-[#1A1A1A]"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => leaveMutation.mutate()}
              disabled={leaveMutation.isPending}
              className="flex-1 rounded-xl border border-[#DC2626] py-2.5 text-sm font-medium text-[#DC2626] disabled:opacity-50"
            >
              {leaveMutation.isPending ? t('settings.householdLeaving') : t('settings.householdLeave')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setLeaveConfirm(true)}
          className="w-full rounded-xl border border-[#DC2626] py-2.5 text-sm font-medium text-[#DC2626] transition-colors hover:bg-[#fee2e2]"
        >
          {t('settings.householdLeave')}
        </button>
      )}
    </div>
  )
}

function SettingsPage() {
  const { t, i18n: i18nInst } = useTranslation()
  const { theme, setTheme } = useTheme()
  const currentLang = i18nInst.language.startsWith('en') ? 'en' : 'pt'
  const { user } = useRouteContext({ from: '/app' })
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    navigate({ to: '/' })
  }

  const displayName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email?.split('@')[0] ||
    '—'
  const email = user?.email ?? ''
  const initial = displayName[0]?.toUpperCase() ?? '?'

  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => fetchMyProfile(),
  })

  const queryClient = useQueryClient()
  const unitMutation = useMutation({
    mutationFn: (unit: MeasurementUnit) => saveMeasurementUnit({ data: unit }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-profile'] }),
  })

  const currentUnit: MeasurementUnit = profile?.measurement_unit ?? 'metric'

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#FAFAF8] px-4 py-3 flex items-center gap-3 border-b border-[#F0F0EE]">
          <Link
            to="/app/library"
            search={{} as never}
            aria-label={t('recipe.back')}
            className="flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t('recipe.back')}
          </Link>
        </div>

        <div className="px-4 pt-5 space-y-6">
          <h1 className="text-xl font-bold text-[#1A1A1A]">{t('settings.title')}</h1>

          {/* Profile */}
          <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm px-4 py-4 flex items-center gap-3">
            <div
              aria-hidden="true"
              className="w-12 h-12 rounded-full bg-[#16A34A] flex items-center justify-center shrink-0"
            >
              <span className="text-white text-lg font-bold leading-none">{initial}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1A1A1A] truncate">{displayName}</p>
              <p className="text-xs text-[#6B7280] truncate mt-0.5">{email}</p>
            </div>
          </div>

          {/* Language */}
          <section>
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">
              {t('settings.language')}
            </p>
            <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden divide-y divide-[#F3F4F6]">
              {(['pt', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => i18n.changeLanguage(lang)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                >
                  <span className="font-medium">
                    {lang === 'pt' ? 'Português' : 'English'}
                  </span>
                  {currentLang === lang && (
                    <Check size={16} className="text-[#16A34A]" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Theme */}
          <section>
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">
              {t('settings.theme')}
            </p>
            <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden divide-y divide-[#F3F4F6]">
              {(['light', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                >
                  <span className="font-medium">
                    {mode === 'light' ? t('settings.light') : t('settings.dark')}
                  </span>
                  {theme === mode && (
                    <Check size={16} className="text-[#16A34A]" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Measurement units */}
          <section>
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">
              {t('settings.units')}
            </p>
            <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden divide-y divide-[#F3F4F6]">
              {(['metric', 'imperial'] as const).map((unit) => (
                <button
                  key={unit}
                  onClick={() => unitMutation.mutate(unit)}
                  disabled={unitMutation.isPending}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none disabled:opacity-60"
                >
                  <span className="font-medium">{t(`settings.${unit}`)}</span>
                  {currentUnit === unit && (
                    <Check size={16} className="text-[#16A34A]" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Household */}
          <section>
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">
              {t('settings.household')}
            </p>
            <HouseholdSection />
          </section>

          {/* Sign out */}
          <section className="pb-2">
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white py-3.5 text-sm font-medium text-[#DC2626] hover:bg-[#fee2e2] hover:border-[#fecaca] disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none shadow-sm"
            >
              <LogOut size={16} aria-hidden="true" />
              {signingOut ? '…' : t('settings.signOut')}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
