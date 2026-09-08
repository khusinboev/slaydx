import { languageDirective, slideLabels } from "./i18n";
import { sourceBlock } from "./prompts";
import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { remainingMs } from "./quality";
import { attachSlideImages } from "./slide-images";
import {
  audienceRules,
  expandBeats,
  resolveSlideTemplate,
  type SlideBeat,
  type SlideTemplate,
} from "./slide-templates";
import { getSlideTheme } from "./slide-themes";
import { isSlideLayout, type SlideLayout, type SlideModel, type SlideThemeId } from "./slide-types";
import type { AcademicDoc, DocMeta } from "./types";

/**
 * Slide Law: bir slaydda 3–4 tadan ortiq band bo'lmasin, agenda'da 5 ta.
 *
 * Ilgari 6 ta band × 140 belgi = ~840 belgilik matn devori chiqardi va
 * `shrinkText` uni 11 pt gacha kichraytirardi — proyektorda o'qib
 * bo'lmasdi. Uzun izoh endi slaydga emas, notiq eslatmasiga tushadi.
 *
 * Aniq chegara auditoriyaga bog'liq (`AUDIENCE_RULES`): maktab sinfida
 * 3 ta qisqa band, himoyada 4 ta.
 */
const MAX_AGENDA_ITEMS = 5;

/**
 * Matn chegaralari — MAKETDAN o'lchangan, promptdagi so'z sonidan emas.
 *
 * Ikkalasi ham `tests/slide-chart.test.mts` da ikki tomondan
 * qulflangan: chegara maket sig'imidan OSHMASIN (aks holda matn qutidan
 * chiqadi yoki shrift polga uriladi) va promptda SO'RALGAN hajmdan KAM
 * bo'lmasin (aks holda ko'rsatmaga rioya qilgan model ham kesiladi —
 * AUDIT-8 N-8/N-9 da aynan shu bo'lgan).
 */
export const STEP_TEXT_MAX = 160;
export const STAT_LABEL_MAX = 110;

function clip(text: string, n: number) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

function arr(v: unknown, n: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => clip(String(x ?? ""), maxLen))
    .filter(Boolean)
    .slice(0, n);
}

function asLayout(v: unknown, fallback: SlideLayout): SlideLayout {
  return typeof v === "string" && isSlideLayout(v) ? v : fallback;
}

type BulletRules = { maxBullets: number; bulletChars: number };

/**
 * Slayd `id` larini absolyut o'rin bo'yicha qayta raqamlaydi.
 *
 * `normalizeSlide` indeksni bo'lak ichidan oladi, shuning uchun uzun
 * deka bo'laklardan yig'ilganda `s0…s7` bir necha marta uchraydi. Bu
 * funksiya birlashtirishdan keyin chaqiriladi va noyoblikni bo'laklar
 * soniga bog'liq bo'lmagan holda kafolatlaydi.
 */
export function renumberSlides(slides: SlideModel[]): SlideModel[] {
  return slides.map((sl, i) => (sl.id === `s${i}` ? sl : { ...sl, id: `s${i}` }));
}

