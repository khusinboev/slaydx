import { sectionLabels } from "./i18n";
import { parseLlmObject } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { writerSystemPrompt, essaySystemPrompt } from "./prompts";
import {
  blocksFromText,
  isGenericFiller,
  mapPool,
  parseManualOutline,
  referenceSearchPlan,
  unverifiedReferenceNote,
  remainingMs,
  section,
  splitCodeBlocks,
  targetWords,
  wordCount, stripHeadingNumber } from "./quality";
import {
  writeGlossaryWithLlm,
  writeImradWithLlm,
  writeKeysWithLlm,
  writeLessonWithLlm,
  writeMapWithLlm,
  writeResumeWithLlm,
  writeTranslationWithLlm,
} from "./write-specials";
import type { AcademicDoc, Block, DocMeta, DocSection } from "./types";

function wantsCodeSample(meta: DocMeta) {
  const t = `${meta.topic} ${meta.subject} ${meta.extra}`.toLowerCase();
  return /ai|dastur|python|kod|algoritm|informatika|sun.?iy|javascript|machine|machine learning|\bit\b|web dastur|sql|c\+\+|java\b/.test(
    t,
  );
}

/**
 * Adabiyot qatori ishonchli ko'rinadimi.
 *
 * Uydirma manba akademik XAVF: o'qituvchi bitta soxta DOI ni tekshirsa
 * butun ish shubha ostiga tushadi. Shuning uchun filtr tekshirib
 * bo'lmaydigan «aniqlik»ni rad etadi (DOI, ISSN, jurnal tomi, havola) —
 * model aynan shularni deyarli har doim o'ylab topadi.
 */
export function isReferenceLine(r: string): boolean {
  if (r.length < 24 || r.length > 280) return false;
  // Tekshirib bo'lmaydigan «aniqlik»: DOI, ISSN, jurnal tomi/soni va
  // havolalar. Model bularni deyarli har doim uydiradi va aynan shular
  // o'qituvchi tekshirganda fosh bo'ladi.
  if (/doi[:\s.]|doi\.org|\bISSN\b|\bISBN\b|https?:\/\/|\bvol\.|\bno\.\s*\d|\bP\.\s*\d+[–-]\d+/i.test(r)) return false;
  if (/^(ushbu|tadqiqot|maqola|izoh|manba|quyida|mana|these|the following|ниже|данн)/i.test(r)) return false;
  const sentences = (r.match(/[.!?]\s+[A-ZА-ЯЁO‘]/g) ?? []).length;
  if (sentences > 3) return false;
  const hasYear = /\b(1[89]\d{2}|20\d{2})\b/.test(r);
  const hasPublisher =
    /[–—]\s*[^,]+[:,]/.test(r) || /\b(nashriyot|publishing|press|изд|қўлланма|qo‘llanma|darslik)/i.test(r);
  return hasYear || hasPublisher;
}

async function writeSection(
  sys: string,
  title: string,
  brief: string,
  meta: DocMeta,
  minParas: number,
  timeoutMs: number,
  thinking = 0,
): Promise<Block[]> {
  if (timeoutMs < 4_000) return [];
  const user = [
    `Bo‘lim sarlavhasi (matnga qayta yozilmasin): ${title}`,
    `Mavzu: ${meta.topic}`,
    `Fan: ${meta.subject || "mavzuga mos fan"}`,
    `Nima yozish: ${brief}`,
    `Kamida ${minParas} ta to‘la paragraf (har biri 80–130 so‘z). Faqat shu bo‘lim.`,
    `Mavzuga xos atama, mexanizm yoki misol yozing. Umumiy shior va boshqa soha aralashmasin.`,
  ].join("\n");
  const text = await llmComplete(sys, user, Math.min(7000, 900 + minParas * 420), { timeoutMs, thinking });
  if (!text) {
    console.warn("[write-llm] empty response for", title);
    return [];
  }
  const mixed = splitCodeBlocks(text);
  if (mixed.some((b) => b.kind === "code") && mixed.some((b) => b.kind === "p")) return mixed;
  const blocks = blocksFromText(text.replace(/```[\s\S]*?```/g, "\n"));
  if (blocks.length) return blocks;
  console.warn("[write-llm] parse failed for", title, "len", text.length);
  return [];
}

type OutlineChapter = { title: string; subs: { title: string; brief: string }[] };

/**
 * Reja raqamlashini QURILISH yo'li bilan izchil qiladi.
 *
 * Muammo aniq ko'ringan edi: model bob sarlavhasini raqamsiz, ostmavzuni
 * esa «1.1.» qilib qaytarardi. Hujjatda bob RAQAMSIZ chiqib, ostidagi
 * «1.1.» hech nimaga ishora qilmasdi — o'quvchi uchun «1» qayerdaligi
 * noma'lum bo'lardi. Endi modeldan kelgan har qanday raqam olib
 * tashlanadi va o'rniga bob tartibiga bog'langan raqam qo'yiladi:
 * «I BOB. …» + «1.1.», «II BOB. …» + «2.1.».
 *
 * Shablon yo'li (`content.ts`) allaqachon shu ko'rinishda edi — ya'ni bu
 * yangi uslub emas, LLM yo'lini mavjud uslubga tenglashtirish.
 */
