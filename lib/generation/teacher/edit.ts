/**
 * O'QITUVCHI HUJJATI TAHRIR OPERATSIYALARI (AUDIT-20 WP-D).
 *
 * `work/edit.ts` bilan AYNI tashqi shartnoma: `applyTeacherOps` sof
 * funksiya (yangi `doc`), `inverseTeacherOps` undo uchun teskari
 * ro'yxat, `parseTeacherOps` esa HTTP tanasi (`unknown`) bilan mantiq
 * orasidagi YAGONA darvoza. Klient (`useTeacherEdit`) ham, server
 * (`teacherAdapter`) ham shu uchtasini chaqiradi.
 *
 * ━━ NEGA ALOHIDA OP TILI ━━
 *
 * Talaba ishida tahrir qilinadigan narsa BITTA: bo'lim bloklari
 * (`sections.<i>.blocks.<j>`). O'qituvchi hujjatida ikkita: o'sha
 * bloklar VA `TeacherModel` (dars bosqichi, hafta qatori, atama,
 * savol). Ikkalasi bir vaqtda mavjud, lekin BIR VAQTDA CHIZILMAYDI —
 * `planTeacher attach()` modeldan band quradi FAQAT bo'lim bo'sh
 * bo'lganda. Ya'ni har maydon uchun aynan bittasi ekranda.
 *
 * ━━ YO'L SHARTNOMASI (`planTeacher` bilan bir xil) ━━
 *
 *   nasr        `sections.<i>.blocks.<j>`
 *   jadval      `table:<n>`  (hujjat jadvali, `review.ts tableTarget`)
 *   model bandi `teacher.<kind>.<...>`  (`teacher.lesson.stages.2.method`)
 *   mavzu       `meta.topic`  (shapkadagi «Mavzu:» maydoni)
 *
 * Har op yo'li JORIY REJA bilan solishtiriladi (`planPaths`): ekranda
 * bo'lmagan bandni tahrirlab bo'lmaydi. Bu «teacherFlow band id lari
 * `plan.body` bilan bir-bir» kafolatining ikkinchi yarmi — birinchisi
 * `teacherEditTargets` (u ham AYNI rejani yuradi).
 *
 * ━━ IZCHILLIK (model ⇄ sections) ━━
 *
 * Dvigatel nasrni ham, modelni ham yozadi (`lesson.ts`: `stageBlocks`
 * va `model.stages` — AYNI ma'lumot). Hisobot, prompt va «Tuzatish»
 * MODELDAN o'qiydi. Demak nasr tahrirlanib model eskirsa, «Tuzatish»
 * eski bosqich nomi bilan ishlardi va hisobot yo'q qilingan matnni
 * baholardi. Uch joyda sinxron ushlanadi:
 *
 *   1. NASR → MODEL (`teacherMirrors`). Har bo'lim uchun blok
 *      indeksidan model yo'liga xarita — dvigatel yozgan TARTIB
 *      bo'yicha qayta yuriladi (matnga qarab emas). Shakl mos
 *      kelmasa (blok o'chirilgan) o'sha bo'lim xaritasi BUTUNLAY
 *      tashlanadi: sinxronni yo'qotish noto'g'ri maydonga yozishdan
 *      xavfsizroq.
 *   2. JADVAL KATAGI → MODEL. Faqat TAHRIRLANGAN katak ko'chiriladi,
 *      butun jadval QAYTA hisoblanmaydi: dars jadvali modelni
 *      KESIB saqlaydi (`clip(st.title, 44)`), qayta hisob esa shu
 *      kesilgan matnni modelga qaytarardi.
 *   3. SHAPKA → PASPORT TAKRORI. `planTeacher isHeadRecap` pasport
 *      paragrafini FAQAT shapka juftlariga aynan mos kelsa tashlaydi;
 *      shapka maydoni o'zgarsa eski takror mos kelmay qoladi va
 *      ekranda DUBLIKAT bo'lib chiqadi. Shuning uchun takror qatori
 *      yangi qiymatlar bilan qayta yoziladi.
 *
 * ━━ NIMA TAHRIRLANMAYDI ━━
 *
 * `text` opi FAQAT satrli maydonni o'zgartiradi. Rejada ko'rinadigan,
 * lekin SON yoki RO'YXAT bo'lgan maydonlar (`school.grade`,
 * `lesson.durationMin`, `map.weeklyHours`, `test.scoring.total`,
 * `bloom`, `difficulty`) rad etiladi — ular FORMADA (WP-E). Sabab
 * mahsulotda: hisobot arifmetikasi (`minutesSum`, `scoreSum`,
 * `variantParity`) shu sonlarga tayanadi, ko'ruvchidan kelgan erkin
 * matn esa u yerga «qirq besh» yozib qo'yishi mumkin edi.
 *
 * Eski hujjat (`doc.teacher` yo'q — `plan.legacy`) UMUMAN
 * tahrirlanmaydi: `legacyTeacherModel` modelni TAXMIN qiladi, ya'ni
 * `teacher.lesson.stages.2.teacher` yo'li boshqa maydonga tegib
 * ketishi mumkin edi. Adapter uni 409 `legacy` bilan qaytaradi.
 */
import type { AcademicDoc, Block, DocSection, DocTable, Figure } from "../types";
import type { DocReview } from "../report/types";
import { planTeacher, quarterIndexOf, variantIdOf, type TeacherPlan } from "./layout";
import { teacherLabels } from "./prompts";
import type { TeacherKind, TeacherModel } from "./types";

/* ══════════════════════════ shakl ══════════════════════════ */

/** Nasr bloki — `work/edit.ts` bilan AYNI shakl. */
export const TEACHER_BLOCK_PATH_RE = /^sections\.\d{1,2}\.blocks\.\d{1,3}$/;
/** Model bandi — `teacher.lesson.stages.2.method`. */
export const TEACHER_MODEL_PATH_RE = /^teacher(?:\.[A-Za-z0-9_-]{1,40}){1,7}$/;
/** Hujjat jadvali nishoni (`review.ts tableTarget`). */
export const TEACHER_TABLE_PATH_RE = /^table:\d{1,3}$/;
/** Shapkadagi yagona tahrirlanadigan `meta` maydoni. */
export const TEACHER_META_PATH = "meta.topic";

export const TEACHER_EDIT_LIMITS = {
  ops: 50,
  text: 6_000,
  title: 200,
  caption: 300,
  cell: 600,
  blocks: 400,
  id: 64,
} as const;

