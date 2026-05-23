import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, Minus, Plus, X } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchRecipeById } from '../../../lib/supabase/queries'
import { updateRecipe, fetchUserProteins, createUserProtein, deleteUserProtein, type IngredientRow, type StepRow } from '../../../lib/supabase/recipe-queries'
import { useToast } from '../../../components/Toast'
import { ProteinPicker } from '../../../components/ProteinPicker'
import type { RecipeIngredient, RecipeStep } from '../../../types/db'

export const Route = createFileRoute('/app/library/$recipeId_/edit')({
  loader: async ({ params }) => fetchRecipeById({ data: params.recipeId }),
  component: EditRecipePage,
})

const TAG_SECTIONS_EDIT: { key: string; tags: string[] }[] = [
  { key: 'method',  tags: ['air-fryer', 'forno', 'fogão', 'micro-ondas', 'sem-cozinha', 'uma-frigideira', 'bimby', 'grelhador'] },
  { key: 'cuisine', tags: ['português', 'mediterrâneo', 'italiano', 'francês', 'europeu', 'americano', 'mexicano', 'indiano', 'asiático', 'japonês', 'coreano', 'árabe', 'africano', 'latino-americano'] },
  { key: 'diet',    tags: ['sem-glúten', 'vegetariano', 'vegano', 'sem-lactose', 'alto-proteína', 'low-carb', 'fit'] },
  { key: 'type',    tags: ['pequeno-almoço', 'almoço', 'jantar', 'snack', 'sobremesa', 'sopa', 'pós-treino', 'batido'] },
  { key: 'context', tags: ['meal-prep', 'rápido', 'reconfortante', 'leve', 'económico', 'família', 'festivo', '5-ingredientes', 'semana', 'verão'] },
]

const SYSTEM_TAG_SLUGS = TAG_SECTIONS_EDIT.flatMap((s) => s.tags)

function ingToRow(ing: RecipeIngredient): IngredientRow {
  return {
    position: ing.position,
    rawText: ing.raw_text,
    quantity: ing.quantity,
    unit: ing.unit,
    name: ing.name,
    isOptional: ing.is_optional,
  }
}

