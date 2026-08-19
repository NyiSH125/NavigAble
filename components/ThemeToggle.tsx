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
 * Icon-only, so the name is supplied explicitly and states the destination rather
 * than the current state: "Dark" alone is ambiguous about whether it describes
 * what you have or what you would get.
 */
export default function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Switch to the light theme" : "Switch to the dark theme";

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
    <button
      type="button"
      onClick={apply}
      aria-label={label}
      title={label}
      className="btn btn-icon shrink-0"
    >
      {next === "light" ? <SunGlyph /> : <MoonGlyph />}
    </button>
  );
}
