"use client";

import { useState } from "react";

import { type SeverityProfile } from "@/lib/obstacles";
import { DESTINATIONS } from "@/lib/places";
import { type LngLat } from "@/lib/routing";
import RouteSteps, { type RouteView } from "@/components/RouteSteps";
import { ReportListSkeleton } from "@/components/Skeleton";

export interface RouteRequest {
  from: LngLat;
  to: LngLat;
  compare: boolean;
}

interface RoutePlannerProps {
  profile: SeverityProfile;
  route: RouteView | null;
  direct: RouteView | null;
  loading: boolean;
  error: string | null;
  selectedStep: number | null;
  onRequestRoute: (request: RouteRequest) => void;
  onSelectStep: (index: number, at: LngLat) => void;
  onClear: () => void;
}

/**
 * Route entry without a geocoder: the device location or typed coordinates for
 * the start, and a fixed destination list for the end. Every control is a native
 * input or button, so the whole thing works from the keyboard by default.
 */
export default function RoutePlanner({
  profile,
  route,
  direct,
  loading,
  error,
  selectedStep,
  onRequestRoute,
  onSelectStep,
  onClear,
}: RoutePlannerProps) {
  const [start, setStart] = useState<LngLat | null>(null);
  const [startLabel, setStartLabel] = useState("No start set yet.");
  const [startLat, setStartLat] = useState("");
  const [startLng, setStartLng] = useState("");
  const [destinationId, setDestinationId] = useState<string>(DESTINATIONS[0]?.id ?? "");
  const [compare, setCompare] = useState(true);
  const [notice, setNotice] = useState("");

  const destination = DESTINATIONS.find((place) => place.id === destinationId) ?? null;

  const useDeviceLocation = () => {
    if (!("geolocation" in navigator)) {
      setStartLabel("This browser does not offer location. Enter coordinates instead.");
      setNotice("Location unavailable. Enter coordinates instead.");
      return;
    }
    setStartLabel("Finding your location.");
    setNotice("Finding your location.");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude };
        setStart(next);
        setStartLat(next.lat.toFixed(5));
        setStartLng(next.lng.toFixed(5));
        setStartLabel(`Start is your location: ${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}.`);
        setNotice("Start set from your device location.");
      },
      (positionError) => {
        const reason =
          positionError.code === positionError.PERMISSION_DENIED
            ? "Location permission was declined."
            : "Your location could not be determined.";
        setStartLabel(`${reason} Enter coordinates below instead.`);
        setNotice(`${reason} Enter coordinates below instead.`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const useManualStart = () => {
    const lat = Number(startLat);
    const lng = Number(startLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setStartLabel("Latitude must be a number between -90 and 90.");
      setNotice("Latitude must be a number between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setStartLabel("Longitude must be a number between -180 and 180.");
      setNotice("Longitude must be a number between -180 and 180.");
      return;
    }
    setStart({ lat, lng });
    setStartLabel(`Start is ${lat.toFixed(5)}, ${lng.toFixed(5)}.`);
    setNotice("Start set from the coordinates you entered.");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!start || !destination) return;
    onRequestRoute({
      from: start,
      to: { lat: destination.lat, lng: destination.lng },
      compare,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-b border-line px-4 py-4">
      <p aria-live="polite" role="status" className="sr-only">
        {notice}
      </p>

      <fieldset>
        <legend className="eyebrow">Start</legend>
        <p className="lede mt-1">{startLabel}</p>
        <button
          type="button"
          onClick={useDeviceLocation}
          disabled={loading}
          className="btn mt-2"
        >
          Use my location
        </button>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <span className="flex flex-col">
            <label htmlFor="route-start-lat" className="text-xs text-ink-muted">
              Start latitude
            </label>
            <input
              id="route-start-lat"
              inputMode="decimal"
              value={startLat}
              onChange={(event) => setStartLat(event.target.value)}
              disabled={loading}
              className="field w-28"
            />
          </span>
          <span className="flex flex-col">
            <label htmlFor="route-start-lng" className="text-xs text-ink-muted">
              Start longitude
            </label>
            <input
              id="route-start-lng"
              inputMode="decimal"
              value={startLng}
              onChange={(event) => setStartLng(event.target.value)}
              disabled={loading}
              className="field w-28"
            />
          </span>
          <button
            type="button"
            onClick={useManualStart}
            disabled={loading}
            className="btn"
          >
            Use these coordinates
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend className="eyebrow">Destination</legend>
        <p className="lede mt-1">
          A short list of places, since there is no address search in this build.
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {DESTINATIONS.map((place) => (
            <label key={place.id} className="flex items-baseline gap-2 text-sm">
              <input
                type="radio"
                name="destination"
                value={place.id}
                checked={destinationId === place.id}
                onChange={() => setDestinationId(place.id)}
                disabled={loading}
                className="accent-[#f2c14e]"
              />
              <span>{place.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={compare}
          onChange={(event) => setCompare(event.target.checked)}
          disabled={loading}
          className="accent-[#f2c14e]"
        />
        <span>Compare with the route that ignores obstacles</span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!start || !destination || loading}
          className="btn btn-lg btn-primary"
        >
          {loading ? "Finding route" : "Find route"}
        </button>
        {route ? (
          <button type="button" onClick={onClear} className="btn">
            Clear route
          </button>
        ) : null}
        {!start ? (
          <span className="text-xs text-ink-muted">Set a start to find a route.</span>
        ) : null}
      </div>

      {loading ? (
        <div className="border border-hairline">
          <p className="px-3 pt-3 text-sm text-ink-muted">Finding a route</p>
          <ReportListSkeleton rows={4} />
        </div>
      ) : null}

      {error && !loading ? (
        <div className="surface px-3 py-2">
          <p className="text-sm">No route yet.</p>
          <p className="lede mt-1">{error}</p>
        </div>
      ) : null}

      {route && !loading ? (
        <RouteSteps
          route={route}
          direct={direct}
          profile={profile}
          selectedStep={selectedStep}
          onSelectStep={onSelectStep}
        />
      ) : null}
    </form>
  );
}
