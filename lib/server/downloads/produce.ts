import "server-only";
import {
  downloadSubject,
  formatById,
  isDownloadFormatId,
  type DownloadFormat,
  type DownloadFormatId,
} from "@/lib/downloads/formats";
import type { AcademicDoc } from "@/lib/generation/types";
import { query, queryOne } from "../db";
import { adapterFor } from "../edit-adapters";
import { ensureFreshFileShared } from "../fresh-file";
import { pdfAvailable } from "../pdf";
import { DownloadError, toDownloadError } from "./errors";
import {
  cachedDerivedSize,
  PRODUCERS,
  producerAvailable,
  type ProduceDeps,
  type ProducerCtx,
  type ProducerSpec,
  type SourceMeta,
} from "./producers";

/**
 * Server-side bytes for any registry format (docs/mobile/PLAN.md §4.2).
 *
 *   produceDownload — the bytes now (Telegram «Saqlash»/«Ulashish» package and
 *                     `GET …/file?format=pdf` call this; never their own conversion);
 *   prepareDownload — the prepare route: answers within ~7 s with `ready` or
 *                     `preparing` (the conversion keeps running in the background,
 *                     single-flight per {gen, format, file_version}, bounded);
 *   peekDownload    — size/name without converting (HEAD on `/api/dl/<token>`).
 *
 * Ownership is in SQL (`WHERE g.id = $1 AND g.user_id = $2`) on every read,
 * and the requested format is validated against the registry with
 * `formatById(downloadSubject(row), features, format)` — the server offers
 * exactly the rows the sheet lists.
 */

export type DownloadResult = { bytes: Buffer; fileName: string; mime: string; fileVersion: number };

export type PrepareResult =
  | { state: "ready"; fileName: string; size: number; mime: string; fileVersion: number }
  | { state: "preparing"; retryAfterMs: number };

/** Test seams on top of the producer deps. */
export type DownloadDeps = ProduceDeps & {
  /** Re-render a stale file before producing (default `ensureFreshFileShared`). */
  ensureFresh?: (generationId: string, userId: string) => Promise<void>;
  /** How long `prepareDownload` waits before answering `preparing` (default 7 s). */
  prepareBudgetMs?: number;
};

/** The prepare route never holds a request longer than this (PLAN: "~8 s"). */
export const PREPARE_BUDGET_MS = 7_000;
/** Client poll interval while preparing (R1 §5: "polls every 1.5 s"). */
export const PREPARE_RETRY_MS = 1_500;
/** Background jobs: total and per user (beyond → 503 / 429 with Retry-After). */
const MAX_JOBS = 16;
const MAX_JOBS_PER_USER = 3;
/** A finished job's metadata stays this long (ready answer without a second conversion). */
const DONE_TTL_MS = 120_000;
/** A failed job is reported to the next poll, or forgotten after this long. */
const FAILED_TTL_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Globals = typeof globalThis & {
  __slaydxDownloadDeps?: DownloadDeps | null;
  __slaydxDownloadJobs?: Map<string, Job>;
};
const g = globalThis as Globals;

/**
 * Test seam for the routes: dependencies every route call uses (stub
 * converter, temp cache, short budget). `null` restores the defaults.
 */
export function setDownloadDeps(deps: DownloadDeps | null): void {
  g.__slaydxDownloadDeps = deps;
}

function currentDeps(): DownloadDeps {
  return g.__slaydxDownloadDeps ?? {};
}

type Row = {
  tool_id: string;
  format: string;
  status: string;
  doc_version: number;
  file_version: number;
  doc_json: AcademicDoc | null;
  file_name: string | null;
  mime: string | null;
  size_bytes: number | string | null;
};

async function loadMeta(generationId: string, userId: string): Promise<SourceMeta | null> {
  const r = await queryOne<Row>(
    `SELECT g.tool_id, g.format, g.status, g.doc_version, g.file_version, g.doc_json,
            f.file_name, f.mime, f.size_bytes
       FROM generations g
       LEFT JOIN generation_files f ON f.generation_id = g.id
      WHERE g.id = $1 AND g.user_id = $2`,
    [generationId, userId],
  );
  if (!r) return null;
  return {
    id: generationId.toLowerCase(),
    userId,
    toolId: r.tool_id,
    format: r.format,
    status: r.status,
    docVersion: r.doc_version ?? 0,
    fileVersion: r.file_version ?? 0,
    doc: r.doc_json ?? null,
    fileName: r.file_name,
    mime: r.mime,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  };
}

/** Stored bytes of exactly `fileVersion` (a rebuild in between → `null`). Does not count a download. */
async function loadBytes(generationId: string, userId: string, fileVersion: number): Promise<Buffer | null> {
  const r = await queryOne<{ bytes: Buffer }>(
    `SELECT f.bytes
       FROM generation_files f
       JOIN generations g ON g.id = f.generation_id
      WHERE f.generation_id = $1 AND g.user_id = $2 AND g.status = 'COMPLETED' AND g.file_version = $3`,
    [generationId, userId, fileVersion],
  );
  return r?.bytes ?? null;
}

