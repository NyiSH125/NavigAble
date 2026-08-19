"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type ObstacleType, type SeverityProfile } from "@/lib/obstacles";
import { DEFAULT_PROFILE, profileMeta, type Report } from "@/lib/reports";
import { initialBbox, parseCenter, type Bbox } from "@/lib/viewport";
import ObstacleFilters from "@/components/ObstacleFilters";
import ReportForm from "@/components/ReportForm";
import RoutePlanner, { type RouteRequest } from "@/components/RoutePlanner";
import type { RouteView } from "@/components/RouteSteps";
import type { LngLat } from "@/lib/routing";
import ReportDetail from "@/components/ReportDetail";
import ReportList from "@/components/ReportList";
import { SeverityLegend } from "@/components/SeverityBadge";
import { MapGlyph } from "@/components/icons";
import ThemeToggle from "@/components/ThemeToggle";
import { isTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { MapSkeleton, ReportListSkeleton } from "@/components/Skeleton";

// MapLibre touches window at import time, so it never runs on the server. The
// skeleton is the loading state, not a spinner.
const MapCanvas = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

/** Wait for panning to settle before refetching. */
const MOVE_DEBOUNCE_MS = 350;

/** Who a map click belongs to. */
type PickTarget = "report" | "routeStart" | "routeEnd" | null;

function bboxParam(bbox: Bbox): string {
  return [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]
    .map((n) => n.toFixed(6))
    .join(",");
}

export default function Page() {
  const [profile, setProfile] = useState<SeverityProfile>(DEFAULT_PROFILE);
  const [selectedTypes, setSelectedTypes] = useState<ObstacleType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bbox, setBbox] = useState<Bbox>(() =>
    initialBbox(parseCenter(process.env.NEXT_PUBLIC_DEFAULT_CENTER)),
  );

  const [reports, setReports] = useState<Report[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mapVisible, setMapVisible] = useState(false);
  /**
   * Mirrors the attribute the head script already set before paint. Held in state
   * only so the basemap and the toggle label can react to it.
   */
  const [theme, setTheme] = useState<Theme>("dark");
  const [reportOpen, setReportOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);

  const [routeRequest, setRouteRequest] = useState<RouteRequest | null>(null);
  const [route, setRoute] = useState<RouteView | null>(null);
  const [directRoute, setDirectRoute] = useState<RouteView | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [focusPoint, setFocusPoint] = useState<LngLat | null>(null);
  /**
   * Which control is waiting for a map click. One picking mode serves three
   * consumers, so the point has to know where it is going.
   */
  const [pickTarget, setPickTarget] = useState<PickTarget>(null);
  const [reportPoint, setReportPoint] = useState<LngLat | null>(null);
  const [routeStartPoint, setRouteStartPoint] = useState<LngLat | null>(null);
  const [routeEndPoint, setRouteEndPoint] = useState<LngLat | null>(null);
  /** Bumped after a successful submission to refetch the current viewport. */
  const [refreshToken, setRefreshToken] = useState(0);

  const itemRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const reportToggleRef = useRef<HTMLButtonElement | null>(null);
  const showMapRef = useRef<HTMLButtonElement | null>(null);
  /** Which control to hand focus to after the map toggle swaps it out. */
  const focusAfterToggle = useRef<"show" | "hide" | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const registerItemRef = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) itemRefs.current.set(id, node);
    else itemRefs.current.delete(id);
  }, []);

  const handleBoundsChange = useCallback((next: Bbox) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setBbox(next), MOVE_DEBOUNCE_MS);
  }, []);

  // Fetch whenever the viewport or the type filter changes.
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ bbox: bboxParam(bbox) });
    if (selectedTypes.length > 0) params.set("types", selectedTypes.join(","));

    setLoading(true);
    setError(null);

    fetch(`/api/reports?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message ?? "Could not load reports.");
        setReports(body.reports as Report[]);
        setTruncated(Boolean(body.truncated));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Could not load reports.");
        setReports([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [bbox, selectedTypes, refreshToken]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Read back what the head script decided, and follow the system setting while
  // the visitor has not made an explicit choice.
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (isTheme(current)) setTheme(current);

    const query = window.matchMedia("(prefers-color-scheme: light)");
    const follow = (event: MediaQueryListEvent) => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        stored = null;
      }
      if (isTheme(stored)) return;
      const next: Theme = event.matches ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      setTheme(next);
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  // Wide screens open with the map showing, narrow ones with the list alone.
  // Done in an effect rather than during render so the server and the client
  // agree on the first pass.
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) setMapVisible(true);
  }, []);

  /**
   * The show button and the on-map close button replace one another, so whichever
   * was just activated has left the document. Without this, focus falls to the
   * body and a keyboard user loses their place.
   */
  useEffect(() => {
    const target = focusAfterToggle.current;
    if (!target) return;

    let frames = 0;
    const attempt = () => {
      const node =
        target === "show"
          ? showMapRef.current
          : document.querySelector<HTMLButtonElement>('#map-pane button[data-hide-map="true"]');
      if (node) {
        node.focus();
        focusAfterToggle.current = null;
        return;
      }
      // The map is dynamically imported, so its controls can appear a beat late.
      // Only that direction needs to wait.
      if (frames++ < 30) requestAnimationFrame(attempt);
      else focusAfterToggle.current = null;
    };
    // Try straight away: the show button exists in the same commit, so deferring
    // it would park focus on the body for a noticeable beat.
    attempt();
  }, [mapVisible]);

  const showMap = useCallback(() => {
    focusAfterToggle.current = "hide";
    setMapVisible(true);
  }, []);

  const hideMap = useCallback(() => {
    focusAfterToggle.current = "show";
    setMapVisible(false);
    setPickTarget(null);
  }, []);

  // Re-routes whenever the endpoints or the profile change. The profile is part
  // of the key on purpose: a different profile is a different route, which is the
  // whole point of the feature.
  useEffect(() => {
    if (!routeRequest) return;

    const controller = new AbortController();
    setRouteLoading(true);
    setRouteError(null);
    setSelectedStep(null);

    fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: routeRequest.from,
        to: routeRequest.to,
        profile,
        compare: routeRequest.compare,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message ?? "No route could be found.");
        setRoute(body.route as RouteView);
        setDirectRoute((body.direct as RouteView | null) ?? null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setRouteError(cause instanceof Error ? cause.message : "No route could be found.");
        setRoute(null);
        setDirectRoute(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteLoading(false);
      });

    return () => controller.abort();
  }, [routeRequest, profile]);

  const handleSelectStep = useCallback((index: number, at: LngLat) => {
    setSelectedStep(index);
    setFocusPoint(at);
  }, []);

  const handleClearRoute = useCallback(() => {
    setRouteRequest(null);
    setRoute(null);
    setDirectRoute(null);
    setRouteError(null);
    setSelectedStep(null);
  }, []);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedId) ?? null,
    [reports, selectedId],
  );

  // Drop a selection that has fallen out of the current results.
  useEffect(() => {
    if (selectedId && !loading && !selectedReport) setSelectedId(null);
  }, [selectedId, selectedReport, loading]);

  const handleCreated = useCallback((created: Report) => {
    // Insert optimistically before refetching. Without this, selecting the new
    // id while `reports` still holds the previous list makes the "selection fell
    // out of results" effect below clear it again before the refetch lands.
    // It also puts the pin and the row on screen immediately.
    setReports((current) =>
      current.some((report) => report.id === created.id) ? current : [created, ...current],
    );
    setSelectedId(created.id);
    setRefreshToken((token) => token + 1);
  }, []);

  const handlePickTarget = useCallback((next: PickTarget) => {
    setPickTarget(next);
    // The map is behind a toggle on small screens, so asking to choose a point on
    // it has to reveal it, otherwise the instruction is impossible to follow.
    if (next) setMapVisible(true);
  }, []);

  /**
   * Leaves the reporting flow. Clears the selection too, otherwise the report
   * just filed stays open in the detail panel below the list.
   */
  const handleReportDone = useCallback(() => {
    setReportOpen(false);
    setPickTarget(null);
    setReportPoint(null);
    setSelectedId(null);
    reportToggleRef.current?.focus();
  }, []);

  const handlePickLocation = useCallback(
    (point: LngLat) => {
      if (pickTarget === "report") setReportPoint(point);
      else if (pickTarget === "routeStart") setRouteStartPoint(point);
      else if (pickTarget === "routeEnd") setRouteEndPoint(point);
      setPickTarget(null);
    },
    [pickTarget],
  );

  const handleBackToList = useCallback(() => {
    // Focus before clearing: the row is still on screen either way, and moving
    // focus first means a keyboard user can press Enter straight away to reopen
    // the same report.
    if (selectedId) itemRefs.current.get(selectedId)?.focus();
    setSelectedId(null);
  }, [selectedId]);

  // One live region for the whole workspace, so state changes are announced
  // once rather than by each pane separately.
  const status = error
    ? `Could not load reports. ${error}`
    : loading
      ? "Loading reports"
      : `${reports.length} ${reports.length === 1 ? "report" : "reports"} in view, severity shown for the ${profileMeta(profile).label.toLowerCase()} profile${
          selectedReport ? ". Report selected, detail panel updated" : ""
        }`;

  return (
    <div className="flex h-dvh flex-col bg-ground text-ink">
      <a
        href="#reports-panel"
        className="absolute top-0 left-0 z-20 -translate-y-full bg-raised px-3 py-2 text-sm focus:translate-y-0"
      >
        Skip to reports
      </a>

      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="wordmark mr-1">NavigAble</h1>

          <button
            type="button"
            ref={reportToggleRef}
            onClick={() => {
              setReportOpen((open) => {
                if (open) setPickTarget(null);
                return !open;
              });
            }}
            aria-expanded={reportOpen}
            aria-controls="report-form-panel"
            className="btn"
          >
            {reportOpen ? "Close reporting form" : "Report an obstacle"}
          </button>

          <button
            type="button"
            onClick={() => setRouteOpen((open) => !open)}
            aria-expanded={routeOpen}
            aria-controls="route-planner-panel"
            className="btn"
          >
            {routeOpen ? "Close route planner" : "Plan a route"}
          </button>
        </div>

        <ThemeToggle theme={theme} onChange={setTheme} />
      </header>

      <p aria-live="polite" role="status" className="sr-only">
        {status}
      </p>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* The list pane comes first in the DOM on every screen size, so the
            keyboard path never runs through the map. */}
        <div
          id="reports-panel"
          className="order-1 flex min-h-0 flex-1 flex-col overflow-y-auto border-line lg:max-w-md lg:border-r lg:order-1"
        >
          <div id="report-form-panel" hidden={!reportOpen}>
            {reportOpen ? (
              <ReportForm
                onCreated={handleCreated}
                picking={pickTarget === "report"}
                onPickingChange={(on) => handlePickTarget(on ? "report" : null)}
                pickedPoint={reportPoint}
                onDone={handleReportDone}
              />
            ) : null}
          </div>

          <div id="route-planner-panel" hidden={!routeOpen}>
            {routeOpen ? (
              <RoutePlanner
                profile={profile}
                route={route}
                direct={directRoute}
                loading={routeLoading}
                error={routeError}
                selectedStep={selectedStep}
                onRequestRoute={setRouteRequest}
                onSelectStep={handleSelectStep}
                onClear={handleClearRoute}
                pickTarget={pickTarget === "routeStart" || pickTarget === "routeEnd" ? pickTarget : null}
                onPickTarget={handlePickTarget}
                pickedStart={routeStartPoint}
                pickedEnd={routeEndPoint}
              />
            ) : null}
          </div>

          <ObstacleFilters
            profile={profile}
            onProfileChange={setProfile}
            selectedTypes={selectedTypes}
            onTypesChange={setSelectedTypes}
          />

          {!mapVisible ? (
            <button
              type="button"
              ref={showMapRef}
              onClick={showMap}
              aria-controls="map-pane"
              className="w-full border-b border-line px-4 py-3 text-left text-sm"
            >
              <span className="flex items-center gap-2">
                <MapGlyph />
                Show map
              </span>
              <span className="lede mt-0.5 block">
                The map is a visual aid. Everything it shows is in the list below.
              </span>
            </button>
          ) : null}

          <div className="shrink-0 border-b border-hairline px-4 py-4">
            <SeverityLegend />
          </div>

          {error ? (
            <div className="border-b border-line px-4 py-3">
              <p className="text-sm">Could not load reports.</p>
              <p className="lede mt-1">{error}</p>
              <button
                type="button"
                onClick={() => setBbox((current) => ({ ...current }))}
                className="btn mt-2"
              >
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className="border-b border-hairline">
              <p className="px-4 py-3 text-sm text-ink-muted">Loading reports</p>
              <ReportListSkeleton />
            </div>
          ) : (
            <ReportList
              reports={reports}
              profile={profile}
              selectedId={selectedId}
              onSelect={setSelectedId}
              registerItemRef={registerItemRef}
              truncated={truncated}
            />
          )}

          {selectedReport ? (
            <ReportDetail report={selectedReport} onBackToList={handleBackToList} />
          ) : null}


        </div>

        <div
          id="map-pane"
          className={`order-2 min-h-0 flex-1 ${mapVisible ? "block" : "hidden"}`}
        >
          <MapCanvas
            reports={reports}
            profile={profile}
            selectedId={selectedId}
            routeGeometry={route?.geometry ?? null}
            directGeometry={directRoute?.geometry ?? null}
            focusPoint={focusPoint}
            pickingLocation={pickTarget !== null}
            pickedPoints={
              pickTarget === "report" || reportOpen
                ? reportPoint
                  ? [reportPoint]
                  : []
                : [routeStartPoint, routeEndPoint].filter((p): p is LngLat => p !== null)
            }
            onPickLocation={handlePickLocation}
            onHideMap={hideMap}
            theme={theme}
            onBoundsChange={handleBoundsChange}
            onSelect={setSelectedId}
          />
        </div>
      </div>
    </div>
  );
}
