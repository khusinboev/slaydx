import "server-only";
import { mediaContext } from "../media/context";
import { MARKET_ASSET_PREFIX, type MarketCloneValues } from "../market/types";
import { stampFingerprint } from "../market/fingerprint";
import { queryOne } from "../server/db";
import { adapterFor } from "../server/edit-adapters";
import { safeFileName } from "../server/market/items";
import { getItemAssets, getItemDoc, getItemRow, marketAssetResolver, type MarketAsset } from "../server/market/store";
import type { FormValues, ToolConfig } from "../types";
import type { BuildOptions } from "./index";
import { parseAuthorLine } from "./meta";
import { renderHtml } from "./render-html";
import { deckFooter } from "./slide-identity";
import type { AcademicDoc, BuiltFile } from "./types";

/**
 * The buyer's copy (docs/market/PLAN.md §2.2): the stored neutral document, his title page, a fresh render, the invisible
 * mark. No LLM, no provider, `cost_json` stays null. A failure is the ordinary failed job: FAILED + full refund.
 *
 * `values_json` is NOT trusted to name an item: the job must be the generation a purchase row points at, so a hand-made
 * `POST /api/generations` carrying `marketItemId` gets nothing even past the route's own refusal.
 */

const COPYABLE = new Set(["active", "sold_out", "retired"]);
const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The buyer's title-page fields over a neutral document; footers follow. Pure: the input document is not changed. */
export function mergeBuyerFields(doc: AcademicDoc, values: MarketCloneValues): AcademicDoc {
  const parsed = parseAuthorLine(clean(values.author));
  const author = parsed.name;
  const university = clean(values.university);
  const faculty = clean(values.faculty);
  const department = clean(values.department);
  const group = clean(values.group) || parsed.group;
  const course = clean(values.course) || parsed.course;
  const teacher = clean(values.teacher);
  const city = clean(values.city);

  const out: AcademicDoc = { ...doc, meta: { ...doc.meta, author, university, faculty, department, group, course, teacher, city } };
  if (doc.work) out.work = { ...doc.work, author, university, faculty, department, group, course, teacher, city };
  if (doc.teacher) out.teacher = { ...doc.teacher, school: { ...doc.teacher.school, author, institution: university } };
  if (doc.article) {
    out.article = { ...doc.article, authors: author ? [{ name: author, ...(university ? { org: university } : {}) }] : [] };
    out.meta.organization = university;
  }
  if (doc.slides) {
    const footer = deckFooter(out.meta);
    out.slides = doc.slides.map((s) => ({ ...s, footer }));
  }
  return out;
}

/** Placeholders → `data:` URLs: the worker's `extractAssets` turns them into THIS generation's asset URLs and rows. */
export function inlineAssets<T>(doc: T, assets: readonly MarketAsset[]): T {
  const urls = new Map(assets.map((a) => [`${MARKET_ASSET_PREFIX}${a.assetId}`, `data:${a.mime};base64,${a.bytes.toString("base64")}`]));
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") return v.startsWith(MARKET_ASSET_PREFIX) ? (urls.get(v) ?? "") : v;
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
    return v;
  };
  return visit(doc) as T;
}

/** The purchase this job fulfils; the only way an item's document reaches a generation. */
async function entitlementOf(generationId: string, itemId: string): Promise<{ userId: string; fingerprint: string } | null> {
  const row = await queryOne<{ user_id: string; fingerprint: string }>(
    `SELECT g.user_id, p.fingerprint
       FROM market_purchases p JOIN generations g ON g.id = p.generation_id
      WHERE p.generation_id = $1 AND p.item_id = $2 AND g.market_item_id = $2 AND g.user_id = p.buyer_user_id`,
    [generationId, itemId],
  );
  return row ? { userId: String(row.user_id), fingerprint: row.fingerprint } : null;
}

export async function buildMarketCopy(tool: ToolConfig, values: FormValues, opts: BuildOptions): Promise<BuiltFile> {
  const generationId = mediaContext()?.generationId;
  const clone = values as MarketCloneValues;
  const itemId = clone.marketItemId;
  if (!generationId) throw new Error("market copy outside a job");
  const paid = await entitlementOf(generationId, itemId);
  if (!paid) throw new Error("market copy without a purchase");
  const item = await getItemRow(itemId);
  if (!item || !COPYABLE.has(item.status) || item.tool_id !== tool.id) throw new Error("market item is not available for a copy");
  const adapter = adapterFor(item.tool_id);
  const stored = await getItemDoc(itemId);
  if (!adapter || !stored?.meta) throw new Error("market item has no document");
  opts.onStage?.({ progress: 40, step: "Nusxa tayyorlanmoqda" });

  const doc = mergeBuyerFields(stored, clone);
  const ext = tool.output === "pptx" ? "pptx" : "docx";
  const rendered = await adapter.render(
    { id: generationId, userId: paid.userId, doc, fileName: safeFileName(item.title, ext), resolveImage: marketAssetResolver(itemId) },
    {},
  );
  const bytes = await stampFingerprint(rendered.bytes, paid.fingerprint);
  const finalDoc = inlineAssets(doc, await getItemAssets(itemId));
  return { bytes, mime: rendered.mime, fileName: rendered.fileName, doc: finalDoc, html: renderHtml(finalDoc) };
}
