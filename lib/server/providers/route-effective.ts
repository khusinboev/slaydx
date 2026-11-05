import { isLlmProviderId, isOpenAiCompatId, parseRoleSpec, type RoleSpec } from "../../generation/llm/types";
import { getProviderKey } from "./resolve";
import { getRoute } from "./route-resolve";
import type { RouteEntry, RouteId } from "./routes";

/**
 * The value each routing slot has RIGHT NOW, and where it comes from: the admin's stored choice (`db`), the
 * `LLM_*` / `GEMINI_*` environment variable (`env`, how the product ran before the page existed) or the built-in
 * default. The generation layer reads its model and chain through here, and the admin page shows the same result, so
 * what the page says is what the product does.
 *
 * Isomorphic and synchronous (no `server-only`, no database): the snapshot comes from `route-resolve.ts`.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-lite-image";
/** «Test ishlash» wrong-answer analysis (owner 2026-10-31): the strongest priced Gemini, it must read a math image. */
export const DEFAULT_TESTS_ANALYSIS_MODEL = "gemini-3.1-pro";
/** Voice providers in the order the standard chain tries them (`tts/types.ts` tables list Azure, then Aisha, then Gemini). */
export const DEFAULT_TTS_ORDER = ["azure", "aisha", "gemini"] as const;

/**
 * What follows Gemini in the default text chain (owner decision 2026-11-05, docs/ops/LLM-FALLBACK.md): Qwen first as the
 * most multilingual, DeepSeek as the cheap second. A provider with no key is dropped from the chain, so without keys
 * the product runs exactly as before.
 */
export const DEFAULT_TEXT_FALLBACKS: readonly RouteEntry[] = [
  { provider: "qwen", model: "qwen3.7-plus" },
  { provider: "deepseek", model: "deepseek-flash" },
];

export type RouteSource = "db" | "env" | "default";
export type EffectiveRoute = { source: RouteSource; entries: RouteEntry[] };

const LLM_ROLE_ENV: Record<string, string> = {
  "llm.writer": "LLM_WRITER",
  "llm.researcher": "LLM_RESEARCHER",
  "llm.judge": "LLM_JUDGE",
  "llm.fast": "LLM_FAST",
};

function modelOf(entries: readonly RouteEntry[] | null): string | null {
  return entries?.[0]?.model ?? null;
}

/** The effective entries of `id`. Never empty: a slot always has a default. */
export function effectiveRoute(id: RouteId, env: NodeJS.ProcessEnv = process.env, opts: { ignoreStored?: boolean } = {}): EffectiveRoute {
  const stored = opts.ignoreStored ? null : getRoute(id);
  if (stored && stored.length > 0) return { source: "db", entries: [...stored] };

  switch (id) {
    case "llm.model": {
      const fromEnv = env.GEMINI_MODEL?.trim();
      return fromEnv
        ? { source: "env", entries: [{ provider: "gemini", model: fromEnv }] }
        : { source: "default", entries: [{ provider: "gemini", model: DEFAULT_GEMINI_MODEL }] };
    }
    case "llm.chain":
      return { source: "default", entries: [{ provider: "gemini", model: modelOf(effectiveRoute("llm.model", env, opts).entries) ?? DEFAULT_GEMINI_MODEL }, ...DEFAULT_TEXT_FALLBACKS] };
    case "image.gemini": {
      const fromEnv = env.GEMINI_IMAGE_MODEL?.trim();
      return fromEnv
        ? { source: "env", entries: [{ provider: "gemini", model: fromEnv }] }
        : { source: "default", entries: [{ provider: "gemini", model: DEFAULT_GEMINI_IMAGE_MODEL }] };
    }
    case "tests.analysis":
      // No env variable: the slot is new, the admin's choice or the default.
      return { source: "default", entries: [{ provider: "gemini", model: DEFAULT_TESTS_ANALYSIS_MODEL }] };
    case "tts.order":
      return { source: "default", entries: DEFAULT_TTS_ORDER.map((provider) => ({ provider, model: null })) };
    default: {
      const chain = effectiveRoute("llm.chain", env, opts).entries;
      const fromEnv = parseRoleSpec(env[LLM_ROLE_ENV[id]]);
      // An env chain predates the fallbacks (`.env.example` lists every role), so it keeps its order and gains the providers it lacks.
      if (fromEnv.length > 0) return { source: "env", entries: [...fromEnv.map((s) => ({ provider: s.provider, model: s.model })), ...chain.filter((e) => !fromEnv.some((s) => s.provider === e.provider))] };
      return { source: "default", entries: chain };
    }
  }
}

/** The default Gemini text model: the first Gemini entry of the text chain, which by default is the `llm.model` slot. */
export function geminiTextModel(env: NodeJS.ProcessEnv = process.env): string {
  return effectiveRoute("llm.chain", env).entries.find((e) => e.provider === "gemini")?.model ?? modelOf(effectiveRoute("llm.model", env).entries) ?? DEFAULT_GEMINI_MODEL;
}

/** The entries of a slot as specs the text layer can call. */
export function routeSpecs(entries: readonly RouteEntry[]): RoleSpec[] {
  return entries.flatMap((e) => (e.model && isLlmProviderId(e.provider) ? [{ provider: e.provider, model: e.model }] : []));
}

/**
 * Drops the OpenAI-compatible specs nobody configured. They are not merely skipped by the chain: whether a spec is the
 * LAST one decides the breaker wait and the timeout retry, so a keyless fallback must leave no trace in the chain.
 */
export function withoutKeylessFallbacks(specs: readonly RoleSpec[]): RoleSpec[] {
  return specs.filter((s) => !isOpenAiCompatId(s.provider) || Boolean(getProviderKey(s.provider)));
}

/** The chain the direct text tools walk (slide, course work, translation...): only providers that can answer right now. */
export function usableTextChain(env: NodeJS.ProcessEnv = process.env): RoleSpec[] {
  return routeSpecs(effectiveRoute("llm.chain", env).entries).filter((s) => Boolean(getProviderKey(s.provider)));
}

/** The Gemini image model (the `image.gemini` slot). */
export function geminiImageModelName(env: NodeJS.ProcessEnv = process.env): string {
  return modelOf(effectiveRoute("image.gemini", env).entries) ?? DEFAULT_GEMINI_IMAGE_MODEL;
}

/** The Gemini model of the «Test ishlash» wrong-answer analysis (the `tests.analysis` slot). */
export function testsAnalysisModel(env: NodeJS.ProcessEnv = process.env): string {
  return modelOf(effectiveRoute("tests.analysis", env).entries) ?? DEFAULT_TESTS_ANALYSIS_MODEL;
}

/**
 * The admin's voice-provider order, or `null` when the slot is not overridden (then the language table's own order
 * applies, which equals `DEFAULT_TTS_ORDER`). Providers the admin did not list keep their place after the listed ones.
 */
export function ttsProviderRank(): ((provider: string) => number) | null {
  const stored = getRoute("tts.order");
  if (!stored || stored.length === 0) return null;
  const order = stored.map((e) => e.provider as string);
  return (provider) => {
    const i = order.indexOf(provider);
    return i < 0 ? order.length : i;
  };
}
