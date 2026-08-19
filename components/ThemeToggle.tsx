"use client";

import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { MoonGlyph, SunGlyph } from "@/components/icons";

interface ThemeToggleProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

/**
 * Switches between the two themes and remembers the choice.
 *
 * The label names the destination rather than the current state, because "Dark"
 * alone is ambiguous about whether it describes what you have or what you would
 * get. The glyph is decorative; the text carries the meaning.
 */
export default function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  const next: Theme = theme === "dark" ? "light" : "dark";

  const apply = () => {
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing can refuse storage. The theme still applies for now.
    }
    onChange(next);
  };

  return (
    <button type="button" onClick={apply} className="btn shrink-0">
      {next === "light" ? <SunGlyph /> : <MoonGlyph />}
      {next === "light" ? "Light theme" : "Dark theme"}
    </button>
  );
}
