"use client";

import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";

import { type SeverityProfile, type SeverityScore } from "@/lib/obstacles";
import { SEVERITY_LEVELS, severityFor, type Report } from "@/lib/reports";
import { parseCenter, parseZoom, type Bbox } from "@/lib/viewport";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

// MapLibre resolves its own module worker to the app root under Next's bundler,
// which returns HTML and leaves the map with a canvas but no style, and no error
// worth the name. scripts/copy-maplibre-worker.mjs puts the real worker here.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const SOURCE_ID = "reports";
const LAYER_PINS = "reports-pins";
const LAYER_SELECTED = "reports-selected";
const SOURCE_ROUTE = "route";
const LAYER_ROUTE = "route-line";
const SOURCE_DIRECT = "route-direct";
const LAYER_DIRECT = "route-direct-line";
const SOURCE_PICK = "picked-point";
const LAYER_PICK = "picked-point-marker";

interface MapProps {
  reports: Report[];
  profile: SeverityProfile;
  selectedId: string | null;
  /** Route line, drawn beneath the pins. Decorative: RouteSteps is canonical. */
  routeGeometry?: Array<[number, number]> | null;
  /** The same endpoints ignoring obstacles, shown dashed for comparison. */
  directGeometry?: Array<[number, number]> | null;
  /** A point to centre on, used when a route step is selected. */
  focusPoint?: { lng: number; lat: number } | null;
  /**
   * When true, a click anywhere on the map reports a location instead of
   * selecting a pin. A convenience for mouse users: the coordinate fields and the
   * device location button remain the keyboard paths to the same result.
   */
  pickingLocation?: boolean;
  /** The location chosen so far, drawn as a marker. */
  pickedPoint?: { lng: number; lat: number } | null;
  onPickLocation?: (point: { lng: number; lat: number }) => void;
  /** Fires after a user-driven move settles. Programmatic pans do not fire it. */
  onBoundsChange: (bbox: Bbox) => void;
  onSelect: (id: string) => void;
}

function toFeatureCollection(
  reports: Report[],
  profile: SeverityProfile,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: reports.map((report) => ({
      type: "Feature",
      id: report.id,
      geometry: { type: "Point", coordinates: [report.lng, report.lat] },
      properties: {
        id: report.id,
        severity: severityFor(report, profile),
      },
    })),
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Builds a data-driven match expression keyed on the severity property. */
function severityMatch<T>(pick: (level: SeverityScore) => T, fallback: T) {
  return [
    "match",
    ["get", "severity"],
    0,
    pick(0),
    1,
    pick(1),
    2,
    pick(2),
    3,
    pick(3),
    fallback,
  ] as unknown as ExpressionSpecification;
}

function lineFeature(
  coordinates: Array<[number, number]>,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features:
      coordinates.length > 1
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }]
        : [],
  };
}

