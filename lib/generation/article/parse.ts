/**
 * Model javobini o'qish (Maqola 2/3) — IZOMORF, sof.
 *
 * `engine.ts` dan ajratilgan: dvigatel `figures/` (sharp) ni import qiladi,
 * shuning uchun uni sof modullar (`polish.ts`, `article-rewrite.ts`) va
 * hisobot to'g'ridan-to'g'ri import qila olmasdi. Bu yerda faqat JSON →
 * `Block[]` / annotatsiya / kalit so'z parserlari; dvigatel ularni qayta
 * eksport qiladi (eski importlar buzilmaydi).
 */
import type { Block } from "../types";
import { blocksFromText, cleanText } from "../quality";
import { articleLabels } from "./labels";
import { parseLlmObject } from "../json";
import type { ArticleContext } from "./prompts";

/** Har qanday qiymat → tozalangan satr (chegara bilan). */
export const str = (v: unknown, max: number): string => cleanText(String(v ?? "")).slice(0, max);

type RawBlock = { kind?: unknown; text?: unknown };

/** Model bloklari → `Block[]` (faqat p/li/quote; qisqa/bo'sh tashlanadi). */
export function blocksFromLlm(raw: unknown, fallbackText: string): Block[] {
  const list = Array.isArray(raw) ? (raw as RawBlock[]) : [];
  const out: Block[] = [];
  for (const b of list) {
    const text = typeof b === "string" ? cleanText(b) : str(b?.text, 4000);
    if (text.length < 20) continue;
    const kind = b && typeof b === "object" && (b.kind === "li" || b.kind === "quote") ? b.kind : "p";
    out.push({ kind, text });
  }
  if (out.length) return out;
  /*
   * JSON kelgan, lekin `blocks` boshqa nom ostida (`parts`, `paragraphs`,
   * `text`…) — kalitlarni matnga aylantirmaymiz («parts : relevance : …»
   * AUDIT-19 smoke), OBYEKT ichidagi uzun satr qiymatlarini olamiz.
   */
  // Yopilmagan oxirgi qiymat (`"…` qo'shtirnoqsiz tugagan) — kesilgan JSON.
  // `parseLlmObject` qavslarni yopib «tuzatishi» mumkin, lekin bu qiymat tushib qoladi.
  const tailRaw = fallbackText.match(/"((?:[^"\\]|\\.){20,})$/);
  const tailValue = tailRaw ? cleanText(tailRaw[1]!) : "";
  const obj = parseLlmObject<Record<string, unknown>>(fallbackText);
  if (obj && typeof obj === "object") {
    const strings: string[] = [];
    const walk = (v: unknown, depth: number) => {
      if (typeof v === "string") {
        const t = cleanText(v);
        if (t.length >= 20) strings.push(t);
      } else if (Array.isArray(v) && depth < 3) v.forEach((x) => walk(x, depth + 1));
      else if (v && typeof v === "object" && depth < 3) Object.values(v as Record<string, unknown>).forEach((x) => walk(x, depth + 1));
    };
    walk(obj, 0);
    if (tailValue && !strings.some((t) => t.startsWith(tailValue.slice(0, 40)))) strings.push(tailValue);
    if (strings.length) return strings.map((text): Block => ({ kind: "p", text }));
  }
  /*
   * KESILGAN JSON (`max_tokens`, yopilmagan qavs) — `parseLlmObject` null.
   * Qavs/qo'shtirnoqni oddiy o'chirish kalitlarni matnga qoldiradi
   * («parts : relevance : …», AUDIT-19 smoke — worker avto-sayqali,
   * kirish `parts` JSON i kesilgan). Qo'shtirnoq ichidagi uzun satrlar —
   * qiymatlar; kalitlar qisqa, ular tushib qoladi.
   */
  if (/^\s*[{[]/.test(fallbackText)) {
    const values: string[] = [];
    for (const m of fallbackText.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const t = cleanText(m[1]!.replace(/\\n/g, "\n").replace(/\\"/g, '"'));
      if (t.length >= 20) values.push(t);
    }
    if (tailValue) values.push(tailValue);
    if (values.length) return values.map((text): Block => ({ kind: "p", text }));
  }
  // JSON kelmadi/bo'sh — model oddiy matn yozgan bo'lishi mumkin.
  const plain = fallbackText.replace(/^\s*\{[\s\S]*?"blocks"\s*:/, "").replace(/[{}[\]"]/g, " ");
  return /\p{L}{3}/u.test(plain) ? blocksFromText(plain) : [];
}

type AbstractJson = { text?: unknown; background?: unknown; methods?: unknown; results?: unknown; conclusions?: unknown; keywords?: unknown };

export function keywordsFrom(raw: unknown, max: number): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;]/) : [];
  const out: string[] = [];
  for (const k of list) {
    const t = str(k, 60).replace(/[.;]+$/, "");
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Annotatsiya JSON → matn + kalit so'zlar; structured bo'lsa 4 qism yorliq bilan. */
export function abstractFromLlm(raw: string | null, ctx: ArticleContext, lang: string): { text: string; keywords: string[]; words: number } | null {
  if (!raw) return null;
  const j = parseLlmObject<AbstractJson>(raw);
  if (!j) return null;
  const L = articleLabels(lang);
  let text = "";
  if (ctx.type.structuredAbstract) {
    const parts: [string, unknown][] = [
      [L.structured.background, j.background],
      [L.structured.methods, j.methods],
      [L.structured.results, j.results],
      [L.structured.conclusions, j.conclusions],
    ];
    const filled = parts.map(([label, v]) => [label, str(v, 1500)] as const).filter(([, v]) => v);
    text = filled.length >= 3 ? filled.map(([label, v]) => `${label}: ${v}`).join("\n") : str(j.text, 3000);
  } else {
    text = str(j.text, 3000) || [j.background, j.methods, j.results, j.conclusions].map((v) => str(v, 800)).filter(Boolean).join(" ");
  }
  if (text.length < 80) return null;
  const words = (text.match(/\S+/g) ?? []).length;
  return { text, keywords: keywordsFrom(j.keywords, ctx.profile.keywords[1]), words };
}

/** So'z chegarasida kesish (highlights ≤ N belgi). */
export function clipWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const i = cut.lastIndexOf(" ");
  return (i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[,;:\s]+$/, "");
}
