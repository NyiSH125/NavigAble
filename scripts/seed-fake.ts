/**
 * Seeds six fabricated reports so the map and list are testable before real
 * data exists.
 *
 *   npx tsx scripts/seed-fake.ts                     insert, skipping duplicates
 *   npx tsx scripts/seed-fake.ts --reset             remove previous fake rows first
 *   npx tsx scripts/seed-fake.ts --center=lng,lat    move the whole set somewhere
 *
 * The centre matters for a demo: the rows have to sit where the map opens. Pass
 * the same point to NEXT_PUBLIC_DEFAULT_CENTER so the two agree.
 *
 * The rows are deliberately marked: photo_url points at seed-fake/ inside the
 * reports bucket and reporter_id is "seed-fake", so they are easy to find and
 * remove. The severities are hand-written to differ across profiles, which is
 * the property the list ordering and the profile selector need to exercise.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { type ObstacleType, type Permanence, type SeverityScore } from "../lib/obstacles";

/** Where the fabricated set is centred by default, matching NEXT_PUBLIC_DEFAULT_CENTER. */
const DEFAULT_CENTER: [number, number] = [-122.04584, 37.3193];

const BUCKET = "reports";
const PREFIX = "seed-fake";
const REPORTER_ID = "seed-fake";

interface FakeReport {
  slug: string;
  lat: number;
  lng: number;
  heading: number | null;
  obstacle_types: ObstacleType[];
  sev: [SeverityScore, SeverityScore, SeverityScore, SeverityScore];
  permanence: Permanence;
  ai_description: string;
  ai_confidence: number;
  confirmations: number;
  disputes: number;
  source: "user" | "mapillary";
  ageHours: number;
  expiresInHours: number | null;
  /** Drawn into the placeholder image so each photo is visually distinct. */
  caption: string;
}

/** Severities are [wheelchair, blind, low_vision, walker]. */
const FAKE_REPORTS: FakeReport[] = [
  {
    slug: "stairs-only-library",
    lat: 37.3197,
    lng: -122.0462,
    heading: 210,
    obstacle_types: ["stairs_only_entrance", "no_handrail"],
    sev: [3, 1, 1, 2],
    permanence: "permanent",
    ai_description:
      "The only way into this entrance is a flight of eight steps with no handrail, so you cannot get in this way with wheels.",
    ai_confidence: 0.93,
    confirmations: 7,
    disputes: 0,
    source: "user",
    ageHours: 52,
    expiresInHours: null,
    caption: "Stairs-only entrance",
  },
  {
    slug: "curb-no-cut-crossing",
    lat: 37.3188,
    lng: -122.0447,
    heading: 95,
    obstacle_types: ["curb_no_cut"],
    sev: [3, 2, 1, 2],
    permanence: "permanent",
    ai_description:
      "The crossing ends at a full-height curb with no dropped kerb, so you will need to double back to the previous corner.",
    ai_confidence: 0.88,
    confirmations: 4,
    disputes: 1,
    source: "mapillary",
    ageHours: 9,
    expiresInHours: null,
    caption: "Curb with no cut",
  },
  {
    slug: "construction-detour",
    lat: 37.3203,
    lng: -122.0439,
    heading: 15,
    obstacle_types: ["construction", "narrow_passage"],
    sev: [2, 3, 2, 2],
    permanence: "temporary",
    ai_description:
      "Fencing narrows the footway to about half a metre and the barriers are unlit, so this is easy to walk into.",
    ai_confidence: 0.71,
    confirmations: 2,
    disputes: 0,
    source: "user",
    ageHours: 4,
    expiresInHours: 24 * 21,
    caption: "Construction hoarding",
  },
  {
    slug: "broken-pavement-plaza",
    lat: 37.3191,
    lng: -122.0475,
    heading: null,
    obstacle_types: ["broken_pavement"],
    sev: [2, 2, 1, 3],
    permanence: "permanent",
    ai_description:
      "Cracked and lifted paving slabs run for about ten metres here, and the lips are high enough to catch a walker wheel.",
    ai_confidence: 0.79,
    confirmations: 11,
    disputes: 2,
    source: "mapillary",
    ageHours: 24 * 12,
    expiresInHours: null,
    caption: "Broken pavement",
  },
  {
    slug: "no-tactile-paving-platform",
    lat: 37.3206,
    lng: -122.0468,
    heading: 300,
    obstacle_types: ["no_tactile_paving"],
    sev: [0, 3, 2, 0],
    permanence: "permanent",
    ai_description:
      "This transit platform edge has no tactile warning strip, so there is nothing underfoot to tell you where the drop starts.",
    ai_confidence: 0.84,
    confirmations: 5,
    disputes: 0,
    source: "user",
    ageHours: 24 * 3,
    expiresInHours: null,
    caption: "No tactile paving",
  },
  {
    slug: "blocked-ramp-bins",
    lat: 37.3184,
    lng: -122.0454,
    heading: 130,
    obstacle_types: ["blocked_ramp"],
    sev: [3, 2, 2, 1],
    permanence: "temporary",
    ai_description:
      "Two wheeled bins are parked across the bottom of the ramp, leaving a gap too narrow to pass through.",
    ai_confidence: 0.9,
    confirmations: 1,
    disputes: 0,
    source: "user",
    ageHours: 2,
    expiresInHours: 48,
    caption: "Blocked ramp",
  },
];