/**
 * Maqola/tezis (standart) — jurnal/konferensiya janri, «I BOB» kitob
 * bobi emas. Shu ikkitasidan boshqa barcha yozuvchi vositalar (kurs
 * ishi, referat, mustaqil ish) bob-kitob uslubida qoladi.
 */
export function isBobStyle(toolId: string): boolean {
  return toolId !== "article" && toolId !== "thesis";
}

function numberOutline(
  chapters: OutlineChapter[],
  L: ReturnType<typeof sectionLabels>,
  bobStyle: boolean,
): OutlineChapter[] {
  return chapters.map((ch, i) => ({
    title: bobStyle
      ? `${L.chapterPrefix(i + 1)} ${stripHeadingNumber(ch.title).toUpperCase()}`
      : `${i + 1}. ${stripHeadingNumber(ch.title)}`,
    subs: ch.subs.map((sub, j) => ({
      ...sub,
      title: `${i + 1}.${j + 1}. ${stripHeadingNumber(sub.title)}`,
    })),
  }));
}

async function buildOutline(meta: DocMeta, sys: string, L: ReturnType<typeof sectionLabels>, deadline?: number) {
  const out = await rawOutline(meta, sys, L, deadline);
  return { ...out, chapters: numberOutline(out.chapters, L, isBobStyle(meta.toolId)) };
}

/**
 * Reja o'lchami — nechta bob va har bobda nechta ostmavzu.
 *
 * Ilgari bu deyarli qat'iy edi: kurs ishida doim 3 bob, har bobda ≤3
 * ostmavzu. Natijada dvigatelning tuzilmaviy imkoniyati ~9 ostmavzu
 * bilan cheklanardi va HAJM 45 betlik va'daga hech qachon yetmasdi —
 * 25–30 va 40–45 betlik kurs ishlari (18 000 va 24 000 tanga) hajm
 * darvozasidan MUNTAZAM yiqilardi. Jonli o'lchov: ikkalasi ham ~5 000
 * so'zda to'xtardi, byudjetning esa uchdan ikkisi ishlatilmay qolardi.
 *
 * Sabab hajm emas, CHAQIRUV SONI edi: modeldan bitta javobda 9 paragraf
 * so'ralganda u ~45% ini beradi. Uch marta 3 paragraf so'rash bir marta
 * 9 paragraf so'rashdan ko'p matn beradi. Shuning uchun hajm endi
 * chaqiruv soni orqali olinadi, chaqiruv kattaligi orqali emas.
 *
 * Bu bir vaqtning o'zida AKADEMIK jihatdan ham to'g'riroq: 45 betlik
 * kurs ishi uch bobda emas, to'rt-besh bobda yoziladi.
 */
export function outlineShape(pages: number, toolId: string): { chapters: number; subs: number } {
  const p = Math.max(4, pages || 8);
  if (p >= 33) return { chapters: 5, subs: 4 };
  if (p >= 23) return { chapters: 4, subs: 4 };
  if (p >= 18 || toolId === "coursework") return { chapters: 3, subs: 3 };
  return { chapters: 2, subs: 3 };
}

