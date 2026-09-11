/**
 * Maqola tahrir operatsiyalari (Maqola 2, AUDIT-17 WP7) — IZOMORF.
 *
 * `resume/edit.ts` bilan bir xil naqsh: `applyArticleOps` sof funksiya
 * (yangi `doc` qaytaradi), `inverseArticleOps` undo uchun teskari ro'yxat,
 * `parseArticleOps` esa HTTP tanasi (`unknown`) bilan mantiq orasidagi
 * YAGONA darvoza. Klient (`useArticleEdit`) ham, server (`articleAdapter`)
 * ham AYNAN shu uchtasini chaqiradi — ekranda qo'llangan operatsiya bazada
 * ham xuddi shunday qo'llanadi.
 *
 * Yagona manba qarori (D-1) bu yerda ham amal qiladi: matn `sections` da,
 * metama'lumot `doc.article` da; raqamlash/tartib `layout.ts planArticle`
 * niki. Shu sababli op lar RAQAM bilmaydi — «1-rasm» emas, `figureId`;
 * `[1; 25-b.]` emas, `[W…]` xom iqtibos.
 *
 * SINXRON ushlanadigan nusxalar (aks holda ko'ruvchi bir narsani, DOCX
 * boshqasini ko'rsatardi):
 *   • rasm bloki `text` ⇄ `article.figures[].caption`;
 *   • jadval bloki `text` ⇄ `tables[].caption`;
 *   • `article.keywords[lang]` ⇄ `abstracts[lang].keywords`
 *     (`planArticle` avval annotatsiyadagi satrni o'qiydi);
 *   • `article.references[].cited` — matnga qarab QAYTA hisoblanadi
 *     (OAK: ro'yxatga faqat iqtibos qilingan manba kiradi);
 *   • eski `doc.references` satrlari (karta, qidiruv) — mavjud bo'lsa.
 *
 * `article.review` bu yerda O'CHIRILMAYDI: qayta hisob serverda
 * (`article-rewrite.ts`, `review` opi orqali) — hisobot LLM baholovchisi
 * bilan bog'liq, klient uni o'zi hisoblay olmaydi.
 *
 * ESKI maqola (`doc.article` yo'q): faqat matn darajasidagi amallar
 * (`text/heading/cell/blockRemove/blockInsert/set`) — annotatsiya, kalit
 * so'z, manba reyestri unda yo'q.
 */
import type { AcademicDoc, Block, DocSection, DocTable } from "../types";
import { ARTICLE_LIMITS, type ArticleReview, type Reference } from "./types";
import { articleLabels } from "./labels";
import { formatRefLine } from "./prompts";
import { referenceIndex, verifyCitationsInText } from "../research/verify";

/** Matn bloki yo'li — `sections.<i>.blocks.<j>`. */
export const ARTICLE_PATH_RE = /^sections\.\d{1,2}\.blocks\.\d{1,3}$/;

export type ArticleLang = "uz" | "ru" | "en";

export const ARTICLE_EDIT_LIMITS = {
  ops: 50,
  /** Bitta matn qiymati (paragraf/annotatsiya). */
  text: 6_000,
  title: 200,
  caption: 300,
  cell: 600,
  /** Bitta bo'limdagi bloklar. */
  blocks: 400,
  keywordChars: 80,
  highlightChars: 200,
  id: 64,
  instruction: 600,
} as const;

/** `blocks` ichida bo'lishi mumkin bo'lgan turlar (parse ro'yxati). */
const BLOCK_KINDS = new Set(["p", "h1", "h2", "h3", "li", "quote", "code", "figure", "formula", "tableRef"]);

export type ArticleOp =
  /** Blok matni; `figure`/`tableRef` da — sarlavha (model bilan sinxron), `formula` da — LaTeX. */
  | { op: "text"; path: string; value: string }
  /** Bo'lim sarlavhasi (`h1`). */
  | { op: "heading"; sectionId: string; title: string }
  /** Jadval katagi; `r = -1` — ustun sarlavhasi. */
  | { op: "cell"; tableId: string; r: number; c: number; value: string }
  | { op: "caption"; target: "figure" | "table"; id: string; value: string }
  /** Annotatsiya matni (yo'q bo'lsa yaratiladi — `abstract:xx` tuzatishi). */
  | { op: "abstract"; lang: ArticleLang; text: string }
  | { op: "keywords"; lang: ArticleLang; items: string[] }
  | { op: "highlights"; items: string[] }
  /** Manbani reyestrdan va matndagi `[ID]` iqtiboslardan olib tashlaydi. */
  | { op: "refRemove"; refId: string }
  | { op: "blockRemove"; path: string }
  /** `path` — qo'yiladigan o'rin (`j` bo'lim uzunligiga teng bo'lishi mumkin). */
  | { op: "blockInsert"; path: string; block: Block }
  /** Butun bo'lim matni (rewrite natijasi) — bitta op, teskarisi eski bloklar. */
  | { op: "setSection"; sectionId: string; blocks: Block[] }
  /** Xavfsizlik tarmog'i — murakkab op larning teskarisi (`refRemove`). */
  | { op: "set"; doc: AcademicDoc }
  /**
   * Tayyorlik hisoboti — FAQAT SERVER (`article-rewrite.ts`) yaratadi;
   * `parseArticleOps` uni rad etadi, ya'ni klient ballni o'zi yoza olmaydi.
   */
  | { op: "review"; review: ArticleReview | null };