const BLOCK_KINDS = new Set(["p", "h1", "h2", "h3", "li", "quote", "code", "figure", "formula", "tableRef"]);

export type TeacherOp =
  /** Blok/model matni; `figure` da — sarlavha, `formula` da — LaTeX. */
  | { op: "text"; path: string; value: string }
  /** Bo'lim sarlavhasi (`passport`, `stages`, `variantA`…). */
  | { op: "heading"; sectionId: string; title: string }
  /** Jadval katagi; `r = -1` — ustun sarlavhasi. `tableId` — reja id si yoki `table:<n>`. */
  | { op: "cell"; tableId: string; r: number; c: number; value: string }
  | { op: "caption"; target: "figure" | "table"; id: string; value: string }
  | { op: "blockRemove"; path: string }
  /** `path` — qo'yiladigan o'rin (`j` bo'lim uzunligiga teng bo'lishi mumkin). */
  | { op: "blockInsert"; path: string; block: Block }
  /** Butun bo'lim matni (avto-sayqal natijasi) — teskarisi eski bloklar. */
  | { op: "setSection"; sectionId: string; blocks: Block[] }
  /** Xavfsizlik tarmog'i — murakkab op larning teskarisi. */
  | { op: "set"; doc: AcademicDoc }
  /** Tayyorlik hisoboti — FAQAT SERVER yaratadi (`parseTeacherOps` rad etadi). */
  | { op: "review"; review: DocReview | null };

export type TeacherEditCtx = { genId: string };
export type TeacherEditResult = { ok: true; doc: AcademicDoc } | { ok: false; error: string; at: number };

const OP_NAMES = new Set(["text", "heading", "cell", "caption", "blockRemove", "blockInsert", "setSection", "set", "review"]);

/** Klient op i shu tilga tegishlimi (`isWorkOp` naqshi — cast o'rniga filtr). */
export function isTeacherOp(op: { op: string }): op is TeacherOp {
  return OP_NAMES.has(op.op);
}

/* ══════════════════════════ yordamchilar ══════════════════════════ */

export function cloneTeacherDoc(doc: AcademicDoc): AcademicDoc {
  return JSON.parse(JSON.stringify(doc)) as AcademicDoc;
}

