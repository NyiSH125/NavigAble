/**
 * Obstacle classification.
 *
 * The provider lives entirely inside this file. Callers import only
 * `analyzeObstacle`, the `ObstacleAnalysis` type, and the error classes, all of
 * which are provider-agnostic. Swapping Gemini for another model means editing
 * this file and nothing else.
 */

import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type FunctionDeclaration,
} from "@google/genai";

// Model id. Never hardcode a guessed version string: this default is the
// current Flash model id from Google AI Studio, and it is overridable per
// environment.
const DEFAULT_MODEL_ID = "gemini-3.7-flash";

export const MODEL_ID = process.env.GEMINI_MODEL_ID || DEFAULT_MODEL_ID;

/**
 * Tried once if the primary model is still refusing after its retries.
 *
 * The Flash models share a quota but not a load queue, and the primary returns
 * 503 "high demand" in bursts that can outlast a few seconds of backoff. Both ids
 * come from the current model list, not from memory. Set GEMINI_FALLBACK_MODEL_ID
 * to an empty string to disable.
 */
const DEFAULT_FALLBACK_MODEL_ID = "gemini-3.5-flash";

export const FALLBACK_MODEL_ID =
  process.env.GEMINI_FALLBACK_MODEL_ID ?? DEFAULT_FALLBACK_MODEL_ID;

const FUNCTION_NAME = "record_obstacle";

// Structured-output calls need headroom. Part of this budget is spent on
// internal reasoning, and a tight limit truncates the function call so the
// failure looks like malformed output rather than truncation.
const MAX_OUTPUT_TOKENS = 4096;

// Provider-agnostic types ---------------------------------------------------

// The domain vocabulary lives in lib/obstacles.ts so client components can use
// it without importing a provider SDK. Re-exported here so callers of this
// module keep a single import site.
import {
  OBSTACLE_TYPES,
  PERMANENCE_VALUES,
  SEVERITY_PROFILES,
  type ObstacleType,
  type Permanence,
  type SeverityByProfile,
  type SeverityScore,
} from "./obstacles";

export {
  OBSTACLE_TYPES,
  PERMANENCE_VALUES,
  SEVERITY_PROFILES,
  type ObstacleType,
  type Permanence,
  type SeverityByProfile,
  type SeverityProfile,
  type SeverityScore,
} from "./obstacles";

export interface ObstacleAnalysis {
  is_accessibility_relevant: boolean;
  obstacle_types: ObstacleType[];
  severity: SeverityByProfile;
  permanence: Permanence;
  /** One plain sentence written for the affected person. */
  description: string;
  /** 0..1 */
  confidence: number;
}

// Errors --------------------------------------------------------------------

/** Base class so callers can catch every vision failure with one clause. */
export class VisionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Provider quota exhausted (HTTP 429). Batch jobs should back off and resume
 * rather than dying, so this is typed separately.
 */
export class RateLimitError extends VisionError {
  /** Seconds to wait before retrying, when the provider supplies a hint. */
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    retryAfterSeconds?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The provider is temporarily unavailable or overloaded (HTTP 503, 500, 504).
 * Retryable on the same input, unlike the other failures here, so batch jobs
 * should retry with backoff rather than dropping the row.
 */
export class TransientUpstreamError extends VisionError {
  readonly status?: number;

  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
  }
}

/**
 * The prompt or the image tripped a safety filter. This arrives as a normal
 * HTTP 200 with empty or partial content, so it has to be detected before
 * reading the result.
 */
export class SafetyBlockError extends VisionError {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? `Vision request blocked by a safety filter (${reason}).`);
    this.reason = reason;
  }
}

/** The model answered without emitting the forced function call. */
export class MissingFunctionCallError extends VisionError {}

/** The function call arrived but its arguments do not match the schema. */
export class SchemaMismatchError extends VisionError {
  readonly issues: string[];
  readonly received?: unknown;

  constructor(issues: string[], received?: unknown) {
    super(`Vision result failed schema validation: ${issues.join("; ")}`);
    this.issues = issues;
    this.received = received;
  }
}

/** Configuration problem, such as a missing API key or an unusable image. */
export class VisionConfigError extends VisionError {}

// Prompt --------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `You classify photographs of the pedestrian environment for an accessibility obstacle map. Your output is read by disabled people deciding whether they can use a route.

