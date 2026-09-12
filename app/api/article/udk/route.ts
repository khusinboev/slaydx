import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { complete } from "@/lib/generation/llm-roles";
import { UDK_TOPIC_MAX, parseUdk, udkSystemPrompt, udkUserPrompt } from "@/lib/generation/article/udk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UDK_TIMEOUT_MS = 20_000;

/**
 * UDK taklifi (Maqola 3, AUDIT-18 Q-4) — formadagi «Taklif» tugmasi.
 *
 * `{topic, language}` → `fast` rol → `{udk, label, note}`. Dvigatel UDK ni
 * o'zi to'ldirmaydi (noto'g'ri UDK bilan jurnal qaytaradi) — bu faqat
 * TAKLIF, javobda doim «tekshiring» izohi. Bepul, chegara 30/soat.
 */
export const POST = handler("article/udk", async (req) => {
  const { user } = await requireUser(req);
  await limit(`udk:${user.id}`, 30, 3600);

  const body = await readJson<{ topic?: unknown; language?: unknown }>(req, 4 * 1024);
  const topic = typeof body?.topic === "string" ? body.topic.replace(/\s+/g, " ").trim() : "";
  if (topic.length < 3) throw new ApiError("Avval mavzuni kiriting", 400);
  if (topic.length > UDK_TOPIC_MAX) throw new ApiError(`Mavzu ${UDK_TOPIC_MAX} belgidan uzun`, 400);
  const language = body?.language === "ru" || body?.language === "en" ? body.language : "uz";

  const r = await complete("fast", udkSystemPrompt(), udkUserPrompt(topic, language), { json: true, maxTokens: 200, timeoutMs: UDK_TIMEOUT_MS });
  const s = parseUdk(r?.text);
  if (!s) throw new ApiError("UDK taklif qilinmadi — qayta urinib ko'ring yoki jurnal talabidan oling", 503);
  return json(s);
});
