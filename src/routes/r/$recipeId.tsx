import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Clock, Users, ArrowRight } from "lucide-react";
import { fetchPublicRecipe } from "../../lib/supabase/public-queries";
import type { PublicRecipe } from "../../lib/supabase/public-queries";

const SITE_NAME = "Meal Prep";

// Muted pastel thumbnail gradients per protein (matches the in-app detail page).
const PROTEIN_COLORS: Record<string, string> = {
  chicken: "linear-gradient(135deg, #fef3c7, #fde68a)",
  beef: "linear-gradient(135deg, #fee2e2, #fecaca)",
  pork: "linear-gradient(135deg, #fce7f3, #fbcfe8)",
  salmon: "linear-gradient(135deg, #ffe4e6, #fecdd3)",
  tuna: "linear-gradient(135deg, #dbeafe, #bfdbfe)",
  fish: "linear-gradient(135deg, #e0f2fe, #bae6fd)",
  eggs: "linear-gradient(135deg, #fefce8, #fef9c3)",
  seafood: "linear-gradient(135deg, #fff7ed, #fed7aa)",
  tofu: "linear-gradient(135deg, #FEE9E1, #bbf7d0)",
  legumes: "linear-gradient(135deg, #d1fae5, #a7f3d0)",
};

function perServing(raw: number | null, servings: number, macrosTotal: boolean) {
  if (raw == null) return null;
  return macrosTotal ? raw / (servings || 1) : raw;
}

function round(n: number | null) {
  return n == null ? null : Math.round(n);
}

// schema.org/Recipe structured data for rich results.
function buildJsonLd(recipe: PublicRecipe, url: string) {
  const cal = round(perServing(recipe.calories, recipe.servings, recipe.macros_total));
  const pro = round(perServing(recipe.protein, recipe.servings, recipe.macros_total));
  const carb = round(perServing(recipe.carbs, recipe.servings, recipe.macros_total));
  const fat = round(perServing(recipe.fat, recipe.servings, recipe.macros_total));

  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.name,
    url,
    ...(recipe.image_url ? { image: [recipe.image_url] } : {}),
    ...(recipe.author_display_name
      ? { author: { "@type": "Person", name: recipe.author_display_name } }
      : {}),
    ...(recipe.created_at ? { datePublished: recipe.created_at } : {}),
    recipeYield: `${recipe.servings}`,
    ...(recipe.time_min != null ? { totalTime: `PT${recipe.time_min}M` } : {}),
    recipeIngredient: recipe.recipe_ingredients.map((i) =>
      i.raw_text.replace(/^\(opcional\)\s*/i, ""),
    ),
    recipeInstructions: recipe.recipe_steps.map((s, idx) => ({
      "@type": "HowToStep",
      position: idx + 1,
      text: s.text,
    })),
    ...(cal != null
      ? {
          nutrition: {
            "@type": "NutritionInformation",
            calories: `${cal} kcal`,
            ...(pro != null ? { proteinContent: `${pro} g` } : {}),
            ...(carb != null ? { carbohydrateContent: `${carb} g` } : {}),
            ...(fat != null ? { fatContent: `${fat} g` } : {}),
          },
        }
      : {}),
  };
}

