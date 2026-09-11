/**
 * Rezyume KIRISHI (Rezyume 2, AUDIT-15) — formadan modelgacha.
 *
 * Bu fayl `FormValues` (satr/son/mantiqiy) bilan `ResumeModel` orasidagi
 * yagona ko'prik. Ikki tomonga ishlaydi:
 *   • `resumeInputFromValues` — server (dvigatel, zond, fallback);
 *   • `encodeResumeValues`    — klient (forma qiymatlarini yig'adi).
 * Ikkalasi bitta faylda turadi, chunki JSON maydonlar shakli AYNAN mos
 * bo'lishi kerak; ilgari shunga o'xshash juftliklar ikki faylga ajralib,
 * vergul/JSON farqi bilan sinardi.
 *
 * Server importi YO'Q (izomorf): `lib/server/validate.ts` shu yerdan
 * `RESUME_JSON_FIELDS` ni import qiladi, teskarisi emas.
 */
import type { FormValues } from "../../types";
import type { DocMeta } from "../types";
import { joinCsv, splitCsv } from "../slide-params";
import {
  RESUME_LIMITS,
  emptyResume,
  isResumeEducationKind,
  linkKindOf,
  newRowId,
  normalizeDate,
  normalizeYear,
  resumeLabels,
  sortDesc,
  type ResumeCertificate,
  type ResumeCrop,
  type ResumeEducation,
  type ResumeExperience,
  type ResumeLanguage,
  type ResumeLink,
  type ResumeModel,
  type ResumePhoto,
  type ResumeSkill,
} from "./model";
import { RESUME_TEMPLATES, isResumePaletteId, normalizeResumeTemplate } from "./templates";

export type ResumeTone = "professional" | "qisqa" | "ijodiy";
export const RESUME_TONES: ResumeTone[] = ["professional", "qisqa", "ijodiy"];
export function isResumeTone(v: unknown): v is ResumeTone {
  return typeof v === "string" && (RESUME_TONES as string[]).includes(v);
}

/**
 * Foydalanuvchi BERGAN faktlar — ishonilaligan yagona manba.
 *
 * `mergeLlm` faqat shu obyektdan kompaniya, sana, muassasa, sertifikat,
 * til va havolani oladi; model javobidan esa faqat qayta yozilgan matn.
 */
export type ResumeInput = {
  identity: { fullName: string; headline: string };
  contact: { phone: string; email: string; location: string };
  experience: ResumeExperience[];
  education: ResumeEducation[];
  certificates: ResumeCertificate[];
  languages: ResumeLanguage[];
  /** CSV maydon — modelda `ResumeSkill[]` ga aylanadi. */
  skills: string[];
  links: ResumeLink[];
  about: string;
  tone: ResumeTone;
  extra: string;
  photoCrop?: ResumeCrop;
};

/** Surat: worker aktivni `data:` URL ga aylantirib beradi. */
export type ResumePhotoInput = { url: string; crop?: ResumeCrop; originalAssetId?: string; assetId?: string };

/**
 * `FormValues` ga SATR sifatida tushadigan maydonlar (JSON.stringify).
 *
 * `lib/server/validate.ts` shu ro'yxatga qarab ularga KENGROQ chegara
 * beradi (`MAX_JSON`): 4 000 belgilik oddiy chegara 12 ta ish joyi va
 * har biriga 10 ta bandni sig'dirmaydi — JSON o'rtasidan KESILADI (B-3).
 */
export const RESUME_JSON_FIELDS = ["experience", "education", "certificates", "languages", "links", "photoCrop"] as const;
export type ResumeJsonField = (typeof RESUME_JSON_FIELDS)[number];

/* ────────────────────────── kesilgan JSON ga chidamlilik ────────────────────────── */