async function rawOutline(meta: DocMeta, sys: string, L: ReturnType<typeof sectionLabels>, deadline?: number) {
  const pages = Math.max(4, meta.targetPages || 8);
  const long = pages >= 18;
  const shape = outlineShape(pages, meta.toolId);
  const chapterN = shape.chapters;
  const manual = meta.tocMethod === "manual" ? parseManualOutline(meta.tocText || meta.extra) : [];

  if (manual.length) {
    // Foydalanuvchi yozgan ostmavzular saqlanadi; yozmagan bo'lsa —
    // bobga ikkita ish sarlavhasi beriladi.
    const chapters: OutlineChapter[] = manual.map((ch, i) => ({
      title: ch.title,
      subs: ch.subs.length
        ? ch.subs.map((sub) => ({
            title: sub,
            brief: `«${meta.topic}» doirasida aynan shu masala: ${sub}.`,
          }))
        : [
            { title: `${i + 1}.1`, brief: `«${meta.topic}»: ${ch.title} ning mohiyati.` },
            { title: `${i + 1}.2`, brief: `«${meta.topic}»: ${ch.title} bo‘yicha tahlil va misol.` },
          ],
    }));
    return { chapters };
  }

  const ask = (timeoutMs: number) =>
    llmComplete(
      sys,
      [
        `«${meta.topic}» uchun ${chapterN} bobli reja. JSON:`,
        `{"chapters":[{"title":"","subs":[{"title":"1.1 ...","brief":"2 gap"}]}]}`,
        `Har bobda ${shape.subs === 3 ? "2–3" : `3–${shape.subs}`} ostmavzu. Sarlavha mavzuga xos (umumiy «Nazariy asoslar» emas).`,
        `brief — shu ostmavzuda nima yozilishini 1–2 gapda.`,
        meta.extra ? `Qo‘shimcha: ${meta.extra}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      1200,
      { json: true, timeoutMs },
    );

  const parse = (text: string | null) => {
    const data = parseLlmObject<{ chapters?: OutlineChapter[] }>(text);
    const chapters = (data?.chapters ?? [])
      .map((c, i) => {
        const title = String(c?.title || "").trim();
        const subs = Array.isArray(c?.subs)
          ? c.subs
              .map((sub) => ({
                title: String(sub?.title || "").trim(),
                brief: String(sub?.brief || "").trim(),
              }))
              .filter((sub) => sub.title)
              .slice(0, shape.subs)
          : [];
        if (!title || !subs.length) return null;
        return {
          title: title.length > 8 ? title : i === 0 ? L.chapterTheory(meta.topic) : L.chapterPractice,
          subs,
        };
      })
      .filter((x): x is OutlineChapter => Boolean(x))
      .slice(0, chapterN);
    return { chapters, parsed: Boolean(data) };
  };

  /**
   * Rejaga ikkinchi urinish beriladi.
   *
   * Reja butun hujjat tuzilmasini belgilaydi: u yiqilsa bob sarlavhalari
   * generic bo'lib qoladi («I BOB. ... NAZARIY ASOSLARI») va ish
   * shablonga o'xshab ketadi. `llmComplete` tarmoq xatosida qayta uradi,
   * lekin javob KELIB parse bo'lmasa urinmaydi — shu bo'shliq yopiladi.
   */
  let raw = await ask(Math.min(40_000, remainingMs(deadline)));
  let out = parse(raw);
  if (out.chapters.length < 2 && remainingMs(deadline) > 25_000) {
    console.warn(
      "[outline] qayta urinish:",
      raw === null ? "javob yo‘q" : `javob ${raw.length} belgi, parse ${out.parsed ? "ok" : "yiqildi"}`,
    );
    raw = await ask(Math.min(30_000, remainingMs(deadline)));
    out = parse(raw);
  }
  if (out.chapters.length >= 2) return { chapters: out.chapters };

  console.warn("[outline] zaxira reja ishlatildi");

  return {
    chapters: long
      ? [
          {
            title: L.chapterTheory(meta.topic),
            subs: [
              { title: L.sub11, brief: `«${meta.topic}» tushunchasi, tasnifi.` },
              { title: L.sub12, brief: `Asosiy unsurlar va jarayon.` },
            ],
          },
          {
            title: L.chapterAnalysis,
            subs: [
              { title: L.sub21, brief: `Qanday ishlaydi / kechadi.` },
              { title: "2.2", brief: `Omillar va bog‘liqlik.` },
            ],
          },
          {
            title: L.chapterProblems,
            subs: [
              { title: "3.1", brief: `Muammo va sabab.` },
              { title: "3.2", brief: `Yechim va tavsiya.` },
            ],
          },
        ]
      : [
          {
            title: L.chapterTheory(meta.topic),
            subs: [
              { title: L.sub11, brief: `«${meta.topic}» tushunchasi, tasnifi.` },
              { title: L.sub12, brief: `Asosiy unsurlar va jarayon.` },
            ],
          },
          {
            title: L.chapterPractice,
            subs: [
              { title: L.sub21, brief: `Amaliy tomon, muammo.` },
              { title: L.sub22, brief: `Yechim va tavsiya.` },
            ],
          },
        ],
  };
}

/**
 * Rejani oldindan ko'rsatish uchun (`POST /api/outline`).
 *
 * Reja BEPUL: u bitta arzon chaqiruv, pulli qilish esa narxni bo'lish,
 * qaytarish mantiqi va yangi tijoriy qoidalarni keltirardi. Bepul bo'lgani
 * uchun foydalanuvchi rejani ko'rib tuzatadi va shundan keyin qimmat
 * renderga o'tadi — natijada yaroqsiz hujjatlar va qaytarishlar kamayadi.
 */
export async function draftOutline(meta: DocMeta, deadline?: number): Promise<string | null> {
  if (!llmEnabled()) return null;
  const { chapters } = await buildOutline(meta, writerSystemPrompt(meta), sectionLabels(meta.language), deadline);
  if (!chapters.length) return null;
  /*
   * Matn ko'rinishi — foydalanuvchi uni to'g'ridan-to'g'ri tahrirlaydi va
   * `parseManualOutline` uni qaytadan o'qiy oladi.
   *
   * Raqam `buildOutline` da qo'yilgan («I BOB. …»), bu yerda esa tahrirga
   * qulay oddiy ko'rinish kerak — shuning uchun qayta raqamlaymiz.
   */
  return chapters
    .map((ch, i) =>
      [
        `${i + 1}. ${stripHeadingNumber(ch.title)}`,
        ...ch.subs.map((sub, j) => `  ${i + 1}.${j + 1} ${stripHeadingNumber(sub.title)}`),
      ].join("\n"),
    )
    .join("\n");
}

/**
 * Kirish bo'limi uchun ko'rsatma — janrga qarab farqlanadi.
 *
 * Ilgari bitta ternary bor edi: kurs ishi vs «hammasi boshqa». Referat,
 * mustaqil ish, maqola va tezis natijada bir xil «obyekt/predmet, 3-4
 * vazifa» ko'rsatmasini olardi — aslida faqat kurs ishida shart.
 */
function introBrief(meta: DocMeta, topic: string): string {
  if (meta.toolId === "coursework") {
    return `«${topic}» bo‘yicha: dolzarblik; ANIQ tadqiqot savoli (savol belgisi bilan); maqsad; 4 ta vazifa; obyekt va predmet ALOHIDA; tadqiqot usullari.`;
  }
  if (meta.toolId === "referat") {
    return `«${topic}» bo‘yicha: mavzuning dolzarbligi; ushbu adabiyot sharhining maqsadi; qanday manbalar ko‘rib chiqilishi. Tadqiqot savoli yoki obyekt/predmet SHART emas.`;
  }
  if (meta.toolId === "mustaqil-ish") {
    return `«${topic}» bo‘yicha: dolzarblik, maqsad, va talaba bu ishda ANIQ nimani mustaqil bajarishi (hisoblaydi/yechadi/tahlil qiladi).`;
  }
  if (meta.toolId === "article") {
    return `«${topic}» maqolasi uchun qisqa kirish: muammo, maqsad, ishning qiymati. «Vazifalar ro‘yxati», obyekt/predmet kabi akademik-metodik bo‘limlar YOZMANG.`;
  }
  if (meta.toolId === "thesis") {
    return `«${topic}» tezisi uchun juda qisqa kirish: muammo va maqsad, 2–3 gapda.`;
  }
  return `Faqat «${topic}» haqida: dolzarblik, maqsad, 3–4 vazifa, obyekt/predmet, usul.`;
}

const ABSTRACT_LANG_NAMES: Record<string, string> = { uz: "o‘zbek", ru: "rus", en: "ingliz" };

/**
 * Annotatsiya — maqola/tezis uchun.
 *
 * Ilgari faqat `toolId === "article"` da ishlardi va doimo `meta.language`
 * bitta tilida yozardi — forma esa «Barcha tillar (UZ+EN+RU)» tanlovini
 * (`annotationLangs`) berardi, lekin u hech qayerda o'qilmasdi. Endi
 * tezis ham qamraladi va `annotationLangs === "all"` bo'lsa uchala tilda
 * ham (tarjima emas, mustaqil) yoziladi.
 */
async function askAbstracts(
  sys: string,
  topic: string,
  meta: DocMeta,
  langs: readonly string[],
  timeoutMs: number,
): Promise<NonNullable<AcademicDoc["abstracts"]>> {
  const schema =
    langs.length > 1
      ? `JSON: {${langs.map((l) => `"${l}":{"text":"","keywords":""}`).join(",")}}`
      : `JSON: {"text":"","keywords":""}`;
  const raw = await llmComplete(
    sys,
    [
      `«${topic}» ${meta.workLabel.toLowerCase()}i uchun annotatsiya.`,
      langs.length > 1
        ? `Har tilda MUSTAQIL yozilsin (bir-biridan tarjima emas): ${langs
            .map((l) => ABSTRACT_LANG_NAMES[l] ?? l)
            .join(", ")}.`
        : "",
      schema,
      `text — 4–6 gap: muammo, maqsad, yondashuv, xulosa. keywords — 5–7 ta atama, vergul bilan.`,
    ]
      .filter(Boolean)
      .join("\n"),
    langs.length > 1 ? 1800 : 800,
    { json: true, timeoutMs },
  );
  if (langs.length === 1) {
    const abs = parseLlmObject<{ text?: string; keywords?: string }>(raw);
    const text = String(abs?.text ?? "").trim();
    if (text.length <= 80) return [];
    return [
      {
        lang: langs[0],
        label: sectionLabels(langs[0]).abstract,
        text: text.slice(0, 900),
        keywords: String(abs?.keywords ?? topic).slice(0, 160),
      },
    ];
  }
  const data = parseLlmObject<Record<string, { text?: string; keywords?: string }>>(raw);
  const out: NonNullable<AcademicDoc["abstracts"]> = [];
  for (const lang of langs) {
    const text = String(data?.[lang]?.text ?? "").trim();
    if (text.length <= 80) continue;
    out.push({
      lang,
      label: sectionLabels(lang).abstract,
      text: text.slice(0, 900),
      keywords: String(data?.[lang]?.keywords ?? topic).slice(0, 160),
    });
  }
  return out;
}

/**
 * Bir martalik so'rov nozik: uch tilni bitta joyda so'rash ko'p tildagi
 * ichma-ich JSON talab qiladi, model buni ba'zan yarim to'ldiradi.
 * Maqolasiz annotatsiya jurnalga umuman yaroqsiz — shuning uchun
 * `rawOutline` naqshi bo'yicha bitta qayta urinish beriladi.
 */
async function writeAbstracts(
  sys: string,
  topic: string,
  meta: DocMeta,
  deadline?: number,
): Promise<AcademicDoc["abstracts"]> {
  const langs = meta.annotationLangs === "all" ? (["uz", "ru", "en"] as const) : ([meta.language] as const);
  let out = await askAbstracts(sys, topic, meta, langs, Math.min(25_000, remainingMs(deadline)));
  if (out.length < langs.length && remainingMs(deadline) > 15_000) {
    out = await askAbstracts(sys, topic, meta, langs, Math.min(20_000, remainingMs(deadline)));
  }
  return out.length ? out : undefined;
}

export async function writeWriterWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const sys = writerSystemPrompt(meta);
  const L = sectionLabels(meta.language);
  const topic = meta.topic;
  const pages = Math.max(4, meta.targetPages || 8);
  const want = targetWords(pages);
  const { chapters } = await buildOutline(meta, sys, L, deadline);

  /**
   * Har OSTMAVZU alohida yoziladi va boshqalarning ro'yxatini biladi.
   *
   * Ilgari bitta chaqiruv butun bobni yozar, keyin matn ostmavzular
   * soniga MATEMATIK bo'linardi (`mid = ceil(bloklar / ostmavzular)`).
   * Ikki oqibati bor edi: 1.1 sarlavhasi ostida 1.2 ning matni turishi
   * mumkin edi, va boblar bir-birini ko'rmagani uchun bir xil fikrni
   * qayta-qayta yozardi.
   *
   * Endi har ostmavzu o'z sarlavhasi uchun yoziladi va promptda boshqa
   * ostmavzular sanab o'tiladi («bular boshqa joyda yoritiladi»).
   * Chaqiruvlar soni ortadi, lekin har biri kichikroq — pool 3 da
   * umumiy vaqt deyarli o'zgarmaydi.
   */
  type Job = {
    id: string;
    kind: "intro" | "sub" | "outro";
    title: string;
    brief: string;
    min: number;
  };

  /**
   * Kurs ishi eng qimmat va eng talabchan ish — bo'lim yozishda modelga
   * o'ylash byudjeti beriladi. Qolgan vositalarda 0: ular qisqaroq va
   * tuzilmasi oldindan aniq, o'ylash faqat narx qo'shardi.
   */
  const thinking = meta.toolId === "coursework" ? 1024 : 0;
  const allSubs = chapters.flatMap((ch) => ch.subs.map((s) => s.title));
  const subCount = Math.max(1, allSubs.length);
  /**
   * Kirish va xulosa hajmning ~25% ini oladi, qolgani ostmavzularga.
   *
   * Yuqori chegara 9 dan 6 ga TUSHIRILDI. Bu qarshi-intuitiv, lekin
   * o'lchov shuni ko'rsatdi: modeldan bitta javobda 9 paragraf
   * so'ralganda u ~45% ini beradi, 4–5 paragraf so'ralganda esa deyarli
   * to'liq bajaradi. Hajm endi ostmavzular SONI orqali olinadi
   * (`outlineShape`), chaqiruv kattaligi orqali emas.
   */
  const perSub = Math.max(3, Math.min(6, Math.round((want * 0.75) / subCount / 105)));

  const jobs: Job[] = [
    {
      id: "kirish",
      kind: "intro",
      title: L.intro,
      brief: introBrief(meta, topic),
      min: Math.max(3, Math.round(pages / 4)),
    },
    ...chapters.flatMap((ch, ci) =>
      ch.subs.map((sub, si) => ({
        id: `bob${ci + 1}-${si + 1}`,
        kind: "sub" as const,
        title: sub.title,
        brief: [
          `Bob: ${ch.title}`,
          `Shu ostmavzuda aynan nima yoziladi: ${sub.brief}`,
          allSubs.length > 1
            ? `Ishning BOSHQA ostmavzulari (ular alohida yoritiladi — TAKRORLAMANG): ${allSubs
                .filter((t) => t !== sub.title)
                .join("; ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        min: perSub,
      })),
    ),
    {
      id: "xulosa",
      kind: "outro",
      title: L.conclusion,
      brief: `3–5 ta aniq xulosa va amaliy tavsiya. Ish boblari: ${chapters
        .map((c) => c.title)
        .join("; ")}. Boblardagi jumlalarni ko‘chirmang, umumlashtiring.`,
      min: 3,
    },
  ];

  /**
   * Parallellik ish soniga ergashadi.
   *
   * Qat'iy 3 da 22 ta bo'lim 8 to'lqin bo'lardi — 8 × 38 s = 304 s,
   * worker esa 285 s beradi. Uzun ishlarda oxirgi to'lqinlar byudjetsiz
   * qolib, bo'limlar bo'sh qaytardi. Chegara 6 — undan yuqorisi
   * provayder tomonidan cheklanishi mumkin.
   */
  const pool = Math.min(6, Math.max(3, Math.ceil(jobs.length / 4)));
  const written = await mapPool(jobs, pool, async (item) => {
    const left = remainingMs(deadline);
    if (left < 5_000) return { item, blocks: [] as Block[] };
    const budget = item.kind === "sub" ? 38_000 : 45_000;
    let blocks = await writeSection(sys, item.title, item.brief, meta, item.min, Math.min(budget, left), thinking);
    if (!blocks.length && remainingMs(deadline) > 8_000) {
      blocks = await writeSection(
        sys,
        item.title,
        item.brief,
        meta,
        Math.max(2, item.min - 2),
        Math.min(30_000, remainingMs(deadline)),
      );
    }
    return { item, blocks };
  });

  const byId = new Map<string, Block[]>();
  for (const { item, blocks } of written) {
    if (blocks.length) byId.set(item.id, blocks);
    else console.warn("[write-llm] empty section", item.id);
  }

  const sections: DocSection[] = [];
  const intro = byId.get("kirish");
  if (intro) sections.push(section("kirish", L.intro, intro));
  chapters.forEach((ch, ci) => {
    const blocks: Block[] = [];
    ch.subs.forEach((sub, si) => {
      const b = byId.get(`bob${ci + 1}-${si + 1}`);
      if (!b?.length) return;
      // Sarlavha endi AYNAN o'z matni ustida turadi.
      blocks.push({ kind: "h2", text: sub.title }, ...b);
    });
    if (blocks.some((b) => b.kind === "p")) sections.push(section(`bob${ci + 1}`, ch.title, blocks));
  });
  const outro = byId.get("xulosa");
  if (outro) sections.push(section("xulosa", L.conclusion, outro));

  if (sections.length < 3) {
    console.warn("[write-llm] too few sections", sections.length);
    return sections.length ? { meta, titlePage: true, toc: true, sections } : null;
  }

  if (wantsCodeSample(meta) && remainingMs(deadline) > 12_000 && !sections.some((s) => s.blocks.some((b) => b.kind === "code"))) {
    const sample = await llmComplete(
      sys,
      `«${topic}» uchun BITTA qisqa, ishlaydigan kod namunasi. JSON: {"caption":"","lang":"python","code":""}. 8–20 qator. Iris/sklearn takrorlamang.`,
      800,
      { json: true, timeoutMs: Math.min(30_000, remainingMs(deadline)) },
    );
    const data = parseLlmObject<{ caption?: string; lang?: string; code?: string }>(sample);
    const code = (data?.code || "").trim();
    if (code.length > 20 && code.length < 1800) {
      const target = sections.find((s) => s.id === "bob2") ?? sections.find((s) => s.id.startsWith("bob"));
      target?.blocks.push(
        { kind: "h3", text: L.codeSample },
        { kind: "code", text: code, caption: data?.caption, lang: data?.lang },
      );
    }
  }

  // Jadval foydalanuvchi tanloviga bo'ysunadi. «Yo'q» deganda jadval
  // qo'shish — tanlovni jimgina bekor qilish bo'lardi.
  if (meta.includeVisuals && remainingMs(deadline) > 12_000) {
    const tableRaw = await llmComplete(
      sys,
      `«${topic}» bo‘yicha 1 ta qisqa jadval. JSON: {"caption":"","headers":["",""],"rows":[["",""]]}. 3–5 qator. Uydirma foiz/DOI yo‘q. Atama yoki bosqich taqqoslash.`,
      700,
      { json: true, timeoutMs: Math.min(25_000, remainingMs(deadline)) },
    );
    const tb = parseLlmObject<{ caption?: string; headers?: string[]; rows?: string[][] }>(tableRaw);
    if (tb?.headers?.length && tb.rows?.length) {
      const docTables = [
        {
          caption: String(tb.caption || topic).slice(0, 80),
          headers: tb.headers.map((h) => String(h).slice(0, 40)).slice(0, 5),
          rows: tb.rows.slice(0, 6).map((r) => r.map((c) => String(c).slice(0, 80))),
        },
      ];
      (meta as DocMeta & { _tables?: typeof docTables })._tables = docTables;
    }
  }

  const refRaw =
    remainingMs(deadline) > 8_000
      ? await llmComplete(
          sys,
          `«${topic}» bo‘yicha ${meta.toolId === "coursework" ? "8–10" : "6–8"} ta USLUBIY adabiyot qatori. Format: Muallif. Nom. – Shahar: Nashriyot, yil.\nSoxta DOI/ISSN/jurnal tomi/GOST YO‘Q. Umumiy darslik yoki qo‘llanma, faqat shu mavzu sohasida.`,
          700,
          { timeoutMs: Math.min(25_000, remainingMs(deadline)) },
        )
      : null;
  const references = (refRaw ? blocksFromText(refRaw).map((b) => b.text) : [])
    .map((r) => r.replace(/\*\*/g, "").replace(/^[_*]+|[_*]+$/g, "").trim())
    .filter(isReferenceLine)
    .slice(0, 10);

  /**
   * Maqola/tezisga annotatsiya va kalit so'zlar.
   *
   * Ilgari annotatsiya faqat `toolId === "article"` da bor edi — standart
   * tezis annotatsiyasiz chiqardi, garchi forma `annotationLangs`
   * tanlovini bersa ham. Endi ikkalasi ham qamraladi, `writeAbstracts`
   * esa `annotationLangs === "all"` bo'lsa uch tilda ham yozadi.
   */
  let abstracts: AcademicDoc["abstracts"];
  if ((meta.toolId === "article" || meta.toolId === "thesis") && remainingMs(deadline) > 12_000) {
    abstracts = await writeAbstracts(sys, topic, meta, deadline);
  }

  const tables = (meta as DocMeta & { _tables?: AcademicDoc["tables"] })._tables;

  // Model yetarli manba bermasa uydirmaymiz — qidiruv rejasini beramiz.
  const refPlan = references.length >= 4 ? null : referenceSearchPlan(topic, meta.subject, meta.language);

  const doc: AcademicDoc = {
    meta,
    titlePage: true,
    toc: true,
    sections,
    abstracts,
    tables,
    references: refPlan ? refPlan.queries : references,
    // Ro'yxat qayerdan kelganiga qarab ogohlantirish. Model bergan
    // manbalar ham TEKSHIRILMAGAN hisoblanadi — bu yerda jimlik
    // foydalanuvchini akademik xavf ostida qoldirardi.
    referencesNote: refPlan ? refPlan.note : unverifiedReferenceNote(meta.language),
  };

  /**
   * Hajmni va'daga yetkazish.
   *
   * Ilgari bu bitta urinish edi va faqat 55% dan past bo'lgandagina ishga
   * tushardi. Natijada «15–20 bet» so'ragan foydalanuvchi muntazam ravishda
   * 12 bet olardi va bu hech qayerda qayd etilmasdi. Endi 90% ga
   * yetguncha (yoki byudjet tugaguncha) qo'shimcha tahlil yoziladi;
   * shundan keyin ham yetmasa `buildArtifact` ishni xato bilan yakunlaydi.
   *
   * Qo'shimchalar UMUMIY to'ldirgich emas — har biri mavzuning aniq
   * qirrasini so'raydi, shuning uchun matn shablonga aylanmaydi.
   */
  /**
   * Qo'shimcha tahlil burchaklari.
   *
   * Ikkita edi — 40 betlik ish uchun yetmasdi, beshtaga chiqarildi. Har
   * biri mavzuning ALOHIDA qirrasini so'raydi, shuning uchun ro'yxat
   * uzayishi matnni shablonga aylantirmaydi. Har bo'lim ≤6 paragraf:
   * katta so'rov modeldan kam matn oladi (yuqoridagi `perSub` izohi).
   */
  const angles = L.extraAngles;
  const TOPUPS = [
    {
      label: angles.practical,
      brief: (t: string) =>
        `«${t}» bo‘yicha aniq misol, holat va raqamsiz kuzatish. O‘zbekiston sharoitidagi qo‘llanish. Oldingi boblarni takrorlamang.`,
    },
    {
      label: angles.problem,
      brief: (t: string) =>
        `«${t}» bo‘yicha tipik qiyinchilik, uning sababi va amaliy yechim. Har band bitta muammoga bag‘ishlansin. Takror bo‘lmasin.`,
    },
    {
      label: angles.compare,
      brief: (t: string) =>
        `«${t}» bo‘yicha kamida ikki yondashuv yoki maktabni QIYOSLANG: nimasi bilan farq qiladi, qaysi sharoitda qaysi biri ustun. Uydirma statistika yo‘q.`,
    },
    {
      label: angles.history,
      brief: (t: string) =>
        `«${t}» tushunchasining qanday shakllangani: bosqichlar, burilish nuqtalari, hozirgi holatga qanday kelingani. Sana uydirmang, umumiy davrlar bilan yozing.`,
    },
    {
      label: angles.outlook,
      brief: (t: string) =>
        `«${t}» bo‘yicha yaqin istiqbol, ochiq savollar va aniq tavsiyalar. Har tavsiya kimga qaratilganini ayting. Shior yo‘q.`,
    },
  ];

  /**
   * Qo'shimcha matn BITTA raqamlangan bobga yig'iladi.
   *
   * Ilgari har burchak alohida, RAQAMSIZ bo'lim bo'lib «V BOB» bilan
   * «XULOSA» orasiga tushardi va sarlavhasi mavzuni to'liq takrorlardi.
   * Jonli hujjatda natija shunday ko'rindi — mundarijada ketma-ket besh
   * qator, hammasi bir xil 60 belgi bilan boshlanadi:
   *
   *   UMUMIY O'RTA TA'LIM MAKTABLARIDA … : AMALIY TAHLIL
   *   UMUMIY O'RTA TA'LIM MAKTABLARIDA … : MUAMMO VA YECHIM
   *   …
   *
   * Kurs ishida raqamsiz bo'lim bo'lmaydi. Endi ular «VI BOB.
   * QO'SHIMCHA TAHLIL VA ISTIQBOL» ichidagi 6.1, 6.2 … ostmavzulari
   * bo'ladi va sarlavhalar mavzuni takrorlamaydi — bobning o'zi
   * kontekstni beradi.
   */
  const extraNo = chapters.length + 1;
  const extraChapter = section("qoshimcha", `${L.chapterPrefix(extraNo)} ${L.chapterExtra}`, []);
  let subNo = 0;
  let misses = 0;

  for (const topup of TOPUPS) {
    const have = wordCount(doc);
    if (have >= want * 0.9) break;
    if (remainingMs(deadline) < 25_000) {
      console.warn("[write-llm] topup skipped: byudjet tugadi", have, "/", want);
      break;
    }
    const need = want - have;
    const extra = await writeSection(
      sys,
      topup.label,
      topup.brief(topic),
      meta,
      Math.max(3, Math.min(6, Math.round(need / 110))),
      Math.min(45_000, remainingMs(deadline)),
    );
    /*
     * Bo'sh javob shu burchakni tashlaydi, tsikl davom etadi. Ilgari
     * birinchi bo'sh javobda `break` bo'lardi — bitta o'tkinchi xato
     * qolgan burchaklarni ham bekor qilardi. Ketma-ket ikki yiqilish
     * esa model umuman javob bermayotganini bildiradi.
     */
    if (!extra.length) {
      if (++misses >= 2) break;
      continue;
    }
    misses = 0;
    // Bob birinchi muvaffaqiyatda kiritiladi — bo'sh bob qolmasin.
    if (!subNo) sections.splice(Math.max(1, sections.length - 1), 0, extraChapter);
    subNo += 1;
    extraChapter.blocks.push({ kind: "h2", text: `${extraNo}.${subNo}. ${topup.label}` }, ...extra);
  }

  return doc;
}

