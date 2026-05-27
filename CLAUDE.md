# Skills
@.claude/skills/supabase/SKILL.md
@.claude/skills/supabase-postgres-best-practices/SKILL.md
@.claude/skills/web-design-guidelines/SKILL.md

# Project: Meal Prep App

This is a meal prep planning web app built around a protein-first paradigm. The user picks a protein, then sees recipes for that protein, then builds a weekly plan.

## Reference documents
- `docs/plan.md` — full v1 product plan, scope, data model decisions
- `docs/implementation-plan.md` — session-by-session build sequence

**Always consult these before making architectural or product decisions.** The plan is the source of truth; do not deviate from it without asking.

## Stack
- TanStack Start (React + TypeScript) — scaffolded, do NOT re-run create
- Tailwind CSS v4 — installed
- Supabase (`@supabase/supabase-js` + `@supabase/ssr`) — installed, code wired, credentials are placeholders until user adds real ones
- TanStack Query (`@tanstack/react-query`) — installed
- pnpm as package manager

## Working agreement
- Verify each session's checks pass before starting the next
- If something fails verification, stop and write the failure to `FAILURE.md`
- Never run destructive commands

## Architectural decisions (locked)
- **Recipe visibility model:** Cookbook/personal recipes → `visibility = 'private'`, `owner_id = user UUID`. Only original recipes created for public launch → `visibility = 'system'`, `owner_id = null`. Never seed cookbook recipes as system.
- **Accounts:** Households are fully implemented. Up to 2 members per household share a plan. Invite flow: owner generates a token → `/join/$token` page → `acceptInvite` server fn → `household_id` written to JWT `app_metadata`. Leave flow dissolves the household and creates fresh personal plans for both members. `household-queries.ts` contains all server functions.
- **Mobile-first UX:** One-handed operation for shopping and cooking flows. Shopping list and cooking companion are designed for phone-in-hand use.
- **Theme:** Light/dark toggle exists in Settings. Light — background `#FAFAF8`, cards `#FFFFFF` with `shadow-sm`, foreground `#1A1A1A`, muted `#6B7280`, border `#E5E7EB`. Dark — dark equivalents. Accent green `#16A34A` in both modes. Rounded corners `rounded-2xl` on cards. Badge colors: green `bg-[#dcfce7] text-[#15803d]`, yellow `bg-[#fef3c7] text-[#B45309]`, red `bg-[#fee2e2] text-[#DC2626]`. Every component must respect the active theme — hardcoded dark background classes are a bug.
- **Protein picker vocabulary:** `proteins text[]` on recipes is the source of truth. Values are generic tokens (e.g. `'frango'`, `'salmão'`) — the picker shows canonical labels, not ingredient substrings.
- **Navigation:** Three bottom tabs — Receitas (/app/library) · Plano (/app/plan) · Lista (/app/shopping). No modals for recipe browsing — all discovery happens in the library tab.
- **Filter UX:** Library uses a persistent search bar + category chip row (Proteína · Tempo · Calorias) + single Vaul bottom sheet for all filters. No collapsible panel. `pnpm add vaul` required.
- **Recipe detail page is context-aware:** `?from=plan` param switches bottom action from "Adicionar ao plano" to "Remover / Substituir". Tapping a plan item card navigates here.
- **Plan item cards:** Compact. Tap → context-aware detail page. Visible "×" remove button. No inline expansion.
- **Ingredient data model:** `ingredients` table (id, name, category, default_unit, owner_id) + `user_ingredient_overrides` (user_id, ingredient_id, category) for per-user category corrections. These tables must exist before Session 6 UI is built.
- **Filter logic:** Protein chips = OR logic against `proteins[]`. Ingredient combobox = AND logic, contextual to selected proteins. Time/Cal chips = single-select max-cap (no selection = no filter).
- **i18n:** i18next + react-i18next + i18next-browser-languagedetector. Supported: `['pt', 'en']`, fallback `'pt'`. Translation files at `src/i18n/locales/{lang}/common.json`. Recipe content (name, ingredients, steps) stored in translation tables, not hardcoded. UI strings accessed via `useTranslation()` hook.
- **Protein slugs:** `proteins text[]` stores language-agnostic English slugs (`'chicken'`, `'salmon'`). Display labels come from i18next `proteins.*` keys. Never store Portuguese tokens in this column.
- **Translation tables:** `recipe_translations`, `recipe_ingredient_translations`, `recipe_step_translations` — each keyed by `(entity_id, language)`. Queries join to the active language and fall back to `'pt'` if missing.
- **LLM translation:** Translations generated via Claude API (claude-haiku-4-5-20251001) in `scripts/translate-recipes.ts`. Idempotent — skips existing rows.

## Current session
**Flavor Identity Phase 1 is next.** Sessions 1–27 and the pre-launch checklist are complete. The app is in production on Vercel. See `docs/claude-code-implementation-plan.md` "Flavor Identity & Cook Profile — Phase 1" for the full spec.

### Key implementation notes
- Env vars: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (both `VITE_` prefixed)
- Server auth check: `getAuthUser()` from `src/lib/supabase/server.ts` in `beforeLoad`
- Cookie handling: `getCookies()` / `setCookie()` from `@tanstack/react-start/server`
- DB types: import from `src/types/db.ts` — regenerate with `mcp__supabase__generate_typescript_types` after schema changes
- Macro columns: `calories` (int), `protein` (numeric), `carbs` (numeric), `fat` (numeric) — no `_g` suffix
- `macros_total = true` → divide by `servings` for per-serving display
- `proteins text[]` — queried with `where 'chicken' = any(proteins)`, GIN indexed. Slugs are English, display via i18next `proteins.*`
- `is_pantry` on recipe_ingredients is `not null default false`
- Filter state in URL search params via TanStack Router `validateSearch`
- `createServerFn` uses `.inputValidator()` not `.validator()` in this version of TanStack Start
- Supabase project ID: `kgvycfrvxzkfhvuazzle`
- Theme: `[data-theme="dark"]` selector — never use Tailwind `dark:` prefix
- Rate limiting: `daily_ai_usage` table tracks AI macro estimation (10 calls/user/day)
- DB schema changes: use `execute_sql` (MCP) to iterate, then `supabase migration new <name>` + write the SQL manually to the file
