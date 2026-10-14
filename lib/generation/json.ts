/**
 * LLM javobidan JSON ajratish.
 *
 * Modellar ba'zan JSON ni to'liq yopmaydi (oxirgi `}` yoki `]` tushib qoladi),
 * ``` bilan o'raydi, oxirida ortiqcha vergul qoldiradi yoki oldin/keyin matn yozadi.
 * Oddiy `JSON.parse` bunday javobda butunlay yiqiladi — natijada tarjima, dars
 * rejasi, glossariy va slayd kabi bo'limlar bekorga «xatolik» beradi.
 * Shuning uchun avval tozalaymiz, keyin kerak bo'lsa qavslarni o'zimiz yopamiz.
 */

import { rewriteLenient, type RepairKind } from "./json-repair";

function stripFences(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/```(?:json|JSON)?/g, "")
    .replace(/```/g, "")
    .trim();
}

type Scan = {
  /** Yopilishi kerak bo'lgan qavslar, ichkaridan tashqariga. */
  closers: string[];
  /** Matn ochiq satr ichida tugadimi. */
  inString: boolean;
  /** Oxirgi to'liq tugagan qiymat/qavs indeksi. */
  lastSafe: number;
  /** Muvozanat buzilgan (mos kelmagan qavs). */
  broken: boolean;
};

function scan(src: string): Scan {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafe = -1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        lastSafe = i;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] !== ch) return { closers: [], inString, lastSafe, broken: true };
      stack.pop();
      lastSafe = i;
      continue;
    }
    if (/[0-9eltrufasn.+-]/i.test(ch)) lastSafe = i;
  }
  return { closers: stack.reverse(), inString, lastSafe, broken: false };
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Oxiridagi tugallanmagan bo'lakni (satr, son, kalit, vergul, ikki nuqta) olib tashlaydi. */
function dropLastToken(text: string): string {
  const t = text.replace(/\s+$/, "");
  if (!t) return "";
  const last = t[t.length - 1];
  if (last === "," || last === ":") return t.slice(0, -1);
  if (last === '"') {
    // To'liq satrni butunligicha olib tashlaymiz (qochirilgan tirnoqlarni hisobga olib).
    let i = t.length - 2;
    while (i >= 0) {
      if (t[i] === '"') {
        let back = 0;
        while (i - 1 - back >= 0 && t[i - 1 - back] === "\\") back++;
        if (back % 2 === 0) break;
      }
      i--;
    }
    return i >= 0 ? t.slice(0, i) : "";
  }
  // Son yoki true/false/null qoldig'i.
  const m = t.match(/[-0-9.eE+truefalsn]+$/i);
  return m ? t.slice(0, t.length - m[0].length) : t.slice(0, -1);
}

/** Bo'sh obyekt yoki bo'sh massiv — ya'ni hech qanday ma'lumot tutmaydigan idish. */
function isEmptyContainer(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  return Boolean(v) && typeof v === "object" && Object.keys(v as object).length === 0;
}

/**
 * Tiklashdan keyin OXIRIDA qolgan bo'sh idishni tashlaydi.
 *
 * Javob element boshida uzilsa (`…,{"title":"Uch`), tiklash o'sha
 * tugallanmagan bo'lakni tashlab, ochiq qolgan `{` ni yopadi — natijada
 * massiv oxirida `{}` paydo bo'ladi. Bu sintaktik jihatdan to'g'ri,
 * lekin MA'NOSIZ va u hujjatgacha yetib borardi:
 *
 *   • `lessonDoc` — sarlavhasi «Bosqich», matni bo'sh dars bosqichi;
 *   • `writeKeysWithLlm` — vaziyati ham, javobi ham bo'sh «Keys N» bo'limi.
 *
 * Faqat OXIRGI element tashlanadi va faqat tiklash yo'lida: o'rtadagi
 * `{}` modeldan shunday kelgan bo'lishi mumkin, tugallangan javobga esa
 * umuman tegilmaydi.
 *
 * Qisman to'ldirilgan element SAQLANADI: `{"title":"Y","minutes":20}`
 * — `activity` si kesilgan bo'lsa ham foydali, uni tashlash modeldan
 * kelgan matnni yo'qotish bo'lardi.
 */
function dropTrailingEmpty(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out = value.map(dropTrailingEmpty);
    while (out.length && isEmptyContainer(out[out.length - 1])) out.pop();
    return out;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    for (const key of keys) o[key] = dropTrailingEmpty(o[key]);
    /*
     * Obyektning OXIRGI kaliti ham shu holatga tushadi:
     * `{"uz":{…},"en":{"text":"Hel` → `{uz:{…}, en:{}}`. JSON kalit
     * tartibini saqlaydi, ya'ni oxirgi kalit — uzilish paytida
     * yozilayotgani. Bo'sh annotatsiya `en: {}` chaqiruvchini «til
     * keldi, lekin matni yo'q» degan noaniq holatga qo'yardi.
     */
    const last = keys[keys.length - 1];
    if (last !== undefined && isEmptyContainer(o[last])) delete o[last];
    return o;
  }
  return value;
}

/**
 * Tiklash natijasi — bo'sh bo'lsa «tahlil qilinmadi» deb hisoblanadi.
 *
 * `"{"` kabi kirish sintaktik jihatdan `{}` ga tiklanadi, lekin unda
 * hech qanday ma'lumot yo'q. Bunday natijani qaytarish chaqiruvchini
 * chalg'itadi: `parseLlmObject` obyekt beradi, xizmat esa uning
 * maydonlarini `undefined` deb topib, sababni bilmay qoladi. `null`
 * halolroq — «model javob bermadi» aynan shu holat.
 *
 * TUGALLANGAN `{}` javobiga bu tegmaydi: u birinchi yo'ldan
 * (`JSON.parse`) o'tadi va tiklashgacha yetib kelmaydi.
 */
