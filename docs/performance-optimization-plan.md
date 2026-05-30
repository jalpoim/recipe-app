# Performance Optimization Plan — page load & tab switching (2026-05-30)

Goal: make page loads and tab switches feel near-instant (Cookidoo-class). This is **code analysis, not yet measured** — validate each item with the React Profiler + network panel (or Playwright timing) before/after. File refs are to the current tree.

---

## A. Library / list page load

### Findings
1. **Over-fetch: the list pulls every recipe's full ingredient list just to show a count.**
   `fetchLibrary` selects `recipes(${RECIPE_FIELDS}, recipe_ingredients(${INGREDIENT_FIELDS}))` (`src/lib/supabase/queries.ts:187`), i.e. all ingredient rows × ~10 columns for every recipe in the page. The card only uses `recipe.recipe_ingredients?.length` → "N ingredientes" (`src/routes/app/library/index.tsx:543,599`). **Biggest, safest win.**
   - Fix: drop the join from the list query; get the count via a lightweight aggregate (`recipe_ingredients(count)`) or a stored `ingredient_count` column on `recipes`. Fetch full ingredients only on the detail page.

2. **List data loads client-side (no route loader / SSR).**
   `useInfiniteQuery(["library", …])` (`index.tsx:1473`) → first visit is blank → skeleton → server round-trip → content, instead of arriving with the HTML. `staleTime: 5min` is set (good — return visits are cached).
   - Fix: serve page 1 from the route `loader` (TanStack Start streams it with the document), keep the query for pagination + the 5-min cache.

3. **`fetchLibrary` server→DB waterfalls when filters/intolerances are active.**
   Allergen exclusion: ingredients-overlap → `recipe_ingredients in()` → ids (`queries.ts:136–154`). Ingredient filter: one query **per ingredient** with `ILIKE %x%` on `raw_text`/`name` (`queries.ts:252–262`). Plus translation lookups. `ILIKE %…%` needs a `gin_trgm` index or it seq-scans; each await stacks latency.
   - Fix: fold the exclusion/ingredient filters into fewer queries (or one RPC); confirm trigram indexes cover the `ILIKE` columns.

4. **Images.** Cards use `image_thumb_url ?? image_url` (good). Confirm thumbnails are CDN-served, responsively sized, and lazy-loaded below the fold.

---

## B. Tab / page switching (Receitas · Plano · Lista)

### Findings
1. **`preload="intent"` prefetches route loaders — but the tab routes have no loaders; their data is client `useQuery`.**
   Router config: `defaultPreload: "intent"`, `defaultPreloadStaleTime: 30_000`, `defaultPendingMs: 300` (`src/router.tsx:66–68`). Tabs are `<Link>` (`src/routes/app.tsx:198`). But `/app/plan`, `/app/shopping`, `/app/library` load data via `useQuery`/`useInfiniteQuery` on mount with **no `loader:`** (`plan.tsx` has none). So intent-preload warms almost nothing data-wise → on tap, the route swaps then fetches → lag.
   - Fix: either move each tab's primary data into its route `loader` (so intent-preload actually warms it), **or** prefetch the sibling tabs' queries on idle after first load (`queryClient.prefetchQuery` for plan/shopping/library) so switching is cache-instant.

2. **Heavy route components mount synchronously.**
   The library route is ~1,800 lines; mounting it (plus first render of a long list) blocks the main thread → the tab visibly changes late ("lags until the tab actually changes").
   - Fix: code-split heavy routes (`React.lazy`/route-level splitting), virtualize long lists, defer non-critical work off the mount path, and make sure the active-tab highlight is **optimistic** (updates on tap from `location`, not after the route commits — the nav already tracks pending location at `app.tsx:59–61`, so verify it flips immediately).

3. **Tab data caching.**
   Library has `staleTime: 5min`. Confirm plan/shopping queries also have a meaningful `staleTime` + `gcTime` so returning to a tab renders from cache instantly instead of refetching.

4. **Confirm `handleTabPress` does no blocking work on tap** (`app.tsx:201`) — any synchronous/awaited work there delays the swap.

---

## Why Cookidoo feels instant (the contrast)
- **Aggressive caching + prefetch** — target content is already cached (or prefetched on intent/scroll) before tap; navigation is just a render.
- **Static recipe content cached at the CDN/edge** — recipes barely change, so views don't hit a DB.
- **Thin list payloads** — cards fetch only what they show; full detail on demand.
- **Tab views stay mounted / cached** — switching is show/hide, not remount + refetch.
- **Optimized images** (responsive, CDN, lazy) + **SPA nav with skeletons / offline PWA cache**.

---

## Prioritized work
1. **Slim the library list query** (drop ingredient join → count via aggregate/stored column). High impact, low risk, no UX change. *(A1)*
2. **Prefetch sibling-tab data on idle** + ensure each tab query has `staleTime`/`gcTime`. Directly targets the tab-switch lag. *(B1, B3)*
3. **Serve list page 1 + tab data via route loaders** (SSR/stream) so first paint isn't blank→fetch. *(A2, B1)*
4. **Code-split heavy route components** + virtualize long lists; verify optimistic tab highlight. *(B2)*
5. **Collapse `fetchLibrary` waterfalls + confirm trigram indexes**; verify image sizing/lazy/CDN. *(A3, A4)*

**Before/after:** measure with the React Profiler (mount/commit time), the Network panel (payload size + request count for `fetchLibrary`), and a Playwright nav-timing script. Don't ship a "fix" without confirming it moved the number.