async function hasResults(generationId: string, userId: string): Promise<boolean> {
  const r = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM game_results r
         JOIN game_sessions s ON s.id = r.session_id
        WHERE s.generation_id = $1 AND s.user_id = $2) AS ok`,
    [generationId, userId],
  );
  return r?.ok === true;
}

/** `downloads + 1` — only a real GET of the file counts (never HEAD or prepare). */
export async function recordDownload(generationId: string): Promise<void> {
  await query("UPDATE generation_files SET downloads = downloads + 1 WHERE generation_id = $1", [generationId]);
}

/** Same rule as `ensureFreshFile`: an editable tool whose file is older than its document. */
function isStale(meta: SourceMeta): boolean {
  return meta.fileVersion < meta.docVersion && adapterFor(meta.toolId) !== null;
}

type Mode = {
  /** Re-render a stale file first (prepare, Telegram, legacy file route). */
  ensureFresh: boolean;
  /** Token path: the bytes must be exactly this `file_version` and still current, else 410. */
  expectVersion?: number;
};

type Resolved = { meta: SourceMeta; format: DownloadFormat; spec: ProducerSpec; ctx: ProducerCtx };

async function resolve(
  generationId: string,
  userId: string,
  formatId: string,
  mode: Mode,
  deps: DownloadDeps,
): Promise<Resolved> {
  if (!isDownloadFormatId(formatId)) throw new DownloadError("unknown_format");
  if (!UUID.test(generationId)) throw new DownloadError("not_found");
  if (mode.ensureFresh) {
    try {
      await (deps.ensureFresh ?? ensureFreshFileShared)(generationId, userId);
    } catch (e) {
      throw toDownloadError(e);
    }
  }
  const meta = await loadMeta(generationId, userId);
  if (!meta) throw new DownloadError("not_found");
  if (meta.status !== "COMPLETED" || !meta.fileName || !meta.mime) throw new DownloadError("not_ready");
  if (mode.expectVersion !== undefined && (meta.fileVersion !== mode.expectVersion || isStale(meta))) {
    throw new DownloadError("stale");
  }

  const subject = downloadSubject(
    { type: meta.toolId, format: meta.format, doc: meta.doc },
    formatId === "results-csv" ? { hasResults: await hasResults(generationId, userId) } : {},
  );
  const features = { pdf: (deps.pdfAvailable ?? pdfAvailable)() };
  const format = formatById(subject, features, formatId);
  if (!format) {
    // Offered with LibreOffice, but this server has none → 503, not "unsupported".
    if (!features.pdf && formatById(subject, { pdf: true }, formatId)) throw new DownloadError("unavailable");
    throw new DownloadError("unsupported");
  }
  if (!producerAvailable(format.id, deps)) throw new DownloadError("unavailable");

  let bytes: Promise<Buffer> | null = null;
  const nativeBytes = () => {
    bytes ??= loadBytes(generationId, userId, meta.fileVersion).then((b) => {
      // The file was rebuilt between the two reads: the token is stale, a prepare just retries.
      if (!b) throw mode.expectVersion !== undefined ? new DownloadError("stale") : new DownloadError("busy", { retryAfterSec: 1 });
      return b;
    });
    return bytes;
  };
  const spec = PRODUCERS[format.id];
  return { meta, format, spec, ctx: { meta, format, nativeBytes, deps } };
}

function mimeOf(r: Resolved): string {
  // The stored row's exact type for the native file; the registry type for derived ones.
  return r.format.id === "native" ? (r.meta.mime ?? r.format.mime) : r.format.mime;
}

function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  signal.throwIfAborted();
  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** `produceDownload` with an explicit mode and deps (routes and tests). */
export async function produceWith(
  generationId: string,
  userId: string,
  format: string,
  mode: Mode,
  deps: DownloadDeps = currentDeps(),
  signal?: AbortSignal,
): Promise<DownloadResult> {
  signal?.throwIfAborted();
  const r = await resolve(generationId, userId, format, mode, deps);
  let bytes: Buffer;
  try {
    // The conversion itself is shared (single-flight) — an abort stops waiting, not the job.
    bytes = await abortable(r.spec.produce(r.ctx), signal);
  } catch (e) {
    throw toDownloadError(e);
  }
  return { bytes, fileName: r.spec.fileName(r.meta), mime: mimeOf(r), fileVersion: r.meta.fileVersion };
}

/**
 * The bytes of `format` for the owner's generation. Stale files are rebuilt
 * first (`ensureFreshFileShared`). Throws `DownloadError` (`code` + HTTP
 * `status`, `retryAfterSec` for busy/limits). Does not count a download.
 */
export async function produceDownload(
  genId: string,
  userId: string,
  format: DownloadFormatId,
  opts?: { signal?: AbortSignal },
): Promise<{ bytes: Buffer; fileName: string; mime: string; fileVersion: number }> {
  return produceWith(genId, userId, format, { ensureFresh: true }, currentDeps(), opts?.signal);
}

export type PeekResult = { size: number | null; fileName: string; mime: string; fileVersion: number };

/**
 * Name, type and size WITHOUT converting: the stored size from the row, a
 * derived file's size from the cache (`null` when not converted yet), an
 * instant serialization is built (cheap). Used by HEAD and the prepare fast path.
 */
export async function peekWith(
  generationId: string,
  userId: string,
  format: string,
  mode: Mode,
  deps: DownloadDeps = currentDeps(),
): Promise<PeekResult> {
  const r = await resolve(generationId, userId, format, mode, deps);
  const base = { fileName: r.spec.fileName(r.meta), mime: mimeOf(r), fileVersion: r.meta.fileVersion };
  try {
    switch (r.spec.kind) {
      case "stored":
        return { ...base, size: r.meta.sizeBytes };
      case "derived":
        return { ...base, size: await cachedDerivedSize(r.ctx) };
      case "instant":
        return { ...base, size: (await r.spec.produce(r.ctx)).byteLength };
    }
  } catch (e) {
    throw toDownloadError(e);
  }
}

export async function peekDownload(genId: string, userId: string, format: DownloadFormatId): Promise<PeekResult> {
  return peekWith(genId, userId, format, { ensureFresh: false });
}

type Job = {
  userId: string;
  promise: Promise<void>;
  done?: { fileName: string; size: number; mime: string; fileVersion: number; at: number };
  failed?: { error: unknown; at: number };
};

function jobs(): Map<string, Job> {
  g.__slaydxDownloadJobs ??= new Map();
  return g.__slaydxDownloadJobs;
}

function sweepJobs(now: number): void {
  for (const [key, j] of jobs()) {
    if (j.done && now - j.done.at > DONE_TTL_MS) jobs().delete(key);
    else if (j.failed && now - j.failed.at > FAILED_TTL_MS) jobs().delete(key);
  }
}

function readyOf(d: NonNullable<Job["done"]>): PrepareResult {
  return { state: "ready", fileName: d.fileName, size: d.size, mime: d.mime, fileVersion: d.fileVersion };
}

function running(): Job[] {
  return [...jobs().values()].filter((j) => !j.done && !j.failed);
}

/**
 * Prepare route core: `ready` when the file exists (stored, cached or
 * converted within the budget), else `preparing` while the conversion
 * continues in the background. A background failure is thrown to the next
 * poll (once). Never waits longer than the budget for a conversion.
 */
export async function prepareDownload(
  genId: string,
  userId: string,
  format: DownloadFormatId,
  deps: DownloadDeps = currentDeps(),
): Promise<PrepareResult> {
  const started = Date.now();
  const budget = deps.prepareBudgetMs ?? PREPARE_BUDGET_MS;
  const r = await resolve(genId, userId, format, { ensureFresh: true }, deps);
  const info = { fileName: r.spec.fileName(r.meta), mime: mimeOf(r), fileVersion: r.meta.fileVersion };

  try {
    if (r.spec.kind === "stored" && r.meta.sizeBytes !== null) {
      return { state: "ready", size: r.meta.sizeBytes, ...info };
    }
    if (r.spec.kind === "instant") {
      return { state: "ready", size: (await r.spec.produce(r.ctx)).byteLength, ...info };
    }
    const cached = await cachedDerivedSize(r.ctx);
    if (cached !== null) return { state: "ready", size: cached, ...info };
  } catch (e) {
    throw toDownloadError(e);
  }

  const now = Date.now();
  sweepJobs(now);
  const key = `${r.meta.id}:${format}:${r.meta.fileVersion}`;
  let job = jobs().get(key);
  if (job?.failed) {
    jobs().delete(key);
    throw toDownloadError(job.failed.error);
  }
  if (job?.done) return readyOf(job.done);
  if (!job) {
    const live = running();
    if (live.filter((j) => j.userId === userId).length >= MAX_JOBS_PER_USER) {
      throw new DownloadError("rate_limited", { retryAfterSec: 5 });
    }
    if (live.length >= MAX_JOBS) throw new DownloadError("busy", { retryAfterSec: 5 });
    const entry: Job = { userId, promise: Promise.resolve() };
    entry.promise = produceWith(genId, userId, format, { ensureFresh: false, expectVersion: r.meta.fileVersion }, deps).then(
      (out) => {
        entry.done = { fileName: out.fileName, size: out.bytes.byteLength, mime: out.mime, fileVersion: out.fileVersion, at: Date.now() };
      },
      (error: unknown) => {
        entry.failed = { error, at: Date.now() };
      },
    );
    jobs().set(key, entry);
    job = entry;
  }

  const left = Math.max(0, budget - (Date.now() - started));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([job.promise, new Promise<void>((res) => (timer = setTimeout(res, left)))]);
  clearTimeout(timer);
  if (job.failed) {
    jobs().delete(key);
    throw toDownloadError(job.failed.error);
  }
  if (job.done) return readyOf(job.done);
  return { state: "preparing", retryAfterMs: PREPARE_RETRY_MS };
}
