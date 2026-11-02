import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { queryOne, transaction } from "./db";
import { chargeInTx } from "./credits";
import { admissionDecision, type AdmissionReject } from "./admission";
import { ADMISSION_COUNTS_SQL, IDEMPOTENCY_WINDOW_HOURS } from "./jobs";
import { queueLimits } from "./queue-limits";
import { toJsonb } from "./jsonb";
import { log } from "./log";
import { insufficientError, prepareGeneration } from "./submit-generation";
import { cleanText, safeSlice } from "../generation/safe-text";
import { MEDIA_CATALOG, STUDIO_IMAGE_PURPOSE, studioPurposeOf } from "../media/catalog";
import { isStudioVideoModel } from "../media/studio-video-pricing";
import { normalize } from "../studio-core";
import { TOOL_BY_ID } from "../tools";
import { isPaidOnlyTool } from "../tool-kinds";
import type { FormValues, ToolConfig } from "../types";

/**
 * Studio «Solishtirish» (docs/studio/P7-SPEC.md, P7a): ONE prompt sent to 2–4 models of the Rasm or Video tab at once.
 *
 * Money rule: every model goes through the SAME pipeline as a single submit (`prepareGeneration`: availability, inputs,
 * channel / offer / pause gates, the server price = `studioEntryPrice` + `tool_pricing` %, the model's `expectedPrice`)
 * BEFORE anything is charged; the total is the plain sum (no discount, no new rule) and is guarded by `expectedTotal`.
 * Then ONE transaction admits, charges and enqueues all N rows — all or nothing. Each row is an ordinary generation
 * (its own charge reference = its id, so the worker refunds it alone when it fails); the rows share `compare_group`
 * (migration 071). Admission counts the batch as N jobs (the user's in-flight cap and the queue wait, no bypass).
 *
 * Idempotency: the client's key is stored on the FIRST row of the batch (the unique `generations_user_idem_idx` allows
 * one row per key); a retry with the same key and the same request answers the whole batch, charging nothing; the same
 * key with another request is a 422, exactly as the single submit.
 */

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

export type CompareKind = "image" | "video";
const TOOL_OF: Readonly<Record<CompareKind, ToolConfig["id"]>> = { image: "studio-image", video: "studio-video" };

export type CompareMember = {
  /** Already passed through `sanitizeValues`: `{ modelId, prompt, …the model's params }`. */
  values: FormValues;
  /** The price the client showed for this model; a different server price is a 409. */
  expectedPrice?: number;
};

export type CompareInput = {
  userId: string;
  kind: CompareKind;
  members: CompareMember[];
  /** The sum the button showed («Solishtirish · N model · ~X so'm»); a different server sum is a 409. */
  expectedTotal?: number;
  idempotencyKey?: string;
};

export type CompareItem = { id: string; modelId: string; price: number };

export type CompareResult =
  | { kind: "queued"; group: string; total: number; items: CompareItem[]; replayed: boolean }
  | { kind: "admission"; error: string; code: string; retryAfterSec: number };

const modelIdOf = (values: FormValues): string => (typeof values.modelId === "string" ? values.modelId.trim() : "");

/**
 * What the batch may hold, before any lookup: 2–4 DISTINCT models of the tab's prompt purpose (Rasm: a drawing model —
 * edit / upscale / background removal have no compare; Video: a text/image → video model, never an effect), one prompt
 * (the same text, as the server normalizes it, for every model) and no input picture (compare is prompt-only). `null`
 * when the request is acceptable.
 */
export function compareRequestError(kind: CompareKind, members: readonly { values: FormValues }[]): string | null {
  if (members.length < COMPARE_MIN || members.length > COMPARE_MAX) return `Solishtirish uchun ${COMPARE_MIN}–${COMPARE_MAX} ta model tanlang`;
  const ids = members.map((m) => modelIdOf(m.values));
  if (ids.some((id) => !id)) return "Har model uchun modelId kerak";
  if (new Set(ids).size !== ids.length) return "Bir model ikki marta tanlangan";
  let prompt: string | null = null;
  for (const [i, m] of members.entries()) {
    const id = ids[i]!;
    const entry = MEDIA_CATALOG.byId(id);
    const fits =
      entry !== undefined &&
      (kind === "image" ? studioPurposeOf(id) === STUDIO_IMAGE_PURPOSE : isStudioVideoModel(id) && !entry.capabilities.includes("effect"));
    if (!entry || !fits) return "Bu model solishtirishda ishlamaydi";
    const params = normalize(entry.params, m.values);
    for (const p of entry.params) {
      const v = params[p.name];
      if (p.type === "image" && Array.isArray(v) && v.length > 0) return "Solishtirish faqat matndan ishlaydi — suratni olib tashlang";
    }
    const text = typeof params.prompt === "string" ? params.prompt : "";
    if (prompt === null) prompt = text;
    else if (text !== prompt) return "Hamma modelga bitta so‘rov yuboriladi";
  }
  return null;
}

