import { type SeverityScore } from "@/lib/obstacles";
import { severityMeta, type SeverityShape } from "@/lib/reports";

/**
 * The shape is decorative and hidden from assistive technology. The written
 * label beside it carries the meaning, so severity never depends on colour.
 */
function Shape({ shape, score }: { shape: SeverityShape; score: SeverityScore }) {
  // var(), not a literal, so the fill follows the active theme.
  const color = `var(--color-sev${score})`;
  if (shape === "triangle") {
    return (
      <span
        aria-hidden="true"
        className="inline-block shrink-0"
        style={{
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderBottom: `11px solid ${color}`,
        }}
      />
    );
  }

  if (shape === "bar") {
    return (
      <span
        aria-hidden="true"
        className="inline-block shrink-0"
        style={{ width: 12, height: 4, backgroundColor: color }}
      />
    );
  }

  // A diamond is a square turned 45 degrees, so it needs no border radius.
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0"
      style={{
        width: 11,
        height: 11,
        backgroundColor: color,
        transform: shape === "diamond" ? "rotate(45deg)" : undefined,
      }}
    />
  );
}

export function SeverityBadge({
  score,
  variant = "short",
}: {
  score: SeverityScore;
  variant?: "short" | "full";
}) {
  const meta = severityMeta(score);
  return (
    <span className="inline-flex items-center gap-2">
      <Shape shape={meta.shape} score={score} />
      <span>
        {variant === "full" ? meta.label : meta.shortLabel} ({score} of 3)
      </span>
    </span>
  );
}

/** Standalone key so the map's circles can be decoded without clicking a pin. */
export function SeverityLegend() {
  const scores: SeverityScore[] = [0, 1, 2, 3];
  return (
    <div className="surface p-3">
      <h3 className="eyebrow mb-2">
        Severity key
      </h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {scores.map((score) => (
          <li key={score} className="flex items-center gap-2">
            <SeverityBadge score={score} variant="full" />
          </li>
        ))}
      </ul>
      <p className="lede mt-2">
        On the map, larger circles with thicker outlines mean higher severity, so the
        levels stay readable without colour.
      </p>
    </div>
  );
}
