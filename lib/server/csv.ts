import "server-only";
import { scorePercent } from "@/lib/game/score";
import type { GameResult } from "./game-sessions";

/**
 * CSV helpers shared by the game results export (`GET …/results?format=csv`)
 * and the download producers (`results-csv`, `glossary-csv`,
 * `lib/server/downloads/producers.ts`). One source, so the file a teacher
 * downloads from the results table and the one the download sheet / Telegram
 * «Saqlash» sends are byte-identical row by row.
 */

/** UTF-8 BOM: Excel opens CSV as UTF-8 only with it (Uzbek names otherwise break). */
export const CSV_BOM = "﻿";

/**
 * One CSV field, always quoted.
 *
 * A value starting with `=`, `+`, `-`, `@` (or TAB) runs as a FORMULA in
 * Excel/Sheets (CSV injection): a pupil who types `=HYPERLINK(...)` as their
 * name would get the teacher to click it. Such a value is prefixed with an
 * apostrophe. Newlines become spaces (one record per line).
 */
export function csvCell(v: unknown): string {
  const s = String(v ?? "").replace(/\r?\n/g, " ");
  const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** One record with the CRLF line end (CSV standard; Excel expects it). */
export function csvRecord(cells: readonly unknown[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

const RESULTS_HEAD = ["Ism", "Ball", "Jami", "Foiz", "Soniya", "Sana"];

/** Header record of the game results CSV. */
export function csvHeadLine(): string {
  return csvRecord(RESULTS_HEAD);
}

/** Tashkent: UTC+5, no daylight saving (same value as `spend.ts` `TASHKENT_UTC_OFFSET_SEC`). */
const TASHKENT_OFFSET_MS = 5 * 3600 * 1000;

/**
 * UTC instant → `YYYY-MM-DD HH:mm` in Tashkent time (BEA-14).
 *
 * The server runs in UTC; the CSV used to carry `2026-09-23T04:12:00.000Z` —
 * five hours behind for the teacher, and Excel read it as text. This shape
 * opens as a date-time cell. The offset is fixed (+5 h), independent of the
 * container's ICU time-zone data. An invalid value is returned unchanged, so
 * one bad row never fails the export.
 */
export function tashkentDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + TASHKENT_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** One game result record (the streaming export and `results-csv` both use it). */
export function csvRowLine(r: GameResult): string {
  return csvRecord([r.playerName, r.score, r.total, scorePercent(r), r.seconds, tashkentDateTime(r.createdAt)]);
}
