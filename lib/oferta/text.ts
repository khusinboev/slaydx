/**
 * The public offer (oferta) text, version 1 -- the ONE source for the web page (`app/oferta`), the PDF
 * (`lib/server/oferta-pdf.ts`), the client modal summary and the bot. Copied from the owner-approved
 * draft `docs/program-17/oferta-draft.uz.md` (2026-10-22). Changing the wording means bumping the
 * setting `oferta.version` so every user is asked again.
 *
 * Two spots depend on the Ijrochi requisites (setting `oferta.requisites`): the Ijrochi name in 1.1
 * (`{{IJROCHI}}`) and the whole of section 9 (`{{REQUISITES}}`). `renderOferta` fills them; no
 * placeholder may reach a reader. `**bold**` marks bold runs (see `runsOf`).
 */

export const OFERTA_TITLE = "SlaydX xizmatlaridan foydalanish bo'yicha OMMAVIY OFERTA";

/** Edition date of the text (the day the owner approved it). */
export const OFERTA_EDITION_DATE = "22.10.2026";

/** Used where the requisites are not entered yet (the gate cannot be enabled in that state). */
export const OFERTA_NO_REQUISITES = "Rekvizitlar tez orada e'lon qilinadi.";
export const OFERTA_NO_NAME = "SlaydX xizmati Ijrochisi";

export type OfertaClause = { no: string; text: string };
export type OfertaSection = { heading: string; clauses: OfertaClause[] };

