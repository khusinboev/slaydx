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
