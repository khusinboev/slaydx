import { slideLabels } from "./i18n";
import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { remainingMs } from "./quality";
import { bodyRules, type BodyRules } from "./slide-audience";
import { blocksToBeats } from "./slide-blocks";
import { deckFooter } from "./slide-identity";
import { purposeDefaults } from "./slide-purpose";
import { attachSlideImages } from "./slide-images";
import { SLIDE_MAX } from "./slide-params";
import { deckJsonSchema, slideSystem, type SlidePromptCtx } from "./slide-prompt";
import { runSlideResearch } from "./slide-research";
import { expandBeats, resolveSlideTemplate, type SlideBeat, type SlideTemplate } from "./slide-templates";
import { getSlideTheme } from "./slide-themes";
import { isSlideLayout, type SlideLayout, type SlideModel, type SlideThemeId } from "./slide-types";
import type { AcademicDoc, DocMeta } from "./types";

/*
 * Slide Law: bir slaydda 3–4 tadan ortiq band bo'lmasin. Aniq chegara
 * auditoriya × matn hajmidan (`bodyRules`): maktab sinfida 3 ta qisqa
 * band, himoyada 4 ta. Agenda chegarasi endi `planItems` (3–6) —
 * ilgari qat'iy 5 edi va forma tanlovi unga yetib bormasdi.
 */

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

type BulletRules = Pick<BodyRules, "maxBullets" | "bulletChars" | "agendaMax">;

/**
 * Slayd `id` larini absolyut o'rin bo'yicha qayta raqamlaydi.
 *
 * `normalizeSlide` indeksni bo'lak ichidan oladi, shuning uchun uzun
 * deka bo'laklardan yig'ilganda `s0…s7` bir necha marta uchraydi. Bu
 * funksiya birlashtirishdan keyin chaqiriladi va noyoblikni bo'laklar
 * soniga bog'liq bo'lmagan holda kafolatlaydi.
 */
/**
 * `references` slaydiga HAQIQIY manbalarni qo'yadi.
 *
 * Model `refs` ni tadqiqot ro'yxatidan ko'chirishi so'raladi, lekin u
 * bo'sh qoldirishi yoki uydirishi mumkin. Tadqiqot bo'lsa — manbalar
 * FAQAT undan (uydirma bo'lmasin); bo'lmasa model yozgani qoladi,
 * `references` maketi buni «tekshirilmagan» deb belgilaydi (WP-C).
 */
function applyResearchRefs(slides: SlideModel[], ctx: SlidePromptCtx) {
  const sources = ctx.research?.sources ?? [];
  if (!sources.length) return;
  for (const sl of slides) {
    if (sl.layout !== "references") continue;
    sl.refs = sources.slice(0, 6).map((src) => ({ title: src.title, source: src.uri }));
  }
}

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
  const limit = layout === "agenda" ? rules.agendaMax : rules.maxBullets;
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
  const footer = deckFooter(meta);
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
  // 20 chegarasi pro slaydning 30 tasini jimgina 20 ga qirqardi.
  const pack = Math.max(4, Math.min(SLIDE_MAX, meta.targetPages || 10));
  return Math.max(Math.min(tpl.beats.length || 8, pack), pack);
}

