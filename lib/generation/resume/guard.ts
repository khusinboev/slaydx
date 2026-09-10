/**
 * Rezyume FAKT QO'RIQCHISI (Rezyume 2, AUDIT-15).
 *
 * Rezyume hujjat emas, DA'VO: yo'q ish joyi yozilgan CV bilan suhbatga
 * borish foydalanuvchi uchun jiddiy zarar. Promptda «uydirmang» deyilgan,
 * lekin prompt — iltimos, tekshiruv emas. Bu fayl model javobini
 * KIRISHGA solishtirib qirqadi va nima qilinganini `GuardReport` da
 * jurnalga yozadi.
 *
 * Ilgari (AUDIT-5 P1-19) mantiq `writeResumeWithLlm` ichida yopiq
 * funksiya edi va uni sinash uchun jonli LLM chaqiruvi kerak bo'lardi.
 * Endi sof funksiya: kirish + model javobi → tozalangan javob.
 *
 * Olti qoida, har biri alohida test bilan qulflangan:
 *   1. faqat kirish id lari qoladi; yo'qolgani kirishdan tiklanadi;
 *   2. kirishda YO'Q yil har matndan olib tashlanadi;
 *   3. boyitish OFF — `ai` bandlar/ko'nikmalar butunlay o'chadi;
 *   4. boyitish ON — ish joyiga ≤2 `ai` band, jami ≤6 `ai` ko'nikma,
 *      raqamli `ai` band o'chadi (raqam = tekshirib bo'lmaydigan da'vo);
 *   5. tashkilot tekshiruvi NFKC + kichik harf; CJK/arab chiqishda
 *      O'TKAZIB YUBORILADI (B-7 — kompaniya baribir kirishdan olinadi);
 *   6. `summary` da uydirma yil yoki uydirma tashkilot bo'lgan JUMLA
 *      tashlanadi (butun `summary` emas — bitta jumla uchun to'liq
 *      qisqachani yo'qotish qimmat).
 */
import { RESUME_LIMITS, type ResumeExperience, type ResumeLabels } from "./model";
import type { ResumeInput } from "./input";

/* ────────────────────────── model javobi shakli ────────────────────────── */

export type ResumeLlmBullet = { text: string; ai?: boolean };
export type ResumeLlmExperience = { id: string; role: string; bullets: ResumeLlmBullet[] };
export type ResumeLlmEducation = { id: string; degree: string };
export type ResumeLlmSkill = { text: string; ai?: boolean };

export type ResumeLlmOut = {
  summary: string;
  headline: string;
  labels?: Partial<ResumeLabels>;
  experience: ResumeLlmExperience[];
  education: ResumeLlmEducation[];
  skills: ResumeLlmSkill[];
};

export type GuardReport = {
  /** Kirishda yo'q id — butun qator tashlandi. */
  unknownRows: number;
  /** Model tushirib qoldirgan id — kirishdan tiklandi. */
  restoredRows: number;
  /** Yil olib tashlangan matn maydonlari soni. */
  strippedYears: number;
  /** Uydirma tashkilot sababli kirishdagi qiymatga qaytarilgan maydon. */
  revertedFields: number;
  /** Chegara/raqam/OFF sababli o'chirilgan `ai` bandlar. */
  droppedBullets: number;
  /** Chegara/OFF sababli o'chirilgan `ai` ko'nikmalar. */
  droppedSkills: number;
  /** `summary` dan olib tashlangan jumlalar. */
  droppedSentences: number;
  /** Tashkilot tekshiruvi o'tkazib yuborildimi (CJK/arab chiqish). */
  orgCheckSkipped: boolean;
};

/** Boyitishda ish joyiga ruxsat etilgan `ai` band soni. */
export const AI_BULLETS_PER_JOB = 2;
/** Boyitishda jami ruxsat etilgan `ai` ko'nikma soni. */
export const AI_SKILLS_MAX = 6;

/**
 * Tashkilot tekshiruvi O'TKAZIB YUBORILADIGAN tillar (B-7).
 *
 * Xitoy/yapon/koreys/arab chiqishida model kompaniya nomini o'z
 * yozuviga o'giradi («Artel» → 「アルテル」) va lotin tokeni bo'yicha
 * solishtirish HAMMASINI uydirma deb topadi. Kompaniya nomi baribir
 * `mergeLlm` da kirishdan olinadi, ya'ni tekshiruvsiz ham uydirma
 * ish joyi hujjatga tusha olmaydi.
 */
const NO_ORG_CHECK = new Set(["zh", "ja", "ko", "ar"]);

/* ────────────────────────── faktlar ────────────────────────── */

/** NFKC + kichik harf — «Artel」», «ＡＲＴＥＬ» va «artel» bir xil ko'rinsin. */
function fold(s: string): string {
  return String(s ?? "").normalize("NFKC").toLowerCase();
}

