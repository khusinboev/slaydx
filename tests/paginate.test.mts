import test from "node:test";
import assert from "node:assert/strict";
import { packPages } from "../lib/viewers/paginate.ts";
import type { FlowItem } from "../lib/viewers/flow.ts";

/**
 * Ko'ruvchi sahifalashi (Sprint 16).
 *
 * Foydalanuvchi hisoboti: `slaydxx.uz/uz/files/...` da sarlavha varaq
 * TAGIDA yolg'iz qolib, ostida katta bo'sh joy turibdi, matni esa keyingi
 * varaqdan boshlanadi.
 *
 * Sabab FAYLDA emas edi: xuddi shu DOCX ni LibreOffice PDF ga
 * o'girganda «3. NATIJALAR (RESULTS)» darhol matn bilan davom etadi —
 * Word sarlavha uslublarida «keyingisi bilan birga» ni o'zi qo'llaydi.
 * Nuqson ko'ruvchining virtual sahifalashida edi: u sarlavhaga atigi
 * 36 px zaxira ajratardi, keyingi paragraf esa 100–250 px.
 *
 * Balandliklar bu yerda ARGUMENT — shuning uchun brauzersiz sinaladi.
 * Sonlar haqiqiy o'lchovga yaqin: A4 chegarasi ≈ 943 px.
 */

const LIMIT = 943;

let seq = 0;
const nextId = () => `it-${seq++}`;
const p = (text = "matn"): FlowItem => ({ type: "p", id: nextId(), text });
const h1 = (text = "3. NATIJALAR (RESULTS)"): FlowItem => ({ type: "h1", id: nextId(), text });
const h2 = (text = "1.1. Ostmavzu"): FlowItem => ({ type: "h2", id: nextId(), text });

/** Sarlavha varaqda yolg'iz qolmagani — asosiy talab. */
function assertNoOrphanHeading(pages: FlowItem[][]) {
  pages.forEach((page, n) => {
    const last = page[page.length - 1];
    if (!last) return;
    if (last.type === "h1" || last.type === "h2" || last.type === "h3") {
      assert.fail(
        `${n + 1}-varaq «${(last as { text: string }).text}» sarlavhasi bilan tugadi — ` +
          `matnisiz yolg'iz qolgan`,
      );
    }
  });
}

test("sarlavha o'z matni bilan birga keyingi varaqqa ko'chadi", () => {
  /*
   * AYNAN hisobotdagi holat: varaq deyarli to'lgan, so'ng sarlavha va
   * undan keyin uzun paragraf keladi.
   *
   * Eski mantiq: 800 + (40 + 36) = 876 ≤ 943 → sarlavha 1-varaqda qoladi.
   * Keyin paragraf 800 + 40 + 220 = 1060 > 943 → 2-varaqqa ketadi.
   * Natija: 1-varaq sarlavha bilan tugaydi, ostida ~100 px bo'sh joy.
   */
  const items = [p("to'ldiruvchi"), h1(), p("uzun natijalar matni")];
  const heights = [800, 40, 220];

  const pages = packPages(items, heights, LIMIT);

  assertNoOrphanHeading(pages);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].map((x) => x.type), ["p"]);
  assert.deepEqual(pages[1].map((x) => x.type), ["h1", "p"], "sarlavha matni bilan birga ko'chsin");
});

test("sarlavha va matni sig'sa, varaq bekorga tashlanmaydi", () => {
  /*
   * Teskari xato ham xuddi shunday yomon: har bir sarlavhani yangi
   * varaqdan boshlash hujjatni yarim bo'sh varaqlar bilan shishiradi.
   */
  const items = [p("boshlanish"), h1(), p("davomi")];
  const heights = [300, 40, 220];

  const pages = packPages(items, heights, LIMIT);

  assert.equal(pages.length, 1, "560 px 943 px ga sig'adi — ajratishning hojati yo'q");
});

test("ketma-ket sarlavhalar zanjiri ham birga ko'chadi", () => {
  /*
   * «I BOB» darhol «1.1.» bilan boshlanadi. Bir qadamlik oldinga
   * qarash bu yerda yetmaydi: h1 uchun faqat h2 hisoblansa, ikkalasi
   * sig'adi, so'ng h2 ning matni ko'chadi va IKKALA sarlavha yolg'iz
   * qoladi. Zanjir birinchi matngacha yig'ilishi kerak.
   */
  const items = [p("to'ldiruvchi"), h1("I BOB"), h2("1.1."), p("bob matni")];
  const heights = [700, 45, 35, 220];

  const pages = packPages(items, heights, LIMIT);

  assertNoOrphanHeading(pages);
  assert.deepEqual(pages[1].map((x) => x.type), ["h1", "h2", "p"]);
});

