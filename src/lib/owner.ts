// During early access, AI-triggering features (recipe macro estimation, AI ingredient
// linking) are limited to the owner account to avoid runaway AI cost / abuse by early
// users. Gate both server-side (authoritative — blocks the API call) and client-side
// (hides the affordance). Revisit when opening AI features to all users.
export const OWNER_USER_ID = "dd8ec600-bc81-4657-a0d3-23eb00524b23";

export function isOwnerId(userId: string | null | undefined): boolean {
  return userId === OWNER_USER_ID;
}
