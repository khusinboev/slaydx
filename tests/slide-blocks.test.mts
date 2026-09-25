import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import {
  QUIZ_COUNT_FALLBACK,
  SLIDE_BLOCKS,
  SLIDE_BLOCK_IDS,
  blocksToBeats,
  orderedBlocks,
  planRoleText,
  plannedBlocks,
  type SlideBlockId,
} from "../lib/generation/slide-blocks.ts";
import { bodyWantOf, defaultSlideCount, planBudget } from "../lib/generation/slide-params.ts";
import { PURPOSE_DEFAULTS, SLIDE_PURPOSES } from "../lib/generation/slide-purpose.ts";
import { slideSystem } from "../lib/generation/slide-prompt/index.ts";
import {
  SLIDE_TEMPLATES,
  SLIDE_TEMPLATE_BY_ID,
  expandBeats,
  type SlideBeat,
  type SlideTemplate,
} from "../lib/generation/slide-templates.ts";
import type { DocMeta } from "../lib/generation/types.ts";
import { AUDIENCE_RULES, bodyRules } from "../lib/generation/slide-audience.ts";
import { fitChars, SLIDE_LIMITS } from "../lib/generation/slide-limits.ts";
import { CHARS_PER_WORD } from "../lib/generation/slide-quality.ts";
import { structureLines } from "../lib/generation/slide-prompt/structure.ts";
import { DESIGN_VISUALS, LEGACY_VISUALS } from "../lib/generation/visuals/spec.ts";

/**
 * BLOKLAR → BEATS (AUDIT-9, WP-B).
 *
 * Bu fayl `blocksToBeats` ning ETTI qoidasini va `structure.ts` ning
 * blokka bog'liq prompt qatorlarini qulflaydi. Har assertion uchun
 * mutatsiya o'tkazilgan (kodni ataylab buzib, testning ANIQ ushlashi
 * tasdiqlangan) — jadval `docs` va hisobotda.
 *
 * `expandBeats` bu sprintda O'ZGARMAYDI: `tests/generation.test.mts`
 * dagi to'ldirgich testlari o'z holicha yashil qolishi shart.
 */

const pro = TOOL_BY_ID["pro-slide"];
/*
 * X-5: `slidePurpose` IXTIYORIY — u qaysi bloklar taqdimot TURIDAN
 * kelganini (ya'ni foydalanuvchi qo'lda yoqmaganini) bildiradi.
 * Berilmasa `general` standarti (`["reja"]`) ishlaydi va hech bir blok
 * yon bermaydi — pastdagi eski testlar aynan shu holatda qoladi.
 */
type BlockMeta = Pick<DocMeta, "blocks" | "planItems" | "quizCount" | "agendaSlide" | "internetSearch" | "speakerNotes"> &
  Partial<Pick<DocMeta, "slidePurpose">>;

const bm = (v: Partial<BlockMeta> = {}): BlockMeta => ({
  blocks: [],
  planItems: 5,
  /*
   * AUDIT-25 A3-01/02: `quizCount: 0` va `agendaSlide: true` endi ANIQ
   * tanlov (0 — tur standartidagi testni ham o'chiradi, true — rejasiz
   * turga ham reja qo'shadi). Standart holat — «yuborilmagan».
   */
  quizCount: undefined,
  agendaSlide: undefined,
  internetSearch: false,
  // X-3: izohlar YOQIQ — javoblar izohda qoladi, rejaga `answers` slaydi
  // KIRMAYDI. Kalit slaydini sinaydigan holatlar uni oshkora yozadi.
  speakerNotes: true,
  ...v,
});

/** Shablon + `want` bo'yicha yakuniy beats (koordinatordagi chaqiruvning aynan o'zi). */
const run = (v: Partial<BlockMeta> = {}, tplId = "lesson", want = 10): SlideBeat[] => {
  const tpl = SLIDE_TEMPLATE_BY_ID[tplId as keyof typeof SLIDE_TEMPLATE_BY_ID];
  return blocksToBeats(bm(v), tpl, expandBeats(tpl, want), want);
};

const layouts = (beats: SlideBeat[]) => beats.map((b) => b.layout);
const roleOf = (beats: SlideBeat[], layout: string) => beats.find((b) => b.layout === layout)?.role ?? "";

// ───────────────────────────────────────────── 1/3-qoida: har blok dekaga tushadi

/*
 * X-3 O'ZGARISHI. Ilgari bu test bitta `quiz` beat va roldagi «N ta
 * savol» matnini kutardi — savollarga ajratishni `finalizeQuiz` deka
 * yozilgandan KEYIN qilardi va deka rejadan uzun chiqardi. Endi
 * savollar soni REJADA: har savolga bitta `quiz` beat. Shuning uchun
 * assertion «rolda son bormi» dan «AYNAN shuncha quiz beat bormi» ga
 * ko'chdi — o'lchanadigan narsa aynan shu.
 */
test("test bloki → savol soncha quiz beat; son roldan ham ko'rinadi", () => {
  const on = run({ blocks: ["test"] }, "lecture", 10);
  const q = on.filter((b) => b.layout === "quiz");
  assert.equal(q.length, QUIZ_COUNT_FALLBACK, "son tanlanmagan — standart savol soncha quiz beat");
  assert.match(q[0].role, new RegExp(`jami ${QUIZ_COUNT_FALLBACK} ta savol`), "rol jami sonni aytmadi");
  assert.match(q[1].role, /2-savol/, "rol slaydning tartib raqamini aytmadi");
  // 3-qoida: son tanlangan bo'lsa blok belgisiz ham test so'ralgan.
  // (AUDIT-25: reja bandlari birinchi o'rin oladi — 2 band + 10 savol = 12 = tana.)
  const byCount = run({ blocks: [], quizCount: 10, planItems: 2 }, "lecture", 14);
  assert.equal(byCount.filter((b) => b.layout === "quiz").length, 10, "quizCount 10 ta quiz beat bermadi");
  assert.match(roleOf(byCount, "quiz"), /jami 10 ta savol/);
  /*
   * Sig'magan savollar TASHLANADI va rol HAQIQIY sonni aytadi. 10
   * slaydli dekada tana 8 ta (titul + yakun ayrilgan), 5 tasi reja
   * bandlariga (AUDIT-25) — ya'ni savolga 3 o'rin. Rolda hamon «10 ta
   * savol» tursa, model rejadan ko'p savol yozar va prompt bilan reja
   * ajralib ketardi.
   */
  const tight = run({ blocks: [], quizCount: 10 }, "lecture", 10);
  assert.equal(tight.filter((b) => b.layout === "quiz").length, 3, "sig'gani qadar quiz beat qo'yilmadi");
  assert.match(roleOf(tight, "quiz"), /jami 3 ta savol/, "rol rejadagi HAQIQIY sonni aytishi kerak");
  assert.equal(tight.length, 10, "uzunlik `want` da qolishi kerak");
  // Aksincha: ikkalasi ham yo'q — quiz yo'q.
  assert.ok(!layouts(run({}, "lecture", 10)).includes("quiz"), "so'ralmagan quiz paydo bo'ldi");
  // A3-01: aniq 0 — blok belgilangan bo'lsa ham test yo'q; yuborilmagan son — standart.
  assert.ok(!layouts(run({ blocks: ["test"], quizCount: 0 }, "lecture", 10)).includes("quiz"), "aniq 0 testni o'chirmadi");
});

