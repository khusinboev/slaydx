import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { photoSlot, planSlide, type Box, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { plannedImageSlots } from "../lib/generation/slide-images.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { SLIDE_THEMES, getSlideTheme } from "../lib/generation/slide-themes.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * AUDIT-9 E2 — `twoCol`/`compare`/`stats`/`process`/`table` uchun rasm
 * TASMASI.
 *
 * Pro slaydning va'dasi «har mos slaydga rasm» edi, amalda esa faqat
 * oltita maket (`title`, `section`, `bullets`, `agenda`, `quote`,
 * `closing`) rasm ko'tarardi — ya'ni ~60% slayd. Bu beshtasi endi o'ng
 * chekkada tor tasma oladi, matn qutilari esa shuncha torayadi.
 *
 * Test ikki yarimdan iborat va IKKALASI ham majburiy:
 *
 *   RASM BOR  — tasma AYNAN `photoSlot` qutisida; birorta matn qatlami
 *               tasma bilan KESISHMAYDI; hech nima chegaradan chiqmaydi;
 *               shrift Slide Law polidan pastga tushmaydi.
 *   RASM YO'Q — maket AYNAN eskicha. Bu «tasma kodi rasmsiz slaydga
 *               sizib o'tmasin» degani: `cut` shartsiz qo'llansa, butun
 *               mavjud deka jimgina siljib ketardi.
 */

const LAYOUTS = ["twoCol", "compare", "stats", "process", "table"] as const;
const VISUALS = ["classic", "cards", "dense", "timeline", "magazine", "hero-split"] as const;
const bodyType = bodyRules({ slideAudience: "auto", textVolume: "standart", planItems: 5 }, "lecture");
const theme = getSlideTheme("atlas");

/** Tasma qutisi — kodning O'ZIDAN olinadi, test uni qayta hisoblamaydi. */
const STRIP = photoSlot("twoCol", "classic")!;

const IMG = "data:image/png;base64,AA";

const texts = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "text" }> => l.t === "text");
const images = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "image" }> => l.t === "image");

/**
 * Namunalar ATAYLAB to'la: 4 stat, 4 bosqich, 3×3 jadval, ikki ustunda
 * 3 banddan. Toraygan zonada aynan shu hajm eng qattiq bosim beradi —
 * bo'sh model bilan sinov hech narsani ushlamasdi.
 */
function sample(layout: (typeof LAYOUTS)[number], withImage: boolean): SlideModel {
  const base: Record<string, unknown> = { id: `s-${layout}`, layout, title: "Ko'rsatkichlar tahlili va xulosalar" };
  if (layout === "twoCol" || layout === "compare") {
    Object.assign(base, {
      leftTitle: "Ijobiy tomonlari",
      left: ["Birinchi band gapi to'liq yozilgan.", "Ikkinchi band gapi.", "Uchinchi band gapi ham bor."],
      rightTitle: "Salbiy tomonlari",
      right: ["To'rtinchi band gapi.", "Beshinchi band gapi.", "Oltinchi band."],
    });
  }
  if (layout === "stats") {
    base.stats = [
      { value: "95%", label: "O'quvchilar qoniqishi" },
      { value: "72%", label: "Takroriy murojaat" },
      { value: "31%", label: "Yillik o'sish" },
      { value: "12%", label: "Yo'qotish darajasi" },
    ];
  }
  if (layout === "process") {
    base.steps = [1, 2, 3, 4].map((n) => ({ n: `${n}`, title: `Bosqich ${n}`, text: "Bosqich mazmuni qisqacha izohlanadi." }));
  }
  if (layout === "table") {
    base.table = {
      headers: ["Ko'rsatkich", "2023-yil", "2024-yil"],
      rows: [
        ["Umumiy daromad", "10 mlrd", "12 mlrd"],
        ["Xarajatlar", "5 mlrd", "6 mlrd"],
        ["Sof foyda", "5 mlrd", "6 mlrd"],
      ],
    };
  }
  if (withImage) base.image = { url: IMG, alt: "Mavzuga oid kadr" };
  return base as SlideModel;
}

