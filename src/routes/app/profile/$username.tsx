import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Clock, Heart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { fetchProfileByUsername } from '../../../lib/supabase/profile-queries'
import { fetchLibrary } from '../../../lib/supabase/queries'
import type { RecipeWithIngredients } from '../../../lib/supabase/queries'
import type { Recipe } from '../../../types/db'

export const Route = createFileRoute('/app/profile/$username')({
  loader: async ({ params }) => {
    const profile = await fetchProfileByUsername({ data: params.username })
    if (!profile) return { profile: null, recipes: [] }

    // Fetch public approved recipes by this user
    const result = await fetchLibrary({
      data: {
        limit: 50,
        cursor: null,
        sort: 'popular',
        modes: [],
        proteins: [],
        maxCal: undefined,
        maxTime: undefined,
        tags: [],
        ingredients: [],
        q: '',
      },
    })
    // Filter to this user's public approved recipes
    const recipes = result.data.filter(
      (r) => r.owner_id === profile.user_id && r.visibility === 'public' && r.moderation_status === 'approved'
    )
    return { profile, recipes }
  },
  component: ProfilePage,
})

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

function ProfileRecipeCard({ recipe }: { recipe: RecipeWithIngredients }) {
  const ratio = pcalRatio(recipe)
  const hasMacros = recipe.calories != null

  return (
    <Link
      to="/app/library/$recipeId"
      params={{ recipeId: recipe.id }}
      search={{ from: undefined, planItemId: undefined }}
      className="block rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 active:scale-[0.98] hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-3">
        {recipe.image_thumb_url ? (
          <img
            src={recipe.image_thumb_url}
            alt=""
            className="w-[60px] h-[60px] rounded-xl object-cover shrink-0"
            loading="lazy"
          />
        ) : (
          <div
            className="w-[60px] h-[60px] rounded-xl shrink-0"
            style={{ background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)' }}
            aria-hidden="true"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#1A1A1A] leading-snug line-clamp-2 flex-1">{recipe.name}</h3>
            {hasMacros && (
              <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badgeClass(ratio)}`}>
                P/Cal {ratio.toFixed(1)}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-[#9CA3AF]">
            {recipe.time_min != null && (
              <span className="flex items-center gap-0.5">
                <Clock size={10} aria-hidden="true" />
                {recipe.time_min} min
              </span>
            )}
            {(recipe.like_count ?? 0) > 0 && (
              <span className="flex items-center gap-0.5">
                <Heart size={10} aria-hidden="true" />
                {recipe.like_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

function ProfilePage() {
  const { t } = useTranslation()
  const { profile, recipes } = Route.useLoaderData()

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <p className="text-[#1A1A1A] font-semibold">Perfil não encontrado</p>
          <Link to="/app/library" search={{ q: '', proteins: [], maxCal: undefined, maxTime: undefined, tags: [], ingredients: [], sort: 'pcal' as const, modes: [], category: undefined, categorySort: 'popular' as const }} className="text-sm text-[#16A34A] underline">
            {t('recipe.back')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#FAFAF8] border-b border-[#F0F0EE]">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            to="/app/library"
            search={{ q: '', proteins: [], maxCal: undefined, maxTime: undefined, tags: [], ingredients: [], sort: 'pcal' as const, modes: [], category: undefined, categorySort: 'popular' as const }}
            aria-label={t('recipe.back')}
            className="flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus-visible:ring-2 focus-visible:ring-[#16A34A]/40 focus:outline-none rounded"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t('recipe.back')}
          </Link>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-6">
        {/* Profile header */}
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.display_name}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #16A34A, #15803d)' }}
              aria-hidden="true"
            >
              {profile.display_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">{profile.display_name}</h1>
            <p className="text-sm text-[#9CA3AF]">@{profile.username}</p>
            {profile.bio && (
              <p className="text-sm text-[#6B7280] mt-1">{profile.bio}</p>
            )}
          </div>
        </div>

        {/* Recipes */}
        <div>
          <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide mb-3">
            {t('profile.recipes')} · {recipes.length}
          </h2>
          {recipes.length === 0 ? (
            <p className="text-sm text-[#9CA3AF]">{t('profile.noRecipes')}</p>
          ) : (
            <div className="space-y-3">
              {recipes.map((recipe) => (
                <ProfileRecipeCard key={recipe.id} recipe={recipe} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
