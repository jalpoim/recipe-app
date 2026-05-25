import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useDeferredValue,
  memo,
} from "react";
import { motion, useAnimationControls } from "framer-motion";
import { useMotion } from "../../../lib/use-reduced-motion";
import { FlyingThumb } from "../../../components/FlyingThumb";
import { capture } from "../../../lib/analytics";
import {
  ArrowUpDown,
  Check,
  Clock,
  Plus,
  Search,
  SlidersHorizontal,
  SlidersVertical,
  X,
} from "lucide-react";
import { Drawer } from "vaul";
import { useTranslation } from "react-i18next";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  fetchLibrary,
  fetchLibraryMeta,
  type RecipeWithIngredients,
  type Sort,
  type LibraryCursor,
} from "../../../lib/supabase/queries";
import { addRecipeToPlan } from "../../../lib/supabase/plan-queries";
import {
  fetchMyProfile,
  fetchIngredientExclusions,
  saveDietaryPreferences,
} from "../../../lib/supabase/profile-queries";
import { useToast } from "../../../components/Toast";
import type { Recipe, DietaryMode } from "../../../types/db";

const DIETARY_FLAGS: Record<DietaryMode, string[]> = {
  none: [],
  vegetarian: ["meat", "poultry", "fish", "shellfish"],
  vegan: ["meat", "poultry", "fish", "shellfish", "dairy", "egg", "honey"],
  pescatarian: ["meat", "poultry"],
};

// Muted pastel thumbnail colors per protein slug
const PROTEIN_COLORS: Record<string, string> = {
  chicken: "linear-gradient(135deg, #fef3c7, #fde68a)",
  beef: "linear-gradient(135deg, #fee2e2, #fecaca)",
  pork: "linear-gradient(135deg, #fce7f3, #fbcfe8)",
  salmon: "linear-gradient(135deg, #ffe4e6, #fecdd3)",
  tuna: "linear-gradient(135deg, #dbeafe, #bfdbfe)",
  cod: "linear-gradient(135deg, #e0f2fe, #bae6fd)",
  eggs: "linear-gradient(135deg, #fefce8, #fef9c3)",
  shrimp: "linear-gradient(135deg, #fff7ed, #fed7aa)",
  turkey: "linear-gradient(135deg, #fef9c3, #fef08a)",
  lamb: "linear-gradient(135deg, #fdf4ff, #f5d0fe)",
  sardine: "linear-gradient(135deg, #e0f2fe, #7dd3fc)",
  hake: "linear-gradient(135deg, #f0fdf4, #bbf7d0)",
  "sea-bream": "linear-gradient(135deg, #eff6ff, #bfdbfe)",
  "sea-bass": "linear-gradient(135deg, #f0fdfa, #99f6e4)",
  mackerel: "linear-gradient(135deg, #fefce8, #fde047)",
  octopus: "linear-gradient(135deg, #fdf4ff, #e9d5ff)",
  tofu: "linear-gradient(135deg, #FEE9E1, #bbf7d0)",
  legumes: "linear-gradient(135deg, #d1fae5, #a7f3d0)",
  whey: "linear-gradient(135deg, #ede9fe, #ddd6fe)",
};

const PAGE_SIZE = 24;

const PROTEIN_TIER1 = [
  "chicken",
  "beef",
  "pork",
  "salmon",
  "tuna",
  "cod",
  "eggs",
  "shrimp",
];
const PROTEIN_TIER2 = [
  "turkey",
  "lamb",
  "sardine",
  "hake",
  "sea-bream",
  "sea-bass",
  "mackerel",
  "octopus",
  "tofu",
  "legumes",
  "whey",
];

// ---------- hooks ----------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------- search param schema ----------

type SheetSection = "protein" | "time" | "calories" | "tags" | "ingredients";

const TAG_SECTIONS: { key: string; tags: string[] }[] = [
  {
    key: "method",
    tags: [
      "air-fryer",
      "forno",
      "fogão",
      "micro-ondas",
      "sem-cozinha",
      "uma-frigideira",
      "bimby",
      "grelhador",
    ],
  },
  {
    key: "cuisine",
    tags: [
      "português",
      "mediterrâneo",
      "italiano",
      "francês",
      "europeu",
      "americano",
      "mexicano",
      "indiano",
      "asiático",
      "japonês",
      "coreano",
      "árabe",
      "africano",
      "latino-americano",
    ],
  },
  {
    key: "diet",
    tags: [
      "sem-glúten",
      "vegetariano",
      "vegano",
      "sem-lactose",
      "alto-proteína",
      "low-carb",
      "fit",
    ],
  },
  {
    key: "type",
    tags: [
      "pequeno-almoço",
      "almoço",
      "jantar",
      "snack",
      "sobremesa",
      "sopa",
      "pós-treino",
      "batido",
    ],
  },
  {
    key: "context",
    tags: [
      "meal-prep",
      "rápido",
      "reconfortante",
      "leve",
      "económico",
      "família",
      "festivo",
      "5-ingredientes",
      "semana",
      "verão",
    ],
  },
];
const TAG_SECTION_LIMIT = 6;

type StripChipId =
  | "em-alta"
  | "rapido"
  | "alto-proteina"
  | "chicken"
  | "salmon"
  | "beef"
  | "tuna"
  | "batido"
  | "snack"
  | "meal-prep";

type StripChipDef = {
  id: StripChipId;
  iconSrc: string;
  labelKey: string;
  proteins?: string[];
  tags?: string[];
  maxTime?: number;
  sort?: Sort;
};

