/**
 * Every text adapter except Gemini. Separate from `llm-roles.ts` because `llm.ts` needs them too and must not import the
 * Gemini adapter, which imports `llm.ts`.
 */
import { anthropicAdapter } from "./anthropic";
import { OPENAI_COMPAT_ADAPTERS } from "./openai-compat";
import type { ProviderAdapter, ProviderId } from "./types";

export const FALLBACK_ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = {
  anthropic: anthropicAdapter,
  ...OPENAI_COMPAT_ADAPTERS,
};
