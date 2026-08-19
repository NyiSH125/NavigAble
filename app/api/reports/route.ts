import { NextResponse } from "next/server";

import { isObstacleType, type ObstacleType } from "@/lib/obstacles";
import { REPORT_COLUMNS, type Report } from "@/lib/reports";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard ceiling on a single response. */
const MAX_ROWS = 1000;

interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** Parses "minLng,minLat,maxLng,maxLat". Returns null when absent, or an error string. */
function parseBbox(raw: string | null): { bbox: Bbox | null; error?: string } {
  if (raw === null || raw.trim() === "") return { bbox: null };

  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return { bbox: null, error: "bbox must be four numbers: minLng,minLat,maxLng,maxLat" };
  }

  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng > maxLng || minLat > maxLat) {
    return { bbox: null, error: "bbox min values must not exceed max values" };
  }
  if (minLat < -90 || maxLat > 90) {
    return { bbox: null, error: "bbox latitudes must be within -90 and 90" };
  }

  // A map panned past the antimeridian reports longitudes outside the normal
  // range. Clamp rather than reject, so the viewport still returns something.
  return {
    bbox: {
      minLng: Math.max(minLng, -180),
      minLat,
      maxLng: Math.min(maxLng, 180),
      maxLat,
    },
  };
}

function parseTypes(raw: string | null): ObstacleType[] {
  if (raw === null || raw.trim() === "") return [];
  const unique = new Set<ObstacleType>();
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value !== "" && isObstacleType(value)) unique.add(value);
  }
  return [...unique];
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const { bbox, error: bboxError } = parseBbox(params.get("bbox"));
  if (bboxError) {
    return NextResponse.json({ error: "invalid_bbox", message: bboxError }, { status: 400 });
  }

  const types = parseTypes(params.get("types"));

  // The anon key is used deliberately: the public read policy is the access
  // rule for this endpoint, and it already hides expired rows. The explicit
  // filter below states the same intent at the query level.
  let query = supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (bbox) {
    query = query
      .gte("lng", bbox.minLng)
      .lte("lng", bbox.maxLng)
      .gte("lat", bbox.minLat)
      .lte("lat", bbox.maxLat);
  }

  if (types.length > 0) {
    // Array overlap: keep a report if any of its types was asked for.
    query = query.overlaps("obstacle_types", types);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[reports] query failed", error);
    return NextResponse.json(
      { error: "query_failed", message: "Could not load reports." },
      { status: 502 },
    );
  }

  const reports = (data ?? []) as unknown as Report[];

  return NextResponse.json(
    {
      reports,
      count: reports.length,
      // Tells the client the viewport holds more than one response can carry,
      // so it can say so rather than implying the map is complete.
      truncated: reports.length === MAX_ROWS,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
