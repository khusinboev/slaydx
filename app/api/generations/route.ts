import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { clampListLimit, decodeCursor, listGenerations } from "@/lib/server/jobs";
import { sanitizeValues } from "@/lib/server/validate";
import { TOOL_BY_SLUG } from "@/lib/tools";
import { startInlineWorker } from "@/lib/server/worker";
import { env } from "@/lib/server/env";
import { submitGeneration } from "@/lib/server/submit-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Foydalanuvchining o'z generatsiyalari. Boshqa userniki chiqmaydi.
 *
 * Kursor bilan sahifalash (BEA-06, FE-08): `?limit=1..100` (standart 50)
 * va `?cursor=<oldingi javobdagi nextCursor>`. Javob kaliti `generations`
 * o'zgarmagan, qo'shimcha `nextCursor` (`null` — oxirgi sahifa).
 */
export const GET = handler("generations/list", async (req) => {
  const { user } = await requireUser(req);
  const params = new URL(req.url).searchParams;
  const rawCursor = params.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) throw new ApiError("Noto'g'ri kursor", 400);
  const { items, nextCursor } = await listGenerations(user.id, {
    limit: clampListLimit(params.get("limit")),
    cursor,
  });
  return json({ generations: items, nextCursor });
});

/**
 * Yangi generatsiyani navbatga qo'yadi.
 *
 * Muhim farqlar (ilgari `/api/generate` shu ishni qilardi):
 *   - kirish talab qilinadi — anonim so'rov pullik LLM ni chaqira olmaydi,
 *   - narx **serverda** hisoblanadi — klient yuborgan `price` e'tiborsiz,
 *   - pul yechish va navbatga qo'yish bitta tranzaksiyada,
 *   - hujjat HTTP ichida emas, worker da yaratiladi (timeout yo'q).
 */
export const POST = handler("generations/create", async (req) => {
  const { user } = await requireUser(req);

  // Ikki qatlam: qisqa portlash va soatlik umumiy chegara.
  await limit(`gen:burst:${user.id}`, 5, 60);
  await limit(`gen:hour:${user.id}`, 60, 3600);

  // Takroriy yuborish (javob yo'qolgan) ikkinchi marta pul yechmasin (C34).
  const idempotencyKey = readIdempotencyKey(req);

  /*
   * 1 200 000 bayt: tarjima chegarasi 200 000 BELGI, kirill/o'zbek matni
   * UTF-8 da belgisiga ~2 bayt, JSON qochirish (`\n`, `\"`) esa ustiga
   * qo'shadi — 400 000 bayt oldin 200 000 belgilik matnni «So'rov hajmi
   * juda katta» deb rad etardi.
   */
  const body = await readJson<{ slug?: unknown; values?: unknown; expectedPrice?: unknown }>(req, 1_200_000);
  const expectedPrice = readExpectedPrice(body.expectedPrice);
  const slug = typeof body.slug === "string" ? body.slug : "";
  const tool = slug ? TOOL_BY_SLUG[slug] : undefined;
  if (!tool) throw new ApiError("Noma'lum vosita", 400);

  const values = sanitizeValues(body.values);
  if (!values) throw new ApiError("Forma qiymatlari noto'g'ri", 400);

  const result = await submitGeneration({ userId: user.id, tool, values, idempotencyKey, expectedPrice });
  if (result.kind === "admission") {
    const { code, retryAfterSec, error } = result;
    return json(
      { error, code, retryAfterSec },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  // Inline rejimda worker shu processda ishlaydi — birinchi so'rovda uyg'otamiz.
  if (env.worker.inline) startInlineWorker();

  /*
   * Takror (shu kalit bilan avval yaratilgan ish) — ASL javob bilan AYNAN bir
   * xil: o'sha id, o'sha (yechilgan) narx, o'sha status kodi. Klient javobni
   * yo'qotib qayta yuborganini bilmasligi ham mumkin — farq faqat sarlavhada.
   */
  return json(
    { id: result.id, price: result.price, status: "QUEUED" },
    { status: 202, headers: result.replayed ? { "Idempotent-Replayed": "true" } : undefined },
  );
});

/**
 * Optional `expectedPrice` (the price the client displayed). Absent: `undefined`;
 * present but not a non-negative safe integer: 400.
 */
function readExpectedPrice(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    throw new ApiError("Kutilgan narx noto'g'ri", 400);
  }
  return raw;
}

const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `Idempotency-Key` sarlavhasi (C34, klient shartnomasi: UUID v4). Yo'q —
 * `undefined` (eski xatti-harakat). Bor, lekin UUID emas — 400: noto'g'ri
 * kalitni jim e'tiborsiz qoldirish klientni «himoyalangan» deb aldardi.
 * Katta-kichik harf farq qilmaydi (bazada kichik harfda).
 */
function readIdempotencyKey(req: Request): string | undefined {
  const raw = req.headers.get("idempotency-key");
  if (raw === null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!IDEMPOTENCY_KEY_RE.test(key)) throw new ApiError("Idempotency-Key UUID bo'lishi kerak", 400);
  return key;
}
