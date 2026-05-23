import { HeadContent, Scripts, createRootRoute, Outlet } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { preconnect } from 'react-dom'
import '../i18n'
import { ToastProvider } from '../components/Toast'
import { initAnalytics } from '../lib/analytics'

if (typeof window !== 'undefined') initAnalytics()

import appCss from '../styles.css?url'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#FAFAF8] px-4 text-center">
      <p className="text-5xl">🥗</p>
      <h1 className="text-xl font-semibold text-[#1A1A1A]">Página não encontrada</h1>
      <p className="text-sm text-[#6B7280]">Este endereço não existe.</p>
      <a href="/app/library" className="mt-2 rounded-lg bg-[#16A34A] px-5 py-2.5 text-sm font-semibold text-white">
        Ir para as receitas
      </a>
    </div>
  )
}

export const Route = createRootRoute({
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Meal Prep' },
      { name: 'description', content: 'Planeador de refeições com foco em proteína' },
      { name: 'theme-color', content: '#16A34A' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      { name: 'apple-mobile-web-app-title', content: 'Meal Prep' },
      { name: 'mobile-web-app-capable', content: 'yes' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.json' },
      { rel: 'apple-touch-icon', href: '/logo192.png' },
    ],
  }),
  shellComponent: RootDocument,
  component: () => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </QueryClientProvider>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  preconnect('https://kgvycfrvxzkfhvuazzle.supabase.co')
  return (
    <html lang="pt">
      <head>
        <HeadContent />
        {/* Restore theme before first paint to avoid FOUC */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);})()` }} />
      </head>
      <body className="bg-[#FAFAF8] text-[#1A1A1A] min-h-screen font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
