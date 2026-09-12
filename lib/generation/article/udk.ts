/**
 * UDK TAKLIFI (Maqola 3, AUDIT-18 Q-4) — sof, izomorf: prompt + javob
 * tahlili. LLM `fast` roli bilan chaqiruv `app/api/article/udk` da;
 * dvigatel UDK ni JIMGINA to'ldirmaydi — bu FORMADAGI taklif, foydalanuvchi
 * jurnal talabiga qarab tekshiradi (`UDK_NOTE` javobda doim bor).
 */
import { ARTICLE_LIMITS } from "./types";
import { parseLlmObject } from "../json";
import { cleanText } from "../quality";

export const UDK_NOTE = "AI taklifi — jurnal talabiga qarab tekshiring";
export const UDK_TOPIC_MAX = 300;
/** UDK sinf ko'rinishi: raqamlar, nuqta, `:`/`+`/`/`/`-`/`(…)`/`"…"`/`=` va bo'shliq (masalan `621.7:004.9`, `37.02(575.1)`). */
const UDK_RE = /^\d{1,3}(?:[\d.:+/=\-()"' ]{0,36})$/;

export type UdkSuggestion = { udk: string; label: string; note: string };

export function udkSystemPrompt(): string {
  return [
    "You are a scientific librarian assigning a UDC (Universal Decimal Classification, «UDK/УДК») class to a journal article.",
    "Return ONLY a JSON object: {\"udk\":\"<UDC notation>\",\"label\":\"<short class name>\"}.",
    "Rules: the notation must be a real UDC class (main table, optionally with a colon-combined second class, e.g. 621.7:004.9 or 37.02); prefer the most specific class you are confident in, otherwise a broader one; no explanations.",
    "The label is the class name in the language requested (2–8 words).",
  ].join("\n");
}

export function udkUserPrompt(topic: string, language: string): string {
  const lang = language === "ru" ? "Russian" : language === "en" ? "English" : "Uzbek (Latin)";
  return [`Article topic: ${topic.trim()}`, `Label language: ${lang}.`].join("\n");
}

/** Model javobi → taklif; UDK shakli yaroqsiz bo'lsa `null` (uydirma belgi/matn qabul qilinmaydi). */
export function parseUdk(raw: string | null | undefined): UdkSuggestion | null {
  const j = parseLlmObject<{ udk?: unknown; label?: unknown }>(raw ?? "");
  if (!j) return null;
  const udk = cleanText(String(j.udk ?? ""))
    .replace(/^(?:UDK|UDC|УДК)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ARTICLE_LIMITS.udkChars);
  if (!udk || !UDK_RE.test(udk)) return null;
  const label = cleanText(String(j.label ?? "")).slice(0, 120);
  return { udk, label, note: UDK_NOTE };
}
