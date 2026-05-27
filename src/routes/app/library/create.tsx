import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState, useRef, useMemo, useEffect } from "react";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronUp,
  Link2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { Drawer } from "vaul";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  createRecipe,
  estimateMacros,
  fetchUserProteins,
  createUserProtein,
  deleteUserProtein,
  parseRecipeUrl,
  type IngredientRow,
  type StepRow,
} from "../../../lib/supabase/recipe-queries";
import { parseIngredientText } from "../../../lib/parse-recipe-url";
import { supabase } from "../../../lib/supabase/browser";
import { convertToGrams } from "../../../lib/units";
import { deriveProteinsFromIngredients } from "../../../lib/proteins";
import { useToast } from "../../../components/Toast";
import { ProteinPicker } from "../../../components/ProteinPicker";
import { fetchMyProfile } from "../../../lib/supabase/profile-queries";
import { IngredientCombobox } from "../../../components/IngredientCombobox";

export const Route = createFileRoute("/app/library/create")({
  component: CreateRecipePage,
});

// ─── tag sections ────────────────────────────────────────────────────────────

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

const SYSTEM_TAG_SLUGS = TAG_SECTIONS.flatMap((s) => s.tags);

// ─── helpers ─────────────────────────────────────────────────────────────────

function estimateMacrosFromIngredients(
  ingredients: IngredientRow[],
  servings: number,
): { calories: number; protein: number; carbs: number; fat: number } | null {
  const active = ingredients.filter((i) => i.rawText.trim());
  if (active.length === 0) return null;
  let calories = 0,
    protein = 0,
    carbs = 0,
    fat = 0,
    covered = 0;
  for (const ing of active) {
    if (ing.caloriesPer100g == null) continue;
    if (!ing.quantity) continue;
    const g = convertToGrams(ing.quantity, ing.unit ?? "g");
    if (g == null || g === 0) continue;
    const f = g / 100;
    calories += (ing.caloriesPer100g ?? 0) * f;
    protein += (ing.proteinPer100g ?? 0) * f;
    carbs += (ing.carbsPer100g ?? 0) * f;
    fat += (ing.fatPer100g ?? 0) * f;
    covered++;
  }
  if (covered < active.length * 0.5) return null;
  const s = Math.max(1, servings);
  return {
    calories: Math.round(calories / s),
    protein: Math.round((protein / s) * 10) / 10,
    carbs: Math.round((carbs / s) * 10) / 10,
    fat: Math.round((fat / s) * 10) / 10,
  };
}

const PROTEIN_PATTERNS: Record<string, RegExp> = {
  chicken: /frango|chicken|peito|coxa/i,
  beef: /vaca|beef|bife|novilho/i,
  pork: /porco|pork|leitão|lombo/i,
  salmon: /salmão|salmon/i,
  tuna: /atum|tuna/i,
  fish: /peixe|fish|bacalhau|robalo|dourada|pescada|sardinha/i,
  eggs: /ovos?|ovo|egg/i,
  seafood: /camarão|marisco|seafood|gambas|lula|mexilhão/i,
  turkey: /peru|turkey/i,
  duck: /pato|duck/i,
  veal: /vitela|veal/i,
  lamb: /borrego|lamb/i,
  tofu: /tofu/i,
  whey: /whey/i,
  legumes: /feijão|lentilha|grão-de-bico|leguminosas/i,
};

function isProteinIngredient(name: string, proteins: string[]): boolean {
  return proteins.some((slug) => PROTEIN_PATTERNS[slug]?.test(name));
}

function suggestRecipeName(
  proteins: string[],
  names: string[],
  t: TFunction,
): string {
  const proteinLabel = proteins[0] ? t(`proteins.${proteins[0]}`) : null;
  const others = names
    .filter((n) => n.length > 2 && !isProteinIngredient(n, proteins))
    .slice(0, 2);
  if (!proteinLabel) return names.slice(0, 3).join(", ");
  if (others.length === 0) return proteinLabel;
  return `${proteinLabel} com ${others.join(" e ")}`;
}

