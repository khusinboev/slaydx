import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { LAYOUT_KIT, planSlide, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { AUDIENCE_RULES, bodyRules } from "../lib/generation/slide-audience.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import { DESIGN_VISUALS, LEGACY_VISUALS } from "../lib/generation/visuals/index.ts";
import type { SlideAudience, SlideVisual } from "../lib/generation/slide-templates.ts";

/**
 * AUDIT-25 integratsiya sharhi — reja (agenda) slaydi.
 *
 * INT-01: `syncAgenda` AYNAN `planN` (5–6) band yozadi va har bandning
 * o'z slaydi bor; `dashboard` esa `slice(0, 4)` qilardi — hisobot
 * dekasi rejaning oxirgi bandlarini yashirardi.
 *
 * INT-02: reja bandlari endi reja slaydlarining SARLAVHALARI (72
 * belgigacha). Qator shrifti `fitSize(…, minPt - 1)` edi — polda
 * sig'masa ham shu o'lchamda qolib toshardi (1–4-sinf 6 × 72 belgi —
 * 17 maketning hammasida 112–159 %). Shartnoma: har reja qatori o'z
 * qutisiga SIG'ADI va 14 pt (`AGENDA_FLOOR_PT`) dan kichik emas.
 * Qutini yozuv bosqichi (P11 `fitChars("agenda", …)`) `agendaRowBox`
 * dan o'qiydi — u maketning o'zi chizgan quti bilan bir xil.
 */

type TextLayer = Extract<SlideLayer, { t: "text" }>;
const W = 13.333;
const H = 7.5;
const VISUALS = [...LEGACY_VISUALS, ...DESIGN_VISUALS] as SlideVisual[];
const AUDIENCES = Object.keys(AUDIENCE_RULES) as SlideAudience[];
const IMG = "https://example.test/a.png";

/*
 * Maketdan MUSTAQIL o'lchov (fit matritsasi bilan bir xil): belgi eni
 * 0.55 em (loyiha standarti, Liberation Sans o'lchovidan zaxira bilan),
 * qator balandligi 1.3 × pt, ochko'z so'z o'rash, qatordan uzun so'z bir
 * necha qator oladi. Maketning `fitSize`/`inkHeight` i import QILINMAYDI.
 */
const CHAR_EM = 0.55;
function inkIn(text: string, w: number, size: number): number {
  const perLine = Math.max(1, Math.floor((w * 72) / (size * CHAR_EM)));
  let rows = 0;
  let col = 0;
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (rows === 0) rows = 1;
    if (word.length > perLine) {
      if (col > 0) rows += 1;
      rows += Math.ceil(word.length / perLine) - 1;
      col = word.length % perLine || perLine;
      continue;
    }
    const next = col === 0 ? word.length : col + 1 + word.length;
    if (next <= perLine) col = next;
    else {
      rows += 1;
      col = word.length;
    }
  }
  return (rows * size * 1.3) / 72;
}

/** So'z chegarasida, AYNAN `n` belgigacha to'ldirilgan o'zbekcha band. */
const WORDS =
  "Orol dengizi havzasida sug'orish tizimlarining iqlim va aholi salomatligiga ta'siri hamda qayta tiklash choralari".split(
    " ",
  );
function textOf(n: number, seed: number): string {
  let out = "";
  let k = seed;
  while (true) {
    const w = WORDS[k % WORDS.length];
    const next = out ? `${out} ${w}` : w;
    if (next.length > n) break;
    out = next;
    k += 1;
  }
  return out.padEnd(n, ".").slice(0, n);
}

function agenda(items: string[], img: boolean): SlideModel {
  return { id: "a", layout: "agenda", title: "Reja", bullets: items, ...(img ? { image: { url: IMG } } : {}) };
}

const rows = (layers: SlideLayer[]) =>
  layers.filter((l): l is TextLayer => l.t === "text" && l.src?.f === "bullets");

const overlaps = (a: TextLayer["box"], b: TextLayer["box"]) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;