/** The refusal of a balance below the batch sum: rolls the whole transaction back (nothing charged, nothing queued). */
class BatchShort extends Error {
  constructor(readonly short: { required: number; available: number; paidOnly?: true; bonus?: number }) {
    super("compare batch: balance below the sum");
  }
}

export async function submitCompare(input: CompareInput): Promise<CompareResult> {
  const { userId, kind, members, expectedTotal, idempotencyKey: key } = input;
  const bad = compareRequestError(kind, members);
  if (bad) throw new ApiError(bad, 400, { code: "compare_invalid" });
  const tool = TOOL_BY_ID[TOOL_OF[kind]];

  // A retry of a batch whose answer was lost: answered with the batch, no gate re-run (the single submit's rule).
  if (key) {
    const prior = await queryOne<{ ok: number }>(
      `SELECT 1 AS ok FROM generations
        WHERE user_id = $1 AND idempotency_key = $2
          AND created_at >= now() - $3::int * interval '1 hour' + interval '5 minutes' LIMIT 1`,
      [userId, key, IDEMPOTENCY_WINDOW_HOURS],
    );
    if (prior) {
      const replay = await transaction((c) => replayOf(c, userId, key, tool.id, members));
      if (replay) return replay;
    }
  }

  // EVERY model is validated and priced before anything is charged; the first refusal stops the batch.
  const prepared = [];
  for (const m of members) prepared.push(await prepareGeneration({ userId, tool, values: m.values, expectedPrice: m.expectedPrice }));
  const total = prepared.reduce((s, p) => s + p.price, 0);
  if (expectedTotal !== undefined && expectedTotal !== total) {
    throw new ApiError(`Narx o'zgardi. Yangi narx: ${total.toLocaleString("uz-UZ")} so'm.`, 409, {
      code: "price_changed",
      price: total,
      prices: prepared.map((p) => p.price),
    });
  }

  const limits = await queueLimits();
  const paidOnly = isPaidOnlyTool(tool.id);
  const group = randomUUID();
  try {
    const res = await transaction(async (client): Promise<CompareResult> => {
      // The admission lock: the same row lock as `enqueueGeneration`, so a batch and a single submit queue one by one.
      await client.query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE", [userId]);
      if (key) {
        await client.query(
          `UPDATE generations SET idempotency_key = NULL
            WHERE user_id = $1 AND idempotency_key = $2 AND created_at < now() - $3::int * interval '1 hour'`,
          [userId, key, IDEMPOTENCY_WINDOW_HOURS],
        );
        const replay = await replayOf(client, userId, key, tool.id, members);
        if (replay) return replay;
      }
      const counts = (await client.query<{ user_inflight: string; queued: string }>(ADMISSION_COUNTS_SQL, [userId])).rows[0];
      const inflight = Number(counts?.user_inflight ?? 0);
      const queued = Number(counts?.queued ?? 0);
      // N jobs = N admissions: the i-th model is admitted as if the i before it were already queued.
      for (let i = 0; i < members.length; i++) {
        const decision = admissionDecision({ ...limits, userInflight: inflight + i, queued: queued + i });
        if (!decision.ok) return admissionOf(decision, i, members.length, inflight, limits.userMaxInflight);
      }
      const items: CompareItem[] = [];
      let paid = 0;
      for (const [i, m] of members.entries()) {
        const id = randomUUID();
        const p = prepared[i]!;
        const topic = cleanText(p.topic);
        const charged = await chargeInTx(client, userId, p.price, id, safeSlice(`${tool.id}: ${topic}`, 200), paidOnly ? { paidOnly: true } : {});
        if (!charged.ok) {
          throw new BatchShort({
            required: total,
            available: charged.available + paid,
            ...(charged.paidOnly ? { paidOnly: true as const, bonus: charged.bonus ?? 0 } : {}),
          });
        }
        paid += p.price;
        await client.query(
          `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms, idempotency_key, compare_group, compare_index)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'Navbatga qo''yildi', $8, $9, $10, $11)`,
          [id, userId, tool.id, safeSlice(topic, 300), p.price, tool.output, toJsonb(m.values), Math.round(p.budgetMs), i === 0 ? (key ?? null) : null, group, i],
        );
        items.push({ id, modelId: modelIdOf(m.values), price: p.price });
      }
      return { kind: "queued", group, total, items, replayed: false };
    });
    log("info", res.kind === "queued" ? "[compare] navbatga qo'yildi" : "[compare] qabul qilinmadi", {
      userId,
      toolId: tool.id,
      group,
      models: members.length,
      total,
      ...(res.kind === "queued" ? { replayed: res.replayed, genIds: res.items.map((x) => x.id).join(",") } : { code: res.code }),
    });
    return res;
  } catch (e) {
    if (e instanceof BatchShort) throw insufficientError(e.short);
    if (!key || !isIdempotencyViolation(e)) throw e;
    // A parallel retry committed first: this whole transaction (charges too) rolled back; answer with its batch.
    const replay = await transaction((c) => replayOf(c, userId, key, tool.id, members));
    if (!replay) throw e;
    return replay;
  }
}

