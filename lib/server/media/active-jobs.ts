import "server-only";
import { query } from "../db";
import { MEDIA_CATALOG, studioPurposeOf } from "../../media/catalog";
import { MIX_MODES } from "../../media/catalog-mix";

/**
 * The signed-in user's unfinished Studio jobs (docs/studio/P11-SPEC.md «C. Reliability»): a refresh brings them back to
 * their tabs. Ownership is in the SQL: another user's job is never read.
 *
 * Not listed: `studio-voice` (the voice list shows a clone being made by itself) and the podcast / greeting templates
 * (their own tools, followed by their own panel and by «Ishlarim»).
 */
export const ACTIVE_JOB_TOOLS = ["studio-image", "studio-video", "studio-speech", "studio-audio", "studio-mix", "studio-transcribe", "studio-dub"] as const;
export type ActiveJobTool = (typeof ACTIVE_JOB_TOOLS)[number];

/** More than `queue.user_max_inflight` allows: a list this long is already a bug, not a page to walk. */
export const ACTIVE_JOBS_LIMIT = 20;

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

type Row = { id: string; tool_id: ActiveJobTool; topic: string; price: string | number; values_json: Record<string, unknown> | null };

const MIX_MODELS: ReadonlySet<string> = new Set(MIX_MODES.map((m) => m.model));

export async function listActiveStudioJobs(userId: string): Promise<ActiveStudioJob[]> {
  const rows = await query<Row>(
    `SELECT id, tool_id, topic, price, values_json
       FROM generations
      WHERE user_id = $1 AND status IN ('QUEUED', 'IN_PROGRESS') AND tool_id = ANY($2::text[])
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [userId, [...ACTIVE_JOB_TOOLS], ACTIVE_JOBS_LIMIT],
  );
  return rows.map((r) => {
    const sent = r.values_json ?? {};
    const modelId = typeof sent.modelId === "string" ? sent.modelId : "";
    return {
      id: r.id,
      tool: r.tool_id,
      modelId,
      modelLabel: MIX_MODELS.has(modelId) ? "Montaj" : (MEDIA_CATALOG.byId(modelId)?.label ?? ""),
      prompt: r.topic,
      price: Number(r.price),
      purpose: r.tool_id === "studio-image" ? studioPurposeOf(modelId) : null,
      sent,
    };
  });
}