/**
 * Kesilgan/buzuq JSON ni tiklaydi (B-3).
 *
 * `sanitizeValues` maydonni belgi bo'yicha kesadi — natijada
 * `[{"id":"e1",…},{"id":"e2","comp` kabi yarim JSON keladi. Butun
 * ro'yxatni yo'qotish o'rniga oxirgi TO'LIQ `}` gacha qirqib, ro'yxat
 * yopiladi va qayta uriniladi: foydalanuvchi 12 ta ish joyidan 9 tasini
 * ko'radi, 0 tasini emas.
 */
export function parseResumeJson(raw: unknown, field: string): unknown {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    /* pastda tiklanadi */
  }
  const cut = t.lastIndexOf("}");
  if (cut > 0) {
    const head = t.slice(0, cut + 1);
    for (const candidate of t.startsWith("[") ? [`${head}]`, head] : [head]) {
      try {
        const v = JSON.parse(candidate);
        console.warn(`[resume] «${field}» JSON kesilgan (${t.length} belgi) — ${candidate.length} belgigacha tiklandi`);
        return v;
      } catch {
        /* keyingi nomzod */
      }
    }
  }
  console.warn(`[resume] «${field}» JSON o'qib bo'lmadi (${t.length} belgi) — bo'sh qoldirildi`);
  return null;
}

function jsonRows(values: FormValues, field: ResumeJsonField): Record<string, unknown>[] {
  const v = parseResumeJson(values[field], field);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x));
}

/* ────────────────────────── yordamchilar ────────────────────────── */

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "";
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * "+998 90 123 45 67" → "+998901234567".
 *
 * Telefon `tel:` havolasiga ham, DOCX matniga ham BITTA shaklda tushadi;
 * ilgari qavs bilan yozilgan raqam `tel:` da yaroqsiz bo'lardi.
 */
export function normalizePhone(raw: unknown): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const plus = t.startsWith("+");
  const digits = t.replace(/\D/g, "");
  if (!digits) return "";
  return `${plus ? "+" : ""}${digits.slice(0, 20)}`;
}

function bulletsOf(v: unknown): { text: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { text: string }[] = [];
  for (const b of v) {
    const t =
      typeof b === "string" ? text(b, RESUME_LIMITS.bulletChars) : text((b as { text?: unknown } | null)?.text, RESUME_LIMITS.bulletChars);
    if (t) out.push({ text: t });
    if (out.length >= RESUME_LIMITS.bullets) break;
  }
  return out;
}

/* ────────────────────────── forma → kirish ────────────────────────── */