export type ArticleEditCtx = { genId: string };
export type ArticleEditResult = { ok: true; doc: AcademicDoc } | { ok: false; error: string; at: number };

/* ────────────────────────── yordamchilar ────────────────────────── */

/** Faqat plain JSON: hujjat `doc_json` dan keladi, funksiya/sana yo'q. */
export function cloneArticleDoc(doc: AcademicDoc): AcademicDoc {
  return JSON.parse(JSON.stringify(doc)) as AcademicDoc;
}

function fail(error: string, at: number): ArticleEditResult {
  return { ok: false, error, at };
}

/** Bitta qatorli matn — tahrir maydonidan kelgan `\n` yutiladi. */
function line(v: string, max: number): string {
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Ko'p qatorli (kod, annotatsiya) — qatorlar saqlanadi, chetlar tozalanadi. */
function multiline(v: string, max: number): string {
  return v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, max);
}

export function langKeyOf(lang: string): ArticleLang {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? "ru" : c === "en" ? "en" : "uz";
}

/** `sections.i.blocks.j` → indekslar; shakl allaqachon `ARTICLE_PATH_RE` bilan tekshirilgan. */
export function parseBlockPath(path: string): { si: number; bi: number } | null {
  if (!ARTICLE_PATH_RE.test(path)) return null;
  const [, si, , bi] = path.split(".");
  return { si: Number(si), bi: Number(bi) };
}

type TextBlock = Extract<Block, { kind: "p" | "h1" | "h2" | "h3" | "li" | "quote" }>;

/** Iqtibos bo'lishi mumkin bo'lgan bloklar (`research/verify.ts textual` bilan bir xil). */
function citable(b: Block): boolean {
  return b.kind === "p" || b.kind === "li" || b.kind === "quote" || b.kind === "figure" || b.kind === "tableRef";
}

function sameId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Matndan BITTA manbaning iqtiboslarini olib tashlaydi
 * (`verifyCitationsInText` naqshi, lekin faqat berilgan id ga tegadi —
 * boshqa noma'lum tokenlar o'z holicha qoladi):
 *   «… [W1; W2]» → «… [W2]»;  «… [W1; 25-b.].» → «….» (lokator yolg'iz qolmaydi).
 */
export function stripCitation(text: string, refId: string): string {
  return text.replace(/\s?\[([^\[\]\n]{1,240})\]/g, (whole, inner: string) => {
    const lead = whole.startsWith(" ") ? " " : "";
    const parts = inner
      .split(/[;,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.some((p) => sameId(p, refId))) return whole;
    const kept = parts.filter((p) => !sameId(p, refId));
    // Qolgani faqat lokator (`25-b.`) yoki hech narsa — butun qavs tushadi.
    const idLike = kept.some((p) => /^(?:W\d+|u\d{1,3}|doi:\S+|ref\d+)$/i.test(p));
    if (!idLike) return "";
    return `${lead}[${kept.join("; ")}]`;
  });
}

/**
 * `cited` bayroqlarini MATNGA qarab qayta hisoblaydi: bo'lim
 * sarlavhalari, iqtibosli bloklar, jadval sarlavha/kataklari. Annotatsiya
 * hisobga olinmaydi — dvigatel undan iqtibosni allaqachon olib tashlagan.
 */
export function recomputeCited(doc: AcademicDoc): Reference[] {
  const refs = doc.article?.references ?? [];
  if (!refs.length) return refs;
  const index = referenceIndex(refs);
  const seen = new Set<string>();
  const scan = (t: string) => {
    if (t.includes("[")) verifyCitationsInText(t, index, { onKeep: (id) => seen.add(id) });
  };
  for (const s of doc.sections) {
    scan(s.title);
    for (const b of s.blocks) if (citable(b)) scan(b.text);
  }
  for (const t of doc.tables ?? []) {
    if (t.caption) scan(t.caption);
    for (const r of t.rows) for (const c of r) scan(c);
  }
  return refs.map((r) => (r.cited === seen.has(r.id) ? r : { ...r, cited: seen.has(r.id) }));
}

/** Eski `doc.references` satrlari — dvigatel formulasi bilan (`engine.ts`). */
function legacyReferenceLines(refs: Reference[]): string[] {
  return refs.filter((r) => r.cited).map((r) => formatRefLine(r).replace(/^\[[^\]]+\]\s*/, ""));
}

/** Rasm/jadval sarlavhalarini bloklardan modelga ko'chiradi (dvigatel bilan bir xil yo'nalish). */
function syncCaptionsFromBlocks(doc: AcademicDoc): void {
  const figures = doc.article?.figures ?? [];
  const tables = doc.tables ?? [];
  for (const s of doc.sections) {
    for (const b of s.blocks) {
      if (b.kind === "figure") {
        const f = figures.find((x) => x.id === b.figureId);
        if (f && f.caption !== b.text) f.caption = b.text;
      } else if (b.kind === "tableRef") {
        const t = tables.find((x) => x.id === b.tableId);
        if (t && (t.caption ?? "") !== b.text) t.caption = b.text;
      }
    }
  }
}

/**
 * Matnga tegadigan op lardan keyin: `cited` bayroqlari va eski
 * `references` satrlari matn bilan tenglashadi. `doc.references` FAQAT
 * mavjud bo'lsa yangilanadi (namunaviy hujjatlarda maydon yo'q — uni
 * qo'shish teskari aylanmani buzardi).
 */
function settle(doc: AcademicDoc): void {
  if (!doc.article) return;
  syncCaptionsFromBlocks(doc);
  doc.article.references = recomputeCited(doc);
  if (doc.references) doc.references = legacyReferenceLines(doc.article.references);
}

/* ────────────────────────── blok tekshiruvi (`unknown` dan) ────────────────────────── */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

/** Bitta blok — shakli bo'yicha; matn `text` limiti bilan. */
export function normalizeBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const kind = typeof b.kind === "string" ? b.kind : "";
  if (!BLOCK_KINDS.has(kind)) return null;
  const text = str(b.text, ARTICLE_EDIT_LIMITS.text);
  if (text === null) return null;
  switch (kind) {
    case "figure": {
      const figureId = str(b.figureId, ARTICLE_EDIT_LIMITS.id);
      if (!figureId) return null;
      return { kind, text, figureId };
    }
    case "tableRef": {
      const tableId = str(b.tableId, ARTICLE_EDIT_LIMITS.id);
      if (!tableId) return null;
      return { kind, text, tableId };
    }
    case "formula":
      return b.display === undefined ? { kind, text } : { kind, text, display: Boolean(b.display) };
    case "code": {
      const out: Extract<Block, { kind: "code" }> = { kind, text };
      const caption = str(b.caption, ARTICLE_EDIT_LIMITS.caption);
      const lang = str(b.lang, 32);
      if (caption) out.caption = caption;
      if (lang) out.lang = lang;
      return out;
    }
    default:
      return { kind: kind as TextBlock["kind"], text };
  }
}