Severity scale. Use exactly these four values:
0 = no impact. The person passes normally.
1 = minor inconvenience. Passable, but slower, more effortful, or unpleasant.
2 = difficult and possibly unsafe. Passable only with significant effort, help, or risk of injury.
3 = impassable. The person cannot get through at all.

Score each profile independently. A single obstacle does not affect every profile equally, and the four numbers are frequently different. Judge each one on its own:
- wheelchair: a person using a manual or powered wheelchair. Steps, high curbs, soft or broken surfaces, steep grades, and narrow gaps matter most. Missing tactile paving is usually 0.
- blind: a person who is blind and navigates by cane and by tactile and audible cues. Missing tactile paving, unmarked level changes, head-height hazards, and unpredictable temporary obstructions matter most. A single step alone is often 1 rather than 3.
- low_vision: a person with usable but reduced vision. Low contrast edges, poor lighting, unmarked steps, and visually camouflaged hazards matter most.
- walker: a person using a walker, rollator, cane, or crutches, who can manage a small step but tires quickly and falls easily. Missing handrails, uneven surfaces, and long detours matter most.

Set is_accessibility_relevant to false for any image that is not of a public walkway, entrance, crossing, or transit access point. Indoor private rooms, food, people, pets, screenshots, documents, vehicles, landscapes, and general scenery are all false. When it is false, set every severity to 0, set obstacle_types to ["none"], and say in one sentence what the image shows instead.

Report only what is visible in the image. Do not infer obstacles that are plausible but not shown. If the relevant ground surface is not visible, say so and lower your confidence.

Use "none" in obstacle_types only when the scene is a walkway, entrance, crossing, or transit access point with no obstacle present, and never alongside another value.

The description is one plain sentence addressed to the affected person, stating what is there and what it means for getting through. No em dashes. No lists. No hedging preamble.

