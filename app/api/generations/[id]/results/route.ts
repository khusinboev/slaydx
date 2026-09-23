import { ApiError, handler, json, requireUser } from "@/lib/server/api";
import { iterateAllResults, listResults, type GameResult } from "@/lib/server/game-sessions";
import { scorePercent } from "@/lib/game/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

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

const CSV_HEAD = ["Ism", "Ball", "Jami", "Foiz", "Soniya", "Sana"];
const csvLine = (cells: unknown[]): string => cells.map(csvCell).join(",");

/** Sarlavha qatori — CRLF bilan (CSV standarti, Excel talab qiladi). */
export function csvHeadLine(): string {
  return `${csvLine(CSV_HEAD)}\r\n`;
}

/** Bitta natija qatori — `resultsCsv` ham, oqim eksporti ham shundan foydalanadi. */
export function csvRowLine(r: GameResult): string {
  return `${csvLine([r.playerName, r.score, r.total, scorePercent(r), r.seconds, r.createdAt])}\r\n`;
}

export function resultsCsv(rows: GameResult[]): string {
  /*
   * BOM (`﻿`) — Excel CSV ni UTF-8 deb tanishi uchun: usiz
   * o'zbekcha ismlar («Zulfiya») krakozyabra bo'lib ochilardi.
   */
  return `﻿${csvHeadLine()}${rows.map(csvRowLine).join("")}`;
}

/** `?before=&beforeId=` — keyingi sahifa kursori (DB-15). Yaroqsiz bo'lsa — birinchi sahifa. */
function parseCursor(url: URL): { createdAt: string; id: string } | undefined {
  const createdAt = url.searchParams.get("before");
  const id = url.searchParams.get("beforeId");
  if (!createdAt || !id || !ISO_DATE.test(createdAt) || !UUID.test(id)) return undefined;
  return { createdAt, id };
}

/**
 * O'YIN NATIJALARI (EGASI).
 *
 * Egalik SQL darajasida (`listResults` ichida `s.user_id = $2`) —
 * generatsiya id sini bilgan begona foydalanuvchi o'quvchilar
 * ro'yxatini ololmaydi.
 *
 * `?format=csv` — jadvalni yuklab olish (egasi qarori 8: «natijalar
 * o'qituvchiga, eksport bilan»). DB-15/BEA-16: eksport eski `LIMIT 500`
 * bilan jimgina kesilardi — endi `iterateAllResults` BARCHA qatorlarni
 * kursor bo'yicha partiyalab, to'g'ridan-to'g'ri oqimga yozadi (bitta
 * katta massiv xotirada yig'ilmaydi). Oddiy JSON ko'rinish esa
 * `?before=&beforeId=` bilan sahifalanadi, `total` — HAQIQIY son.
 */
export const GET = handler("generations/results", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "csv") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`﻿${csvHeadLine()}`));
          for await (const batch of iterateAllResults(id, user.id)) {
            for (const r of batch) controller.enqueue(encoder.encode(csvRowLine(r)));
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="natijalar-${id.slice(0, 8)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const limitParam = Number(url.searchParams.get("limit"));
  const page = await listResults(id, user.id, {
    limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
    before: parseCursor(url),
  });
  return json({
    results: page.rows.map((r) => ({ ...r, percent: scorePercent(r) })),
    // `count` — shu sahifaning uzunligi (eski maydon, moslik uchun); `total` — HAQIQIY son (DB-15).
    count: page.rows.length,
    total: page.total,
    nextCursor: page.nextCursor,
  });
});
