"use client";

import { type ObstacleType, type SeverityProfile } from "@/lib/obstacles";
import { FILTERABLE_OBSTACLE_TYPES, PROFILES, obstacleTypeLabel } from "@/lib/reports";

interface ObstacleFiltersProps {
  profile: SeverityProfile;
  onProfileChange: (profile: SeverityProfile) => void;
  selectedTypes: ObstacleType[];
  onTypesChange: (types: ObstacleType[]) => void;
}

/**
 * Two independent controls. The profile selector changes which severity is
 * shown and how the list is ordered. The checkboxes change which reports are
 * fetched at all.
 */
export default function ObstacleFilters({
  profile,
  onProfileChange,
  selectedTypes,
  onTypesChange,
}: ObstacleFiltersProps) {
  const toggle = (type: ObstacleType, checked: boolean) => {
    onTypesChange(
      checked ? [...selectedTypes, type] : selectedTypes.filter((t) => t !== type),
    );
  };

  return (
    <div className="flex flex-col gap-4 border-b border-line px-4 py-4">
      {/* Radio group rather than a select, so the whole set is visible and
          arrow keys move between profiles. */}
      <fieldset>
        <legend className="eyebrow">
          Your profile
        </legend>
        <p className="lede mt-1">
          Sets which severity the map and list show.
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {PROFILES.map((meta) => (
            <label key={meta.id} className="flex items-baseline gap-2 text-sm">
              <input
                type="radio"
                name="profile"
                value={meta.id}
                checked={profile === meta.id}
                onChange={() => onProfileChange(meta.id)}
                className="mt-0.5 accent-[#f2c14e]"
              />
              <span>
                {meta.label}
                <span className="block text-xs text-ink-muted">{meta.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="eyebrow">
          Obstacle types
        </legend>
        <p className="lede mt-1">
          {selectedTypes.length === 0
            ? "Showing every type. Check a box to narrow the map."
            : `Showing ${selectedTypes.length} of ${FILTERABLE_OBSTACLE_TYPES.length} types.`}
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {FILTERABLE_OBSTACLE_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={type}
                checked={selectedTypes.includes(type)}
                onChange={(event) => toggle(type, event.target.checked)}
                className="accent-[#f2c14e]"
              />
              <span>{obstacleTypeLabel(type)}</span>
            </label>
          ))}
        </div>
        {selectedTypes.length > 0 ? (
          <button
            type="button"
            onClick={() => onTypesChange([])}
            className="btn mt-3"
          >
            Clear all obstacle filters
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}
