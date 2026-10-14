/**
 * Display-only progress smoothing and time estimate for the running panel.
 *
 * The server writes `progress` only when an engine reports a stage, so inside one long LLM call
 * (lesson plan 8 → 65, audio 68 → 92) the number stands still for minutes and the page looks hung.
 * `smoothProgress` creeps the SHOWN value toward the end of the CURRENT stage while nothing new
 * arrives. Three rules keep it honest:
 *   - never below the server value, never backwards (`prev`);
 *   - never past the stage ceiling (`stageCeiling`) — the next stage mark is only reached by the server;
 *   - never 99+ (the page flips to the result when the job really finishes).
 * Pure functions, no clock reads: the caller passes elapsed time (tested in `tests/progress-smooth.test.mts`).
 */
import { stageCeiling, stageIndexAt, type StageDef } from "./progress-stages";

/** Typical wall time of one stage when the tool's median is unknown. */
const DEFAULT_STAGE_MS = 30_000;
const MIN_STAGE_MS = 8_000;
const MAX_STAGE_MS = 90_000;

export function smoothProgress(input: {
  server: number;
  stages: readonly StageDef[];
  /** ms since the server value last changed. */
  sinceChangeMs: number;
  /** Median duration of this tool (s), if known — sizes the creep to the stage's share of the job. */
  typicalSec?: number | null;
  /** Previously shown value — the result never goes below it. */
  prev?: number;
}): number {
  const server = Math.max(0, Math.min(99, Math.round(Number(input.server) || 0)));
  const idx = stageIndexAt(input.stages, server);
  const ceiling = Math.max(server, stageCeiling(input.stages, idx));
  const span = (input.stages[idx + 1]?.from ?? 100) - input.stages[idx].from;
  const stageMs =
    input.typicalSec && input.typicalSec > 0
      ? Math.min(MAX_STAGE_MS, Math.max(MIN_STAGE_MS, (input.typicalSec * 1000 * span) / 100))
      : DEFAULT_STAGE_MS;
  const t = Math.max(0, input.sinceChangeMs);
  const creep = server + (ceiling - server) * (1 - Math.exp(-t / stageMs));
  const shown = Math.min(ceiling, Math.round(creep));
  return Math.min(99, Math.max(server, shown, Math.round(input.prev ?? 0)));
}

export type EtaState =
  | { kind: "none" }
  | { kind: "left"; sec: number }
  /** Already past the usual duration — say so instead of a stuck "0 s left". */
  | { kind: "slow" };

/**
 * Remaining time from the tool's median duration: `typical × (1 − progress)`, but never less than what
 * the median says is still ahead of the elapsed time. Below ~5 s of data (`typicalSec` missing) → none.
 */
export function etaState(input: { elapsedSec: number; typicalSec?: number | null; progress: number }): EtaState {
  const typical = input.typicalSec;
  if (!typical || typical <= 0 || !Number.isFinite(input.elapsedSec)) return { kind: "none" };
  if (input.elapsedSec > typical * 1.3 && input.progress < 90) return { kind: "slow" };
  const byProgress = typical * (1 - Math.min(99, Math.max(0, input.progress)) / 100);
  const byClock = typical - input.elapsedSec;
  const sec = Math.max(byProgress, byClock * 0.5);
  return { kind: "left", sec: Math.max(0, sec) };
}

/** «taxminan 2 daqiqa» / «bir necha soniya» — coarse on purpose (a false-precise ETA is worse than none). */
export function etaLabel(sec: number): string {
  if (sec < 15) return "bir necha soniya";
  if (sec < 50) return `${Math.round(sec / 10) * 10} soniya`;
  if (sec < 90) return "1 daqiqa";
  const min = Math.round(sec / 60);
  return min < 90 ? `${min} daqiqa` : `${Math.round(min / 60)} soat`;
}
