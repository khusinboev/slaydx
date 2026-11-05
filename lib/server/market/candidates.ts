import "server-only";
import type { PoolClient } from "pg";
import { PPTX_SIZE_LIMIT } from "../../generation/size-limits";
import type { AcademicDoc } from "../../generation/types";
import { bodyTextOf, marketLanguageOf, marketLevelOf, marketTitleOf, outlineOf, summaryOf } from "../../market/listing";
import { buildSearchText, normalizeTopic } from "../../market/normalize";
import { paramsAsFormValues, sizeBucket } from "../../market/params";
import { marketQuality } from "../../market/quality";
import { MARKET_TOOL_IDS, MAX_COPIES_KEY, isDeckTool, marketFamilyOf } from "../../market/registry";
import { dropMissingAssets, resanitizeStored, sanitizeForMarket, type SanitizeInput } from "../../market/sanitize";
import { simhash64 } from "../../market/simhash";
import { classifySubject } from "../../market/subjects";
import { TOOL_BY_ID } from "../../tools";
import type { ToolId } from "../../types";
import { pool, query, queryOne, transaction } from "../db";
import { adapterFor } from "../edit-adapters";
import { toJsonb } from "../jsonb";
import { log } from "../log";
import { effectivePrice } from "../pricing";
import { getSetting } from "../settings";
import { isUuid } from "./store";

/**
 * The supply side of the market (docs/market/PLAN.md §1.2): the scan that turns finished works into `candidate` rows.
 *
 * After this step nothing refers back to the live generation: the item holds its own sanitised document, params and
 * asset bytes (M1). `source_generation_id` / `source_user_id` are admin-only breadcrumbs.
 *
 * The source document is `COALESCE(doc_prev, doc_json)`: the state BEFORE the first user edit. What the AI wrote is what
 * we resell; what a user typed or uploaded in the viewer afterwards (his name, a photo of his group) never enters.
 *
 * Every read row ends in a `market_items` row, listed or `rejected`, so the scan makes progress and never re-evaluates
 * a work. A rejected row holds no document: `doc_json = '{}'`, only the sanitised title.
 */

/** Runs behind this advisory lock; a concurrent scan (manual + cron) returns at once. */
export const MARKET_SCAN_LOCK_ID = 727_000_006;
/** Cancel, refund and edit settle first (§1.2). */
const SETTLE_HOURS = 24;
/** Bodies this close (bits of 64) are the same work (§1.2). */
const SIMHASH_MAX_DISTANCE = 6;

/**
 * `values_json` keys of user-provided material: not ours to resell. A filled value disqualifies the work; forms send
 * these keys empty on every normal submit, so only a value counts.
 */
export const USER_MATERIAL_KEYS = ["sourceAssetId", "sourceText", "templateAssetId", "logoAssetId", "photoAssetId", "userFacts", "userRefs", "userData"] as const;

export type RejectReason = "quality" | "duplicate" | "per_topic" | "legacy" | "too_large" | "user_material" | "sanitize_error";

export type ScanResult = { locked: boolean; scanned: number; created: number; rejected: number };

type SourceRow = {
  id: string;
  user_id: string;
  tool_id: string;
  topic: string;
  values_json: Record<string, unknown>;
  doc: AcademicDoc | null;
  u_name: string | null;
  u_username: string | null;
  u_phone: string | null;
  u_author: string | null;
  u_teacher: string | null;
  u_university: string | null;
  u_faculty: string | null;
  u_department: string | null;
  u_organization: string | null;
  u_position: string | null;
  u_group: string | null;
};

