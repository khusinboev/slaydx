/**
 * TALABA ISHI TAHRIR OPERATSIYALARI (AUDIT-19 WP-C) — IZOMORF.
 *
 * `article/edit.ts` bilan AYNI shartnoma: `applyWorkOps` sof funksiya
 * (yangi `doc` qaytaradi), `inverseWorkOps` undo uchun teskari ro'yxat,
 * `parseWorkOps` esa HTTP tanasi (`unknown`) bilan mantiq orasidagi
 * YAGONA darvoza. Klient (`useWorkEdit`) ham, server (`workAdapter`)
 * ham shu uchtasini chaqiradi.
 *
 * Nega maqolaning op tili qayta ishlatilmadi (garchi tashqi SHAKLI bir
 * xil bo'lsa ham — `PATCH …/doc` tanasi farq qilmaydi): maqolada
 * annotatsiya, kalit so'z va «asosiy natijalar» op lari bor, talaba
 * ishida ular YO'Q; talaba ishida esa bob↔paragraf DARAXTI bor
 * (`work.chapters`) va u sarlavha tahriridan keyin `sections` bilan
 * TENGLASHISHI kerak — maqolada bunday nusxa yo'q. Ikkalasini bitta
 * faylga qo'shish har ikki tomonda «bu janrda bu op ishlamaydi» degan
 * shartlar qatorini keltirardi.
 *
 * SINXRON ushlanadigan nusxalar (aks holda ko'ruvchi bir narsani, DOCX
 * boshqasini ko'rsatardi):
 *   • rasm bloki `text` ⇄ `work.figures[].caption`;
 *   • jadval bloki `text` ⇄ `tables[].caption`;
 *   • bo'lim sarlavhasi ⇄ `work.chapters[].title` / `…paragraphs[].title`
 *     (mundarija `planWork` da bob daraxtidan EMAS, `sections` dan
 *     chiqadi — lekin model hisobot va prompt uchun to'g'ri qolishi kerak);
 *   • `work.references[].cited` — matnga qarab QAYTA hisoblanadi
 *     (ro'yxatga faqat iqtibos qilingan manba kiradi);
 *   • eski `doc.references` satrlari (karta, qidiruv) — mavjud bo'lsa.
 *
 * `work.review` bu yerda O'CHIRILMAYDI: qayta hisob serverda (`review`
 * opi orqali) — u LLM baholovchisiga bog'liq.
 */
import type { AcademicDoc, Block, DocSection, DocTable, Reference } from "../types";
import type { DocReview } from "../report/types";
import { formatRefLine } from "../article/prompts";
import { referenceIndex, verifyCitationsInText } from "../research/verify";
import { WORK_LIMITS } from "./types";

/** Matn bloki yo'li — `sections.<i>.blocks.<j>` (maqola bilan bir xil shakl). */
export const WORK_PATH_RE = /^sections\.\d{1,2}\.blocks\.\d{1,3}$/;

export const WORK_EDIT_LIMITS = {
  ops: 50,
  text: 6_000,
  title: 200,
  caption: 300,
  cell: 600,
  blocks: 400,
  id: 64,
} as const;

/** `blocks` ichida bo'lishi mumkin bo'lgan turlar (parse ro'yxati). */
const BLOCK_KINDS = new Set(["p", "h1", "h2", "h3", "li", "quote", "code", "figure", "formula", "tableRef"]);

