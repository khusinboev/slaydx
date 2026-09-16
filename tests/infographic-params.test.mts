import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { budgetFor } from "../lib/generation/budget.ts";
import { INFOGRAPHIC_FORM_FIELDS, INFOGRAPHIC_PARAMS, type InfographicParamImpact } from "../lib/generation/infographic-params.ts";
import { buildInfographicArtifact } from "../lib/generation/infographic/engine.ts";
import { infographicInputFromValues } from "../lib/generation/infographic/input.ts";
import { infographicCtx, infographicPrompt, infographicSystemPrompt } from "../lib/generation/infographic/prompts.ts";
import { infographicTypeOf } from "../lib/generation/infographic/registry.ts";
import { layoutInfographic } from "../lib/generation/infographic/layout.ts";
import { renderInfographic } from "../lib/generation/infographic/svg.ts";
import { paletteOf } from "../lib/generation/infographic/types.ts";

/**
 * INFOGRAFIKA PARAMETR SHARTNOMASI — «bezak maydon yo'q» kafolati
 * (mahsulot egasi qarori 14). `tests/essay-params.test.mts` naqshi:
 * reyestrdagi har parametr uchun `probeA`/`probeB` bilan differensial
 * zond va e'lon qilingan HAR ta'sirda A ≠ B.
 *
 * `layout` ta'siri CHIZILGAN plakat (SVG satri) bilan o'lchanadi,
 * geometriya bilan emas: maket ataylab RANGSIZ (`layout.ts` izohi), ya'ni
 * palitra unga tegmaydi — lekin foydalanuvchi ko'radigan PLAKAT
 * o'zgaradi. Zond foydalanuvchi ko'rgan narsani o'lchashi kerak.
 *
 * Mutatsiya: reyestrga hech narsaga ta'sir qilmaydigan maydon qo'shilsa
 * yoki mavjud maydon promptdan/maketdan olib tashlansa — zond qizaradi.
 */

const tool = TOOL_BY_ID.infographic;

const BASE: FormValues = {
  topic: "Suv aylanishi",
  infographicType: "list",
  blockCount: 3,
  palette: "indigo",
  size: "A4",
  language: "uz",
  extra: "",
};

/* ────────────────────────── stub ────────────────────────── */

/*
 * Javob ATAYLAB `source` bilan: manba qatori plakatning YAGONA
 * tarjima qilinadigan joyi (`Manba:` / `Источник:`), ya'ni `language`
 * ning maketga ta'siri aynan shu qatorda ko'rinadi. `stat` esa
 * `extra` zondining hisobotga ta'sirini ochadi: raqam foydalanuvchi
 * ma'lumotida bo'lsa `sourceGrounded` yashil, bo'lmasa qizil.
 */
const stubComplete = (async (role: LlmRole, _system: string, user: string) => {
  if (role === "judge") return null;
  const m = /^BLOCKS: (\d+)$/m.exec(user);
  const n = m ? Number(m[1]) : 3;
  return {
    text: JSON.stringify({
      title: `${/^TOPIC: (.+)$/m.exec(user)?.[1] ?? "Plakat"} — asosiy jihatlari`,
      subtitle: "Chap tomon — O'ng tomon",
      source: "6-sinf darsligi",
      blocks: Array.from({ length: n }, (_, i) => ({
        icon: "bulb",
        heading: `Bosqich ${i + 1}`,
        text: "Bu blokda mavzuga oid aniq bir fakt qisqa bayon qilinadi.",
        order: i + 1,
        when: String(1991 + i),
        side: i % 2 === 0 ? "left" : "right",
        role: i % 2 === 0 ? "cause" : "effect",
        stat: { value: "71%", label: "ulush" },
      })),
    }),
  };
}) as never;

/* ────────────────────────── zond ────────────────────────── */

type Probe = Record<InfographicParamImpact, string>;