test("adabiyotlar bloki → references beat, internetSearch o'chiq bo'lsa ham", () => {
  const off = run({ blocks: ["adabiyotlar"], internetSearch: false }, "lecture", 10);
  assert.ok(layouts(off).includes("references"), "internetSearch=false da references tushib qoldi");
  const on = run({ blocks: ["adabiyotlar"], internetSearch: true }, "lecture", 10);
  assert.ok(layouts(on).includes("references"));
  // `end` ankori: closing dan DARHOL oldin.
  assert.equal(layouts(off)[off.length - 2], "references", "references closing dan oldin turmadi");
  assert.ok(!layouts(run({}, "lecture", 10)).includes("references"), "so'ralmagan references paydo bo'ldi");

  /*
   * `end` ankori TO'LDIRISH yo'lida ham buzilmasin. Shablon beats'idan
   * uzunroq deka so'ralganda tana to'ldirgichlar bilan uzaytiriladi;
   * ular oxiriga qo'shilsa «Adabiyotlar» dan KEYIN tushib qolardi va
   * manbalar slaydi dekaning o'rtasida qolardi.
   */
  const cases: [SlideBlockId[], string, number, number][] = [
    [["adabiyotlar"], "lecture", 16, 0],
    [["adabiyotlar"], "lecture", 24, 0],
    [["adabiyotlar"], "lesson", 20, 0],
    [["adabiyotlar"], "pitch", 30, 0],
    // Quyidagi uchtasi AYNAN to'ldirish yo'lini ushlaydi: bu yerda tana
    // bloklar joylangandan KEYIN uzaytiriladi.
    [["adabiyotlar", "amaliyot"], "lecture", 19, 5],
    [["adabiyotlar", "maqsadlar", "uyga_vazifa"], "lecture", 7, 0],
    [["adabiyotlar", "maqsadlar", "uyga_vazifa"], "lecture", 8, 5],
  ];
  for (const [blocks, tplId, want, quizCount] of cases) {
    /*
     * AUDIT-25: 2 ta reja bandi — bloklar kichik dekada ham sig'sin
     * (5 band bilan 7 slaydda `adabiyotlar` reja slaydlariga yon berardi,
     * ya'ni sinaladigan narsaning o'zi yo'qolardi).
     */
    const long = run({ blocks, quizCount, planItems: 2 }, tplId, want);
    const tag = `${tplId}/${want}/[${blocks}]`;
    assert.equal(long[long.length - 1].layout, "closing", tag);
    assert.equal(long[long.length - 2].layout, "references", `${tag}: to'ldirgich references dan KEYIN tushdi`);
    assert.equal(long.filter((b) => b.layout === "references").length, 1, `${tag}: references takrorlandi`);
  }
});

test("internetSearch=true references beat'ini keltiradi — blok belgisiz ham", () => {
  /*
   * Grounding manbalari hech qayerda ko'rsatilmasa, tadqiqot
   * QILINGANI foydalanuvchiga ko'rinmaydi. `internetSearch` shu sabab
   * beats'ga ta'sir qiladi (`slide-params.ts` da «beats» deb e'lon
   * qilingan — bezak maydon emas).
   */
  const a = run({ blocks: [], internetSearch: true }, "lecture", 10);
  assert.equal(a.filter((b) => b.layout === "references").length, 1, "internetSearch references bermadi");
  assert.equal(a[a.length - 2].layout, "references", "references closing dan oldin turmadi");
  assert.equal(a.length, 10, "uzunlik `want` da qolishi kerak");

  // Blok bilan birga bo'lsa TAKRORLANMAYDI.
  const b = run({ blocks: ["adabiyotlar"], internetSearch: true }, "lecture", 10);
  assert.equal(b.filter((x) => x.layout === "references").length, 1, "references ikki marta qo'yildi");
  assert.equal(b.length, 10);

  // O'chiq va blok yo'q — references ham yo'q.
  const off = run({ blocks: [], internetSearch: false }, "lecture", 10);
  assert.ok(!layouts(off).includes("references"), "so'ralmagan references paydo bo'ldi");

  // Hamma shablonda: bitta references, uzunlik `want`, takror yo'q.
  for (const tpl of SLIDE_TEMPLATES) {
    for (const want of [8, 12, 16, 24]) {
      const out = run({ blocks: [], internetSearch: true }, tpl.id, want);
      const tag = `${tpl.id}/${want}`;
      assert.equal(out.filter((x) => x.layout === "references").length, 1, tag);
      assert.equal(out[out.length - 2].layout, "references", `${tag}: references oxirida emas`);
      assert.equal(out.length, want, `${tag}: uzunlik buzildi`);
      for (let i = 1; i < out.length; i++) assert.notEqual(out[i].layout, out[i - 1].layout, `${tag} @${i}`);
    }
  }
});

test("diagramma bloki → stats beat va chart:true", () => {
  const on = run({ blocks: ["diagramma"] }, "lecture", 10);
  const stats = on.filter((b) => b.layout === "stats");
  assert.ok(stats.length >= 1, "stats beat yo'q");
  const chart = stats.filter((b) => (b as { chart?: boolean }).chart === true);
  assert.equal(chart.length, 1, "aynan bitta stats diagramma rejimida bo'lishi kerak");
  assert.match(chart[0].role, /Diagramma/);
  // Blok yo'q — hech bir beat chart so'ramaydi.
  const off = run({}, "report", 10);
  assert.equal(off.filter((b) => (b as { chart?: boolean }).chart).length, 0, "so'ralmagan chart paydo bo'ldi");
  // `report` shablonida stats ALLAQACHON bor — qo'shilishi kerak, ikkilanmasin.
  const merged = run({ blocks: ["diagramma"] }, "report", 10);
  assert.equal(merged.filter((b) => (b as { chart?: boolean }).chart === true).length, 1);
});

test("maqsadlar bloki: bullets roli almashadi va BIRINCHI UCHDAN BIRDA turadi", () => {
  const on = run({ blocks: ["maqsadlar"] }, "lecture", 12);
  const at = on.findIndex((b) => b.role.startsWith("Maqsadlar"));
  assert.ok(at >= 0, "maqsadlar roli beats'ga tushmadi");
  assert.equal(on[at].layout, "bullets");
  const body = on.filter((b) => b.layout !== "title" && b.layout !== "closing");
  const i = body.findIndex((b) => b.role.startsWith("Maqsadlar"));
  assert.ok(i < Math.ceil(body.length / 3), `maqsadlar early hududdan tashqarida: ${i}/${body.length}`);
  // QO'SHILISH: `lecture` da early hududda bullets bor, ya'ni yangi slayd QO'SHILMAYDI.
  const off = run({}, "lecture", 12);
  assert.equal(on.length, off.length, "maqsadlar mavjud bullets bilan qo'shilmadi — deka uzaydi");
  assert.notEqual(roleOf(on, "bullets"), roleOf(off, "bullets"), "rol almashmadi");
});

