/**
 * Viewport defaults shared by the map and the page.
 *
 * The list must be able to load without the map ever mounting, so the initial
 * bounding box is derived from the configured centre rather than read off the
 * map. The map refines it on the first move.
 */

export interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export const FALLBACK_CENTER: [number, number] = [-122.04584, 37.3193];
export const FALLBACK_ZOOM = 15;

/** Half-span of the initial box in degrees, roughly a 2 km window. */
const INITIAL_HALF_SPAN = 0.012;

export function parseCenter(raw: string | undefined): [number, number] {
  if (!raw) return FALLBACK_CENTER;
  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return FALLBACK_CENTER;
  const [lng, lat] = parts;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return FALLBACK_CENTER;
  return [lng, lat];
}

export function parseZoom(raw: string | undefined): number {
  const zoom = Number(raw);
  return Number.isFinite(zoom) && zoom >= 0 && zoom <= 22 ? zoom : FALLBACK_ZOOM;
}

export function initialBbox(center: [number, number]): Bbox {
  const [lng, lat] = center;
  return {
    minLng: Math.max(lng - INITIAL_HALF_SPAN, -180),
    minLat: Math.max(lat - INITIAL_HALF_SPAN, -90),
    maxLng: Math.min(lng + INITIAL_HALF_SPAN, 180),
    maxLat: Math.min(lat + INITIAL_HALF_SPAN, 90),
  };
}
