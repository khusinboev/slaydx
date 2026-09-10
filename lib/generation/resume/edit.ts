/**
 * Rezyume tahrir operatsiyalari (Rezyume 2, AUDIT-15) — IZOMORF.
 *
 * `slide-edit.ts` bilan bir xil naqsh: `applyResumeOps` sof funksiya
 * (yangi `doc` qaytaradi), `inverseResumeOps` undo uchun teskari
 * ro'yxat, `parseResumeOps` esa HTTP tanasi (`unknown`) bilan mantiq
 * orasidagi YAGONA darvoza. Klient (`useResumeEdit`) ham, server
 * (`resumeAdapter`) ham AYNAN shu uchtasini chaqiradi — ya'ni ekranda
 * qo'llangan operatsiya bazada ham xuddi shunday qo'llanadi.
 *
 * Model o'zgargach `sections` QAYTA SINTEZ qilinadi (`docFromResume` →
 * `resumeSections`): bosh sahifa kartasi, qidiruv va eski kod
 * (`WordViewer` zaxira yo'li) `doc.resume` ni bilmasa ham yangi matnni
 * ko'radi.
 */
import { RESUME_PATH_RE, type ResumePath } from "./layout";
import {
  RESUME_LIMITS,
  RESUME_SECTION_IDS,
  docFromResume,
  linkKindOf,
  normalizeDate,
  normalizeResume,
  type ResumeBullet,
  type ResumeCrop,
  type ResumeModel,
  type ResumeSectionId,
  type ResumeSkill,
} from "./model";
import { isResumePaletteId, isResumeTemplateId, type ResumePaletteId, type ResumeTemplateId } from "./templates";
import type { AcademicDoc } from "../types";

/** Qator (`row`) ko'rinishidagi bo'limlar — `rowAdd/rowRemove/rowMove` shular ustida. */
export const RESUME_ROW_SECTIONS = ["experience", "education", "certificates", "languages", "links"] as const;
export type ResumeRowSection = (typeof RESUME_ROW_SECTIONS)[number];

export type ResumePhotoOp = {
  op: "photo";
  /** `""` — suratni olib tashlash; aks holda SHU generatsiyaning aktivi. */
  url: string;
  shape?: "circle" | "square";
  assetId?: string;
  originalAssetId?: string;
  crop?: ResumeCrop;
};

export type ResumeOp =
  | { op: "text"; path: ResumePath; value: string }
  | { op: "list"; items: string[] }
  | { op: "rowAdd"; section: ResumeRowSection; at?: number }
  | { op: "rowRemove"; section: ResumeRowSection; index: number }
  | { op: "rowMove"; section: ResumeRowSection; from: number; to: number }
  | { op: "bulletAdd"; row: number; at?: number; value?: string }
  | { op: "bulletRemove"; row: number; index: number }
  | { op: "bulletMove"; row: number; from: number; to: number }
  | { op: "sectionMove"; section: ResumeSectionId; to: number }
  | { op: "template"; template: ResumeTemplateId }
  | { op: "palette"; palette: ResumePaletteId }
  | ResumePhotoOp
  | { op: "set"; model: ResumeModel };

export type ResumeEditCtx = { genId: string };
export type ResumeEditResult =
  | { ok: true; doc: AcademicDoc }
  | { ok: false; error: string; at: number };

/** Faqat SHU generatsiyaning aktiv URL naqshi (`assets.ts` bilan bir xil). */
export function ownAssetUrlRe(genId: string): RegExp {
  return new RegExp(`^/api/generations/${genId}/assets/([0-9a-f]+)$`);
}

/* ────────────────────────── path bo'yicha yozish ────────────────────────── */

type Leaf = { get: (m: ResumeModel) => string; set: (m: ResumeModel, v: string) => void; max: number; date?: boolean };

const IDENT: Record<string, Leaf> = {
  "identity.fullName": { get: (m) => m.identity.fullName, set: (m, v) => { m.identity = { ...m.identity, fullName: v }; }, max: RESUME_LIMITS.nameChars },
  "identity.headline": { get: (m) => m.identity.headline, set: (m, v) => { m.identity = { ...m.identity, headline: v }; }, max: RESUME_LIMITS.headlineChars },
  "contact.phone": { get: (m) => m.contact.phone, set: (m, v) => { m.contact = { ...m.contact, phone: v }; }, max: 32 },
  "contact.email": { get: (m) => m.contact.email, set: (m, v) => { m.contact = { ...m.contact, email: v }; }, max: RESUME_LIMITS.fieldChars },
  "contact.location": { get: (m) => m.contact.location, set: (m, v) => { m.contact = { ...m.contact, location: v }; }, max: RESUME_LIMITS.fieldChars },
  summary: { get: (m) => m.summary, set: (m, v) => { m.summary = v; }, max: RESUME_LIMITS.summaryChars },
};