export function resumeInputFromValues(values: FormValues): ResumeInput {
  const experience: ResumeExperience[] = jsonRows(values, "experience")
    .slice(0, RESUME_LIMITS.experience)
    .map((e, i) => ({
      id: str(e.id, 16) || newRowId("e", i),
      company: str(e.company, RESUME_LIMITS.fieldChars),
      role: str(e.role, RESUME_LIMITS.fieldChars),
      start: normalizeDate(e.start),
      end: normalizeDate(e.end),
      bullets: bulletsOf(e.bullets),
    }))
    .filter((e) => e.company || e.role || e.bullets.length);

  const education: ResumeEducation[] = jsonRows(values, "education")
    .slice(0, RESUME_LIMITS.education)
    .map((e, i) => ({
      id: str(e.id, 16) || newRowId("d", i),
      // Tur berilmagan qoralama/eski qiymat — «oliy ta'lim» (AUDIT-16).
      kind: isResumeEducationKind(e.kind) ? e.kind : ("university" as const),
      institution: str(e.institution, RESUME_LIMITS.fieldChars),
      field: str(e.field, RESUME_LIMITS.fieldChars),
      degree: str(e.degree, RESUME_LIMITS.fieldChars),
      // Ta'limda oy so'ralmaydi — o'quv yili sentabrda boshlanadi.
      start: normalizeYear(e.start),
      end: normalizeYear(e.end),
    }))
    .filter((e) => e.institution || e.degree || e.field);

  const certificates: ResumeCertificate[] = jsonRows(values, "certificates")
    .slice(0, RESUME_LIMITS.certificates)
    .map((c, i) => ({
      id: str(c.id, 16) || newRowId("c", i),
      name: str(c.name, RESUME_LIMITS.fieldChars),
      issuer: str(c.issuer, RESUME_LIMITS.fieldChars),
      // Yil tanlagichdan keladi — «hozir» sertifikatda ma'nosiz.
      year: normalizeYear(c.year, false),
    }))
    .filter((c) => c.name);

  const languages: ResumeLanguage[] = jsonRows(values, "languages")
    .slice(0, RESUME_LIMITS.languages)
    .map((l, i) => ({ id: str(l.id, 16) || newRowId("l", i), language: str(l.language, 60), level: str(l.level, 40) }))
    .filter((l) => l.language);

  const links: ResumeLink[] = jsonRows(values, "links")
    .slice(0, RESUME_LIMITS.links)
    .map((k, i) => {
      const url = str(k.url, RESUME_LIMITS.urlChars);
      return { id: str(k.id, 16) || newRowId("k", i), kind: linkKindOf(url, k.kind), url };
    })
    .filter((k) => k.url);

  const crop = parseResumeJson(values.photoCrop, "photoCrop");
  const c = crop && typeof crop === "object" && !Array.isArray(crop) ? (crop as Record<string, unknown>) : null;

  const toneRaw = str(values.tone, 20);
  return {
    identity: {
      fullName: str(values.fullName, RESUME_LIMITS.nameChars),
      headline: str(values.targetRole, RESUME_LIMITS.headlineChars),
    },
    contact: {
      phone: normalizePhone(values.phone),
      email: str(values.email, RESUME_LIMITS.fieldChars),
      location: str(values.location, RESUME_LIMITS.fieldChars),
    },
    experience,
    education,
    certificates,
    languages,
    skills: splitCsv(values.skills, RESUME_LIMITS.skills, RESUME_LIMITS.skillChars),
    links,
    // Eski qatorlarda maydon `summary` deb atalgan edi (B-8).
    about: text(values.about ?? values.summary, RESUME_LIMITS.summaryChars),
    tone: isResumeTone(toneRaw) ? toneRaw : "professional",
    extra: text(values.extra, 600),
    ...(c && Number.isFinite(Number(c.zoom))
      ? { photoCrop: { x: Number(c.x) || 0, y: Number(c.y) || 0, zoom: Number(c.zoom) || 1 } }
      : {}),
  };
}

/** Klient uchun teskari yo'l — forma holatidan `FormValues`. */
export function encodeResumeValues(input: ResumeInput): FormValues {
  const out: FormValues = {
    fullName: input.identity.fullName,
    targetRole: input.identity.headline,
    phone: input.contact.phone,
    email: input.contact.email,
    location: input.contact.location,
    experience: JSON.stringify(input.experience.map((e) => ({ ...e, bullets: e.bullets.map((b) => b.text) }))),
    education: JSON.stringify(input.education),
    certificates: JSON.stringify(input.certificates),
    languages: JSON.stringify(input.languages),
    links: JSON.stringify(input.links.map((k) => ({ id: k.id, kind: k.kind, url: k.url }))),
    skills: joinCsv(input.skills),
    about: input.about,
    tone: input.tone,
    extra: input.extra,
  };
  if (input.photoCrop) out.photoCrop = JSON.stringify(input.photoCrop);
  return out;
}

/* ────────────────────────── LLM'siz model ────────────────────────── */

