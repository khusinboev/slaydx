import type { AcademicDoc, Block, DocSection } from "./types";

/**
 * Bir A4 betdagi real so'z soni.
 *
 * Times New Roman 14 pt, 1.5 interval, hoshiya 3 + 1.5 sm va 1.25 sm abzas
 * sharoitida amalda ~230 so'z chiqadi. Ilgari bu yerda 280 turardi —
 * natijada dvigatel o'z hajm hisobida ~22% shishirar va «20 bet» deb
 * va'da qilingan ish Word'da 15 bet bo'lib ochilardi.
 *
 * Bu konstanta YAGONA manba: `scale.ts` ham shu yerdan oladi.
 */
export const WORDS_PER_PAGE = 230;

export function cleanText(s: string): string {
  let t = String(s ?? "");
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/&amp;/gi, "&")
      .replace(/&apos;|&#39;|&lsquo;|&rsquo;/gi, "‘")
      .replace(/&quot;|&ldquo;|&rdquo;/gi, "\"")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&nbsp;/gi, " ");
  }
  return t
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function wordCount(doc: AcademicDoc): number {
  let n = 0;
  for (const s of doc.sections) {
    n += countWords(s.title);
    for (const b of s.blocks) n += countWords(b.text);
  }
  for (const r of doc.references ?? []) n += countWords(r);
  for (const a of doc.abstracts ?? []) n += countWords(a.text);
  for (const t of doc.tables ?? []) {
    n += countWords(t.caption || "");
    for (const h of t.headers) n += countWords(h);
    for (const row of t.rows) for (const c of row) n += countWords(c);
  }
  return n;
}

export function targetWords(pages: number): number {
  return Math.max(220, Math.round(Math.max(1, pages) * WORDS_PER_PAGE));
}

const UNVERIFIED_NOTE: Record<string, string> = {
  uz: "Ro‘yxatni AI tuzgan va u TEKSHIRILMAGAN: muallif, nashriyot yoki yil noto‘g‘ri bo‘lishi mumkin. Har bir manbani kutubxona katalogidan tasdiqlang va ilmiy rahbaringiz bilan kelishing.",
  ru: "Список составлен ИИ и НЕ ПРОВЕРЕН: автор, издательство или год могут быть неточными. Подтвердите каждый источник по каталогу библиотеки и согласуйте с научным руководителем.",
  en: "This list was drafted by AI and is NOT VERIFIED: author, publisher or year may be inaccurate. Confirm each source in a library catalogue and agree it with your supervisor.",
};

/**
 * Model bergan adabiyotlar uchun ogohlantirish.
 *
 * Jonli sinov ko‘rsatdi: model ishonarli ko‘rinadigan ro‘yxat yozadi —
 * haqiqiy nashriyot nomlari, mantiqiy yillar. Lekin ularning to‘g‘riligini
 * biz tekshira olmaymiz va LLM tafsilotlarni (yil, hammuallif, nashriyot)
 * muntazam adashtiradi. Ro‘yxatni yashirish foydalanuvchiga yordam
 * bermaydi — uni BELGILASH kerak: hujjatda ogohlantirish qoladi.
 */
export function unverifiedReferenceNote(language = "uz"): string {
  return UNVERIFIED_NOTE[(language || "uz").slice(0, 2).toLowerCase()] ?? UNVERIFIED_NOTE.uz;
}

const REF_NOTE: Record<string, string> = {
  uz: "Bu ro‘yxat tasdiqlanmagan. Quyidagi so‘rovlar bo‘yicha manbani o‘zingiz toping va ilmiy rahbaringiz bilan aniqlashtiring.",
  ru: "Этот список не подтверждён. Найдите источники по приведённым запросам и уточните их с научным руководителем.",
  en: "This list is not verified. Find the sources using the queries below and confirm them with your supervisor.",
};

/**
 * Model ishonchli adabiyot bera olmaganda nima yoziladi.
 *
 * Ilgari bu holatda qattiq yozilgan «O‘quv qo‘llanma. – Toshkent: O‘qituvchi.»
 * kabi to‘rt qator qo‘yilardi: format haqiqiy manbaga o‘xshardi, lekin
 * muallif ham, nashriyot ham, yil ham uydirma edi. O‘qituvchi tekshirsa
 * bu akademik halollik masalasiga aylanadi. Endi uydirma o‘rniga
 * foydalanuvchiga qidiruv so‘rovlari beriladi.
 */
