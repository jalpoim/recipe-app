import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { fetchMyProfile } from "../../lib/supabase/profile-queries";
import {
  getCookProfile,
  getCookSummaryThisMonth,
  getDistinctCookedCount,
} from "../../lib/supabase/cook-log-queries";
import type { UserCookProfile } from "../../types/db";

export const Route = createFileRoute("/app/me")({
  component: ProfilePage,
});

// ─── Level thresholds ────────────────────────────────────────────────────────

const EXPLORER_THRESHOLDS = [10, 25, 50, 75, 100] as const;
const PCT_THRESHOLDS = [20, 40, 60, 80, 95] as const; // optimizer & swift
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
  return (Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0] as Axis);
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
      className="relative px-5 pt-14 pb-8 text-white overflow-hidden"
      style={{ background: "linear-gradient(145deg, #F4623A 0%, #C23E22 100%)" }}
    >
      <div
        aria-hidden="true"
        className="absolute -top-10 -right-10 w-48 h-48 rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
      />
      <div
        aria-hidden="true"
        className="absolute bottom-0 -left-6 w-32 h-32 rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
      />

      <Link
        to="/app/settings"
        aria-label={t("flavorIdentity.settingsTitle")}
        className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center hover:bg-white/25 transition-colors focus:outline-none"
      >
        <Settings size={16} aria-hidden="true" />
      </Link>

      <div className="flex flex-col items-center text-center gap-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="w-20 h-20 rounded-full object-cover ring-4 ring-white/30 shrink-0"
          />
        ) : (
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold ring-4 ring-white/30 shrink-0"
            style={{ background: "rgba(255,255,255,0.2)" }}
            aria-hidden="true"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}

        <div>
          <p className="text-xl font-bold leading-tight">{displayName}</p>
          {username && (
            <p className="text-sm text-white/70 mt-0.5">@{username}</p>
          )}
        </div>

        <div className="mt-1 px-4 py-1.5 rounded-full bg-white/20 backdrop-blur-sm border border-white/30">
          <p className="text-sm font-semibold tracking-wide">{primaryTitle}</p>
        </div>

        {specialtyBadgeLabel && (
          <div className="px-3 py-1 rounded-full bg-white/15 border border-white/20">
            <p className="text-xs font-medium">{specialtyBadgeLabel}</p>
          </div>
        )}

        {subtitle && (
          <p className="text-xs text-white/70 max-w-[240px] leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Narrative card ───────────────────────────────────────────────────────────

function NarrativeCard({
  emoji,
  headline,
  sub,
  accent,
}: {
  emoji: string;
  headline: string;
  sub?: string;
  accent?: "green" | "orange" | "default";
}) {
  const bg =
    accent === "green"
      ? "bg-[#f0fdf4] border-[#86efac]"
      : accent === "orange"
        ? "bg-[#FEF2EE] border-[#F4623A]/30"
        : "bg-white border-[#F0F0EE]";

  return (
    <div className={`rounded-2xl border p-4 flex gap-3 items-start shadow-sm ${bg}`}>
      <span className="text-2xl leading-none shrink-0 mt-0.5" aria-hidden="true">
        {emoji}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#1A1A1A] leading-snug">
          {headline}
        </p>
        {sub && (
          <p className="text-xs text-[#6B7280] mt-0.5 leading-relaxed">{sub}</p>
        )}
      </div>
    </div>
  );
}

// ─── Badge row ────────────────────────────────────────────────────────────────

function BadgeCard({
  label,
  sublabel,
  emoji,
}: {
  label: string;
  sublabel: string;
  emoji: string;
}) {
  return (
    <div className="flex-1 rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 flex flex-col items-center gap-2 text-center">
      <span className="text-3xl leading-none" aria-hidden="true">{emoji}</span>
      <p className="text-xs font-semibold text-[#1A1A1A] leading-snug">{label}</p>
      <p className="text-[10px] text-[#6B7280]">{sublabel}</p>
    </div>
  );
}

// ─── Lifetime counters ────────────────────────────────────────────────────────

function LifetimeCounters({
  cookCount,
  shoppingCount,
}: {
  cookCount: number;
  shoppingCount: number;
}) {
  const { t } = useTranslation();

  if (cookCount === 0 && shoppingCount === 0) return null;

  return (
    <div className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 space-y-1.5">
      {cookCount > 0 && (
        <p className="text-sm text-[#6B7280]">
          🍳 {t("flavorIdentity.lifetimeCooks", { count: cookCount })}
        </p>
      )}
      {shoppingCount > 0 && (
        <p className="text-sm text-[#6B7280]">
          🛒 {t("flavorIdentity.lifetimeShopping", { count: shoppingCount })}
        </p>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="animate-pulse">
      <div
        className="h-56"
        style={{ background: "linear-gradient(145deg, #F4623A 0%, #C23E22 100%)" }}
      />
      <div className="px-4 py-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl bg-white border border-[#F0F0EE] p-4 h-[72px]"
          >
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-[#F3F4F6] shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-[#F3F4F6] rounded-full w-3/4" />
                <div className="h-3 bg-[#F3F4F6] rounded-full w-1/2" />
              </div>
            </div>
          </div>
        ))}
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
  const specialtyBadgeKey = cookProfile?.specialty_badge_key ?? null;
  const specialtyBadgeLabel = specialtyBadgeKey
    ? t(`flavorIdentity.specialtyBadge.${specialtyBadgeKey}`, { defaultValue: "" }) || null
    : null;

  // ── Creator badge ──────────────────────────────────────────────────────────
  const creatorPoints = Number(cookProfile?.creator_points ?? 0);
  const creatorLevel = creatorPoints >= CREATOR_THRESHOLDS[0] ? getCreatorLevel(creatorPoints) : null;
  const creatorTitle = creatorLevel
    ? t(`flavorIdentity.titles.creator.${creatorLevel}`)
    : null;

  // ── Hero subtitle ──────────────────────────────────────────────────────────
  const lifetimeCookCount = cookProfile?.lifetime_cook_count ?? 0;
  const heroSubtitle =
    lifetimeCookCount < 5 ? t("flavorIdentity.heroSubtitleNewCook") : "";

  // ── Unlock gates ───────────────────────────────────────────────────────────
  const showCookCount = distinctCount >= 5;
  const showSignatureAndCuisine = distinctCount >= 10;
  const showTopProtein = distinctCount >= 15;

  // ── Signature recipe (≥3 cooks same recipe, ≥10 distinct) ─────────────────
  const signatureRecipe =
    showSignatureAndCuisine && cookSummary?.mostCookedRecipe?.count != null &&
    cookSummary.mostCookedRecipe.count >= 3
      ? cookSummary.mostCookedRecipe
      : null;

  // ── Top protein (≥40% concentration) ──────────────────────────────────────
  const topProtein = showTopProtein && cookSummary?.topProtein ? cookSummary.topProtein : null;

  // ── Cuisine collection ─────────────────────────────────────────────────────
  const exploredCuisines = cookProfile?.explored_cuisines ?? [];
  // Badge earned = cooked ≥3 distinct recipes; for now we surface all explored as earned
  const earnedCuisineBadges = exploredCuisines.length > 0 ? exploredCuisines : [];

  // ── Badge row visibility ───────────────────────────────────────────────────
  const showBadgeRow = !!creatorTitle || !!specialtyBadgeLabel;

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <IdentityHero
        displayName={displayName}
        username={username}
        avatarUrl={avatarUrl}
        primaryTitle={primaryTitle}
        subtitle={heroSubtitle}
        specialtyBadgeLabel={specialtyBadgeLabel ?? undefined}
      />

      <div className="max-w-md mx-auto px-4 py-6 space-y-3">

        {/* Badge row — creator + specialty */}
        {showBadgeRow && (
          <div className="flex gap-3">
            {creatorTitle && (
              <BadgeCard
                emoji="📓"
                label={creatorTitle}
                sublabel={t("flavorIdentity.creatorBadge")}
              />
            )}
            {specialtyBadgeLabel && (
              <BadgeCard
                emoji="⭐"
                label={specialtyBadgeLabel}
                sublabel={t("flavorIdentity.specialtyBadge.label", { defaultValue: "Specialty" })}
              />
            )}
          </div>
        )}

        {/* Cook count card (gate: 5+ cooks) */}
        {showCookCount && cookSummary && (
          <NarrativeCard
            emoji="🍳"
            headline={t("flavorIdentity.cookCountCard", { count: distinctCount })}
            accent="orange"
          />
        )}

        {/* Cuisine discovery card (gate: 10+ cooks) */}
        {showSignatureAndCuisine && cookSummary?.firstTimeCuisine && (
          <NarrativeCard
            emoji="🌍"
            headline={t("flavorIdentity.cuisineDiscoveryTitle")}
            sub={cookSummary.firstTimeCuisine}
            accent="green"
          />
        )}

        {/* Signature recipe card (gate: 10+ cooks, same recipe ≥3×) */}
        {signatureRecipe && (
          <NarrativeCard
            emoji="⭐"
            headline={t("flavorIdentity.signatureCardTitle")}
            sub={signatureRecipe.name}
          />
        )}

        {/* Top protein card (gate: 15+ cooks, ≥40% concentration) */}
        {topProtein && (
          <NarrativeCard
            emoji="💪"
            headline={t("flavorIdentity.topProteinTitle", {
              protein: t(`proteins.${topProtein}`, { defaultValue: topProtein }),
            })}
          />
        )}

        {/* Cuisine badge collection */}
        {earnedCuisineBadges.length > 0 && (
          <div className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-widest">
              {t("flavorIdentity.cuisineDiscoveryTitle")}
            </p>
            <div className="flex flex-wrap gap-2">
              {earnedCuisineBadges.map((c) => (
                <span
                  key={c}
                  className="text-xs px-3 py-1 rounded-full font-medium bg-[#F3F4F6] text-[#6B7280]"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Lifetime counters */}
        <LifetimeCounters
          cookCount={lifetimeCookCount}
          shoppingCount={cookProfile?.shopping_trip_count ?? 0}
        />
      </div>
    </div>
  );
}
