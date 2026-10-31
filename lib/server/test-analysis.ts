import "server-only";
import { createHash } from "node:crypto";
import { parseLlmJson } from "../generation/json";
import { recordLlmUsage, trackJobCost } from "../generation/job-cost";
import { ANALYSIS_SCHEMA, ANALYSIS_SYSTEM, analysisUser, parseAnalysis, type AnalysisStem, type ParsedAnalysis } from "../tests/analysis";
import { letterOf } from "../tests/rules";
import { recordAiUsage } from "./ai-usage";
import { query, queryOne } from "./db";
import { log } from "./log";
import { getProviderKey } from "./providers/resolve";
import { testsAnalysisModel } from "./providers/route-effective";

/**
 * «Test ishlash» -- AI analysis of the wrong answers (owner 2026-10-31, migration 063). Included in the attempt's
 * price; the results page loads the result first and then asks for the analyses (`GET .../analysis`), so the model
 * never blocks the page.
 *
 *  - ONLY a finished attempt of the caller (ownership and status checked in SQL): the analysis names the correct
 *    letter, so it must never exist for a running attempt.
 *  - Shared cache `test_analyses`, one row per (question, answer key, stem hash): each question is analysed ONCE for
 *    every user. A row is claimed with `INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING` -- whoever gets the
 *    row back calls the model, everyone else waits for the row; two requests never call the model for one key.
 *  - The model call runs in the background of this process behind a cap of `MAX_CONCURRENT` calls; the page polls.
 *    A failure marks the row 'failed' (the page offers «Qayta urinish»; a retry is accepted after a short cool-down).
 *    A crashed process leaves a 'pending' row whose lease runs out, then the next request takes it over.
 *  - The model is the `tests.analysis` routing slot (default Gemini 3.1 Pro) and SEES the question image (inline
 *    bytes from `test_assets`). Spend goes to `ai_usage` as tool `tests:analysis`.
 */

export const ANALYSIS_TOOL_ID = "tests:analysis";
/** Model calls at once in this process (the rest wait in line). */
export const MAX_CONCURRENT = 3;
/** A claimed row waiting in line: another process may take it over after this. */
const CLAIM_LEASE_SEC = 300;
/** A running call: its own deadline plus a margin. */
const CALL_LEASE_SEC = 150;
const CALL_TIMEOUT_MS = 120_000;
/** A failed row may be retried after this many seconds (a retry storm cannot hammer the provider). */
export const RETRY_COOLDOWN_SEC = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────────────────── the model call ───────────────────────── */

export type AnalyzeInput = { stem: AnalysisStem; correct: number; image: { bytes: Buffer; mime: string } | null };
export type AnalyzeResult = ParsedAnalysis & { model: string };
export type Analyzer = (input: AnalyzeInput) => Promise<AnalyzeResult>;