function normalizeSlide(raw: unknown, i: number, footer: string, rules: BulletRules): SlideModel | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const layout = asLayout(o.layout, "bullets");
  const title = clip(String(o.title ?? ""), 80);
  if (!title && layout !== "closing") return null;
  /*
   * `subtitle` chegarasi LAYOUTGA bog'liq — maketdan o'lchangan:
   *
   *   section  quti 7.3 × 1.45", 16 pt → ~325 belgi
   *   closing  quti 8.95 × 0.85", 16 pt → ~160 belgi
   *   title    muqova, qisqa qolishi kerak
   *
   * Ilgari hammasiga bitta 140 turardi va u aynan BO'SH slaydlarni
   * to'ldirish imkoniyatini kesib tashlardi: section slaydda 325 belgi
   * joy bo'lsa ham, 140 dan ortig'i tashlanardi.
   */
  const subtitleMax = layout === "section" ? 300 : layout === "closing" ? 160 : 140;
  const base: SlideModel = {
    id: `s${i}`,
    layout,
    title: title || "Slayd",
    kicker: o.kicker ? clip(String(o.kicker), 40) : undefined,
    subtitle: o.subtitle ? clip(String(o.subtitle), subtitleMax) : undefined,
    footer,
    notes: o.notes ? clip(String(o.notes), 700) : undefined,
    imageHint: o.imageHint ? clip(String(o.imageHint), 180) : undefined,
  };
  if (layout === "twoCol" || layout === "compare") {
    return {
      ...base,
      leftTitle: clip(String(o.leftTitle ?? (layout === "compare" ? "Birinchi" : "")), 40),
      /*
       * Ustunda 4 band × 120 belgi → 16 pt (o'lchangan). 130 belgida
       * 14 pt ga tushadi, 5 band ham shunday — shuning uchun ikkala
       * chegara ham shu yerda: 4 ta band, 120 belgi.
       *
       * Ilgari 5 × 110 edi. Chegara emas, so'rov muammo edi: jonli
       * o'lchovda twoCol slaydda 8 band jami 172 belgi (21 belgi/band)
       * chiqdi — bandlar to'liq gap emas, yorliq bo'lib qolgan edi.
       */
      left: arr(o.left, 4, 120),
      rightTitle: clip(String(o.rightTitle ?? (layout === "compare" ? "Ikkinchi" : "")), 40),
      right: arr(o.right, 4, 120),
    };
  }
  if (layout === "quote") {
    return {
      ...base,
      quote: clip(String(o.quote ?? o.subtitle ?? title), 220),
      quoteBy: o.quoteBy ? clip(String(o.quoteBy), 60) : undefined,
    };
  }
  if (layout === "stats") {
    const stats = Array.isArray(o.stats)
      ? o.stats
          .map((s) => {
            if (!s || typeof s !== "object") return null;
            const x = s as Record<string, unknown>;
            const value = clip(String(x.value ?? ""), 24);
            /*
             * Yorliq chegarasi 60 edi va jonli dekalarda muntazam
             * kesardi (`lesson`#6, `problem`#7 ning uchala yorlig'i,
             * `case`#6 — AUDIT-8 N-9). Maket sig'imi ancha katta:
             * `planStats` kartasida yorliq qutisi 3.58 × 2.3 dyuym va
             * `fitSize(..., 15, 11)` bilan chiziladi — 11 pt da ~480
             * belgi, diagramma ko'rinishida esa 3.6 × 1.05 da ~220.
             * 110 ikkalasiga ham bemalol sig'adi.
             */
            const label = clip(String(x.label ?? ""), STAT_LABEL_MAX);
            return value ? { value, label } : null;
          })
          .filter((x): x is { value: string; label: string } => Boolean(x))
          .slice(0, 4)
      : [];
    return { ...base, stats: stats.length ? stats : [{ value: "—", label: title }] };
  }
  if (layout === "table") {
    const src = (o.table ?? o) as Record<string, unknown>;
    /*
     * Sarlavha uzunligi USTUNLAR SONIGA bog'liq.
     *
     * Qat'iy 28 belgi 3 ustunli jadvalda ham qirqardi: «Quyosh
     * fotoelektr stansiyalari» (30 belgi) «…» bilan tugardi, holbuki
     * ustun kengligi to'liq matnni ko'tarardi. `planTable` shriftni
     * o'zi kichraytiradi, shuning uchun keng ustunda uzunroq matn xavfsiz.
     */
    const rawHeaders = arr(src.headers, 5, 60);
    const headers = rawHeaders.map((h) => clip(h, rawHeaders.length <= 3 ? 40 : 26));
    const rows = Array.isArray(src.rows)
      ? src.rows
          .map((r) => arr(r, Math.max(1, headers.length), 60))
          .filter((r) => r.some(Boolean))
          .slice(0, 6)
      : [];
    // Jadvalsiz «table» slayd — bo'sh ramka. Bunday holda bandlarga qaytamiz.
    if (headers.length < 2 || rows.length < 2) {
      return { ...base, layout: "bullets", bullets: arr(o.bullets, rules.maxBullets, rules.bulletChars) };
    }
    return { ...base, table: { headers, rows } };
  }
  if (layout === "process") {
    const steps = Array.isArray(o.steps)
      ? o.steps
          .map((s, n) => {
            if (!s || typeof s !== "object") return null;
            const x = s as Record<string, unknown>;
            const t = clip(String(x.title ?? ""), 40);
            if (!t) return null;
            /*
             * 90 chegaraga TEGIB turardi (o'lchovda 4 bosqich × ~80
             * belgi) — model uzunroq yozsa ham kesilardi.
             *
             * `planProcess` bu matnni `fitSize(..., 14, 11)` bilan
             * chizadi, ya'ni kartalar tor va shrift 14 pt dan boshlanadi.
             *
             * 120 chegara MAKETDAN emas, promptdagi «10–15 so'z» dan
             * kelib chiqqan edi va model undan uzunroq yozganda gapni
             * O'RTASIDAN kesardi: jonli `timeline` dekasida bitta
             * slaydning TO'RTALA kartasi ham «…» bilan tugagan
             * (AUDIT-8 N-8). Quti sig'imi qayta o'lchandi — 4 kartali
             * qatorda 2.47 × 1.75 dyuym: 14 pt da ~138 belgi, 11 pt da
             * ~255. 160 shu oraliqda: to'liq gap sig'adi, eng yomon
             * holatda shrift 13 pt ga tushadi, polga (11) yetmaydi.
             */
            return { n: String(x.n ?? n + 1), title: t, text: clip(String(x.text ?? ""), STEP_TEXT_MAX) };
          })
          .filter((x): x is { n: string; title: string; text: string } => Boolean(x))
          .slice(0, 5)
      : [];
    return { ...base, steps };
  }
  const limit = layout === "agenda" ? MAX_AGENDA_ITEMS : rules.maxBullets;
  return { ...base, bullets: arr(o.bullets, limit, rules.bulletChars) };
}

