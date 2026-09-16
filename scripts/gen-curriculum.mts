/**
 * O'QUV DASTURI BAZASI — 2-bosqich: keshlangan PDF matnidan
 * `data/curriculum/<fan>.json` yasaydi (AUDIT-20 WP-B).
 *
 * Naqsh `scripts/gen-professions.mts`: **RO'YXATNI LLM TUZMAYDI**. Bob
 * va mavzu nomlari rasmiy hujjat matnidan HEURISTIKA bilan ajratiladi,
 * LLM esa faqat TOZALASH bosqichida ishlaydi (bo'linib ketgan mavzuni
 * birlashtirish, dublikatni olib tashlash) va u O'CHIRILGAN bo'lsa ham
 * baza to'liq ishlaydi — «darslik rejimi» va'dasi manbaga bog'liq
 * bo'lishi shart (halollik chegarasi, AUDIT-20 §7).
 *
 * HUJJAT FORMATLARI (R4 §4.3 da bittasi ko'rilgan edi, amalda IKKITA):
 *   A) «N-mavzu: Sarlavha. (2 soat, A2+: 3 soat)» — geografiya 6–7,
 *      tarix 6–7, biologiya 6–7, fizika 6–7, kimyo 7, matematika 6–7:
 *      mavzular ANIQ belgilangan, heuristika deyarli xatosiz;
 *   B) «I BOB. SARLAVHA / (19 soat) / <mavzu nomi>. <tavsif>. …» —
 *      qolgan hujjatlar: mavzu nomi qalin shriftda edi, PDF dan matn
 *      olinganda qalinlik YO'QOLADI. Shuning uchun mavzu chegarasi
 *      QATOR UZILISHI bilan aniqlanadi: oldingi qator nuqta bilan
 *      tugab, yangisi bosh harf bilan boshlansa — yangi mavzu; nomi
 *      esa shu bo'lakning BIRINCHI GAPI.
 *
 * NIMA BAZAGA KIRMAYDI (X-5 mualliflik chegarasi): «Tushuntirish xati»,
 * kompetensiya ro'yxatlari, «o'quvchilar … biladi/tushunadi» talablari,
 * jihozlar ro'yxati — ular uslubiy MATN, faktik ma'lumot emas. Bazada
 * faqat BOB sarlavhasi, soat va MAVZU NOMLARI saqlanadi.
 *
 * NAZORAT ISHI qatorlari (`1-nazorat ishi`, `Yakuniy nazorat`) ham
 * chiqariladi: ular dastur qismi, lekin MAVZU emas — ularga test
 * generatsiya qilib bo'lmaydi (pedagogik qaror, R4 ochiq savol #3).
 *
 * Foydalanish (loyiha ildizidan, keshdan keyin):
 *   scripts/heavy.sh npx tsx scripts/gen-curriculum.mts
 *   … --only matematika,fizika   # faqat shu fanlar
 *   … --stats                    # faylga yozmaydi, faqat hisobot
 *   … --dry                      # faylga yozmaydi, JSON namunasi
 *   … --llm                      # LLM normalizatsiyasi (kalit kerak)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { CACHE_DIR, SUBJECTS, loadAllCached, type CachedDoc, type SubjectSpec } from "./fetch-curriculum.mts";

const OUT_DIR = "data/curriculum";
/** Baza versiyasi — yangi DTS loyihasi (2026-08) chiqqanda O'ZGARADI (X-1). */
const VERSION = new Date().toISOString().slice(0, 10);

/* ────────────────────────── shakl ────────────────────────── */

export type Topic = { id: string; title: string; hours?: number };
export type Unit = { title: string; hours?: number; topics: Topic[] };
export type Entry = {
  grade: number;
  /** Hujjatda E'LON QILINGAN yillik soat («(68 soat)») — tekshiruv tayanchi. */
  hours?: number;
  source: { title: string; url: string; year: number; publisher: string };
  units: Unit[];
};

const PUBLISHER = "Respublika ta'lim markazi (Xalq ta'limi vazirligi)";
/** Hujjatlar 2018-yil nashri (matn ichida «Toshkent-2018»). */
const YEAR = 2018;

