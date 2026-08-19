import { NextResponse } from "next/server";

import {
  MissingFunctionCallError,
  RateLimitError,
  SafetyBlockError,
  SchemaMismatchError,
  VisionConfigError,
  VisionError,
  analyzeObstacle,
  isSupportedMediaType,
} from "@/lib/vision";

export const runtime = "nodejs";

/** Largest accepted base64 payload. */
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

/** Per-IP request cap and the window it applies over. */
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;

/**
 * In-memory sliding window, keyed by client IP. This is per server instance and
 * resets on redeploy, which is fine for a first pass but does not hold across
 * multiple instances. Move to a shared store before running more than one.
 */
const hits = new Map<string, number[]>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Returns null when the request is allowed, or the seconds until it will be. */
function rateLimit(ip: string, now: number): number | null {
  const cutoff = now - WINDOW_MS;

  // Opportunistic sweep so idle keys do not accumulate.
  for (const [key, stamps] of hits) {
    const live = stamps.filter((at) => at > cutoff);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }

  const recent = hits.get(ip) ?? [];
  if (recent.length >= RATE_LIMIT) {
    const oldest = recent[0];
    return Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
  }

  recent.push(now);
  hits.set(ip, recent);
  return null;
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const retryAfter = rateLimit(ip, Date.now());
  if (retryAfter !== null) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Limit is ${RATE_LIMIT} requests per minute. Retry in ${retryAfter}s.`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // Reject oversized bodies on the declared length before reading them.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "payload_too_large", message: "Payload exceeds 5MB." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: "payload_too_large", message: "Payload exceeds 5MB." },
        { status: 413 },
      );
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      {
        error: "invalid_body",
        message: "Expected an object with imageBase64 and mediaType.",
      },
      { status: 400 },
    );
  }

  const { imageBase64, mediaType } = body as {
    imageBase64?: unknown;
    mediaType?: unknown;
  };

  if (typeof imageBase64 !== "string" || imageBase64.trim() === "") {
    return NextResponse.json(
      { error: "invalid_body", message: "imageBase64 must be a non-empty string." },
      { status: 400 },
    );
  }
  if (typeof mediaType !== "string" || !isSupportedMediaType(mediaType)) {
    return NextResponse.json(
      {
        error: "unsupported_media_type",
        message:
          "mediaType must be one of image/jpeg, image/png, image/webp, image/heic, image/heif.",
      },
      { status: 415 },
    );
  }

  try {
    const analysis = await analyzeObstacle(imageBase64, mediaType, {
      signal: request.signal,
    });
    return NextResponse.json(analysis, { status: 200 });
  } catch (error) {
    if (error instanceof RateLimitError) {
      // Upstream quota, not this route's limiter.
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
    if (error instanceof SafetyBlockError) {
      return NextResponse.json(
        { error: "safety_blocked", message: error.message, reason: error.reason },
        { status: 422 },
      );
    }
    if (
      error instanceof MissingFunctionCallError ||
      error instanceof SchemaMismatchError
    ) {
      return NextResponse.json(
        { error: "model_output_invalid", message: error.message },
        { status: 502 },
      );
    }
    if (error instanceof VisionConfigError) {
      console.error("[analyze] configuration error", error);
      return NextResponse.json(
        { error: "misconfigured", message: "Vision provider is not configured." },
        { status: 500 },
      );
    }
    if (error instanceof VisionError) {
      console.error("[analyze] vision error", error);
      return NextResponse.json(
        { error: "upstream_failed", message: error.message },
        { status: 502 },
      );
    }

    console.error("[analyze] unexpected error", error);
    return NextResponse.json(
      { error: "internal", message: "Unexpected failure." },
      { status: 500 },
    );
  }
}
