/**
 * REZYUME PARAMETRLARI REYESTRI — yagona manba (Rezyume 2, AUDIT-15).
 *
 * `slide-params.ts` bilan bir xil shartnoma va bir xil sabab: **bezak
 * maydon yo'q**. Har parametr shu yerda `impacts` bilan e'lon qilinadi,
 * `tests/resume-params.test.mts` esa har biri uchun differensial zond
 * o'tkazadi — e'lon qilingan chiqishda A va B farq qilmasa test qizil.
 *
 * Slayddan bitta farq bor: `price` TA'SIRI YO'Q va bo'lmasligi kerak.
 * Rezyume narxi TEKIS — 3 000 tanga (`lib/tools.ts` `basePrice`), ya'ni
 * shablon, boyitish yoki surat qo'shish qimmatlashtirmaydi. Test buni
 * TESKARI kafolat sifatida qulflaydi: har parametr uchun
 * `priceFor(resume, probeA) === priceFor(resume, probeB) === 3000`.
 *
 * Yangi maydon qo'shish tartibi: avval shu yerga qator, keyin `DocMeta`
 * yoki `ResumeInput`, keyin ta'sir nuqtasi, keyin forma.
 */
import type { FormValues } from "../types";
import { TRANSLATION_LANGUAGES } from "../tools";
import { RESUME_TEMPLATE_IDS, RESUME_PALETTE_IDS } from "./resume/templates";

/**
 * Rezyume chiqish tili — 18 ta (B-4).
 *
 * Hujjat SKELETI uch tilda («Kirish/Xulosa») bo'lgani uchun akademik
 * vositalar `TARGET_LANGUAGES` bilan chegaralangan. Rezyumeda esa
 * skelet yo'q: bo'lim sarlavhalari `ResumeModel.labels` da, ular uz/ru/en
 * da koddan, qolgan tillarda MODELDAN keladi (`write.ts` 7-qoida).
 * Shuning uchun bu yerda tarjimon ro'yxati (`TRANSLATION_LANGUAGES`)
 * to'liq ishlaydi.
 */
export function isResumeLanguage(v: unknown): boolean {
  return typeof v === "string" && TRANSLATION_LANGUAGES.some((l) => l.value === v);
}

export type ResumeParamImpact =
  /** Tizim yoki foydalanuvchi prompti matni. */
  | "prompt"
  /** `planResume(draftModel(...))` — zonalar, itemlar, kengliklar. */
  | "layout"
  /** Shablon/palitra tanlovi. */
  | "template"
  /** Model suratining mavjudligi/kesimi. */
  | "photo"
  /** `meta.language` va model tili. */
  | "language"
  /** Model javobiga qo'llanadigan qoidalar (`guardResume`). */
  | "model";

export type ResumeParam = {
  id: string;
  /** `FormValues` massiv qabul qilmaydi: ro'yxat — `csv`, obyekt — `json`. */
  encode: "string" | "boolean" | "csv" | "json";
  /** Differensial zond uchun ikki xil qiymat. */
  probeA: FormValues[string];
  probeB: FormValues[string];
  /** Shu chiqishlarda A va B farq qilishi SHART. */
  impacts: ResumeParamImpact[];
  /** Zond boshqa parametrni ham talab qilsa (masalan `photoCrop` — surat bo'lishi). */
  probeWith?: FormValues;
};

const EXP_A = JSON.stringify([
  { id: "e1", company: "Artel Electronics", role: "Moliya tahlilchisi", start: "2019-08", end: "now", bullets: ["Byudjet modelini tuzdi."] },
]);
const EXP_B = JSON.stringify([
  { id: "e1", company: "Korzinka", role: "Yetakchi tahlilchi", start: "2021-01", end: "now", bullets: ["Rentabellik tahlilini yo‘lga qo‘ydi."] },
  { id: "e2", company: "Artel Electronics", role: "Tahlilchi", start: "2018-02", end: "2020-12", bullets: ["Oylik hisobotni avtomatlashtirdi."] },
]);
/*
 * Ta'lim zondi AUDIT-16 shaklida: `kind` + `field` + daraja ID si.
 * B da tur ham boshqa (kollej) — tur maketga daraja YORLIG'I orqali
 * ta'sir qiladi, ya'ni zond turni ham sinaydi.
 */
