/**
 * Per-IP sliding window rate limiter.
 *
 * In memory, so it is per server instance and resets on redeploy. That is fine
 * for a single instance and is not a substitute for a shared store once this
 * runs on more than one.
 */

export interface RateLimiter {
  /** Returns null when the request is allowed, or the seconds until it will be. */
  check(key: string, now?: number): number | null;
}

export function createRateLimiter({
  limit,
  windowMs = 60_000,
}: {
  limit: number;
  windowMs?: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key: string, now: number = Date.now()): number | null {
      const cutoff = now - windowMs;

      // Opportunistic sweep so idle keys do not accumulate.
      for (const [entry, stamps] of hits) {
        const live = stamps.filter((at) => at > cutoff);
        if (live.length === 0) hits.delete(entry);
        else hits.set(entry, live);
      }

      const recent = hits.get(key) ?? [];
      if (recent.length >= limit) {
        return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      }

      recent.push(now);
      hits.set(key, recent);
      return null;
    },
  };
}

/** Best effort client address, for rate limiting only. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
