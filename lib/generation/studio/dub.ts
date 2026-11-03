/**
 * Studio P10 «Dublyaj» engine (docs/studio/P10-SPEC.md, tool `studio-dub`) — ElevenLabs Dubbing, ASYNC, polled by the
 * worker INSIDE the job's budget (no second poll loop; why: P10-SPEC «Async»).
 *
 *   1. One `media_jobs` row per job, key `<generationId>:dub:0` (purpose `studio.dub`), written BEFORE the provider call.
 *   2. Submit (`POST /v1/dubbing`) → the op id `<dubbing_id>:<target>` is parked on that row ('pending').
 *   3. Poll (`GET /v1/dubbing/{id}`) with a backoff (10, 15, 20, 30 s …) until `dubbed` / `failed` / the job deadline
 *      (minus the download reserve) → download the dub (MP4 for a video source, MP3 for audio), delete the project at
 *      ElevenLabs (best effort), finish the row.
 *
 * Exactly once at the provider: a re-run of the same job (the worker died, a deploy re-queued it) finds the row and
 *   - 'pending' with an op id → RESUMES polling that op (never submits again);
 *   - 'submitting' (died between the call and the park: a paid dub nobody knows the id of) → FAILED + refund, never resent;
 *   - 'failed' → FAILED + refund.
 * Any failure, a safety refusal, the deadline → `UserFacingError` → the worker fails the job and refunds in full; an op we
 * give up on is deleted at ElevenLabs (best effort) so a late finish is not kept. Outside a job (unit tests, scripts) the
 * row store is injected or absent.
 */
import { MediaError, costUsd, normalize, submitWithRoutes, type MediaAdapter, type MediaOutput, type RouteHealth } from "../../studio-core";
import { DUB_MAX_SECONDS, DUB_MODEL, SPEECH_TOOL_OUTPUT_MAX_BYTES, STUDIO_DUB_PURPOSE, parseSource } from "../../media/catalog-transcribe";
import { MIX_SECONDS_TOLERANCE } from "../../media/catalog-mix";
import { dubEntry, studioDubError } from "../../media/studio-transcribe";
import { transcribeAdapters } from "../../media/adapters/transcribe-studio";
import { mediaContext } from "../../media/context";
import { UserFacingError } from "../../server/user-error";
import { extractMeta } from "../meta";
import { recordAudioCall } from "./cost";
import { mp4HasVideo } from "./mix-media";
import { mp4Seconds } from "../video/mp4";
import { mp3Seconds } from "../tts/mp3";
import { sourceKindOf, type SpeechToolCtx } from "./transcribe";
import type { AcademicDoc, BuiltFile, StudioDubDoc } from "../types";
import type { FormValues, ToolConfig } from "../../types";

/** The `media_jobs` side the engine needs (default: `lib/server/media/jobs.ts` inside a job). */
export type DubRowStore = {
  begin(i: { key: string; params: Record<string, unknown>; costUsd: number }): Promise<{ id: string; status: string; opId: string | null; fresh: boolean }>;
  park(id: string, opId: string): Promise<void>;
  finish(id: string, meta: { mime: string; size: number }): Promise<void>;
  fail(id: string, message: string): Promise<void>;
};