test("ANKOR: qo'shiladigan blok o'z hududiga tushadi, oxiriga emas", () => {
  // `lesson` shablonida agenda YO'Q — `reja` yangi slayd bo'lib kiradi.
  assert.ok(!SLIDE_TEMPLATE_BY_ID.lesson.beats.some((b) => b.layout === "agenda"));
  const reja = run({ blocks: ["reja"] }, "lesson", 10);
  assert.equal(reja[1].layout, "agenda", "after-title: reja title dan darhol keyin turmadi");

  /*
   * Keyingi ankor bloki oldingisidan OLDINGA o'tib ketmasin. Kichik
   * dekada `early` ning hisoblangan o'rni ham 0 bo'lib chiqadi va
   * `maqsadlar` shablonning `agenda` beat'i bilan qo'shilgan `reja`
   * dan oldin tushib qolardi.
   */
  for (const want of [6, 8, 10, 14]) {
    // 2 band — 6 slaydda ham `maqsadlar` reja slaydlariga yon bermasin (AUDIT-25).
    const both = run({ blocks: ["reja", "maqsadlar"], planItems: 2 }, "lecture", want);
    assert.equal(both[1].layout, "agenda", `want=${want}: reja title dan darhol keyin turmadi`);
    const iR = both.findIndex((b) => b.layout === "agenda");
    const iM = both.findIndex((b) => b.role.startsWith("Maqsadlar"));
    assert.ok(iR < iM, `want=${want}: maqsadlar rejadan oldin tushdi (${iR} / ${iM})`);
  }

  // `lecture` da quote OXIRGI uchdan birda — `motivatsiya` u bilan QO'SHILMASLIGI
  // va o'z hududiga (birinchi uchdan bir) yangi slayd bo'lib kirishi kerak.
  const q = SLIDE_TEMPLATE_BY_ID.lecture.beats.findIndex((b) => b.layout === "quote");
  assert.ok(q > SLIDE_TEMPLATE_BY_ID.lecture.beats.length / 2, "shablon o'zgargan — test asosi yo'qoldi");
  const mot = run({ blocks: ["motivatsiya"] }, "lecture", 10);
  const body = mot.filter((b) => b.layout !== "title" && b.layout !== "closing");
  const at = body.findIndex((b) => b.role.startsWith("Motivatsiya"));
  assert.ok(at >= 0, "motivatsiya beats'ga tushmadi");
  assert.ok(at < Math.ceil(body.length / 3), `motivatsiya early hududda emas: ${at}/${body.length}`);
  /*
   * AUDIT-25: blok endi shablon beat'i bilan «qo'shilmaydi» — tana reja
   * bandlaridan quriladi. Sinaladigan narsa: motivatsiya O'Z slaydi
   * (bitta), va shablonning uzoqdagi iqtibosi uning o'rnini egallamagan.
   */
  assert.equal(mot.filter((b) => b.role.startsWith("Motivatsiya")).length, 1, "motivatsiya takrorlandi yoki yo'qoldi");
  assert.equal(body[at].layout, "quote");
});

test("ANKOR: middle bloki o'rta uchdan birda, late bloki oxirgi uchdan birda", () => {
  const body = (bs: SlideBlockId[]) =>
    run({ blocks: bs }, "lecture", 14).filter((b) => b.layout !== "title" && b.layout !== "closing");
  const tbl = body(["jadval"]);
  const iT = tbl.findIndex((b) => b.role === "Taqqoslash jadvali");
  assert.ok(iT >= Math.floor(tbl.length / 3) && iT < Math.ceil((2 * tbl.length) / 3), `jadval middle emas: ${iT}/${tbl.length}`);
  const hw = body(["uyga_vazifa"]);
  const iH = hw.findIndex((b) => b.role.startsWith("Uyga vazifa"));
  assert.ok(iH >= Math.floor((2 * hw.length) / 3), `uyga vazifa late emas: ${iH}/${hw.length}`);
});

// ───────────────────────────────────────────── 2-qoida: agenda

test("reja bloki yo'q → agenda beat butunlay olib tashlanadi", () => {
  assert.ok(layouts(run({ blocks: ["reja"] }, "lecture", 10)).includes("agenda"), "reja bor — agenda bo'lishi kerak");
  assert.ok(!layouts(run({ blocks: [] }, "lecture", 10)).includes("agenda"), "reja yo'q, agenda qoldi");
  assert.ok(!layouts(run({ blocks: ["maqsadlar"] }, "lecture", 10)).includes("agenda"));
  // `lecture` beats'ida agenda bor — ya'ni test haqiqatan olib tashlashni sinaydi.
  assert.ok(SLIDE_TEMPLATE_BY_ID.lecture.beats.some((b) => b.layout === "agenda"));
});

test("agendaSlide=false → reja bloki yoqilgan bo'lsa ham agenda yo'q", () => {
  const on = run({ blocks: ["reja"], agendaSlide: true }, "lecture", 10);
  const off = run({ blocks: ["reja"], agendaSlide: false }, "lecture", 10);
  assert.ok(layouts(on).includes("agenda"));
  assert.ok(!layouts(off).includes("agenda"), "agendaSlide=false agenda'ni olib tashlamadi");
  assert.equal(off.length, on.length, "agenda o'rni to'ldirilmadi — deka qisqarib qoldi");
});

test("reja roli reja bandlari sonini olib yuradi", () => {
  assert.match(roleOf(run({ blocks: ["reja"], planItems: 3 }, "lecture"), "agenda"), /aynan 3 ta band/);
  assert.match(roleOf(run({ blocks: ["reja"], planItems: 6 }, "lecture"), "agenda"), /aynan 6 ta band/);
});

// ───────────────────────────────────────────── 4/5/6-qoidalar, hamma shablonda

test("title boshida, closing oxirida va BITTA, yonma-yon takror yo'q", () => {
  for (const tpl of SLIDE_TEMPLATES) {
    for (const want of [6, 10, 16, 30]) {
      for (const blocks of [[], ["reja", "maqsadlar", "test"], [...SLIDE_BLOCK_IDS]] as SlideBlockId[][]) {
        const out = run({ blocks }, tpl.id, want);
        const tag = `${tpl.id}/want=${want}/[${blocks}]`;
        assert.equal(out.filter((b) => b.layout === "title").length <= 1, true, `${tag}: bir nechta title`);
        assert.equal(out.filter((b) => b.layout === "closing").length <= 1, true, `${tag}: bir nechta closing`);
        if (out.some((b) => b.layout === "title")) assert.equal(out[0].layout, "title", `${tag}: title boshda emas`);
        if (out.some((b) => b.layout === "closing")) {
          assert.equal(out[out.length - 1].layout, "closing", `${tag}: closing oxirda emas`);
        }
        /*
         * X-3: `quiz` — YAGONA istisno. 1 savol = 1 slayd bo'lgani
         * uchun nazorat testi ATAYLAB ketma-ket qator bo'lib turadi
         * (ilgari ham shunday chizilardi, faqat qator rejada emas,
         * `finalizeQuiz` da tug'ilardi). Qolgan hamma maket uchun
         * 5-qoida o'z kuchida.
         */
        for (let i = 1; i < out.length; i++) {
          if (out[i].layout === "quiz" && out[i - 1].layout === "quiz") continue;
          assert.notEqual(out[i].layout, out[i - 1].layout, `${tag}: @${i} yonma-yon ${out[i].layout}`);
        }
      }
    }
  }
});

test("uzunlik `want` ga tenglashadi — bloklar sig'sa", () => {
  for (const tpl of SLIDE_TEMPLATES) {
    for (const want of [8, 10, 12, 16, 20, 30]) {
      for (const blocks of [[], ["reja"], ["reja", "maqsadlar", "diagramma"], PURPOSE_DEFAULTS.open_lesson.blocks]) {
        const out = run({ blocks: blocks as SlideBlockId[] }, tpl.id, want);
        assert.equal(out.length, want, `${tpl.id}/want=${want}/[${blocks}] → ${out.length}`);
      }
    }
  }
});

