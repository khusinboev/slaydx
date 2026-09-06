import { TOOL_BY_ID } from "../tools";
import { profileFor } from "./docx-profile";
import { docLabels } from "./i18n";
import type { AcademicDoc } from "./types";

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
      topic: string;
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

export function titleModel(doc: AcademicDoc): TitleModel {
  const { meta } = doc;
  const L = docLabels(meta.language);
  const year = new Date(Date.now()).getFullYear();
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

  const courseLine = [meta.course && L.course(meta.course), meta.group && L.group(meta.group)]
    .filter(Boolean)
    .join(", ");
  return {
    kind: "gost",
    labels: L,
    ministry: (meta.ministry === "maktab" ? L.ministrySchool : L.ministryHigher).split("\n"),
    university: meta.university,
    faculty: meta.faculty ? L.faculty(meta.faculty) : undefined,
    department: meta.department ? L.department(meta.department) : undefined,
    workLabel: meta.workLabel,
    topic: meta.topic,
    author: meta.author || undefined,
    authorLabel: TOOL_BY_ID[meta.toolId]?.group === "oqituvchi" ? L.compiledBy : L.doneBy,
    courseLine: courseLine || undefined,
    teacher: meta.teacher || undefined,
    subject: meta.subject || undefined,
    academicYear: L.academicYear(year, year + 1),
    cityYear,
  };
}