function normalizeBlocks(raw: unknown): Block[] | null {
  if (!Array.isArray(raw) || raw.length > ARTICLE_EDIT_LIMITS.blocks) return null;
  const out: Block[] = [];
  for (const x of raw) {
    const b = normalizeBlock(x);
    if (!b) return null;
    out.push(b);
  }
  return out;
}

function normalizeStrings(raw: unknown, max: number, maxLen: number): string[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") return null;
    const t = line(x, maxLen);
    if (t) out.push(t);
  }
  return out;
}

/* ────────────────────────── qo'llash ────────────────────────── */

function blockAt(doc: AcademicDoc, path: string): { s: DocSection; bi: number } | null {
  const p = parseBlockPath(path);
  if (!p) return null;
  const s = doc.sections[p.si];
  if (!s) return null;
  return { s, bi: p.bi };
}

function tableOf(doc: AcademicDoc, id: string): DocTable | null {
  return (doc.tables ?? []).find((t) => t.id === id) ?? null;
}

/** Eski maqolada (`doc.article` yo'q) ruxsat etilgan op lar. */
const LEGACY_OPS = new Set<ArticleOp["op"]>(["text", "heading", "cell", "blockRemove", "blockInsert", "set"]);

/** Matnga (iqtiboslarga) tegadigan op lar — `settle` shulardan keyin. */
const TEXT_OPS = new Set<ArticleOp["op"]>(["text", "heading", "cell", "caption", "refRemove", "blockRemove", "blockInsert", "setSection", "set"]);

/**
 * Operatsiyalarni ketma-ket qo'llaydi. Bittasi yiqilsa HECH NARSA
 * qo'llanmaydi (PATCH atomar) — xato `at` indeksi bilan qaytadi.
 * Kirish hujjati O'ZGARMAYDI (chuqur nusxa ustida ishlanadi).
 */