const EDU_A = JSON.stringify([
  { id: "d1", kind: "university", institution: "TDIU", field: "Moliya", degree: "bakalavr", start: "2015", end: "2019" },
]);
const EDU_B = JSON.stringify([
  { id: "d1", kind: "university", institution: "TDIU", field: "Moliya", degree: "magistr", start: "2019", end: "2021" },
  { id: "d2", kind: "college", institution: "Toshkent moliya kolleji", field: "Buxgalteriya hisobi", degree: "kichik-mutaxassis", start: "2015", end: "2019" },
]);
const CERT_A = JSON.stringify([{ id: "c1", name: "ACCA F3", issuer: "ACCA", year: "2021" }]);
const CERT_B = JSON.stringify([
  { id: "c1", name: "ACCA F3", issuer: "ACCA", year: "2021" },
  { id: "c2", name: "CIMA Cert BA", issuer: "CIMA", year: "2022" },
]);
const LANG_A = JSON.stringify([{ id: "l1", language: "Ingliz", level: "B2" }]);
const LANG_B = JSON.stringify([
  { id: "l1", language: "Ingliz", level: "C1" },
  { id: "l2", language: "Rus", level: "C1" },
]);
const LINK_A = JSON.stringify([{ id: "k1", kind: "linkedin", url: "https://linkedin.com/in/a" }]);
const LINK_B = JSON.stringify([
  { id: "k1", kind: "github", url: "https://github.com/b" },
  { id: "k2", kind: "portfolio", url: "https://b.uz" },
]);

export const RESUME_PARAMS: ResumeParam[] = [
  { id: "fullName", encode: "string", probeA: "Karimova Dilnoza", probeB: "Aliyev Ali", impacts: ["prompt", "layout"] },
  { id: "phone", encode: "string", probeA: "+998 90 123 45 67", probeB: "+998 71 200 00 00", impacts: ["prompt", "layout"] },
  { id: "email", encode: "string", probeA: "a@mail.uz", probeB: "b@mail.uz", impacts: ["prompt", "layout"] },
  { id: "location", encode: "string", probeA: "Toshkent", probeB: "Samarqand", impacts: ["prompt", "layout"] },
  // Surat aktivi: worker uni `data:` URL ga aylantiradi; zond uchun mavjudligi yetarli.
  { id: "photoAssetId", encode: "string", probeA: "", probeB: "0123456789abcdef01234567", impacts: ["photo", "layout"] },
  {
    id: "photoCrop",
    encode: "json",
    probeA: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
    probeB: JSON.stringify({ x: 12, y: -8, zoom: 1.6 }),
    impacts: ["photo"],
    // Kesim faqat surat bo'lganda ko'rinadi.
    probeWith: { photoAssetId: "0123456789abcdef01234567" },
  },
  { id: "targetRole", encode: "string", probeA: "Moliya tahlilchisi", probeB: "Backend dasturchi", impacts: ["prompt", "layout"] },
  { id: "language", encode: "string", probeA: "uz", probeB: "de", impacts: ["language", "prompt", "layout"] },
  { id: "resumeTemplate", encode: "string", probeA: "modern", probeB: "classic", impacts: ["template", "layout"] },
  { id: "resumePalette", encode: "string", probeA: "ember", probeB: "ocean", impacts: ["template", "layout"] },
  { id: "enrich", encode: "boolean", probeA: true, probeB: false, impacts: ["prompt", "model"] },
  { id: "about", encode: "string", probeA: "", probeB: "Byudjetlashtirish bo‘yicha besh yillik tajriba.", impacts: ["prompt", "layout"] },
  { id: "experience", encode: "json", probeA: EXP_A, probeB: EXP_B, impacts: ["prompt", "layout"] },
  { id: "education", encode: "json", probeA: EDU_A, probeB: EDU_B, impacts: ["prompt", "layout"] },
  { id: "certificates", encode: "json", probeA: CERT_A, probeB: CERT_B, impacts: ["prompt", "layout"] },
  { id: "languages", encode: "json", probeA: LANG_A, probeB: LANG_B, impacts: ["prompt", "layout"] },
  { id: "skills", encode: "csv", probeA: "Excel,SQL", probeB: "Power BI,IFRS,1C", impacts: ["prompt", "layout"] },
  { id: "links", encode: "json", probeA: LINK_A, probeB: LINK_B, impacts: ["prompt", "layout"] },
  { id: "tone", encode: "string", probeA: "professional", probeB: "qisqa", impacts: ["prompt"] },
  { id: "extra", encode: "string", probeA: "", probeB: "diplomni birinchi qatorga chiqaring", impacts: ["prompt"] },
];

/**
 * Forma AYNAN shu maydonlarni chizadi.
 *
 * «Reyestrda bor, formada yo'q» va aksi — qamrov testi bilan ushlanadi
 * (lead tomonda, `ResumeWizard` bilan birga).
 */
export const RESUME_FORM_FIELDS: string[] = RESUME_PARAMS.map((p) => p.id);

/** Formadagi tanlovlar — komponent va test bitta ro'yxatdan o'qisin. */
export const RESUME_TEMPLATE_CHOICES = RESUME_TEMPLATE_IDS;
export const RESUME_PALETTE_CHOICES = RESUME_PALETTE_IDS;
