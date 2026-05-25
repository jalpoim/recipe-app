import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { capture } from '../../../lib/analytics'
import { ArrowLeft, Bookmark, BookmarkCheck, Clock, Edit, Heart, Minus, Plus, ChevronLeft, ChevronRight, X, UtensilsCrossed, CheckCircle2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchRecipeById } from '../../../lib/supabase/queries'
import { fetchMyProfile } from '../../../lib/supabase/profile-queries'
import { useToast } from '../../../components/Toast'
import { convertUnit, formatQuantity } from '../../../lib/units'
import {
  addRecipeToPlan,
  removePlanItem,
  fetchPlanItem,
  updatePlanItemMultiplier,
  upsertUserRecipePreference,
} from '../../../lib/supabase/plan-queries'
import {
  logRecipeCooked,
  fetchRecipeCookCounts,
} from '../../../lib/supabase/cook-log-queries'
import {
  upsertInteraction,
  removeInteraction,
  fetchInteractions,
} from '../../../lib/supabase/interaction-queries'
import type { RecipeIngredient, RecipeStep } from '../../../types/db'

// Muted pastel thumbnail gradients per protein
const PROTEIN_COLORS: Record<string, string> = {
  chicken:    'linear-gradient(135deg, #fef3c7, #fde68a)',
  beef:       'linear-gradient(135deg, #fee2e2, #fecaca)',
  pork:       'linear-gradient(135deg, #fce7f3, #fbcfe8)',
  salmon:     'linear-gradient(135deg, #ffe4e6, #fecdd3)',
  tuna:       'linear-gradient(135deg, #dbeafe, #bfdbfe)',
  cod:        'linear-gradient(135deg, #e0f2fe, #bae6fd)',
  eggs:       'linear-gradient(135deg, #fefce8, #fef9c3)',
  shrimp:     'linear-gradient(135deg, #fff7ed, #fed7aa)',
  turkey:     'linear-gradient(135deg, #fef9c3, #fef08a)',
  lamb:       'linear-gradient(135deg, #fdf4ff, #f5d0fe)',
  sardine:    'linear-gradient(135deg, #e0f2fe, #7dd3fc)',
  hake:       'linear-gradient(135deg, #f0fdf4, #bbf7d0)',
  'sea-bream': 'linear-gradient(135deg, #eff6ff, #bfdbfe)',
  'sea-bass': 'linear-gradient(135deg, #f0fdfa, #99f6e4)',
  mackerel:   'linear-gradient(135deg, #fefce8, #fde047)',
  octopus:    'linear-gradient(135deg, #fdf4ff, #e9d5ff)',
  tofu:       'linear-gradient(135deg, #FEE9E1, #bbf7d0)',
  legumes:    'linear-gradient(135deg, #d1fae5, #a7f3d0)',
  whey:       'linear-gradient(135deg, #ede9fe, #ddd6fe)',
}

// ---------- helpers ----------

function fmt(n: number, decimals = 1) {
  if (n % 1 === 0) return n.toFixed(0)
  return n.toFixed(decimals)
}

function scaledMacro(raw: number | null, servings: number, macrosTotal: boolean, multiplier: number) {
  if (raw == null) return 0
  const perServing = macrosTotal ? raw / (servings || 1) : raw
  return perServing * multiplier
}

function scaleIngredient(
  ing: RecipeIngredient,
  multiplier: number,
  baseServings: number,
  measurementSystem: 'metric' | 'imperial' = 'metric',
): string {
  const rawDisplay = ing.raw_text.replace(/^\(opcional\)\s*/i, '')
  if (ing.quantity == null) return rawDisplay
  const factor = multiplier / (baseServings || 1)
  const scaled = ing.quantity * factor
  const { value: converted, unit: displayUnit } = convertUnit(scaled, ing.unit ?? '', measurementSystem)
  const qty = formatQuantity(converted)
  const parts = [qty, displayUnit, ing.name].filter(Boolean)
  return parts.length > 1 ? parts.join(' ') : rawDisplay
}

