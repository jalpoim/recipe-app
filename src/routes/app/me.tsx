import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef } from "react";
import { Settings, X, ChevronRight, Share2 } from "lucide-react";
import { Drawer } from "vaul";
import { fetchMyProfile } from "../../lib/supabase/profile-queries";
import {
  getCookProfile,
  getCookSummaryThisMonth,
  getDistinctCookedCount,
  getSavesSummary,
  getCuisineBadgeProgress,
} from "../../lib/supabase/cook-log-queries";
import {
  getUserFlavorProfile,
  generateFlavorNarrative,
} from "../../lib/supabase/flavor-profile-queries";
import {
  getAxisLevel,
  getPrimaryAxis,
  getCreatorLevel,
  CREATOR_THRESHOLDS,
} from "../../lib/cook-profile";

export const Route = createFileRoute("/app/me")({
  component: ProfilePage,
});

// ─── Design tokens ────────────────────────────────────────────────────────────
// All colors derived from brand coral #F4623A — no foreign hues on this page.
// MD3-style tonal palette: same family at varying tone/lightness.
//
// brand:       #F4623A  hero, discovery card bg, accent elements
// brand-dark:  #C23E22  numbers and text-on-light where coral is too bright
// surface:     #FFF4F0  all card backgrounds (warm tint)
// dark-warm:   #2D1208  signature card bg (very dark warm brown, not cold black)
// text-hi:     #1C0F0C  headlines on light surfaces
// text-lo:     #9C6355  labels, sub-lines on light surfaces
// chip-bg:     #FFE8DE  cuisine collection chips
// chip-text:   #7A2C18  text on chips

// ─── Hero ────────────────────────────────────────────────────────────────────

