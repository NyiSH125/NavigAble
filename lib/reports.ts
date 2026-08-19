/**
 * Report shape and the presentation vocabulary shared by every view.
 *
 * Severity is never communicated by colour alone. Each level carries a written
 * label and a shape, and the list and detail panes render the label as text.
 */

import {
  type ObstacleType,
  type Permanence,
  type ReportSource,
  type SeverityProfile,
  type SeverityScore,
} from "./obstacles";

/** A report as the API returns it. The geom column is deliberately not selected. */
export interface Report {
  id: string;
  lat: number;
  lng: number;
  heading: number | null;
  photo_url: string;
  source: ReportSource;
  obstacle_types: ObstacleType[];
  sev_wheelchair: SeverityScore;
  sev_blind: SeverityScore;
  sev_low_vision: SeverityScore;
  sev_walker: SeverityScore;
  permanence: Permanence;
  ai_description: string | null;
  ai_confidence: number | null;
  confirmations: number;
  disputes: number;
  created_at: string;
  expires_at: string | null;
}

/** Columns the API selects. Excludes geom, which PostgREST returns as EWKB hex. */
export const REPORT_COLUMNS =
  "id,lat,lng,heading,photo_url,source,obstacle_types,sev_wheelchair,sev_blind,sev_low_vision,sev_walker,permanence,ai_description,ai_confidence,confirmations,disputes,created_at,expires_at";

// Profiles ------------------------------------------------------------------

export interface ProfileMeta {
  id: SeverityProfile;
  label: string;
  column: keyof Pick<
    Report,
    "sev_wheelchair" | "sev_blind" | "sev_low_vision" | "sev_walker"
  >;
  /** How this profile navigates, shown as help text next to the selector. */
  hint: string;
}

export const PROFILES: ProfileMeta[] = [
  {
    id: "wheelchair",
    label: "Wheelchair",
    column: "sev_wheelchair",
    hint: "Manual or powered wheelchair",
  },
  {
    id: "blind",
    label: "Blind",
    column: "sev_blind",
    hint: "Navigating by cane and by tactile and audible cues",
  },
  {
    id: "low_vision",
    label: "Low vision",
    column: "sev_low_vision",
    hint: "Usable but reduced vision",
  },
  {
    id: "walker",
    label: "Walker or cane",
    column: "sev_walker",
    hint: "Walker, rollator, cane, or crutches",
  },
];

export const DEFAULT_PROFILE: SeverityProfile = "wheelchair";

export function profileMeta(profile: SeverityProfile): ProfileMeta {
  return PROFILES.find((p) => p.id === profile) ?? PROFILES[0];
}

export function severityFor(report: Report, profile: SeverityProfile): SeverityScore {
  return report[profileMeta(profile).column];
}

// Severity levels -----------------------------------------------------------

/**
 * Shapes carry the same information as the colours, so the levels stay
 * distinguishable in greyscale and for anyone who cannot separate the hues.
 * None of them is a circle: a round badge would need a full border radius,
 * which the 4px ceiling in CLAUDE.md rules out.
 */
export type SeverityShape = "bar" | "square" | "diamond" | "triangle";

export interface SeverityMeta {
  score: SeverityScore;
  /** Full sentence label used in the detail pane. */
  label: string;
  /** Compact label used in list rows. */
  shortLabel: string;
  shape: SeverityShape;
  /** Map circle fill. */
  color: string;
  /** Map circle outline. */
  outline: string;
  /** Map circle radius at mid zoom, in pixels. Monotonic with severity. */
  radius: number;
  /** Map circle outline width, in pixels. Monotonic with severity. */
  outlineWidth: number;
}

export const SEVERITY_LEVELS: Record<SeverityScore, SeverityMeta> = {
  0: {
    score: 0,
    label: "No impact",
    shortLabel: "No impact",
    shape: "bar",
    color: "#6f6a5e",
    outline: "#a8a294",
    radius: 4,
    outlineWidth: 1,
  },
  1: {
    score: 1,
    label: "Minor inconvenience, passable with more effort",
    shortLabel: "Minor",
    shape: "square",
    color: "#c9a227",
    outline: "#efe3bd",
    radius: 5.5,
    outlineWidth: 1.5,
  },
  2: {
    score: 2,
    label: "Difficult and possibly unsafe",
    shortLabel: "Difficult",
    shape: "diamond",
    color: "#d1662b",
    outline: "#f6dcc6",
    radius: 7,
    outlineWidth: 2.5,
  },
  3: {
    score: 3,
    label: "Impassable",
    shortLabel: "Impassable",
    shape: "triangle",
    color: "#b3332b",
    outline: "#f4f0e8",
    radius: 8.5,
    outlineWidth: 3.5,
  },
};

export function severityMeta(score: SeverityScore): SeverityMeta {
  return SEVERITY_LEVELS[score];
}

// Obstacle type labels ------------------------------------------------------

export const OBSTACLE_TYPE_LABELS: Record<ObstacleType, string> = {
  stairs_only_entrance: "Stairs-only entrance",
  curb_no_cut: "Curb with no cut",
  broken_pavement: "Broken pavement",
  blocked_ramp: "Blocked ramp",
  narrow_passage: "Narrow passage",
  construction: "Construction",
  no_tactile_paving: "No tactile paving",
  steep_grade: "Steep grade",
  no_handrail: "No handrail",
  none: "No obstacle recorded",
};

/** Types offered in the filter UI. "none" is not a filterable obstacle. */
export const FILTERABLE_OBSTACLE_TYPES: ObstacleType[] = (
  Object.keys(OBSTACLE_TYPE_LABELS) as ObstacleType[]
).filter((type) => type !== "none");

export function obstacleTypeLabel(type: ObstacleType): string {
  return OBSTACLE_TYPE_LABELS[type] ?? type;
}

export function obstacleTypesSentence(types: ObstacleType[]): string {
  const named = types.filter((type) => type !== "none").map(obstacleTypeLabel);
  if (named.length === 0) return OBSTACLE_TYPE_LABELS.none;
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

// Formatting ----------------------------------------------------------------

const AGE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

/** "3 days ago". Written out rather than abbreviated, since it is read aloud. */
export function formatAge(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown age";

  const elapsed = now - then;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const { unit, ms } of AGE_UNITS) {
    if (Math.abs(elapsed) >= ms) {
      return formatter.format(-Math.round(elapsed / ms), unit);
    }
  }
  return "just now";
}

export function formatConfirmations(count: number): string {
  if (count === 0) return "No confirmations yet";
  return count === 1 ? "1 confirmation" : `${count} confirmations`;
}

export function formatConfidence(confidence: number | null): string {
  if (confidence === null) return "Not recorded";
  return `${Math.round(confidence * 100)} percent`;
}

export const SOURCE_LABELS: Record<ReportSource, string> = {
  user: "Reported by a person",
  mapillary: "Detected from Mapillary street imagery",
};

// Sorting -------------------------------------------------------------------

/** Most severe for the active profile first, then most recently reported. */
export function sortForProfile(reports: Report[], profile: SeverityProfile): Report[] {
  return [...reports].sort((a, b) => {
    const diff = severityFor(b, profile) - severityFor(a, profile);
    if (diff !== 0) return diff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