export function referenceSearchPlan(
  topic: string,
  subject = "",
  language = "uz",
): { note: string; queries: string[] } {
  const t = topic.replace(/\s+/g, " ").trim();
  const s = subject.replace(/\s+/g, " ").trim();
  const base = s && s.toLowerCase() !== t.toLowerCase() ? `${t} ${s}` : t;
  return {
    note: REF_NOTE[(language || "uz").slice(0, 2).toLowerCase()] ?? REF_NOTE.uz,
    queries: [
      `${base} o‘quv qo‘llanma site:edu.uz`,
      `${base} darslik pdf`,
      `${base} ma’ruza matnlari`,
      `${base} review article scholar.google.com`,
      `${base} monografiya`,
    ],
  };
}

export function remainingMs(deadline?: number): number {
  if (!deadline) return 90_000;
  return Math.max(0, deadline - Date.now());
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      ret[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
  return ret;
}

/** Shablon matnining o'ziga xos, boshqa hech qayerda uchramaydigan iboralari. */
const GENERIC_RE = [
  /tizimli o[‘'`]rganishni talab qiladigan mavzu/i,
  /alohida fakt emas, balki bog[‘'`]liq tushunchalar/i,
  /tajriba bandi to[‘'`]ldirilmagan/i,
  /tarjima matni topilmadi/i,
  /soha nazariyasi asoslari/i,
  /umumiy nazariy asoslar/i,
];

/**
 * Faqat QISQA matnda (jadval katagi, natija ustuni) shablon hisoblanadigan
 * iboralar.
 *
 * Nega alohida: «tushuncha shakllanadi» texnologik xaritadagi bo'sh
 * natija katagi sifatida shablon, lekin jonli nasrda mutlaqo o'rinli.
 * Jonli sinovda insho «uning qalbida bir tushuncha shakllanadi» deb
 * boshlangan edi va butun paragraf shablon deb tashlanardi.
 */
const GENERIC_SHORT_RE = [
  /tushuncha shakllanadi/i,
  /ko[‘'`]nikma mustahkamlanadi/i,
  /mustaqil ishlay oladi/i,
];

/** Qisqa matn chegarasi — jadval katagi shu atrofda bo'ladi. */
const SHORT_TEXT = 70;

export function isGenericFiller(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (GENERIC_RE.some((re) => re.test(t))) return true;
  return t.length <= SHORT_TEXT && GENERIC_SHORT_RE.some((re) => re.test(t));
}

const GENERIC_GLOSSARY = /^(mezon|metod|kompetensiya|tahlil|sintez|innovatsiya|refleksiya|differensiatsiya|integratsiya|indikator|resurs)$/i;

export function isGenericGlossaryTerm(term: string): boolean {
  const t = term.replace(/^[^:]+:\s*/, "").trim();
  return GENERIC_GLOSSARY.test(t);
}

export function parseParagraphs(raw: string): string[] {
  const chunks = raw
    .replace(/\r/g, "")
    .split(/\n{2,}|\n(?=(?:\d+\.|[-*•])\s)/)
    .map((s) =>
      cleanText(
        s.replace(/^\s*(?:#{1,4}\s+|\d+[\).]\s+|[-*•]\s+)/gm, ""),
      ),
    )
    .filter(
      (s) =>
        s.length > 40 &&
        !/^(kirish|xulosa|bob|mundarija|introduction|conclusion|глава)/i.test(s) &&
        !/berilgan talablar asosida|tayyorlangan insho/i.test(s),
    );
  if (chunks.length >= 2) return chunks;
  const sentences = raw.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const paras: string[] = [];
  let buf = "";
  for (const s of sentences) {
    buf = buf ? `${buf} ${s}` : s;
    if (buf.length > 280) {
      paras.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim().length > 40) paras.push(buf.trim());
  return paras;
}

export function blocksFromText(text: string): Block[] {
  const paras = parseParagraphs(text);
  if (paras.length) return paras.map((t) => ({ kind: "p" as const, text: t }));
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? [{ kind: "p", text: t }] : [];
}

export function splitCodeBlocks(raw: string): Block[] {
  const out: Block[] = [];
  const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const before = raw.slice(last, m.index).trim();
    if (before) out.push(...blocksFromText(before));
    const code = m[2].replace(/\s+$/, "");
    if (code.trim()) out.push({ kind: "code", text: code, lang: m[1] || undefined });
    last = m.index + m[0].length;
  }
  const tail = raw.slice(last).trim();
  if (tail) out.push(...blocksFromText(tail));
  return out;
}

export function section(id: string, title: string, blocks: Block[]): DocSection {
  return { id, title, blocks };
}

export type ManualChapter = { title: string; subs: string[] };

const TOC_SKIP =
  /^(kirish|xulosa|adabiyot|foydalanilgan|mundarija|reja|introduction|conclusion|references|contents|содержание|введение|заключение|литератур)/i;

/**
 * Qo'lda yozilgan rejani BOB va OSTMAVZULARGA ajratadi.
 *
 * Ilgari bu funksiya faqat bob sarlavhalarini qaytarardi va foydalanuvchi
 * yozgan ostmavzular butunlay tashlab yuborilardi — o'rniga generic
 * «1.1», «1.2» qo'yilardi. Ya'ni «mundarijani o'zim yozaman» tanlovi
 * yarim yolg'on edi: reja qabul qilinardi-yu, tafsiloti yo'qolardi.
 *
 * Ostmavzu belgisi ikkita, ikkalasi ham bashorat qilinadigan:
 *   — raqamlash «1.1», «2.3.1» ko'rinishida;
 *   — qator ichkariga surilgan (kamida 2 bo'sh joy).
 * Bandcha belgisi (`-`, `•`) o'zicha hal qilmaydi: ko'p foydalanuvchi
 * boblarni ham bandcha bilan yozadi.
 */
export function parseManualOutline(text: string): ManualChapter[] {
  const chapters: ManualChapter[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = (raw.match(/^[ \t]*/)?.[0] ?? "").replace(/\t/g, "  ").length;
    const body = raw.trim().replace(/^[-*•]\s*/, "").trim();
    if (!body || body.length > 200 || TOC_SKIP.test(body)) continue;
    const numbered = /^\d+(\.\d+)+/.test(body);
    const title = body.replace(/^[IVXLC]+[.)]\s*/i, "").replace(/^\d+(\.\d+)*[.)]?\s*/, "").trim() || body;
    if (title.length < 3) continue;
    if ((numbered || indent >= 2) && chapters.length) chapters[chapters.length - 1].subs.push(title);
    else chapters.push({ title, subs: [] });
  }
  return chapters
    .filter((c) => c.title.length >= 4)
    .slice(0, 6)
    .map((c) => ({ ...c, subs: c.subs.slice(0, 4) }));
}

/**
 * Sarlavha boshidagi raqamlashni olib tashlaydi.
 *
 * Model sarlavhani o'zi raqamlaydi, lekin izchil emas: bir joyda «1.1.»,
 * boshqasida «1.1», uchinchisida umuman yo'q. Shu sababli raqamni
 * MODELDAN olmaymiz — tashlab yuboramiz va o'zimiz qo'yamiz. Natijada
 * bob va ostmavzu raqamlari qurilish yo'li bilan izchil bo'ladi.
 *
 * Ikki hol alohida ushlanadi, chunki bitta keng qolip xavfli:
 * «IT sohasida», «3D modellashtirish» kabi sarlavhalar raqam bilan
 * boshlangandek ko'rinadi. Shuning uchun ajratuvchi belgi TALAB qilinadi.
 */
const ARABIC_LEAD = /^\d+(?:\.\d+)*\s*[.)]?\s+/;
const ROMAN_LEAD = /^(?:(?:chapter|глава)\s+)?[ivxlc]{1,4}\s*[-–—]?\s*(?:bob|глава|chapter)?\s*[.)]\s+/i;

export function stripHeadingNumber(title: string): string {
  const t = String(title ?? "").trim();
  const cut = t.replace(ROMAN_LEAD, "").replace(ARABIC_LEAD, "").trim();
  // Sarlavha butunlay raqamdan iborat bo'lsa (masalan «2.2»), asl matn
  // qoladi — bo'sh sarlavha raqamsizdan ham yomon.
  return cut.length >= 3 ? cut : t;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** 1 → «I». Chegaradan chiqsa arab raqami qaytadi. */
export function romanNumeral(n: number): string {
  return ROMAN[n - 1] ?? String(n);
}