const DRAFT_SUMMARY: Record<string, (role: string, years: number) => string> = {
  uz: (role, years) =>
    years
      ? `${role} yo‘nalishida ${years} yildan ortiq amaliy tajribaga ega mutaxassis. Vazifalarni mustaqil rejalashtiradi, natijani o‘lchab boradi va jamoada ishlaydi.`
      : `${role} lavozimiga nomzod. Vazifalarni mustaqil rejalashtiradi, natijani o‘lchab boradi va jamoada ishlaydi.`,
  ru: (role, years) =>
    years
      ? `Специалист с опытом работы более ${years} лет по направлению «${role}». Самостоятельно планирует задачи, измеряет результат и работает в команде.`
      : `Кандидат на позицию «${role}». Самостоятельно планирует задачи, измеряет результат и работает в команде.`,
  en: (role, years) =>
    years
      ? `Specialist with ${years}+ years of hands-on experience in ${role}. Plans work independently, measures outcomes and collaborates across teams.`
      : `Candidate for the ${role} role. Plans work independently, measures outcomes and collaborates across teams.`,
};

/** Kirishdagi eng erta boshlanish yilidan bugungacha — taxminiy staj. */
function yearsOfExperience(rows: ResumeExperience[]): number {
  const starts = rows.map((e) => Number(/^(\d{4})/.exec(e.start)?.[1] ?? 0)).filter((y) => y >= 1950);
  if (!starts.length) return 0;
  const n = new Date().getFullYear() - Math.min(...starts);
  return n > 0 && n < 60 ? n : 0;
}

export function draftSummary(language: string, headline: string, rows: ResumeExperience[]): string {
  const lang = (language || "uz").toLowerCase();
  const role = headline || (lang === "ru" ? "специалист" : lang === "uz" ? "mutaxassis" : "specialist");
  const make = DRAFT_SUMMARY[lang] ?? DRAFT_SUMMARY.en;
  return make(role, yearsOfExperience(rows)).slice(0, RESUME_LIMITS.summaryChars);
}

/**
 * LLM'SIZ deterministik model — uch joyda kerak:
 *   • `content.ts` `resumeDoc` (kalitsiz muhit va LLM xatosi zaxirasi);
 *   • `resume-params.ts` differensial zondi (maket farqini o'lchash);
 *   • galereya/namuna (`sampleResume` bilan bir xil shakl).
 *
 * `model.ts` ga qo'shilmadi: u sof MODEL (izomorf, `DocMeta` bilmaydi),
 * bu esa KIRISH qatlami — meta va forma bilan bog'liq.
 */
export function draftModel(meta: DocMeta, input: ResumeInput, photo?: ResumePhotoInput): ResumeModel {
  const language = meta.language || "uz";
  const template = normalizeResumeTemplate(meta.resumeTemplate);
  const palette = isResumePaletteId(meta.resumePalette) ? meta.resumePalette : RESUME_TEMPLATES[template].defaultPalette;
  const m: ResumeModel = {
    ...emptyResume(language),
    template,
    palette,
    identity: {
      fullName: input.identity.fullName || meta.author || "",
      headline: input.identity.headline || meta.topic || "",
    },
    contact: { ...input.contact },
    summary: input.about || draftSummary(language, input.identity.headline || meta.topic, input.experience),
    experience: sortDesc(input.experience.map((e) => ({ ...e, bullets: e.bullets.map((b) => ({ text: b.text })) }))),
    education: sortDesc(input.education.map((e) => ({ ...e }))),
    certificates: input.certificates.map((c) => ({ ...c })),
    languages: input.languages.map((l) => ({ ...l })),
    skills: input.skills.map((t): ResumeSkill => ({ text: t })),
    links: input.links.map((k) => ({ ...k })),
    labels: resumeLabels(language),
    enriched: false,
  };
  if (photo?.url) {
    const shape = RESUME_TEMPLATES[template].photo.shape;
    const p: ResumePhoto = { url: photo.url, shape, assetId: photo.assetId ?? "" };
    if (photo.originalAssetId) p.originalAssetId = photo.originalAssetId;
    const crop = photo.crop ?? input.photoCrop;
    if (crop) p.crop = { x: crop.x, y: crop.y, zoom: crop.zoom };
    m.photo = p;
  }
  return m;
}