function IdentityHero({
  displayName,
  username,
  avatarUrl,
  primaryTitle,
  subtitle,
  specialtyBadgeLabel,
}: {
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  primaryTitle: string;
  subtitle: string;
  specialtyBadgeLabel?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="relative px-5 pt-12 pb-8 text-white"
      style={{ background: "linear-gradient(160deg, #F4623A 0%, #C23E22 100%)" }}
    >
      <Link
        to="/app/settings"
        aria-label={t("flavorIdentity.settingsTitle")}
        className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center hover:bg-white/25 transition-colors focus-visible:ring-2 focus-visible:ring-white/50 focus:outline-none"
      >
        <Settings size={16} aria-hidden="true" />
      </Link>

      <div className="flex flex-col items-center text-center">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            width={80}
            height={80}
            className="w-20 h-20 rounded-full object-cover ring-2 ring-white/30 shrink-0 mb-3"
          />
        ) : (
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold ring-2 ring-white/30 shrink-0 mb-3"
            style={{ background: "rgba(255,255,255,0.18)" }}
            aria-hidden="true"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}

        <p className="text-[20px] font-bold leading-tight">{displayName}</p>
        {username && (
          <p className="text-[14px] text-white/60 mt-0.5">@{username}</p>
        )}

        {/* Title — dominant identity statement */}
        <p
          className="text-[28px] font-bold leading-tight mt-4"
          style={{ textWrap: "balance" } as React.CSSProperties}
        >
          {primaryTitle}
        </p>

        {specialtyBadgeLabel && (
          <div className="mt-2 px-3 py-1 rounded-full bg-white/15 border border-white/20">
            <p className="text-[12px] font-medium tracking-wide">{specialtyBadgeLabel}</p>
          </div>
        )}

        {subtitle && (
          <p className="text-[13px] text-white/60 max-w-[260px] leading-relaxed mt-4">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
// Horizontal layout: large number left + label wrapping right.
// Fills horizontal space intentionally — no empty right-side void.

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl shadow-sm px-6 py-5 flex items-baseline gap-4" style={{ background: "#FFF4F0" }}>
      <p
        className="text-[56px] font-extrabold leading-none tracking-tight shrink-0"
        style={{ color: "#C23E22", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
      <p className="text-[14px] leading-snug" style={{ color: "#9C6355" }}>
        {label}
      </p>
    </div>
  );
}

// ─── Discovery card ───────────────────────────────────────────────────────────
// Full brand coral — echoes the hero, signals celebration.

function DiscoveryCard({ category, headline, sub }: { category: string; headline: string; sub?: string }) {
  return (
    <div className="rounded-2xl shadow-sm px-6 py-5" style={{ background: "#F4623A" }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "rgba(255,255,255,0.6)" }}>
        {category}
      </p>
      <p
        className="text-[20px] font-bold text-white leading-snug"
        style={{ textWrap: "balance" } as React.CSSProperties}
      >
        {headline}
      </p>
      {sub && (
        <p className="text-[12px] font-medium mt-1.5" style={{ color: "rgba(255,255,255,0.72)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Signature card ───────────────────────────────────────────────────────────
// Dark warm brown — most earned moment on the page.
// Coral sub-line glows against the dark surface.

function SignatureCard({ category, headline, sub }: { category: string; headline: string; sub: string }) {
  return (
    <div className="rounded-2xl shadow-md px-6 py-5" style={{ background: "#2D1208" }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>
        {category}
      </p>
      <p
        className="text-[18px] font-bold text-white leading-snug"
        style={{ textWrap: "balance" } as React.CSSProperties}
      >
        {headline}
      </p>
      <p className="text-[12px] font-medium mt-2" style={{ color: "#F4623A" }}>
        {sub}
      </p>
    </div>
  );
}

// ─── Narrative card ───────────────────────────────────────────────────────────
// General content — warm surface, consistent with StatCard family.

function NarrativeCard({ category, headline, sub }: { category?: string; headline: string; sub?: string }) {
  return (
    <div className="rounded-2xl shadow-sm px-6 py-5" style={{ background: "#FFF4F0" }}>
      {category && (
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "#9C6355" }}>
          {category}
        </p>
      )}
      <p
        className="text-[17px] font-semibold leading-snug"
        style={{ color: "#1C0F0C", textWrap: "balance" } as React.CSSProperties}
      >
        {headline}
      </p>
      {sub && (
        <p className="text-[13px] mt-1 leading-relaxed" style={{ color: "#9C6355" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Badge card ───────────────────────────────────────────────────────────────

function BadgeCard({ label, category }: { label: string; category: string }) {
  return (
    <div className="flex-1 rounded-2xl shadow-sm overflow-hidden" style={{ background: "#FFF4F0" }}>
      <div className="h-0.5" style={{ background: "#F4623A" }} />
      <div className="px-4 pt-3 pb-5 flex flex-col items-center gap-1 text-center">
        <p className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: "#9C6355" }}>
          {category}
        </p>
        <p className="text-[14px] font-bold leading-snug" style={{ color: "#1C0F0C" }}>
          {label}
        </p>
      </div>
    </div>
  );
}

// ─── Narrative card ───────────────────────────────────────────────────────────
// AI-generated 2–3 sentence cooking identity description.

function NarrativeAICard({ text }: { text: string }) {
  return (
    <div
      className="rounded-2xl shadow-sm px-6 py-5"
      style={{ background: "#FFF4F0", borderLeft: "3px solid #F4623A" }}
    >
      <p
        className="text-[15px] leading-relaxed"
        style={{ color: "#1C0F0C", fontStyle: "italic" }}
      >
        {text}
      </p>
    </div>
  );
}

// ─── Signature ingredient card ────────────────────────────────────────────────

function SignatureIngredientCard({
  ingredient,
  multiple,
  flavorNotes,
  label,
  sub,
}: {
  ingredient: string;
  multiple: number;
  flavorNotes: string[];
  label: string;
  sub: string;
}) {
  const capitalised = ingredient.charAt(0).toUpperCase() + ingredient.slice(1);
  return (
    <div className="rounded-2xl shadow-sm px-6 py-5" style={{ background: "#FFF4F0" }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "#9C6355" }}>
        {label}
      </p>
      <p className="text-[22px] font-bold leading-tight mb-1" style={{ color: "#C23E22" }}>
        {capitalised}
      </p>
      <p className="text-[12px] mb-3" style={{ color: "#9C6355" }}>
        {sub.replace("{{multiple}}", String(multiple))}
      </p>
      {flavorNotes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flavorNotes.map((note) => (
            <span
              key={note}
              className="text-[11px] px-2.5 py-1 rounded-full font-medium"
              style={{ background: "#FFE8DE", color: "#7A2C18" }}
            >
              {note}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Share card ───────────────────────────────────────────────────────────────

function ShareCard({
  narrative,
  flavorNotes,
  title,
  shareLabel,
  copiedLabel,
}: {
  narrative: string;
  flavorNotes: string[];
  title: string;
  shareLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const monthYear = now.toLocaleString(undefined, { month: "long", year: "numeric" });

  async function handleShare() {
    const text = `${narrative}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // user cancelled
    }
  }

  return (
    <div className="space-y-3">
      <div
        ref={cardRef}
        className="rounded-2xl overflow-hidden"
        style={{ background: "#2D1208" }}
      >
        <div className="h-1" style={{ background: "#F4623A" }} />
        <div className="px-6 py-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
            {title} · {monthYear}
          </p>
          <p className="text-[15px] leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.85)", fontStyle: "italic" }}>
            {narrative}
          </p>
          {flavorNotes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {flavorNotes.map((note) => (
                <span
                  key={note}
                  className="text-[11px] px-2.5 py-1 rounded-full font-medium"
                  style={{ background: "rgba(244,98,58,0.2)", color: "#F4A58A" }}
                >
                  {note}
                </span>
              ))}
            </div>
          )}
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
            mealprep.app
          </p>
        </div>
      </div>
      <button
        onClick={handleShare}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border text-sm font-medium transition-colors focus:outline-none"
        style={{ borderColor: "#E5E7EB", color: "#6B7280" }}
      >
        <Share2 size={15} aria-hidden="true" />
        {copied ? copiedLabel : shareLabel}
      </button>
    </div>
  );
}

// ─── Cuisine badges ───────────────────────────────────────────────────────────

const TARGET_CUISINES = [
  "portuguese", "italian", "japanese", "mexican", "indian", "thai",
  "chinese", "french", "greek", "moroccan", "korean", "spanish",
  "middle-eastern", "american", "brazilian", "vietnamese", "turkish", "german",
] as const;

const BADGE_THRESHOLD = 3;

// Warm, food-inspired per-cuisine accent colors
const CUISINE_COLORS: Record<string, string> = {
  portuguese:    "#2d6a4f",
  italian:       "#c62828",
  japanese:      "#1a237e",
  mexican:       "#e65100",
  indian:        "#f57f17",
  thai:          "#1b5e20",
  chinese:       "#b71c1c",
  french:        "#283593",
  greek:         "#0277bd",
  moroccan:      "#bf360c",
  korean:        "#880e4f",
  spanish:       "#c62828",
  "middle-eastern": "#e65100",
  american:      "#283593",
  brazilian:     "#1b5e20",
  vietnamese:    "#004d40",
  turkish:       "#880e4f",
  german:        "#4e342e",
};

function CuisineBadge({
  cuisine,
  earned,
  remaining,
  label,
}: {
  cuisine: string;
  earned: boolean;
  remaining: number;
  label: string;
}) {
  const { t } = useTranslation();
  const color = CUISINE_COLORS[cuisine] ?? "#C23E22";
  const initial = label.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0" style={{ width: 68 }}>
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center text-[20px] font-extrabold"
        style={{
          background: earned ? color : "#FFE8DE",
          color: earned ? "#fff" : color,
          border: earned ? `2px solid ${color}` : "2px dashed #F4A58A",
          opacity: earned ? 1 : 0.65,
        }}
      >
        {initial}
      </div>
      <p
        className="text-[10px] font-medium text-center leading-tight"
        style={{ color: earned ? "#1C0F0C" : "#9C6355" }}
      >
        {label}
      </p>
      {!earned && (
        <p className="text-[9px] font-medium" style={{ color: "#C4A49C" }}>
          {t("flavorIdentity.cuisineBadgeTeaser", { count: remaining })}
        </p>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="motion-safe:animate-pulse">
      <div className="h-60" style={{ background: "linear-gradient(160deg, #F4623A 0%, #C23E22 100%)" }} />
      <div className="px-4 pt-4 pb-6 space-y-4">
        <div className="rounded-2xl h-20" style={{ background: "#FFF4F0" }} />
        <div className="rounded-2xl h-16" style={{ background: "#F4623A", opacity: 0.2 }} />
        <div className="rounded-2xl h-16" style={{ background: "#2D1208", opacity: 0.08 }} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProfilePage() {
  const { t } = useTranslation();

  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchMyProfile(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: distinctCount = 0, isLoading: countLoading } = useQuery({
    queryKey: ["cook-distinct-count"],
    queryFn: () => getDistinctCookedCount(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: cookProfile } = useQuery({
    queryKey: ["cook-profile"],
    queryFn: () => getCookProfile(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: cookSummary } = useQuery({
    queryKey: ["cook-summary-this-month"],
    queryFn: () => getCookSummaryThisMonth(),
    staleTime: 5 * 60 * 1000,
    enabled: distinctCount >= 5,
  });

  const { data: savesSummary } = useQuery({
    queryKey: ["saves-summary"],
    queryFn: () => getSavesSummary(),
    staleTime: 5 * 60 * 1000,
    enabled: distinctCount === 0,
  });

  const { data: badgeProgress = [] } = useQuery({
    queryKey: ["cuisine-badge-progress"],
    queryFn: () => getCuisineBadgeProgress(),
    staleTime: 5 * 60 * 1000,
  });

  const qc = useQueryClient();

  // ── Flavor profile (Phase 2) ───────────────────────────────────────────────
  const { data: flavorProfile } = useQuery({
    queryKey: ["flavor-profile"],
    queryFn: () => getUserFlavorProfile(),
    staleTime: 30 * 60 * 1000,
    enabled: distinctCount >= 5,
  });

  const narrativeMutation = useMutation({
    mutationFn: () => generateFlavorNarrative(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-profile"] }),
    onError: () => { /* silent — narrative is best-effort */ },
  });

  // Trigger narrative generation when profile is loaded and narrative is missing/stale
  const narrativeTriggeredRef = useRef(false);
  useEffect(() => {
    if (narrativeTriggeredRef.current) return;
    if (!profile || distinctCount < 5) return;
    const raw = profile as unknown as Record<string, unknown>;
    const generatedAt = raw["flavor_narrative_generated_at"] as string | null;
    const narrative = raw["flavor_narrative"] as string | null;
    if (narrative && generatedAt) {
      const days = (Date.now() - new Date(generatedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days < 30) return;
    }
    narrativeTriggeredRef.current = true;
    narrativeMutation.mutate();
  }, [profile, distinctCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sheet state ────────────────────────────────────────────────────────────
  type ProfileSheet =
    | { type: 'cook-history' }
    | { type: 'recipe'; recipeId: string; name: string; sub: string; category: string; imageUrl: string | null }
    | null;
  const [sheet, setSheet] = useState<ProfileSheet>(null);

  // ── Badge change banner — hooks must be before any early returns ───────────
  const [badgeBanner, setBadgeBanner] = useState<string | null>(null);
  const specialtyBadgeKeyRaw = cookProfile?.specialty_badge_key ?? null;

  useEffect(() => {
    if (!specialtyBadgeKeyRaw) return;
    const lastSeen = typeof localStorage !== 'undefined'
      ? localStorage.getItem('last_seen_badge_key')
      : null;
    if (lastSeen !== null && lastSeen !== specialtyBadgeKeyRaw) {
      const label = t(`flavorIdentity.specialtyBadge.${specialtyBadgeKeyRaw}`, { defaultValue: '' });
      if (label) {
        setBadgeBanner(label);
        const timer = setTimeout(() => setBadgeBanner(null), 3000);
        return () => clearTimeout(timer);
      }
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('last_seen_badge_key', specialtyBadgeKeyRaw);
    }
  }, [specialtyBadgeKeyRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  if (countLoading || !profile) return <ProfileSkeleton />;

  const displayName = profile.display_name ?? "—";
  const username = profile.username ?? null;
  const avatarUrl = profile.avatar_url ?? null;

  // ── Primary title ──────────────────────────────────────────────────────────
  let primaryTitle: string;
  if (cookProfile && (cookProfile.lifetime_cook_count ?? 0) >= 5) {
    const axis = getPrimaryAxis(cookProfile);
    const level = getAxisLevel(axis, cookProfile);
    primaryTitle = t(`flavorIdentity.titles.${axis}.${level}`);
  } else {
    primaryTitle = t("flavorIdentity.newCook");
  }

  // ── Specialty badge ────────────────────────────────────────────────────────
  const specialtyBadgeKey = specialtyBadgeKeyRaw; // already declared above
  const specialtyBadgeLabel = specialtyBadgeKey
    ? t(`flavorIdentity.specialtyBadge.${specialtyBadgeKey}`, { defaultValue: "" }) || null
    : null;

  // ── Creator badge ──────────────────────────────────────────────────────────
  const creatorPoints = Number(cookProfile?.creator_points ?? 0);
  const creatorLevel =
    creatorPoints >= CREATOR_THRESHOLDS[0] ? getCreatorLevel(creatorPoints) : null;
  const creatorTitle = creatorLevel
    ? t(`flavorIdentity.titles.creator.${creatorLevel}`)
    : null;

  // ── Hero subtitle — only at 0–4 distinct cooks ─────────────────────────────
  const heroSubtitle = distinctCount < 5 ? t("flavorIdentity.heroSubtitleNewCook") : "";

  // ── Unlock gates ───────────────────────────────────────────────────────────
  const showCookCount = distinctCount >= 5;
  const showSignatureAndCuisine = distinctCount >= 10;
  const showTopProtein = distinctCount >= 15;

  // ── Signature recipe (≥3 cooks same recipe AND ≥10 distinct) ──────────────
  const signatureRecipe =
    showSignatureAndCuisine &&
    cookSummary?.mostCookedRecipe?.count != null &&
    cookSummary.mostCookedRecipe.count >= 3
      ? cookSummary.mostCookedRecipe
      : null;

  // ── Top protein — suppress if already conveyed by specialty badge ──────────
  const specialtyProteinSlug = specialtyBadgeKey?.startsWith("protein:")
    ? specialtyBadgeKey.slice("protein:".length)
    : null;
  const topProtein =
    showTopProtein &&
    cookSummary?.topProtein &&
    cookSummary.topProtein !== specialtyProteinSlug
      ? cookSummary.topProtein
      : null;

  // ── Creator badge — shown as a card only (separate from specialty in hero) ─
  const showCreatorCard = !!creatorTitle;

  function cuisineLabel(slug: string): string {
    return t(`flavorIdentity.cuisineLabels.${slug}`, { defaultValue: slug });
  }

  const lifetimeCookCount = cookProfile?.lifetime_cook_count ?? 0;

  // ── Cuisine badges ─────────────────────────────────────────────────────────
  const badgeMap = new Map(badgeProgress.map((b) => [b.cuisine, b.distinctRecipes]));
  const visibleBadges = TARGET_CUISINES
    .map((c) => ({ cuisine: c, count: badgeMap.get(c) ?? 0 }))
    .filter(({ count }) => count >= 2); // earned (≥3) or teaser (2)

  // ── Phase 2: narrative + flavor profile ───────────────────────────────────
  const profileRaw = profile as unknown as Record<string, unknown>;
  const savedNarrative = profileRaw["flavor_narrative"] as string | null;
  const showNarrativeLoading = narrativeMutation.isPending && !savedNarrative;

  return (
    <div className="min-h-screen pb-24" style={{ background: "#FFFAF8" }}>
      <IdentityHero
        displayName={displayName}
        username={username}
        avatarUrl={avatarUrl}
        primaryTitle={primaryTitle}
        subtitle={heroSubtitle}
        specialtyBadgeLabel={specialtyBadgeLabel ?? undefined}
      />

      {/* Badge change banner */}
      {badgeBanner && (
        <div
          className="flex items-center justify-between px-4 py-3 text-white text-[13px] font-medium"
          style={{ background: "#C23E22" }}
        >
          <span>{t("flavorIdentity.badgeChanged", { badge: badgeBanner })}</span>
          <button
            onClick={() => setBadgeBanner(null)}
            aria-label={t("common.close")}
            className="ml-3 shrink-0 opacity-70 hover:opacity-100 focus:outline-none"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="max-w-md mx-auto px-4 pt-4 pb-6 space-y-3">

        {/* Tier 1 — progress bar for new users (0–4 distinct cooks) */}
        {distinctCount < 5 && (
          <div className="rounded-2xl shadow-sm px-6 py-5" style={{ background: "#FFF4F0" }}>
            <p className="text-[13px] leading-relaxed mb-3" style={{ color: "#9C6355" }}>
              {t("cookProfile.progressHint", { remaining: 5 - distinctCount })}
            </p>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#FFE8DE" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.round((distinctCount / 5) * 100)}%`, background: "#F4623A" }}
              />
            </div>
            <p className="text-[11px] mt-1.5 font-semibold tabular-nums" style={{ color: "#C4A49C" }}>
              {distinctCount}/5
            </p>
          </div>
        )}

        {/* Tier 2 — browser message (0 cooks but has saves) */}
        {distinctCount === 0 && savesSummary?.topCuisine && (
          <NarrativeCard
            headline={t("cookProfile.basedOnSaved", {
              cuisine: t(`flavorIdentity.cuisineLabels.${savesSummary.topCuisine}`, { defaultValue: savesSummary.topCuisine }),
              protein: savesSummary.topProtein ? t(`proteins.${savesSummary.topProtein}`, { defaultValue: savesSummary.topProtein }) : "",
            })}
            sub={t("cookProfile.browserHint")}
          />
        )}

        {/* Creator badge card — only when earned (specialty badge lives in hero pill) */}
        {showCreatorCard && (
          <BadgeCard label={creatorTitle!} category={t("flavorIdentity.creatorBadge")} />
        )}

        {/* AI narrative — loading skeleton or generated text */}
        {showNarrativeLoading && (
          <div className="rounded-2xl px-6 py-5 motion-safe:animate-pulse" style={{ background: "#FFF4F0", borderLeft: "3px solid #FFE8DE" }}>
            <p className="text-[13px]" style={{ color: "#C4A49C" }}>
              {t("flavorIdentity.narrativeLoading")}
            </p>
          </div>
        )}
        {savedNarrative && !showNarrativeLoading && (
          <NarrativeAICard text={savedNarrative} />
        )}

        {/* Cook count — tappable: opens top recipes sheet */}
        {showCookCount && (
          <button
            onClick={() => setSheet({ type: 'cook-history' })}
            className="w-full text-left rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40"
          >
            <StatCard value={distinctCount} label={t("flavorIdentity.cookCountLabel")} />
          </button>
        )}

        {/* Signature recipe — tappable: opens recipe preview sheet */}
        {signatureRecipe && (
          <button
            onClick={() => setSheet({ type: 'recipe', recipeId: signatureRecipe.id, name: signatureRecipe.name, sub: t("flavorIdentity.signatureTimes", { count: signatureRecipe.count }), category: t("flavorIdentity.signatureRecipe"), imageUrl: signatureRecipe.imageUrl ?? null })}
            className="w-full text-left rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40"
          >
            <SignatureCard
              category={t("flavorIdentity.signatureRecipe")}
              headline={signatureRecipe.name}
              sub={t("flavorIdentity.signatureTimes", { count: signatureRecipe.count })}
            />
          </button>
        )}

        {/* Signature ingredient (Phase 2) */}
        {flavorProfile?.signatureIngredient && showSignatureAndCuisine && (
          <SignatureIngredientCard
            ingredient={flavorProfile.signatureIngredient}
            multiple={flavorProfile.signatureIngredientPlatformMultiple}
            flavorNotes={flavorProfile.topFlavorNotes.map((n) => t(`flavorIdentity.flavorNotes.${n}`, { defaultValue: n }))}
            label={t("flavorIdentity.signatureIngredientLabel")}
            sub={t("flavorIdentity.signatureIngredientSub", { multiple: flavorProfile.signatureIngredientPlatformMultiple })}
          />
        )}

        {/* Top protein — only if not already shown via specialty badge */}
        {topProtein && (
          <NarrativeCard
            headline={t("flavorIdentity.topProteinTitle", {
              protein: t(`proteins.${topProtein}`, { defaultValue: topProtein }),
            })}
          />
        )}

        {/* Recently explored cuisine — tappable: opens recipe preview sheet */}
        {showSignatureAndCuisine && cookSummary?.firstTimeCuisine && (
          <button
            onClick={() => setSheet({ type: 'recipe', recipeId: cookSummary.firstTimeCuisine!.recipeId, name: cookSummary.firstTimeCuisine!.recipeName, sub: cuisineLabel(cookSummary.firstTimeCuisine!.cuisine), category: t("flavorIdentity.cuisineRecentLabel"), imageUrl: cookSummary.firstTimeCuisine!.imageUrl ?? null })}
            className="w-full text-left rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40"
          >
            <DiscoveryCard
              category={t("flavorIdentity.cuisineRecentLabel")}
              headline={t("flavorIdentity.cuisineDiscoveryHeadline", {
                cuisine: cuisineLabel(cookSummary.firstTimeCuisine.cuisine),
              })}
              sub={cookSummary.firstTimeCuisine.recipeName}
            />
          </button>
        )}

        {/* Cuisine badge collection — hidden until first earned or teaser */}
        {visibleBadges.length > 0 && (
          <div className="space-y-2">
            <p
              className="text-[10px] font-semibold uppercase tracking-widest px-1"
              style={{ color: "#9C6355" }}
            >
              {t("flavorIdentity.cuisineBadgesTitle")}
            </p>
            <div className="-mx-4 overflow-x-auto" style={{ overscrollBehaviorX: "contain" }}>
              <div className="flex gap-3 px-4 pb-1">
                {visibleBadges.map(({ cuisine, count }) => (
                  <CuisineBadge
                    key={cuisine}
                    cuisine={cuisine}
                    earned={count >= BADGE_THRESHOLD}
                    remaining={BADGE_THRESHOLD - count}
                    label={cuisineLabel(cuisine)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Share card (Phase 2) — when narrative is available */}
        {savedNarrative && (
          <ShareCard
            narrative={savedNarrative}
            flavorNotes={(flavorProfile?.topFlavorNotes ?? []).map((n) => t(`flavorIdentity.flavorNotes.${n}`, { defaultValue: n }))}
            title={t("flavorIdentity.shareCardTitle")}
            shareLabel={t("flavorIdentity.shareButton")}
            copiedLabel={t("flavorIdentity.shareCopied")}
          />
        )}

        {/* Lifetime counters — bare centered text, archive-level content */}
        {(lifetimeCookCount > 0 || (cookProfile?.shopping_trip_count ?? 0) > 0) && (
          <div className="space-y-1 text-center">
            {lifetimeCookCount > 0 && (
              <p className="text-[13px]" style={{ color: "#C4A49C" }}>
                {t("flavorIdentity.lifetimeCooks", { count: lifetimeCookCount })}
              </p>
            )}
            {(cookProfile?.shopping_trip_count ?? 0) > 0 && (
              <p className="text-[13px]" style={{ color: "#C4A49C" }}>
                {t("flavorIdentity.lifetimeShopping", { count: cookProfile!.shopping_trip_count })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Profile sheets ───────────────────────────────────────────────── */}
      <Drawer.Root open={sheet !== null} onOpenChange={(v) => !v && setSheet(null)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/30 z-40" />
          <Drawer.Content
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl outline-none max-h-[85dvh] flex flex-col"
            aria-label={sheet?.type === 'cook-history' ? t("flavorIdentity.cookHistoryTitle") : sheet?.name ?? ""}
          >
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-[#E5E7EB]" />
            </div>

            {sheet?.type === 'cook-history' && (
              <div className="px-5 pt-2 pb-8 overflow-y-auto">
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "#9C6355" }}>
                  {t("flavorIdentity.cookHistoryTitle")}
                </p>
                {!cookSummary?.masteredRecipes.length ? (
                  <p className="text-[14px] leading-relaxed" style={{ color: "#9C6355" }}>
                    {t("flavorIdentity.cookHistoryEmpty")}
                  </p>
                ) : (
                  <div>
                    {cookSummary.masteredRecipes.map((r) => (
                      <Link
                        key={r.id}
                        to="/app/library/$recipeId"
                        params={{ recipeId: r.id }}
                        search={{ from: undefined, planItemId: undefined }}
                        onClick={() => setSheet(null)}
                        className="flex items-center gap-3 py-3 border-b border-[#F5F5F3] last:border-0 focus:outline-none"
                      >
                        <div
                          className="w-12 h-12 rounded-xl shrink-0 overflow-hidden"
                          style={{ background: "#FFE8DE" }}
                        >
                          {r.imageUrl ? (
                            <img src={r.imageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full" style={{ background: "linear-gradient(135deg, #FFE8DE, #FECDB3)" }} />
                          )}
                        </div>
                        <span className="flex-1 text-[15px] font-medium leading-snug" style={{ color: "#1C0F0C" }}>{r.name}</span>
                        <ChevronRight size={16} style={{ color: "#D1D5DB" }} aria-hidden="true" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {sheet?.type === 'recipe' && (
              <div className="pb-8">
                {/* Thumbnail */}
                <div
                  className="w-full h-44 overflow-hidden"
                  style={{ background: "linear-gradient(135deg, #FFE8DE, #FECDB3)" }}
                >
                  {sheet.imageUrl && (
                    <img src={sheet.imageUrl} alt={sheet.name} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="px-5 pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "#9C6355" }}>
                    {sheet.category}
                  </p>
                  <p className="text-[22px] font-bold leading-snug mb-1" style={{ color: "#1C0F0C" }}>
                    {sheet.name}
                  </p>
                  <p className="text-[13px] mb-5" style={{ color: "#9C6355" }}>
                    {sheet.sub}
                  </p>
                  <Link
                    to="/app/library/$recipeId"
                    params={{ recipeId: sheet.recipeId }}
                    search={{ from: undefined, planItemId: undefined }}
                    onClick={() => setSheet(null)}
                    className="block w-full text-center py-3.5 rounded-2xl font-semibold text-[15px] text-white focus:outline-none"
                    style={{ background: "#F4623A" }}
                  >
                    {t("flavorIdentity.viewRecipe")}
                  </Link>
                </div>
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
