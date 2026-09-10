/**
 * Namuna rezyume — shablon galereyasi (`ResumeTemplateDialog`), testlar va
 * jonli sinov uchun. Haqiqiy odam emas.
 */
import { emptyResume, type ResumeModel } from "./model";
import { RESUME_TEMPLATES, type ResumePaletteId, type ResumeTemplateId } from "./templates";

export const SAMPLE_PHOTO_SQUARE = "/samples/resume-photo.jpg";
export const SAMPLE_PHOTO_CIRCLE = "/samples/resume-photo-circle.png";

export const SAMPLE_RESUME: ResumeModel = {
  ...emptyResume("uz"),
  identity: { fullName: "Karimova Dilnoza", headline: "Moliya tahlilchisi" },
  contact: { phone: "+998 90 123 45 67", email: "dilnoza.karimova@mail.uz", location: "Toshkent" },
  summary:
    "Moliya tahlili va byudjetlashtirish bo‘yicha 5 yillik tajribaga ega mutaxassis. Ishlab chiqarish va chakana savdo kompaniyalarida boshqaruv hisobotini yo‘lga qo‘ygan, xarajatlarni 12 % ga qisqartirishga erishgan. Excel, 1C va Power BI bilan ishlaydi.",
  experience: [
    {
      id: "e1",
      company: "Artel Electronics",
      role: "Yetakchi moliya tahlilchisi",
      start: "2022-03",
      end: "now",
      bullets: [
        { text: "Yillik byudjet modelini tuzdi va 14 ta bo‘lim uchun oylik ijro nazoratini yo‘lga qo‘ydi." },
        { text: "Xarajat tahlili asosida logistika sarfini 12 % ga qisqartirish rejasini amalga oshirdi." },
        { text: "Power BI dashboardlari orqali rahbariyat hisobotini 3 kundan 1 kunga qisqartirdi." },
      ],
    },
    {
      id: "e2",
      company: "Korzinka",
      role: "Moliya tahlilchisi",
      start: "2019-08",
      end: "2022-02",
      bullets: [
        { text: "35 ta do‘kon bo‘yicha rentabellik tahlili va haftalik hisobotlarni tayyorladi." },
        { text: "1C da boshqaruv hisobi bloklarini avtomatlashtirishda ishtirok etdi." },
        { text: "Yangi do‘konlar ochish bo‘yicha investitsiya modellarini hisobladi." },
      ],
    },
  ],
  education: [{ id: "d1", institution: "Toshkent davlat iqtisodiyot universiteti", degree: "Bakalavr, Moliya va kredit", start: "2015", end: "2019" }],
  certificates: [{ id: "c1", name: "ACCA F3 — Financial Accounting", issuer: "ACCA", year: "2021" }],
  languages: [
    { id: "l1", language: "O‘zbek", level: "ona tili" },
    { id: "l2", language: "Ingliz", level: "B2" },
    { id: "l3", language: "Rus", level: "C1" },
  ],
  skills: [
    { text: "Excel" },
    { text: "1C" },
    { text: "Power BI" },
    { text: "IFRS" },
    { text: "Byudjetlashtirish" },
    { text: "Moliyaviy modellashtirish" },
    { text: "SQL" },
    { text: "Taqdimot" },
  ],
  links: [{ id: "k1", kind: "linkedin", url: "https://linkedin.com/in/dilnoza-karimova" }],
  enriched: false,
};

/** Galereya kartasi uchun nusxa: shablon, palitra, surat bor/yo'q. */
export function sampleResume(template: ResumeTemplateId, palette?: ResumePaletteId, withPhoto = true): ResumeModel {
  const t = RESUME_TEMPLATES[template];
  const m: ResumeModel = { ...SAMPLE_RESUME, template, palette: palette ?? t.defaultPalette };
  if (withPhoto) {
    m.photo = { url: t.photo.shape === "circle" ? SAMPLE_PHOTO_CIRCLE : SAMPLE_PHOTO_SQUARE, shape: t.photo.shape, assetId: "" };
  } else {
    delete m.photo;
  }
  return m;
}
