import test from "node:test";
import assert from "node:assert/strict";
import { photoSlot, planSlide, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { coerceLayout } from "../lib/generation/slide-write.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * Slayd chizmasi — Slide Law ning kod darajasidagi ifodasi.
 *
 * Bu yerdagi tekshiruvlar aynan Sprint 1 da tuzatilgan nuqsonlarni
 * qulflaydi: matn qutidan chiqib ketmasin, jarayon oqim bo'lib ko'rinsin,
 * raqamlar diagrammaga aylansin, model kontenti yo'qolmasin.
 */

const theme = getSlideTheme("atlas");
const plan = (s: SlideModel) => planSlide(s, theme, "classic", 1, 10);
const texts = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "text" }> => l.t === "text");
const rects = (ls: SlideLayer[]) => ls.filter((l) => l.t === "rect");

// ------------------------------------------------------------ sig'dirish

test("Slide Law hajmidagi bandlar to'liq 18 pt da qoladi", () => {
  // 4 ta band × 120 belgi — `MAX_BULLETS` va `MAX_BULLET_CHARS` chegarasi.
  // Aynan shu hajm proyektor uchun mo'ljallangan va kichraytirilmasligi kerak.
  const size = texts(
    plan({
      id: "a",
      layout: "bullets",
      title: "Sarlavha",
      bullets: Array.from({ length: 4 }, () => "a".repeat(120)),
    }).layers,
  ).find((t) => t.lines)?.size;
  assert.equal(size, 18);
});

test("chegaradan oshgan matn kichrayadi, lekin 15 pt dan pastga tushmaydi", () => {
  const sizeOf = (chars: number) =>
    texts(
      plan({
        id: "b",
        layout: "bullets",
        title: "Sarlavha",
        bullets: Array.from({ length: 4 }, () => "a".repeat(chars)),
      }).layers,
    ).find((t) => t.lines)?.size ?? 0;

  const heavy = sizeOf(300);
  const extreme = sizeOf(900);
  assert.ok(heavy < 18, `og'ir matn kichrayishi kerak: ${heavy}`);
  assert.ok(heavy > 15, `o'rtacha og'irlikda pol urilmasin: ${heavy}`);
  assert.equal(extreme, 15, "haddan tashqari matnda pol 15 pt");
});

/**
 * AUDIT-6 B4. Yuqoridagi ikki test `"a".repeat(n)` — bitta uzluksiz
 * "so'z", bo'sh joysiz. Naql qator-hisoblash (`ceil(chars/perLine)`)
 * aynan shu holatda TO'G'RI, chunki so'z chegarasi umuman yo'q — shuning
 * uchun bu ikki test B4 ni ilgari ushlay olmagan.
 *
 * Real matnda so'zlar orasida bo'sh joy bor va ochko'z (greedy) qatorlash
 * ba'zan qatorni to'liq to'ldirmay tugatadi (keyingi so'z sig'masa). Bu
 * qator sonini oshiradi — quyidagi 4 bandning har biri 4 ta 43 belgili
 * "so'z"dan iborat: ikkitasi bir qatorga sig'maydi, shuning uchun har
 * band 4 alohida qatorni band qiladi. Eski (belgi-hisoblash) versiya buni
 * bitta qatorga ozgina ortiqcha sig'gan deb hisoblab, shriftni 18 pt da
 * qoldirardi — matn haqiqatda qutidan chiqib ketardi.
 */
test("so'z-o'ralish hisobga olinadi — band ichida bo'sh joy ketishi shriftni kichraytiradi", () => {
  const word = (ch: string) => ch.repeat(43);
  const bullet = [word("A"), word("B"), word("C"), word("D")].join(" ");
  const size = texts(
    plan({
      id: "c",
      layout: "bullets",
      title: "Sarlavha",
      bullets: Array.from({ length: 4 }, () => bullet),
    }).layers,
  ).find((t) => t.lines)?.size;
  assert.ok(
    size !== undefined && size < 18,
    `so'z-o'ralish yo'qotilgan joy hisobga olinib, 18 pt dan kichrayishi kerak: ${size}`,
  );
});

test("hech bir qatlam slayd chegarasidan chiqmaydi", () => {
  const samples: SlideModel[] = [
    { id: "1", layout: "title", title: "Uzun sarlavha ".repeat(4), kicker: "Fan", subtitle: "Izoh" },
    { id: "2", layout: "agenda", title: "Reja", bullets: ["a", "b", "c", "d", "e"] },
    { id: "3", layout: "compare", title: "Qiyos", leftTitle: "A", left: ["x", "y"], rightTitle: "B", right: ["z"] },
    { id: "4", layout: "quote", title: "Iqtibos", quote: "Uzun iqtibos matni ".repeat(6) },
    { id: "5", layout: "process", title: "Oqim", steps: [1, 2, 3, 4, 5].map((n) => ({ n: `${n}`, title: `B${n}`, text: "Izoh" })) },
  ];
  for (const s of samples) {
    for (const l of plan(s).layers) {
      assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01, `${s.layout}: manfiy koordinata`);
      assert.ok(l.box.x + l.box.w <= 13.34, `${s.layout}: kenglikdan chiqdi`);
      assert.ok(l.box.y + l.box.h <= 7.51, `${s.layout}: balandlikdan chiqdi`);
    }
  }
});

// ----------------------------------------------------------- visual maket

/**
 * `visual` HAR BIR tarmog'i alohida qulflanadi.
 *
 * Umumiy «visual farq beradi» testi yetarli emas: `magazine` titulda
 * ham farq qilgani uchun bo'lim tarmog'i o'chirilsa ham u yashil
 * qolaverardi (mutatsiya sinovida shu ko'rindi). Quyidagi uchtasi aynan
 * o'z tarmog'iga qaraydi.
 */
