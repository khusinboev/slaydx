import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { transaction } from "./db";
import { adminTx } from "./admin-audit";
import type { AdminActor } from "./admin-handler";
import { buildKeyset, countCapped, keysetSelect, pageResult, parseListParams, likePrefix, type CursorColumns, type ListSpec, type ParsedList } from "./admin-list";
import { PUBLIC_GAME_KINDS, publicGameView, type PublicGameKind, type PublicGameView } from "../game/public";
import type { AcademicDoc } from "../generation/types";

/**
 * Moderation of public game content (docs/admin/02-plan.md §6.8, §7.1 S12).
 *
 * A "game link" is a `game_sessions` row (anonymous, login-free public URL
 * `/o/<token>`), a "result" is a `game_results` row (a player's attempt; the
 * player name is typed by a stranger, so it is user-controlled text).
 *
 * Rules kept here:
 *   - the list never selects a wide column; the result count is a correlated
 *     `count(*)` over the 500-row-capped, session-indexed `game_results`,
 *     computed only for the page's rows (CTE with the LIMIT inside);
 *   - the preview is `publicGameView(doc, kind, { seed: token })`, exactly the
 *     call of the public route (`app/api/o/[token]/route.ts`), so the admin
 *     sees what a player sees (answers stripped, same option order). The token
 *     itself is a secret and NEVER leaves the server;
 *   - "active" mirrors the public rule in `getGameSessionByToken`: a link is
 *     dead once `expires_at <= now()` (NULL = never expires = active);
 *   - revoke sets `expires_at = now()` and so reuses that public rule: the
 *     public route answers 404 afterwards, no second code path to keep in sync;
 *   - every mutation writes its audit row(s) in the same transaction.
 */

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Detail shows at most this many results; `link.results` carries the true count. */
export const DETAIL_RESULTS_LIMIT = 200;
/** Bulk delete cap (§6.8). */
export const BULK_DELETE_MAX = 100;
/** `q` (topic prefix) cap in characters (§6.8). */
export const TOPIC_QUERY_MAX = 100;

const notFound = (): ApiError => new ApiError("Topilmadi", 404, { code: "not_found" });

/** Strict id parse: anything that is not a UUID is a plain 404, never a 500. */
export function parseModerationId(raw: string): string {
  if (!UUID_RE.test(raw)) throw notFound();
  return raw.toLowerCase();
}

async function readOnly<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    return fn(client);
  });
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

export const LINKS_LIST_SPEC = {
  sorts: {
    created_desc: { column: "gs.created_at", dir: "DESC", type: "timestamptz" },
  },
  id: { column: "gs.id", type: "uuid" },
  filters: {
    active: { kind: "flag" },
    kind: { kind: "enum", values: PUBLIC_GAME_KINDS },
    userId: { kind: "int", min: 1, max: Number.MAX_SAFE_INTEGER },
  },
  range: {},
} as const satisfies ListSpec;

export type LinksListParams = ParsedList<typeof LINKS_LIST_SPEC> & {
  /** Lower-cased topic prefix, `null` when absent. */
  topicPrefix: string | null;
};

/**
 * `q`: case-insensitive topic PREFIX, at most 100 characters. A repeated `q`
 * or an over-long one is a 400; NUL is dropped (invalid in Postgres text).
 */
export function parseTopicQuery(url: URL): string | null {
  const all = url.searchParams.getAll("q");
  if (all.length > 1) throw new ApiError("Noto'g'ri parametr: q", 400);
  const raw = (all[0] ?? "").replace(/\0/g, "").trim();
  if (raw === "") return null;
  if (Array.from(raw).length > TOPIC_QUERY_MAX) throw new ApiError(`Qidiruv ${TOPIC_QUERY_MAX} belgidan oshmasligi kerak`, 400);
  return raw.toLowerCase();
}

export function parseLinksQuery(url: URL): LinksListParams {
  return { ...parseListParams(url, LINKS_LIST_SPEC), topicPrefix: parseTopicQuery(url) };
}

