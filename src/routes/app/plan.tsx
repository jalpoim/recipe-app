import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { capture } from '../../lib/analytics'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Clock, ChevronRight, CalendarDays, ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Drawer } from 'vaul'
import {
  fetchPlanItems,
  fetchActivePlanWithCount,
  removePlanItem,
  updatePlanItemMultiplier,
  archiveAndCreatePlan,
} from '../../lib/supabase/plan-queries'
import { fetchCookLog } from '../../lib/supabase/cook-log-queries'
import type { CookLogWithRecipe } from '../../lib/supabase/cook-log-queries'
import type { PlanItemWithRecipe, ActivePlanWithCount, Recipe } from '../../types/db'

function PlanSkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4 py-5 space-y-3">
        <div className="h-6 w-28 bg-[#F3F4F6] rounded-full animate-pulse motion-reduce:animate-none mb-4" />
        <div className="h-14 bg-[#F3F4F6] rounded-2xl animate-pulse motion-reduce:animate-none" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 animate-pulse motion-reduce:animate-none">
            <div className="h-4 w-2/3 bg-[#F3F4F6] rounded-full mb-3" />
            <div className="grid grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((j) => <div key={j} className="h-12 bg-[#F3F4F6] rounded-xl" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlanError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">Não foi possível carregar o plano</p>
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

export const Route = createFileRoute('/app/plan')({
  errorComponent: ({ error }) => <PlanError error={error as Error} />,
  component: PlanPage,
})

// ---------- helpers ----------

function perServing(r: Recipe, field: 'calories' | 'protein' | 'carbs' | 'fat') {
  const raw = r[field] ?? 0
  return r.macros_total ? raw / (r.servings || 1) : raw
}

// ---------- PlanItemCard ----------

function PlanItemCard({
  item,
  onRemove,
  onMultiplierChange,
  isUpdating,
}: {
  item: PlanItemWithRecipe
  onRemove: (id: string) => void
  onMultiplierChange: (id: string, v: number) => void
  isUpdating?: boolean
}) {
  const { t } = useTranslation()
  const scale = item.portion_multiplier
  const cal = Math.round(perServing(item.recipe, 'calories') * scale)
  const pro = Math.round(perServing(item.recipe, 'protein') * scale)
  const carbs = Math.round(perServing(item.recipe, 'carbs') * scale)
  const fat = Math.round(perServing(item.recipe, 'fat') * scale)

  return (
    <div className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 relative group">
      {/* Full-card navigation layer */}
      <Link
        to="/app/library/$recipeId"
        params={{ recipeId: item.recipe_id }}
        search={{ from: 'plan', planItemId: item.id }}
        className="absolute inset-0 rounded-2xl focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
        aria-label={item.recipe.name}
      />

      <button
        onClick={() => onRemove(item.id)}
        aria-label={`Remover ${item.recipe.name} do plano`}
        className="absolute top-3 right-3 z-10 w-6 h-6 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#fee2e2] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
      >
        <X size={14} aria-hidden="true" />
      </button>

      <div className="block pr-8">
        <div className="flex items-center gap-1">
          <h3 className="text-[#1A1A1A] font-semibold text-sm leading-snug group-hover:text-[#16A34A] transition-colors truncate">
            {item.recipe.name}
          </h3>
          <ChevronRight size={12} className="text-[#9CA3AF] flex-shrink-0" aria-hidden="true" />
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs text-[#6B7280]">
          {item.recipe.proteins.length > 0 && (
            <span className="font-medium text-[#6B7280]">
              {t(`proteins.${item.recipe.proteins[0]}`)}
            </span>
          )}
          {item.recipe.time_min != null && (
            <span className="flex items-center gap-0.5">
              <Clock size={10} aria-hidden="true" />
              {item.recipe.time_min} {t('common.min')}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between relative z-10">
        <span className="text-[11px] text-[#9CA3AF] font-medium">{t('plan.multiplier')}</span>
        <div className="flex rounded-xl border border-[#E5E7EB] overflow-hidden">
          {([1, 2, 3, 4] as const).map((n) => (
            <button
              key={n}
              onClick={() => onMultiplierChange(item.id, n)}
              aria-pressed={item.portion_multiplier === n}
              disabled={isUpdating}
              className={`w-9 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none focus:z-10 relative disabled:opacity-50 ${
                item.portion_multiplier === n
                  ? 'bg-[#16A34A] text-white'
                  : 'bg-white text-[#6B7280] hover:bg-[#F3F4F6]'
              }`}
            >
              {n}×
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
        {(
          [
            { label: 'Cal', value: cal },
            { label: 'P', value: pro },
            { label: 'C', value: carbs },
            { label: 'G', value: fat },
          ] as const
        ).map(({ label, value }) => (
          <div key={label} className="bg-[#F9FAFB] rounded-xl py-1.5">
            <div className="text-[9px] text-[#9CA3AF] uppercase tracking-wide font-medium">{label}</div>
            <div className="text-sm font-bold text-[#1A1A1A]">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- date helpers ----------

function getWeekBounds(offset: number): { start: Date; end: Date } {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon…
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) + offset * 7)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { start: monday, end: sunday }
}

function toLocalDateStr(isoStr: string) {
  const d = new Date(isoStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateHeading(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// ---------- CookHistorySheet ----------

function CookHistorySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation()
  const [weekOffset, setWeekOffset] = useState(0)

  const { data: cookLog = [] } = useQuery({
    queryKey: ['cook-log'],
    queryFn: fetchCookLog,
    staleTime: 2 * 60 * 1000,
    enabled: open,
  })

  const { start, end } = useMemo(() => getWeekBounds(weekOffset), [weekOffset])

  const weekEntries = useMemo(
    () => cookLog.filter((e) => {
      const d = new Date(e.cooked_at)
      return d >= start && d <= end
    }),
    [cookLog, start, end],
  )

  // Day strip: Mon=0 … Sun=6
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
  const stripDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const dateStr = toLocalDateStr(d.toISOString())
      const hasEntry = weekEntries.some((e) => toLocalDateStr(e.cooked_at) === dateStr)
      return { key: DAY_KEYS[i], hasEntry, date: d }
    })
  }, [start, weekEntries])

  // Group entries by date, most recent first
  const grouped = useMemo(() => {
    const map = new Map<string, CookLogWithRecipe[]>()
    for (const entry of weekEntries) {
      const key = toLocalDateStr(entry.cooked_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(entry)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [weekEntries])

  const hasOlderEntries = cookLog.some((e) => new Date(e.cooked_at) < start)

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-[20px] bg-[#FAFAF8] outline-none"
          aria-label={t('cookHistory.title')}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1 w-10 rounded-full bg-[#E5E7EB]" aria-hidden="true" />
          </div>

          <div className="px-4 pb-4" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            {/* Header */}
            <div className="flex items-center justify-between py-3">
              <h2 className="text-base font-bold text-[#1A1A1A]">{t('cookHistory.title')}</h2>
              <button
                onClick={() => setWeekOffset((o) => o - 1)}
                disabled={!hasOlderEntries && weekOffset === 0}
                aria-label={t('cookHistory.prevWeek')}
                className="flex items-center gap-1 text-xs text-[#6B7280] disabled:opacity-30 hover:text-[#1A1A1A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 rounded-lg px-1 py-0.5"
              >
                <ChevronLeft size={14} aria-hidden="true" />
                {t('cookHistory.prevWeek')}
              </button>
              {weekOffset < 0 && (
                <button
                  onClick={() => setWeekOffset((o) => o + 1)}
                  aria-label={t('cookHistory.nextWeek')}
                  className="flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 rounded-lg px-1 py-0.5"
                >
                  {t('cookHistory.nextWeek')}
                  <ChevronLeft size={14} className="rotate-180" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Week strip */}
            <div className="grid grid-cols-7 gap-1 mb-3">
              {stripDays.map(({ key, hasEntry, date }) => {
                const isToday = toLocalDateStr(date.toISOString()) === toLocalDateStr(new Date().toISOString())
                return (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <span className={`text-[10px] font-medium ${isToday ? 'text-[#16A34A]' : 'text-[#9CA3AF]'}`}>
                      {t(`cookHistory.days.${key}`)}
                    </span>
                    <div
                      className={`h-5 w-5 rounded-full border-2 ${
                        hasEntry
                          ? 'bg-[#16A34A] border-[#16A34A]'
                          : 'bg-white border-[#E5E7EB]'
                      } ${isToday && !hasEntry ? 'border-[#16A34A]/40' : ''}`}
                      aria-hidden="true"
                    />
                  </div>
                )
              })}
            </div>

            {/* Count */}
            <p className="text-xs text-[#6B7280] mb-4">
              {t('cookHistory.timesThisWeek', { count: weekEntries.length })}
            </p>

            {/* Divider */}
            <div className="border-t border-[#F0F0EE] mb-4" />

            {/* Log */}
            {grouped.length === 0 ? (
              <p className="text-sm text-[#9CA3AF] text-center py-6">{t('cookHistory.nothingYet')}</p>
            ) : (
              <div className="space-y-4">
                {grouped.map(([dateStr, entries]) => (
                  <div key={dateStr}>
                    <p className="text-xs font-semibold text-[#6B7280] mb-2 capitalize">
                      {formatDateHeading(dateStr)}
                    </p>
                    <div className="space-y-1.5">
                      {entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-xl bg-white border border-[#F0F0EE] px-3 py-2 text-sm text-[#1A1A1A] font-medium"
                        >
                          {entry.recipe_name}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

// ---------- PlanPage ----------

function PlanPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { showToast } = useToast()
  const [confirmClear, setConfirmClear] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const { data: plan, isLoading: isPlanLoading } = useQuery({
    queryKey: ['active-plan'],
    queryFn: fetchActivePlanWithCount,
    staleTime: 5 * 60 * 1000,
  })

  const planId = plan?.id

  const { data: items = [], isLoading: isItemsLoading } = useQuery({
    queryKey: ['plan-items', planId],
    queryFn: () => fetchPlanItems({ data: planId! }),
    enabled: !!planId,
    staleTime: 2 * 60 * 1000,
  })

  // Remove item — optimistic
  const removeMutation = useMutation({
    mutationFn: (id: string) => removePlanItem({ data: id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['plan-items', planId] })
      const prev = qc.getQueryData<PlanItemWithRecipe[]>(['plan-items', planId])
      qc.setQueryData<PlanItemWithRecipe[]>(['plan-items', planId], (old) =>
        old?.filter((i) => i.id !== id) ?? [],
      )
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['plan-items', planId], ctx.prev)
      showToast('Erro ao remover receita', 'error')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['plan-items', planId] })
      qc.invalidateQueries({ queryKey: ['active-plan'] })
    },
  })

  // Update per-item multiplier — optimistic
  const itemMultMutation = useMutation({
    mutationFn: ({ id, mult }: { id: string; mult: number }) =>
      updatePlanItemMultiplier({ data: { planItemId: id, multiplier: mult } }),
    onMutate: async ({ id, mult }) => {
      await qc.cancelQueries({ queryKey: ['plan-items', planId] })
      const prev = qc.getQueryData<PlanItemWithRecipe[]>(['plan-items', planId])
      qc.setQueryData<PlanItemWithRecipe[]>(['plan-items', planId], (old) =>
        old?.map((i) => i.id === id ? { ...i, portion_multiplier: mult } : i) ?? [],
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['plan-items', planId], ctx.prev)
      showToast('Erro ao actualizar multiplicador', 'error')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['plan-items', planId] }),
  })

  // Archive + create new plan
  const clearMutation = useMutation({
    mutationFn: () => archiveAndCreatePlan({ data: planId! }),
    onSuccess: (newPlan) => {
      capture('plan_archived', { itemCount: items.length })
      qc.setQueryData<ActivePlanWithCount>(['active-plan'], {
        ...newPlan,
        item_count: 0,
      })
      qc.setQueryData(['plan-items', newPlan.id], [])
      qc.removeQueries({ queryKey: ['plan-items', planId] })
      setConfirmClear(false)
    },
  })

  if (isPlanLoading || isItemsLoading) return <PlanSkeleton />

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4">
        {/* Header */}
        <div className="py-5 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">{t('plan.title')}</h1>
            <p className="text-xs text-[#9CA3AF] mt-0.5">
              {items.length === 0
                ? t('plan.noItems')
                : t('plan.itemCount', { count: items.length })}
            </p>
          </div>
          <button
            onClick={() => setHistoryOpen(true)}
            aria-label={t('cookHistory.title')}
            className="mt-1 p-2 rounded-xl text-[#6B7280] hover:text-[#1A1A1A] hover:bg-[#F3F4F6] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40"
          >
            <CalendarDays size={20} aria-hidden="true" />
          </button>
        </div>

        <CookHistorySheet open={historyOpen} onOpenChange={setHistoryOpen} />

        {/* Empty state */}
        {items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[#6B7280] text-sm mb-4">{t('plan.empty')}</p>
            <Link
              to="/app/library"
              search={{} as never}
              className="inline-block px-5 py-2.5 rounded-xl bg-[#16A34A] text-white text-sm font-semibold hover:bg-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              {t('plan.addRecipe')}
            </Link>
          </div>
        ) : (
          <>
            {/* Plan items */}
            <div className="space-y-3 mb-4">
              {items.map((item) => (
                <PlanItemCard
                  key={item.id}
                  item={item}
                  onRemove={(id) => removeMutation.mutate(id)}
                  onMultiplierChange={(id, v) => itemMultMutation.mutate({ id, mult: v })}
                  isUpdating={itemMultMutation.isPending}
                />
              ))}
            </div>

            {/* Clear plan */}
            <div className="mb-4">
              {confirmClear ? (
                <div className="rounded-2xl border border-[#fecaca] bg-[#fee2e2]/50 p-4 text-center space-y-3">
                  <p className="text-sm text-[#1A1A1A]">
                    {t('plan.clearConfirm')}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="flex-1 py-2 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={() => clearMutation.mutate()}
                      disabled={clearMutation.isPending}
                      className="flex-1 py-2 rounded-xl bg-[#DC2626] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#b91c1c] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                    >
                      {t('common.confirm')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="w-full py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#9CA3AF] hover:text-[#DC2626] hover:border-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                >
                  {t('plan.clearPlan')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
