/**
 * «VIDEO YARATISH» (program-17 item 5, video part) -- the catalogue and the input normalizer.
 *
 * Client-safe on purpose (no node, no server imports): the composer, the price formula in `lib/tools.ts`, the
 * request builders (`adapters/*`), the engine, the route and the admin ladder all read THIS file, so a provider,
 * its allowed durations and its price per second exist in exactly one place.
 *
 *   id          the value of the form param `provider`;
 *   registryId  the provider registry id (`lib/server/providers/registry.ts`) whose key + switch decide availability;
 *   seconds     the clip lengths the provider offers (the form shows exactly these);
 *   soumPerSecond  the BASE price of one second (the admin «Narxlar» page adjusts the tool through `tool_pricing`).
 *
 * PRICES ARE A PRODUCT DECISION FLAGGED FOR THE OWNER (defaults from the program-17 brief):
 *   - veo   3 000 so'm / s. The provider bills Gemini Omni Flash at $17.50 per 1M output tokens, 5 792 tokens per
 *           second of 720p video = about $0.10 / s (https://ai.google.dev/gemini-api/docs/pricing, 2026-10-24),
 *           i.e. ~1 270 so'm / s at 12 700 so'm per USD: the default is ~2.4x the cost.
 *   - kling 2 000 / s. Kling's own price list could not be read (the developer site is a JS app). Third-party guides
 *           put the API at roughly $0.07-0.14 per second (std mode, 5 s clip about $0.28-0.70 depending on the model),
 *           i.e. ~900-1 800 so'm / s at 12 700: the 2 000 default covers only ~1.1x of the top of that range. UNVERIFIED --
 *           check the account's real per-second cost on the first key before selling (the admin «Narxlar» % moves it).
 *
 * Every option here changes the provider request (`adapters/*.buildRequest`) or the price; `lib/generation/video-params.ts`
 * declares the same set and `tests/video-params.test.mts` proves it with a differential probe ("every param must work").
 */

export const VIDEO_PROVIDERS = [
  {
    id: "veo",
    registryId: "veo",
    label: "Google Veo (Gemini)",
    short: "Veo",
    seconds: [5, 8],
    soumPerSecond: 3000,
  },
  {
    id: "kling",
    registryId: "kling",
    label: "Kling AI",
    short: "Kling",
    seconds: [5, 10],
    soumPerSecond: 2000,
  },
] as const;

export type VideoProviderId = (typeof VIDEO_PROVIDERS)[number]["id"];
export const VIDEO_PROVIDER_IDS: readonly VideoProviderId[] = VIDEO_PROVIDERS.map((p) => p.id);
export const DEFAULT_VIDEO_PROVIDER: VideoProviderId = "veo";

export const VIDEO_ASPECTS = ["16:9", "9:16"] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];
export const DEFAULT_VIDEO_ASPECT: VideoAspect = "16:9";

/** The prompt must say something, and must not be a novel (both providers cut long prompts). */
export const VIDEO_PROMPT_MIN = 5;
export const VIDEO_PROMPT_MAX = 1000;

/** How long (ms) an operation may stay with the provider before the job fails and is refunded. */
export const VIDEO_OP_DEADLINE_MS = 20 * 60_000;

export function isVideoProviderId(v: unknown): v is VideoProviderId {
  return typeof v === "string" && (VIDEO_PROVIDER_IDS as readonly string[]).includes(v);
}

export function videoProviderById(id: string) {
  return VIDEO_PROVIDERS.find((p) => p.id === id) ?? VIDEO_PROVIDERS[0];
}

export type VideoInput = {
  provider: VideoProviderId;
  prompt: string;
  /** Always one of `videoProviderById(provider).seconds`. */
  seconds: number;
  aspect: VideoAspect;
  /** `photo_uploads.asset_id` of the optional start image ("" = text to video). */
  imageAssetId: string;
};

/**
 * The ONE normalizer: the form, the price, the budget, the request builders and the worker all read the form values
 * through it. An absent / unknown `provider` is NOT silently mapped on the server (`videoParamsError` rejects it before
 * anything is charged); here it falls back to the default only so the pure functions never throw.
 */
export function videoInputFromValues(values: Record<string, unknown>): VideoInput {
  const rawProvider = typeof values.provider === "string" ? values.provider.trim() : "";
  const provider = isVideoProviderId(rawProvider) ? rawProvider : DEFAULT_VIDEO_PROVIDER;
  const spec = videoProviderById(provider);
  const sec = Number(values.seconds);
  const seconds = (spec.seconds as readonly number[]).includes(sec) ? sec : spec.seconds[0];
  const aspect = values.aspect === "9:16" ? "9:16" : DEFAULT_VIDEO_ASPECT;
  const image = String(values.imageAssetId ?? "").trim().toLowerCase();
  return {
    provider,
    prompt: String(values.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, VIDEO_PROMPT_MAX),
    seconds,
    aspect,
    imageAssetId: /^[0-9a-f]{24}$/.test(image) ? image : "",
  };
}

export function encodeVideoValues(input: VideoInput): Record<string, string | number> {
  return { provider: input.provider, prompt: input.prompt, seconds: input.seconds, aspect: input.aspect, imageAssetId: input.imageAssetId };
}

/** Price of one video: the provider's base price per second x the clip length. */
export function videoPrice(values: Record<string, unknown>): number {
  const input = videoInputFromValues(values);
  return videoProviderById(input.provider).soumPerSecond * input.seconds;
}

/** Message for a request the server must refuse before charging (Uzbek, for a 400), `null` when it is fine. */
export function videoParamsError(values: Record<string, unknown>): string | null {
  const raw = values.provider;
  if (raw !== undefined && raw !== null && raw !== "" && !isVideoProviderId(typeof raw === "string" ? raw.trim() : raw)) {
    return "Noma'lum video provayderi";
  }
  const rawImage = String(values.imageAssetId ?? "").trim();
  if (rawImage && !/^[0-9a-f]{24}$/i.test(rawImage)) return "Boshlang'ich surat identifikatori noto'g'ri";
  const input = videoInputFromValues(values);
  if (input.prompt.length < VIDEO_PROMPT_MIN) return "Videoda nima bo'lishini yozing (kamida 5 ta belgi)";
  const sec = values.seconds;
  if (sec !== undefined && sec !== null && sec !== "" && !(videoProviderById(input.provider).seconds as readonly number[]).includes(Number(sec))) {
    return `Bu provayder uchun davomiylik: ${videoProviderById(input.provider).seconds.join(" yoki ")} soniya`;
  }
  return null;
}

/** Providers the form may offer, given the server's list (`features.videoProviders`). Absent = none (the tool is hidden). */
export function offeredVideoProviders(available: readonly string[] | null | undefined): VideoProviderId[] {
  if (!available) return [];
  return VIDEO_PROVIDER_IDS.filter((id) => available.includes(id));
}
