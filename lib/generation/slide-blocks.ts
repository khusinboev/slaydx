import { PLAN_ITEMS_DEFAULT } from "./slide-params";
import type { SlideLayout } from "./slide-types";
import { expandBeats, type SlideBeat, type SlideTemplate } from "./slide-templates";
import type { DocMeta } from "./types";

/**
 * Tuzilma BLOKLARI — foydalanuvchi yoqadi/o'chiradi.
 *
 * Shablon (`beats`/`fillers`) tuzilmani berardi, foydalanuvchi esa unga
 * ta'sir qila olmasdi. Endi: taqdimot turi standart bloklarni beradi
 * (`purposeDefaults`), foydalanuvchi ularni o'zgartiradi, `blocksToBeats`
 * esa shablon beats'iga kiritadi/olib tashlaydi.
 *
 * Har blok — layout + rol matni (LLM promptiga tushadi) + `anchor`
 * (dekaning qayeriga kiradi). `test` → yangi `quiz` maketi,
 * `adabiyotlar` → yangi `references` maketi, `diagramma` → `stats`
 * majburiy chart rejimida (`SlideModel.chart`).
 */
export const SLIDE_BLOCK_IDS = [
  "reja",
  "maqsadlar",
  "motivatsiya",
  "amaliyot",
  "test",
  "uyga_vazifa",
  "jadval",
  "diagramma",
  "adabiyotlar",
] as const;
export type SlideBlockId = (typeof SLIDE_BLOCK_IDS)[number];

export function isSlideBlockId(v: string): v is SlideBlockId {
  return (SLIDE_BLOCK_IDS as readonly string[]).includes(v);
}

export type SlideBlockAnchor = "after-title" | "early" | "middle" | "late" | "end";

export type SlideBlock = {
  id: SlideBlockId;
  label: string;
  layout: SlideLayout;
  role: (meta: Pick<DocMeta, "planItems" | "quizCount">) => string;
  anchor: SlideBlockAnchor;
  /** `stats` uchun: diagramma majburiy. */
  chart?: boolean;
};

export const SLIDE_BLOCKS: SlideBlock[] = [
  { id: "reja", label: "Reja", layout: "agenda", anchor: "after-title", role: (m) => `Reja — aynan ${m.planItems} ta band` },
  { id: "maqsadlar", label: "Maqsadlar", layout: "bullets", anchor: "early", role: () => "Maqsadlar — tinglovchi nimani bilib oladi (fe’l bilan)" },
  { id: "motivatsiya", label: "Motivatsiya", layout: "quote", anchor: "early", role: () => "Motivatsiya — mavzuga qiziqish uyg‘otadigan savol yoki fakt" },
  { id: "amaliyot", label: "Amaliyot", layout: "process", anchor: "middle", role: () => "Amaliyot — auditoriya bajaradigan qadamlar" },
  { id: "test", label: "Test", layout: "quiz", anchor: "late", role: (m) => `Nazorat testi — ${m.quizCount} ta savol, har birida 4 variant` },
  { id: "uyga_vazifa", label: "Uyga vazifa", layout: "bullets", anchor: "late", role: () => "Uyga vazifa — aniq topshiriq va muddat" },
  { id: "jadval", label: "Jadval", layout: "table", anchor: "middle", role: () => "Taqqoslash jadvali" },
  { id: "diagramma", label: "Diagramma", layout: "stats", anchor: "middle", chart: true, role: () => "Diagramma — bir xil birlikdagi 3–4 taqqoslanadigan ko‘rsatkich" },
  { id: "adabiyotlar", label: "Adabiyotlar", layout: "references", anchor: "end", role: () => "Adabiyotlar va manbalar" },
];

export const SLIDE_BLOCK_BY_ID = Object.fromEntries(SLIDE_BLOCKS.map((b) => [b.id, b])) as Record<SlideBlockId, SlideBlock>;

/** `test` bloki yoqilgan, lekin savollar soni tanlanmagan — shu qadar savol. */
export const QUIZ_COUNT_FALLBACK = 3;

/**
 * `chart` maydoni `SlideBeat` ga WP-0b da (koordinator) qo'shiladi.
 *
 * Bu ish oqimi WP-0a dan tarmoqlangani uchun tip bu yerda hali yo'q —
 * kesishma bilan yozamiz. Birlashgach kesishma ORTIQCHA bo'ladi, lekin
 * zararsiz (bir xil ixtiyoriy maydon). Aynan shu shakl tanlandi:
 * `@ts-expect-error` birlashgandan KEYIN yiqilardi, `as any` esa
 * `chart` ning tipini butunlay yo'qotardi.
 */
