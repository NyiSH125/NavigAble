import { NextResponse } from "next/server";

import { isSeverityProfile, type SeverityProfile, type SeverityScore } from "@/lib/obstacles";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { REPORT_COLUMNS, severityFor, type Report } from "@/lib/reports";
import {
  NoRouteFoundError,
  RoutingConfigError,
  RoutingError,
  RoutingRateLimitError,
  RoutingTransientError,
  UnroutablePointError,
  getRoute,
  haversineMeters,
  type LngLat,
  type RouteResult,
} from "@/lib/routing";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 20 });

/** Padding around the start-destination box when looking for obstacles, in degrees. */
const OBSTACLE_PADDING_DEG = 0.01;

/** Severity at or above which an obstacle is routed around, unless overridden. */
const DEFAULT_AVOID_SEVERITY: SeverityScore = 2;

function isPoint(value: unknown): value is LngLat {
  if (value === null || typeof value !== "object") return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Loads the obstacles worth avoiding between two points.
 *
 * Deliberately server side: the client sends only the endpoints, so it cannot
 * suppress an obstacle by omitting it from the request.
 */
async function obstaclesBetween(
  from: LngLat,
  to: LngLat,
  profile: SeverityProfile,
  minSeverity: SeverityScore,
): Promise<{ points: LngLat[]; considered: number }> {
  const minLng = Math.min(from.lng, to.lng) - OBSTACLE_PADDING_DEG;
  const maxLng = Math.max(from.lng, to.lng) + OBSTACLE_PADDING_DEG;
  const minLat = Math.min(from.lat, to.lat) - OBSTACLE_PADDING_DEG;
  const maxLat = Math.max(from.lat, to.lat) + OBSTACLE_PADDING_DEG;

  const { data, error } = await supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .gte("lng", minLng)
    .lte("lng", maxLng)
    .gte("lat", minLat)
    .lte("lat", maxLat)
    .limit(1000);

  if (error) {
    console.error("[route] obstacle lookup failed", error);
    // Routing without avoidance is worse than routing, but better than nothing.
    return { points: [], considered: 0 };
  }

  const reports = (data ?? []) as unknown as Report[];
  const points = reports
    .filter((report) => severityFor(report, profile) >= minSeverity)
    .map((report) => ({ lat: report.lat, lng: report.lng }));

  return { points, considered: reports.length };
}

function routeToJson(result: RouteResult) {
  return {
    distanceMeters: result.distanceMeters,
    durationSeconds: result.durationSeconds,
    geometry: result.geometry,
    steps: result.steps,
    avoidedCount: result.avoidedCount,
    avoidTruncated: result.avoidTruncated,
    profileUsed: result.profileUsed,
    quotaRemaining: result.quotaRemaining,
  };
}

export async function POST(request: Request) {
  const retryAfter = limiter.check(clientIp(request));
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate_limited", message: `Too many route requests. Retry in ${retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "invalid_body", message: "Expected a JSON object." },
        { status: 400 },
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  const { from, to, profile, avoidSeverity, compare } = body;

  if (!isPoint(from)) {
    return NextResponse.json(
      { error: "invalid_body", message: "from must be {lat, lng}." },
      { status: 400 },
    );
  }
  if (!isPoint(to)) {
    return NextResponse.json(
      { error: "invalid_body", message: "to must be {lat, lng}." },
      { status: 400 },
    );
  }
  if (typeof profile !== "string" || !isSeverityProfile(profile)) {
    return NextResponse.json(
      {
        error: "invalid_body",
        message: "profile must be wheelchair, blind, low_vision, or walker.",
      },
      { status: 400 },
    );
  }
  if (haversineMeters(from, to) < 5) {
    return NextResponse.json(
      {
        error: "same_point",
        message: "The start and the destination are the same place.",
      },
      { status: 400 },
    );
  }

  const threshold: SeverityScore =
    typeof avoidSeverity === "number" && [0, 1, 2, 3].includes(avoidSeverity)
      ? (avoidSeverity as SeverityScore)
      : DEFAULT_AVOID_SEVERITY;

  const { points, considered } = await obstaclesBetween(from, to, profile, threshold);

  try {
    const avoiding = await getRoute(from, to, profile, {
      avoid: points,
      signal: request.signal,
    });

    // The comparison route ignores obstacles entirely, which is what makes the
    // cost of accessibility legible: same endpoints, different path.
    let direct = null;
    if (compare === true && points.length > 0) {
      try {
        direct = routeToJson(
          await getRoute(from, to, profile, { avoid: [], signal: request.signal }),
        );
      } catch (error) {
        // A missing comparison is not worth failing the useful route over.
        console.warn("[route] comparison route failed", error);
      }
    }

    return NextResponse.json(
      {
        route: routeToJson(avoiding),
        direct,
        obstaclesConsidered: considered,
        avoidSeverity: threshold,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof RoutingRateLimitError) {
      return NextResponse.json(
        {
          error: "routing_quota_exhausted",
          message: error.message,
          resetAt: error.resetAt?.toISOString(),
        },
        { status: 429 },
      );
    }
    if (error instanceof UnroutablePointError) {
      return NextResponse.json(
        { error: "unroutable_point", message: error.message, which: error.which },
        { status: 422 },
      );
    }
    if (error instanceof NoRouteFoundError) {
      return NextResponse.json(
        { error: "no_route", message: error.message },
        { status: 422 },
      );
    }
    if (error instanceof RoutingTransientError) {
      return NextResponse.json(
        { error: "routing_unavailable", message: error.message, retryable: true },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    if (error instanceof RoutingConfigError) {
      console.error("[route] configuration problem", error);
      return NextResponse.json(
        { error: "misconfigured", message: error.message },
        { status: 500 },
      );
    }
    if (error instanceof RoutingError) {
      console.error("[route] routing failed", error);
      return NextResponse.json(
        { error: "routing_failed", message: error.message },
        { status: 502 },
      );
    }
    console.error("[route] unexpected failure", error);
    return NextResponse.json(
      { error: "internal", message: "Unexpected failure." },
      { status: 500 },
    );
  }
}
