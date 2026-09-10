import { llmComplete } from "../llm";
import { parseLlmObject } from "../json";
import { mapPool } from "../quality";
import { langInfo } from "../i18n";
import { renderDocx } from "../render-docx";
import { renderHtml } from "../render-html";
import type { BuildOptions } from "../index";
import type { AcademicDoc, Block, BuiltFile, Delivered, DocMeta } from "../types";
import type { FormValues } from "../../types";
import {
  applySegments,
  extractSegments,
  joinSubsegments,
  markDuplicates,
  outputFileName,
  OUTPUT_MIME,
  pdfBlocksToDoc,
  splitOversize,
  stripTokens,
  textToSegments,
  tokenMultiset,
  tokensBalanced,
  type Extracted,
  type Segment,
  type SegmentMap,
  type SourceKind,
} from "./index";
import { glossarySystem, glossaryUser, strictSuffix, translationBatchUser, translationSystem, type BatchItem } from "./prompts";
import { isTranslationStyle, type GlossaryEntry, type TranslationReport, type TranslationStyle, type TranslationWarning } from "./report";
import { parseUserGlossary, USER_GLOSSARY_MAX } from "./glossary";
export { parseUserGlossary } from "./glossary";

/**
 * TARJIMA DVIGATELI (Tarjimon 2).
 *
 * Kirish — segmentlar (fayl yoki matn), chiqish — id → tarjima xaritasi va
 * hisobot. Tuzilma bu yerda O'ZGARMAYDI: fayl adapterlari (`./index`)
 * matn tugunlarini almashtiradi, biz faqat matnni tarjima qilamiz.
 *
 * Bosqichlar:
 *   1) dublikatlar bir marta (bir xil sarlavha 20 slaydda — bitta chaqiruv),
 *      juda uzun segment jumla chegarasida bo'linadi (`splitOversize`);
 *   2) 1-O'TISH — butun hujjatdan namuna: manba tilini ANIQLASH va
 *      atamalar lug'ati (glossariy). Keyingi har partiya shu lug'at bilan
 *      tarjima qilinadi — «pro» sifatning asosi: 60 ta partiya bir xil
 *      atamani 60 xil tarjima qilmaydi;
 *   3) partiyalar (≤ `BATCH_CHARS`, segment bo'linmaydi) `mapPool` bilan
 *      parallel; har partiya JSON `{items:[{id,text}]}`;
 *   4) TEKSHIRUV: id to'liq, bo'sh emas, manbaga aynan teng emas, maket
 *      tokenlari (⟦…⟧) multiset bilan teng, raqam/URL/email/akronim
 *      saqlangan (`checkVerbatim`);
 *   5) QAYTA URINISH: partiya darajasida (JSON kelmadi) — ikkiga bo'lib;
 *      band darajasida — faqat muvaffaqiyatsiz idlar bilan qat'iy
 *      ko'rsatma, ≤ `ITEM_RETRIES`;
 *   6) QISMAN QOIDA: qolgan muvaffaqiyatsizlar ≤ 3% (va ≤ 20) bo'lsa asl
 *      matn qoladi + ogohlantirish + `delivered` (worker farqni qaytaradi);
 *      ko'proq bo'lsa — xato, to'liq qaytarish (eski semantika).
 */

export const BATCH_CHARS = 3500;
export const POOL = 4;
export const GLOSSARY_SAMPLE_CHARS = 12_000;
export const GLOSSARY_MAX = 40;
export const PREV_TAIL_CHARS = 400;
export const ITEM_RETRIES = 2;
export const PARTIAL_MAX_SHARE = 0.03;
export const PARTIAL_MAX_COUNT = 20;
/** Shu uzunlikdan qisqa band o'zgarishsiz qolsa — jim (ism, sarlavha, manba qatori). */
export const UNCHANGED_WARN_CHARS = 80;
export const PAIRS_MAX = 3000;
export const PAIRS_MAX_CHARS = 700_000;
const MIN_WAVE_MS = 15_000;

