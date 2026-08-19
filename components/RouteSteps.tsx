"use client";

import { type SeverityProfile } from "@/lib/obstacles";
import { profileMeta } from "@/lib/reports";
import { formatDistance, formatDuration, type LngLat, type RouteStep } from "@/lib/routing";

export interface RouteView {
  distanceMeters: number;
  durationSeconds: number;
  geometry: Array<[number, number]>;
  steps: RouteStep[];
  avoidedCount: number;
  avoidTruncated: boolean;
  profileUsed: string;
  quotaRemaining?: number;
}

interface RouteStepsProps {
  route: RouteView;
  /** Same endpoints with no obstacle avoidance, when a comparison was requested. */
  direct: RouteView | null;
  profile: SeverityProfile;
  selectedStep: number | null;
  onSelectStep: (index: number, at: LngLat) => void;
}

/**
 * The canonical route surface. The line drawn on the map is decorative, so every
 * fact about the route is written here: distance, time, what was avoided, and
 * each step in order.
 */
export default function RouteSteps({
  route,
  direct,
  profile,
  selectedStep,
  onSelectStep,
}: RouteStepsProps) {
  const meta = profileMeta(profile);
  const headingId = "route-steps-heading";

  const extra = direct ? Math.round(route.distanceMeters - direct.distanceMeters) : null;

  const summary = [
    formatDistance(route.distanceMeters),
    formatDuration(route.durationSeconds),
    route.avoidedCount === 0
      ? "no obstacles needed avoiding"
      : `avoids ${route.avoidedCount} ${route.avoidedCount === 1 ? "obstacle" : "obstacles"}`,
  ].join(", ");

  return (
    <section aria-labelledby={headingId} className="border-t border-line">
      {/* The summary is announced as one sentence when a route arrives. */}
      <p aria-live="polite" role="status" className="sr-only">
        {`Route found for the ${meta.label.toLowerCase()} profile: ${summary}. ${route.steps.length} steps.`}
      </p>

      <div className="border-b border-hairline px-4 py-3">
        <h2 id={headingId} className="eyebrow">
          Route
        </h2>

        <dl className="mt-2 flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-ink-muted">Distance</dt>
            <dd>{formatDistance(route.distanceMeters)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Time</dt>
            <dd>{formatDuration(route.durationSeconds)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Obstacles avoided</dt>
            <dd>{route.avoidedCount}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Profile</dt>
            <dd>{meta.label}</dd>
          </div>
        </dl>

        {direct && extra !== null ? (
          <p className="box mt-2 px-2 py-1.5 text-xs">
            {extra > 0
              ? `${extra} metres longer than the direct route, which passes ${route.avoidedCount} ${route.avoidedCount === 1 ? "obstacle" : "obstacles"} this profile cannot use.`
              : extra < 0
                ? `${Math.abs(extra)} metres shorter than the direct route, and it avoids ${route.avoidedCount} ${route.avoidedCount === 1 ? "obstacle" : "obstacles"}.`
                : `Same length as the direct route, and it avoids ${route.avoidedCount} ${route.avoidedCount === 1 ? "obstacle" : "obstacles"}.`}
          </p>
        ) : null}

        {route.avoidTruncated ? (
          <p className="mt-2 text-xs text-ink-muted">
            More obstacles were in range than one request can carry, so this route avoids
            the first {route.avoidedCount}. Zoom into a smaller area for a complete result.
          </p>
        ) : null}

        {route.quotaRemaining !== undefined && route.quotaRemaining < 50 ? (
          <p className="mt-2 text-xs text-ink-muted">
            {route.quotaRemaining} routing requests left on today&apos;s quota.
          </p>
        ) : null}
      </div>

      {route.steps.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-muted">
          The route has no turn instructions, which usually means it is a single straight
          path.
        </p>
      ) : (
        <ol className="max-h-72 overflow-y-auto">
          {route.steps.map((step, index) => {
            const selected = selectedStep === index;
            return (
              <li key={index} className="border-b border-hairline">
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  aria-label={`Step ${index + 1} of ${route.steps.length}. ${step.instruction}${
                    step.name ? ` on ${step.name}` : ""
                  }. ${formatDistance(step.distanceMeters)}.`}
                  onClick={() => onSelectStep(index, step.at)}
                  className={`w-full px-4 py-2 text-left text-sm ${
                    selected ? "bg-raised" : "bg-transparent"
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-xs text-ink-muted">{index + 1}</span>
                    <span>
                      {step.instruction}
                      {step.name ? <span className="text-ink-muted"> on {step.name}</span> : null}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {formatDistance(step.distanceMeters)}
                    {step.durationSeconds >= 30
                      ? `, about ${formatDuration(step.durationSeconds)}`
                      : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
