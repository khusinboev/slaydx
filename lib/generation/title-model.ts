import { TOOL_BY_ID } from "../tools";
import { profileFor } from "./docx-profile";
import { docLabels } from "./i18n";
import type { AcademicDoc } from "./types";
import { workLangKey, type WorkLang } from "./work/labels";
import type { WorkModel } from "./work/types";

/**
 * Titul sahifasi modeli — DOCX va sayt uchun YAGONA manba.
 *
 * Ilgari `titleModel` faqat GOST talaba tituli qurar edi, `render-docx`
 * esa `profileFor(meta).titlePage` ga qarab IKKI xil titul chizardi
 * (`gost` va `article`). Natijada maqola foydalanuvchiga saytda
 * **talaba ishi** bo'lib ko'rinar, yuklab olinganida esa jurnal
 * maqolasi chiqardi (AUDIT-5 P0-2) — vazirlik sarlavhasi bilan
 * muallif bloki o'rtasida hech qanday umumiylik yo'q.
 *
 * Endi tur profil bilan belgilanadi va ikkala renderer ham AYNAN shu
 * modelni chizadi — `tocRows` va `planSlide` bilan bir xil naqsh:
 * koordinatani bitta funksiya beradi, chizuvchilar faqat chizadi.
 */
export type TitleModel =
  | {
      kind: "gost";
      labels: ReturnType<typeof docLabels>;
      ministry: string[];
      university: string;
      faculty?: string;
      department?: string;
      workLabel: string;
      /**
       * «"Ma'lumotlar bazasi" fanidan» — TALABA ISHI tituli (AUDIT-19):
       * fan nomi ish turidan (KURS ISHI) OLDINGI qatorda turadi. Eski
       * hujjatlarda yo'q (`undefined`) — u yerda fan «Fan: …» qatorida.
       */
      subjectLine?: string;
      topic: string;
      /** «Mavzu:» — mavzu qatorining yorlig'i (talaba ishi); yo'q bo'lsa faqat «…» chiziladi. */
      topicLabel?: string;
      author?: string;
      /**
       * Muallif qatorining yorlig'i — janrga qarab.
       *
       * «Bajardi» talaba tili; o'qituvchi dars ishlanmasini TUZADI.
       * Yorliq modelda hisoblanadi, chizuvchida emas — aks holda DOCX
       * va sayt uni mustaqil tanlar va ajralib ketardi.
       */
      authorLabel: string;
      courseLine?: string;
      teacher?: string;
      /**
       * O'qituvchi qatorining yorlig'i. Eski hujjatlarda «Ilmiy rahbar»
       * (`labels.supervisor`); talaba ishida «Tekshirdi» — uslubiy
       * ko'rsatmalar aynan shu so'zni talab qiladi.
       */
      teacherLabel: string;
      subject?: string;
      academicYear: string;
      cityYear: string;
    }
  | {
      kind: "article";
      labels: ReturnType<typeof docLabels>;
      workLabel: string;
      topic: string;
      /** Muallif + ilmiy daraja bitta qatorda («Aliyev A., PhD»). */
      authorLine?: string;
      organization?: string;
      email?: string;
      cityYear: string;
    };

/**
 * Ma'nosiz o'rinbosar universitet nomini tashlaydi.
 *
 * Ilgari bu shart FAQAT `render-docx.ts` da turardi — sayt ko'ruvchisi
 * `«Oliy ta'lim muassasasi»` ni baribir chizardi. Endi model bitta
 * qaror qiladi va ikkala renderer ham unga ergashadi.
 */
