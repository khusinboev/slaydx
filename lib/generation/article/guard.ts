/**
 * Maqola QO'RIQCHISI (Maqola 2) — model javobini qabul qilishdan oldin.
 *
 * Prompt qoidalari (iqtibos faqat reyestrdan, raqam faqat manbadan,
 * foydalanuvchi fakti verbatim) generatsiyadan KEYIN shu yerda
 * tekshiriladi — «model qoidaga bo'ysundi» degan taxminga tayanilmaydi
 * (rezyume qo'riqchisi bilan bir qaror).
 *
 * Nima O'CHIRILADI: faqat reyestrda yo'q iqtibos id lari (`verify.ts`).
 * Nima HISOBLANADI, lekin o'chirilmaydi: manbasiz foizlar, yo'qolgan
 * foydalanuvchi raqamlari, «suv» iboralar, so'z chegarasi — bular
 * tayyorlik hisoboti (WP5) va dvigatelning qayta so'rovi uchun.
 * Sabab: jumlani o'chirish matnni buzadi; foydalanuvchi hisobotda
 * ko'rib «Tuzatish» bilan qayta yozdiradi.
 */
import type { Block, DocSection } from "../types";
import type { ArticleType, Reference } from "./types";
import { referenceIndex, verifyCitationsInText } from "../research/verify";
import { FILLER_PHRASES } from "./prompts";

export type GuardOpts = {
  refs: Reference[];
  userFacts?: string;
  /** Tezis/qisqa xabar — bo'lim tanasi shu oraliqda bo'lishi kerak. */
  wordRange?: [number, number];
};

export type SectionGuardReport = {
  /** O'chirilgan iqtibos id lari (reyestrda yo'q). */
  removedCitations: string[];
  /** Saqlangan (haqiqiy) iqtiboslar soni. */
  citations: number;
  /** Manbasiz va foydalanuvchi faktida yo'q foizlar («12 %», «4,6%»). */
  unsourcedNumbers: string[];
  /** Foydalanuvchi faktlaridagi raqamlardan shu bo'limda uchraganlari. */
  factNumbersFound: string[];
  /** Uchragan «suv» iboralar. */
  filler: string[];
  words: number;
  /** `wordRange` berilgan bo'lsa — ichidami. Berilmasa `true`. */
  wordRangeOk: boolean;
};

const WORD_RE = /\S+/g;

export function wordsOf(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind === "figure" || b.kind === "tableRef" || b.kind === "formula") continue;
    n += (b.text.match(WORD_RE) ?? []).length;
  }
  return n;
}

/**
 * Matndagi raqamlar — `4,6`, `4.6`, `120`, `2024`, `12 %` → normallashgan
 * shakl (`4.6`, `120`, `12%`). Foydalanuvchi fakti bilan solishtirish uchun.
 */
export function numbersOf(text: string): string[] {
  const out: string[] = [];
  const re = /(\d+(?:[.,]\d+)?)(\s*%)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = m[1].replace(",", ".");
    out.push(m[2] ? `${n}%` : n);
  }
  return out;
}

/** Foydalanuvchi faktlaridagi raqamlar (takrorsiz). */
export function factNumbers(userFacts: string | undefined): string[] {
  if (!userFacts) return [];
  return [...new Set(numbersOf(userFacts))];
}

const PERCENT_RE = /\d+[.,]?\d*\s*%/g;

/**
 * Bitta bo'lim: iqtiboslarni tozalaydi (reyestr), raqam/fakt/suv
 * hisobini beradi. Bloklar YANGI massiv (kirish o'zgarmaydi).
 */
export function guardSection(blocks: Block[], opts: GuardOpts): { blocks: Block[]; report: SectionGuardReport } {
  const index = referenceIndex(opts.refs);
  const facts = new Set(factNumbers(opts.userFacts));
  const removedCitations: string[] = [];
  let citations = 0;
  const unsourcedNumbers: string[] = [];
  const found = new Set<string>();
  const filler: string[] = [];

  const out = blocks.map((b): Block => {
    if (b.kind === "formula") return b;
    const hasCite = { v: false };
    const text = verifyCitationsInText(b.text, index, {
      onKeep: () => {
        citations++;
        hasCite.v = true;
      },
      onDrop: (id) => removedCitations.push(id),
    });
    // Raqamlar: foydalanuvchi faktidagilar «topildi»; foizlar manbasiz bo'lsa hisobga.
    for (const n of numbersOf(text)) if (facts.has(n)) found.add(n);
    if (!hasCite.v) {
      for (const p of text.match(PERCENT_RE) ?? []) {
        const norm = p.replace(/\s+/g, "").replace(",", ".");
        if (!facts.has(norm)) unsourcedNumbers.push(norm);
      }
    }
    const low = text.toLowerCase();
    for (const f of FILLER_PHRASES) if (low.includes(f)) filler.push(f);
    return text === b.text ? b : { ...b, text };
  });

  const words = wordsOf(out);
  const wordRangeOk = opts.wordRange ? words >= opts.wordRange[0] && words <= opts.wordRange[1] : true;
  return {
    blocks: out,
    report: { removedCitations, citations, unsourcedNumbers, factNumbersFound: [...found], filler, words, wordRangeOk },
  };
}

/**
 * Skeletga moslik: `required` bo'limlar (ixtiyoriysiz) rejada/hujjatda
 * bormi. `body` kabi erkin bo'limlar `body-1`, `body-2` id bilan keladi —
 * prefiks bo'yicha mos deb olinadi.
 */
export function skeletonCoverage(type: ArticleType, sections: { id: string; blocks?: Block[] }[]): { missing: string[]; hardMissing: string[] } {
  const present = (id: string) => sections.some((s) => (s.id === id || s.id.startsWith(`${id}-`)) && (s.blocks === undefined || s.blocks.length > 0));
  const missing = type.skeleton.filter((s) => s.required && !present(s.id)).map((s) => s.id);
  const hardMissing = type.skeleton.filter((s) => s.hard && !present(s.id)).map((s) => s.id);
  return { missing, hardMissing };
}

/** Butun hujjat bo'yicha: foydalanuvchi faktlaridagi qaysi raqamlar hech qayerda uchramadi. */
export function missingFactNumbers(sections: DocSection[], userFacts: string | undefined): string[] {
  const facts = factNumbers(userFacts);
  if (!facts.length) return [];
  const seen = new Set<string>();
  for (const s of sections) for (const b of s.blocks) for (const n of numbersOf(b.text)) seen.add(n);
  return facts.filter((n) => !seen.has(n));
}