/**
 * Bir maketning IKKI TARMOQLI holatlari.
 *
 * `planStats` ichida ikki butunlay boshqa chizmasi bor: qiymatlar bir
 * birlikda va uchtadan ko'p bo'lsa — DIAGRAMMA, aks holda — KARTALAR.
 * Yuqoridagi `sample("stats")` to'rtta foiz beradi, ya'ni har doim
 * diagramma tarmog'iga tushadi va kartalar tarmog'i sinovsiz qolardi
 * (mutatsiya M11 aynan shu teshikdan o'tib ketgan edi: kartalar
 * kengligidan `cut` olib tashlansa ham testlar yashil qolardi).
 * Shuning uchun aralash birlikli ikkinchi namuna.
 */
function variants(layout: (typeof LAYOUTS)[number], withImage: boolean): Array<[string, SlideModel]> {
  const out: Array<[string, SlideModel]> = [[layout, sample(layout, withImage)]];
  if (layout === "stats") {
    const cards = sample("stats", withImage) as SlideModel & { stats: Array<{ value: string; label: string }> };
    // Aralash birlik → `oneUnit` false → KARTALAR tarmog'i.
    cards.stats = [
      { value: "95%", label: "O'quvchilar qoniqishi" },
      { value: "12 mln", label: "Yillik aylanma" },
      { value: "3,4x", label: "O'sish koeffitsiyenti" },
      { value: "48 soat", label: "O'rtacha javob vaqti" },
    ];
    out.push(["stats-kartalar", cards]);
  }
  return out;
}

const plan = (s: SlideModel, visual: (typeof VISUALS)[number], th = theme, logo?: string) =>
  planSlide(s, th, visual, 1, 10, "auto", "lecture", { bodyType, logo });

function overlaps(a: Box, b: Box): boolean {
  // 0.01″ tolerantlik — chegaraga TEGIB turish kesishish emas.
  return a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;
}

// ═══════════════════════════════════════════════════ 1. Tasma qutisi

test("photoSlot beshta kontent maketiga ham tasma qutisini qaytaradi", () => {
  for (const layout of LAYOUTS) {
    for (const visual of VISUALS) {
      const slot = photoSlot(layout, visual);
      assert.ok(slot, `${layout}/${visual}: rasm joyi bo'lishi kerak (E2)`);
      // Tasma `visual` ga bog'liq emas — zonani hamma tarmoq bir xil
      // miqdorda bo'shatadi.
      assert.deepEqual(slot, STRIP, `${layout}/${visual}: tasma qutisi bir xil bo'lishi kerak`);
    }
  }
  // Tor va tik: o'ng chekkada, to'la balandlik.
  assert.ok(STRIP.w > 3 && STRIP.w < 4, `tasma tor bo'lishi kerak: ${STRIP.w}`);
  assert.equal(STRIP.y, 0);
  assert.equal(STRIP.h, 7.5, "tasma to'la balandlikda");
  assert.ok(Math.abs(STRIP.x + STRIP.w - 13.333) < 0.001, "tasma o'ng chekkaga yopishadi");
});

test("maketsiz slaydlar (quiz/references/answers) hamon rasm joyisiz", () => {
  for (const layout of ["quiz", "references", "answers"]) {
    assert.equal(photoSlot(layout, "classic"), null, `${layout}: rasm joyi bo'lmasligi kerak`);
  }
});

test("plannedImageSlots endi bu beshta maketni ham sanaydi", () => {
  const deck: SlideModel[] = LAYOUTS.map((l) => sample(l, false));
  const slots = plannedImageSlots(deck, "classic", false, true);
  assert.equal(slots.length, LAYOUTS.length, "beshala slayd ham rasm rejasiga tushishi kerak");
  for (const { size } of slots) {
    // Tik kadr — `aspectFor` uni Gemini'ning 9:16 nisbatiga tushiradi.
    assert.ok(size.height > size.width, `tasma uchun TIK kadr so'ralishi kerak: ${size.width}×${size.height}`);
  }
  // Aralash dekada faqat mos maketlar sanaladi (regressiya: hammasi emas).
  const mixed = plannedImageSlots([...deck, { id: "q", layout: "quiz", title: "Test" } as SlideModel], "classic", false, true);
  assert.equal(mixed.length, LAYOUTS.length, "quiz slaydi rejaga tushmasligi kerak");
});

