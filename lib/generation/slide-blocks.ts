import { PLAN_ITEMS_DEFAULT, activeBlockIds, planBudgetForBody } from "./slide-params";
import { purposeDefaults } from "./slide-purpose";
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
 * Bitta `quiz` slaydiga sig'adigan savol soni.
 *
 * Maket qarori (WP-C, `slide-layout-extra.ts`): to'rt variantli savol
 * slayd balandligining yarmini egallaydi, ikkitasi sig'sa ham o'qib
 * bo'lmaydigan darajada mayda chiqadi. Ya'ni 1 savol = 1 slayd.
 * X-3 da bu son REJAGA ko'chdi — nechta savol so'ralgan bo'lsa,
 * shuncha `quiz` beat qo'yiladi va deka uzunligi keyin o'smaydi.
 */
export const QUIZ_PER_SLIDE = 1;

/**
 * Javoblar kaliti — izohlar o'chirilganda (`speakerNotes: false`)
 * javoblar hech qayerda qolmaydi, shuning uchun REJAGA alohida
 * `answers` slaydi kiradi. Ilgari uni `finalizeQuiz` deka yozilgandan
 * KEYIN qo'shardi va deka rejadan bir slayd uzun chiqardi (X-3).
 */
const ANSWERS_ROLE = "Test javoblari kaliti — har savol raqami va to‘g‘ri variant harfi";

/**
 * Sig'im yetmaganda test guruhi tananing eng ko'pi bilan `1/TEST_SHARE`
 * ulushini oladi (X-5).
 *
 * Nega shift kerak. `quizCount` — foydalanuvchi ANIQ kiritgan son, ya'ni
 * u shablondan kelgan standart blokdan ustun. Lekin cheklovsiz ustunlik
 * darsni testga aylantirardi: 10 slaydli dekada 3 savol + kalit qo'yish
 * uchun BESHTA blokdan ikkitasini tashlash kerak bo'lardi va mazmun
 * slaydlaridan uchtagina qolardi. Uchdan bir — o'lchangan muvozanat:
 * 8 ta tanali dekada test guruhi 3 o'rin oladi (2 savol + kalit), qolgan
 * beshtasi mazmun bo'lib qoladi.
 */
const TEST_SHARE = 3;

/**
 * Sig'im yetmaganda BIRINCHI yon beradigan bloklar (X-5).
 *
 * Faqat ular taqdimot TURINING standartidan kelgan bo'lsa
 * (`purposeDefaults`) — ya'ni foydalanuvchi ularni formada QO'LDA
 * yoqmagan bo'lsa. AUDIT-25 dan keyin boshqa bloklar ham yon berishi
 * mumkin (reja slaydlari va `want` uchun, 6-qoida), lekin FAQAT shu
 * beshtasi tugagandan keyin.
 *
 * Ro'yxatdan chiqarilganlar va sababi:
 *   `reja`        — o'z maydonlari bor (`agendaSlide`, `planItems`), ya'ni
 *                   `quizCount` bilan bir darajadagi aniq tanlov;
 *   `test`        — guruhning O'ZI;
 *   `adabiyotlar` — `internetSearch` uni so'raydi va `structure.ts` da
 *                   o'z prompt qoidasi bor;
 *   `diagramma`   — `structure.ts` da o'z qoidasi bor (`chart: true`).
 * Oxirgi ikkisi uchun sabab bitta: rejadan tushib qolgan blokning prompt
 * qatori modelga YOLG'ON va'da bo'lardi (AUDIT-8 naqshi) — shuning uchun
 * ular faqat oxirgi chorada tashlanadi.
 */
const YIELDING_BLOCKS = new Set<SlideBlockId>(["maqsadlar", "motivatsiya", "amaliyot", "uyga_vazifa", "jadval"]);

/** Har `quiz` slaydining roli: modelga AYNAN bitta savol yozishni aytadi. */
function quizRole(i: number, n: number): string {
  return `Nazorat testi (jami ${n} ta savol) — ${i + 1}-savol: AYNAN bitta savol va 4 variant`;
}

/**
 * REJA BANDI slaydining roli (AUDIT-25).
 *
 * Model promptdagi ketma-ketlikda shu prefiksni ko'radi va slaydni
 * rejaning i-bandi deb yozadi; `:` dan keyingi qism — shablonning
 * burchagi (maket va ohang ishorasi), band nomi emas. Prefiks formati
 * `slide-prompt/structure.ts` dagi qoida bilan BIR XIL bo'lishi shart.
 */