export type ModerationLink = {
  id: string;
  generationId: string;
  userId: string;
  userName: string;
  kind: PublicGameKind;
  topic: string;
  createdAt: string;
  /** `null` = never expires. */
  expiresAt: string | null;
  active: boolean;
  /** Number of results of this link (all of them, not only the shown ones). */
  results: number;
};

type LinkRow = {
  id: string;
  generation_id: string;
  user_id: string;
  user_name: string;
  kind: string;
  topic: string;
  created_at: Date;
  expires_at: Date | null;
  active: boolean;
  results: string;
};

const LINK_FROM = `FROM game_sessions gs
  JOIN generations g ON g.id = gs.generation_id
  JOIN users u ON u.id = gs.user_id`;

/** Inner projection; `sid`/`ts` keep the raw uuid / timestamptz for the outer ORDER BY. */
const LINK_COLUMNS = `gs.id AS sid, gs.created_at AS ts, gs.id::text AS id, gs.generation_id::text AS generation_id,
       gs.user_id::text AS user_id, u.name AS user_name, gs.kind, g.topic, gs.created_at, gs.expires_at,
       (gs.expires_at IS NULL OR gs.expires_at > now()) AS active`;

const RESULTS_COUNT = `(SELECT count(*)::text FROM game_results r WHERE r.session_id = page.sid) AS results`;

function toLink(r: Omit<LinkRow, never>): ModerationLink {
  return {
    id: r.id,
    generationId: r.generation_id,
    userId: r.user_id,
    userName: r.user_name,
    kind: r.kind as PublicGameKind,
    topic: r.topic,
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: iso(r.expires_at),
    active: r.active,
    results: Number(r.results),
  };
}

/** WHERE conditions of the list filters; user values only travel as `$n`. */
function whereFor(p: LinksListParams, params: unknown[]): string[] {
  const conds: string[] = [];
  const add = (v: unknown): number => params.push(v);
  const f = p.filters;
  if (f.active === true) conds.push("(gs.expires_at IS NULL OR gs.expires_at > now())");
  if (f.active === false) conds.push("gs.expires_at <= now()");
  if (f.kind) conds.push(`gs.kind = $${add(f.kind)}`);
  if (f.userId !== undefined) conds.push(`gs.user_id = $${add(String(f.userId))}::bigint`);
  // LIKE's default escape character is the backslash, which `likePrefix` uses.
  // `lower(topic)` (not ILIKE) so a future `lower(topic) text_pattern_ops` index can serve it.
  if (p.topicPrefix !== null) conds.push(`lower(g.topic) LIKE $${add(likePrefix(p.topicPrefix))}`);
  if (p.range) {
    conds.push(`gs.created_at >= $${add(p.range.fromTs)}::timestamptz`);
    conds.push(`gs.created_at < $${add(p.range.toTsExclusive)}::timestamptz`);
  }
  return conds;
}

