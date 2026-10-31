import { parseRoleSpec } from "../../generation/llm/types";
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
/** Voice providers in the order the standard chain tries them (`tts/types.ts` tables list Azure, then Aisha, then Gemini). */
export const DEFAULT_TTS_ORDER = ["azure", "aisha", "gemini"] as const;

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
    case "image.gemini": {
      const fromEnv = env.GEMINI_IMAGE_MODEL?.trim();
      return fromEnv
        ? { source: "env", entries: [{ provider: "gemini", model: fromEnv }] }
        : { source: "default", entries: [{ provider: "gemini", model: DEFAULT_GEMINI_IMAGE_MODEL }] };
    }
    case "tts.order":
      return { source: "default", entries: DEFAULT_TTS_ORDER.map((provider) => ({ provider, model: null })) };
    default: {
      const fromEnv = parseRoleSpec(env[LLM_ROLE_ENV[id]]);
      if (fromEnv.length > 0) return { source: "env", entries: fromEnv.map((s) => ({ provider: s.provider, model: s.model })) };
      return { source: "default", entries: [{ provider: "gemini", model: modelOf(effectiveRoute("llm.model", env, opts).entries) ?? DEFAULT_GEMINI_MODEL }] };
    }
  }
}

/** The default Gemini text model (the `llm.model` slot). */
export function geminiTextModel(env: NodeJS.ProcessEnv = process.env): string {
  return modelOf(effectiveRoute("llm.model", env).entries) ?? DEFAULT_GEMINI_MODEL;
}

/** The Gemini image model (the `image.gemini` slot). */
export function geminiImageModelName(env: NodeJS.ProcessEnv = process.env): string {
  return modelOf(effectiveRoute("image.gemini", env).entries) ?? DEFAULT_GEMINI_IMAGE_MODEL;
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