test("varaq boshidagi sarlavha cheksiz surilmaydi", () => {
  /*
   * Patologik holat: sarlavhadan keyingi paragraf CHEGARADAN kattaroq
   * (masalan, katta jadval). Bunday paragraf hech qanday varaqqa yolg'iz
   * ham sig'maydi — uni "keyingi varaq"qa ko'chirish yordam bermaydi.
   * Shart `cur.length` bo'lmasa (varaq bosh bo'lganda), bu holat cheksiz
   * bo'sh varaq hosil qilishga aylanib ketardi. Muhimi — sikl to'xtashi
   * va har bir band ANIQ bir marta chiqishi.
   */
  const items = [h1(), p("juda uzun matn")];
  const heights = [40, 2000];

  const pages = packPages(items, heights, LIMIT);

  assert.ok(pages.length <= 2, "cheksiz varaq hosil bo'lmasin");
  pages.forEach((page) => assert.ok(page.length > 0, "bo'sh varaq bo'lmasin"));
  assert.deepEqual(pages.flat(), items, "har bir band aynan bir marta chiqishi kerak");
});

test("titul o'z varag'ida yolg'iz turadi", () => {
  const items: FlowItem[] = [{ type: "title", id: nextId() }, p("kirish")];
  const pages = packPages(items, [900, 100], LIMIT);

  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].map((x) => x.type), ["title"]);
});

test("mundarija va annotatsiya yangi varaqdan boshlanadi", () => {
  const items: FlowItem[] = [
    p("oldingi"),
    { type: "toc", id: nextId() },
    { type: "abstract", id: nextId(), label: "Annotatsiya", text: "annotatsiya", keywords: "" },
    p("keyingi"),
  ];
  // Hammasi bitta varaqqa BEMALOL sig'adi — ajralish faqat qoidadan.
  const pages = packPages(items, [50, 60, 70, 50], LIMIT);

  assert.equal(pages.length, 3);
  assert.deepEqual(pages[0].map((x) => x.type), ["p"]);
  assert.deepEqual(pages[1].map((x) => x.type), ["toc"]);
  assert.deepEqual(pages[2].map((x) => x.type), ["abstract", "p"]);
});

test("A5: ko'p tilli annotatsiya ketma-ket oqadi, har biri alohida varaqda emas", () => {
  /*
   * `annotationLangs: "all"` da uch tilli annotatsiya bo'ladi.
   * `render-docx.ts` ularni orasida sahifa uzilishisiz chizadi; ilgari
   * `packPages` har birini alohida varaqqa majburlar va ko'ruvchidagi
   * varaq raqamlari fayldan ~2 taga siljirdi.
   */
  const abs = (n: string): FlowItem => ({
    type: "abstract",
    id: nextId(),
    label: `Annotatsiya ${n}`,
    text: "annotatsiya matni",
    keywords: "kalit",
  });
  const items: FlowItem[] = [
    { type: "toc", id: nextId() },
    abs("uz"),
    abs("en"),
    abs("ru"),
    h1("KIRISH"),
    p("kirish matni"),
  ];
  // Uch annotatsiya bemalol bitta varaqqa sig'adi (3 × 120 px).
  const pages = packPages(items, [80, 120, 120, 120, 40, 200], LIMIT);

  // Toc — 1-varaq; uchala annotatsiya — 2-varaqda birga.
  assert.deepEqual(pages[0].map((x) => x.type), ["toc"]);
  const absPage = pages.find((pg) => pg.some((x) => x.type === "abstract"))!;
  assert.equal(
    absPage.filter((x) => x.type === "abstract").length,
    3,
    "uchala annotatsiya bitta varaqda bo'lishi kerak",
  );
  // Alohida "faqat annotatsiya" varag'i bo'lmasligi kerak.
  const soloAbs = pages.filter((pg) => pg.length === 1 && pg[0].type === "abstract");
  assert.equal(soloAbs.length, 0, `har biri alohida varaqda emas: ${pages.map((p) => p.map((x) => x.type).join("+")).join(" | ")}`);
});

test("o'lchanmagan band ham joy egallaydi", () => {
  /*
   * `getBoundingClientRect` hali chizilmagan elementga 0 qaytarishi
   * mumkin. Nol balandlik bilan cheksiz band bitta varaqqa «sig'ardi».
   */
  const items = Array.from({ length: 60 }, () => p());
  const pages = packPages(items, [], LIMIT);

  assert.ok(pages.length > 1, "o'lchovsiz bandlar ham varaqqa bo'linishi kerak");
});

