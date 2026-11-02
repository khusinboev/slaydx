/**
 * Provider-cost telemetry of the Studio speech / audio engines (docs/studio/P7-SPEC.md, P7c).
 *
 * Every delivered provider call is one entry in the job's meter (`job-cost.ts`), so `generations.cost_json` and
 * `ai_usage` (the admin cost / profit reports) carry the real spend of an «Ovoz» / «Audio» job, as the other engines do.
 *
 *   amount     the catalog cost of THAT call -- the very rule and normalized values `runMedia` stores in
 *              `media_jobs.cost_usd`, so the two can never disagree (a sound-effect call runs with `variants: 1`:
 *              one clip per call);
 *   when       after the engine accepted the call's audio. A call that failed, or answered with nothing usable,
 *              records nothing -- the same rule as a picture (`coreAdapterImageProvider`) and a TTS synthesis
 *              (`tts/chain`); the admin reports see only what was delivered;
 *   parts      speech -> `tts` (units = characters), music / sound effect / voice changer / isolator -> `audio`
 *              (units = the seconds the call was priced on). A Gemini speech quote is a character -> token estimate
 *              (the adapter returns no usage), so that part is flagged `estimated`.
 *
 * Outside a job (previews, scripts, unit tests without a meter) the `record*` calls are no-ops.
 */
import { costUsd, normalize, type CatalogEntry, type Route } from "../../studio-core";
import { recordAudio, recordTts } from "../job-cost";

/** The catalog cost (USD) of ONE provider call made with `values` -- identical to `runMedia`'s `media_jobs.cost_usd`. */
export function callCostUsd(entry: CatalogEntry, values: Readonly<Record<string, unknown>>): number {
  return costUsd(entry.cost, normalize(entry.params, values));
}

/** One delivered speech call: `chars` is what was spoken (display only), the money is the catalog quote of `values`. */
export function recordSpeechCall(entry: CatalogEntry, route: Route, values: Readonly<Record<string, unknown>>, chars: number): void {
  recordTts(route.provider, route.upstreamModel, chars, callCostUsd(entry, values), route.provider === "gemini" ? { estimated: true } : undefined);
}

/** One delivered audio call (music / effect / voice changer / isolator), priced on the rule's seconds. */
export function recordAudioCall(entry: CatalogEntry, route: Route, values: Readonly<Record<string, unknown>>): void {
  const p = normalize(entry.params, values);
  const seconds = entry.cost.per === "second" ? Number(p[entry.cost.secondsParam]) : 0;
  recordAudio(route.provider, route.upstreamModel, Number.isFinite(seconds) ? seconds : 0, costUsd(entry.cost, p));
}