/**
 * Slaydni shablon talab qilgan layoutga KELTIRADI (majburan bosib yozmaydi).
 *
 * Ilgari `s.layout = beats[i].layout` deb yozib yuborilardi: model `quote`
 * yozgan bo'lsa-yu beat `stats` talab qilsa, iqtibos yo'qolib, `stats[]`
 * bo'sh qolardi va slaydda «—» chiqardi. Endi:
 *   — kerakli ma'lumot bor bo'lsa, shunchaki layout qo'yiladi;
 *   — yo'qotishsiz o'girish mumkin bo'lsa, o'giriladi;
 *   — o'girish uydirma raqam talab qilsa (stats), model layouti saqlanadi.
 */
export function coerceLayout(s: SlideModel, want: SlideLayout, maxBullets = 4): SlideModel {
  if (s.layout === want) return s;
  const pool = (s.bullets?.length ? s.bullets : [s.subtitle, s.quote].filter(Boolean) as string[]).filter(Boolean);

  if (want === "stats") {
    // Raqamsiz stats — uydirma bo'lardi. Model nima yozgan bo'lsa shu qoladi.
    return s.stats?.length ? { ...s, layout: want } : s;
  }
  if (want === "table") {
    // Jadvalni bandlardan «yasash» ustunlarni o'ylab topishni talab qiladi.
    return s.table?.rows.length ? { ...s, layout: want } : s;
  }
  if (want === "process") {
    if (s.steps?.length) return { ...s, layout: want };
    if (pool.length < 2) return s;
    return {
      ...s,
      layout: want,
      steps: pool.slice(0, 4).map((b, i) => {
        const [head, ...rest] = b.split(/\s+[—–:-]\s+/);
        return {
          n: String(i + 1),
          title: clip(head, 40),
          text: clip(rest.join(" — ") || b, 90),
        };
      }),
    };
  }
  if (want === "twoCol" || want === "compare") {
    if (s.left?.length && s.right?.length) return { ...s, layout: want };
    if (pool.length < 2) return s;
    const mid = Math.ceil(pool.length / 2);
    return { ...s, layout: want, left: pool.slice(0, mid), right: pool.slice(mid) };
  }
  if (want === "quote") {
    const quote = s.quote || pool[0];
    return quote ? { ...s, layout: want, quote: clip(quote, 220) } : s;
  }
  if (want === "section" || want === "closing" || want === "title") {
    return { ...s, layout: want, subtitle: s.subtitle || pool[0] };
  }
  // bullets / agenda
  return { ...s, layout: want, bullets: pool.length ? pool.slice(0, maxBullets) : s.bullets };
}

function parseDeckJson(raw: string, footer: string, want: number, rules: BulletRules): SlideModel[] {
  const data = parseLlmJson(raw) as { slides?: unknown } | null;
  if (!Array.isArray(data?.slides)) return [];
  return data.slides
    .map((s, i) => normalizeSlide(s, i, footer, rules))
    .filter((s): s is SlideModel => Boolean(s))
    .slice(0, Math.max(6, Math.min(24, want + 2)));
}

function beatToSlide(beat: { layout: SlideLayout; role: string }, i: number, meta: DocMeta, footer: string): SlideModel {
  const t = meta.topic;
  const L = slideLabels(meta.language);
  const base: SlideModel = { id: `s${i}`, layout: beat.layout, title: beat.role, footer };
  if (beat.layout === "title") {
    return { ...base, title: t, subtitle: beat.role, kicker: meta.subject || L.presentation };
  }
  if (beat.layout === "closing") {
    return { ...base, title: L.conclusion, subtitle: beat.role || L.questions };
  }
  if (beat.layout === "agenda") {
    return { ...base, title: beat.role, bullets: [`${t}: kirish`, "Asosiy qism", "Amaliyot", "Xulosa"] };
  }
  if (beat.layout === "section") {
    return { ...base, title: beat.role, subtitle: t };
  }
  if (beat.layout === "compare" || beat.layout === "twoCol") {
    return {
      ...base,
      leftTitle: "A",
      left: [`${t}: birinchi tomon`],
      rightTitle: "B",
      right: [`${t}: ikkinchi tomon`],
    };
  }
  if (beat.layout === "process") {
    return {
      ...base,
      steps: [
        { n: "1", title: "Boshlash", text: beat.role },
        { n: "2", title: "O‘zgarish", text: t },
        { n: "3", title: "Natija", text: "Kuzatiladigan yakun" },
      ],
    };
  }
  if (beat.layout === "stats") {
    return { ...base, stats: [{ value: "3", label: "Asosiy nuqta" }, { value: "1", label: beat.role }] };
  }
  if (beat.layout === "quote") {
    return { ...base, quote: `${t} — ${beat.role.toLowerCase()}.` };
  }
  return { ...base, bullets: [`${t}: ${beat.role}.`, "Mavzuga bog‘liq aniq band."] };
}

export function fallbackSlides(meta: DocMeta, tpl?: SlideTemplate, beats?: SlideBeat[]): SlideModel[] {
  const footer = [meta.author, meta.university].filter(Boolean).join(" · ");
  const template = tpl ?? resolveSlideTemplate(meta.slideTemplate, meta.topic, meta.extra);
  const base = beats ?? (template.beats.length ? template.beats : resolveSlideTemplate("lecture", meta.topic).beats);
  const seq = meta.titleSlide === false ? base.filter((b) => b.layout !== "title") : base;
  return seq.map((b, i) => beatToSlide(b, i, meta, footer));
}