// ─── component ───────────────────────────────────────────────────────────────

function CreateRecipePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const lang = i18n.language.startsWith("en") ? "en" : "pt";

  const keyCounter = useRef(0);
  const [ingredientKeys, setIngredientKeys] = useState<number[]>([0]);
  const prevServingsRef = useRef(2);
  const scaleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── core state ──────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [servings, setServings] = useState(2);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageExpanded, setImageExpanded] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    {
      position: 0,
      rawText: "",
      quantity: null,
      unit: null,
      name: null,
      isOptional: false,
    },
  ]);
  const [steps, setSteps] = useState<StepRow[]>([
    { position: 0, text: "", timerSeconds: null },
  ]);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [macrosManuallyEdited, setMacrosManuallyEdited] = useState(false);
  const [selectedProteins, setSelectedProteins] = useState<string[]>([]);
  const [proteinsManuallyEdited, setProteinsManuallyEdited] = useState(false);
  const [timeMin, setTimeMin] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState("");
  const [publish, setPublish] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [scaleConfirm, setScaleConfirm] = useState<{
    factor: number;
    newServings: number;
  } | null>(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(
    null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── import state ─────────────────────────────────────────────────────────────
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importedSourceUrl, setImportedSourceUrl] = useState<string | null>(
    null,
  );
  const [importedImagePreview, setImportedImagePreview] = useState<
    string | null
  >(null);

  // ── queries ─────────────────────────────────────────────────────────────────
  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchMyProfile(),
    staleTime: 5 * 60 * 1000,
  });
  const measurementSystem: "metric" | "imperial" =
    profile?.measurement_unit === "imperial" ? "imperial" : "metric";

  const { data: userProteins = [], refetch: refetchUserProteins } = useQuery({
    queryKey: ["user-proteins"],
    queryFn: () => fetchUserProteins(),
    staleTime: 5 * 60 * 1000,
  });

  // ── derived ─────────────────────────────────────────────────────────────────
  const derivedProteins = useMemo(
    () => deriveProteinsFromIngredients(ingredients),
    [ingredients],
  );
  const effectiveProteins = proteinsManuallyEdited
    ? selectedProteins
    : derivedProteins;

  const estimatedMacros = useMemo(
    () => estimateMacrosFromIngredients(ingredients, servings),
    [ingredients, servings],
  );

  const hasIngredients = ingredients.some((i) => i.rawText.trim());
  const uncoveredCount = useMemo(
    () =>
      ingredients.filter((i) => i.rawText.trim() && i.caloriesPer100g == null)
        .length,
    [ingredients],
  );
  const allCovered = hasIngredients && uncoveredCount === 0;

  // Effective macro display values (auto or manual)
  const effCalories =
    !macrosManuallyEdited && estimatedMacros != null
      ? String(estimatedMacros.calories)
      : calories;
  const effProtein =
    !macrosManuallyEdited && estimatedMacros != null
      ? String(estimatedMacros.protein)
      : protein;
  const effCarbs =
    !macrosManuallyEdited && estimatedMacros != null
      ? String(estimatedMacros.carbs)
      : carbs;
  const effFat =
    !macrosManuallyEdited && estimatedMacros != null
      ? String(estimatedMacros.fat)
      : fat;

  const macroSource = macrosManuallyEdited
    ? "manual"
    : estimatedMacros != null
      ? "auto"
      : null;

  // Duplicate indices
  const duplicateIndices = useMemo(() => {
    const seen = new Map<string, number>();
    const dups = new Set<number>();
    ingredients.forEach((ing, idx) => {
      const key = ing.ingredientId
        ? `id:${ing.ingredientId}`
        : `text:${ing.rawText.toLowerCase().trim()}`;
      if (key === "text:") return;
      if (seen.has(key)) {
        dups.add(idx);
        dups.add(seen.get(key)!);
      } else {
        seen.set(key, idx);
      }
    });
    return dups;
  }, [ingredients]);

  // Auto-name suggestion
  const rawSuggestion = useMemo(() => {
    if (name.trim()) return null;
    const active = ingredients.filter((i) => i.rawText.trim());
    if (active.length < 2) return null;
    return suggestRecipeName(
      effectiveProteins,
      active.map((i) => i.name ?? i.rawText),
      t,
    );
  }, [name, ingredients, effectiveProteins, t]);

  const autoNameSuggestion =
    rawSuggestion !== null && rawSuggestion !== dismissedSuggestion
      ? rawSuggestion
      : null;

  // ── mutations ────────────────────────────────────────────────────────────────
  const addCustomProteinMutation = useMutation({
    mutationFn: (displayName: string) =>
      createUserProtein({ data: { displayName, language: lang } }),
    onSuccess: (p) => {
      refetchUserProteins();
      setSelectedProteins((prev) => [...prev, p.slug]);
      setProteinsManuallyEdited(true);
    },
  });

  const deleteCustomProteinMutation = useMutation({
    mutationFn: (id: string) => deleteUserProtein({ data: id }),
    onSuccess: () => refetchUserProteins(),
  });

  const estimateMutation = useMutation({
    mutationFn: () =>
      estimateMacros({
        data: {
          name: name.trim(),
          ingredients: ingredients
            .filter((i) => i.rawText.trim() && i.caloriesPer100g == null)
            .map((i) => i.rawText),
          servings,
        },
      }),
    onSuccess: (result) => {
      if (result.calories != null) setCalories(String(result.calories));
      if (result.protein != null) setProtein(String(result.protein));
      if (result.carbs != null) setCarbs(String(result.carbs));
      if (result.fat != null) setFat(String(result.fat));
      setMacrosManuallyEdited(true);
      showToast(t("create.macrosEstimated"), "success");
    },
    onError: () => showToast(t("create.macrosEstimateError"), "error"),
  });

  const importMutation = useMutation({
    mutationFn: (url: string) => parseRecipeUrl({ data: { url } }),
    onSuccess: (result) => {
      if (!result) {
        showToast(t("import.errorNoSchema"), "error");
        return;
      }
      setImportSheetOpen(false);
      setImportUrl("");
      setImportError(null);
      setImportedSourceUrl(result.sourceUrl);
      if (result.imageUrl) {
        setImageUrl(result.imageUrl);
        setImportedImagePreview(result.imageUrl);
      }
      if (result.name) setName(result.name);
      {
        const sv = result.servings ?? 1;
        prevServingsRef.current = sv;
        setServings(sv);
      }
      if (result.timeMin) setTimeMin(String(result.timeMin));
      if (result.ingredients.length > 0) {
        const newKey = ++keyCounter.current;
        const parsed: IngredientRow[] = result.ingredients.map((raw, idx) => {
          const p = parseIngredientText(raw);
          return {
            position: idx,
            rawText: raw,
            quantity: p.quantity,
            unit: p.unit,
            name: p.name,
            isOptional: false,
          };
        });
        setIngredients(parsed);
        setIngredientKeys(parsed.map((_, i) => newKey + i));
      }
      if (result.steps.length > 0) {
        setSteps(
          result.steps.map((text, idx) => ({
            position: idx,
            text,
            timerSeconds: null,
          })),
        );
      }
      if (
        result.calories != null ||
        result.protein != null ||
        result.carbs != null ||
        result.fat != null
      ) {
        if (result.calories != null) setCalories(String(result.calories));
        if (result.protein != null) setProtein(String(result.protein));
        if (result.carbs != null) setCarbs(String(result.carbs));
        if (result.fat != null) setFat(String(result.fat));
        setMacrosManuallyEdited(true);
      }
    },
    onError: (err) => {
      const msg = (err as Error).message ?? "";
      if (msg.startsWith("fetch_failed")) {
        setImportError(t("import.errorFetch"));
      } else {
        setImportError(t("import.errorNoSchema"));
      }
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const effectiveName = name.trim() || autoNameSuggestion || name.trim();
      return createRecipe({
        data: {
          name: effectiveName,
          servings,
          timeMin: timeMin ? parseInt(timeMin, 10) : null,
          proteins: effectiveProteins,
          tags: selectedTags,
          calories: effCalories ? parseFloat(effCalories) : null,
          protein: effProtein ? parseFloat(effProtein) : null,
          carbs: effCarbs ? parseFloat(effCarbs) : null,
          fat: effFat ? parseFloat(effFat) : null,
          visibility: publish ? "public" : "private",
          imageUrl,
          sourceUrl: importedSourceUrl,
          ingredients: ingredients
            .filter((i) => i.rawText.trim())
            .map((ing, idx) => ({ ...ing, position: idx })),
          steps: steps
            .filter((s) => s.text.trim())
            .map((s, idx) => ({ ...s, position: idx })),
          lang,
        },
      });
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      navigate({
        to: "/app/library/$recipeId",
        params: { recipeId: id },
        search: { from: undefined, planItemId: undefined },
      });
    },
    onError: () => showToast(t("common.error"), "error"),
  });

  // ── handlers ─────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    const effectiveName = name.trim() || autoNameSuggestion || "";
    if (!effectiveName) errs.name = t("create.validationName");
    if (!ingredients.some((i) => i.rawText.trim()))
      errs.ingredients = t("create.validationIngredients");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleServingsChange(newVal: number) {
    const prev = prevServingsRef.current;
    if (newVal !== prev && ingredients.some((i) => i.quantity != null)) {
      if (scaleTimerRef.current) clearTimeout(scaleTimerRef.current);
      setScaleConfirm({ factor: newVal / prev, newServings: newVal });
      scaleTimerRef.current = setTimeout(() => setScaleConfirm(null), 3000);
    }
    prevServingsRef.current = newVal;
    setServings(newVal);
  }

  function applyScale(factor: number) {
    setIngredients((prev) =>
      prev.map((ing) =>
        ing.quantity != null
          ? { ...ing, quantity: Math.round(ing.quantity * factor * 10) / 10 }
          : ing,
      ),
    );
    setIngredientKeys((prev) => prev.map((k) => k + 10000));
    setScaleConfirm(null);
    if (scaleTimerRef.current) clearTimeout(scaleTimerRef.current);
  }

  function addIngredient() {
    const newKey = ++keyCounter.current;
    setIngredientKeys((prev) => [...prev, newKey]);
    setIngredients((prev) => [
      ...prev,
      {
        position: prev.length,
        rawText: "",
        quantity: null,
        unit: null,
        name: null,
        isOptional: false,
      },
    ]);
  }

  function updateIngredient(index: number, updated: IngredientRow) {
    setIngredients((prev) =>
      prev.map((ing, i) => (i === index ? updated : ing)),
    );
  }

  function removeIngredient(index: number) {
    setIngredientKeys((prev) => prev.filter((_, i) => i !== index));
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  function addStep() {
    setSteps((prev) => [
      ...prev,
      { position: prev.length, text: "", timerSeconds: null },
    ]);
  }

  function updateStep(index: number, text: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, text } : s)));
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleProtein(slug: string) {
    const base = proteinsManuallyEdited ? selectedProteins : derivedProteins;
    const next = base.includes(slug)
      ? base.filter((p) => p !== slug)
      : [...base, slug];
    setSelectedProteins(next);
    setProteinsManuallyEdited(true);
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function addCustomTag() {
    const slug = customTagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!slug || selectedTags.includes(slug)) return;
    setSelectedTags((prev) => [...prev, slug]);
    setCustomTagInput("");
  }

  async function handleImageFile(file: File) {
    setImageUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("not authenticated");
      const path = `${session.user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("recipe-images")
        .upload(path, file, { upsert: true });
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from("recipe-images").getPublicUrl(path);
      setImageUrl(publicUrl);
    } catch {
      showToast(t("common.error"), "error");
    } finally {
      setImageUploading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (scaleTimerRef.current) clearTimeout(scaleTimerRef.current);
    };
  }, []);

  // ── style tokens ─────────────────────────────────────────────────────────────
  const chipBase =
    "text-xs px-3 py-1.5 rounded-full border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none";
  const chipActive = "bg-[#FEE9E1] border-[#F4623A] text-[#D94F2B]";
  const chipInactive =
    "bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#F4623A]";

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#FAFAF8] border-b border-[#F0F0EE]">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.history.back()}
            aria-label={t("recipe.back")}
            className="flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none rounded"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("recipe.back")}
          </button>
          <h1 className="text-base font-semibold text-[#1A1A1A]">
            {t("create.title")}
          </h1>
          <button
            type="button"
            onClick={() => {
              if (validate()) saveMutation.mutate();
            }}
            disabled={saveMutation.isPending}
            className="text-sm font-semibold text-[#F4623A] disabled:opacity-50 hover:text-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none rounded"
          >
            {saveMutation.isPending ? t("create.saving") : t("create.save")}
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-5 space-y-4">
        {/* Import from URL — primary entry point */}
        {!importedSourceUrl && (
          <button
            type="button"
            onClick={() => setImportSheetOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#E5E7EB] bg-white px-4 py-4 text-sm font-medium text-[#6B7280] hover:border-[#F4623A] hover:text-[#F4623A] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
          >
            <Link2 size={16} aria-hidden="true" />
            {t("import.trigger")}
          </button>
        )}

        {/* Import banner */}
        {importedSourceUrl && (
          <div className="flex items-start gap-2 rounded-2xl bg-[#F0FDF4] border border-[#16A34A]/30 px-4 py-3">
            <Link2
              size={14}
              className="text-[#16A34A] shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs text-[#15803d]">
              {t("import.banner", {
                domain: new URL(importedSourceUrl).hostname.replace(
                  /^www\./,
                  "",
                ),
              })}
            </p>
          </div>
        )}

        {/* 1. Name + servings row */}
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("create.namePlaceholder")}
            className={`w-full rounded-xl border bg-[#F9FAFB] px-4 py-3 text-[16px] font-semibold text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors ${errors.name ? "border-[#DC2626]" : "border-[#E5E7EB]"}`}
          />
          {errors.name && (
            <p className="text-xs text-[#DC2626]">{errors.name}</p>
          )}

          {/* Auto-name suggestion chip */}
          {autoNameSuggestion && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[#9CA3AF]">Sugestão:</span>
              <button
                type="button"
                onClick={() => setName(autoNameSuggestion)}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-[#F9FAFB] border border-[#E5E7EB] text-[#1A1A1A] hover:border-[#F4623A] transition-colors"
              >
                {autoNameSuggestion}
                <span
                  role="button"
                  aria-label="Dispensar sugestão"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDismissedSuggestion(autoNameSuggestion);
                  }}
                  className="ml-0.5 text-[#9CA3AF] hover:text-[#DC2626]"
                >
                  <X size={10} aria-hidden="true" />
                </span>
              </button>
            </div>
          )}

          {/* Servings stepper */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#6B7280]">
              {t("create.servingsLabel")}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleServingsChange(Math.max(1, servings - 1))}
                disabled={servings <= 1}
                aria-label={t("recipe.decreaseServings")}
                className="w-8 h-8 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#1A1A1A] disabled:opacity-30 hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
              >
                <Minus size={14} aria-hidden="true" />
              </button>
              <span className="w-6 text-center font-bold text-[#1A1A1A]">
                {servings}
              </span>
              <button
                type="button"
                onClick={() => handleServingsChange(servings + 1)}
                aria-label={t("recipe.increaseServings")}
                className="w-8 h-8 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#1A1A1A] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Scale confirm row */}
          {scaleConfirm && (
            <div className="flex items-center justify-between rounded-xl bg-[#FFF5F2] border border-[#F4623A]/30 px-3 py-2 text-sm">
              <span className="text-[#6B7280]">
                Ajustar quantidades para {scaleConfirm.newServings} porções?
              </span>
              <div className="flex gap-2 ml-2 shrink-0">
                <button
                  type="button"
                  onClick={() => applyScale(scaleConfirm.factor)}
                  className="text-xs font-semibold text-[#F4623A] hover:text-[#D94F2B]"
                >
                  Sim
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScaleConfirm(null);
                    if (scaleTimerRef.current)
                      clearTimeout(scaleTimerRef.current);
                  }}
                  className="text-xs font-semibold text-[#9CA3AF] hover:text-[#6B7280]"
                >
                  Não
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 2. Image (collapsed by default) */}
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden">
          {!imageExpanded && !imageUrl ? (
            <button
              type="button"
              onClick={() => setImageExpanded(true)}
              className="w-full flex items-center gap-2 px-4 py-3.5 text-sm text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F9FAFB] transition-colors focus:outline-none"
            >
              <Camera size={16} aria-hidden="true" />+ {t("create.imageLabel")}
            </button>
          ) : (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#1A1A1A]">
                  {t("create.imageLabel")}
                </span>
                {!imageUrl && (
                  <button
                    type="button"
                    onClick={() => setImageExpanded(false)}
                    className="text-[#9CA3AF] hover:text-[#6B7280]"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              {imageUrl ? (
                <div className="relative">
                  <img
                    src={imageUrl}
                    alt="Imagem da receita"
                    className="w-full h-40 object-cover rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                    aria-label="Remover imagem"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-32 rounded-xl border-2 border-dashed border-[#E5E7EB] cursor-pointer hover:border-[#F4623A] hover:bg-[#FFF5F2] transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageFile(file);
                    }}
                  />
                  {imageUploading ? (
                    <div className="w-5 h-5 rounded-full border-2 border-[#F4623A] border-t-transparent animate-spin" />
                  ) : (
                    <>
                      <Camera
                        size={20}
                        className="text-[#9CA3AF] mb-1"
                        aria-hidden="true"
                      />
                      <span className="text-xs text-[#9CA3AF]">
                        Toca para adicionar foto
                      </span>
                    </>
                  )}
                </label>
              )}
            </div>
          )}
        </div>

        {/* Import URL bottom sheet */}
        <Drawer.Root
          open={importSheetOpen}
          onOpenChange={setImportSheetOpen}
          shouldScaleBackground
        >
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-white px-4 pb-8 pt-3 focus:outline-none">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#E5E7EB]" />
              <Drawer.Title className="mb-4 text-base font-semibold text-[#1A1A1A]">
                {t("import.trigger")}
              </Drawer.Title>
              <input
                type="url"
                value={importUrl}
                onChange={(e) => {
                  setImportUrl(e.target.value);
                  if (importError) setImportError(null);
                }}
                placeholder={t("import.placeholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && importUrl.trim()) {
                    importMutation.mutate(importUrl.trim());
                  }
                }}
                className={`w-full rounded-xl border bg-[#F9FAFB] px-4 py-3 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 transition-colors mb-3 ${importError ? "border-[#DC2626] focus:border-[#DC2626]" : "border-[#E5E7EB] focus:border-[#F4623A]"}`}
              />
              {importError && (
                <div className="mb-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3">
                  <p className="text-sm font-medium text-[#DC2626] mb-0.5">
                    {t("import.errorTitle")}
                  </p>
                  <p className="text-xs text-[#B91C1C]">{importError}</p>
                </div>
              )}
              {importedImagePreview && !imageUrl && (
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-2">
                  <img
                    src={importedImagePreview}
                    alt={t("import.trigger")}
                    className="h-12 w-12 rounded-lg object-cover shrink-0"
                  />
                  <p className="text-xs text-[#6B7280]">
                    Imagem da receita original (referência)
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  if (importUrl.trim()) importMutation.mutate(importUrl.trim());
                }}
                disabled={!importUrl.trim() || importMutation.isPending}
                className="w-full rounded-2xl bg-[#F4623A] py-3.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
              >
                {importMutation.isPending
                  ? t("import.importing")
                  : t("import.button")}
              </button>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        {/* 3. Ingredients */}
        <div
          className={`rounded-2xl bg-white border shadow-sm p-4 space-y-3 ${errors.ingredients ? "border-[#DC2626]" : "border-[#E5E7EB]"}`}
        >
          <p className="text-sm font-semibold text-[#1A1A1A]">
            {t("create.ingredientsLabel")}
          </p>
          {ingredients.map((ing, idx) => (
            <IngredientCombobox
              key={ingredientKeys[idx]}
              value={ing}
              index={idx}
              onValueChange={(updated) => updateIngredient(idx, updated)}
              onRemove={() => removeIngredient(idx)}
              measurementSystem={measurementSystem}
              isDuplicate={duplicateIndices.has(idx)}
              lang={lang}
            />
          ))}
          <button
            type="button"
            onClick={addIngredient}
            className="w-full rounded-xl border border-dashed border-[#D1D5DB] text-sm text-[#F4623A] py-2.5 hover:border-[#F4623A] hover:bg-[#FFF5F2] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
          >
            + {t("create.addIngredient")}
          </button>
          {errors.ingredients && (
            <p className="text-xs text-[#DC2626]">{errors.ingredients}</p>
          )}
        </div>

        {/* 4. Steps */}
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4 space-y-3">
          <p className="text-sm font-semibold text-[#1A1A1A]">
            {t("create.stepsLabel")}
          </p>
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-[#FEE9E1] text-[#D94F2B] text-xs font-bold flex items-center justify-center mt-2.5">
                {idx + 1}
              </span>
              <textarea
                value={step.text}
                onChange={(e) => updateStep(idx, e.target.value)}
                placeholder={t("create.stepPlaceholder")}
                rows={2}
                className="flex-1 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors"
              />
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStep(idx)}
                  aria-label="Remover passo"
                  className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#fee2e2] transition-colors mt-1.5 focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addStep}
            className="w-full rounded-xl border border-dashed border-[#D1D5DB] text-sm text-[#F4623A] py-2.5 hover:border-[#F4623A] hover:bg-[#FFF5F2] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
          >
            + {t("create.addStep")}
          </button>
        </div>

        {/* 5. Macros — shown once ≥1 ingredient exists */}
        {hasIngredients && (
          <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[#1A1A1A]">
                {t("create.macrosLabel")}
              </p>
              {macroSource && (
                <span className="text-[11px] text-[#9CA3AF]">
                  {macroSource === "auto"
                    ? t("create.macrosAutoLabel", "(calculado automaticamente)")
                    : t("create.macrosManualLabel", "(editado manualmente)")}
                </span>
              )}
            </div>

            {/* Haiku estimate button — only when some ingredients lack DB data */}
            {!allCovered && (
              <button
                type="button"
                onClick={() => estimateMutation.mutate()}
                disabled={estimateMutation.isPending}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-sm text-[#F4623A] font-medium disabled:opacity-40 hover:bg-[#FFF5F2] hover:border-[#F4623A] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
              >
                {estimateMutation.isPending && (
                  <div className="w-4 h-4 rounded-full border-2 border-[#F4623A] border-t-transparent animate-spin" />
                )}
                {t(
                  "create.estimateMacrosRemaining",
                  "Estimar macros restantes",
                )}
              </button>
            )}

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: t("create.caloriesLabel"),
                  value: effCalories,
                  setter: setCalories,
                },
                {
                  label: t("create.proteinLabel"),
                  value: effProtein,
                  setter: setProtein,
                },
                {
                  label: t("create.carbsLabel"),
                  value: effCarbs,
                  setter: setCarbs,
                },
                { label: t("create.fatLabel"), value: effFat, setter: setFat },
              ].map(({ label, value, setter }) => (
                <div key={label}>
                  <label className="block text-xs text-[#6B7280] mb-1">
                    {label}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={value}
                    onChange={(e) => {
                      setter(e.target.value);
                      setMacrosManuallyEdited(true);
                    }}
                    className="w-full rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[16px] text-[#1A1A1A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 6. Optional details (proteins, time, tags, publish) */}
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setOptionalOpen((o) => !o)}
            aria-expanded={optionalOpen}
            className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-semibold text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors focus:outline-none"
          >
            Mais detalhes
            {optionalOpen ? (
              <ChevronUp
                size={16}
                className="text-[#9CA3AF]"
                aria-hidden="true"
              />
            ) : (
              <ChevronDown
                size={16}
                className="text-[#9CA3AF]"
                aria-hidden="true"
              />
            )}
          </button>

          {optionalOpen && (
            <div className="px-4 pb-4 pt-1 border-t border-[#F3F4F6] space-y-5">
              {/* Proteins */}
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A] mb-3">
                  {t("create.proteinsLabel")}
                </p>
                <ProteinPicker
                  selected={effectiveProteins}
                  onToggle={toggleProtein}
                  userProteins={userProteins}
                  onAddCustom={(displayName) =>
                    addCustomProteinMutation.mutate(displayName)
                  }
                  onDeleteUserProtein={(id) =>
                    deleteCustomProteinMutation.mutate(id)
                  }
                  autoDetected={
                    !proteinsManuallyEdited ? derivedProteins : undefined
                  }
                />
              </div>

              {/* Time */}
              <div>
                <label className="block text-sm font-semibold text-[#1A1A1A] mb-2">
                  {t("create.timeLabel")}
                </label>
                <input
                  type="number"
                  min={1}
                  value={timeMin}
                  onChange={(e) => setTimeMin(e.target.value)}
                  placeholder="30"
                  className="w-full rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[16px] text-[#1A1A1A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors"
                />
              </div>

              {/* Tags */}
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A] mb-3">
                  {t("create.tagsLabel")}
                </p>
                <div className="space-y-4">
                  {TAG_SECTIONS.map(({ key, tags: sectionTags }) => (
                    <div key={key}>
                      <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                        {t(`tagSections.${key}`)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {sectionTags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTag(tag)}
                            aria-pressed={selectedTags.includes(tag)}
                            className={`${chipBase} ${selectedTags.includes(tag) ? chipActive : chipInactive}`}
                          >
                            {t(`tags.${tag}`, { defaultValue: tag })}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {/* Custom tags */}
                  {selectedTags.filter((tag) => !SYSTEM_TAG_SLUGS.includes(tag))
                    .length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                        {t("create.customTagsSection", "Os meus tags")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedTags
                          .filter((tag) => !SYSTEM_TAG_SLUGS.includes(tag))
                          .map((tag) => (
                            <span
                              key={tag}
                              className={`${chipBase} ${chipActive} flex items-center gap-1`}
                            >
                              {tag}
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedTags((prev) =>
                                    prev.filter((t) => t !== tag),
                                  )
                                }
                                aria-label={`Remover tag ${tag}`}
                                className="focus:outline-none"
                              >
                                <X size={10} aria-hidden="true" />
                              </button>
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customTagInput}
                      onChange={(e) => setCustomTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomTag();
                        }
                      }}
                      placeholder={t("create.addCustomTag", "Adicionar tag…")}
                      className="flex-1 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={addCustomTag}
                      disabled={!customTagInput.trim()}
                      className="w-9 h-9 rounded-xl border border-[#E5E7EB] bg-white flex items-center justify-center text-[#F4623A] hover:bg-[#FFF5F2] disabled:opacity-40 transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none shrink-0"
                    >
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Publish toggle */}
              <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <p className="text-sm font-semibold text-[#1A1A1A]">
                    {t("create.publishLabel")}
                  </p>
                  <p className="text-xs text-[#9CA3AF] mt-0.5">
                    {t("create.publishHint")}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={publish}
                  onClick={() => setPublish((p) => !p)}
                  className={`relative w-11 h-6 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${publish ? "bg-[#F4623A]" : "bg-[#D1D5DB]"}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${publish ? "translate-x-5" : "translate-x-0"}`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Save button */}
        <button
          type="button"
          onClick={() => {
            if (validate()) saveMutation.mutate();
          }}
          disabled={saveMutation.isPending}
          className="w-full rounded-2xl bg-[#F4623A] text-white py-4 text-sm font-semibold disabled:opacity-60 hover:bg-[#D94F2B] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
        >
          {saveMutation.isPending ? t("create.saving") : t("create.save")}
        </button>
      </div>
    </div>
  );
}
