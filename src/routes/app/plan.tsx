import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMotion } from "../../lib/use-reduced-motion";
import { usePullToRefresh } from "../../lib/use-pull-to-refresh";
import { PullIndicator } from "../../components/PullIndicator";
import { capture } from "../../lib/analytics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Clock,
  ChevronLeft,
  Minus,
  Plus,
  CalendarDays,
  Star,
  Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import { Drawer } from "vaul";
import {
  fetchPlanItems,
  fetchActivePlanWithCount,
  removePlanItem,
  removePlanItems,
  updatePlanItemMultiplier,
  upsertUserRecipePreference,
  archiveAndCreatePlan,
  addRecipeToPlan,
  suggestPlan,
} from "../../lib/supabase/plan-queries";
import {
  fetchCookLog,
  deleteCookLogEntry,
  fetchTopCookedRecipes,
  getDistinctCookedCount,
} from "../../lib/supabase/cook-log-queries";
import type {
  CookLogWithRecipe,
  TopCookedRecipe,
} from "../../lib/supabase/cook-log-queries";
import { fetchMyProfile } from "../../lib/supabase/profile-queries";
import {
  defaultSuggestionCount,
  type PlanIntent,
  type ProteinFamily,
  type VarietyLevel,
} from "../../lib/plan-generator";
import type {
  PlanItemWithRecipe,
  ActivePlanWithCount,
  Recipe,
} from "../../types/db";

// Plan size beyond which the generator buttons are disabled, to avoid runaway (§3.9).
const PLAN_MAX_ITEMS = 14;

function PlanSkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4 py-5 space-y-3">
        <div className="h-6 w-28 bg-[#F3F4F6] rounded-full animate-pulse motion-reduce:animate-none mb-4" />
        <div className="h-14 bg-[#F3F4F6] rounded-2xl animate-pulse motion-reduce:animate-none" />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 animate-pulse motion-reduce:animate-none"
          >
            <div className="h-4 w-2/3 bg-[#F3F4F6] rounded-full mb-3" />
            <div className="grid grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-12 bg-[#F3F4F6] rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">
          Não foi possível carregar o plano
        </p>
        <p className="text-sm text-[#6B7280]">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-sm text-[#F4623A] underline"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/app/plan")({
  pendingComponent: PlanSkeleton,
  errorComponent: ({ error }) => <PlanError error={error as Error} />,
  component: PlanPage,
});

// ---------- helpers ----------

function perServing(
  r: Recipe,
  field: "calories" | "protein" | "carbs" | "fat",
) {
  const raw = r[field] ?? 0;
  return r.macros_total ? raw / (r.servings || 1) : raw;
}

// ---------- PlanItemCard ----------

const PROTEIN_COLORS: Record<string, string> = {
  chicken: "linear-gradient(135deg, #fef3c7, #fde68a)",
  beef: "linear-gradient(135deg, #fee2e2, #fecaca)",
  pork: "linear-gradient(135deg, #fce7f3, #fbcfe8)",
  salmon: "linear-gradient(135deg, #ffe4e6, #fecdd3)",
  tuna: "linear-gradient(135deg, #dbeafe, #bfdbfe)",
  fish: "linear-gradient(135deg, #e0f2fe, #bae6fd)",
  eggs: "linear-gradient(135deg, #fefce8, #fef9c3)",
  seafood: "linear-gradient(135deg, #fff7ed, #fed7aa)",
  turkey: "linear-gradient(135deg, #fef9c3, #fef08a)",
  duck: "linear-gradient(135deg, #fef3c7, #fde68a)",
  veal: "linear-gradient(135deg, #fee2e2, #fca5a5)",
  lamb: "linear-gradient(135deg, #fdf4ff, #f5d0fe)",
  tofu: "linear-gradient(135deg, #FEE9E1, #bbf7d0)",
  legumes: "linear-gradient(135deg, #d1fae5, #a7f3d0)",
  whey: "linear-gradient(135deg, #ede9fe, #ddd6fe)",
};

