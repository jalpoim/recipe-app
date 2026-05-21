import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Clock, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import {
  fetchPlanItems,
  fetchActivePlanWithCount,
  removePlanItem,
  updatePlanItemMultiplier,
  archiveAndCreatePlan,
} from '../../lib/supabase/plan-queries'
import type { PlanItemWithRecipe, ActivePlanWithCount, Recipe } from '../../types/db'

function PlanSkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4 py-5 space-y-3">
        <div className="h-6 w-28 bg-[#F3F4F6] rounded-full animate-pulse mb-4" />
        <div className="h-14 bg-[#F3F4F6] rounded-2xl animate-pulse" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 animate-pulse">
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
}: {
  item: PlanItemWithRecipe
  onRemove: (id: string) => void
  onMultiplierChange: (id: string, v: number) => void
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
        search={{ from: 'plan', planItemId: item.id, replacing: undefined }}
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
          <h3 className="text-[#1A1A1A] font-semibold text-sm leading-snug group-hover:text-[#16A34A] transition-colors">
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
              {item.recipe.time_min} min
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
              className={`w-9 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none focus:z-10 relative ${
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

// ---------- PlanPage ----------

function PlanPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { showToast } = useToast()
  const [confirmClear, setConfirmClear] = useState(false)

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
        <div className="py-5">
          <h1 className="text-xl font-bold text-[#1A1A1A]">{t('plan.title')}</h1>
          <p className="text-xs text-[#9CA3AF] mt-0.5">
            {items.length === 0
              ? t('plan.noItems')
              : t('plan.itemCount', { count: items.length })}
          </p>
        </div>

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
