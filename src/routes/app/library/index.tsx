import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useMemo, useRef, useEffect, useCallback, useDeferredValue } from 'react'
import { capture } from '../../../lib/analytics'
import { ArrowUpDown, Bookmark, BookmarkCheck, Check, Clock, Heart, Plus, Search, Settings, SlidersHorizontal, X } from 'lucide-react'
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
import { fetchMyProfile, fetchIngredientExclusions } from '../../../lib/supabase/profile-queries'
import { useToast } from '../../../components/Toast'
import type { Recipe, DietaryMode } from '../../../types/db'

const DIETARY_FLAGS: Record<DietaryMode, string[]> = {
  none: [],
  vegetarian: ['meat', 'poultry', 'fish', 'shellfish'],
  vegan: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg', 'honey'],
  pescatarian: ['meat', 'poultry'],
}

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

type GatewayCategory = 'meat' | 'poultry' | 'fish' | 'vegetarian' | 'quick'

type LibrarySearch = {
  q: string
  proteins: string[]
  maxCal: number | undefined
  maxTime: number | undefined
  tags: string[]
  ingredients: string[]
  sort: Sort
  modes: LibraryMode[]
  category: GatewayCategory | undefined
  categorySort: 'popular' | 'quick'
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
    modes: Array.isArray(search.modes)
      ? (search.modes as string[]).filter((s): s is LibraryMode =>
          (['mine', 'saved', 'curated'] as string[]).includes(s),
        )
      : [],
    category: (['meat', 'poultry', 'fish', 'vegetarian', 'quick'] as GatewayCategory[]).includes(search.category as GatewayCategory)
      ? (search.category as GatewayCategory)
      : undefined,
    categorySort: search.categorySort === 'quick' ? 'quick' : 'popular',
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
        className="block px-4 pt-4 pb-2"
      >
        <div className="flex items-start gap-3">
          {/* Thumbnail */}
          <div className="w-[88px] h-[88px] shrink-0">
            {recipe.image_thumb_url ? (
              <img
                src={recipe.image_thumb_url}
                alt=""
                className="w-full h-full rounded-xl object-cover object-center"
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
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-center">
            {(
              [
                { label: t('recipe.calAbbr'), value: cal },
                { label: t('recipe.proteinAbbr'), value: pro },
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
          <div className="mt-1 flex items-center gap-2">
            {cookCount > 0 && (
              <p className="text-[10px] text-[#9CA3AF] flex-1">{t('recipe.cookedCount', { count: cookCount })}</p>
            )}
            {onToggleSave && (
              <button
                onClick={onToggleSave}
                aria-label={isSaved ? t('recipe.unsave') : t('recipe.save')}
                aria-pressed={isSaved}
                className={`ml-auto w-8 h-8 rounded-full flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                  isSaved
                    ? 'text-[#16A34A]'
                    : 'text-[#D1D5DB] hover:text-[#16A34A]'
                }`}
              >
                {isSaved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
              </button>
            )}
          </div>
        )}
      </Link>
    </div>
  )
}



// ---------- Category gateway ----------

const CATEGORY_COLORS: Record<GatewayCategory, string> = {
  meat:       'linear-gradient(135deg, #fee2e2, #fca5a5)',
  poultry:    'linear-gradient(135deg, #fef3c7, #fde68a)',
  fish:       'linear-gradient(135deg, #dbeafe, #93c5fd)',
  vegetarian: 'linear-gradient(135deg, #d1fae5, #6ee7b7)',
  quick:      'linear-gradient(135deg, #ede9fe, #c4b5fd)',
}

const CATEGORY_PROTEINS: Record<GatewayCategory, string[]> = {
  meat:       ['beef', 'pork', 'lamb'],
  poultry:    ['chicken', 'turkey'],
  fish:       ['salmon', 'tuna', 'cod', 'sardine', 'hake', 'sea-bream', 'sea-bass', 'mackerel', 'octopus', 'shrimp'],
  vegetarian: [],
  quick:      [],
}

const CATEGORY_EMOJI: Record<GatewayCategory, string> = {
  meat:       '🥩',
  poultry:    '🍗',
  fish:       '🐟',
  vegetarian: '🥦',
  quick:      '⏱️',
}

const CATEGORY_EXCLUDED_FLAGS: Record<GatewayCategory, string[]> = {
  meat:       [],
  poultry:    [],
  fish:       [],
  vegetarian: ['meat', 'poultry', 'fish', 'shellfish'],
  quick:      [],
}

// ---------- GridCard ----------

function GridCard({ recipe, onClick }: { recipe: RecipeWithIngredients; onClick?: () => void }) {
  const hasMacros = recipe.calories != null
  const cal = recipe.macros_total ? (recipe.calories ?? 0) / (recipe.servings || 1) : (recipe.calories ?? 0)
  const pro = recipe.macros_total ? (recipe.protein ?? 0) / (recipe.servings || 1) : (recipe.protein ?? 0)
  const ratio = hasMacros && cal ? (pro * 10) / cal : 0

  const thumbnailBg = recipe.image_thumb_url
    ? undefined
    : (PROTEIN_COLORS[recipe.proteins[0]] ?? 'linear-gradient(135deg, #dcfce7, #bbf7d0)')

  return (
    <Link
      to="/app/library/$recipeId"
      params={{ recipeId: recipe.id }}
      search={{ from: undefined, planItemId: undefined }}
      onClick={onClick}
      className="block rounded-2xl overflow-hidden shadow-sm active:scale-[0.98] transition-transform"
    >
      {/* Photo */}
      <div className="relative aspect-[4/3] w-full">
        {recipe.image_thumb_url ? (
          <img
            src={recipe.image_thumb_url}
            alt=""
            className="w-full h-full object-cover object-center"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full" style={{ background: thumbnailBg }} aria-hidden="true" />
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        {/* Text on image */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-3">
          <p className="text-white text-sm font-semibold leading-snug line-clamp-2">{recipe.name}</p>
          <div className="flex items-center gap-2 mt-1">
            {recipe.time_min != null && (
              <span className="text-white/80 text-xs flex items-center gap-0.5">
                <Clock size={10} aria-hidden="true" />
                {recipe.time_min} min
              </span>
            )}
            {hasMacros && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${badgeClass(ratio)}`}>
                P/Cal {fmt(ratio)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
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
                <button
                  aria-expanded={proteinsExpanded}
                  onClick={() => setProteinsExpanded((e) => !e)}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed border-[#D1D5DB] text-[#9CA3AF] hover:border-[#16A34A] hover:text-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                >
                  {proteinsExpanded ? t('tagSections.verMenos') : t('tagSections.verMais')}
                </button>
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

              <div className="relative">
                <input
                  type="text"
                  value={ingSearch}
                  onChange={(e) => setIngSearch(e.target.value)}
                  onFocus={() => {
                    if (!ingredientsRef.current || !scrollRef.current) return
                    const containerTop = scrollRef.current.getBoundingClientRect().top
                    const elTop = ingredientsRef.current.getBoundingClientRect().top
                    const offset = scrollRef.current.scrollTop + (elTop - containerTop) - 16
                    scrollRef.current.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && ingSearch.trim()) {
                      addIngredient(ingSearch.trim())
                      setIngSearch('')
                    }
                  }}
                  placeholder={t('filters.searchIngredient')}
                  className="w-full rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 pr-9 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors"
                />
                {ingSearch.trim().length > 0 && (
                  <button
                    onClick={() => { addIngredient(ingSearch.trim()); setIngSearch('') }}
                    aria-label={t('filters.searchFreeText', { term: ingSearch.trim() })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#16A34A] text-white flex items-center justify-center hover:bg-[#15803d] transition-colors focus:outline-none"
                  >
                    <Plus size={13} aria-hidden="true" />
                  </button>
                )}
              </div>

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

// ---------- SortSheet ----------

const SORT_OPTIONS: { value: Sort; labelKey: string }[] = [
  { value: 'pcal',     labelKey: 'sort.pcal' },
  { value: 'popular',  labelKey: 'sort.popular' },
  { value: 'protein',  labelKey: 'sort.protein' },
  { value: 'calories', labelKey: 'sort.calories' },
  { value: 'time',     labelKey: 'sort.time' },
  { value: 'cooked',   labelKey: 'sort.cooked' },
]

function SortSheet({
  open,
  onOpenChange,
  current,
  onSelect,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  current: Sort
  onSelect: (s: Sort) => void
}) {
  const { t } = useTranslation()
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-white rounded-t-2xl outline-none"
          aria-label={t('sort.label')}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
          </div>
          <div className="px-4 pt-1 pb-2">
            <p className="text-base font-semibold text-[#1A1A1A]">{t('sort.label')}</p>
          </div>
          <div className="pb-6">
            {SORT_OPTIONS.map(({ value, labelKey }) => (
              <button
                key={value}
                onClick={() => { onSelect(value); onOpenChange(false) }}
                className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#16A34A]/40"
              >
                <span className={current === value ? 'font-semibold text-[#16A34A]' : ''}>
                  {t(labelKey)}
                </span>
                {current === value && <Check size={16} className="text-[#16A34A]" aria-hidden="true" />}
              </button>
            ))}
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
  const [sortSheetOpen, setSortSheetOpen] = useState(false)
  const [ignoreDietary, setIgnoreDietary] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('dietary_banner_dismissed') === '1'
  )
  const parentRef = useRef<HTMLDivElement>(null)

  const activeCat = search.category

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
    return () => {
      if (parentRef.current) {
        sessionStorage.setItem('library_scroll', String(parentRef.current.scrollTop))
      }
    }
  }, [])

  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => fetchMyProfile(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: excludedIngredientIds = [] } = useQuery({
    queryKey: ['ingredient-exclusions'],
    queryFn: () => fetchIngredientExclusions(),
    staleTime: 5 * 60 * 1000,
  })

  const userExcludedFlags = useMemo(() => {
    if (ignoreDietary) return []
    const modeFlags = DIETARY_FLAGS[(profile?.dietary_mode ?? 'none') as DietaryMode] ?? []
    const intoleranceFlags = profile?.intolerances ?? []
    return [...new Set([...modeFlags, ...intoleranceFlags])]
  }, [profile, ignoreDietary])

  const hasActiveFilters = Boolean(
    search.q ||
      search.proteins.length ||
      search.maxCal !== undefined ||
      search.maxTime !== undefined ||
      search.tags.length ||
      search.ingredients.length,
  )

  const showGateway = !activeCat && !hasActiveFilters && search.modes.length === 0 && !search.q

  const effectiveSort: Sort = activeCat
    ? (search.categorySort === 'quick' ? 'time' : 'popular')
    : search.sort

  const filterKey = useMemo(() => {
    const catFlags = activeCat ? CATEGORY_EXCLUDED_FLAGS[activeCat] : []
    const effectiveExcludedFlags = [...new Set([...userExcludedFlags, ...catFlags])]
    return {
      proteins: activeCat ? CATEGORY_PROTEINS[activeCat] : search.proteins,
      maxCal: activeCat ? undefined : search.maxCal,
      maxTime: activeCat === 'quick' ? 30 : (activeCat ? undefined : search.maxTime),
      tags: activeCat ? [] : search.tags,
      ingredients: activeCat ? [] : search.ingredients,
      q: activeCat ? '' : deferredQ,
      modes: search.modes,
      lang,
      excludedFlags: effectiveExcludedFlags,
      excludedIngredientIds: ignoreDietary ? [] : excludedIngredientIds,
      category: activeCat,
      categorySort: activeCat ? search.categorySort : undefined,
    }
  }, [activeCat, search.proteins, search.maxCal, search.maxTime, search.tags, search.ingredients, deferredQ, search.modes, lang, userExcludedFlags, excludedIngredientIds, ignoreDietary, search.categorySort])

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
    queryFn: ({ pageParam }) => {
      const catFlags = activeCat ? CATEGORY_EXCLUDED_FLAGS[activeCat] : []
      const effectiveExcludedFlags = [...new Set([...userExcludedFlags, ...catFlags])]
      return fetchLibrary({
        data: {
          limit: PAGE_SIZE,
          cursor: (pageParam as LibraryCursor | null) ?? null,
          sort: effectiveSort,
          modes: search.modes,
          proteins: activeCat ? CATEGORY_PROTEINS[activeCat] : search.proteins,
          maxCal: activeCat ? undefined : search.maxCal,
          maxTime: activeCat === 'quick' ? 30 : (activeCat ? undefined : search.maxTime),
          tags: activeCat ? [] : search.tags,
          ingredients: activeCat ? [] : search.ingredients,
          q: activeCat ? '' : search.q,
          excludedFlags: effectiveExcludedFlags,
          excludedIngredientIds: ignoreDietary ? [] : excludedIngredientIds,
        },
      })
    },
    initialPageParam: null as LibraryCursor | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5 * 60 * 1000,
    enabled: !showGateway,
  })

  const allRecipes = useMemo(
    () => infiniteData?.pages.flatMap((p) => p.data) ?? [],
    [infiniteData],
  )

  const sortedRecipes = useMemo(() => {
    const copy = [...allRecipes]
    switch (effectiveSort) {
      case 'protein':
        return copy.sort((a, b) => (b.protein ?? 0) - (a.protein ?? 0))
      case 'calories':
        return copy.sort((a, b) => (a.calories ?? 0) - (b.calories ?? 0))
      case 'time':
        return copy.sort((a, b) => (a.time_min ?? 999) - (b.time_min ?? 999))
      case 'popular':
        return copy.sort((a, b) => (b.popularity_score ?? 0) - (a.popularity_score ?? 0))
      case 'cooked':
        return copy.sort((a, b) => (b.cook_count ?? 0) - (a.cook_count ?? 0))
      case 'pcal':
      default:
        return copy.sort((a, b) => pcalRatio(b) - pcalRatio(a))
    }
  }, [allRecipes, effectiveSort])

  const featuredRecipes = useMemo(
    () => allRecipes.filter((r) => r.is_featured).slice(0, 6),
    [allRecipes],
  )

  const hasRecipes = sortedRecipes.length > 0
  useEffect(() => {
    if (!hasRecipes || !parentRef.current) return
    const saved = sessionStorage.getItem('library_scroll')
    if (!saved) return
    sessionStorage.removeItem('library_scroll')
    const top = Number(saved)
    requestAnimationFrame(() => {
      if (parentRef.current) parentRef.current.scrollTop = top
    })
  }, [hasRecipes])

  const { data: meta } = useQuery({
    queryKey: ['libraryMeta', lang],
    queryFn: () => fetchLibraryMeta({ data: { lang } }),
    staleTime: Infinity,
  })

  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ['libraryMeta', lang],
      queryFn: () => fetchLibraryMeta({ data: { lang } }),
    })
  }, [queryClient, lang])

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

  const virtualCount = hasNextPage ? sortedRecipes.length + 1 : sortedRecipes.length
  const virtualizer = useVirtualizer({
    count: activeCat ? 0 : virtualCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 160,
    overscan: 5,
  })

  const fetchNextPageStable = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    if (activeCat) return
    const items = virtualizer.getVirtualItems()
    const lastItem = items[items.length - 1]
    if (!lastItem) return
    if (lastItem.index >= sortedRecipes.length - 1) {
      fetchNextPageStable()
    }
  }, [virtualizer.getVirtualItems(), sortedRecipes.length, fetchNextPageStable, activeCat]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeFilterCount =
    search.proteins.length +
    (search.maxCal !== undefined ? 1 : 0) +
    (search.maxTime !== undefined ? 1 : 0) +
    search.tags.length +
    search.ingredients.length

  if (isError && !showGateway) return <LibraryError error={error as Error} />

  return (
    <div className="h-dvh bg-[#FAFAF8] flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-md px-4 flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="pt-4 pb-3">
          {/* Row 1: Search bar + settings button */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center rounded-xl border border-[#E5E7EB] bg-white shadow-sm overflow-hidden focus-within:border-[#16A34A] focus-within:ring-2 focus-within:ring-[#16A34A]/20 transition-colors">
              <Search size={15} className="shrink-0 ml-3 text-[#9CA3AF] pointer-events-none" aria-hidden="true" />
              <input
                type="text"
                value={localQ}
                onChange={(e) => setLocalQ(e.target.value)}
                placeholder={t('filters.searchRecipe')}
                aria-label={t('filters.searchRecipe')}
                className="flex-1 py-2.5 px-2 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none bg-transparent min-w-0"
              />
              {localQ && (
                <button
                  onClick={() => { setLocalQ(''); update({ q: '' }) }}
                  aria-label="Limpar pesquisa"
                  className="shrink-0 mr-1 p-1 text-[#9CA3AF] hover:text-[#6B7280] transition-colors focus:outline-none rounded"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
              <div className="shrink-0 w-px h-5 bg-[#E5E7EB]" aria-hidden="true" />
              <button
                onClick={() => openSheet('protein')}
                aria-label={t('filters.sheetTitle')}
                className={`relative shrink-0 flex items-center justify-center w-10 h-10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 ${
                  activeFilterCount > 0 ? 'text-[#15803d]' : 'text-[#6B7280] hover:text-[#1A1A1A]'
                }`}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                {activeFilterCount > 0 && (
                  <span className="absolute top-1.5 right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-[#16A34A] text-white text-[9px] font-bold flex items-center justify-center leading-none">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
            <Link
              to="/app/settings"
              aria-label={t('settings.title')}
              className="shrink-0 w-10 h-10 rounded-xl border border-[#E5E7EB] bg-white shadow-sm flex items-center justify-center text-[#9CA3AF] hover:text-[#6B7280] hover:border-[#D1D5DB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              <Settings size={16} aria-hidden="true" />
            </Link>
          </div>

          {/* Row 2: Category back header OR Mode chips + sort */}
          {activeCat ? (
            <div className="flex items-center gap-2 mt-2.5">
              <button
                onClick={() => update({ category: undefined, categorySort: 'popular' })}
                className="flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 rounded"
              >
                ← {t('gateway.title')}
              </button>
              <span className="text-[#D1D5DB]" aria-hidden="true">·</span>
              <span className="text-sm font-semibold text-[#1A1A1A]">
                {CATEGORY_EMOJI[activeCat]} {t(`gateway.categories.${activeCat}`)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 mt-2.5">
              <button
                onClick={() => update({ modes: [] })}
                aria-pressed={search.modes.length === 0}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                  search.modes.length === 0
                    ? 'bg-[#dcfce7] border-[#16A34A] text-[#15803d]'
                    : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]'
                }`}
              >
                {t('library.all')}
              </button>
              {(['mine', 'saved', 'curated'] as LibraryMode[]).map((m) => {
                const active = search.modes.includes(m)
                return (
                  <button
                    key={m}
                    onClick={() => {
                      const next = active
                        ? search.modes.filter((x) => x !== m)
                        : [...search.modes, m]
                      update({ modes: next })
                    }}
                    aria-pressed={active}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
                      active
                        ? 'bg-[#dcfce7] border-[#16A34A] text-[#15803d]'
                        : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]'
                    }`}
                  >
                    {t(`library.${m}`)}
                  </button>
                )
              })}
              <div className="flex-1" />
              <button
                onClick={() => setSortSheetOpen(true)}
                aria-label={t('sort.label')}
                className={`relative shrink-0 flex items-center justify-center w-7 h-7 rounded-full border transition-colors focus:outline-none ${
                  search.sort !== 'pcal'
                    ? 'border-[#16A34A] bg-[#dcfce7] text-[#15803d]'
                    : 'border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280] hover:border-[#D1D5DB]'
                }`}
              >
                <ArrowUpDown size={13} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Dietary banner — list mode only, dismissible */}
        {!showGateway && !activeCat && userExcludedFlags.length > 0 && !bannerDismissed && (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-[#fef3c7] border border-[#fde68a] px-3 py-2 text-xs text-[#B45309]">
            <span className="flex-1">{t('library.dietaryBanner')}</span>
            <button
              onClick={() => {
                setBannerDismissed(true)
                localStorage.setItem('dietary_banner_dismissed', '1')
              }}
              aria-label={t('common.close')}
              className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center hover:bg-[#fde68a] transition-colors focus:outline-none"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ── Gateway ── */}
        {showGateway ? (
          <div className="flex-1 overflow-auto pb-24 -mx-4 px-4">
            <p className="text-xl font-bold text-[#1A1A1A] mb-4">{t('gateway.title')}</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              {(['meat', 'poultry', 'fish', 'vegetarian'] as GatewayCategory[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => update({ category: cat })}
                  className="rounded-2xl h-28 flex flex-col justify-end p-3 text-left active:scale-[0.97] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40"
                  style={{ background: CATEGORY_COLORS[cat] }}
                >
                  <span className="text-3xl leading-none mb-1">{CATEGORY_EMOJI[cat]}</span>
                  <span className="text-sm font-semibold text-[#1A1A1A]">
                    {t(`gateway.categories.${cat}`)}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => update({ category: 'quick' })}
              className="w-full rounded-2xl h-20 flex items-center gap-4 px-5 mb-5 text-left active:scale-[0.97] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40"
              style={{ background: CATEGORY_COLORS.quick }}
            >
              <span className="text-3xl leading-none">{CATEGORY_EMOJI.quick}</span>
              <span className="text-sm font-semibold text-[#1A1A1A]">
                {t('gateway.categories.quick')}
              </span>
            </button>
            {userExcludedFlags.length > 0 && (
              <div className="text-center pb-4">
                <button
                  onClick={() => setIgnoreDietary(true)}
                  className="text-sm text-[#6B7280] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 rounded"
                >
                  {t('gateway.showAll')}
                </button>
              </div>
            )}
          </div>

        ) : isLoading ? (
          <div className="flex-1 min-h-0 overflow-auto pb-20 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => <CardSkeleton key={i} />)}
          </div>

        ) : activeCat ? (
          /* ── Category grid view ── */
          <div ref={parentRef} className="flex-1 min-h-0 overflow-auto pb-20">
            {/* Featured strip */}
            {featuredRecipes.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-semibold text-[#1A1A1A] mb-2">{t('gateway.featured')}</p>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory">
                  {featuredRecipes.map((r) => (
                    <div key={r.id} className="flex-none w-44 snap-start">
                      <GridCard
                        recipe={r}
                        onClick={() => capture('recipe_viewed', { recipeId: r.id, source: 'featured_strip' })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sort pills */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => update({ categorySort: 'popular' })}
                aria-pressed={search.categorySort !== 'quick'}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 ${
                  search.categorySort !== 'quick'
                    ? 'bg-[#dcfce7] border-[#16A34A] text-[#15803d]'
                    : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]'
                }`}
              >
                {t('gateway.sort.popular')}
              </button>
              <button
                onClick={() => update({ categorySort: 'quick' })}
                aria-pressed={search.categorySort === 'quick'}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 ${
                  search.categorySort === 'quick'
                    ? 'bg-[#dcfce7] border-[#16A34A] text-[#15803d]'
                    : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]'
                }`}
              >
                {t('gateway.sort.quick')}
              </button>
            </div>

            {sortedRecipes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <p className="text-[#6B7280] text-sm text-center">{t('gateway.noResults')}</p>
                {userExcludedFlags.length > 0 && (
                  <button
                    onClick={() => setIgnoreDietary(true)}
                    className="mt-3 text-sm text-[#16A34A] underline focus:outline-none"
                  >
                    {t('gateway.showAll')}
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {sortedRecipes.map((r) => (
                    <GridCard
                      key={r.id}
                      recipe={r}
                      onClick={() => capture('recipe_viewed', { recipeId: r.id, source: 'category_grid' })}
                    />
                  ))}
                </div>
                {hasNextPage && (
                  <div className="flex justify-center py-6">
                    <button
                      onClick={fetchNextPageStable}
                      disabled={isFetchingNextPage}
                      className="text-sm text-[#16A34A] px-5 py-2 rounded-xl border border-[#16A34A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 disabled:opacity-50 flex items-center gap-2"
                    >
                      {isFetchingNextPage
                        ? <div className="h-4 w-4 rounded-full border-2 border-[#16A34A] border-t-transparent animate-spin" />
                        : t('tagSections.verMais')}
                    </button>
                  </div>
                )}
              </>
            )}
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
          /* ── Virtual list (normal / filtered mode) ── */
          <div ref={parentRef} className="flex-1 min-h-0 overflow-auto pb-20">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
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
                        showOwnerBadge={search.modes.length === 0 || search.modes.includes('saved')}
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

      <SortSheet
        open={sortSheetOpen}
        onOpenChange={setSortSheetOpen}
        current={search.sort}
        onSelect={(s) => update({ sort: s })}
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