function badgeClass(ratio: number) {
  if (ratio >= 1.0) return 'text-[#166534] bg-[#d1fae5]'
  if (ratio >= 0.7) return 'text-[#B45309] bg-[#fef3c7]'
  return 'text-[#DC2626] bg-[#fee2e2]'
}

// ---------- CookingDrawer ----------

function CookingDrawer({
  steps,
  onExit,
  onStepChange,
}: {
  steps: RecipeStep[]
  onExit: () => void
  onStepChange: (completedUpTo: number) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')

  const currStep = steps[stepIndex]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === steps.length - 1

  function goNext() {
    if (isLast) return
    const next = stepIndex + 1
    setDirection('forward')
    setStepIndex(next)
    onStepChange(next)
  }

  function goPrev() {
    if (isFirst) return
    const next = stepIndex - 1
    setDirection('back')
    setStepIndex(next)
    onStepChange(next)
  }

  return (
    <div
      className="cooking-drawer-enter fixed left-0 right-0 z-30 bg-white border-t border-[#E5E7EB] shadow-2xl flex flex-col motion-reduce:transition-none motion-reduce:animate-none"
      style={{
        bottom: 'calc(3.25rem + env(safe-area-inset-bottom))',
        height: expanded ? '75vh' : '256px',
        transition: 'height 300ms cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      {/* Drag handle + stop button */}
      <div className="flex items-center px-4 pt-2 pb-1 shrink-0 gap-2">
        <button
          className="flex-1 flex justify-center py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 rounded"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? t('cooking.collapseDrawer') : t('cooking.expandDrawer')}
          aria-expanded={expanded}
        >
          <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
        </button>
        <button
          onClick={onExit}
          aria-label={t('cooking.stopCooking')}
          className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col flex-1 min-h-0 pb-3 overflow-hidden">
        {/* Step counter + progress */}
        <div className="px-4 shrink-0">
          <p className="text-xs font-semibold text-[#9CA3AF] tracking-widest uppercase mb-1">
            {t('cooking.stepOf', { current: stepIndex + 1, total: steps.length })}
          </p>
          <div className="h-0.5 bg-[#F3F4F6] rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-[#F4623A] rounded-full transition-[width] duration-200 ease-out"
              style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Step text */}
        <div className="flex-1 px-4 overflow-y-auto overscroll-contain">
          <p
            key={`${stepIndex}-${direction}`}
            className={`text-sm text-[#1A1A1A] leading-relaxed ${
              direction === 'forward' ? 'step-enter-forward' : 'step-enter-back'
            }`}
          >
            {currStep.text}
          </p>
        </div>

        {/* Navigation */}
        <div className="px-4 pt-2 shrink-0 flex gap-2">
          <button
            onClick={goPrev}
            disabled={isFirst}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl border border-[#E5E7EB] bg-white text-sm font-semibold text-[#1A1A1A] disabled:opacity-30 hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            {t('cooking.prev')}
          </button>
          {isLast ? (
            <button
              onClick={onExit}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-[#F4623A] text-white text-sm font-semibold hover:bg-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t('cooking.done')}
            </button>
          ) : (
            <button
              onClick={goNext}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-[#F4623A] text-white text-sm font-semibold hover:bg-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t('cooking.next')}
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- Skeleton / Error ----------

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
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">{t('recipe.loadError')}</p>
        <p className="text-sm text-[#6B7280]">{error.message}</p>
        <button onClick={() => window.location.reload()} className="mt-2 text-sm text-[#F4623A] underline">
          {t('common.retry')}
        </button>
      </div>
    </div>
  )
}

// ---------- Route ----------

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
    const planItem = deps.planItemId ? await fetchPlanItem({ data: deps.planItemId }) : null
    return { recipe, planItem }
  },
  component: RecipeDetailPage,
})

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

  const [multiplier, setMultiplier] = useState(planItem?.portion_multiplier ?? 1)
  const [isCooking, setIsCooking] = useState(false)
  const [completedUpToStep, setCompletedUpToStep] = useState(-1)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [lastCookLogId, setLastCookLogId] = useState<string | null>(null)
  const [cookDebounced, setCookDebounced] = useState(false)
  const [cookIconBouncing, setCookIconBouncing] = useState(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const skipFirstSave = useRef(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // Wake lock during cooking
  useEffect(() => {
    if (isCooking) {
      navigator.wakeLock?.request('screen').then((lock) => { wakeLockRef.current = lock }).catch(() => {})
    } else {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [isCooking])

  function enterCooking() {
    const toggle = () => {
      setIsCooking(true)
      setCompletedUpToStep(-1)
    }
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as unknown as { startViewTransition: (cb: () => void) => void }).startViewTransition(toggle)
    } else {
      toggle()
    }
  }

  function exitCooking() {
    setIsCooking(false)
    setCompletedUpToStep(-1)
  }

  function handleCookingDone() {
    exitCooking()
    logCookMutation.mutate()
  }

  // Interactions
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
    onMutate: () => setLikeCount((c) => (isLiked ? c - 1 : c + 1)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interactions'] }),
    onError: () => { setLikeCount((c) => (isLiked ? c + 1 : c - 1)); showToast(t('common.error'), 'error') },
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      isSaved
        ? removeInteraction({ data: { recipeId: recipe.id, type: 'save' } })
        : upsertInteraction({ data: { recipeId: recipe.id, type: 'save' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interactions'] }),
    onError: () => showToast(t('common.error'), 'error'),
  })

  // User profile (for unit conversion)
  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => fetchMyProfile(),
    staleTime: 5 * 60 * 1000,
  })
  const measurementSystem = (profile?.measurement_unit ?? 'metric') as 'metric' | 'imperial'

  // Cook counts
  const { data: cookCounts } = useQuery({
    queryKey: ['cook-counts', recipe.id],
    queryFn: () => fetchRecipeCookCounts({ data: [recipe.id] }),
    staleTime: 0,
  })
  const myCookCount = cookCounts?.find((c) => c.recipe_id === recipe.id)?.count ?? 0

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

  const saveMultMutation = useMutation({
    mutationFn: (mult: number) =>
      Promise.all([
        updatePlanItemMultiplier({ data: { planItemId: search.planItemId!, multiplier: mult } }),
        upsertUserRecipePreference({ data: { recipeId: recipe.id, servings: mult } }),
      ]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plan-items'] }),
  })

  const savePrefMutation = useMutation({
    mutationFn: (mult: number) =>
      upsertUserRecipePreference({ data: { recipeId: recipe.id, servings: mult } }),
  })

  useEffect(() => {
    if (skipFirstSave.current) { skipFirstSave.current = false; return }
    const timer = setTimeout(() => {
      if (isFromPlan) {
        saveMultMutation.mutate(multiplier)
      } else {
        savePrefMutation.mutate(multiplier)
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [multiplier]) // eslint-disable-line react-hooks/exhaustive-deps

  const cal = scaledMacro(recipe.calories, recipe.servings, recipe.macros_total, multiplier)
  const pro = scaledMacro(recipe.protein, recipe.servings, recipe.macros_total, multiplier)
  const carb = scaledMacro(recipe.carbs, recipe.servings, recipe.macros_total, multiplier)
  const fat = scaledMacro(recipe.fat, recipe.servings, recipe.macros_total, multiplier)

  const perServingCal = recipe.macros_total ? (recipe.calories ?? 0) / (recipe.servings || 1) : (recipe.calories ?? 0)
  const perServingPro = recipe.macros_total ? (recipe.protein ?? 0) / (recipe.servings || 1) : (recipe.protein ?? 0)
  const ratio = perServingCal ? (perServingPro * 10) / perServingCal : 0

  const addMutation = useMutation({
    mutationFn: () => addRecipeToPlan({ data: recipe.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-plan'] })
      qc.invalidateQueries({ queryKey: ['plan-items'] })
      showToast(t('recipe.addedToPlan'), 'success')
      capture('recipe_added_to_plan', { recipeId: recipe.id })
    },
    onError: () => showToast(t('recipe.addedToPlanError'), 'error'),
  })

  const removeMutation = useMutation({
    mutationFn: () => removePlanItem({ data: search.planItemId! }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-plan'] })
      qc.invalidateQueries({ queryKey: ['plan-items'] })
      navigate({ to: '/app/plan' })
    },
  })

  const hasSteps = recipe.recipe_steps.length > 0

  // Group ingredients by section_label
  const ingredientSections: { label: string | null; items: typeof recipe.recipe_ingredients }[] = []
  const sectionMap = new Map<string, (typeof ingredientSections)[0]>()
  for (const ing of recipe.recipe_ingredients) {
    const key = ing.section_label ?? '__main__'
    if (!sectionMap.has(key)) {
      const s = { label: ing.section_label, items: [] as typeof recipe.recipe_ingredients }
      sectionMap.set(key, s)
      ingredientSections.push(s)
    }
    sectionMap.get(key)!.items.push(ing)
  }

  return (
    <div
      className="min-h-screen bg-[#FAFAF8]"
      style={{ paddingBottom: isCooking ? 'calc(256px + 3.25rem + env(safe-area-inset-bottom) + 1.5rem)' : 'calc(12rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto w-full max-w-md">

        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-[#FAFAF8]/95 backdrop-blur-sm px-4 py-3 flex items-center gap-3 border-b border-[#F0F0EE]">
          <button
            onClick={() => navigate({ to: isFromPlan ? '/app/plan' : '/app/library' })}
            aria-label={t('recipe.back')}
            className="flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none rounded"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t('recipe.back')}
          </button>
          {isCooking && (
            <p className="flex-1 text-sm font-semibold text-[#1A1A1A] truncate recipe-title-vt">
              {recipe.name}
            </p>
          )}
          {!isCooking && <div className="flex-1" />}
          {/* Like — hidden during cooking */}
          {!isCooking && (
            <button
              onClick={() => likeMutation.mutate()}
              disabled={likeMutation.isPending}
              aria-label={isLiked ? t('recipe.unlike') : t('recipe.like')}
              aria-pressed={isLiked}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none disabled:opacity-60 ${isLiked ? 'bg-[#fee2e2] border-[#fecaca] text-[#DC2626]' : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#fecaca] hover:text-[#DC2626]'}`}
            >
              <Heart size={13} className={isLiked ? 'fill-current' : ''} aria-hidden="true" />
              {likeCount > 0 ? likeCount : t('recipe.like')}
            </button>
          )}
          {!isCooking && (
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              aria-label={isSaved ? t('recipe.unsave') : t('recipe.save')}
              aria-pressed={isSaved}
              className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none disabled:opacity-60 ${isSaved ? 'bg-[#FEE9E1] border-[#F4623A] text-[#D94F2B]' : 'bg-white border-[#E5E7EB] text-[#9CA3AF] hover:border-[#F4623A] hover:text-[#F4623A]'}`}
            >
              {isSaved ? <BookmarkCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
            </button>
          )}
          {!isCooking && isOwner && (
            <Link
              to="/app/library/$recipeId/edit"
              params={{ recipeId: recipe.id }}
              aria-label={t('recipe.edit')}
              className="w-8 h-8 rounded-full border border-[#E5E7EB] bg-white flex items-center justify-center text-[#9CA3AF] hover:text-[#1A1A1A] hover:border-[#D1D5DB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              <Edit size={14} aria-hidden="true" />
            </Link>
          )}
        </div>

        {/* Hero image */}
        {!isCooking && (
          <div className="w-full aspect-[16/9] overflow-hidden">
            {recipe.image_thumb_url ? (
              <img
                src={recipe.image_thumb_url}
                alt={recipe.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-full h-full"
                style={{ background: PROTEIN_COLORS[recipe.proteins[0]] ?? 'linear-gradient(135deg, #FEE9E1, #bbf7d0)' }}
                aria-hidden="true"
              />
            )}
          </div>
        )}

        <div className="px-4 pt-5 space-y-5">

          {/* Title (hidden in compact sticky header during cooking) */}
          {!isCooking && (
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-2xl font-bold text-[#1A1A1A] leading-snug flex-1 recipe-title-vt">
                {recipe.name}
              </h1>
              {recipe.calories != null && recipe.protein != null && (
                <span className={`shrink-0 text-sm font-bold px-2.5 py-1 rounded-full ${badgeClass(ratio)}`}>
                  {fmt(ratio)}
                </span>
              )}
            </div>
          )}

          {/* Time — hidden during cooking to save space */}
          {!isCooking && recipe.time_min != null && (
            <div className="flex items-center gap-4 text-sm text-[#6B7280]">
              <span className="flex items-center gap-1.5">
                <Clock size={14} aria-hidden="true" />
                {recipe.time_min} {t('common.min')}
              </span>
            </div>
          )}

          {/* Ingredients — always visible */}
          {recipe.recipe_ingredients.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-[#1A1A1A] mb-3">{t('recipe.ingredients')}</h2>
              <div className="space-y-3">
                {ingredientSections.map(({ label, items }) => (
                  <div key={label ?? '__main__'} className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden">
                    {label && (
                      <div className="px-4 py-2 border-b border-[#F3F4F6] flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
                        <span className="text-[10px] text-[#9CA3AF] border border-[#E5E7EB] rounded-full px-1.5 py-0.5">{t('recipe.optional')}</span>
                      </div>
                    )}
                    <div className="divide-y divide-[#F3F4F6]">
                      {items.map((ing) => (
                        <div
                          key={ing.id}
                          className={`px-4 py-3 flex items-baseline justify-between gap-2 ${ing.is_optional && !label ? 'opacity-60' : ''}`}
                        >
                          <span className={`text-sm ${ing.is_optional && !label ? 'text-[#6B7280]' : 'text-[#1A1A1A]'}`}>
                            {scaleIngredient(ing, multiplier, recipe.servings, measurementSystem)}
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
          )}

          {/* Collapsing metadata — fades out when cooking starts */}
          <div
            style={{
              display: 'grid',
              gridTemplateRows: isCooking ? '0fr' : '1fr',
              transition: 'grid-template-rows 350ms ease-out, opacity 300ms ease-out',
              opacity: isCooking ? 0 : 1,
            }}
          >
            <div className="overflow-hidden space-y-5">
              {recipe.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recipe.tags.map((tag) => (
                    <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-[#F3F4F6] text-[#6B7280] font-medium">
                      {t(`tags.${tag}`, tag)}
                    </span>
                  ))}
                </div>
              )}

              {recipe.owner_id != null && recipe.author_display_name != null && (
                <p className="text-xs text-[#9CA3AF]">
                  {t('recipe.by')} <span className="font-medium text-[#6B7280]">{recipe.author_display_name}</span>
                </p>
              )}

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

              {myCookCount > 0 && (
                <p className="text-sm text-[#9CA3AF]">
                  {t('recipe.cookedCount', { count: myCookCount })}
                </p>
              )}
            </div>
          </div>

          {/* Portion stepper — hidden during cooking (multiplier shown in servings line above) */}
          {!isCooking && (
            <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[#1A1A1A]">{t('recipe.servings')}</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setMultiplier((m) => Math.max(1, m - 1))}
                    disabled={multiplier <= 1}
                    aria-label={t('recipe.decreaseServings')}
                    className="w-11 h-11 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#1A1A1A] disabled:opacity-30 hover:bg-[#F3F4F6] active:bg-[#E5E7EB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                  >
                    <Minus size={16} aria-hidden="true" />
                  </button>
                  <span className="w-6 text-center font-bold text-[#1A1A1A]" aria-live="polite">
                    {multiplier}
                  </span>
                  <button
                    onClick={() => setMultiplier((m) => m + 1)}
                    aria-label={t('recipe.increaseServings')}
                    className="w-11 h-11 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#1A1A1A] hover:bg-[#F3F4F6] active:bg-[#E5E7EB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Macros — collapsed during cooking */}
          {!isCooking && (
            <div className="grid grid-cols-4 gap-2">
              {([
                { key: 'recipe.calories' as const, value: cal, unit: 'kcal' },
                { key: 'recipe.protein' as const, value: pro, unit: 'g' },
                { key: 'recipe.carbs' as const, value: carb, unit: 'g' },
                { key: 'recipe.fat' as const, value: fat, unit: 'g' },
              ]).map(({ key, value, unit }) => (
                <div key={key} className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-3 text-center">
                  <div className="text-[9px] text-[#9CA3AF] uppercase tracking-wide leading-tight font-medium">{t(key)}</div>
                  <div className="text-lg font-bold text-[#1A1A1A] mt-0.5">{fmt(value, 0)}</div>
                  <div className="text-[9px] text-[#9CA3AF] font-medium">{unit}</div>
                </div>
              ))}
            </div>
          )}

          {/* Steps — always visible */}
          {recipe.recipe_steps.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-[#1A1A1A] mb-3">{t('recipe.steps')}</h2>
              <ol className="space-y-4">
                {recipe.recipe_steps.map((step, i) => (
                  <li key={step.id} className="flex gap-3">
                    <span className={`shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center mt-0.5 transition-colors duration-200 ${
                      isCooking && i < completedUpToStep ? 'bg-[#F4623A] text-white' : 'bg-[#FEE9E1] text-[#D94F2B]'
                    }`}>
                      {i + 1}
                    </span>
                    <p className={`text-sm leading-relaxed transition-opacity duration-200 ${isCooking && i < completedUpToStep ? 'text-[#9CA3AF]' : 'text-[#374151]'}`}>
                      {step.text}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* I Cooked This */}
          {!isCooking && (
            <div className="pt-2 pb-2">
              <button
                onClick={() => logCookMutation.mutate()}
                disabled={logCookMutation.isPending || cookDebounced}
                className="w-full rounded-2xl bg-[#FFF5F2] border border-[#FDD9CC] py-4 flex items-center justify-center gap-2 text-[#D94F2B] text-sm font-semibold disabled:opacity-50 hover:bg-[#FEE9E1] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
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
            </div>
          )}
        </div>
      </div>

      {/* Cooking drawer */}
      {isCooking && (
        <CookingDrawer
          steps={recipe.recipe_steps}
          onExit={handleCookingDone}
          onStepChange={setCompletedUpToStep}
        />
      )}

      {/* Sticky bottom bar — hidden during cooking (drawer has its own controls) */}
      {!isCooking && (
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
                      className="flex-1 rounded-2xl border border-[#E5E7EB] bg-white text-[#6B7280] py-3.5 text-sm font-semibold hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
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
                className="w-full rounded-2xl bg-[#F4623A] text-white py-3.5 text-sm font-semibold disabled:opacity-60 hover:bg-[#D94F2B] active:scale-[0.97] transition-[transform,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
              >
                {addMutation.isPending ? t('recipe.adding') : t('recipe.addToPlan')}
              </button>
            )}

            {hasSteps && (
              <button
                onClick={enterCooking}
                className="w-full rounded-2xl border border-[#E5E7EB] bg-white py-3 text-sm font-semibold text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none flex items-center justify-center gap-2"
              >
                <UtensilsCrossed size={15} aria-hidden="true" />
                {t('recipe.cook')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
