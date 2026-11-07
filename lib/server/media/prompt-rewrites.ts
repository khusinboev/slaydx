import "server-only";
import type { EnhanceKind } from "../../media/enhance";
import { query, queryOne } from "../db";

/**
 * «AI yaxshilash» runs once per job (docs/studio/P11-SPEC.md «G»). A job can be claimed again (a worker died, a deploy
 * returned it to the queue), and the rewrite is paid: so the row is claimed BEFORE the LLM call, and whoever finds it taken
 * reads the outcome instead of calling.
 *
 * A «Solishtirish» batch shares one row (`compare_group`): the first member to arrive makes the rewrite and carries its cost,
 * the others wait for it, so every model gets the same prompt.
 *
 * A pending row older than `waitMs` belongs to a worker that died mid-call. Its call may have been paid, so it is not
 * repeated: the row is closed as failed and the job goes on with the user's own prompt.
 */

/** Longer than the LLM budget (`auto-prompt.ts`): a live owner always answers inside it. */
export const REWRITE_WAIT_MS = 30_000;
const POLL_MS = 400;

type Row = { status: "pending" | "done" | "failed"; prompt: string | null; age_ms: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function claim(generationId: string, kind: EnhanceKind): Promise<boolean> {
  const rows = await query<{ generation_id: string }>(
    `INSERT INTO studio_prompt_rewrites (generation_id, compare_group, kind)
     SELECT id, compare_group, $2 FROM generations WHERE id = $1
     ON CONFLICT DO NOTHING
     RETURNING generation_id`,
    [generationId, kind],
  );
  return rows.length > 0;
}

/** The row this job reads: its own, or its batch's. */
function read(generationId: string): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT r.status, r.prompt, (EXTRACT(EPOCH FROM now() - r.created_at) * 1000)::text AS age_ms
       FROM studio_prompt_rewrites r
      WHERE r.generation_id = $1 OR r.compare_group = (SELECT g.compare_group FROM generations g WHERE g.id = $1)
      LIMIT 1`,
    [generationId],
  );
}

/** Closes the job's row; a row already closed keeps what it holds. */
async function close(generationId: string, prompt: string | null): Promise<void> {
  await query(
    `UPDATE studio_prompt_rewrites SET status = $2, prompt = $3, finished_at = now()
      WHERE status = 'pending' AND (generation_id = $1 OR compare_group = (SELECT g.compare_group FROM generations g WHERE g.id = $1))`,
    [generationId, prompt === null ? "failed" : "done", prompt],
  );
}

/**
 * The job's rewrite, made by `make` at most once for the job (or its batch); `null` when there is none to use: `make` gave
 * nothing, or the owner never came back. `make` may throw: that is a failed rewrite, never a failed job.
 */
export async function rewriteOnce(
  generationId: string,
  kind: EnhanceKind,
  make: () => Promise<string | null>,
  o: { deadline?: number; waitMs?: number; pollMs?: number } = {},
): Promise<string | null> {
  if (await claim(generationId, kind)) {
    const made = await make().catch((e: unknown) => {
      console.warn("[studio-prompt] rewrite failed:", e instanceof Error ? e.message : e);
      return null;
    });
    await close(generationId, made);
    return (await read(generationId))?.prompt ?? null;
  }
  const waitMs = o.waitMs ?? REWRITE_WAIT_MS;
  for (;;) {
    const row = await read(generationId);
    if (!row) return null;
    if (row.status !== "pending") return row.prompt;
    if (Number(row.age_ms) >= waitMs || (o.deadline !== undefined && Date.now() >= o.deadline)) {
      await close(generationId, null);
      return (await read(generationId))?.prompt ?? null;
    }
    await sleep(o.pollMs ?? POLL_MS);
  }
}