type GeminiResponse = {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/** ONE multimodal Gemini call: the prompt text and the question image inline, a JSON answer. */
export async function analyzeWithGemini(input: AnalyzeInput, fetchImpl: typeof fetch = fetch): Promise<AnalyzeResult> {
  const key = getProviderKey("gemini");
  if (!key) throw new Error("GEMINI_API_KEY yo‘q");
  const model = testsAnalysisModel();
  const parts: Record<string, unknown>[] = [{ text: analysisUser(input.stem, input.correct) }];
  if (input.image) parts.push({ inlineData: { mimeType: input.image.mime, data: input.image.bytes.toString("base64") } });
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: ANALYSIS_SYSTEM }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        // A thinking model counts its thoughts in this limit; Pro cannot switch thinking off, so it gets a small budget.
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 1024 },
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
      },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  const u = data.usageMetadata;
  // Thinking tokens are billed at the output price (the same rule as `llm.ts geminiUsage`).
  if (u) recordLlmUsage({ provider: "gemini", model, inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message ?? "xato"}`.slice(0, 280));
  const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
  const parsed = parseAnalysis(parseLlmJson(text), input.correct);
  if (!parsed) throw new Error(`tahlil o‘qilmadi (${data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? "bo‘sh"})`);
  return { ...parsed, model };
}

/* ───────────────────────── the background line (cap of concurrent calls) ───────────────────────── */

let running = 0;
const waiting: (() => void)[] = [];
// On globalThis so a test (or a second bundle copy of this module) can wait for every job.
const jobs: Set<Promise<void>> = ((globalThis as typeof globalThis & { __slaydxTestAnalysisJobs?: Set<Promise<void>> }).__slaydxTestAnalysisJobs ??= new Set());

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Test seam: resolves when every analysis started so far has settled. */
export async function settleAnalyses(): Promise<void> {
  while (jobs.size) await Promise.all([...jobs]);
}

let analyzer: Analyzer = (input) => analyzeWithGemini(input);
/** Test seam: replaces the model call (the HTTP edge stays testable through `analyzeWithGemini` with a stubbed fetch). */
export function setAnalyzer(fn: Analyzer | null): void {
  analyzer = fn ?? ((input) => analyzeWithGemini(input));
}

/* ───────────────────────── the cache ───────────────────────── */

type Key = { questionId: number; correct: number; stemHash: string };
type Row = { question_id: string; correct: number; stem_hash: string; status: "pending" | "ready" | "failed"; explanation: string | null; wrong: Record<string, string> | null };

/**
 * Claims the row of `key` for this caller: a new row, a failed one after the cool-down (only when `retry`), or a
 * pending one whose lease ran out. `true` = the caller must run the model now; `false` = someone else has it.
 */
async function claim(k: Key, retry: boolean): Promise<boolean> {
  const r = await queryOne<{ ok: number }>(
    `INSERT INTO test_analyses (question_id, correct, stem_hash, status, lease_until)
     VALUES ($1, $2, $3, 'pending', clock_timestamp() + make_interval(secs => $4))
     ON CONFLICT (question_id, correct, stem_hash) DO UPDATE
        SET status = 'pending', lease_until = EXCLUDED.lease_until, error = NULL, updated_at = clock_timestamp()
      WHERE (test_analyses.status = 'pending' AND test_analyses.lease_until < clock_timestamp())
         OR ($5::boolean AND test_analyses.status = 'failed' AND test_analyses.updated_at < clock_timestamp() - make_interval(secs => $6))
     RETURNING 1 AS ok`,
    [k.questionId, k.correct, k.stemHash, CLAIM_LEASE_SEC, retry, RETRY_COOLDOWN_SEC],
  );
  return Boolean(r);
}

async function runOne(k: Key, userId: string): Promise<void> {
  await slot(async () => {
    // The line may have been long: renew the lease for the real call.
    await query("UPDATE test_analyses SET lease_until = clock_timestamp() + make_interval(secs => $4), tries = tries + 1, updated_at = clock_timestamp() WHERE question_id = $1 AND correct = $2 AND stem_hash = $3 AND status = 'pending'", [
      k.questionId,
      k.correct,
      k.stemHash,
      CALL_LEASE_SEC,
    ]);
    const q = await queryOne<{ subject: string; question_text: string | null; options: string[] | null; bytes: Buffer | null; mime: string | null }>(
      `SELECT s.name AS subject, q.question_text, q.options, a.bytes, a.mime
         FROM test_questions q JOIN test_subjects s ON s.id = q.subject_id LEFT JOIN test_assets a ON a.id = q.image_asset_id
        WHERE q.id = $1`,
      [k.questionId],
    );
    const tracked = trackJobCost(async () => {
      if (!q) throw new Error("savol topilmadi");
      return analyzer({
        stem: { subject: q.subject, text: q.question_text, options: q.options, hasImage: Boolean(q.bytes) },
        correct: k.correct,
        image: q.bytes && q.mime ? { bytes: Buffer.from(q.bytes), mime: q.mime } : null,
      });
    });
    try {
      const out = await tracked.promise;
      await query(
        `UPDATE test_analyses SET status = 'ready', explanation = $4, wrong = $5::jsonb, model = $6, lease_until = NULL, error = NULL, updated_at = clock_timestamp()
          WHERE question_id = $1 AND correct = $2 AND stem_hash = $3`,
        [k.questionId, k.correct, k.stemHash, out.explanation, JSON.stringify(out.wrong), out.model.slice(0, 80)],
      );
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      log("warn", "[tests] tahlil yozilmadi", { questionId: k.questionId, err: msg });
      await query(
        "UPDATE test_analyses SET status = 'failed', error = $4, lease_until = NULL, updated_at = clock_timestamp() WHERE question_id = $1 AND correct = $2 AND stem_hash = $3 AND status = 'pending'",
        [k.questionId, k.correct, k.stemHash, msg],
      ).catch(() => undefined);
    } finally {
      try {
        void recordAiUsage({ source: "free", outcome: "free", userId, toolId: ANALYSIS_TOOL_ID, cost: tracked.snapshot().toJson() });
      } catch {
        // Telemetry never affects the analysis.
      }
    }
  });
}

/** Keys this process is analysing or has in line: never claimed twice from here, even past the claim lease. */
const inflight = new Set<string>();
const keyText = (k: Key): string => `${k.questionId}:${k.correct}:${k.stemHash}`;

function start(k: Key, userId: string): void {
  inflight.add(keyText(k));
  const p = runOne(k, userId)
    .catch((err: unknown) => log("warn", "[tests] tahlil ishi yiqildi", { questionId: k.questionId, err }))
    .finally(() => inflight.delete(keyText(k)));
  jobs.add(p);
  void p.finally(() => jobs.delete(p));
}

/* ───────────────────────── the view ───────────────────────── */

export type AnalysisItem = {
  questionId: number;
  position: number;
  status: "pending" | "ready" | "failed";
  correctLetter: string;
  /** `null` = the question was not answered. */
  chosenLetter: string | null;
  /** Why the correct option is correct (ready only). */
  explanation: string | null;
  /** Why the user's option is wrong (ready and answered only). */
  chosenWhy: string | null;
};

export type AnalysisView = { attemptId: string; items: AnalysisItem[]; done: boolean };
export type AnalysisOutcome = { ok: true; view: AnalysisView } | { ok: false; reason: "not_found" | "not_finished" };

/** sha256 of what the model reads: the image hash, the text and the options. A corrected stem gets a new analysis. */
export function stemHash(imageSha: string | null, text: string | null, options: string[] | null): string {
  return createHash("sha256").update(JSON.stringify([imageSha ?? "", text ?? "", options ?? []])).digest("hex");
}

/**
 * The analyses of the caller's FINISHED attempt, one per wrong or unanswered question: ready ones from the cache, the
 * missing ones started in the background (`pending`). `retry` also restarts the failed ones (after the cool-down).
 */
export async function attemptAnalysis(userId: string, attemptId: string, opts: { retry?: boolean } = {}): Promise<AnalysisOutcome> {
  if (!UUID_RE.test(attemptId)) return { ok: false, reason: "not_found" };
  const a = await queryOne<{ status: string; question_ids: number[]; key_snapshot: number[] | null; deadline_at: Date }>(
    "SELECT status, question_ids, key_snapshot, deadline_at FROM test_attempts WHERE id = $1 AND user_id = $2",
    [attemptId, userId],
  );
  if (!a) return { ok: false, reason: "not_found" };
  if (a.status !== "finished" || !a.key_snapshot) return { ok: false, reason: "not_finished" };

  const ids = a.question_ids.map(Number);
  // The same rule as the scoring: only answers given up to the deadline count.
  const given = await query<{ question_id: string; chosen: number }>(
    "SELECT question_id::text AS question_id, chosen FROM test_attempt_answers WHERE attempt_id = $1 AND answered_at <= $2",
    [attemptId, a.deadline_at],
  );
  const chosenOf = new Map(given.map((r) => [Number(r.question_id), r.chosen]));
  const wrong = ids
    .map((id, i) => ({ id, position: i + 1, correct: a.key_snapshot![i] ?? 0, chosen: chosenOf.get(id) ?? null }))
    .filter((x) => x.chosen !== x.correct);
  if (!wrong.length) return { ok: true, view: { attemptId, items: [], done: true } };

  const stems = await query<{ id: number; question_text: string | null; options: string[] | null; sha256: string | null }>(
    `SELECT q.id::int AS id, q.question_text, q.options, a.sha256 FROM test_questions q LEFT JOIN test_assets a ON a.id = q.image_asset_id WHERE q.id = ANY($1::bigint[])`,
    [wrong.map((w) => w.id)],
  );
  const hashOf = new Map(stems.map((s) => [s.id, stemHash(s.sha256, s.question_text, s.options)]));
  const keys = wrong.filter((w) => hashOf.has(w.id)).map((w): Key & { position: number; chosen: number | null } => ({ ...w, questionId: w.id, stemHash: hashOf.get(w.id)! }));

  const read = async () => {
    const rows = await query<Row>(
      `SELECT t.question_id::text AS question_id, t.correct, t.stem_hash, t.status, t.explanation, t.wrong
         FROM test_analyses t JOIN unnest($1::bigint[], $2::smallint[], $3::text[]) AS k(q, c, h) ON t.question_id = k.q AND t.correct = k.c AND t.stem_hash = k.h`,
      [keys.map((k) => k.questionId), keys.map((k) => k.correct), keys.map((k) => k.stemHash)],
    );
    return new Map(rows.map((r) => [`${r.question_id}:${r.correct}:${r.stem_hash}`, r]));
  };
  let byKey = await read();
  let claimed = 0;
  for (const k of keys) {
    const row = byKey.get(keyText(k));
    const wanted = !row || row.status === "pending" || (row.status === "failed" && opts.retry);
    if (wanted && !inflight.has(keyText(k)) && (await claim(k, Boolean(opts.retry)))) {
      start(k, userId);
      claimed++;
    }
  }
  if (claimed) byKey = await read();

  const items = keys.map((k): AnalysisItem => {
    const row = byKey.get(keyText(k));
    const status = row?.status ?? "pending";
    const ready = status === "ready" && row;
    return {
      questionId: k.questionId,
      position: k.position,
      status,
      correctLetter: letterOf(k.correct),
      chosenLetter: k.chosen === null ? null : letterOf(k.chosen),
      explanation: ready ? row.explanation : null,
      chosenWhy: ready && k.chosen !== null ? (row.wrong?.[String(k.chosen)] ?? null) : null,
    };
  });
  return { ok: true, view: { attemptId, items, done: items.every((i) => i.status !== "pending") } };
}