test("blockHeight faqat sarlavha + BIRINCHI keyingi bandni hisoblaydi", () => {
  /*
   * Zanjir hisoblashda oddiy xato: `break` sharti tushib qolsa, blockHeight
   * sarlavhadan keyingi BUTUN qolgan hujjatni yig'ib ketadi. Bu orfan
   * hosil qilmaydi (chunki sarlavhaning o'zi keyin haqiqiy balandligi
   * bilan qo'shiladi), lekin varaqni SAMARASIZ erta to'ldiradi — filler
   * hali 243 px joy bo'sh turgan holda yangi varaqqa o'tadi. Bu aniq
   * sahifa tarkibini tekshirmasa sezilmay qoladigan nuqson.
   */
  const items = [p("to'ldiruvchi"), h1(), p("1"), p("2"), p("3"), p("4"), p("5")];
  const heights = [700, 40, 60, 60, 60, 60, 60];

  const pages = packPages(items, heights, LIMIT);

  assert.equal(pages.length, 2);
  assert.deepEqual(
    pages[0].map((x) => x.type),
    ["p", "h1", "p", "p", "p"],
    "sarlavha filler bilan bir varaqda qolib, sig'gan uchta paragrafni ham olishi kerak",
  );
  assert.deepEqual(pages[1].map((x) => x.type), ["p", "p"]);
});

test("uzun hujjat chegaradan oshmaydi", () => {
  /*
   * Butun hujjat bo'ylab invariant: hech bir varaq (yolg'iz turgan
   * bandlardan tashqari) chegaradan oshmasin va sarlavha bilan tugamasin.
   */
  const items: FlowItem[] = [];
  const heights: number[] = [];
  for (let i = 0; i < 12; i++) {
    items.push(h1(`${i + 1}-bo'lim`));
    heights.push(44);
    for (let j = 0; j < 5; j++) {
      items.push(p());
      heights.push(180);
    }
  }

  const pages = packPages(items, heights, LIMIT);

  assertNoOrphanHeading(pages);
  pages.forEach((page, n) => {
    if (page.length === 1) return;
    const total = page.reduce((sum, item) => sum + heights[items.indexOf(item)], 0);
    assert.ok(total <= LIMIT, `${n + 1}-varaq chegaradan oshdi: ${total} > ${LIMIT}`);
  });
});

// ── Jadval sahifalash (Sprint 5, B1) ─────────────────────────────────
/*
 * Ilgari BUTUN jadval (yoki 10 qatorlik qattiq bo'lak) bitta band edi:
 * balandligi bitta varaqdan oshsa, `.word-sheet{overflow:hidden}`
 * pastini jim kesardi. Endi har qator ALOHIDA band — sarlavha
 * (`table-head`) birinchi qator bilan keep-with-next orqali turadi,
 * qolgan qatorlar haqiqiy balandligi bo'yicha oqadi.
 */

const tableHead = (): FlowItem => ({ type: "table-head", id: nextId(), table: { headers: ["A"], rows: [] } });
const row = (text = "qator"): FlowItem => ({ type: "table-row", id: nextId(), row: [text] });

test("jadval sarlavhasi birinchi qator bilan birga turadi", () => {
  const items = [p("to'ldiruvchi"), tableHead(), row("1")];
  const heights = [700, 40, 220];

  const pages = packPages(items, heights, LIMIT);

  assert.equal(pages.length, 2);
  assert.deepEqual(pages[1].map((x) => x.type), ["table-head", "table-row"], "sarlavha qatordan ajralib qolmasin");
});

test("davom etayotgan qator uchun sarlavha balandligi zaxira qilinadi", () => {
  /*
   * Ushbu test qadamlarni izohda yozilgan hisob-kitob bilan aynan
   * mos: sabab — `paginate.ts` yangi varaq boshida ko'ruvchi jadval
   * sarlavhasini QAYTA chizadi ("davomi" bilan), lekin bu sintez
   * qilingan sarlavha `pages` massividagi haqiqiy band emas — shuning
   * uchun uning balandligi ALOHIDA zaxira qilinishi SHART, aks holda
   * keyingi qatorlar "bo'sh joy bor" deb noto'g'ri hisoblanadi.
   */
  const items = [tableHead(), row("1"), row("2"), row("3"), row("4")];
  const heights = [40, 40, 800, 100, 810];

  const pages = packPages(items, heights, LIMIT);

  assert.equal(pages.length, 3, "sarlavha zaxirasi 3-qatorni yolg'iz qoldirishi kerak");
  assert.deepEqual(pages[0].map((x) => x.type), ["table-head", "table-row", "table-row"]);
  assert.deepEqual(
    pages[1].map((it) => (it.type === "table-row" ? it.row[0] : it.type)),
    ["3"],
    "3-qator sarlavha zaxirasi tufayli 4-qator bilan bir varaqqa sig'masligi kerak",
  );
  assert.deepEqual(
    pages[2].map((it) => (it.type === "table-row" ? it.row[0] : it.type)),
    ["4"],
  );
});

