import { useState, useRef, useEffect } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Drawer } from "vaul";
import {
  searchIngredients,
  type IngredientRow,
} from "../lib/supabase/recipe-queries";

// ---------- constants ----------

export const METRIC_UNITS = ["g", "kg", "ml", "L"] as const;
export const IMPERIAL_UNITS = [
  "oz",
  "lb",
  "cup",
  "tbsp",
  "tsp",
  "fl oz",
] as const;
export const COUNT_UNIT_KEYS = [
  "unit",
  "slice",
  "clove",
  "pinch",
  "bunch",
  "handful",
  "sheet",
  "can",
  "sachet",
  "scoop",
] as const;

const SLUG_TO_PT: Record<string, string> = {
  meat: "Talho/Peixaria",
  produce: "Frutas/Legumes",
  dairy: "Lacticínios",
  grains: "Mercearia",
  other: "Outros",
};

// ---------- useDebounce ----------

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------- UnitSheet ----------

export function UnitSheet({
  open,
  onOpenChange,
  selected,
  onSelect,
  measurementSystem,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selected: string;
  onSelect: (unit: string) => void;
  measurementSystem: "metric" | "imperial";
}) {
  const { t } = useTranslation();

  const sections = [
    ...(measurementSystem === "metric"
      ? [
          {
            labelKey: "create.unitMetric",
            units: METRIC_UNITS as readonly string[],
          },
        ]
      : [
          {
            labelKey: "create.unitImperial",
            units: IMPERIAL_UNITS as readonly string[],
          },
        ]),
    {
      labelKey: "create.unitCount",
      units: COUNT_UNIT_KEYS as readonly string[],
    },
  ];

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl flex flex-col max-h-[70vh]">
          <div className="mx-auto w-10 h-1 rounded-full bg-[#E5E7EB] mt-3 mb-1 shrink-0" />
          <Drawer.Title className="sr-only">
            {t("create.selectUnit")}
          </Drawer.Title>
          <div className="overflow-y-auto pb-8">
            {sections.map((section) => (
              <div key={section.labelKey}>
                <p className="px-4 pt-4 pb-1 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide">
                  {t(section.labelKey)}
                </p>
                {section.units.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => {
                      onSelect(u);
                      onOpenChange(false);
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm text-[#1A1A1A] active:bg-[#F9FAFB] transition-colors"
                  >
                    {t(`units.${u}`, { defaultValue: u })}
                    {selected === u && (
                      <Check size={16} className="text-[#F4623A]" />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------- IngredientCombobox ----------

export function IngredientCombobox({
  value,
  onValueChange,
  onRemove,
  index,
  measurementSystem,
  isDuplicate,
  lang = "pt",
}: {
  value: IngredientRow;
  onValueChange: (updated: IngredientRow) => void;
  onRemove: () => void;
  index: number;
  measurementSystem: "metric" | "imperial";
  isDuplicate?: boolean;
  lang?: string;
}) {
  useTranslation();
  const [text, setText] = useState(value.rawText);
  const [open, setOpen] = useState(false);
  const [unitSheetOpen, setUnitSheetOpen] = useState(false);
  const [qty, setQty] = useState(
    value.quantity != null ? String(value.quantity) : "",
  );
  const [unit, setUnit] = useState(value.unit ?? "g");
  const debouncedText = useDebounce(text, 250);
  const containerRef = useRef<HTMLDivElement>(null);

  // Latest-ref pattern: always current without becoming a dep
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  // Track which suggestion ID has already been auto-applied
  const lastAutoMatchIdRef = useRef<string | null>(null);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["ingredientSearch", debouncedText, lang],
    queryFn: () => searchIngredients({ data: { q: debouncedText, lang } }),
    enabled: debouncedText.length >= 2,
    staleTime: 30_000,
  });

  // Auto-apply top suggestion's nutrition data when no explicit selection made.
  // Only fires when similarity >= 0.75 to avoid wrong macros from poor matches.
  useEffect(() => {
    const v = valueRef.current;
    if (v.ingredientId) return; // explicit selection already applied
    if (suggestions.length === 0) return;
    const top = suggestions[0];
    if (top.id === lastAutoMatchIdRef.current) return; // already applied this match
    if ((top.similarity ?? 0) < 0.75) return; // not confident enough
    lastAutoMatchIdRef.current = top.id;
    onValueChangeRef.current({
      ...v,
      caloriesPer100g: top.calories_per_100g ?? null,
      proteinPer100g: top.protein_per_100g ?? null,
      carbsPer100g: top.carbs_per_100g ?? null,
      fatPer100g: top.fat_per_100g ?? null,
      category: top.category ? (SLUG_TO_PT[top.category] ?? null) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(ing: {
    id: string;
    name: string;
    similarity?: number;
    default_unit: string | null;
    category: string | null;
    dietary_flags?: string[] | null;
    calories_per_100g?: number | null;
    protein_per_100g?: number | null;
    carbs_per_100g?: number | null;
    fat_per_100g?: number | null;
  }) {
    const selectedUnit = ing.default_unit ?? "g";
    setText(ing.name);
    lastAutoMatchIdRef.current = ing.id; // mark as applied so effect doesn't re-apply
    onValueChange({
      ...value,
      rawText: ing.name,
      name: ing.name,
      unit: ing.default_unit,
      ingredientId: ing.id,
      category: ing.category ? (SLUG_TO_PT[ing.category] ?? null) : null,
      dietaryFlags: ing.dietary_flags ?? null,
      caloriesPer100g: ing.calories_per_100g ?? null,
      proteinPer100g: ing.protein_per_100g ?? null,
      carbsPer100g: ing.carbs_per_100g ?? null,
      fatPer100g: ing.fat_per_100g ?? null,
    });
    setUnit(selectedUnit);
    setOpen(false);
  }

  function handleTextChange(newText: string) {
    setText(newText);
    // Clear nutrition so it gets re-matched from next suggestions batch
    lastAutoMatchIdRef.current = null;
    onValueChange({
      ...value,
      rawText: newText,
      name: null,
      ingredientId: null,
      caloriesPer100g: null,
      proteinPer100g: null,
      carbsPer100g: null,
      fatPer100g: null,
    });
    setOpen(newText.length >= 2);
  }

  function handleQtyChange(newQty: string) {
    setQty(newQty);
    onValueChange({ ...value, quantity: newQty ? parseFloat(newQty) : null });
  }

  function handleUnitChange(newUnit: string) {
    setUnit(newUnit);
    onValueChange({ ...value, unit: newUnit || null });
  }

  const isNonDefault = unit !== "g" && unit !== "";

  return (
    <div ref={containerRef} className="relative space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 w-5 text-xs text-[#9CA3AF] text-right">
          {index + 1}.
        </span>
        <input
          type="number"
          min={0}
          step="any"
          value={qty}
          onChange={(e) => handleQtyChange(e.target.value)}
          placeholder="Qtd"
          aria-label="Quantidade"
          className="w-14 shrink-0 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-2 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors"
        />
        <button
          type="button"
          onClick={() => setUnitSheetOpen(true)}
          aria-label="Selecionar unidade"
          className={`shrink-0 rounded-xl border px-2 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 ${
            isNonDefault
              ? "border-[#F4623A] bg-[#FFF5F2] text-[#D94F2B]"
              : "border-[#E5E7EB] bg-[#F9FAFB] text-[#1A1A1A]"
          }`}
        >
          {unit || "g"}
        </button>
        <input
          type="text"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onFocus={() => {
            if (text.length >= 2) setOpen(true);
          }}
          placeholder="Ingrediente…"
          className="flex-1 min-w-0 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remover ingrediente"
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#9CA3AF] active:text-[#DC2626] active:bg-[#fee2e2] transition-colors focus-visible:ring-2 focus-visible:ring-[#DC2626]/30 focus:outline-none"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {isDuplicate && (value.name ?? value.rawText).trim() && (
        <p className="text-[11px] text-[#F59E0B] pl-7">
          ⚠ &quot;{value.name ?? value.rawText}&quot; já foi adicionado
        </p>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-6 right-8 mt-1 z-30 bg-white rounded-xl border border-[#E5E7EB] shadow-lg overflow-y-auto max-h-48">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={() => handleSelect(s)}
              className="w-full text-left px-3 py-2.5 text-sm text-[#1A1A1A] hover:bg-[#F9FAFB] active:bg-[#F0F0EE] transition-colors"
            >
              {s.name}
              {s.default_unit && (
                <span className="text-[#9CA3AF] ml-1">· {s.default_unit}</span>
              )}
            </button>
          ))}
        </div>
      )}
      <UnitSheet
        open={unitSheetOpen}
        onOpenChange={setUnitSheetOpen}
        selected={unit}
        onSelect={handleUnitChange}
        measurementSystem={measurementSystem}
      />
    </div>
  );
}
