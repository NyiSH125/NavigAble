"use client";

import { useEffect, useRef } from "react";

import { type SeverityProfile } from "@/lib/obstacles";
import {
  formatAge,
  formatConfirmations,
  obstacleTypesSentence,
  profileMeta,
  severityFor,
  severityMeta,
  sortForProfile,
  type Report,
} from "@/lib/reports";
import { SeverityBadge } from "@/components/SeverityBadge";

interface ReportListProps {
  reports: Report[];
  profile: SeverityProfile;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Set by the page so it can return focus here from the detail panel. */
  registerItemRef?: (id: string, node: HTMLButtonElement | null) => void;
  truncated?: boolean;
}

/**
 * The canonical interaction surface. Everything the map conveys visually is
 * available here as text: severity for the active profile, obstacle types, the
 * description, age, and confirmation count.
 *
 * Ordering is by severity for the active profile, so the reports that matter
 * most to the person reading are first.
 */
export default function ReportList({
  reports,
  profile,
  selectedId,
  onSelect,
  registerItemRef,
  truncated = false,
}: ReportListProps) {
  const ordered = sortForProfile(reports, profile);
  const meta = profileMeta(profile);
  const headingId = "report-list-heading";
  const listRef = useRef<HTMLOListElement | null>(null);

  // Keep the selected row in view when selection changes from the map.
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(
      `[data-report-id="${CSS.escape(selectedId)}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (reports.length === 0) {
    return (
      <section aria-labelledby={headingId} className="p-4">
        <h2 id={headingId} className="text-sm font-semibold tracking-wide uppercase">
          Reports in view
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          No reports in this part of the map. Pan or zoom the map, or clear an obstacle
          filter, to see more.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-col">
      <div className="border-b border-hairline px-4 py-3">
        <h2 id={headingId} className="text-sm font-semibold tracking-wide uppercase">
          Reports in view
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          {ordered.length} {ordered.length === 1 ? "report" : "reports"}, most severe for
          the {meta.label.toLowerCase()} profile first.
          {truncated
            ? " This area holds more than 1000 reports, so the list is capped. Zoom in for a complete picture."
            : ""}
        </p>
      </div>

      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {ordered.map((report, index) => {
          const score = severityFor(report, profile);
          const selected = report.id === selectedId;
          const description =
            report.ai_description ?? "No description recorded for this report.";

          // An explicit name, so the row is announced as one coherent sentence
          // rather than as five separate fragments, and so the severity reads as
          // words before the description.
          const label = [
            `Report ${index + 1} of ${ordered.length}`,
            `Severity ${score} of 3, ${severityMeta(score).label.toLowerCase()}`,
            obstacleTypesSentence(report.obstacle_types),
            description,
            `Reported ${formatAge(report.created_at)}`,
            formatConfirmations(report.confirmations),
          ].join(". ");

          return (
            <li key={report.id} className="border-b border-hairline">
              <button
                type="button"
                ref={(node) => registerItemRef?.(report.id, node)}
                data-report-id={report.id}
                aria-label={label}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(report.id)}
                className={`w-full px-4 py-3 text-left ${
                  selected ? "bg-raised" : "bg-transparent"
                }`}
              >
                {/* The number ties a row to its position in the ordered list when
                    read aloud, and gives sighted users a stable reference. */}
                <span className="flex items-baseline gap-2 text-xs text-ink-muted">
                  <span>{index + 1}</span>
                  <SeverityBadge score={score} />
                  {selected ? <span className="text-ink">Selected</span> : null}
                </span>

                <span className="mt-1.5 block text-sm font-medium">
                  {obstacleTypesSentence(report.obstacle_types)}
                </span>

                <span className="mt-1 block text-sm text-ink-muted">{description}</span>

                <span className="mt-1.5 block text-xs text-ink-muted">
                  {formatAge(report.created_at)}, {formatConfirmations(report.confirmations)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
