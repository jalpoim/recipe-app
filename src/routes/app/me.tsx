import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Settings, X } from "lucide-react";
import { fetchMyProfile } from "../../lib/supabase/profile-queries";
import {
  getCookProfile,
  getCookSummaryThisMonth,
  getDistinctCookedCount,
  getSavesSummary,
  getCuisineBadgeProgress,
} from "../../lib/supabase/cook-log-queries";
import type { UserCookProfile } from "../../types/db";

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

// ─── Level thresholds ────────────────────────────────────────────────────────

const EXPLORER_THRESHOLDS = [10, 25, 50, 75, 100] as const;
const PCT_THRESHOLDS = [20, 40, 60, 80, 95] as const;
const PLANNER_THRESHOLDS = [3, 10, 20, 35, 50] as const;
const CREATOR_THRESHOLDS = [5, 15, 30, 55, 90] as const;

type Axis = "explorer" | "optimizer" | "planner" | "swift";

function getLevel(score: number, thresholds: readonly number[]): 1 | 2 | 3 | 4 | 5 {
  if (score >= thresholds[4]) return 5;
  if (score >= thresholds[3]) return 4;
  if (score >= thresholds[2]) return 3;
  if (score >= thresholds[1]) return 2;
  return 1;
}

function getCreatorLevel(points: number): 1 | 2 | 3 | 4 | 5 {
  return getLevel(points, CREATOR_THRESHOLDS);
}

function getAxisLevel(axis: Axis, cp: UserCookProfile): 1 | 2 | 3 | 4 | 5 {
  switch (axis) {
    case "explorer":
      return getLevel(Number(cp.explorer_score), EXPLORER_THRESHOLDS);
    case "optimizer":
      return getLevel(Number(cp.optimizer_score), PCT_THRESHOLDS);
    case "planner":
      return getLevel(Number(cp.planner_score), PLANNER_THRESHOLDS);
    case "swift":
      return getLevel(Number(cp.swift_score), PCT_THRESHOLDS);
  }
}

function getPrimaryAxis(cp: UserCookProfile): Axis {
  const scores: Record<Axis, number> = {
    explorer: Number(cp.explorer_score),
    optimizer: Number(cp.optimizer_score),
    planner: Number(cp.planner_score),
    swift: Number(cp.swift_score),
  };
  return Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0] as Axis;
}

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

  // ── Cuisine collection ─────────────────────────────────────────────────────
  const exploredCuisines = cookProfile?.explored_cuisines ?? [];

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
  const hasAnyBadge = visibleBadges.some(({ count }) => count >= BADGE_THRESHOLD);

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

        {/* Cook count */}
        {showCookCount && (
          <StatCard value={distinctCount} label={t("flavorIdentity.cookCountLabel")} />
        )}

        {/* Signature recipe — dark warm card, most earned moment */}
        {signatureRecipe && (
          <Link to="/app/library/$recipeId" params={{ recipeId: signatureRecipe.id }} search={{ from: undefined, planItemId: undefined }}>
            <SignatureCard
              category={t("flavorIdentity.signatureRecipe")}
              headline={signatureRecipe.name}
              sub={t("flavorIdentity.signatureTimes", { count: signatureRecipe.count })}
            />
          </Link>
        )}

        {/* Top protein — only if not already shown via specialty badge */}
        {topProtein && (
          <NarrativeCard
            headline={t("flavorIdentity.topProteinTitle", {
              protein: t(`proteins.${topProtein}`, { defaultValue: topProtein }),
            })}
          />
        )}

        {/* Recently explored cuisine — full brand coral */}
        {showSignatureAndCuisine && cookSummary?.firstTimeCuisine && (
          <Link to="/app/library/$recipeId" params={{ recipeId: cookSummary.firstTimeCuisine.recipeId }} search={{ from: undefined, planItemId: undefined }}>
            <DiscoveryCard
              category={t("flavorIdentity.cuisineRecentLabel")}
              headline={t("flavorIdentity.cuisineDiscoveryHeadline", {
                cuisine: cuisineLabel(cookSummary.firstTimeCuisine.cuisine),
              })}
              sub={cookSummary.firstTimeCuisine.recipeName}
            />
          </Link>
        )}

        {/* Cuisine badge collection — hidden until first earned or teaser */}
        {(hasAnyBadge || visibleBadges.length > 0) && (
          <div className="space-y-3 pt-1">
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

        {/* Explored cuisine chips — breadth indicator, all cuisines cooked at least once */}
        {exploredCuisines.length > 0 && (
          <div className="space-y-2 pt-1">
            <p
              className="text-[10px] font-semibold uppercase tracking-widest px-1"
              style={{ color: "#9C6355" }}
            >
              {t("flavorIdentity.cuisineCollectionTitle")}
            </p>
            <div className="-mx-1 overflow-x-auto" style={{ overscrollBehaviorX: "contain" }}>
              <div className="flex gap-2 px-1 pb-1">
                {exploredCuisines.map((c) => (
                  <span
                    key={c}
                    className="text-[12px] px-3.5 py-1.5 rounded-full font-semibold whitespace-nowrap shrink-0"
                    style={{ background: "#FFE8DE", color: "#7A2C18" }}
                  >
                    {cuisineLabel(c)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Lifetime counters — bare centered text, archive-level content */}
        {(lifetimeCookCount > 0 || (cookProfile?.shopping_trip_count ?? 0) > 0) && (
          <div className="pt-2 pb-1 space-y-1 text-center">
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
    </div>
  );
}