const STRIP_CHIPS: StripChipDef[] = [
  {
    id: "em-alta",
    iconSrc: "/icons/chips/em-alta.png",
    labelKey: "strip.emAlta",
    sort: "popular",
  },
  {
    id: "rapido",
    iconSrc: "/icons/chips/rapido.png",
    labelKey: "tags.rápido",
    maxTime: 30,
  },
  {
    id: "alto-proteina",
    iconSrc: "/icons/chips/alto-proteina.png",
    labelKey: "strip.proteicas",
    tags: ["alto-proteína"],
  },
  {
    id: "chicken",
    iconSrc: "/icons/chips/chicken.png",
    labelKey: "proteins.chicken",
    proteins: ["chicken"],
  },
  {
    id: "salmon",
    iconSrc: "/icons/chips/salmon.png",
    labelKey: "proteins.salmon",
    proteins: ["salmon"],
  },
  {
    id: "beef",
    iconSrc: "/icons/chips/beef.png",
    labelKey: "proteins.beef",
    proteins: ["beef"],
  },
  {
    id: "tuna",
    iconSrc: "/icons/chips/tuna.png",
    labelKey: "proteins.tuna",
    proteins: ["tuna"],
  },
  {
    id: "batido",
    iconSrc: "/icons/chips/batido.png",
    labelKey: "tags.batido",
    tags: ["batido"],
  },
  {
    id: "snack",
    iconSrc: "/icons/chips/snack.png",
    labelKey: "tags.snack",
    tags: ["snack"],
  },
  {
    id: "meal-prep",
    iconSrc: "/icons/chips/meal-prep.png",
    labelKey: "tags.meal-prep",
    tags: ["meal-prep"],
  },
];

const DIETARY_MODES: DietaryMode[] = [
  "none",
  "vegetarian",
  "vegan",
  "pescatarian",
];
const DIETARY_INTOLERANCES = ["gluten", "dairy", "egg", "nuts", "soy"] as const;

function getTimeAwareChip(): StripChipId {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const isWeekend = day === 0 || day === 6;
  if (isWeekend) return "meal-prep";
  if (hour >= 6 && hour < 10) return "em-alta";
  if (hour >= 14 && hour < 17) return "snack";
  if (hour >= 17 && hour < 22) return "rapido";
  return "em-alta";
}

type LibrarySearch = {
  q: string;
  proteins: string[];
  maxCal: number | undefined;
  maxTime: number | undefined;
  tags: string[];
  ingredients: string[];
  sort: Sort;
};

function CardSkeleton() {
  return (
    <div className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm overflow-hidden animate-pulse">
      <div className="flex h-[136px]">
        <div className="w-[96px] shrink-0 bg-[#F3F4F6]" />
        <div className="flex-1 p-3 flex flex-col gap-2.5">
          <div className="h-3.5 bg-[#F3F4F6] rounded-full w-4/5" />
          <div className="h-3 bg-[#F3F4F6] rounded-full w-3/5" />
          <div className="h-3 bg-[#F3F4F6] rounded-full w-1/2" />
          <div className="flex gap-1.5 mt-1">
            <div className="h-5 w-16 bg-[#F3F4F6] rounded-full" />
            <div className="h-5 w-16 bg-[#F3F4F6] rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StripChipButton({
  chip,
  isActive,
  onChipClick,
}: {
  chip: StripChipDef;
  isActive: boolean;
  onChipClick: (id: StripChipId) => void;
}) {
  const { t } = useTranslation();
  const controls = useAnimationControls();
  const { skip: reducedMotion } = useMotion();

  function handleClick() {
    onChipClick(chip.id);
    if (!reducedMotion) {
      controls.start({
        scale: [1, 1.15, 1],
        transition: { duration: 0.3, ease: [0.34, 1.56, 0.64, 1] },
      });
    }
  }

  return (
    <button
      onClick={handleClick}
      aria-pressed={isActive}
      className={`flex-none flex flex-col items-center gap-1.5 px-3 pt-2.5 pb-2 rounded-2xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 ${
        isActive ? "bg-[#F4623A]" : "bg-white border border-[#F0F0EE]"
      }`}
    >
      <motion.span
        animate={controls}
        className="flex flex-col items-center gap-1.5"
      >
        <img
          src={chip.iconSrc}
          alt=""
          className="w-10 h-10 rounded-xl object-cover"
          aria-hidden="true"
        />
        <span
          className={`text-[10px] font-semibold whitespace-nowrap ${isActive ? "text-white" : "text-[#6B7280]"}`}
        >
          {t(chip.labelKey)}
        </span>
      </motion.span>
    </button>
  );
}

const ChipStrip = memo(function ChipStrip({
  chips,
  activeChipId,
  onChipClick,
}: {
  chips: StripChipDef[];
  activeChipId: StripChipId | null;
  onChipClick: (id: StripChipId) => void;
}) {
  return (
    <div
      className="flex gap-2.5 overflow-x-auto pt-2 pb-3 -mx-4 px-4"
      style={{ scrollbarWidth: "none" }}
    >
      {chips.map((chip) => (
        <StripChipButton
          key={chip.id}
          chip={chip}
          isActive={activeChipId === chip.id}
          onChipClick={onChipClick}
        />
      ))}
    </div>
  );
});

function LibrarySkeleton() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <div className="mx-auto w-full max-w-md px-4 py-5 space-y-3">
        <div className="h-6 w-24 bg-[#F3F4F6] rounded-full animate-pulse mb-4" />
        <div className="h-10 bg-[#F3F4F6] rounded-xl animate-pulse" />
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-7 w-20 bg-[#F3F4F6] rounded-full animate-pulse"
            />
          ))}
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function LibraryError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">
          Não foi possível carregar as receitas
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

export const Route = createFileRoute("/app/library/")({
  pendingComponent: LibrarySkeleton,
  errorComponent: ({ error }) => <LibraryError error={error as Error} />,
  validateSearch: (search): LibrarySearch => ({
    q: typeof search.q === "string" ? search.q : "",
    proteins: Array.isArray(search.proteins)
      ? (search.proteins as string[])
      : [],
    maxCal: typeof search.maxCal === "number" ? search.maxCal : undefined,
    maxTime: typeof search.maxTime === "number" ? search.maxTime : undefined,
    tags: Array.isArray(search.tags) ? (search.tags as string[]) : [],
    ingredients: Array.isArray(search.ingredients)
      ? (search.ingredients as string[])
      : [],
    sort: (
      ["pcal", "protein", "calories", "time", "popular", "cooked"] as Sort[]
    ).includes(search.sort as Sort)
      ? (search.sort as Sort)
      : "pcal",
  }),
  component: LibraryPage,
});

