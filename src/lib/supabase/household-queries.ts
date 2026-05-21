import { createServerFn } from '@tanstack/react-start'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../types/db'
import type { HouseholdInfo } from '../../types/db'
import { getCookies, setCookie } from '@tanstack/react-start/server'

function makeAuthClient() {
  return createServerClient<Database>(
    (import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string,
    (import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY) as string,
    {
      cookies: {
        getAll() {
          const cookies = getCookies()
          return Object.entries(cookies).map(([name, value]) => ({ name, value }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            setCookie(name, value, options as Parameters<typeof setCookie>[2])
          )
        },
      },
    },
  )
}

// Untyped service client — bypasses RLS; auth is verified manually via getUser().
// We intentionally omit the <Database> generic because the legacy tables in db.ts lack
// the Relationships key required by @supabase/supabase-js's stricter constraints,
// which collapses from() calls to never when the generic is applied in this file.
function makeServiceClient() {
  const url = (import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string
  return createClient(url, key)
}

async function getAuthedUser() {
  const auth = makeAuthClient()
  const { data: { user } } = await auth.auth.getUser()
  return user
}

// POST: create a new household for the current user
export const createHousehold = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await getAuthedUser()
  if (!user) throw new Error('Not authenticated')
  const db = makeServiceClient()

  const emailPrefix = user.email?.split('@')[0] ?? 'User'
  const { data: household, error: hhError } = await db
    .from('households')
    .insert({ name: emailPrefix })
    .select()
    .single()
  if (hhError || !household) throw new Error(hhError?.message ?? 'Failed to create household')

  await db
    .from('household_members')
    .insert({ household_id: household.id, user_id: user.id, role: 'owner' })

  await db
    .from('recipes')
    .update({ visibility: 'household' })
    .eq('owner_id', user.id)
    .eq('visibility', 'private')

  await db
    .from('plans')
    .update({ household_id: household.id })
    .eq('owner_id', user.id)
    .is('archived_at', null)

  return household as { id: string; name: string; created_at: string }
})

// POST: generate a new invite token for the caller's household
export const generateInviteToken = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await getAuthedUser()
  if (!user) throw new Error('Not authenticated')
  const db = makeServiceClient()

  const { data: membership } = await db
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) throw new Error('Not in a household')

  const { data, error } = await db
    .from('household_invites')
    .insert({ household_id: membership.household_id, created_by: user.id })
    .select('token')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Failed to generate token')
  return data.token as string
})

// POST: revoke an invite token
export const revokeInviteToken = createServerFn({ method: 'POST' })
  .inputValidator((token: string) => token)
  .handler(async ({ data: token }) => {
    const user = await getAuthedUser()
    if (!user) throw new Error('Not authenticated')
    const db = makeServiceClient()

    await db
      .from('household_invites')
      .delete()
      .eq('token', token)
      .eq('created_by', user.id)

    return { ok: true }
  })

// GET: fetch invite info without auth (for the /join page)
export const fetchInviteInfo = createServerFn({ method: 'GET' })
  .inputValidator((token: string) => token)
  .handler(async ({ data: token }): Promise<{ inviterName: string; householdName: string } | null> => {
    const db = makeServiceClient()

    const { data: invite } = await db
      .from('household_invites')
      .select('created_by, household_id, used_at')
      .eq('token', token)
      .is('used_at', null)
      .maybeSingle()
    if (!invite || !invite.created_by || !invite.household_id) return null

    const { data: userData } = await db.auth.admin.getUserById(invite.created_by)
    const inviterEmail = userData?.user?.email ?? ''
    const inviterName = inviterEmail.split('@')[0] ?? 'Someone'

    const { data: household } = await db
      .from('households')
      .select('name')
      .eq('id', invite.household_id)
      .single()
    const householdName = (household as { name: string } | null)?.name ?? 'Meal Prep'

    return { inviterName, householdName }
  })

