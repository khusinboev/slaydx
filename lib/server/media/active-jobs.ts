import "server-only";
import { query } from "../db";
import { MEDIA_CATALOG, studioPurposeOf } from "../../media/catalog";
import { MIX_MODES } from "../../media/catalog-mix";

/**
 * The signed-in user's unfinished Studio jobs (docs/studio/P11-SPEC.md «C. Reliability»): a refresh brings them back to
 * their tabs. Ownership is in the SQL: another user's job is never read.
 *
 * Not listed: `studio-voice` (the voice list shows a clone being made by itself), the podcast / greeting templates (their
 * own tools, followed by their own panel and by «Ishlarim»), and compare rows (`compare_group`): a compare member is one
 * cell of a batch, and as a lone card its retry would be a different purchase. They stay in the gallery and «Ishlarim».
 *
 * The plan needs no index of its own: `generations_status_created_idx` walks the active rows only, so a user with 20 000
 * finished jobs costs the same as a new one (EXPLAIN ANALYZE on 220 000 seeded rows: 10 buffers, 0.07 ms).
 */
export const ACTIVE_JOB_TOOLS = ["studio-image", "studio-video", "studio-speech", "studio-audio", "studio-mix", "studio-transcribe", "studio-dub"] as const;
export type ActiveJobTool = (typeof ACTIVE_JOB_TOOLS)[number];

/** More than `queue.user_max_inflight` allows: a list this long is already a bug, not a page to walk. */
export const ACTIVE_JOBS_LIMIT = 20;
/** The longest non-text value in `sent` (asset ids, enums); a text param has its schema's own `max`. */
export const SENT_VALUE_MAX = 512;
/** `topicOf` is short for every Studio tool; the card shows two lines of it. */
export const ACTIVE_TOPIC_MAX = 200;

export type ActiveStudioJob = {
  id: string;
  tool: ActiveJobTool;
  modelId: string;
  modelLabel: string;
  prompt: string;
  price: number;
  /** The catalog purpose the job was priced under; `null` outside the picture modes. */
  purpose: string | null;
  /** The request values: «Qayta» sends exactly these again. */
  sent: Record<string, unknown>;
};

/**
 * What `requestValues` sent, and nothing else: `{ modelId }` + the model's schema params, each within its schema. A form
 * value can hold up to 1.2 MB, so the stored JSON is never echoed as it is. An unknown model keeps only its id: the card
 * still follows the job, and its retry says the model is gone.
 */
export function sentOf(values: Readonly<Record<string, unknown>>, modelId: string): Record<string, unknown> {
  const params = MIX_MODES.find((m) => m.model === modelId)?.entry.params ?? MEDIA_CATALOG.byId(modelId)?.params ?? [];
  const out: Record<string, unknown> = { modelId };
  for (const p of params) {
    const v = values[p.name];
    if (v === undefined) continue;
    out[p.name] = typeof v === "string" ? v.slice(0, p.type === "text" ? p.max : SENT_VALUE_MAX) : v;
  }
  return out;
}

type Row = { id: string; tool_id: ActiveJobTool; topic: string; price: string | number; values_json: Record<string, unknown> | null };

const MIX_MODELS: ReadonlySet<string> = new Set(MIX_MODES.map((m) => m.model));

export async function listActiveStudioJobs(userId: string): Promise<ActiveStudioJob[]> {
  const rows = await query<Row>(
    `SELECT id, tool_id, LEFT(topic, $4) AS topic, price, values_json
       FROM generations
      WHERE user_id = $1 AND status IN ('QUEUED', 'IN_PROGRESS') AND tool_id = ANY($2::text[]) AND compare_group IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [userId, [...ACTIVE_JOB_TOOLS], ACTIVE_JOBS_LIMIT, ACTIVE_TOPIC_MAX],
  );
  return rows.map((r) => {
    const values = r.values_json ?? {};
    const modelId = typeof values.modelId === "string" ? values.modelId : "";
    return {
      id: r.id,
      tool: r.tool_id,
      modelId,
      modelLabel: MIX_MODELS.has(modelId) ? "Montaj" : (MEDIA_CATALOG.byId(modelId)?.label ?? ""),
      prompt: r.topic,
      price: Number(r.price),
      purpose: r.tool_id === "studio-image" ? studioPurposeOf(modelId) : null,
      sent: sentOf(values, modelId),
    };
  });
}
