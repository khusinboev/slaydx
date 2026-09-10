/**
 * Rezyume modeli (Rezyume 2, AUDIT-15) — `AcademicDoc.resume`.
 *
 * YAGONA MANBA: DOCX renderer (`resume/render-docx.ts`) va sayt ko'ruvchisi
 * (`components/viewers/resume/ResumePage.tsx`) ikkalasi ham shu modelni
 * `planResume` (`layout.ts`) orqali o'qiydi. Izomorf: server importi yo'q.
 *
 * Satrlarda `id` — tahrir oplari va LLM birlashtirish (`mergeLlm`) uchun;
 * matn bo'yicha emas, id bo'yicha mos keladi.
 */
import type { AcademicDoc, Block, DocSection } from "../types";
import { sectionLabels } from "../i18n";
import {
  RESUME_PALETTES,
  RESUME_TEMPLATES,
  isResumePaletteId,
  normalizeResumeTemplate,
  type ResumePaletteId,
  type ResumeSectionId,
  type ResumeTemplateId,
} from "./templates";

export type { ResumeSectionId, ResumeTemplateId, ResumePaletteId } from "./templates";

export type ResumeBullet = { text: string; ai?: true };
export type ResumeSkill = { text: string; ai?: true };
/** `start`/`end`: "YYYY-MM" | "YYYY" | "" ; `end` "now" = hozir. */
export type ResumeExperience = { id: string; company: string; role: string; start: string; end: string; bullets: ResumeBullet[] };
export type ResumeEducation = { id: string; institution: string; degree: string; start: string; end: string };
export type ResumeCertificate = { id: string; name: string; issuer: string; year: string };
export type ResumeLanguage = { id: string; language: string; level: string };
export type ResumeLinkKind = "linkedin" | "github" | "portfolio" | "other";
export type ResumeLink = { id: string; kind: ResumeLinkKind; url: string };
export type ResumeCrop = { x: number; y: number; zoom: number };
export type ResumePhoto = {
  /** `data:` (yaratish vaqtida) → `/api/generations/{id}/assets/{aid}` (`extractAssets`). */
  url: string;
  /** Surat allaqachon shu shaklda kesilgan (doira — shaffof PNG). */
  shape: "circle" | "square";
  /** Kesilgan surat aktivi (`photo_uploads.asset_id` yoki generatsiya aktivi). */
  assetId: string;
  /** Asl surat — qayta markazlash uchun. */
  originalAssetId?: string;
  crop?: ResumeCrop;
};
export type ResumeLabelKey = ResumeSectionId | "contact" | "present" | "resume";
export type ResumeLabels = Record<ResumeLabelKey, string>;

export type ResumeModel = {
  v: 1;
  language: string;
  template: ResumeTemplateId;
  palette: ResumePaletteId;
  identity: { fullName: string; headline: string };
  contact: { phone: string; email: string; location: string };
  photo?: ResumePhoto;
  summary: string;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  certificates: ResumeCertificate[];
  languages: ResumeLanguage[];
  skills: ResumeSkill[];
  links: ResumeLink[];
  /** Asosiy ustun tartibi — ko'ruvchida sudrab o'zgartiriladi. */
  order: ResumeSectionId[];
  labels: ResumeLabels;
  /** AI boyitish ishlatilganmi (`ai:true` bandlar bor bo'lishi mumkin). */
  enriched: boolean;
};

export const RESUME_LIMITS = {
  experience: 12,
  bullets: 10,
  bulletChars: 300,
  education: 8,
  certificates: 12,
  languages: 10,
  skills: 40,
  skillChars: 40,
  links: 6,
  summaryChars: 1200,
  nameChars: 120,
  headlineChars: 120,
  fieldChars: 160,
  urlChars: 300,
} as const;

export const RESUME_SECTION_IDS: ResumeSectionId[] = ["summary", "experience", "education", "certificates", "languages", "skills", "links"];
export const DEFAULT_ORDER: ResumeSectionId[] = ["summary", "experience", "education", "certificates", "languages", "skills", "links"];

/* ────────────────────────── yorliqlar ────────────────────────── */