type ChartBeat = SlideBeat & { chart?: boolean };

/**
 * Bloklar dekaga chapdan o'ngga shu tartibda kiradi. `SLIDE_BLOCKS`
 * ro'yxati MAHSULOT tartibida (formada shunday ko'rinadi), joylashuv
 * esa ANCHOR bo'yicha — ikkisini aralashtirsak `jadval` (o'rta)
 * `test` (oxir) dan keyin qo'yilardi.
 */
const ANCHOR_ORDER: SlideBlockAnchor[] = ["after-title", "early", "middle", "late", "end"];

type MarkedBeat = ChartBeat & {
  /** Shu beat foydalanuvchi BLOKI — hech qachon tashlanmaydi. */
  block?: SlideBlockId;
  /** Blok ankori — keyingi bloklar undan oldinga o'tib ketmasligi uchun. */
  anchor?: SlideBlockAnchor;
  /** Shu beat `expandBeats` TO'LDIRGICHI — birinchi navbatda tashlanadi. */
  filler?: boolean;
};

const anchorRank = (a: SlideBlockAnchor) => ANCHOR_ORDER.indexOf(a);

const beatKey = (b: SlideBeat) => `${b.layout}|${b.role}`;

/**
 * Blok MAVJUD beat bilan qo'shilishi mumkin bo'lgan hudud (yarim ochiq).
 *
 * `end` uchun bo'sh oraliq: `references` hech bir shablon beats'ida
 * yo'q, ya'ni qo'shiladigan beat ham yo'q — u doim yangi slayd bo'lib
 * kiradi va `closing` dan darhol oldin turadi.
 */
function mergeRange(anchor: SlideBlockAnchor, n: number): [number, number] {
  switch (anchor) {
    case "after-title":
      return [0, Math.min(1, n)];
    case "early":
      return [0, Math.ceil(n / 3)];
    case "middle":
      return [Math.floor(n / 3), Math.ceil((2 * n) / 3)];
    case "late":
      return [Math.floor((2 * n) / 3), n];
    case "end":
      return [n, n];
  }
}

/**
 * Qo'shiladigan blok qaysi indeksga tushadi (title/closing chiqarilgan TANADA).
 *
 * Indeks `mergeRange` dan KELTIRILADI — ikkisi ajralib qolsa blok bir
 * hududda qidirilib, boshqasiga qo'yilardi.
 */
function insertIndex(anchor: SlideBlockAnchor, n: number): number {
  const [lo, hi] = mergeRange(anchor, n);
  switch (anchor) {
    case "after-title":
      return 0;
    case "early":
    case "middle":
      /*
       * Hududning OXIRGI o'rni, `hi` ning o'zi emas. Tana qo'shilgandan
       * keyin bir birlikka uzayadi va chegara ham suriladi: `hi` ga
       * qo'yilgan blok yangi o'lchovda hududdan BIR QADAM tashqarida
       * qolardi (7 ta beat, `early` = [0,3): 3-indeks 8 talik tanada
       * hamon [0,3) dan tashqarida).
       */
      return Math.max(lo, hi - 1);
    case "late":
    case "end":
      // Tana oxiri — `closing` dan darhol oldin; uzaygach ham `late` da.
      return n;
  }
}

/**
 * `expandBeats` ning to'ldirgich OQIMINI qaytaradi (avval shablonniki,
 * keyin umumiysi).
 *
 * `GENERIC_FILLERS` eksport qilinmagan va qilinmasligi ham kerak —
 * shuning uchun uzunroq deka so'rab, shablon beats'idan ORTGANINI
 * kesib olamiz. Shunda to'ldirish mantig'i bitta joyda qoladi va
 * `expandBeats` ning o'zi umuman o'zgarmaydi.
 */
function fillerPool(tpl: SlideTemplate, need: number): SlideBeat[] {
  if (need <= 0) return [];
  const base = expandBeats(tpl, 0);
  const cut = base[base.length - 1]?.layout === "closing" ? 1 : 0;
  const long = expandBeats(tpl, base.length + need);
  return long.slice(base.length - cut, long.length - cut);
}

