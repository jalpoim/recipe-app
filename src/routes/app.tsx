import { createFileRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { BookOpen, CalendarDays, ShoppingCart } from 'lucide-react'
import { getAuthUser } from '../lib/supabase/server'
import { fetchActivePlanWithCount } from '../lib/supabase/plan-queries'

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const user = await getAuthUser()
    if (!user) throw redirect({ to: '/' })
    return { user }
  },
  component: AppLayout,
})

function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isLoading = useRouterState({ select: (s) => s.status === 'pending' })
  const [loadingTab, setLoadingTab] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoading) setLoadingTab(null)
  }, [isLoading])

  const { data: plan } = useQuery({
    queryKey: ['active-plan'],
    queryFn: fetchActivePlanWithCount,
  })

  const itemCount = plan?.item_count ?? 0

  const tabs = [
    { label: 'Receitas', icon: BookOpen, to: '/app/library' as const, disabled: false },
    { label: 'Plano', icon: CalendarDays, to: '/app/plan' as const, badge: itemCount, disabled: false },
    { label: 'Lista', icon: ShoppingCart, to: '/app/shopping' as const, disabled: false },
  ]

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

          const isLoadingThisTab = isLoading && loadingTab === tab.to

          return (
            <Link
              key={tab.to}
              to={tab.to}
              onClick={() => !isActive && setLoadingTab(tab.to)}
              className={`relative flex flex-col items-center justify-center flex-1 py-2 gap-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                isActive ? 'text-[#16A34A]' : 'text-[#9CA3AF] hover:text-[#6B7280]'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="relative">
                {isLoadingThisTab ? (
                  <svg
                    className="animate-spin text-[#16A34A]"
                    width={22}
                    height={22}
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                  </svg>
                ) : (
                  <Icon size={22} aria-hidden="true" />
                )}
                {'badge' in tab && tab.badge > 0 && !isLoadingThisTab && (
                  <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-[#16A34A] text-white text-[9px] font-bold flex items-center justify-center leading-none">
                    {tab.badge > 99 ? '99+' : tab.badge}
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

function AppLayout() {
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  )
}
