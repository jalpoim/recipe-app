import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { capture } from '../../../lib/analytics'
import { ArrowLeft, Bookmark, BookmarkCheck, Clock, Edit, Heart, Minus, Plus, ChevronLeft, ChevronRight, X, UtensilsCrossed, CheckCircle2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchRecipeById } from '../../../lib/supabase/queries'
import { useToast } from '../../../components/Toast'
import {
  addRecipeToPlan,
  removePlanItem,
  fetchPlanItem,
  updatePlanItemMultiplier,
} from '../../../lib/supabase/plan-queries'
import {
  logRecipeCooked,
  fetchRecipeCookCounts,
  deleteCookLogEntry,
} from '../../../lib/supabase/cook-log-queries'
import {
  upsertInteraction,
  removeInteraction,
  fetchInteractions,
} from '../../../lib/supabase/interaction-queries'
import type { RecipeIngredient, RecipeStep } from '../../../types/db'

function RecipeDetailSkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-56">
      <div className="mx-auto w-full max-w-md px-4 py-5 space-y-4 animate-pulse motion-reduce:animate-none">
        <div className="h-4 w-16 bg-[#F3F4F6] rounded-full" />
        <div className="h-7 w-3/4 bg-[#F3F4F6] rounded-full" />
        <div className="h-4 w-1/3 bg-[#F3F4F6] rounded-full" />
        <div className="h-20 bg-[#F3F4F6] rounded-2xl" />
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 bg-[#F3F4F6] rounded-2xl" />)}
        </div>
        <div className="h-4 w-24 bg-[#F3F4F6] rounded-full" />
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 bg-[#F3F4F6] rounded-xl" />)}
      </div>
    </div>
  )
}

function RecipeDetailError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">Não foi possível carregar a receita</p>
        <p className="text-sm text-[#6B7280]">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-sm text-[#16A34A] underline"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/app/library/$recipeId')({
  pendingComponent: RecipeDetailSkeleton,
  errorComponent: ({ error }) => <RecipeDetailError error={error as Error} />,
  validateSearch: (search) => ({
    from: search.from === 'plan' ? ('plan' as const) : undefined,
    planItemId: typeof search.planItemId === 'string' ? search.planItemId : undefined,
  }),
  loaderDeps: ({ search }) => ({ planItemId: search.planItemId }),
  loader: async ({ params, deps }) => {
    const recipe = await fetchRecipeById({ data: params.recipeId })
    const planItem = deps.planItemId
      ? await fetchPlanItem({ data: deps.planItemId })
      : null
    return { recipe, planItem }
  },
  component: RecipeDetailPage,
})

// ---------- helpers ----------

function fmt(n: number, decimals = 1) {
  if (n % 1 === 0) return n.toFixed(0)
  return n.toFixed(decimals)
}

function scaledMacro(
  raw: number | null,
  servings: number,
  macrosTotal: boolean,
  multiplier: number,
) {
  if (raw == null) return 0
  const perServing = macrosTotal ? raw / (servings || 1) : raw
  return perServing * multiplier
}

function scaleIngredient(
  ing: RecipeIngredient,
  multiplier: number,
  baseServings: number,
): string {
  const rawDisplay = ing.raw_text.replace(/^\(opcional\)\s*/i, '')
  if (ing.quantity == null) return rawDisplay
  const factor = multiplier / (baseServings || 1)
  const scaled = ing.quantity * factor
  const qty = fmt(scaled)
  const parts = [qty, ing.unit, ing.name].filter(Boolean)
  return parts.length > 1 ? parts.join(' ') : rawDisplay
}

function badgeClass(ratio: number) {
  if (ratio >= 1.0) return 'text-[#15803d] bg-[#dcfce7]'
  if (ratio >= 0.7) return 'text-[#B45309] bg-[#fef3c7]'
  return 'text-[#DC2626] bg-[#fee2e2]'
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.6)
    setTimeout(() => ctx.close(), 1000)
  } catch {}
}

// ---------- StepTimer ----------