test("cards maketida bandlar ro'yxat emas, alohida kartaga aylanadi", () => {
  const s: SlideModel = {
    id: "c",
    layout: "bullets",
    title: "Sarlavha",
    bullets: ["Birinchi band gapi.", "Ikkinchi band gapi.", "Uchinchi band gapi."],
  };
  const asList = planSlide(s, theme, "classic", 1, 10);
  const asCards = planSlide(s, theme, "cards", 1, 10);

  // Ro'yxat: bitta `lines` qatlami. Karta: har band alohida `text`.
  assert.ok(texts(asList.layers).some((t) => t.lines), "classic bandlarni ro'yxat qilib chizishi kerak");
  assert.ok(!texts(asCards.layers).some((t) => t.lines), "cards da `lines` ro'yxati bo'lmasligi kerak");
  for (const b of s.bullets ?? []) {
    assert.ok(
      texts(asCards.layers).some((t) => t.text === b),
      `«${b}» kartada alohida matn bo'lishi kerak`,
    );
  }
  // Har kartaga fon + aksent chizig'i — classic dan ko'proq to'rtburchak.
  assert.ok(
    rects(asCards.layers).length >= rects(asList.layers).length + 6,
    "3 ta karta kamida 6 ta qo'shimcha to'rtburchak beradi",
  );
});

/**
 * AUDIT-7 O-3. `lab` — `science` (Tajriba) ning O'Z maketi.
 *
 * Ilgari `science` ning `visual` i `classic` edi, ya'ni `lecture` bilan
 * piksel-bapiksel bir xil chizilardi. Quyidagi test aynan `lab`
 * tarmog'iga qaraydi: uni `planBullets` dan olib tashlasangiz — yiqiladi.
 */
test("lab maketi bandlarni raqamlangan kuzatuv qatorlariga aylantiradi", () => {
  const s: SlideModel = {
    id: "l",
    layout: "bullets",
    title: "Kuzatuv natijalari",
    bullets: ["Birinchi kuzatuv.", "Ikkinchi kuzatuv.", "Uchinchi kuzatuv."],
  };
  const asLab = planSlide(s, theme, "lab", 1, 10);
  const asClassic = planSlide(s, theme, "classic", 1, 10);
  const asCards = planSlide(s, theme, "cards", 1, 10);

  // Ro'yxat emas: har band alohida `text` qatlami.
  assert.ok(!texts(asLab.layers).some((t) => t.lines), "lab da `lines` ro'yxati bo'lmasligi kerak");
  for (const b of s.bullets ?? []) {
    assert.ok(texts(asLab.layers).some((t) => t.text === b), `«${b}» alohida qator bo'lishi kerak`);
  }
  // Raqamlangan: har qatorga «01», «02», «03».
  for (const n of ["01", "02", "03"]) {
    assert.ok(texts(asLab.layers).some((t) => t.text === n), `«${n}» kuzatuv raqami yo'q`);
  }
  // Chap chekkadagi o'lchov chizig'i — ingichka va baland to'rtburchak.
  const rule = rects(asLab.layers).find((r) => r.box.w < 0.05 && r.box.h > 4 && r.box.y >= 1.4);
  assert.ok(rule, "chap chekkada o'lchov chizig'i bo'lishi kerak");
  // Bo'linmalar (shkala) — chiziq yonidagi ko'plab mayda to'rtburchak.
  const ticks = rects(asLab.layers).filter((r) => r.box.h < 0.05 && r.box.w < 0.3 && r.box.y >= 1.4);
  assert.ok(ticks.length >= 15, `o'lchov bo'linmalari kam: ${ticks.length}`);

  // Va u boshqa ikkala maketning nusxasi emas.
  assert.notEqual(JSON.stringify(asLab), JSON.stringify(asClassic), "lab classic bilan bir xil");
  assert.notEqual(JSON.stringify(asLab), JSON.stringify(asCards), "lab cards bilan bir xil");
});

test("lab qatlamlari slayd chegarasidan chiqmaydi", () => {
  for (const n of [1, 2, 3, 4]) {
    const s: SlideModel = {
      id: `l${n}`,
      layout: "bullets",
      title: "Kuzatuv",
      bullets: Array.from({ length: n }, (_, i) => `Kuzatuv bandi ${i + 1} ` + "matn ".repeat(20)),
      // Rasmli (yarim kenglik) holat ham tekshiriladi.
      image: n % 2 === 0 ? { url: "https://example.test/a.png" } : undefined,
    };
    for (const l of planSlide(s, theme, "lab", 1, 10).layers) {
      assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01, `lab/${n}: manfiy koordinata`);
      assert.ok(l.box.x + l.box.w <= 13.34, `lab/${n}: kenglikdan chiqdi`);
      assert.ok(l.box.y + l.box.h <= 7.51, `lab/${n}: balandlikdan chiqdi`);
      assert.ok(l.box.w > 0 && l.box.h > 0, `lab/${n}: bo'sh quti`);
    }
  }
});

// ------------------------------------------------- bandlarni taqsimlash

/**
 * AUDIT-7 O-4. `classic` band slaydi bandlarni qutiga TEPADAN tizardi
 * va oraliq har doim qat'iy 10 pt qolardi. Qisqa bandda (jonli
 * o'lchovda 75–120 belgi odatiy) matn 5.35″ qutining atigi 26% ini
 * egallab, pastda 3.96″ bo'sh oq maydon qolardi.
 *
 * Quyidagi uchta test uch xil narsani qulflaydi va har biri O'Z
 * mutatsiyasiga javob beradi:
 *   1) oraliq qoldiqqa qarab O'SADI (`paraSpace: 10` ga qaytarilsa yiqiladi);
 *   2) qoldiq tepa/pastga TENG bo'linadi (`valign` olib tashlansa yiqiladi);
 *   3) oraliq CHEKLANGAN va uzun matnda zich qoladi (chegara olib
 *      tashlansa yoki `fitLines` tartibi buzilsa yiqiladi).
 */