/*
 * A3-04 O'ZGARISHI. Ilgari: «want bloklardan kichik — deka uzayadi,
 * birorta blok tashlanmaydi» (4 slayd so'ralsa 11 ta chiqardi). Pro
 * slaydda narx slayd soniga bog'liq — endi deka HECH QACHON `want` dan
 * uzun emas: bloklar ankor OXIRIDAN tashlanadi, reja slaydi (agenda) va
 * bitta savol qoladi, har reja bandi o'z slaydini oladi.
 */
test("want bloklardan kichik: deka UZAYMAYDI — bloklar ankor oxiridan tashlanadi, reja va 1 savol qoladi", () => {
  const blocks = [...SLIDE_BLOCK_IDS];
  /*
   * 8 slayd, 2 band: tanada 6 o'rin — reja, 2 band, 1 savol, qolgan 2 o'rin.
   * Avval qo'lda yoqilgan yon beruvchi TURDAGI bloklar (maqsadlar…jadval)
   * tashlanadi, `diagramma`/`adabiyotlar` — oxirgi chora (prompt qoidasi
   * bor, `adabiyotlar` ni `internetSearch` so'ragan bo'lishi mumkin).
   */
  const out = run({ blocks, planItems: 2 }, "lecture", 8);
  const tag = layouts(out).join(",");
  assert.equal(out.length, 8, tag);
  assert.equal(out[0].layout, "title");
  assert.equal(out[out.length - 1].layout, "closing");
  assert.equal(out[1].layout, "agenda", `reja qolishi kerak: ${tag}`);
  assert.equal(out.filter((b) => b.layout === "quiz").length, 1, tag);
  assert.equal(new Set(out.map((b) => b.plan).filter(Boolean)).size, 2, `reja bandlari: ${tag}`);
  const kept = SLIDE_BLOCKS.filter((blk) => blk.id !== "reja" && blk.id !== "test" && out.some((b) => b.role === blk.role({ planItems: 2, quizCount: 3 }))).map((b) => b.id);
  assert.deepEqual(kept.sort(), ["adabiyotlar", "diagramma"], `yon beruvchi turdagilar birinchi tashlanmadi: ${tag}`);
  // 4 slayd: agenda ham reja bandiga yon beradi — titul, band, savol, yakun.
  const tiny = run({ blocks }, "lecture", 4);
  assert.deepEqual(layouts(tiny).map((l, i) => (tiny[i].plan ? "plan" : l)), ["title", "plan", "quiz", "closing"]);
});

test("bir xil maketli ikki blok yonma-yon tushmaydi — orasiga reja slaydi tushadi", () => {
  /*
   * `maqsadlar` ham, `uyga_vazifa` ham `bullets`. Ilgari want=4 da
   * orasiga ajratgich qo'yilib deka uzayardi; endi (AUDIT-25) ular
   * orasida doim reja bandi turadi va u `bullets` bo'lmaydi.
   */
  const out = run({ blocks: ["maqsadlar", "uyga_vazifa"], planItems: 1 }, "lecture", 5);
  assert.ok(out.some((b) => b.role.startsWith("Maqsadlar")));
  assert.ok(out.some((b) => b.role.startsWith("Uyga vazifa")));
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i].layout, out[i - 1].layout, `@${i}`);
  assert.equal(out.length, 5);
  assert.equal(out[2].plan, 1, layouts(out).join(","));
});

/*
 * AUDIT-25 O'ZGARISHI. Ilgari bloksiz deka shablon beats'ining AYNAN
 * o'zi edi. Endi tana reja bandlaridan quriladi, lekin maketlar va
 * rollar hamon SHABLONDAN (avval uning o'z beat'lari, tartibida):
 * «Hisobot» dekasi boshqa shablon tiliga o'tib ketmasin.
 */
test("bloklarsiz deka: tana reja bandlari, maket va rollar shablondan, tartibida", () => {
  const tpl = SLIDE_TEMPLATE_BY_ID.report;
  const out = run({}, "report", 8);
  assert.equal(out.length, 8);
  assert.deepEqual(out[0], tpl.beats[0]);
  assert.deepEqual(out[out.length - 1], tpl.beats[tpl.beats.length - 1]);
  const own = new Set([...tpl.beats, ...tpl.fillers].map((b) => b.role));
  for (const b of out.slice(1, -1)) assert.ok(own.has(planRoleText(b.role)), `shablonda yo'q rol: ${b.role}`);
  // Shablonning mazmun beat'lari birinchi bo'lib, o'z tartibida ishlatiladi.
  const content = tpl.beats.filter((b) => ["bullets", "twoCol", "process", "table", "stats"].includes(b.layout)).map((b) => b.role);
  const used = out.slice(1, -1).map((b) => planRoleText(b.role)).filter((r) => content.includes(r));
  assert.deepEqual(used, content, `shablon tartibi buzildi: ${out.map((b) => b.role).join(" | ")}`);
  assert.equal(new Set(out.map((b) => b.plan).filter(Boolean)).size, 5);
});

test("kirish massivi O'ZGARTIRILMAYDI (koordinator uni qayta ishlatadi)", () => {
  const tpl = SLIDE_TEMPLATE_BY_ID.lesson;
  const input = expandBeats(tpl, 12);
  const snapshot = JSON.stringify(input);
  blocksToBeats(bm({ blocks: [...SLIDE_BLOCK_IDS] }), tpl, input, 12);
  assert.equal(JSON.stringify(input), snapshot, "blocksToBeats kirish beats'ini mutatsiya qildi");
});

// ───────────────────────────────────────────── 7-qoida: determinizm

test("deterministik: bir xil kirish → bir xil chiqish", () => {
  for (const p of SLIDE_PURPOSES) {
    const d = PURPOSE_DEFAULTS[p];
    const tplId = d.templateId === "auto" ? "lecture" : d.templateId;
    const a = run({ blocks: d.blocks, quizCount: 5 }, tplId, 14);
    for (let k = 0; k < 3; k++) {
      assert.deepEqual(run({ blocks: d.blocks, quizCount: 5 }, tplId, 14), a, `${p}: takroriy chaqiruv boshqacha`);
    }
  }
});

// ───────────────────────────────────────────── taqdimot turlari farqlanadi

test("9 taqdimot turi standarti kamida 6 juftlikda farqli deka beradi", () => {
  const tpl: SlideTemplate = SLIDE_TEMPLATE_BY_ID.lecture;
  // Shablon QASDDAN bitta — farq faqat BLOKLARDAN kelishi kerak.
  const sig = SLIDE_PURPOSES.map((p) =>
    run({ blocks: PURPOSE_DEFAULTS[p].blocks }, tpl.id, 12)
      .map((b) => `${b.layout}|${b.role}`)
      .join("\n"),
  );
  let differ = 0;
  for (let i = 0; i < sig.length; i++) for (let j = i + 1; j < sig.length; j++) if (sig[i] !== sig[j]) differ += 1;
  assert.ok(differ >= 6, `36 juftlikdan faqat ${differ} tasi farq qildi`);
  assert.equal(new Set(sig).size >= 6, true, `9 turdan faqat ${new Set(sig).size} xil deka chiqdi`);
});

