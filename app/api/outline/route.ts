import { ApiError, handler, json, readJson, requireUser } from "@/lib/server/api";
import { assertFreeLlmEnabled, withFreeLlm } from "@/lib/server/spend";
import { extractMeta } from "@/lib/generation/meta";
import { draftOutline } from "@/lib/generation/write-llm";
import { sanitizeValues } from "@/lib/server/validate";
import { TOOL_BY_SLUG } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reja bir necha soniyada tayyor — uzun byudjet kerak emas. */
const OUTLINE_BUDGET_MS = 45_000;

/**
 * Ish rejasini oldindan ko'rsatadi — BEPUL.
 *
 * Nega bepul: bu bitta arzon LLM chaqiruvi. Uni pulli qilish narxni ikkiga
 * bo'lish, «renderdan voz kechsa outline puli qaytadimi» degan qoida va
 * yangi tranzaksiya turlarini talab qilardi. Bepul bo'lgani uchun
 * foydalanuvchi rejani ko'rib tuzatadi va faqat shundan keyin qimmat
 * generatsiyaga o'tadi — yaroqsiz hujjatlar va qaytarishlar kamayadi.
 *
 * Suiiste'moldan himoya: kirish talab qilinadi; qisqa oyna (12/10 daq),
 * kunlik va global chegara, o'chirish tugmasi — `lib/server/spend.ts`
 * (prod-readiness C10). Chelak faqat yaroqli so'rovda yeyiladi.
 */
export const POST = handler("outline", async (req) => {
  const { user } = await requireUser(req);
  assertFreeLlmEnabled();

  const body = await readJson<{ slug?: unknown; values?: unknown }>(req, 40_000);
  const slug = typeof body.slug === "string" ? body.slug : "";
  const tool = slug ? TOOL_BY_SLUG[slug] : undefined;
  if (!tool) throw new ApiError("Noma'lum vosita", 400);

  const values = sanitizeValues(body.values);
  if (!values) throw new ApiError("Forma qiymatlari noto'g'ri", 400);

  const meta = extractMeta(tool, values);
  if (!meta.topic.trim()) throw new ApiError("Avval mavzuni kiriting", 400);

  // Rejani AI tuzishi so'ralyapti — foydalanuvchi matnini qayta o'qimaymiz.
  const text = await withFreeLlm({ endpoint: "outline", userId: user.id, signal: req.signal }, () =>
    draftOutline({ ...meta, tocMethod: "ai" }, Date.now() + OUTLINE_BUDGET_MS),
  );
  if (!text) throw new ApiError("Reja tuzilmadi — qayta urinib ko'ring", 503);

  return json({ text });
});