function PlanItemCard({
  item,
  onRemove,
  onServingsChange,
  reason,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onLongPress,
}: {
  item: PlanItemWithRecipe;
  onRemove: (id: string) => void;
  onServingsChange: (id: string, recipeId: string, v: number) => void;
  reason?: string;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onLongPress?: (id: string) => void;
}) {
  const { t } = useTranslation();
  // Long-press → enter selection mode. Track a fired-flag so the click that
  // follows pointerup doesn't also navigate.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const startPress = () => {
    longFired.current = false;
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      onLongPress?.(item.id);
    }, 450);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const scale = item.portion_multiplier;
  const cal = Math.round(perServing(item.recipe, "calories") * scale);
  const pro = Math.round(perServing(item.recipe, "protein") * scale);
  const hasMacros = item.recipe.calories != null;
  const recipeThumbnail =
    item.recipe.image_thumb_url ?? item.recipe.image_url ?? null;
  const thumbnailBg = recipeThumbnail
    ? undefined
    : (PROTEIN_COLORS[item.recipe.proteins[0]] ??
      "linear-gradient(135deg, #FEE9E1, #bbf7d0)");

  return (
    <div
      className={`relative rounded-2xl bg-white border shadow-sm active:scale-[0.98] hover:shadow-md transition-[transform,box-shadow] overflow-hidden ${
        selected ? "border-[#F4623A] ring-2 ring-[#F4623A]/40" : "border-[#F0F0EE]"
      }`}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerMove={cancelPress}
    >
      {/* Full-card navigation link — in selection mode it toggles instead of navigating */}
      <Link
        to="/app/library/$recipeId"
        params={{ recipeId: item.recipe_id }}
        search={{ from: "plan", planItemId: item.id }}
        onClick={(e) => {
          if (selectionMode || longFired.current) {
            e.preventDefault();
            longFired.current = false;
            onToggleSelect?.(item.id);
          }
        }}
        className="flex h-[136px] focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
        aria-label={item.recipe.name}
      >
        {/* Left: thumbnail */}
        <div className="w-[96px] shrink-0 relative">
          {recipeThumbnail ? (
            <img
              src={recipeThumbnail}
              alt=""
              width={96}
              height={136}
              className="w-full h-full object-cover object-top"
              loading="lazy"
            />
          ) : (
            <div
              className="w-full h-full"
              style={{ background: thumbnailBg }}
              aria-hidden="true"
            />
          )}
        </div>

        {/* Right: content */}
        <div className="flex-1 min-w-0 flex flex-col p-3 pb-2 overflow-hidden pr-10">
          <h3 className="text-[#1A1A1A] font-semibold text-sm leading-snug line-clamp-2">
            {item.recipe.name}
          </h3>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#9CA3AF]">
            {item.recipe.time_min != null && (
              <span className="flex items-center gap-0.5 shrink-0">
                <Clock size={10} aria-hidden="true" />
                {item.recipe.time_min} {t("common.min")}
              </span>
            )}
          </div>
          {hasMacros && (
            <div className="mt-2 flex gap-1.5">
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#9CA3AF] font-medium">
                {cal} Cal
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#9CA3AF] font-medium">
                {pro}g {t("recipe.proteinAbbr")}
              </span>
            </div>
          )}
          {reason && (
            <span className="mt-1.5 text-[10px] font-semibold text-[#F4623A] leading-tight line-clamp-1">
              {t(`plan.reason.${reason}`)}
            </span>
          )}
        </div>
      </Link>

      {/* Selection checkmark (selection mode) */}
      {selectionMode && (
        <div
          className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
            selected
              ? "bg-[#F4623A] border-[#F4623A] text-white"
              : "bg-white/80 border-[#E5E7EB]"
          }`}
          aria-hidden="true"
        >
          {selected && <Check size={14} />}
        </div>
      )}

      {/* Remove button — top-right, above the link (hidden in selection mode) */}
      {!selectionMode && (
        <button
          onClick={() => onRemove(item.id)}
          aria-label={`Remover ${item.recipe.name} do plano`}
          className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#fee2e2] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}

      {/* Servings stepper — bottom-right, above the link (hidden in selection mode) */}
      {!selectionMode && (
      <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5">
        <button
          onClick={() =>
            onServingsChange(
              item.id,
              item.recipe_id,
              Math.max(1, item.portion_multiplier - 1),
            )
          }
          disabled={item.portion_multiplier <= 1}
          aria-label="Diminuir doses"
          className="w-6 h-6 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#6B7280] disabled:opacity-30 hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
        >
          <Minus size={10} aria-hidden="true" />
        </button>
        <span
          className="w-4 text-center text-xs font-bold text-[#1A1A1A]"
          aria-live="polite"
        >
          {item.portion_multiplier}
        </span>
        <button
          onClick={() =>
            onServingsChange(
              item.id,
              item.recipe_id,
              item.portion_multiplier + 1,
            )
          }
          aria-label="Aumentar doses"
          className="w-6 h-6 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
        >
          <Plus size={10} aria-hidden="true" />
        </button>
      </div>
      )}
    </div>
  );
}

// ---------- date helpers ----------

function getWeekBounds(offset: number): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon…
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function toLocalDateStr(isoStr: string) {
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateHeading(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ---------- CookHistorySheet ----------

function CookHistorySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [weekOffset, setWeekOffset] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: cookLog = [] } = useQuery({
    queryKey: ["cook-log"],
    queryFn: fetchCookLog,
    staleTime: 2 * 60 * 1000,
    enabled: open,
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (cookLogId: string) =>
      deleteCookLogEntry({ data: { cookLogId } }),
    onMutate: async (cookLogId) => {
      setDeletingId(cookLogId);
      await qc.cancelQueries({ queryKey: ["cook-log"] });
      const prev = qc.getQueryData<CookLogWithRecipe[]>(["cook-log"]);
      qc.setQueryData<CookLogWithRecipe[]>(
        ["cook-log"],
        (old) => old?.filter((e) => e.id !== cookLogId) ?? [],
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["cook-log"], ctx.prev);
    },
    onSettled: () => {
      setDeletingId(null);
      qc.invalidateQueries({ queryKey: ["cook-log"] });
      qc.invalidateQueries({ queryKey: ["cook-counts"] });
    },
  });

  const { start, end } = useMemo(() => getWeekBounds(weekOffset), [weekOffset]);

  const weekEntries = useMemo(
    () =>
      cookLog.filter((e) => {
        const d = new Date(e.cooked_at);
        return d >= start && d <= end;
      }),
    [cookLog, start, end],
  );

  // Day strip: Mon=0 … Sun=6
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const stripDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dateStr = toLocalDateStr(d.toISOString());
      const hasEntry = weekEntries.some(
        (e) => toLocalDateStr(e.cooked_at) === dateStr,
      );
      return { key: DAY_KEYS[i], hasEntry, date: d };
    });
  }, [start, weekEntries]);

  // Group entries by date, most recent first
  const grouped = useMemo(() => {
    const map = new Map<string, CookLogWithRecipe[]>();
    for (const entry of weekEntries) {
      const key = toLocalDateStr(entry.cooked_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [weekEntries]);

  const hasOlderEntries = cookLog.some((e) => new Date(e.cooked_at) < start);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-[20px] bg-[#FAFAF8] outline-none"
          aria-label={t("cookHistory.title")}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div
              className="h-1 w-10 rounded-full bg-[#E5E7EB]"
              aria-hidden="true"
            />
          </div>

          <div
            className="px-4 pb-4"
            style={{ maxHeight: "80vh", overflowY: "auto" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between py-3">
              <h2 className="text-base font-bold text-[#1A1A1A]">
                {t("cookHistory.title")}
              </h2>
              <button
                onClick={() => setWeekOffset((o) => o - 1)}
                disabled={!hasOlderEntries && weekOffset === 0}
                aria-label={t("cookHistory.prevWeek")}
                className="flex items-center gap-1 text-xs text-[#6B7280] disabled:opacity-30 hover:text-[#1A1A1A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 rounded-lg px-1 py-0.5"
              >
                <ChevronLeft size={14} aria-hidden="true" />
                {t("cookHistory.prevWeek")}
              </button>
              {weekOffset < 0 && (
                <button
                  onClick={() => setWeekOffset((o) => o + 1)}
                  aria-label={t("cookHistory.nextWeek")}
                  className="flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 rounded-lg px-1 py-0.5"
                >
                  {t("cookHistory.nextWeek")}
                  <ChevronLeft
                    size={14}
                    className="rotate-180"
                    aria-hidden="true"
                  />
                </button>
              )}
            </div>

            {/* Week strip */}
            <div className="grid grid-cols-7 gap-1 mb-3">
              {stripDays.map(({ key, hasEntry, date }) => {
                const isToday =
                  toLocalDateStr(date.toISOString()) ===
                  toLocalDateStr(new Date().toISOString());
                return (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <span
                      className={`text-[10px] font-medium ${isToday ? "text-[#F4623A]" : "text-[#9CA3AF]"}`}
                    >
                      {t(`cookHistory.days.${key}`)}
                    </span>
                    <div
                      className={`h-5 w-5 rounded-full border-2 ${
                        hasEntry
                          ? "bg-[#F4623A] border-[#F4623A]"
                          : "bg-white border-[#E5E7EB]"
                      } ${isToday && !hasEntry ? "border-[#F4623A]/40" : ""}`}
                      aria-hidden="true"
                    />
                  </div>
                );
              })}
            </div>

            {/* Count */}
            <p className="text-xs text-[#6B7280] mb-4">
              {t("cookHistory.timesThisWeek", { count: weekEntries.length })}
            </p>

            {/* Divider */}
            <div className="border-t border-[#F0F0EE] mb-4" />

            {/* Log */}
            {grouped.length === 0 ? (
              <p className="text-sm text-[#9CA3AF] text-center py-6">
                {t("cookHistory.nothingYet")}
              </p>
            ) : (
              <div className="space-y-4">
                {grouped.map(([dateStr, entries]) => (
                  <div key={dateStr}>
                    <p className="text-xs font-semibold text-[#6B7280] mb-2 capitalize">
                      {formatDateHeading(dateStr)}
                    </p>
                    <div className="space-y-1.5">
                      {entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-xl bg-white border border-[#F0F0EE] px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <span className="text-sm text-[#1A1A1A] font-medium flex-1 truncate">
                            {entry.recipe_name}
                          </span>
                          <button
                            onClick={() => deleteEntryMutation.mutate(entry.id)}
                            disabled={deletingId === entry.id}
                            aria-label={`Eliminar registo de ${entry.recipe_name}`}
                            className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[#9CA3AF] active:text-[#DC2626] active:bg-[#fee2e2] transition-colors focus:outline-none disabled:opacity-40"
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------- FavouritesSheet (F11 quick-add) ----------

function FavouritesSheet({
  open,
  onOpenChange,
  planId,
  planRecipeIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  planId: string | undefined;
  planRecipeIds: Set<string>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { showToast } = useToast();
  // Recipes the user added during this session (so rows mark as added immediately,
  // even before the plan-items query refetches).
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);

  const { data: favourites = [], isLoading } = useQuery({
    queryKey: ["top-cooked"],
    queryFn: () => fetchTopCookedRecipes({ data: 12 }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const addMutation = useMutation({
    mutationFn: (recipeId: string) => addRecipeToPlan({ data: recipeId }),
    onMutate: (recipeId) => {
      setAddingId(recipeId);
      setJustAdded((prev) => new Set(prev).add(recipeId));
    },
    onError: (_err, recipeId) => {
      setJustAdded((prev) => {
        const next = new Set(prev);
        next.delete(recipeId);
        return next;
      });
      showToast(t("recipe.addedToPlanError"), "error");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-items", planId] });
      qc.invalidateQueries({ queryKey: ["active-plan"] });
      showToast(t("recipe.addedToPlan"), "success");
    },
    onSettled: () => setAddingId(null),
  });

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-[20px] bg-[#FAFAF8] outline-none"
          aria-label={t("plan.quickAddTitle")}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div
              className="h-1 w-10 rounded-full bg-[#E5E7EB]"
              aria-hidden="true"
            />
          </div>

          <div
            className="px-4 pb-4"
            style={{ maxHeight: "80dvh", overflowY: "auto" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between py-3">
              <h2 className="text-base font-bold text-[#1A1A1A]">
                {t("plan.quickAddTitle")}
              </h2>
              <button
                onClick={() => onOpenChange(false)}
                aria-label={t("common.close")}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#1A1A1A] hover:bg-[#F3F4F6] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 rounded-xl bg-[#F3F4F6] animate-pulse motion-reduce:animate-none"
                  />
                ))}
              </div>
            ) : favourites.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-[#6B7280] mb-4">
                  {t("plan.quickAddEmpty")}
                </p>
                <Link
                  to="/app/library"
                  search={{} as never}
                  className="inline-block px-5 py-2.5 rounded-xl bg-[#F4623A] text-white text-sm font-semibold hover:bg-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                >
                  {t("plan.addRecipe")}
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {favourites.map((fav) => {
                  const added =
                    planRecipeIds.has(fav.id) || justAdded.has(fav.id);
                  return (
                    <FavouriteRow
                      key={fav.id}
                      fav={fav}
                      added={added}
                      busy={addingId === fav.id}
                      onAdd={() => addMutation.mutate(fav.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function FavouriteRow({
  fav,
  added,
  busy,
  onAdd,
}: {
  fav: TopCookedRecipe;
  added: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const thumbBg = fav.imageThumbUrl
    ? undefined
    : (PROTEIN_COLORS[fav.proteins[0]] ??
      "linear-gradient(135deg, #FEE9E1, #bbf7d0)");

  return (
    <div className="rounded-xl bg-white border border-[#F0F0EE] flex items-center gap-3 pr-2.5 overflow-hidden">
      <div className="w-14 h-16 shrink-0">
        {fav.imageThumbUrl ? (
          <img
            src={fav.imageThumbUrl}
            alt=""
            width={56}
            height={64}
            className="w-full h-full object-cover object-top"
            loading="lazy"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{ background: thumbBg }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="flex-1 min-w-0 py-2">
        <p className="text-sm font-semibold text-[#1A1A1A] leading-snug line-clamp-2">
          {fav.name}
        </p>
        <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
          {t("plan.cookedNTimes", { count: fav.cookCount })}
        </p>
      </div>
      <button
        onClick={onAdd}
        disabled={added || busy}
        aria-label={
          added
            ? t("plan.alreadyInPlan")
            : `${t("plan.addRecipe")}: ${fav.name}`
        }
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 disabled:cursor-default ${
          added
            ? "bg-[#dcfce7] text-[#15803d]"
            : "bg-[#F4623A] text-white hover:bg-[#D94F2B] disabled:opacity-50"
        }`}
      >
        {added ? (
          <Check size={16} aria-hidden="true" />
        ) : (
          <Plus size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

// ---------- IntentPanel (F13 §11.3–11.4) ----------

const PROTEIN_FAMILY_KEYS: ProteinFamily[] = [
  "poultry",
  "fish",
  "red_meat",
  "seafood",
  "vegetarian",
  "eggs",
];
const VARIETY_OPTIONS: VarietyLevel[] = ["similar", "balanced", "surprise"];
const TEMPO_OPTIONS: { key: string; maxTime: number | null }[] = [
  { key: "any", maxTime: null },
  { key: "t30", maxTime: 30 },
  { key: "t45", maxTime: 45 },
];

function IntentPanel({
  intent,
  onChange,
}: {
  intent: PlanIntent;
  onChange: (i: PlanIntent) => void;
}) {
  const { t } = useTranslation();
  const targets = intent.proteinTargets ?? [];
  const countFor = (f: ProteinFamily) =>
    targets.find((x) => x.family === f)?.count ?? 0;
  const setCount = (f: ProteinFamily, n: number) => {
    const others = targets.filter((x) => x.family !== f);
    const next = n > 0 ? [...others, { family: f, count: n }] : others;
    onChange({ ...intent, proteinTargets: next.length ? next : undefined });
  };
  const variety = intent.variety ?? "balanced";
  const maxTime = intent.maxTime ?? null;

  return (
    <div className="mt-4 rounded-2xl border border-[#E5E7EB] bg-white p-4 space-y-4 text-left">
      {/* Protein mix */}
      <div>
        <p className="text-xs font-semibold text-[#6B7280] mb-2">
          {t("plan.intent.proteins")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PROTEIN_FAMILY_KEYS.map((f) => {
            const n = countFor(f);
            const active = n > 0;
            return (
              <div
                key={f}
                className={`flex items-center rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? "border-[#F4623A] bg-[#FEE9E1] text-[#1A1A1A]"
                    : "border-[#E5E7EB] text-[#6B7280]"
                }`}
              >
                <button
                  onClick={() => setCount(f, active ? 0 : 1)}
                  className="px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 rounded-full"
                >
                  {t(`plan.family.${f}`)}
                </button>
                {active && (
                  <span className="flex items-center gap-1 pr-1.5">
                    <button
                      onClick={() => setCount(f, n - 1)}
                      aria-label={t("common.decrease", "−")}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[#6B7280] hover:bg-white/60"
                    >
                      <Minus size={11} aria-hidden="true" />
                    </button>
                    <span className="w-3 text-center font-bold" aria-live="polite">
                      {n}
                    </span>
                    <button
                      onClick={() => setCount(f, Math.min(n + 1, 6))}
                      aria-label={t("common.increase", "+")}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[#6B7280] hover:bg-white/60"
                    >
                      <Plus size={11} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Variety dial */}
      <div>
        <p className="text-xs font-semibold text-[#6B7280] mb-2">
          {t("plan.intent.variety")}
        </p>
        <div className="flex rounded-xl border border-[#E5E7EB] overflow-hidden">
          {VARIETY_OPTIONS.map((v) => (
            <button
              key={v}
              onClick={() => onChange({ ...intent, variety: v })}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 ${
                variety === v
                  ? "bg-[#F4623A] text-white"
                  : "text-[#6B7280] hover:bg-[#F3F4F6]"
              }`}
            >
              {t(`plan.variety.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Tempo */}
      <div>
        <p className="text-xs font-semibold text-[#6B7280] mb-2">
          {t("plan.intent.tempo")}
        </p>
        <div className="flex gap-1.5">
          {TEMPO_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => onChange({ ...intent, maxTime: o.maxTime })}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 ${
                maxTime === o.maxTime
                  ? "border-[#F4623A] bg-[#FEE9E1] text-[#1A1A1A]"
                  : "border-[#E5E7EB] text-[#6B7280]"
              }`}
            >
              {t(`plan.tempo.${o.key}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- PlanPage ----------

function PlanPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { skip: reducedMotion } = useMotion();
  const [confirmClear, setConfirmClear] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [favouritesOpen, setFavouritesOpen] = useState(false);
  // Last 1–2 generated batches of recipe ids — passed back to suggestPlan as extra
  // excludes so "Sugerir mais" yields a fresh set, not the same top picks (§9.3).
  const recentBatchesRef = useRef<string[][]>([]);
  // Transient "why this" reasons keyed by plan-item id (F12a). Not persisted —
  // captions show right after generation and reset on reload (spec §10.7 Q3).
  const [reasonByItemId, setReasonByItemId] = useState<Record<string, string>>(
    {},
  );
  const [adjustOpen, setAdjustOpen] = useState(false);
  // Sticky per-plan intent (§11.7) — remembered across generations, client-side.
  const [intent, setIntent] = useState<PlanIntent>(() => {
    if (typeof localStorage === "undefined") return {};
    try {
      const raw = localStorage.getItem("plan_intent");
      return raw ? (JSON.parse(raw) as PlanIntent) : {};
    } catch {
      return {};
    }
  });
  const changeIntent = (next: PlanIntent) => {
    setIntent(next);
    try {
      localStorage.setItem("plan_intent", JSON.stringify(next));
    } catch {
      /* ignore quota/availability errors */
    }
  };

  const { pullY: planPullY, isRefreshing: isPlanPtrRefreshing } =
    usePullToRefresh({
      onRefresh: async () => {
        await qc.invalidateQueries({ queryKey: ["active-plan"] });
        await qc.invalidateQueries({ queryKey: ["plan-items"] });
      },
    });

  const { data: plan, isLoading: isPlanLoading } = useQuery({
    queryKey: ["active-plan"],
    queryFn: fetchActivePlanWithCount,
    staleTime: 5 * 60 * 1000,
  });

  const planId = plan?.id;

  const { data: items = [], isLoading: isItemsLoading } = useQuery({
    queryKey: ["plan-items", planId],
    queryFn: () => fetchPlanItems({ data: planId! }),
    enabled: !!planId,
    staleTime: 2 * 60 * 1000,
  });

  // Remove item — optimistic
  const removeMutation = useMutation({
    mutationFn: (id: string) => removePlanItem({ data: id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["plan-items", planId] });
      const prev = qc.getQueryData<PlanItemWithRecipe[]>([
        "plan-items",
        planId,
      ]);
      qc.setQueryData<PlanItemWithRecipe[]>(
        ["plan-items", planId],
        (old) => old?.filter((i) => i.id !== id) ?? [],
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["plan-items", planId], ctx.prev);
      showToast("Erro ao remover receita", "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["plan-items", planId] });
      qc.invalidateQueries({ queryKey: ["active-plan"] });
    },
  });

  // Update per-item servings — optimistic update + save preference
  const itemMultMutation = useMutation({
    mutationFn: ({
      id,
      recipeId,
      mult,
    }: {
      id: string;
      recipeId: string;
      mult: number;
    }) =>
      Promise.all([
        updatePlanItemMultiplier({
          data: { planItemId: id, multiplier: mult },
        }),
        upsertUserRecipePreference({ data: { recipeId, servings: mult } }),
      ]),
    onMutate: async ({ id, mult }) => {
      await qc.cancelQueries({ queryKey: ["plan-items", planId] });
      const prev = qc.getQueryData<PlanItemWithRecipe[]>([
        "plan-items",
        planId,
      ]);
      qc.setQueryData<PlanItemWithRecipe[]>(
        ["plan-items", planId],
        (old) =>
          old?.map((i) =>
            i.id === id ? { ...i, portion_multiplier: mult } : i,
          ) ?? [],
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["plan-items", planId], ctx.prev);
      showToast("Erro ao actualizar doses", "error");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["plan-items", planId] }),
  });

  // Archive + create new plan
  const clearMutation = useMutation({
    mutationFn: () => archiveAndCreatePlan({ data: planId! }),
    onSuccess: (newPlan) => {
      capture("plan_archived", { itemCount: items.length });
      qc.setQueryData<ActivePlanWithCount>(["active-plan"], {
        ...newPlan,
        item_count: 0,
      });
      qc.setQueryData(["plan-items", newPlan.id], []);
      qc.removeQueries({ queryKey: ["plan-items", planId] });
      setConfirmClear(false);
    },
  });

  // Persona → first-tap suggestion count (§9.5). Reuses the same query key as the
  // library so it's already warm; falls back to the null-persona default.
  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchMyProfile(),
    staleTime: 5 * 60 * 1000,
  });
  const firstTapCount = defaultSuggestionCount(profile?.cook_style ?? null);

  // Distinct recipes cooked → drives the cold-start "it gets better" message
  // (< 5 mirrors the flavor-profile threshold where personalization kicks in).
  const { data: distinctCooks = 0 } = useQuery({
    queryKey: ["cook-distinct-count"],
    queryFn: () => getDistinctCookedCount(),
    staleTime: 5 * 60 * 1000,
  });

  const planRecipeIds = useMemo(
    () => new Set(items.map((i) => i.recipe_id)),
    [items],
  );
  const atMax = items.length >= PLAN_MAX_ITEMS;
  // First-tap size, bumped up if protein targets ask for more than the default.
  const intentMin = (intent.proteinTargets ?? []).reduce(
    (a, x) => a + x.count,
    0,
  );
  const genCount = Math.min(PLAN_MAX_ITEMS, Math.max(firstTapCount, intentMin));

  // Generate / "Sugerir mais" — direct insert + undo toast (§3.9).
  const suggestMutation = useMutation({
    mutationFn: (requested: number) =>
      suggestPlan({
        data: {
          count: requested,
          excludeRecipeIds: recentBatchesRef.current.flat(),
          intent,
        },
      }),
    onSuccess: ({ items: newItems, reasons }, requested) => {
      if (newItems.length === 0) {
        showToast(t("plan.suggestNone"), "error");
        return;
      }
      capture("plan_suggested", { count: newItems.length, requested });
      const batch = newItems.map((i) => i.recipe_id);
      recentBatchesRef.current = [...recentBatchesRef.current, batch].slice(-2);
      const insertedIds = newItems.map((i) => i.id);
      // Stash the "why this" reason per inserted item (F12a transparency caption).
      setReasonByItemId((prev) => {
        const next = { ...prev };
        for (const it of newItems) {
          const reason = reasons[it.recipe_id];
          if (reason) next[it.id] = reason;
        }
        return next;
      });
      qc.invalidateQueries({ queryKey: ["plan-items", planId] });
      qc.invalidateQueries({ queryKey: ["active-plan"] });
      const partial = newItems.length < requested;
      showToast(
        partial
          ? t("plan.suggestPartial", { count: newItems.length })
          : t("plan.suggestDone", { count: newItems.length }),
        "success",
        {
          label: t("plan.suggestUndo"),
          onClick: () => {
            // Atomic batch delete (§9.9) + free the ids for re-suggestion.
            recentBatchesRef.current = recentBatchesRef.current.filter(
              (b) => b !== batch,
            );
            setReasonByItemId((prev) => {
              const next = { ...prev };
              for (const id of insertedIds) delete next[id];
              return next;
            });
            removePlanItems({ data: insertedIds }).then(() => {
              qc.invalidateQueries({ queryKey: ["plan-items", planId] });
              qc.invalidateQueries({ queryKey: ["active-plan"] });
            });
          },
        },
      );
    },
    onError: () => showToast(t("common.error"), "error"),
  });

  // ── Multi-select (long-press) + Eliminar / Substituir (§11.5) ──────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const enterSelect = (id: string) => {
    setSelectMode(true);
    setSelectedItemIds(new Set([id]));
  };
  const toggleSelect = (id: string) =>
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectMode(false);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedItemIds(new Set());
  };

  const bulkRemoveMutation = useMutation({
    mutationFn: (ids: string[]) => removePlanItems({ data: ids }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ["plan-items", planId] });
      const prev = qc.getQueryData<PlanItemWithRecipe[]>(["plan-items", planId]);
      qc.setQueryData<PlanItemWithRecipe[]>(
        ["plan-items", planId],
        (old) => old?.filter((i) => !ids.includes(i.id)) ?? [],
      );
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(["plan-items", planId], ctx.prev);
      showToast(t("common.error"), "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["plan-items", planId] });
      qc.invalidateQueries({ queryKey: ["active-plan"] });
    },
  });

  const replaceMutation = useMutation({
    mutationFn: async (itemIds: string[]) => {
      const removedRecipeIds = items
        .filter((i) => itemIds.includes(i.id))
        .map((i) => i.recipe_id);
      await removePlanItems({ data: itemIds });
      return suggestPlan({
        data: {
          count: itemIds.length,
          intent,
          excludeRecipeIds: [
            ...recentBatchesRef.current.flat(),
            ...removedRecipeIds,
          ],
        },
      });
    },
    onSuccess: ({ items: newItems, reasons }) => {
      const batch = newItems.map((i) => i.recipe_id);
      recentBatchesRef.current = [...recentBatchesRef.current, batch].slice(-2);
      setReasonByItemId((prev) => {
        const next = { ...prev };
        for (const it of newItems) {
          const reason = reasons[it.recipe_id];
          if (reason) next[it.id] = reason;
        }
        return next;
      });
      qc.invalidateQueries({ queryKey: ["plan-items", planId] });
      qc.invalidateQueries({ queryKey: ["active-plan"] });
      showToast(
        newItems.length > 0
          ? t("plan.suggestDone", { count: newItems.length })
          : t("plan.suggestNone"),
        newItems.length > 0 ? "success" : "error",
      );
    },
    onError: () => showToast(t("common.error"), "error"),
    onSettled: () => exitSelect(),
  });

  if (isPlanLoading || isItemsLoading) return <PlanSkeleton />;

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4">
        {/* Header */}
        <div className="pt-4 pb-3 flex items-center justify-between gap-2">
          <span className="text-xs text-[#9CA3AF]">
            {items.length === 0
              ? t("plan.noItems")
              : t("plan.itemCount", { count: items.length })}
          </span>
          <div className="flex items-center gap-1">
            {items.length > 0 && (
              <button
                onClick={() => suggestMutation.mutate(3)}
                disabled={suggestMutation.isPending || atMax}
                aria-label={t("plan.suggestMore")}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-[#F4623A] hover:bg-[#FEE9E1] transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40"
              >
                {suggestMutation.isPending
                  ? t("plan.suggesting")
                  : t("plan.suggestMore")}
              </button>
            )}
            <button
              onClick={() => setFavouritesOpen(true)}
              aria-label={t("plan.quickAdd")}
              className="p-1.5 rounded-xl text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40"
            >
              <Star size={20} aria-hidden="true" />
            </button>
            <button
              onClick={() => setHistoryOpen(true)}
              aria-label={t("cookHistory.title")}
              className="p-1.5 rounded-xl text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40"
            >
              <CalendarDays size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <CookHistorySheet open={historyOpen} onOpenChange={setHistoryOpen} />
        <FavouritesSheet
          open={favouritesOpen}
          onOpenChange={setFavouritesOpen}
          planId={planId}
          planRecipeIds={planRecipeIds}
        />

        <PullIndicator
          pullY={planPullY}
          isRefreshing={isPlanPtrRefreshing}
          variant="flow"
        />

        {/* Empty state */}
        {items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[#6B7280] text-sm mb-5">{t("plan.empty")}</p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => suggestMutation.mutate(genCount)}
                disabled={suggestMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F4623A] text-white text-sm font-semibold hover:bg-[#D94F2B] transition-colors disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
              >
                {suggestMutation.isPending
                  ? t("plan.suggesting")
                  : t("plan.suggest")}
              </button>
              <button
                onClick={() => setAdjustOpen((o) => !o)}
                aria-expanded={adjustOpen}
                className="px-3 py-2.5 rounded-xl text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
              >
                {t("plan.adjust")}
              </button>
            </div>
            {adjustOpen && (
              <div className="max-w-[340px] mx-auto">
                <IntentPanel intent={intent} onChange={changeIntent} />
              </div>
            )}
            <div className="mt-3">
              <Link
                to="/app/library"
                search={{} as never}
                className="text-sm font-medium text-[#6B7280] hover:text-[#1A1A1A] underline underline-offset-2 transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none rounded"
              >
                {t("plan.addRecipe")}
              </Link>
            </div>
            {/* Personalization framing: tell cold-start users it improves, and warm
                users that the plan is built from their data (links to the profile). */}
            {distinctCooks < 5 ? (
              <p className="mt-6 text-xs text-[#9CA3AF] max-w-[280px] mx-auto">
                {t("plan.coldStartProgress", { count: distinctCooks })}
              </p>
            ) : (
              <p className="mt-6 text-xs text-[#9CA3AF]">
                {t("plan.suggestBasedOn")}{" "}
                <Link
                  to="/app/me"
                  className="text-[#F4623A] font-medium hover:underline focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none rounded"
                >
                  {t("plan.viewProfile")}
                </Link>
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Plan items */}
            <div className="mb-4">
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    exit={
                      reducedMotion ? {} : { opacity: 0, scaleY: 0, height: 0 }
                    }
                    style={{ originY: 0, marginBottom: 12 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                  >
                    <PlanItemCard
                      item={item}
                      reason={reasonByItemId[item.id]}
                      selectionMode={selectMode}
                      selected={selectedItemIds.has(item.id)}
                      onToggleSelect={toggleSelect}
                      onLongPress={enterSelect}
                      onRemove={(id) => removeMutation.mutate(id)}
                      onServingsChange={(id, recipeId, v) =>
                        itemMultMutation.mutate({ id, recipeId, mult: v })
                      }
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Clear plan */}
            <div className="mb-4">
              {confirmClear ? (
                <div className="rounded-2xl border border-[#fecaca] bg-[#fee2e2]/50 p-4 text-center space-y-3">
                  <p className="text-sm text-[#1A1A1A]">
                    {t("plan.clearConfirm")}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="flex-1 py-2 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={() => clearMutation.mutate()}
                      disabled={clearMutation.isPending}
                      className="flex-1 py-2 rounded-xl bg-[#DC2626] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#b91c1c] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="w-full py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#9CA3AF] hover:text-[#DC2626] hover:border-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                >
                  {t("plan.clearPlan")}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Multi-select action bar (§11.5) */}
      {selectMode && (
        <div className="fixed bottom-20 left-0 right-0 z-40 flex justify-center px-4">
          <div className="w-full max-w-md flex items-center gap-2 rounded-2xl bg-white border border-[#E5E7EB] shadow-lg p-2">
            <button
              onClick={exitSelect}
              className="px-3 py-2 rounded-xl text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t("common.cancel")}
            </button>
            <span className="flex-1 text-xs text-[#9CA3AF] text-center">
              {t("plan.selectedCount", { count: selectedItemIds.size })}
            </span>
            <button
              onClick={() => {
                bulkRemoveMutation.mutate([...selectedItemIds]);
                exitSelect();
              }}
              disabled={selectedItemIds.size === 0}
              className="px-3 py-2 rounded-xl text-sm font-semibold text-[#DC2626] hover:bg-[#fee2e2] transition-colors disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
            >
              {t("plan.remove")}
            </button>
            <button
              onClick={() => replaceMutation.mutate([...selectedItemIds])}
              disabled={selectedItemIds.size === 0 || replaceMutation.isPending}
              className="px-3 py-2 rounded-xl text-sm font-semibold bg-[#F4623A] text-white hover:bg-[#D94F2B] transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {replaceMutation.isPending ? t("plan.suggesting") : t("plan.replace")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