const bodyOf = (bullets: string[]) =>
  texts(plan({ id: "g", layout: "bullets", title: "Sarlavha", bullets }).layers).find((t) => t.lines)!;

/** Berilgan uzunlikda realistik o'zbekcha band — «aaa…» emas, so'zli. */
const WORDS =
  "fotosintez bosqichidagi kimyoviy o‘zgarishlar ketma-ketligi va ularning o‘simlik hujayrasi energetikasi uchun ahamiyati batafsil ko‘rib chiqiladi hamda tajriba natijasi bilan solishtiriladi".split(" ");
function bullet(n: number, chars: number) {
  let s = `${n}-band:`;
  for (let i = 0; s.length < chars; i++) s += " " + WORDS[i % WORDS.length];
  return s;
}
const bullets = (n: number, chars: number) => Array.from({ length: n }, (_, i) => bullet(i + 1, chars));

// Jonli o'lchovda odatiy hajm: 3 band × ~50 belgi. Aynan shu holat
// ilgari qutining 26% ini egallab, pastda 3.96″ bo'sh joy qoldirardi.
const SHORT = bullets(3, 45);
// «Slide Law» hajmi — `AUDIENCE_RULES.bulletChars` chegarasi.
const LAW = bullets(4, 165);
// Chegaradan ancha oshgan zich matn.
const DENSE = bullets(4, 320);

test("qisqa bandlar quti bo'ylab taqsimlanadi — pastki yarmi bo'sh qolmaydi", () => {
  const short = bodyOf(SHORT);
  assert.equal(short.size, 18, "qisqa matnda shrift 18 pt shiftida qolishi kerak");
  assert.ok(
    (short.paraSpace ?? 0) > 20,
    `qisqa bandda oraliq qoldiqqa qarab o'sishi kerak, qat'iy 10 pt da qolmasin: ${short.paraSpace}`,
  );
});

test("oraliq mutanosib — zich matnda u qaytib kichrayadi", () => {
  const short = bodyOf(SHORT).paraSpace ?? 0;
  const dense = bodyOf(DENSE).paraSpace ?? 0;
  assert.ok(
    dense < short - 5,
    `oraliq qoldiqqa ergashishi kerak (o'zgarmas son emas): qisqa=${short} zich=${dense}`,
  );
  assert.ok(dense >= 10, `oraliq eski poldan pastga tushmasin: ${dense}`);
});

test("qolgan bo'shliq tepa va pastga teng bo'linadi", () => {
  assert.equal(bodyOf(SHORT).valign, "middle", "band bloki vertikal markazlashtirilishi kerak");
});

test("Slide Law hajmi zich qoladi va oraliq cheklangan", () => {
  // 4 × 165 — auditoriya tipografikasi buzilmaydi, shrift shiftda.
  const law = bodyOf(LAW);
  assert.equal(law.size, 18, `Slide Law hajmi 18 pt da qolishi kerak: ${law.size}`);

  for (const [name, set] of [["qisqa", SHORT], ["law", LAW], ["zich", DENSE], ["bitta", bullets(1, 30)]] as const) {
    const b = bodyOf(set);
    // Chegara: ro'yxat ro'yxatligicha qolsin — oraliq qator balandligining
    // ikki baravaridan oshmasin, aks holda bandlar bir-biridan uziladi.
    assert.ok(
      (b.paraSpace ?? 0) <= b.size * 2,
      `${name}: oraliq chegaradan oshdi (${b.paraSpace} > ${b.size * 2}) — ro'yxat ro'yxat bo'lmay qoladi`,
    );
    // Va hech qachon qutiga sig'maydigan darajada emas: har band kamida
    // bitta qator, ya'ni qator+oraliq yig'indisi 5.35″ dan oshmasin.
    const need = set.length * (b.size * 1.3 + (b.paraSpace ?? 0));
    assert.ok(need <= 5.35 * 72, `${name}: bandlar qutiga sig'maydi (${need.toFixed(0)}pt > 385pt)`);
  }
});

test("magazine bo'lim slaydi to'la ekran kadr va pastki tasma beradi", () => {
  const s: SlideModel = {
    id: "m",
    layout: "section",
    title: "1-lavha",
    subtitle: "Bo'lim kirishi.",
    image: { url: "https://example.test/a.png" },
  };
  const mag = planSlide(s, theme, "magazine", 1, 10);
  const classic = planSlide(s, theme, "classic", 1, 10);

  const magImg = mag.layers.find((l) => l.t === "image");
  const classicImg = classic.layers.find((l) => l.t === "image");
  assert.ok(magImg, "magazine bo'limida rasm bo'lishi kerak");
  assert.equal(Number(magImg.box.w.toFixed(2)), 13.33, "kadr to'la kenglikda");
  assert.equal(Number(magImg.box.h.toFixed(2)), 7.5, "kadr to'la balandlikda");
  assert.ok(classicImg && classicImg.box.w < 6, "classic da rasm yon ustunda qoladi");
  assert.equal(mag.bg, theme.titleBg, "magazine bo'limi muqova foniga o'tadi");

  // Rasmsiz ham tasma qoladi — fal.ai yiqilsa maket buzilmasin.
  const noImg = planSlide({ ...s, image: undefined }, theme, "magazine", 1, 10);
  assert.equal(noImg.bg, theme.titleBg);
  assert.ok(texts(noImg.layers).some((t) => t.text === "1-lavha"));

  /*
   * `photoSlot` maketdan ALOHIDA tekshiriladi: u rasm SO'ROVIGA tushadi
   * (`slide-images.ts` → `slotPixels`). Slot yon ustunda qolsa, fal.ai
   * dan tik (5.2 × 7.5) kadr so'ralar va u to'la ekranga cho'zilib
   * buzilardi — maketda esa bu ko'rinmasdi, chunki `planSectionMagazine`
   * qutini o'zi yozadi.
   */
  const magSlot = photoSlot("section", "magazine");
  assert.equal(Number(magSlot?.w.toFixed(2)), 13.33, "magazine bo'limi 16:9 kadr so'rashi kerak");
  assert.equal(Number(magSlot?.h.toFixed(2)), 7.5);
  assert.ok((photoSlot("section", "classic")?.w ?? 99) < 6, "classic da yon ustun kadri");
});