/**
 * Yoqilgan bloklar — DEKADAGI tartibda (anchor bo'yicha).
 *
 * `blocksToBeats` ham, prompt ham (`slide-prompt/structure.ts`) aynan
 * shu YAGONA ro'yxatni ko'radi: beats'da bor slayd promptda tushib
 * qolsa, model uni qanday to'ldirishni bilmaydi (AUDIT-8 naqshi).
 *
 * Ikki blok belgisiz ham yoqiladi, chunki foydalanuvchi ularni boshqa
 * maydon bilan SO'RAGAN bo'ladi:
 *   `quizCount > 0`      → `test`
 *   `internetSearch`     → `adabiyotlar`
 * Ikkinchisining sababi: grounding manbalari hech qayerda
 * ko'rsatilmasa, tadqiqot qilingani foydalanuvchiga umuman
 * ko'rinmaydi — u to'lagan ish ko'zga tashlanmay qoladi.
 */
export function orderedBlocks(
  blocks: readonly SlideBlockId[] | undefined,
  quizCount = 0,
  internetSearch = false,
): SlideBlock[] {
  const on = new Set<SlideBlockId>(blocks ?? []);
  if (quizCount > 0) on.add("test");
  if (internetSearch) on.add("adabiyotlar");
  return ANCHOR_ORDER.flatMap((a) => SLIDE_BLOCKS.filter((b) => b.anchor === a && on.has(b.id)));
}

/** Yonma-yon bir xil layout turgan birinchi indeks; yo'q bo'lsa −1. */
function clumpAt(beats: SlideBeat[]): number {
  for (let i = 1; i < beats.length; i++) if (beats[i].layout === beats[i - 1].layout) return i;
  return -1;
}

/**
 * `beat` ni `at` ga qo'yish mumkinmi: yonma-yon takror bermasin VA
 * bloklarning ankor tartibini buzmasin (`references` `quiz` dan oldin
 * tushib qolmasin, `reja` esa boshdan siljimasin).
 */
function fits(beats: MarkedBeat[], at: number, beat: MarkedBeat): boolean {
  if (beats[at - 1]?.layout === beat.layout || beats[at]?.layout === beat.layout) return false;
  if (beat.anchor === undefined) return true;
  const r = anchorRank(beat.anchor);
  const prev = beats[at - 1]?.anchor;
  const next = beats[at]?.anchor;
  if (prev !== undefined && anchorRank(prev) > r) return false;
  if (next !== undefined && anchorRank(next) < r) return false;
  return true;
}

/**
 * `p` va `p+1` ni almashtirish ANKOR tartibini buzmaydimi.
 *
 * Bu shartsiz almashtirish `references` ni ikki `bullets` blokning
 * orasiga tashlardi: takror yo'qolardi, lekin «Adabiyotlar»
 * `closing` dan darhol oldin turish shartini yo'qotardi.
 */
function swapOk(beats: MarkedBeat[], p: number): boolean {
  const l = beats[p].anchor;
  const r = beats[p + 1]?.anchor;
  // Almashgach `r` chapga, `l` o'ngga o'tadi — tartib faqat `r <= l` da saqlanadi.
  if (l !== undefined && r !== undefined) return anchorRank(r) <= anchorRank(l);
  if (r === "end" || l === "after-title") return false;
  return true;
}

/**
 * Yonma-yon takrorlarni yo'qotadi (5-qoida).
 *
 * Avval qo'shni bilan ALMASHTIRIB ko'radi — eng kam buzuvchi harakat,
 * hech kim o'z hududidan chiqmaydi; bo'lmasa blok bo'lmagan nusxani
 * eng yaqin toza joyga ko'chiradi. Blok beat'i oxirgi navbatda
 * qimirlaydi va hech qachon TASHLANMAYDI. Sanagich cheklangan:
 * yechimsiz holatda hozirgi holat qaytariladi — bu `expandBeats`
 * ning o'zidagi xatti-harakatdan yomon emas (u ham mos kelmagan
 * to'ldirgichni shunchaki o'tkazib yuboradi).
 */