export function applyArticleOps(doc: AcademicDoc, ops: ArticleOp[], ctx: ArticleEditCtx): ArticleEditResult {
  // `ctx.genId` hozircha ishlatilmaydi: maqola op lari rasm URL i olib
  // kelmaydi (sxemalar faqat serverda yaratiladi; `set` aktivlarni joriy
  // hujjatdan oladi). Imzo adapter shartnomasi uchun saqlanadi.
  void ctx;
  if (!doc.sections?.length) return fail("Bu hujjatda bo'limlar yo'q", 0);
  let d = cloneArticleDoc(doc);
  const legacy = !d.article;
  let touched = false;

  for (let at = 0; at < ops.length; at++) {
    const op = ops[at];
    if (legacy && !LEGACY_OPS.has(op.op)) return fail("Eski maqolada bu amal mavjud emas — qaytadan yarating", at);
    if (TEXT_OPS.has(op.op)) touched = true;
    switch (op.op) {
      case "text": {
        const hit = blockAt(d, op.path);
        const b = hit?.s.blocks[hit.bi];
        if (!hit || !b) return fail(`Yo'l topilmadi: ${op.path}`, at);
        if (b.kind === "code") {
          const text = multiline(op.value, ARTICLE_EDIT_LIMITS.text);
          if (!text) return fail("Kod bloki bo'sh bo'lmaydi — o'chirish uchun «blockRemove»", at);
          hit.s.blocks[hit.bi] = { ...b, text };
        } else if (b.kind === "formula") {
          const text = line(op.value, ARTICLE_EDIT_LIMITS.text);
          if (!text) return fail("Formula bo'sh bo'lmaydi", at);
          hit.s.blocks[hit.bi] = { ...b, text };
        } else if (b.kind === "figure" || b.kind === "tableRef") {
          // Sarlavha — bo'sh bo'lishi mumkin («1-rasm.»); model `settle` da tenglashadi.
          hit.s.blocks[hit.bi] = { ...b, text: line(op.value, ARTICLE_EDIT_LIMITS.caption) };
        } else {
          const text = line(op.value, ARTICLE_EDIT_LIMITS.text);
          if (!text) return fail("Bo'sh blok — o'chirish uchun «blockRemove»", at);
          hit.s.blocks[hit.bi] = { ...b, text };
        }
        break;
      }
      case "heading": {
        const s = d.sections.find((x) => x.id === op.sectionId);
        if (!s) return fail(`Bo'lim topilmadi: ${op.sectionId}`, at);
        const title = line(op.title, ARTICLE_EDIT_LIMITS.title);
        if (!title) return fail("Bo'lim sarlavhasi bo'sh bo'lmaydi", at);
        s.title = title;
        break;
      }
      case "cell": {
        const t = tableOf(d, op.tableId);
        if (!t) return fail(`Jadval topilmadi: ${op.tableId}`, at);
        const value = line(op.value, ARTICLE_EDIT_LIMITS.cell);
        if (op.r === -1) {
          if (op.c < 0 || op.c >= t.headers.length) return fail("Ustun indeksi chegaradan tashqarida", at);
          if (!value) return fail("Ustun sarlavhasi bo'sh bo'lmaydi", at);
          t.headers[op.c] = value;
        } else {
          const row = t.rows[op.r];
          if (!row || op.c < 0 || op.c >= row.length) return fail("Katak indeksi chegaradan tashqarida", at);
          row[op.c] = value;
        }
        break;
      }
      case "caption": {
        const value = line(op.value, ARTICLE_EDIT_LIMITS.caption);
        if (op.target === "figure") {
          const f = d.article!.figures.find((x) => x.id === op.id);
          if (!f) return fail(`Rasm topilmadi: ${op.id}`, at);
          f.caption = value;
          for (const s of d.sections) for (let i = 0; i < s.blocks.length; i++) {
            const b = s.blocks[i];
            if (b.kind === "figure" && b.figureId === op.id) s.blocks[i] = { ...b, text: value };
          }
        } else {
          const t = tableOf(d, op.id);
          if (!t) return fail(`Jadval topilmadi: ${op.id}`, at);
          t.caption = value;
          for (const s of d.sections) for (let i = 0; i < s.blocks.length; i++) {
            const b = s.blocks[i];
            if (b.kind === "tableRef" && b.tableId === op.id) s.blocks[i] = { ...b, text: value };
          }
        }
        break;
      }
      case "abstract": {
        const text = multiline(op.text, ARTICLE_EDIT_LIMITS.text);
        if (!text) return fail("Annotatsiya bo'sh bo'lmaydi", at);
        const list = (d.abstracts ??= []);
        const cur = list.find((a) => langKeyOf(a.lang) === op.lang);
        if (cur) cur.text = text;
        else {
          const L = articleLabels(op.lang);
          list.push({ lang: op.lang, label: L.abstract, text, keywords: (d.article!.keywords[op.lang] ?? []).join(", ") });
        }
        break;
      }
      case "keywords": {
        const seen = new Set<string>();
        const items: string[] = [];
        for (const raw of op.items) {
          const t = line(raw, ARTICLE_EDIT_LIMITS.keywordChars);
          if (!t || seen.has(t.toLowerCase())) continue;
          seen.add(t.toLowerCase());
          items.push(t);
          if (items.length >= ARTICLE_LIMITS.keywords) break;
        }
        if (items.length) d.article!.keywords[op.lang] = items;
        else delete d.article!.keywords[op.lang];
        // Annotatsiya satri — `planArticle` avval shuni o'qiydi.
        const abs = (d.abstracts ?? []).find((a) => langKeyOf(a.lang) === op.lang);
        if (abs) abs.keywords = items.join(", ");
        break;
      }
      case "highlights": {
        const items: string[] = [];
        for (const raw of op.items) {
          const t = line(raw, ARTICLE_EDIT_LIMITS.highlightChars);
          if (t) items.push(t);
          if (items.length >= ARTICLE_LIMITS.highlights) break;
        }
        if (items.length) d.article!.highlights = items;
        else delete d.article!.highlights;
        break;
      }
      case "refRemove": {
        const refs = d.article!.references;
        if (!refs.some((r) => r.id === op.refId)) return fail(`Manba topilmadi: ${op.refId}`, at);
        d.article!.references = refs.filter((r) => r.id !== op.refId);
        for (const s of d.sections) {
          s.title = stripCitation(s.title, op.refId);
          s.blocks = s.blocks.map((b) => (citable(b) && b.text.includes("[") ? { ...b, text: stripCitation(b.text, op.refId) } : b));
        }
        for (const t of d.tables ?? []) {
          if (t.caption) t.caption = stripCitation(t.caption, op.refId);
          t.rows = t.rows.map((r) => r.map((c) => (c.includes("[") ? stripCitation(c, op.refId) : c)));
        }
        break;
      }
      case "blockRemove": {
        const hit = blockAt(d, op.path);
        const b = hit?.s.blocks[hit.bi];
        if (!hit || !b) return fail(`Yo'l topilmadi: ${op.path}`, at);
        hit.s.blocks.splice(hit.bi, 1);
        /*
         * Jadval bloki o'chsa jadvalning O'ZI ham ketadi: `planArticle`
         * langarlangan, lekin `tableRef` siz jadvalni bo'lim oxirida
         * baribir chizardi — foydalanuvchi «o'chirdim, lekin turibdi»
         * degan natijani olardi. Rasm modelda qoladi (aktiv bilan; raqam
         * faqat blokdan beriladi, ya'ni ko'rinmaydi).
         */
        if (b.kind === "tableRef" && d.tables) d.tables = d.tables.filter((t) => t.id !== b.tableId);
        break;
      }
      case "blockInsert": {
        const hit = blockAt(d, op.path);
        if (!hit || hit.bi > hit.s.blocks.length) return fail(`Yo'l topilmadi: ${op.path}`, at);
        if (hit.s.blocks.length >= ARTICLE_EDIT_LIMITS.blocks) return fail(`Bo'limdagi bloklar chegarasi: ${ARTICLE_EDIT_LIMITS.blocks}`, at);
        hit.s.blocks.splice(hit.bi, 0, op.block);
        break;
      }
      case "setSection": {
        const s = d.sections.find((x) => x.id === op.sectionId);
        if (!s) return fail(`Bo'lim topilmadi: ${op.sectionId}`, at);
        if (op.blocks.length > ARTICLE_EDIT_LIMITS.blocks) return fail(`Bo'limdagi bloklar chegarasi: ${ARTICLE_EDIT_LIMITS.blocks}`, at);
        s.blocks = op.blocks.map((b) => ({ ...b }));
        break;
      }
      case "set": {
        /*
         * FAQAT matn qismlari olinadi: `meta`, rasm aktivlari
         * (`figures[].url/assetId`), mualliflar, tur/profil va hisobot
         * JORIY hujjatdan qoladi — klient yuborgan `doc` bilan begona URL
         * yoki soxta ball kirmasin.
         */
        const src = op.doc;
        if (!Array.isArray(src.sections) || !src.sections.length) return fail("«set» — bo'limlar yo'q", at);
        const next: AcademicDoc = {
          ...d,
          sections: src.sections.map((s) => ({ id: s.id, title: s.title, blocks: s.blocks.map((b) => ({ ...b })) })),
        };
        if (src.tables) next.tables = src.tables.map((t) => ({ ...t, headers: t.headers.slice(), rows: t.rows.map((r) => r.slice()) }));
        else delete next.tables;
        if (src.abstracts) next.abstracts = src.abstracts.map((a) => ({ ...a }));
        else delete next.abstracts;
        if (src.references) next.references = src.references.slice();
        else delete next.references;
        if (src.referencesNote) next.referencesNote = src.referencesNote;
        else delete next.referencesNote;
        if (d.article) {
          const a = src.article;
          next.article = {
            ...d.article,
            keywords: { ...(a?.keywords ?? d.article.keywords) },
            references: (a?.references ?? d.article.references).map((r) => ({ ...r })),
            figures: d.article.figures.map((f) => ({ ...f })),
          };
          if (a?.highlights?.length) next.article.highlights = a.highlights.slice();
          else delete next.article.highlights;
          if (a && "udk" in a) {
            if (a.udk) next.article.udk = a.udk;
            else delete next.article.udk;
          }
        }
        d = next;
        break;
      }
      case "review": {
        if (op.review) d.article!.review = op.review;
        else delete d.article!.review;
        break;
      }
      default:
        return fail("Noma'lum operatsiya", at);
    }
  }

  if (touched) settle(d);
  return { ok: true, doc: d };
}