test("INT-01: 6 bandli reja — 17 maketning HAMMASIDA 6 ta band, har biri o'z src.i, slayd ichida, kesishmaydi", () => {
  const items = Array.from({ length: 6 }, (_, i) => textOf(40, i * 3));
  for (const visual of VISUALS) {
    for (const themeId of ["atlas", "ink"]) {
      for (const img of [false, true]) {
        for (const logo of [undefined, "data:image/png;base64,AA"]) {
          const tag = `${visual}/${themeId}/${img ? "rasm" : "rasmsiz"}${logo ? "/logo" : ""}`;
          const bodyType = bodyRules({ slideAudience: "general", textVolume: "standart", planItems: 6 }, "lecture");
          const plan = planSlide(agenda(items, img), getSlideTheme(themeId), visual, 1, 12, "auto", "lecture", { bodyType, logo });
          const rs = rows(plan.layers);
          assert.deepEqual(
            rs.map((l) => (l.src as { i: number }).i).sort(),
            [0, 1, 2, 3, 4, 5],
            `${tag}: reja bandlari ${rs.length}/6 (src.i ${JSON.stringify(rs.map((l) => (l.src as { i: number }).i))})`,
          );
          for (const l of rs) {
            assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01, `${tag}: manfiy koordinata`);
            assert.ok(l.box.x + l.box.w <= W + 0.01 && l.box.y + l.box.h <= H + 0.01, `${tag}: slayddan chiqdi`);
          }
          for (let a = 0; a < rs.length; a++) {
            for (let b = a + 1; b < rs.length; b++) {
              assert.ok(!overlaps(rs[a].box, rs[b].box), `${tag}: ${a} va ${b} bandlar kesishdi`);
            }
          }
        }
      }
    }
  }
});

