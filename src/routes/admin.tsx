import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ShieldOff, Star } from 'lucide-react'
import {
  fetchPendingRecipes,
  approveRecipeImage,
  rejectRecipeImage,
  trustUser,
  type PendingRecipe,
} from '../lib/supabase/admin-queries'
import { getAuthUser } from '../lib/supabase/server'

const ADMIN_USER_IDS = new Set([
  '9a5a4a71-bcd3-4e64-b734-b258b93e7576', // joao.chaves.g@hotmail.com
  'dd8ec600-bc81-4657-a0d3-23eb00524b23',  // jchavesalp@gmail.com
])
const TRUST_AFTER_N = 5

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const user = await getAuthUser()
    if (!user || !ADMIN_USER_IDS.has(user.id)) throw redirect({ to: '/app/library', search: {} as never })
  },
  component: AdminPage,
})

function RecipeCard({ recipe, onApprove, onReject, onTrust, approving, rejecting, trusting }: {
  recipe: PendingRecipe
  onApprove: () => void
  onReject: () => void
  onTrust: () => void
  approving: boolean
  rejecting: boolean
  trusting: boolean
}) {
  const canTrust = recipe.approved_image_count + 1 >= TRUST_AFTER_N

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
      {recipe.image_url ? (
        <img
          src={recipe.image_url}
          alt={recipe.name}
          className="w-full aspect-[4/3] object-cover"
        />
      ) : (
        <div className="w-full aspect-[4/3] bg-[#F3F4F6] flex items-center justify-center text-sm text-[#9CA3AF]">
          No image
        </div>
      )}
      <div className="px-4 py-3 space-y-2">
        <p className="font-semibold text-[#1A1A1A] truncate">{recipe.name}</p>
        <p className="text-xs text-[#6B7280]">
          {recipe.owner_username ?? recipe.owner_email ?? recipe.owner_id}
        </p>
        <p className="text-xs text-[#9CA3AF]">
          {recipe.approved_image_count} approved so far ·{' '}
          {new Date(recipe.created_at).toLocaleDateString('pt-PT')}
        </p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onApprove}
            disabled={approving || rejecting}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#16A34A] text-white text-sm font-medium active:opacity-80 disabled:opacity-50 transition-opacity"
          >
            <CheckCircle2 size={14} />
            {approving ? 'Approving…' : 'Approve'}
          </button>
          <button
            onClick={onReject}
            disabled={approving || rejecting}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#fee2e2] text-[#DC2626] text-sm font-medium active:opacity-80 disabled:opacity-50 transition-opacity"
          >
            <ShieldOff size={14} />
            {rejecting ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
        {canTrust && (
          <button
            onClick={onTrust}
            disabled={trusting}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#fef3c7] text-[#B45309] text-sm font-medium active:opacity-80 disabled:opacity-50 transition-opacity"
          >
            <Star size={14} />
            {trusting ? 'Trusting…' : `Trust this user (${recipe.approved_image_count + 1}/${TRUST_AFTER_N} approved)`}
          </button>
        )}
      </div>
    </div>
  )
}

function AdminPage() {
  const qc = useQueryClient()

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['admin-pending'],
    queryFn: () => fetchPendingRecipes(),
    staleTime: 0,
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveRecipeImage({ data: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-pending'] }),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectRecipeImage({ data: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-pending'] }),
  })

  const trustMutation = useMutation({
    mutationFn: (userId: string) => trustUser({ data: userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-pending'] }),
  })

  return (
    <div className="min-h-screen bg-[#FAFAF8] px-4 py-6">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-[#1A1A1A] mb-1">Image moderation</h1>
        <p className="text-sm text-[#6B7280] mb-6">
          {isLoading ? 'Loading…' : `${pending.length} pending`}
        </p>

        {!isLoading && pending.length === 0 && (
          <div className="text-center py-16 text-[#9CA3AF]">
            All clear — nothing to review.
          </div>
        )}

        <div className="space-y-4">
          {pending.map(recipe => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onApprove={() => approveMutation.mutate(recipe.id)}
              onReject={() => rejectMutation.mutate(recipe.id)}
              onTrust={() => trustMutation.mutate(recipe.owner_id)}
              approving={approveMutation.isPending && approveMutation.variables === recipe.id}
              rejecting={rejectMutation.isPending && rejectMutation.variables === recipe.id}
              trusting={trustMutation.isPending && trustMutation.variables === recipe.owner_id}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