const SECTIONS: readonly OfertaSection[] = [
  {
    heading: "1. Umumiy qoidalar",
    clauses: [
      { no: "1.1.", text: "Ushbu hujjat {{IJROCHI}} (bundan keyin — «Ijrochi») tomonidan SlaydX xizmatlari (sayt slaydxx.uz, Telegram bot va Mini App; bundan keyin — «Xizmat») bilan foydalanish shartlarini belgilovchi ommaviy ofertadir (O'zbekiston Respublikasi Fuqarolik kodeksi 367–369-moddalari)." },
      { no: "1.2.", text: "Foydalanuvchi «Qabul qilaman» tugmasini bosishi, Xizmatda ro'yxatdan o'tishi yoki hisobini to'ldirishi ofertaning to'liq va so'zsiz aksepti hisoblanadi." },
      { no: "1.3.", text: "Ijrochi ofertani o'zgartirishi mumkin; yangi tahrir Xizmatda e'lon qilingan paytdan kuchga kiradi. Yangi tahrir Xizmatdan keyingi foydalanishdan oldin qayta qabul qilish uchun ko'rsatiladi." },
    ],
  },
  {
    heading: "2. Xizmat mazmuni",
    clauses: [
      { no: "2.1.", text: "Xizmat sun'iy intellekt (AI) yordamida hujjat, taqdimot, rasm, audio, video, test va boshqa materiallarni yaratish, fayllarni konvertatsiya qilish, matnni alifbolar orasida o'girish, AI chat va boshqa raqamli xizmatlarni ko'rsatadi." },
      { no: "2.2.", text: "Har bir pullik xizmat narxi ishga tushirishdan oldin Xizmat ichida ko'rsatiladi. Ijrochi narxlarni oldindan e'lon qilib o'zgartirishi mumkin; allaqachon boshlangan buyurtma narxi o'zgarmaydi." },
      { no: "2.3.", text: "AI natijalari avtomatik yaratiladi va xatolar, noaniqliklar bo'lishi mumkin. Foydalanuvchi natijani o'zi tekshiradi va undan foydalanish (jumladan o'quv, ilmiy va rasmiy maqsadlarda) uchun o'zi javobgar." },
    ],
  },
  {
    heading: "3. Hisob, to'lov va qaytarish",
    clauses: [
      { no: "3.1.", text: "Foydalanuvchi hisobini Xizmatda ko'rsatilgan to'lov tizimlari (Click, Paynet va boshqalar) orqali so'mda to'ldiradi; hisobdagi mablag' faqat Xizmat ichida xizmatlar uchun sarflanadi." },
      { no: "3.2.", text: "**Hisobga to'langan mablag' naqd pulga almashtirilmaydi va foydalanuvchiga qaytarilmaydi**, shu jumladan foydalanuvchi Xizmatdan foydalanishni to'xtatgan yoki hisobini o'chirgan holda ham." },
      { no: "3.3.", text: "Texnik nosozlik tufayli buyurtma bajarilmasa yoki va'da qilinganidan kam bajarilsa, tegishli summa avtomatik ravishda foydalanuvchining Xizmatdagi hisobiga qaytariladi (pul ko'rinishida emas)." },
      { no: "3.4.", text: "Bonus so'm (ro'yxatdan o'tish, do'st taklifi, baholash, kunlik savollar, to'lov bonusi va boshqa aksiyalar) — Ijrochining rag'batlantirish vositasi: u naqdlashtirilmaydi, boshqa foydalanuvchiga o'tkazilmaydi, ayrim xizmatlarga (masalan video generatsiya) ishlatilmasligi va Ijrochi tomonidan limit qo'yilishi mumkin. Bonuslarni suiiste'mol qilish (soxta akkauntlar, avtomatlashtirish) aniqlansa, Ijrochi bonuslarni bekor qilish va hisobni bloklash huquqiga ega." },
      { no: "3.5.", text: "Fiskal chek to'lov tizimi tomonidan beriladi." },
    ],
  },
  {
    heading: "4. Taklif dasturi va elchilar",
    clauses: [
      { no: "4.1.", text: "Foydalanuvchi o'z taklif havolasi/promokodi orqali kelgan yangi foydalanuvchilar uchun Xizmatda e'lon qilingan miqdorda bonus oladi." },
      { no: "4.2.", text: "Elchi o'zi taklif qilgan foydalanuvchilarning har bir to'lovidan Xizmatda e'lon qilingan foizni bonus so'm sifatida oladi. Bu bonus naqd pulga yechilmaydi. Ijrochi foiz va shartlarni oldindan e'lon qilib o'zgartirishi mumkin." },
      { no: "4.3.", text: "Spam, aldov yo'li bilan yoki o'zini o'zi taklif qilish orqali olingan bonuslar bekor qilinadi." },
    ],
  },
  {
    heading: "5. Foydalanuvchi majburiyatlari",
    clauses: [
      { no: "5.1.", text: "Xizmatdan qonunga zid, boshqalarning huquqlarini (mualliflik huquqi, shaxsiy hayot daxlsizligi, sha'n va qadr-qimmat) buzuvchi, haqoratli yoki zararli material yaratish uchun foydalanmaslik." },
      { no: "5.2.", text: "Boshqa shaxsning suratini (masalan portret xizmatida) faqat uning roziligi bilan yuklash." },
      { no: "5.3.", text: "Hisobga kirish ma'lumotlarini boshqalarga bermaslik." },
    ],
  },
  {
    heading: "6. Shaxsiy ma'lumotlar",
    clauses: [
      { no: "6.1.", text: "Ijrochi Xizmat ko'rsatish uchun zarur ma'lumotlarni qayta ishlaydi: Telegram identifikatori, ism, telefon raqami, to'lov tarixi, foydalanuvchi yuklagan fayllar, matnlar, **suratlar (selfi) va ovozli xabarlar**, qoldirilgan fikr va baholar." },
      { no: "6.2.", text: "Suratlar va ovozli xabarlar faqat so'ralgan xizmatni bajarish uchun AI provayderlariga (masalan Google, OpenAI, ElevenLabs va boshqalar) uzatiladi va boshqa maqsadda ishlatilmaydi." },
      { no: "6.3.", text: "Foydalanuvchi qoldirgan fikr va baho Xizmat sahifalarida ismi qisqartirilgan holda e'lon qilinishi mumkin." },
      { no: "6.4.", text: "Ma'lumotlar «Shaxsga doir ma'lumotlar to'g'risida»gi Qonun talablariga muvofiq saqlanadi; foydalanuvchi qo'llab-quvvatlash orqali o'z ma'lumotlarini o'chirishni so'rashi mumkin (bu 3.2-bandga ta'sir qilmaydi)." },
    ],
  },
  {
    heading: "7. Javobgarlik",
    clauses: [
      { no: "7.1.", text: "Ijrochi Xizmat uzluksiz ishlashi uchun oqilona choralar ko'radi, ammo uchinchi tomon (AI provayderlari, Telegram, to'lov tizimlari) nosozliklari uchun javob bermaydi." },
      { no: "7.2.", text: "Ijrochining javobgarligi har qanday holatda foydalanuvchining tegishli buyurtma uchun to'lagan summasi bilan cheklanadi va faqat Xizmatdagi hisobga qaytarish shaklida amalga oshiriladi." },
    ],
  },
  {
    heading: "8. Nizolar va aloqa",
    clauses: [
      { no: "8.1.", text: "Savol va murojaatlar: qo'llab-quvvatlash guruhi https://t.me/SlaydX_support." },
      { no: "8.2.", text: "Nizolar muzokara yo'li bilan, kelishilmasa — O'zbekiston Respublikasi qonunchiligiga muvofiq hal qilinadi." },
    ],
  },
  {
    heading: "9. Rekvizitlar",
    clauses: [
      { no: "", text: "{{REQUISITES}}" },
    ],
  },
];

