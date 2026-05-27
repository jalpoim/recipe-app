import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { fetchMyProfile } from "../../lib/supabase/profile-queries";
import {
  getCookSummaryThisMonth,
  getDistinctCookedCount,
  getSavesSummary,
  type CookSummary,
} from "../../lib/supabase/cook-log-queries";

export const Route = createFileRoute("/app/me")({
  component: ProfilePage,
});

const UNLOCK_THRESHOLD = 5;

function getPersonaKey(topProtein: string | null): string {
  if (!topProtein) return "default";
  const known = [
    "chicken","beef","pork","fish","salmon","shrimp","eggs","tofu","turkey","lamb",
  ];
  return known.includes(topProtein) ? topProtein : "default";
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function IdentityHero({
  displayName,
  username,
  avatarUrl,
  identityTitle,
  subtitle,
}: {
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  identityTitle: string;
  subtitle: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="relative px-5 pt-14 pb-8 text-white overflow-hidden"
      style={{ background: "linear-gradient(145deg, #F4623A 0%, #C23E22 100%)" }}
    >
      {/* Decorative blobs */}
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

      {/* Settings link — top right */}
      <Link
        to="/app/settings"
        aria-label={t("flavorIdentity.settingsTitle")}
        className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center hover:bg-white/25 transition-colors focus:outline-none"
      >
        <Settings size={16} aria-hidden="true" />
      </Link>

      {/* Avatar */}
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

        {/* Identity badge */}
        <div className="mt-1 px-4 py-1.5 rounded-full bg-white/20 backdrop-blur-sm border border-white/30">
          <p className="text-sm font-semibold tracking-wide">{identityTitle}</p>
        </div>
        {subtitle && (
          <p className="text-xs text-white/70 max-w-[220px] leading-relaxed">
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

// ─── Progress tier (new / browser users) ─────────────────────────────────────

function ProgressSection({
  distinctCount,
  savesSummary,
}: {
  distinctCount: number;
  savesSummary: { topCuisine: string | null; topProtein: string | null } | undefined;
}) {
  const { t } = useTranslation();
  const remaining = UNLOCK_THRESHOLD - distinctCount;
  const progress = Math.round((distinctCount / UNLOCK_THRESHOLD) * 100);
  const hasSaves =
    savesSummary?.topCuisine !== null || savesSummary?.topProtein !== null;

  return (
    <div className="space-y-3">
      {hasSaves && (savesSummary?.topProtein || savesSummary?.topCuisine) && (
        <NarrativeCard
          emoji="👀"
          headline={t("flavorIdentity.browserTitle")}
          sub={[savesSummary?.topProtein
            ? t(`proteins.${savesSummary.topProtein}`, { defaultValue: savesSummary.topProtein })
            : null,
            savesSummary?.topCuisine,
          ]
            .filter(Boolean)
            .join(" · ")}
          accent="orange"
        />
      )}

      <div className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 space-y-3">
        <p className="text-sm font-semibold text-[#1A1A1A]">
          {t("flavorIdentity.progressHint", { remaining })}
        </p>
        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-[#F3F4F6] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(90deg, #F4623A, #D94F2B)",
              }}
            />
          </div>
          <p className="text-xs text-[#9CA3AF] text-right">
            {t("flavorIdentity.progressCount", {
              current: distinctCount,
              total: UNLOCK_THRESHOLD,
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Active cook stats ────────────────────────────────────────────────────────

function ActiveCookSection({ summary }: { summary: CookSummary }) {
  const { t, i18n } = useTranslation();

  const monthName = new Date().toLocaleDateString(i18n.language, {
    month: "long",
  });
  const delta = summary.countThisMonth - summary.countLastMonth;

  const deltaLabel =
    delta > 0
      ? t("flavorIdentity.upVsLastMonth", { n: delta })
      : delta < 0
        ? t("flavorIdentity.downVsLastMonth", { n: Math.abs(delta) })
        : t("flavorIdentity.sameAsLastMonth");

  const isBestMonth = delta > 0 && summary.countLastMonth > 0;

  return (
    <div className="space-y-3">
      {/* Cook count */}
      <NarrativeCard
        emoji="🍳"
        headline={t("flavorIdentity.cookedTimes", { count: summary.countThisMonth })}
        sub={isBestMonth ? t("flavorIdentity.bestMonth") : deltaLabel}
        accent="orange"
      />

      {/* Signature recipe */}
      {summary.mostCookedRecipe && (
        <NarrativeCard
          emoji="⭐"
          headline={`${t("flavorIdentity.signatureRecipe")}: ${summary.mostCookedRecipe.name}`}
          sub={t("flavorIdentity.signatureTimes", {
            count: summary.mostCookedRecipe.count,
          })}
        />
      )}

      {/* First-time cuisine */}
      {summary.firstTimeCuisine && (
        <NarrativeCard
          emoji="🌍"
          headline={t("flavorIdentity.newCuisineUnlock", {
            cuisine: summary.firstTimeCuisine,
          })}
          accent="green"
        />
      )}

      {/* Top protein personality */}
      {summary.topProtein && (
        <NarrativeCard
          emoji="💪"
          headline={t("flavorIdentity.proteinPersonality", {
            protein: t(`proteins.${summary.topProtein}`, {
              defaultValue: summary.topProtein,
            }),
          })}
        />
      )}

      {/* Month title chip — decorative label */}
      <p className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-widest px-1 pt-1">
        {t("flavorIdentity.monthTitle", { month: monthName })}
      </p>

      {/* Cuisines explored */}
      {summary.cuisinesThisMonth.length > 0 && (
        <div className="rounded-2xl bg-white border border-[#F0F0EE] shadow-sm p-4 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {summary.cuisinesThisMonth.map((c) => (
              <span
                key={c}
                className={`text-xs px-3 py-1 rounded-full font-medium ${
                  c === summary.firstTimeCuisine
                    ? "bg-[#dcfce7] text-[#15803d]"
                    : "bg-[#F3F4F6] text-[#6B7280]"
                }`}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Mastered recipes */}
      {summary.masteredRecipes.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between px-1">
            <p className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-widest">
              {t("flavorIdentity.masteredTitle")}
            </p>
            <p className="text-xs text-[#9CA3AF]">
              {t("flavorIdentity.masteredHint")}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {summary.masteredRecipes.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-2xl bg-[#fef3c7] border border-[#fbbf24]/30 px-4 py-3"
              >
                <span className="text-lg leading-none" aria-hidden="true">
                  🏆
                </span>
                <p className="text-sm font-semibold text-[#92400E]">{r.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Hero skeleton */}
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

  const { data: cookSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ["cook-summary-this-month"],
    queryFn: () => getCookSummaryThisMonth(),
    staleTime: 5 * 60 * 1000,
    enabled: distinctCount >= UNLOCK_THRESHOLD,
  });

  const { data: savesSummary, isLoading: savesLoading } = useQuery({
    queryKey: ["saves-summary"],
    queryFn: () => getSavesSummary(),
    staleTime: 5 * 60 * 1000,
    enabled: distinctCount < UNLOCK_THRESHOLD,
  });

  if (countLoading || !profile) return <ProfileSkeleton />;

  const displayName = profile.display_name ?? "—";
  const username = profile.username ?? null;
  const avatarUrl = profile.avatar_url ?? null;

  const isActiveCook = distinctCount >= UNLOCK_THRESHOLD;
  const hasSaves =
    savesSummary?.topCuisine !== null || savesSummary?.topProtein !== null;

  // Derive identity title
  let identityTitle: string;
  let heroSubtitle: string;

  if (isActiveCook && cookSummary?.topProtein) {
    const personaKey = getPersonaKey(cookSummary.topProtein);
    identityTitle = t(`flavorIdentity.persona.${personaKey}`);
    heroSubtitle = t("flavorIdentity.cookedTimes", { count: cookSummary.countThisMonth });
  } else if (!isActiveCook && hasSaves && savesSummary?.topProtein) {
    const personaKey = getPersonaKey(savesSummary.topProtein);
    identityTitle = t(`flavorIdentity.persona.${personaKey}`);
    heroSubtitle = t("flavorIdentity.browserTitle");
  } else {
    identityTitle = t("flavorIdentity.newCook");
    heroSubtitle = t("flavorIdentity.progressHint", {
      remaining: UNLOCK_THRESHOLD - distinctCount,
    });
  }

  const showActiveCook = isActiveCook && !summaryLoading && cookSummary;
  const showProgress = !isActiveCook;

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      <IdentityHero
        displayName={displayName}
        username={username}
        avatarUrl={avatarUrl}
        identityTitle={identityTitle}
        subtitle={heroSubtitle}
      />

      <div className="max-w-md mx-auto px-4 py-6 space-y-3">
        {showActiveCook ? (
          <ActiveCookSection summary={cookSummary!} />
        ) : showProgress ? (
          <ProgressSection
            distinctCount={distinctCount}
            savesSummary={savesLoading ? undefined : savesSummary}
          />
        ) : (
          <ProfileSkeleton />
        )}
      </div>
    </div>
  );
}
