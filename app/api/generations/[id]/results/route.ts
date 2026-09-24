import { ApiError, handler, json, requireUser } from "@/lib/server/api";
import { iterateAllResultRows, listResults, type GameResult } from "@/lib/server/game-sessions";
import { scorePercent } from "@/lib/game/score";
import { parseIsoInstant } from "@/lib/server/validate";

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

/**
 * Oqim ORTASIDA (masalan baza ulanishi uzilib) yiqilsa qo'shiladigan
 * QATOR (Sharh R2). Sarlavhalar allaqachon `200 OK` bilan yuborilgan —
 * status endi o'zgartirib bo'lmaydi, shuning uchun oqim `controller.error()`
 * bilan XATOGA chiqariladi (brauzer yuklab olishni "muvaffaqiyatsiz"
 * deb ko'rsatadi) VA bu qator baribir yoziladi — kimdir faylni qo'lda
 * ochsa ham, oxiri KESILGAN emas, ANIQ XABARLI ekanini ko'radi.
 */
export function csvErrorMarkerLine(): string {
  return csvLine(["#XATOLIK: eksport oqim o'rtasida uzildi — qayta urinib ko'ring yoki o'qituvchi qo'llab-quvvatlashga murojaat qiling", "", "", "", "", ""]) + "\r\n";
}

/**
 * `?before=&beforeId=` — keyingi sahifa kursori (DB-15). Yaroqsiz bo'lsa — birinchi sahifa.
 * Sana HAQIQIY bo'lishi shart (BEA-13): `2026-02-30T…Z` ilgari regex dan
 * o'tib, `::timestamptz` da 500 berardi.
 */
function parseCursor(url: URL): { createdAt: string; id: string } | undefined {
  const createdAt = parseIsoInstant(url.searchParams.get("before"));
  const id = url.searchParams.get("beforeId");
  if (!createdAt || !id || !UUID.test(id)) return undefined;
  return { createdAt, id };
}

/**
 * CSV oqimi — `pull()` asosida (Sharh R2), `rows` dan (odatda
 * `iterateAllResultRows`) TALAB QILINGANDA bitta qator so'raydi:
 * haqiqiy backpressure, `start()` kabi hammasini bir yo'la navbatga
 * qo'ymaydi. Bitta AJRATILGAN funksiya sifatida (route handler'dan
 * tashqarida) — soxta `rows` generator bilan DB SIZ sinaladi
 * (`tests/game-routes.test.mts`).
 *
 * Xato: sarlavhalar allaqachon `200`ga yuborilgan bo'lishi mumkin,
 * status endi o'zgarmaydi. Shuning uchun (a) `onError` bilan LOG
 * qoldiramiz (ilgari `finally{close()}` buni butunlay yutib yuborardi),
 * (b) marker qator qo'shamiz (fayl qo'lda ochilsa ham kesilgan emas,
 * XABARLI ko'rinsin) — `controller.error()`dan OLDIN, bitta mikrovazifa
 * kechiktirib (navbatdagi o'quvchi shu qatorni ULGURIB o'qishi uchun,
 * chunki `error()` navbatni tozalaydi), (c) `controller.error()` bilan
 * oqimni XATOGA chiqaramiz — brauzer yuklab olishni tugallanmagan/
 * muvaffaqiyatsiz deb ko'rsatadi.
 */
export function csvStream(rows: AsyncGenerator<GameResult>, onError: (e: unknown) => void = () => {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let headSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headSent) {
          controller.enqueue(encoder.encode(`﻿${csvHeadLine()}`));
          headSent = true;
        }
        const { value, done } = await rows.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(csvRowLine(value)));
      } catch (e) {
        onError(e);
        try {
          controller.enqueue(encoder.encode(csvErrorMarkerLine()));
          // Navbatni bo'shatishga bitta mikrovazifa beramiz — aks holda
          // darrov chaqirilgan `controller.error()` shu qatorni ham
          // o'qilmasdan navbatdan olib tashlashi mumkin.
          await Promise.resolve();
        } catch {
          // controller allaqachon yopilgan/xato bo'lgan bo'lishi mumkin — e'tiborsiz.
        }
        controller.error(e instanceof Error ? e : new Error(String(e)));
      }
    },
    cancel() {
      // Yuklab olish bekor qilinsa (brauzer tab yopildi) — generatorni ham to'xtatamiz.
      void rows.return?.(undefined).catch(() => {});
    },
  });
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
 * bilan jimgina kesilardi — endi `iterateAllResultRows` BARCHA
 * qatorlarni kursor bo'yicha partiyalab beradi. Oqim `pull()` orqali —
 * har chaqiriqda ANIQ bitta qator (Sharh R2): shuning uchun HAQIQIY
 * backpressure bor (sekin/yo'q iste'molchida baza ortiqcha so'ralmaydi)
 * va baza o'rtada yiqilsa, oqim `controller.error()` bilan aniq XATOGA
 * chiqadi (`start()` + `finally { close() }` naqshi buni "muvaffaqiyatli,
 * lekin kesilgan" 200 qilib ko'rsatardi — aynan BEA-16 ning o'zi). Oddiy
 * JSON ko'rinish esa `?before=&beforeId=` bilan sahifalanadi, `total` —
 * HAQIQIY son.
 */
export const GET = handler("generations/results", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "csv") {
    const stream = csvStream(iterateAllResultRows(id, user.id), (e) => {
      // Sharh R2: ilgari `finally { controller.close() }` xatoni YUTIB
      // yuborardi — 200 va yashirin, hech qayerda LOG bo'lmagan xato.
      console.error(`[generations/results csv] id=${id} user=${user.id}:`, e instanceof Error ? e.message : String(e));
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