/** `experience.2.role` kabi yo'lni maydon yozuvchisiga aylantiradi. */
function leafOf(m: ResumeModel, path: string): Leaf | null {
  const flat = IDENT[path];
  if (flat) return flat;
  const [sec, iRaw, key, jRaw, sub] = path.split(".");
  const i = Number(iRaw);
  if (!Number.isInteger(i) || i < 0) return null;

  if (sec === "experience") {
    const row = m.experience[i];
    if (!row) return null;
    if (key === "bullets") {
      const j = Number(jRaw);
      if (sub !== "text" || !Number.isInteger(j) || !row.bullets[j]) return null;
      return {
        get: (mm) => mm.experience[i].bullets[j].text,
        max: RESUME_LIMITS.bulletChars,
        set: (mm, v) => {
          const rows = mm.experience.slice();
          const bs = rows[i].bullets.slice();
          // Qo'lda tahrirlangan band endi AI bandi emas — nishon olinadi.
          bs[j] = { text: v };
          rows[i] = { ...rows[i], bullets: bs };
          mm.experience = rows;
        },
      };
    }
    if (key !== "company" && key !== "role" && key !== "start" && key !== "end") return null;
    const date = key === "start" || key === "end";
    return {
      get: (mm) => mm.experience[i][key],
      max: date ? 12 : RESUME_LIMITS.fieldChars,
      date,
      set: (mm, v) => {
        const rows = mm.experience.slice();
        rows[i] = { ...rows[i], [key]: v };
        mm.experience = rows;
      },
    };
  }
  if (sec === "education") {
    const row = m.education[i];
    if (!row) return null;
    if (key !== "institution" && key !== "degree" && key !== "start" && key !== "end") return null;
    const date = key === "start" || key === "end";
    return {
      get: (mm) => mm.education[i][key],
      max: date ? 12 : RESUME_LIMITS.fieldChars,
      date,
      set: (mm, v) => {
        const rows = mm.education.slice();
        rows[i] = { ...rows[i], [key]: v };
        mm.education = rows;
      },
    };
  }
  if (sec === "certificates") {
    const row = m.certificates[i];
    if (!row) return null;
    if (key !== "name" && key !== "issuer" && key !== "year") return null;
    return {
      get: (mm) => mm.certificates[i][key],
      max: key === "year" ? 12 : RESUME_LIMITS.fieldChars,
      set: (mm, v) => {
        const rows = mm.certificates.slice();
        rows[i] = { ...rows[i], [key]: v };
        mm.certificates = rows;
      },
    };
  }
  if (sec === "languages") {
    const row = m.languages[i];
    if (!row) return null;
    if (key !== "language" && key !== "level") return null;
    return {
      get: (mm) => mm.languages[i][key],
      max: key === "language" ? 60 : 40,
      set: (mm, v) => {
        const rows = mm.languages.slice();
        rows[i] = { ...rows[i], [key]: v };
        mm.languages = rows;
      },
    };
  }
  if (sec === "links") {
    const row = m.links[i];
    if (!row || key !== "url") return null;
    return {
      get: (mm) => mm.links[i].url,
      max: RESUME_LIMITS.urlChars,
      set: (mm, v) => {
        const rows = mm.links.slice();
        rows[i] = { ...rows[i], url: v, kind: linkKindOf(v) };
        mm.links = rows;
      },
    };
  }
  return null;
}

/* ────────────────────────── yordamchilar ────────────────────────── */

export function cloneResume(m: ResumeModel): ResumeModel {
  return {
    ...m,
    identity: { ...m.identity },
    contact: { ...m.contact },
    experience: m.experience.map((e) => ({ ...e, bullets: e.bullets.map((b) => ({ ...b })) })),
    education: m.education.map((e) => ({ ...e })),
    certificates: m.certificates.map((e) => ({ ...e })),
    languages: m.languages.map((e) => ({ ...e })),
    skills: m.skills.map((e) => ({ ...e })),
    links: m.links.map((e) => ({ ...e })),
    order: m.order.slice(),
    labels: { ...m.labels },
    ...(m.photo ? { photo: { ...m.photo, ...(m.photo.crop ? { crop: { ...m.photo.crop } } : {}) } } : {}),
  };
}

