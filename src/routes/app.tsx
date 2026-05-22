import { createFileRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { BookOpen, CalendarDays, ShoppingCart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { fetchActivePlanWithCount } from '../lib/supabase/plan-queries'
import { acceptInvite } from '../lib/supabase/household-queries'
import { supabase } from '../lib/supabase/browser'
import { capture, identifyUser } from '../lib/analytics'

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw redirect({ to: '/' })
    const user = session.user

    // Process pending invite saved before sign-in
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

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-[#E5E7EB] pb-safe">
      <div className="flex items-stretch max-w-md mx-auto">
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

function AppLayout() {
  const { user } = Route.useRouteContext()
  useEffect(() => {
    if (user) identifyUser(user.id, user.email)
  }, [user.id])
  return (
    <>
      <TopProgressBar />
      <Outlet />
      <BottomNav />
    </>
  )
}
