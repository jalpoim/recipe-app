import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { BookOpen, BookMarked, CalendarDays, ShoppingCart } from "lucide-react";

const NAV_ICONS: Record<string, { active: string; inactive: string }> = {
  library: {
    active: "/icons/nav/recipes.png",
    inactive: "/icons/nav/recipes.png",
  },
  "my-recipes": {
    active: "/icons/nav/kitchen.png",
    inactive: "/icons/nav/kitchen.png",
  },
  plan: { active: "/icons/nav/plan.png", inactive: "/icons/nav/plan.png" },
  shopping: { active: "/icons/nav/list.png", inactive: "/icons/nav/list.png" },
};
import { useTranslation } from "react-i18next";
import { fetchActivePlanWithCount } from "../lib/supabase/plan-queries";
import { acceptInvite } from "../lib/supabase/household-queries";
import {
  saveMeasurementUnit,
  fetchMyProfile,
} from "../lib/supabase/profile-queries";
import { getAuthUser } from "../lib/supabase/server";
import { supabase } from "../lib/supabase/browser";
import { capture, identifyUser } from "../lib/analytics";
import { detectLocaleFromBrowser } from "../lib/detect-locale";
import i18n from "../i18n";

export const Route = createFileRoute("/app")({
  beforeLoad: async () => {
    // getAuthUser() uses the server client (reads cookies from the request),
    // so it works correctly during SSR — unlike the browser client which has
    // no cookie access on the server and always returns null.
    const user = await getAuthUser();
    if (!user) throw redirect({ to: "/" });

    // Process pending invite saved before sign-in (client-only — localStorage
    // is undefined on the server so this block is safely skipped during SSR)
    const pendingToken =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("pendingInviteToken")
        : null;
    if (pendingToken) {
      localStorage.removeItem("pendingInviteToken");
      try {
        await acceptInvite({ data: pendingToken });
        await supabase.auth.refreshSession();
      } catch {
        // Silently ignore — invite may be expired or already used
      }
    }

    return { user };
  },
  component: AppLayout,
});

function BottomNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const prevTabRef = useRef(pathname);

  const { data: plan } = useQuery({
    queryKey: ["active-plan"],
    queryFn: fetchActivePlanWithCount,
    staleTime: 5 * 60 * 1000,
  });

  const itemCount = plan?.item_count ?? 0;

  const tabs = [
    {
      label: t("nav.recipes"),
      icon: BookOpen,
      to: "/app/library" as const,
      key: "library",
      disabled: false,
    },
    {
      label: t("nav.myRecipes"),
      icon: BookMarked,
      to: "/app/my-recipes" as const,
      key: "my-recipes",
      disabled: false,
    },
    {
      label: t("nav.plan"),
      icon: CalendarDays,
      to: "/app/plan" as const,
      key: "plan",
      badge: itemCount,
      disabled: false,
    },
    {
      label: t("nav.list"),
      icon: ShoppingCart,
      to: "/app/shopping" as const,
      key: "shopping",
      disabled: false,
    },
  ];

  function handleTabPress(to: string, key: string) {
    const from =
      tabs.find((tab) => pathname.startsWith(tab.to))?.key ?? "unknown";
    if (from === key) {
      // Already on this tab — scroll its list to top
      window.dispatchEvent(new CustomEvent(`tab:scroll-top:${key}`));
    } else {
      capture("tab_switched", { from, to: key });
    }
    prevTabRef.current = to;
  }

  const activeTabIndex = tabs.findIndex((tab) => pathname.startsWith(tab.to));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-[#E5E7EB] pb-safe">
      <div className="relative max-w-md mx-auto">
        {/* Sliding green indicator */}
        <div
          aria-hidden="true"
          className="absolute top-0 left-0 h-0.5 bg-[#F4623A] transition-[transform] duration-200 ease-in-out motion-reduce:transition-none"
          style={{
            width: `${100 / tabs.length}%`,
            transform: `translateX(${Math.max(0, activeTabIndex) * 100}%)`,
          }}
        />
        <div className="flex items-stretch">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.to);
            const Icon = tab.icon;

            if (tab.disabled) {
              return (
                <div
                  key={tab.to}
                  className="flex flex-col items-center justify-center flex-1 py-2 gap-0.5 opacity-35 cursor-not-allowed"
                  aria-disabled="true"
                >
                  <Icon size={22} aria-hidden="true" />
                  <span className="text-[10px] font-medium">{tab.label}</span>
                </div>
              );
            }

            const navIcon = NAV_ICONS[tab.key];
            return (
              <Link
                key={tab.to}
                to={tab.to}
                onClick={() => handleTabPress(tab.to, tab.key)}
                className={`relative flex flex-col items-center justify-center flex-1 py-1.5 gap-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none ${
                  isActive
                    ? "text-[#F4623A]"
                    : "text-[#9CA3AF] hover:text-[#6B7280]"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <div className="relative">
                  {navIcon ? (
                    <img
                      src={navIcon.active}
                      alt=""
                      className={`w-7 h-7 rounded-lg object-cover transition-opacity ${isActive ? "opacity-100" : "opacity-40"}`}
                      aria-hidden="true"
                    />
                  ) : (
                    <Icon size={22} aria-hidden="true" />
                  )}
                  {"badge" in tab && (tab.badge ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-[#F4623A] text-white text-[9px] font-bold flex items-center justify-center leading-none">
                      {(tab.badge ?? 0) > 99 ? "99+" : tab.badge}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10px] font-medium ${isActive ? "text-[#F4623A]" : "text-[#9CA3AF]"}`}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function TopProgressBar() {
  const isLoading = useRouterState({ select: (s) => s.status === "pending" });
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-0.5">
      <div
        className={`h-full bg-[#F4623A] transition-all duration-300 ${
          isLoading ? "opacity-100 animate-progress" : "opacity-0 w-full"
        }`}
      />
    </div>
  );
}

const LOCALE_BOOTSTRAP_KEY = "locale_bootstrapped_v1";

function AppLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOnboarding = pathname === "/app/onboarding";

  useEffect(() => {
    if (user) identifyUser(user.id, user.email);
  }, [user.id]);

  // Redirect new users to onboarding — reactive so it never fires with a stale isOnboarding value
  const { data: profileForOnboarding } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchMyProfile(),
    staleTime: 5 * 60 * 1000,
    enabled: !!user,
  });

  useEffect(() => {
    if (isOnboarding) return;
    if (profileForOnboarding && !profileForOnboarding.onboarding_completed) {
      navigate({ to: "/app/onboarding" });
    }
  }, [profileForOnboarding, isOnboarding]); // eslint-disable-line react-hooks/exhaustive-deps

  // On first visit per browser: detect language + units from Accept-Language and save to profile.
  // Uses a localStorage flag so this runs once and never overrides a deliberate user preference.
  useEffect(() => {
    if (!user) return;
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(LOCALE_BOOTSTRAP_KEY)) return;

    const { language, measurementUnit } = detectLocaleFromBrowser();

    // Apply detected language to i18next immediately
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }

    // Persist measurement unit to profile (fire-and-forget; non-critical)
    saveMeasurementUnit({ data: measurementUnit }).catch(() => {});

    localStorage.setItem(LOCALE_BOOTSTRAP_KEY, "1");
  }, [user.id]);

  return (
    <>
      <TopProgressBar />
      <Outlet />
      {!isOnboarding && <BottomNav />}
    </>
  );
}
