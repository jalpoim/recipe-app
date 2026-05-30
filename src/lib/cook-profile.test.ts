import { describe, it, expect } from "vitest";
import type { UserCookProfile } from "../types/db";
import {
  getPrimaryAxis,
  getPrimaryLevel,
  getAxisLevel,
  axisProgressPct,
  progressToNextLevelPct,
} from "./cook-profile";

// Build a UserCookProfile with only the score fields that matter; the rest are
// filler so the object satisfies the type.
function cp(scores: {
  explorer?: number;
  optimizer?: number;
  planner?: number;
  swift?: number;
}): UserCookProfile {
  return {
    user_id: "u",
    explorer_score: scores.explorer ?? 0,
    optimizer_score: scores.optimizer ?? 0,
    planner_score: scores.planner ?? 0,
    swift_score: scores.swift ?? 0,
    creator_points: 0,
    specialty_badge_key: null,
    lifetime_cook_count: 0,
    shopping_trip_count: 0,
    explored_cuisines: [],
    explored_proteins: [],
    last_computed_at: null,
  } as unknown as UserCookProfile;
}

describe("getPrimaryAxis — normalized (Finding 2)", () => {
  it("picks the higher-LEVEL axis even when another axis has a larger RAW score", () => {
    // explorer raw 96 > optimizer raw 95, but optimizer is a full level higher
    // (optimizer 95 = L5; explorer 96 = L4). Old raw-score code picked explorer.
    const profile = cp({ explorer: 96, optimizer: 95 });
    expect(getPrimaryAxis(profile)).toBe("optimizer");
  });

  it("still lets a genuine explorer win when they actually lead on level", () => {
    const profile = cp({ explorer: 100, optimizer: 40, planner: 5, swift: 30 });
    expect(getPrimaryAxis(profile)).toBe("explorer");
  });

  it("does not default to explorer on a flat all-zero profile (tie-breaker)", () => {
    // All axes L1 / 0% — explorer must NOT win by default anymore.
    expect(getPrimaryAxis(cp({}))).toBe("planner");
  });

  it("lets the capped percentage axes (optimizer/swift) be primary", () => {
    expect(getPrimaryAxis(cp({ swift: 95, explorer: 60 }))).toBe("swift");
  });
});

describe("level + progress helpers", () => {
  it("getPrimaryLevel reflects the chosen axis", () => {
    expect(getPrimaryLevel(cp({ optimizer: 95, explorer: 96 }))).toBe(5);
  });

  it("progressToNextLevelPct is null at max level", () => {
    expect(progressToNextLevelPct(cp({ optimizer: 95 }))).toBeNull();
  });

  it("axisProgressPct computes fractional progress within a level band", () => {
    // swift 50 → PCT band [40,60) at L2 → (50-40)/(60-40) = 50%
    expect(axisProgressPct("swift", cp({ swift: 50 }))).toBe(50);
  });

  it("getAxisLevel matches the threshold tables", () => {
    expect(getAxisLevel("explorer", cp({ explorer: 50 }))).toBe(3);
    expect(getAxisLevel("planner", cp({ planner: 20 }))).toBe(3);
  });
});
