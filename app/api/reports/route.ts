import { NextResponse } from "next/server";

import { isObstacleType, type ObstacleType } from "@/lib/obstacles";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { REPORT_COLUMNS, type Report } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabase } from "@/lib/supabase/client";
import {
  MissingFunctionCallError,
  RateLimitError,
  SafetyBlockError,
  SchemaMismatchError,
  TransientUpstreamError,
  VisionConfigError,
  VisionError,
  analyzeObstacle,
  isSupportedMediaType,
} from "@/lib/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard ceiling on a single response. */
const MAX_ROWS = 1000;

/** Posting costs a model call and a storage write, so it is limited harder than reads. */
const POST_LIMIT = 5;
const postLimiter = createRateLimiter({ limit: POST_LIMIT });

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

/** How long a temporary obstacle stays live before it expires itself. */
const TEMPORARY_TTL_DAYS = 14;

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

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

// Submission ----------------------------------------------------------------

interface SubmitBody {
  imageBase64?: unknown;
  mediaType?: unknown;
  lat?: unknown;
  lng?: unknown;
  heading?: unknown;
  reporterId?: unknown;
}

function badRequest(message: string, status = 400, error = "invalid_body") {
  return NextResponse.json({ error, message }, { status });
}

/**
 * Creates a report from a photograph.
 *
 * The order matters. Classification runs first, so a photo that is not of the
 * pedestrian environment is never written to storage at all. The upload and the
 * insert both use the service role, which exists only on the server: the browser
 * holds the anon key and could not write this row if it tried.
 */
export async function POST(request: Request) {
  const retryAfter = postLimiter.check(clientIp(request));
  if (retryAfter !== null) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Limit is ${POST_LIMIT} reports per minute. Retry in ${retryAfter}s.`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
    return badRequest("Payload exceeds 5MB.", 413, "payload_too_large");
  }

  let body: SubmitBody;
  try {
    const raw = await request.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return badRequest("Payload exceeds 5MB.", 413, "payload_too_large");
    }
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return badRequest("Expected a JSON object.");
    }
    body = parsed as SubmitBody;
  } catch {
    return badRequest("Body must be JSON.", 400, "invalid_json");
  }

  const { imageBase64, mediaType, lat, lng, heading, reporterId } = body;

  if (typeof imageBase64 !== "string" || imageBase64.trim() === "") {
    return badRequest("imageBase64 must be a non-empty string.");
  }
  if (typeof mediaType !== "string" || !isSupportedMediaType(mediaType)) {
    return badRequest(
      "mediaType must be one of image/jpeg, image/png, image/webp, image/heic, image/heif.",
      415,
      "unsupported_media_type",
    );
  }
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return badRequest("lat must be a number between -90 and 90.");
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return badRequest("lng must be a number between -180 and 180.");
  }
  if (
    heading !== undefined &&
    heading !== null &&
    (typeof heading !== "number" || !Number.isFinite(heading) || heading < 0 || heading > 360)
  ) {
    return badRequest("heading must be a number between 0 and 360, or omitted.");
  }

  // 1. Classify before storing anything.
  let analysis;
  try {
    analysis = await analyzeObstacle(imageBase64, mediaType, { signal: request.signal });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: "upstream_rate_limited", message: error.message },
        {
          status: 429,
          headers: error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
        },
      );
    }
    if (error instanceof TransientUpstreamError) {
      return NextResponse.json(
        { error: "upstream_unavailable", message: error.message, retryable: true },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    if (error instanceof SafetyBlockError) {
      return NextResponse.json(
        { error: "safety_blocked", message: error.message, reason: error.reason },
        { status: 422 },
      );
    }
    if (error instanceof MissingFunctionCallError || error instanceof SchemaMismatchError) {
      return NextResponse.json(
        { error: "model_output_invalid", message: error.message },
        { status: 502 },
      );
    }
    if (error instanceof VisionConfigError) {
      console.error("[reports] vision misconfigured", error);
      return NextResponse.json(
        { error: "misconfigured", message: "Vision provider is not configured." },
        { status: 500 },
      );
    }
    if (error instanceof VisionError) {
      console.error("[reports] vision failed", error);
      return NextResponse.json(
        { error: "upstream_failed", message: error.message },
        { status: 502 },
      );
    }
    console.error("[reports] unexpected classification failure", error);
    return NextResponse.json(
      { error: "internal", message: "Unexpected failure." },
      { status: 500 },
    );
  }

  // 2. Nothing is stored for a photo that is not of the pedestrian environment.
  if (!analysis.is_accessibility_relevant) {
    return NextResponse.json(
      {
        error: "not_accessibility_relevant",
        message: analysis.description,
        analysis,
      },
      { status: 422 },
    );
  }

  const admin = createAdminClient();
  const extension = EXTENSION_BY_MEDIA_TYPE[mediaType.toLowerCase()] ?? "jpg";
  const objectPath = `user/${crypto.randomUUID()}.${extension}`;
  const bytes = Buffer.from(imageBase64.replace(/^data:[^;,]+;base64,/, ""), "base64");

  // 3. Store the photo.
  const { error: uploadError } = await admin.storage
    .from("reports")
    .upload(objectPath, bytes, { contentType: mediaType, upsert: false });
  if (uploadError) {
    console.error("[reports] upload failed", uploadError);
    return NextResponse.json(
      { error: "upload_failed", message: "Could not store the photo." },
      { status: 502 },
    );
  }

  const {
    data: { publicUrl },
  } = admin.storage.from("reports").getPublicUrl(objectPath);

  // 4. Insert the row.
  const expiresAt =
    analysis.permanence === "temporary"
      ? new Date(Date.now() + TEMPORARY_TTL_DAYS * 24 * 3600_000).toISOString()
      : null;

  const { data, error: insertError } = await admin
    .from("reports")
    .insert({
      lat,
      lng,
      heading: typeof heading === "number" ? heading : null,
      photo_url: publicUrl,
      source: "user",
      obstacle_types: analysis.obstacle_types,
      sev_wheelchair: analysis.severity.wheelchair,
      sev_blind: analysis.severity.blind,
      sev_low_vision: analysis.severity.low_vision,
      sev_walker: analysis.severity.walker,
      permanence: analysis.permanence,
      ai_description: analysis.description,
      ai_confidence: analysis.confidence,
      reporter_id: typeof reporterId === "string" ? reporterId.slice(0, 64) : null,
      expires_at: expiresAt,
    })
    .select(REPORT_COLUMNS)
    .single();

  if (insertError || !data) {
    // Do not leave the photo behind as an orphan.
    await admin.storage.from("reports").remove([objectPath]);
    console.error("[reports] insert failed", insertError);
    return NextResponse.json(
      { error: "insert_failed", message: "Could not save the report." },
      { status: 502 },
    );
  }

  return NextResponse.json({ report: data as unknown as Report }, { status: 201 });
}