// ═══════════════════════════════════════ 2. RASM BOR — tasma va matn

test("rasm bo'lsa tasma AYNAN photoSlot qutisida chiziladi", () => {
  for (const layout of LAYOUTS) {
    for (const visual of VISUALS) {
      const imgs = images(plan(sample(layout, true), visual).layers);
      assert.equal(imgs.length, 1, `${layout}/${visual}: aynan bitta rasm qatlami`);
      assert.equal(imgs[0].url, IMG);
      assert.deepEqual(imgs[0].box, STRIP, `${layout}/${visual}: rasm tasma qutisida bo'lishi kerak`);
      // `cover` — standart (`fit` berilmagan), ya'ni tasma to'liq to'ladi.
      assert.equal(imgs[0].fit, undefined, `${layout}/${visual}: tasma "cover" bo'lishi kerak`);
    }
  }
});

test("rasm bo'lsa birorta matn qatlami tasma bilan kesishmaydi", () => {
  for (const t of SLIDE_THEMES) {
    const th = getSlideTheme(t.id);
    for (const layout of LAYOUTS) {
      for (const visual of VISUALS) {
        for (const [tag, model] of variants(layout, true))
          for (const logo of [undefined, IMG]) {
            const p = plan(model, visual, th, logo);
            for (const l of texts(p.layers)) {
              assert.ok(
                !overlaps(l.box, STRIP),
                `${t.id}/${visual}/${tag}${logo ? "+logo" : ""}: «${(l.text ?? l.lines?.[0] ?? "").slice(0, 24)}» tasma ostiga kirdi ` +
                  `(x=${l.box.x.toFixed(2)}..${(l.box.x + l.box.w).toFixed(2)}, tasma ${STRIP.x.toFixed(2)} dan)`,
              );
            }
          }
      }
    }
  }
});

test("rasmli tasma 15 tema × 6 visual da chegaradan chiqmaydi va shrift polida qoladi", () => {
  for (const t of SLIDE_THEMES) {
    const th = getSlideTheme(t.id);
    for (const layout of LAYOUTS) {
      for (const visual of VISUALS) {
        for (const [name, model] of variants(layout, true))
        for (const logo of [undefined, IMG]) {
          const p = plan(model, visual, th, logo);
          const tag = `${t.id}/${visual}/${name}${logo ? "+logo" : ""}`;
          for (const l of p.layers) {
            assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01, `${tag}: manfiy koordinata`);
            assert.ok(l.box.w >= 0 && l.box.h >= 0, `${tag}: manfiy o'lcham (${l.box.w}×${l.box.h})`);
            assert.ok(l.box.x + l.box.w <= 13.34, `${tag}: kenglikdan chiqdi (${l.box.x + l.box.w})`);
            assert.ok(l.box.y + l.box.h <= 7.51, `${tag}: balandlikdan chiqdi (${l.box.y + l.box.h})`);
          }
          /*
           * Slide Law: `fitSize`/`fitLines` toraygan qutida shriftni
           * QAYTA hisoblaydi, lekin hech qachon o'z polidan pastga
           * tushmaydi. Eng past pol shu beshta maketda 10 pt
           * (`planTable` katakchasi) — undan pastga tushgan raqam
           * hisob xatosi bo'lardi, sig'dirish emas.
           */
          for (const l of texts(p.layers)) {
            assert.ok(l.size >= 10, `${tag}: shrift poli buzildi (${l.size} pt)`);
          }
        }
      }
    }
  }
});

