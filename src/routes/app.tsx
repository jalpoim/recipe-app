import { createFileRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { BookOpen, CalendarDays, ShoppingCart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { fetchActivePlanWithCount } from '../lib/supabase/plan-queries'
import { acceptInvite } from '../lib/supabase/household-queries'
import { saveMeasurementUnit } from '../lib/supabase/profile-queries'
import { getAuthUser } from '../lib/supabase/server'
import { supabase } from '../lib/supabase/browser'
import { capture, identifyUser } from '../lib/analytics'
import { detectLocaleFromBrowser } from '../lib/detect-locale'
import i18n from '../i18n'

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    // getAuthUser() uses the server client (reads cookies from the request),
    // so it works correctly during SSR — unlike the browser client which has
    // no cookie access on the server and always returns null.
    const user = await getAuthUser()
    if (!user) throw redirect({ to: '/' })

    // Process pending invite saved before sign-in (client-only — localStorage
    // is undefined on the server so this block is safely skipped during SSR)
    const pendingToken =
      typeof localStorage !== 'undefined' ? localStorage.getItem('pendingInviteToken') : null
    if (pendingToken) {
      localStorage.removeItem('pendingInviteToken')
      try {
        await acceptInvite({ data: pendingToken })
        await supabase.auth.refreshSession()
      } catch {
        // Silently ignore — invite may be expired or already used
      }
    }

    return { user }
  },
  component: AppLayout,
})

function BottomNav() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const prevTabRef = useRef(pathname)

  const { data: plan } = useQuery({
    queryKey: ['active-plan'],
    queryFn: fetchActivePlanWithCount,
    staleTime: 5 * 60 * 1000,
  })

  const itemCount = plan?.item_count ?? 0

  const tabs = [
    { label: t('nav.recipes'), icon: BookOpen, to: '/app/library' as const, key: 'library', disabled: false },
    { label: t('nav.plan'), icon: CalendarDays, to: '/app/plan' as const, key: 'plan', badge: itemCount, disabled: false },
    { label: t('nav.list'), icon: ShoppingCart, to: '/app/shopping' as const, key: 'shopping', disabled: false },
  ]

  function handleTabPress(to: string, key: string) {
    const from = tabs.find((tab) => pathname.startsWith(tab.to))?.key ?? 'unknown'
    if (from !== key) capture('tab_switched', { from, to: key })
    prevTabRef.current = to
  }

  const activeTabIndex = tabs.findIndex((tab) => pathname.startsWith(tab.to))

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-[#E5E7EB] pb-safe">
      <div className="relative max-w-md mx-auto">
        {/* Sliding green indicator */}
        <div
          aria-hidden="true"
          className="absolute top-0 left-0 h-0.5 bg-[#16A34A] transition-[transform] duration-200 ease-in-out motion-reduce:transition-none"
          style={{
            width: `${100 / tabs.length}%`,
            transform: `translateX(${Math.max(0, activeTabIndex) * 100}%)`,
          }}
        />
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.to)
          const Icon = tab.icon

          if (tab.disabled) {
            return (
              <div
                key={tab.to}
                className="flex flex-col items-center justify-center flex-1 py-2 gap-0.5 opacity-35 cursor-not-allowed"
                aria-disabled="true"
              >
                <Icon size={22} aria-hidden="true" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </div>
            )
          }

          return (
            <Link
              key={tab.to}
              to={tab.to}
              onClick={() => handleTabPress(tab.to, tab.key)}
              className={`relative flex flex-col items-center justify-center flex-1 py-2 gap-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                isActive ? 'text-[#16A34A]' : 'text-[#9CA3AF] hover:text-[#6B7280]'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="relative">
                <Icon size={22} aria-hidden="true" />
                {'badge' in tab && (tab.badge ?? 0) > 0 && (
                  <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-[#16A34A] text-white text-[9px] font-bold flex items-center justify-center leading-none">
                    {(tab.badge ?? 0) > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          )
        })}
      </div>
      </div>
    </nav>
  )
}

function TopProgressBar() {
  const isLoading = useRouterState({ select: (s) => s.status === 'pending' })
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-0.5">
      <div
        className={`h-full bg-[#16A34A] transition-all duration-300 ${
          isLoading ? 'opacity-100 animate-progress' : 'opacity-0 w-full'
        }`}
      />
    </div>
  )
}

const LOCALE_BOOTSTRAP_KEY = 'locale_bootstrapped_v1'

function AppLayout() {
  const { user } = Route.useRouteContext()

  useEffect(() => {
    if (user) identifyUser(user.id, user.email)
  }, [user.id])

  // On first visit per browser: detect language + units from Accept-Language and save to profile.
  // Uses a localStorage flag so this runs once and never overrides a deliberate user preference.
  useEffect(() => {
    if (!user) return
    if (typeof localStorage === 'undefined') return
    if (localStorage.getItem(LOCALE_BOOTSTRAP_KEY)) return

    const { language, measurementUnit } = detectLocaleFromBrowser()

    // Apply detected language to i18next immediately
    if (i18n.language !== language) {
      i18n.changeLanguage(language)
    }

    // Persist measurement unit to profile (fire-and-forget; non-critical)
    saveMeasurementUnit({ data: measurementUnit }).catch(() => {})

    localStorage.setItem(LOCALE_BOOTSTRAP_KEY, '1')
  }, [user.id])

  return (
    <>
      <TopProgressBar />
      <Outlet />
      <BottomNav />
    </>
  )
}