export type StudioDubDeps = {
  adapters?: Readonly<Record<string, MediaAdapter>>;
  /** `null` = record nothing (outside a job); absent = the real table when a job context exists. */
  store?: DubRowStore | null;
  health?: RouteHealth;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const REFUND = "Kredit qaytariladi.";
export const DUB_FAILED_MESSAGE = `Dublyaj bajarilmadi — provayder javob bermadi. ${REFUND}`;
export const DUB_DEADLINE_MESSAGE = `Dublyaj belgilangan vaqtda tayyor bo‘lmadi. ${REFUND}`;
export const DUB_LOST_MESSAGE = `Dublyaj so‘rovi uzilib qoldi (server qayta ishga tushdi). ${REFUND}`;
export const DUB_SAFETY_MESSAGE = `Provayder bu faylni dublyaj qilishni rad etdi. ${REFUND}`;

/** Seconds before the next status check after `n` checks: 10, 15, 20, then every 30. */
export function dubPollDelaySec(n: number): number {
  const ladder = [10, 15, 20, 30];
  return ladder[Math.min(Math.max(0, n), ladder.length - 1)]!;
}
/** Time kept for the download + checks + commit after the last poll. */
export const DUB_DOWNLOAD_RESERVE_MS = 45_000;
/** Transient poll errors (5xx, network) tolerated before the op is given up. */
export const DUB_MAX_TRANSIENT = 8;


async function defaultStore(): Promise<DubRowStore | null> {
  const ctx = mediaContext();
  if (!ctx) return null;
  const jobs = await import("../../server/media/jobs");
  const entry = dubEntry();
  const route = entry.routes[0]!;
  return {
    begin: async (i) => {
      const { row, fresh } = await jobs.beginMediaJob({
        generationId: ctx.generationId,
        purpose: STUDIO_DUB_PURPOSE,
        modelId: entry.id,
        provider: route.provider,
        upstreamModel: route.upstreamModel,
        idempotencyKey: i.key,
        params: i.params,
        costUsd: i.costUsd,
      });
      return { id: row.id, status: row.status, opId: row.op_id, fresh };
    },
    park: (id, opId) => jobs.parkMediaJob(id, opId, new Date(Date.now() + 10_000)),
    finish: (id, meta) => jobs.finishMediaJob(id, [meta]),
    fail: (id, message) => jobs.failMediaJob(id, message),
  };
}

async function defaultHealth(): Promise<RouteHealth> {
  return (await import("../../server/media/run")).breakerHealth;
}

/** What the downloaded dub is: an MP4 with a picture, an MP3, or neither. */
function dubOutputOf(bytes: Uint8Array): { mime: "video/mp4"; seconds: number } | { mime: "audio/mpeg"; seconds: number } | null {
  if (mp4HasVideo(bytes)) return { mime: "video/mp4", seconds: mp4Seconds(bytes) };
  const s = mp3Seconds(bytes);
  return s > 0 ? { mime: "audio/mpeg", seconds: s } : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function buildStudioDub(
  tool: ToolConfig,
  values: FormValues,
  ctx: SpeechToolCtx,
  o: { deadline?: number; onStage?: (ev: { progress: number; step: string }) => void } = {},
  deps: StudioDubDeps = {},
): Promise<BuiltFile> {
  o.onStage?.({ progress: 0, step: "So‘rov tayyorlanmoqda" });
  const bad = studioDubError(values);
  if (bad) throw new UserFacingError(`${bad} ${REFUND}`);
  const entry = dubEntry();
  const p = normalize(entry.params, values);
  const ref = parseSource(values.source)!;
  const src = ctx.source;
  if (!src || src.kind !== ref.kind || src.id !== ref.id) throw new UserFacingError(`Tanlangan manba topilmadi (o‘chirilgan yoki muddati o‘tgan bo‘lishi mumkin). ${REFUND}`);
  if (!(src.seconds > 0 && src.seconds <= DUB_MAX_SECONDS + MIX_SECONDS_TOLERANCE)) throw new UserFacingError(`Manba ${DUB_MAX_SECONDS / 60} daqiqadan uzun yoki o‘qilmadi. ${REFUND}`);
  const kind = sourceKindOf(src.mime);

  const adapters = deps.adapters ?? transcribeAdapters();
  const route = entry.routes[0]!;
  const adapter = adapters[route.adapter];
  if (!adapter || !adapter.configured()) throw new UserFacingError(`Dublyaj xizmati hozir mavjud emas. ${REFUND}`);
  const store = deps.store === undefined ? await defaultStore() : deps.store;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gen = mediaContext()?.generationId ?? "adhoc";
  const key = `${gen}:dub:0`;

  const row = store ? await store.begin({ key, params: { ...p }, costUsd: costUsd(entry.cost, p) }) : null;
  const fail = async (message: string, userMessage: string): Promise<never> => {
    if (store && row) await store.fail(row.id, message).catch(() => undefined);
    throw new UserFacingError(userMessage);
  };

  let opId: string;
  if (row && !row.fresh) {
    // A re-run of this job: resume the parked op, never submit a second (paid) dub.
    if ((row.status === "pending" || row.status === "succeeded") && row.opId) opId = row.opId;
    else return fail(`re-run found the row '${row.status}' without an op id — not resubmitted`, DUB_LOST_MESSAGE);
  } else {
    o.onStage?.({ progress: 5, step: "Fayl yuborilmoqda" });
    try {
      const { result } = await submitWithRoutes(
        [route],
        adapters,
        deps.health ?? (await defaultHealth()),
        { params: p, assets: { media: [{ mime: src.mime, base64: Buffer.from(src.bytes).toString("base64") }] }, idempotencyKey: key },
        o.deadline ? { deadline: o.deadline } : {},
      );
      if (!("opId" in result)) throw new MediaError(route.provider, "dubbing answered synchronously");
      opId = result.opId;
    } catch (e) {
      console.warn("[studio-dub] submit failed:", e instanceof Error ? e.message : e);
      return fail(e instanceof Error ? e.message : String(e), e instanceof MediaError && e.safety ? DUB_SAFETY_MESSAGE : DUB_FAILED_MESSAGE);
    }
    if (store && row) await store.park(row.id, opId);
  }

  const giveUp = async (message: string, userMessage: string): Promise<never> => {
    // A dub we no longer wait for is deleted at ElevenLabs, so a late finish is not kept (best effort).
    await adapter.cancel?.(opId).catch(() => undefined);
    return fail(message, userMessage);
  };

  const until = (o.deadline ?? now() + 9 * 60_000) - DUB_DOWNLOAD_RESERVE_MS;
  let output: MediaOutput | null = null;
  let transient = 0;
  for (let n = 0; !output; n++) {
    o.onStage?.({ progress: Math.min(85, 10 + n * 6), step: "Dublyaj qilinmoqda" });
    const wait = dubPollDelaySec(n) * 1000;
    if (now() + wait > until) return giveUp("deadline before the dub finished", DUB_DEADLINE_MESSAGE);
    await sleep(wait);
    let r: Awaited<ReturnType<NonNullable<MediaAdapter["poll"]>>>;
    try {
      r = await adapter.poll!(opId, {});
    } catch (e) {
      if (e instanceof MediaError && e.retryable && ++transient <= DUB_MAX_TRANSIENT) continue;
      return giveUp(e instanceof Error ? e.message : String(e), DUB_FAILED_MESSAGE);
    }
    if (r.state === "failed") return giveUp(r.message, r.safety ? DUB_SAFETY_MESSAGE : DUB_FAILED_MESSAGE);
    if (r.state === "done") output = r.outputs[0] ?? null;
    if (r.state === "done" && !output) return giveUp("dubbed without an output", DUB_FAILED_MESSAGE);
  }

  o.onStage?.({ progress: 90, step: "Natija yuklab olinmoqda" });
  let bytes: Uint8Array;
  try {
    bytes = await adapter.fetchOutput(output, {});
  } catch (e) {
    return giveUp(e instanceof Error ? e.message : String(e), DUB_FAILED_MESSAGE);
  }
  const shape = dubOutputOf(bytes);
  // A video source must come back as a video, an audio source as an MP3.
  if (!shape || (kind === "video") !== (shape.mime === "video/mp4")) return giveUp(`unexpected dub output (${bytes.length} B)`, DUB_FAILED_MESSAGE);
  if (bytes.length > SPEECH_TOOL_OUTPUT_MAX_BYTES) return giveUp(`dub output ${bytes.length} B over the cap`, `Natija fayli juda katta (25 MB dan oshdi). ${REFUND}`);
  if (store && row) await store.finish(row.id, { mime: shape.mime, size: bytes.length }).catch(() => undefined);
  // The project is deleted at ElevenLabs once we hold the file (privacy; nothing is kept there).
  await adapter.cancel?.(opId).catch(() => undefined);
  recordAudioCall(entry, route, p);

  const target = String(p.target);
  const output2: StudioDubDoc["output"] = shape.mime === "video/mp4" ? "mp4" : "mp3";
  const dub: StudioDubDoc = {
    model: DUB_MODEL,
    source: ref.kind,
    sourceId: ref.kind === "result" ? ref.id : null,
    sourceKind: kind,
    sourceSeconds: Number(p.sourceSeconds),
    target,
    sourceLang: String(p.sourceLang),
    output: output2,
    seconds: round1(shape.seconds),
  };
  const label = `Dublyaj · ${target.toUpperCase()}`;
  const meta = extractMeta(tool, { ...values, topic: label });
  const doc: AcademicDoc = { meta, titlePage: false, toc: false, sections: [], dub };
  if (output2 === "mp4") doc.video = { provider: "elevenlabs", prompt: label, aspect: src.aspect ?? "16:9", requestedSeconds: round1(shape.seconds), seconds: round1(shape.seconds), fromImage: false, model: DUB_MODEL };
  return {
    html: `<article><h1>${label}</h1><p>${Math.round(shape.seconds)} s</p></article>`,
    bytes,
    fileName: `${meta.fileNameHint || "dublyaj"}.${output2}`,
    mime: shape.mime,
    doc,
  };
}
