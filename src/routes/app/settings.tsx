import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import i18n from '../../i18n'

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

function SettingsPage() {
  const { t, i18n: i18nInst } = useTranslation()
  const { theme, setTheme } = useTheme()
  const currentLang = i18nInst.language.startsWith('en') ? 'en' : 'pt'

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#FAFAF8]/95 backdrop-blur-sm px-4 py-3 flex items-center gap-3 border-b border-[#F0F0EE]">
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
        </div>
      </div>
    </div>
  )
}
