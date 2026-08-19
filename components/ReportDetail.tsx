"use client";

import { useEffect, useRef, useState } from "react";

import { PROFILES } from "@/lib/reports";
import {
  SOURCE_LABELS,
  formatAge,
  formatConfidence,
  formatConfirmations,
  obstacleTypeLabel,
  severityFor,
  type Report,
} from "@/lib/reports";
import { SeverityBadge } from "@/components/SeverityBadge";

interface ReportDetailProps {
  report: Report;
  /** Returns focus to the row that opened this panel. */
  onBackToList: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-hairline py-2 last:border-b-0">
      <dt className="text-xs tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Every field is text. The photo is supporting evidence, not the content, so a
 * failed image load never costs the reader information.
 */
export default function ReportDetail({ report, onBackToList }: ReportDetailProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  const description = report.ai_description ?? "No description recorded for this report.";

  // Move focus to the panel when a different report is opened, so a keyboard
  // user lands on the detail instead of hunting for it below the list.
  useEffect(() => {
    setPhotoFailed(false);
    headingRef.current?.focus();
  }, [report.id]);

  return (
    <section
      aria-labelledby="report-detail-heading"
      className="border-t border-line bg-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <h2
          id="report-detail-heading"
          ref={headingRef}
          tabIndex={-1}
          data-focus-quiet
          className="text-sm font-semibold tracking-wide uppercase"
        >
          Report detail
        </h2>
        <button
          type="button"
          onClick={onBackToList}
          className="border border-line px-2 py-1 text-xs"
        >
          Back to list
        </button>
      </div>

      <div className="px-4 py-3">
        {photoFailed ? (
          <p className="border border-hairline bg-raised p-3 text-sm text-ink-muted">
            The photo for this report could not be loaded. Description: {description}
          </p>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- photo_url is an
             arbitrary storage or imagery host, so the optimizer's allowlist does
             not apply. Dimensions are fixed by the aspect box below. */
          <img
            src={report.photo_url}
            alt={description}
            width={800}
            height={600}
            loading="lazy"
            onError={() => setPhotoFailed(true)}
            className="w-full border border-hairline object-cover"
            style={{ aspectRatio: "4 / 3" }}
          />
        )}

        <dl className="mt-3">
          <Field label="Description">{description}</Field>

          <Field label="Obstacle types">
            {report.obstacle_types.length === 0 ? (
              "No obstacle recorded"
            ) : (
              <ul className="flex flex-col gap-1">
                {report.obstacle_types.map((type) => (
                  <li key={type}>{obstacleTypeLabel(type)}</li>
                ))}
              </ul>
            )}
          </Field>

          {/* All four profiles, always, so a reader can compare rather than
              trusting the one profile currently selected. */}
          <Field label="Severity by profile">
            <ul className="flex flex-col gap-1.5">
              {PROFILES.map((profile) => (
                <li key={profile.id} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{profile.label}:</span>
                  <SeverityBadge score={severityFor(report, profile.id)} variant="full" />
                </li>
              ))}
            </ul>
          </Field>

          <Field label="Permanence">
            {report.permanence === "permanent"
              ? "Permanent, part of the built environment"
              : "Temporary, expected to clear"}
          </Field>

          <Field label="Reported">{formatAge(report.created_at)}</Field>

          <Field label="Confirmations">
            {formatConfirmations(report.confirmations)}
            {report.disputes > 0
              ? `, ${report.disputes} ${report.disputes === 1 ? "dispute" : "disputes"}`
              : ""}
          </Field>

          <Field label="Model confidence">{formatConfidence(report.ai_confidence)}</Field>

          <Field label="Source">{SOURCE_LABELS[report.source]}</Field>

          <Field label="Location">
            {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
            {report.heading !== null ? `, facing ${Math.round(report.heading)} degrees` : ""}
          </Field>
        </dl>
      </div>
    </section>
  );
}