export default function Map({
  reports,
  profile,
  selectedId,
  routeGeometry = null,
  directGeometry = null,
  focusPoint = null,
  pickingLocation = false,
  pickedPoint = null,
  onPickLocation,
  onBoundsChange,
  onSelect,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  /** Set while the map moves under our own instruction, to suppress refetching. */
  const programmaticRef = useRef(false);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onSelectRef = useRef(onSelect);
  const onPickLocationRef = useRef(onPickLocation);
  const pickingRef = useRef(pickingLocation);

  onBoundsChangeRef.current = onBoundsChange;
  onSelectRef.current = onSelect;
  onPickLocationRef.current = onPickLocation;
  pickingRef.current = pickingLocation;

  const emitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    onBoundsChangeRef.current({
      minLng: bounds.getWest(),
      minLat: bounds.getSouth(),
      maxLng: bounds.getEast(),
      maxLat: bounds.getNorth(),
    });
  }, []);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: parseCenter(process.env.NEXT_PUBLIC_DEFAULT_CENTER),
      zoom: parseZoom(process.env.NEXT_PUBLIC_DEFAULT_ZOOM),
      // The canvas is decorative and the list is the keyboard surface, so the
      // map must not become a tab stop that traps arrow keys.
      keyboard: false,
      attributionControl: { compact: true },
    });

    mapRef.current = map;

    // Hide the drawing surface from assistive technology and take it out of the
    // tab order. Attribution links and the zoom buttons live in a sibling
    // control container, so they stay reachable: attribution is a licence term,
    // and zooming changes which reports the list shows.
    const canvas = map.getCanvas();
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("tabindex", "-1");
    canvas.removeAttribute("role");
    canvas.removeAttribute("aria-label");

    // MapLibre labels its canvas wrapper as role="region" named "Map", which
    // would advertise the decorative canvas as a landmark alongside the list.
    const canvasContainer = map.getCanvasContainer();
    canvasContainer.setAttribute("aria-hidden", "true");
    canvasContainer.removeAttribute("role");
    canvasContainer.removeAttribute("aria-label");
    canvasContainer.setAttribute("tabindex", "-1");

    map.addControl(
      new NavigationControl({ showCompass: false, visualizePitch: false }),
      "top-right",
    );

    map.on("load", () => {
      // Added first so the pins, added below, paint over the line.
      map.addSource(SOURCE_DIRECT, { type: "geojson", data: lineFeature([]) });
      map.addLayer({
        id: LAYER_DIRECT,
        type: "line",
        source: SOURCE_DIRECT,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#8d8677",
          "line-width": 3,
          "line-dasharray": [2, 2],
        },
      });

      map.addSource(SOURCE_ROUTE, { type: "geojson", data: lineFeature([]) });
      map.addLayer({
        id: LAYER_ROUTE,
        type: "line",
        source: SOURCE_ROUTE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#5fa8a0",
          "line-width": 5,
        },
      });

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Size and outline width both climb with severity, so the levels are
      // separable in greyscale as well as by hue.
      map.addLayer({
        id: LAYER_PINS,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": severityMatch(
            (level) => SEVERITY_LEVELS[level].radius,
            SEVERITY_LEVELS[0].radius,
          ),
          "circle-color": severityMatch(
            (level) => SEVERITY_LEVELS[level].color,
            SEVERITY_LEVELS[0].color,
          ),
          "circle-stroke-width": severityMatch(
            (level) => SEVERITY_LEVELS[level].outlineWidth,
            SEVERITY_LEVELS[0].outlineWidth,
          ),
          "circle-stroke-color": severityMatch(
            (level) => SEVERITY_LEVELS[level].outline,
            SEVERITY_LEVELS[0].outline,
          ),
        },
      });

      // A separate ring marks the selection, so the severity styling below it
      // is not overwritten.
      map.addLayer({
        id: LAYER_SELECTED,
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-radius": severityMatch(
            (level) => SEVERITY_LEVELS[level].radius + 7,
            SEVERITY_LEVELS[0].radius + 7,
          ),
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#f2c14e",
        },
      });

      map.addSource(SOURCE_PICK, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: LAYER_PICK,
        type: "circle",
        source: SOURCE_PICK,
        paint: {
          "circle-radius": 9,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#f2c14e",
        },
      });

      readyRef.current = true;
      map.getContainer().dataset.ready = "true";
      emitBounds();
    });

    map.on("error", (event) => {
      // A failed style or tile request otherwise shows up as a blank rectangle.
      console.error("[map] maplibre error", event.error ?? event);
    });

    map.on("moveend", () => {
      if (programmaticRef.current) {
        programmaticRef.current = false;
        return;
      }
      emitBounds();
    });

    // Clicking a pin is a convenience for mouse users. The list is the
    // canonical way to select, so nothing here is keyboard-only functionality.
    map.on("click", LAYER_PINS, (event: MapLayerMouseEvent) => {
      if (pickingRef.current) return;
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") onSelectRef.current(id);
    });

    // Any click while picking reports a location, including on top of a pin.
    map.on("click", (event: MapLayerMouseEvent) => {
      if (!pickingRef.current) return;
      onPickLocationRef.current?.({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    });

    map.on("mouseenter", LAYER_PINS, () => {
      if (!pickingRef.current) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER_PINS, () => {
      if (!pickingRef.current) map.getCanvas().style.cursor = "";
    });

    // The map pane is hidden behind a toggle on small screens, so the container
    // can go from zero size to full size without a window resize. MapLibre only
    // watches the window, so it needs telling.
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width === 0 || box.height === 0) return;
      map.resize();
      if (readyRef.current) emitBounds();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [emitBounds]);

  // Push report data into the source whenever it or the active profile changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(reports, profile));
  }, [reports, profile]);

  // Push route geometry and frame it. Framing is a programmatic move, so it must
  // not trigger a refetch.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const route = map.getSource(SOURCE_ROUTE) as GeoJSONSource | undefined;
    route?.setData(lineFeature(routeGeometry ?? []));
    const direct = map.getSource(SOURCE_DIRECT) as GeoJSONSource | undefined;
    direct?.setData(lineFeature(directGeometry ?? []));

    if (!routeGeometry || routeGeometry.length < 2) return;

    const bounds = routeGeometry.reduce(
      (acc, [lng, lat]) => acc.extend([lng, lat]),
      new LngLatBounds(routeGeometry[0], routeGeometry[0]),
    );
    programmaticRef.current = true;
    map.fitBounds(bounds, { padding: 48, duration: prefersReducedMotion() ? 0 : 400 });
  }, [routeGeometry, directGeometry]);

  // Centre on a chosen route step.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !focusPoint) return;
    programmaticRef.current = true;
    if (prefersReducedMotion()) {
      map.jumpTo({ center: [focusPoint.lng, focusPoint.lat] });
    } else {
      map.easeTo({ center: [focusPoint.lng, focusPoint.lat], duration: 350 });
    }
  }, [focusPoint]);

  // Crosshair makes the picking mode visible rather than only announced.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = pickingLocation ? "crosshair" : "";
  }, [pickingLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource(SOURCE_PICK) as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: pickedPoint
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [pickedPoint.lng, pickedPoint.lat] },
            },
          ]
        : [],
    });
  }, [pickedPoint]);

  // Mirror the selection and pan to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    map.setFilter(LAYER_SELECTED, ["==", ["get", "id"], selectedId ?? ""]);

    if (!selectedId) return;
    const target = reports.find((report) => report.id === selectedId);
    if (!target) return;

    programmaticRef.current = true;
    if (prefersReducedMotion()) {
      map.jumpTo({ center: [target.lng, target.lat] });
    } else {
      map.easeTo({ center: [target.lng, target.lat], duration: 400 });
    }
  }, [selectedId, reports]);

  return (
    <div
      ref={containerRef}
      role="presentation"
      className="h-full w-full bg-panel"
      data-testid="map-container"
    />
  );
}