/* ────────────────────────── matn yordamchilari ────────────────────────── */

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Lotin apostroflari bitta shaklga (id va taqqoslash uchun). */
export function slug(s: string): string {
  return norm(s)
    .toLowerCase()
    .replace(/[‘’ʻʼ'`´]/g, "")
    /*
     * FAQAT ASCII: id shakli `^[a-z0-9-]+$` — `tests/curriculum.test.mts`
     * (R0) shuni qulflagan va `/api/curriculum` javobi ham shu id larni
     * beradi. Kirill harflar dasturlarda faqat SHOVQIN sifatida uchraydi
     * («А2» darajasi, ruscha fan nomi), mavzu nomlarida emas.
     */
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

/** Bo'sh joysiz yopishib qolgan so'zlar (`Hayotninghujayrasizshakllari`) — PDF nuqsoni. */
const GLUED = /[a-z‘’][A-Z]/;

const CAPS_RATIO = (s: string) => {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (!letters) return 0;
  return (letters.match(/\p{Lu}/gu) ?? []).length / letters.length;
};

/* ────────────────────────── shovqin ────────────────────────── */

/** Butun BLOK tashlanadigan sarlavhalar (keyingi bob/mavzugacha). */
const BLOCK_START = [
  /o.?quvchilar.*(faoliyati|talablar)/i,
  /shakllantiriladigan.*kompetensiya/i,
  /tayanch kompetensiya/i,
  /kompetensiya(si|lar)?\s*:?$/i,
  /^jihozlar/i,
  /^amaliy (mashg|ish)/i,
  /^laboratoriya/i,
  /^tushuntirish xati/i,
  /^foydalanilgan adabiyot/i,
  /^mundarija/i,
];

/** Bitta QATOR tashlanadi. */
const LINE_NOISE = [
  /^\d{1,3}$/, // bet raqami
  /^[☐☒✓•–—-]+$/,
  /tijorat maqsadida/i,
  /^\(?(A2\+?|B1\+?|A1\+?)\)?:?$/i,
  /^o.?zbekiston respublikasi$/i,
  /^xalq ta.?limi vazirligi$/i,
  /^respublika ta.?lim markazi$/i,
  /^toshkent[- ]\d{4}$/i,
  /^\d+-sinf$/i,
];

/** MAVZU bo'la olmaydigan sarlavhalar (dastur qismi, lekin mavzu emas). */
const NOT_A_TOPIC = [
  /nazorat ishi/i,
  /^takrorlash/i,
  /takrorlashga doir/i,
  /^masalalar yechish/i,
  /^mashqlar bajarish/i,
  /xatolar ustida ishlash/i,
  /^mavzular kesimida/i,
  /^jihozlar/i,
  /^amaliy (topshiriq|mashg|ish)/i,
  /^\d*-?laboratoriya/i,
  /^\d*-?ekskursiya/i,
  /^kompetensiya/i,
  /^o.?quv resurs/i,
  // Kirill yozuvidagi nusxalari (matematika 6–7 dasturida aralash yozilgan).
  /назорат иши/i,
  /хатолар устида/i,
  /^масала ва тест/i,
  /*
   * Uslubiy NASR: ba'zi hujjatlarda (biologiya 10, geografiya 10)
   * tushuntirish xati bob sarlavhasisiz boshlanadi va heuristika uning
   * gaplarini mavzu deb oladi. Bunday gaplar DOIM o'quvchi haqida
   * 3-shaxsda gapiradi («o'quvchilar … erishadilar») yoki maqsad
   * bildiradi («e'tibor qaratiladi») — mavzu nomi hech qachon shunday
   * yozilmaydi.
   */
  /o.?quvchilar/i,
  /e.?tibor qaratiladi/i,
  /ko.?zda tutiladi/i,
  /elektron darslik/i,
  /masofaviy ta.?lim/i,
];

/**
 * Daraja belgisi («A2+:», «А2:») — mavzu nomi EMAS, dastur darajasi.
 * Lotin «A» va kirill «А» ikkalasi ham uchraydi (bitta hujjat ichida).
 */
const LEVEL_PREFIX = /^[AВА-Я]?\s*[AА][12]\+?\s*:\s*/i;

/**
 * Mavzu nomining OXIRIDAGI uslubiy dum: har dasturda takrorlanadigan
 * «… (kompetentlikka) va fanlararo bog'liqlikka doir masalalar yechish»
 * bandi mavzu nomiga yopishib keladi (PDF da u alohida qator edi).
 */
const TITLE_TAIL = /\s*[.,;]?\s*\(?\s*(kompetent\w*|kompetensiya\w*)\)?.*$/i;

const isNoiseLine = (l: string) => LINE_NOISE.some((re) => re.test(l));
const isBlockStart = (l: string) => BLOCK_START.some((re) => re.test(l));
const isNotATopic = (t: string) => NOT_A_TOPIC.some((re) => re.test(t));

/* ────────────────────────── sarlavhalar ────────────────────────── */

/** «I BOB. …», «IBOB.», «1-BOB.», «II bo'lim» — rim yoki arab raqami. */
const CHAPTER_RE = /^((?:[IVXLC]{1,6})|(?:\d{1,2}))\s*[-.]?\s*(BOB|BOB\.|BO[‘'`ʻ]?LIM|BOLIM)\b\.?\s*(.*)$/i;
/** «(19 soat)», «(A2: 51 soat, A2+: 68 soat)», «(34+*17 soat)». */
const HOURS_RE = /\(\s*([^)]*?)(\d+)\s*[- ]?soat/i;
/** «12-mavzu: …», «4-5-mavzular: …» (ko'plik shakli matematikada uchraydi). */
const TOPIC_NUM_RE = /^(\d{1,3}(?:\s*-\s*\d{1,3})?)\s*-\s*mavzu(?:lar)?\s*[:.]?\s*(.*)$/i;
/** «1.Gulli o'simliklar … (3 soat)» — biologiya 5-sinf uslubi. */
const TOPIC_DOT_RE = /^(\d{1,3})\s*[.)]\s*([^(]{3,180}?)\s*\(\s*[^)]*\d+\s*-?\s*soat/i;

/** Qatordagi birinchi soat qiymati (A2 bazaviy soat — birinchi son). */
export function hoursOf(line: string): number | undefined {
  const m = HOURS_RE.exec(line);
  if (!m) return undefined;
  const n = Number(m[2]);
  return Number.isFinite(n) && n > 0 && n <= 400 ? n : undefined;
}

/**
 * YILLIK soat — hujjatning O'ZIDAN.
 *
 * Rasmiy tayanch o'quv reja (MMTV 2025-yil 10-apreldagi 121-son buyrug'i,
 * 1-ILOVA) fan×sinf haftalik soatini beradi, lekin uning PDF havolasi
 * 2026-09-16 holatiga 502 qaytaradi (`data/CURRICULUM-SOURCES.md` da
 * qayd etilgan). Shuning uchun yillik soat SHU hujjatning sarlavha
 * qatoridan olinadi — u ham AYNI rasmiy manba, taxmin emas:
 * «(68 soat)», «(34-soat, haftasiga 1 soatdan)», «(A2: 51 soat, A2+: 68
 * soat)», «(haftasiga 2 soatdan jami 68 soat)».
 *
 * Faqat BIRINCHI bobdan OLDINGI qatorlarga qaraladi: bobning o'z soati
 * («(19 soat)») yillik soat bilan adashib ketmasin.
 */
export function yearHoursOf(lines: string[], beforeIndex: number): number | undefined {
  for (let i = 0; i < Math.min(beforeIndex, lines.length); i++) {
    const h = hoursOf(lines[i]);
    if (h !== undefined && h >= 30 && h <= 250) return h;
  }
  return undefined;
}

/** Gapning BIRINCHI jumlasi — B formatida mavzu nomi aynan shu. */
export function firstSentence(text: string): string {
  const t = norm(text);
  // Qisqartmalar («XIX asr.», «1865-y.») gapni tugatmaydi: nuqtadan keyin
  // PROBEL va BOSH HARF kelishi shart, oldida esa ≥3 belgili so'z.
  const m = /^([\s\S]{3,200}?[\p{L}\p{N}]{3,}[.!?])(\s+\p{Lu}|$)/u.exec(t);
  return norm(m ? m[1] : t).replace(/[.;:,]+$/, "");
}

/* ────────────────────────── parser ────────────────────────── */

export type ParseStats = { format: "A" | "B" | "mixed"; units: number; topics: number; dropped: number };

/** `parseDoc` natijasi: boblar + hujjatda e'lon qilingan yillik soat. */
export type ParsedDoc = { units: Unit[]; yearHours?: number; stats: ParseStats };

/**
 * Bitta hujjat matni → boblar va mavzular.
 *
 * Bir o'tishda ikkala formatni ham qamraydi: `N-mavzu:` qatori
 * uchrasa ANIQ mavzu, uchramasa bob tanasi qator uzilishlari bo'yicha
 * bo'laklanadi (yuqoridagi B izohi).
 */
export function parseDoc(text: string): ParsedDoc {
  const raw = text.split(/\r?\n/).map(norm);
  const lines = raw.filter((l) => l && !isNoiseLine(l));

  // Mazmun qayerdan boshlanadi: birinchi bob sarlavhasi yoki `N-mavzu`.
  let start = lines.findIndex((l) => CHAPTER_RE.test(l) || TOPIC_NUM_RE.test(l) || TOPIC_DOT_RE.test(l));
  if (start < 0) start = lines.findIndex((l) => HOURS_RE.test(l));
  if (start < 0) start = 0;

  const units: Unit[] = [];
  let unit: Unit | null = null;
  let buffer: string[] = [];
  let pendingTopic: { title: string; hours?: number } | null = null;
  let skipping = false;
  let explicit = 0;
  let implicit = 0;
  let dropped = 0;

  /** Bob yaratadi. `flushBuffer` ni O'ZI chaqirmaydi — chaqiruvchi qiladi. */
  const newUnit = (title: string, hours?: number) => {
    // Qavs ichidagi soat/daraja bloki sarlavhaga KIRMAYDI: u `hours` da,
    // va id prefiksiga tushsa «…-24-soat-а2-6-soat-1» kabi id yasardi.
    const clean = norm(title).replace(/\([^)]*\)/g, " ").replace(/[.:]+$/, "");
    unit = { title: norm(clean) || norm(title), ...(hours ? { hours } : {}), topics: [] };
    units.push(unit);
    return unit;
  };

  const openUnit = (title: string, hours?: number) => {
    flushBuffer();
    newUnit(title, hours);
  };

  /*
   * Bobsiz hujjatlarda (10-sinf O'zbekiston tarixi) mavzular to'g'ridan-
   * to'g'ri boshlanadi. `newUnit` chaqiriladi, `openUnit` EMAS: aks holda
   * `flushBuffer → pushTopic → ensureUnit → openUnit → flushBuffer`
   * cheksiz rekursiyaga tushardi (jonli topildi).
   */
  const ensureUnit = () => unit ?? newUnit("Dastur mavzulari");

  const pushTopic = (title: string, hours?: number) => {
    const t = norm(title).replace(/^[-–—•\s]+/, "").replace(LEVEL_PREFIX, "").replace(TITLE_TAIL, "").replace(/[.;:,]+$/, "");
    if (t.length < 3 || t.length > 200 || isNotATopic(t) || GLUED.test(t.slice(0, 40))) {
      dropped++;
      return;
    }
    // Faqat bosh harf bilan boshlanadigan nom (kompetensiya bandlari kichik harfda).
    if (!/^[\p{Lu}\p{N}«"]/u.test(t)) {
      dropped++;
      return;
    }
    ensureUnit().topics.push({ title: t, id: "", ...(hours ? { hours } : {}) });
  };

  function flushBuffer() {
    if (!buffer.length) {
      buffer = [];
      return;
    }
    // B formati: qator uzilishi bo'yicha bo'laklash (oldingi qator nuqta
    // bilan tugab, yangisi bosh harf bilan boshlansa — yangi mavzu).
    const segments: string[][] = [];
    for (const l of buffer) {
      const prev = segments[segments.length - 1];
      const prevLast = prev?.[prev.length - 1] ?? "";
      const breaks = !prev || (/[.!?:]$/.test(prevLast) && /^[\p{Lu}«"]/u.test(l));
      if (breaks) segments.push([l]);
      else prev.push(l);
    }
    for (const seg of segments) {
      const title = firstSentence(seg.join(" "));
      pushTopic(title);
      implicit++;
    }
    buffer = [];
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    /* bob sarlavhasi */
    const ch = CHAPTER_RE.exec(line);
    if (ch) {
      skipping = false;
      let title = norm(ch[3]);
      let hours = hoursOf(line);
      /*
       * Sarlavha keyingi qatorga cho'zilishi mumkin (BOSH HARFLI davomi),
       * soat esa ALOHIDA qatorda turadi: «I BOB. NATURAL SONLARNI …» /
       * «(19 soat)». Shuning uchun soat qatori BOSH HARF shartidan
       * QAT'I NAZAR yutiladi — aks holda «(19 soat)» mavzu tanasiga
       * tushib, birinchi mavzuni yeb qo'yardi (jonli topildi).
       */
      let j = i + 1;
      while (j < lines.length && j - i <= 3) {
        const next = lines[j];
        if (hours === undefined && /^\(/.test(next)) {
          const h = hoursOf(next);
          if (h !== undefined) {
            hours = h;
            j++;
            break;
          }
        }
        if (hours === undefined && CAPS_RATIO(next) > 0.6 && next.length < 120 && !CHAPTER_RE.test(next)) {
          title = norm(`${title} ${next}`);
          j++;
          continue;
        }
        break;
      }
      i = j - 1;
      openUnit(title || `Bob ${units.length + 1}`, hours);
      continue;
    }

    /* «N-mavzu: …» — aniq mavzu (A formati) */
    const tn = TOPIC_NUM_RE.exec(line);
    if (tn) {
      skipping = false;
      flushBuffer();
      let title = tn[2];
      let hours = hoursOf(line);
      let j = i + 1;
      // Sarlavha `(… soat)` gacha cho'ziladi.
      while (hours === undefined && j < lines.length && j - i <= 3 && !TOPIC_NUM_RE.test(lines[j]) && !CHAPTER_RE.test(lines[j])) {
        title = `${title} ${lines[j]}`;
        hours = hoursOf(lines[j]);
        j++;
      }
      i = j - 1;
      pendingTopic = { title: norm(title.replace(/\([\s\S]*$/, "")), ...(hours ? { hours } : {}) };
      pushTopic(pendingTopic.title, pendingTopic.hours);
      explicit++;
      pendingTopic = null;
      skipping = true; // tavsif matni mavzuga kirmaydi
      continue;
    }

    /* «1. Sarlavha (3 soat)» */
    const td = TOPIC_DOT_RE.exec(line);
    if (td) {
      skipping = false;
      flushBuffer();
      pushTopic(td[2], hoursOf(line));
      explicit++;
      skipping = true;
      continue;
    }

    /* kompetensiya/jihoz bloklari — bob yoki mavzugacha tashlanadi */
    if (isBlockStart(line)) {
      flushBuffer();
      skipping = true;
      continue;
    }
    if (skipping) continue;
    if (isNotATopic(line)) continue;

    buffer.push(line);
  }
  flushBuffer();

  // Bo'sh boblarni olib tashlaymiz va id larni beramiz.
  const out = units
    .filter((u) => u.topics.length)
    .map((u) => ({
      ...u,
      topics: u.topics.map((t, i) => ({ ...t, id: `${slug(u.title) || "bob"}-${i + 1}` })),
    }));
  const topics = out.reduce((a, u) => a + u.topics.length, 0);
  const format: ParseStats["format"] = explicit && implicit ? "mixed" : explicit ? "A" : "B";
  const yearHours = yearHoursOf(lines, start);
  return { units: out, ...(yearHours ? { yearHours } : {}), stats: { format, units: out.length, topics, dropped } };
}

/* ────────────────────────── dublikat va tozalash ────────────────────────── */

/**
 * Fan+sinf ICHIDA bir xil nomli mavzu bir marta qoladi va id lar
 * QAYTA raqamlanadi.
 *
 * Id prefiksi bob sarlavhasining slug i, LEKIN u ham takrorlanishi
 * mumkin: sarlavha 48 belgida kesiladi va ba'zi dasturda ikki bob
 * bir xil boshlanadi («ORGANIZMLARNING XILMA-XILLIGI» ikki marta,
 * biologiya 9). Shunda id lar to'qnashardi va `pickTopics` noto'g'ri
 * mavzuni tanlardi — shuning uchun takrorlangan prefiksga bob tartibi
 * qo'shiladi.
 */
export function dedupe(units: Unit[]): Unit[] {
  const seenTopic = new Set<string>();
  const usedPrefix = new Map<string, number>();
  const out: Unit[] = [];
  for (const [at, u] of units.entries()) {
    const topics: Topic[] = [];
    for (const t of u.topics) {
      const key = slug(t.title);
      if (!key || seenTopic.has(key)) continue;
      seenTopic.add(key);
      topics.push(t);
    }
    if (!topics.length) continue;
    const base = slug(u.title) || "bob";
    const n = (usedPrefix.get(base) ?? 0) + 1;
    usedPrefix.set(base, n);
    const prefix = n === 1 ? base : `${base}-b${at + 1}`;
    out.push({ ...u, topics: topics.map((t, i) => ({ ...t, id: `${prefix}-${i + 1}` })) });
  }
  return out;
}

/* ────────────────────────── LLM normalizatsiyasi ────────────────────────── */

/**
 * LLM FAQAT TOZALAYDI: bo'linib ketgan mavzuni birlashtiradi, mavzu
 * bo'lmagan qatorni olib tashlaydi. Yangi mavzu QO'SHMAYDI va tartibni
 * o'zgartirmaydi — javobdagi har element kirishdagi indeksga ishora
 * qiladi, ya'ni «ro'yxatni LLM tuzmaydi» qoidasi kod bilan majburlanadi.
 *
 * Kalit bo'lmasa (yoki xato bo'lsa) kirish O'ZGARISHSIZ qaytadi.
 */
export async function normalizeWithLlm(unit: Unit, subject: string, grade: number): Promise<Unit> {
  const { llmComplete } = await import("../lib/generation/llm.ts");
  const numbered = unit.topics.map((t, i) => `${i}. ${t.title}`).join("\n");
  const system = [
    "You clean up a list of school curriculum topics extracted from a PDF. You NEVER invent topics.",
    'Answer with JSON only: {"keep":[{"i":<index of the FIRST line of the topic>,"title":"<cleaned title>"}]}',
    "Rules: keep the original order; merge lines that are fragments of one topic into one entry (use the first line's index);",
    "drop lines that are not topics (assessment work, equipment lists, competency statements, page artefacts);",
    "keep the wording of the source — only fix broken spacing, stray punctuation and truncation. Do not translate.",
  ].join("\n");
  const user = `SUBJECT: ${subject} · GRADE: ${grade} · CHAPTER: ${unit.title}\n\nLINES:\n${numbered}`;
  try {
    const raw = await llmComplete(system, user, 4000, { json: true, timeoutMs: 60_000 });
    const parsed = raw ? (JSON.parse(raw.replace(/^```json\s*|```$/g, "")) as { keep?: { i?: unknown; title?: unknown }[] }) : null;
    const keep = Array.isArray(parsed?.keep) ? parsed.keep : [];
    if (!keep.length) return unit;
    const topics: Topic[] = [];
    for (const k of keep) {
      const i = Number(k?.i);
      const title = norm(String(k?.title ?? ""));
      if (!Number.isInteger(i) || i < 0 || i >= unit.topics.length) continue;
      if (title.length < 6 || title.length > 200 || isNotATopic(title)) continue;
      topics.push({ ...unit.topics[i], title });
    }
    return topics.length >= Math.ceil(unit.topics.length * 0.4) ? { ...unit, topics } : unit;
  } catch (e) {
    console.warn(`    [llm] ${unit.title}: ${e instanceof Error ? e.message : e}`);
    return unit;
  }
}

/* ────────────────────────── fan fayli ────────────────────────── */

export function entryOf(doc: CachedDoc, grade: number, spec: SubjectSpec, units: Unit[], yearHours?: number): Entry {
  const gradeLabel = doc.grades.length > 1 ? `${doc.grades.join("–")}-sinf` : `${grade}-sinf`;
  return {
    grade,
    ...(yearHours ? { hours: yearHours } : {}),
    source: {
      title: `Umumiy o'rta ta'limning o'quv dasturi (${gradeLabel}) — ${spec.uz}${doc.note ? ` (${doc.note})` : ""}`,
      url: doc.url,
      year: YEAR,
      publisher: PUBLISHER,
    },
    units,
  };
}

type Args = { only: string[]; stats: boolean; dry: boolean; llm: boolean };

export function parseArgs(argv: string[]): Args {
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    only: (val("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    stats: argv.includes("--stats"),
    dry: argv.includes("--dry"),
    llm: argv.includes("--llm"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const subjects = args.only.length ? SUBJECTS.filter((s) => args.only.includes(s.id)) : SUBJECTS;
  if (!subjects.length) {
    console.error(`Noma'lum fan. Mavjud: ${SUBJECTS.map((s) => s.id).join(", ")}`);
    process.exit(2);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const indexSubjects: { id: string; uz: string; ru: string; en: string; grades: number[] }[] = [];
  for (const spec of subjects) {
    const docs = await loadAllCached(spec.id);
    if (!docs.length) {
      console.warn(`[gen] ${spec.id}: kesh bo'sh — avval fetch-curriculum.mts ni yugurting (${CACHE_DIR})`);
      continue;
    }
    const entries: Entry[] = [];
    for (const doc of docs) {
      const parsed = parseDoc(doc.text);
      let units = dedupe(parsed.units);
      if (args.llm) {
        const cleaned: Unit[] = [];
        for (const u of units) cleaned.push(await normalizeWithLlm(u, spec.uz, doc.grades[0]));
        units = dedupe(cleaned);
      }
      const topics = units.reduce((a, u) => a + u.topics.length, 0);
      console.log(`  ${spec.id} ${doc.grades.join("/")}-sinf · ${parsed.stats.format} · ${units.length} bob · ${topics} mavzu (tashlandi ${parsed.stats.dropped})`);
      // Qo'shma fayl («6-7-sinf») ikkala sinfga ham AYNI mundarija beradi.
      for (const g of doc.grades) entries.push(entryOf(doc, g, spec, units, parsed.yearHours));
    }
    entries.sort((a, b) => a.grade - b.grade);
    const grades = entries.map((e) => e.grade);
    indexSubjects.push({ id: spec.id, uz: spec.uz, ru: spec.ru, en: spec.en, grades });
    if (!args.stats && !args.dry) {
      const file = { version: VERSION, subject: { id: spec.id, uz: spec.uz, ru: spec.ru, en: spec.en }, entries };
      await writeFile(`${OUT_DIR}/${spec.id}.json`, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    }
  }

  const total = indexSubjects.reduce((a, s) => a + s.grades.length, 0);
  console.log(`[gen] ${indexSubjects.length} fan, ${total} fan×sinf yozuvi`);
  if (args.stats || args.dry || args.only.length) {
    console.log("[gen] indeks YOZILMADI (--stats/--dry yoki --only): to'liq yugurishda yangilanadi");
    return;
  }
  const index = {
    version: VERSION,
    sources: [
      {
        title: "Umumiy o'rta ta'limning fan o'quv dasturlari (qabul-2025 to'plami)",
        url: "https://uzbmb.uz/upload/file/pdf/qabul2025/dasturlar/",
        publisher: PUBLISHER,
        year: YEAR,
      },
    ],
    subjects: indexSubjects,
  };
  await writeFile(`${OUT_DIR}/index.json`, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  console.log(`[gen] ${OUT_DIR}/index.json yangilandi`);
}

if (process.argv[1]?.endsWith("gen-curriculum.mts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