function fail(error: string, at: number): TeacherEditResult {
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

export function parseTeacherBlockPath(path: string): { si: number; bi: number } | null {
  if (!TEACHER_BLOCK_PATH_RE.test(path)) return null;
  const [, si, , bi] = path.split(".");
  return { si: Number(si), bi: Number(bi) };
}

function blockAt(doc: AcademicDoc, path: string): { s: DocSection; bi: number } | null {
  const p = parseTeacherBlockPath(path);
  if (!p) return null;
  const s = doc.sections[p.si];
  return s ? { s, bi: p.bi } : null;
}

/* ══════════════════════════ model yo'llari ══════════════════════════ */

type Leaf = { holder: Record<string, unknown>; key: string; value: unknown };

/**
 * `teacher.lesson.stages.2.method` → o'sha maydon EGASI va kaliti.
 *
 * Massiv indeksi ham oddiy kalit sifatida yuriladi (JS da `arr["2"]`
 * ishlaydi), lekin indeks RAQAM ekani tekshiriladi: `arr["length"]`
 * yoki prototip kaliti bilan kelgan yo'l `null` qaytaradi.
 */
function modelLeaf(model: TeacherModel, path: string): Leaf | null {
  const segs = path.split(".").slice(1);
  if (!segs.length) return null;
  let cur: unknown = model;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (!cur || typeof cur !== "object") return null;
    if (Array.isArray(cur)) {
      if (!/^\d{1,3}$/.test(seg)) return null;
      cur = cur[Number(seg)];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  const key = segs[segs.length - 1];
  if (!cur || typeof cur !== "object") return null;
  if (Array.isArray(cur)) {
    if (!/^\d{1,3}$/.test(key)) return null;
    const idx = Number(key);
    if (idx >= cur.length) return null;
    return { holder: cur as unknown as Record<string, unknown>, key, value: cur[idx] };
  }
  if (!Object.prototype.hasOwnProperty.call(cur, key)) return null;
  return { holder: cur as Record<string, unknown>, key, value: (cur as Record<string, unknown>)[key] };
}

/** Modeldagi satrli maydonni o'qiydi (`null` — yo'q yoki satr emas). */
export function readTeacherModelText(model: TeacherModel, path: string): string | null {
  const leaf = modelLeaf(model, path);
  return leaf && typeof leaf.value === "string" ? leaf.value : null;
}

/**
 * Nishonning HUJJATDAGI xom matni — tahrir maydonini ochish va
 * `inverseTeacherOps` uchun YAGONA o'qish nuqtasi.
 */
export function readTeacherPath(doc: AcademicDoc, path: string): string | null {
  if (path === TEACHER_META_PATH) return doc.meta.topic ?? "";
  if (TEACHER_BLOCK_PATH_RE.test(path)) {
    const hit = blockAt(doc, path);
    return hit?.s.blocks[hit.bi]?.text ?? null;
  }
  if (TEACHER_MODEL_PATH_RE.test(path) && doc.teacher) return readTeacherModelText(doc.teacher, path);
  return null;
}

/* ══════════════════════════ nasr ⇄ model xaritasi ══════════════════════════ */

/**
 * Nasr bloki ↔ model yo'li. `cut` — blokdagi YORLIQ/RAQAMni matndan
 * ajratuvchi regex (bitta guruh = modelga tushadigan qism).
 */
type Mirror = { path: string; cut?: RegExp };

/** Yorliqli paragraf («Metod: Suhbat») — yorliqdan keyingi qism. */
const afterLabel = (label: string) => new RegExp(`^${escapeRe(label)}\\s*:?\\s*([\\s\\S]*)$`);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * Yorliq/raqam ajratuvchilar. `s` (dotAll) bayrog'i YO'Q — `tsconfig`
 * maqsadi undan eski; `[\s\S]` AYNI ishni bajaradi va tahrir matni
 * baribir bitta qatorga keltiriladi (`line()`).
 */
/** «3. Yangi mavzu (12 daq)» → «Yangi mavzu». */
const STAGE_TITLE_RE = /^\s*\d{1,2}\.\s*([\s\S]*?)\s*\([^()]*\)\s*$/;
/** «1. Savol matni (2 ball)» → «Savol matni». */
const STEM_RE = /^\s*\d{1,3}\.\s*([\s\S]*?)\s*\([^()]*\)\s*$/;
/** «B) variant matni» → «variant matni». */
const OPTION_RE = /^\s*[A-F]\)\s*([\s\S]*)$/;
/** «Mezon matni — 4 ball» → «Mezon matni». */
const RUBRIC_RE = /^\s*([\s\S]*?)\s+—\s+\d{1,3}\s+\S+\s*$/;
/** «2. Javob: namunaviy javob» → «namunaviy javob». */
const KEY_ANSWER_RE = /^\s*\d{1,3}\.\s*[^:]{1,40}:\s*([\s\S]*)$/;

/** Matndan modelga tushadigan qism (`cut` mos kelmasa — butun matn). */
function unwrap(text: string, cut?: RegExp): string {
  if (!cut) return text.trim();
  const m = cut.exec(text);
  return m ? m[1].trim() : text.trim();
}

/**
 * Modelga yozilgan qiymatni blok matniga QAYTA o'raydi (teskari
 * yo'nalish — shapka maydoni o'zgarganda pasport takrori).
 * Yorliq eski matndan olinadi: `cut` guruhining O'RNI almashtiriladi.
 */
function rewrap(old: string, value: string, cut?: RegExp): string {
  if (!cut) return value;
  const m = cut.exec(old);
  if (!m) return value;
  const at = m[0].lastIndexOf(m[1]);
  if (at < 0) return value;
  return m[0].slice(0, at) + value + m[0].slice(at + m[1].length);
}

/**
 * Bo'lim bloklaridan model yo'llariga xarita.
 *
 * Har kind uchun dvigatel yozgan TARTIB qaytadan yuriladi (matn
 * tahlil qilinmaydi — faqat sanoq va blok turi). Kutilgan shakl
 * buzilgan bo'lsa (blok qo'shilgan/o'chirilgan) `null` qaytadi va
 * chaqiruvchi o'sha bo'lim uchun sinxronni O'CHIRADI.
 */
function sectionMirror(model: TeacherModel, kind: TeacherKind, s: DocSection, lang: string): (Mirror | null)[] | null {
  const L = teacherLabels(lang);
  const out: (Mirror | null)[] = [];
  const b = s.blocks;
  const kindAt = (i: number) => b[i]?.kind;

  if (kind === "lesson" && model.lesson) {
    const l = model.lesson;
    if (s.id === "homework") return b.length === 1 && kindAt(0) === "p" ? [{ path: "teacher.lesson.homework" }] : null;
    if (s.id === "assessment") return b.length === 1 && kindAt(0) === "p" ? [{ path: "teacher.lesson.assessment" }] : null;
    if (s.id === "goal") {
      /* `goalBlocks`: talim (doim), tarbiya va rivoj — bo'sh bo'lmasa. */
      const want: Mirror[] = [{ path: "teacher.lesson.goal.talim", cut: afterLabel(L.goalTalim) }];
      if (l.goal?.tarbiya) want.push({ path: "teacher.lesson.goal.tarbiya", cut: afterLabel(L.goalTarbiya) });
      if (l.goal?.rivoj) want.push({ path: "teacher.lesson.goal.rivoj", cut: afterLabel(L.goalRivoj) });
      return b.length === want.length && b.every((x) => x.kind === "p") ? want : null;
    }
    if (s.id === "stages") {
      /* `stageBlocks`: h3 sarlavha, keyin o'qituvchi/o'quvchi/metod — bo'sh bo'lmaganlari. */
      for (let k = 0; k < l.stages.length; k++) {
        const st = l.stages[k];
        if (kindAt(out.length) !== "h3") return null;
        out.push({ path: `teacher.lesson.stages.${k}.title`, cut: STAGE_TITLE_RE });
        for (const f of ["teacher", "student"] as const) {
          if (!st[f]) continue;
          if (kindAt(out.length) !== "p") return null;
          out.push({ path: `teacher.lesson.stages.${k}.${f}` });
        }
        if (st.method) {
          if (kindAt(out.length) !== "p") return null;
          out.push({ path: `teacher.lesson.stages.${k}.method`, cut: afterLabel(L.method) });
        }
      }
      return out.length === b.length ? out : null;
    }
    if (s.id === "passport") {
      /* `passport`: shapka takrori, «Mavzu: …», kompetensiya/jihoz ro'yxatlari. */
      if (kindAt(0) !== "p" || kindAt(1) !== "p") return null;
      out.push(null, { path: TEACHER_META_PATH, cut: afterLabel(L.fieldTopic) });
      const list = (items: readonly string[], base: string) => {
        if (!items.length) return true;
        if (kindAt(out.length) !== "h3") return false;
        out.push(null);
        for (let k = 0; k < items.length; k++) {
          if (kindAt(out.length) !== "li") return false;
          out.push({ path: `${base}.${k}` });
        }
        return true;
      };
      if (!list(l.competencies, "teacher.lesson.competencies")) return null;
      if (!list(l.equipment, "teacher.lesson.equipment")) return null;
      return out.length === b.length ? out : null;
    }
    return null;
  }

  if (kind === "glossary" && model.glossary && s.id === "terms") {
    const g = model.glossary;
    for (let k = 0; k < g.terms.length; k++) {
      const t = g.terms[k];
      if (kindAt(out.length) !== "h3") return null;
      out.push({ path: `teacher.glossary.terms.${k}.term` });
      if (kindAt(out.length) !== "p") return null;
      out.push({ path: `teacher.glossary.terms.${k}.def` });
      if (g.includeExample !== false && t.example) {
        if (kindAt(out.length) !== "p") return null;
        out.push({ path: `teacher.glossary.terms.${k}.example`, cut: afterLabel(L.example) });
      }
    }
    return out.length === b.length ? out : null;
  }

  if (kind === "keys" && model.keys) {
    const cases = model.keys.cases;
    const n = /^case(\d{1,2})$/.exec(s.id);
    if (n) {
      /* `keys.ts`: vaziyat, «Topshiriqlar» h3, savollar, «Javob kaliti» h3, yechim. */
      const c = cases[Number(n[1]) - 1];
      if (!c) return null;
      const base = `teacher.keys.cases.${Number(n[1]) - 1}`;
      if (kindAt(0) !== "p" || kindAt(1) !== "h3") return null;
      out.push({ path: `${base}.situation` }, null);
      for (let j = 0; j < c.questions.length; j++) {
        if (kindAt(out.length) !== "li") return null;
        out.push({ path: `${base}.questions.${j}` });
      }
      if (kindAt(out.length) !== "h3" || kindAt(out.length + 1) !== "p") return null;
      out.push(null, { path: `${base}.solution` });
      return out.length === b.length ? out : null;
    }
    if (s.id === "rubric") {
      /* Har keys: h3 sarlavha, mezon `li` lari, «Jami» paragrafi. */
      for (let k = 0; k < cases.length; k++) {
        const c = cases[k];
        if (!c.rubric.length) continue;
        if (kindAt(out.length) !== "h3") return null;
        out.push(null);
        for (let j = 0; j < c.rubric.length; j++) {
          if (kindAt(out.length) !== "li") return null;
          out.push({ path: `teacher.keys.cases.${k}.rubric.${j}.criterion`, cut: RUBRIC_RE });
        }
        if (kindAt(out.length) !== "p") return null;
        out.push(null);
      }
      return out.length === b.length ? out : null;
    }
    return null;
  }

  if (kind === "test" && model.test) {
    const t = model.test;
    if (s.id === "instructions") {
      /* `testSections`: o'quvchi maydoni qatori, keyin ko'rsatmalar. */
      if (kindAt(0) !== "p") return null;
      out.push(null);
      for (let k = 0; k < t.instructions.length; k++) {
        if (kindAt(out.length) !== "li") return null;
        out.push({ path: `teacher.test.instructions.${k}` });
      }
      return out.length === b.length ? out : null;
    }
    const vId = variantIdOf(s.id);
    if (vId) {
      /*
       * `variantSection`: savol matni, keyin javob variantlari
       * ARALASHTIRILGAN tartibda. Model yo'li ASL indeksga ishora
       * qiladi (`perm[j]`) — ya'ni B variantidagi tahrir savolni
       * bitta joyda, asl ro'yxatda o'zgartiradi.
       */
      const v = t.variants.find((x) => x.id === vId);
      if (!v) return null;
      for (let i = 0; i < v.order.length; i++) {
        const qi = v.order[i];
        const q = t.questions[qi];
        if (!q) return null;
        if (kindAt(out.length) !== "li") return null;
        out.push({ path: `teacher.test.questions.${qi}.stem`, cut: STEM_RE });
        if (q.kind === "open") {
          if (kindAt(out.length) !== "li") return null;
          out.push(null);
          continue;
        }
        const perm = v.optionOrder[i] ?? q.options.map((_, j) => j);
        for (const orig of perm) {
          if (!q.options[orig]) continue;
          if (kindAt(out.length) !== "li") return null;
          out.push({ path: `teacher.test.questions.${qi}.options.${orig}`, cut: OPTION_RE });
        }
      }
      return out.length === b.length ? out : null;
    }
    if (s.id === "key") {
      /* Ogohlantirish, kalit jadvali, ochiq savol javoblari, baho jadvali. */
      if (kindAt(0) !== "p" || kindAt(1) !== "tableRef") return null;
      out.push(null, null);
      for (let qi = 0; qi < t.questions.length; qi++) {
        if (t.questions[qi].kind !== "open") continue;
        if (kindAt(out.length) !== "li") return null;
        out.push({ path: `teacher.test.questions.${qi}.answer`, cut: KEY_ANSWER_RE });
      }
      if (kindAt(out.length) !== "tableRef") return null;
      out.push(null);
      return out.length === b.length ? out : null;
    }
    return null;
  }

  return null;
}

/**
 * BUTUN hujjat uchun `sections.<i>.blocks.<j>` → model yo'li xaritasi.
 * Shakli tanilmagan bo'lim UMUMAN kirmaydi (sinxron yo'q, tahrir bor).
 */
export function teacherMirrors(doc: AcademicDoc): Map<string, Mirror> {
  const map = new Map<string, Mirror>();
  const model = doc.teacher;
  if (!model) return map;
  const lang = model.school.language || doc.meta.language || "uz";
  doc.sections.forEach((s, si) => {
    if (!s.blocks.length) return;
    const mirror = sectionMirror(model, model.kind, s, lang);
    if (!mirror) return;
    mirror.forEach((m, bi) => {
      if (m) map.set(`sections.${si}.blocks.${bi}`, m);
    });
  });
  return map;
}

/* ══════════════════════════ jadval katagi ⇄ model ══════════════════════════ */

/** Jadval katagining model yo'li (`null` — hosila/qo'shma katak). */
function tableCellPath(model: TeacherModel, t: DocTable, r: number, c: number): Mirror | null {
  // Ustun sarlavhasi — yorliq, modelda yo'q.
  if (r < 0) return null;
  const anchor = t.anchor ?? t.id ?? "";

  if (model.kind === "map" && model.map) {
    /* `rowOf`: n | soat | mavzu | metod | natija | nazorat. */
    const cols = [null, null, "topic", "method", "result", "control"] as const;
    const field = cols[c];
    if (!field) return null;
    const q = quarterIndexOf(anchor);
    if (q !== null) {
      const qi = model.map.quarters.findIndex((x) => x.n === q);
      return qi < 0 ? null : { path: `teacher.map.quarters.${qi}.weeks.${r}.${field}` };
    }
    if (anchor === "year") {
      /* Yillik jadval — barcha choraklarning haftalari ketma-ket. */
      let left = r;
      for (let qi = 0; qi < model.map.quarters.length; qi++) {
        const weeks = model.map.quarters[qi].weeks;
        if (left < weeks.length) return { path: `teacher.map.quarters.${qi}.weeks.${left}.${field}` };
        left -= weeks.length;
      }
    }
    return null;
  }

  if (model.kind === "lesson" && model.lesson && anchor === "stages") {
    /* `timeCols`: bosqich | daqiqa | kutilgan natija (daqiqa — son, formada). */
    const cols = ["title", null, "result"] as const;
    const field = cols[c];
    return field && model.lesson.stages[r] ? { path: `teacher.lesson.stages.${r}.${field}` } : null;
  }

  if (model.kind === "glossary" && model.glossary && anchor === "terms") {
    /* `triCols`: atama | ruscha | inglizcha. */
    const cols = ["term", "ru", "en"] as const;
    const field = cols[c];
    return field && model.glossary.terms[r] ? { path: `teacher.glossary.terms.${r}.${field}` } : null;
  }

  if (model.kind === "test" && model.test) {
    const t2 = model.test;
    if ((t.id ?? "") === "key") {
      /*
       * `keyTable`: № | variant ustunlari | ball | Bloom | qiyinlik.
       * Faqat VARIANT ustunlari modelga qaytadi — qolganlari savol
       * maydonlari (ball — son, Bloom/qiyinlik — sanov).
       */
      const vi = c - 1;
      const v = t2.variants[vi];
      if (!v || vi < 0) return null;
      return r < t2.questions.length ? { path: `teacher.test.key.${v.id}.${r}` } : null;
    }
    return null;
  }

  return null;
}

/* ══════════════════════════ shapka takrori ══════════════════════════ */

/** Shapkadagi «Yorliq: qiymat» juftlari — `planTeacher isHeadRecap` bilan bir xil. */
function headPairs(plan: TeacherPlan): string[] {
  return plan.head.filter((h) => h.k === "field").map((h) => (h.k === "field" ? `${h.label}: ${h.text}` : ""));
}

/**
 * Pasport takrorini YANGI shapka qiymatlari bilan qayta yozadi.
 *
 * `isHeadRecap` paragrafni faqat AYNAN mos kelganda tashlaydi, ya'ni
 * shapka maydoni o'zgargach eski takror ko'rinib qolardi. Bu yerda
 * eski juftlar yangilariga BIR-BIR almashtiriladi: paragraf yana
 * takrorga aylanadi va `planTeacher` uni avvalgidek tashlaydi.
 */
function rewriteHeadRecap(doc: AcademicDoc, before: string[], after: string[]): void {
  if (before.length !== after.length) return;
  const changed = before.map((x, i) => [x, after[i]] as const).filter(([a, b2]) => a !== b2);
  if (!changed.length) return;
  const passport = doc.sections.find((s) => s.id === "passport");
  if (!passport) return;
  for (let i = 0; i < passport.blocks.length; i++) {
    const b = passport.blocks[i];
    if (b.kind !== "p") continue;
    const parts = b.text.replace(/\.$/, "").split(/\.\s+/).filter(Boolean);
    if (!parts.length || !parts.every((p) => before.includes(p))) continue;
    const next = parts.map((p) => changed.find(([a]) => a === p)?.[1] ?? p);
    passport.blocks[i] = { ...b, text: `${next.join(". ")}.` };
  }
}

/* ══════════════════════════ qo'llash ══════════════════════════ */

/** Rejadagi BARCHA tahrir yo'llari — ekranda yo'q bandni tahrirlab bo'lmaydi. */
function planPaths(plan: TeacherPlan): Set<string> {
  const set = new Set<string>();
  for (const h of plan.head) set.add(h.path);
  for (const b of plan.body) set.add(b.path);
  return set;
}

/**
 * Reja jadval id si yoki `table:<n>` → TAHRIRLANADIGAN jadval.
 *
 * Modeldan qurilgan jadval (`planTeacher attach` — dars vaqt jadvali,
 * chorak jadvali) hujjatning `tables` ida YO'Q: u har renderda
 * modeldan qayta quriladi. Bunday jadvalning katagini to'g'ridan-
 * to'g'ri o'zgartirib bo'lmaydi — o'zgarish keyingi renderda
 * yo'qolardi; `cell` opi u yerda MODELGA yozadi (`tableCellPath`),
 * shuning uchun bu funksiya reja nusxasini qaytaradi va chaqiruvchi
 * uni faqat indeks tekshiruvi uchun ishlatadi.
 */
function tableOf(doc: AcademicDoc, plan: TeacherPlan, id: string): { table: DocTable; live: boolean } | null {
  const tables = doc.tables ?? [];
  const byIndex = (raw: string): DocTable | null => {
    const m = /^table:(\d{1,3})$/.exec(raw);
    return m ? (tables[Number(m[1])] ?? null) : null;
  };
  const direct = byIndex(id);
  if (direct) return { table: direct, live: true };
  const viaPath = plan.tablePaths[id] ? byIndex(plan.tablePaths[id]) : null;
  if (viaPath) return { table: viaPath, live: true };
  const planned = plan.body.find((b): b is Extract<TeacherPlan["body"][number], { k: "table" }> => b.k === "table" && b.tableId === id);
  return planned ? { table: planned.table, live: false } : null;
}

const TEXT_OPS = new Set<TeacherOp["op"]>(["text", "heading", "cell", "caption", "blockRemove", "blockInsert", "setSection", "set"]);

/**
 * Operatsiyalarni ketma-ket qo'llaydi. Bittasi yiqilsa HECH NARSA
 * qo'llanmaydi (PATCH atomar) — xato `at` indeksi bilan qaytadi.
 * Kirish hujjati O'ZGARMAYDI (chuqur nusxa ustida ishlanadi).
 */
export function applyTeacherOps(doc: AcademicDoc, ops: TeacherOp[], ctx: TeacherEditCtx): TeacherEditResult {
  // `ctx.genId` imzo shartnomasi uchun (aktivlar faqat serverda yaratiladi).
  void ctx;
  if (!doc.teacher) return fail("Bu hujjat eski formatda — qaytadan yarating", 0);
  if (!doc.sections?.length) return fail("Bu hujjatda bo'limlar yo'q", 0);

  let d = cloneTeacherDoc(doc);
  let plan = planTeacher(d);
  if (plan.legacy) return fail("Bu hujjat eski formatda — qaytadan yarating", 0);
  const pairsBefore = headPairs(plan);
  let paths = planPaths(plan);
  let mirrors = teacherMirrors(d);
  let touched = false;
  let headTouched = false;

  /** Tuzilma o'zgargach reja va xaritalar QAYTA quriladi. */
  const reindex = () => {
    plan = planTeacher(d);
    paths = planPaths(plan);
    mirrors = teacherMirrors(d);
  };

  /** Model maydoniga satr yozadi; `false` — maydon yo'q yoki satr emas. */
  const writeModel = (path: string, value: string): boolean => {
    if (path === TEACHER_META_PATH) {
      d.meta = { ...d.meta, topic: value };
      return true;
    }
    const leaf = modelLeaf(d.teacher!, path);
    if (!leaf || typeof leaf.value !== "string") return false;
    (leaf.holder as Record<string, unknown>)[leaf.key] = value;
    return true;
  };

  for (let at = 0; at < ops.length; at++) {
    const op = ops[at];
    if (TEXT_OPS.has(op.op)) touched = true;

    switch (op.op) {
      case "text": {
        /* ── nasr bloki ── */
        if (TEACHER_BLOCK_PATH_RE.test(op.path)) {
          const hit = blockAt(d, op.path);
          const b = hit?.s.blocks[hit.bi];
          if (!hit || !b) return fail(`Yo'l topilmadi: ${op.path}`, at);
          let text: string;
          if (b.kind === "code") {
            text = multiline(op.value, TEACHER_EDIT_LIMITS.text);
            if (!text) return fail("Kod bloki bo'sh bo'lmaydi — o'chirish uchun «blockRemove»", at);
          } else if (b.kind === "figure" || b.kind === "tableRef") {
            // Sarlavha bo'sh bo'lishi mumkin («1-rasm.»).
            text = line(op.value, TEACHER_EDIT_LIMITS.caption);
          } else {
            text = line(op.value, TEACHER_EDIT_LIMITS.text);
            if (!text) return fail("Bo'sh blok — o'chirish uchun «blockRemove»", at);
          }
          hit.s.blocks[hit.bi] = { ...b, text };
          // NASR → MODEL: dvigatel yozgan bo'lim bo'lsa model ham yangilanadi.
          const m = mirrors.get(op.path);
          if (m) writeModel(m.path, unwrap(text, m.cut));
          break;
        }

        /* ── model bandi / mavzu ── */
        const isModel = op.path === TEACHER_META_PATH || TEACHER_MODEL_PATH_RE.test(op.path);
        if (!isModel) return fail(`Yo'l topilmadi: ${op.path}`, at);
        if (!paths.has(op.path)) return fail(`Bu band hujjatda ko'rinmaydi: ${op.path}`, at);
        const cur = op.path === TEACHER_META_PATH ? (d.meta.topic ?? "") : readTeacherModelText(d.teacher!, op.path);
        if (cur === null) {
          return fail(`Bu maydon matn emas — formadan o'zgartiring: ${op.path}`, at);
        }
        const value = line(op.value, TEACHER_EDIT_LIMITS.text);
        if (!value) return fail("Bo'sh maydon bo'lmaydi", at);
        if (!writeModel(op.path, value)) return fail(`Yo'l topilmadi: ${op.path}`, at);
        // MODEL → NASR: shu yo'lga bog'langan nasr bloki bo'lsa (masalan
        // pasportdagi «Mavzu: …») u ham yangilanadi.
        for (const [blockPath, m] of mirrors) {
          if (m.path !== op.path) continue;
          const hit = blockAt(d, blockPath);
          const b = hit?.s.blocks[hit.bi];
          if (hit && b) hit.s.blocks[hit.bi] = { ...b, text: rewrap(b.text, value, m.cut) };
        }
        if (op.path.startsWith("teacher.school.") || op.path === TEACHER_META_PATH) headTouched = true;
        break;
      }

      case "heading": {
        const s = d.sections.find((x) => x.id === op.sectionId);
        if (!s) return fail(`Bo'lim topilmadi: ${op.sectionId}`, at);
        const title = line(op.title, TEACHER_EDIT_LIMITS.title);
        if (!title) return fail("Bo'lim sarlavhasi bo'sh bo'lmaydi", at);
        s.title = title;
        break;
      }

      case "cell": {
        const hit = tableOf(d, plan, op.tableId);
        if (!hit) return fail(`Jadval topilmadi: ${op.tableId}`, at);
        const { table: t, live } = hit;
        const value = line(op.value, TEACHER_EDIT_LIMITS.cell);
        if (op.r === -1) {
          if (op.c < 0 || op.c >= t.headers.length) return fail("Ustun indeksi chegaradan tashqarida", at);
          if (!value) return fail("Ustun sarlavhasi bo'sh bo'lmaydi", at);
          // Ustun nomi — YORLIQ (`L.yearCols`), modelda yo'q: modeldan
          // qurilgan jadvalda uni o'zgartirish keyingi renderda yo'qolardi.
          if (!live) return fail("Ustun sarlavhasi bu jadvalda o'zgarmaydi", at);
          t.headers[op.c] = value;
          break;
        }
        const row = t.rows[op.r];
        if (!row || op.c < 0 || op.c >= row.length) return fail("Katak indeksi chegaradan tashqarida", at);
        // JADVAL → MODEL: faqat SHU katak (butun jadval qayta hisoblanmaydi).
        const m = tableCellPath(d.teacher!, t, op.r, op.c);
        if (!m && !live) return fail("Bu katak modeldan chiqadi — formadan o'zgartiring", at);
        if (live) row[op.c] = value;
        if (m) writeModel(m.path, unwrap(value, m.cut));
        break;
      }

      case "caption": {
        const value = line(op.value, TEACHER_EDIT_LIMITS.caption);
        if (op.target === "figure") {
          const f = (d.teacher!.figures ?? []).find((x) => x.id === op.id);
          if (!f) return fail(`Rasm topilmadi: ${op.id}`, at);
          f.caption = value;
          for (const s of d.sections)
            for (let i = 0; i < s.blocks.length; i++) {
              const b = s.blocks[i];
              if (b.kind === "figure" && b.figureId === op.id) s.blocks[i] = { ...b, text: value };
            }
          break;
        }
        const hit = tableOf(d, plan, op.id);
        if (!hit) return fail(`Jadval topilmadi: ${op.id}`, at);
        if (!hit.live) return fail("Bu jadval sarlavhasi modeldan chiqadi", at);
        hit.table.caption = value;
        for (const s of d.sections)
          for (let i = 0; i < s.blocks.length; i++) {
            const b = s.blocks[i];
            if (b.kind === "tableRef" && b.tableId === op.id) s.blocks[i] = { ...b, text: value };
          }
        break;
      }

      case "blockRemove": {
        const hit = blockAt(d, op.path);
        const b = hit?.s.blocks[hit.bi];
        if (!hit || !b) return fail(`Yo'l topilmadi: ${op.path}`, at);
        hit.s.blocks.splice(hit.bi, 1);
        // Jadval bloki o'chsa jadvalning O'ZI ham ketadi (`planTeacher`
        // uni aks holda hujjat oxirida baribir chizardi).
        if (b.kind === "tableRef" && d.tables) d.tables = d.tables.filter((t) => t.id !== b.tableId);
        reindex();
        break;
      }

      case "blockInsert": {
        const hit = blockAt(d, op.path);
        if (!hit || hit.bi > hit.s.blocks.length) return fail(`Yo'l topilmadi: ${op.path}`, at);
        if (hit.s.blocks.length >= TEACHER_EDIT_LIMITS.blocks) return fail(`Bo'limdagi bloklar chegarasi: ${TEACHER_EDIT_LIMITS.blocks}`, at);
        hit.s.blocks.splice(hit.bi, 0, op.block);
        reindex();
        break;
      }

      case "setSection": {
        const s = d.sections.find((x) => x.id === op.sectionId);
        if (!s) return fail(`Bo'lim topilmadi: ${op.sectionId}`, at);
        if (op.blocks.length > TEACHER_EDIT_LIMITS.blocks) return fail(`Bo'limdagi bloklar chegarasi: ${TEACHER_EDIT_LIMITS.blocks}`, at);
        s.blocks = op.blocks.map((b) => ({ ...b }));
        reindex();
        break;
      }

      case "set": {
        /*
         * FAQAT matn qismlari olinadi: `meta`, model, rasm aktivlari va
         * hisobot JORIY hujjatdan qoladi — klient yuborgan `doc` bilan
         * begona URL yoki soxta ball kirmasin.
         */
        const src = op.doc;
        if (!Array.isArray(src.sections) || !src.sections.length) return fail("«set» — bo'limlar yo'q", at);
        const next: AcademicDoc = {
          ...d,
          sections: src.sections.map((s) => ({ id: s.id, title: s.title, blocks: s.blocks.map((b) => ({ ...b })) })),
        };
        if (src.tables) next.tables = src.tables.map((t) => ({ ...t, headers: t.headers.slice(), rows: t.rows.map((r) => r.slice()) }));
        else delete next.tables;
        d = next;
        reindex();
        break;
      }

      case "review": {
        if (op.review) d.teacher!.review = op.review;
        else delete d.teacher!.review;
        break;
      }

      default:
        return fail("Noma'lum operatsiya", at);
    }
  }

  if (touched && headTouched) rewriteHeadRecap(d, pairsBefore, headPairs(planTeacher(d)));
  return { ok: true, doc: d };
}

/* ══════════════════════════ teskari ══════════════════════════ */

function snapshot(doc: AcademicDoc): TeacherOp {
  return { op: "set", doc: cloneTeacherDoc(doc) };
}

/**
 * Teskari ro'yxat (undo). Maydon darajasidagi op larning teskarisi —
 * o'sha op eski qiymat bilan; tuzilma o'zgartiradigan op lar uchun
 * BUTUN hujjat (`set`): model va nasr birga o'zgaradi, ularni bittalab
 * qaytarish xatoga moyil.
 */
export function inverseTeacherOps(doc: AcademicDoc, ops: TeacherOp[], ctx: TeacherEditCtx): TeacherOp[] {
  const out: TeacherOp[] = [];
  let cur = doc;
  for (const op of ops) {
    const inv = inverseOne(cur, op);
    if (!inv) break;
    const step = applyTeacherOps(cur, [op], ctx);
    // Yiqilgan operatsiya hujjatni o'zgartirmaydi — teskarisi ham keraksiz.
    if (!step.ok) break;
    out.push(inv);
    cur = step.doc;
  }
  return out.reverse();
}

function inverseOne(doc: AcademicDoc, op: TeacherOp): TeacherOp | null {
  switch (op.op) {
    case "text": {
      /*
       * Matn opi MODELGA ham tegishi mumkin (nasr ⇄ model), shuning
       * uchun teskarisi — butun hujjat: bitta `text` bilan qaytarish
       * model tomonini eskirgan holda qoldirardi.
       */
      const raw = readTeacherPath(doc, op.path);
      if (raw === null) return null;
      return TEACHER_BLOCK_PATH_RE.test(op.path) ? snapshot(doc) : { op: "text", path: op.path, value: raw };
    }
    case "heading": {
      const s = doc.sections.find((x) => x.id === op.sectionId);
      return s ? { op: "heading", sectionId: op.sectionId, title: s.title } : null;
    }
    case "cell": {
      // Katak ham modelga ko'chadi — butun hujjat qaytariladi.
      return snapshot(doc);
    }
    case "caption": {
      if (op.target === "figure") {
        const f = (doc.teacher?.figures ?? []).find((x) => x.id === op.id);
        return f ? { op: "caption", target: "figure", id: op.id, value: f.caption } : null;
      }
      const t = (doc.tables ?? []).find((x) => x.id === op.id);
      return t ? { op: "caption", target: "table", id: op.id, value: t.caption ?? "" } : null;
    }
    case "blockRemove": {
      const hit = blockAt(doc, op.path);
      const b = hit?.s.blocks[hit.bi];
      if (!hit || !b) return null;
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
      return { op: "review", review: doc.teacher?.review ? cloneTeacherDoc(doc).teacher!.review! : null };
    default:
      return null;
  }
}

/* ══════════════════════════ sayqal op lari ══════════════════════════ */

/**
 * Avto-sayqal op lari (`teacher/polish.ts TeacherSectionOp`) → tahrir
 * tili. Tip bu yerda STRUKTURAVIY yozilgan: `polish.ts` `edit.ts` ni
 * import qiladi, teskarisi import sikl bo'lardi.
 *
 * `setTable` → o'zgargan kataklar uchun `cell` op lari: adapter
 * jadvalni faqat shu til bilan biladi, op lar esa bazaga
 * YOZILMAYDI (`commitDocOps` hujjatning o'zini saqlaydi), ya'ni
 * soni muhim emas.
 */
export type TeacherPolishOp =
  | { op: "setSection"; sectionId: string; blocks: Block[] }
  | { op: "setTable"; index: number; rows: string[][] };

export function teacherOpsFromPolish(ops: readonly TeacherPolishOp[]): TeacherOp[] {
  const out: TeacherOp[] = [];
  for (const op of ops) {
    if (op.op === "setSection") {
      out.push({ op: "setSection", sectionId: op.sectionId, blocks: op.blocks });
      continue;
    }
    /*
     * HAR katak yoziladi, o'zgarganlari ajratilmaydi: chaqiruvchida
     * ASL hujjat bo'lmasligi mumkin (`doc-polish.ts toOps` ga sayqal
     * NATIJASI keladi) va farqni o'sha nusxadan hisoblash «hech narsa
     * o'zgarmagan» degan bo'sh ro'yxat berardi. Bir xil qiymatli
     * `cell` opi baribir zararsiz.
     */
    const tableId = `table:${op.index}`;
    op.rows.forEach((row, r) => {
      row.forEach((value, c) => out.push({ op: "cell", tableId, r, c, value }));
    });
  }
  return out;
}

/* ══════════════════════════ tahlil (`unknown` dan) ══════════════════════════ */

const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ID_RE = /^[\w:.\-/]{1,64}$/;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
const isIdx = (v: unknown, min = 0, max = 1000): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v < max;

/** Tahrir yo'li shaklan to'g'rimi (mazmuni `applyTeacherOps` da). */
export function isTeacherPath(v: unknown): v is string {
  return typeof v === "string" && (TEACHER_BLOCK_PATH_RE.test(v) || TEACHER_MODEL_PATH_RE.test(v) || v === TEACHER_META_PATH);
}

function scan(v: unknown, depth = 0): string | null {
  if (depth > 10) return "Tana juda chuqur";
  if (typeof v === "string") return v.length > TEACHER_EDIT_LIMITS.text ? "Matn juda uzun" : null;
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

export function normalizeTeacherBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const kind = typeof b.kind === "string" ? b.kind : "";
  if (!BLOCK_KINDS.has(kind)) return null;
  const text = str(b.text, TEACHER_EDIT_LIMITS.text);
  if (text === null) return null;
  switch (kind) {
    case "figure": {
      const figureId = str(b.figureId, TEACHER_EDIT_LIMITS.id);
      return figureId ? { kind, text, figureId } : null;
    }
    case "tableRef": {
      const tableId = str(b.tableId, TEACHER_EDIT_LIMITS.id);
      return tableId ? { kind, text, tableId } : null;
    }
    case "formula":
      return b.display === undefined ? { kind, text } : { kind, text, display: Boolean(b.display) };
    case "code": {
      const out: Extract<Block, { kind: "code" }> = { kind, text };
      const caption = str(b.caption, TEACHER_EDIT_LIMITS.caption);
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
  if (!Array.isArray(raw) || raw.length > TEACHER_EDIT_LIMITS.blocks) return null;
  const out: Block[] = [];
  for (const x of raw) {
    const b = normalizeTeacherBlock(x);
    if (!b) return null;
    out.push(b);
  }
  return out;
}

/** `set` uchun: faqat oq ro'yxatdagi maydonlar (model va aktivlar TEGILMAYDI). */
function normalizeSetDoc(raw: unknown): AcademicDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.sections) || !d.sections.length || d.sections.length > 80) return null;
  const sections: DocSection[] = [];
  for (const s of d.sections as unknown[]) {
    const o = s as Record<string, unknown> | null;
    if (!o || typeof o !== "object") return null;
    const id = str(o.id, TEACHER_EDIT_LIMITS.id);
    const title = str(o.title, TEACHER_EDIT_LIMITS.title);
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
      if (!Array.isArray(o.headers) || o.headers.length > 20 || !o.headers.every((h) => typeof h === "string")) return null;
      if (!Array.isArray(o.rows) || o.rows.length > 500) return null;
      const rows: string[][] = [];
      for (const r of o.rows as unknown[]) {
        if (!Array.isArray(r) || r.length > 20 || !r.every((c) => typeof c === "string")) return null;
        rows.push((r as string[]).map((c) => c.slice(0, TEACHER_EDIT_LIMITS.cell)));
      }
      const tb: DocTable = { headers: (o.headers as string[]).map((h) => h.slice(0, TEACHER_EDIT_LIMITS.cell)), rows };
      const id = str(o.id, TEACHER_EDIT_LIMITS.id);
      const caption = str(o.caption, TEACHER_EDIT_LIMITS.caption);
      const anchor = str(o.anchor, TEACHER_EDIT_LIMITS.id);
      if (id) tb.id = id;
      if (caption !== null) tb.caption = caption;
      if (anchor) tb.anchor = anchor;
      if (Array.isArray(o.widths) && o.widths.every((w) => typeof w === "number")) tb.widths = (o.widths as number[]).slice(0, 20);
      tables.push(tb);
    }
    out.tables = tables;
  }
  return out;
}

