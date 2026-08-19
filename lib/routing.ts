/**
 * Pedestrian and wheelchair routing.
 *
 * The provider lives entirely inside this file, the same arrangement as
 * lib/vision.ts. Callers import getRoute, the exported types, and the error
 * classes, none of which mention OpenRouteService. Swapping providers means
 * editing this file and nothing else.
 */

import { type SeverityProfile } from "./obstacles";

const BASE_URL = "https://api.openrouteservice.org/v2/directions";

/**
 * ORS limits, from https://openrouteservice.org/restrictions/
 * The 150km ceiling applies specifically when avoid_polygons is in play, which
 * is the normal case here.
 */
const MAX_DISTANCE_M_WITH_AVOID = 150_000;
const MAX_WAYPOINTS = 50;

/**
 * Upper bound on avoid polygons sent in one request. A dense city viewport can
 * hold more obstacles than a single request should carry. Anything dropped is
 * reported back in `avoidTruncated` rather than silently ignored.
 */
const MAX_AVOID_POLYGONS = 150;

/** Half-width of the square drawn around an obstacle, in metres. */
const DEFAULT_AVOID_RADIUS_M = 12;

// Types ---------------------------------------------------------------------

export interface LngLat {
  lng: number;
  lat: number;
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  /** Street or path name, when the data has one. */
  name?: string;
  /** Where this step begins, for panning the map to it. */
  at: LngLat;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Route line as [lng, lat] pairs. Decorative: the step list is canonical. */
  geometry: Array<[number, number]>;
  steps: RouteStep[];
  /** How many obstacles were fed in as areas to avoid. */
  avoidedCount: number;
  /** True when more obstacles existed than one request could carry. */
  avoidTruncated: boolean;
  /** The provider profile actually used, for display. */
  profileUsed: string;
  /** Requests left on the provider quota today, when it reports one. */
  quotaRemaining?: number;
}

export interface GetRouteOptions {
  /** Obstacle positions to route around. Each becomes a small square. */
  avoid?: LngLat[];
  avoidRadiusMeters?: number;
  signal?: AbortSignal;
}

// Errors --------------------------------------------------------------------

export class RoutingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Daily quota exhausted. ORS signals this with 403 rather than 429, so it cannot
 * be detected by status code alone.
 */
export class RoutingRateLimitError extends RoutingError {
  readonly quotaRemaining?: number;
  readonly resetAt?: Date;

  constructor(message: string, quotaRemaining?: number, resetAt?: Date) {
    super(message);
    this.quotaRemaining = quotaRemaining;
    this.resetAt = resetAt;
  }
}

/** The two points are routable but no path connects them for this profile. */
export class NoRouteFoundError extends RoutingError {}

/** A point is not near any routable path, so no route can start or end there. */
export class UnroutablePointError extends RoutingError {
  readonly which: "start" | "destination" | "unknown";

  constructor(message: string, which: UnroutablePointError["which"] = "unknown") {
    super(message);
    this.which = which;
  }
}

/** Provider temporarily unavailable. Retryable on the same input. */
export class RoutingTransientError extends RoutingError {}

/** Missing or rejected credentials, or a request outside the provider's limits. */
export class RoutingConfigError extends RoutingError {}

// Profile mapping -----------------------------------------------------------

/**
 * Wheelchair and walker users care about kerbs, surface, and incline, which the
 * wheelchair profile models. Blind and low vision users are walking, so the
 * foot profile is the right base, and their obstacles are handled by the
 * avoidance areas instead.
 */
const ORS_PROFILE: Record<SeverityProfile, string> = {
  wheelchair: "wheelchair",
  walker: "wheelchair",
  blind: "foot-walking",
  low_vision: "foot-walking",
};

export function providerProfileFor(profile: SeverityProfile): string {
  return ORS_PROFILE[profile];
}

// Geometry ------------------------------------------------------------------

const METRES_PER_DEGREE_LAT = 111_320;

/** Straight line distance, used only to check the provider's range limit. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Square around a point, as a GeoJSON linear ring. Longitude degrees shrink with
 * latitude, so the east-west span is corrected by cos(lat), otherwise boxes are
 * far wider than intended away from the equator.
 */