/** A refused batch admission; when the in-flight cap is what the N jobs together exceed, the text says so. */
function admissionOf(decision: AdmissionReject, i: number, n: number, inflight: number, cap: number): CompareResult {
  const { code, retryAfterSec } = decision;
  const error =
    code === "user_inflight" && i > 0
      ? `Solishtirish ${n} ta ish hisoblanadi: bir vaqtda ${Math.max(1, Math.floor(cap) || 1)} tagacha ish mumkin, sizda hozir ${inflight} ta. Kamroq model tanlang yoki ishlaringiz tugashini kuting. Pul yechilmadi.`
      : decision.error;
  return { kind: "admission", error, code, retryAfterSec };
}

function isIdempotencyViolation(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string } | null;
  return err?.code === "23505" && err.constraint === "generations_user_idem_idx";
}

/**
 * The batch already bought under `key` (24 h window), or `null` when the key is free. The same key with another
 * request — another tool, a single (non-compare) job, other models or values, another count — is a 422.
 */
async function replayOf(client: PoolClient, userId: string, key: string, toolId: string, members: readonly CompareMember[]): Promise<CompareResult | null> {
  const head = await client.query<{ compare_group: string | null }>(
    `SELECT compare_group FROM generations
      WHERE user_id = $1 AND idempotency_key = $2 AND created_at >= now() - $3::int * interval '1 hour'`,
    [userId, key, IDEMPOTENCY_WINDOW_HOURS],
  );
  const row = head.rows[0];
  if (!row) return null;
  const conflict = new ApiError("Bu Idempotency-Key boshqa so'rov uchun ishlatilgan — yangi kalit bilan yuboring", 422);
  if (!row.compare_group) throw conflict;
  // JSONB equality ignores key order: the stored `values_json` of row i against the i-th member of this request.
  const rows = (
    await client.query<{ id: string; tool_id: string; price: string; same: boolean; model_id: string | null }>(
      `SELECT id, tool_id, price::text AS price, values_json->>'modelId' AS model_id,
              values_json = ($3::jsonb -> compare_index::int) AS same
         FROM generations WHERE user_id = $1 AND compare_group = $2 ORDER BY compare_index`,
      [userId, row.compare_group, toJsonb(members.map((m) => m.values))],
    )
  ).rows;
  if (rows.length !== members.length || rows.some((r) => r.tool_id !== toolId || !r.same)) throw conflict;
  const items = rows.map((r) => ({ id: r.id, modelId: r.model_id ?? "", price: Number(r.price) }));
  return { kind: "queued", group: row.compare_group, total: items.reduce((s, x) => s + x.price, 0), items, replayed: true };
}