/** The eligibility rules of §1.2, in one query. `generations_retention_idx` serves the COMPLETED + not purged + finished_at part. */
const ELIGIBLE_SQL = `
  SELECT g.id, g.user_id, g.tool_id, g.topic, g.values_json, COALESCE(g.doc_prev, g.doc_json) AS doc,
         u.name AS u_name, u.username AS u_username, u.phone AS u_phone, u.author AS u_author, u.teacher AS u_teacher,
         u.university AS u_university, u.faculty AS u_faculty, u.department AS u_department, u.organization AS u_organization,
         u.position AS u_position, u."group" AS u_group
    FROM generations g
    JOIN users u ON u.id = g.user_id
   WHERE g.status = 'COMPLETED'
     AND g.files_purged_at IS NULL
     AND g.finished_at < now() - $1::int * interval '1 hour'
     AND g.market_item_id IS NULL
     AND g.delivered_json IS NULL
     AND g.tool_id = ANY($2::text[])
     AND u.is_blocked = FALSE
     AND u.market_opt_out = FALSE
     AND NOT EXISTS (SELECT 1 FROM admin_accounts a WHERE a.user_id = g.user_id)
     AND NOT EXISTS (SELECT 1 FROM market_items m WHERE m.source_generation_id = g.id)
     AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.kind = 'refund' AND t.reference = g.id::text)
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each_text(g.values_json) v
        WHERE v.key = ANY($3::text[]) AND btrim(COALESCE(v.value, '')) NOT IN ('', '[]', '{}', 'null')
     )
   ORDER BY g.finished_at DESC
   LIMIT $4`;

async function insertRejected(row: SourceRow, reason: RejectReason, title: string, quality: unknown = {}, detail?: string): Promise<void> {
  await query(
    `INSERT INTO market_items (source_generation_id, source_user_id, tool_id, status, title, doc_json, topic_norm, reject_reason, quality_json)
     VALUES ($1, $2, $3, 'rejected', $4, '{}'::jsonb, $5, $6, $7::jsonb)
     ON CONFLICT (source_generation_id) WHERE source_generation_id IS NOT NULL DO NOTHING`,
    [row.id, row.user_id, row.tool_id, title, normalizeTopic(title), detail ? `${reason}: ${detail}`.slice(0, 500) : reason, toJsonb(quality)],
  );
}

const profileOf = (r: SourceRow): SanitizeInput["profile"] => ({
  name: r.u_name,
  username: r.u_username,
  phone: r.u_phone,
  author: r.u_author,
  teacher: r.u_teacher,
  university: r.u_university,
  faculty: r.u_faculty,
  department: r.u_department,
  organization: r.u_organization,
  position: r.u_position,
  group: r.u_group,
});

/** The dedupe gate of §1.2; the name of the reason, or `null` when the work may enter. */
async function duplicateReason(client: Pick<PoolClient, "query">, toolId: string, topicNorm: string, hash: string, size: string, perTopic: number): Promise<RejectReason | null> {
  const near = await client.query(
    `SELECT 1 FROM market_items
      WHERE tool_id = $1 AND status IN ('candidate','active','sold_out') AND bit_count((simhash # $2::bigint)::bit(64)) <= $3
      LIMIT 1`,
    [toolId, hash, SIMHASH_MAX_DISTANCE],
  );
  if (near.rows[0]) return "duplicate";
  const same = await client.query<{ size: string | null }>(
    `SELECT COALESCE(params_json->>'pages', params_json->>'slideCount', '') AS size FROM market_items
      WHERE tool_id = $1 AND topic_norm = $2 AND status IN ('candidate','active','sold_out')`,
    [toolId, topicNorm],
  );
  // One work per (topic, size): the same topic at another size is a different product, up to the per-topic limit.
  if (same.rows.some((r) => (r.size ?? "") === size)) return "duplicate";
  return same.rows.length >= perTopic ? "per_topic" : null;
}

