import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { completeOnboarding } from "../../lib/supabase/profile-queries";
import type { DietaryMode, CookStyle } from "../../types/db";
import type { MeasurementUnit } from "../../lib/detect-locale";
import i18n from "../../i18n";

export const Route = createFileRoute("/app/onboarding")({
  component: OnboardingPage,
});

const DIETARY_MODES: { value: DietaryMode; labelKey: string; descKey: string }[] = [
  { value: "vegetarian", labelKey: "settings.dietaryVegetarian", descKey: "onboarding.dietaryVegetarianDesc" },
  { value: "vegan", labelKey: "settings.dietaryVegan", descKey: "onboarding.dietaryVeganDesc" },
  { value: "pescatarian", labelKey: "settings.dietaryPescatarian", descKey: "onboarding.dietaryPescatarianDesc" },
];

const INTOLERANCES = ["gluten", "dairy", "egg", "nuts", "soy"] as const;

const LANGUAGES = [
  { value: "pt", label: "Português", sublabel: "Portuguese" },
  { value: "en", label: "English", sublabel: "English" },
] as const;

type Lang = (typeof LANGUAGES)[number]["value"];

const COOK_STYLES: { value: CookStyle; labelKey: string; subKey: string }[] = [
  { value: "optimizer", labelKey: "onboarding.cookStyleOptimizer", subKey: "onboarding.cookStyleOptimizerSub" },
  { value: "time_crunched", labelKey: "onboarding.cookStyleTimeCrunched", subKey: "onboarding.cookStyleTimeCrunchedSub" },
  { value: "explorer", labelKey: "onboarding.cookStyleExplorer", subKey: "onboarding.cookStyleExplorerSub" },
  { value: "dietary", labelKey: "onboarding.cookStyleDietary", subKey: "onboarding.cookStyleDietarySub" },
  { value: "meal_prepper", labelKey: "onboarding.cookStyleMealPrepper", subKey: "onboarding.cookStyleMealPrepperSub" },
];