/* ────────────────────────── teskari ────────────────────────── */

/**
 * Teskari ro'yxat (undo). Maydon darajasidagi op larning teskarisi —
 * o'sha op eski qiymat bilan; `refRemove` va yo'q joydan yaratilgan
 * annotatsiya uchun BUTUN hujjat (`set`) — iqtiboslar o'nlab blokda
 * o'zgaradi, ularni bittalab qaytarish xatoga moyil.
 */
export function inverseArticleOps(doc: AcademicDoc, ops: ArticleOp[], ctx: ArticleEditCtx): ArticleOp[] {
  const out: ArticleOp[] = [];
  let cur = doc;
  for (const op of ops) {
    const inv = inverseOne(cur, op);
    if (!inv) break;
    const step = applyArticleOps(cur, [op], ctx);
    // Yiqilgan operatsiya hujjatni o'zgartirmaydi — teskarisi ham keraksiz.
    if (!step.ok) break;
    out.push(inv);
    cur = step.doc;
  }
  return out.reverse();
}

function snapshot(doc: AcademicDoc): ArticleOp {
  return { op: "set", doc: cloneArticleDoc(doc) };
}

function inverseOne(doc: AcademicDoc, op: ArticleOp): ArticleOp | null {
  switch (op.op) {
    case "text": {
      const hit = blockAt(doc, op.path);
      const b = hit?.s.blocks[hit.bi];
      if (!hit || !b) return null;
      return { op: "text", path: op.path, value: b.text };
    }
    case "heading": {
      const s = doc.sections.find((x) => x.id === op.sectionId);
      return s ? { op: "heading", sectionId: op.sectionId, title: s.title } : null;
    }
    case "cell": {
      const t = tableOf(doc, op.tableId);
      if (!t) return null;
      const old = op.r === -1 ? t.headers[op.c] : t.rows[op.r]?.[op.c];
      return old === undefined ? null : { op: "cell", tableId: op.tableId, r: op.r, c: op.c, value: old };
    }
    case "caption": {
      if (op.target === "figure") {
        const f = doc.article?.figures.find((x) => x.id === op.id);
        return f ? { op: "caption", target: "figure", id: op.id, value: f.caption } : null;
      }
      const t = tableOf(doc, op.id);
      return t ? { op: "caption", target: "table", id: op.id, value: t.caption ?? "" } : null;
    }
    case "abstract": {
      const a = (doc.abstracts ?? []).find((x) => langKeyOf(x.lang) === op.lang);
      return a ? { op: "abstract", lang: op.lang, text: a.text } : snapshot(doc);
    }
    case "keywords": {
      const items = (doc.article?.keywords[op.lang] ?? []).slice();
      const abs = (doc.abstracts ?? []).find((x) => langKeyOf(x.lang) === op.lang);
      // Annotatsiya satri model bilan mos bo'lmasa (eski/qo'lda yozilgan
      // hujjat) maydon opi uni aynan qaytara olmaydi — butun hujjat.
      if (abs && abs.keywords !== items.join(", ")) return snapshot(doc);
      return { op: "keywords", lang: op.lang, items };
    }
    case "highlights":
      return { op: "highlights", items: (doc.article?.highlights ?? []).slice() };
    case "refRemove":
      return snapshot(doc);
    case "blockRemove": {
      const hit = blockAt(doc, op.path);
      const b = hit?.s.blocks[hit.bi];
      if (!hit || !b) return null;
      // Jadval bilan birga o'chgan blok — jadvalni ham qaytarish uchun butun hujjat.
      return b.kind === "tableRef" ? snapshot(doc) : { op: "blockInsert", path: op.path, block: { ...b } };
    }
    case "blockInsert":
      return { op: "blockRemove", path: op.path };
    case "setSection": {
      const s = doc.sections.find((x) => x.id === op.sectionId);
      return s ? { op: "setSection", sectionId: op.sectionId, blocks: s.blocks.map((b) => ({ ...b })) } : null;
    }
    case "set":
      return snapshot(doc);
    case "review":
      return { op: "review", review: doc.article?.review ? cloneArticleDoc(doc).article!.review! : null };
    default:
      return null;
  }
}

