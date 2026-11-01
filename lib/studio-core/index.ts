/**
 * Media engine core — public surface (docs/studio/P0-SPEC.md). Hosts import from here, never from the files.
 * No SlaydX imports anywhere under `lib/studio-core/` (`tests/studio-core-purity.test.mts`).
 *
 * Named re-exports, not `export *`: tsx loads these files as CommonJS, where a star re-export is invisible to an ESM
 * importer (the same reason `lib/generation/tts/index.ts` lists names).
 */
export { MEDIA_KINDS, MediaError, isRetryableStatus } from "./types";
export type { MediaKind, Capability, MediaOutput } from "./types";
export { ASSET_ID_RE, normalizeText, normalize, validate } from "./params";
export type { EnumParam, IntParam, NumberParam, BoolParam, TextParam, ImageParam, VoiceParam, ParamSchema, ParamValue, NormalizedParams } from "./params";
export { costUsd } from "./cost";
export type { CostTable, CostRule } from "./cost";
export { MARKUP_MIN, MARKUP_MAX, isValidMarkup, price, roundUpTo } from "./pricing";
export type { PriceOverride, PriceCtx } from "./pricing";
export { defineCatalog } from "./catalog";
export type { Route, Badge, CatalogEntry, ClientEntry, Catalog } from "./catalog";
export { definePurposes, resolveModel } from "./purposes";
export type { PurposeSpec, Purposes, Resolved } from "./purposes";
export type { AdapterAsset, AdapterInput, AdapterDeps, PollResult, SubmitResult, MediaAdapter } from "./adapter";
export { routeKey, submitWithRoutes } from "./router";
export type { RouteHealth, Routed } from "./router";
export { sniffMime, sha256Hex, checkOutput } from "./storage";
export type { StoredObject, MediaStore, OutputCheck } from "./storage";
export { LLM_BREAKER, CircuitBreaker, breakerFor, snapshotBreakers, resetBreakers, allowOrWait } from "./breaker";
export type { BreakerState, BreakerOpts, BreakerSnapshot } from "./breaker";
export { Semaphore } from "./limiter";
