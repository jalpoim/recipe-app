import { createServerFn } from '@tanstack/react-start'
import { makeClient } from './client-server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_USER_ID = '9a5a4a71-bcd3-4e64-b734-b258b93e7576'

function makeServiceClient() {
  const url = process.env.VITE_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

async function assertAdmin() {
  const supabase = makeClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || session.user.id !== ADMIN_USER_ID) {
    throw new Error('Forbidden')
  }
}

export type PendingRecipe = {
  id: string
  name: string
  image_url: string | null
  image_thumb_url: string | null
  moderation_status: string | null
  created_at: string
  owner_id: string
  owner_email: string | null
  owner_username: string | null
  approved_image_count: number
}

export const fetchPendingRecipes = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PendingRecipe[]> => {
    await assertAdmin()
    const service = makeServiceClient()

    const { data: recipes, error } = await service
      .from('recipes')
      .select('id, name, image_url, image_thumb_url, moderation_status, created_at, owner_id')
      .eq('moderation_status', 'pending_review')
      .not('owner_id', 'is', null)
      .order('created_at', { ascending: true })

    if (error) throw new Error(error.message)
    if (!recipes?.length) return []

    const ownerIds = [...new Set(recipes.map(r => r.owner_id))]

    // Fetch emails from auth.users
    const { data: { users } } = await service.auth.admin.listUsers({ perPage: 1000 })
    const emailMap = new Map(users.map(u => [u.id, u.email ?? null]))

    // Fetch usernames from profiles
    const { data: profiles } = await service
      .from('profiles')
      .select('user_id, username')
      .in('user_id', ownerIds)
    const usernameMap = new Map((profiles ?? []).map(p => [p.user_id, p.username]))

    // Count approved images per owner
    const { data: approved } = await service
      .from('recipes')
      .select('owner_id')
      .eq('moderation_status', 'approved')
      .in('owner_id', ownerIds)
      .not('image_url', 'is', null)
    const approvedCount = new Map<string, number>()
    for (const r of approved ?? []) {
      approvedCount.set(r.owner_id, (approvedCount.get(r.owner_id) ?? 0) + 1)
    }

    return recipes.map(r => ({
      ...r,
      owner_email: emailMap.get(r.owner_id) ?? null,
      owner_username: usernameMap.get(r.owner_id) ?? null,
      approved_image_count: approvedCount.get(r.owner_id) ?? 0,
    }))
  },
)

export const approveRecipeImage = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await assertAdmin()
    const service = makeServiceClient()
    const { error } = await service
      .from('recipes')
      .update({ moderation_status: 'approved' })
      .eq('id', id)
    if (error) throw new Error(error.message)
  })

export const rejectRecipeImage = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await assertAdmin()
    const service = makeServiceClient()
    const { error } = await service
      .from('recipes')
      .update({ moderation_status: 'rejected', image_url: null, image_thumb_url: null })
      .eq('id', id)
    if (error) throw new Error(error.message)
  })

export const trustUser = createServerFn({ method: 'POST' })
  .inputValidator((userId: string) => userId)
  .handler(async ({ data: userId }) => {
    await assertAdmin()
    const service = makeServiceClient()
    const { error } = await service.auth.admin.updateUserById(userId, {
      app_metadata: { trust_level: 1 },
    })
    if (error) throw new Error(error.message)
  })