test("orderedBlocks: dekadagi tartib (anchor), formadagi tartib emas", () => {
  const ids = orderedBlocks([...SLIDE_BLOCK_IDS]).map((b) => b.id);
  assert.deepEqual(ids, ["reja", "maqsadlar", "motivatsiya", "amaliyot", "jadval", "diagramma", "test", "uyga_vazifa", "adabiyotlar"]);
  // `jadval` (o'rta) `test` (oxir) dan OLDIN — `SLIDE_BLOCKS` da esa keyin.
  assert.ok(ids.indexOf("jadval") < ids.indexOf("test"));
  assert.ok(SLIDE_BLOCK_IDS.indexOf("jadval") > SLIDE_BLOCK_IDS.indexOf("test"));
  assert.deepEqual(orderedBlocks([], 5).map((b) => b.id), ["test"], "quizCount test blokini yoqadi");
  assert.deepEqual(orderedBlocks(undefined).map((b) => b.id), []);
});

// ───────────────────────────────────────────── structure.ts prompt qatorlari

const promptFor = (v: FormValues) => slideSystem(extractMeta(pro, { topic: "Suv aylanishi", ...v }), SLIDE_TEMPLATE_BY_ID.lecture);

test("agenda qatori reja bandlari SONINI aytadi (oraliqni emas)", () => {
  assert.match(promptFor({ blocks: "reja", planItems: 3 }), /agenda: AYNAN 3 ta band/);
  assert.match(promptFor({ blocks: "reja", planItems: 6 }), /agenda: AYNAN 6 ta band/);
  assert.doesNotMatch(promptFor({ blocks: "reja", planItems: 6 }), /AYNAN 3 ta band/);
  // Reja so'ralmagan — qator ham yo'q (beats'da agenda yo'qligi bilan mos).
  assert.doesNotMatch(promptFor({ blocks: "maqsadlar" }), /agenda: AYNAN/);
  assert.doesNotMatch(promptFor({ blocks: "reja", agendaSlide: false }), /agenda: AYNAN/);
});

/*
 * X-3 O'ZGARISHI. Ilgari bu yerda «quiz layout: N ta savol» sinalardi
 * va N promptdagi YAGONA son edi — model shuncha savolni BITTA
 * slaydga solar, `finalizeQuiz` esa uni ajratib dekani uzaytirardi.
 * Endi son REJADA (beats rollarida, `blocksToBeats`), prompt qatori
 * esa faqat SLAYD ICHIDAGI sxemani aytadi. Ikki manba bo'lsa ular
 * ajralib ketardi: reja 8 ta savolga joy topsa ham prompt 10 talab
 * qilib turardi.
 */
test("quiz qatori faqat test so'ralganda chiqadi va bitta savol talab qiladi", () => {
  assert.doesNotMatch(promptFor({ blocks: "reja", quizCount: 0 }), /quiz layout/);
  const on = promptFor({ blocks: "reja", quizCount: 5 });
  assert.match(on, /quiz layout: HAR quiz slaydida AYNAN BITTA savol/);
  assert.match(on, /AYNAN 4 variant \(options\)/);
  assert.match(on, /answer — to‘g‘ri variant indeksi 0\.\.3/);
  // Savol SONI promptda qotib qolmasin — u rejadan keladi.
  assert.doesNotMatch(on, /quiz layout: \d+ ta savol/);
  // Javob kalitini model yozmasin — uni `finalizeQuiz` to'ldiradi.
  assert.match(on, /answers layout: javob kalitini O‘ZINGIZ yozmang/);
  // Blok bor, son YUBORILMAGAN — qator baribir chiqadi (standart son rejada).
  assert.match(promptFor({ blocks: "reja,test" }), /quiz layout: HAR quiz slaydida/);
  /*
   * P1 sharhi, 1-band: bloklar YUBORILGAN bo'lsa (pro chiplari) «Test»
   * chipi `quizCount: 0` dan ustun — forma 0 ni doim yuboradi. Bloklar
   * yuborilmagan (oddiy slayd) — aniq 0 tur standartidagi testni o'chiradi.
   */
  assert.match(promptFor({ blocks: "reja,test", quizCount: 0 }), /quiz layout: HAR quiz slaydida/);
  assert.doesNotMatch(promptFor({ slidePurpose: "open_lesson", quizCount: 0 }), /quiz layout/);
  assert.match(promptFor({ slidePurpose: "open_lesson" }), /quiz layout/);
  assert.doesNotMatch(promptFor({ blocks: "reja" }), /answers layout/);
});

/*
 * INT-08 (AUDIT-25 integratsiya sharhi, `extensions.ts`). Ilgari
 * «NAZORAT TESTI: N ta savol» qatori `meta.quizCount`dan (foydalanuvchi
 * SO'RAGAN son) olinardi, plan esa sig'imga qarab 1–6 ta quiz slaydiga
 * qisqarardi — model va'da qilingan sondan ortiqni bitta slaydga
 * siqib solardi (masalan «10 ta savol» va'da qilinib, reja atigi 6
 * slaydga sig'ardi). Xuddi shunday izoh o'chiq (`speakerNotes: false`)
 * bo'lsa ham, «Javoblar» slaydi sig'im yetmaganda REJADAN tushib
 * qolishi mumkin edi — prompt esa baribir uni va'da qilib turardi.
 * Endi ikkalasi ham `plannedBlocks(...)` (`quizBeats`/`answers`) dan —
 * `structure.ts`ning «TUZILMA BLOKLARI» qatori bilan BIR manbadan.
 */
test("INT-08: NAZORAT TESTI soni plandagi quiz slaydlari soniga (quizBeats) mos, so'ralgan sonlar EMAS", () => {
  // quizCount 10 so'ralgan, lekin 14 slaydli dekada 6 tasigagina joy bor (izoh yoqiq — javoblar kerak emas).
  const v = { blocks: "reja,test", quizCount: 10, slideCount: 14, speakerNotes: true };
  const m = extractMeta(pro, { topic: "Suv aylanishi", ...v });
  const plan = plannedBlocks(m, bodyWantOf(m.targetPages || undefined, m.titleSlide));
  assert.equal(plan.quizBeats, 6, "probe: 14 slaydli dekada quizCount:10 → rejada 6 quiz slaydi bo'lishi kerak");
  const p = promptFor(v);
  assert.match(p, /NAZORAT TESTI: 6 ta savol/, `prompt rejadagi sonni (6) aytishi kerak: mos qator topilmadi`);
  // MUTATSIYA: `extensions.ts` `meta.quizCount`ga qaytsa — bu yerda «10 ta savol» chiqadi.
  assert.doesNotMatch(p, /NAZORAT TESTI: 10 ta savol/, "so'ralgan (qisqartirilmagan) son va'da qilinmasligi kerak");
});

test("INT-08: «Javoblar» slaydi FAQAT rejada bor bo'lsa va'da qilinadi — sig'im uni tashlab yuborsa yo'q", () => {
  // izoh o'chiq (javoblar so'ralgan), lekin 6 slaydli kichik dekada faqat 1 savolga joy bor — kalit slaydiga joy qolmaydi.
  const v = { blocks: "reja,test", quizCount: 10, slideCount: 6, speakerNotes: false };
  const m = extractMeta(pro, { topic: "Suv aylanishi", ...v });
  const plan = plannedBlocks(m, bodyWantOf(m.targetPages || undefined, m.titleSlide));
  assert.equal(plan.quizBeats, 1);
  assert.equal(plan.answers, false, "probe: sig'im tor bo'lganda javoblar slaydi rejadan tushib qolishi kerak");
  const p = promptFor(v);
  assert.match(p, /NAZORAT TESTI: 1 ta savol/);
  // MUTATSIYA: eski shart `meta.speakerNotes === false && (meta.quizCount ?? 0) > 0` bo'lsa — bu yerda ham «Javoblar» chiqib qolardi.
  assert.doesNotMatch(p, /Javoblar/, "rejada yo'q slayd va'da qilinmasligi kerak");

  // Aksincha: sig'im yetganda (8 slayd) javoblar rejada bor — prompt HAM va'da qilishi kerak.
  const v2 = { blocks: "reja,test", quizCount: 10, slideCount: 8, speakerNotes: false };
  const m2 = extractMeta(pro, { topic: "Suv aylanishi", ...v2 });
  const plan2 = plannedBlocks(m2, bodyWantOf(m2.targetPages || undefined, m2.titleSlide));
  assert.equal(plan2.answers, true, "probe: 8 slaydda javoblar rejada bo'lishi kerak");
  assert.match(promptFor(v2), /Javoblar/, "rejada bor slayd va'da qilinishi kerak");
});