/* ────────────────────────── tahlil (`unknown` dan) ────────────────────────── */

const OP_NAMES = new Set(["text", "heading", "cell", "caption", "abstract", "keywords", "highlights", "refRemove", "blockRemove", "blockInsert", "setSection", "set"]);
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const LANGS = new Set(["uz", "ru", "en"]);
const ID_RE = /^[\w:.\-/]{1,64}$/;

function scan(v: unknown, depth = 0): string | null {
  if (depth > 10) return "Tana juda chuqur";
  if (typeof v === "string") return v.length > ARTICLE_EDIT_LIMITS.text ? "Matn juda uzun" : null;
  if (v === null || typeof v === "number" || typeof v === "boolean" || v === undefined) return null;
  if (Array.isArray(v)) {
    if (v.length > 2000) return "Ro'yxat juda uzun";
    for (const x of v) {
      const e = scan(x, depth + 1);
      if (e) return e;
    }
    return null;
  }
  if (typeof v !== "object") return "Qiymat turi yaroqsiz";
  for (const k of Object.keys(v as object)) {
    if (BAD_KEYS.has(k)) return "Taqiqlangan kalit";
    const e = scan((v as Record<string, unknown>)[k], depth + 1);
    if (e) return e;
  }
  return null;
}

const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
const isLang = (v: unknown): v is ArticleLang => typeof v === "string" && LANGS.has(v);
const isIdx = (v: unknown, min = 0, max = 1000): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v < max;

export type ArticleParseResult = { ok: true; ops: ArticleOp[] } | { ok: false; error: string };