export type TeacherParseResult = { ok: true; ops: TeacherOp[] } | { ok: false; error: string };

/**
 * HTTP tanasidan `TeacherOp[]` ga. Shakl xatosi shu yerda (400),
 * mazmun xatosi `applyTeacherOps` da (422) — `parseWorkOps` bilan bir
 * xil taqsimot. `review` opi bu yerdan O'TMAYDI (faqat server).
 */
export function parseTeacherOps(raw: unknown): TeacherParseResult {
  if (!Array.isArray(raw)) return { ok: false, error: "Operatsiyalar ro'yxati kutilgan" };
  if (!raw.length) return { ok: false, error: "Operatsiya yo'q" };
  if (raw.length > TEACHER_EDIT_LIMITS.ops) {
    return { ok: false, error: `Bir so'rovda ${TEACHER_EDIT_LIMITS.ops} tadan ortiq operatsiya bo'lmaydi` };
  }
  const bad = scan(raw);
  if (bad) return { ok: false, error: bad };

  const ops: TeacherOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Operatsiya obyekt bo'lishi kerak" };
    const o = item as Record<string, unknown>;
    const name = typeof o.op === "string" ? o.op : "";
    // `review` ATAYIN ro'yxatda yo'q: ballni faqat server yozadi.
    if (!OP_NAMES.has(name) || name === "review") return { ok: false, error: "Noma'lum operatsiya" };
    switch (name) {
      case "text":
        if (!isTeacherPath(o.path)) return { ok: false, error: "«path» yaroqsiz" };
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
      case "blockRemove":
        if (typeof o.path !== "string" || !TEACHER_BLOCK_PATH_RE.test(o.path)) return { ok: false, error: "«path» yaroqsiz" };
        ops.push({ op: "blockRemove", path: o.path });
        break;
      case "blockInsert": {
        if (typeof o.path !== "string" || !TEACHER_BLOCK_PATH_RE.test(o.path)) return { ok: false, error: "«path» yaroqsiz" };
        const block = normalizeTeacherBlock(o.block);
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

/** Rasm reyestri — `assets.ts` va maket uchun (`doc.teacher.figures`). */
export function teacherFigures(doc: AcademicDoc): Figure[] {
  return doc.teacher?.figures ?? [];
}