test("dense jadval to'q sahifada chiziladi", () => {
  const s: SlideModel = {
    id: "t",
    layout: "table",
    title: "Ko'rsatkichlar",
    table: { headers: ["Mezon", "Qiymat"], rows: [["A", "1"], ["B", "2"]] },
  };
  const dense = planSlide(s, theme, "dense", 1, 10);
  const classic = planSlide(s, theme, "classic", 1, 10);
  assert.equal(dense.bg, theme.titleBg, "dense jadval muqova foniga o'tadi");
  assert.equal(classic.bg, theme.bg, "classic jadval oddiy fonda qoladi");
  // Katak matni to'q fonda o'qiladigan rangga o'tadi.
  assert.ok(
    texts(dense.layers).some((t) => t.text === "A" && t.color === theme.titleText),
    "dense da birinchi ustun `titleText` bilan chizilishi kerak",
  );
});

// -------------------------------------------------------------- process

test("5 bosqich ikki qatorga bo'linadi va o'qlar qo'yiladi", () => {
  const p = plan({
    id: "p",
    layout: "process",
    title: "Bosqichlar",
    steps: [1, 2, 3, 4, 5].map((n) => ({ n: String(n), title: `Bosqich ${n}`, text: "Izoh" })),
  });
  const cardYs = new Set(rects(p.layers).map((l) => Number(l.box.y.toFixed(2))));
  assert.ok(cardYs.size >= 2, "kartalar ikki qatorda bo'lishi kerak");
  assert.equal(texts(p.layers).filter((t) => t.text === "→").length, 3, "3+2 taqsimotda 3 ta o'q");
});

test("3 bosqich bitta qatorda qoladi", () => {
  const p = plan({
    id: "p",
    layout: "process",
    title: "Bosqichlar",
    steps: [1, 2, 3].map((n) => ({ n: String(n), title: `B${n}`, text: "Izoh" })),
  });
  assert.equal(texts(p.layers).filter((t) => t.text === "→").length, 2);
});

// ---------------------------------------------------------------- stats

test("o'qib bo'ladigan raqamlar diagrammaga aylanadi", () => {
  const chart = plan({
    id: "s",
    layout: "stats",
    title: "Natijalar",
    stats: [
      { value: "95%", label: "O'zlashtirish" },
      { value: "72%", label: "Faollik" },
      { value: "48%", label: "Mustaqil ish" },
    ],
  });
  assert.ok(rects(chart.layers).length >= 6, "ustunlar chizilmadi");
  assert.equal(texts(chart.layers).filter((t) => t.size === 30).length, 0, "katta karta raqami qolmasligi kerak");
});

test("formula yoki matn qiymat karta ko'rinishida qoladi", () => {
  const cards = plan({
    id: "s",
    layout: "stats",
    title: "Moddalar",
    stats: [
      { value: "C6H12O6", label: "Glyukoza" },
      { value: "O2", label: "Kislorod" },
      { value: "H2O", label: "Suv" },
    ],
  });
  assert.ok(texts(cards.layers).some((t) => t.size === 30), "karta ko'rinishi kutilgan edi");
});

// ------------------------------------------------------- layout coerce

test("shablon layouti kontentni yo'qotmaydi", () => {
  const bullets: SlideModel = { id: "x", layout: "bullets", title: "T", bullets: ["Birinchi band", "Ikkinchi band"] };

  const two = coerceLayout(bullets, "twoCol");
  assert.equal(two.layout, "twoCol");
  assert.deepEqual([...(two.left ?? []), ...(two.right ?? [])], bullets.bullets);

  const proc = coerceLayout(bullets, "process");
  assert.equal(proc.layout, "process");
  assert.equal(proc.steps?.length, 2);

  assert.equal(coerceLayout(bullets, "quote").quote, "Birinchi band");
});

test("stats ga o'girish uydirma raqam yaratmaydi", () => {
  const bullets: SlideModel = { id: "x", layout: "bullets", title: "T", bullets: ["Bir", "Ikki", "Uch"] };
  const forced = coerceLayout(bullets, "stats");
  assert.equal(forced.layout, "bullets", "raqamsiz slayd stats bo'lmasligi kerak");
  assert.equal(forced.stats, undefined);

  const real: SlideModel = { id: "y", layout: "bullets", title: "T", stats: [{ value: "5", label: "a" }] };
  assert.equal(coerceLayout(real, "stats").layout, "stats");
});

// ---------------------------------------------------------------- table

test("jadval sarlavha va qatorlari bilan chiziladi", () => {
  const p = plan({
    id: "t",
    layout: "table",
    title: "Qiyos",
    table: {
      headers: ["Mezon", "A", "B"],
      rows: [
        ["Samaradorlik", "Yuqori", "O'rta"],
        ["Og'irlik", "Katta", "Kichik"],
      ],
    },
  });
  const shown = texts(p.layers).map((t) => t.text);
  for (const cell of ["Mezon", "A", "B", "Samaradorlik", "Yuqori", "Kichik"]) {
    assert.ok(shown.includes(cell), `«${cell}» chizilmadi`);
  }
  for (const l of p.layers) {
    assert.ok(l.box.x + l.box.w <= 13.34 && l.box.y + l.box.h <= 7.51, "jadval chegaradan chiqdi");
  }
});

