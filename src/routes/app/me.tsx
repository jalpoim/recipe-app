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
      className="relative px-5 pt-12 pb-10 text-white"
      style={{ background: "linear-gradient(145deg, #F4623A 0%, #C23E22 100%)" }}
    >
      <Link
        to="/app/settings"
        aria-label={t("flavorIdentity.settingsTitle")}
        className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center hover:bg-white/25 transition-colors focus:outline-none"
      >
        <Settings size={16} aria-hidden="true" />
      </Link>

      <div className="flex flex-col items-center text-center">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="w-20 h-20 rounded-full object-cover ring-4 ring-white/30 shrink-0 mb-3"
          />
        ) : (
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold ring-4 ring-white/30 shrink-0 mb-3"
            style={{ background: "rgba(255,255,255,0.2)" }}
            aria-hidden="true"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}

        <p className="text-xl font-bold leading-tight">{displayName}</p>
        {username && (
          <p className="text-sm text-white/60 mt-0.5">@{username}</p>
        )}

        <p className="text-[26px] font-bold leading-tight mt-4">{primaryTitle}</p>

        {specialtyBadgeLabel && (
          <div className="mt-2 px-3 py-1 rounded-full bg-white/15 border border-white/25">
            <p className="text-xs font-medium tracking-wide">{specialtyBadgeLabel}</p>
          </div>
        )}

        {subtitle && (
          <p className="text-[13px] text-white/65 max-w-[260px] leading-relaxed mt-4">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Stat card — number as the hero ──────────────────────────────────────────

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white shadow-sm px-7 py-6">
      <p className="text-[64px] font-extrabold leading-none text-[#F4623A] tracking-tight">
        {value}
      </p>
      <p className="text-[13px] text-[#9CA3AF] mt-2 leading-snug">{label}</p>
    </div>
  );
}

// ─── Discovery card — full-color, celebratory ─────────────────────────────────

function DiscoveryCard({ category, headline }: { category: string; headline: string }) {
  return (
    <div className="rounded-2xl bg-[#16A34A] shadow-sm px-6 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60 mb-1.5">
        {category}
      </p>
      <p className="text-[20px] font-bold text-white leading-snug">{headline}</p>
    </div>
  );
}

// ─── Signature card — dark, earned ───────────────────────────────────────────

function SignatureCard({
  category,
  headline,
  sub,
}: {
  category: string;
  headline: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl bg-[#1A1A1A] shadow-md px-6 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 mb-1.5">
        {category}
      </p>
      <p className="text-[18px] font-bold text-white leading-snug">{headline}</p>
      <p className="text-[12px] text-[#F4623A] mt-2 font-medium">{sub}</p>
    </div>
  );
}

// ─── Narrative card — clean white, for general content ───────────────────────

function NarrativeCard({
  category,
  headline,
  sub,
}: {
  category?: string;
  headline: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-white shadow-sm px-6 py-5">
      {category && (
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF] mb-1.5">
          {category}
        </p>
      )}
      <p className="text-[17px] font-bold text-[#1A1A1A] leading-snug">{headline}</p>
      {sub && (
        <p className="text-[12px] text-[#6B7280] mt-1 leading-relaxed">{sub}</p>
      )}
    </div>
  );
}

// ─── Badge card ───────────────────────────────────────────────────────────────

