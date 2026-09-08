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
  type SlideBlockId,
} from "../lib/generation/slide-blocks.ts";
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
type BlockMeta = Pick<DocMeta, "blocks" | "planItems" | "quizCount" | "agendaSlide" | "internetSearch" | "speakerNotes">;

const bm = (v: Partial<BlockMeta> = {}): BlockMeta => ({
  blocks: [],
  planItems: 5,
  quizCount: 0,
  agendaSlide: true,
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
  const byCount = run({ blocks: [], quizCount: 10 }, "lecture", 14);
  assert.equal(byCount.filter((b) => b.layout === "quiz").length, 10, "quizCount 10 ta quiz beat bermadi");
  assert.match(roleOf(byCount, "quiz"), /jami 10 ta savol/);
  /*
   * Sig'magan savollar TASHLANADI va rol HAQIQIY sonni aytadi. 10
   * slaydli dekada tana 8 ta (titul + yakun ayrilgan) — ya'ni 10
   * savol sig'maydi. Rolda hamon «10 ta savol» tursa, model rejadan
   * ko'p savol yozar va prompt bilan reja ajralib ketardi.
   */
  const tight = run({ blocks: [], quizCount: 10 }, "lecture", 10);
  assert.equal(tight.filter((b) => b.layout === "quiz").length, 8, "sig'gani qadar quiz beat qo'yilmadi");
  assert.match(roleOf(tight, "quiz"), /jami 8 ta savol/, "rol rejadagi HAQIQIY sonni aytishi kerak");
  assert.equal(tight.length, 10, "uzunlik `want` da qolishi kerak");
  // Aksincha: ikkalasi ham yo'q — quiz yo'q.
  assert.ok(!layouts(run({}, "lecture", 10)).includes("quiz"), "so'ralmagan quiz paydo bo'ldi");
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
    const long = run({ blocks, quizCount }, tplId, want);
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
    const both = run({ blocks: ["reja", "maqsadlar"] }, "lecture", want);
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
  // Uzoqdagi quote bilan QO'SHILMAGANI — asl «Asosiy g‘oya» joyida qolgan.
  assert.ok(mot.some((b) => b.role === "Asosiy g‘oya"), "motivatsiya hududidan tashqaridagi quote bilan qo'shildi");
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

test("want bloklardan kichik: deka uzayadi, lekin BIRORTA blok tashlanmaydi", () => {
  const blocks = [...SLIDE_BLOCK_IDS];
  const out = run({ blocks }, "lecture", 4);
  assert.ok(out.length > 4, "bloklar sig'magan holatda ham deka 4 ta bo'lib qoldi — blok tashlangan");
  for (const blk of SLIDE_BLOCKS) {
    assert.ok(out.some((b) => b.layout === blk.layout), `${blk.id} (${blk.layout}) tashlab yuborildi`);
  }
  // Ortiqcha slayd faqat bloklar uchun — generik to'ldirgich qolmasin.
  assert.equal(out.length, 2 + SLIDE_BLOCKS.length, "blok bo'lmagan beat qolib ketdi");
  assert.equal(out[0].layout, "title");
  assert.equal(out[out.length - 1].layout, "closing");
});

test("bir xil maketli ikki blok yonma-yon tushmaydi — orasiga ajratgich kiradi", () => {
  // `maqsadlar` ham, `uyga_vazifa` ham `bullets`; want=4 da tanada
  // ikkitagina o'rin bor. Blok tashlanmaydi, ya'ni deka uzayishi kerak.
  const out = run({ blocks: ["maqsadlar", "uyga_vazifa"] }, "lecture", 4);
  assert.ok(out.some((b) => b.role.startsWith("Maqsadlar")));
  assert.ok(out.some((b) => b.role.startsWith("Uyga vazifa")));
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i].layout, out[i - 1].layout, `@${i}`);
  assert.equal(out.length, 5, "ajratgich uchun deka aynan bitta slaydga uzayishi kerak edi");
});

test("bloklarsiz meta shablon beats'ini uzunlikdan boshqa narsada o'zgartirmaydi", () => {
  // Yagona farq — `reja` yo'qligi uchun agenda olib tashlanadi (2-qoida).
  const out = run({}, "report", 8);
  assert.deepEqual(out, expandBeats(SLIDE_TEMPLATE_BY_ID.report, 8), "blok yo'q — shablon tegilmasligi kerak");
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
  // Blok bor, son yo'q — qator baribir chiqadi (standart son rejada).
  assert.match(promptFor({ blocks: "reja,test", quizCount: 0 }), /quiz layout: HAR quiz slaydida/);
  assert.doesNotMatch(promptFor({ blocks: "reja" }), /answers layout/);
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
  assert.match(p, /table layout: 2–4 ustun, 3–5 qator/);
  assert.match(p, /stats ga uydirma milliard\/tonna\/foiz YOZILMASIN/);
});