test("jadvalga o'girish uydirma ustun yaratmaydi", () => {
  const bullets: SlideModel = { id: "x", layout: "bullets", title: "T", bullets: ["Bir", "Ikki"] };
  assert.equal(coerceLayout(bullets, "table").layout, "bullets");

  const real: SlideModel = {
    id: "y",
    layout: "bullets",
    title: "T",
    table: { headers: ["A", "B"], rows: [["1", "2"]] },
  };
  assert.equal(coerceLayout(real, "table").layout, "table");
});

test("jadval eslatmasi qatorlarni o'z ichiga oladi", async () => {
  const { slideNotes } = await import("../lib/generation/slide-layout.ts");
  const notes = slideNotes({
    id: "t",
    layout: "table",
    title: "Qiyos",
    table: { headers: ["Mezon", "A"], rows: [["Narx", "Past"]] },
  });
  assert.match(notes, /Mezon/);
  assert.match(notes, /Narx/);
});

/**
 * Rasm byudjeti deka uzunligiga ergashadi.
 *
 * Nuqson: `premium` cheklovi 10 edi va 16 slaydli premium dekada rasm
 * ko'tara oladigan slaydlar soni ham aynan 10 chiqardi — cheklov
 * chegaraga tegib turardi, ya'ni shablon mixi ozgina o'zgarsa rasm jim
 * yo'qola boshlardi.
 */
test("rasm byudjeti deka uzayganda o'sadi va sun'iy shift qo'ymaydi", async () => {
  const { imageBudget } = await import("../lib/generation/slide-images.ts");

  // Qisqa dekada eski quyi chegara saqlanadi.
  assert.equal(imageBudget(10, false), 8);
  assert.equal(imageBudget(10, true), 10);

  // Uzun dekada byudjet 0.8 zichlikka ergashadi.
  assert.equal(imageBudget(16, true), 13);
  assert.equal(imageBudget(20, true), 16);
  assert.equal(imageBudget(14, false), 12);

  // 16 slaydli premium dekada mos slot 10 ta — byudjet undan KATTA
  // bo'lishi kerak, aks holda cheklovning o'zi bog'lovchi bo'lib qoladi.
  assert.ok(imageBudget(16, true) > 10);

  // Buzuq kirish yiqilmaydi.
  assert.equal(imageBudget(0, false), 8);
  assert.equal(imageBudget(-5, true), 10);
});

/**
 * `imageBudget` o'sganda rasm PROMPTI ham hammaga yetishi kerak.
 *
 * Nuqson: `writeSlideImagePrompts` (`slide-image-prompts.ts`) ichida
 * qat'iy `.slice(0, 8)` turardi. `imageBudget` 16 slaydli premium dekada
 * 13 tagacha rasm so'raganda, 9–13-slaydlar bu funksiyaning `fallback`
 * xaritasiga umuman kirmasdi. `attachSlideImages` chaqiruv joyida
 * `prompts[s.id] || composeSlideImagePrompt(...)` zaxirasi borligi uchun
 * CRASH bo'lmasdi, lekin bu slaydlar doim LLM yozgan sahna o'rniga umumiy
 * shablon promptidan chiqardi — sifat farqi jimgina yo'qolardi.
 *
 * LLM o'chirilgan holatda sinaladi (kalit yo'q): shunda funksiya faqat
 * `fallback` xaritasini qaytaradi va MAP TO'LIQLIGI to'g'ridan-to'g'ri
 * ko'rinadi — tarmoq/LLM javobini soxtalashtirish shart emas.
 */
test("rasm prompti imageBudget kengaygan dekaning barcha slaydiga yetadi", async () => {
  const { writeSlideImagePrompts } = await import("../lib/generation/slide-image-prompts.ts");
  const { imageBudget } = await import("../lib/generation/slide-images.ts");

  const saved = process.env.GEMINI_API_KEY;
  const savedX = process.env.XAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    const n = imageBudget(16, true); // 13
    assert.ok(n > 8, `sinov ma'noli bo'lishi uchun 8 dan ko'p bo'lishi kerak: ${n}`);
    const slides: SlideModel[] = Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      layout: "bullets",
      title: `Slayd ${i + 1}`,
    }));
    const prompts = await writeSlideImagePrompts("Fotosintez", slides, "classic");
    for (const s of slides) {
      assert.ok(prompts[s.id], `${s.id} uchun rasm prompti yo'q (jami ${n} tadan)`);
    }
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
    if (savedX === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedX;
  }
});

/**
 * Slayd `id` lari noyob bo'lishi shart.
 *
 * Nuqson: `normalizeSlide` indeksni BO'LAK ichidan olardi, ya'ni har
 * bo'lak `s0` dan qayta boshlardi. 16 slaydli deka ikki bo'lakdan
 * yig'iladi va `s0…s7` ikki marta chiqardi. Oqibati uchta edi: React
 * ko'ruvchida 24 ta «same key» xatosi, ko'ruvchining noto'g'ri slayd
 * ko'rsatish ehtimoli, va — eng jiddiyi — `slide-images.ts` rasm
 * promptini `prompts[s.id]` bo'yicha izlagani uchun dekaning ikkinchi
 * yarmi birinchi yarmining rasmini olardi.
 */
