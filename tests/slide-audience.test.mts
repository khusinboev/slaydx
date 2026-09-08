import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { slideSystem } from "../lib/generation/slide-prompt/index.ts";
import { SLIDE_TEMPLATE_BY_ID } from "../lib/generation/slide-templates.ts";
import { AUDIENCE_RULES } from "../lib/generation/slide-audience.ts";
import { PURPOSE_DEFAULTS, SLIDE_PURPOSES } from "../lib/generation/slide-purpose.ts";

/**
 * WP-A — brif prompti: auditoriya, taqdimot turi, asosiy g'oyalar,
 * mahalliy misollar `briefLines` (`lib/generation/slide-prompt/brief.ts`)
 * dan chiqadigan promptga qo'shilishini tekshiradi. `fetch` stub kerak
 * emas — `slideSystem` faqat matn yig'adi, LLM chaqirmaydi.
 */

const pro = TOOL_BY_ID["pro-slide"];
const lecture = SLIDE_TEMPLATE_BY_ID.lecture;
const meta = (v: FormValues) => extractMeta(pro, { topic: "Suv aylanishi", ...v });
const prompt = (v: FormValues) => slideSystem(meta(v), lecture);

// ───────────────────────────────────────────── taqdimot turi (9)

test("9 tur: 8 tasida TAQDIMOT TURI qatori bor, general da yo'q, hech biri takrorlanmaydi", () => {
  assert.equal(SLIDE_PURPOSES.length, 9, "reyestrdagi tur soni endi 9 emas — testni yangilang");
  const lines = new Map<string, string>();
  for (const p of SLIDE_PURPOSES) {
    const text = prompt({ slidePurpose: p });
    const match = text.match(/^TAQDIMOT TURI — .+$/m);
    if (p === "general") {
      assert.equal(match, null, "general da TAQDIMOT TURI qatori chiqmasin");
    } else {
      assert.ok(match, `${p}: TAQDIMOT TURI qatori yo'q`);
      lines.set(p, match![0]);
    }
  }
  assert.equal(lines.size, 8, "8 ta tur qatorli bo'lishi kerak");
  const uniqueLines = new Set(lines.values());
  assert.equal(uniqueLines.size, lines.size, "ikkita tur bir xil TAQDIMOT TURI qatorini beryapti");
  // Label allaqachon noyob — bu qatorlar `label` farqi bilan emas, aynan
  // `guidance` matni bilan farqlanishini alohida tekshiramiz.
  const guidances = SLIDE_PURPOSES.filter((p) => p !== "general").map((p) => PURPOSE_DEFAULTS[p].guidance);
  assert.equal(new Set(guidances).size, guidances.length, "ikkita tur bir xil guidance matnini ishlatyapti");
});

// ───────────────────────────────────────────── asosiy g'oyalar

test("keyIdeas 3 tasi promptda raqamlangan holda chiqadi, bo'sh bo'lsa ASOSIY G'OYALAR yo'q", () => {
  const withIdeas = prompt({ keyIdeas: "Suv buglanadi,Bulut hosil boladi,Yomgir yogadi" });
  assert.match(withIdeas, /ASOSIY G‘OYALAR/);
  assert.match(withIdeas, /1\) Suv buglanadi/);
  assert.match(withIdeas, /2\) Bulut hosil boladi/);
  assert.match(withIdeas, /3\) Yomgir yogadi/);

  const without = prompt({});
  assert.doesNotMatch(without, /ASOSIY G‘OYALAR/);
});

// ───────────────────────────────────────────── mahalliy misollar

test("localExamples true/false — MAHALLIY MISOLLAR qatori bor/yo'q", () => {
  const on = prompt({ localExamples: true });
  const off = prompt({ localExamples: false });
  assert.match(on, /MAHALLIY MISOLLAR/);
  assert.doesNotMatch(off, /MAHALLIY MISOLLAR/);
});

// ───────────────────────────────────────────── 14 auditoriya

test("14 auditoriya note si promptda chiqadi va 14 tasi noyob", () => {
  const ids = Object.keys(AUDIENCE_RULES);
  assert.equal(ids.length, 14, "auditoriya soni endi 14 emas — testni yangilang");
  const notes = new Set<string>();
  for (const id of ids) {
    const rule = AUDIENCE_RULES[id as keyof typeof AUDIENCE_RULES];
    const text = prompt({ slideAudience: id });
    assert.ok(text.includes(rule.note), `${id}: note promptda topilmadi`);
    notes.add(rule.note);
  }
  assert.equal(notes.size, 14, "auditoriya note'lari orasida takror bor");
});