/** Marker of a clause that is replaced by the requisites lines. */
const REQUISITES_MARK = "{{REQUISITES}}";
const IJROCHI_MARK = "{{IJROCHI}}";

/** Normalises the stored requisites to non-empty trimmed lines. */
export function requisiteLines(requisites: string): string[] {
  return requisites
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export type OfertaView = {
  title: string;
  /** Version shown in the footer (the setting `oferta.version`). */
  version: number;
  editionDate: string;
  sections: Array<{ heading: string; clauses: OfertaClause[] }>;
  /** Ijrochi name (first requisites line) or the neutral fallback. */
  ijrochi: string;
  /** Section 9 lines. */
  requisites: string[];
};

/**
 * The offer as shown to users: placeholders filled from `requisites` (first line = Ijrochi name).
 * Section 9's single marker clause expands to one clause per requisites line.
 */
export function renderOferta(requisites: string, version: number): OfertaView {
  const lines = requisiteLines(requisites);
  const ijrochi = lines[0] ?? OFERTA_NO_NAME;
  const sections = SECTIONS.map((s) => ({
    heading: s.heading,
    clauses: s.clauses.flatMap((c): OfertaClause[] => {
      if (c.text === REQUISITES_MARK) {
        return (lines.length ? lines : [OFERTA_NO_REQUISITES]).map((text) => ({ no: "", text: escapeMarkup(text) }));
      }
      // A replacer function: an admin-entered name containing `$&` must not be read as a replacement pattern.
      return [{ no: c.no, text: c.text.replaceAll(IJROCHI_MARK, () => escapeMarkup(ijrochi)) }];
    }),
  }));
  return { title: OFERTA_TITLE, version, editionDate: OFERTA_EDITION_DATE, sections, ijrochi, requisites: lines };
}

/** Admin-entered text (requisites) must render literally: its `**` becomes the escape `\*\*`. */
export function escapeMarkup(text: string): string {
  return text.replaceAll("**", "\\*\\*");
}

/** Splits `**bold**` markup into runs; the escape `\*\*` is a literal `**`. */
export function runsOf(text: string): Array<{ text: string; bold: boolean }> {
  const out: Array<{ text: string; bold: boolean }> = [];
  let bold = false;
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, bold });
    buf = "";
  };
  for (const tok of text.split(/(\\\*\\\*|\*\*)/)) {
    if (tok === "**") {
      flush();
      bold = !bold;
    } else if (tok === "\\*\\*") buf += "**";
    else buf += tok;
  }
  flush();
  return out;
}

/** The offer as plain text (no markup) -- used by tests and the bot caption fallback. */
export function ofertaPlainText(view: OfertaView): string {
  const body = view.sections.map((s) => [s.heading, ...s.clauses.map((c) => `${c.no ? c.no + " " : ""}${runsOf(c.text).map((r) => r.text).join("")}`)].join("\n"));
  return [view.title, ...body, `Tahrir: v${view.version} · ${view.editionDate}`].join("\n\n");
}

/** A placeholder must never reach a reader. */
export function hasPlaceholder(text: string): boolean {
  return /[⟦⟧]|\{\{[A-Z]+\}\}/.test(text);
}

/** Short summary shown in the acceptance modal / bot caption. */
export const OFERTA_SUMMARY: readonly string[] = [
  "Hisobga to'langan mablag' qaytarilmaydi (texnik nosozlikda summa hisobingizga qaytariladi).",
  "Bonus so'm naqdlashtirilmaydi va faqat Xizmat ichida ishlatiladi.",
  "AI natijalarini ishlatishdan oldin o'zingiz tekshirasiz.",
  "Surat va ovozli xabarlar faqat so'ralgan xizmat uchun AI provayderlariga uzatiladi.",
];