// POST: accept an invite token
export const acceptInvite = createServerFn({ method: 'POST' })
  .inputValidator((token: string) => token)
  .handler(async ({ data: token }) => {
    const user = await getAuthedUser()
    if (!user) throw new Error('Not authenticated')
    const db = makeServiceClient()

    const { data: invite } = await db
      .from('household_invites')
      .select('id, household_id, created_by, used_at')
      .eq('token', token)
      .is('used_at', null)
      .maybeSingle()
    if (!invite || !invite.household_id) throw new Error('Invalid or already used invite')

    const { count } = await db
      .from('household_members')
      .select('*', { count: 'exact', head: true })
      .eq('household_id', invite.household_id)
    if ((count ?? 0) >= 2) throw new Error('Household is full')

    // Archive joiner's active personal plan
    await db
      .from('plans')
      .update({ archived_at: new Date().toISOString() })
      .eq('owner_id', user.id)
      .is('archived_at', null)
      .is('household_id', null)

    await db
      .from('household_members')
      .insert({ household_id: invite.household_id, user_id: user.id, role: 'member' })

    await db
      .from('household_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invite.id)

    const inviterData = invite.created_by
      ? await db.auth.admin.getUserById(invite.created_by)
      : null
    const inviterPrefix = (inviterData?.data?.user?.email ?? '').split('@')[0] ?? 'User'
    const joinerPrefix = (user.email ?? '').split('@')[0] ?? 'User'

    await db
      .from('households')
      .update({ name: `${inviterPrefix} & ${joinerPrefix}` })
      .eq('id', invite.household_id)

    const { data: household } = await db
      .from('households')
      .select('*')
      .eq('id', invite.household_id)
      .single()

    return household as { id: string; name: string; created_at: string } | null
  })

// GET: fetch household info for the current user
export const fetchHouseholdInfo = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HouseholdInfo | null> => {
    const user = await getAuthedUser()
    if (!user) return null
    const db = makeServiceClient()

    const { data: membership } = await db
      .from('household_members')
      .select('household_id, role')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return null

    const { data: household } = await db
      .from('households')
      .select('id, name')
      .eq('id', membership.household_id)
      .single()
    if (!household) return null

    const { data: members } = await db
      .from('household_members')
      .select('user_id, role')
      .eq('household_id', membership.household_id)
    const memberRows = (members ?? []) as { user_id: string; role: string | null }[]

    const membersWithEmail = await Promise.all(
      memberRows.map(async (m) => {
        const { data } = await db.auth.admin.getUserById(m.user_id)
        return {
          userId: m.user_id,
          email: data?.user?.email ?? m.user_id,
          role: (m.role ?? 'member') as 'owner' | 'member',
        }
      })
    )

    const { data: invite } = await db
      .from('household_invites')
      .select('token')
      .eq('household_id', membership.household_id)
      .eq('created_by', user.id)
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return {
      household: household as { id: string; name: string },
      members: membersWithEmail,
      inviteToken: (invite as { token: string } | null)?.token ?? null,
    }
  }
)

// POST: leave the household
export const leaveHousehold = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await getAuthedUser()
  if (!user) throw new Error('Not authenticated')
  const db = makeServiceClient()

  const { data: membership } = await db
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) throw new Error('Not in a household')

  const householdId = membership.household_id

  await db
    .from('plans')
    .update({ archived_at: new Date().toISOString() })
    .eq('household_id', householdId)
    .is('archived_at', null)

  await db
    .from('household_members')
    .delete()
    .eq('household_id', householdId)
    .eq('user_id', user.id)

  await db
    .from('recipes')
    .update({ visibility: 'private' })
    .eq('owner_id', user.id)
    .eq('visibility', 'household')

  await db
    .from('plans')
    .insert({ owner_id: user.id, name: 'Current plan', default_multiplier: 1 })

  const { data: remaining } = await db
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)

  for (const other of (remaining ?? []) as { user_id: string }[]) {
    await db
      .from('plans')
      .insert({ owner_id: other.user_id, name: 'Current plan', default_multiplier: 1 })
    await db
      .from('recipes')
      .update({ visibility: 'private' })
      .eq('owner_id', other.user_id)
      .eq('visibility', 'household')
    await db
      .from('household_members')
      .delete()
      .eq('household_id', householdId)
      .eq('user_id', other.user_id)
  }

  return { ok: true }
})