export type WorkOp =
  /** Blok matni; `figure`/`tableRef` da — sarlavha (model bilan sinxron), `formula` da — LaTeX. */
  | { op: "text"; path: string; value: string }
  /** Bo'lim sarlavhasi — bob (`ch1`), paragraf (`ch1.1`), kirish/xulosa/ilova. */
  | { op: "heading"; sectionId: string; title: string }
  /** Jadval katagi; `r = -1` — ustun sarlavhasi. */
  | { op: "cell"; tableId: string; r: number; c: number; value: string }
  | { op: "caption"; target: "figure" | "table"; id: string; value: string }
  /** Manbani reyestrdan va matndagi `[ID]` iqtiboslardan olib tashlaydi. */
  | { op: "refRemove"; refId: string }
  | { op: "blockRemove"; path: string }
  /** `path` — qo'yiladigan o'rin (`j` bo'lim uzunligiga teng bo'lishi mumkin). */
  | { op: "blockInsert"; path: string; block: Block }
  /** Butun bo'lim matni (avto-sayqal natijasi) — bitta op, teskarisi eski bloklar. */
  | { op: "setSection"; sectionId: string; blocks: Block[] }
  /** Xavfsizlik tarmog'i — murakkab op larning teskarisi (`refRemove`). */
  | { op: "set"; doc: AcademicDoc }
  /**
   * Tayyorlik hisoboti — FAQAT SERVER yaratadi; `parseWorkOps` uni rad
   * etadi, ya'ni klient ballni o'zi yoza olmaydi.
   */
  | { op: "review"; review: DocReview | null };

export type WorkEditCtx = { genId: string };
export type WorkEditResult = { ok: true; doc: AcademicDoc } | { ok: false; error: string; at: number };

/* ────────────────────────── yordamchilar ────────────────────────── */

/** Faqat plain JSON: hujjat `doc_json` dan keladi, funksiya/sana yo'q. */
export function cloneWorkDoc(doc: AcademicDoc): AcademicDoc {
  return JSON.parse(JSON.stringify(doc)) as AcademicDoc;
}

function fail(error: string, at: number): WorkEditResult {
  return { ok: false, error, at };
}

/** Bitta qatorli matn — tahrir maydonidan kelgan `\n` yutiladi. */
function line(v: string, max: number): string {
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Ko'p qatorli (kod) — qatorlar saqlanadi, chetlar tozalanadi. */
function multiline(v: string, max: number): string {
  return v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, max);
}

/** `sections.i.blocks.j` → indekslar; shakl allaqachon `WORK_PATH_RE` bilan tekshirilgan. */
export function parseWorkBlockPath(path: string): { si: number; bi: number } | null {
  if (!WORK_PATH_RE.test(path)) return null;
  const [, si, , bi] = path.split(".");
  return { si: Number(si), bi: Number(bi) };
}

/** Iqtibos bo'lishi mumkin bo'lgan bloklar (`research/verify.ts` bilan bir xil). */
function citable(b: Block): boolean {
  return b.kind === "p" || b.kind === "li" || b.kind === "quote" || b.kind === "figure" || b.kind === "tableRef";
}