test("bo'laklardan yig'ilgan deka id lari qayta raqamlanadi", async () => {
  const { renumberSlides } = await import("../lib/generation/slide-write.ts");

  // Ikki bo'lakdan yig'ilgan 16 slaydli deka: har bo'lak `s0` dan boshlagan.
  const chunked = Array.from({ length: 16 }, (_, i) => ({
    id: `s${i % 8}`,
    layout: "bullets" as const,
    title: `Slayd ${i + 1}`,
  }));
  const ids = chunked.map((s) => s.id);
  assert.notEqual(new Set(ids).size, ids.length, "sinov ma'lumoti takroriy bo'lishi kerak");

  const fixed = renumberSlides(chunked);
  const out = fixed.map((s) => s.id);
  assert.equal(new Set(out).size, 16, "id lar noyob bo'lishi kerak");
  assert.deepEqual(out, Array.from({ length: 16 }, (_, i) => `s${i}`));
  // Mazmun tegilmaydi — faqat id.
  assert.deepEqual(fixed.map((s) => s.title), chunked.map((s) => s.title));

  // Allaqachon to'g'ri bo'lsa yangi obyekt yaratilmaydi.
  const ok = [{ id: "s0", layout: "title" as const, title: "A" }];
  assert.equal(renumberSlides(ok)[0], ok[0]);
});

test("deka slaydlarining id lari noyob va tartibli", async () => {
  const { buildSlideAcademicDoc } = await import("../lib/generation/slide-write.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  // LLM kalitisiz `fallbackSlides` yo'li ishlaydi — id mantig'i o'sha.
  const saved = process.env.GEMINI_API_KEY;
  const savedX = process.env.XAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    for (const quality of ["standard", "premium_long"]) {
      const meta = extractMeta(TOOL_BY_ID["slide"], {
        topic: "Fotosintez jarayoni",
        quality,
      } as never);
      const doc = await buildSlideAcademicDoc(meta, Date.now() + 20_000);
      const ids = doc.slides!.map((s) => s.id);

      assert.equal(new Set(ids).size, ids.length, `${quality}: id lar takrorlanmasligi kerak — ${ids.join(",")}`);
      assert.deepEqual(ids, ids.map((_, i) => `s${i}`), `${quality}: id lar tartibda bo'lishi kerak`);
    }
  } finally {
    if (saved) process.env.GEMINI_API_KEY = saved;
    if (savedX) process.env.XAI_API_KEY = savedX;
  }
});