function cleanUniversity(raw: string): string {
  const t = (raw || "").trim();
  return /^oliy ta[’'`]lim muassasasi$/i.test(t) ? "" : t;
}

/* ────────────────────────── talaba ishi tituli (AUDIT-19) ────────────────────────── */

/**
 * Talaba ishi titulining O'Z yorliqlari. Ular `i18n.ts docLabels` da YO'Q
 * va ataylab shu yerda: «Tekshirdi» (`supervisor` = «Ilmiy rahbar» emas),
 * «Mavzu:» va «"FAN" fanidan» — uchalasi ham FAQAT titulga tegishli va
 * uchalasini ham DOCX bilan ko'ruvchi bitta manbadan o'qishi kerak.
 */
const WORK_TITLE_WORDS: Record<WorkLang, { checkedBy: string; topic: string; subjectLine: (s: string) => string }> = {
  uz: { checkedBy: "Tekshirdi", topic: "Mavzu:", subjectLine: (s) => `«${s}» fanidan` },
  ru: { checkedBy: "Проверил", topic: "Тема:", subjectLine: (s) => `по предмету «${s}»` },
  en: { checkedBy: "Checked by", topic: "Topic:", subjectLine: (s) => `in the subject «${s}»` },
};

/**
 * Vazirlik qatorlari. `oliy`/`maktab` — `i18n.ts` dagi rasmiy matn
 * (2022 dan «Oliy ta'lim, fan va innovatsiyalar»), `custom` — foydalanuvchi
 * matni: TATU da ikkinchi vazirlik qatori ham bo'ladi, shuning uchun
 * `\n` bo'yicha ikkitagacha qatorga bo'linadi.
 */
export function workMinistryLines(model: WorkModel, L: ReturnType<typeof docLabels>): string[] {
  if (model.ministry === "custom") {
    const lines = (model.ministryCustom ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2);
    // Bo'sh «o'z matnim» — rasmiy qatorga qaytamiz, titul boshsiz qolmasin.
    if (lines.length) return lines;
  }
  return (model.ministry === "maktab" ? L.ministrySchool : L.ministryHigher).split("\n");
}

export function titleModel(doc: AcademicDoc): TitleModel {
  const { meta } = doc;
  const L = docLabels(meta.language);
  // Yil hujjat bilan birga muzlaydi (`extractMeta`). Eski `doc_json` da
  // `meta.year` bo'lmasligi mumkin — bunday holatda render vaqti yiliga
  // qaytamiz (avvalgi xatti-harakat, ya'ni regressiya emas).
  const year = meta.year || new Date(Date.now()).getFullYear();
  const cityYear = `${meta.city || "Toshkent"} — ${year}`;

  if (profileFor(meta).titlePage === "article") {
    const authorLine = [meta.author, meta.degree].filter(Boolean).join(", ");
    return {
      kind: "article",
      labels: L,
      workLabel: meta.workLabel,
      topic: meta.topic,
      authorLine: authorLine || undefined,
      organization: meta.organization || undefined,
      email: meta.email || undefined,
      cityYear,
    };
  }

  /*
   * TALABA ISHI 2 (AUDIT-19): titul maydonlari `doc.work` MODELIDAN
   * o'qiladi, `meta` dan emas. Sabab — vazirlikning uchinchi qiymati
   * («o'z matnim»), o'qituvchi darajasi va guruh raqami faqat modelda
   * bor; `meta.ministry` esa ikki qiymatli. Eski hujjat (`doc.work`
   * yo'q) quyidagi umumiy yo'lda o'zgarishsiz qoladi.
   */
  const work = doc.work;
  if (work) {
    const W = WORK_TITLE_WORDS[workLangKey(work.language || meta.language)];
    const author = [work.group && L.group(work.group), work.author].map((x) => (x || "").trim()).filter(Boolean).join(", ");
    const teacher = [work.teacherDegree, work.teacher].map((x) => (x || "").trim()).filter(Boolean).join(" ");
    const subjectName = (work.subjectName || meta.subject || "").trim();
    return {
      kind: "gost",
      labels: L,
      ministry: workMinistryLines(work, L),
      university: cleanUniversity(work.university || meta.university),
      faculty: work.faculty ? L.faculty(work.faculty) : undefined,
      department: work.department ? L.department(work.department) : undefined,
      ...(subjectName ? { subjectLine: W.subjectLine(subjectName) } : {}),
      workLabel: meta.workLabel,
      topic: work.title || meta.topic,
      topicLabel: W.topic,
      author: author || undefined,
      authorLabel: L.doneBy,
      // Kurs va guruh muallif qatorida — takror qator chizilmaydi.
      courseLine: work.course ? L.course(work.course) : undefined,
      teacher: teacher || undefined,
      teacherLabel: W.checkedBy,
      // Fan nomi «"FAN" fanidan» qatorida — «Fan: …» takrorlanmaydi.
      subject: undefined,
      academicYear: L.academicYear(year, year + 1),
      cityYear,
    };
  }

  const courseLine = [meta.course && L.course(meta.course), meta.group && L.group(meta.group)]
    .filter(Boolean)
    .join(", ");
  return {
    kind: "gost",
    labels: L,
    ministry: (meta.ministry === "maktab" ? L.ministrySchool : L.ministryHigher).split("\n"),
    university: cleanUniversity(meta.university),
    faculty: meta.faculty ? L.faculty(meta.faculty) : undefined,
    department: meta.department ? L.department(meta.department) : undefined,
    workLabel: meta.workLabel,
    topic: meta.topic,
    author: meta.author || undefined,
    authorLabel: TOOL_BY_ID[meta.toolId]?.group === "oqituvchi" ? L.compiledBy : L.doneBy,
    courseLine: courseLine || undefined,
    teacher: meta.teacher || undefined,
    teacherLabel: L.supervisor,
    subject: meta.subject || undefined,
    academicYear: L.academicYear(year, year + 1),
    cityYear,
  };
}