function deClump(beats: MarkedBeat[], pool: SlideBeat[]): void {
  for (let guard = 0; guard < 128; guard += 1) {
    const i = clumpAt(beats);
    if (i < 0) return;
    // 1) o'ng qo'shni bilan almashtirish
    if (i + 1 < beats.length && beats[i + 1].layout !== beats[i - 1].layout && beats[i + 2]?.layout !== beats[i].layout && swapOk(beats, i)) {
      [beats[i], beats[i + 1]] = [beats[i + 1], beats[i]];
      continue;
    }
    // 2) chap qo'shni bilan almashtirish
    if (i - 2 >= 0 && beats[i - 2].layout !== beats[i].layout && beats[i - 3]?.layout !== beats[i - 1].layout && swapOk(beats, i - 2)) {
      [beats[i - 1], beats[i - 2]] = [beats[i - 2], beats[i - 1]];
      continue;
    }
    // 3) ko'chirish — blok BO'LMAGANINI afzal ko'ramiz
    const from = !beats[i].block ? i : !beats[i - 1].block ? i - 1 : i;
    const [beat] = beats.splice(from, 1);
    let at = -1;
    for (let j = from + 1; j <= beats.length; j += 1) if (fits(beats, j, beat)) { at = j; break; }
    if (at < 0) for (let j = from - 1; j >= 0; j -= 1) if (fits(beats, j, beat)) { at = j; break; }
    beats.splice(at < 0 ? from : at, 0, beat);
    if (at >= 0) continue;
    /*
     * 4) Ko'chirib bo'lmadi — demak ikkala qo'shni ham BLOK va tanada
     *    boshqa layout qolmagan (`want=4` da `maqsadlar` va
     *    `uyga_vazifa`, ikkalasi ham `bullets`). Orasiga ajratgich
     *    qo'yiladi va deka bir slaydga uzayadi. Bu 6-qoidaning ayni
     *    o'zi: blok tashlanmaydi, `want` esa yon beradi.
     */
    const sep = pool.find((c) => c.layout !== beats[i].layout);
    if (!sep) return;
    beats.splice(i, 0, { ...sep, filler: true });
  }
}

/**
 * Foydalanuvchi bloklarini shablon beats'iga KIRITADI.
 *
 * Qoidalar (AUDIT-9, WP-B):
 *   1. Har yoqilgan blok `anchor` hududiga tushadi. Shu hududda AYNAN
 *      o'sha layoutli beat bo'lsa — yangi slayd qo'shilmaydi, mavjud
 *      beat'ning ROLI blok roli bilan almashtiriladi (qo'shiladi).
 *      Shu sabab «Dars» shablonida `maqsadlar` bloki slayd sonini
 *      oshirmaydi: shablonda allaqachon «Maqsad» bandlari bor.
 *   2. `reja` o'chirilgan yoki `agendaSlide === false` — `agenda`
 *      beat'lari butunlay olib tashlanadi.
 *   3. `quizCount > 0` testni SO'RAGAN demakdir: `test` bloki
 *      belgilanmagan bo'lsa ham `quiz` beat qo'yiladi. Aksi ham:
 *      blok bor, son yo'q — `QUIZ_COUNT_FALLBACK`. Xuddi shunday
 *      `internetSearch` `references` beat'ini keltiradi — tadqiqot
 *      manbalari ko'rsatilmasa tadqiqot QILINGANI ko'rinmaydi.
 *      Ikkalasi ham takrorlanmaydi: blok allaqachon yoqilgan bo'lsa
 *      bitta beat qoladi (`orderedBlocks` to'plam ustida ishlaydi).
 *   4. `title` doim boshida; `closing` doim oxirida va BITTA.
 *   5. Yonma-yon bir xil layout yo'q (`expandBeats` qoidasi saqlanadi).
 *   6. Uzunlik `want` ga keltiriladi: ortiqchasi to'ldirgich/oddiy
 *      beat'lardan qirqiladi, kami to'ldirgich oqimidan qo'shiladi.
 *      BLOKLAR HECH QACHON TASHLANMAYDI — `want` 4 bo'lib 6 blok
 *      yoqilsa deka `want` dan UZUN chiqadi: foydalanuvchining aniq
 *      tanlovi shablon uzunligidan ustun turadi.
 *   7. Deterministik: bir xil kirish → bir xil chiqish, tasodif yo'q.
 */