// ---------- helpers ----------

function perServing(
  r: Recipe,
  field: "calories" | "protein" | "carbs" | "fat",
) {
  const raw = r[field] ?? 0;
  return r.macros_total ? raw / (r.servings || 1) : raw;
}

// ---------- RecipeCard ----------

export type ThumbInfo = {
  src: string | null;
  background: string | null;
  rect: DOMRect;
};

function RecipeCard({
  recipe,
  onAddToPlan,
}: {
  recipe: RecipeWithIngredients;
  onAddToPlan?: (thumb: ThumbInfo) => void;
}) {
  const { t } = useTranslation();
  const cal = perServing(recipe, "calories");
  const pro = perServing(recipe, "protein");
  const hasMacros = recipe.calories != null;
  const thumbnailBg = recipe.image_thumb_url
    ? undefined
    : (PROTEIN_COLORS[recipe.proteins[0]] ??
      "linear-gradient(135deg, #FEE9E1, #bbf7d0)");
  const ingredientCount = recipe.recipe_ingredients?.length ?? 0;
  const thumbRef = useRef<HTMLDivElement>(null);
  const thumbControls = useAnimationControls();
  const { skip: reducedMotion } = useMotion();

  return (
    <div className="relative rounded-2xl bg-white border border-[#F0F0EE] shadow-sm active:scale-[0.98] hover:shadow-md transition-[transform,box-shadow] overflow-hidden">
      <Link
        to="/app/library/$recipeId"
        params={{ recipeId: recipe.id }}
        search={{ from: undefined, planItemId: undefined }}
        onClick={() =>
          capture("recipe_viewed", { recipeId: recipe.id, source: "library" })
        }
        className="flex h-[136px]"
      >
        {/* Left: image */}
        <motion.div
          ref={thumbRef}
          animate={thumbControls}
          className="w-[96px] shrink-0 relative"
        >
          {recipe.image_thumb_url ? (
            <img
              src={recipe.image_thumb_url}
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
        </motion.div>

        {/* Right: content */}
        <div className="flex-1 min-w-0 flex flex-col p-3 pb-2 overflow-hidden">
          <h2 className="text-[#1A1A1A] font-semibold text-sm leading-snug line-clamp-2">
            {recipe.name}
          </h2>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#9CA3AF]">
            {recipe.time_min != null && (
              <span className="flex items-center gap-0.5 shrink-0">
                <Clock size={10} aria-hidden="true" />
                {recipe.time_min} min
              </span>
            )}
            {ingredientCount > 0 && (
              <span className="truncate">
                {ingredientCount} {t("recipe.ingredients").toLowerCase()}
              </span>
            )}
          </div>
          {hasMacros && (
            <div className="mt-2 flex gap-1.5">
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#9CA3AF] font-medium">
                {Math.round(cal)} Cal
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#9CA3AF] font-medium">
                {Math.round(pro)}g {t("recipe.proteinAbbr")}
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Add-to-plan tab — bottom-right corner, outside the Link */}
      {onAddToPlan && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!onAddToPlan) return;
            if (!reducedMotion) {
              thumbControls.start({
                scale: [1, 0.85, 1.06, 1],
                transition: { duration: 0.4, ease: [0.34, 1.56, 0.64, 1] },
              });
            }
            const rect = thumbRef.current?.getBoundingClientRect();
            onAddToPlan({
              src: recipe.image_thumb_url ?? null,
              background: thumbnailBg ?? null,
              rect: rect ?? new DOMRect(0, 0, 96, 136),
            });
          }}
          aria-label={t("plan.addRecipe")}
          className="absolute bottom-0 right-0 w-10 h-10 rounded-tl-2xl bg-white border-t border-l border-[#F0F0EE] flex items-center justify-center transition-colors hover:bg-[#FEF2EF] focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus-visible:ring-inset focus:outline-none"
        >
          <img
            src="/icons/nav/add-to-plan.png"
            alt=""
            className="w-5 h-5 object-cover rounded-md"
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}

// ---------- FilterSheet ----------

interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SheetSection;
  search: LibrarySearch;
  allTags: string[];
  allIngredientNames: string[];
  onUpdate: (patch: Partial<LibrarySearch>) => void;
  onClear: () => void;
}

function FilterSheet({
  open,
  onOpenChange,
  section,
  search,
  allTags,
  allIngredientNames,
  onUpdate,
  onClear,
}: FilterSheetProps) {
  const { t } = useTranslation();
  const [ingSearch, setIngSearch] = useState("");
  const debouncedIngSearch = useDebounce(ingSearch, 150);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  );
  const [proteinsExpanded, setProteinsExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const proteinRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const caloriesRef = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const ingredientsRef = useRef<HTMLDivElement>(null);

  const sectionRefMap: Record<
    SheetSection,
    React.RefObject<HTMLDivElement | null>
  > = {
    protein: proteinRef,
    time: timeRef,
    calories: caloriesRef,
    tags: tagsRef,
    ingredients: ingredientsRef,
  };

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const el = sectionRefMap[section]?.current;
      if (el && scrollRef.current) {
        const containerTop = scrollRef.current.getBoundingClientRect().top;
        const elTop = el.getBoundingClientRect().top;
        const offset =
          scrollRef.current.scrollTop + (elTop - containerTop) - 16;
        scrollRef.current.scrollTo({
          top: Math.max(0, offset),
          behavior: "smooth",
        });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [open, section]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredIngs = useMemo(
    () =>
      debouncedIngSearch.length > 0
        ? allIngredientNames.filter(
            (n) =>
              n.toLowerCase().includes(debouncedIngSearch.toLowerCase()) &&
              !search.ingredients.includes(n),
          )
        : [],
    [allIngredientNames, debouncedIngSearch, search.ingredients],
  );

  function toggleProtein(slug: string) {
    const next = search.proteins.includes(slug)
      ? search.proteins.filter((p) => p !== slug)
      : [...search.proteins, slug];
    capture("filter_applied", {
      filterType: "protein",
      value: slug,
      active: !search.proteins.includes(slug),
    });
    onUpdate({ proteins: next });
  }

  function toggleTag(tag: string) {
    const next = search.tags.includes(tag)
      ? search.tags.filter((t) => t !== tag)
      : [...search.tags, tag];
    capture("filter_applied", {
      filterType: "tag",
      value: tag,
      active: !search.tags.includes(tag),
    });
    onUpdate({ tags: next });
  }

  function addIngredient(ing: string) {
    if (!search.ingredients.includes(ing)) {
      onUpdate({ ingredients: [...search.ingredients, ing] });
    }
    setIngSearch("");
  }

  function removeIngredient(ing: string) {
    onUpdate({ ingredients: search.ingredients.filter((i) => i !== ing) });
  }

  const hasActive =
    search.proteins.length > 0 ||
    search.maxCal !== undefined ||
    search.maxTime !== undefined ||
    search.tags.length > 0 ||
    search.ingredients.length > 0;

  const sectionHeader =
    "text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3";

  function chipCls(active: boolean) {
    return `text-xs px-3 py-1.5 rounded-full border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
      active
        ? "bg-[#FEE9E1] border-[#F4623A] text-[#D94F2B]"
        : "bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#F4623A] hover:text-[#D94F2B]"
    }`;
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-white rounded-t-2xl outline-none max-h-[90dvh]"
          aria-label="Filtros"
        >
          {/* drag handle */}
          <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
          </div>

          {/* sheet header */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 pt-1 pb-3">
            <span className="text-base font-semibold text-[#1A1A1A]">
              {t("filters.sheetTitle")}
            </span>
            <button
              onClick={() => onOpenChange(false)}
              aria-label={t("common.close")}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {/* scrollable content */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 pb-4 space-y-6"
          >
            {/* Proteína */}
            <div ref={proteinRef}>
              <p className={sectionHeader}>{t("filters.protein")}</p>
              <div className="flex flex-wrap gap-2">
                {(proteinsExpanded
                  ? [...PROTEIN_TIER1, ...PROTEIN_TIER2]
                  : PROTEIN_TIER1
                ).map((slug) => (
                  <button
                    key={slug}
                    onClick={() => toggleProtein(slug)}
                    aria-pressed={search.proteins.includes(slug)}
                    className={chipCls(search.proteins.includes(slug))}
                  >
                    {t(`proteins.${slug}`, slug)}
                  </button>
                ))}
                <button
                  aria-expanded={proteinsExpanded}
                  onClick={() => setProteinsExpanded((e) => !e)}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed border-[#D1D5DB] text-[#9CA3AF] hover:border-[#F4623A] hover:text-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                >
                  {proteinsExpanded
                    ? t("tagSections.verMenos")
                    : t("tagSections.verMais")}
                </button>
              </div>
            </div>

            {/* Ingredientes */}
            <div ref={ingredientsRef}>
              <p className={sectionHeader}>{t("filters.ingredients")}</p>

              {search.ingredients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {search.ingredients.map((ing) => (
                    <button
                      key={ing}
                      onClick={() => removeIngredient(ing)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#FEE9E1] border border-[#F4623A] text-[#D94F2B] font-medium"
                    >
                      {ing} <X size={10} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}

              <div className="relative">
                <input
                  type="text"
                  value={ingSearch}
                  onChange={(e) => setIngSearch(e.target.value)}
                  onFocus={() => {
                    if (!ingredientsRef.current || !scrollRef.current) return;
                    const containerTop =
                      scrollRef.current.getBoundingClientRect().top;
                    const elTop =
                      ingredientsRef.current.getBoundingClientRect().top;
                    const offset =
                      scrollRef.current.scrollTop + (elTop - containerTop) - 16;
                    scrollRef.current.scrollTo({
                      top: Math.max(0, offset),
                      behavior: "smooth",
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && ingSearch.trim()) {
                      addIngredient(ingSearch.trim());
                      setIngSearch("");
                    }
                  }}
                  placeholder={t("filters.searchIngredient")}
                  className="w-full rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 pr-9 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors"
                />
                {ingSearch.trim().length > 0 && (
                  <button
                    onClick={() => {
                      addIngredient(ingSearch.trim());
                      setIngSearch("");
                    }}
                    aria-label={t("filters.searchFreeText", {
                      term: ingSearch.trim(),
                    })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#F4623A] text-white flex items-center justify-center hover:bg-[#D94F2B] transition-colors focus:outline-none"
                  >
                    <Plus size={13} aria-hidden="true" />
                  </button>
                )}
              </div>

              {filteredIngs.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-white border border-[#E5E7EB] divide-y divide-[#F3F4F6]">
                  {filteredIngs.slice(0, 40).map((ing) => (
                    <button
                      key={ing}
                      onClick={() => addIngredient(ing)}
                      className="w-full text-left text-sm px-3 py-2.5 text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                    >
                      {ing}
                    </button>
                  ))}
                </div>
              )}

              {debouncedIngSearch.length > 0 && filteredIngs.length === 0 && (
                <button
                  onClick={() => {
                    addIngredient(ingSearch.trim());
                    setIngSearch("");
                  }}
                  className="mt-2 w-full text-left text-sm px-3 py-2.5 rounded-xl border border-dashed border-[#D1D5DB] text-[#6B7280] hover:border-[#F4623A] hover:text-[#F4623A] transition-colors"
                >
                  + {t("filters.searchFreeText", { term: ingSearch.trim() })}
                </button>
              )}
            </div>

            {/* Tempo */}
            <div ref={timeRef}>
              <p className={sectionHeader}>{t("filters.time")}</p>
              <div className="flex flex-wrap gap-2">
                {([15, 30, 60] as const).map((mins) => (
                  <button
                    key={mins}
                    onClick={() => {
                      const next = search.maxTime === mins ? undefined : mins;
                      capture("filter_applied", {
                        filterType: "maxTime",
                        value: next ?? null,
                      });
                      onUpdate({ maxTime: next });
                    }}
                    aria-pressed={search.maxTime === mins}
                    className={chipCls(search.maxTime === mins)}
                  >
                    {"< "}
                    {mins} min
                  </button>
                ))}
              </div>
            </div>

            {/* Calorias */}
            <div ref={caloriesRef}>
              <p className={sectionHeader}>{t("filters.calories")}</p>
              <div className="flex flex-wrap gap-2">
                {([300, 500, 700] as const).map((cal) => (
                  <button
                    key={cal}
                    onClick={() => {
                      const next = search.maxCal === cal ? undefined : cal;
                      capture("filter_applied", {
                        filterType: "maxCal",
                        value: next ?? null,
                      });
                      onUpdate({ maxCal: next });
                    }}
                    aria-pressed={search.maxCal === cal}
                    className={chipCls(search.maxCal === cal)}
                  >
                    {"< "}
                    {cal} cal
                  </button>
                ))}
              </div>
            </div>

            {/* Tags — sectioned */}
            <div ref={tagsRef}>
              <p className={sectionHeader}>{t("filters.tags")}</p>
              <div className="space-y-4">
                {TAG_SECTIONS.map(({ key, tags: sectionTags }) => {
                  const available = sectionTags.filter((tag) =>
                    allTags.includes(tag),
                  );
                  if (available.length === 0) return null;
                  const expanded = expandedSections.has(key);
                  const visible = expanded
                    ? available
                    : available.slice(0, TAG_SECTION_LIMIT);
                  const hasMore = available.length > TAG_SECTION_LIMIT;
                  return (
                    <div key={key}>
                      <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                        {t(`tagSections.${key}`)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {visible.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => toggleTag(tag)}
                            aria-pressed={search.tags.includes(tag)}
                            className={chipCls(search.tags.includes(tag))}
                          >
                            {t(`tags.${tag}`, { defaultValue: tag })}
                          </button>
                        ))}
                        {hasMore && (
                          <button
                            onClick={() =>
                              setExpandedSections((prev) => {
                                const next = new Set(prev);
                                expanded ? next.delete(key) : next.add(key);
                                return next;
                              })
                            }
                            className="text-xs px-3 py-1.5 rounded-full border border-dashed border-[#D1D5DB] text-[#9CA3AF] hover:border-[#F4623A] hover:text-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
                          >
                            {expanded
                              ? t("tagSections.verMenos")
                              : t("tagSections.verMais")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* bottom action */}
          <div className="flex-shrink-0 px-4 py-4 border-t border-[#F0F0EE]">
            {hasActive ? (
              <button
                onClick={() => {
                  onClear();
                  onOpenChange(false);
                }}
                className="w-full text-sm font-medium text-[#DC2626] py-2.5 rounded-xl border border-[#fecaca] bg-[#fee2e2] hover:bg-[#fecaca] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
              >
                {t("filters.clearFilters")}
              </button>
            ) : (
              <button
                onClick={() => onOpenChange(false)}
                className="w-full text-sm font-medium text-[#6B7280] py-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
              >
                {t("common.close")}
              </button>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------- SortSheet ----------

const SORT_OPTIONS: { value: Sort; labelKey: string }[] = [
  { value: "pcal", labelKey: "sort.pcal" },
  { value: "popular", labelKey: "sort.popular" },
  { value: "protein", labelKey: "sort.protein" },
  { value: "calories", labelKey: "sort.calories" },
  { value: "time", labelKey: "sort.time" },
  { value: "cooked", labelKey: "sort.cooked" },
];

function SortSheet({
  open,
  onOpenChange,
  current,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: Sort;
  onSelect: (s: Sort) => void;
}) {
  const { t } = useTranslation();
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-white rounded-t-2xl outline-none"
          aria-label={t("sort.label")}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
          </div>
          <div className="px-4 pt-1 pb-2">
            <p className="text-base font-semibold text-[#1A1A1A]">
              {t("sort.label")}
            </p>
          </div>
          <div className="pb-6">
            {SORT_OPTIONS.map(({ value, labelKey }) => (
              <button
                key={value}
                onClick={() => {
                  onSelect(value);
                  onOpenChange(false);
                }}
                className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F4623A]/40"
              >
                <span
                  className={
                    current === value ? "font-semibold text-[#F4623A]" : ""
                  }
                >
                  {t(labelKey)}
                </span>
                {current === value && (
                  <Check
                    size={16}
                    className="text-[#F4623A]"
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------- DietarySheet ----------

function DietarySheet({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profile:
    | { dietary_mode: DietaryMode; intolerances: string[] }
    | null
    | undefined;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [savedMsg, setSavedMsg] = useState(false);

  const mode: DietaryMode = profile?.dietary_mode ?? "none";
  const intolerances: string[] = profile?.intolerances ?? [];

  const mutation = useMutation({
    mutationFn: (vars: { dietaryMode: DietaryMode; intolerances: string[] }) =>
      saveDietaryPreferences({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["ingredient-exclusions"] });
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    },
  });

  function setMode(m: DietaryMode) {
    mutation.mutate({ dietaryMode: m, intolerances });
  }

  function toggleIntolerance(flag: string) {
    const next = intolerances.includes(flag)
      ? intolerances.filter((f) => f !== flag)
      : [...intolerances, flag];
    mutation.mutate({ dietaryMode: mode, intolerances: next });
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-white rounded-t-2xl outline-none"
          aria-label={t("settings.dietary")}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
          </div>
          <div className="flex items-center justify-between px-4 pt-1 pb-3">
            <span className="text-base font-semibold text-[#1A1A1A]">
              {t("settings.dietary")}
            </span>
            <button
              onClick={() => onOpenChange(false)}
              aria-label={t("common.close")}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="px-4 pb-8 space-y-4">
            <div>
              <p className="text-xs font-medium text-[#6B7280] mb-2">
                {t("settings.dietaryModeLabel")}
              </p>
              <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden divide-y divide-[#F3F4F6]">
                {DIETARY_MODES.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    disabled={mutation.isPending}
                    className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none disabled:opacity-60"
                  >
                    <span className="font-medium">
                      {t(
                        `settings.dietary${m.charAt(0).toUpperCase() + m.slice(1)}`,
                      )}
                    </span>
                    {mode === m && (
                      <Check
                        size={16}
                        className="text-[#F4623A]"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-[#6B7280] mb-2">
                {t("settings.intolerancesLabel")}
              </p>
              <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden divide-y divide-[#F3F4F6]">
                {DIETARY_INTOLERANCES.map((flag) => {
                  const active = intolerances.includes(flag);
                  return (
                    <button
                      key={flag}
                      onClick={() => toggleIntolerance(flag)}
                      disabled={mutation.isPending}
                      className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none disabled:opacity-60"
                    >
                      <span className="font-medium">
                        {t(
                          `settings.intolerance${flag.charAt(0).toUpperCase() + flag.slice(1)}`,
                        )}
                      </span>
                      {active && (
                        <Check
                          size={16}
                          className="text-[#F4623A]"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {savedMsg && (
              <p className="text-xs text-[#F4623A] text-center">
                {t("settings.dietarySaved")}
              </p>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------- LibraryPage ----------

function LibraryPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "pt";
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/app/library/" });
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSection, setSheetSection] = useState<SheetSection>("protein");
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [dietaryOpen, setDietaryOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("dietary_banner_dismissed") === "1",
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAnimatedRef = useRef(false);
  const [flyingThumb, setFlyingThumb] = useState<{
    src: string | null;
    background: string | null;
    from: { x: number; y: number; w: number; h: number };
    to: { x: number; y: number };
  } | null>(null);
  const { skip: reducedMotion } = useMotion();
  const [initialScrollOffset] = useState(() => {
    if (typeof sessionStorage === "undefined") return 0;
    return Number(sessionStorage.getItem("library_scroll") || "0");
  });

  const [stripChip, setStripChip] = useState<StripChipId | null>(() => {
    if (typeof sessionStorage === "undefined") return getTimeAwareChip();
    const saved = sessionStorage.getItem("library_strip_chip");
    if (saved && STRIP_CHIPS.find((c) => c.id === saved))
      return saved as StripChipId;
    return getTimeAwareChip();
  });

  const handleChipClick = useCallback((chipId: StripChipId) => {
    setStripChip((prev) => {
      const next = prev === chipId ? null : chipId;
      if (next) sessionStorage.setItem("library_strip_chip", next);
      else sessionStorage.removeItem("library_strip_chip");
      return next;
    });
  }, []);

  function update(patch: Partial<LibrarySearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  }

  function openSheet(section: SheetSection) {
    setSheetSection(section);
    setSheetOpen(true);
  }

  function clearFilters() {
    update({
      q: "",
      proteins: [],
      maxCal: undefined,
      maxTime: undefined,
      tags: [],
      ingredients: [],
    });
  }

  const [localQ, setLocalQ] = useState(search.q);
  const debouncedQ = useDebounce(localQ, 500);
  const deferredQ = useDeferredValue(search.q);

  useEffect(() => {
    if (debouncedQ !== search.q) {
      update({ q: debouncedQ });
      if (debouncedQ) capture("search_performed", { query: debouncedQ });
    }
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLocalQ(search.q);
  }, [search.q]);

  const handleScroll = useCallback(() => {
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => {
      if (parentRef.current) {
        sessionStorage.setItem(
          "library_scroll",
          String(parentRef.current.scrollTop),
        );
      }
    }, 200);
  }, []);

  // Tap active Recipes tab → scroll to top and clear saved position
  useEffect(() => {
    function handler() {
      sessionStorage.removeItem("library_scroll");
      parentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
    window.addEventListener("tab:scroll-top:library", handler);
    return () => window.removeEventListener("tab:scroll-top:library", handler);
  }, []);

  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchMyProfile(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: excludedIngredientIds = [] } = useQuery({
    queryKey: ["ingredient-exclusions"],
    queryFn: () => fetchIngredientExclusions(),
    staleTime: 5 * 60 * 1000,
  });

  const userExcludedFlags = useMemo(() => {
    const modeFlags =
      DIETARY_FLAGS[(profile?.dietary_mode ?? "none") as DietaryMode] ?? [];
    const intoleranceFlags = profile?.intolerances ?? [];
    return [...new Set([...modeFlags, ...intoleranceFlags])];
  }, [profile]);

  const hasActiveFilters = Boolean(
    search.q ||
    search.proteins.length ||
    search.maxCal !== undefined ||
    search.maxTime !== undefined ||
    search.tags.length ||
    search.ingredients.length,
  );

  const stripVisible = !hasActiveFilters && !search.q;
  const activeStripChip = stripVisible
    ? STRIP_CHIPS.find((c) => c.id === stripChip)
    : undefined;

  const orderedChips = useMemo(() => {
    if (!stripVisible) return STRIP_CHIPS;
    const idx = STRIP_CHIPS.findIndex((c) => c.id === stripChip);
    if (idx <= 0) return STRIP_CHIPS;
    return [STRIP_CHIPS[idx], ...STRIP_CHIPS.filter((_, i) => i !== idx)];
  }, [stripChip, stripVisible]);

  const effectiveSort: Sort = activeStripChip?.sort ?? search.sort;

  const filterKey = useMemo(
    () => ({
      proteins: activeStripChip?.proteins ?? search.proteins,
      maxCal: search.maxCal,
      maxTime: activeStripChip?.maxTime ?? search.maxTime,
      tags: activeStripChip?.tags ?? search.tags,
      ingredients: search.ingredients,
      q: deferredQ,
      lang,
      excludedFlags: userExcludedFlags,
      excludedIngredientIds,
      stripChip: stripVisible && stripChip ? stripChip : undefined,
    }),
    [
      activeStripChip,
      search.proteins,
      search.maxCal,
      search.maxTime,
      search.tags,
      search.ingredients,
      deferredQ,
      lang,
      userExcludedFlags,
      excludedIngredientIds,
      stripVisible,
      stripChip,
    ],
  );

  const {
    data: infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: ["library", filterKey],
    queryFn: ({ pageParam }) =>
      fetchLibrary({
        data: {
          limit: PAGE_SIZE,
          cursor: (pageParam as LibraryCursor | null) ?? null,
          sort: effectiveSort,
          modes: [],
          proteins: activeStripChip?.proteins ?? search.proteins,
          maxCal: search.maxCal,
          maxTime: activeStripChip?.maxTime ?? search.maxTime,
          tags: activeStripChip?.tags ?? search.tags,
          ingredients: search.ingredients,
          q: search.q,
          excludedFlags: userExcludedFlags,
          excludedIngredientIds,
        },
      }),
    initialPageParam: null as LibraryCursor | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5 * 60 * 1000,
  });

  const allRecipes = useMemo(
    () => infiniteData?.pages.flatMap((p) => p.data) ?? [],
    [infiniteData],
  );

  const sortedRecipes = useMemo(() => {
    const copy = [...allRecipes];
    switch (effectiveSort) {
      case "protein":
        return copy.sort((a, b) => (b.protein ?? 0) - (a.protein ?? 0));
      case "calories":
        return copy.sort((a, b) => (a.calories ?? 0) - (b.calories ?? 0));
      case "time":
        return copy.sort((a, b) => (a.time_min ?? 999) - (b.time_min ?? 999));
      case "popular":
        return copy.sort(
          (a, b) => (b.popularity_score ?? 0) - (a.popularity_score ?? 0),
        );
      case "cooked":
        return copy.sort((a, b) => (b.cook_count ?? 0) - (a.cook_count ?? 0));
      case "pcal":
      default: {
        const ratio = (r: Recipe) => {
          const cal = perServing(r, "calories");
          const pro = perServing(r, "protein");
          if (!cal) return 0;
          return (pro * 10) / cal;
        };
        return copy.sort((a, b) => ratio(b) - ratio(a));
      }
    }
  }, [allRecipes, effectiveSort]);

  const { data: meta } = useQuery({
    queryKey: ["libraryMeta", lang],
    queryFn: () => fetchLibraryMeta({ data: { lang } }),
    staleTime: Infinity,
  });

  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ["libraryMeta", lang],
      queryFn: () => fetchLibraryMeta({ data: { lang } }),
    });
  }, [queryClient, lang]);

  const addToPlanMutation = useMutation({
    mutationFn: (recipeId: string) => addRecipeToPlan({ data: recipeId }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["active-plan"] });
      const previous = queryClient.getQueryData(["active-plan"]);
      queryClient.setQueryData(
        ["active-plan"],
        (old: Record<string, unknown> | undefined) => {
          if (!old) return old;
          return { ...old, item_count: ((old.item_count as number) ?? 0) + 1 };
        },
      );
      return { previous };
    },
    onSuccess: () => {
      showToast(t("recipe.addedToPlan"), "success");
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["active-plan"], context.previous);
      }
      showToast(t("recipe.addedToPlanError"), "error");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["active-plan"] });
      queryClient.invalidateQueries({ queryKey: ["plan-items"] });
    },
  });

  const virtualCount = hasNextPage
    ? sortedRecipes.length + 1
    : sortedRecipes.length;
  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 148,
    overscan: 5,
    initialOffset: initialScrollOffset,
  });

  const fetchNextPageStable = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const items = virtualizer.getVirtualItems();
    const lastItem = items[items.length - 1];
    if (!lastItem) return;
    if (lastItem.index >= sortedRecipes.length - 1) {
      fetchNextPageStable();
    }
  }, [
    virtualizer.getVirtualItems(),
    sortedRecipes.length,
    fetchNextPageStable,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFilterCount =
    search.proteins.length +
    (search.maxCal !== undefined ? 1 : 0) +
    (search.maxTime !== undefined ? 1 : 0) +
    search.tags.length +
    search.ingredients.length;

  if (isError) return <LibraryError error={error as Error} />;

  return (
    <div className="h-dvh bg-[#FAFAF8] flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-md px-4 flex flex-col flex-1 min-h-0">
        {/* Sticky header */}
        <div
          className="pt-4 pb-2 shrink-0 touch-none"
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* Row 1: Search bar + dietary button */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center rounded-xl border border-[#E5E7EB] bg-white shadow-sm overflow-hidden focus-within:border-[#F4623A] focus-within:ring-2 focus-within:ring-[#F4623A]/20 transition-colors">
              <Search
                size={15}
                className="shrink-0 ml-3 text-[#9CA3AF] pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={localQ}
                onChange={(e) => setLocalQ(e.target.value)}
                placeholder={t("filters.searchRecipe")}
                aria-label={t("filters.searchRecipe")}
                className="flex-1 py-2.5 px-2 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none bg-transparent min-w-0"
              />
              {localQ && (
                <button
                  onClick={() => {
                    setLocalQ("");
                    update({ q: "" });
                  }}
                  aria-label="Limpar pesquisa"
                  className="shrink-0 mr-2 p-1 text-[#9CA3AF] hover:text-[#6B7280] transition-colors focus:outline-none rounded"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </div>
            <button
              onClick={() => setDietaryOpen(true)}
              aria-label={t("settings.dietary")}
              className={`shrink-0 w-10 h-10 rounded-xl border bg-white shadow-sm flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
                (profile?.dietary_mode && profile.dietary_mode !== "none") ||
                (profile?.intolerances && profile.intolerances.length > 0)
                  ? "border-[#F4623A] text-[#D94F2B]"
                  : "border-[#E5E7EB] text-[#9CA3AF] hover:text-[#6B7280] hover:border-[#D1D5DB]"
              }`}
            >
              <SlidersVertical size={16} aria-hidden="true" />
            </button>
          </div>

          {/* Row 2: Filtros + Ordenar + count */}
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={() => openSheet("protein")}
              aria-label={t("filters.sheetTitle")}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 ${
                activeFilterCount > 0
                  ? "border-[#F4623A] bg-[#FEE9E1] text-[#D94F2B]"
                  : "border-[#E5E7EB] bg-white text-[#6B7280] hover:border-[#D1D5DB]"
              }`}
            >
              <SlidersHorizontal size={12} aria-hidden="true" />
              {t("filters.sheetTitle")}
              {activeFilterCount > 0 && (
                <span className="min-w-[16px] h-4 px-0.5 rounded-full bg-[#F4623A] text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setSortSheetOpen(true)}
              aria-label={t("sort.label")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 ${
                search.sort !== "pcal" && !activeStripChip?.sort
                  ? "border-[#F4623A] bg-[#FEE9E1] text-[#D94F2B]"
                  : "border-[#E5E7EB] bg-white text-[#6B7280] hover:border-[#D1D5DB]"
              }`}
            >
              <ArrowUpDown size={12} aria-hidden="true" />
              {t("sort.label")}
            </button>
            {!isLoading && sortedRecipes.length > 0 && (
              <span className="ml-auto text-xs text-[#9CA3AF]">
                {sortedRecipes.length}
                {hasNextPage ? "+" : ""}{" "}
                {sortedRecipes.length === 1
                  ? t("common.recipes_one")
                  : t("common.recipes_other")}
              </span>
            )}
          </div>
        </div>

        {/* Always-rendered scroll container — chips live here so they
            scroll away naturally without being affected by list load state */}
        <div
          ref={parentRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-20"
          style={{ overscrollBehaviorY: "contain" }}
        >
          {/* Strip chips — memoized, unaffected by list re-renders */}
          {stripVisible && (
            <ChipStrip
              chips={orderedChips}
              activeChipId={stripChip}
              onChipClick={handleChipClick}
            />
          )}

          {/* Dietary banner — dismissible */}
          {userExcludedFlags.length > 0 && !bannerDismissed && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-[#fef3c7] border border-[#fde68a] px-3 py-2 text-xs text-[#B45309]">
              <span className="flex-1">{t("library.dietaryBanner")}</span>
              <button
                onClick={() => {
                  setBannerDismissed(true);
                  localStorage.setItem("dietary_banner_dismissed", "1");
                }}
                aria-label={t("common.close")}
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center hover:bg-[#fde68a] transition-colors focus:outline-none"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          )}

          {/* List content — only this section transitions between states */}
          {isLoading ? (
            <div className="space-y-3 pt-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : sortedRecipes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24">
              <p className="text-[#6B7280] text-sm">{t("filters.empty")}</p>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-2 text-xs text-[#F4623A] underline"
                >
                  {t("filters.clearFilters")}
                </button>
              )}
            </div>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const isSentinel = virtualItem.index >= sortedRecipes.length;
                const shouldAnimate =
                  !reducedMotion &&
                  !hasAnimatedRef.current &&
                  virtualItem.index < sortedRecipes.length;
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                      paddingBottom: "12px",
                    }}
                  >
                    {isSentinel ? (
                      <div className="py-4 flex justify-center">
                        {isFetchingNextPage && (
                          <div className="h-5 w-5 rounded-full border-2 border-[#F4623A] border-t-transparent animate-spin" />
                        )}
                      </div>
                    ) : (
                      <motion.div
                        initial={shouldAnimate ? { opacity: 0 } : false}
                        animate={shouldAnimate ? { opacity: 1 } : undefined}
                        transition={
                          shouldAnimate
                            ? {
                                delay: Math.min(virtualItem.index * 0.04, 0.3),
                                duration: 0.25,
                                ease: "easeOut",
                              }
                            : undefined
                        }
                        onAnimationComplete={() => {
                          if (shouldAnimate) hasAnimatedRef.current = true;
                        }}
                      >
                        <RecipeCard
                          recipe={sortedRecipes[virtualItem.index]}
                          onAddToPlan={(thumb) => {
                            const r = sortedRecipes[virtualItem.index];
                            if (!reducedMotion) {
                              const planTabEl =
                                document.getElementById("nav-plan-tab") ??
                                document.querySelector('[data-tab="plan"]');
                              const toRect = planTabEl?.getBoundingClientRect();
                              const vw = window.innerWidth;
                              const vh = window.innerHeight;
                              const to = toRect
                                ? {
                                    x: toRect.left + toRect.width / 2 - 10,
                                    y: toRect.top + toRect.height / 2 - 10,
                                  }
                                : { x: vw * 0.625 - 10, y: vh - 36 };
                              setFlyingThumb({
                                src: thumb.src,
                                background: thumb.background,
                                from: {
                                  x: thumb.rect.left,
                                  y: thumb.rect.top,
                                  w: thumb.rect.width,
                                  h: thumb.rect.height,
                                },
                                to,
                              });
                            }
                            addToPlanMutation.mutate(r.id);
                          }}
                        />
                      </motion.div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        section={sheetSection}
        search={search}
        allTags={meta?.tags ?? []}
        allIngredientNames={meta?.ingredients ?? []}
        onUpdate={update}
        onClear={clearFilters}
      />

      <SortSheet
        open={sortSheetOpen}
        onOpenChange={setSortSheetOpen}
        current={search.sort}
        onSelect={(s) => update({ sort: s })}
      />

      <DietarySheet
        open={dietaryOpen}
        onOpenChange={setDietaryOpen}
        profile={
          profile
            ? {
                dietary_mode: profile.dietary_mode as DietaryMode,
                intolerances: profile.intolerances,
              }
            : null
        }
      />

      {flyingThumb && (
        <FlyingThumb
          src={flyingThumb.src}
          background={flyingThumb.background}
          from={flyingThumb.from}
          to={flyingThumb.to}
          onDone={() => setFlyingThumb(null)}
        />
      )}
    </div>
  );
}