export async function writeSlidesWithLlm(
  meta: DocMeta,
  tpl: SlideTemplate,
  beats: SlideBeat[] = tpl.beats,
  deadline?: number,
  ctx: SlidePromptCtx = {},
): Promise<SlideModel[] | null> {
  if (!llmEnabled()) return null;
  const rules = bodyRules(meta, tpl.id);
  const plan = meta.titleSlide === false ? beats.filter((b) => b.layout !== "title") : beats;
  const want = plan.length || Math.max(4, Math.min(SLIDE_MAX, meta.targetPages || 10));
  const footer = deckFooter(meta);
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
      deckJsonSchema(),
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
    const raw = await llmComplete(slideSystem(meta, tpl, ctx), user, maxTokens, {
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
      // «Diagramma» bloki beat'dagi `chart` bayrog'ini slaydga o'tkazadi (WP-B qo'yadi).
      .map((sl, i) => (sl && plan[i]?.chart ? { ...sl, chart: true } : sl))
      .filter((sl): sl is SlideModel => Boolean(sl)),
  );
  applyResearchRefs(slides, ctx);
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

export type SlideStageBudget = { researchMs: number; textMs: number; imageMs: number; assemblyMs: number };

/** Tadqiqot bosqichi (grounding) — usable ning shu ulushi, lekin 30 s dan oshmaydi. */
const RESEARCH_SHARE = 0.08;
const RESEARCH_MAX_MS = 30_000;

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
export function slideStageBudget(
  deadline?: number,
  now = Date.now(),
  opts: { research?: boolean } = {},
): SlideStageBudget {
  const total = deadline ? Math.max(0, deadline - now) : SLIDE_FALLBACK_BUDGET_MS;
  // Juda kichik byudjetda ham yig'ishga joy qoldiramiz, lekin hammasini emas.
  const assemblyMs = Math.min(ASSEMBLY_MS, Math.round(total * 0.1));
  const afterAssembly = Math.max(0, total - assemblyMs);
  // Tadqiqot faqat so'ralganda ulush oladi — aks holda matn/rasm to'liq.
  const researchMs = opts.research ? Math.min(RESEARCH_MAX_MS, Math.round(afterAssembly * RESEARCH_SHARE)) : 0;
  const usable = afterAssembly - researchMs;
  const textMs = Math.round(usable * TEXT_SHARE);
  return { researchMs, textMs, imageMs: usable - textMs, assemblyMs };
}

/**
 * Deck shabloni: foydalanuvchi tanlagani → taqdimot turi standarti →
 * mavzudan taxmin. YAGONA joy — differensial test ham shuni chaqiradi.
 */
export function resolveDeckTemplate(meta: DocMeta): SlideTemplate {
  const purpose = purposeDefaults(meta.slidePurpose);
  const wanted = !meta.slideTemplate || meta.slideTemplate === "auto" ? purpose.templateId : meta.slideTemplate;
  return resolveSlideTemplate(wanted, meta.topic, meta.extra);
}

export type SlideBuildOpts = {
  /** Logotip — `data:` URL (worker `logo_uploads` dan o'qiydi). */
  logo?: string;
};

export async function buildSlideAcademicDoc(meta: DocMeta, deadline?: number, opts: SlideBuildOpts = {}): Promise<AcademicDoc> {
  const themeId = (meta.slideTheme || "atlas") as SlideThemeId;
  getSlideTheme(themeId);
  /*
   * Shablon: foydalanuvchi tanlagan bo'lsa u; «auto» bo'lsa TAQDIMOT TURI
   * standarti (dars → `lesson`, himoya → `defense`…); tur ham `general`
   * bo'lsa — mavzudan (`inferSlideTemplate`). Ya'ni tur parametri o'z
   * ta'sirini shu yerda ko'rsatadi, bloklar esa `blocksToBeats` da.
   */
  const tpl = resolveDeckTemplate(meta);
  // Sifat paketi / slayder shu yerda haqiqiy slaydlar soniga aylanadi,
  // foydalanuvchi bloklari esa shablon beats'iga kiritiladi.
  const want = wantSlides(meta, tpl);
  const beats = blocksToBeats(meta, tpl, expandBeats(tpl, want), want);
  const stage = slideStageBudget(deadline, Date.now(), { research: meta.internetSearch });
  /*
   * Tadqiqot deck yozuvidan OLDIN va alohida chaqiruvda: grounding JSON
   * rejimi bilan birga ishlamaydi (jonli tasdiqlangan). Yiqilsa deck
   * baribir yoziladi — `research: null`.
   */
  const research = stage.researchMs > 0 ? await runSlideResearch(meta, Date.now() + stage.researchMs) : null;
  const ctx: SlidePromptCtx = { research };
  const written = await writeSlidesWithLlm(meta, tpl, beats, Date.now() + stage.researchMs + stage.textMs, ctx);
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
    slideResearch: research ?? undefined,
    slideLogo: opts.logo ? { url: opts.logo } : undefined,
  };
}