export function planRole(i: number, role: string): string {
  return `REJA ${i}-band: ${role}`;
}

/** Roldan «REJA i-band:» prefiksini olib tashlaydi (skelet sarlavhasi, agenda). */
export function planRoleText(role: string): string {
  return role.replace(/^REJA \d+-band: /, "");
}

/**
 * Reja bandining MAZMUN slaydi bo'la oladigan maketlar.
 *
 * `quote` va `section` — yo'q: band o'z slaydini olishi kerak, bitta
 * iqtibos yoki sarlavha-ajratgich esa band mazmunini bermaydi (AUDIT-25
 * S4 — «axboriy matn kam»). Blok maketlari (`agenda`, `quiz`,
 * `answers`, `references`) — ular bloklarniki.
 */
const PLAN_CONTENT = new Set<SlideLayout>(["bullets", "twoCol", "compare", "process", "table", "stats"]);

/** Qo'shimcha (reja bandiga bog'lanmagan) slaydlar — mazmun maketlari + iqtibos. */
const EXTRA_LAYOUTS = new Set<SlideLayout>([...PLAN_CONTENT, "quote"]);

/**
 * Bloklar dekaga chapdan o'ngga shu tartibda kiradi. `SLIDE_BLOCKS`
 * ro'yxati MAHSULOT tartibida (formada shunday ko'rinadi), joylashuv
 * esa ANCHOR bo'yicha — ikkisini aralashtirsak `jadval` (o'rta)
 * `test` (oxir) dan keyin qo'yilardi.
 */
const ANCHOR_ORDER: SlideBlockAnchor[] = ["after-title", "early", "middle", "late", "end"];

type MarkedBeat = SlideBeat & {
  /** Shu beat foydalanuvchi BLOKI — hech qachon tashlanmaydi. */
  block?: SlideBlockId;
  /** Blok ankori — dekadagi guruhi. */
  anchor?: SlideBlockAnchor;
};

const beatKey = (b: SlideBeat) => `${b.layout}|${b.role}`;

/**
 * Shablon beat'i BLOKNING nusxasimi.
 *
 * «Dars» shablonida «Maqsad — o‘quvchi nimani bilib oladi» (bullets) va
 * «Uyga vazifa» (bullets) beat'lari bor — ular mavzuning bandi emas,
 * dars TUZILMASI, va aynan `maqsadlar`/`uyga_vazifa` bloklarining ishi.
 * Ilgari ular blok bilan QO'SHILARDI (1-qoida); endi reja bandi slaydi
 * shablon beat'idan quriladi va «REJA 3-band: Uyga vazifa» chiqib
 * qolardi. Aniqlash: maket bir xil VA rol blok nomining o'zagi (6 harf)
 * bilan boshlanadi — «Maqsadlar» → «maqsad», «Uyga vazifa» → «uyga v».
 */