function stepToRow(step: RecipeStep): StepRow {
  return { position: step.position, text: step.text, timerSeconds: step.timer_seconds }
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-semibold text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus:outline-none"
      >
        {title}
        {open ? <ChevronUp size={16} className="text-[#9CA3AF]" /> : <ChevronDown size={16} className="text-[#9CA3AF]" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-[#F3F4F6]">{children}</div>}
    </div>
  )
}

function EditRecipePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const recipe = Route.useLoaderData()
  const lang = i18n.language.startsWith('en') ? 'en' : 'pt'

  const [name, setName] = useState(recipe.name)
  const [servings, setServings] = useState(recipe.servings)
  const [timeMin, setTimeMin] = useState(recipe.time_min?.toString() ?? '')
  const [selectedProteins, setSelectedProteins] = useState<string[]>(recipe.proteins)
  const [ingredients, setIngredients] = useState<IngredientRow[]>(recipe.recipe_ingredients.map(ingToRow))
  const [steps, setSteps] = useState<StepRow[]>(recipe.recipe_steps.map(stepToRow))
  const [selectedTags, setSelectedTags] = useState<string[]>(recipe.tags)
  const [customTagInput, setCustomTagInput] = useState('')
  const [calories, setCalories] = useState(recipe.calories?.toString() ?? '')
  const [protein, setProtein] = useState(recipe.protein?.toString() ?? '')
  const [carbs, setCarbs] = useState(recipe.carbs?.toString() ?? '')
  const [fat, setFat] = useState(recipe.fat?.toString() ?? '')
  const [publish, setPublish] = useState(recipe.visibility === 'public')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { data: userProteins = [], refetch: refetchUserProteins } = useQuery({
    queryKey: ['user-proteins'],
    queryFn: () => fetchUserProteins(),
    staleTime: 5 * 60 * 1000,
  })

  const addCustomProteinMutation = useMutation({
    mutationFn: (displayName: string) => createUserProtein({ data: { displayName, language: lang } }),
    onSuccess: (p) => { refetchUserProteins(); setSelectedProteins((prev) => [...prev, p.slug]) },
  })

  const deleteCustomProteinMutation = useMutation({
    mutationFn: (id: string) => deleteUserProtein({ data: id }),
    onSuccess: () => refetchUserProteins(),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      updateRecipe({
        data: {
          recipeId: recipe.id,
          name: name.trim(),
          servings,
          timeMin: timeMin ? parseInt(timeMin, 10) : null,
          proteins: selectedProteins,
          tags: selectedTags,
          calories: calories ? parseFloat(calories) : null,
          protein: protein ? parseFloat(protein) : null,
          carbs: carbs ? parseFloat(carbs) : null,
          fat: fat ? parseFloat(fat) : null,
          visibility: publish ? 'public' : 'private',
          ingredients: ingredients.filter((i) => i.rawText.trim()).map((ing, idx) => ({ ...ing, position: idx })),
          steps: steps.filter((s) => s.text.trim()).map((s, idx) => ({ ...s, position: idx })),
          lang,
        },
      }),
    onSuccess: () => {
      navigate({ to: '/app/library/$recipeId', params: { recipeId: recipe.id }, search: { from: undefined, planItemId: undefined } })
    },
    onError: () => showToast(t('common.error'), 'error'),
  })

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = t('create.validationName')
    if (!ingredients.some((i) => i.rawText.trim())) errs.ingredients = t('create.validationIngredients')
    if (!steps.some((s) => s.text.trim())) errs.steps = t('create.validationSteps')
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function addIngredient() {
    setIngredients((prev) => [...prev, { position: prev.length, rawText: '', quantity: null, unit: null, name: null, isOptional: false }])
  }
  function updateIngredient(index: number, updated: IngredientRow) {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? updated : ing)))
  }
  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  }
  function addStep() {
    setSteps((prev) => [...prev, { position: prev.length, text: '', timerSeconds: null }])
  }
  function updateStep(index: number, text: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, text } : s)))
  }
  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }
  function toggleTag(tag: string) {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }
  function addCustomTag() {
    const slug = customTagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (!slug || selectedTags.includes(slug)) return
    setSelectedTags((prev) => [...prev, slug])
    setCustomTagInput('')
  }

  const chipBase = 'text-xs px-3 py-1.5 rounded-full border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none'
  const chipActive = 'bg-[#dcfce7] border-[#16A34A] text-[#15803d]'
  const chipInactive = 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#16A34A]'

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="sticky top-0 z-10 bg-[#FAFAF8] border-b border-[#F0F0EE]">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: '/app/library/$recipeId', params: { recipeId: recipe.id }, search: { from: undefined, planItemId: undefined } })}
            aria-label={t('recipe.back')}
            className="flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t('recipe.back')}
          </button>
          <h1 className="text-base font-semibold text-[#1A1A1A]">{t('create.editTitle')}</h1>
          <button
            type="button"
            onClick={() => { if (validate()) saveMutation.mutate() }}
            disabled={saveMutation.isPending}
            className="text-sm font-semibold text-[#16A34A] disabled:opacity-50 hover:text-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
          >
            {saveMutation.isPending ? t('create.saving') : t('create.save')}
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-5 space-y-4">
        {/* Name */}
        <div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('create.namePlaceholder')}
            className={`w-full rounded-xl border bg-white px-4 py-3 text-[16px] font-semibold text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors ${errors.name ? 'border-[#DC2626]' : 'border-[#E5E7EB]'}`}
          />
          {errors.name && <p className="mt-1 text-xs text-[#DC2626]">{errors.name}</p>}
        </div>

        {/* Servings */}
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#1A1A1A]">{t('create.servingsLabel')}</span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setServings((s) => Math.max(1, s - 1))} disabled={servings <= 1}
                className="w-9 h-9 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#1A1A1A] disabled:opacity-30 hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none">
                <Minus size={16} aria-hidden="true" />
              </button>
              <span className="w-6 text-center font-bold text-[#1A1A1A]">{servings}</span>
              <button type="button" onClick={() => setServings((s) => s + 1)}
                className="w-9 h-9 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#1A1A1A] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none">
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* Proteins */}
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4">
          <p className="text-sm font-semibold text-[#1A1A1A] mb-3">{t('create.proteinsLabel')}</p>
          <ProteinPicker
            selected={selectedProteins}
            onToggle={(slug) => setSelectedProteins((prev) => prev.includes(slug) ? prev.filter((p) => p !== slug) : [...prev, slug])}
            userProteins={userProteins}
            onAddCustom={(displayName) => addCustomProteinMutation.mutate(displayName)}
            onDeleteUserProtein={(id) => deleteCustomProteinMutation.mutate(id)}
          />
        </div>

        {/* Ingredients */}
        <div className={`rounded-2xl bg-white border shadow-sm p-4 space-y-3 ${errors.ingredients ? 'border-[#DC2626]' : 'border-[#E5E7EB]'}`}>
          <p className="text-sm font-semibold text-[#1A1A1A]">{t('create.ingredientsLabel')}</p>
          {ingredients.map((ing, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="shrink-0 w-5 text-xs text-[#9CA3AF] text-right">{idx + 1}.</span>
              <input
                type="text"
                value={ing.rawText}
                onChange={(e) => updateIngredient(idx, { ...ing, rawText: e.target.value, name: null })}
                placeholder={t('create.ingredientPlaceholder')}
                className="flex-1 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors"
              />
              <button type="button" onClick={() => removeIngredient(idx)} aria-label="Remover"
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#fee2e2] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" onClick={addIngredient}
            className="w-full rounded-xl border border-dashed border-[#D1D5DB] text-sm text-[#16A34A] py-2.5 hover:border-[#16A34A] hover:bg-[#f0fdf4] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none">
            + {t('create.addIngredient')}
          </button>
          {errors.ingredients && <p className="text-xs text-[#DC2626]">{errors.ingredients}</p>}
        </div>

        {/* Steps */}
        <div className={`rounded-2xl bg-white border shadow-sm p-4 space-y-3 ${errors.steps ? 'border-[#DC2626]' : 'border-[#E5E7EB]'}`}>
          <p className="text-sm font-semibold text-[#1A1A1A]">{t('create.stepsLabel')}</p>
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-[#dcfce7] text-[#15803d] text-xs font-bold flex items-center justify-center mt-2.5">{idx + 1}</span>
              <textarea
                value={step.text}
                onChange={(e) => updateStep(idx, e.target.value)}
                placeholder={t('create.stepPlaceholder')}
                rows={2}
                className="flex-1 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors"
              />
              {steps.length > 1 && (
                <button type="button" onClick={() => removeStep(idx)} aria-label="Remover passo"
                  className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#fee2e2] transition-colors mt-1.5 focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none">
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addStep}
            className="w-full rounded-xl border border-dashed border-[#D1D5DB] text-sm text-[#16A34A] py-2.5 hover:border-[#16A34A] hover:bg-[#f0fdf4] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none">
            + {t('create.addStep')}
          </button>
          {errors.steps && <p className="text-xs text-[#DC2626]">{errors.steps}</p>}
        </div>

        {/* Time */}
        <CollapsibleSection title={t('create.timeLabel')} defaultOpen={!!recipe.time_min}>
          <input
            type="number" min={1} value={timeMin} onChange={(e) => setTimeMin(e.target.value)} placeholder="30"
            className="w-full rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[16px] text-[#1A1A1A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors"
          />
        </CollapsibleSection>

        {/* Tags */}
        <CollapsibleSection title={t('create.tagsLabel')} defaultOpen={recipe.tags.length > 0}>
          <div className="space-y-4">
            {TAG_SECTIONS_EDIT.map(({ key, tags: sectionTags }) => (
              <div key={key}>
                <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">{t(`tagSections.${key}`)}</p>
                <div className="flex flex-wrap gap-2">
                  {sectionTags.map((tag) => (
                    <button key={tag} type="button" onClick={() => toggleTag(tag)} aria-pressed={selectedTags.includes(tag)}
                      className={`${chipBase} ${selectedTags.includes(tag) ? chipActive : chipInactive}`}>
                      {t(`tags.${tag}`, { defaultValue: tag })}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {/* Custom tags */}
            {selectedTags.filter((tag) => !SYSTEM_TAG_SLUGS.includes(tag)).length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                  {t('create.customTagsSection', 'Os meus tags')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedTags.filter((tag) => !SYSTEM_TAG_SLUGS.includes(tag)).map((tag) => (
                    <span key={tag} className={`${chipBase} ${chipActive} flex items-center gap-1`}>
                      {tag}
                      <button
                        type="button"
                        onClick={() => setSelectedTags((prev) => prev.filter((t) => t !== tag))}
                        aria-label={`Remover tag ${tag}`}
                        className="focus:outline-none"
                      >
                        <X size={10} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag() } }}
                placeholder={t('create.addCustomTag', 'Adicionar tag…')}
                className="flex-1 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors"
              />
              <button
                type="button"
                onClick={addCustomTag}
                disabled={!customTagInput.trim()}
                className="w-9 h-9 rounded-xl border border-[#E5E7EB] bg-white flex items-center justify-center text-[#16A34A] hover:bg-[#f0fdf4] disabled:opacity-40 transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none shrink-0"
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </CollapsibleSection>

        {/* Macros */}
        <CollapsibleSection title={t('create.macrosLabel')} defaultOpen={recipe.calories != null}>
          <div className="grid grid-cols-2 gap-3">
            {([
              { label: t('create.caloriesLabel'), value: calories, setter: setCalories },
              { label: t('create.proteinLabel'), value: protein, setter: setProtein },
              { label: t('create.carbsLabel'), value: carbs, setter: setCarbs },
              { label: t('create.fatLabel'), value: fat, setter: setFat },
            ]).map(({ label, value, setter }) => (
              <div key={label}>
                <label className="block text-xs text-[#6B7280] mb-1">{label}</label>
                <input type="number" min={0} value={value} onChange={(e) => setter(e.target.value)}
                  className="w-full rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[16px] text-[#1A1A1A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:border-[#16A34A] transition-colors" />
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* Publish */}
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-4">
              <p className="text-sm font-semibold text-[#1A1A1A]">{t('create.publishLabel')}</p>
              <p className="text-xs text-[#9CA3AF] mt-0.5">{t('create.publishHint')}</p>
            </div>
            <button
              type="button" role="switch" aria-checked={publish} onClick={() => setPublish((p) => !p)}
              className={`relative w-11 h-6 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none ${publish ? 'bg-[#16A34A]' : 'bg-[#D1D5DB]'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${publish ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => { if (validate()) saveMutation.mutate() }}
          disabled={saveMutation.isPending}
          className="w-full rounded-2xl bg-[#16A34A] text-white py-4 text-sm font-semibold disabled:opacity-60 hover:bg-[#15803d] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none"
        >
          {saveMutation.isPending ? t('create.saving') : t('create.save')}
        </button>
      </div>
    </div>
  )
}