/** One work → one row. Throws only on an unexpected failure; the scan turns that into `sanitize_error`. */
async function processOne(row: SourceRow, minQuality: number, perTopic: number): Promise<"created" | "rejected"> {
  const toolId = row.tool_id as ToolId;
  const doc = row.doc;
  const adapter = adapterFor(toolId);
  if (!doc?.meta || !adapter?.hasModel(doc)) {
    await insertRejected(row, "legacy", TOOL_BY_ID[toolId]?.title ?? toolId);
    return "rejected";
  }
  const clean = sanitizeForMarket({ toolId, doc, values: row.values_json ?? {}, sourceId: row.id, profile: profileOf(row) });
  const title = marketTitleOf(clean.doc.meta.topic || row.topic);
  if (clean.userMaterial) {
    await insertRejected(row, "user_material", title);
    return "rejected";
  }
  const quality = marketQuality(doc);
  if (quality.score < minQuality) {
    await insertRejected(row, "quality", title, quality);
    return "rejected";
  }
  const assets = clean.assetIds.length
    ? await query<{ asset_id: string; mime: string; size_bytes: string; bytes: Buffer }>(
        "SELECT asset_id, mime, size_bytes, bytes FROM generation_assets WHERE generation_id = $1 AND asset_id = ANY($2::text[])",
        [row.id, clean.assetIds],
      )
    : [];
  if (assets.reduce((n, a) => n + a.bytes.byteLength, 0) > PPTX_SIZE_LIMIT) {
    await insertRejected(row, "too_large", title);
    return "rejected";
  }
  const found = new Set(assets.map((a) => a.asset_id));
  const finalDoc = dropMissingAssets(clean.doc, clean.assetIds.filter((id) => !found.has(id)));

  const topicNorm = normalizeTopic(title);
  const hash = simhash64(bodyTextOf(finalDoc));
  const dup = await duplicateReason(pool(), toolId, topicNorm, hash, sizeBucket(clean.params), perTopic);
  if (dup) {
    await insertRejected(row, dup, title);
    return "rejected";
  }

  const outline = outlineOf(finalDoc);
  const summary = summaryOf(toolId, title, outline, clean.params);
  const family = marketFamilyOf(toolId);
  const maxCopies = family ? await getSetting(MAX_COPIES_KEY[family]) : null;
  const tool = TOOL_BY_ID[toolId];
  const original = await effectivePrice(tool, paramsAsFormValues(toolId, clean.params));
  const deck = isDeckTool(toolId);
  await transaction(async (client) => {
    const item = await client.query<{ id: string }>(
      `INSERT INTO market_items (source_generation_id, source_user_id, tool_id, status, title, summary, subject, level, language, pages, slide_count,
                                 doc_json, params_json, outline_json, pii_flags, quality_json, topic_norm, simhash, search_text, original_price, max_copies)
       VALUES ($1, $2, $3, 'candidate', $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17::bigint, $18, $19, $20)
       ON CONFLICT (source_generation_id) WHERE source_generation_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        row.id,
        row.user_id,
        toolId,
        title,
        summary,
        classifySubject({ topic: title, subjectName: doc.meta.subject || doc.work?.subjectName, profile: doc.work?.subject }),
        marketLevelOf(doc),
        marketLanguageOf(doc),
        deck ? null : doc.meta.targetPages || null,
        deck ? (finalDoc.slides?.length ?? null) : null,
        toJsonb(finalDoc),
        toJsonb(clean.params),
        toJsonb(outline),
        toJsonb(clean.flags),
        toJsonb(quality),
        topicNorm,
        hash,
        buildSearchText({ title, summary, outline }),
        original,
        maxCopies,
      ],
    );
    const id = item.rows[0]?.id;
    if (!id) return;
    for (const a of assets) {
      await client.query(
        `INSERT INTO market_assets (item_id, asset_id, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (item_id, asset_id) DO NOTHING`,
        [id, a.asset_id, a.mime, a.bytes.byteLength, a.bytes],
      );
    }
  });
  return "created";
}

/**
 * One scan. `market.backfill_batch` rows at most (0 = off). Leader-safe: `pg_try_advisory_lock` on a dedicated
 * connection, so an admin's manual scan and the 6 hour step never run the same work twice.
 */
export async function scanMarketCandidates(opts: { batch?: number } = {}): Promise<ScanResult> {
  const batch = opts.batch ?? (await getSetting("market.backfill_batch"));
  if (batch <= 0) return { locked: false, scanned: 0, created: 0, rejected: 0 };
  const client = await pool().connect();
  try {
    const got = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [MARKET_SCAN_LOCK_ID]);
    if (!got.rows[0]?.ok) return { locked: true, scanned: 0, created: 0, rejected: 0 };
    try {
      const disabled = new Set<string>(await getSetting("market.tools_disabled"));
      const tools = MARKET_TOOL_IDS.filter((t) => !disabled.has(t));
      const [minQuality, perTopic] = await Promise.all([getSetting("market.min_quality"), getSetting("market.per_topic_limit")]);
      const rows = await query<SourceRow>(ELIGIBLE_SQL, [SETTLE_HOURS, tools, USER_MATERIAL_KEYS, batch]);
      let created = 0;
      let rejected = 0;
      for (const row of rows) {
        try {
          if ((await processOne(row, minQuality, perTopic)) === "created") created++;
          else rejected++;
        } catch (err) {
          rejected++;
          log("warn", "[market] nomzod yaratilmadi", { generationId: row.id, err });
          await insertRejected(row, "sanitize_error", marketTitleOf(row.tool_id), {}, err instanceof Error ? err.name : "error").catch(() => {});
        }
      }
      return { locked: false, scanned: rows.length, created, rejected };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MARKET_SCAN_LOCK_ID]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

/** The 6 hour housekeeping step. Dark launch: while the market is off only the admin's manual scan fills the queue. */
export async function marketCandidatesStep(): Promise<number> {
  if (!(await getSetting("market.enabled"))) return 0;
  return (await scanMarketCandidates()).created;
}

/** Previews of retired / rejected items older than 30 days. */
export async function gcMarketPreviews(): Promise<number> {
  const rows = await query<{ item_id: string }>(
    `DELETE FROM market_previews p USING market_items i
      WHERE p.item_id = i.id AND i.status IN ('retired','rejected') AND i.updated_at < now() - interval '30 days'
      RETURNING p.item_id`,
  );
  return rows.length;
}

/**
 * Rejected rows older than 90 days lose their document and bytes, but stay: the row is what keeps the scan from
 * evaluating that work again.
 */
export async function gcRejectedItems(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE market_items SET doc_json = '{}'::jsonb
      WHERE status = 'rejected' AND updated_at < now() - interval '90 days' AND doc_json <> '{}'::jsonb
      RETURNING id`,
  );
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await query("DELETE FROM market_assets WHERE item_id = ANY($1::uuid[])", [ids]);
    await query("DELETE FROM market_item_files WHERE item_id = ANY($1::uuid[])", [ids]);
  }
  return rows.length;
}

/**
 * «Qayta tozalash» of a candidate: the current sanitiser rules over the STORED document (the source generation is never
 * read again, M1). Updates the document, the flags and the search text in the caller's transaction and returns the new
 * flag count; a new `preview_version` makes the rasters rebuild from the cleaned text.
 */
export async function resanitizeItemInTx(client: Pick<PoolClient, "query">, itemId: string): Promise<{ flags: number } | null> {
  if (!isUuid(itemId)) return null;
  const row = (await client.query<{ tool_id: ToolId; doc_json: AcademicDoc; params_json: Record<string, unknown>; title: string; summary: string }>(
    "SELECT tool_id, doc_json, params_json, title, summary FROM market_items WHERE id = $1 FOR UPDATE",
    [itemId],
  )).rows[0];
  if (!row?.doc_json?.meta) return null;
  const clean = resanitizeStored(row.tool_id, row.doc_json, row.params_json);
  const outline = outlineOf(clean.doc);
  await client.query(
    `UPDATE market_items
        SET doc_json = $2::jsonb, pii_flags = $3::jsonb, outline_json = $4::jsonb, search_text = $5, simhash = $6::bigint,
            preview_version = preview_version + 1, updated_at = now()
      WHERE id = $1`,
    [itemId, toJsonb(clean.doc), toJsonb(clean.flags), toJsonb(outline), buildSearchText({ title: row.title, summary: row.summary, outline }), simhash64(bodyTextOf(clean.doc))],
  );
  return { flags: clean.flags.length };
}

/** Admin stats line: rows waiting in the queue. */
export async function candidateCount(): Promise<number> {
  const row = await queryOne<{ n: string }>("SELECT count(*) AS n FROM market_items WHERE status = 'candidate'");
  return Number(row?.n ?? 0);
}