function blockLike(b: SlideBeat): boolean {
  const role = b.role.toLowerCase();
  return SLIDE_BLOCKS.some((blk) => blk.layout === b.layout && role.startsWith(blk.label.toLowerCase().slice(0, 6)));
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
 * Belgilanmagan blok ham yoqilishi (yoki belgilangani o'chishi) mumkin —
 * foydalanuvchi uni boshqa maydon bilan SO'RAGAN bo'ladi: `quizCount`
 * (aniq 0 — testsiz), `internetSearch` (grounding manbalari hech qayerda
 * ko'rsatilmasa tadqiqot qilingani ko'rinmaydi), `agendaSlide: true`.
 * Qoida bitta joyda — `activeBlockIds` (`slide-params.ts`), `planCapacity`
 * ham shundan o'qiydi.
 */
export function orderedBlocks(
  blocks: readonly SlideBlockId[] | undefined,
  quizCount?: number,
  internetSearch = false,
  agendaSlide?: boolean,
): SlideBlock[] {
  const on = activeBlockIds(blocks, quizCount, internetSearch, agendaSlide);
  return ANCHOR_ORDER.flatMap((a) => SLIDE_BLOCKS.filter((b) => b.anchor === a && on.has(b.id)));
}

/**
 * Nomzodlar oqimidan maket tanlovchi — reja bandi mazmuni va qo'shimcha
 * slaydlar uchun.
 *
 * Oqim: shablonning O'Z tana beat'lari (tartibida), keyin to'ldirgichlari,
 * keyin umumiy to'ldirgichlar. Har chaqiruvda eng KAM ishlatilgan (teng
 * bo'lsa eng oldingi) mos nomzod olinadi — ya'ni avval shablon tartibi,
 * oqim tugagach aylanib takrorlanadi. `prev`/`next` — qo'shni maketlar:
 * yonma-yon bir xil maket bo'lmasin (5-qoida). Umumiy to'ldirgichlarda
 * mazmun maketlarining kamida to'rttasi bor, ya'ni ikki qo'shni bilan
 * ham tanlov HAR DOIM topiladi; topilmasa (nazariy) avval `next`, keyin
 * `prev` sharti yumshatiladi.
 */
function makePicker(stream: SlideBeat[]) {
  const used = stream.map(() => 0);
  return (allowed: ReadonlySet<SlideLayout>, prev?: SlideLayout, next?: SlideLayout): SlideBeat => {
    for (const [p, n] of [[prev, next], [prev, undefined], [undefined, undefined]] as const) {
      let best = -1;
      for (let i = 0; i < stream.length; i += 1) {
        const c = stream[i];
        if (!allowed.has(c.layout) || c.layout === p || c.layout === n) continue;
        if (best < 0 || used[i] < used[best]) best = i;
        if (used[best] === 0) break;
      }
      if (best >= 0) {
        used[best] += 1;
        return stream[best];
      }
    }
    return { layout: "bullets", role: "Mavzuga oid qo‘shimcha aniq misol" };
  };
}

/**
 * Foydalanuvchi bloklari va REJA BANDLARINI dekaga joylaydi.
 *
 * Qoidalar (AUDIT-9 WP-B, X-3, X-5, AUDIT-25):
 *   1. Har yoqilgan blok o'z `anchor` guruhida turadi:
 *        after-title → early → [reja bandlari + middle] → late → end.
 *      `middle` bloklari reja bandlari ORASIGA teng taqsimlanadi.
 *      (Ilgari blok shablonning bir xil maketli beat'i bilan
 *      «qo'shilardi» — shablon ketma-ketligi saqlanib qolsin deb.
 *      Endi tana reja bandlaridan quriladi, qo'shish kerak emas:
 *      shablon maketlari reja slaydlariga o'tadi.)
 *   2. `reja` o'chirilgan yoki `agendaSlide === false` — agenda yo'q;
 *      `agendaSlide === true` esa standartida reja yo'q turga ham
 *      agenda QO'SHADI (A3-02). Shablonning o'z `agenda` beat'i HECH
 *      QACHON qolmaydi: reja slaydi faqat `reja` blokidan (bitta manba).
 *   3. `quizCount > 0` testni SO'RAGAN demakdir: `test` bloki
 *      belgilanmagan bo'lsa ham `quiz` beat qo'yiladi; aniq `0` esa
 *      tur standartidagi testni ham OLIB TASHLAYDI (A3-01). Blok bor,
 *      son yuborilmagan (`undefined`) — `QUIZ_COUNT_FALLBACK`. Xuddi
 *      shunday `internetSearch` `references` beat'ini keltiradi.
 *      Hech biri takrorlanmaydi (`activeBlockIds` to'plam ustida).
 *   4. `title` doim boshida; `closing` doim oxirida va BITTA.
 *   5. Yonma-yon bir xil layout yo'q — tana QURILISHDA shunday
 *      tanlanadi (`makePicker`), keyin tuzatilmaydi. Yagona istisno —
 *      `quiz` qatori (1 savol = 1 slayd, X-3). Bloklar guruhlari
 *      o'zaro to'qnashmaydi: har guruh ichidagi maketlar har xil,
 *      guruhlar orasida esa kamida bitta reja slaydi turadi.
 *   6. Uzunlik HAR DOIM `want` ga teng (A3-04). Ilgari bloklar
 *      sig'masa deka UZAYARDI («Ochiq dars» 4 slayd → 8) — pro slaydda
 *      narx slayd soniga bog'liq, ya'ni forma va'da qilgan formula
 *      buzilardi. Endi sig'magan blok TASHLANADI, tartib:
 *        a) yon beruvchi standart bloklar (9-qoida), oxiridan;
 *        b) ortiqcha savollar va kalit (8-qoida);
 *        c) qolgan bloklar ankor OXIRIDAN (end → late → middle →
 *           early) — `reja` (agenda qolsa) va bitta savol hech qachon.
 *      Reja slaydlari (10-qoida) eng oxirida, lekin sig'im ularni
 *      shunday tanlaydiki, tashlanishga navbat yetmaydi.
 *   7. Deterministik: bir xil kirish → bir xil chiqish, tasodif yo'q.
 *   8. TEST GURUHI (savol slaydlari + javoblar kaliti) TO'LIQ shu
 *      yerda rejalashtiriladi va `want` ni HECH QACHON oshirmaydi
 *      (X-3). Sig'magan savollar va kalit TASHLANADI (kamida bitta
 *      savol qoladi) — ular BITTA blokning ichki hajmi.
 *   9. SIG'IM YETMASA AVVAL STANDART BLOK YON BERADI (X-5). Test
 *      guruhi tananing kamida `1/TEST_SHARE` ulushiga haqli; unga
 *      yetmagan o'rin taqdimot TURIDAN kelgan (`purposeDefaults`)
 *      va `YIELDING_BLOCKS` ro'yxatidagi bloklardan olinadi.
 *      `meta.slidePurpose` berilmasa (`general` standarti) yon
 *      beruvchi topilmaydi — noaniqlikda hech qanday blok tashlanmaydi.
 *      ESLATMA: yon bergan blok `structure.ts` ning umumiy «TUZILMA
 *      BLOKLARI» qatorida qoladi — u faqat deka NIYATI; o'z to'ldirish
 *      qoidasi bor bloklar (`diagramma`, `adabiyotlar`, `reja`, `test`)
 *      shu sabab yon beruvchilar ro'yxatida YO'Q (AUDIT-8 naqshi).
 *  10. REJA = SHARTNOMA (AUDIT-25). Har reja bandi (`planItems`) KAMIDA
 *      bitta MAZMUN slaydini oladi (`plan: i`, rejadagi tartibda) va u
 *      hech qachon qirqilmaydi. O'rin berish tartibi — 6-qoidadagi
 *      a) → b) → c). Bandlar soni `planBudgetForBody` sig'imiga
 *      qisiladi (tana − agenda − bitta savol); `extractMeta` va forma
 *      ham AYNAN shu funksiyadan o'qiydi (`planCapacity`).
 *      Shablonda `section` bo'lsa va reja uchun ≥ 2 o'rin/band qolsa,
 *      band = `section` + mazmun (ikkalasi `plan: i`). Qolgan o'rinlar
 *      bandlar orasiga «qo'shimcha» slayd bo'lib taqsimlanadi (shablon
 *      oqimidan, `plan` siz). Mazmun maketlari shablon tana beat'lari
 *      va to'ldirgichlaridan, TARTIBDA (`makePicker`).
 */
export function blocksToBeats(
  meta: Pick<DocMeta, "blocks" | "planItems" | "quizCount" | "agendaSlide" | "internetSearch" | "speakerNotes"> &
    Partial<Pick<DocMeta, "slidePurpose">>,
  tpl: SlideTemplate,
  beats: SlideBeat[],
  want: number,
): SlideBeat[] {
  const quizCount = meta.quizCount !== undefined && meta.quizCount > 0 ? meta.quizCount : QUIZ_COUNT_FALLBACK;
  const on = orderedBlocks(meta.blocks, meta.quizCount, meta.internetSearch === true, meta.agendaSlide);

  /*
   * title/closing ajratiladi: ular tana hisobiga KIRMAYDI va shu bilan
   * 4-qoida o'z-o'zidan bajariladi — nechta bo'lishidan qat'i nazar
   * bittasi boshida, bittasi oxirida qoladi.
   */
  const head = beats.find((b) => b.layout === "title") ?? null;
  const tail = beats.find((b) => b.layout === "closing") ?? null;
  const bodyWant = Math.max(0, want - (head ? 1 : 0) - (tail ? 1 : 0));

  // ── 10-qoida: reja sig'imi — `planCapacity` bilan YAGONA hisob.
  const budget = planBudgetForBody(bodyWant, new Set(on.map((b) => b.id)), meta.agendaSlide);
  const planN = Math.max(1, Math.min(meta.planItems || PLAN_ITEMS_DEFAULT, budget.capacity));
  const roleMeta = { planItems: planN, quizCount };
  const asBeat = (blk: SlideBlock): MarkedBeat => ({
    layout: blk.layout,
    role: blk.role(roleMeta),
    block: blk.id,
    anchor: blk.anchor,
    ...(blk.chart ? { chart: true } : {}),
  });

  // ── 2-qoida (+ kichik dekada agenda reja slaydiga yon beradi — `planBudgetForBody`).
  const keepAgenda = budget.agenda;

  /*
   * ── 6/8/9/10-qoidalar: kim qancha o'rin oladi.
   *
   * Har blok tanada AYNAN BITTA o'rin egallaydi. Bloklarga qoladigan
   * joy — `space = bodyWant − planN` (reja slaydlari birinchi); sig'im
   * `space` da doim agenda va bitta savolga joy qoldiradi.
   *
   *   a) reja slaydlariga joy yetmasa — yon beruvchi STANDART bloklar,
   *      oxiridan (deka boshi mavzuni ochadi, test guruhi oxirda);
   *   c) hali ham yetmasa — qolgan bloklar ankor oxiridan (`reja`dan
   *      tashqari). Bu faqat qo'lda yoqilgan bloklar ko'p bo'lganda;
   *   b) test guruhi: `baseSlots` — boshqa bloklardan QOLGAN joy,
   *      `share` — KAFOLATLANGAN ulush (tananing 1/3 i), unga yetmagani
   *      yana standart bloklardan (`yielded`, X-5).
   *
   * UZUNLIK SHARTNOMASI: bloklar + test guruhi ≤ `space`, bo'sh qolgani
   * reja bandlariga bo'lim/qo'shimcha slayd bo'lib qaytadi.
   */
  const testOn = on.some((b) => b.id === "test");
  const others = on.filter((b) => b.id !== "test" && !(b.id === "reja" && !keepAgenda));
  const askQuiz = testOn ? Math.max(1, Math.ceil(quizCount / QUIZ_PER_SLIDE)) : 0;
  const wantAnswers = askQuiz > 0 && meta.speakerNotes === false;
  const need = askQuiz > 0 ? askQuiz + (wantAnswers ? 1 : 0) : 0;
  const std = new Set(purposeDefaults(meta.slidePurpose).blocks);
  const givers = others.filter((b) => YIELDING_BLOCKS.has(b.id) && std.has(b.id));
  const space = bodyWant - planN;
  const testMin = askQuiz > 0 ? 1 : 0;
  const dropped = new Set<SlideBlockId>();
  let count = others.length;
  // a) standart yon beruvchilar
  for (let i = givers.length - 1; i >= 0 && count + testMin > space; i -= 1) {
    dropped.add(givers[i].id);
    count -= 1;
  }
  // c) qolgan bloklar — ankor oxiridan, `reja` qoladi
  for (let i = others.length - 1; i >= 0 && count + testMin > space; i -= 1) {
    if (others[i].id === "reja" || dropped.has(others[i].id)) continue;
    dropped.add(others[i].id);
    count -= 1;
  }
  const kept = givers.filter((b) => !dropped.has(b.id));
  const room = space - count;
  const baseSlots = askQuiz > 0 ? Math.max(1, Math.min(need, room)) : 0;
  const share = askQuiz > 0 && room > 0 ? Math.min(need, Math.max(1, Math.ceil(bodyWant / TEST_SHARE))) : 0;
  const yielded = Math.max(0, Math.min(kept.length, share - baseSlots));
  for (const b of kept.slice(kept.length - yielded)) dropped.add(b.id);
  const slots = baseSlots + yielded;
  const quizBeats = askQuiz > 0 ? Math.max(1, Math.min(askQuiz, slots - (wantAnswers ? 1 : 0))) : 0;
  const answersBeat = wantAnswers && quizBeats + 1 <= slots;

  /** Dekaga tushadigan BLOK beat'lari — ankor guruhlari bo'yicha, dekadagi tartibda. */
  const group: Record<SlideBlockAnchor, MarkedBeat[]> = { "after-title": [], early: [], middle: [], late: [], end: [] };
  let blockCount = 0;
  for (const blk of on) {
    if (blk.id === "reja" && !keepAgenda) continue;
    if (dropped.has(blk.id)) continue;
    const out = group[blk.anchor];
    if (blk.id !== "test") out.push(asBeat(blk));
    else {
      // `test` bloki guruhga YOYILADI: `quizBeats` ta `quiz` va (kerak bo'lsa) bitta `answers`.
      for (let i = 0; i < quizBeats; i += 1) {
        out.push({ layout: "quiz", role: quizRole(i, quizBeats), block: "test", anchor: blk.anchor });
      }
      if (answersBeat) out.push({ layout: "answers", role: ANSWERS_ROLE, block: "test", anchor: blk.anchor });
    }
  }
  for (const a of ANCHOR_ORDER) blockCount += group[a].length;

  /*
   * Reja uchun qolgan o'rinlar: `free` — bandlarning mazmun slaydidan
   * ORTGANI (≥ 0, 6-qoida). Shablonda bo'lim (`section`) bo'lsa va har
   * bandga ikkinchi o'rin yetsa — band bo'lim bilan ochiladi; qolgani
   * qo'shimcha slayd.
   */
  const free = bodyWant - blockCount - planN;
  const tplBeats = expandBeats(tpl, 0);
  const useSections = tplBeats.some((b) => b.layout === "section") && free >= planN;
  const extras = Math.max(0, free - (useSections ? planN : 0));

  /*
   * Nomzodlar oqimi: kirish TANASI (shablon beats'i, uzun dekada
   * to'ldirgichlari bilan), keyin to'ldirgich oqimi. Blok nusxasi
   * (`blockLike`) va blok/muqova maketlari chiqariladi, takror yo'q.
   */
  const bodyIn = beats.filter((b) => b.layout !== "title" && b.layout !== "closing");
  const pool = [...bodyIn, ...fillerPool(tpl, 48)];
  const seen = new Set<string>();
  const stream: SlideBeat[] = [];
  const sections: string[] = [];
  for (const b of pool) {
    const k = beatKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    if (b.layout === "section") sections.push(b.role);
    else if (EXTRA_LAYOUTS.has(b.layout) && !blockLike(b)) stream.push({ layout: b.layout, role: b.role });
  }
  const pick = makePicker(stream);

  /*
   * Tana SKELETI: bloklar — tayyor beat, reja/qo'shimcha o'rinlar —
   * keyin to'ldiriladigan «teshik». Qo'shimchalar bandlarga teng
   * taqsimlanadi (j-qo'shimcha → floor(j·N/x)-band ortidan), `middle`
   * bloklari esa bandlar orasiga (j-blok → round((j+1)·N/(m+1))-band
   * ortidan, kamida 1-band).
   */
  type Hole = { hole: "content" | "extra"; plan?: number };
  type Cell = MarkedBeat | Hole;
  const isHole = (c: Cell): c is Hole => "hole" in c;
  const extraAfter = new Array<number>(planN + 1).fill(0);
  for (let j = 0; j < extras; j += 1) extraAfter[1 + Math.floor((j * planN) / extras)] += 1;
  const mid = group.middle;
  const midAfter = mid.map((_, j) => Math.max(1, Math.min(planN, Math.round(((j + 1) * planN) / (mid.length + 1)))));

  const cells: Cell[] = [...group["after-title"], ...group.early];
  for (let i = 1; i <= planN; i += 1) {
    if (useSections) {
      // Shablon bo'limlari tugasa — umumiy ishora; oldingi bo'lim roli QAYTARILMAYDI.
      cells.push({ layout: "section", role: planRole(i, sections[i - 1] ?? "Keyingi bo‘lim"), plan: i });
    }
    cells.push({ hole: "content", plan: i });
    for (let e = 0; e < extraAfter[i]; e += 1) cells.push({ hole: "extra" });
    mid.forEach((b, j) => {
      if (midAfter[j] === i) cells.push(b);
    });
  }
  cells.push(...group.late, ...group.end);

  // ── 5-qoida: teshiklar chapdan o'ngga, qo'shnilarga qarab to'ldiriladi.
  const body: MarkedBeat[] = [];
  cells.forEach((c, t) => {
    if (!isHole(c)) {
      body.push(c);
      return;
    }
    const prev = body[t - 1]?.layout ?? head?.layout;
    const nx = cells[t + 1];
    const next = nx === undefined ? tail?.layout : isHole(nx) ? undefined : nx.layout;
    if (c.hole === "content") {
      const b = pick(PLAN_CONTENT, prev, next);
      body.push({ layout: b.layout, role: planRole(c.plan!, b.role), plan: c.plan });
    } else {
      body.push(pick(EXTRA_LAYOUTS, prev, next));
    }
  });

  // Ichki belgilar (`block`/`anchor`) tashqariga CHIQMAYDI.
  return [...(head ? [{ layout: head.layout, role: head.role }] : []), ...body, ...(tail ? [{ layout: tail.layout, role: tail.role }] : [])].map(
    (b) =>
      ({
        layout: b.layout,
        role: b.role,
        ...(b.chart ? { chart: true } : {}),
        ...(b.plan ? { plan: b.plan } : {}),
      }) as SlideBeat,
  );
}
