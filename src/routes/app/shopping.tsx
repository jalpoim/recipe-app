import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ensureActivePlan, fetchPlanItems } from '../../lib/supabase/plan-queries'
import {
  fetchShoppingChecks,
  upsertCheck,
  addCustomShoppingItem,
  deleteCustomShoppingItem,
  clearNonCustomChecks,
  clearCustomItems,
  fetchCategoryOverrides,
  upsertCategoryOverride,
} from '../../lib/supabase/shopping-queries'
import type { PlanItemWithRecipe, ShoppingCheckState } from '../../types/db'
import { useToast } from '../../components/Toast'

function ShoppingSkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4 py-5 space-y-3 animate-pulse">
        <div className="h-6 w-40 bg-[#F3F4F6] rounded-full mb-4" />
        <div className="h-10 bg-[#F3F4F6] rounded-xl" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[#F3F4F6]">
              <div className="h-3.5 w-1/2 bg-[#F3F4F6] rounded-full" />
            </div>
            {[0, 1, 2].map((j) => (
              <div key={j} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-5 h-5 rounded-md bg-[#F3F4F6] shrink-0" />
                <div className="h-3 flex-1 bg-[#F3F4F6] rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function ShoppingError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">Não foi possível carregar a lista</p>
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

export const Route = createFileRoute('/app/shopping')({
  pendingComponent: ShoppingSkeleton,
  errorComponent: ({ error }) => <ShoppingError error={error as Error} />,
  validateSearch: (search) => ({
    view: search.view === 'global' ? ('global' as const) : ('recipe' as const),
  }),
  loader: async () => {
    const plan = await ensureActivePlan()
    const [items, checks] = await Promise.all([
      fetchPlanItems({ data: plan.id }),
      fetchShoppingChecks({ data: plan.id }),
    ])
    return { plan, items, checks }
  },
  component: ShoppingPage,
})

// ---------- constants ----------

const CATEGORIES = ['Talho/Peixaria', 'Frutas/Legumes', 'Lacticínios', 'Mercearia', 'Outros'] as const
type Category = (typeof CATEGORIES)[number]

const CATEGORY_KEYWORDS: [Category, string[]][] = [
  ['Talho/Peixaria', ['frango', 'carne', 'bife', 'peixe', 'atum', 'salmão', 'peru', 'bacalhau', 'porco', 'filete', 'chicken', 'salmon', 'tuna', 'turkey', 'cod', 'beef', 'pork', 'shrimp', 'camarão']],
  ['Lacticínios', ['leite', 'iogurte', 'queijo', 'manteiga', 'nata', 'ovo', 'ovos', 'milk', 'yogurt', 'cheese', 'butter', 'egg', 'whey']],
  ['Frutas/Legumes', ['tomate', 'alface', 'cenoura', 'brócolo', 'espinafre', 'banana', 'maçã', 'cebola', 'alho', 'batata', 'tomato', 'lettuce', 'carrot', 'broccoli', 'spinach', 'onion', 'garlic', 'potato']],
  ['Mercearia', ['arroz', 'massa', 'aveia', 'pão', 'farinha', 'azeite', 'óleo', 'rice', 'pasta', 'oats', 'bread', 'flour', 'oil', 'olive']],
]

function autoCategory(label: string): Category | null {
  const lower = label.toLowerCase()
  for (const [cat, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return cat
  }
  return null
}

// ---------- helpers ----------

function fmtQty(qty: number | null): string {
  if (qty == null || qty === 0) return ''
  if (qty >= 100) return Math.round(qty).toString()
  if (qty % 1 === 0) return qty.toString()
  return qty.toFixed(1)
}

function scaleQty(qty: number | null, portionMult: number, defaultMult: number, servings: number): number | null {
  if (qty == null) return null
  return qty * ((portionMult * defaultMult) / (servings || 1))
}

// ---------- sub-components ----------

function ViewToggle({ view, onChange }: { view: 'recipe' | 'global'; onChange: (v: 'recipe' | 'global') => void }) {
  return (
    <div className="flex rounded-xl border border-[#E5E7EB] overflow-hidden bg-white">
      {(['recipe', 'global'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`flex-1 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
            view === v ? 'bg-[#16A34A] text-white' : 'text-[#6B7280] hover:bg-[#F9FAFB]'
          }`}
        >
          {v === 'recipe' ? 'Por receita' : 'Lista global'}
        </button>
      ))}
    </div>
  )
}

function CheckRow({
  label,
  qty,
  unit,
  checked,
  partial,
  onToggle,
  onRemove,
}: {
  itemKey: string
  label: string
  qty: number | null
  unit: string | null
  checked: boolean
  partial?: boolean
  onToggle: () => void
  onRemove?: () => void
}) {
  const qtyStr = fmtQty(qty)
  const display = [qtyStr, unit, label].filter(Boolean).join(' ')

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <button
        onClick={onToggle}
        aria-pressed={checked}
        aria-label={`${checked ? 'Desmarcar' : 'Marcar'} ${label}`}
        className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
          checked
            ? 'bg-[#16A34A] border-[#16A34A]'
            : partial
            ? 'bg-[#dcfce7] border-[#16A34A]'
            : 'border-[#D1D5DB] hover:border-[#16A34A]'
        }`}
      >
        {checked && <Check size={11} className="text-white" strokeWidth={3} aria-hidden="true" />}
        {partial && !checked && <div className="w-2 h-0.5 bg-[#16A34A] rounded-full" />}
      </button>
      <span
        className={`flex-1 text-sm transition-colors ${
          checked ? 'line-through text-[#9CA3AF]' : partial ? 'text-[#6B7280]' : 'text-[#1A1A1A]'
        }`}
      >
        {display}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remover ${label}`}
          className="shrink-0 text-[#9CA3AF] hover:text-[#DC2626] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none rounded"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function CategoryPicker({
  current,
  onSelect,
  onClose,
}: {
  current: string
  onSelect: (cat: Category) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div
        className="w-full max-w-md mx-auto bg-white rounded-t-2xl border-t border-[#E5E7EB] pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
        </div>
        <p className="text-sm font-semibold text-[#1A1A1A] px-4 pb-3">Alterar categoria</p>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => onSelect(cat)}
            className={`w-full text-left px-4 py-3 text-sm transition-colors hover:bg-[#F9FAFB] focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${
              cat === current ? 'font-semibold text-[#16A34A]' : 'text-[#1A1A1A]'
            }`}
          >
            {cat}
            {cat === current && <span className="ml-2 text-xs text-[#16A34A]">✓</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Por receita view ----------

function RecipeView({
  items,
  defaultMult,
  checkMap,
  onToggle,
}: {
  items: PlanItemWithRecipe[]
  defaultMult: number
  checkMap: Map<string, boolean>
  onToggle: (key: string) => void
}) {
  if (items.length === 0) return null

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const visibleIngs = item.recipe.recipe_ingredients.filter((i) => !i.is_pantry)
        if (visibleIngs.length === 0) return null

        return (
          <div key={item.id} className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[#F3F4F6]">
              <p className="text-sm font-semibold text-[#1A1A1A]">{item.recipe.name}</p>
              <p className="text-xs text-[#9CA3AF] mt-0.5">
                {item.portion_multiplier * defaultMult}× porção
              </p>
            </div>
            <div className="divide-y divide-[#F9FAFB]">
              {visibleIngs.map((ing) => {
                const key = `recipe:${item.id}:${ing.id}`
                const qty = scaleQty(ing.quantity, item.portion_multiplier, defaultMult, item.recipe.servings)
                return (
                  <CheckRow
                    key={key}
                    itemKey={key}
                    label={ing.name ?? ing.raw_text}
                    qty={qty}
                    unit={ing.unit}
                    checked={checkMap.get(key) ?? false}
                    onToggle={() => onToggle(key)}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Lista global view ----------

type AggItem = {
  recipeKeys: string[]
  name: string
  unit: string | null
  category: string
  totalQty: number | null
  hasUnknownQty: boolean
}

function buildGlobalList(
  items: PlanItemWithRecipe[],
  defaultMult: number,
  categoryOverrides: Record<string, string>,
): Map<string, AggItem[]> {
  const aggMap = new Map<string, AggItem>()

  for (const item of items) {
    for (const ing of item.recipe.recipe_ingredients) {
      if (ing.is_pantry) continue
      const name = (ing.name ?? ing.raw_text).trim()
      const unit = ing.unit ?? null
      const aggKey = `${name.toLowerCase()}|${unit ?? ''}`
      const recipeKey = `recipe:${item.id}:${ing.id}`
      const qty = scaleQty(ing.quantity, item.portion_multiplier, defaultMult, item.recipe.servings)
      const category =
        categoryOverrides[name.toLowerCase()] ??
        ing.category ??
        'Outros'

      const existing = aggMap.get(aggKey)
      if (existing) {
        existing.recipeKeys.push(recipeKey)
        if (qty != null && existing.totalQty != null) {
          existing.totalQty += qty
        } else {
          existing.hasUnknownQty = true
        }
      } else {
        aggMap.set(aggKey, {
          recipeKeys: [recipeKey],
          name,
          unit,
          category,
          totalQty: qty,
          hasUnknownQty: qty == null,
        })
      }
    }
  }

  // Group by category
  const byCategory = new Map<string, AggItem[]>()
  for (const item of aggMap.values()) {
    const cat = item.category
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(item)
  }

  // Sort categories in canonical order
  const ordered = new Map<string, AggItem[]>()
  for (const cat of CATEGORIES) {
    const items = byCategory.get(cat)
    if (items && items.length > 0) {
      ordered.set(cat, items.sort((a, b) => a.name.localeCompare(b.name)))
    }
  }
  // Any remaining categories not in canonical list
  for (const [cat, items] of byCategory) {
    if (!ordered.has(cat)) ordered.set(cat, items)
  }
  return ordered
}

function GlobalView({
  items,
  defaultMult,
  checkMap,
  customItems,
  categoryOverrides,
  onToggle,
  onRemoveCustom,
  onCategoryChange,
}: {
  items: PlanItemWithRecipe[]
  defaultMult: number
  checkMap: Map<string, boolean>
  customItems: ShoppingCheckState[]
  categoryOverrides: Record<string, string>
  onToggle: (keys: string[], next: boolean) => void
  onRemoveCustom: (key: string) => void
  onCategoryChange: (ingredientName: string, cat: Category) => void
}) {
  const [editingCategory, setEditingCategory] = useState<{ name: string; current: string } | null>(null)

  const grouped = buildGlobalList(items, defaultMult, categoryOverrides)

  return (
    <>
      <div className="space-y-3">
        {[...grouped.entries()].map(([category, aggItems]) => (
          <div key={category} className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm overflow-hidden">
            <button
              onClick={() => setEditingCategory({ name: category, current: category })}
              className="w-full text-left px-4 py-2.5 border-b border-[#F3F4F6] flex items-center justify-between group focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">
                {category}
              </span>
              <span className="text-[10px] text-[#9CA3AF] opacity-0 group-hover:opacity-100 transition-opacity">
                alterar
              </span>
            </button>
            <div className="divide-y divide-[#F9FAFB]">
              {aggItems.map((agg) => {
                const checkedCount = agg.recipeKeys.filter((k) => checkMap.get(k) ?? false).length
                const allChecked = checkedCount === agg.recipeKeys.length
                const someChecked = checkedCount > 0 && !allChecked
                return (
                  <CheckRow
                    key={agg.recipeKeys[0]}
                    itemKey={agg.recipeKeys[0]}
                    label={agg.name}
                    qty={agg.hasUnknownQty ? null : agg.totalQty}
                    unit={agg.unit}
                    checked={allChecked}
                    partial={someChecked}
                    onToggle={() => onToggle(agg.recipeKeys, !allChecked)}
                  />
                )
              })}
            </div>
          </div>
        ))}

        {/* Custom items */}
        {customItems.length > 0 && (
          <div className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#F3F4F6]">
              <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">
                Itens extra
              </span>
            </div>
            <div className="divide-y divide-[#F9FAFB]">
              {customItems.map((c) => (
                <CheckRow
                  key={c.item_key}
                  itemKey={c.item_key}
                  label={c.label ?? c.item_key}
                  qty={null}
                  unit={null}
                  checked={checkMap.get(c.item_key) ?? false}
                  onToggle={() => onToggle([c.item_key], !(checkMap.get(c.item_key) ?? false))}
                  onRemove={() => onRemoveCustom(c.item_key)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Category picker overlay */}
      {editingCategory && (
        <CategoryPicker
          current={editingCategory.current}
          onSelect={(cat) => {
            onCategoryChange(editingCategory.name, cat)
            setEditingCategory(null)
          }}
          onClose={() => setEditingCategory(null)}
        />
      )}
    </>
  )
}

// ---------- AddCustomItemForm ----------

function AddCustomItemForm({
  onAdd,
  onClose,
}: {
  onAdd: (label: string, category: Category) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState<Category | null>(null)
  const [showCatPicker, setShowCatPicker] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (window.matchMedia('(hover: hover)').matches) {
      inputRef.current?.focus()
    }
  }, [])

  function handleLabelChange(val: string) {
    setLabel(val)
    if (val.trim()) {
      const auto = autoCategory(val)
      setCategory(auto)
    } else {
      setCategory(null)
    }
  }

  function handleSubmit() {
    const trimmed = label.trim()
    if (!trimmed) return
    onAdd(trimmed, category ?? 'Outros')
    setLabel('')
    setCategory(null)
  }

  return (
    <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          name="shopping-item"
          autoComplete="off"
          value={label}
          onChange={(e) => handleLabelChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Nome do item…"
          className="flex-1 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors"
        />
        <button
          onClick={onClose}
          aria-label="Cancelar"
          className="text-[#9CA3AF] hover:text-[#6B7280] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowCatPicker(true)}
          className="flex-1 text-left text-xs px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:border-[#16A34A] hover:text-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
        >
          {category ?? 'Categoria…'}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!label.trim()}
          className="px-4 py-1.5 rounded-xl bg-[#16A34A] text-white text-xs font-semibold disabled:opacity-40 hover:bg-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
        >
          Adicionar
        </button>
      </div>

      {showCatPicker && (
        <CategoryPicker
          current={category ?? 'Outros'}
          onSelect={(cat) => { setCategory(cat); setShowCatPicker(false) }}
          onClose={() => setShowCatPicker(false)}
        />
      )}
    </div>
  )
}

// ---------- ShoppingPage ----------

function ShoppingPage() {
  const { plan, items, checks: loaderChecks } = Route.useLoaderData()
  const { view } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showToast } = useToast()

  function setView(v: 'recipe' | 'global') {
    // @ts-ignore -- routeTree.gen.ts is regenerated on pnpm dev; view is valid search param
    void navigate({ search: { view: v }, replace: true })
  }

  // Checkbox state — local, fire-and-forget to server
  const [checkMap, setCheckMap] = useState<Map<string, boolean>>(
    () => new Map(loaderChecks.map((c) => [c.item_key, c.is_checked])),
  )

  // Custom items state
  const [customItems, setCustomItems] = useState<ShoppingCheckState[]>(
    () => loaderChecks.filter((c) => c.item_key.startsWith('custom:')),
  )

  // Per-ingredient category overrides — backed by Supabase
  const { data: overridesData = [] } = useQuery({
    queryKey: ['category-overrides'],
    queryFn: fetchCategoryOverrides,
  })

  const categoryOverrides: Record<string, string> = Object.fromEntries(
    overridesData.map((r) => [r.ingredient_name.toLowerCase(), r.category]),
  )

  const overrideMutation = useMutation({
    mutationFn: (vars: { ingredientName: string; category: string }) =>
      upsertCategoryOverride({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-overrides'] }),
    onError: () => showToast('Erro ao guardar', 'error'),
  })

  const [showAddForm, setShowAddForm] = useState(false)
  const [confirmClearChecks, setConfirmClearChecks] = useState(false)
  const [confirmClearCustom, setConfirmClearCustom] = useState(false)

  const defaultMult = plan.default_multiplier
  const hasCustomItems = customItems.length > 0
  const checkedCount = [...checkMap.values()].filter(Boolean).length

  function toggleCheck(itemKey: string, label?: string, category?: string) {
    const next = !(checkMap.get(itemKey) ?? false)
    setCheckMap((prev) => new Map(prev).set(itemKey, next))
    upsertCheck({ data: { planId: plan.id, itemKey, isChecked: next, label, category } }).catch(
      () => showToast('Erro ao guardar', 'error'),
    )
  }

  function toggleKeys(keys: string[], next: boolean) {
    setCheckMap((prev) => {
      const m = new Map(prev)
      for (const k of keys) m.set(k, next)
      return m
    })
    for (const k of keys) {
      upsertCheck({ data: { planId: plan.id, itemKey: k, isChecked: next } }).catch(
        () => showToast('Erro ao guardar', 'error'),
      )
    }
  }

  function handleCategoryChange(ingredientName: string, cat: Category) {
    overrideMutation.mutate({ ingredientName: ingredientName.toLowerCase(), category: cat })
  }

  function handleAddCustom(label: string, category: Category) {
    const tempKey = `custom:${Date.now()}`
    const tempItem: ShoppingCheckState = {
      id: tempKey,
      plan_id: plan.id,
      item_key: tempKey,
      is_checked: false,
      label,
      category,
      updated_at: null,
    }
    setCustomItems((prev) => [...prev, tempItem])
    setCheckMap((prev) => new Map(prev).set(tempKey, false))
    setShowAddForm(false)

    addCustomShoppingItem({ data: { planId: plan.id, label, category } }).then((saved) => {
      setCustomItems((prev) =>
        prev.map((c) => (c.item_key === tempKey ? saved : c)),
      )
      setCheckMap((prev) => {
        const next = new Map(prev)
        next.delete(tempKey)
        next.set(saved.item_key, false)
        return next
      })
    }).catch(() => showToast('Erro ao adicionar item', 'error'))
  }

  function handleRemoveCustom(itemKey: string) {
    setCustomItems((prev) => prev.filter((c) => c.item_key !== itemKey))
    setCheckMap((prev) => { const n = new Map(prev); n.delete(itemKey); return n })
    deleteCustomShoppingItem({ data: { planId: plan.id, itemKey } }).catch(
      () => showToast('Erro ao remover item', 'error'),
    )
  }

  function handleClearChecks() {
    const next = new Map(checkMap)
    for (const [k] of next) {
      if (!k.startsWith('custom:')) next.set(k, false)
    }
    setCheckMap(next)
    clearNonCustomChecks({ data: plan.id }).catch(
      () => showToast('Erro ao limpar marcações', 'error'),
    )
  }

  function handleClearCustomItems() {
    setCustomItems([])
    const next = new Map(checkMap)
    for (const [k] of next) {
      if (k.startsWith('custom:')) next.delete(k)
    }
    setCheckMap(next)
    clearCustomItems({ data: plan.id }).catch(
      () => showToast('Erro ao limpar itens', 'error'),
    )
  }

  const isEmpty = items.length === 0

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4">
        {/* Header */}
        <div className="py-5">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Lista de compras</h1>
          {!isEmpty && (
            <p className="text-xs text-[#9CA3AF] mt-0.5">
              {checkedCount > 0 ? `${checkedCount} marcado${checkedCount !== 1 ? 's' : ''}` : 'Toca para marcar o que já tens'}
            </p>
          )}
        </div>

        {isEmpty ? (
          <div className="py-16 text-center">
            <p className="text-[#6B7280] text-sm">Adiciona receitas ao plano para gerar a lista</p>
          </div>
        ) : (
          <>
            {/* View toggle */}
            <div className="mb-4">
              <ViewToggle view={view} onChange={setView} />
            </div>

            {/* Content — both always mounted so checkMap stays in sync */}
            <div className={view !== 'recipe' ? 'hidden' : ''}>
              <RecipeView
                items={items}
                defaultMult={defaultMult}
                checkMap={checkMap}
                onToggle={toggleCheck}
              />
            </div>
            <div className={view !== 'global' ? 'hidden' : ''}>
              <GlobalView
                items={items}
                defaultMult={defaultMult}
                checkMap={checkMap}
                customItems={customItems}
                categoryOverrides={categoryOverrides}
                onToggle={toggleKeys}
                onRemoveCustom={handleRemoveCustom}
                onCategoryChange={handleCategoryChange}
              />
            </div>

            {/* Add custom item */}
            <div className="mt-4">
              {showAddForm ? (
                <AddCustomItemForm
                  onAdd={handleAddCustom}
                  onClose={() => setShowAddForm(false)}
                />
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-2 w-full rounded-2xl border border-dashed border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#9CA3AF] hover:border-[#16A34A] hover:text-[#16A34A] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                >
                  <Plus size={16} aria-hidden="true" />
                  Adicionar item extra
                </button>
              )}
            </div>

            {/* Bottom actions */}
            <div className="mt-4 flex flex-col gap-2">
              {checkedCount > 0 && (
                confirmClearChecks ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmClearChecks(false)}
                      className="flex-1 py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => { handleClearChecks(); setConfirmClearChecks(false) }}
                      className="flex-1 py-2.5 rounded-xl border border-[#fecaca] bg-[#fee2e2] text-[#DC2626] text-sm font-medium hover:bg-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                    >
                      Confirmar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClearChecks(true)}
                    className="w-full py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#6B7280] hover:text-[#1A1A1A] hover:border-[#D1D5DB] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                  >
                    Limpar marcações
                  </button>
                )
              )}
              {hasCustomItems && (
                confirmClearCustom ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmClearCustom(false)}
                      className="flex-1 py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => { handleClearCustomItems(); setConfirmClearCustom(false) }}
                      className="flex-1 py-2.5 rounded-xl border border-[#fecaca] bg-[#fee2e2] text-[#DC2626] text-sm font-medium hover:bg-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                    >
                      Confirmar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClearCustom(true)}
                    className="w-full py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#9CA3AF] hover:text-[#DC2626] hover:border-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                  >
                    Limpar itens extra
                  </button>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
