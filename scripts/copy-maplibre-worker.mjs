/**
 * Copies MapLibre's worker bundle into public/maplibre/.
 *
 * Why this exists: MapLibre 6 spawns its worker with
 * `new Worker(url, { type: "module" })`, and under Next's bundler that URL
 * resolves to the app root, so the browser gets HTML back, refuses it for MIME
 * reasons, and the worker never starts. A map with no worker creates its canvas
 * and then silently never loads a style, which looks like a blank map with no
 * error. Serving the worker ourselves and pointing setWorkerUrl at it avoids
 * the resolution entirely.
 *
 * The worker imports ./maplibre-gl-shared.mjs relatively, so both files have to
 * land in the same directory.
 *
 * Runs from predev and prebuild, so an upgrade of maplibre-gl cannot leave a
 * stale worker behind.
 */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const from = join(root, "node_modules", "maplibre-gl", "dist");
const to = join(root, "public", "maplibre");

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const version = JSON.parse(
  await readFile(join(root, "node_modules", "maplibre-gl", "package.json"), "utf8"),
).version;

await mkdir(to, { recursive: true });
for (const file of FILES) {
  await copyFile(join(from, file), join(to, file));
}

console.log(`maplibre worker: copied ${FILES.length} files for v${version} to public/maplibre/`);
