import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useMemo, useRef, useEffect, useCallback, useDeferredValue } from 'react'
import { capture } from '../../../lib/analytics'
import { Bookmark, BookmarkCheck, Clock, Heart, Plus, Search, Settings, SlidersHorizontal, X } from 'lucide-react'
import { Drawer } from 'vaul'
import { useTranslation } from 'react-i18next'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  fetchLibrary,
  fetchLibraryMeta,
  type RecipeWithIngredients,
  type Sort,
  type LibraryMode,
  type LibraryCursor,
} from '../../../lib/supabase/queries'
import { fetchRecipeCookCounts } from '../../../lib/supabase/cook-log-queries'
import {
  fetchInteractions,
  upsertInteraction,
  removeInteraction,
} from '../../../lib/supabase/interaction-queries'
import { useToast } from '../../../components/Toast'
import type { Recipe } from '../../../types/db'

// Muted pastel thumbnail colors per protein slug
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
  tofu:       'linear-gradient(135deg, #dcfce7, #bbf7d0)',
  legumes:    'linear-gradient(135deg, #d1fae5, #a7f3d0)',
  whey:       'linear-gradient(135deg, #ede9fe, #ddd6fe)',
}

const PAGE_SIZE = 24

const PROTEIN_TIER1 = ['chicken', 'beef', 'pork', 'salmon', 'tuna', 'cod', 'eggs', 'shrimp']
const PROTEIN_TIER2 = ['turkey', 'lamb', 'sardine', 'hake', 'sea-bream', 'sea-bass', 'mackerel', 'octopus', 'tofu', 'legumes', 'whey']

// ---------- hooks ----------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

// ---------- search param schema ----------

type SheetSection = 'protein' | 'time' | 'calories' | 'tags' | 'ingredients'

const TAG_SECTIONS: { key: string; tags: string[] }[] = [
  { key: 'method',  tags: ['air-fryer', 'forno', 'fogão', 'micro-ondas', 'sem-cozinha', 'uma-frigideira', 'bimby', 'grelhador'] },
  { key: 'cuisine', tags: ['português', 'mediterrâneo', 'italiano', 'francês', 'europeu', 'americano', 'mexicano', 'indiano', 'asiático', 'japonês', 'coreano', 'árabe', 'africano', 'latino-americano'] },
  { key: 'diet',    tags: ['sem-glúten', 'vegetariano', 'vegano', 'sem-lactose', 'alto-proteína', 'low-carb', 'fit'] },
  { key: 'type',    tags: ['pequeno-almoço', 'almoço', 'jantar', 'snack', 'sobremesa', 'sopa', 'pós-treino', 'batido'] },
  { key: 'context', tags: ['meal-prep', 'rápido', 'reconfortante', 'leve', 'económico', 'família', 'festivo', '5-ingredientes', 'semana', 'verão'] },
]
const TAG_SECTION_LIMIT = 6

type LibrarySearch = {
  q: string
  proteins: string[]
  maxCal: number | undefined
  maxTime: number | undefined
  tags: string[]
  ingredients: string[]
  sort: Sort
  mode: LibraryMode
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 animate-pulse">
      <div className="flex justify-between gap-2 mb-3">
        <div className="h-4 bg-[#F3F4F6] rounded-full flex-1" />
        <div className="h-4 w-14 bg-[#F3F4F6] rounded-full shrink-0" />
      </div>
      <div className="h-3 w-24 bg-[#F3F4F6] rounded-full mb-3" />
      <div className="grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-[#F3F4F6] rounded-xl" />
        ))}
      </div>
    </div>
  )
}

function LibrarySkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4 py-5 space-y-3">
        <div className="h-6 w-24 bg-[#F3F4F6] rounded-full animate-pulse mb-4" />
        <div className="h-10 bg-[#F3F4F6] rounded-xl animate-pulse" />
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-7 w-20 bg-[#F3F4F6] rounded-full animate-pulse" />)}
        </div>
        {[0, 1, 2, 3, 4].map((i) => <CardSkeleton key={i} />)}
      </div>
    </div>
  )
}

function LibraryError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">Não foi possível carregar as receitas</p>
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

