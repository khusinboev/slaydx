import { ApiError, handler, json, requireUser } from "@/lib/server/api";
import { listResults, type GameResult } from "@/lib/server/game-sessions";
import { scorePercent } from "@/lib/game/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CSV maydonini qochirish.
 *
 * `=`, `+`, `-`, `@` bilan boshlanadigan qiymat Excel/Sheets da
 * FORMULA bo'lib ishga tushadi (CSV injection): o'quvchi ismini
 * `=HYPERLINK(...)` deb yozsa, o'qituvchi faylni ochganda uni
 * bosardi. Shuning uchun bunday qiymat oldiga apostrof qo'yiladi.
 */
export function csvCell(v: unknown): string {
  const s = String(v ?? "").replace(/\r?\n/g, " ");
  const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function resultsCsv(rows: GameResult[]): string {
  const head = ["Ism", "Ball", "Jami", "Foiz", "Soniya", "Sana"];
  const body = rows.map((r) => [r.playerName, r.score, r.total, scorePercent(r), r.seconds, r.createdAt].map(csvCell).join(","));
  /*
   * BOM (`﻿`) — Excel CSV ni UTF-8 deb tanishi uchun: usiz
   * o'zbekcha ismlar («Zulfiya») krakozyabra bo'lib ochilardi.
   */
  return `﻿${[head.map(csvCell).join(","), ...body].join("\r\n")}\r\n`;
}

/**
 * O'YIN NATIJALARI (EGASI).
 *
 * Egalik SQL darajasida (`listResults` ichida `s.user_id = $2`) —
 * generatsiya id sini bilgan begona foydalanuvchi o'quvchilar
 * ro'yxatini ololmaydi.
 *
 * `?format=csv` — jadvalni yuklab olish (egasi qarori 8: «natijalar
 * o'qituvchiga, eksport bilan»).
 */
export const GET = handler("generations/results", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  const rows = await listResults(id, user.id);
  const wantsCsv = new URL(req.url).searchParams.get("format") === "csv";
  if (!wantsCsv) {
    return json({
      results: rows.map((r) => ({ ...r, percent: scorePercent(r) })),
      count: rows.length,
    });
  }

  return new Response(resultsCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="natijalar-${id.slice(0, 8)}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
