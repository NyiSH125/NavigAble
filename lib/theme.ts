/**
 * Light and dark themes.
 *
 * CLAUDE.md calls for a dark map style, so the light theme is a deliberate
 * exception to that rule, added on request. The rest of the rules still hold in
 * both themes: no pure white ground, contrast of 4.5:1 for text and 3:1 for
 * boundaries, and severity never carried by colour alone.
 */

export const THEMES = ["dark", "light"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "navigable.theme";

/** Basemap per theme. Positron is the light counterpart to the dark style. */
export const MAP_STYLE_URL: Record<Theme, string> = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Runs before first paint, from a blocking script in the document head.
 *
 * Without this the page renders in the default theme and then corrects itself,
 * which is a visible flash of the wrong colours on every load. Kept as a string
 * because it has to execute before React hydrates.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
`.trim();
