import "server-only";
import { log } from "./log";

/**
 * Streaming CSV export for admin endpoints (plan §6.0 "Exports", §9, T11).
 *
 * Same conventions as `app/api/generations/[id]/results/route.ts`: UTF-8 BOM so Excel
 * opens Uzbek text correctly, CRLF line ends, every cell quoted, formula-injection
 * guard, pull-based stream for real backpressure. Additions: a hard row cap and
 * Tashkent timestamps for `Date` cells.
 */

export const CSV_MAX_ROWS = 100_000;

/** Tashkent is UTC+5 with no DST; a fixed shift keeps the output independent of the container's ICU data. */
const TASHKENT_OFFSET_MS = 5 * 3600 * 1000;

/** A chunk is flushed once it reaches this size, so one `pull()` never buffers an unbounded amount. */
const CHUNK_BYTES = 32 * 1024;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `Date` -> `DD.MM.YYYY HH:mm` in Asia/Tashkent; an invalid date gives an empty cell. */
export function tashkentStamp(d: Date): string {
  const t = d.getTime();
  if (!Number.isFinite(t)) return "";
  const x = new Date(t + TASHKENT_OFFSET_MS);
  return `${pad2(x.getUTCDate())}.${pad2(x.getUTCMonth() + 1)}.${x.getUTCFullYear()} ${pad2(x.getUTCHours())}:${pad2(x.getUTCMinutes())}`;
}

function cellText(v: unknown): { text: string; numeric: boolean } {
  if (v === null || v === undefined) return { text: "", numeric: false };
  if (v instanceof Date) return { text: tashkentStamp(v), numeric: false };
  if (typeof v === "number") return { text: String(v), numeric: Number.isFinite(v) };
  if (typeof v === "bigint") return { text: v.toString(), numeric: true };
  if (typeof v === "boolean") return { text: v ? "true" : "false", numeric: false };
  if (typeof v === "string") return { text: v, numeric: false };
  try {
    return { text: JSON.stringify(v) ?? "", numeric: false };
  } catch {
    return { text: "", numeric: false };
  }
}

/**
 * One CSV cell, always quoted.
 *
 * A string starting with `= + - @`, TAB or CR is run as a FORMULA by Excel/Sheets (CSV
 * injection), so it gets a leading apostrophe. Real numbers (`typeof number|bigint`) are
 * exempt: a negative balance is data, not an attack vector, and must stay numeric.
 * Quotes are doubled; newlines stay inside the quotes (RFC 4180). NUL bytes are dropped.
 */
