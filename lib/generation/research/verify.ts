/**
 * Iqtiboslarni TEKSHIRISH (Maqola 2) — generatsiyadan keyingi qat'iy filtr.
 *
 * Model matnda `[W2741809807]`, `[W…; 25-b.]`, `[W1; W2]`, `[u1]` shaklida
 * iqtibos qiladi. Bu yerda har `[…]` guruhi reyestr (`Reference[]`) bilan
 * solishtiriladi:
 *   • reyestrda bor id  → `cited: true`;
 *   • yo'q id           → guruhdan O'CHIRILADI va `unresolved` ga yoziladi;
 *     guruhda birorta ham haqiqiy id qolmasa butun `[…]` (oldingi bo'sh
 *     joy bilan) olib tashlanadi, JUMLA saqlanadi.
 *   • sof raqamli `[3]` ham iqtibos deb hisoblanadi va reyestrda yo'qligi
 *     uchun o'chiriladi — model eski uslubda raqam o'ylab topsa, u
 *     hech nimaga ishora qilmaydi.
 *
 * Sahifa lokatori (`25-b.`, `p. 12`, `с. 25`, `pp. 3–5`) saqlanadi:
 * `[W1; 25-b.]` → o'zgarmaydi, `[W9; 25-b.]` (W9 yo'q) → butunlay o'chadi.
 *
 * Qoidaning asosi (mahsulot egasi qarori 1): tadqiqotlar AI iqtiboslarining
 * 20–32% i uydirma ekanini ko'rsatadi — tekshirilmagan iqtibos hujjatga
 * tushmaydi. Ro'yxatga esa faqat MATNDA iqtibos qilingan manba kiradi
 * (`citedOnly`, OAK qoidasi).
 */
import type { Reference } from "../article/types";
import type { Block, DocSection } from "../types";

/** `[…]` guruhi — ichida `[`/`]` yo'q, ≤160 belgi. */
const GROUP_RE = /\s?\[([^\[\]\n]{1,160})\]/g;
/** Bitta id: OpenAlex `W…`, foydalanuvchi `u…`, DOI `doi:…`, yoki sof raqam. */
const ID_RE = /^(?:W\d+|u\d{1,3}|doi:10\.\S+|\d{1,3})$/i;
/** Sahifa lokatori — `25-b.`, `25–31-b.`, `p. 12`, `pp. 3-5`, `с. 25`, `b. 25`. */
const LOCATOR_RE = /^(?:\d{1,4}(?:\s*[–-]\s*\d{1,4})?\s*-?\s*(?:b|bet|с|стр|p|pp|page|pages)\.?|(?:b|bet|с|стр|p|pp|page|pages)\.?\s*\d{1,4}(?:\s*[–-]\s*\d{1,4})?)$/i;

export type Unresolved = { sectionId: string; id: string; context: string };

export type CitationVerification = {
  sections: DocSection[];
  refs: Reference[];
  unresolved: Unresolved[];
  /** Olib tashlangan id lar soni (guruhlar emas). */
  removed: number;
  /** Matnda topilgan haqiqiy iqtiboslar soni. */
  kept: number;
};

function normId(id: string): string {
  const t = id.trim();
  if (/^w\d+$/i.test(t)) return t.toUpperCase();
  if (/^doi:/i.test(t)) return `doi:${t.slice(4).toLowerCase()}`;
  return t.toLowerCase();
}

/** Reyestr id lari (normallashtirilgan) → asl id. */
export function referenceIndex(refs: Reference[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of refs) {
    m.set(normId(r.id), r.id);
    if (r.doi) m.set(normId(`doi:${r.doi}`), r.id);
  }
  return m;
}

/**
 * Bitta matn: iqtiboslarni tozalaydi. `onKeep`/`onDrop` — hisob.
 * Tokenlar `;` yoki `,` bilan ajratiladi (model ikkalasini ham yozadi).
 */
export function verifyCitationsInText(
  text: string,
  index: Map<string, string>,
  hooks: { onKeep?: (id: string) => void; onDrop?: (id: string, context: string) => void } = {},
): string {
  return text.replace(GROUP_RE, (whole, inner: string, offset: number) => {
    const lead = whole.startsWith(" ") ? " " : "";
    const parts = inner
      .split(/[;,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const ids = parts.filter((p) => ID_RE.test(p));
    // Iqtibos emas (masalan «[kerakli]», «[sic]») — tegilmaydi.
    if (!ids.length) return whole;
    const locators = parts.filter((p) => !ID_RE.test(p) && LOCATOR_RE.test(p));
    const kept: string[] = [];
    for (const id of ids) {
      const real = index.get(normId(id));
      if (real) {
        if (!kept.includes(real)) kept.push(real);
        hooks.onKeep?.(real);
      } else {
        hooks.onDrop?.(id, text.slice(Math.max(0, offset - 60), offset + whole.length + 20).replace(/\s+/g, " ").trim());
      }
    }
    if (!kept.length) return "";
    return `${lead}[${[...kept, ...locators].join("; ")}]`;
  });
}

/** Blok matni iqtibos tekshiruvidan o'tishi kerakmi (sarlavha va formulada iqtibos bo'lmaydi). */
function textual(b: Block): boolean {
  return b.kind === "p" || b.kind === "li" || b.kind === "quote" || b.kind === "figure" || b.kind === "tableRef";
}

/**
 * Bo'limlar + reyestr → tozalangan bo'limlar, `cited` belgilangan reyestr.
 * Kirish o'zgartirilmaydi (yangi massivlar qaytadi).
 */
export function verifyCitations(sections: DocSection[], refs: Reference[]): CitationVerification {
  const index = referenceIndex(refs);
  const citedIds = new Set<string>();
  const unresolved: Unresolved[] = [];
  let kept = 0;
  const out = sections.map((s) => ({
    ...s,
    title: verifyCitationsInText(s.title, index, {
      onKeep: (id) => {
        citedIds.add(id);
        kept++;
      },
      onDrop: (id, context) => unresolved.push({ sectionId: s.id, id, context }),
    }),
    blocks: s.blocks.map((b) =>
      textual(b)
        ? {
            ...b,
            text: verifyCitationsInText(b.text, index, {
              onKeep: (id) => {
                citedIds.add(id);
                kept++;
              },
              onDrop: (id, context) => unresolved.push({ sectionId: s.id, id, context }),
            }),
          }
        : b,
    ),
  }));
  return {
    sections: out,
    refs: refs.map((r) => ({ ...r, cited: citedIds.has(r.id) })),
    unresolved,
    removed: unresolved.length,
    kept,
  };
}

/** Ro'yxatga FAQAT matnda iqtibos qilingan manba kiradi (OAK qoidasi). */
export function citedOnly(refs: Reference[]): Reference[] {
  return refs.filter((r) => r.cited);
}

/** Matndagi barcha haqiqiy iqtibos id lari (tartibda, takrorsiz) — raqamlash uchun. */
export function citationOrder(sections: DocSection[], refs: Reference[]): string[] {
  const index = referenceIndex(refs);
  const order: string[] = [];
  for (const s of sections) {
    for (const b of s.blocks) {
      if (!textual(b)) continue;
      verifyCitationsInText(b.text, index, { onKeep: (id) => (order.includes(id) ? undefined : order.push(id)) });
    }
  }
  return order;
}
