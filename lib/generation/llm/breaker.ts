/**
 * The circuit breaker lives in the media core (`lib/studio-core/breaker.ts`, docs/studio/P0-SPEC.md §3.9) so the LLM
 * layer and the media router share ONE implementation and ONE registry (the admin heartbeat snapshot sees both).
 * Named re-exports: tsx loads these files as CommonJS, where `export *` is invisible to an ESM importer.
 */
export { LLM_BREAKER, CircuitBreaker, breakerFor, snapshotBreakers, resetBreakers, allowOrWait } from "../../studio-core/breaker";
export type { BreakerState, BreakerOpts, BreakerSnapshot } from "../../studio-core/breaker";