/** Parses --center=lng,lat. Falls back to the built-in centre. */
function parseCenterArg(argv: string[]): { center: [number, number]; explicit: boolean } {
  const arg = argv.find((value) => value.startsWith("--center="));
  if (!arg) return { center: DEFAULT_CENTER, explicit: false };
  const parts = arg.slice("--center=".length).split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Could not read ${arg}. Expected --center=lng,lat`);
  }
  const [lng, lat] = parts;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new Error(`--center is out of range: ${lng},${lat}`);
  }
  return { center: [lng, lat], explicit: true };
}

/**
 * Moves a seeded point by the offset between the two centres, so relocating the
 * set preserves the spacing between obstacles rather than piling them up.
 */
function relocate(
  report: FakeReport,
  center: [number, number],
): { lat: number; lng: number } {
  return {
    lng: report.lng - DEFAULT_CENTER[0] + center[0],
    lat: report.lat - DEFAULT_CENTER[1] + center[1],
  };
}

async function loadEnvLocal(): Promise<void> {
  let text: string;
  try {
    text = await readFile(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    const value = rawValue.trim().replace(/^["'](.*)["']$/, "$1");
    if (value !== "") process.env[key] = value;
  }
}

/**
 * Placeholder photo. Flat colour and a caption, no attempt to look like a real
 * photograph, so nobody mistakes seeded rows for evidence.
 */
async function placeholderJpeg(report: FakeReport): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <rect width="800" height="600" fill="#23272e"/>
  <rect x="24" y="24" width="752" height="552" fill="none" stroke="#7a818a" stroke-width="2"/>
  <text x="48" y="96" font-family="Georgia, serif" font-size="20" fill="#b8b2a4">Seeded example, not a real photograph</text>
  <text x="48" y="168" font-family="Georgia, serif" font-size="44" fill="#f4f0e8">${report.caption}</text>
  <text x="48" y="232" font-family="Georgia, serif" font-size="22" fill="#b8b2a4">${report.permanence === "temporary" ? "Temporary obstruction" : "Permanent feature"}</text>
  <text x="48" y="540" font-family="Georgia, serif" font-size="18" fill="#7a818a">${report.slug}</text>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

async function main(): Promise<void> {
  await loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
    process.exitCode = 2;
    return;
  }

  const reset = process.argv.includes("--reset");

  let center: [number, number];
  let explicitCenter: boolean;
  try {
    ({ center, explicit: explicitCenter } = parseCenterArg(process.argv));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
    return;
  }
  console.log(`center : ${center[0]}, ${center[1]}${explicitCenter ? "" : " (default)"}`);
  if (explicitCenter) {
    console.log(`         set NEXT_PUBLIC_DEFAULT_CENTER=${center[0]},${center[1]} to match`);
  }
  console.log("");
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The bucket must exist and be public, per the README setup note.
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) {
    console.error(`Could not list storage buckets: ${bucketError.message}`);
    process.exitCode = 1;
    return;
  }
  const bucket = buckets?.find((entry) => entry.name === BUCKET);
  if (!bucket) {
    console.error(
      `Storage bucket "${BUCKET}" does not exist. See the Storage section of README.md.`,
    );
    process.exitCode = 1;
    return;
  }
  if (!bucket.public) {
    console.error(
      `Storage bucket "${BUCKET}" is private, so photo URLs will not load. Make it public.`,
    );
    process.exitCode = 1;
    return;
  }

  if (reset) {
    const { data: removed, error } = await supabase
      .from("reports")
      .delete()
      .eq("reporter_id", REPORTER_ID)
      .select("id");
    if (error) {
      console.error(`Could not delete previous fake rows: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`reset  : removed ${removed?.length ?? 0} previous fake rows`);
  }

  const now = Date.now();
  let inserted = 0;
  let skipped = 0;

  for (const report of FAKE_REPORTS) {
    const objectPath = `${PREFIX}/${report.slug}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, await placeholderJpeg(report), {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploadError) {
      console.error(`  ${report.slug}: photo upload failed, ${uploadError.message}`);
      process.exitCode = 1;
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);

    // Idempotent on the photo URL, so re-running does not pile up duplicates.
    const { data: existing, error: existingError } = await supabase
      .from("reports")
      .select("id")
      .eq("photo_url", publicUrl)
      .limit(1);
    if (existingError) {
      console.error(`  ${report.slug}: lookup failed, ${existingError.message}`);
      process.exitCode = 1;
      return;
    }
    if (existing && existing.length > 0) {
      console.log(`  ${report.slug}: already present, skipped`);
      skipped += 1;
      continue;
    }

    const [wheelchair, blind, lowVision, walker] = report.sev;
    const at = relocate(report, center);
    const { error: insertError } = await supabase.from("reports").insert({
      lat: at.lat,
      lng: at.lng,
      heading: report.heading,
      photo_url: publicUrl,
      source: report.source,
      obstacle_types: report.obstacle_types,
      sev_wheelchair: wheelchair,
      sev_blind: blind,
      sev_low_vision: lowVision,
      sev_walker: walker,
      permanence: report.permanence,
      ai_description: report.ai_description,
      ai_confidence: report.ai_confidence,
      confirmations: report.confirmations,
      disputes: report.disputes,
      reporter_id: REPORTER_ID,
      created_at: new Date(now - report.ageHours * 3600_000).toISOString(),
      expires_at:
        report.expiresInHours === null
          ? null
          : new Date(now + report.expiresInHours * 3600_000).toISOString(),
    });
    if (insertError) {
      console.error(`  ${report.slug}: insert failed, ${insertError.message}`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `  ${report.slug}: inserted at ${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}, severity w${wheelchair} b${blind} lv${lowVision} wa${walker}`,
    );
    inserted += 1;
  }

  console.log("");
  console.log(`done   : ${inserted} inserted, ${skipped} skipped`);
  console.log(`clean  : npx tsx scripts/seed-fake.ts --reset`);
}

void main();