/**
 * Toraygan zona matnni SIQIB tashlamasligi kerak.
 *
 * Chegaradan chiqmaslik va shrift poli yetarli EMAS: quti tor bo'lsa,
 * matn shunchaki polga tushib, o'sha tor qutida bir necha qatorga
 * cho'ziladi — «chiqmadi, lekin o'qib bo'lmaydi». Ikki eng nozik joy:
 *
 *   process  4 ta karta 8.57″ zonada 1.83″ ga tushardi (endi 2×2).
 *   stats    diagramma yorlig'i qat'iy 3.6″ bo'lsa, ustunlarga 2.87″
 *            qolardi — 2.5% va 95% bir xil ko'rinardi.
 */
test("toraygan zonada bosqich va yorliq qutilari o'qiladigan kenglikda qoladi", () => {
  for (const visual of VISUALS) {
    const proc = plan(sample("process", true), visual);
    for (const l of texts(proc.layers)) {
      if (l.src?.f === "steps" && l.src.k === "text") {
        assert.ok(l.box.w >= 2.0, `${visual}/process: bosqich matni qutisi juda tor (${l.box.w.toFixed(2)}″)`);
      }
    }

    const st = plan(sample("stats", true), visual);
    const stTexts = texts(st.layers);
    const labels = stTexts.filter((l) => l.src?.f === "stats" && l.src.k === "label");
    const zoneW = Math.max(...stTexts.map((l) => l.box.x + l.box.w)) - 0.68;
    for (const l of labels) {
      assert.ok(
        l.box.w <= zoneW * 0.42,
        `${visual}/stats: yorliq ustuni zonaning yarmidan ko'pini yeb qo'ydi (${l.box.w.toFixed(2)}″ / ${zoneW.toFixed(2)}″)`,
      );
    }
  }
});

/**
 * `dense` (to'q sahifa) va `magazine` (oq sahifa) — tasma aynan shu
 * ikkisida sahifaga qo'shilib ketishi mumkin edi. Shuning uchun tasma
 * ostida to'q taglik va matn zonasi bilan orasida aksent choki bo'ladi.
 */
test("dense va magazine da tasma taglik va aksent choki bilan ajratiladi", () => {
  for (const visual of ["dense", "magazine"] as const) {
    for (const layout of LAYOUTS) {
      const p = plan(sample(layout, true), visual);
      const rects = p.layers.filter((l): l is Extract<SlideLayer, { t: "rect" }> => l.t === "rect");
      assert.ok(
        rects.some((r) => r.box.x === STRIP.x && r.box.w === STRIP.w && r.fill?.color === theme.titleBg),
        `${visual}/${layout}: tasma ostida to'q taglik bo'lishi kerak`,
      );
      const seam = rects.filter((r) => r.fill?.color === theme.accent && r.box.h === 7.5 && r.box.x < STRIP.x && r.box.x + r.box.w >= STRIP.x - 0.001);
      assert.equal(seam.length, 1, `${visual}/${layout}: tasma chekkasida bitta aksent choki bo'lishi kerak`);
    }
  }
});

/**
 * Logotip `LOGO_BOX.x` = 12.15 da, ya'ni TASMA USTIDA. To'la ekranli
 * maketlardagi kabi u ham plashka olishi kerak — aks holda to'q rasmda
 * logo yo'qolib ketardi.
 */
test("tasmali slaydda logotip ostiga plashka qo'yiladi", () => {
  for (const layout of LAYOUTS) {
    const p = plan(sample(layout, true), "classic", theme, IMG);
    const plaque = p.layers.filter(
      (l) => l.t === "rect" && l.fill?.color === theme.bg && (l.fill?.alpha ?? 1) < 1 && l.box.x > 11.9 && l.box.y < 0.2,
    );
    assert.equal(plaque.length, 1, `${layout}: logo plashkasi bo'lishi kerak`);
    // Rasmsiz shu maketda plashka KERAK EMAS — sahifa fonining o'zi yetadi.
    const bare = plan(sample(layout, false), "classic", theme, IMG);
    assert.equal(
      bare.layers.filter((l) => l.t === "rect" && l.fill?.color === theme.bg && (l.fill?.alpha ?? 1) < 1 && l.box.x > 11.9).length,
      0,
      `${layout}: rasmsiz slaydda ortiqcha plashka chizilmasin`,
    );
  }
});