confidence is your own certainty in this classification, from 0 to 1.`;

const USER_PROMPT = `Classify this photograph. Call ${FUNCTION_NAME} exactly once with your classification.`;

// Provider schema -----------------------------------------------------------

const severityProperty = (profile: string) => ({
  type: Type.INTEGER,
  minimum: 0,
  maximum: 3,
  description: `Severity for the ${profile} profile, 0 to 3.`,
});

const recordObstacle: FunctionDeclaration = {
  name: FUNCTION_NAME,
  description:
    "Record the accessibility classification of a single photograph of the pedestrian environment.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      is_accessibility_relevant: {
        type: Type.BOOLEAN,
        description:
          "True only if the image shows a public walkway, entrance, crossing, or transit access point.",
      },
      obstacle_types: {
        type: Type.ARRAY,
        description:
          'Every obstacle visible in the image. Use ["none"] if there is no obstacle.',
        items: {
          type: Type.STRING,
          enum: [...OBSTACLE_TYPES],
        },
      },
      severity: {
        type: Type.OBJECT,
        description: "Independent severity score per disability profile.",
        properties: {
          wheelchair: severityProperty("wheelchair"),
          blind: severityProperty("blind"),
          low_vision: severityProperty("low vision"),
          walker: severityProperty("walker"),
        },
        required: [...SEVERITY_PROFILES],
      },
      permanence: {
        type: Type.STRING,
        enum: [...PERMANENCE_VALUES],
        description:
          "permanent for built infrastructure, temporary for obstructions that will clear.",
      },
      description: {
        type: Type.STRING,
        description:
          "One plain sentence addressed to the affected person. No em dashes.",
      },
      confidence: {
        type: Type.NUMBER,
        minimum: 0,
        maximum: 1,
        description: "Certainty in this classification, 0 to 1.",
      },
    },
    required: [
      "is_accessibility_relevant",
      "obstacle_types",
      "severity",
      "permanence",
      "description",
      "confidence",
    ],
  },
};

// Validation ----------------------------------------------------------------

const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export function isSupportedMediaType(mediaType: string): boolean {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(
    mediaType.toLowerCase(),
  );
}

/**
 * Validates the model's arguments against the schema. The provider enforces the
 * overall shape, but enum membership and numeric bounds are advisory there, so
 * they are re-checked before the value is handed to a caller as ObstacleAnalysis.
 */
function validate(raw: unknown): ObstacleAnalysis {
  const issues: string[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SchemaMismatchError(["result is not an object"], raw);
  }
  const value = raw as Record<string, unknown>;

  if (typeof value.is_accessibility_relevant !== "boolean") {
    issues.push("is_accessibility_relevant is not a boolean");
  }

  const types: ObstacleType[] = [];
  if (!Array.isArray(value.obstacle_types)) {
    issues.push("obstacle_types is not an array");
  } else {
    for (const entry of value.obstacle_types) {
      if (
        typeof entry !== "string" ||
        !(OBSTACLE_TYPES as readonly string[]).includes(entry)
      ) {
        issues.push(
          `obstacle_types contains an unknown value ${JSON.stringify(entry)}`,
        );
        continue;
      }
      if (!types.includes(entry as ObstacleType)) types.push(entry as ObstacleType);
    }
  }

  const severity: Partial<SeverityByProfile> = {};
  const rawSeverity = value.severity;
  if (
    rawSeverity === null ||
    typeof rawSeverity !== "object" ||
    Array.isArray(rawSeverity)
  ) {
    issues.push("severity is not an object");
  } else {
    for (const profile of SEVERITY_PROFILES) {
      const score = (rawSeverity as Record<string, unknown>)[profile];
      if (
        typeof score !== "number" ||
        !Number.isInteger(score) ||
        score < 0 ||
        score > 3
      ) {
        issues.push(`severity.${profile} is not an integer 0 to 3`);
        continue;
      }
      severity[profile] = score as SeverityScore;
    }
  }

  if (
    typeof value.permanence !== "string" ||
    !(PERMANENCE_VALUES as readonly string[]).includes(value.permanence)
  ) {
    issues.push("permanence is not one of permanent, temporary");
  }

  if (typeof value.description !== "string" || value.description.trim() === "") {
    issues.push("description is missing or empty");
  }

  if (
    typeof value.confidence !== "number" ||
    Number.isNaN(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    issues.push("confidence is not a number 0 to 1");
  }

  if (issues.length > 0) throw new SchemaMismatchError(issues, raw);

  return {
    is_accessibility_relevant: value.is_accessibility_relevant as boolean,
    obstacle_types: types.length > 0 ? types : ["none"],
    severity: severity as SeverityByProfile,
    permanence: value.permanence as Permanence,
    description: (value.description as string).trim(),
    confidence: value.confidence as number,
  };
}

// Provider plumbing ---------------------------------------------------------

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new VisionConfigError(
        "Missing GEMINI_API_KEY. Set it in .env.local. Keys come from https://aistudio.google.com/apikey",
      );
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const SAFETY_FINISH_REASONS = [
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
];

function retryAfterFromError(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error);
  const match = /retry(?:[-\s_])?(?:after|delay)\D{0,12}?(\d+(?:\.\d+)?)\s*s/i.exec(
    text,
  );
  return match ? Math.ceil(Number(match[1])) : undefined;
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; code?: unknown };
    if (typeof candidate.status === "number") return candidate.status;
    if (typeof candidate.code === "number") return candidate.code;
  }
  return undefined;
}

function translateError(error: unknown, model: string = MODEL_ID): never {
  const status = statusOf(error);
  const text = error instanceof Error ? error.message : String(error);

  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) {
    throw new RateLimitError(
      `Gemini quota exhausted for ${model}. Back off and resume.`,
      retryAfterFromError(error),
      { cause: error },
    );
  }

  // Model overload and gateway failures are retryable on the same input.
  if (
    status === 503 ||
    status === 500 ||
    status === 504 ||
    /UNAVAILABLE|high demand|overloaded|INTERNAL|DEADLINE_EXCEEDED/i.test(text)
  ) {
    throw new TransientUpstreamError(
      `Gemini is temporarily unavailable for ${model}. Retry with backoff.`,
      status,
      { cause: error },
    );
  }

  throw new VisionError(`Gemini request failed: ${text}`, { cause: error });
}

// Public entry point --------------------------------------------------------

export interface AnalyzeObstacleOptions {
  /** Aborts the provider call. */
  signal?: AbortSignal;
  /**
   * Extra attempts after a retryable provider failure. Only overload (503, 500,
   * 504) is retried: quota will not clear in seconds, and a safety block or a
   * schema mismatch will not change on the same input.
   */
  retries?: number;
}

/** Backoff before each retry, in milliseconds. */
const RETRY_DELAYS_MS = [900, 2400, 5000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Classifies one photograph of the pedestrian environment.
 *
 * @param imageBase64 Base64-encoded image bytes, with or without a data: URL prefix.
 * @param mediaType   IANA media type, for example image/jpeg.
 * @throws RateLimitError on provider quota exhaustion (429).
 * @throws TransientUpstreamError on provider overload (503, 500, 504). Retryable.
 * @throws SafetyBlockError when the prompt or the image is blocked.
 * @throws MissingFunctionCallError when the model skips the forced call.
 * @throws SchemaMismatchError when the returned arguments do not validate.
 */
export async function analyzeObstacle(
  imageBase64: string,
  mediaType: string,
  options: AnalyzeObstacleOptions = {},
): Promise<ObstacleAnalysis> {
  const retries = options.retries ?? 2;

  // The primary model, then one shot at the fallback. A burst of overload on the
  // newest Flash model should not be the reason a report cannot be filed.
  const plan: string[] = Array.from({ length: retries + 1 }, () => MODEL_ID);
  if (FALLBACK_MODEL_ID && FALLBACK_MODEL_ID !== MODEL_ID) plan.push(FALLBACK_MODEL_ID);

  for (let attempt = 0; attempt < plan.length; attempt += 1) {
    const model = plan[attempt];
    try {
      return await analyzeOnce(imageBase64, mediaType, options, model);
    } catch (error) {
      const retryable =
        error instanceof TransientUpstreamError || error instanceof RateLimitError;
      const last = attempt === plan.length - 1;
      if (!retryable || last) throw error;

      const next = plan[attempt + 1];
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      console.warn(
        next === model
          ? `[vision] ${model} unavailable, retrying in ${delay}ms`
          : `[vision] ${model} still unavailable, falling back to ${next}`,
      );
      await sleep(delay);
      if (options.signal?.aborted) throw error;
    }
  }

  // Unreachable: the loop either returns or throws on its last attempt.
  throw new VisionError("Vision request exhausted every model.");
}

async function analyzeOnce(
  imageBase64: string,
  mediaType: string,
  options: AnalyzeObstacleOptions,
  model: string = MODEL_ID,
): Promise<ObstacleAnalysis> {
  const data = imageBase64.replace(/^data:[^;,]+;base64,/, "").trim();
  if (data === "") {
    throw new VisionConfigError("imageBase64 is empty.");
  }
  if (!isSupportedMediaType(mediaType)) {
    throw new VisionConfigError(
      `Unsupported mediaType ${mediaType}. Supported: ${SUPPORTED_MEDIA_TYPES.join(", ")}.`,
    );
  }

  const ai = getClient();

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data, mimeType: mediaType } },
            { text: USER_PROMPT },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Forced function call. The structured result is never parsed out of prose.
        tools: [{ functionDeclarations: [recordObstacle] }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [FUNCTION_NAME],
          },
        },
        // This is the high-volume classifier, so keep reasoning cheap. LOW is
        // the floor on the current Flash model, which rejects MINIMAL.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: options.signal,
      },
    });
  } catch (error) {
    translateError(error, model);
  }

  // A blocked prompt returns HTTP 200 with no candidates, so check the block
  // signal and the finish reason before touching the content.
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new SafetyBlockError(
      String(blockReason),
      `Gemini blocked the prompt (${blockReason}).`,
    );
  }

  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new MissingFunctionCallError("Gemini returned no candidates.");
  }

  const finishReason = candidate.finishReason
    ? String(candidate.finishReason)
    : undefined;
  if (finishReason && SAFETY_FINISH_REASONS.includes(finishReason)) {
    throw new SafetyBlockError(finishReason, `Gemini stopped on ${finishReason}.`);
  }
  if (finishReason === "MAX_TOKENS") {
    throw new VisionError(
      `Gemini hit the ${MAX_OUTPUT_TOKENS} token output limit before completing the function call. Raise MAX_OUTPUT_TOKENS in lib/vision.ts.`,
    );
  }
  if (finishReason === "MALFORMED_FUNCTION_CALL") {
    throw new SchemaMismatchError([
      "provider reported a malformed function call",
    ]);
  }

  const call = response.functionCalls?.find((fc) => fc.name === FUNCTION_NAME);
  if (!call) {
    const seen = (response.functionCalls ?? [])
      .map((fc) => fc.name)
      .filter((name): name is string => Boolean(name));
    throw new MissingFunctionCallError(
      seen.length > 0
        ? `Gemini called ${seen.join(", ")} instead of ${FUNCTION_NAME}.`
        : `Gemini answered without calling ${FUNCTION_NAME} (finish reason ${finishReason ?? "unknown"}).`,
    );
  }
  if (!call.args) {
    throw new SchemaMismatchError(["function call carried no arguments"]);
  }

  return validate(call.args);
}