test("forma standartlaridan slayd pastki qatoriga muallif yetib boradi", async () => {
  const { profileDefaults, TOOL_BY_ID } = await import("../lib/tools.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { fallbackSlides } = await import("../lib/generation/slide-write.ts");

  /*
   * AYNAN N-7 (Sprint 14). `SlideForm` o'z qiymatlarini noldan qurar va
   * profildan hech narsa olmasdi, `StandardForm` esa olardi. Natijada
   *
   *   const footer = [meta.author, meta.university].filter(Boolean).join(" · ")
   *
   * slayd yo'lida DOIM bo'sh satr berardi: himoya taqdimotida ham muallif
   * ismi ko'rinmasdi — ko'ruvchida ham, PPTX da ham.
   *
   * Sinov formadan slaydgacha bo'lgan BUTUN zanjirni bosib o'tadi:
   * profil → forma standartlari → `extractMeta` → deck.
   */
  const profile = {
    name: "Aliyev Ali",
    author: "Aliyev Ali — 3-kurs, 301-guruh",
    university: "Toshkent davlat universiteti",
    faculty: "Fizika",
    department: "Optika",
    subject: "Fizika",
    teacher: "Karimov B.",
    city: "Samarqand",
  };

  const values = { ...profileDefaults(profile), topic: "Fotosintez", quality: "standard" };
  const meta = extractMeta(TOOL_BY_ID.slide, values as never);

  // `parseAuthorLine` kurs va guruhni ajratadi — pastki qatorda faqat ism qoladi.
  assert.equal(meta.author, "Aliyev Ali");
  assert.equal(meta.university, "Toshkent davlat universiteti");
  assert.equal(meta.city, "Samarqand", "shahar ham profildan olinishi kerak");

  const slides = fallbackSlides(meta);
  const footers = slides.map((s) => s.footer ?? "");
  assert.ok(
    footers.every((f) => f.includes("Aliyev Ali")),
    `har slaydda muallif bo'lishi kerak, chiqdi: ${JSON.stringify(footers[0])}`,
  );
  assert.ok(
    footers.every((f) => f.includes("Toshkent davlat universiteti")),
    "pastki qatorda muassasa ham bo'lishi kerak",
  );

  // Profil bo'sh bo'lsa pastki qator ham bo'sh — bu kutilgan holat,
  // «F.I.Sh» kabi o'ylab topilgan qiymat qo'yilmaydi.
  const blank = extractMeta(TOOL_BY_ID.slide, {
    ...profileDefaults({}),
    topic: "Fotosintez",
  } as never);
  assert.equal(fallbackSlides(blank)[0].footer, "");
});

test("byudjet bosqichlar orasida oldindan taqsimlanadi", async () => {
  const { slideStageBudget } = await import("../lib/generation/slide-write.ts");

  /*
   * AYNAN N-2 (Sprint 14). Ilgari bosqichlar byudjetni bo'lishmasdi:
   * matn `writeSlidesWithLlm` da qat'iy 90 s × 4 chaqiruvgacha ishlar,
   * rasm esa «qolganini» olardi —
   *
   *   const budget = deadline ? Math.max(0, deadline - Date.now() - 12_000) : 60_000;
   *
   * Matn byudjetni yeb bo'lsa bu 0 berardi va `attachSlideImages`
   * BARCHA slaydni o'tkazib yuborardi: «sifatliroq rasm» deb 6 000–8 000
   * tanga to'langan premium deck rasmsiz chiqardi, hech qanday signalsiz.
   */
  const now = 1_000_000;
  const stage = slideStageBudget(now + 296_000, now);

  // Eng muhim shart: rasmga vaqt QOLISHI kafolatlanadi.
  assert.ok(stage.imageMs > 0, "rasm bosqichi hech qachon nolga tushmasligi kerak");
  assert.ok(stage.textMs > 0, "matn bosqichi ham nolga tushmasligi kerak");
  assert.ok(stage.assemblyMs > 0, "PPTX yig'ishga zaxira qolishi kerak");

  // Yig'indi umumiy byudjetdan oshmasligi kerak — aks holda deadline buziladi.
  assert.ok(
    stage.textMs + stage.imageMs + stage.assemblyMs <= 296_000,
    "bosqichlar yig'indisi umumiy byudjetdan oshmasligi kerak",
  );

  // Matn og'irroq (usiz deck umuman yo'q), lekin hammasini olmaydi.
  assert.ok(stage.textMs > stage.imageMs, "matn ulushi kattaroq bo'lishi kerak");
  assert.ok(stage.imageMs > 60_000, `16 slaydli deka rasmiga yetarli vaqt: ${stage.imageMs}ms`);

  // Juda kichik byudjetda ham taqsimot buzilmaydi va manfiyga tushmaydi.
  for (const total of [0, 5_000, 30_000, 90_000, 600_000]) {
    const st = slideStageBudget(now + total, now);
    assert.ok(st.textMs >= 0 && st.imageMs >= 0 && st.assemblyMs >= 0, `${total}: manfiy ulush yo'q`);
    assert.ok(st.textMs + st.imageMs + st.assemblyMs <= total, `${total}: yig'indi oshmasligi kerak`);
  }

  // Byudjetsiz chaqiruv (test/dev) ham ishlaydigan taqsimot beradi.
  const noDeadline = slideStageBudget(undefined, now);
  assert.ok(noDeadline.textMs > 0 && noDeadline.imageMs > 0);
});

test("slayd byudjeti paketga qarab o'sadi", async () => {
  const { budgetFor } = await import("../lib/generation/budget.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  const CAP = 900_000;
  const forQuality = (quality: string) =>
    budgetFor(TOOL_BY_ID.slide, { topic: "Fotosintez", quality } as never, CAP);

  /*
   * Ilgari slayd `FIXED` da qat'iy 180 000 edi: 10 slaydli standart paket
   * ham, 16 slaydli `premium_long` ham (3 000 va 8 000 tanga) bir xil vaqt
   * olardi — ya'ni qimmatroq paketda muvaffaqiyatsizlik ehtimoli yuqoriroq
   * edi, xuddi kurs ishidagi N-3 kabi.
   */
  const standard = forQuality("standard");
  const premium = forQuality("premium");
  const long = forQuality("long");
  const premiumLong = forQuality("premium_long");

  assert.ok(standard < premium, "12 slayd 10 slayddan ko'proq vaqt olishi kerak");
  assert.ok(premium < long, "14 slayd 12 slayddan ko'proq vaqt olishi kerak");
  assert.ok(long < premiumLong, "16 slayd 14 slayddan ko'proq vaqt olishi kerak");

  /*
   * Eng uzun deka matn VA rasm bosqichlariga yetadigan vaqt olishi kerak.
   * 16 slayd ikki bo'lakda yoziladi (~40 s har biri, qayta urinish bilan),
   * so'ng 14 tagacha rasm chiziladi.
   */
  assert.ok(premiumLong >= 280_000, `premium_long byudjeti: ${premiumLong}ms`);

  // Operatorning shifti hamon oxirgi so'z.
  assert.equal(budgetFor(TOOL_BY_ID.slide, { quality: "premium_long" } as never, 200_000), 200_000);
});

test("byudjet tugagan bo'lsa slayd yozuvchisi tarmoqqa chiqmaydi", async () => {
  const { writeSlidesWithLlm } = await import("../lib/generation/slide-write.ts");
  const { resolveSlideTemplate, expandBeats } = await import("../lib/generation/slide-templates.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  /*
   * `deadline` `writeSlidesWithLlm` ga UMUMAN yetib bormasdi (N-2): ichida
   * qat'iy `timeoutMs: 90_000` turardi. Byudjet allaqachon tugagan bo'lsa
   * ham u yana 4 tagacha 90 soniyalik chaqiruv qilar va `buildArtifact`
   * ning butun byudjetini yeb qo'yardi.
   *
   * Tekshiruv vaqt bilan emas, CHAQIRUV SONI bilan: sekin/tez mashinada
   * ham bir xil natija beradi.
   */
  const realFetch = globalThis.fetch;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  let calls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls += 1;
    return realFetch(...args);
  }) as typeof fetch;
  // Kalit BOR — ya'ni `llmEnabled()` to'siq emas, to'siq byudjet bo'lishi kerak.
  process.env.GEMINI_API_KEY = "test-key-not-used";
  delete process.env.XAI_API_KEY;

  try {
    const meta = extractMeta(TOOL_BY_ID.slide, {
      topic: "Fotosintez",
      quality: "premium_long",
    } as never);
    const tpl = resolveSlideTemplate(meta.slideTemplate, meta.topic, meta.extra);
    const beats = expandBeats(tpl, 16);

    const out = await writeSlidesWithLlm(meta, tpl, beats, Date.now() - 1);

    assert.equal(calls, 0, `byudjet tugaganda tarmoqqa chiqilmasligi kerak, chiqdi: ${calls} marta`);
    assert.equal(out, null, "slayd chiqmasa `null` qaytishi kerak — worker kreditni qaytaradi");
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
  }
});

test("band chegaralari maket sig'imiga bog'langan", async () => {
  const { AUDIENCE_RULES } = await import("../lib/generation/slide-templates.ts");
  const { planSlide } = await import("../lib/generation/slide-layout.ts");
  const { getSlideTheme } = await import("../lib/generation/slide-themes.ts");
  const theme = getSlideTheme("atlas");

  /*
   * `bulletChars` MAKETDAN o'lchanadi, taxmin qilinmaydi.
   *
   * Ilgari u 120 (lecture) va 80 (school) edi — «Slide Law» dan kelib
   * chiqqan, lekin o'sha qoida BOSHQA holatga qarshi yozilgan: 6 band ×
   * 140 belgi 11 pt gacha kichrayardi. Muammo band SONIDA edi,
   * uzunligida emas; chegara esa ikkalasiga birdan urilgan va slaydlar
   * bo'shab qolgan edi (jonli o'lchov: 237 belgi/slayd).
   *
   * Bu test chegarani maket bilan BOG'LAYDI: kim `bulletChars` ni
   * oshirsa, shrift o'qish chegarasidan pastga tushsa — test yiqiladi.
   * Ya'ni qiymatni oshirish mumkin, lekin faqat maket ko'targanicha.
   */
  const bodySize = (bullets: string[], audience: keyof typeof AUDIENCE_RULES, withPhoto: boolean) => {
    const plan = planSlide(
      {
        id: "s",
        layout: "bullets",
        title: "Fotosintez qanday kechadi",
        bullets,
        footer: "Muallif",
        ...(withPhoto ? { image: { url: "data:image/png;base64,AA" } } : {}),
      },
      theme,
      "classic",
      3,
      10,
      audience,
      "lecture",
    );
    const body = plan.layers.filter((l) => l.t === "text" && "lines" in l && l.lines?.length);
    return Math.min(...body.map((l) => ("size" in l ? l.size : 99)));
  };

  for (const [name, rules] of Object.entries(AUDIENCE_RULES)) {
    const audience = name as keyof typeof AUDIENCE_RULES;

    // Sog'lom aql tekshiruvlari.
    assert.ok(rules.minBullets >= 1, `${name}: minBullets kamida 1`);
    assert.ok(rules.minBullets < rules.maxBullets, `${name}: oraliq bo'lishi kerak`);
    assert.ok(rules.minPt < rules.bodyPt, `${name}: minPt bodyPt dan kichik`);

    // ENG YOMON holat: eng ko'p band, eng uzun matn, rasm bilan (tor ustun).
    const worst = Array.from({ length: rules.maxBullets }, () => "A".repeat(rules.bulletChars));
    const withPhoto = bodySize(worst, audience, true);
    const noPhoto = bodySize(worst, audience, false);

    /*
     * `fitLines` hech qachon `minPt` dan PAST qaytarmaydi — u qisib
     * qo'yadi (`return min`). Ya'ni `minPt` ning O'ZI «sig'madi»
     * degani: shrift kichrayishi tugagan, matn esa qutidan chiqadi.
     *
     * Shuning uchun shart QAT'IY: chegaraviy matn `minPt` dan YUQORI
     * shriftda chizilishi kerak, unga teng emas.
     */
    assert.ok(
      withPhoto > rules.minPt,
      `${name}: ${rules.maxBullets} × ${rules.bulletChars} rasmli slaydda ${withPhoto}pt — ` +
        `${rules.minPt}pt qisish chegarasi, ya'ni matn sig'magan`,
    );
    assert.ok(noPhoto > rules.minPt, `${name}: rasmsiz slaydda ${noPhoto}pt — sig'magan`);
  }

  /*
   * Test BO'SH emasligini isbotlaymiz: uch barobar uzun matn qisish
   * chegarasiga urilishi kerak. Aks holda «har qanday qiymat o'tadi»
   * degani bo'lardi va test hech narsani ushlamasdi.
   */
  const tooLong = Array.from({ length: 5 }, () => "A".repeat(AUDIENCE_RULES.lecture.bulletChars * 3));
  assert.equal(
    bodySize(tooLong, "lecture", true),
    AUDIENCE_RULES.lecture.minPt,
    "uch barobar uzun matn qisish chegarasiga urilishi kerak — aks holda test bo'sh",
  );
});

test("slayd so'rovi oraliq beradi, faqat shift emas", async () => {
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const { fallbackSlides } = await import("../lib/generation/slide-write.ts");
  const { AUDIENCE_RULES } = await import("../lib/generation/slide-templates.ts");

  /*
   * Model faqat yuqori chegara berilganda eng qisqa variantni tanlaydi:
   * jonli o'lchovda ruxsat etilgan 480 belgidan 174 tasi ishlatilardi.
   * Prompt endi ORALIQ va POL beradi.
   *
   * `slideSystem` eksport qilinmagan (ichki funksiya), shuning uchun
   * tekshiruv `subtitle` chegaralari orqali — ular ham shu o'zgarish
   * doirasida maketga moslangan.
   */
  const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Fotosintez", quality: "standard" } as never);
  const slides = fallbackSlides(meta);

  // `section` va `closing` — ilgari BO'SH chiqadigan slaydlar.
  const section = slides.find((s) => s.layout === "section");
  const closing = slides.find((s) => s.layout === "closing");
  assert.ok(section, "shablon section slaydini berishi kerak");
  assert.ok(closing, "shablon closing slaydini berishi kerak");

  // Auditoriya qoidalarida pol bor — prompt shundan oraliq quradi.
  for (const rules of Object.values(AUDIENCE_RULES)) {
    const lo = Math.round((rules.bulletChars * 0.55) / 8);
    const hi = Math.round(rules.bulletChars / 8);
    assert.ok(lo >= 8, `pastki chegara juda kichik: ${lo} so'z`);
    assert.ok(hi > lo, `oraliq bo'lishi kerak: ${lo}–${hi}`);
  }
});