test("references qatori adabiyotlar blokida — va internet tadqiqotida ham", () => {
  assert.doesNotMatch(promptFor({ blocks: "reja" }), /references layout/);
  const on = promptFor({ blocks: "reja,adabiyotlar" });
  assert.match(on, /references layout: refs/);
  assert.match(on, /uydirma muallif\/DOI YOZMANG/);
  /*
   * Prompt beats bilan BIR manbadan: `internetSearch` `references`
   * beat'ini keltiradi, demak uni to'ldirish qoidasi ham kerak —
   * aks holda model manbalar slaydini ko'radi-yu, nima yozishni
   * bilmaydi va slayd bo'sh chiqadi.
   */
  assert.match(promptFor({ blocks: "reja", internetSearch: true }), /references layout: refs/);
});

test("diagramma qatori faqat diagramma blokida va birlik talabini qo'yadi", () => {
  assert.doesNotMatch(promptFor({ blocks: "reja" }), /stats \(diagramma\)/);
  const on = promptFor({ blocks: "reja,diagramma" });
  assert.match(on, /stats \(diagramma\): 3–4 ko‘rsatkich/);
  assert.match(on, /HAMMASI bir xil birlikda/);
  assert.match(on, /chart: true/);
});

test("tuzilma bloklari ro'yxati promptda, dekadagi tartibda", () => {
  assert.doesNotMatch(promptFor({ blocks: "" }), /TUZILMA BLOKLARI/);
  const on = promptFor({ blocks: "adabiyotlar,test,reja" });
  assert.match(on, /TUZILMA BLOKLARI \(rejada shu tartibda\): reja, test, adabiyotlar\./);
});

test("mavjud tuzilma qatorlari saqlandi (WP-0a shartnomasi buzilmasin)", () => {
  const p = promptFor({});
  assert.match(p, /section slaydda subtitle — BO‘SH QOLMASIN/);
  assert.match(p, /closing slaydda subtitle/);
  assert.match(p, /twoCol va compare/);
  assert.match(p, /table layout: katak matni qisqa/);
  /*
   * AUDIT-25 W6: sonlar `structure.ts` dan olindi — ular «MAKET HAJMI»
   * blokida (`wordTargetLines`) hisoblanadi. Ikki manba qolsa ular zid
   * edi («10–15 so‘z» vs hisoblangan oraliq).
   */
  assert.match(p, /— section: subtitle \d+–\d+ so‘z/);
  // Jadval qator POLI 3 (AUDIT-8: 2 qatorli jadval slaydning yuqori uchdan birida qolardi).
  assert.match(p, /— table: (2–\d+|AYNAN 2) ustun, 3–\d+ qator/);
  // Sonsiz ko'rsatmalar saqlanadi (W6 faqat SONLARNI olib tashladi).
  assert.match(p, /«Savollar va muhokama» kabi bo‘sh ibora emas/);
  assert.match(p, /Bir so‘zli yorliq emas/);
  assert.match(p, /nima qilinadi va natija nima/);
  assert.match(p, /Uydirma raqam emas — tasnif, qiyos/);
  assert.doesNotMatch(p, /20–35 so‘zlik|15–25 so‘zlik|\(10–15 so‘z\)|table layout: 2–4 ustun/);
  assert.match(p, /stats ga uydirma milliard\/tonna\/foiz YOZILMASIN/);
});

// ───────────────────────────────────────────── INT-02: reja slayd sarlavhasi IKKALA qutiga (agenda + sarlavha 72 belgi) sig'adi

/*
 * INT-02 (AUDIT-25 integratsiya sharhi, P11 topilmasi; reviewer
 * qaytarishi — `audit/reviews/AUDIT-25-P1.md` "P13 review — 3964934").
 * Ilgari yuqori chegara FAQAT agenda qutisidan (`fitChars("agenda", …)`)
 * hisoblanardi — keng vizual/auditoriyada bu quti katta (masalan 280+
 * belgi) bo'lishi mumkin, lekin band nomi keyinchalik `syncAgenda` bilan
 * SLAYD SARLAVHASIGA ko'chadi va u har doim `SLIDE_LIMITS.title` (72
 * belgi) bilan chegaralangan — model uzoqroq yozsa, `clipTo` uni «…»
 * bilan kesardi (reviewer o'lchovi: 220 juftlikdan 170 tasida). Endi
 * ikkalasining KICHIGI olinadi.
 *
 * Testlar STATIK sonni EMAS, `structureLines`dan chinakam N ni o'qib,
 * uni ikkala qutining haqiqiy sig'imi bilan solishtiradi — shu sabab
 * `Math.min(…, SLIDE_LIMITS.title)` olib tashlansa (yoki formulaning
 * boshqa qismi buzilsa) test o'zi qizaradi, formulaning nusxasi emas.
 */
const promptWith = (v: FormValues, tpl: SlideTemplate) => slideSystem(extractMeta(pro, { topic: "Suv aylanishi", ...v }), tpl);
const ALL_VISUALS = [...LEGACY_VISUALS, ...DESIGN_VISUALS];
const ALL_AUDIENCES = Object.keys(AUDIENCE_RULES);

/** `structureLines`dan «REJA slaydlari sarlavhasi: eng ko'pi N so'z» qatoridagi N (topilmasa null). */
function agendaWordsCapFrom(meta: DocMeta, visual: string): number | null {
  const tpl = { id: "lecture", visual } as unknown as SlideTemplate;
  const lines = structureLines(meta, tpl, {});
  const line = lines.find((l) => l.startsWith("REJA slaydlari sarlavhasi: eng ko‘pi "));
  const m = line?.match(/eng ko‘pi (\d+) so‘z/);
  return m ? Number(m[1]) : null;
}

test("INT-02: 1–4-sinf/split/6 band — reja sarlavhasi 3 so'zga chegaralanadi (tor agenda quti)", () => {
  const compare = SLIDE_TEMPLATE_BY_ID.compare;
  assert.equal(compare.visual, "split", "probe: `compare` shablon `split` vizualda bo'lishi kerak — testni yangilang");
  const meta = extractMeta(pro, { topic: "x", slideAudience: "school_1_4", planItems: 6, blocks: "reja" });
  const cap = agendaWordsCapFrom(meta, "split");
  assert.equal(cap, 3, `probe: 1–4-sinf/split/6 band sig'imi 3 so'z bo'lishi kutilgan, oldi: ${cap}`);
  // Umumiy sarlavha qoidasi («4–7 so‘z, ≤ 61 belgi» — `TITLE_WORDS`/`TITLE_CHARS`) BOSHQA slaydlar uchun saqlanadi — bu qator uni almashtirmaydi.
  const p = promptWith({ slideAudience: "school_1_4", planItems: 6, blocks: "reja" }, compare);
  assert.match(p, /Sarlavha to‘liq fikr, 4–7 so‘z, ≤ 61 belgi\./);
  assert.match(p, /boshqa slaydlar sarlavhasi umumiy qoidada \(4–7 so‘z\) qoladi/);
});