test("INT-02: 3–6 × 72 belgili band × 14 auditoriya × 17 maket — har qator qutisiga SIG'ADI, ≥ 14 pt", () => {
  let checked = 0;
  for (const visual of VISUALS) {
    for (const aud of AUDIENCES) {
      for (const n of [3, 4, 5, 6]) {
        for (const img of [false, true]) {
          const bodyType = bodyRules({ slideAudience: aud, textVolume: "standart", planItems: n }, "lecture");
          const items = Array.from({ length: n }, (_, i) => textOf(72, i * 2));
          const plan = planSlide(agenda(items, img), getSlideTheme("atlas"), visual, 1, 12, aud, "lecture", { bodyType });
          const rs = rows(plan.layers);
          assert.equal(rs.length, n, `${visual}/${aud}/${n}: ${rs.length} band chizildi`);
          for (const l of rs) {
            const tag = `${visual}/${aud}/n=${n}/${img ? "rasm" : "rasmsiz"}/#${(l.src as { i: number }).i}`;
            const t = l.text ?? "";
            const ink = inkIn(t, l.box.w, l.size);
            assert.ok(ink <= l.box.h + 0.01, `${tag}: ${l.size} pt da ${ink.toFixed(2)}″ > quti ${l.box.h.toFixed(2)}″ (eni ${l.box.w.toFixed(2)}″)`);
            assert.ok(l.size >= 14, `${tag}: ${l.size} pt < 14 pt himoya poli`);
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked > 5000, `${checked} qator`);
});

test("INT-02: agendaRowBox — maket chizgan qutining o'zi (yagona manba), har dizayn × n × auditoriya", () => {
  assert.equal(LAYOUT_KIT.AGENDA_FLOOR_PT, 14);
  for (const visual of VISUALS) {
    for (const aud of ["school_1_4", "general"] as SlideAudience[]) {
      for (const n of [3, 5, 6]) {
        for (const img of [false, true]) {
          const bodyType = bodyRules({ slideAudience: aud, textVolume: "standart", planItems: n }, "lecture");
          const box = LAYOUT_KIT.agendaRowBox(visual, n, bodyType, { image: img });
          assert.ok(box, `${visual}: agendaRowBox null`);
          const items = Array.from({ length: n }, (_, i) => textOf(72, i));
          const rs = rows(planSlide(agenda(items, img), getSlideTheme("ink"), visual, 3, 12, aud, "lecture", { bodyType }).layers);
          const minW = Math.min(...rs.map((l) => l.box.w));
          const minH = Math.min(...rs.map((l) => l.box.h));
          assert.ok(Math.abs(box!.w - minW) < 1e-9 && Math.abs(box!.h - minH) < 1e-9, `${visual}/${aud}/${n}: agendaRowBox ${box!.w}×${box!.h} ≠ maket ${minW}×${minH}`);
        }
      }
    }
  }
});

/**
 * Sig'im kafolati: 40 belgigacha reja bandi (1–4-sinfda eng tor maket —
 * dashboard 6 plita — sig'imi) HAR maket × auditoriya × n da auditoriya
 * POLIDA (`minPt`) yoki kattaroq chiziladi va sig'adi. Split ustuni tor
 * (4.7″) — band qo'shni (boshqa yarimdagi) qatorlar balandligiga kengayadi;
 * ilgari 1–4-sinfda 25 belgidan uzun band polda sig'masdi.
 */
test("INT-02: 40 belgili band — har maket × 14 auditoriya × n 3–6 da auditoriya polida (≥ minPt) va sig'adi", () => {
  for (const visual of VISUALS) {
    for (const aud of AUDIENCES) {
      for (const n of [3, 4, 5, 6]) {
        const bodyType = bodyRules({ slideAudience: aud, textVolume: "standart", planItems: n }, "lecture");
        const items = Array.from({ length: n }, (_, i) => textOf(40, i * 2).replace(/\.+$/, ""));
        const rs = rows(planSlide(agenda(items, false), getSlideTheme("atlas"), visual, 1, 12, aud, "lecture", { bodyType }).layers);
        for (const l of rs) {
          const tag = `${visual}/${aud}/n=${n}/#${(l.src as { i: number }).i}`;
          assert.ok(l.size >= bodyType.minPt, `${tag}: ${l.size} pt < auditoriya poli ${bodyType.minPt}`);
          assert.ok(inkIn(l.text ?? "", l.box.w, l.size) <= l.box.h + 0.01, `${tag}: sig'madi`);
        }
      }
    }
  }
});

/**
 * Eski doc_json (qisqa bandlar, sig'adigan matn) — reja slaydi 879f495
 * bilan AYNAN teng: qator geometriyasi o'zgarmadi, pol faqat SIG'MAGAN
 * matnda pastga davom etadi. `dashboard` 5–6 band — ataylab o'zgargan
 * (INT-01), shuning uchun u yerda faqat 3–4 band.
 */
test("INT-02: qisqa bandli reja 879f495 bilan AYNAN teng (barmoq izi)", () => {
  const out: string[] = [];
  const theme = getSlideTheme("atlas");
  for (const visual of VISUALS) {
    for (const n of [3, 4, 5, 6]) {
      if (visual === "dashboard" && n > 4) continue;
      for (const img of [false, true]) {
        for (const aud of ["school_5_7", "general"] as SlideAudience[]) {
          const bodyType = bodyRules({ slideAudience: aud, textVolume: "standart", planItems: n }, "lecture");
          const items = Array.from({ length: n }, (_, i) => textOf(24, i));
          const p = planSlide(agenda(items, img), theme, visual, 1, 12, aud, "lecture", { bodyType });
          out.push(
            `${visual}/${n}/${img}/${aud}|` +
              p.layers
                .map((l) => {
                  const b = l.box;
                  const tail = l.t === "text" ? `${l.size}:${l.text ?? (l.lines ?? []).join("\n")}` : "";
                  return `${l.t}:${b.x.toFixed(4)},${b.y.toFixed(4)},${b.w.toFixed(4)},${b.h.toFixed(4)},${tail}`;
                })
                .join(";"),
          );
        }
      }
    }
  }
  const hash = createHash("sha256").update(out.join("\n")).digest("hex").slice(0, 32);
  assert.equal(hash, "34e0b602adc7566fbb7daedaebd99f2a", "qisqa bandli reja geometriyasi o'zgardi — eski dekalar boshqacha chiziladi");
});
