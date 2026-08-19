/**
 * LLM javobidan JSON ajratish.
 *
 * Modellar ba'zan JSON ni to'liq yopmaydi (oxirgi `}` yoki `]` tushib qoladi),
 * ``` bilan o'raydi, oxirida ortiqcha vergul qoldiradi yoki oldin/keyin matn yozadi.
 * Oddiy `JSON.parse` bunday javobda butunlay yiqiladi — natijada tarjima, dars
 * rejasi, glossariy va slayd kabi bo'limlar bekorga «xatolik» beradi.
 * Shuning uchun avval tozalaymiz, keyin kerak bo'lsa qavslarni o'zimiz yopamiz.
 */

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
      if (parsed !== undefined) return parsed;
      const noTrailing = tryParse(candidate.replace(/,(\s*[}\]])/g, "$1"));
      if (noTrailing !== undefined) return noTrailing;
    }
    head = dropLastToken(trimmed);
  }
  return undefined;
}

/**
 * LLM javobidan birinchi JSON obyekt/massivni oladi.
 * Javob kesilgan bo'lsa ham qutqarishga harakat qiladi. Bo'lmasa `null`.
 */
export function parseLlmJson(raw: string | null | undefined): unknown {
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
    if (direct !== undefined) return direct;
  }

  // 2) Butun qoldiq to'g'ri JSON bo'lishi mumkin.
  const whole = tryParse(body);
  if (whole !== undefined) return whole;

  // 3) Kesilgan javobni tiklaymiz.
  const repaired = repairTruncated(body);
  return repaired === undefined ? null : repaired;
}

/** `parseLlmJson`, lekin natija obyekt bo'lsagina qaytaradi. */
export function parseLlmObject<T extends object = Record<string, unknown>>(
  raw: string | null | undefined,
): T | null {
  const data = parseLlmJson(raw);
  return data && typeof data === "object" && !Array.isArray(data) ? (data as T) : null;
}