export async function writeEssayWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const sys = essaySystemPrompt(meta);
  const L = sectionLabels(meta.language);
  const n = Math.min(5, Math.max(1, meta.targetPages));
  const minParas = n <= 1 ? 4 : n <= 2 ? 7 : n * 3;
  const raw = await llmComplete(
    sys,
    [
      `Mavzu: «${meta.topic}». ${n} varaqli insho.`,
      `JSON: {"intro":["paragraf"],"sections":[{"title":"I. ...","paras":["",""]}],"conclusion":["",""]}`,
      `intro 2 paragraf. sections ${n <= 2 ? 2 : 3} ta, har birida 2–3 to‘la paragraf.`,
      `Jami kamida ${minParas} paragraf. Har paragraf 70–110 so‘z.`,
      `Jonli mushohada, aniq misol. Shior va takror yo‘q.`,
    ].join("\n"),
    3600,
    { json: true, timeoutMs: Math.min(70_000, remainingMs(deadline) || 70_000) },
  );
  const data = parseLlmObject<{
    intro?: unknown;
    sections?: { title?: string; paras?: unknown }[];
    conclusion?: unknown;
  }>(raw);

  const asParas = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter((s) => s.length > 40);
    if (typeof v === "string") return blocksFromText(v).map((b) => b.text);
    return [];
  };

  const intro = asParas(data?.intro);
  const bodySecs = (data?.sections ?? [])
    .map((s, i) => ({
      title: String(s?.title || `${L.main} ${i + 1}`).slice(0, 80),
      paras: asParas(s?.paras),
    }))
    .filter((s) => s.paras.length);
  const conclusion = asParas(data?.conclusion);

  /**
   * Uchala qism ham TO'LIQ bo'lishi shart.
   *
   * Ilgari shart faqat JAMI paragraf soniga qo'yilgan edi (`>= 4`).
   * Model `intro` ni bo'sh qaytarib, `sections` ni to'ldirsa — shart
   * baribir bajarilar va hujjatga MATNSIZ «KIRISH» sarlavhasi tushardi
   * (render har bo'limga sarlavha yozadi, ichi bo'sh bo'lsa ham).
   * Kirishsiz yoki xulosasiz insho — tuzilmaviy jihatdan yaroqsiz,
   * shuning uchun bunda pastdagi matnli zaxira yo'liga o'tamiz: u
   * paragraflarni o'zi uchga bo'ladi va bo'sh bo'lim qoldirmaydi.
   */
  const bodyParas = bodySecs.reduce((n, s) => n + s.paras.length, 0);
  if (intro.length && bodyParas && conclusion.length && intro.length + bodyParas + conclusion.length >= 4) {
    return {
      meta,
      titlePage: true,
      toc: false,
      sections: [
        section("kirish", L.intro, intro.map((t) => ({ kind: "p", text: t }))),
        ...bodySecs.map((s, i) => section(`asosiy${i + 1}`, s.title, s.paras.map((t) => ({ kind: "p", text: t })))),
        section("xulosa", L.conclusion, conclusion.map((t) => ({ kind: "p", text: t }))),
      ],
    };
  }

  const text = await llmComplete(
    sys,
    `Mavzu: «${meta.topic}». ${n} varaqli insho: kirish, 2–3 asosiy band, xulosa. Har band 2–3 to‘la paragraf. Ajratish: KIRISH *** ASOSIY *** XULOSA`,
    3200,
    { timeoutMs: Math.min(50_000, remainingMs(deadline) || 50_000) },
  );
  if (!text) return null;
  const paras = blocksFromText(text).map((b) => b.text).filter((t) => !isGenericFiller(t));
  if (paras.length < 4) return null;
  const third = Math.max(1, Math.floor(paras.length / 3));
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      section("kirish", L.intro, paras.slice(0, third).map((t) => ({ kind: "p", text: t }))),
      section("asosiy", L.main, paras.slice(third, -Math.max(1, third - 1)).map((t) => ({ kind: "p", text: t }))),
      section("xulosa", L.conclusion, paras.slice(-Math.max(1, third - 1)).map((t) => ({ kind: "p", text: t }))),
    ],
  };
}

const WRITER = new Set(["referat", "coursework", "mustaqil-ish", "article", "thesis"]);

export async function writeWithLlm(
  meta: DocMeta,
  values: Record<string, unknown> = {},
  deadline?: number,
): Promise<AcademicDoc | null> {
  if (meta.toolId === "essay") return writeEssayWithLlm(meta, deadline);
  if ((meta.toolId === "article" || meta.toolId === "thesis") && meta.kind === "imrad") {
    return writeImradWithLlm(meta, deadline);
  }
  if (WRITER.has(meta.toolId)) return writeWriterWithLlm(meta, deadline);
  if (meta.toolId === "translation") return writeTranslationWithLlm(meta, values, deadline);
  if (meta.toolId === "lesson-plan") return writeLessonWithLlm(meta, deadline);
  if (meta.toolId === "glossary") return writeGlossaryWithLlm(meta, deadline);
  if (meta.toolId === "keys") return writeKeysWithLlm(meta, deadline);
  if (meta.toolId === "texnologik-xarita") return writeMapWithLlm(meta, deadline);
  if (meta.toolId === "resume") return writeResumeWithLlm(meta, values, deadline);
  return null;
}
