/**
 * Manual check for the vision layer.
 *
 *   npx tsx scripts/test-vision.ts ./some-photo.jpg
 *
 * Reads GEMINI_API_KEY and optional GEMINI_MODEL_ID from .env.local.
 */

import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import {
  MODEL_ID,
  MissingFunctionCallError,
  RateLimitError,
  SafetyBlockError,
  SchemaMismatchError,
  VisionError,
  analyzeObstacle,
  type ObstacleAnalysis,
} from "../lib/vision";

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

/**
 * Minimal .env.local reader. Next.js loads env files itself, but tsx does not,
 * and pulling in a dependency for six lines is not worth it.
 */
async function loadEnvLocal(): Promise<void> {
  let text: string;
  try {
    text = await readFile(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    const value = rawValue.trim().replace(/^["'](.*)["']$/, "$1");
    if (value !== "") process.env[key] = value;
  }
}

function render(analysis: ObstacleAnalysis): string {
  const bar = (score: number) => `${score} ${"".padEnd(score, "#").padEnd(3, ".")}`;
  return [
    `relevant to accessibility : ${analysis.is_accessibility_relevant ? "yes" : "no"}`,
    `obstacle types           : ${analysis.obstacle_types.join(", ")}`,
    `permanence               : ${analysis.permanence}`,
    `confidence               : ${analysis.confidence.toFixed(2)}`,
    "severity (0 none, 1 minor, 2 difficult, 3 impassable)",
    `  wheelchair             : ${bar(analysis.severity.wheelchair)}`,
    `  blind                  : ${bar(analysis.severity.blind)}`,
    `  low vision             : ${bar(analysis.severity.low_vision)}`,
    `  walker                 : ${bar(analysis.severity.walker)}`,
    "description",
    `  ${analysis.description}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npx tsx scripts/test-vision.ts <path-to-image>");
    process.exitCode = 2;
    return;
  }

  await loadEnvLocal();

  const absolute = resolve(process.cwd(), inputPath);
  const extension = extname(absolute).toLowerCase();
  const mediaType = MEDIA_TYPES[extension];
  if (!mediaType) {
    console.error(
      `Unsupported extension ${extension || "(none)"}. Supported: ${Object.keys(MEDIA_TYPES).join(", ")}`,
    );
    process.exitCode = 2;
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    console.error(`Cannot read ${absolute}: ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }

  const kb = (bytes.byteLength / 1024).toFixed(0);
  console.log(`file  : ${absolute}`);
  console.log(`type  : ${mediaType} (${kb} KB)`);
  console.log(`model : ${MODEL_ID}`);
  console.log("");

  const startedAt = process.hrtime.bigint();
  try {
    const analysis = await analyzeObstacle(bytes.toString("base64"), mediaType);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    console.log(render(analysis));
    console.log("");
    console.log(`took  : ${elapsedMs.toFixed(0)} ms`);
    console.log("");
    console.log("raw JSON");
    console.log(JSON.stringify(analysis, null, 2));
  } catch (error) {
    process.exitCode = 1;

    if (error instanceof RateLimitError) {
      console.error(
        `Rate limited. ${error.message}${
          error.retryAfterSeconds ? ` Retry after ${error.retryAfterSeconds}s.` : ""
        }`,
      );
      return;
    }
    if (error instanceof SafetyBlockError) {
      console.error(`Safety block (${error.reason}). ${error.message}`);
      return;
    }
    if (error instanceof SchemaMismatchError) {
      console.error(`Schema mismatch. ${error.message}`);
      if (error.received !== undefined) {
        console.error(JSON.stringify(error.received, null, 2));
      }
      return;
    }
    if (error instanceof MissingFunctionCallError) {
      console.error(`No function call. ${error.message}`);
      return;
    }
    if (error instanceof VisionError) {
      console.error(`${error.name}. ${error.message}`);
      return;
    }
    throw error;
  }
}

void main();
