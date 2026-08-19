"use client";

import { useEffect, useRef, useState } from "react";

import { PROFILES, formatConfidence, obstacleTypeLabel, severityFor, type Report } from "@/lib/reports";
import { SeverityBadge } from "@/components/SeverityBadge";
import { ReportDetailSkeleton } from "@/components/Skeleton";

interface ReportFormProps {
  onCreated: (report: Report) => void;
}

type Status = "idle" | "preparing" | "analyzing" | "success" | "error";

interface Coords {
  lat: number;
  lng: number;
  source: "device" | "manual";
  accuracy?: number;
}

const REPORTER_KEY = "navigable.reporter-id";

/**
 * Longest edge of the uploaded image, in pixels.
 *
 * Phone cameras produce files of several megabytes, and base64 adds a third on
 * top, so an unmodified photo can exceed the 5MB request cap on its own.
 * Downscaling here keeps submissions inside the cap and cuts the model's
 * classification time as well. 1600px is far more detail than the classifier
 * needs to see a kerb or a flight of steps.
 */
const MAX_EDGE = 1600;

function reporterId(): string {
  try {
    const existing = window.localStorage.getItem(REPORTER_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(REPORTER_KEY, fresh);
    return fresh;
  } catch {
    // Private browsing can refuse storage. An anonymous report is still valid.
    return "anonymous";
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Downscales to JPEG. Falls back to the original bytes when the browser cannot
 * decode the format, which happens with HEIC outside Safari. The API accepts
 * HEIC, so the fallback still works, it just sends more bytes.
 */
async function prepareImage(
  file: File,
): Promise<{ imageBase64: string; mediaType: string; note?: string }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("decode failed"));
      element.src = objectUrl;
    });

    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) throw new Error("encode failed");

    return {
      imageBase64: await blobToBase64(blob),
      mediaType: "image/jpeg",
      note: `Resized to ${width} by ${height} pixels, ${Math.round(blob.size / 1024)} KB`,
    };
  } catch {
    return {
      imageBase64: await blobToBase64(file),
      mediaType: file.type || "image/jpeg",
      note: `Sent at original size, ${Math.round(file.size / 1024)} KB`,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function ReportForm({ onCreated }: ReportFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [geoMessage, setGeoMessage] = useState<string>("No location set yet.");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [prepNote, setPrepNote] = useState<string | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pickFile = (next: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
    setResult(null);
    setErrorMessage(null);
    setPrepNote(null);
    setStatus("idle");
    setAnnouncement(next ? `Photo selected, ${next.name}.` : "Photo cleared.");
  };

  const useDeviceLocation = () => {
    if (!("geolocation" in navigator)) {
      setGeoMessage("This browser does not offer location. Enter coordinates instead.");
      setAnnouncement("Location unavailable. Enter coordinates instead.");
      return;
    }
    setGeoMessage("Finding your location.");
    setAnnouncement("Finding your location.");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: Coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          source: "device",
          accuracy: position.coords.accuracy,
        };
        setCoords(next);
        setManualLat(next.lat.toFixed(5));
        setManualLng(next.lng.toFixed(5));
        const accuracy = next.accuracy ? `, accurate to about ${Math.round(next.accuracy)} metres` : "";
        setGeoMessage(
          `Using device location: ${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}${accuracy}.`,
        );
        setAnnouncement(`Location set from your device${accuracy}.`);
      },
      (error) => {
        const reason =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was declined."
            : "Your location could not be determined.";
        setGeoMessage(`${reason} Enter coordinates below instead.`);
        setAnnouncement(`${reason} Enter coordinates below instead.`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const useManualLocation = () => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setGeoMessage("Latitude must be a number between -90 and 90.");
      setAnnouncement("Latitude must be a number between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setGeoMessage("Longitude must be a number between -180 and 180.");
      setAnnouncement("Longitude must be a number between -180 and 180.");
      return;
    }
    setCoords({ lat, lng, source: "manual" });
    setGeoMessage(`Using entered coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}.`);
    setAnnouncement("Location set from the coordinates you entered.");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !coords) return;

    setStatus("preparing");
    setErrorMessage(null);
    setResult(null);
    setAnnouncement("Preparing the photo.");

    try {
      const { imageBase64, mediaType, note } = await prepareImage(file);
      setPrepNote(note ?? null);
      setStatus("analyzing");
      setAnnouncement("Analysing the photo. This usually takes a few seconds.");

      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64,
          mediaType,
          lat: coords.lat,
          lng: coords.lng,
          reporterId: reporterId(),
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (response.status === 201) {
        const created = body.report as Report;
        setResult(created);
        setStatus("success");
        setAnnouncement(
          `Report saved. ${created.ai_description ?? ""} It is now on the map and in the list.`,
        );
        onCreated(created);
        // Focus the outcome so a keyboard user lands on what changed.
        requestAnimationFrame(() => resultRef.current?.focus());
        return;
      }

      // Every failure below is phrased as what to do next, not as a status code.
      let message: string;
      if (body?.error === "not_accessibility_relevant") {
        message = `This photo is not of a public walkway, entrance, crossing, or transit access point, so nothing was saved. ${body.message ?? ""} Choose a different photo and try again.`;
      } else if (body?.error === "rate_limited") {
        message = `${body.message ?? "Too many reports for now."} Wait a moment, then submit again.`;
      } else if (body?.error === "upstream_rate_limited") {
        message =
          "The classification service is out of quota for now. Wait a minute, then submit again.";
      } else if (body?.error === "upstream_unavailable") {
        message =
          "The classification service is busy. This is temporary, so submitting again usually works.";
      } else if (body?.error === "safety_blocked") {
        message =
          "The classifier declined to process this photo. Choose a different photo of the obstacle.";
      } else if (response.status === 413) {
        message = "That photo is too large even after resizing. Try a smaller one.";
      } else if (response.status === 415) {
        message = "That file type is not supported. Use a JPEG, PNG, WebP, or HEIC photo.";
      } else {
        message = body?.message ?? "Something went wrong and the report was not saved.";
      }

      setErrorMessage(message);
      setStatus("error");
      setAnnouncement(message);
    } catch {
      const message = "The report could not be sent. Check your connection and try again.";
      setErrorMessage(message);
      setStatus("error");
      setAnnouncement(message);
    }
  };

  const reset = () => {
    pickFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.focus();
  };

  const busy = status === "preparing" || status === "analyzing";
  const canSubmit = Boolean(file && coords) && !busy;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-b border-line px-4 py-4">
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <div>
        <label htmlFor="report-photo" className="block text-sm font-semibold tracking-wide uppercase">
          Photo of the obstacle
        </label>
        <p id="report-photo-hint" className="mt-1 text-xs text-ink-muted">
          A walkway, entrance, crossing, or transit access point. Anything else is rejected
          and nothing is stored.
        </p>
        <input
          ref={fileInputRef}
          id="report-photo"
          name="photo"
          type="file"
          accept="image/*"
          capture="environment"
          aria-describedby="report-photo-hint"
          onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
          disabled={busy}
          className="mt-2 w-full border border-line px-2 py-1.5 text-sm"
        />
      </div>

      {previewUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element -- local object URL,
           nothing for the image optimizer to fetch or cache. */
        <img
          src={previewUrl}
          alt={result?.ai_description ?? (file ? `Selected photo, ${file.name}` : "Selected photo")}
          className="w-full border border-hairline object-cover"
          style={{ aspectRatio: "4 / 3" }}
        />
      ) : null}

      <fieldset>
        <legend className="text-sm font-semibold tracking-wide uppercase">Location</legend>
        <p className="mt-1 text-xs text-ink-muted">{geoMessage}</p>

        <button
          type="button"
          onClick={useDeviceLocation}
          disabled={busy}
          className="mt-2 border border-line px-2 py-1 text-xs"
        >
          Use my location
        </button>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <span className="flex flex-col">
            <label htmlFor="report-lat" className="text-xs text-ink-muted">
              Latitude
            </label>
            <input
              id="report-lat"
              inputMode="decimal"
              value={manualLat}
              onChange={(event) => setManualLat(event.target.value)}
              disabled={busy}
              className="w-28 border border-line px-2 py-1 text-sm"
            />
          </span>
          <span className="flex flex-col">
            <label htmlFor="report-lng" className="text-xs text-ink-muted">
              Longitude
            </label>
            <input
              id="report-lng"
              inputMode="decimal"
              value={manualLng}
              onChange={(event) => setManualLng(event.target.value)}
              disabled={busy}
              className="w-28 border border-line px-2 py-1 text-sm"
            />
          </span>
          <button
            type="button"
            onClick={useManualLocation}
            disabled={busy}
            className="border border-line px-2 py-1 text-xs"
          >
            Use these coordinates
          </button>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="border border-line px-3 py-1.5 text-sm disabled:text-ink-muted"
        >
          {busy ? "Working" : "Submit report"}
        </button>
        {!file || !coords ? (
          <span className="text-xs text-ink-muted">
            {!file && !coords
              ? "Add a photo and a location to submit."
              : !file
                ? "Add a photo to submit."
                : "Set a location to submit."}
          </span>
        ) : null}
      </div>

      {prepNote && busy ? <p className="text-xs text-ink-muted">{prepNote}</p> : null}

      {busy ? (
        <div className="border border-hairline">
          <p className="px-3 pt-3 text-sm text-ink-muted">
            {status === "preparing" ? "Preparing the photo" : "Analysing the photo"}
          </p>
          <ReportDetailSkeleton />
        </div>
      ) : null}

      {status === "error" && errorMessage ? (
        <div className="border border-line px-3 py-2">
          <p className="text-sm">Report not saved.</p>
          <p className="mt-1 text-xs text-ink-muted">{errorMessage}</p>
        </div>
      ) : null}

      {status === "success" && result ? (
        <div
          ref={resultRef}
          tabIndex={-1}
          data-focus-quiet
          className="border border-line px-3 py-3"
        >
          <h3 className="text-sm font-semibold tracking-wide uppercase">Report saved</h3>

          <dl className="mt-2 flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-xs tracking-wide text-ink-muted uppercase">Description</dt>
              <dd className="mt-0.5">{result.ai_description}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-ink-muted uppercase">Obstacle types</dt>
              <dd className="mt-0.5">
                {result.obstacle_types.map((type) => obstacleTypeLabel(type)).join(", ")}
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-ink-muted uppercase">
                Severity by profile
              </dt>
              <dd className="mt-0.5">
                <ul className="flex flex-col gap-1.5">
                  {PROFILES.map((profile) => (
                    <li key={profile.id} className="flex flex-wrap items-center gap-x-2">
                      <span className="font-medium">{profile.label}:</span>
                      <SeverityBadge score={severityFor(result, profile.id)} variant="full" />
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-ink-muted uppercase">Permanence</dt>
              <dd className="mt-0.5">
                {result.permanence === "permanent"
                  ? "Permanent, part of the built environment"
                  : `Temporary, expires ${result.expires_at ? new Date(result.expires_at).toLocaleDateString() : "in two weeks"}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-ink-muted uppercase">Model confidence</dt>
              <dd className="mt-0.5">{formatConfidence(result.ai_confidence)}</dd>
            </div>
          </dl>

          <button type="button" onClick={reset} className="mt-3 border border-line px-2 py-1 text-xs">
            Report another obstacle
          </button>
        </div>
      ) : null}
    </form>
  );
}