export const Route = createFileRoute("/r/$recipeId")({
  loader: async ({ params }) => {
    const recipe = await fetchPublicRecipe({ data: params.recipeId });
    if (!recipe) throw notFound();
    return { recipe };
  },
  head: ({ loaderData, params }) => {
    const recipe = loaderData?.recipe;
    if (!recipe) return {};
    const url = `https://mealprep.app/r/${params.recipeId}`;
    const cal = round(
      perServing(recipe.calories, recipe.servings, recipe.macros_total),
    );
    const description =
      cal != null
        ? `${recipe.name} — ${cal} kcal por dose, ${recipe.recipe_ingredients.length} ingredientes${recipe.time_min != null ? `, ${recipe.time_min} min` : ""}.`
        : recipe.name;
    const image = recipe.image_url ?? recipe.image_thumb_url ?? undefined;
    return {
      meta: [
        { title: `${recipe.name} · ${SITE_NAME}` },
        { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:title", content: recipe.name },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        ...(image ? [{ property: "og:image", content: image }] : []),
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
        { name: "twitter:title", content: recipe.name },
        { name: "twitter:description", content: description },
        ...(image ? [{ name: "twitter:image", content: image }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: PublicRecipePage,
});

function PublicRecipePage() {
  const { t } = useTranslation();
  const { recipe } = Route.useLoaderData();
  const { recipeId } = Route.useParams();
  const url = `https://mealprep.app/r/${recipeId}`;

  const macros = [
    { key: "recipe.calories", value: round(perServing(recipe.calories, recipe.servings, recipe.macros_total)), unit: "kcal" },
    { key: "recipe.protein", value: round(perServing(recipe.protein, recipe.servings, recipe.macros_total)), unit: "g" },
    { key: "recipe.carbs", value: round(perServing(recipe.carbs, recipe.servings, recipe.macros_total)), unit: "g" },
    { key: "recipe.fat", value: round(perServing(recipe.fat, recipe.servings, recipe.macros_total)), unit: "g" },
  ];
  const hasMacros = macros.some((m) => m.value != null);
  const heroImage = recipe.image_thumb_url ?? recipe.image_url;

  // Group ingredients by section_label (matches in-app rendering).
  const sections: { label: string | null; items: PublicRecipe["recipe_ingredients"] }[] = [];
  const sectionMap = new Map<string, (typeof sections)[number]>();
  for (const ing of recipe.recipe_ingredients) {
    const key = ing.section_label ?? "__main__";
    if (!sectionMap.has(key)) {
      const s = { label: ing.section_label, items: [] as PublicRecipe["recipe_ingredients"] };
      sectionMap.set(key, s);
      sections.push(s);
    }
    sectionMap.get(key)!.items.push(ing);
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* JSON-LD structured data (server-rendered) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd(recipe, url)) }}
      />

      <div className="mx-auto w-full max-w-md pb-28">
        {/* Brand bar */}
        <header className="px-4 py-3 flex items-center justify-between border-b border-[#F0F0EE]">
          <span className="text-sm font-bold text-[#1A1A1A]">{SITE_NAME}</span>
          <Link
            to="/"
            className="text-xs font-semibold text-[#F4623A] hover:underline"
          >
            {t("publicRecipe.openApp", "Abrir app")}
          </Link>
        </header>

        {/* Hero */}
        <div className="w-full aspect-[16/9] overflow-hidden">
          {heroImage ? (
            <img
              src={heroImage}
              alt={recipe.name}
              width={640}
              height={360}
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full"
              style={{
                background:
                  PROTEIN_COLORS[recipe.proteins[0]] ??
                  "linear-gradient(135deg, #FEE9E1, #bbf7d0)",
              }}
              aria-hidden="true"
            />
          )}
        </div>

        <div className="px-4 pt-5 space-y-5">
          <h1 className="text-2xl font-bold text-[#1A1A1A] leading-snug">
            {recipe.name}
          </h1>

          <div className="flex items-center gap-4 text-sm text-[#6B7280]">
            {recipe.time_min != null && (
              <span className="flex items-center gap-1.5">
                <Clock size={14} aria-hidden="true" />
                {recipe.time_min} {t("common.min")}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Users size={14} aria-hidden="true" />
              {recipe.servings}
            </span>
          </div>

          {recipe.author_display_name && (
            <p className="text-xs text-[#9CA3AF]">
              {t("recipe.by")}{" "}
              <span className="font-medium text-[#6B7280]">
                {recipe.author_display_name}
              </span>
            </p>
          )}

          {hasMacros && (
            <div className="grid grid-cols-4 gap-2">
              {macros.map(({ key, value, unit }) => (
                <div
                  key={key}
                  className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-3 text-center"
                >
                  <div className="text-[9px] text-[#9CA3AF] uppercase tracking-wide leading-tight font-medium">
                    {t(key)}
                  </div>
                  <div className="text-lg font-bold text-[#1A1A1A] mt-0.5">
                    {value ?? "—"}
                  </div>
                  <div className="text-[9px] text-[#9CA3AF] font-medium">{unit}</div>
                </div>
              ))}
            </div>
          )}

          {recipe.recipe_ingredients.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-[#1A1A1A] mb-3">
                {t("recipe.ingredients")}
              </h2>
              <div className="space-y-3">
                {sections.map(({ label, items }) => (
                  <div
                    key={label ?? "__main__"}
                    className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden"
                  >
                    {label && (
                      <div className="px-4 py-2 border-b border-[#F3F4F6]">
                        <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">
                          {label}
                        </span>
                      </div>
                    )}
                    <ul className="divide-y divide-[#F3F4F6]">
                      {items.map((ing) => (
                        <li
                          key={ing.id}
                          className={`px-4 py-3 text-sm ${ing.is_optional ? "text-[#6B7280]" : "text-[#1A1A1A]"}`}
                        >
                          {ing.raw_text.replace(/^\(opcional\)\s*/i, "")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {recipe.recipe_steps.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-[#1A1A1A] mb-3">
                {t("recipe.steps")}
              </h2>
              <ol className="space-y-4">
                {recipe.recipe_steps.map((step, i) => (
                  <li key={step.id} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center mt-0.5 bg-[#FEE9E1] text-[#D94F2B]">
                      {i + 1}
                    </span>
                    <p className="text-sm leading-relaxed text-[#374151]">
                      {step.text}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>

      {/* Sign-in CTA — exposes the invitation, not the gated action */}
      <div
        className="fixed left-0 right-0 bottom-0 px-4 py-3 bg-[#FAFAF8] border-t border-[#F0F0EE]"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto max-w-md">
          <Link
            to="/"
            className="w-full rounded-2xl bg-[#F4623A] text-white py-3.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#D94F2B] transition-colors"
          >
            {t("publicRecipe.signInCta", "Criar conta para guardar e planear")}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