export const Route = createFileRoute('/app/library/')({
  pendingComponent: LibrarySkeleton,
  errorComponent: ({ error }) => <LibraryError error={error as Error} />,
  validateSearch: (search): LibrarySearch => ({
    q: typeof search.q === 'string' ? search.q : '',
    proteins: Array.isArray(search.proteins) ? (search.proteins as string[]) : [],
    maxCal: typeof search.maxCal === 'number' ? search.maxCal : undefined,
    maxTime: typeof search.maxTime === 'number' ? search.maxTime : undefined,
    tags: Array.isArray(search.tags) ? (search.tags as string[]) : [],
    ingredients: Array.isArray(search.ingredients) ? (search.ingredients as string[]) : [],
    sort: (['pcal', 'protein', 'calories', 'time', 'popular', 'cooked'] as Sort[]).includes(search.sort as Sort)
      ? (search.sort as Sort)
      : 'pcal',
    mode: (['all', 'mine', 'saved', 'curated'] as LibraryMode[]).includes(search.mode as LibraryMode)
      ? (search.mode as LibraryMode)
      : 'all',
  }),
  component: LibraryPage,
})

// ---------- helpers ----------

function perServing(r: Recipe, field: 'calories' | 'protein' | 'carbs' | 'fat') {
  const raw = r[field] ?? 0
  return r.macros_total ? raw / (r.servings || 1) : raw
}

function pcalRatio(r: Recipe) {
  const cal = perServing(r, 'calories')
  const pro = perServing(r, 'protein')
  if (!cal) return 0
  return (pro * 10) / cal
}

function badgeClass(ratio: number) {
  if (ratio >= 1.0) return 'text-[#15803d] bg-[#dcfce7]'
  if (ratio >= 0.7) return 'text-[#B45309] bg-[#fef3c7]'
  return 'text-[#DC2626] bg-[#fee2e2]'
}

function fmt(n: number) {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)
}

// ---------- RecipeCard ----------