export type TranslateDeps = {
  complete?: typeof llmComplete;
  now?: () => number;
};

export type TranslateOpts = {
  target: string;
  sourceLang: string;
  style: TranslationStyle;
  userGlossary: GlossaryEntry[];
  deadline: number;
  onStage?: BuildOptions["onStage"];
  sourceKind: string;
  sourceName?: string;
  /** Adapter ogohlantirishlari (masalan SmartArt) hisobotga qo'shiladi. */
  extractWarnings?: string[];
};

export type TranslateResult = { map: SegmentMap; report: TranslationReport; delivered?: Delivered };

/* ───────────────────────────── verbatim tekshiruvi ───────────────────────────── */

const NUM_RE = /\d+(?:[.,\s]\d+)*/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s⟦⟧<>"']+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PLACEHOLDER_RE = /\{\{[^}]*\}\}|\{[a-zA-Z_][\w.]*\}|%[sd]|\$[A-Z_][A-Z0-9_]*/g;
const ACRONYM_RE = /\b[A-Z][A-Z0-9]{2,}\b/g;

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Manbadagi «o'zgarmas» narsalar tarjimada ham bormi.
 *
 * Raqamlar faqat RAQAMLARI bilan solishtiriladi: «1 000», «1,000», «1000»
 * — bitta narsa. So'z bilan yozilgan raqam («ming») yolg'on salbiy beradi —
 * shuning uchun bu tekshiruv pul qaytarmaydi, faqat qayta urinish va
 * ogohlantirish (`numbers`).
 */
export function checkVerbatim(src: string, dst: string): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const dstDigits = digitsOnly(dst);
  for (const m of src.match(NUM_RE) ?? []) {
    const d = digitsOnly(m);
    if (d && !dstDigits.includes(d)) missing.push(m.trim());
  }
  for (const re of [URL_RE, EMAIL_RE, PLACEHOLDER_RE]) {
    for (const m of src.match(re) ?? []) if (!dst.includes(m)) missing.push(m);
  }
  const dstUpper = dst.toUpperCase();
  for (const m of src.match(ACRONYM_RE) ?? []) {
    // Kirill/lotin transliteratsiyasi bo'lishi mumkin (ЮНЕСКО) — faqat lotin akronimlar, katta harfda qidiriladi.
    if (!dstUpper.includes(m)) missing.push(m);
  }
  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

/* ───────────────────────────── partiyalash ───────────────────────────── */