const LABELS: Record<string, ResumeLabels> = {
  uz: { summary: "Qisqacha", experience: "Ish tajribasi", education: "Ta’lim", certificates: "Sertifikatlar", languages: "Tillar", skills: "Ko‘nikmalar", links: "Havolalar", contact: "Aloqa", present: "hozir", resume: "Rezyume" },
  ru: { summary: "Кратко о себе", experience: "Опыт работы", education: "Образование", certificates: "Сертификаты", languages: "Языки", skills: "Навыки", links: "Ссылки", contact: "Контакты", present: "наст. время", resume: "Резюме" },
  en: { summary: "Summary", experience: "Work experience", education: "Education", certificates: "Certificates", languages: "Languages", skills: "Skills", links: "Links", contact: "Contact", present: "present", resume: "Résumé" },
};

export const RESUME_LABEL_KEYS: ResumeLabelKey[] = ["summary", "experience", "education", "certificates", "languages", "skills", "links", "contact", "present", "resume"];

/**
 * Rezyume yorliqlari: uz/ru/en — koddan; boshqa til — modeldan (`labels`
 * JSON, `write.ts`), bo'lmasa inglizcha. Bu funksiya faqat KOD yorliqlarini
 * beradi; `hasCodeLabels` — modelga so'rov kerakmi.
 */
export function resumeLabels(language: string): ResumeLabels {
  return LABELS[(language || "uz").toLowerCase()] ?? LABELS.en;
}
export function hasCodeLabels(language: string): boolean {
  return Boolean(LABELS[(language || "uz").toLowerCase()]);
}

/** Model bergan yorliqlarni tozalab, yetishmaganini inglizcha bilan to'ldiradi. */
export function sanitizeLabels(raw: unknown, language: string): ResumeLabels {
  const base = resumeLabels(language);
  const out: ResumeLabels = { ...base };
  if (raw && typeof raw === "object") {
    for (const k of RESUME_LABEL_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim() && v.trim().length <= 40) out[k] = v.trim();
    }
  }
  return out;
}

/* ────────────────────────── yordamchilar ────────────────────────── */

const s = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function newRowId(prefix: string, i: number): string {
  return `${prefix}${i + 1}`;
}

/** "2021-03" | "2021" | "now" | "" — boshqa hamma narsa "" ga tushadi. */
export function normalizeDate(v: unknown): string {
  const t = s(v, 12).toLowerCase();
  if (t === "now" || t === "hozir" || t === "present") return "now";
  const m = /^(\d{4})(?:-(\d{1,2}))?$/.exec(t);
  if (!m) return "";
  const y = Number(m[1]);
  if (y < 1950 || y > 2100) return "";
  if (!m[2]) return String(y);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return String(y);
  return `${y}-${String(mo).padStart(2, "0")}`;
}

function normBullets(v: unknown, max = RESUME_LIMITS.bullets): ResumeBullet[] {
  const out: ResumeBullet[] = [];
  for (const b of arr(v)) {
    const text = typeof b === "string" ? s(b, RESUME_LIMITS.bulletChars) : s(obj(b).text, RESUME_LIMITS.bulletChars);
    if (!text) continue;
    const ai = typeof b === "object" && b !== null && (b as { ai?: unknown }).ai === true;
    out.push(ai ? { text, ai: true } : { text });
    if (out.length >= max) break;
  }
  return out;
}

function normSkills(v: unknown): ResumeSkill[] {
  const out: ResumeSkill[] = [];
  const seen = new Set<string>();
  for (const b of arr(v)) {
    const text = typeof b === "string" ? s(b, RESUME_LIMITS.skillChars) : s(obj(b).text, RESUME_LIMITS.skillChars);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const ai = typeof b === "object" && b !== null && (b as { ai?: unknown }).ai === true;
    out.push(ai ? { text, ai: true } : { text });
    if (out.length >= RESUME_LIMITS.skills) break;
  }
  return out;
}

const LINK_KINDS: ResumeLinkKind[] = ["linkedin", "github", "portfolio", "other"];
export function linkKindOf(url: string, hint?: unknown): ResumeLinkKind {
  if (typeof hint === "string" && (LINK_KINDS as string[]).includes(hint)) return hint as ResumeLinkKind;
  const u = url.toLowerCase();
  if (u.includes("linkedin.")) return "linkedin";
  if (u.includes("github.")) return "github";
  return u ? "portfolio" : "other";
}

