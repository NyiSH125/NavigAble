/**
 * Loading placeholders that mirror the shape of the real content.
 *
 * Each skeleton is hidden from assistive technology. The surrounding region
 * announces its own busy state, so a screen reader hears "Loading reports"
 * once instead of reading a stack of empty boxes.
 */

function Bar({ className = "" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} />;
}

/** Mirrors one ReportList row. */
export function ReportListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul aria-hidden="true" className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="border-b border-hairline p-3">
          <div className="flex items-center gap-2">
            <Bar className="h-3 w-3 rounded-full" />
            <Bar className="h-3 w-24" />
          </div>
          <Bar className="mt-2.5 h-3.5 w-11/12" />
          <Bar className="mt-1.5 h-3.5 w-3/5" />
          <div className="mt-2.5 flex gap-3">
            <Bar className="h-2.5 w-16" />
            <Bar className="h-2.5 w-20" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Mirrors the map pane: a flat field with a small control cluster. */
export function MapSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="relative h-full w-full overflow-hidden bg-panel"
    >
      <Bar className="h-full w-full" />
      <span className="skeleton absolute top-3 right-3 block h-14 w-8 rounded-[3px]" />
      <span className="skeleton absolute bottom-3 left-3 block h-4 w-40 rounded-[3px]" />
    </div>
  );
}

/** Mirrors the detail panel. */
export function ReportDetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 p-3">
      <Bar className="aspect-[4/3] w-full rounded-[3px]" />
      <Bar className="h-4 w-2/3" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Bar key={index} className="h-3 w-5/6" />
        ))}
      </div>
    </div>
  );
}
