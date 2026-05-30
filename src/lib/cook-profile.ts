import type { UserCookProfile } from "../types/db";

// ─── Cook-profile axis math (shared) ─────────────────────────────────────────
// Single source of truth for level thresholds and primary-axis selection, used
// by the profile page (me.tsx) and the level-up detection on recipe detail
// ($recipeId.tsx). Keep them importing from here so the two never drift.

export type Axis = "explorer" | "optimizer" | "planner" | "swift";

export const EXPLORER_THRESHOLDS = [10, 25, 50, 75, 100] as const;
export const PCT_THRESHOLDS = [20, 40, 60, 80, 95] as const; // optimizer + swift (0–100 %)
export const PLANNER_THRESHOLDS = [3, 10, 20, 35, 50] as const;
export const CREATOR_THRESHOLDS = [5, 15, 30, 55, 90] as const;

export function getLevel(
  score: number,
  thresholds: readonly number[],
): 1 | 2 | 3 | 4 | 5 {
  if (score >= thresholds[4]) return 5;
  if (score >= thresholds[3]) return 4;
  if (score >= thresholds[2]) return 3;
  if (score >= thresholds[1]) return 2;
  return 1;
}

export function getCreatorLevel(points: number): 1 | 2 | 3 | 4 | 5 {
  return getLevel(points, CREATOR_THRESHOLDS);
}

export function axisThresholds(axis: Axis): readonly number[] {
  if (axis === "explorer") return EXPLORER_THRESHOLDS;
  if (axis === "planner") return PLANNER_THRESHOLDS;
  return PCT_THRESHOLDS;
}

export function axisScore(axis: Axis, cp: UserCookProfile): number {
  switch (axis) {
    case "explorer":
      return Number(cp.explorer_score);
    case "optimizer":
      return Number(cp.optimizer_score);
    case "planner":
      return Number(cp.planner_score);
    case "swift":
      return Number(cp.swift_score);
  }
}

export function getAxisLevel(axis: Axis, cp: UserCookProfile): 1 | 2 | 3 | 4 | 5 {
  return getLevel(axisScore(axis, cp), axisThresholds(axis));
}

// 0–100 progress toward the NEXT level on the given axis; null if already max.
export function axisProgressPct(
  axis: Axis,
  cp: UserCookProfile,
): number | null {
  const thresholds = axisThresholds(axis);
  const score = axisScore(axis, cp);
  const level = getLevel(score, thresholds);
  if (level >= 5) return null;
  const lo = level === 1 ? 0 : thresholds[level - 1];
  const hi = thresholds[level];
  if (hi <= lo) return 0;
  return Math.min(
    100,
    Math.max(0, Math.round(((score - lo) / (hi - lo)) * 100)),
  );
}

// Normalised rank = level (1–5) + fractional progress within the band (0–1).
// At max level the fractional part is 1 → rank 6. This puts every axis on the
// SAME per-level scale, so the unbounded axes (explorer/planner) no longer beat
// the capped percentage axes (optimizer/swift) merely because their raw numbers
// grow larger. This is the Finding 2 fix — all four axes are equally winnable.
function axisRank(axis: Axis, cp: UserCookProfile): number {
  const level = getAxisLevel(axis, cp);
  const pct = axisProgressPct(axis, cp);
  return level + (pct === null ? 1 : pct / 100);
}

// Tie-breaker for exact equality only (rare — e.g. a brand-new all-zero profile).
// Higher wins. Explorer is last so it no longer wins ties by default; it was the
// systematic over-winner before normalisation.
const TIE_PRIORITY: Record<Axis, number> = {
  planner: 3,
  optimizer: 2,
  swift: 1,
  explorer: 0,
};

const ALL_AXES: Axis[] = ["explorer", "optimizer", "planner", "swift"];

export function getPrimaryAxis(cp: UserCookProfile): Axis {
  return ALL_AXES.map((axis) => ({
    axis,
    rank: axisRank(axis, cp),
    tie: TIE_PRIORITY[axis],
  })).sort((a, b) => b.rank - a.rank || b.tie - a.tie)[0].axis;
}

export function getPrimaryLevel(cp: UserCookProfile): 1 | 2 | 3 | 4 | 5 {
  return getAxisLevel(getPrimaryAxis(cp), cp);
}

export function progressToNextLevelPct(cp: UserCookProfile): number | null {
  return axisProgressPct(getPrimaryAxis(cp), cp);
}
