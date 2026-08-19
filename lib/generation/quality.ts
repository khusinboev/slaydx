import type { AcademicDoc, Block, DocSection } from "./types";

export const WORDS_PER_PAGE = 280;

export function cleanText(s: string): string {
  let t = String(s ?? "");
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/&amp;/gi, "&")
      .replace(/&apos;|&#39;|&lsquo;|&rsquo;/gi, "‘")
      .replace(/&quot;|&ldquo;|&rdquo;/gi, "\"")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&nbsp;/gi, " ");
  }
  return t
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function wordCount(doc: AcademicDoc): number {
  let n = 0;
  for (const s of doc.sections) {
    n += countWords(s.title);
    for (const b of s.blocks) n += countWords(b.text);
  }
  for (const r of doc.references ?? []) n += countWords(r);
  for (const a of doc.abstracts ?? []) n += countWords(a.text);
  for (const t of doc.tables ?? []) {
    n += countWords(t.caption || "");
    for (const h of t.headers) n += countWords(h);
    for (const row of t.rows) for (const c of row) n += countWords(c);
  }
  return n;
}

export function targetWords(pages: number): number {
  return Math.max(220, Math.round(Math.max(1, pages) * WORDS_PER_PAGE));
}

export function remainingMs(deadline?: number): number {
  if (!deadline) return 90_000;
  return Math.max(0, deadline - Date.now());
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      ret[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
  return ret;
}

const GENERIC_RE = [
  /tizimli o[‘'`]rganishni talab qiladigan mavzu/i,
  /alohida fakt emas, balki bog[‘'`]liq tushunchalar/i,
  /tajriba bandi to[‘'`]ldirilmagan/i,
  /tarjima matni topilmadi/i,
  /soha nazariyasi asoslari/i,
  /umumiy nazariy asoslar/i,
  /tushuncha shakllanadi/i,
];

export function isGenericFiller(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  return GENERIC_RE.some((re) => re.test(t));
}

const GENERIC_GLOSSARY = /^(mezon|metod|kompetensiya|tahlil|sintez|innovatsiya|refleksiya|differensiatsiya|integratsiya|indikator|resurs)$/i;

export function isGenericGlossaryTerm(term: string): boolean {
  const t = term.replace(/^[^:]+:\s*/, "").trim();
  return GENERIC_GLOSSARY.test(t);
}

export function parseParagraphs(raw: string): string[] {
  const chunks = raw
    .replace(/\r/g, "")
    .split(/\n{2,}|\n(?=(?:\d+\.|[-*•])\s)/)
    .map((s) =>
      cleanText(
        s.replace(/^\s*(?:#{1,4}\s+|\d+[\).]\s+|[-*•]\s+)/gm, ""),
      ),
    )
    .filter(
      (s) =>
        s.length > 40 &&
        !/^(kirish|xulosa|bob|mundarija|introduction|conclusion|глава)/i.test(s) &&
        !/berilgan talablar asosida|tayyorlangan insho/i.test(s),
    );
  if (chunks.length >= 2) return chunks;
  const sentences = raw.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const paras: string[] = [];
  let buf = "";
  for (const s of sentences) {
    buf = buf ? `${buf} ${s}` : s;
    if (buf.length > 280) {
      paras.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim().length > 40) paras.push(buf.trim());
  return paras;
}

export function blocksFromText(text: string): Block[] {
  const paras = parseParagraphs(text);
  if (paras.length) return paras.map((t) => ({ kind: "p" as const, text: t }));
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? [{ kind: "p", text: t }] : [];
}

export function splitCodeBlocks(raw: string): Block[] {
  const out: Block[] = [];
  const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const before = raw.slice(last, m.index).trim();
    if (before) out.push(...blocksFromText(before));
    const code = m[2].replace(/\s+$/, "");
    if (code.trim()) out.push({ kind: "code", text: code, lang: m[1] || undefined });
    last = m.index + m[0].length;
  }
  const tail = raw.slice(last).trim();
  if (tail) out.push(...blocksFromText(tail));
  return out;
}

export function section(id: string, title: string, blocks: Block[]): DocSection {
  return { id, title, blocks };
}

/** Qo‘lda yozilgan mundarija qatorlaridan bob sarlavhalari. */
export function parseManualToc(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.replace(/^\s*\d+[\).]\s*/, "").replace(/^[-*•]\s*/, "").trim())
    .filter((s) => s.length >= 4 && s.length <= 160)
    .filter((s) => !/^(kirish|xulosa|adabiyot|mundarija|содержание|introduction|conclusion|references)$/i.test(s))
    .slice(0, 8);
}
