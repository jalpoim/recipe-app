import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Clock, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  ensureActivePlan,
  fetchPlanItems,
  fetchActivePlanWithCount,
  removePlanItem,
  updatePlanMultiplier,
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
  pendingComponent: PlanSkeleton,
  errorComponent: ({ error }) => <PlanError error={error as Error} />,
  loader: async () => {
    const plan = await ensureActivePlan()
    const items = await fetchPlanItems({ data: plan.id })
    return { plan, items }
  },
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
  defaultMult,
  onRemove,
}: {
  item: PlanItemWithRecipe
  defaultMult: number
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const scale = item.portion_multiplier * defaultMult
  const cal = Math.round(perServing(item.recipe, 'calories') * scale)
  const pro = Math.round(perServing(item.recipe, 'protein') * scale)
  const carbs = Math.round(perServing(item.recipe, 'carbs') * scale)
  const fat = Math.round(perServing(item.recipe, 'fat') * scale)

  return (
    <div className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 relative">
      <button
        onClick={() => onRemove(item.id)}
        aria-label={`Remover ${item.recipe.name} do plano`}
        className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#fee2e2] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
      >
        <X size={14} aria-hidden="true" />
      </button>

      <Link
        to="/app/library/$recipeId"
        params={{ recipeId: item.recipe_id }}
        search={{ from: 'plan', planItemId: item.id }}
        className="block pr-8 group"
      >
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
      </Link>

      <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
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

// ---------- MultiplierControl ----------

function MultiplierControl({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white border border-[#E5E7EB] shadow-sm px-4 py-3">
      <span className="text-sm font-medium text-[#1A1A1A]">Multiplicador</span>
      <div className="flex rounded-xl border border-[#E5E7EB] overflow-hidden">
        {([1, 2, 3, 4] as const).map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className={`w-10 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none focus:z-10 relative ${
              value === n
                ? 'bg-[#16A34A] text-white'
                : 'bg-white text-[#6B7280] hover:bg-[#F3F4F6]'
            }`}
          >
            {n}×
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- PlanPage ----------

function PlanPage() {
  const { plan: loaderPlan, items: loaderItems } = Route.useLoaderData()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [confirmClear, setConfirmClear] = useState(false)

  const { data: plan } = useQuery({
    queryKey: ['active-plan'],
    queryFn: fetchActivePlanWithCount,
    initialData: { ...loaderPlan, item_count: loaderItems.length } as ActivePlanWithCount,
  })

  const planId = plan?.id ?? loaderPlan.id
  const defaultMult = plan?.default_multiplier ?? 1

  const { data: items = [] } = useQuery({
    queryKey: ['plan-items', planId],
    queryFn: () => fetchPlanItems({ data: planId }),
    initialData: planId === loaderPlan.id ? loaderItems : undefined,
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
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['plan-items', planId] })
      qc.invalidateQueries({ queryKey: ['active-plan'] })
    },
  })

  // Update multiplier — optimistic
  const multiplierMutation = useMutation({
    mutationFn: (multiplier: number) =>
      updatePlanMultiplier({ data: { planId, multiplier } }),
    onMutate: (multiplier) => {
      const prev = qc.getQueryData<ActivePlanWithCount>(['active-plan'])
      qc.setQueryData<ActivePlanWithCount>(['active-plan'], (old) =>
        old ? { ...old, default_multiplier: multiplier } : old!,
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['active-plan'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['active-plan'] }),
  })

  // Archive + create new plan
  const clearMutation = useMutation({
    mutationFn: () => archiveAndCreatePlan({ data: planId }),
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

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4">
        {/* Header */}
        <div className="py-5">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Meu plano</h1>
          <p className="text-xs text-[#9CA3AF] mt-0.5">
            {items.length === 0
              ? 'Nenhuma receita adicionada'
              : `${items.length} receita${items.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {/* Multiplier */}
        <div className="mb-4">
          <MultiplierControl
            value={defaultMult}
            onChange={(v) => multiplierMutation.mutate(v)}
          />
        </div>

        {/* Empty state */}
        {items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[#6B7280] text-sm mb-4">O teu plano está vazio</p>
            <Link
              to="/app/library"
              className="inline-block px-5 py-2.5 rounded-xl bg-[#16A34A] text-white text-sm font-semibold hover:bg-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
            >
              Adicionar receita
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
                  defaultMult={defaultMult}
                  onRemove={(id) => removeMutation.mutate(id)}
                />
              ))}
            </div>

            {/* Clear plan */}
            <div className="mb-4">
              {confirmClear ? (
                <div className="rounded-2xl border border-[#fecaca] bg-[#fee2e2]/50 p-4 text-center space-y-3">
                  <p className="text-sm text-[#1A1A1A]">
                    Tens a certeza? O plano atual será arquivado.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="flex-1 py-2 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => clearMutation.mutate()}
                      disabled={clearMutation.isPending}
                      className="flex-1 py-2 rounded-xl bg-[#DC2626] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#b91c1c] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="w-full py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#9CA3AF] hover:text-[#DC2626] hover:border-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                >
                  Limpar plano
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