export function blocksToBeats(
  meta: Pick<DocMeta, "blocks" | "planItems" | "quizCount" | "agendaSlide" | "internetSearch">,
  tpl: SlideTemplate,
  beats: SlideBeat[],
  want: number,
): SlideBeat[] {
  const quizCount = (meta.quizCount ?? 0) > 0 ? meta.quizCount : QUIZ_COUNT_FALLBACK;
  const roleMeta = { planItems: meta.planItems || PLAN_ITEMS_DEFAULT, quizCount };
  const on = orderedBlocks(meta.blocks, meta.quizCount ?? 0, meta.internetSearch === true);
  const asBeat = (blk: SlideBlock): MarkedBeat => ({
    layout: blk.layout,
    role: blk.role(roleMeta),
    block: blk.id,
    anchor: blk.anchor,
    ...(blk.chart ? { chart: true } : {}),
  });

  /*
   * title/closing ajratiladi: ular hudud hisobiga KIRMAYDI (aks holda
   * «birinchi uchdan bir» doim title bilan band bo'lardi) va shu bilan
   * 4-qoida o'z-o'zidan bajariladi — nechta bo'lishidan qat'i nazar
   * bittasi boshida, bittasi oxirida qoladi.
   */
  const src: MarkedBeat[] = beats.map((b) => ({ ...(b as ChartBeat) }));
  const head = src.find((b) => b.layout === "title") ?? null;
  const tail = src.find((b) => b.layout === "closing") ?? null;
  const fillerKeys = new Set([...tpl.fillers, ...fillerPool(tpl, 24)].map(beatKey));
  let body: MarkedBeat[] = src
    .filter((b) => b.layout !== "title" && b.layout !== "closing")
    .map((b) => (fillerKeys.has(beatKey(b)) ? { ...b, filler: true } : b));

  // ── 2-qoida
  const keepAgenda = on.some((b) => b.id === "reja") && meta.agendaSlide !== false;
  if (!keepAgenda) body = body.filter((b) => b.layout !== "agenda");

  /*
   * ── 6-qoida BLOKLARDAN OLDIN bajariladi.
   *
   * Nega shunday tartib. Hududlar tananing UZUNLIGIDAN o'lchanadi.
   * Agar avval bloklarni joylab, keyin qirqsak, blok o'z o'rnida
   * qolgani holda «birinchi uchdan bir» chegarasi suriladi va blok
   * hududidan chiqib ketadi — 16 beat'li shablondan 6 slaydli deka
   * so'ralganda `motivatsiya` dekaning o'rtasiga tushardi. Shuning
   * uchun tana AVVAL yakuniy o'lchamga keltiriladi, qo'shiladigan
   * bloklar uchun joy qoldirib.
   */
  const bodyWant = Math.max(0, want - (head ? 1 : 0) - (tail ? 1 : 0));

  /** Tanani joyida `target` uzunlikka keltiradi; BLOKLARGA tegmaydi. */
  const resize = (out: MarkedBeat[], target: number): MarkedBeat[] => {
    /*
     * Ortiqcha beat qirqiladi. Har qadamda bitta ENG YAXSHI nomzod
     * tanlanadi (oxiridan boshlab), afzallik tartibi:
     *   0) to'ldirgich, qirqilsa yonma-yon takror yasamaydi
     *   1) shablonning oddiy beat'i, takror yasamaydi
     *   2) to'ldirgich, lekin qo'shnilari bir xil layout
     *   3) oddiy beat, qo'shnilari bir xil layout
     *
     * «Takror yasamaydi» sharti kerak: `want=4` li «Pitch» dekada
     * oxiridan ketma-ket qirqish `bullets, bullets` qoldirardi va uni
     * `deClump` ham yecholmasdi — tanada boshqa layout qolmagan edi.
     */
    while (out.length > target) {
      let pick = -1;
      let best = 9;
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (out[i].block) continue; // 6-qoida: blok hech qachon qirqilmaydi
        const clumps = i > 0 && i + 1 < out.length && out[i - 1].layout === out[i + 1].layout;
        const rank = (clumps ? 2 : 0) + (out[i].filler ? 0 : 1);
        if (rank < best) { best = rank; pick = i; }
        if (best === 0) break;
      }
      if (pick < 0) break; // faqat bloklar qoldi — deka `want` dan uzun qolaveradi
      out.splice(pick, 1);
    }
    /*
     * Kami to'ldirgich oqimidan qo'shiladi — yonma-yon takrorni
     * o'tkazib yuborib va OXIRIDAGI bloklardan oldin: `references`
     * («Adabiyotlar») `closing` dan darhol oldin turishi shart, uning
     * ortidan to'ldirgich qo'yilsa `end` ankori buzilardi.
     */
    let at = out.length;
    while (at > 0 && out[at - 1].block) at -= 1;
    for (let i = 0, guard = 0; out.length < target && guard < 256; i += 1, guard += 1) {
      const pool = fillerPool(tpl, (target - out.length) * 4 + 8);
      const cand = pool[i % pool.length];
      if (!cand || out[at - 1]?.layout === cand.layout || out[at]?.layout === cand.layout) continue;
      out.splice(at, 0, { ...cand, filler: true });
      at += 1;
    }
    return out;
  };

  /**
   * 1-qoida: har blokni O'Z hududidagi mos layoutli beat bilan
   * QO'SHADI (uzunlik o'zgarmaydi), qo'sha olmaganlarini qaytaradi.
   */
  const mergeInto = (arr: MarkedBeat[]): SlideBlock[] => {
    const rest: SlideBlock[] = [];
    for (const blk of on) {
      if (blk.id === "reja" && !keepAgenda) continue;
      const [lo, hi] = mergeRange(blk.anchor, arr.length);
      let at = -1;
      for (let i = lo; i < hi; i += 1) {
        if (arr[i].layout === blk.layout && !arr[i].block) { at = i; break; }
      }
      if (at < 0) rest.push(blk);
      else arr[at] = asBeat(blk);
    }
    return rest;
  };

  /*
   * Qirqim va qo'shish bir-biriga bog'liq: nechta beat qirqish kerakligi
   * nechta blok QO'SHILISHIGA, u esa qirqilgan tanaga bog'liq. Qo'zg'almas
   * nuqta bir-ikki qadamda topiladi (blok soni ≤ 9, ya'ni oraliq kichik);
   * topilmasa oxirgi baho olinadi — uzunlik `deClump` dan keyin baribir
   * to'g'ri, chunki qo'shish soni ayni shu bahodan kelib chiqadi.
   */
  const base = body;
  const trial = (target: number) => resize(base.map((b) => ({ ...b })), Math.max(0, target));
  let k = 0;
  for (let iter = 0; iter < 4; iter += 1) {
    const k2 = mergeInto(trial(bodyWant - k)).length;
    if (k2 === k) break;
    k = k2;
  }
  body = trial(bodyWant - k);
  const pending = mergeInto(body);

  /*
   * Qolgan bloklar QO'SHILADI — tana allaqachon yakuniy o'lchamda,
   * ya'ni hududlar ham yakuniy. Indekslar qo'shishdan OLDINGI
   * uzunlikdan hisoblanadi va guruhlar o'ngdan chapga joylanadi:
   * shunda oldin hisoblangan indekslar surilmaydi va natija
   * 7-qoidaga ko'ra deterministik qoladi.
   */
  const n0 = body.length;
  for (let a = ANCHOR_ORDER.length - 1; a >= 0; a -= 1) {
    const anchor = ANCHOR_ORDER[a];
    const group = pending.filter((b) => b.anchor === anchor);
    if (!group.length) continue;
    let at = Math.min(insertIndex(anchor, n0), body.length);
    /*
     * OLDINGI ankor blokidan oldinga o'tib ketmaslik. `reja`
     * (`after-title`) shablonning `agenda` beat'i bilan QO'SHILGAN
     * bo'lsa u allaqachon 0-indeksda turadi; kichik tanada `early`
     * ning hisoblangan o'rni ham 0 bo'lib chiqadi va `maqsadlar`
     * rejadan OLDIN tushardi.
     */
    while (at < body.length) {
      const other = body[at].anchor;
      if (other === undefined || anchorRank(other) >= anchorRank(anchor)) break;
      at += 1;
    }
    body.splice(at, 0, ...group.map(asBeat));
  }

  /*
   * Yakuniy uzunlik. Qo'zg'almas nuqta (`k`) deyarli har doim topiladi,
   * lekin qirqim mergani, merga esa qirqimni o'zgartiradigan chekka
   * holatlar bor. Shu sabab uzunlik OXIRIDA yana bir marta qat'iy
   * tenglashtiriladi — endi bloklar belgilangan, ya'ni ular tegilmaydi.
   */
  resize(body, bodyWant);

  // ── 5-qoida
  deClump(body, fillerPool(tpl, 12));

  // Ichki belgilar (`block`/`filler`) tashqariga CHIQMAYDI.
  return [...(head ? [head] : []), ...body, ...(tail ? [tail] : [])].map(
    (b) => (b.chart ? { layout: b.layout, role: b.role, chart: true } : { layout: b.layout, role: b.role }) as SlideBeat,
  );
}