export function planBatches(segs: Segment[], maxChars = BATCH_CHARS): Segment[][] {
  const out: Segment[][] = [];
  let cur: Segment[] = [];
  let size = 0;
  for (const s of segs) {
    const n = s.text.length;
    if (cur.length && size + n > maxChars) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* ───────────────────────────── 1-o'tish: glossariy ───────────────────────────── */

/** Namuna: kichik hujjat — boshidan; katta — tekis taqsimlangan 1 500 belgili oynalar. */
export function glossarySample(segs: Segment[], max = GLOSSARY_SAMPLE_CHARS): { sample: string; total: number } {
  const texts = segs.map((s) => stripTokens(s.text));
  const total = texts.reduce((n, t) => n + t.length, 0);
  if (total <= max) return { sample: texts.join("\n"), total };
  const full = texts.join("\n");
  const win = 1500;
  const windows = Math.max(2, Math.floor(max / win));
  const step = (full.length - win) / (windows - 1);
  const parts: string[] = [];
  for (let i = 0; i < windows; i++) {
    const at = Math.round(i * step);
    parts.push(full.slice(at, at + win));
  }
  return { sample: parts.join("\n…\n"), total };
}

type GlossaryPass = { detected?: string; domain?: string; glossary: GlossaryEntry[] };

const KNOWN_LANGS = new Set(["uz", "kaa", "kk", "ky", "tg", "tk", "ru", "en", "tr", "ar", "de", "fr", "es", "zh", "ko", "ja", "it", "pt"]);

async function glossaryPass(segs: Segment[], target: string, timeoutMs: number, complete: typeof llmComplete): Promise<GlossaryPass> {
  const { sample, total } = glossarySample(segs);
  if (!sample.trim()) return { glossary: [] };
  const raw = await complete(glossarySystem(target), glossaryUser(sample, sample.length, total), 2500, { json: true, timeoutMs, thinking: 0 }).catch(
    () => null,
  );
  const data = parseLlmObject<{ detected?: unknown; domain?: unknown; glossary?: unknown }>(raw);
  if (!data) return { glossary: [] };
  const detected = typeof data.detected === "string" && KNOWN_LANGS.has(data.detected.toLowerCase()) ? data.detected.toLowerCase() : undefined;
  const domain = typeof data.domain === "string" ? data.domain.trim().slice(0, 80) : undefined;
  const lower = sample.toLowerCase();
  const glossary: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const g of Array.isArray(data.glossary) ? data.glossary : []) {
    if (!g || typeof g !== "object") continue;
    const src = String((g as { src?: unknown }).src ?? "")
      .trim()
      .slice(0, 80);
    const dst = String((g as { dst?: unknown }).dst ?? "")
      .trim()
      .slice(0, 120);
    if (!src || !dst || src.length < 2) continue;
    // Faqat NAMUNADA uchraydigan atama — model o'ylab topganini kiritmaymiz.
    if (!lower.includes(src.toLowerCase())) continue;
    const key = src.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    glossary.push({ src, dst });
    if (glossary.length >= GLOSSARY_MAX) break;
  }
  return { detected, domain: domain || undefined, glossary };
}

/** Foydalanuvchi lug'ati modelnikidan USTUN (bir xil `src` — foydalanuvchiniki qoladi). */
export function mergeGlossary(model: GlossaryEntry[], user: GlossaryEntry[]): GlossaryEntry[] {
  const keys = new Set(user.map((g) => g.src.toLowerCase()));
  return [...user, ...model.filter((g) => !keys.has(g.src.toLowerCase()))].slice(0, GLOSSARY_MAX + USER_GLOSSARY_MAX);
}

/* ───────────────────────────── partiya tarjimasi ───────────────────────────── */

type ItemFail = { id: string; reason: "missing" | "empty" | "same" | "tokens" | "verbatim"; detail?: string };

function hasLetters(s: string): boolean {
  return /\p{L}{3,}/u.test(s);
}

function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

/** Bitta javobni tekshirish: xarita (id → matn) va muvaffaqiyatsizlar. */
export function validateItems(batch: Segment[], data: unknown, opts: { sameLang: boolean }): { ok: Map<string, string>; fails: ItemFail[] } {
  const ok = new Map<string, string>();
  const fails: ItemFail[] = [];
  const got = new Map<string, string>();
  const items =
    data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items) ? ((data as { items: unknown[] }).items as unknown[]) : [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const id = String((it as { id?: unknown }).id ?? "");
    const text = (it as { text?: unknown }).text;
    if (id && typeof text === "string") got.set(id, text);
  }
  for (const seg of batch) {
    const text = got.get(seg.id);
    if (text === undefined) {
      fails.push({ id: seg.id, reason: "missing" });
      continue;
    }
    const t = text.trim();
    if (!t) {
      fails.push({ id: seg.id, reason: "empty" });
      continue;
    }
    if (!opts.sameLang && hasLetters(seg.text) && sameText(t, seg.text)) {
      fails.push({ id: seg.id, reason: "same" });
      continue;
    }
    const srcTok = tokenMultiset(seg.text);
    const dstTok = tokenMultiset(t);
    if (srcTok.join("") !== dstTok.join("") || !tokensBalanced(t)) {
      fails.push({ id: seg.id, reason: "tokens", detail: `${srcTok.length}≠${dstTok.length}` });
      continue;
    }
    const v = checkVerbatim(stripTokens(seg.text), stripTokens(t));
    if (!v.ok) {
      // Tarjima QABUL qilinadi (xaritaga tushadi), lekin qayta urinishga nomzod.
      ok.set(seg.id, t);
      fails.push({ id: seg.id, reason: "verbatim", detail: v.missing.slice(0, 3).join(", ") });
      continue;
    }
    ok.set(seg.id, t);
  }
  return { ok, fails };
}