function cleaned(parsed: unknown): unknown {
  const out = dropTrailingEmpty(parsed);
  return isEmptyContainer(out) ? undefined : out;
}

/**
 * Kesilgan JSON ni tiklaydi: ochiq satrni tashlaydi, keyin oxirgi
 * tugallanmagan bo'laklarni birma-bir olib tashlab, qavslarni yopib ko'radi.
 */
function repairTruncated(body: string): unknown {
  const first = scan(body);
  if (first.broken) return undefined;
  // Satr o'rtasida uzilgan bo'lsa — o'sha tugallanmagan qiymatni tashlaymiz.
  let head = first.inString ? body.slice(0, Math.max(0, first.lastSafe + 1)) : body;

  for (let attempt = 0; attempt < 8; attempt++) {
    const trimmed = head.replace(/\s+$/, "").replace(/,$/, "");
    if (!trimmed.trim()) return undefined;
    const st = scan(trimmed);
    if (!st.broken && !st.inString) {
      const candidate = trimmed + st.closers.join("");
      const parsed = tryParse(candidate);
      if (parsed !== undefined) return cleaned(parsed);
      const noTrailing = tryParse(candidate.replace(/,(\s*[}\]])/g, "$1"));
      if (noTrailing !== undefined) return cleaned(noTrailing);
    }
    head = dropLastToken(trimmed);
  }
  return undefined;
}

/** Parse result plus the names of the syntax repairs it needed (`[]` - the answer was clean). */
export type ParsedJson = { value: unknown; repairs: RepairKind[] };

/** Fence / BOM / prose around the value - cheap facts about the raw answer, for the repair counters. */
function wrapperRepairs(raw: string, start: number, endIndex: number, length: number): RepairKind[] {
  const out: RepairKind[] = [];
  if (raw.charCodeAt(0) === 0xfeff) out.push("bom");
  if (raw.includes("```")) out.push("fence");
  if (start > 0 || endIndex < length - 1) out.push("prose");
  return out;
}

/** Indices of the `{` / `[` characters to try as the value start (the first one wins when it parses). */
function startCandidates(text: string, first: number): number[] {
  const out = [first];
  for (let i = first + 1; i < text.length && out.length < 4; i++) {
    if (text[i] === "{" || text[i] === "[") out.push(i);
  }
  return out;
}

/**
 * `parseLlmJson` with the list of repairs that were applied. Order of attempts:
 *   1. the plain value up to the last closing bracket (clean answers, fences, prose);
 *   2. the whole remainder;
 *   3. the lenient SYNTAX rewriter (`json-repair.ts`) from the first bracket, then from the
 *      next few brackets (prose that itself contains `[1]` or `{}` before the real value);
 *   4. the old truncation repair on the raw text.
 */
export function parseLlmJsonDetailed(raw: string | null | undefined): ParsedJson | null {
  if (!raw) return null;
  const cleaned = stripFences(raw);
  if (!cleaned) return null;

  const iObj = cleaned.indexOf("{");
  const iArr = cleaned.indexOf("[");
  const start = iObj < 0 ? iArr : iArr < 0 ? iObj : Math.min(iObj, iArr);
  if (start < 0) return null;

  const endChar = cleaned[start] === "[" ? "]" : "}";
  const body = cleaned.slice(start);

  // 1) Odatdagi holat: oxirgi yopuvchi belgigacha kesamiz.
  const lastClose = body.lastIndexOf(endChar);
  if (lastClose > 0) {
    const direct = tryParse(body.slice(0, lastClose + 1));
    if (direct !== undefined) return { value: direct, repairs: wrapperRepairs(raw, start, start + lastClose, cleaned.length) };
  }

  // 2) Butun qoldiq to'g'ri JSON bo'lishi mumkin.
  const whole = tryParse(body);
  if (whole !== undefined) return { value: whole, repairs: wrapperRepairs(raw, start, cleaned.length - 1, cleaned.length) };

  // 3) Sintaksis tiklash: ortiqcha/yetishmagan vergul, xom yangi qator, noto'g'ri escape, ichki tirnoq, takror obyekt...
  for (const at of startCandidates(cleaned, start)) {
    const r = rewriteLenient(cleaned, at);
    if (!r) continue;
    const parsed = r.incomplete ? repairTruncated(r.text) : tryParse(r.text);
    if (parsed === undefined || isEmptyContainer(parsed)) continue;
    const repairs = [...wrapperRepairs(raw, at, cleaned.length - 1, cleaned.length), ...r.repairs];
    if (r.incomplete) repairs.push("truncated");
    return { value: parsed, repairs };
  }

  // 4) Kesilgan javobni tiklaymiz (eski yo'l).
  const repaired = repairTruncated(body);
  return repaired === undefined ? null : { value: repaired, repairs: [...wrapperRepairs(raw, start, cleaned.length - 1, cleaned.length), "truncated"] };
}

/**
 * LLM javobidan birinchi JSON obyekt/massivni oladi.
 * Javob kesilgan bo'lsa ham qutqarishga harakat qiladi. Bo'lmasa `null`.
 */
export function parseLlmJson(raw: string | null | undefined): unknown {
  return parseLlmJsonDetailed(raw)?.value ?? null;
}

/** `parseLlmJson`, lekin natija obyekt bo'lsagina qaytaradi. */
export function parseLlmObject<T extends object = Record<string, unknown>>(
  raw: string | null | undefined,
): T | null {
  const data = parseLlmJson(raw);
  return data && typeof data === "object" && !Array.isArray(data) ? (data as T) : null;
}