/** Kirishdagi barcha matn — tashkilot va yil tekshiruvi uchun langar. */
export function inputFacts(input: ResumeInput): string {
  const parts: string[] = [
    input.identity.fullName,
    input.identity.headline,
    input.contact.location,
    input.about,
    input.extra,
    ...input.skills,
  ];
  for (const e of input.experience) parts.push(e.company, e.role, e.start, e.end, ...e.bullets.map((b) => b.text));
  for (const e of input.education) parts.push(e.institution, e.degree, e.start, e.end);
  for (const c of input.certificates) parts.push(c.name, c.issuer, c.year);
  for (const l of input.languages) parts.push(l.language, l.level);
  for (const k of input.links) parts.push(k.url);
  return fold(parts.filter(Boolean).join(" "));
}

/**
 * Kirishda uchraydigan YILLAR.
 *
 * Sanalardan tashqari BANDLAR ichidagi raqamlar ham hisobga olinadi:
 * foydalanuvchi «2019-yilda ERP joriy qildim» deb yozgan bo'lsa, model
 * shu yilni qayta ishlata olishi kerak.
 */
export function inputYears(input: ResumeInput): Set<string> {
  const bag = inputFacts(input);
  return new Set(bag.match(/\b(?:19|20)\d{2}\b/g) ?? []);
}

/**
 * Kiritilmagan yilni olib tashlaydi (P1-19 dan ko'chirildi).
 *
 * Model ko'pincha mantiqiy, lekin O'YLAB TOPILGAN sana qo'shadi:
 * bakalavr 2021-yilda tugagan bo'lsa, u «2017–2021» deb yozadi.
 * Oraliqda bitta yil notanish bo'lsa BUTUN oraliq olib tashlanadi —
 * yarim oraliq («–2021») ma'nosiz.
 */
export function stripUnknownYears(text: string, years: Set<string>): string {
  const t = String(text ?? "");
  if (!years.size) return t;
  return t
    .replace(/\b(?:19|20)\d{2}\s*[–—-]\s*(?:19|20)\d{2}\b/g, (range) =>
      (range.match(/\b(?:19|20)\d{2}\b/g) ?? []).every((y) => years.has(y)) ? range : "",
    )
    .replace(/\b(?:19|20)\d{2}\b/g, (y) => (years.has(y) ? y : ""))
    .replace(/\s*·\s*(?=·|$)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s·,;—–-]+|[\s·,;—–-]+$/g, "")
    .trim();
}

/**
 * Tashkilot/joy nomi kiritilgan matndan olinganmi.
 *
 * Ehtiyotkor: model qayta ifodalashi mumkin («15-maktab» → «15-sonli
 * umumiy o'rta ta'lim maktabi»), shuning uchun kamida BITTA mazmunli
 * bo'lak kirishda uchrasa yetarli.
 */
export function orgIsKnown(head: string, facts: string): boolean {
  if (!facts.trim()) return true;
  const tokens = fold(head)
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 4);
  if (!tokens.length) return true;
  return tokens.some((t) => facts.includes(t));
}

/**
 * Matndagi TASHKILOT NOMZODLARI.
 *
 * Ikki naqsh, ataylab tor: (a) ketma-ket 2+ bosh harfli so'z («Artel
 * Electronics», «Respublika ta'lim markazi»), (b) 3+ belgili to'liq
 * BOSH HARFLI qisqartma («TDPU», «ACCA»).
 *
 * Nega bitta bosh harfli so'z hisoblanmaydi: nemis tilida HAR ot bosh
 * harf bilan yoziladi («Erfahrung in der Finanzanalyse») — bitta so'z
 * qoidasi nemischa qisqachani butunlay yo'q qilardi. Bu narx: yolg'iz
 * «Google» o'tib ketadi. Almashuv ataylab: qisqachada yolg'iz brend
 * nomi kamdan-kam, buzilgan qisqacha esa har safar ko'rinadi.
 */
export function orgCandidates(text: string): string[] {
  const out: string[] = [];
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) out.push(run.join(" "));
    run = [];
  };
  for (const raw of words) {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const first = w.charAt(0);
    const capped = Boolean(w) && first !== first.toLowerCase() && first === first.toUpperCase();
    if (capped && w.length >= 2) {
      run.push(w);
      if (w.length >= 3 && w === w.toUpperCase() && /\p{L}/u.test(w)) out.push(w);
    } else {
      flush();
    }
    if (/[.!?]$/.test(raw)) flush();
  }
  flush();
  return out;
}