/* ───────────────────────────── asosiy oqim ───────────────────────────── */

export async function translateSegments(segs: Segment[], opts: TranslateOpts, deps: TranslateDeps = {}): Promise<TranslateResult> {
  const complete = deps.complete ?? llmComplete;
  const now = deps.now ?? Date.now;
  const remaining = () => Math.max(0, opts.deadline - now());
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });

  // 1) dublikatlar va uzun segmentlar.
  markDuplicates(segs);
  const originals = segs.filter((s) => !s.dup);
  const work: Segment[] = [];
  const children = new Map<string, string[]>(); // ota id → bola idlari (oversize)
  for (const s of originals) {
    const parts = splitOversize(s, BATCH_CHARS);
    if (parts.length === 1 && parts[0].id === s.id) {
      work.push(s);
    } else {
      children.set(
        s.id,
        parts.map((p) => p.id),
      );
      work.push(...parts);
    }
  }
  const total = work.length;
  const chars = segs.reduce((n, s) => n + s.text.length, 0);

  // 2) 1-o'tish.
  stage(8, "Atamalar aniqlanmoqda");
  const sameLangRequested = opts.sourceLang !== "avto" && opts.sourceLang === opts.target;
  const gp = total ? await glossaryPass(work, opts.target, Math.min(60_000, Math.max(20_000, remaining() / 6)), complete) : { glossary: [] };
  const detected = opts.sourceLang !== "avto" ? opts.sourceLang : (gp.detected ?? "avto");
  const glossary = mergeGlossary(gp.glossary, opts.userGlossary);
  const warnings: TranslationWarning[] = [];
  for (const w of opts.extractWarnings ?? []) warnings.push({ code: "skipped-part", detail: w });
  if (opts.sourceLang !== "avto" && gp.detected && gp.detected !== opts.sourceLang) {
    warnings.push({
      code: "detected",
      detail: `Manba tili sifatida ${langInfo(opts.sourceLang).native} tanlangan, matn ${langInfo(gp.detected).native} tilida ko‘rinadi`,
    });
  }
  if (opts.target === "ar") warnings.push({ code: "rtl", detail: "Arab tili — paragraf yo‘nalishi (o‘ngdan chapga) faylda qo‘lda sozlanadi" });
  const system = translationSystem(opts.target, opts.sourceLang, detected, opts.style, glossary, gp.domain);
  const sameLang = sameLangRequested || detected === opts.target;

  // 3) partiyalar.
  const batches = planBatches(work, BATCH_CHARS);
  const map: SegmentMap = new Map();
  const failed = new Map<string, ItemFail>();
  const verbatimWarn = new Map<string, string>();
  const unchangedWarn = new Map<string, string>();
  let done = 0;
  const waveOf = (i: number) => Math.floor(i / POOL);
  const wavesTotal = Math.max(1, Math.ceil(batches.length / POOL));

  type CallResult = { ok: Map<string, string>; fails: ItemFail[]; parsed: boolean };
  const callBatch = async (items: Segment[], index: number, prevTail: string | undefined, suffix = ""): Promise<CallResult> => {
    const wavesLeft = Math.max(1, wavesTotal - waveOf(index));
    const timeoutMs = Math.max(25_000, Math.min(90_000, remaining() / wavesLeft));
    const batchChars = items.reduce((n, s) => n + s.text.length, 0);
    const maxTokens = Math.min(8000, Math.ceil((batchChars * 1.6) / 3) + 400);
    const payload: BatchItem[] = items.map((s) => ({ id: s.id, kind: s.kind, ctx: s.ctx, text: s.text }));
    const raw = await complete(system, translationBatchUser(payload, index, batches.length, prevTail) + suffix, maxTokens, {
      json: true,
      timeoutMs,
      thinking: 0,
    }).catch(() => null);
    const data = parseLlmObject(raw);
    if (!data) {
      console.warn(`[translate] partiya ${index + 1}/${batches.length}: JSON kelmadi (${raw === null ? "javob yo'q/xato" : `${raw.length} belgi`}), ${items.length} band`);
      return { ok: new Map(), fails: items.map((s) => ({ id: s.id, reason: "missing" as const })), parsed: false };
    }
    const v = validateItems(items, data, { sameLang });
    return { ...v, parsed: true };
  };

  const translateBatch = async (batch: Segment[], index: number) => {
    const prevTail = index > 0 ? stripTokens(batches[index - 1].map((s) => s.text).join(" ")).slice(-PREV_TAIL_CHARS) : undefined;
    if (remaining() < MIN_WAVE_MS) {
      for (const s of batch) failed.set(s.id, { id: s.id, reason: "missing", detail: "vaqt tugadi" });
      done++;
      return;
    }
    let res = await callBatch(batch, index, prevTail);
    // Partiya darajasi: JSON kelmadi yoki yarmidan kami — ikkiga bo'lib qayta.
    if ((!res.parsed || res.ok.size < batch.length / 2) && batch.length >= 2 && remaining() > MIN_WAVE_MS) {
      const mid = Math.ceil(batch.length / 2);
      const a = await callBatch(batch.slice(0, mid), index, prevTail);
      const b = await callBatch(batch.slice(mid), index, undefined);
      res = { ok: new Map([...a.ok, ...b.ok]), fails: [...a.fails, ...b.fails], parsed: a.parsed || b.parsed };
    }
    for (const [id, t] of res.ok) map.set(id, t);
    /*
     * `same` — model matnni o'zgarishsiz qaytardi (kod qatori, ism, «Reja»,
     * yaqin tillarda bir xil so'z). Qayta SO'RALMAYDI: qat'iy «tarjima
     * qil» ko'rsatmasi kod/ismni buzishga undaydi. Asl matn qabul qilinadi,
     * faqat uzun band ogohlantirish oladi (`UNCHANGED_WARN_CHARS`).
     */
    const acceptUnchanged = (f: ItemFail) => {
      const src = batch.find((s) => s.id === f.id)?.text ?? "";
      map.set(f.id, src);
      if (stripTokens(src).length >= UNCHANGED_WARN_CHARS) unchangedWarn.set(f.id, stripTokens(src).slice(0, 60));
    };
    let pending = res.fails.filter((f) => {
      if (f.reason !== "same") return true;
      acceptUnchanged(f);
      return false;
    });
    // Band darajasi: faqat muvaffaqiyatsizlar, qat'iy ko'rsatma.
    for (let attempt = 0; attempt < ITEM_RETRIES && pending.length && remaining() > MIN_WAVE_MS; attempt++) {
      const ids = new Set(pending.map((f) => f.id));
      const items = batch.filter((s) => ids.has(s.id));
      const reasons = pending.map((f) => `${f.id}:${f.reason}${f.detail ? `(${f.detail})` : ""}`).join(", ");
      const r = await callBatch(items, index, prevTail, strictSuffix(reasons));
      for (const [id, t] of r.ok) map.set(id, t);
      if (!r.parsed) continue; // javob kelmadi — `pending` o'zgarmaydi, yana urinish
      pending = r.fails.filter((f) => {
        if (f.reason !== "same") return true;
        acceptUnchanged(f);
        return false;
      });
    }
    for (const f of pending) {
      if (f.reason === "verbatim") verbatimWarn.set(f.id, f.detail ?? "");
      else if (f.reason === "same") acceptUnchanged(f);
      else failed.set(f.id, f);
    }
    done++;
    stage(10 + Math.round((80 * done) / Math.max(1, batches.length)), `Tarjima qilinmoqda · ${done}/${batches.length}`);
  };

  if (batches.length) await mapPool(batches, POOL, translateBatch);

  // 6) qisman qoida.
  for (const id of failed.keys()) map.delete(id);
  const failedCount = failed.size;
  if (failedCount) {
    // Sabablar jurnali — prodda «24 tasi tarjima qilinmadi» ning NEGA ekanini ko'rish uchun.
    const bySabab: Record<string, number> = {};
    for (const f of failed.values()) bySabab[f.reason] = (bySabab[f.reason] ?? 0) + 1;
    const sample = [...failed.values()].slice(0, 5).map((f) => `${f.id}:${f.reason}${f.detail ? `(${f.detail})` : ""}`).join(", ");
    console.warn(`[translate] ${failedCount}/${total} band muvaffaqiyatsiz ${JSON.stringify(bySabab)}; namuna: ${sample}`);
  }
  const allowed = Math.min(PARTIAL_MAX_COUNT, Math.max(1, Math.ceil(total * PARTIAL_MAX_SHARE)));
  if (failedCount > allowed) {
    throw new Error(`Tarjima to‘liq chiqmadi: ${total} banddan ${failedCount} tasi tarjima qilinmadi. Kredit qaytariladi — qayta urinib ko‘ring.`);
  }
  const byId = new Map(work.map((s) => [s.id, s]));
  for (const [id] of failed) {
    const s = byId.get(id);
    if (!s) continue;
    map.set(id, s.text);
    warnings.push({ code: "untranslated", id, detail: stripTokens(s.text).slice(0, 60) });
  }
  for (const [id, detail] of verbatimWarn) warnings.push({ code: "numbers", id, detail: detail || "raqam/URL mos kelmadi" });
  for (const [id, detail] of unchangedWarn) warnings.push({ code: "unchanged", id, detail });

  // Bo'laklarni ota segmentga yig'ish, dublikatlarni to'ldirish.
  for (const [parent, ids] of children) {
    map.set(parent, joinSubsegments(ids.map((id) => map.get(id) ?? byId.get(id)?.text ?? "")));
    for (const id of ids) map.delete(id);
  }
  for (const s of segs) if (s.dup && map.has(s.dup)) map.set(s.id, map.get(s.dup)!);

  // Hisobot juftlari (ko'ruvchi).
  const warnIds = new Set(warnings.map((w) => w.id).filter(Boolean));
  const pairs: TranslationReport["pairs"] = [];
  let pairChars = 0;
  let pairsTruncated = false;
  for (const s of segs) {
    const dst = map.get(s.id) ?? s.text;
    if (pairs.length >= PAIRS_MAX || pairChars > PAIRS_MAX_CHARS) {
      pairsTruncated = true;
      break;
    }
    const src = stripTokens(s.text);
    const out = stripTokens(dst);
    pairChars += src.length + out.length;
    const warn =
      warnIds.has(s.id) ||
      (s.dup ? warnIds.has(s.dup) : false) ||
      (children.get(s.id)?.some((c) => warnIds.has(c)) ?? false);
    pairs.push({ id: s.id, src, dst: out, kind: s.kind, ctx: s.ctx, warn: warn || undefined });
  }

  const report: TranslationReport = {
    sourceLang: opts.sourceLang,
    detected,
    target: opts.target,
    style: opts.style,
    domain: gp.domain,
    glossary,
    warnings,
    pairs,
    pairsTruncated: pairsTruncated || undefined,
    segments: segs.length,
    translated: segs.length - failedCount,
    chars,
    sourceKind: opts.sourceKind,
    sourceName: opts.sourceName,
  };
  const delivered: Delivered | undefined = failedCount ? { got: total - failedCount, want: total, unit: "band", refundShare: 1 } : undefined;
  return { map, report, delivered };
}

