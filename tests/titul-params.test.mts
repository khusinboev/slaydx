import test from "node:test";
import assert from "node:assert/strict";
import { TITUL_FIELD_IDS, encodeTitulValues, titulFieldsOf, titulInputFromValues, type TitulFieldId } from "../lib/generation/title-page/input.ts";
import { planTitlePage } from "../lib/generation/title-page/layout.ts";
import {
  TITUL_APPROVER_ROLES,
  TITUL_CHECKER_LABELS,
  TITUL_LAB_KINDS,
  TITUL_LANGS,
  TITUL_LAYOUTS_OF,
  TITUL_MINISTRIES,
  TITUL_WORK_TYPES,
  type TitulInput,
} from "../lib/generation/title-page/types.ts";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * «Bezak maydon yo'q» differential probe (the `tests/slide-params.test.mts` pattern) for «Titul»: for every work
 * type × offered layout, every field the form draws (`titulFieldsOf`) is changed ONE at a time and the page plan must
 * change; every field the form does NOT draw is changed too and the plan must NOT change (so hiding it loses
 * nothing). The price stays 0 for every probe (free tool).
 *
 * Mutations (each turned a test red, then restored):
 *   M1. `titulFieldsOf` stops listing `group` -> «hidden fields change nothing» (the classic note uses it);
 *   M2. classic stops drawing the subject line -> «every drawn field changes the plan» (`subject`);
 *   M3. `"title-page"` `basePrice: 0` -> 500 -> «free for every probe».
 */

const BASE: FormValues = {
  ministry: "custom",
  ministryCustom: "Raqamli texnologiyalar vazirligi",
  university: "Toshkent axborot texnologiyalari universiteti",
  faculty: "Kompyuter injiniringi",
  department: "Axborot xavfsizligi",
  subject: "Dasturlash asoslari",
  topic: "Sun'iy intellekt",
  author: "Aliyev V.",
  group: "912-21",
  course: "3",
  direction: "Kompyuter injiniringi",
  directionCode: "60610100",
  supervisor: "Karimov B.",
  supervisorRole: "katta o'qituvchi",
  approver: "Rahimov S.",
  reviewer: "dotsent Yusupov A.",
  udk: "004.8",
  specialityCode: "70610101",
  speciality: "Axborot xavfsizligi",
  labNumber: "3",
  city: "Samarqand",
  year: 2026,
};

function other<T extends string>(list: readonly T[], cur: T): T {
  return list.find((x) => x !== cur)!;
}

/** A different valid value of one field. */
function changed(input: TitulInput, id: TitulFieldId): Partial<FormValues> {
  switch (id) {
    case "workType":
      return { workType: other(TITUL_WORK_TYPES, input.workType) };
    case "layout":
      return { layout: other(TITUL_LAYOUTS_OF[input.workType], input.layout) };
    case "lang":
      return { lang: other(TITUL_LANGS, input.lang) };
    case "ministry":
      return { ministry: other(TITUL_MINISTRIES, input.ministry) };
    case "checkerLabel":
      return { checkerLabel: other(TITUL_CHECKER_LABELS, input.checkerLabel) };
    case "approverRole":
      return { approverRole: other(TITUL_APPROVER_ROLES, input.approverRole) };
    case "labKind":
      return { labKind: other(TITUL_LAB_KINDS, input.labKind) };
    case "year":
      return { year: input.year + 1 };
    case "border":
      return { border: !input.border };
    case "course":
      return { course: "4" };
    case "labNumber":
      return { labNumber: "7" };
    default:
      return { [id]: `${String(input[id])} Yangi` };
  }
}

const planOf = (v: FormValues) => JSON.stringify(planTitlePage({ input: titulInputFromValues(v), overrides: {} }));

test("the field registry covers every TitulInput key, once", () => {
  const keys = Object.keys(titulInputFromValues({})).sort();
  assert.deepEqual([...TITUL_FIELD_IDS].sort(), keys);
  assert.equal(new Set(TITUL_FIELD_IDS).size, TITUL_FIELD_IDS.length);
});

test("every drawn field changes the plan; every hidden field changes nothing", () => {
  let probes = 0;
  for (const workType of TITUL_WORK_TYPES) {
    for (const layout of TITUL_LAYOUTS_OF[workType]) {
      const values: FormValues = { ...BASE, workType, layout };
      const input = titulInputFromValues(values);
      const before = planOf(values);
      const shown = new Set(titulFieldsOf(workType, layout, input.ministry));
      for (const id of TITUL_FIELD_IDS) {
        if (id === "layout" && TITUL_LAYOUTS_OF[workType].length < 2) continue;
        const after = planOf({ ...encodeTitulValues(input), ...changed(input, id) });
        if (shown.has(id)) assert.notEqual(after, before, `${workType}/${layout}: «${id}» is drawn but changes nothing`);
        else assert.equal(after, before, `${workType}/${layout}: «${id}» is hidden but changes the page`);
        probes++;
      }
    }
  }
  assert.ok(probes > 400, `probes: ${probes}`);
});

test("ministryCustom is drawn only for an own ministry text", () => {
  const input = titulInputFromValues({ ...BASE, ministry: "oliy" });
  assert.ok(!titulFieldsOf(input.workType, input.layout, "oliy").includes("ministryCustom"));
  assert.equal(planOf({ ...BASE, ministry: "oliy" }), planOf({ ...BASE, ministry: "oliy", ministryCustom: "Boshqa" }));
});

test("free for every probe: priceFor is 0", () => {
  const tool = TOOL_BY_ID["title-page"];
  for (const workType of TITUL_WORK_TYPES) {
    for (const layout of TITUL_LAYOUTS_OF[workType]) assert.equal(priceFor(tool, { ...BASE, workType, layout }), 0, `${workType}/${layout}`);
  }
  assert.equal(priceFor(tool, {}), 0);
});