/**
 * Sifat paketi nechta slayd va'da qiladi.
 * `meta.targetPages` — formadagi paket (standart 10, uzun 14, premium 12,
 * premium uzun 16). Shablon beats'i bundan kam bo'lsa kengaytiriladi.
 */
export function wantSlides(meta: DocMeta, tpl: SlideTemplate): number {
  const pack = Math.max(8, Math.min(20, meta.targetPages || 10));
  return Math.max(tpl.beats.length || 8, pack);
}

function slideSystem(meta: DocMeta, tpl: SlideTemplate) {
  const rules = audienceRules(meta.slideAudience, tpl.id);
  const audienceLine: Record<string, string> = {
    defense: `AUDITORIYA — himoya komissiyasi. Bir slaydda tadqiqot savoli AYNAN savol shaklida bo‘lsin. Har da'vo ortida asos ko‘rinsin. Shior yo‘q.`,
    lecture: `AUDITORIYA — talabalar. Har tushuncha ta'rif + misol bilan. Yangi atama kiritilsa darhol izohlansin.`,
    school: `AUDITORIYA — maktab o‘quvchilari. Sodda gap, kundalik misol. Bir slaydda sinf 2 daqiqada bajaradigan mashq bo‘lsin.`,
    pitch: `AUDITORIYA — investor. Bitta slayd — bitta fikr. Muammo, yechim va keyingi qadam aniq. Uydirma bozor raqami YO‘Q.`,
  };
  return [
    languageDirective(meta.language),
    `Siz professional taqdimot muallifisiz.`,
    `Auditoriyasi: talaba / o‘qituvchi / himoya komissiyasi.`,
    `Mavzu: «${meta.topic}». Fan: ${meta.subject || "—"}.`,
    `Faqat JSON qaytaring. Matn qisqa, aniq, slaydga sig‘adigan.`,
    `QAT’IY TAQIQLANADI: umumiy pedagogika shablonlari (kompetensiya, auditoriya, UNESCO, differensiatsiya, «tashxis-baholash» sikli), mavzuga tegishli bo‘lmagan soha (masalan, dvigatel yoki «milliy ta’lim»).`,
    `YOZING: shu mavzuning o‘zi — ta’rif, tuzilish/jarayon, turlari, misol, ahamiyat, cheklov.`,
    /*
     * ORALIQ beriladi, faqat yuqori chegara emas.
     *
     * Ilgari bu qator «ENG KO'PI N ta bullet … X so'zdan oshmasin» deb
     * yozilgan edi — ya'ni modelga faqat SHIFT aytilardi. Model bunday
     * ko'rsatmada tabiiy ravishda eng qisqa variantni tanlaydi: jonli
     * o'lchovda 10 slaydli deka o'rtacha 174 belgi/slayd bergan, ruxsat
     * etilgani esa 480 edi (36%). Slayd bo'sh ko'rinardi.
     *
     * Oraliq va POL ko'rsatilganda model oraliqni to'ldiradi. Bu
     * `perSub` (write-llm.ts) dagi saboqning slayddagi ko'rinishi: nima
     * SO'RALSA, shu keladi.
     */
    `Har slaydda ${rules.minBullets}–${rules.maxBullets} ta bullet (agenda'da 4–5).`,
    `Har bullet — TO‘LIQ gap, ${Math.round((rules.bulletChars * 0.55) / 8)}–${Math.round(rules.bulletChars / 8)} so‘z. Bir-ikki so‘zli sarlavhasimon parcha YOZMANG: fikr tugallangan bo‘lsin.`,
    `Bandlar bir-birini takrorlamasin — har biri yangi qirra: ta’rif, sabab, misol, oqibat, cheklov.`,
    audienceLine[meta.slideAudience && meta.slideAudience !== "auto" ? meta.slideAudience : ""] ??
      `${rules.note}`,
    /**
     * «Premium» paket endi KONTENTGA ham ta'sir qiladi.
     *
     * Ilgari u faqat rasm sifatini o'zgartirardi — matn standart paket
     * bilan bir xil edi, ya'ni qimmatroq paket uchun to'lagan
     * foydalanuvchi mazmunan bir xil deck olardi.
     */
    meta.premiumVisuals
      ? [
          `PREMIUM DARAJA:`,
          `— notes 80–120 so‘z: notiq nima deyishi, misol va o‘tish jumlasi bilan;`,
          `— kamida bitta slaydda taqqoslash mumkin bo‘lgan ANIQ ko‘rsatkichlar (stats), lekin uydirma emas — mavzuning o‘z birliklari;`,
          `— kamida bitta slaydda qarama-qarshi qo‘yish (compare yoki twoCol) chuqur tahlil bilan.`,
        ].join("\n")
      : "",
    `Sarlavha to‘liq fikr, 6–10 so‘z.`,
    /*
     * BO'SH SLAYDLARNI to'ldirish.
     *
     * O'lchov: 10 slaydli dekaning 4 tasida (title, 2 × section,
     * closing) tana matni UMUMAN yo'q edi — deka uzunligining 40% i.
     * `planSection` va `planOverlay` bu slaydlarda `subtitle` ni
     * chizadi, lekin promptda u so'ralmagan edi, shuning uchun model
     * «Savollar va muhokama» kabi ikki so'z qaytarardi.
     *
     * Sig'im maketdan o'lchandi: section subtitle qutisi ~325 belgi,
     * closing niki ~160 belgi ko'taradi.
     */
    `section slaydda subtitle — BO‘SH QOLMASIN: 20–35 so‘zlik kirish, shu bo‘limda nima ko‘rilishini aytadi.`,
    `closing slaydda subtitle — 15–25 so‘zlik xulosa: asosiy fikr va keyingi qadam. «Savollar va muhokama» kabi bo‘sh ibora emas.`,
    `twoCol va compare: har ustunda 3–4 band, har biri to‘liq gap (10–15 so‘z). Bir so‘zli yorliq emas.`,
    `process: har bosqichning text maydoni to‘liq gap (10–15 so‘z) — nima qilinadi va natija nima.`,
    `Uzun IZOHNI (nazariy chekinish, tarixiy tafsilot) notes ga yozing — bandlar to‘liq bo‘lsin, lekin izohga aylanmasin.`,
    `Har slaydda imageHint: 12–20 so‘z, ANIQ vizual (inglizcha yoki o‘zbekcha), shu slayd mazmunidagi narsa/joy/asbob. Mavzudan chiqib ketmasin.`,
    `Har slaydda notes: notiq OG‘ZAKI aytadigan matn, 40–80 so‘z. Slayddagi bandlarni takrorlamang — misol, izoh yoki savol qo‘shing.`,
    `title slaydning title maydoni foydalanuvchi mavzusini saqlasin.`,
    `kicker qisqa (2–4 so‘z), masalan «Biologiya» yoki «Taqdimot». Qo‘shimcha talabni kicker qilmang.`,
    `stats ga uydirma milliard/tonna/foiz YOZILMASIN. Formula, bosqich soni, ma’lum birlik (masalan C6H12O6, 2 bosqich) mumkin.`,
    /*
     * Qator soni POLI 3 ga ko'tarildi.
     *
     * «2–5» so'ralganda model odatda 2 ta qator qaytarardi va jadval
     * slaydning yuqori uchdan birida qolib, qolgani bo'sh chiqardi
     * (jonli sinovda `report` shablonida aynan shu ko'rindi).
     * `normalizeSlide` 6 tagacha qatorni qabul qiladi.
     */
    `table layout: 2–4 ustun, 3–5 qator. Katak matni qisqa (2–5 so‘z). Uydirma raqam emas — tasnif, qiyos yoki bosqich xossalari.`,
    meta.extra ? `Qo‘shimcha talab: ${meta.extra}` : "",
    sourceBlock(meta),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function writeSlidesWithLlm(
  meta: DocMeta,
  tpl: SlideTemplate,
  beats: SlideBeat[] = tpl.beats,
  deadline?: number,
): Promise<SlideModel[] | null> {
  if (!llmEnabled()) return null;
  const rules = audienceRules(meta.slideAudience, tpl.id);
  const plan = meta.titleSlide === false ? beats.filter((b) => b.layout !== "title") : beats;
  const want = plan.length || Math.max(8, Math.min(20, meta.targetPages || 10));
  const footer = [meta.author, meta.university].filter(Boolean).join(" · ");
  const seq = plan.map((b, i) => `${i + 1}) layout=${b.layout} — ${b.role}`).join("\n");

  /*
   * Uzun deka BIR chaqiruvga sig'maydi.
   *
   * Token byudjetini kattalashtirish yetarli emas edi: 16 slayd + notes
   * javobi chegaraga urilib, JSON o'rtasida kesilardi. Kesilgan JSON esa
   * parse bo'lmaydi — ya'ni butun deka yo'qoladi, faqat oxirgi slaydlar
   * emas. Shuning uchun reja bo'laklarga bo'linadi va har bo'lak alohida
   * so'raladi; bittasi yiqilsa qolgani saqlanadi.
   *
   * Har chaqiruvga TO'LIQ ketma-ketlik beriladi — model o'z bo'lagi
   * atrofida nima borligini bilmasa, slaydlar bir-birini takrorlaydi.
   */
  const CHUNK = 8;
  const ranges: { from: number; to: number }[] = [];
  if (plan.length > 10) {
    for (let i = 0; i < plan.length; i += CHUNK) {
      ranges.push({ from: i, to: Math.min(plan.length, i + CHUNK) });
    }
  } else {
    ranges.push({ from: 0, to: plan.length });
  }

  const askRange = async (from: number, to: number, done: string[]): Promise<SlideModel[]> => {
    const n = to - from;
    const scoped = ranges.length > 1;
    const user = [
      `«${meta.topic}» bo‘yicha shablon: ${tpl.nameUz} (${tpl.blurb}).`,
      scoped
        ? `Butun taqdimot rejasi (${plan.length} slayd) — kontekst uchun:`
        : `AYNAN ${want} ta slayd. QAT’IY shu tartibda (layout ni o‘zgartirmang):`,
      seq,
      scoped
        ? `SIZ FAQAT ${from + 1}–${to} slaydlarni yozasiz — aynan ${n} ta, shu tartibda. Boshqa slaydlarni yozmang.`
        : `Har slayd mazmuni shu rolga mos, mavzudan chiqmasin. Slaydlar bir-birini takrorlamasin.`,
      done.length
        ? `ALLAQACHON YOZILGAN slayd sarlavhalari — ularning mavzusini va raqamlarini TAKRORLAMANG:\n${done.map((t, i) => `${i + 1}) ${t}`).join("\n")}`
        : "",
      /*
       * `layout` enumida «table» YO'Q edi, garchi pastdagi `table`
       * ma'lumot maydoni va renderer (`slide-layout.ts` `case "table"`)
       * allaqachon bor edi. Natijada `report`/`defense` shablonlarining
       * `{ layout: "table", role: "..." }` beat'i model tomonidan hech
       * qachon bajarilmasdi — model enumda yo'q qiymatni tanlay olmaydi,
       * `coerceLayout` esa uni boshqa layoutga (odatda `bullets`) majburlab
       * qo'yardi. Deck jadval va'da qilingan joyda ham jadvalsiz chiqardi.
       */
      `JSON sxema: {"slides":[{"layout":"title|agenda|section|bullets|twoCol|compare|quote|stats|process|table|closing","kicker":"","title":"","subtitle":"","imageHint":"","notes":"","bullets":[""],"leftTitle":"","left":[""],"rightTitle":"","right":[""],"quote":"","quoteBy":"","stats":[{"value":"","label":""}],"steps":[{"n":"1","title":"","text":""}],"table":{"headers":["",""],"rows":[["",""]]}}]}`,
    ].join("\n");
    const maxTokens = Math.min(9_000, 2_000 + n * 420);
    /*
     * Timeout QOLGAN byudjetdan olinadi.
     *
     * Ilgari bu yerda qat'iy `90_000` turardi va `deadline` bu funksiyaga
     * umuman yetib kelmasdi. 16 slaydli deka ikki bo'lak + qayta
     * urinishlar bilan eng yomon holatda 4 × 90 = 360 s olardi, slaydga
     * ajratilgan byudjet esa 180 s edi. Matn byudjetni yeb bo'lgach,
     * `buildSlideAcademicDoc` rasmga manfiy vaqt hisoblar va rasm
     * bosqichi JIM o'tkazib yuborilardi — aynan «sifatliroq rasm» deb
     * 6 000–8 000 tanga to'langan premium paketlarda.
     */
    const left = remainingMs(deadline);
    if (left < 8_000) {
      console.warn("[slide-write] byudjet tugadi, bo‘lak tashlandi", from + 1, "-", to);
      return [];
    }
    const raw = await llmComplete(slideSystem(meta, tpl), user, maxTokens, {
      json: true,
      timeoutMs: Math.min(90_000, left),
    });
    if (!raw) {
      console.warn("[slide-write] bo‘lak javobsiz", from + 1, "-", to);
      return [];
    }
    return parseDeckJson(raw, footer, n, rules);
  };

  /*
   * Natija ABSOLYUT o'rin bo'yicha yig'iladi.
   *
   * Oddiy birlashtirish (`flat()`) xavfli: bir bo'lak so'ralgandan bitta
   * ko'p yoki kam slayd qaytarsa, undan keyingi hamma slayd bir qadam
   * siljiydi va `coerceLayout` ularga BOSHQA rejadagi layoutni majburlab
   * qo'yadi — masalan `quote` slaydini `stats` ga aylantiradi. Shuning
   * uchun har slayd o'z o'rniga qo'yiladi, ortiqchasi kesiladi,
   * yetishmagani esa faqat bo'sh joy qoldiradi.
   */
  /*
   * Bo'laklar KETMA-KET so'raladi.
   *
   * Parallel variant tezroq edi (33s ga qarshi ~50s), lekin sinovda aniq
   * kamchilik ko'rindi: 16 slaydli dekada 2- va 11-slayd deyarli bir xil
   * chiqdi — ikkala bo'lak bir-birining nima yozganini bilmasdi. Reja
   * ketma-ketligi rolni ajratadi, mazmunni esa yo'q. Endi keyingi bo'lak
   * oldingilarning sarlavhalarini oladi.
   */
  const slots: (SlideModel | undefined)[] = new Array(plan.length);
  const written: string[] = [];
  const parts: SlideModel[][] = [];
  for (const r of ranges) {
    let got = await askRange(r.from, r.to, written);
    /*
     * Bo'lak so'ralganidan kam slayd bilan qaytishi mumkin (javob token
     * chegarasiga urilishi yoki modelning shunchaki kamroq berishi
     * mumkin) — bu asosiy sabab «premium_long» 16 ta emas 12 ta bilan
     * yakunlanardi. Bitta qayta urinish (`rawOutline`/`writeAbstracts`
     * naqshi) ko'pincha yetishmagan slaydlarni tiklaydi; yaxshiroq
     * natija olinadi, yomoni tashlab yuboriladi.
     */
    // Qayta urinish faqat vaqt qolganda: u yaxshilash, majburiyat emas.
    if (got.length < r.to - r.from && remainingMs(deadline) > 25_000) {
      const retry = await askRange(r.from, r.to, written);
      if (retry.length > got.length) got = retry;
    }
    parts.push(got);
    for (const sl of got) if (sl.title) written.push(sl.title);
  }
  if (!plan.length) {
    // Reja yo'q (`want` betlar sonidan chiqarilgan) — hizalashga asos yo'q.
    slots.push(...parts.flat());
  } else {
    ranges.forEach((r, i) => {
      parts[i].slice(0, r.to - r.from).forEach((sl, k) => {
        slots[r.from + k] = sl;
      });
    });
  }
  /**
   * `id` ABSOLYUT o'rin bo'yicha qayta beriladi.
   *
   * `normalizeSlide` indeksni BO'LAK ichidan oladi, ya'ni har bo'lak
   * `s0` dan qayta boshlaydi. 16 slaydli deka ikki bo'lakdan yig'iladi
   * va natijada `s0…s7` IKKI MARTA uchraydi. Uch oqibati bor edi:
   *
   *   1. React ko'ruvchida «two children with the same key» xatosi —
   *      16 slaydli dekada 24 ta konsol xatosi;
   *   2. bir xil kalitli bolalar dublikat yoki tushib qolishi mumkin,
   *      ya'ni ko'ruvchi noto'g'ri slaydni ko'rsatishi mumkin;
   *   3. eng jiddiyisi — `slide-images.ts` rasm promptini `prompts[s.id]`
   *      bo'yicha izlaydi. Takroriy id bilan dekaning IKKINCHI yarmi
   *      birinchi yarmining rasm promptini olardi, ya'ni premium
   *      taqdimotda rasmlar takrorlanardi.
   *
   * Raqamlash birlashtirish va filtrlashdan KEYIN qilinadi — shunda
   * bo'lakka bog'liq bo'lmagan holda noyoblik kafolatlanadi.
   */
  const slides = renumberSlides(
    slots
      .map((sl, i) => (sl && plan[i] ? coerceLayout(sl, plan[i].layout, rules.maxBullets) : sl))
      .filter((sl): sl is SlideModel => Boolean(sl)),
  );
  /*
   * Va'da qilingan hajmning quyi chegarasi. Bundan kam bo'lsa deck
   * paketga mos kelmaydi; `null` qaytarib, chaqiruvchi pulni qaytaradi.
   *
   * Ilgari 0.75 edi — «premium_long» (16 slayd, 8 000 tanga) shu bilan
   * 12 tasi bilan ham yakunlanardi, garchi foydalanuvchi aniq «16»
   * ko'rgan bo'lsa ham. Yuqoridagi qayta urinish yetishmovchilikning
   * katta qismini yopadi, shuning uchun chegara endi 0.85 — birdaniga
   * 1.0 ga emas (ba'zi mavzularda ikkinchi urinishdan keyin ham bir-ikki
   * slayd kam qolishi mumkin, buni butunlay rad etish ko'proq FAILED va
   * qayta-urinishga olib keladi).
   */
  const floor = Math.max(6, Math.ceil(want * 0.85));
  if (slides.length < floor) {
    console.warn("[slide-write] too few slides", slides.length, "want", want);
    return null;
  }
  const L = slideLabels(meta.language);
  if (meta.titleSlide === false) {
    // Foydalanuvchi titul slaydini xohlamadi — model baribir yozgan bo‘lsa olib tashlaymiz.
    while (slides.length > 1 && slides[0].layout === "title") slides.shift();
  } else if (slides[0].layout !== "title") {
    slides.unshift({
      id: "title-fix",
      layout: "title",
      title: meta.topic,
      subtitle: meta.workLabel,
      kicker: meta.subject && meta.subject !== meta.workLabel ? meta.subject : L.presentation,
      footer,
    });
  } else {
    const kick = clip(slides[0].kicker || meta.subject || L.presentation, 28);
    const same = kick.toLowerCase() === meta.topic.toLowerCase();
    slides[0] = {
      ...slides[0],
      title: meta.topic,
      kicker: same ? clip(meta.subject || meta.workLabel || L.presentation, 28) : kick,
    };
  }
  if (slides[slides.length - 1].layout !== "closing") {
    slides.push({
      id: "end-fix",
      layout: "closing",
      title: L.conclusion,
      subtitle: L.questions,
      footer,
    });
  }
  // Interfeys matnlari MODELDA to'ldiriladi, layoutda emas: `planSlide`
  // tilni bilmaydi va ilgari u yerda o'zbekcha «Savollar va muhokama» /
  // «Taqdimot» qattiq yozilgan edi — ruscha taqdimot aralash chiqardi.
  const last = slides[slides.length - 1];
  if (last.layout === "closing" && !last.subtitle) last.subtitle = L.questions;
  if (slides[0].layout === "title" && !slides[0].kicker) slides[0].kicker = L.presentation;
  return slides;
}

/** Byudjetsiz (test/dev) chaqiruv uchun taxminiy umumiy vaqt. */
const SLIDE_FALLBACK_BUDGET_MS = 180_000;

/** Matn bosqichiga ajratiladigan ulush. Qolgani rasmga, ozi yig'ishga. */
const TEXT_SHARE = 0.62;
/** PPTX yig'ish va saqlashga ajratiladigan zaxira. */
const ASSEMBLY_MS = 12_000;

export type SlideStageBudget = { textMs: number; imageMs: number; assemblyMs: number };

/**
 * Byudjetni bosqichlar orasida OLDINDAN taqsimlaydi.
 *
 * Ildiz sabab shu yerda edi: bosqichlar byudjetni bo'lishmasdi. Matn
 * `writeSlidesWithLlm` da cheksiz (qat'iy 90 s × 4 chaqiruv) ishlar,
 * rasm esa «qolganini» olardi:
 *
 *   const budget = deadline ? Math.max(0, deadline - Date.now() - 12_000) : 60_000;
 *
 * Matn byudjetni yeb bo'lsa bu ifoda 0 berar va `attachSlideImages`
 * birinchi tekshiruvdayoq hamma slaydni o'tkazib yuborardi — deck
 * `COMPLETED` bo'lib, rasmsiz chiqardi. Hech qanday signal yo'q,
 * `console.warn` dan boshqa.
 *
 * Endi matn O'Z ulushini oladi va undan oshib keta olmaydi (u
 * `deadline` ni haqiqatan o'qiydi), shuning uchun rasmga vaqt QOLISHI
 * kafolatlanadi. Ulush 62/38 — matn og'irroq, chunki usiz deck umuman
 * yo'q; lekin rasm hech qachon nolga tushmaydi.
 */
export function slideStageBudget(deadline?: number, now = Date.now()): SlideStageBudget {
  const total = deadline ? Math.max(0, deadline - now) : SLIDE_FALLBACK_BUDGET_MS;
  // Juda kichik byudjetda ham yig'ishga joy qoldiramiz, lekin hammasini emas.
  const assemblyMs = Math.min(ASSEMBLY_MS, Math.round(total * 0.1));
  const usable = Math.max(0, total - assemblyMs);
  const textMs = Math.round(usable * TEXT_SHARE);
  return { textMs, imageMs: usable - textMs, assemblyMs };
}

export async function buildSlideAcademicDoc(meta: DocMeta, deadline?: number): Promise<AcademicDoc> {
  const themeId = (meta.slideTheme || "atlas") as SlideThemeId;
  getSlideTheme(themeId);
  const tpl = resolveSlideTemplate(meta.slideTemplate, meta.topic, meta.extra);
  // Sifat paketi shu yerda haqiqiy slaydlar soniga aylanadi.
  const beats = expandBeats(tpl, wantSlides(meta, tpl));
  const stage = slideStageBudget(deadline);
  const written = await writeSlidesWithLlm(meta, tpl, beats, Date.now() + stage.textMs);
  // Kalit bor, lekin matn yozilmadi — shablon deck bermaymiz. `beatToSlide`
  // «Fotosintez: kirish / Asosiy qism / Amaliyot» kabi bo'sh slaydlar
  // yaratadi va foydalanuvchi buni to'lagan ishi deb oladi. Xato bo'lsa
  // worker kreditni qaytaradi.
  if (!written && llmEnabled()) {
    throw new Error("Taqdimot matni yozilmadi. Kredit qaytariladi — qayta urinib ko‘ring.");
  }
  const slides = written ?? fallbackSlides(meta, tpl, beats);
  /*
   * Matn erta tugagan bo'lsa ortgan vaqt ham rasmga o'tadi — ulush
   * pastki chegara, shift emas. Yig'ish zaxirasi har doim ayriladi.
   */
  const budget = deadline
    ? Math.max(0, deadline - Date.now() - stage.assemblyMs)
    : stage.imageMs;
  /*
   * Rasm bosqichining hisoboti SAQLANADI.
   *
   * Ilgari bu chaqiruvning natijasi tashlab yuborilardi: fal.ai hamma
   * so'rovni rad etsa ham (jonli sinovda 19/19 — `403 User is locked`)
   * deka `COMPLETED` bo'lib, rasmsiz chiqar, foydalanuvchi esa buni
   * faqat ekranga qarab taxmin qilardi. Endi hisobot `doc.slideImages`
   * ga tushadi va `deliveredCount` uni pul qaroriga aylantiradi.
   */
  const images = await attachSlideImages(slides, meta.topic, tpl.visual, budget, {
    premium: meta.premiumVisuals,
  });
  const sections = slides
    .filter((s) => s.layout !== "title" && s.layout !== "closing")
    .map((s) => ({
      id: s.id,
      title: s.title,
      blocks: (s.bullets?.length ? s.bullets : [s.subtitle || s.quote || s.title]).map((text) => ({
        kind: "p" as const,
        text,
      })),
    }));
  return {
    meta,
    titlePage: true,
    toc: true,
    sections,
    slideTheme: themeId,
    slideTemplate: tpl.id,
    slides,
    slideImages: images,
  };
}