export type LinksListResult = {
  items: ModerationLink[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

export async function listModerationLinks(p: LinksListParams): Promise<LinksListResult> {
  return readOnly(async (client) => {
    const params: unknown[] = [];
    const conds = whereFor(p, params);
    const ks = buildKeyset({ sort: p.sort, cursor: p.cursor, id: LINKS_LIST_SPEC.id, paramOffset: params.length });
    const all = [...params, ...ks.params, p.limit + 1];
    const res = await client.query<LinkRow & CursorColumns>(
      `WITH page AS (
         SELECT ${LINK_COLUMNS}, ${keysetSelect(p.sort, LINKS_LIST_SPEC.id)}
           ${LINK_FROM}
          WHERE ${[...conds, ks.where].join(" AND ")}
          ORDER BY ${ks.orderBy}
          LIMIT $${all.length}
       )
       SELECT page.id, page.generation_id, page.user_id, page.user_name, page.kind, page.topic,
              page.created_at, page.expires_at, page.active, page.cursor_v, page.cursor_id, ${RESULTS_COUNT}
         FROM page
        ORDER BY page.ts DESC, page.sid DESC`,
      all,
    );
    const page = pageResult(res.rows, p.limit, p.sort);
    // The count needs neither the user join nor the result counts.
    const cparams: unknown[] = [];
    const cconds = whereFor(p, cparams);
    const count = await countCapped(
      client,
      `FROM game_sessions gs JOIN generations g ON g.id = gs.generation_id WHERE ${cconds.length ? cconds.join(" AND ") : "TRUE"}`,
      cparams,
    );
    return { items: page.items.map(toLink), nextCursor: page.nextCursor, ...count };
  });
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                     */
/* -------------------------------------------------------------------------- */

export type ModerationResult = {
  id: string;
  playerName: string;
  score: number;
  total: number;
  createdAt: string;
};

export type ModerationLinkDetail = {
  link: ModerationLink;
  /** The answer-stripped view a player gets; `null` when the public route would have none (job not COMPLETED, or the document is not a game). */
  preview: PublicGameView | null;
  /** The newest `DETAIL_RESULTS_LIMIT` results. */
  results: ModerationResult[];
};

/** One link in the list-item shape; `client` may be inside a mutation's transaction. */
async function fetchLink(client: Pick<PoolClient, "query">, id: string): Promise<ModerationLink | null> {
  const res = await client.query<LinkRow>(
    `WITH page AS (SELECT ${LINK_COLUMNS} ${LINK_FROM} WHERE gs.id = $1)
     SELECT page.id, page.generation_id, page.user_id, page.user_name, page.kind, page.topic,
            page.created_at, page.expires_at, page.active, ${RESULTS_COUNT}
       FROM page`,
    [id],
  );
  const r = res.rows[0];
  return r ? toLink(r) : null;
}

export async function getModerationLink(id: string): Promise<ModerationLinkDetail> {
  return readOnly(async (client) => {
    const link = await fetchLink(client, id);
    if (!link) throw notFound();
    // The token and the document are read here only to build the preview; neither is returned.
    const src = await client.query<{ token: string; doc_json: AcademicDoc | null; status: string }>(
      `SELECT gs.token, g.doc_json, g.status
         FROM game_sessions gs JOIN generations g ON g.id = gs.generation_id
        WHERE gs.id = $1`,
      [id],
    );
    const s = src.rows[0];
    // Same conditions as the public route: COMPLETED job, document present, a view that builds.
    const preview = s && s.doc_json && s.status === "COMPLETED" ? publicGameView(s.doc_json, link.kind, { seed: s.token }) : null;
    const rows = await client.query<{ id: string; player_name: string; score: number; total: number; created_at: Date }>(
      `SELECT id::text AS id, player_name, score, total, created_at
         FROM game_results
        WHERE session_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT ${DETAIL_RESULTS_LIMIT}`,
      [id],
    );
    return {
      link,
      preview,
      results: rows.rows.map((r) => ({
        id: r.id,
        playerName: r.player_name,
        score: Number(r.score),
        total: Number(r.total),
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Revoke                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Kills a link: `expires_at = now()`. Idempotency decision: an already dead
 * link (revoked before, or expired by time) answers 409 `{code:"state"}` and
 * writes NO audit row, so the log never holds a revoke that changed nothing and
 * a double click or a stale list shows an honest message.
 */
export async function revokeLink(actor: AdminActor, id: string, reason: string): Promise<{ link: ModerationLink }> {
  return adminTx(actor, async (client, audit) => {
    const cur = await client.query<{ expires_at: Date | null; active: boolean }>(
      `SELECT expires_at, (expires_at IS NULL OR expires_at > now()) AS active FROM game_sessions WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = cur.rows[0];
    if (!row) throw notFound();
    if (!row.active) throw new ApiError("Havola allaqachon o'chirilgan yoki muddati tugagan", 409, { code: "state" });
    const upd = await client.query<{ expires_at: Date }>(`UPDATE game_sessions SET expires_at = now() WHERE id = $1 RETURNING expires_at`, [id]);
    await audit({
      action: "moderation.revoke",
      targetType: "game_session",
      targetId: id,
      reason,
      before: { expiresAt: iso(row.expires_at), active: true },
      after: { expiresAt: iso(upd.rows[0]!.expires_at), active: false },
    });
    const link = await fetchLink(client, id);
    return { link: link! };
  });
}

/* -------------------------------------------------------------------------- */
/* Delete results                                                             */
/* -------------------------------------------------------------------------- */

type ResultRow = {
  id: string;
  session_id: string;
  player_name: string;
  score: number;
  total: number;
  seconds: number;
  answers_json: unknown;
  ip_hash: string | null;
  submission_id: string | null;
  created_at: Date;
};

const RESULT_COLUMNS = `id::text AS id, session_id::text AS session_id, player_name, score, total, seconds, answers_json,
       ip_hash, submission_id, created_at`;

/** The full row as the audit `before` (§8: a deleted row must be recoverable from the log). */
function auditRow(r: ResultRow): Record<string, unknown> {
  return {
    id: r.id,
    sessionId: r.session_id,
    playerName: r.player_name,
    score: Number(r.score),
    total: Number(r.total),
    seconds: Number(r.seconds),
    answers: r.answers_json,
    ipHash: r.ip_hash,
    submissionId: r.submission_id,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function deleteResult(actor: AdminActor, id: string, reason: string): Promise<{ ok: true }> {
  return adminTx(actor, async (client, audit) => {
    const cur = await client.query<ResultRow>(`SELECT ${RESULT_COLUMNS} FROM game_results WHERE id = $1 FOR UPDATE`, [id]);
    const row = cur.rows[0];
    if (!row) throw notFound();
    await client.query(`DELETE FROM game_results WHERE id = $1`, [id]);
    await audit({
      action: "moderation.result.delete",
      targetType: "game_result",
      targetId: id,
      reason,
      before: auditRow(row),
      meta: { sessionId: row.session_id },
    });
    return { ok: true as const };
  });
}

/** `{ids}` of the bulk delete: 1..100 distinct UUIDs (case-folded), anything else is a 400. */
export function parseBulkIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ApiError("ids bo'sh bo'lmagan ro'yxat bo'lishi kerak", 400);
  if (raw.length > BULK_DELETE_MAX) throw new ApiError(`Bir so'rovda ko'pi bilan ${BULK_DELETE_MAX} ta natija o'chiriladi`, 400);
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !UUID_RE.test(v)) throw new ApiError("ids ichida noto'g'ri identifikator bor", 400);
    const id = v.toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Deletes several results in ONE transaction: all ids must exist (otherwise 404
 * listing the missing ones and nothing is deleted) and each id gets its own
 * audit row with the full deleted row.
 */
export async function deleteResults(actor: AdminActor, ids: string[], reason: string): Promise<{ ok: true; deleted: number }> {
  return adminTx(actor, async (client, audit) => {
    // Ordered locking keeps two overlapping bulk deletes from deadlocking.
    const cur = await client.query<ResultRow>(`SELECT ${RESULT_COLUMNS} FROM game_results WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [ids]);
    if (cur.rows.length !== ids.length) {
      const found = new Set(cur.rows.map((r) => r.id));
      throw new ApiError("Ba'zi natijalar topilmadi", 404, { code: "not_found", missing: ids.filter((id) => !found.has(id)) });
    }
    await client.query(`DELETE FROM game_results WHERE id = ANY($1::uuid[])`, [ids]);
    for (const row of cur.rows) {
      await audit({
        action: "moderation.result.delete",
        targetType: "game_result",
        targetId: row.id,
        reason,
        before: auditRow(row),
        meta: { sessionId: row.session_id, bulk: true, count: ids.length },
      });
    }
    return { ok: true as const, deleted: cur.rows.length };
  });
}