test("INT-02: invariant — BARCHA 14 auditoriya × 17 vizual: va'da qilingan N so'z ikkala qutidan (agenda VA sarlavha 72 belgi) oshmaydi", () => {
  let checked = 0;
  for (const audience of ALL_AUDIENCES) {
    for (const visual of ALL_VISUALS) {
      const meta = extractMeta(pro, { topic: "x", slideAudience: audience, planItems: 5, blocks: "reja" });
      const rules = bodyRules(meta, "lecture");
      // IKKALA qutining kichigi — reviewerning talab qilgan invariant chegarasi.
      const boxChars = Math.min(fitChars("agenda", rules, visual as never, 5), SLIDE_LIMITS.title);
      const cap = agendaWordsCapFrom(meta, visual);
      assert.ok(cap !== null, `${audience}/${visual}: «REJA slaydlari sarlavhasi» qatori topilmadi`);
      assert.ok(cap! >= 3, `${audience}/${visual}: pol 3 so'zdan pastga tushmasin, oldi ${cap}`);
      /*
       * ASOSIY INVARIANT (reviewer talabi): cap × CHARS_PER_WORD ≤
       * min(fitChars(agenda), SLIDE_LIMITS.title) — FAQAT cap POLDAN
       * (3 so'z) katta bo'lganda qat'iy. Eng tor juftliklarda (masalan
       * school_1_4/classic — legacy vizual, box ~18 belgi) hatto 3 so'z
       * ham qutidan katta chiqishi mumkin: bu `Math.max(3, …)` polining
       * ATAYLAB qilingan asosi — 3 so'zdan kam band ma'nosiz (structure.ts
       * izohi), shuning uchun bunday holatda qutidan biroz oshishga yo'l
       * qo'yiladi. Pol ishlagan holatlarda faqat `cap === 3` tekshiriladi
       * (yuqoridagi qator), qutidan OSHISHNI emas.
       */
      if (cap! > 3) {
        assert.ok(cap! * CHARS_PER_WORD <= boxChars, `${audience}/${visual}: ${cap} so‘z × ${CHARS_PER_WORD} > ${boxChars} belgi (agenda VA sarlavha qutisining kichigi)`);
      }
      checked += 1;
    }
  }
  assert.equal(checked, 14 * 17, "auditoriya/vizual soni o'zgargan — testni yangilang");
});

// ───────────────────────────────────────────── 9-qoida (X-5): sig'im urushi

/**
 * X-5 — JONLI nuqson.
 *
 * 10 slaydli dekada 7 blok yoqilgan, `quizCount: 3`, izohlar o'chiq.
 * Ilgari test guruhi boshqa bloklardan QOLGAN joyni olardi va
 * foydalanuvchi tanlagan 3 savol BITTAGA tushardi.
 *
 * `quizCount` — formada AYNAN tanlangan son, «Uyga vazifa» esa
 * «Ochiq dars» TURINING standarti; standart blok yon beradi.
 *
 * AUDIT-25: reja bandlari (bu yerda 3 ta) test guruhidan HAM oldin o'rin
 * oladi. Tana 8 o'rin = reja + 3 band + 2 savol + kalit + adabiyotlar;
 * to'rtta standart blok (maqsadlar, motivatsiya, amaliyot, uyga vazifa)
 * avval reja bandlariga, keyin test ulushiga yon beradi.
 */
const LIVE_BLOCKS = [...PURPOSE_DEFAULTS.open_lesson.blocks, "adabiyotlar"] as SlideBlockId[];

const planCount = (beats: SlideBeat[]) => new Set(beats.map((b) => b.plan).filter(Boolean)).size;

test("X-5: sig'im yetmasa STANDART blok yon beradi, quizCount saqlanadi", () => {
  const out = run(
    { blocks: LIVE_BLOCKS, quizCount: 3, speakerNotes: false, slidePurpose: "open_lesson", planItems: 3 },
    "lesson",
    10,
  );
  const tag = layouts(out).join(",");
  assert.equal(out.length, 10, `uzunlik shartnomasi buzildi: ${tag}`);
  assert.equal(planCount(out), 3, `reja bandlari: ${tag}`);
  assert.equal(out.filter((b) => b.layout === "quiz").length, 2, `savol slaydlari: ${tag}`);
  assert.equal(out.filter((b) => b.layout === "answers").length, 1, `kalit: ${tag}`);
  // Rol REJADAGI haqiqiy sonni aytadi — model rejadan ko'p savol yozmasin.
  assert.match(roleOf(out, "quiz"), /jami 2 ta savol/);
  // Yon bergan — standart bloklar; yon bermaydiganlar joyida.
  for (const role of ["Maqsadlar", "Motivatsiya", "Amaliyot", "Uyga vazifa"]) {
    assert.equal(out.some((b) => b.role.startsWith(role)), false, `${role} yon bermadi: ${tag}`);
  }
  for (const role of ["Reja", "Adabiyotlar"]) assert.ok(out.some((b) => b.role.startsWith(role)), `${role} tashlab yuborildi: ${tag}`);

  // Joy yetsa (15 slayd) hech kim yon bermaydi: 3 savol ham, uyga vazifa ham bor.
  const roomy = run({ blocks: LIVE_BLOCKS, quizCount: 3, speakerNotes: false, slidePurpose: "open_lesson", planItems: 3 }, "lesson", 15);
  assert.equal(roomy.filter((b) => b.layout === "quiz").length, 3, "joy yetganda savollar to'liq qolsin");
  for (const role of ["Maqsadlar", "Motivatsiya", "Amaliyot", "Uyga vazifa"]) {
    assert.ok(roomy.some((b) => b.role.startsWith(role)), `joy yetganda ${role} tashlanmasin`);
  }
  assert.equal(roomy.length, 15);
});

/**
 * Yon berish TARTIBI tur standartiga bog'liq.
 *
 * Bir xil blok ro'yxati bilan, lekin `slidePurpose: "general"` da
 * (standarti — faqat `reja`) hamma blok QO'LDA yoqilgan: birinchi yon
 * beruvchi yo'q, shuning uchun test guruhi 1 savolga qisqaradi va joy
 * (A3-04) ankor OXIRIDAGI yon beruvchi turdagi bloklardan olinadi —
 * uyga vazifa, amaliyot; `adabiyotlar` oxirgi chora bo'lib qoladi.
 * «Ochiq dars» da esa standart bloklar birinchi yon beradi va test
 * guruhi o'z ulushini oladi.
 */
