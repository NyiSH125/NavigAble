"use client";

import { useEffect, useState } from "react";

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
  /** Which end is waiting for a map click, if either. */
  pickTarget: "routeStart" | "routeEnd" | null;
  onPickTarget: (target: "routeStart" | "routeEnd" | null) => void;
  pickedStart: LngLat | null;
  pickedEnd: LngLat | null;
}

/** Stands in for the preset list when a point comes from the map or the fields. */
const CUSTOM_DESTINATION = "custom";

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
  pickTarget,
  onPickTarget,
  pickedStart,
  pickedEnd,
}: RoutePlannerProps) {
  const [start, setStart] = useState<LngLat | null>(null);
  const [startLabel, setStartLabel] = useState("No start set yet.");
  const [startLat, setStartLat] = useState("");
  const [startLng, setStartLng] = useState("");
  const [destinationId, setDestinationId] = useState<string>(DESTINATIONS[0]?.id ?? "");
  const [compare, setCompare] = useState(true);
  const [notice, setNotice] = useState("");
  const [endLat, setEndLat] = useState("");
  const [endLng, setEndLng] = useState("");
  const [customEnd, setCustomEnd] = useState<LngLat | null>(null);

  const preset = DESTINATIONS.find((place) => place.id === destinationId) ?? null;
  const destination: LngLat | null = preset
    ? { lat: preset.lat, lng: preset.lng }
    : destinationId === CUSTOM_DESTINATION
      ? customEnd
      : null;

  // A point chosen on the map fills the same fields the keyboard path uses, so
  // the two ways of setting an end cannot disagree.
  useEffect(() => {
    if (!pickedStart) return;
    setStart(pickedStart);
    setStartLat(pickedStart.lat.toFixed(5));
    setStartLng(pickedStart.lng.toFixed(5));
    setStartLabel(
      `Start is the point you chose on the map: ${pickedStart.lat.toFixed(5)}, ${pickedStart.lng.toFixed(5)}.`,
    );
    setNotice(
      `Start set from the map: ${pickedStart.lat.toFixed(5)}, ${pickedStart.lng.toFixed(5)}.`,
    );
  }, [pickedStart]);

  useEffect(() => {
    if (!pickedEnd) return;
    setCustomEnd(pickedEnd);
    setDestinationId(CUSTOM_DESTINATION);
    setEndLat(pickedEnd.lat.toFixed(5));
    setEndLng(pickedEnd.lng.toFixed(5));
    setNotice(
      `Destination set from the map: ${pickedEnd.lat.toFixed(5)}, ${pickedEnd.lng.toFixed(5)}.`,
    );
  }, [pickedEnd]);

  const useManualEnd = () => {
    const lat = Number(endLat);
    const lng = Number(endLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setNotice("Destination latitude must be a number between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setNotice("Destination longitude must be a number between -180 and 180.");
      return;
    }
    setCustomEnd({ lat, lng });
    setDestinationId(CUSTOM_DESTINATION);
    setNotice("Destination set from the coordinates you entered.");
  };

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
    onRequestRoute({ from: start, to: destination, compare });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-b border-line px-4 py-4">
      <p aria-live="polite" role="status" className="sr-only">
        {notice}
      </p>

      <fieldset>
        <legend className="eyebrow">Start</legend>
        <p className="lede mt-1">{startLabel}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={useDeviceLocation} disabled={loading} className="btn">
            Use my location
          </button>
          {/* Clicking the map is a shortcut for mouse users. The coordinate fields
              below stay the keyboard path to the same result. */}
          <button
            type="button"
            onClick={() => onPickTarget(pickTarget === "routeStart" ? null : "routeStart")}
            aria-pressed={pickTarget === "routeStart"}
            disabled={loading}
            className="btn"
          >
            {pickTarget === "routeStart" ? "Stop choosing start" : "Choose on map"}
          </button>
        </div>
        {pickTarget === "routeStart" ? (
          <p className="box mt-2 px-2 py-1.5 text-xs">
            Click the start on the map. The coordinates appear below and can be edited by
            hand.
          </p>
        ) : null}

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
          A short list of places, since there is no address search in this build, or a
          point of your own.
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
              />
              <span>{place.label}</span>
            </label>
          ))}
          <label className="flex items-baseline gap-2 text-sm">
            <input
              type="radio"
              name="destination"
              value={CUSTOM_DESTINATION}
              checked={destinationId === CUSTOM_DESTINATION}
              onChange={() => setDestinationId(CUSTOM_DESTINATION)}
              disabled={loading}
            />
            <span>
              A point I choose
              {customEnd ? (
                <span className="lede block">
                  {customEnd.lat.toFixed(5)}, {customEnd.lng.toFixed(5)}
                </span>
              ) : null}
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={() => onPickTarget(pickTarget === "routeEnd" ? null : "routeEnd")}
          aria-pressed={pickTarget === "routeEnd"}
          disabled={loading}
          className="btn mt-2"
        >
          {pickTarget === "routeEnd" ? "Stop choosing destination" : "Choose on map"}
        </button>
        {pickTarget === "routeEnd" ? (
          <p className="box mt-2 px-2 py-1.5 text-xs">
            Click the destination on the map. The coordinates appear below and can be
            edited by hand.
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <span className="flex flex-col">
            <label htmlFor="route-end-lat" className="text-xs text-ink-muted">
              Destination latitude
            </label>
            <input
              id="route-end-lat"
              inputMode="decimal"
              value={endLat}
              onChange={(event) => setEndLat(event.target.value)}
              disabled={loading}
              className="field w-28"
            />
          </span>
          <span className="flex flex-col">
            <label htmlFor="route-end-lng" className="text-xs text-ink-muted">
              Destination longitude
            </label>
            <input
              id="route-end-lng"
              inputMode="decimal"
              value={endLng}
              onChange={(event) => setEndLng(event.target.value)}
              disabled={loading}
              className="field w-28"
            />
          </span>
          <button type="button" onClick={useManualEnd} disabled={loading} className="btn">
            Use these coordinates
          </button>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={compare}
          onChange={(event) => setCompare(event.target.checked)}
          disabled={loading}
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
        {!start || !destination ? (
          <span className="text-xs text-ink-muted">
            {!start && !destination
              ? "Set a start and a destination to find a route."
              : !start
                ? "Set a start to find a route."
                : "Set a destination to find a route."}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="box">
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
