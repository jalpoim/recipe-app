import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMotion } from "../../../lib/use-reduced-motion";
import { Clock, ClipboardList, Plus, Settings, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchMyProfile } from "../../../lib/supabase/profile-queries";
import {
  fetchLibrary,
  type RecipeWithIngredients,
} from "../../../lib/supabase/queries";
import { addRecipeToPlan } from "../../../lib/supabase/plan-queries";
import { deleteRecipe } from "../../../lib/supabase/recipe-queries";
import { useToast } from "../../../components/Toast";
import { ConfirmModal } from "../../../components/ConfirmModal";

export const Route = createFileRoute("/app/my-recipes/")({
  component: MyRecipesPage,
});

type Tab = "created" | "saved";

function RecipeCard({
  recipe,
  canDelete,
  onAddToPlan,
  onDelete,
}: {
  recipe: RecipeWithIngredients;
  canDelete?: boolean;
  onAddToPlan: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const thumbnail = recipe.image_thumb_url ?? recipe.image_url ?? null;

  return (
    <div className="relative rounded-2xl bg-white border border-[#F0F0EE] shadow-sm overflow-hidden active:scale-[0.98] transition-transform">
      <Link
        to="/app/library/$recipeId"
        params={{ recipeId: recipe.id }}
        search={{ from: undefined, planItemId: undefined }}
        className="flex items-start gap-3 p-4 pr-12"
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="w-[60px] h-[60px] rounded-xl object-cover shrink-0"
            loading="lazy"
          />
        ) : (
          <div
            className="w-[60px] h-[60px] rounded-xl shrink-0"
            style={{ background: "linear-gradient(135deg, #FEE9E1, #bbf7d0)" }}
            aria-hidden="true"
          />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[#1A1A1A] leading-snug line-clamp-2">
            {recipe.name}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-[#9CA3AF]">
            {recipe.time_min != null && (
              <span className="flex items-center gap-0.5">
                <Clock size={10} aria-hidden="true" />
                {recipe.time_min} {t("common.min")}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Action buttons column — right edge */}
      <div className="absolute right-0 top-0 bottom-0 flex flex-col">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddToPlan();
          }}
          aria-label={t("plan.addRecipe")}
          className={`flex-1 w-11 flex items-center justify-center border-l border-[#F0F0EE] text-[#F4623A] hover:bg-[#FEF2EF] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${canDelete ? "border-b" : ""}`}
        >
          <ClipboardList size={18} aria-hidden="true" />
        </button>

        {canDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.();
            }}
            aria-label={t("common.delete")}
            className="flex-1 w-11 flex items-center justify-center border-l border-[#F0F0EE] text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#fee2e2] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

function RecipeListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-2xl bg-white border border-[#F0F0EE] p-4 animate-pulse"
        >
          <div className="flex gap-3">
            <div className="w-[60px] h-[60px] rounded-xl bg-[#F3F4F6] shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-[#F3F4F6] rounded-full w-3/4" />
              <div className="h-3 bg-[#F3F4F6] rounded-full w-1/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MyRecipesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "pt";
  const [tab, setTab] = useState<Tab>("created");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { skip: reducedMotion } = useMotion();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchMyProfile(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: createdResult, isLoading: createdLoading } = useQuery({
    queryKey: ["my-recipes-created", lang],
    queryFn: () =>
      fetchLibrary({
        data: {
          limit: 50,
          cursor: null,
          sort: "popular",
          modes: ["mine"],
          proteins: [],
          maxCal: undefined,
          maxTime: undefined,
          tags: [],
          ingredients: [],
          q: "",
          lang,
        },
      }),
    staleTime: 2 * 60 * 1000,
  });

  const { data: savedResult, isLoading: savedLoading } = useQuery({
    queryKey: ["my-recipes-saved", lang],
    queryFn: () =>
      fetchLibrary({
        data: {
          limit: 50,
          cursor: null,
          sort: "popular",
          modes: ["saved"],
          proteins: [],
          maxCal: undefined,
          maxTime: undefined,
          tags: [],
          ingredients: [],
          q: "",
        },
      }),
    enabled: tab === "saved",
    staleTime: 2 * 60 * 1000,
  });

  const addToPlanMutation = useMutation({
    mutationFn: (recipeId: string) => addRecipeToPlan({ data: recipeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plan"] });
      showToast(t("plan.added"), "success");
    },
    onError: () => showToast(t("common.error"), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (recipeId: string) => deleteRecipe({ data: recipeId }),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["my-recipes-created"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      showToast(t("recipe.deleted"), "success");
    },
    onError: () => {
      setDeleteTarget(null);
      showToast(t("common.error"), "error");
    },
  });

  const displayName = profile?.display_name ?? "—";
  const bio = profile?.bio ?? null;
  const avatarUrl = profile?.avatar_url ?? null;
  const username = profile?.username ?? null;

  const createdRecipes = createdResult?.data ?? [];
  const savedRecipes = savedResult?.data ?? [];

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#FAFAF8] border-b border-[#F0F0EE]">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-base font-semibold text-[#1A1A1A]">
            {t("myRecipes.title")}
          </h1>
          <Link
            to="/app/settings"
            aria-label={t("settings.title")}
            className="w-9 h-9 rounded-xl border border-[#E5E7EB] bg-white flex items-center justify-center text-[#9CA3AF] hover:text-[#6B7280] hover:border-[#D1D5DB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
          >
            <Settings size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-6">
        {/* Profile header */}
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-16 h-16 rounded-full object-cover shrink-0"
            />
          ) : (
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white shrink-0"
              style={{
                background: "linear-gradient(135deg, #F4623A, #D94F2B)",
              }}
              aria-hidden="true"
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-[#1A1A1A] truncate">
              {displayName}
            </p>
            {username && <p className="text-sm text-[#9CA3AF]">@{username}</p>}
            {bio && (
              <p className="text-sm text-[#6B7280] mt-0.5 line-clamp-2">
                {bio}
              </p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl bg-[#F3F4F6] p-1">
          <button
            onClick={() => setTab("created")}
            className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors focus:outline-none ${
              tab === "created"
                ? "bg-white shadow-sm text-[#1A1A1A]"
                : "text-[#6B7280] hover:text-[#1A1A1A]"
            }`}
          >
            {t("myRecipes.created")}
          </button>
          <button
            onClick={() => setTab("saved")}
            className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors focus:outline-none ${
              tab === "saved"
                ? "bg-white shadow-sm text-[#1A1A1A]"
                : "text-[#6B7280] hover:text-[#1A1A1A]"
            }`}
          >
            {t("myRecipes.saved")}
          </button>
        </div>

        {/* Recipe list */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={
              reducedMotion ? {} : { opacity: 0, x: tab === "created" ? -8 : 8 }
            }
            animate={{ opacity: 1, x: 0 }}
            exit={
              reducedMotion ? {} : { opacity: 0, x: tab === "created" ? 8 : -8 }
            }
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {tab === "created" && (
              <div>
                {createdLoading ? (
                  <RecipeListSkeleton />
                ) : createdRecipes.length === 0 ? (
                  <p className="text-sm text-[#9CA3AF] text-center py-8">
                    {t("myRecipes.noCreated")}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {createdRecipes.map((recipe) => (
                      <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        canDelete
                        onAddToPlan={() => addToPlanMutation.mutate(recipe.id)}
                        onDelete={() => setDeleteTarget(recipe.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "saved" && (
              <div>
                {savedLoading ? (
                  <RecipeListSkeleton />
                ) : savedRecipes.length === 0 ? (
                  <p className="text-sm text-[#9CA3AF] text-center py-8">
                    {t("myRecipes.noSaved")}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {savedRecipes.map((recipe) => (
                      <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        onAddToPlan={() => addToPlanMutation.mutate(recipe.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* FAB — create new recipe */}
      <Link
        to="/app/library/create"
        aria-label={t("library.newRecipe")}
        className="fixed z-20 right-4 w-14 h-14 rounded-full bg-[#F4623A] text-white shadow-lg flex items-center justify-center hover:bg-[#D94F2B] active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
        style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 1rem)" }}
      >
        <Plus size={24} aria-hidden="true" />
      </Link>

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("recipe.delete")}
        message={t("recipe.deleteConfirm")}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