function BadgeCard({ label, category }: { label: string; category: string }) {
  return (
    <div className="flex-1 rounded-2xl bg-white shadow-sm overflow-hidden">
      <div className="h-0.5 bg-[#F4623A]" />
      <div className="px-4 pt-3 pb-5 flex flex-col items-center gap-1 text-center">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-[#9CA3AF]">
          {category}
        </p>
        <p className="text-[14px] font-bold text-[#1A1A1A] leading-snug">{label}</p>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="animate-pulse">
      <div
        className="h-60"
        style={{ background: "linear-gradient(145deg, #F4623A 0%, #C23E22 100%)" }}
      />
      <div className="px-4 py-6 space-y-4">
        <div className="rounded-2xl bg-white shadow-sm h-32" />
        <div className="rounded-2xl bg-[#16A34A] opacity-20 h-20" />
        <div className="rounded-2xl bg-[#1A1A1A] opacity-10 h-20" />
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

  // ── Top protein ────────────────────────────────────────────────────────────
  const topProtein =
    showTopProtein && cookSummary?.topProtein ? cookSummary.topProtein : null;

  // ── Cuisine collection ─────────────────────────────────────────────────────
  const exploredCuisines = cookProfile?.explored_cuisines ?? [];

  // ── Badge row visibility ───────────────────────────────────────────────────
  const showBadgeRow = !!creatorTitle || !!specialtyBadgeLabel;

  // ── Translate a cuisine slug to a proper label ─────────────────────────────
  function cuisineLabel(slug: string): string {
    return t(`flavorIdentity.cuisineLabels.${slug}`, { defaultValue: slug });
  }

  const lifetimeCookCount = cookProfile?.lifetime_cook_count ?? 0;

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

      <div className="max-w-md mx-auto px-4 py-6 space-y-4">

        {/* Badge row — appears only when earned */}
        {showBadgeRow && (
          <div className="flex gap-3">
            {creatorTitle && (
              <BadgeCard
                label={creatorTitle}
                category={t("flavorIdentity.creatorBadge")}
              />
            )}
            {specialtyBadgeLabel && (
              <BadgeCard
                label={specialtyBadgeLabel}
                category={t("flavorIdentity.specialtyBadgeCategory")}
              />
            )}
          </div>
        )}

        {/* Cook count — number as the statement */}
        {showCookCount && (
          <StatCard
            value={distinctCount}
            label={t("flavorIdentity.cookCountLabel")}
          />
        )}

        {/* First-time cuisine this month — celebratory full-green */}
        {showSignatureAndCuisine && cookSummary?.firstTimeCuisine && (
          <DiscoveryCard
            category={t("flavorIdentity.cuisineFirstTimeLabel")}
            headline={t("flavorIdentity.cuisineDiscoveryHeadline", {
              cuisine: cuisineLabel(cookSummary.firstTimeCuisine),
            })}
          />
        )}

        {/* Signature recipe — dark card, recipe name is the hero */}
        {signatureRecipe && (
          <SignatureCard
            category={t("flavorIdentity.signatureRecipe")}
            headline={signatureRecipe.name}
            sub={t("flavorIdentity.signatureTimes", { count: signatureRecipe.count })}
          />
        )}

        {/* Top protein */}
        {topProtein && (
          <NarrativeCard
            headline={t("flavorIdentity.topProteinTitle", {
              protein: t(`proteins.${topProtein}`, { defaultValue: topProtein }),
            })}
          />
        )}

        {/* Cuisine collection — label + horizontal scroll, no card container */}
        {exploredCuisines.length > 0 && (
          <div className="space-y-3 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF] px-1">
              {t("flavorIdentity.cuisineCollectionTitle")}
            </p>
            <div className="-mx-1 overflow-x-auto">
              <div className="flex gap-2 px-1 pb-1">
                {exploredCuisines.map((c) => (
                  <span
                    key={c}
                    className="text-[12px] px-3.5 py-1.5 rounded-full font-semibold whitespace-nowrap bg-[#FEF2EE] text-[#C23E22] shrink-0"
                  >
                    {cuisineLabel(c)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Lifetime counters — bare text, no container */}
        {(lifetimeCookCount > 0 || (cookProfile?.shopping_trip_count ?? 0) > 0) && (
          <div className="pt-2 pb-1 space-y-1 text-center">
            {lifetimeCookCount > 0 && (
              <p className="text-[13px] text-[#B0B3B8]">
                {t("flavorIdentity.lifetimeCooks", { count: lifetimeCookCount })}
              </p>
            )}
            {(cookProfile?.shopping_trip_count ?? 0) > 0 && (
              <p className="text-[13px] text-[#B0B3B8]">
                {t("flavorIdentity.lifetimeShopping", {
                  count: cookProfile!.shopping_trip_count,
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
