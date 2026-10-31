/**
 * AI provider registry (program-17 decision D7, docs/program-17/PLAN.md phase C) -- the ONE list of every
 * provider API key the product reads or will read.
 *
 * Pure data, no secrets, no I/O: the generation layer (isomorphic, no `server-only`), the key resolver
 * (`resolve.ts`), the store, the admin API and the admin page all read it, so a provider is declared once.
 *
 *   id          stable key of the `provider_settings` row and of the audit `targetId`.
 *   label       Uzbek name for the admin page.
 *   kinds       what the key is used for (an LLM adapter, an image source, text-to-speech, video, research).
 *   envKeys     fallback environment variables, first non-empty wins. This is also how the product ran
 *               before the store existed, so with no `provider_settings` rows nothing changes.
 *   keyHint     what a key of this provider looks like (a prefix hint for the admin, never validated strictly).
 *   implemented the adapter exists in code. `false` = reserved: the key can be stored, the page says «tez orada»
 *               and nothing reads it yet.
 *   testable    the admin «Tekshirish» button has a cheap live call for it (`probe.ts`).
 *
 * `tests/provider-keys.test.mts` pins this list against the env variables the code reads.
 */

export type ProviderKind = "llm" | "image" | "tts" | "video" | "research";

export type ProviderDef = {
  id: string;
  label: string;
  kinds: readonly ProviderKind[];
  envKeys: readonly string[];
  keyHint: string;
  implemented: boolean;
  testable: boolean;
};

export const PROVIDERS = [
  { id: "gemini", label: "Google Gemini", kinds: ["llm", "image", "tts"], envKeys: ["GEMINI_API_KEY"], keyHint: "AIza… (39 belgi)", implemented: true, testable: true },
  { id: "anthropic", label: "Anthropic (Claude)", kinds: ["llm"], envKeys: ["ANTHROPIC_API_KEY"], keyHint: "sk-ant-…", implemented: true, testable: true },
  { id: "pexels", label: "Pexels", kinds: ["image"], envKeys: ["PEXELS_API_KEY"], keyHint: "56 belgili kalit", implemented: true, testable: true },
  { id: "pixabay", label: "Pixabay", kinds: ["image"], envKeys: ["PIXABAY_API_KEY"], keyHint: "12345678-abcdef…", implemented: true, testable: true },
  { id: "azure", label: "Azure Speech", kinds: ["tts"], envKeys: ["AZURE_SPEECH_KEY"], keyHint: "32 ta hex belgi (region AZURE_SPEECH_REGION muhitida)", implemented: true, testable: true },
  { id: "aisha", label: "Aisha (o'zbekcha ovoz)", kinds: ["tts"], envKeys: ["AISHA_API_KEY"], keyHint: "Aisha kaliti", implemented: true, testable: false },
  { id: "openalex", label: "OpenAlex", kinds: ["research"], envKeys: ["OPENALEX_API_KEY"], keyHint: "OpenAlex kaliti", implemented: true, testable: true },
  { id: "googlebooks", label: "Google Books", kinds: ["research"], envKeys: ["GOOGLE_BOOKS_API_KEY"], keyHint: "AIza…", implemented: true, testable: true },
  // `openai-image`: «ChatGPT» choice of the `rasm` tool (image-provider-openai.ts); the only OpenAI use (no OpenAI text provider).
  { id: "openai-image", label: "OpenAI (rasm)", kinds: ["image"], envKeys: ["OPENAI_API_KEY"], keyHint: "sk-…", implemented: true, testable: false },
  // Video (lib/generation/video/): `veo` runs on Gemini Omni Flash through the Interactions API (Google shut the Veo REST
  // models down in the Gemini API on 2026-10-22, see omni.ts), so it shares the Gemini key; `kling` signs a JWT, so its
  // one secret is stored as `<accessKey>:<secretKey>`.
  { id: "veo", label: "Google Veo (video)", kinds: ["video"], envKeys: ["GEMINI_API_KEY"], keyHint: "AIza… (Gemini kaliti)", implemented: true, testable: false },
  { id: "kling", label: "Kling (video)", kinds: ["video"], envKeys: ["KLING_API_KEY"], keyHint: "<accessKey>:<secretKey>", implemented: true, testable: false },
  // ElevenLabs: the «Premium ovoz» of podcast / greeting (lib/generation/tts/elevenlabs.ts); never part of the default chain.
  { id: "elevenlabs", label: "ElevenLabs (ovoz)", kinds: ["tts"], envKeys: ["ELEVENLABS_API_KEY"], keyHint: "sk_…", implemented: true, testable: false },
] as const satisfies readonly ProviderDef[];

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export const PROVIDER_IDS: readonly ProviderId[] = PROVIDERS.map((p) => p.id);

const BY_ID: ReadonlyMap<string, ProviderDef> = new Map(PROVIDERS.map((p) => [p.id, p]));

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && BY_ID.has(v);
}

export function providerDef(id: string): ProviderDef | null {
  return BY_ID.get(id) ?? null;
}

/** Every provider that serves `kind`. */
export function providersOfKind(kind: ProviderKind): readonly ProviderDef[] {
  return PROVIDERS.filter((p) => (p.kinds as readonly ProviderKind[]).includes(kind));
}

/** Stored key shape: one printable-ASCII token. Providers differ, so only sanity is checked (the page shows a hint). */
export const KEY_MIN_LEN = 8;
export const KEY_MAX_LEN = 512;

export function isPlausibleKey(v: unknown): v is string {
  return typeof v === "string" && v.length >= KEY_MIN_LEN && v.length <= KEY_MAX_LEN && /^[\x21-\x7e]+$/.test(v);
}

/** `…a1B2`: the only form of a stored key that ever leaves the store. */
export function keyHintOf(key: string): string {
  return `…${key.slice(-4)}`;
}