/* ────────────────────────── qo'riqchi ────────────────────────── */

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Jumlalarga ajratadi (nuqta/undov/so'roqdan keyin). */
function sentences(text: string): string[] {
  return String(text ?? "")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function guardResume(
  input: ResumeInput,
  out: ResumeLlmOut,
  opts: { enrich: boolean; language: string },
): { out: ResumeLlmOut; report: GuardReport } {
  const facts = inputFacts(input);
  const years = inputYears(input);
  const orgCheckSkipped = NO_ORG_CHECK.has((opts.language || "uz").toLowerCase());
  const report: GuardReport = {
    unknownRows: 0,
    restoredRows: 0,
    strippedYears: 0,
    revertedFields: 0,
    droppedBullets: 0,
    droppedSkills: 0,
    droppedSentences: 0,
    orgCheckSkipped,
  };

  /** Yilni tozalab, o'zgargan bo'lsa hisobga qo'shadi. */
  const clean = (t: string): string => {
    const v = stripUnknownYears(t, years);
    if (v !== t) report.strippedYears++;
    return v;
  };
  /**
   * Matnda KIRISHDA YO'Q tashkilot nomzodi bormi.
   *
   * Butun matnni `orgIsKnown` ga berish juda yumshoq bo'lardi (uzun
   * bandda biror so'z albatta kirishda uchraydi), shuning uchun avval
   * nomzodlar ajratiladi va HAR BIRI alohida tekshiriladi.
   */
  const hasUnknownOrg = (t: string): boolean =>
    !orgCheckSkipped && orgCandidates(t).some((c) => !orgIsKnown(c, facts));

  /* ── 1 + 5: ish joylari id bo'yicha ── */
  const byId = new Map<string, ResumeLlmExperience>();
  for (const row of Array.isArray(out.experience) ? out.experience : []) {
    const id = clip(row?.id, 16);
    if (!id) continue;
    if (byId.has(id)) continue;
    byId.set(id, row);
  }
  for (const id of byId.keys()) {
    if (!input.experience.some((e) => e.id === id)) report.unknownRows++;
  }

  const experience: ResumeLlmExperience[] = input.experience.map((src: ResumeExperience) => {
    const row = byId.get(src.id);
    if (!row) {
      report.restoredRows++;
      return { id: src.id, role: src.role, bullets: src.bullets.map((b) => ({ text: b.text })) };
    }
    let role = clean(clip(row.role, RESUME_LIMITS.fieldChars)) || src.role;
    if (hasUnknownOrg(role)) {
      report.revertedFields++;
      role = src.role;
    }
    const bullets: ResumeLlmBullet[] = [];
    let aiUsed = 0;
    const seen = new Set<string>();
    for (const b of Array.isArray(row.bullets) ? row.bullets : []) {
      const ai = b?.ai === true;
      const t = clean(clip(b?.text, RESUME_LIMITS.bulletChars));
      if (!t) continue;
      const key = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (seen.has(key)) continue;
      if (ai) {
        // 3: OFF — boyitish umuman yo'q. 4: ON — chegara, raqam va mijoz nomi taqiqi.
        if (!opts.enrich || aiUsed >= AI_BULLETS_PER_JOB || /\d/.test(t) || hasUnknownOrg(t)) {
          report.droppedBullets++;
          continue;
        }
        aiUsed++;
      }
      seen.add(key);
      bullets.push(ai ? { text: t, ai: true } : { text: t });
      if (bullets.length >= RESUME_LIMITS.bullets) break;
    }
    return { id: src.id, role, bullets: bullets.length ? bullets : src.bullets.map((b) => ({ text: b.text })) };
  });

  /* ── 1 + 2: ta'lim ── */
  const eduById = new Map<string, ResumeLlmEducation>();
  for (const row of Array.isArray(out.education) ? out.education : []) {
    const id = clip(row?.id, 16);
    if (!id || eduById.has(id)) continue;
    eduById.set(id, row);
  }
  for (const id of eduById.keys()) {
    if (!input.education.some((e) => e.id === id)) report.unknownRows++;
  }
  const education: ResumeLlmEducation[] = input.education.map((src) => {
    const row = eduById.get(src.id);
    if (!row) {
      report.restoredRows++;
      return { id: src.id, degree: src.degree };
    }
    let degree = clean(clip(row.degree, RESUME_LIMITS.fieldChars)) || src.degree;
    if (hasUnknownOrg(degree)) {
      report.revertedFields++;
      degree = src.degree;
    }
    return { id: src.id, degree };
  });

  /* ── 3 + 4: ko'nikmalar ── */
  const skills: ResumeLlmSkill[] = [];
  const seenSkill = new Set<string>();
  let aiSkills = 0;
  for (const s of Array.isArray(out.skills) ? out.skills : []) {
    const t = clip(s?.text, RESUME_LIMITS.skillChars);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seenSkill.has(key)) continue;
    if (s?.ai === true) {
      if (!opts.enrich || aiSkills >= AI_SKILLS_MAX) {
        report.droppedSkills++;
        continue;
      }
      aiSkills++;
    }
    seenSkill.add(key);
    skills.push(s?.ai === true ? { text: t, ai: true } : { text: t });
    if (skills.length >= RESUME_LIMITS.skills) break;
  }

  /* ── 6: qisqacha ── */
  const kept: string[] = [];
  for (const raw of sentences(clip(out.summary, RESUME_LIMITS.summaryChars))) {
    const badYear = (raw.match(/\b(?:19|20)\d{2}\b/g) ?? []).some((y) => !years.has(y));
    if (badYear || hasUnknownOrg(raw)) {
      report.droppedSentences++;
      continue;
    }
    kept.push(raw);
  }

  return {
    out: {
      summary: kept.join(" "),
      headline: clean(clip(out.headline, RESUME_LIMITS.headlineChars)),
      ...(out.labels ? { labels: out.labels } : {}),
      experience,
      education,
      skills,
    },
    report,
  };
}