/** Ro'yxatdagi id lar bilan to'qnashmaydigan yangi id. */
function freshId(prefix: string, used: Set<string>): string {
  for (let i = 1; i < 1000; i++) {
    const id = `${prefix}${i}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${used.size + 1000}`;
}

function rowsOf(m: ResumeModel, section: ResumeRowSection): { id: string }[] {
  return m[section] as unknown as { id: string }[];
}

function setRows(m: ResumeModel, section: ResumeRowSection, rows: unknown[]): void {
  (m as unknown as Record<string, unknown>)[section] = rows;
}

function emptyRow(section: ResumeRowSection, id: string) {
  switch (section) {
    case "experience":
      return { id, company: "", role: "", start: "", end: "", bullets: [] as ResumeBullet[] };
    case "education":
      return { id, institution: "", degree: "", start: "", end: "" };
    case "certificates":
      return { id, name: "", issuer: "", year: "" };
    case "languages":
      return { id, language: "", level: "" };
    case "links":
      return { id, kind: "other" as const, url: "" };
  }
}

const ROW_LIMIT: Record<ResumeRowSection, number> = {
  experience: RESUME_LIMITS.experience,
  education: RESUME_LIMITS.education,
  certificates: RESUME_LIMITS.certificates,
  languages: RESUME_LIMITS.languages,
  links: RESUME_LIMITS.links,
};

function move<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

function fail(error: string, at: number): ResumeEditResult {
  return { ok: false, error, at };
}

/** Bitta qatorli matn — tahrir maydonidan kelgan `\n` yutiladi. */
function line(v: string, max: number): string {
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/* ────────────────────────── qo'llash ────────────────────────── */

/**
 * Operatsiyalarni ketma-ket qo'llaydi. Bittasi yiqilsa HECH NARSA
 * qo'llanmaydi (PATCH atomar) — xato `at` indeksi bilan qaytadi.
 *
 * Kirish hujjatida `doc.resume` BO'LISHI SHART: eski hujjatlar
 * (`legacyResumeModel`) chaqiruvchida modelga o'giriladi
 * (`resumeAdapter.hasModel`), shu bilan bu yerda bitta yo'l qoladi.
 */
export function applyResumeOps(doc: AcademicDoc, ops: ResumeOp[], ctx: ResumeEditCtx): ResumeEditResult {
  const start = doc.resume;
  if (!start) return fail("Bu hujjatda rezyume modeli yo'q", 0);
  let m = cloneResume(start);
  const assetRe = ownAssetUrlRe(ctx.genId);

  for (let at = 0; at < ops.length; at++) {
    const op = ops[at];
    switch (op.op) {
      case "text": {
        if (op.path === "skills") return fail("«skills» uchun «list» operatsiyasi ishlatiladi", at);
        const leaf = leafOf(m, op.path);
        if (!leaf) return fail(`Yo'l topilmadi: ${op.path}`, at);
        const raw = line(op.value, leaf.max);
        leaf.set(m, leaf.date ? normalizeDate(raw) : raw);
        break;
      }
      case "list": {
        // Matni o'zgarmagan ko'nikma AI nishonini saqlaydi, o'zgargani — yo'q.
        const before = new Map(m.skills.map((s) => [s.text, s.ai === true]));
        const seen = new Set<string>();
        const out: ResumeSkill[] = [];
        for (const raw of op.items) {
          const text = line(raw, RESUME_LIMITS.skillChars);
          if (!text) continue;
          const key = text.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(before.get(text) ? { text, ai: true } : { text });
          if (out.length >= RESUME_LIMITS.skills) break;
        }
        m.skills = out;
        break;
      }
      case "rowAdd": {
        const rows = rowsOf(m, op.section);
        if (rows.length >= ROW_LIMIT[op.section]) return fail(`«${op.section}» chegarasi: ${ROW_LIMIT[op.section]}`, at);
        const pos = op.at === undefined ? rows.length : op.at;
        if (!Number.isInteger(pos) || pos < 0 || pos > rows.length) return fail("«at» chegaradan tashqarida", at);
        const next = rows.slice();
        next.splice(pos, 0, emptyRow(op.section, freshId(op.section[0], new Set(rows.map((r) => r.id)))));
        setRows(m, op.section, next);
        break;
      }
      case "rowRemove": {
        const rows = rowsOf(m, op.section);
        if (!rows[op.index]) return fail("Qator indeksi chegaradan tashqarida", at);
        setRows(m, op.section, rows.filter((_, i) => i !== op.index));
        break;
      }
      case "rowMove": {
        const rows = rowsOf(m, op.section);
        if (!rows[op.from] || op.to < 0 || op.to >= rows.length) return fail("Qator indeksi chegaradan tashqarida", at);
        setRows(m, op.section, move(rows, op.from, op.to));
        break;
      }
      case "bulletAdd": {
        const row = m.experience[op.row];
        if (!row) return fail("Ish joyi indeksi chegaradan tashqarida", at);
        if (row.bullets.length >= RESUME_LIMITS.bullets) return fail(`Bandlar chegarasi: ${RESUME_LIMITS.bullets}`, at);
        const pos = op.at === undefined ? row.bullets.length : op.at;
        if (!Number.isInteger(pos) || pos < 0 || pos > row.bullets.length) return fail("«at» chegaradan tashqarida", at);
        const bs = row.bullets.slice();
        bs.splice(pos, 0, { text: line(op.value ?? "", RESUME_LIMITS.bulletChars) });
        const rows = m.experience.slice();
        rows[op.row] = { ...row, bullets: bs };
        m.experience = rows;
        break;
      }
      case "bulletRemove": {
        const row = m.experience[op.row];
        if (!row || !row.bullets[op.index]) return fail("Band indeksi chegaradan tashqarida", at);
        const rows = m.experience.slice();
        rows[op.row] = { ...row, bullets: row.bullets.filter((_, i) => i !== op.index) };
        m.experience = rows;
        break;
      }
      case "bulletMove": {
        const row = m.experience[op.row];
        if (!row || !row.bullets[op.from] || op.to < 0 || op.to >= row.bullets.length) return fail("Band indeksi chegaradan tashqarida", at);
        const rows = m.experience.slice();
        rows[op.row] = { ...row, bullets: move(row.bullets, op.from, op.to) };
        m.experience = rows;
        break;
      }
      case "sectionMove": {
        const from = m.order.indexOf(op.section);
        if (from < 0) return fail("Noma'lum bo'lim", at);
        if (op.to < 0 || op.to >= m.order.length) return fail("«to» chegaradan tashqarida", at);
        m.order = move(m.order, from, op.to);
        break;
      }
      case "template":
        m.template = op.template;
        break;
      case "palette":
        m.palette = op.palette;
        break;
      case "photo": {
        if (!op.url) {
          delete m.photo;
          break;
        }
        /*
         * Begona URL (boshqa generatsiya aktivi, `https:`) HECH QACHON
         * qabul qilinmaydi: DOCX qayta renderda `resolveImage` shu URL
         * ni o'qishga urinardi va bu IDOR/SSRF yo'li bo'lardi
         * (`slide-edit.ts` `ownImage` bilan bir xil qoida).
         */
        if (!assetRe.test(op.url)) return fail("Surat manzili bu hujjatga tegishli emas", at);
        m.photo = {
          url: op.url,
          shape: op.shape === "square" ? "square" : "circle",
          assetId: op.assetId || assetRe.exec(op.url)?.[1] || "",
          ...(op.originalAssetId ? { originalAssetId: op.originalAssetId } : {}),
          ...(op.crop ? { crop: { x: op.crop.x, y: op.crop.y, zoom: op.crop.zoom } } : {}),
        };
        break;
      }
      case "set": {
        const url = op.model.photo?.url ?? "";
        if (url && !assetRe.test(url) && !url.startsWith("data:")) {
          return fail("Surat manzili bu hujjatga tegishli emas", at);
        }
        m = cloneResume(op.model);
        break;
      }
      default:
        return fail("Noma'lum operatsiya", at);
    }
  }

  return { ok: true, doc: { ...doc, ...docFromResume(m, doc.meta) } };
}

/**
 * Teskari ro'yxat (undo). Oddiy maydon tahririning teskarisi — o'sha
 * `text` opi eski qiymat bilan; qolgan hamma narsa (ro'yxat, qator,
 * band, tartib, surat) uchun BUTUN MODEL (`set`). Sabab `inverseOps`
 * dagi bilan bir xil: maydon darajasidagi teskari hisob bo'sh element
 * o'chishi yoki `ai` nishoni yo'qolishi kabi holatlarda noto'g'ri
 * bo'lardi.
 */
export function inverseResumeOps(doc: AcademicDoc, ops: ResumeOp[], ctx: ResumeEditCtx): ResumeOp[] {
  const out: ResumeOp[] = [];
  let cur = doc;
  for (const op of ops) {
    const m = cur.resume;
    if (!m) break;
    if (op.op === "text" && op.path !== "skills" && !isAiBullet(m, op.path)) {
      const leaf = leafOf(m, op.path);
      if (leaf) out.push({ op: "text", path: op.path, value: leaf.get(m) });
      else out.push({ op: "set", model: cloneResume(m) });
    } else if (op.op === "template") {
      out.push({ op: "template", template: m.template });
    } else if (op.op === "palette") {
      out.push({ op: "palette", palette: m.palette });
    } else {
      out.push({ op: "set", model: cloneResume(m) });
    }
    const step = applyResumeOps(cur, [op], ctx);
    // Yiqilgan operatsiya hujjatni o'zgartirmaydi — teskarisi ham keraksiz.
    if (!step.ok) {
      out.pop();
      break;
    }
    cur = step.doc;
  }
  return out.reverse();
}

function isAiBullet(m: ResumeModel, path: string): boolean {
  const [sec, i, key, j] = path.split(".");
  if (sec !== "experience" || key !== "bullets") return false;
  return m.experience[Number(i)]?.bullets[Number(j)]?.ai === true;
}

/* ────────────────────────── tahlil (`unknown` dan) ────────────────────────── */

const MAX_OPS = 50;
/** Bitta matn qiymati — eng uzun maydondan (`summaryChars`) oshmaydi. */
const MAX_STR = RESUME_LIMITS.summaryChars;
const OP_NAMES = new Set([
  "text", "list", "rowAdd", "rowRemove", "rowMove",
  "bulletAdd", "bulletRemove", "bulletMove", "sectionMove",
  "template", "palette", "photo", "set",
]);
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function scan(v: unknown, depth = 0): string | null {
  if (depth > 8) return "Tana juda chuqur";
  if (typeof v === "string") return v.length > MAX_STR ? "Matn juda uzun" : null;
  if (v === null || typeof v === "number" || typeof v === "boolean" || v === undefined) return null;
  if (Array.isArray(v)) {
    if (v.length > 200) return "Ro'yxat juda uzun";
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

function idx(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 100;
}

function isRowSection(v: unknown): v is ResumeRowSection {
  return typeof v === "string" && (RESUME_ROW_SECTIONS as readonly string[]).includes(v);
}

function hex(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{0,64}$/.test(v);
}

export type ResumeParseResult = { ok: true; ops: ResumeOp[] } | { ok: false; error: string };

/**
 * HTTP tanasidan `ResumeOp[]` ga. Shakl xatosi shu yerda (400),
 * mazmun xatosi `applyResumeOps` da (422) — `parseDocOps` bilan bir xil
 * taqsimot.
 */
export function parseResumeOps(raw: unknown): ResumeParseResult {
  if (!Array.isArray(raw)) return { ok: false, error: "Operatsiyalar ro'yxati kutilgan" };
  if (!raw.length) return { ok: false, error: "Operatsiya yo'q" };
  if (raw.length > MAX_OPS) return { ok: false, error: `Bir so'rovda ${MAX_OPS} tadan ortiq operatsiya bo'lmaydi` };
  const bad = scan(raw);
  if (bad) return { ok: false, error: bad };

  const ops: ResumeOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Operatsiya obyekt bo'lishi kerak" };
    const o = item as Record<string, unknown>;
    const name = typeof o.op === "string" ? o.op : "";
    if (!OP_NAMES.has(name)) return { ok: false, error: "Noma'lum operatsiya" };
    switch (name) {
      case "text": {
        if (typeof o.path !== "string" || !RESUME_PATH_RE.test(o.path)) return { ok: false, error: "«path» yaroqsiz" };
        if (typeof o.value !== "string") return { ok: false, error: "«value» matn bo'lishi kerak" };
        ops.push({ op: "text", path: o.path, value: o.value });
        break;
      }
      case "list": {
        if (!Array.isArray(o.items) || !o.items.every((x) => typeof x === "string")) return { ok: false, error: "«items» matnlar ro'yxati bo'lishi kerak" };
        if (o.items.length > RESUME_LIMITS.skills) return { ok: false, error: `Ko'nikma chegarasi: ${RESUME_LIMITS.skills}` };
        ops.push({ op: "list", items: o.items as string[] });
        break;
      }
      case "rowAdd": {
        if (!isRowSection(o.section)) return { ok: false, error: "«section» yaroqsiz" };
        if (o.at !== undefined && !idx(o.at)) return { ok: false, error: "«at» yaroqsiz" };
        ops.push({ op: "rowAdd", section: o.section, ...(o.at === undefined ? {} : { at: o.at }) });
        break;
      }
      case "rowRemove": {
        if (!isRowSection(o.section) || !idx(o.index)) return { ok: false, error: "«rowRemove» yaroqsiz" };
        ops.push({ op: "rowRemove", section: o.section, index: o.index });
        break;
      }
      case "rowMove": {
        if (!isRowSection(o.section) || !idx(o.from) || !idx(o.to)) return { ok: false, error: "«rowMove» yaroqsiz" };
        ops.push({ op: "rowMove", section: o.section, from: o.from, to: o.to });
        break;
      }
      case "bulletAdd": {
        if (!idx(o.row)) return { ok: false, error: "«row» yaroqsiz" };
        if (o.at !== undefined && !idx(o.at)) return { ok: false, error: "«at» yaroqsiz" };
        if (o.value !== undefined && typeof o.value !== "string") return { ok: false, error: "«value» yaroqsiz" };
        ops.push({
          op: "bulletAdd",
          row: o.row,
          ...(o.at === undefined ? {} : { at: o.at }),
          ...(o.value === undefined ? {} : { value: o.value as string }),
        });
        break;
      }
      case "bulletRemove": {
        if (!idx(o.row) || !idx(o.index)) return { ok: false, error: "«bulletRemove» yaroqsiz" };
        ops.push({ op: "bulletRemove", row: o.row, index: o.index });
        break;
      }
      case "bulletMove": {
        if (!idx(o.row) || !idx(o.from) || !idx(o.to)) return { ok: false, error: "«bulletMove» yaroqsiz" };
        ops.push({ op: "bulletMove", row: o.row, from: o.from, to: o.to });
        break;
      }
      case "sectionMove": {
        if (typeof o.section !== "string" || !(RESUME_SECTION_IDS as string[]).includes(o.section)) return { ok: false, error: "«section» yaroqsiz" };
        if (!idx(o.to)) return { ok: false, error: "«to» yaroqsiz" };
        ops.push({ op: "sectionMove", section: o.section as ResumeSectionId, to: o.to });
        break;
      }
      case "template": {
        if (!isResumeTemplateId(o.template)) return { ok: false, error: "Noma'lum shablon" };
        ops.push({ op: "template", template: o.template });
        break;
      }
      case "palette": {
        if (!isResumePaletteId(o.palette)) return { ok: false, error: "Noma'lum palitra" };
        ops.push({ op: "palette", palette: o.palette });
        break;
      }
      case "photo": {
        if (typeof o.url !== "string" || o.url.length > 300) return { ok: false, error: "«url» yaroqsiz" };
        if (o.shape !== undefined && o.shape !== "circle" && o.shape !== "square") return { ok: false, error: "«shape» yaroqsiz" };
        if (o.assetId !== undefined && !hex(o.assetId)) return { ok: false, error: "«assetId» yaroqsiz" };
        if (o.originalAssetId !== undefined && !hex(o.originalAssetId)) return { ok: false, error: "«originalAssetId» yaroqsiz" };
        let crop: ResumeCrop | undefined;
        if (o.crop !== undefined) {
          const c = o.crop as Record<string, unknown> | null;
          if (!c || typeof c !== "object" || typeof c.x !== "number" || typeof c.y !== "number" || typeof c.zoom !== "number") {
            return { ok: false, error: "«crop» yaroqsiz" };
          }
          crop = { x: c.x, y: c.y, zoom: c.zoom };
        }
        ops.push({
          op: "photo",
          url: o.url,
          ...(o.shape === undefined ? {} : { shape: o.shape as "circle" | "square" }),
          ...(o.assetId === undefined ? {} : { assetId: o.assetId as string }),
          ...(o.originalAssetId === undefined ? {} : { originalAssetId: o.originalAssetId as string }),
          ...(crop ? { crop } : {}),
        });
        break;
      }
      default: {
        // `set` — butun model; `normalizeResume` chegaralarga sig'diradi.
        if (!o.model || typeof o.model !== "object" || Array.isArray(o.model)) return { ok: false, error: "«model» yaroqsiz" };
        const model = normalizeResume(o.model);
        if (!model) return { ok: false, error: "«model» yaroqsiz" };
        ops.push({ op: "set", model });
      }
    }
  }
  return { ok: true, ops };
}