/** `set` uchun: faqat oq ro'yxatdagi maydonlar, har biri shakli bilan. */
function normalizeSetDoc(raw: unknown): AcademicDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.sections) || !d.sections.length || d.sections.length > 60) return null;
  const sections: DocSection[] = [];
  for (const s of d.sections as unknown[]) {
    const o = s as Record<string, unknown> | null;
    if (!o || typeof o !== "object") return null;
    const id = str(o.id, ARTICLE_EDIT_LIMITS.id);
    const title = str(o.title, ARTICLE_EDIT_LIMITS.title);
    const blocks = normalizeBlocks(o.blocks);
    if (!id || title === null || !blocks) return null;
    sections.push({ id, title, blocks });
  }
  const out: AcademicDoc = { sections } as AcademicDoc;
  if (d.tables !== undefined) {
    if (!Array.isArray(d.tables) || d.tables.length > 40) return null;
    const tables: DocTable[] = [];
    for (const t of d.tables as unknown[]) {
      const o = t as Record<string, unknown> | null;
      if (!o || typeof o !== "object") return null;
      const headers = normalizeStrings(o.headers, 20, ARTICLE_EDIT_LIMITS.cell);
      if (!headers || !Array.isArray(o.rows) || o.rows.length > 500) return null;
      const rows: string[][] = [];
      for (const r of o.rows as unknown[]) {
        if (!Array.isArray(r) || r.length > 20 || !r.every((c) => typeof c === "string")) return null;
        rows.push((r as string[]).map((c) => c.slice(0, ARTICLE_EDIT_LIMITS.cell)));
      }
      const tb: DocTable = { headers, rows };
      const id = str(o.id, ARTICLE_EDIT_LIMITS.id);
      const caption = str(o.caption, ARTICLE_EDIT_LIMITS.caption);
      const anchor = str(o.anchor, ARTICLE_EDIT_LIMITS.id);
      if (id) tb.id = id;
      if (caption !== null) tb.caption = caption;
      if (anchor) tb.anchor = anchor;
      if (Array.isArray(o.widths) && o.widths.every((w) => typeof w === "number")) tb.widths = (o.widths as number[]).slice(0, 20);
      tables.push(tb);
    }
    out.tables = tables;
  }
  if (d.abstracts !== undefined) {
    if (!Array.isArray(d.abstracts) || d.abstracts.length > 6) return null;
    const abstracts: NonNullable<AcademicDoc["abstracts"]> = [];
    for (const a of d.abstracts as unknown[]) {
      const o = a as Record<string, unknown> | null;
      if (!o || typeof o !== "object") return null;
      const lang = str(o.lang, 8);
      const label = str(o.label, 80);
      const text = str(o.text, ARTICLE_EDIT_LIMITS.text);
      const keywords = str(o.keywords, 1000);
      if (!lang || label === null || text === null || keywords === null) return null;
      abstracts.push({ lang, label, text, keywords });
    }
    out.abstracts = abstracts;
  }
  if (d.references !== undefined) {
    const refs = normalizeStrings(d.references, ARTICLE_LIMITS.refs, 1000);
    if (!refs) return null;
    out.references = refs;
  }
  const note = str(d.referencesNote, 1000);
  if (note) out.referencesNote = note;
  if (d.article !== undefined) {
    const a = d.article as Record<string, unknown> | null;
    if (!a || typeof a !== "object") return null;
    const article: Partial<NonNullable<AcademicDoc["article"]>> = {};
    if (a.keywords !== undefined) {
      const kw = a.keywords as Record<string, unknown> | null;
      if (!kw || typeof kw !== "object") return null;
      const keywords: Partial<Record<ArticleLang, string[]>> = {};
      for (const l of ["uz", "ru", "en"] as const) {
        if (kw[l] === undefined) continue;
        const items = normalizeStrings(kw[l], ARTICLE_LIMITS.keywords, ARTICLE_EDIT_LIMITS.keywordChars);
        if (!items) return null;
        keywords[l] = items;
      }
      article.keywords = keywords;
    }
    if (a.highlights !== undefined) {
      const h = normalizeStrings(a.highlights, ARTICLE_LIMITS.highlights, ARTICLE_EDIT_LIMITS.highlightChars);
      if (!h) return null;
      article.highlights = h;
    }
    if (a.references !== undefined) {
      if (!Array.isArray(a.references) || a.references.length > ARTICLE_LIMITS.refs) return null;
      const refs: Reference[] = [];
      for (const r of a.references as unknown[]) {
        const o = r as Record<string, unknown> | null;
        if (!o || typeof o !== "object") return null;
        const id = str(o.id, ARTICLE_EDIT_LIMITS.id);
        const title = str(o.title, 600);
        const authors = normalizeStrings(o.authors, 60, 200);
        const verified = o.verified;
        if (!id || title === null || !authors || (verified !== "openalex" && verified !== "crossref" && verified !== "user" && verified !== "unverified")) return null;
        const ref: Reference = { id, title, authors, verified, cited: Boolean(o.cited) };
        for (const k of ["doi", "venue", "url", "publisher", "place", "pages", "raw"] as const) {
          const v = str(o[k], 600);
          if (v) ref[k] = v;
        }
        if (isIdx(o.year, 0, 3000)) ref.year = o.year;
        if (isIdx(o.n, 0, 1000)) ref.n = o.n;
        refs.push(ref);
      }
      article.references = refs;
    }
    if (a.udk !== undefined) {
      const udk = str(a.udk, ARTICLE_LIMITS.udkChars);
      if (udk === null) return null;
      article.udk = udk;
    }
    out.article = article as NonNullable<AcademicDoc["article"]>;
  }
  return out;
}