function normOrder(v: unknown): ResumeSectionId[] {
  const out: ResumeSectionId[] = [];
  for (const x of arr(v)) if (typeof x === "string" && (RESUME_SECTION_IDS as string[]).includes(x) && !out.includes(x as ResumeSectionId)) out.push(x as ResumeSectionId);
  for (const id of DEFAULT_ORDER) if (!out.includes(id)) out.push(id);
  return out;
}

export function emptyResume(language = "uz"): ResumeModel {
  return {
    v: 1,
    language: language || "uz",
    template: "modern",
    palette: "ember",
    identity: { fullName: "", headline: "" },
    contact: { phone: "", email: "", location: "" },
    summary: "",
    experience: [],
    education: [],
    certificates: [],
    languages: [],
    skills: [],
    links: [],
    order: [...DEFAULT_ORDER],
    labels: resumeLabels(language),
    enriched: false,
  };
}

/**
 * Har qanday kirishni (LLM JSON, tahrir opi, eski `doc_json`) chegaralarga
 * sig'dirib modelga aylantiradi. Ism ham, lavozim ham yo'q bo'lsa `null`.
 */
export function normalizeResume(raw: unknown): ResumeModel | null {
  const r = obj(raw);
  if (!Object.keys(r).length) return null;
  const language = s(r.language, 8).toLowerCase() || "uz";
  const identity = obj(r.identity);
  const contact = obj(r.contact);
  const m: ResumeModel = {
    v: 1,
    language,
    template: normalizeResumeTemplate(r.template),
    palette: isResumePaletteId(r.palette) ? r.palette : RESUME_TEMPLATES[normalizeResumeTemplate(r.template)].defaultPalette,
    identity: { fullName: s(identity.fullName, RESUME_LIMITS.nameChars), headline: s(identity.headline, RESUME_LIMITS.headlineChars) },
    contact: { phone: s(contact.phone, 32), email: s(contact.email, RESUME_LIMITS.fieldChars), location: s(contact.location, RESUME_LIMITS.fieldChars) },
    summary: s(r.summary, RESUME_LIMITS.summaryChars),
    experience: arr(r.experience)
      .slice(0, RESUME_LIMITS.experience)
      .map((x, i) => {
        const e = obj(x);
        return {
          id: s(e.id, 16) || newRowId("e", i),
          company: s(e.company, RESUME_LIMITS.fieldChars),
          role: s(e.role, RESUME_LIMITS.fieldChars),
          start: normalizeDate(e.start),
          end: normalizeDate(e.end),
          bullets: normBullets(e.bullets),
        };
      })
      .filter((e) => e.company || e.role || e.bullets.length),
    education: arr(r.education)
      .slice(0, RESUME_LIMITS.education)
      .map((x, i) => {
        const e = obj(x);
        return {
          id: s(e.id, 16) || newRowId("d", i),
          institution: s(e.institution, RESUME_LIMITS.fieldChars),
          degree: s(e.degree, RESUME_LIMITS.fieldChars),
          start: normalizeDate(e.start),
          end: normalizeDate(e.end),
        };
      })
      .filter((e) => e.institution || e.degree),
    certificates: arr(r.certificates)
      .slice(0, RESUME_LIMITS.certificates)
      .map((x, i) => {
        const e = obj(x);
        return { id: s(e.id, 16) || newRowId("c", i), name: s(e.name, RESUME_LIMITS.fieldChars), issuer: s(e.issuer, RESUME_LIMITS.fieldChars), year: s(e.year, 12) };
      })
      .filter((e) => e.name),
    languages: arr(r.languages)
      .slice(0, RESUME_LIMITS.languages)
      .map((x, i) => {
        const e = obj(x);
        return { id: s(e.id, 16) || newRowId("l", i), language: s(e.language, 60), level: s(e.level, 40) };
      })
      .filter((e) => e.language),
    skills: normSkills(r.skills),
    links: arr(r.links)
      .slice(0, RESUME_LIMITS.links)
      .map((x, i) => {
        const e = obj(x);
        const url = s(e.url, RESUME_LIMITS.urlChars);
        return { id: s(e.id, 16) || newRowId("k", i), kind: linkKindOf(url, e.kind), url };
      })
      .filter((e) => e.url),
    order: normOrder(r.order),
    labels: sanitizeLabels(r.labels, language),
    enriched: r.enriched === true,
  };
  const photo = obj(r.photo);
  const photoUrl = s(photo.url, 2_000_000);
  if (photoUrl) {
    const crop = obj(photo.crop);
    m.photo = {
      url: photoUrl,
      shape: photo.shape === "square" ? "square" : "circle",
      assetId: s(photo.assetId, 64),
      ...(s(photo.originalAssetId, 64) ? { originalAssetId: s(photo.originalAssetId, 64) } : {}),
      ...(typeof crop.zoom === "number" ? { crop: { x: Number(crop.x) || 0, y: Number(crop.y) || 0, zoom: Number(crop.zoom) || 1 } } : {}),
    };
  }
  if (!m.identity.fullName && !m.identity.headline && !m.summary && !m.experience.length) return null;
  return m;
}