function RecipeCard({
  recipe,
  cookCount = 0,
  isSaved = false,
  showOwnerBadge = false,
  onToggleSave,
}: {
  recipe: RecipeWithIngredients
  cookCount?: number
  isSaved?: boolean
  showOwnerBadge?: boolean
  onToggleSave?: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation()
  const cal = perServing(recipe, 'calories')
  const pro = perServing(recipe, 'protein')
  const carb = perServing(recipe, 'carbs')
  const fat = perServing(recipe, 'fat')
  const ratio = pcalRatio(recipe)
  const hasMacros = recipe.calories != null
  const isUserRecipe = recipe.owner_id != null
  const showLikes = isUserRecipe && (recipe.like_count ?? 0) > 0
  const thumbnailBg = recipe.image_thumb_url
    ? undefined
    : (PROTEIN_COLORS[recipe.proteins[0]] ?? 'linear-gradient(135deg, #dcfce7, #bbf7d0)')

  return (
    <div className="relative rounded-2xl bg-white border border-[#F0F0EE] shadow-sm active:scale-[0.98] hover:shadow-md transition-all">
      <Link
        to="/app/library/$recipeId"
        params={{ recipeId: recipe.id }}
        search={{ from: undefined, planItemId: undefined }}
        onClick={() => capture('recipe_viewed', { recipeId: recipe.id, source: 'library' })}
        className="block p-4"
      >
        <div className="flex items-start gap-3">
          {/* Thumbnail */}
          <div className="w-[72px] h-[72px] shrink-0">
            {recipe.image_thumb_url ? (
              <img
                src={recipe.image_thumb_url}
                alt=""
                className="w-full h-full rounded-xl object-cover"
                loading="lazy"
              />
            ) : (
              <div
                className="w-full h-full rounded-xl"
                style={{ background: thumbnailBg }}
                aria-hidden="true"
              />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[#1A1A1A] font-semibold text-base leading-snug flex-1 line-clamp-2">{recipe.name}</h2>
              {hasMacros && (
                <span
                  className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${badgeClass(ratio)}`}
                  title="Rácio proteína/calorias (×10). Verde ≥ 1.0 · Amarelo ≥ 0.7 · Vermelho < 0.7"
                >
                  P/Cal {fmt(ratio)}
                </span>
              )}
            </div>

            <div className="mt-1 flex items-center gap-2 text-xs text-[#6B7280] flex-wrap">
              {recipe.proteins.length > 0 && (
                <span className="font-medium text-[#1A1A1A]">
                  {t(`proteins.${recipe.proteins[0]}`)}
                </span>
              )}
              {recipe.time_min != null && (
                <span className="flex items-center gap-1">
                  <Clock size={11} aria-hidden="true" />
                  {recipe.time_min} min
                </span>
              )}
              {showLikes && (
                <span className="flex items-center gap-1 text-[#9CA3AF]">
                  <Heart size={10} aria-hidden="true" />
                  {recipe.like_count}
                </span>
              )}
              {showOwnerBadge && isUserRecipe && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#dcfce7] text-[#15803d] font-medium">
                  {t('library.ownBadge')}
                </span>
              )}
            </div>
          </div>
        </div>

        {hasMacros && (
          <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
            {(
              [
                { label: 'Cal', value: cal },
                { label: 'P', value: pro },
                { label: 'C', value: carb },
                { label: 'G', value: fat },
              ] as const
            ).map(({ label, value }) => (
              <div key={label} className="bg-[#F9FAFB] rounded-xl py-2">
                <div className="text-[9px] text-[#9CA3AF] uppercase tracking-wide font-medium">{label}</div>
                <div className="text-sm font-bold text-[#1A1A1A] mt-0.5">{Math.round(value)}</div>
              </div>
            ))}
          </div>
        )}

        {!hasMacros && recipe.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {recipe.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7280] font-medium"
              >
                {t(`tags.${tag}`, { defaultValue: tag })}
              </span>
            ))}
          </div>
        )}

        {(cookCount > 0 || onToggleSave) && (
          <div className="mt-2 flex items-center gap-2">
            {cookCount > 0 && (
              <p className="text-[10px] text-[#9CA3AF] flex-1">{t('recipe.cookedCount', { count: cookCount })}</p>
            )}
            {onToggleSave && (
              <button
                onClick={onToggleSave}
                aria-label={isSaved ? t('recipe.unsave') : t('recipe.save')}
                aria-pressed={isSaved}
                className={`ml-auto w-6 h-6 rounded-full flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                  isSaved
                    ? 'text-[#16A34A]'
                    : 'text-[#D1D5DB] hover:text-[#16A34A]'
                }`}
              >
                {isSaved ? <BookmarkCheck size={14} aria-hidden="true" /> : <Bookmark size={14} aria-hidden="true" />}
              </button>
            )}
          </div>
        )}
      </Link>
    </div>
  )
}



// ---------- FilterSheet ----------

interface FilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: SheetSection
  search: LibrarySearch
  allTags: string[]
  allIngredientNames: string[]
  onUpdate: (patch: Partial<LibrarySearch>) => void
  onClear: () => void
}

function FilterSheet({
  open,
  onOpenChange,
  section,
  search,
  allTags,
  allIngredientNames,
  onUpdate,
  onClear,
}: FilterSheetProps) {
  const { t } = useTranslation()
  const [ingSearch, setIngSearch] = useState('')
  const debouncedIngSearch = useDebounce(ingSearch, 150)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [proteinsExpanded, setProteinsExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const proteinRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLDivElement>(null)
  const caloriesRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const ingredientsRef = useRef<HTMLDivElement>(null)

  const sectionRefMap: Record<SheetSection, React.RefObject<HTMLDivElement | null>> = {
    protein: proteinRef,
    time: timeRef,
    calories: caloriesRef,
    tags: tagsRef,
    ingredients: ingredientsRef,
  }

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      const el = sectionRefMap[section]?.current
      if (el && scrollRef.current) {
        const containerTop = scrollRef.current.getBoundingClientRect().top
        const elTop = el.getBoundingClientRect().top
        const offset = scrollRef.current.scrollTop + (elTop - containerTop) - 16
        scrollRef.current.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [open, section]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredIngs = useMemo(
    () =>
      debouncedIngSearch.length > 0
        ? allIngredientNames.filter(
            (n) =>
              n.toLowerCase().includes(debouncedIngSearch.toLowerCase()) &&
              !search.ingredients.includes(n),
          )
        : [],
    [allIngredientNames, debouncedIngSearch, search.ingredients],
  )

  function toggleProtein(slug: string) {
    const next = search.proteins.includes(slug)
      ? search.proteins.filter((p) => p !== slug)
      : [...search.proteins, slug]
    capture('filter_applied', { filterType: 'protein', value: slug, active: !search.proteins.includes(slug) })
    onUpdate({ proteins: next })
  }

  function toggleTag(tag: string) {
    const next = search.tags.includes(tag)
      ? search.tags.filter((t) => t !== tag)
      : [...search.tags, tag]
    capture('filter_applied', { filterType: 'tag', value: tag, active: !search.tags.includes(tag) })
    onUpdate({ tags: next })
  }

  function addIngredient(ing: string) {
    if (!search.ingredients.includes(ing)) {
      onUpdate({ ingredients: [...search.ingredients, ing] })
    }
    setIngSearch('')
  }

  function removeIngredient(ing: string) {
    onUpdate({ ingredients: search.ingredients.filter((i) => i !== ing) })
  }

  const hasActive =
    search.proteins.length > 0 ||
    search.maxCal !== undefined ||
    search.maxTime !== undefined ||
    search.tags.length > 0 ||
    search.ingredients.length > 0

  const sectionHeader = 'text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3'

  function chipCls(active: boolean) {
    return `text-xs px-3 py-1.5 rounded-full border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
      active
        ? 'bg-[#dcfce7] border-[#16A34A] text-[#15803d]'
        : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#16A34A] hover:text-[#15803d]'
    }`
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-white rounded-t-2xl outline-none max-h-[90dvh]"
          aria-label="Filtros"
        >
          {/* drag handle */}
          <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
          </div>

          {/* sheet header */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 pt-1 pb-3">
            <span className="text-base font-semibold text-[#1A1A1A]">{t('filters.sheetTitle')}</span>
            <button
              onClick={() => onOpenChange(false)}
              aria-label={t('common.close')}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {/* scrollable content */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-4 space-y-6">
            {/* Proteína */}
            <div ref={proteinRef}>
              <p className={sectionHeader}>{t('filters.protein')}</p>
              <div className="flex flex-wrap gap-2">
                {(proteinsExpanded ? [...PROTEIN_TIER1, ...PROTEIN_TIER2] : PROTEIN_TIER1).map((slug) => (
                  <button
                    key={slug}
                    onClick={() => toggleProtein(slug)}
                    aria-pressed={search.proteins.includes(slug)}
                    className={chipCls(search.proteins.includes(slug))}
                  >
                    {t(`proteins.${slug}`, slug)}
                  </button>
                ))}
              </div>
              <button
                aria-expanded={proteinsExpanded}
                onClick={() => setProteinsExpanded((e) => !e)}
                className="mt-2 text-xs text-[#16A34A] font-medium focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
              >
                {proteinsExpanded ? t('tagSections.verMenos') : t('tagSections.verMais')}
              </button>
            </div>

            {/* Tempo */}
            <div ref={timeRef}>
              <p className={sectionHeader}>{t('filters.time')}</p>
              <div className="flex flex-wrap gap-2">
                {([15, 30, 60] as const).map((mins) => (
                  <button
                    key={mins}
                    onClick={() => {
                      const next = search.maxTime === mins ? undefined : mins
                      capture('filter_applied', { filterType: 'maxTime', value: next ?? null })
                      onUpdate({ maxTime: next })
                    }}
                    aria-pressed={search.maxTime === mins}
                    className={chipCls(search.maxTime === mins)}
                  >
                    {'< '}{mins} min
                  </button>
                ))}
              </div>
            </div>

            {/* Calorias */}
            <div ref={caloriesRef}>
              <p className={sectionHeader}>{t('filters.calories')}</p>
              <div className="flex flex-wrap gap-2">
                {([300, 500, 700] as const).map((cal) => (
                  <button
                    key={cal}
                    onClick={() => {
                      const next = search.maxCal === cal ? undefined : cal
                      capture('filter_applied', { filterType: 'maxCal', value: next ?? null })
                      onUpdate({ maxCal: next })
                    }}
                    aria-pressed={search.maxCal === cal}
                    className={chipCls(search.maxCal === cal)}
                  >
                    {'< '}{cal} cal
                  </button>
                ))}
              </div>
            </div>

            {/* Tags — sectioned */}
            <div ref={tagsRef}>
              <p className={sectionHeader}>{t('filters.tags')}</p>
              <div className="space-y-4">
                {TAG_SECTIONS.map(({ key, tags: sectionTags }) => {
                  const available = sectionTags.filter((tag) => allTags.includes(tag))
                  if (available.length === 0) return null
                  const expanded = expandedSections.has(key)
                  const visible = expanded ? available : available.slice(0, TAG_SECTION_LIMIT)
                  const hasMore = available.length > TAG_SECTION_LIMIT
                  return (
                    <div key={key}>
                      <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                        {t(`tagSections.${key}`)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {visible.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => toggleTag(tag)}
                            aria-pressed={search.tags.includes(tag)}
                            className={chipCls(search.tags.includes(tag))}
                          >
                            {t(`tags.${tag}`, { defaultValue: tag })}
                          </button>
                        ))}
                        {hasMore && (
                          <button
                            onClick={() => setExpandedSections((prev) => {
                              const next = new Set(prev)
                              expanded ? next.delete(key) : next.add(key)
                              return next
                            })}
                            className="text-xs px-3 py-1.5 rounded-full border border-dashed border-[#D1D5DB] text-[#9CA3AF] hover:border-[#16A34A] hover:text-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                          >
                            {expanded ? t('tagSections.verMenos') : t('tagSections.verMais')}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Ingredientes */}
            <div ref={ingredientsRef}>
              <p className={sectionHeader}>{t('filters.ingredients')}</p>

              {search.ingredients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {search.ingredients.map((ing) => (
                    <button
                      key={ing}
                      onClick={() => removeIngredient(ing)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#dcfce7] border border-[#16A34A] text-[#15803d] font-medium"
                    >
                      {ing} <X size={10} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}

              <input
                type="text"
                value={ingSearch}
                onChange={(e) => setIngSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ingSearch.trim()) {
                    addIngredient(ingSearch.trim())
                    setIngSearch('')
                  }
                }}
                placeholder={t('filters.searchIngredient')}
                className="w-full rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors"
              />

              {filteredIngs.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-white border border-[#E5E7EB] divide-y divide-[#F3F4F6]">
                  {filteredIngs.slice(0, 40).map((ing) => (
                    <button
                      key={ing}
                      onClick={() => addIngredient(ing)}
                      className="w-full text-left text-sm px-3 py-2.5 text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                    >
                      {ing}
                    </button>
                  ))}
                </div>
              )}

              {debouncedIngSearch.length > 0 && filteredIngs.length === 0 && (
                <button
                  onClick={() => { addIngredient(ingSearch.trim()); setIngSearch('') }}
                  className="mt-2 w-full text-left text-sm px-3 py-2.5 rounded-xl border border-dashed border-[#D1D5DB] text-[#6B7280] hover:border-[#16A34A] hover:text-[#16A34A] transition-colors"
                >
                  + {t('filters.searchFreeText', { term: ingSearch.trim() })}
                </button>
              )}
            </div>
          </div>

          {/* bottom action */}
          <div className="flex-shrink-0 px-4 py-4 border-t border-[#F0F0EE]">
            {hasActive ? (
              <button
                onClick={() => {
                  onClear()
                  onOpenChange(false)
                }}
                className="w-full text-sm font-medium text-[#DC2626] py-2.5 rounded-xl border border-[#fecaca] bg-[#fee2e2] hover:bg-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
              >
                {t('filters.clearFilters')}
              </button>
            ) : (
              <button
                onClick={() => onOpenChange(false)}
                className="w-full text-sm font-medium text-[#6B7280] py-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
              >
                {t('common.close')}
              </button>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

// ---------- LibraryPage ----------

function LibraryPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.startsWith('en') ? 'en' : 'pt'
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/app/library/' })
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetSection, setSheetSection] = useState<SheetSection>('protein')
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false)
  const modeDropdownRef = useRef<HTMLDivElement>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  function update(patch: Partial<LibrarySearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  }

  function openSheet(section: SheetSection) {
    setSheetSection(section)
    setSheetOpen(true)
  }

  function clearFilters() {
    update({
      q: '',
      proteins: [],
      maxCal: undefined,
      maxTime: undefined,
      tags: [],
      ingredients: [],
      // mode intentionally not cleared — mode is a dataset switch, not a filter
    })
  }

  const [localQ, setLocalQ] = useState(search.q)
  const debouncedQ = useDebounce(localQ, 500)
  const deferredQ = useDeferredValue(search.q)

  useEffect(() => {
    if (debouncedQ !== search.q) {
      update({ q: debouncedQ })
      if (debouncedQ) capture('search_performed', { query: debouncedQ })
    }
  }, [debouncedQ]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLocalQ(search.q)
  }, [search.q])

  useEffect(() => {
    if (!modeDropdownOpen) return
    function handleOutside(e: MouseEvent) {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)) {
        setModeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [modeDropdownOpen])

  // mode is in filterKey — changes trigger a full re-fetch
  // sort is excluded from queryKey for pcal/protein/calories/time — applied client-side
  // popular sort is also handled client-side over the loaded pages
  const filterKey = useMemo(
    () => ({
      proteins: search.proteins,
      maxCal: search.maxCal,
      maxTime: search.maxTime,
      tags: search.tags,
      ingredients: search.ingredients,
      q: deferredQ,
      mode: search.mode,
      lang,
    }),
    [search.proteins, search.maxCal, search.maxTime, search.tags, search.ingredients, deferredQ, search.mode, lang],
  )

  const {
    data: infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: ['library', filterKey],
    queryFn: ({ pageParam }) =>
      fetchLibrary({
        data: {
          limit: PAGE_SIZE,
          cursor: (pageParam as LibraryCursor | null) ?? null,
          sort: search.sort,
          mode: search.mode,
          proteins: search.proteins,
          maxCal: search.maxCal,
          maxTime: search.maxTime,
          tags: search.tags,
          ingredients: search.ingredients,
          q: search.q,
        },
      }),
    initialPageParam: null as LibraryCursor | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5 * 60 * 1000,
  })

  // Apply sort client-side over all fetched pages
  const allRecipes = useMemo(
    () => infiniteData?.pages.flatMap((p) => p.data) ?? [],
    [infiniteData],
  )

  const sortedRecipes = useMemo(() => {
    const copy = [...allRecipes]
    switch (search.sort) {
      case 'protein':
        return copy.sort((a, b) => (b.protein ?? 0) - (a.protein ?? 0))
      case 'calories':
        return copy.sort((a, b) => (a.calories ?? 0) - (b.calories ?? 0))
      case 'time':
        return copy.sort((a, b) => (a.time_min ?? 999) - (b.time_min ?? 999))
      case 'popular':
        return copy.sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
      case 'cooked':
        return copy.sort((a, b) => (b.cook_count ?? 0) - (a.cook_count ?? 0))
      case 'pcal':
      default:
        return copy.sort((a, b) => pcalRatio(b) - pcalRatio(a))
    }
  }, [allRecipes, search.sort])

  // Library meta — proteins, tags, ingredient names — language-aware
  const { data: meta } = useQuery({
    queryKey: ['libraryMeta', lang],
    queryFn: () => fetchLibraryMeta({ data: { lang } }),
    staleTime: Infinity,
  })

  // Pre-warm libraryMeta cache for current language
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ['libraryMeta', lang],
      queryFn: () => fetchLibraryMeta({ data: { lang } }),
    })
  }, [queryClient, lang])

  // Saved interactions
  const { data: interactions = [] } = useQuery({
    queryKey: ['interactions'],
    queryFn: fetchInteractions,
    staleTime: 5 * 60 * 1000,
  })

  const savedIds = useMemo(
    () => new Set(interactions.filter((i) => i.type === 'save').map((i) => i.recipe_id)),
    [interactions],
  )

  const saveMutation = useMutation({
    mutationFn: (vars: { recipeId: string; wasSaved: boolean }) =>
      vars.wasSaved
        ? removeInteraction({ data: { recipeId: vars.recipeId, type: 'save' } })
        : upsertInteraction({ data: { recipeId: vars.recipeId, type: 'save' } }),
    onMutate: (vars) => {
      queryClient.setQueryData(['interactions'], (prev: typeof interactions) => {
        if (!prev) return prev
        if (vars.wasSaved) {
          return prev.filter((i) => !(i.recipe_id === vars.recipeId && i.type === 'save'))
        }
        return [...prev, { id: 'tmp', user_id: '', recipe_id: vars.recipeId, type: 'save' as const, created_at: '' }]
      })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['interactions'] })
      showToast('Erro ao guardar receita', 'error')
    },
    onSuccess: (_, vars) => {
      if (!vars.wasSaved) {
        showToast('Receita guardada ✓', 'success')
        capture('recipe_saved', { recipeId: vars.recipeId })
      }
      queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })

  // Cook counts for visible recipes
  const recipeIds = useMemo(() => sortedRecipes.map((r) => r.id), [sortedRecipes])
  const recipeIdsKey = useMemo(() => recipeIds.join(','), [recipeIds])
  const { data: cookCounts } = useQuery({
    queryKey: ['cookCounts', recipeIdsKey],
    queryFn: () => fetchRecipeCookCounts({ data: recipeIds }),
    staleTime: 5 * 60 * 1000,
    enabled: recipeIds.length > 0,
  })
  const cookCountMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const { recipe_id, count } of cookCounts ?? []) {
      map[recipe_id] = count
    }
    return map
  }, [cookCounts])

  // Virtual list — only render cards in the viewport
  const virtualCount = hasNextPage ? sortedRecipes.length + 1 : sortedRecipes.length
  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 160,
    overscan: 5,
  })

  // Fetch next page when sentinel item comes into view
  const fetchNextPageStable = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    const items = virtualizer.getVirtualItems()
    const lastItem = items[items.length - 1]
    if (!lastItem) return
    if (lastItem.index >= sortedRecipes.length - 1) {
      fetchNextPageStable()
    }
  }, [virtualizer.getVirtualItems(), sortedRecipes.length, fetchNextPageStable]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasActiveFilters = Boolean(
    search.q ||
      search.proteins.length ||
      search.maxCal !== undefined ||
      search.maxTime !== undefined ||
      search.tags.length ||
      search.ingredients.length,
  )

  const activeFilterCount =
    search.proteins.length +
    (search.maxCal !== undefined ? 1 : 0) +
    (search.maxTime !== undefined ? 1 : 0) +
    search.tags.length +
    search.ingredients.length

  if (isError) return <LibraryError error={error as Error} />

  return (
    <div className="h-dvh bg-[#FAFAF8] flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-md px-4 flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="py-5">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold text-[#1A1A1A]">{t('nav.recipes')}</h1>
            <Link
              to="/app/settings"
              aria-label={t('settings.title')}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              <Settings size={18} aria-hidden="true" />
            </Link>
          </div>

          {/* Persistent search bar */}
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={localQ}
              onChange={(e) => setLocalQ(e.target.value)}
              placeholder={t('filters.searchRecipe')}
              aria-label={t('filters.searchRecipe')}
              className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-9 py-2.5 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] shadow-sm transition-colors"
            />
            {localQ && (
              <button
                onClick={() => { setLocalQ(''); update({ q: '' }) }}
                aria-label="Limpar pesquisa"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Mode dropdown + Filtros icon */}
          <div className="flex items-center gap-2 mt-3">
            {/* Mode selector */}
            <div ref={modeDropdownRef} className="relative">
              <button
                onClick={() => setModeDropdownOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={modeDropdownOpen}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-[#E5E7EB] bg-white text-[#1A1A1A] font-medium transition-colors hover:border-[#D1D5DB] focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
              >
                {t(`library.${search.mode}`)}
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="text-[#9CA3AF]">
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
              {modeDropdownOpen && (
                <div
                  role="listbox"
                  className="absolute top-full left-0 mt-1 w-36 rounded-xl border border-[#E5E7EB] bg-white shadow-md z-20 py-1 overflow-hidden"
                >
                  {(['all', 'mine', 'saved', 'curated'] as LibraryMode[]).map((m) => (
                    <button
                      key={m}
                      role="option"
                      aria-selected={search.mode === m}
                      onClick={() => { update({ mode: m }); setModeDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                        search.mode === m
                          ? 'text-[#15803d] font-semibold bg-[#f0fdf4]'
                          : 'text-[#1A1A1A] hover:bg-[#F9FAFB]'
                      }`}
                    >
                      {t(`library.${m}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1" />

            {/* Filtros icon-only button */}
            <button
              onClick={() => openSheet('protein')}
              aria-label={t('filters.sheetTitle')}
              className={`relative flex items-center justify-center w-8 h-8 rounded-full border transition-all focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                activeFilterCount > 0
                  ? 'border-[#16A34A] text-[#15803d] bg-[#dcfce7]'
                  : 'border-[#E5E7EB] text-[#6B7280] bg-white hover:border-[#D1D5DB]'
              }`}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-[#16A34A] text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Sort + count row */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#9CA3AF]">
            {isLoading ? '…' : t('plan.itemCount', { count: sortedRecipes.length })}
          </span>
          <select
            value={search.sort}
            onChange={(e) => update({ sort: e.target.value as Sort })}
            aria-label={t('sort.label')}
            className="text-xs bg-white border border-[#E5E7EB] text-[#1A1A1A] rounded-xl px-2 py-1.5 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors"
          >
            <option value="pcal">{t('sort.pcal')}</option>
            <option value="popular">{t('sort.popular')}</option>
            <option value="protein">{t('sort.protein')}</option>
            <option value="calories">{t('sort.calories')}</option>
            <option value="time">{t('sort.time')}</option>
            {/* Hidden until enough cook_log data to make it meaningful */}
          </select>
        </div>

        {/* Recipe list — virtualised */}
        {isLoading ? (
          <div className="flex-1 min-h-0 overflow-auto pb-20 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => <CardSkeleton key={i} />)}
          </div>
        ) : sortedRecipes.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center pb-20">
            <p className="text-[#6B7280] text-sm">{t('filters.empty')}</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="mt-2 text-xs text-[#16A34A] underline">
                {t('filters.clearFilters')}
              </button>
            )}
          </div>
        ) : (
          <div ref={parentRef} className="flex-1 min-h-0 overflow-auto pb-20">
            <div
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const isSentinel = virtualItem.index >= sortedRecipes.length
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                      paddingBottom: '12px',
                    }}
                  >
                    {isSentinel ? (
                      <div className="py-4 flex justify-center">
                        {isFetchingNextPage && (
                          <div className="h-5 w-5 rounded-full border-2 border-[#16A34A] border-t-transparent animate-spin" />
                        )}
                      </div>
                    ) : (
                      <RecipeCard
                        recipe={sortedRecipes[virtualItem.index]}
                        cookCount={cookCountMap[sortedRecipes[virtualItem.index].id] ?? 0}
                        isSaved={savedIds.has(sortedRecipes[virtualItem.index].id)}
                        showOwnerBadge={search.mode === 'all' || search.mode === 'saved'}
                        onToggleSave={(e) => {
                          e.preventDefault()
                          const r = sortedRecipes[virtualItem.index]
                          saveMutation.mutate({ recipeId: r.id, wasSaved: savedIds.has(r.id) })
                        }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        section={sheetSection}
        search={search}
        allTags={meta?.tags ?? []}
        allIngredientNames={meta?.ingredients ?? []}
        onUpdate={update}
        onClear={clearFilters}
      />

      {/* FAB */}
      <Link
        to="/app/library/create"
        aria-label={t('library.newRecipe')}
        className="fixed z-20 right-4 w-14 h-14 rounded-full bg-[#16A34A] text-white shadow-lg flex items-center justify-center hover:bg-[#15803d] active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
        style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom) + 1rem)' }}
      >
        <Plus size={24} aria-hidden="true" />
      </Link>
    </div>
  )
}
