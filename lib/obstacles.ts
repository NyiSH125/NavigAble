/**
 * Shared domain vocabulary for obstacles and severity.
 *
 * This file has no dependencies on purpose. Both the vision provider and the
 * client components import it, so pulling anything heavy in here would drag a
 * server SDK into the browser bundle.
 */

export const OBSTACLE_TYPES = [
  "stairs_only_entrance",
  "curb_no_cut",
  "broken_pavement",
  "blocked_ramp",
  "narrow_passage",
  "construction",
  "no_tactile_paving",
  "steep_grade",
  "no_handrail",
  "none",
] as const;

export type ObstacleType = (typeof OBSTACLE_TYPES)[number];

export const PERMANENCE_VALUES = ["permanent", "temporary"] as const;

export type Permanence = (typeof PERMANENCE_VALUES)[number];

export const REPORT_SOURCES = ["user", "mapillary"] as const;

export type ReportSource = (typeof REPORT_SOURCES)[number];

export const SEVERITY_PROFILES = [
  "wheelchair",
  "blind",
  "low_vision",
  "walker",
] as const;

export type SeverityProfile = (typeof SEVERITY_PROFILES)[number];

/** 0 = no impact, 1 = minor inconvenience, 2 = difficult and possibly unsafe, 3 = impassable. */
export type SeverityScore = 0 | 1 | 2 | 3;

export type SeverityByProfile = Record<SeverityProfile, SeverityScore>;

export function isObstacleType(value: string): value is ObstacleType {
  return (OBSTACLE_TYPES as readonly string[]).includes(value);
}

export function isSeverityProfile(value: string): value is SeverityProfile {
  return (SEVERITY_PROFILES as readonly string[]).includes(value);
}