/** Sana kaliti: "now" eng katta, keyin "YYYY-MM" > "YYYY", bo'sh eng kichik. */
function dateKey(v: string): number {
  if (v === "now") return 9_999_99;
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(v);
  if (!m) return -1;
  return Number(m[1]) * 100 + (m[2] ? Number(m[2]) : 99);
}

/** Xronologik teskari tartib: hozirgi → end desc → start desc. Barqaror. */
export function sortDesc<T extends { start: string; end: string }>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => dateKey(b.r.end) - dateKey(a.r.end) || dateKey(b.r.start) - dateKey(a.r.start) || a.i - b.i)
    .map((x) => x.r);
}

const MONTHS: Record<string, string[]> = {
  uz: ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"],
  ru: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** "2021-03" → "mar 2021" (uz/ru/en), boshqa til → "03.2021"; "now" → yorliq. */
export function formatDate(v: string, L: ResumeLabels, lang: string): string {
  if (!v) return "";
  if (v === "now") return L.present;
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(v);
  if (!m) return v;
  if (!m[2]) return m[1];
  const names = MONTHS[(lang || "uz").toLowerCase()];
  return names ? `${names[Number(m[2]) - 1]} ${m[1]}` : `${m[2]}.${m[1]}`;
}

/** "mar 2021 – hozir"; faqat biri bo'lsa o'zi; ikkalasi bo'sh → "". */
export function formatPeriod(start: string, end: string, L: ResumeLabels, lang: string): string {
  const a = formatDate(start, L, lang);
  const b = formatDate(end, L, lang);
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

/* ────────────────────────── eski hujjatlar (B-8) ────────────────────────── */

/**
 * Rezyume 2 dan oldingi `doc_json` (4 bo'lim: summary/exp/edu/skills,
 * `summary.blocks[1]` = kontakt satri) → model. Ko'ruvchi va DOCX
 * ikkalasi ham `doc.resume ?? legacyResumeModel(doc)` deb o'qiydi.
 */
export function legacyResumeModel(doc: AcademicDoc): ResumeModel {
  const L = sectionLabels(doc.meta.language);
  const byId = Object.fromEntries(doc.sections.map((sec) => [sec.id, sec]));
  const blocks = (id: string): Block[] => byId[id]?.blocks ?? [];
  const summaryBlocks = blocks("summary");
  const contactLine = summaryBlocks[1]?.text || doc.meta.city || "";
  const parts = contactLine.split(" · ").map((p) => p.trim()).filter(Boolean);
  const email = parts.find((p) => p.includes("@")) ?? "";
  const phone = parts.find((p) => /^\+?[\d\s()-]{7,}$/.test(p)) ?? "";
  const location = parts.find((p) => p !== email && p !== phone) ?? "";

  const experience: ResumeExperience[] = [];
  let cur: ResumeExperience | null = null;
  for (const b of blocks("exp")) {
    if (!b.text.trim()) continue;
    if (b.kind === "h3" || (b.kind === "p" && !cur)) {
      cur = { id: newRowId("e", experience.length), company: "", role: b.text.trim(), start: "", end: "", bullets: [] };
      experience.push(cur);
      if (b.kind === "p") cur = null;
    } else if (cur) {
      cur.bullets.push({ text: b.text.trim() });
    } else {
      experience.push({ id: newRowId("e", experience.length), company: "", role: b.text.trim(), start: "", end: "", bullets: [] });
    }
  }
  const education: ResumeEducation[] = blocks("edu")
    .filter((b) => b.text.trim())
    .map((b, i) => ({ id: newRowId("d", i), institution: b.text.trim(), degree: "", start: "", end: "" }));
  const skills: ResumeSkill[] = blocks("skills")
    .flatMap((b) => (b.kind === "li" ? [b.text] : b.text.split(/[,·]/)))
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ text }));

  const m = emptyResume(doc.meta.language);
  m.identity = { fullName: doc.meta.author || "", headline: doc.meta.topic || "" };
  m.contact = { phone, email, location };
  m.summary = summaryBlocks[0]?.text ?? "";
  m.experience = experience.slice(0, RESUME_LIMITS.experience);
  m.education = education.slice(0, RESUME_LIMITS.education);
  m.skills = skills.slice(0, RESUME_LIMITS.skills);
  m.labels = {
    ...m.labels,
    summary: byId.summary?.title || L.summary,
    experience: byId.exp?.title || L.experience,
    education: byId.edu?.title || L.education,
    skills: byId.skills?.title || L.skills,
    contact: L.fieldContact,
    resume: L.viewerResume,
  };
  return m;
}

