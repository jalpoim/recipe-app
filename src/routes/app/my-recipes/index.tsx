import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Clock, Plus, Settings } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchMyProfile } from "../../../lib/supabase/profile-queries";
import {
  fetchLibrary,
  type RecipeWithIngredients,
} from "../../../lib/supabase/queries";

export const Route = createFileRoute("/app/my-recipes/")({
  component: MyRecipesPage,
});

type Tab = "created" | "saved";

function RecipeCard({ recipe }: { recipe: RecipeWithIngredients }) {
  const { t } = useTranslation();

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
      </div>
    </Link>
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
          <Link
            to="/app/settings"
            className="shrink-0 text-xs font-medium text-[#F4623A] hover:underline focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none rounded"
          >
            {t("myRecipes.editProfile")}
          </Link>
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
                  <RecipeCard key={recipe.id} recipe={recipe} />
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
                  <RecipeCard key={recipe.id} recipe={recipe} />
                ))}
              </div>
            )}
          </div>
        )}
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
    </div>
  );
}