function sameId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Matndan BITTA manbaning iqtiboslarini olib tashlaydi:
 *   «… [W1; W2]» → «… [W2]»;  «… [W1; 25-b.].» → «….» (lokator yolg'iz qolmaydi).
 */
export function stripWorkCitation(text: string, refId: string): string {
  return text.replace(/\s?\[([^\[\]\n]{1,240})\]/g, (whole, inner: string) => {
    const lead = whole.startsWith(" ") ? " " : "";
    const parts = inner
      .split(/[;,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.some((p) => sameId(p, refId))) return whole;
    const kept = parts.filter((p) => !sameId(p, refId));
    const idLike = kept.some((p) => /^(?:W\d+|u\d{1,3}|doi:\S+|ref\d+|lex\S*)$/i.test(p));
    if (!idLike) return "";
    return `${lead}[${kept.join("; ")}]`;
  });
}

/**
 * `cited` bayroqlarini MATNGA qarab qayta hisoblaydi: bo'lim
 * sarlavhalari, iqtibosli bloklar, jadval sarlavha/kataklari.
 */
export function recomputeWorkCited(doc: AcademicDoc): Reference[] {
  const refs = doc.work?.references ?? [];
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

/** Rasm/jadval sarlavhalarini bloklardan modelga ko'chiradi. */
function syncCaptionsFromBlocks(doc: AcademicDoc): void {
  const figures = doc.work?.figures ?? [];
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
 * BOB DARAXTI ⇄ BO'LIM SARLAVHALARI. `planWork` mundarijani `sections`
 * dan chiqaradi, lekin `work.chapters` — hisobot (`chapterBalance`),
 * prompt va forma o'qiydigan model: sarlavha tahriridan keyin u eskirib
 * qolsa, «Tuzatish» bosilganda AI eski bob nomi bilan ishlardi.
 */
function syncChaptersFromSections(doc: AcademicDoc): void {
  const model = doc.work;
  if (!model) return;
  const byId = new Map(doc.sections.map((s) => [s.id, s]));
  for (const c of model.chapters) {
    const cs = byId.get(c.id);
    if (cs && cs.title && cs.title !== c.title) c.title = cs.title;
    for (const p of c.paragraphs) {
      const ps = byId.get(p.sectionId || p.id);
      if (ps && ps.title && ps.title !== p.title) p.title = ps.title;
    }
  }
}

/**
 * Matnga tegadigan op lardan keyin: sarlavha/sarlavhalar, `cited`
 * bayroqlari va eski `references` satrlari matn bilan tenglashadi.
 */
function settle(doc: AcademicDoc): void {
  if (!doc.work) return;
  syncCaptionsFromBlocks(doc);
  syncChaptersFromSections(doc);
  doc.work.references = recomputeWorkCited(doc);
  if (doc.references) doc.references = legacyReferenceLines(doc.work.references);
}

/* ────────────────────────── blok tekshiruvi (`unknown` dan) ────────────────────────── */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

export function normalizeWorkBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const kind = typeof b.kind === "string" ? b.kind : "";
  if (!BLOCK_KINDS.has(kind)) return null;
  const text = str(b.text, WORK_EDIT_LIMITS.text);
  if (text === null) return null;
  switch (kind) {
    case "figure": {
      const figureId = str(b.figureId, WORK_EDIT_LIMITS.id);
      if (!figureId) return null;
      return { kind, text, figureId };
    }
    case "tableRef": {
      const tableId = str(b.tableId, WORK_EDIT_LIMITS.id);
      if (!tableId) return null;
      return { kind, text, tableId };
    }
    case "formula":
      return b.display === undefined ? { kind, text } : { kind, text, display: Boolean(b.display) };
    case "code": {
      const out: Extract<Block, { kind: "code" }> = { kind, text };
      const caption = str(b.caption, WORK_EDIT_LIMITS.caption);
      const lang = str(b.lang, 32);
      if (caption) out.caption = caption;
      if (lang) out.lang = lang;
      return out;
    }
    default:
      return { kind: kind as Extract<Block, { kind: "p" }>["kind"], text };
  }
}

function normalizeBlocks(raw: unknown): Block[] | null {
  if (!Array.isArray(raw) || raw.length > WORK_EDIT_LIMITS.blocks) return null;
  const out: Block[] = [];
  for (const x of raw) {
    const b = normalizeWorkBlock(x);
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
  const p = parseWorkBlockPath(path);
  if (!p) return null;
  const s = doc.sections[p.si];
  if (!s) return null;
  return { s, bi: p.bi };
}

function tableOf(doc: AcademicDoc, id: string): DocTable | null {
  return (doc.tables ?? []).find((t) => t.id === id) ?? null;
}

/** Matnga (iqtiboslarga/sarlavhalarga) tegadigan op lar — `settle` shulardan keyin. */
const TEXT_OPS = new Set<WorkOp["op"]>(["text", "heading", "cell", "caption", "refRemove", "blockRemove", "blockInsert", "setSection", "set"]);

/**
 * Operatsiyalarni ketma-ket qo'llaydi. Bittasi yiqilsa HECH NARSA
 * qo'llanmaydi (PATCH atomar) — xato `at` indeksi bilan qaytadi.
 * Kirish hujjati O'ZGARMAYDI (chuqur nusxa ustida ishlanadi).
 */
export function applyWorkOps(doc: AcademicDoc, ops: WorkOp[], ctx: WorkEditCtx): WorkEditResult {
  // `ctx.genId` hozircha ishlatilmaydi (sxema aktivlari faqat serverda
  // yaratiladi); imzo adapter shartnomasi uchun saqlanadi.
  void ctx;
  if (!doc.sections?.length) return fail("Bu hujjatda bo'limlar yo'q", 0);
  if (!doc.work) return fail("Bu hujjat eski formatda — qaytadan yarating", 0);
  let d = cloneWorkDoc(doc);
  let touched = false;

  for (let at = 0; at < ops.length; at++) {
    const op = ops[at];
    if (TEXT_OPS.has(op.op)) touched = true;
    switch (op.op) {
      case "text": {
        const hit = blockAt(d, op.path);
        const b = hit?.s.blocks[hit.bi];
        if (!hit || !b) return fail(`Yo'l topilmadi: ${op.path}`, at);
        if (b.kind === "code") {
          const text = multiline(op.value, WORK_EDIT_LIMITS.text);
          if (!text) return fail("Kod bloki bo'sh bo'lmaydi — o'chirish uchun «blockRemove»", at);
          hit.s.blocks[hit.bi] = { ...b, text };
        } else if (b.kind === "formula") {
          const text = line(op.value, WORK_EDIT_LIMITS.text);
          if (!text) return fail("Formula bo'sh bo'lmaydi", at);
          hit.s.blocks[hit.bi] = { ...b, text };
        } else if (b.kind === "figure" || b.kind === "tableRef") {
          // Sarlavha bo'sh bo'lishi mumkin («1.1-rasm.»); model `settle` da tenglashadi.
          hit.s.blocks[hit.bi] = { ...b, text: line(op.value, WORK_EDIT_LIMITS.caption) };
        } else {
          const text = line(op.value, WORK_EDIT_LIMITS.text);
          if (!text) return fail("Bo'sh blok — o'chirish uchun «blockRemove»", at);
          hit.s.blocks[hit.bi] = { ...b, text };
        }
        break;
      }
      case "heading": {
        const s = d.sections.find((x) => x.id === op.sectionId);
        if (!s) return fail(`Bo'lim topilmadi: ${op.sectionId}`, at);
        const title = line(op.title, WORK_EDIT_LIMITS.title);
        if (!title) return fail("Bo'lim sarlavhasi bo'sh bo'lmaydi", at);
        s.title = title;
        break;
      }
      case "cell": {
        const t = tableOf(d, op.tableId);
        if (!t) return fail(`Jadval topilmadi: ${op.tableId}`, at);
        const value = line(op.value, WORK_EDIT_LIMITS.cell);
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
        const value = line(op.value, WORK_EDIT_LIMITS.caption);
        if (op.target === "figure") {
          const f = d.work!.figures.find((x) => x.id === op.id);
          if (!f) return fail(`Rasm topilmadi: ${op.id}`, at);
          f.caption = value;
          for (const s of d.sections)
            for (let i = 0; i < s.blocks.length; i++) {
              const b = s.blocks[i];
              if (b.kind === "figure" && b.figureId === op.id) s.blocks[i] = { ...b, text: value };
            }
        } else {
          const t = tableOf(d, op.id);
          if (!t) return fail(`Jadval topilmadi: ${op.id}`, at);
          t.caption = value;
          for (const s of d.sections)
            for (let i = 0; i < s.blocks.length; i++) {
              const b = s.blocks[i];
              if (b.kind === "tableRef" && b.tableId === op.id) s.blocks[i] = { ...b, text: value };
            }
        }
        break;
      }
      case "refRemove": {
        const refs = d.work!.references;
        if (!refs.some((r) => r.id === op.refId)) return fail(`Manba topilmadi: ${op.refId}`, at);
        d.work!.references = refs.filter((r) => r.id !== op.refId);
        for (const s of d.sections) {
          s.title = stripWorkCitation(s.title, op.refId);
          s.blocks = s.blocks.map((b) => (citable(b) && b.text.includes("[") ? { ...b, text: stripWorkCitation(b.text, op.refId) } : b));
        }
        for (const t of d.tables ?? []) {
          if (t.caption) t.caption = stripWorkCitation(t.caption, op.refId);
          t.rows = t.rows.map((r) => r.map((c) => (c.includes("[") ? stripWorkCitation(c, op.refId) : c)));
        }
        break;
      }
      case "blockRemove": {
        const hit = blockAt(d, op.path);
        const b = hit?.s.blocks[hit.bi];
        if (!hit || !b) return fail(`Yo'l topilmadi: ${op.path}`, at);
        hit.s.blocks.splice(hit.bi, 1);
        // Jadval bloki o'chsa jadvalning O'ZI ham ketadi (aks holda
        // `planWork` uni hujjat oxirida baribir chizardi).
        if (b.kind === "tableRef" && d.tables) d.tables = d.tables.filter((t) => t.id !== b.tableId);
        break;
      }
      case "blockInsert": {
        const hit = blockAt(d, op.path);
        if (!hit || hit.bi > hit.s.blocks.length) return fail(`Yo'l topilmadi: ${op.path}`, at);
        if (hit.s.blocks.length >= WORK_EDIT_LIMITS.blocks) return fail(`Bo'limdagi bloklar chegarasi: ${WORK_EDIT_LIMITS.blocks}`, at);
        hit.s.blocks.splice(hit.bi, 0, op.block);
        break;
      }
      case "setSection": {
        const s = d.sections.find((x) => x.id === op.sectionId);
        if (!s) return fail(`Bo'lim topilmadi: ${op.sectionId}`, at);
        if (op.blocks.length > WORK_EDIT_LIMITS.blocks) return fail(`Bo'limdagi bloklar chegarasi: ${WORK_EDIT_LIMITS.blocks}`, at);
        s.blocks = op.blocks.map((b) => ({ ...b }));
        break;
      }
      case "set": {
        /*
         * FAQAT matn qismlari olinadi: `meta`, rasm aktivlari
         * (`figures[].url/assetId`), titul maydonlari va hisobot JORIY
         * hujjatdan qoladi — klient yuborgan `doc` bilan begona URL yoki
         * soxta ball kirmasin.
         */
        const src = op.doc;
        if (!Array.isArray(src.sections) || !src.sections.length) return fail("«set» — bo'limlar yo'q", at);
        const next: AcademicDoc = {
          ...d,
          sections: src.sections.map((s) => ({ id: s.id, title: s.title, blocks: s.blocks.map((b) => ({ ...b })) })),
        };
        if (src.tables) next.tables = src.tables.map((t) => ({ ...t, headers: t.headers.slice(), rows: t.rows.map((r) => r.slice()) }));
        else delete next.tables;
        if (src.references) next.references = src.references.slice();
        else delete next.references;
        if (src.referencesNote) next.referencesNote = src.referencesNote;
        else delete next.referencesNote;
        const w = src.work;
        next.work = {
          ...d.work!,
          references: (w?.references ?? d.work!.references).map((r) => ({ ...r })),
          figures: d.work!.figures.map((f) => ({ ...f })),
          chapters: (w?.chapters ?? d.work!.chapters).map((c) => ({ ...c, paragraphs: c.paragraphs.map((p) => ({ ...p })) })),
        };
        d = next;
        break;
      }
      case "review": {
        if (op.review) d.work!.review = op.review;
        else delete d.work!.review;
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
 * o'sha op eski qiymat bilan; `refRemove` uchun BUTUN hujjat (`set`):
 * iqtiboslar o'nlab blokda o'zgaradi, ularni bittalab qaytarish xatoga moyil.
 */
export function inverseWorkOps(doc: AcademicDoc, ops: WorkOp[], ctx: WorkEditCtx): WorkOp[] {
  const out: WorkOp[] = [];
  let cur = doc;
  for (const op of ops) {
    const inv = inverseOne(cur, op);
    if (!inv) break;
    const step = applyWorkOps(cur, [op], ctx);
    // Yiqilgan operatsiya hujjatni o'zgartirmaydi — teskarisi ham keraksiz.
    if (!step.ok) break;
    out.push(inv);
    cur = step.doc;
  }
  return out.reverse();
}

function snapshot(doc: AcademicDoc): WorkOp {
  return { op: "set", doc: cloneWorkDoc(doc) };
}

function inverseOne(doc: AcademicDoc, op: WorkOp): WorkOp | null {
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
        const f = doc.work?.figures.find((x) => x.id === op.id);
        return f ? { op: "caption", target: "figure", id: op.id, value: f.caption } : null;
      }
      const t = tableOf(doc, op.id);
      return t ? { op: "caption", target: "table", id: op.id, value: t.caption ?? "" } : null;
    }
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
      return { op: "review", review: doc.work?.review ? cloneWorkDoc(doc).work!.review! : null };
    default:
      return null;
  }
}

/* ────────────────────────── tahlil (`unknown` dan) ────────────────────────── */

const OP_NAMES = new Set(["text", "heading", "cell", "caption", "refRemove", "blockRemove", "blockInsert", "setSection", "set"]);
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ID_RE = /^[\w:.\-/]{1,64}$/;

function scan(v: unknown, depth = 0): string | null {
  if (depth > 10) return "Tana juda chuqur";
  if (typeof v === "string") return v.length > WORK_EDIT_LIMITS.text ? "Matn juda uzun" : null;
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
const isIdx = (v: unknown, min = 0, max = 1000): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v < max;

export type WorkParseResult = { ok: true; ops: WorkOp[] } | { ok: false; error: string };

/** `set` uchun: faqat oq ro'yxatdagi maydonlar, har biri shakli bilan. */
function normalizeSetDoc(raw: unknown): AcademicDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.sections) || !d.sections.length || d.sections.length > 80) return null;
  const sections: DocSection[] = [];
  for (const s of d.sections as unknown[]) {
    const o = s as Record<string, unknown> | null;
    if (!o || typeof o !== "object") return null;
    const id = str(o.id, WORK_EDIT_LIMITS.id);
    const title = str(o.title, WORK_EDIT_LIMITS.title);
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
      const headers = normalizeStrings(o.headers, 20, WORK_EDIT_LIMITS.cell);
      if (!headers || !Array.isArray(o.rows) || o.rows.length > 500) return null;
      const rows: string[][] = [];
      for (const r of o.rows as unknown[]) {
        if (!Array.isArray(r) || r.length > 20 || !r.every((c) => typeof c === "string")) return null;
        rows.push((r as string[]).map((c) => c.slice(0, WORK_EDIT_LIMITS.cell)));
      }
      const tb: DocTable = { headers, rows };
      const id = str(o.id, WORK_EDIT_LIMITS.id);
      const caption = str(o.caption, WORK_EDIT_LIMITS.caption);
      const anchor = str(o.anchor, WORK_EDIT_LIMITS.id);
      const source = str(o.source, WORK_EDIT_LIMITS.caption);
      if (id) tb.id = id;
      if (caption !== null) tb.caption = caption;
      if (anchor) tb.anchor = anchor;
      if (source) tb.source = source;
      if (Array.isArray(o.widths) && o.widths.every((w) => typeof w === "number")) tb.widths = (o.widths as number[]).slice(0, 20);
      tables.push(tb);
    }
    out.tables = tables;
  }
  if (d.references !== undefined) {
    const refs = normalizeStrings(d.references, WORK_LIMITS.refs, 1000);
    if (!refs) return null;
    out.references = refs;
  }
  const note = str(d.referencesNote, 1000);
  if (note) out.referencesNote = note;
  if (d.work !== undefined) {
    const w = d.work as Record<string, unknown> | null;
    if (!w || typeof w !== "object") return null;
    const work: Partial<NonNullable<AcademicDoc["work"]>> = {};
    if (w.references !== undefined) {
      if (!Array.isArray(w.references) || w.references.length > WORK_LIMITS.refs) return null;
      const refs: Reference[] = [];
      for (const r of w.references as unknown[]) {
        const o = r as Record<string, unknown> | null;
        if (!o || typeof o !== "object") return null;
        const id = str(o.id, WORK_EDIT_LIMITS.id);
        const title = str(o.title, 600);
        const authors = normalizeStrings(o.authors, 60, 200);
        if (!id || title === null || !authors) return null;
        const ref: Reference = { id, title, authors, verified: "unverified", cited: Boolean(o.cited) };
        /*
         * `verified` — FAQAT bilinadigan qiymatlar. Noma'lum satr
         * («openalex-ish») `unverified` ga tushadi: klient tekshiruv
         * belgisini o'ziga «yuqori» qilib yozib yubormasin.
         */
        for (const v of ["openalex", "crossref", "googlebooks", "lexuz", "user", "unverified"] as const) {
          if (o.verified === v) ref.verified = v;
        }
        for (const k of ["doi", "venue", "url", "publisher", "place", "pages", "raw", "isbn", "docNo", "docDate", "issuer", "accessed", "pageCount"] as const) {
          const v = str(o[k], 600);
          if (v) (ref as Record<string, unknown>)[k] = v;
        }
        if (isIdx(o.year, 0, 3000)) ref.year = o.year;
        if (isIdx(o.n, 0, 1000)) ref.n = o.n;
        if (typeof o.kind === "string" && ["article", "book", "law", "web", "user"].includes(o.kind)) ref.kind = o.kind as Reference["kind"];
        refs.push(ref);
      }
      work.references = refs;
    }
    if (w.chapters !== undefined) {
      if (!Array.isArray(w.chapters) || w.chapters.length > WORK_LIMITS.chapters) return null;
      const chapters: NonNullable<AcademicDoc["work"]>["chapters"] = [];
      for (const c of w.chapters as unknown[]) {
        const o = c as Record<string, unknown> | null;
        if (!o || typeof o !== "object") return null;
        const id = str(o.id, WORK_EDIT_LIMITS.id);
        const title = str(o.title, WORK_EDIT_LIMITS.title);
        if (!id || title === null || !Array.isArray(o.paragraphs) || o.paragraphs.length > WORK_LIMITS.paragraphs) return null;
        const paragraphs: NonNullable<AcademicDoc["work"]>["chapters"][number]["paragraphs"] = [];
        for (const p of o.paragraphs as unknown[]) {
          const q = p as Record<string, unknown> | null;
          if (!q || typeof q !== "object") return null;
          const pid = str(q.id, WORK_EDIT_LIMITS.id);
          const ptitle = str(q.title, WORK_EDIT_LIMITS.title);
          if (!pid || ptitle === null) return null;
          paragraphs.push({ id: pid, title: ptitle, sectionId: str(q.sectionId, WORK_EDIT_LIMITS.id) || pid });
        }
        chapters.push({ id, title, paragraphs });
      }
      work.chapters = chapters;
    }
    out.work = work as NonNullable<AcademicDoc["work"]>;
  }
  return out;
}

/**
 * HTTP tanasidan `WorkOp[]` ga. Shakl xatosi shu yerda (400), mazmun
 * xatosi `applyWorkOps` da (422) — `parseArticleOps` bilan bir xil
 * taqsimot. `review` opi bu yerdan O'TMAYDI (faqat server).
 */
export function parseWorkOps(raw: unknown): WorkParseResult {
  if (!Array.isArray(raw)) return { ok: false, error: "Operatsiyalar ro'yxati kutilgan" };
  if (!raw.length) return { ok: false, error: "Operatsiya yo'q" };
  if (raw.length > WORK_EDIT_LIMITS.ops) return { ok: false, error: `Bir so'rovda ${WORK_EDIT_LIMITS.ops} tadan ortiq operatsiya bo'lmaydi` };
  const bad = scan(raw);
  if (bad) return { ok: false, error: bad };

  const ops: WorkOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Operatsiya obyekt bo'lishi kerak" };
    const o = item as Record<string, unknown>;
    const name = typeof o.op === "string" ? o.op : "";
    if (!OP_NAMES.has(name)) return { ok: false, error: "Noma'lum operatsiya" };
    switch (name) {
      case "text":
        if (typeof o.path !== "string" || !WORK_PATH_RE.test(o.path)) return { ok: false, error: "«path» yaroqsiz" };
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
      case "refRemove":
        if (!isId(o.refId)) return { ok: false, error: "«refId» yaroqsiz" };
        ops.push({ op: "refRemove", refId: o.refId });
        break;
      case "blockRemove":
        if (typeof o.path !== "string" || !WORK_PATH_RE.test(o.path)) return { ok: false, error: "«path» yaroqsiz" };
        ops.push({ op: "blockRemove", path: o.path });
        break;
      case "blockInsert": {
        if (typeof o.path !== "string" || !WORK_PATH_RE.test(o.path)) return { ok: false, error: "«path» yaroqsiz" };
        const block = normalizeWorkBlock(o.block);
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