test("X-5: qo'lda yoqilgan blok standartdan KEYIN yon beradi", () => {
  const hand = run({ blocks: LIVE_BLOCKS, quizCount: 3, speakerNotes: false, slidePurpose: "general", planItems: 3 }, "lesson", 10);
  const tag = layouts(hand).join(",");
  assert.equal(hand.length, 10);
  assert.equal(planCount(hand), 3, tag);
  assert.equal(hand.filter((b) => b.layout === "quiz").length, 1, `standart blok yo'q — savol guruhi qisqaradi: ${tag}`);
  // Qo'lda yoqilgan yon beruvchi TURDAGI bloklar oxiridan tashlanadi; `adabiyotlar` — oxirgi chora.
  for (const role of ["Reja", "Maqsadlar", "Motivatsiya", "Adabiyotlar"]) assert.ok(hand.some((b) => b.role.startsWith(role)), `${role}: ${tag}`);
  for (const role of ["Uyga vazifa", "Amaliyot"]) assert.ok(!hand.some((b) => b.role.startsWith(role)), `${role} ankor oxiridan tashlanmadi: ${tag}`);

  /*
   * `jadval` «Dars» turining standartida YO'Q — ya'ni u qo'lda
   * qo'shilgan va birinchi yon beruvchilar ro'yxatiga kirmaydi; uning
   * o'rniga standart bloklar beradi.
   */
  const mixed = run(
    { blocks: [...PURPOSE_DEFAULTS.lesson.blocks, "test", "jadval"] as SlideBlockId[], quizCount: 3, speakerNotes: false, slidePurpose: "lesson", planItems: 3 },
    "lesson",
    10,
  );
  assert.equal(mixed.length, 10);
  assert.ok(mixed.some((b) => b.layout === "table" && !b.plan), "qo'lda qo'shilgan jadval tashlandi");
  assert.equal(mixed.filter((b) => b.layout === "quiz").length, 2, "quizCount standart blokdan ustun turmadi");
});

/**
 * Yon berish CHEKLANGAN: test guruhi tananing uchdan biridan ko'pini
 * ololmaydi, ya'ni dars testga aylanmaydi. 10 savol so'ralgan 10
 * slaydli dekada guruh 3 o'rindan oshmasligi kerak.
 */
test("X-5: test guruhi tananing uchdan biridan oshmaydi", () => {
  const out = run({ blocks: LIVE_BLOCKS, quizCount: 10, speakerNotes: false, slidePurpose: "open_lesson", planItems: 3 }, "lesson", 10);
  const group = out.filter((b) => b.layout === "quiz" || b.layout === "answers").length;
  assert.equal(out.length, 10);
  assert.equal(group, 3, `test guruhi ${group} o'rin oldi — tananing yarmi`);
  // Qolgan beshtasi: reja, adabiyotlar va 3 ta reja bandi.
  assert.equal(planCount(out), 3);
  assert.equal(out.filter((b) => b.layout !== "title" && b.layout !== "closing" && b.layout !== "quiz" && b.layout !== "answers").length, 5);
});

/**
 * Uzunlik HAR DOIM `want` (A3-04) va yon berish faqat SIG'IM yetmaganda.
 * Supurish — 9 taqdimot turi × savol soni × izoh × uzunlik.
 */
test("X-5 supurishi: uzunlik doim want, joy yetganda hech bir blok tashlanmaydi", () => {
  const fails: string[] = [];
  let cases = 0;
  for (const p of SLIDE_PURPOSES) {
    const d = PURPOSE_DEFAULTS[p];
    const tplId = d.templateId === "auto" ? "lecture" : d.templateId;
    for (const quizCount of [undefined, 0, 3, 5, 10]) {
      for (const speakerNotes of [true, false]) {
        for (const want of [4, 6, 8, 10, 12, 16, 24]) {
          cases += 1;
          const out = run({ blocks: d.blocks, quizCount, speakerNotes, slidePurpose: p }, tplId, want);
          const tag = `${p}/quiz=${quizCount}/izoh=${speakerNotes}/want=${want}`;
          if (out.length !== want) fails.push(`${tag} → ${out.length}`);
          const on = orderedBlocks(d.blocks, quizCount, false);
          const q = out.filter((b) => b.layout === "quiz").length;
          if (on.some((b) => b.id === "test") && q < 1) fails.push(`${tag}: test so'ralgan, quiz beat yo'q`);
          if (!on.some((b) => b.id === "test") && q > 0) fails.push(`${tag}: so'ralmagan quiz`);
          if (quizCount && q > quizCount) fails.push(`${tag}: ${q} quiz beat (so'ralgan ${quizCount})`);
          /*
           * Joy yetsa (bloklar + butun test guruhi + reja bandlari tanaga
           * sig'sa) birorta blok tashlanmasligi kerak — aks holda kafolat
           * «bo'sh joyni ham tortib olish» ga aylanadi.
           */
          const asked = on.some((b) => b.id === "test") ? Math.max(1, quizCount || QUIZ_COUNT_FALLBACK) : 0;
          const needed = asked + (asked > 0 && speakerNotes === false ? 1 : 0);
          const cap = planBudget({ slideCount: want, blocks: d.blocks, quizCount }).capacity;
          if (on.filter((b) => b.id !== "test").length + needed + Math.min(5, cap) <= want - 2) {
            for (const blk of on) {
              if (blk.id === "test") continue;
              const role = blk.role({ planItems: Math.min(5, cap), quizCount: quizCount || QUIZ_COUNT_FALLBACK });
              if (!out.some((b) => b.role === role)) fails.push(`${tag}: joy yetgan holatda «${blk.id}» tashlandi`);
            }
          }
        }
      }
    }
  }
  assert.ok(cases >= 600, `supurish kichik: ${cases}`);
  assert.deepEqual(fails.slice(0, 10), [], `${fails.length}/${cases} holat:\n  ${fails.slice(0, 10).join("\n  ")}`);
});

/*
 * A3-04 O'ZGARISHI. Ilgari: «bloklar `want` ga sig'masa yon berish
 * YO'Q — deka uzayadi» (6 slaydda 11 ta). Endi deka uzaymaydi: hamma
 * blok yoqilgan 6 slaydli dekada reja slaydi, 2 reja bandi va bitta
 * savol qoladi, qolgan bloklar ankor oxiridan tashlanadi.
 */
test("A3-04: bloklar `want` ga sig'masa deka uzaymaydi — reja, bandlar va bitta savol qoladi", () => {
  const out = run({ blocks: [...SLIDE_BLOCK_IDS], quizCount: 3, speakerNotes: false, slidePurpose: "open_lesson" }, "lecture", 6);
  const tag = layouts(out).join(",");
  assert.equal(out.length, 6, tag);
  assert.equal(out[1].layout, "agenda", tag);
  assert.equal(planCount(out), 2, tag);
  assert.equal(out.filter((b) => b.layout === "quiz").length, 1, tag);
  assert.equal(out.filter((b) => b.layout === "answers").length, 0, `kalit birinchi tashlanadi: ${tag}`);
});

// ───────────────────────────────────────────── INT-13 (non-blocking follow-up): meta.ts ⇄ defaultSlideCount

/**
 * `extractMeta` (`meta.ts`) endi `defaultSlideCount("pro-slide"|"slide")`
 * dan o'qiydi — ilgari o'z nusxasi (`PRO_SLIDE_DEFAULT`/`SLIDE_DEFAULT`
 * to'g'ridan-to'g'ri) bor edi, forma (`slide-fields.tsx slidePagesOf`)
 * esa BOSHQA nusxadan. Bu test ikkalasi (dvigatel va reyestr funksiyasi)
 * bir xil sonni berishini qulflaydi — kelajakda biri o'zgarib ikkinchisi
 * qolib ketmasin.
 */
test("meta.ts: slideCount yo'q bo'lganda extractMeta.targetPages defaultSlideCount(tool) bilan bir xil", () => {
  assert.equal(extractMeta(pro, { topic: "x" }).targetPages, defaultSlideCount("pro-slide"));
  assert.equal(extractMeta(TOOL_BY_ID.slide, { topic: "x" }).targetPages, defaultSlideCount("slide"));
});