function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [cookStyle, setCookStyle] = useState<CookStyle | null>(null);
  const [lang, setLang] = useState<Lang>(() =>
    i18n.language.startsWith("en") ? "en" : "pt",
  );
  const [unit, setUnit] = useState<MeasurementUnit>("metric");
  const [dietMode, setDietMode] = useState<DietaryMode>("none");
  const [intolerances, setIntolerances] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: (vars: {
      measurementUnit: MeasurementUnit;
      dietaryMode: DietaryMode;
      intolerances: string[];
      cookStyle: CookStyle | null;
    }) => completeOnboarding({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      navigate({ to: "/app/library", search: {} as never });
    },
  });

  function handleLangContinue() {
    if (i18n.language !== lang) i18n.changeLanguage(lang);
    setStep(3);
  }

  function toggleIntolerance(flag: string) {
    setIntolerances((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag],
    );
  }

  function finish() {
    mutation.mutate({
      measurementUnit: unit,
      dietaryMode: dietMode,
      intolerances,
      cookStyle,
    });
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex flex-col px-5 py-8 max-w-md mx-auto">
      {/* Progress dots */}
      <div className="flex items-center gap-2 mb-8">
        {([1, 2, 3, 4] as const).map((s) => (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all ${
              s === step
                ? "w-8 bg-[#F4623A]"
                : s < step
                  ? "w-4 bg-[#86efac]"
                  : "w-4 bg-[#E5E7EB]"
            }`}
          />
        ))}
      </div>

      {/* Step 1 — Cook Style */}
      {step === 1 && (
        <>
          <h1 className="text-2xl font-bold text-[#1A1A1A] mb-1">
            {t("onboarding.cookStyleTitle")}
          </h1>
          <p className="text-sm text-[#6B7280] mb-8">
            {t("onboarding.cookStyleSubtitle")}
          </p>

          <div className="space-y-3 flex-1">
            {COOK_STYLES.map((cs) => (
              <button
                key={cs.value}
                onClick={() => setCookStyle(cs.value)}
                className={`w-full flex items-center justify-between rounded-2xl border-2 px-4 py-4 text-left transition-all focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
                  cookStyle === cs.value
                    ? "border-[#F4623A] bg-[#FFF5F2]"
                    : "border-[#E5E7EB] bg-white hover:border-[#D1D5DB]"
                }`}
              >
                <div>
                  <p className="font-semibold text-[#1A1A1A]">{t(cs.labelKey)}</p>
                  <p className="text-xs text-[#6B7280] mt-0.5">{t(cs.subKey)}</p>
                </div>
                {cookStyle === cs.value && (
                  <Check size={20} className="text-[#F4623A] shrink-0" />
                )}
              </button>
            ))}
          </div>

          <div className="mt-8 flex gap-3">
            <button
              onClick={() => { setCookStyle(null); setStep(2); }}
              className="flex-1 rounded-2xl border border-[#E5E7EB] py-4 text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t("onboarding.cookStyleSkip")}
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={cookStyle === null}
              className="flex-[2] rounded-2xl bg-[#F4623A] py-4 text-sm font-semibold text-white hover:bg-[#D94F2B] disabled:opacity-40 active:scale-[0.98] transition-all focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t("onboarding.continue")}
            </button>
          </div>
        </>
      )}

      {/* Step 2 — Language */}
      {step === 2 && (
        <>
          <h1 className="text-2xl font-bold text-[#1A1A1A] mb-1">
            {t("onboarding.langTitle")}
          </h1>
          <p className="text-sm text-[#6B7280] mb-8">
            {t("onboarding.langSubtitle")}
          </p>

          <div className="space-y-3 flex-1">
            {LANGUAGES.map((l) => (
              <button
                key={l.value}
                onClick={() => setLang(l.value)}
                className={`w-full flex items-center justify-between rounded-2xl border-2 px-4 py-4 text-left transition-all focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
                  lang === l.value
                    ? "border-[#F4623A] bg-[#FFF5F2]"
                    : "border-[#E5E7EB] bg-white hover:border-[#D1D5DB]"
                }`}
              >
                <div>
                  <p className="font-semibold text-[#1A1A1A]">{l.label}</p>
                  <p className="text-xs text-[#6B7280] mt-0.5">{l.sublabel}</p>
                </div>
                {lang === l.value && (
                  <Check size={20} className="text-[#F4623A] shrink-0" />
                )}
              </button>
            ))}
          </div>

          <div className="mt-8 flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 rounded-2xl border border-[#E5E7EB] py-4 text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t("onboarding.back")}
            </button>
            <button
              onClick={handleLangContinue}
              className="flex-[2] rounded-2xl bg-[#F4623A] py-4 text-sm font-semibold text-white hover:bg-[#D94F2B] active:scale-[0.98] transition-all focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t("onboarding.continue")}
            </button>
          </div>
        </>
      )}

      {/* Step 3 — Units */}
      {step === 3 && (
        <>
          <h1 className="text-2xl font-bold text-[#1A1A1A] mb-1">
            {t("onboarding.unitsTitle")}
          </h1>
          <p className="text-sm text-[#6B7280] mb-8">
            {t("onboarding.unitsSubtitle")}
          </p>

          <div className="space-y-3 flex-1">
            {(["metric", "imperial"] as MeasurementUnit[]).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`w-full flex items-center justify-between rounded-2xl border-2 px-4 py-4 text-left transition-all focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
                  unit === u
                    ? "border-[#F4623A] bg-[#FFF5F2]"
                    : "border-[#E5E7EB] bg-white hover:border-[#D1D5DB]"
                }`}
              >
                <div>
                  <p className="font-semibold text-[#1A1A1A]">
                    {t(`settings.${u}`)}
                  </p>
                  <p className="text-xs text-[#6B7280] mt-0.5">
                    {u === "metric" ? "g, ml, kg" : "oz, lb, cups"}
                  </p>
                </div>
                {unit === u && (
                  <Check size={20} className="text-[#F4623A] shrink-0" />
                )}
              </button>
            ))}
          </div>

          <div className="mt-8 flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex-1 rounded-2xl border border-[#E5E7EB] py-4 text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t("onboarding.back")}
            </button>
            <button
              onClick={() => setStep(4)}
              className="flex-[2] rounded-2xl bg-[#F4623A] py-4 text-sm font-semibold text-white hover:bg-[#D94F2B] active:scale-[0.98] transition-all focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t("onboarding.continue")}
            </button>
          </div>
        </>
      )}

      {/* Step 4 — Dietary */}
      {step === 4 && (
        <>
          <h1 className="text-2xl font-bold text-[#1A1A1A] mb-1">
            {t("onboarding.dietaryTitle")}
          </h1>
          <p className="text-sm text-[#6B7280] mb-6">
            {t("onboarding.dietarySubtitle")}
          </p>

          <div className="space-y-2 mb-6">
            {DIETARY_MODES.map(({ value, labelKey }) => (
              <button
                key={value}
                onClick={() =>
                  setDietMode((prev) => (prev === value ? "none" : value))
                }
                className={`w-full flex items-center justify-between rounded-2xl border-2 px-4 py-3.5 text-left transition-all focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
                  dietMode === value
                    ? "border-[#F4623A] bg-[#FFF5F2]"
                    : "border-[#E5E7EB] bg-white hover:border-[#D1D5DB]"
                }`}
              >
                <span className="font-medium text-sm text-[#1A1A1A]">
                  {t(labelKey)}
                </span>
                {dietMode === value && (
                  <Check size={18} className="text-[#F4623A] shrink-0" />
                )}
              </button>
            ))}
          </div>

          <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">
            {t("settings.intolerancesLabel")}
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            {INTOLERANCES.map((flag) => {
              const active = intolerances.includes(flag);
              return (
                <button
                  key={flag}
                  onClick={() => toggleIntolerance(flag)}
                  className={`text-sm px-3.5 py-1.5 rounded-full border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
                    active
                      ? "bg-[#FEE9E1] border-[#F4623A] text-[#D94F2B]"
                      : "bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]"
                  }`}
                >
                  {t(
                    `settings.intolerance${flag.charAt(0).toUpperCase() + flag.slice(1)}`,
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-xs text-[#9CA3AF] text-center mb-6 px-4 leading-relaxed">
            {t("onboarding.closingSentence")}
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(3)}
              className="flex-1 rounded-2xl border border-[#E5E7EB] py-4 text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {t("onboarding.back")}
            </button>
            <button
              onClick={finish}
              disabled={mutation.isPending}
              className="flex-[2] rounded-2xl bg-[#F4623A] py-4 text-sm font-semibold text-white hover:bg-[#D94F2B] disabled:opacity-50 active:scale-[0.98] transition-all focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
            >
              {mutation.isPending
                ? t("common.loading")
                : t("onboarding.finish")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