export function csvCell(v: unknown): string {
  const { text, numeric } = cellText(v);
  let s = text.replace(/\0/g, "");
  if (!numeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const csvLine = (cells: readonly unknown[]): string => `${cells.map(csvCell).join(",")}\r\n`;

/** Content-Disposition filename: ASCII only, no quotes, separators or control characters. */
export function safeFilename(name: string): string {
  const base = name
    .replace(/\.csv$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 100);
  return `${base || "export"}.csv`;
}

export const capNoticeLine = (max: number): string =>
  csvLine([`#CHEKLOV: eksport ${max.toLocaleString("en-US").replace(/,/g, " ")} qatorga cheklangan — qolgan qatorlar kiritilmadi, filtrlarni toraytiring`]);

const errorNoticeLine = (): string => csvLine(["#XATOLIK: eksport oqim o'rtasida uzildi — qayta urinib ko'ring"]);

export type CsvResponseOptions = {
  filename: string;
  header: readonly string[];
  rows: AsyncIterable<readonly unknown[]>;
  /** Row cap (default {@link CSV_MAX_ROWS}); exposed for tests. */
  maxRows?: number;
  /** Extra response headers (e.g. a request id). Cannot override the security headers below. */
  headers?: Record<string, string>;
};

/**
 * Streams `rows` as a CSV download.
 *
 * Pull-based: rows are requested from the iterator only when the consumer has room, so a
 * slow client never makes the server buffer the export. When the iterator yields MORE than
 * `maxRows` rows the file ends with a notice row instead of silently truncating; exactly
 * `maxRows` rows produce no notice. A mid-stream failure appends an error row and errors
 * the stream (status is already sent), so the browser marks the download as failed.
 */
export function csvResponse(opts: CsvResponseOptions): Response {
  const maxRows = opts.maxRows ?? CSV_MAX_ROWS;
  const encoder = new TextEncoder();
  const iterator = opts.rows[Symbol.asyncIterator]();
  let started = false;
  let emitted = 0;
  let finished = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let buf = "";
      try {
        if (!started) {
          started = true;
          buf = `﻿${csvLine(opts.header)}`;
        }
        while (!finished && buf.length < CHUNK_BYTES) {
          const next = await iterator.next();
          if (next.done) {
            finished = true;
            break;
          }
          if (emitted >= maxRows) {
            // One row beyond the cap exists: say so, and release the source.
            buf += capNoticeLine(maxRows);
            finished = true;
            await iterator.return?.();
            break;
          }
          buf += csvLine(next.value);
          emitted += 1;
        }
        if (buf) {
          controller.enqueue(encoder.encode(buf));
          buf = "";
        }
        if (finished) controller.close();
      } catch (e) {
        log("error", "[admin-csv] export stream failed", { err: e, rows: emitted });
        finished = true;
        try {
          // Rows already read in this pull belong in the file before the notice.
          controller.enqueue(encoder.encode(buf + errorNoticeLine()));
          // Let the reader take the notice before `error()` clears the queue.
          await Promise.resolve();
        } catch {
          // The controller may already be closed or errored.
        }
        controller.error(e instanceof Error ? e : new Error(String(e)));
      }
    },
    async cancel() {
      // Client went away: stop the source (it may hold a DB cursor / pending page).
      finished = true;
      try {
        await iterator.return?.();
      } catch {
        // Nothing more to do for a failed cleanup.
      }
    },
  });

  // `set` (not object spread) so a differently-cased extra header cannot be merged with ours.
  const headers = new Headers(opts.headers);
  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set("Content-Disposition", `attachment; filename="${safeFilename(opts.filename)}"`);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(stream, { status: 200, headers });
}

export type KeysetPage<T> = { items: T[]; nextCursor: string | null };

/**
 * Pages through keyset results in batches, so an export never holds one long query open
 * (§9: pool protection). `fetchPage(cursor, limit)` must return the next `limit` rows after
 * `cursor`. `maxItems` bounds the work: the final page is shortened so no row beyond it is read.
 * For {@link csvResponse} pass `CSV_MAX_ROWS + 1` so the cap notice can still be detected.
 */
export async function* keysetBatches<T>(
  fetchPage: (cursor: string | null, limit: number) => Promise<KeysetPage<T>>,
  batch = 1000,
  maxItems = Number.POSITIVE_INFINITY,
): AsyncGenerator<T[], void, undefined> {
  if (!Number.isInteger(batch) || batch < 1) throw new Error("admin-csv: invalid batch size");
  let cursor: string | null = null;
  let seen = 0;
  while (seen < maxItems) {
    const limit: number = Math.min(batch, maxItems - seen);
    const page: KeysetPage<T> = await fetchPage(cursor, limit);
    if (page.items.length === 0) return;
    const items = page.items.length > limit ? page.items.slice(0, limit) : page.items;
    seen += items.length;
    yield items;
    if (page.nextCursor === null) return;
    // A repeated cursor would loop forever on a buggy fetcher; fail loudly instead.
    if (page.nextCursor === cursor) throw new Error("admin-csv: the cursor did not advance");
    cursor = page.nextCursor;
  }
}

/** Flattens {@link keysetBatches} into single items (and then into CSV rows via `map`). */
export async function* flattenBatches<T, R = T>(batches: AsyncIterable<T[]>, map?: (item: T) => R): AsyncGenerator<R, void, undefined> {
  for await (const b of batches) {
    for (const item of b) yield map ? map(item) : (item as unknown as R);
  }
}