async function probe(values: FormValues): Promise<Probe> {
  const v = { ...BASE, ...values };
  const meta = extractMeta(tool, v);
  const input = infographicInputFromValues(meta, v);
  const ctx = infographicCtx(infographicTypeOf(input.type), input);
  const built = await buildInfographicArtifact(tool, v, { deadline: Date.now() + 180_000, complete: stubComplete, judge: false, polish: false });
  assert.ok(built, "zond: plakat qurilishi kerak");
  const spec = built!.doc.infographic!.spec;
  const layout = layoutInfographic(spec);
  return {
    prompt: [infographicSystemPrompt(ctx), infographicPrompt(ctx)].join("\n"),
    structure: JSON.stringify({ type: spec.type, n: spec.blocks.length, fields: spec.blocks.map((b) => [b.order, b.side, b.role, b.when, b.stat?.value]) }),
    layout: renderInfographic(layout, paletteOf(spec.palette)),
    palette: spec.palette,
    review: JSON.stringify((built!.doc.infographic!.review?.checks ?? []).filter((c) => !c.id.startsWith("judge:")).map((c) => [c.id, c.level, c.detail])),
    language: `${input.language}/${built!.doc.meta.language}/${spec.language}`,
    budget: String(budgetFor(tool, v, 600_000)),
  };
}

/* ────────────────────────── testlar ────────────────────────── */

test("reyestr: 7 parametr, forma qamrovi ro'yxati bilan mos", () => {
  assert.equal(INFOGRAPHIC_PARAMS.length, 7);
  assert.deepEqual(INFOGRAPHIC_FORM_FIELDS, INFOGRAPHIC_PARAMS.map((p) => p.id));
  assert.equal(new Set(INFOGRAPHIC_FORM_FIELDS).size, INFOGRAPHIC_PARAMS.length, "id lar takrorlanmasin");
});

test("reyestr: formadagi HAR maydon reyestrda e'lon qilingan (va aksincha)", () => {
  const formFields = tool.fields.map((f) => f.name);
  const declared = new Set(INFOGRAPHIC_FORM_FIELDS);
  for (const name of formFields) {
    assert.ok(declared.has(name), `«${name}» formada bor, lekin reyestrda yo'q — zond uni tekshirmaydi`);
  }
  // `topic` va `extra` `StandardForm` ning umumiy maydonlari — `fields` da emas.
  for (const id of INFOGRAPHIC_FORM_FIELDS) {
    assert.ok(formFields.includes(id) || id === "topic" || id === "extra", `«${id}» reyestrda bor, lekin formada chizilmaydi`);
  }
});

test("differensial zond: reyestrdagi HAR parametr e'lon qilingan ta'sirini beradi", async () => {
  const failures: string[] = [];
  for (const p of INFOGRAPHIC_PARAMS) {
    const base = p.probeWith ?? {};
    const a = await probe({ ...base, [p.id]: p.probeA });
    const b = await probe({ ...base, [p.id]: p.probeB });
    for (const impact of p.impacts) {
      if (a[impact] === b[impact]) failures.push(`${p.id} → ${impact}`);
    }
  }
  assert.deepEqual(failures, [], `bezak parametrlar (A va B bir xil chiqdi):\n  ${failures.join("\n  ")}`);
});

test("zond maydonlari o'lik emas: har ta'sir kamida bitta parametrda e'lon qilingan", () => {
  const declared = new Set(INFOGRAPHIC_PARAMS.flatMap((p) => p.impacts));
  for (const impact of ["prompt", "structure", "layout", "palette", "review", "language", "budget"] as InfographicParamImpact[]) {
    assert.ok(declared.has(impact), `${impact}: hech bir parametr bu ta'sirni e'lon qilmagan — zond o'lik`);
  }
});

test("narx: parametrlar narxga TA'SIR QILMAYDI (tekis 2 000)", () => {
  assert.equal(priceFor(tool, BASE), 2000);
  for (const p of INFOGRAPHIC_PARAMS) {
    assert.equal(priceFor(tool, { ...BASE, [p.id]: p.probeB }), 2000, `${p.id} narxni o'zgartirdi`);
  }
});