test("jadval qatorlari haqiqiy balandlik bo'yicha (qattiq 10ta emas) bo'linadi", () => {
  // 20 ta qisqa qator BITTA varaqqa sig'ishi kerak — ilgari "10 ta"
  // qattiq chegara ularni ikkiga bo'lib tashlardi.
  const items = [tableHead(), ...Array.from({ length: 20 }, (_, i) => row(String(i)))];
  const heights = [40, ...Array.from({ length: 20 }, () => 30)];

  const pages = packPages(items, heights, LIMIT);

  assert.equal(pages.length, 1, "20 ta qisqa qator (jami ~640px) bitta varaqqa sig'adi");
});

// ── Jadval davomiyligini aniqlash (Sprint 5, B1) ─────────────────────
import { continuationTableFor } from "../lib/viewers/paginate.ts";

test("continuationTableFor: davom etayotgan sahifa to'g'ri jadvalni topadi", () => {
  const T = { headers: ["A"], rows: [] };
  const head: FlowItem = { type: "table-head", id: "h1", table: T };
  const r1: FlowItem = { type: "table-row", id: "r1", row: ["1"] };
  const r2: FlowItem = { type: "table-row", id: "r2", row: ["2"] };

  // 1-varaq: sarlavha+1-qator. 2-varaq: FAQAT 2-qator (davomi).
  const pages = [[head, r1], [r2]];
  const cont = continuationTableFor(pages);

  assert.equal(cont[0], null, "yangi jadval boshlangan varaq davom emas");
  assert.equal(cont[1], T, "faqat qator bilan boshlangan varaq oldingi jadvalning davomi");
});

test("continuationTableFor: prozaik varaqdan keyin jadval boshlansa davom emas", () => {
  /*
   * Agar oldingi varaq JADVAL bilan tugamagan bo'lsa (masalan oddiy
   * paragraf), keyingi varaqdagi qator YANGI jadvalning boshi bo'lishi
   * mumkin emas — lekin bu holat sun'iy: aslida sarlavhasiz qator hech
   * qachon yolg'iz kelmaydi (keep-with-next kafolatlaydi). Test shunga
   * qaramay funksiya HECH QACHON noto'g'ri jadval "eslab qolmasligini"
   * tasdiqlaydi.
   */
  const T1 = { headers: ["A"], rows: [] };
  const head1: FlowItem = { type: "table-head", id: "h1", table: T1 };
  const r1: FlowItem = { type: "table-row", id: "r1", row: ["1"] };
  const para: FlowItem = { type: "p", id: "p1", text: "oraliq matn" };

  const pages = [[head1, r1], [para]];
  const cont = continuationTableFor(pages);

  assert.equal(cont[1], null, "prozadan keyin davomiylik yo'q");
});

test("continuationTableFor: ikkinchi jadval birinchisining davomi deb topilmaydi", () => {
  const T1 = { headers: ["A"], rows: [] };
  const T2 = { headers: ["B"], rows: [] };
  const head1: FlowItem = { type: "table-head", id: "h1", table: T1 };
  const r1: FlowItem = { type: "table-row", id: "r1", row: ["1"] };
  const head2: FlowItem = { type: "table-head", id: "h2", table: T2 };
  const r2: FlowItem = { type: "table-row", id: "r2", row: ["2"] };

  // Bitta varaqda ikkinchi jadval ham to'liq boshlanadi (o'z sarlavhasi bilan).
  const pages = [[head1, r1, head2, r2]];
  const cont = continuationTableFor(pages);

  assert.equal(cont[0], null);
});

test("continuationTableFor: orada proza kirsa eski jadval 'esda qolmaydi'", () => {
  /*
   * Himoya devori: agar ORADA jadval bilan bog'liq bo'lmagan varaq
   * kirsa (masalan proza), undan KEYINGI varaqdagi qator — garchi u
   * texnik jihatdan "table-row" bo'lsa ham — OLDINGI (uzoq qolgan)
   * jadvalning davomi deb noto'g'ri belgilanmasligi kerak. Bu holat
   * haqiqiy `packPages` chiqishida yuzaga kelmaydi (keep-with-next
   * kafolatlaydi), lekin funksiya o'zi mustaqil ravishda to'g'ri
   * bo'lishi kerak — kelajakda boshqa chaqiruvchi paydo bo'lsa ham.
   */
  const T = { headers: ["A"], rows: [] };
  const head: FlowItem = { type: "table-head", id: "h1", table: T };
  const r1: FlowItem = { type: "table-row", id: "r1", row: ["1"] };
  const para: FlowItem = { type: "p", id: "p1", text: "oraliq matn" };
  const strayRow: FlowItem = { type: "table-row", id: "r2", row: ["2"] };

  const pages = [[head, r1], [para], [strayRow]];
  const cont = continuationTableFor(pages);

  assert.equal(cont[2], null, "orada proza kirgach eski jadval davomi deb hisoblanmasligi kerak");
});
