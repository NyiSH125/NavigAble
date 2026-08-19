/**
 * Hand-drawn glyphs.
 *
 * No icon library and no emoji, per CLAUDE.md. These are two paths each, sized to
 * the surrounding text and inheriting its colour, and always hidden from
 * assistive technology: the button's own name carries the meaning.
 */

/** Shared so the imperative map control can reuse the same shape as the JSX one. */
export const CROSS_PATH = "M5 5 14 14M14 5 5 14";

const MAP_OUTLINE = "M1.5 4 6 2.4l4 1.6 4.5-1.6v9.6L10 13.6l-4-1.6L1.5 13.6z";
const MAP_FOLDS = "M6 2.4v9.6M10 4v9.6";

export function MapGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d={MAP_OUTLINE} />
      <path d={MAP_FOLDS} />
    </svg>
  );
}

export function CrossGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 19 19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d={CROSS_PATH} />
    </svg>
  );
}