/* ───────────────────────────── artefakt ───────────────────────────── */

function blockFor(kind: string, text: string): Block {
  if (kind === "title") return { kind: "h1", text };
  if (kind === "h") return { kind: "h2", text };
  if (kind === "li") return { kind: "li", text };
  return { kind: "p", text };
}

function docFromSegments(meta: DocMeta, segs: Segment[], map: SegmentMap, report: TranslationReport): AcademicDoc {
  const blocks: Block[] = segs
    .map((s) => blockFor(s.kind, stripTokens(map.get(s.id) ?? s.text).replace(/\t/g, " ")))
    .filter((b) => b.text.trim());
  return { meta, titlePage: false, toc: false, sections: [{ id: "body", title: "", blocks }], translation: report };
}

/** Fayl rejimida ham `doc` bo'ladi: bosh sahifa kartasi (`buildPreview`) uchun birinchi 40 tarjima paragrafi. */
function previewDoc(meta: DocMeta, report: TranslationReport): AcademicDoc {
  const blocks: Block[] = report.pairs
    .filter((p) => p.dst.trim())
    .slice(0, 40)
    .map((p) => blockFor(p.kind, p.dst.replace(/\t/g, " ")));
  return { meta, titlePage: false, toc: false, sections: [{ id: "body", title: "", blocks }], translation: report };
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Tarjima artefakti — `buildArtifact` dan chaqiriladi.
 *
 * Fayl rejimi (`opts.source`): natija bayti = O'SHA fayl, faqat matn
 * tugunlari almashgan; mime va nom kirish formatidan. PDF → toza DOCX
 * (`pdfBlocksToDoc`, profil `translation`). Matn rejimi → DOCX (profil
 * `translation`, GOST emas — AUDIT-5).
 */
export async function buildTranslationArtifact(meta: DocMeta, values: FormValues, opts: BuildOptions): Promise<BuiltFile> {
  const target = meta.language || "uz";
  const sourceLang = String(values.sourceLang ?? "avto") || "avto";
  const style: TranslationStyle = isTranslationStyle(values.style) ? values.style : "formal";
  const userGlossary = parseUserGlossary(values.userGlossary);
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });
  stage(3, "Manba o‘qilmoqda");

  const wantsFile = Boolean(String(values.sourceAssetId ?? "").trim());
  let extracted: Extracted;
  let kind: SourceKind | "text";
  if (wantsFile || opts.source) {
    if (!opts.source) throw new Error("Yuklangan fayl topilmadi — kredit qaytariladi. Faylni qayta yuklab ko‘ring.");
    kind = opts.source.kind;
    extracted = await extractSegments(opts.source.kind, opts.source.bytes);
  } else {
    kind = "text";
    extracted = textToSegments(String(values.sourceText ?? meta.sourceText ?? ""));
  }
  if (!extracted.chars) throw new Error("Tarjima qilinadigan matn topilmadi. Kredit qaytariladi.");

  const { map, report, delivered } = await translateSegments(extracted.segments, {
    target,
    sourceLang,
    style,
    userGlossary,
    deadline: opts.deadline,
    onStage: opts.onStage,
    sourceKind: kind,
    sourceName: opts.source?.name,
    extractWarnings: extracted.warnings,
  });

  stage(95, "Hujjat yig‘ilmoqda");
  if (kind === "text") {
    const doc = docFromSegments(meta, extracted.segments, map, report);
    const bytes = await renderDocx(doc);
    return { html: renderHtml(doc), bytes, fileName: `${meta.fileNameHint}-tarjima.docx`, mime: DOCX_MIME, doc, delivered };
  }
  const source = opts.source!;
  if (kind === "pdf") {
    const doc = pdfBlocksToDoc(extracted.pdf?.blocks ?? [], map, meta);
    doc.translation = report;
    const bytes = await renderDocx(doc);
    return { html: renderHtml(doc), bytes, fileName: outputFileName(source.name, "pdf", target), mime: DOCX_MIME, doc, delivered };
  }
  const bytes = await applySegments(kind, source.bytes, map);
  return {
    html: "",
    bytes,
    fileName: outputFileName(source.name, kind, target),
    mime: OUTPUT_MIME[kind],
    doc: previewDoc(meta, report),
    delivered,
  };
}