function squareAround(point: LngLat, radiusMeters: number): Array<[number, number]> {
  const dLat = radiusMeters / METRES_PER_DEGREE_LAT;
  const dLng =
    radiusMeters / (METRES_PER_DEGREE_LAT * Math.max(Math.cos((point.lat * Math.PI) / 180), 0.01));
  const west = point.lng - dLng;
  const east = point.lng + dLng;
  const south = point.lat - dLat;
  const north = point.lat + dLat;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

// Provider plumbing ---------------------------------------------------------

interface OrsStep {
  distance: number;
  duration: number;
  instruction: string;
  name?: string;
  way_points: [number, number];
}

interface OrsResponse {
  features?: Array<{
    geometry: { type: string; coordinates: Array<[number, number]> };
    properties: {
      summary: { distance: number; duration: number };
      segments: Array<{ steps: OrsStep[] }>;
    };
  }>;
  error?: { code?: number; message?: string } | string;
}

function parseQuota(headers: Headers): { remaining?: number; resetAt?: Date } {
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const resetRaw = headers.get("x-ratelimit-reset");
  const remaining = remainingRaw === null ? undefined : Number(remainingRaw);
  const resetSeconds = resetRaw === null ? undefined : Number(resetRaw);
  return {
    remaining: Number.isFinite(remaining) ? remaining : undefined,
    resetAt:
      resetSeconds !== undefined && Number.isFinite(resetSeconds)
        ? new Date(resetSeconds * 1000)
        : undefined,
  };
}

function errorText(body: OrsResponse | null): { code?: number; message: string } {
  if (!body || !body.error) return { message: "no detail" };
  if (typeof body.error === "string") return { message: body.error };
  return { code: body.error.code, message: body.error.message ?? "no detail" };
}

/**
 * Requests a route.
 *
 * @throws RoutingRateLimitError when the daily quota is gone (ORS uses 403).
 * @throws NoRouteFoundError when nothing connects the points for this profile.
 * @throws UnroutablePointError when a point has no path near it.
 * @throws RoutingTransientError on provider 5xx. Retryable.
 * @throws RoutingConfigError on a missing or rejected key, or an out-of-range request.
 */
export async function getRoute(
  from: LngLat,
  to: LngLat,
  profile: SeverityProfile,
  options: GetRouteOptions = {},
): Promise<RouteResult> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    throw new RoutingConfigError(
      "Missing ORS_API_KEY. Set it in .env.local. Keys come from https://account.heigit.org",
    );
  }

  const avoidInput = options.avoid ?? [];
  const avoid = avoidInput.slice(0, MAX_AVOID_POLYGONS);
  const avoidTruncated = avoidInput.length > avoid.length;

  // The tighter ceiling applies whenever avoidance areas are present.
  const straightLine = haversineMeters(from, to);
  if (avoid.length > 0 && straightLine > MAX_DISTANCE_M_WITH_AVOID) {
    throw new RoutingConfigError(
      `Route spans ${Math.round(straightLine / 1000)}km, over the ${MAX_DISTANCE_M_WITH_AVOID / 1000}km limit that applies when avoiding areas.`,
    );
  }

  const coordinates: Array<[number, number]> = [
    [from.lng, from.lat],
    [to.lng, to.lat],
  ];
  if (coordinates.length > MAX_WAYPOINTS) {
    throw new RoutingConfigError(`At most ${MAX_WAYPOINTS} waypoints are supported.`);
  }

  const providerProfile = providerProfileFor(profile);
  const radius = options.avoidRadiusMeters ?? DEFAULT_AVOID_RADIUS_M;

  const body: Record<string, unknown> = {
    coordinates,
    instructions: true,
    units: "m",
  };
  if (avoid.length > 0) {
    body.options = {
      avoid_polygons: {
        type: "MultiPolygon",
        coordinates: avoid.map((point) => [squareAround(point, radius)]),
      },
    };
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/${providerProfile}/geojson`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/geo+json",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (cause) {
    throw new RoutingTransientError("Could not reach the routing service.", { cause });
  }

  const quota = parseQuota(response.headers);

  let parsed: OrsResponse | null = null;
  try {
    parsed = (await response.json()) as OrsResponse;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const { code, message } = errorText(parsed);

    // 403 covers both an exhausted daily quota and a rejected key, so the body
    // has to be read to tell them apart.
    if (response.status === 403 || response.status === 429) {
      if (/quota|rate.?limit|exceeded|daily/i.test(message) || response.status === 429) {
        throw new RoutingRateLimitError(
          `Routing quota is exhausted. ${message}`,
          quota.remaining,
          quota.resetAt,
        );
      }
      throw new RoutingConfigError(`Routing service rejected the API key. ${message}`);
    }
    if (response.status >= 500) {
      throw new RoutingTransientError(
        `Routing service is unavailable (${response.status}). Retry shortly.`,
      );
    }

    // 2010 is "could not find routable point", 2009 is "route not found".
    if (code === 2010 || /routable point/i.test(message)) {
      const which = /coordinate 0/i.test(message)
        ? "start"
        : /coordinate 1/i.test(message)
          ? "destination"
          : "unknown";
      throw new UnroutablePointError(
        which === "start"
          ? "No footpath near the starting point."
          : which === "destination"
            ? "No footpath near the destination."
            : "No footpath near one of the points.",
        which,
      );
    }
    if (code === 2009 || /route.*could not be found|no route/i.test(message)) {
      throw new NoRouteFoundError(
        avoid.length > 0
          ? "No route avoids every obstacle for this profile. Try a lower avoidance threshold."
          : "No route connects these points for this profile.",
      );
    }

    throw new RoutingError(`Routing failed (${response.status}). ${message}`);
  }

  const feature = parsed?.features?.[0];
  if (!feature) {
    throw new NoRouteFoundError("The routing service returned no route.");
  }

  const geometry = feature.geometry.coordinates;
  const segments = feature.properties.segments ?? [];
  const steps: RouteStep[] = segments.flatMap((segment) =>
    (segment.steps ?? []).map((step) => {
      const index = Math.min(step.way_points?.[0] ?? 0, Math.max(geometry.length - 1, 0));
      const [lng, lat] = geometry[index] ?? geometry[0] ?? [from.lng, from.lat];
      return {
        instruction: step.instruction,
        distanceMeters: step.distance,
        durationSeconds: step.duration,
        name: step.name && step.name !== "-" ? step.name : undefined,
        at: { lng, lat },
      };
    }),
  );

  return {
    distanceMeters: feature.properties.summary?.distance ?? 0,
    durationSeconds: feature.properties.summary?.duration ?? 0,
    geometry,
    steps,
    avoidedCount: avoid.length,
    avoidTruncated,
    profileUsed: providerProfile,
    quotaRemaining: quota.remaining,
  };
}

// Formatting ----------------------------------------------------------------

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} metres`;
  return `${(meters / 1000).toFixed(1)} kilometres`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `${hours} ${hours === 1 ? "hour" : "hours"}`
    : `${hours} ${hours === 1 ? "hour" : "hours"} ${rest} minutes`;
}