// ═══════════════════════════════════════════ 3. RASM YO'Q — paritet

/**
 * Paritetning YUMSHOQ, o'qiladigan yarmi.
 *
 * Beshala maketning oltala tarmog'i ham kolontitulni `pushFooter` bilan
 * chizadi va unga KONTENT ZONASINING kengligini beradi — ya'ni `cut`
 * shartsiz qo'llansa, aynan shu quti siljiydi. Sahifa raqami zonaning
 * o'ng chekkasida turgani uchun uning o'ng qirrasi zona kengligining
 * to'g'ridan-to'g'ri o'lchovi.
 */
test("rasmsiz slaydda kontent zonasi to'la kenglikda qoladi (tasma zaxirasi olinmaydi)", () => {
  for (const layout of LAYOUTS) {
    for (const visual of VISUALS)
      for (const [tag, model] of variants(layout, false)) {
        const p = plan(model, visual);
        const right = Math.max(...texts(p.layers).map((l) => l.box.x + l.box.w));
        assert.ok(
          right > STRIP.x,
          `${tag}/${visual}: rasmsiz slayd hamon to'la kenglikni egallashi kerak (eng o'ng qirra ${right.toFixed(2)}, tasma ${STRIP.x.toFixed(2)} dan)`,
        );
        assert.equal(images(p.layers).length, 0, `${tag}/${visual}: rasmsiz slaydda rasm qatlami bo'lmasin`);
      }
  }
});

/**
 * Paritetning QAT'IY yarmi — geometriya barmoq izi.
 *
 * `JSON.stringify(plan)` ning E2 dan OLDINGI holati bilan aynan
 * tengligi shu xesh bilan qulflangan. Xesh faqat GEOMETRIYAGA
 * (`layer.box` + shrift o'lchami) qaraladi: rang/tema tahriri uni
 * behuda qizartirmasin, lekin bironta quti bir mingdan bir dyuymga
 * siljisa — darhol ushlansin.
 *
 * Agar siz shu beshta maketning geometriyasini ATAYLAB o'zgartirgan
 * bo'lsangiz, quyidagi xeshni yangilang VA o'zgarishni AUDIT faylida
 * izohlang. Aks holda bu qizil rang — regressiya.
 */
test("rasmsiz maket geometriyasi E2 dan oldingi bilan AYNAN teng (barmoq izi)", () => {
  const rows: string[] = [];
  for (const visual of VISUALS) {
    for (const layout of LAYOUTS) {
      for (const logo of [undefined, IMG]) {
        const p = plan(sample(layout, false), visual, theme, logo);
        rows.push(
          `${visual}/${layout}${logo ? "+logo" : ""}|` +
            p.layers
              .map((l) => {
                const b = l.box;
                const size = l.t === "text" ? l.size : 0;
                return `${l.t}:${b.x.toFixed(4)},${b.y.toFixed(4)},${b.w.toFixed(4)},${b.h.toFixed(4)},${size}`;
              })
              .join(";"),
        );
      }
    }
  }
  const hash = createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 32);
  assert.equal(
    hash,
    /*
     * Yangilangan: AUDIT-8 N-3 (`planStatChart` qatorlari foydali
     * balandlikni qoldiqsiz bo'lib oladi) va N-10 (`process` timeline
     * relsi sarlavha chizig'idan uzoqlashtirildi, tugun nuqtalari
     * qo'shildi) — ikkalasi ham `stats`/`process` GEOMETRIYASINI
     * ataylab o'zgartiradi. Tafsilot: `docs/AUDIT-8.md`, «N-3…N-10
     * yopilishi». Eski xesh: dd1adb15a82b3b6bbb97aa9b4681b11b.
     */
    "23b6f081e48c642414a88a1d96fdcce6",
    "rasmsiz maket geometriyasi o'zgardi — tasma kodi rasmsiz slaydga sizib o'tgan bo'lishi mumkin",
  );
});