const RADIUS = 45
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function StepTimer({
  initialSeconds,
  stepLabel,
  recipeName,
}: {
  initialSeconds: number
  stepLabel: string
  recipeName: string
}) {
  const { t } = useTranslation()
  const [seconds, setSeconds] = useState(initialSeconds)
  const [timeLeft, setTimeLeft] = useState(initialSeconds)
  const [isRunning, setIsRunning] = useState(false)
  const [isConfiguring, setIsConfiguring] = useState(initialSeconds === 0)
  const [inputMinutes, setInputMinutes] = useState(Math.max(1, Math.round(initialSeconds / 60)))
  const startTimeRef = useRef<number | null>(null)
  const remainingAtPauseRef = useRef(initialSeconds)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const notifTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasBeepedRef = useRef(false)

  useEffect(() => {
    return () => {
      clearInterval(intervalRef.current!)
      clearTimeout(notifTimeoutRef.current!)
    }
  }, [])

  useEffect(() => {
    if (!isRunning) return
    startTimeRef.current = Date.now()
    intervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current!) / 1000)
      const remaining = Math.max(0, remainingAtPauseRef.current - elapsed)
      setTimeLeft(remaining)
      if (remaining === 0) {
        clearInterval(intervalRef.current!)
        setIsRunning(false)
        remainingAtPauseRef.current = 0
        if (!hasBeepedRef.current) {
          hasBeepedRef.current = true
          playBeep()
        }
      }
    }, 500)
    return () => clearInterval(intervalRef.current!)
  }, [isRunning])

  async function startTimer(secs: number) {
    if ('Notification' in window) {
      if (Notification.permission === 'default') await Notification.requestPermission()
      if (Notification.permission === 'granted') {
        clearTimeout(notifTimeoutRef.current!)
        notifTimeoutRef.current = setTimeout(() => {
          new Notification(`⏱ ${stepLabel}`, {
            body: t('cooking.timerDone', { recipe: recipeName }),
            silent: false,
          })
        }, secs * 1000)
      }
    }
    setIsRunning(true)
  }

  async function handleStart() {
    await startTimer(timeLeft)
  }

  function handlePause() {
    clearTimeout(notifTimeoutRef.current!)
    clearInterval(intervalRef.current!)
    remainingAtPauseRef.current = timeLeft
    setIsRunning(false)
  }

  function handleReset() {
    clearTimeout(notifTimeoutRef.current!)
    clearInterval(intervalRef.current!)
    setIsRunning(false)
    setTimeLeft(seconds)
    remainingAtPauseRef.current = seconds
    hasBeepedRef.current = false
    startTimeRef.current = null
  }

  function handleSetTimer() {
    const s = Math.max(60, inputMinutes * 60)
    setSeconds(s)
    setTimeLeft(s)
    remainingAtPauseRef.current = s
    setIsConfiguring(false)
    startTimer(s)
  }

  const isDone = timeLeft === 0
  const progress = seconds > 0 ? timeLeft / seconds : 0
  const offset = CIRCUMFERENCE * (1 - progress)

  if (isConfiguring) {
    return (
      <div className="flex flex-col items-center gap-3 py-3">
        <p className="text-xs text-[#9CA3AF]">{t('cooking.setTimer')}</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setInputMinutes((m) => Math.max(1, m - 1))}
            aria-label={t('cooking.decreaseMinutes')}
            className="w-9 h-9 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <span className="text-2xl font-bold text-[#1A1A1A] w-16 text-center tabular-nums">
            {t('cooking.minutes', { count: inputMinutes })}
          </span>
          <button
            onClick={() => setInputMinutes((m) => Math.min(99, m + 1))}
            aria-label={t('cooking.increaseMinutes')}
            className="w-9 h-9 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        <button
          onClick={handleSetTimer}
          className="px-6 py-2 rounded-xl bg-[#16A34A] text-white text-sm font-semibold hover:bg-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
        >
          {t('common.confirm')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3 py-3">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="#F3F4F6" strokeWidth="6" />
          <circle
            cx="50" cy="50" r={RADIUS}
            fill="none"
            stroke={isDone ? '#DC2626' : '#16A34A'}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xl font-bold tabular-nums ${isDone ? 'text-[#DC2626]' : 'text-[#1A1A1A]'}`}>
            {formatTime(timeLeft)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isDone ? (
          <button
            onClick={handleReset}
            className="px-4 py-1.5 rounded-xl bg-[#F3F4F6] text-sm font-medium text-[#6B7280] hover:bg-[#E5E7EB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
          >
            {t('cooking.reset')}
          </button>
        ) : (
          <>
            <button
              onClick={isRunning ? handlePause : handleStart}
              className={`px-5 py-1.5 rounded-xl text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                isRunning ? 'bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]' : 'bg-[#16A34A] text-white hover:bg-[#15803d]'
              }`}
            >
              {isRunning ? t('cooking.pause') : t('cooking.start')}
            </button>
            <button
              onClick={handleReset}
              aria-label={t('cooking.resetLabel')}
              className="w-8 h-8 rounded-xl bg-[#F3F4F6] text-[#9CA3AF] hover:bg-[#E5E7EB] flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- CookingMode ----------

function CookingMode({
  recipeName,
  steps,
  ingredients,
  multiplier,
  baseServings,
  onExit,
  onFinished,
}: {
  recipeName: string
  steps: RecipeStep[]
  ingredients: RecipeIngredient[]
  multiplier: number
  baseServings: number
  onExit: () => void
  onFinished?: () => void
}) {
  const { t } = useTranslation()
  const [stepIndex, setStepIndex] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [showIngredients, setShowIngredients] = useState(false)
  const [timerOpen, setTimerOpen] = useState(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    navigator.wakeLock?.request('screen').then((lock) => {
      wakeLockRef.current = lock
    }).catch(() => {})
    return () => { wakeLockRef.current?.release().catch(() => {}) }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showIngredients) setShowIngredients(false)
        else onExit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showIngredients, onExit])

  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null
  const currStep = steps[stepIndex]
  const nextStep = stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null
  const isFirst = stepIndex === 0
  const isLast = stepIndex === steps.length - 1

  function navigateTo(index: number) {
    setDirection(index > stepIndex ? 'forward' : 'back')
    setStepIndex(index)
  }

  function goNext() {
    if (isLast) { onFinished ? onFinished() : onExit(); return }
    setDirection('forward')
    setStepIndex((i) => i + 1)
  }

  function goPrev() {
    if (!isFirst) {
      setDirection('back')
      setStepIndex((i) => i - 1)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('cooking.mode')} className="fixed inset-0 z-50 bg-[#FAFAF8] flex flex-col select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#F0F0EE] shrink-0">
        <button
          onClick={onExit}
          aria-label={t('cooking.exitLabel')}
          className="flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
        >
          <X size={16} aria-hidden="true" />
          {t('cooking.exit')}
        </button>
        <p className="text-sm font-medium text-[#6B7280] truncate max-w-[55%] text-center">
          {recipeName}
        </p>
        <button
          onClick={() => setShowIngredients(true)}
          className="text-sm text-[#16A34A] font-medium hover:text-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
        >
          {t('recipe.ingredients')}
        </button>
      </div>

      {/* Carousel */}
      <div className="flex-1 flex flex-col justify-center overflow-hidden px-6 py-4">

        {/* Previous step */}
        <div className="flex-1 flex items-end pb-5">
          {prevStep ? (
            <button
              onClick={goPrev}
              aria-label={t('cooking.prevStepLabel')}
              className="w-full text-sm text-[#C4C9D4] leading-relaxed text-center line-clamp-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 rounded"
            >
              {prevStep.text}
            </button>
          ) : <div className="w-full" />}
        </div>

        <div className="w-12 h-px bg-[#E5E7EB] mx-auto mb-5" />

        {/* Current step */}
        <div className="flex flex-col items-center gap-3 shrink-0">
          <p className="text-xs font-semibold text-[#9CA3AF] tracking-widest uppercase">
            {t('cooking.stepOf', { current: stepIndex + 1, total: steps.length })}
          </p>
          <p
            key={stepIndex}
            className={`text-xl font-medium text-[#1A1A1A] leading-relaxed text-center ${direction === 'forward' ? 'step-enter-forward' : 'step-enter-back'}`}
          >
            {currStep.text}
          </p>
        </div>

        <div className="w-12 h-px bg-[#E5E7EB] mx-auto mt-5" />

        {/* Next step */}
        <div className="flex-1 flex items-start pt-5">
          {nextStep ? (
            <button
              onClick={goNext}
              aria-label={t('cooking.nextStepLabel')}
              className="w-full text-sm text-[#C4C9D4] leading-relaxed text-center line-clamp-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 rounded"
            >
              {nextStep.text}
            </button>
          ) : <div className="w-full" />}
        </div>
      </div>

      {/* Timer panel — slides in above nav when open */}
      {timerOpen && (
        <div className="shrink-0 border-t border-[#F0F0EE] bg-white px-4 py-2">
          <StepTimer
            initialSeconds={currStep.timer_seconds ?? 0}
            stepLabel={t('cooking.stepOf', { current: stepIndex + 1, total: steps.length })}
            recipeName={recipeName}
          />
        </div>
      )}

      {/* Step dots + timer toggle */}
      <div className="shrink-0 flex flex-col items-center gap-3 pt-3 pb-2 px-4">
        <div className="flex justify-center gap-1.5">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => navigateTo(i)}
              aria-label={t('cooking.stepDotLabel', { n: i + 1 })}
              className={`rounded-full transition-all focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                i === stepIndex
                  ? 'w-4 h-2 bg-[#16A34A]'
                  : i < stepIndex
                  ? 'w-2 h-2 bg-[#16A34A]/40'
                  : 'w-2 h-2 bg-[#E5E7EB]'
              }`}
            />
          ))}
        </div>

        {/* Timer toggle button */}
        <button
          onClick={() => setTimerOpen((o) => !o)}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
            timerOpen
              ? 'border-[#16A34A] bg-[#dcfce7] text-[#15803d]'
              : 'border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]'
          }`}
        >
          <Clock size={14} aria-hidden="true" />
          {t('cooking.timer')}
        </button>
      </div>

      {/* Navigation */}
      <div className="px-4 pb-safe flex gap-3 shrink-0 pt-2">
        <button
          onClick={goPrev}
          disabled={isFirst}
          aria-label={t('cooking.prevStepLabel')}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-[#E5E7EB] bg-white text-sm font-semibold text-[#1A1A1A] disabled:opacity-30 hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
        >
          <ChevronLeft size={18} aria-hidden="true" />
          {t('cooking.prev')}
        </button>
        <button
          onClick={goNext}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#16A34A] text-white text-sm font-semibold hover:bg-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
        >
          {isLast ? t('cooking.done') : t('cooking.next')}
          {!isLast && <ChevronRight size={18} aria-hidden="true" />}
        </button>
      </div>

      {/* Ingredients sheet */}
      {showIngredients && (
        <div className="fixed inset-0 z-[60] flex items-end" aria-hidden="true" onClick={() => setShowIngredients(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('recipe.ingredients')}
            aria-hidden="false"
            className="w-full max-w-md mx-auto bg-white rounded-t-2xl border-t border-[#E5E7EB] max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#F3F4F6] shrink-0">
              <p className="text-sm font-semibold text-[#1A1A1A]">{t('recipe.ingredients')}</p>
              <button
                onClick={() => setShowIngredients(false)}
                aria-label={t('common.close')}
                className="text-[#9CA3AF] hover:text-[#6B7280] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain pb-6">
              {(() => {
                const sections: { label: string | null; items: RecipeIngredient[] }[] = []
                const sectionMap = new Map<string, typeof sections[0]>()
                for (const ing of ingredients) {
                  const key = ing.section_label ?? '__main__'
                  if (!sectionMap.has(key)) {
                    const s = { label: ing.section_label, items: [] as RecipeIngredient[] }
                    sectionMap.set(key, s)
                    sections.push(s)
                  }
                  sectionMap.get(key)!.items.push(ing)
                }
                return sections.map(({ label, items }) => (
                  <div key={label ?? '__main__'}>
                    {label && (
                      <div className="px-4 py-2 border-b border-[#F3F4F6] flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
                        <span className="text-[10px] text-[#9CA3AF] border border-[#E5E7EB] rounded-full px-1.5 py-0.5">{t('recipe.optional')}</span>
                      </div>
                    )}
                    <div className="divide-y divide-[#F3F4F6]">
                      {items.map((ing) => (
                        <div key={ing.id} className={`px-4 py-3 flex items-baseline justify-between gap-2 ${ing.is_optional && !label ? 'opacity-60' : ''}`}>
                          <span className={`text-sm ${ing.is_optional && !label ? 'text-[#6B7280]' : 'text-[#1A1A1A]'}`}>
                            {scaleIngredient(ing, multiplier, baseServings)}
                          </span>
                          {ing.is_optional && !label && (
                            <span className="shrink-0 text-[10px] text-[#9CA3AF] border border-[#E5E7EB] rounded-full px-1.5 py-0.5 whitespace-nowrap">{t('recipe.optional')}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- RecipeDetailPage ----------

function RecipeDetailPage() {
  const { t } = useTranslation()
  const { recipe, planItem } = Route.useLoaderData()
  const routeCtx = Route.useRouteContext() as { user?: { id: string } }
  const user = routeCtx?.user ?? null
  const search = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showToast } = useToast()
  const isFromPlan = search.from === 'plan' && !!search.planItemId
  const isOwner = !!user && recipe.owner_id === user.id
  const [multiplier, setMultiplier] = useState(
    planItem?.portion_multiplier ?? recipe.servings,
  )
  const [isCooking, setIsCooking] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [lastCookLogId, setLastCookLogId] = useState<string | null>(null)
  const [cookDebounced, setCookDebounced] = useState(false)
  const [cookIconBouncing, setCookIconBouncing] = useState(false)
  const skipFirstSave = useRef(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // Interactions (like/save)
  const { data: interactions = [] } = useQuery({
    queryKey: ['interactions'],
    queryFn: fetchInteractions,
    staleTime: 5 * 60 * 1000,
  })
  const isLiked = interactions.some((i) => i.recipe_id === recipe.id && i.type === 'like')
  const isSaved = interactions.some((i) => i.recipe_id === recipe.id && i.type === 'save')

  const [likeCount, setLikeCount] = useState(recipe.like_count ?? 0)

  const likeMutation = useMutation({
    mutationFn: () =>
      isLiked
        ? removeInteraction({ data: { recipeId: recipe.id, type: 'like' } })
        : upsertInteraction({ data: { recipeId: recipe.id, type: 'like' } }),
    onMutate: () => {
      setLikeCount((c) => (isLiked ? c - 1 : c + 1))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interactions'] }),
    onError: () => {
      setLikeCount((c) => (isLiked ? c + 1 : c - 1))
      showToast(t('common.error'), 'error')
    },
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      isSaved
        ? removeInteraction({ data: { recipeId: recipe.id, type: 'save' } })
        : upsertInteraction({ data: { recipeId: recipe.id, type: 'save' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interactions'] }),
    onError: () => showToast(t('common.error'), 'error'),
  })

  // Personal cook count for this recipe
  const { data: cookCounts } = useQuery({
    queryKey: ['cook-counts', recipe.id],
    queryFn: () => fetchRecipeCookCounts({ data: [recipe.id] }),
    staleTime: 0,
  })
  const myCookCount = cookCounts?.find((c) => c.recipe_id === recipe.id)?.count ?? 0

  // Log cooked mutation
  const logCookMutation = useMutation({
    mutationFn: () => logRecipeCooked({ data: { recipeId: recipe.id, source: 'manual' } }),
    onSuccess: (row) => {
      setLastCookLogId(row.id)
      setCookIconBouncing(true)
      qc.invalidateQueries({ queryKey: ['cook-counts', recipe.id] })
      showToast(t('recipe.logCookedSuccess'), 'success')
      setCookDebounced(true)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => setCookDebounced(false), 3000)
    },
    onError: () => showToast(t('common.error'), 'error'),
  })

  // Undo last cook log entry
  const undoCookMutation = useMutation({
    mutationFn: () => deleteCookLogEntry({ data: { cookLogId: lastCookLogId! } }),
    onSuccess: () => {
      setLastCookLogId(null)
      qc.invalidateQueries({ queryKey: ['cook-counts', recipe.id] })
    },
    onError: () => showToast(t('common.error'), 'error'),
  })

  function handleCookingDone() {
    setIsCooking(false)
    logCookMutation.mutate()
  }

  // Auto-save portion_multiplier back to the plan item (debounced)
  const saveMultMutation = useMutation({
    mutationFn: (mult: number) =>
      updatePlanItemMultiplier({ data: { planItemId: search.planItemId!, multiplier: mult } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan-items'] })
    },
  })

  useEffect(() => {
    if (!isFromPlan) return
    if (skipFirstSave.current) { skipFirstSave.current = false; return }
    const timer = setTimeout(() => saveMultMutation.mutate(multiplier), 600)
    return () => clearTimeout(timer)
  }, [multiplier]) // eslint-disable-line react-hooks/exhaustive-deps

  const cal = scaledMacro(recipe.calories, recipe.servings, recipe.macros_total, multiplier)
  const pro = scaledMacro(recipe.protein, recipe.servings, recipe.macros_total, multiplier)
  const carb = scaledMacro(recipe.carbs, recipe.servings, recipe.macros_total, multiplier)
  const fat = scaledMacro(recipe.fat, recipe.servings, recipe.macros_total, multiplier)

  const perServingCal = recipe.macros_total
    ? (recipe.calories ?? 0) / (recipe.servings || 1)
    : (recipe.calories ?? 0)
  const perServingPro = recipe.macros_total
    ? (recipe.protein ?? 0) / (recipe.servings || 1)
    : (recipe.protein ?? 0)
  const ratio = perServingCal ? (perServingPro * 10) / perServingCal : 0

  // Add to plan
  const addMutation = useMutation({
    mutationFn: () => addRecipeToPlan({ data: recipe.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-plan'] })
      qc.invalidateQueries({ queryKey: ['plan-items'] })
      showToast('Adicionado ao plano ✓', 'success')
      capture('recipe_added_to_plan', { recipeId: recipe.id })
    },
    onError: () => showToast('Erro ao adicionar ao plano', 'error'),
  })

  // Remove from plan
  const removeMutation = useMutation({
    mutationFn: () => removePlanItem({ data: search.planItemId! }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-plan'] })
      qc.invalidateQueries({ queryKey: ['plan-items'] })
      navigate({ to: '/app/plan' })
    },
  })

  const hasSteps = recipe.recipe_steps.length > 0

  if (isCooking) {
    return (
      <CookingMode
        recipeName={recipe.name}
        steps={recipe.recipe_steps}
        ingredients={recipe.recipe_ingredients.filter((i) => !i.is_pantry)}
        multiplier={multiplier}
        baseServings={recipe.servings}
        onExit={() => setIsCooking(false)}
        onFinished={handleCookingDone}
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]" style={{ paddingBottom: 'calc(12rem + env(safe-area-inset-bottom))' }}>
      <div className="mx-auto w-full max-w-md">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-[#FAFAF8] px-4 py-3 flex items-center gap-3 border-b border-[#F0F0EE]">
          <button
            onClick={() => navigate({ to: isFromPlan ? '/app/plan' : '/app/library' })}
            aria-label={t('recipe.back')}
            className="flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t('recipe.back')}
          </button>
          <div className="flex-1" />
          {/* Like button */}
          <button
            onClick={() => likeMutation.mutate()}
            disabled={likeMutation.isPending}
            aria-label={isLiked ? t('recipe.unlike') : t('recipe.like')}
            aria-pressed={isLiked}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none disabled:opacity-60 ${isLiked ? 'bg-[#fee2e2] border-[#fecaca] text-[#DC2626]' : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#fecaca] hover:text-[#DC2626]'}`}
          >
            <Heart size={13} className={isLiked ? 'fill-current' : ''} aria-hidden="true" />
            {likeCount > 0 ? likeCount : t('recipe.like')}
          </button>
          {/* Save button */}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            aria-label={isSaved ? t('recipe.unsave') : t('recipe.save')}
            aria-pressed={isSaved}
            className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none disabled:opacity-60 ${isSaved ? 'bg-[#dcfce7] border-[#16A34A] text-[#15803d]' : 'bg-white border-[#E5E7EB] text-[#9CA3AF] hover:border-[#16A34A] hover:text-[#16A34A]'}`}
          >
            {isSaved ? <BookmarkCheck size={14} aria-hidden="true" /> : <Bookmark size={14} aria-hidden="true" />}
          </button>
          {/* Edit button — owner only */}
          {isOwner && (
            <Link
              to="/app/library/$recipeId/edit"
              params={{ recipeId: recipe.id }}
              aria-label={t('recipe.edit')}
              className="w-8 h-8 rounded-full border border-[#E5E7EB] bg-white flex items-center justify-center text-[#9CA3AF] hover:text-[#1A1A1A] hover:border-[#D1D5DB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              <Edit size={14} aria-hidden="true" />
            </Link>
          )}
        </div>

        <div className="px-4 pt-5 space-y-5">
          {/* Title + badge */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-[#1A1A1A] leading-snug flex-1">
              {recipe.name}
            </h1>
            {recipe.calories != null && recipe.protein != null && (
              <span className={`shrink-0 text-sm font-bold px-2.5 py-1 rounded-full ${badgeClass(ratio)}`}>
                {fmt(ratio)}
              </span>
            )}
          </div>

          {/* Time + servings */}
          <div className="flex items-center gap-4 text-sm text-[#6B7280]">
            {recipe.time_min != null && (
              <span className="flex items-center gap-1.5">
                <Clock size={14} aria-hidden="true" />
                {recipe.time_min} {t('common.min')}
              </span>
            )}
            <span>
              {recipe.servings} {recipe.servings !== 1 ? t('recipe.bases') : t('recipe.base')}
            </span>
          </div>

          {/* Tags */}
          {recipe.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {recipe.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2.5 py-1 rounded-full bg-[#F3F4F6] text-[#6B7280] font-medium"
                >
                  {t(`tags.${tag}`, tag)}
                </span>
              ))}
            </div>
          )}

          {/* Moderation badge — owner only */}
          {isOwner && recipe.moderation_status === 'pending_review' && (
            <div className="rounded-xl bg-[#fef3c7] border border-[#B45309]/30 px-3 py-2">
              <p className="text-xs font-semibold text-[#B45309]">{t('moderation.pending')}</p>
              <p className="text-xs text-[#B45309]/80 mt-0.5">{t('moderation.pendingHint')}</p>
            </div>
          )}
          {isOwner && recipe.moderation_status === 'rejected' && (
            <div className="rounded-xl bg-[#fee2e2] border border-[#DC2626]/30 px-3 py-2">
              <p className="text-xs font-semibold text-[#DC2626]">{t('moderation.rejected')}</p>
              <p className="text-xs text-[#DC2626]/80 mt-0.5">{t('moderation.rejectedHint')}</p>
            </div>
          )}

          {/* Personal cook count */}
          {myCookCount > 0 && (
            <p className="text-sm text-[#9CA3AF]">
              {t('recipe.cookedCount', { count: myCookCount })}
            </p>
          )}

          {/* Portion stepper */}
          <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#1A1A1A]">{t('recipe.servings')}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMultiplier((m) => Math.max(1, m - 1))}
                  disabled={multiplier <= 1}
                  aria-label="Diminuir porções"
                  className="w-9 h-9 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#1A1A1A] disabled:opacity-30 hover:bg-[#F3F4F6] active:bg-[#E5E7EB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                >
                  <Minus size={16} aria-hidden="true" />
                </button>
                <span
                  className="w-6 text-center font-bold text-[#1A1A1A]"
                  aria-live="polite"
                  aria-label={`${multiplier} porções`}
                >
                  {multiplier}
                </span>
                <button
                  onClick={() => setMultiplier((m) => m + 1)}
                  aria-label="Aumentar porções"
                  className="w-9 h-9 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#1A1A1A] hover:bg-[#F3F4F6] active:bg-[#E5E7EB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* Macros grid */}
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { key: 'recipe.calories' as const, value: cal, unit: 'kcal' },
                { key: 'recipe.protein' as const, value: pro, unit: 'g' },
                { key: 'recipe.carbs' as const, value: carb, unit: 'g' },
                { key: 'recipe.fat' as const, value: fat, unit: 'g' },
              ]
            ).map(({ key, value, unit }) => (
              <div
                key={key}
                className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-3 text-center"
              >
                <div className="text-[9px] text-[#9CA3AF] uppercase tracking-wide leading-tight font-medium">
                  {t(key)}
                </div>
                <div className="text-lg font-bold text-[#1A1A1A] mt-0.5">{fmt(value, 0)}</div>
                <div className="text-[9px] text-[#9CA3AF] font-medium">{unit}</div>
              </div>
            ))}
          </div>

          {/* Ingredients */}
          {recipe.recipe_ingredients.length > 0 && (() => {
            // Group by section_label, preserving order of first appearance
            const sections: { label: string | null; items: typeof recipe.recipe_ingredients }[] = []
            const sectionMap = new Map<string, typeof sections[0]>()
            for (const ing of recipe.recipe_ingredients) {
              const key = ing.section_label ?? '__main__'
              if (!sectionMap.has(key)) {
                const s = { label: ing.section_label, items: [] as typeof recipe.recipe_ingredients }
                sectionMap.set(key, s)
                sections.push(s)
              }
              sectionMap.get(key)!.items.push(ing)
            }
            return (
              <div>
                <h2 className="text-base font-semibold text-[#1A1A1A] mb-3">{t('recipe.ingredients')}</h2>
                <div className="space-y-3">
                  {sections.map(({ label, items }) => (
                    <div key={label ?? '__main__'} className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden">
                      {label && (
                        <div className="px-4 py-2 border-b border-[#F3F4F6] flex items-center gap-2">
                          <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
                          <span className="text-[10px] text-[#9CA3AF] border border-[#E5E7EB] rounded-full px-1.5 py-0.5">{t('recipe.optional')}</span>
                        </div>
                      )}
                      <div className="divide-y divide-[#F3F4F6]">
                        {items.map((ing) => (
                          <div key={ing.id} className={`px-4 py-3 flex items-baseline justify-between gap-2 ${ing.is_optional && !label ? 'opacity-60' : ''}`}>
                            <span className={`text-sm ${ing.is_optional && !label ? 'text-[#6B7280]' : 'text-[#1A1A1A]'}`}>
                              {scaleIngredient(ing, multiplier, recipe.servings)}
                            </span>
                            {ing.is_optional && !label && (
                              <span className="shrink-0 text-[10px] text-[#9CA3AF] border border-[#E5E7EB] rounded-full px-1.5 py-0.5 whitespace-nowrap">
                                {t('recipe.optional')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Steps */}
          {recipe.recipe_steps.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-[#1A1A1A] mb-3">{t('recipe.steps')}</h2>
              <ol className="space-y-4">
                {recipe.recipe_steps.map((step, i) => (
                  <li key={step.id} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-[#dcfce7] text-[#15803d] text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-sm text-[#374151] leading-relaxed">{step.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* I Cooked This — end of recipe, after steps */}
          <div className="pt-2 pb-2">
            <button
              onClick={() => logCookMutation.mutate()}
              disabled={logCookMutation.isPending || cookDebounced}
              className="w-full rounded-2xl bg-[#f0fdf4] dark:bg-[#16a34a]/10 border border-[#bbf7d0] dark:border-[#16a34a]/25 py-4 flex items-center justify-center gap-2 text-[#15803d] dark:text-[#4ade80] text-sm font-semibold disabled:opacity-50 hover:bg-[#dcfce7] dark:hover:bg-[#16a34a]/20 transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              <span
                className={`inline-block ${cookIconBouncing ? 'cooked-success' : ''}`}
                onAnimationEnd={() => setCookIconBouncing(false)}
                aria-hidden="true"
              >
                <CheckCircle2 size={17} aria-hidden="true" />
              </span>
              {myCookCount > 0 || lastCookLogId ? t('recipe.logCookedAgain') : t('recipe.logCooked')}
            </button>
            {lastCookLogId && (
              <button
                onClick={() => undoCookMutation.mutate()}
                disabled={undoCookMutation.isPending}
                className="w-full text-center text-xs text-[#9CA3AF] hover:text-[#6B7280] py-2 disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
              >
                {t('recipe.undoCook')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sticky bottom bar — sits above the nav bar */}
      <div
        className="fixed left-0 right-0 px-4 py-3 bg-[#FAFAF8] border-t border-[#F0F0EE]"
        style={{ bottom: 'calc(3.25rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto max-w-md space-y-2">
          {isFromPlan ? (
            <div className="flex gap-2">
              {confirmRemove ? (
                <>
                  <button
                    onClick={() => setConfirmRemove(false)}
                    className="flex-1 rounded-2xl border border-[#E5E7EB] bg-white text-[#6B7280] py-3.5 text-sm font-semibold hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => removeMutation.mutate()}
                    disabled={removeMutation.isPending}
                    className="flex-1 rounded-2xl border border-[#fecaca] bg-[#fee2e2] text-[#DC2626] py-3.5 text-sm font-semibold disabled:opacity-60 hover:bg-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                  >
                    {t('common.confirm')}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmRemove(true)}
                  className="w-full rounded-2xl border border-[#fecaca] bg-[#fee2e2] text-[#DC2626] py-3.5 text-sm font-semibold hover:bg-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                >
                  {t('recipe.removeFromPlan')}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending}
              className="w-full rounded-2xl bg-[#16A34A] text-white py-3.5 text-sm font-semibold disabled:opacity-60 hover:bg-[#15803d] active:scale-[0.97] transition-[transform,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              {addMutation.isPending ? t('recipe.adding') : t('recipe.addToPlan')}
            </button>
          )}

          {hasSteps && (
            <button
              onClick={() => setIsCooking(true)}
              className="w-full rounded-2xl border border-[#E5E7EB] bg-white py-3 text-sm font-semibold text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none flex items-center justify-center gap-2"
            >
              <UtensilsCrossed size={15} aria-hidden="true" />
              {t('recipe.cook')}
            </button>
          )}

        </div>
      </div>
    </div>
  )
}