/**
 * HTTP tanasidan `ArticleOp[]` ga. Shakl xatosi shu yerda (400), mazmun
 * xatosi `applyArticleOps` da (422) — `parseDocOps`/`parseResumeOps`
 * bilan bir xil taqsimot. `review` opi bu yerdan O'TMAYDI (faqat server).
 */
export function parseArticleOps(raw: unknown): ArticleParseResult {
  if (!Array.isArray(raw)) return { ok: false, error: "Operatsiyalar ro'yxati kutilgan" };
  if (!raw.length) return { ok: false, error: "Operatsiya yo'q" };
  if (raw.length > ARTICLE_EDIT_LIMITS.ops) return { ok: false, error: `Bir so'rovda ${ARTICLE_EDIT_LIMITS.ops} tadan ortiq operatsiya bo'lmaydi` };
  const bad = scan(raw);
  if (bad) return { ok: false, error: bad };

  const ops: ArticleOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Operatsiya obyekt bo'lishi kerak" };
    const o = item as Record<string, unknown>;
    const name = typeof o.op === "string" ? o.op : "";
    if (!OP_NAMES.has(name)) return { ok: false, error: "Noma'lum operatsiya" };
    switch (name) {
      case "text":
        if (typeof o.path !== "string" || !ARTICLE_PATH_RE.test(o.path)) return { ok: false, error: "«path» yaroqsiz" };
        if (typeof o.value !== "string") return { ok: false, error: "«value» matn bo'lishi kerak" };
        ops.push({ op: "text", path: o.path, value: o.value });
        break;
      case "heading":
        if (!isId(o.sectionId)) return { ok: false, error: "«sectionId» yaroqsiz" };
        if (typeof o.title !== "string") return { ok: false, error: "«title» matn bo'lishi kerak" };
        ops.push({ op: "heading", sectionId: o.sectionId, title: o.title });
        break;
      case "cell":
        if (!isId(o.tableId)) return { ok: false, error: "«tableId» yaroqsiz" };
        if (!isIdx(o.r, -1, 500) || !isIdx(o.c, 0, 20)) return { ok: false, error: "«cell» indeksi yaroqsiz" };
        if (typeof o.value !== "string") return { ok: false, error: "«value» matn bo'lishi kerak" };
        ops.push({ op: "cell", tableId: o.tableId, r: o.r, c: o.c, value: o.value });
        break;
      case "caption":
        if (o.target !== "figure" && o.target !== "table") return { ok: false, error: "«target» yaroqsiz" };
        if (!isId(o.id)) return { ok: false, error: "«id» yaroqsiz" };
        if (typeof o.value !== "string") return { ok: false, error: "«value» matn bo'lishi kerak" };
        ops.push({ op: "caption", target: o.target, id: o.id, value: o.value });
        break;
      case "abstract":
        if (!isLang(o.lang)) return { ok: false, error: "«lang» yaroqsiz" };
        if (typeof o.text !== "string") return { ok: false, error: "«text» matn bo'lishi kerak" };
        ops.push({ op: "abstract", lang: o.lang, text: o.text });
        break;
      case "keywords": {
        if (!isLang(o.lang)) return { ok: false, error: "«lang» yaroqsiz" };
        const items = normalizeStrings(o.items, ARTICLE_LIMITS.keywords, ARTICLE_EDIT_LIMITS.keywordChars);
        if (!items) return { ok: false, error: `«items» — ko'pi bilan ${ARTICLE_LIMITS.keywords} matn` };
        ops.push({ op: "keywords", lang: o.lang, items });
        break;
      }
      case "highlights": {
        const items = normalizeStrings(o.items, ARTICLE_LIMITS.highlights, ARTICLE_EDIT_LIMITS.highlightChars);
        if (!items) return { ok: false, error: `«items» — ko'pi bilan ${ARTICLE_LIMITS.highlights} matn` };
        ops.push({ op: "highlights", items });
        break;
      }
      case "refRemove":
        if (!isId(o.refId)) return { ok: false, error: "«refId» yaroqsiz" };
        ops.push({ op: "refRemove", refId: o.refId });
        break;
      case "blockRemove":
        if (typeof o.path !== "string" || !ARTICLE_PATH_RE.test(o.path)) return { ok: false, error: "«path» yaroqsiz" };
        ops.push({ op: "blockRemove", path: o.path });
        break;
      case "blockInsert": {
        if (typeof o.path !== "string" || !ARTICLE_PATH_RE.test(o.path)) return { ok: false, error: "«path» yaroqsiz" };
        const block = normalizeBlock(o.block);
        if (!block) return { ok: false, error: "«block» yaroqsiz" };
        ops.push({ op: "blockInsert", path: o.path, block });
        break;
      }
      case "setSection": {
        if (!isId(o.sectionId)) return { ok: false, error: "«sectionId» yaroqsiz" };
        const blocks = normalizeBlocks(o.blocks);
        if (!blocks) return { ok: false, error: "«blocks» yaroqsiz" };
        ops.push({ op: "setSection", sectionId: o.sectionId, blocks });
        break;
      }
      default: {
        const doc = normalizeSetDoc(o.doc);
        if (!doc) return { ok: false, error: "«doc» yaroqsiz" };
        ops.push({ op: "set", doc });
      }
    }
  }
  return { ok: true, ops };
}