/* ────────────────────────── sintez bo'limlar ────────────────────────── */

/**
 * Modeldan `DocSection[]` — bosh sahifa kartasi (`preview.lines`), qidiruv,
 * eski kod (`WordViewer` fallback) uchun. Rollback xavfsizligi: eski kod
 * `doc.resume` ni bilmasa ham `sections` ni o'qiy oladi.
 */
export function resumeSections(m: ResumeModel): DocSection[] {
  const L = m.labels;
  const out: DocSection[] = [];
  const contact = [m.contact.location, m.contact.email, m.contact.phone].filter(Boolean).join(" · ");
  out.push({ id: "summary", title: L.summary, blocks: [{ kind: "p", text: m.summary }, { kind: "p", text: contact }] });
  for (const id of m.order) {
    if (id === "summary") continue;
    if (id === "experience" && m.experience.length) {
      const blocks: Block[] = [];
      for (const e of m.experience) {
        const period = formatPeriod(e.start, e.end, L, m.language);
        blocks.push({ kind: "h3", text: [period, e.role, e.company].filter(Boolean).join(" — ") });
        for (const b of e.bullets) blocks.push({ kind: "li", text: b.text });
      }
      out.push({ id: "exp", title: L.experience, blocks });
    } else if (id === "education" && m.education.length) {
      out.push({
        id: "edu",
        title: L.education,
        blocks: m.education.map((e) => ({ kind: "p", text: [formatPeriod(e.start, e.end, L, m.language), e.degree, e.institution].filter(Boolean).join(" — ") })),
      });
    } else if (id === "certificates" && m.certificates.length) {
      out.push({ id: "certificates", title: L.certificates, blocks: m.certificates.map((c) => ({ kind: "li", text: [c.name, c.issuer, c.year].filter(Boolean).join(", ") })) });
    } else if (id === "languages" && m.languages.length) {
      out.push({ id: "languages", title: L.languages, blocks: m.languages.map((l) => ({ kind: "li", text: l.level ? `${l.language} — ${l.level}` : l.language })) });
    } else if (id === "skills" && m.skills.length) {
      out.push({ id: "skills", title: L.skills, blocks: m.skills.map((k) => ({ kind: "li", text: k.text })) });
    } else if (id === "links" && m.links.length) {
      out.push({ id: "links", title: L.links, blocks: m.links.map((k) => ({ kind: "li", text: k.url })) });
    }
  }
  return out;
}

/** Modelni to'liq `AcademicDoc` ga o'raydi (`meta.topic`/`author` sinxron). */
export function docFromResume(model: ResumeModel, meta: AcademicDoc["meta"]): AcademicDoc {
  return {
    meta: { ...meta, language: model.language, topic: model.identity.headline || meta.topic, author: model.identity.fullName || meta.author },
    titlePage: false,
    toc: false,
    sections: resumeSections(model),
    resume: model,
  };
}

/** Surat bor va shablon suratni ko'rsatadimi (classic — faqat aniq berilsa). */
export function showsPhoto(m: ResumeModel): boolean {
  return Boolean(m.photo?.url);
}

export function paletteOf(m: ResumeModel) {
  return RESUME_PALETTES[m.palette] ?? RESUME_PALETTES[RESUME_TEMPLATES[m.template].defaultPalette];
}
