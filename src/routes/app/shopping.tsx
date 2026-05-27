import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { capture } from "../../lib/analytics";
import { usePullToRefresh } from "../../lib/use-pull-to-refresh";
import { PullIndicator } from "../../components/PullIndicator";
import { Check, Plus, Share2, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  fetchActivePlanWithCount,
  fetchPlanItems,
} from "../../lib/supabase/plan-queries";
import {
  fetchShoppingChecks,
  upsertCheck,
  addCustomShoppingItem,
  deleteCustomShoppingItem,
  clearNonCustomChecks,
  clearCustomItems,
  fetchCategoryOverrides,
  upsertCategoryOverride,
} from "../../lib/supabase/shopping-queries";
import { searchIngredients } from "../../lib/supabase/recipe-queries";
import type { PlanItemWithRecipe, ShoppingCheckState } from "../../types/db";
import { useToast } from "../../components/Toast";

function ShoppingSkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4 py-5 space-y-3 animate-pulse">
        <div className="h-6 w-40 bg-[#F3F4F6] rounded-full mb-4" />
        <div className="h-10 bg-[#F3F4F6] rounded-xl" />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[#F3F4F6]">
              <div className="h-3.5 w-1/2 bg-[#F3F4F6] rounded-full" />
            </div>
            {[0, 1, 2].map((j) => (
              <div key={j} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-5 h-5 rounded-md bg-[#F3F4F6] shrink-0" />
                <div className="h-3 flex-1 bg-[#F3F4F6] rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShoppingError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">
          Não foi possível carregar a lista
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

export const Route = createFileRoute("/app/shopping")({
  pendingComponent: ShoppingSkeleton,
  errorComponent: ({ error }) => <ShoppingError error={error as Error} />,
  validateSearch: (search) => ({
    view: search.view === "global" ? ("global" as const) : ("recipe" as const),
  }),
  component: ShoppingPage,
});

// ---------- constants ----------

const CATEGORIES = [
  "Talho/Peixaria",
  "Frutas/Legumes",
  "Lacticínios",
  "Mercearia",
  "Outros",
] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_KEYWORDS: [Category, string[]][] = [
  [
    "Talho/Peixaria",
    [
      "frango",
      "carne",
      "bife",
      "peixe",
      "atum",
      "salmão",
      "peru",
      "bacalhau",
      "porco",
      "filete",
      "chicken",
      "salmon",
      "tuna",
      "turkey",
      "cod",
      "beef",
      "pork",
      "shrimp",
      "camarão",
    ],
  ],
  [
    "Lacticínios",
    [
      "leite",
      "iogurte",
      "queijo",
      "manteiga",
      "nata",
      "ovo",
      "ovos",
      "milk",
      "yogurt",
      "cheese",
      "butter",
      "egg",
      "whey",
    ],
  ],
  [
    "Frutas/Legumes",
    [
      "tomate",
      "alface",
      "cenoura",
      "brócolo",
      "espinafre",
      "banana",
      "maçã",
      "cebola",
      "alho",
      "batata",
      "tomato",
      "lettuce",
      "carrot",
      "broccoli",
      "spinach",
      "onion",
      "garlic",
      "potato",
    ],
  ],
  [
    "Mercearia",
    [
      "arroz",
      "massa",
      "aveia",
      "pão",
      "farinha",
      "azeite",
      "óleo",
      "rice",
      "pasta",
      "oats",
      "bread",
      "flour",
      "oil",
      "olive",
    ],
  ],
];

const PANTRY_MODIFIERS = ["enlatad", "desidratad", "em lata", "em conserva"];

function autoCategory(label: string): Category | null {
  const lower = label.toLowerCase();
  if (PANTRY_MODIFIERS.some((m) => lower.includes(m))) return "Mercearia";
  for (const [cat, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return cat;
  }
  return null;
}

// ---------- helpers ----------

function fmtQty(qty: number | null): string {
  if (qty == null || qty === 0) return "";
  if (qty >= 100) return Math.round(qty).toString();
  if (qty % 1 === 0) return qty.toString();
  return qty.toFixed(1);
}

function scaleQty(
  qty: number | null,
  portionMult: number,
  servings: number,
): number | null {
  if (qty == null) return null;
  return qty * (portionMult / (servings || 1));
}

// ---------- sub-components ----------

function ViewToggle({
  view,
  onChange,
}: {
  view: "recipe" | "global";
  onChange: (v: "recipe" | "global") => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex rounded-xl border border-[#E5E7EB] overflow-hidden bg-white">
      {(["recipe", "global"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`flex-1 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
            view === v
              ? "bg-[#F4623A] text-white"
              : "text-[#6B7280] hover:bg-[#F9FAFB]"
          }`}
        >
          {v === "recipe" ? t("shopping.perRecipe") : t("shopping.global")}
        </button>
      ))}
    </div>
  );
}

function CheckRow({
  label,
  qty,
  unit,
  checked,
  partial,
  onToggle,
  onRemove,
}: {
  itemKey: string;
  label: string;
  qty: number | null;
  unit: string | null;
  checked: boolean;
  partial?: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const qtyStr = fmtQty(qty);
  const display = [qtyStr, unit, label].filter(Boolean).join(" ");

  return (
    <button
      onClick={onToggle}
      aria-pressed={checked}
      aria-label={`${checked ? "Desmarcar" : "Marcar"} ${label}`}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F4623A]/40 focus:outline-none active:bg-black/5 transition-colors"
    >
      <span
        aria-hidden="true"
        className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
          checked
            ? "bg-[#F4623A] border-[#F4623A]"
            : partial
              ? "bg-[#FEE9E1] border-[#F4623A]"
              : "border-[#D1D5DB]"
        }`}
      >
        {checked && (
          <Check
            size={11}
            className="text-white"
            strokeWidth={3}
            aria-hidden="true"
          />
        )}
        {partial && !checked && (
          <div className="w-2 h-0.5 bg-[#F4623A] rounded-full" />
        )}
      </span>
      <span
        className={`flex-1 text-sm transition-colors item-text ${
          checked
            ? "item-checked text-[#9CA3AF]"
            : partial
              ? "text-[#6B7280]"
              : "text-[#1A1A1A]"
        }`}
      >
        {display}
      </span>
      {onRemove && (
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remover ${label}`}
          className="shrink-0 text-[#9CA3AF] hover:text-[#DC2626] transition-colors"
        >
          <X size={14} aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

function CategoryPicker({
  current,
  onSelect,
  onClose,
}: {
  current: string;
  onSelect: (cat: Category) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end" onPointerDown={onClose}>
      <div
        className="w-full max-w-md mx-auto bg-white rounded-t-2xl border-t border-[#E5E7EB] pb-6"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
        </div>
        <p className="text-sm font-semibold text-[#1A1A1A] px-4 pb-3">
          {t("shopping.changeCategory")}
        </p>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(cat);
            }}
            className={`w-full cursor-pointer text-left px-4 py-3 text-sm transition-colors hover:bg-[#F9FAFB] focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
              cat === current
                ? "font-semibold text-[#F4623A]"
                : "text-[#1A1A1A]"
            }`}
          >
            {cat}
            {cat === current && (
              <span className="ml-2 text-xs text-[#F4623A]">✓</span>
            )}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Por receita view ----------

type RecipeGroup = {
  recipeId: string;
  name: string;
  ingredients: {
    id: string;
    name: string | null;
    rawText: string | null;
    unit: string | null;
    isOptional: boolean;
    totalQty: number | null;
    itemKeys: string[];
  }[];
};

function buildRecipeGroups(items: PlanItemWithRecipe[]): RecipeGroup[] {
  const groupMap = new Map<string, PlanItemWithRecipe[]>();
  for (const item of items) {
    const list = groupMap.get(item.recipe_id) ?? [];
    list.push(item);
    groupMap.set(item.recipe_id, list);
  }

  return [...groupMap.values()].map((groupItems) => {
    const recipe = groupItems[0].recipe;
    const totalMultiplier = groupItems.reduce(
      (sum, i) => sum + i.portion_multiplier,
      0,
    );

    const ingredients = recipe.recipe_ingredients
      .filter((ing) => !ing.is_pantry)
      .map((ing) => ({
        id: ing.id,
        name: ing.name,
        rawText: ing.raw_text,
        unit: ing.unit,
        isOptional: ing.is_optional ?? false,
        totalQty: scaleQty(ing.quantity, totalMultiplier, recipe.servings),
        itemKeys: groupItems.map((item) => `recipe:${item.id}:${ing.id}`),
      }));

    return { recipeId: recipe.id, name: recipe.name, ingredients };
  });
}

function buildRecipeShareText(groups: RecipeGroup[]): string {
  const lines: string[] = [];
  for (const group of groups) {
    if (group.ingredients.length === 0) continue;
    lines.push(group.name.toUpperCase());
    for (const ing of group.ingredients) {
      const qtyStr = fmtQty(ing.totalQty);
      const name = ing.isOptional
        ? `${ing.name ?? ing.rawText} (opcional)`
        : (ing.name ?? ing.rawText);
      const parts = [qtyStr, ing.unit, name].filter(Boolean);
      lines.push(`• ${parts.join(" ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function RecipeView({
  items,
  checkMap,
  onToggle,
}: {
  items: PlanItemWithRecipe[];
  checkMap: Map<string, boolean>;
  onToggle: (keys: string[], next: boolean) => void;
}) {
  if (items.length === 0) return null;

  const groups = buildRecipeGroups(items);
  const shareText = buildRecipeShareText(groups);

  return (
    <>
      <div className="flex justify-end mb-3">
        <ShareButton text={shareText} />
      </div>
      <div className="space-y-3">
        {groups.map((group) => {
          if (group.ingredients.length === 0) return null;
          return (
            <div
              key={group.recipeId}
              className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-[#F3F4F6]">
                <p className="text-sm font-semibold text-[#1A1A1A]">
                  {group.name}
                </p>
              </div>
              <div className="divide-y divide-[#F3F4F6]">
                {group.ingredients.map((ing) => {
                  const checkedCount = ing.itemKeys.filter(
                    (k) => checkMap.get(k) ?? false,
                  ).length;
                  const allChecked = checkedCount === ing.itemKeys.length;
                  const someChecked = checkedCount > 0 && !allChecked;
                  const label = [
                    ing.name ?? ing.rawText,
                    ing.isOptional ? "(opcional)" : null,
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <CheckRow
                      key={ing.itemKeys[0]}
                      itemKey={ing.itemKeys[0]}
                      label={label}
                      qty={ing.totalQty}
                      unit={ing.unit}
                      checked={allChecked}
                      partial={someChecked}
                      onToggle={() => onToggle(ing.itemKeys, !allChecked)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- Lista global view ----------

type AggItem = {
  recipeKeyQtys: { key: string; qty: number | null }[];
  name: string;
  unit: string | null;
  category: string;
  totalQty: number | null;
  hasUnknownQty: boolean;
  allOptional: boolean;
  isCustom?: boolean;
  onRemove?: () => void;
};

function buildGlobalList(
  items: PlanItemWithRecipe[],
  categoryOverrides: Record<string, string>,
  customItems: ShoppingCheckState[],
  onRemoveCustom: (key: string) => void,
): Map<string, AggItem[]> {
  const aggMap = new Map<string, AggItem>();

  for (const item of items) {
    for (const ing of item.recipe.recipe_ingredients) {
      if (ing.is_pantry) continue;
      const name = (ing.name ?? ing.raw_text).trim();
      const unit = ing.unit ?? null;
      const aggKey = `${name.toLowerCase()}|${unit ?? ""}`;
      const recipeKey = `recipe:${item.id}:${ing.id}`;
      const qty = scaleQty(
        ing.quantity,
        item.portion_multiplier,
        item.recipe.servings,
      );
      const category =
        categoryOverrides[name.toLowerCase()] ??
        ing.category ??
        autoCategory(name) ??
        "Outros";

      const existing = aggMap.get(aggKey);
      if (existing) {
        existing.recipeKeyQtys.push({ key: recipeKey, qty });
        if (qty != null && existing.totalQty != null) {
          existing.totalQty += qty;
        } else {
          existing.hasUnknownQty = true;
        }
        if (!ing.is_optional) existing.allOptional = false;
      } else {
        aggMap.set(aggKey, {
          recipeKeyQtys: [{ key: recipeKey, qty }],
          name,
          unit,
          category,
          totalQty: qty,
          hasUnknownQty: qty == null,
          allOptional: ing.is_optional ?? false,
        });
      }
    }
  }

  // Inject custom items into the same aggregation map
  for (const c of customItems) {
    const name = (c.label ?? c.item_key).trim();
    const category = c.category ?? "Outros";
    aggMap.set(c.item_key, {
      recipeKeyQtys: [{ key: c.item_key, qty: null }],
      name,
      unit: null,
      category,
      totalQty: null,
      hasUnknownQty: true,
      allOptional: false,
      isCustom: true,
      onRemove: () => onRemoveCustom(c.item_key),
    });
  }

  // Group by category
  const byCategory = new Map<string, AggItem[]>();
  for (const item of aggMap.values()) {
    const cat = item.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(item);
  }

  // Sort categories in canonical order
  const ordered = new Map<string, AggItem[]>();
  for (const cat of CATEGORIES) {
    const items = byCategory.get(cat);
    if (items && items.length > 0) {
      ordered.set(
        cat,
        items.sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
  }
  // Any remaining categories not in canonical list
  for (const [cat, items] of byCategory) {
    if (!ordered.has(cat)) ordered.set(cat, items);
  }
  return ordered;
}

function buildShareText(grouped: Map<string, AggItem[]>): string {
  const lines: string[] = [];
  for (const [category, aggItems] of grouped) {
    lines.push(`${category.toUpperCase()}`);
    for (const agg of aggItems) {
      const qtyStr = fmtQty(agg.totalQty);
      const name = agg.allOptional ? `${agg.name} (opcional)` : agg.name;
      const parts = [qtyStr, agg.unit, name].filter(Boolean);
      lines.push(`• ${parts.join(" ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // user cancelled or share failed — fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E5E7EB] bg-white text-xs font-medium text-[#6B7280] hover:border-[#F4623A] hover:text-[#F4623A] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
    >
      <Share2 size={13} aria-hidden="true" />
      {copied ? "Copiado!" : "Partilhar"}
    </button>
  );
}

function GlobalView({
  items,
  checkMap,
  customItems,
  categoryOverrides,
  onToggle,
  onRemoveCustom,
  onCategoryChange,
}: {
  items: PlanItemWithRecipe[];
  checkMap: Map<string, boolean>;
  customItems: ShoppingCheckState[];
  categoryOverrides: Record<string, string>;
  onToggle: (keys: string[], next: boolean) => void;
  onRemoveCustom: (key: string) => void;
  onCategoryChange: (ingredientName: string, cat: Category) => void;
}) {
  const [editingCategory, setEditingCategory] = useState<{
    name: string;
    current: string;
  } | null>(null);

  const grouped = buildGlobalList(
    items,
    categoryOverrides,
    customItems,
    onRemoveCustom,
  );
  const shareText = buildShareText(grouped);

  return (
    <>
      <div className="flex justify-end mb-3">
        <ShareButton text={shareText} />
      </div>
      <div className="space-y-3">
        {[...grouped.entries()].map(([category, aggItems]) => (
          <div
            key={category}
            className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm overflow-hidden"
          >
            <button
              onClick={() =>
                setEditingCategory({ name: category, current: category })
              }
              className="w-full text-left px-4 py-2.5 border-b border-[#F3F4F6] flex items-center justify-between group focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">
                {category}
              </span>
              <span className="text-[10px] text-[#9CA3AF] opacity-0 group-hover:opacity-100 transition-opacity">
                alterar
              </span>
            </button>
            <div className="divide-y divide-[#F3F4F6]">
              {aggItems.map((agg) => {
                const checkedCount = agg.recipeKeyQtys.filter(
                  (k) => checkMap.get(k.key) ?? false,
                ).length;
                const allChecked = checkedCount === agg.recipeKeyQtys.length;
                const someChecked = checkedCount > 0 && !allChecked;
                const unchecked = agg.recipeKeyQtys.filter(
                  (k) => !(checkMap.get(k.key) ?? false),
                );
                const remainingQty = agg.hasUnknownQty
                  ? null
                  : unchecked.reduce((s, k) => s + (k.qty ?? 0), 0);
                const allKeys = agg.recipeKeyQtys.map((k) => k.key);
                const displayName = agg.allOptional
                  ? `${agg.name} (opcional)`
                  : agg.name;
                return (
                  <CheckRow
                    key={agg.recipeKeyQtys[0].key}
                    itemKey={agg.recipeKeyQtys[0].key}
                    label={displayName}
                    qty={allChecked ? agg.totalQty : remainingQty}
                    unit={agg.unit}
                    checked={allChecked}
                    partial={someChecked}
                    onToggle={() => onToggle(allKeys, !allChecked)}
                    onRemove={agg.isCustom ? agg.onRemove : undefined}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Category picker overlay */}
      {editingCategory && (
        <CategoryPicker
          current={editingCategory.current}
          onSelect={(cat) => {
            onCategoryChange(editingCategory.name, cat);
            setEditingCategory(null);
          }}
          onClose={() => setEditingCategory(null)}
        />
      )}
    </>
  );
}

// ---------- AddCustomItemForm ----------

const INGREDIENT_CATEGORY_MAP: Record<string, Category> = {
  meat: "Talho/Peixaria",
  produce: "Frutas/Legumes",
  dairy: "Lacticínios",
  grains: "Mercearia",
  other: "Outros",
};

function AddCustomItemForm({
  onAdd,
  onClose,
}: {
  onAdd: (label: string, category: Category) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "pt";
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<Category>("Outros");
  const [categoryPicked, setCategoryPicked] = useState(false);
  const [showCatPicker, setShowCatPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (window.matchMedia("(hover: hover)").matches) {
      inputRef.current?.focus();
    }
  }, []);

  function handleLabelChange(val: string) {
    setLabel(val);
    if (categoryPicked) return;

    // Immediate keyword fallback
    setCategory(autoCategory(val) ?? "Outros");

    // Debounced DB lookup for a smarter match
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) return;
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchIngredients({
          data: { q: val.trim(), lang },
        });
        if (!results.length) return;
        const top = results[0];
        if ((top.similarity as number) >= 0.25 && top.category) {
          const mapped = INGREDIENT_CATEGORY_MAP[top.category];
          if (mapped) setCategory(mapped);
        }
      } catch {
        // silently ignore — keyword fallback already applied
      }
    }, 350);
  }

  function handleSubmit() {
    const trimmed = label.trim();
    if (!trimmed) return;
    onAdd(trimmed, category);
    setLabel("");
    setCategory("Outros");
    setCategoryPicked(false);
  }

  return (
    <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          name="shopping-item"
          autoComplete="off"
          value={label}
          onChange={(e) => handleLabelChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={t("shopping.itemName")}
          className="flex-1 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors"
        />
        <button
          onClick={onClose}
          aria-label="Cancelar"
          className="text-[#9CA3AF] hover:text-[#6B7280] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none rounded"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowCatPicker(true)}
          className="flex-1 text-left text-xs px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:border-[#F4623A] hover:text-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
        >
          {category}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!label.trim()}
          className="px-4 py-1.5 rounded-xl bg-[#F4623A] text-white text-xs font-semibold disabled:opacity-40 hover:bg-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
        >
          {t("shopping.add")}
        </button>
      </div>

      {showCatPicker && (
        <CategoryPicker
          current={category}
          onSelect={(cat) => {
            setCategory(cat);
            setCategoryPicked(true);
            setShowCatPicker(false);
          }}
          onClose={() => setShowCatPicker(false)}
        />
      )}
    </div>
  );
}

// ---------- ShoppingPage ----------

function ShoppingPage() {
  const { t } = useTranslation();
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useToast();

  const { pullY: shopPullY, isRefreshing: isShopPtrRefreshing } =
    usePullToRefresh({
      onRefresh: async () => {
        await qc.invalidateQueries({ queryKey: ["active-plan"] });
        await qc.invalidateQueries({ queryKey: ["shopping-checks"] });
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

  const { data: checksData, isLoading: isChecksLoading } = useQuery({
    queryKey: ["shopping-checks", planId],
    queryFn: () => fetchShoppingChecks({ data: planId! }),
    enabled: !!planId,
    staleTime: 0,
  });

  // Local check state — initialized from server once per plan, then mutated optimistically
  const [checkMap, setCheckMap] = useState<Map<string, boolean>>(new Map());
  const [customItems, setCustomItems] = useState<ShoppingCheckState[]>([]);
  const [initializedForPlan, setInitializedForPlan] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (checksData && planId && planId !== initializedForPlan) {
      setCheckMap(new Map(checksData.map((c) => [c.item_key, c.is_checked])));
      setCustomItems(
        checksData.filter((c) => c.item_key.startsWith("custom:")),
      );
      setInitializedForPlan(planId);
    }
  }, [checksData, planId, initializedForPlan]);

  // Per-ingredient category overrides — backed by Supabase
  const { data: overridesData = [] } = useQuery({
    queryKey: ["category-overrides"],
    queryFn: fetchCategoryOverrides,
  });

  const overrideMutation = useMutation({
    mutationFn: (vars: { ingredientName: string; category: string }) =>
      upsertCategoryOverride({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["category-overrides"] }),
    onError: () => showToast("Erro ao guardar", "error"),
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmClearChecks, setConfirmClearChecks] = useState(false);
  const [confirmClearCustom, setConfirmClearCustom] = useState(false);

  const isLoading =
    isPlanLoading ||
    (!!planId &&
      (isItemsLoading || isChecksLoading || initializedForPlan !== planId));

  function setView(v: "recipe" | "global") {
    capture("shopping_view_toggled", { view: v });
    // @ts-ignore -- routeTree.gen.ts is regenerated on pnpm dev; view is valid search param
    void navigate({ search: { view: v }, replace: true });
  }

  const categoryOverrides: Record<string, string> = Object.fromEntries(
    overridesData.map((r) => [r.ingredient_name.toLowerCase(), r.category]),
  );

  const hasCustomItems = customItems.length > 0;
  const checkedCount = [...checkMap.values()].filter(Boolean).length;

  function toggleKeys(keys: string[], next: boolean) {
    setCheckMap((prev) => {
      const m = new Map(prev);
      for (const k of keys) m.set(k, next);
      return m;
    });
    for (const k of keys) {
      upsertCheck({
        data: { planId: planId!, itemKey: k, isChecked: next },
      }).catch(() => showToast("Erro ao guardar", "error"));
    }
  }

  function handleCategoryChange(ingredientName: string, cat: Category) {
    overrideMutation.mutate({
      ingredientName: ingredientName.toLowerCase(),
      category: cat,
    });
  }

  function handleAddCustom(label: string, category: Category) {
    const tempKey = `custom:${Date.now()}`;
    const tempItem: ShoppingCheckState = {
      id: tempKey,
      plan_id: planId!,
      item_key: tempKey,
      is_checked: false,
      label,
      category,
      updated_at: null,
    };
    setCustomItems((prev) => [...prev, tempItem]);
    setCheckMap((prev) => new Map(prev).set(tempKey, false));
    setShowAddForm(false);
    setView("global");

    addCustomShoppingItem({ data: { planId: planId!, label, category } })
      .then((saved) => {
        setCustomItems((prev) =>
          prev.map((c) => (c.item_key === tempKey ? saved : c)),
        );
        setCheckMap((prev) => {
          const next = new Map(prev);
          next.delete(tempKey);
          next.set(saved.item_key, false);
          return next;
        });
      })
      .catch(() => showToast("Erro ao adicionar item", "error"));
  }

  function handleRemoveCustom(itemKey: string) {
    setCustomItems((prev) => prev.filter((c) => c.item_key !== itemKey));
    setCheckMap((prev) => {
      const n = new Map(prev);
      n.delete(itemKey);
      return n;
    });
    deleteCustomShoppingItem({ data: { planId: planId!, itemKey } }).catch(() =>
      showToast("Erro ao remover item", "error"),
    );
  }

  function handleClearChecks() {
    const next = new Map(checkMap);
    for (const [k] of next) {
      if (!k.startsWith("custom:")) next.set(k, false);
    }
    setCheckMap(next);
    clearNonCustomChecks({ data: planId! }).catch(() =>
      showToast("Erro ao limpar marcações", "error"),
    );
  }

  function handleClearCustomItems() {
    setCustomItems([]);
    const next = new Map(checkMap);
    for (const [k] of next) {
      if (k.startsWith("custom:")) next.delete(k);
    }
    setCheckMap(next);
    clearCustomItems({ data: planId! }).catch(() =>
      showToast("Erro ao limpar itens", "error"),
    );
  }

  if (isLoading) return <ShoppingSkeleton />;

  const isEmpty = items.length === 0;

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4 pt-4">
        {/* no header row — bottom nav provides tab context */}

        {isEmpty ? (
          <div className="py-16 text-center">
            <p className="text-[#6B7280] text-sm">{t("shopping.emptyHint")}</p>
          </div>
        ) : (
          <>
            {/* View toggle */}
            <div className="mb-4">
              <ViewToggle view={view} onChange={setView} />
            </div>

            <PullIndicator
              pullY={shopPullY}
              isRefreshing={isShopPtrRefreshing}
              variant="flow"
            />

            {/* Add custom item */}
            <div className="mb-4">
              {showAddForm ? (
                <AddCustomItemForm
                  onAdd={handleAddCustom}
                  onClose={() => setShowAddForm(false)}
                />
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-2 w-full rounded-2xl border border-dashed border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#9CA3AF] hover:border-[#F4623A] hover:text-[#F4623A] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                >
                  <Plus size={16} aria-hidden="true" />
                  {t("shopping.addExtra")}
                </button>
              )}
            </div>

            {/* Content — both always mounted so checkMap stays in sync */}
            <div className={view !== "recipe" ? "hidden" : ""}>
              <RecipeView
                items={items}
                checkMap={checkMap}
                onToggle={toggleKeys}
              />
            </div>
            <div className={view !== "global" ? "hidden" : ""}>
              <GlobalView
                items={items}
                checkMap={checkMap}
                customItems={customItems}
                categoryOverrides={categoryOverrides}
                onToggle={toggleKeys}
                onRemoveCustom={handleRemoveCustom}
                onCategoryChange={handleCategoryChange}
              />
            </div>

            {/* Bottom actions */}
            <div className="mt-4 flex flex-col gap-2">
              {checkedCount > 0 &&
                (confirmClearChecks ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmClearChecks(false)}
                      className="flex-1 py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={() => {
                        handleClearChecks();
                        setConfirmClearChecks(false);
                      }}
                      className="flex-1 py-2.5 rounded-xl border border-[#fecaca] bg-[#fee2e2] text-[#DC2626] text-sm font-medium hover:bg-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClearChecks(true)}
                    className="w-full py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#6B7280] hover:text-[#1A1A1A] hover:border-[#D1D5DB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                  >
                    {t("shopping.clearChecks")}
                  </button>
                ))}
              {hasCustomItems &&
                (confirmClearCustom ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmClearCustom(false)}
                      className="flex-1 py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={() => {
                        handleClearCustomItems();
                        setConfirmClearCustom(false);
                      }}
                      className="flex-1 py-2.5 rounded-xl border border-[#fecaca] bg-[#fee2e2] text-[#DC2626] text-sm font-medium hover:bg-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClearCustom(true)}
                    className="w-full py-2.5 rounded-xl border border-[#E5E7EB] bg-white text-sm font-medium text-[#9CA3AF] hover:text-[#DC2626] hover:border-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                  >
                    {t("shopping.clearCustom")}
                  </button>
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
