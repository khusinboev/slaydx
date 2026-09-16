import test from "node:test";
import assert from "node:assert/strict";
import { INFOGRAPHIC_FORM_FIELDS, INFOGRAPHIC_PARAMS, type InfographicParamImpact } from "../lib/generation/infographic-params.ts";
import type { FormValues } from "../lib/types.ts";
import type { DocMeta } from "../lib/generation/types.ts";

/**
 * «BEZAK MAYDON YO'Q» reyestri — infografika (AUDIT-21 R0).
 *
 * `tests/game-params.test.mts` naqshi. Infografikaning kirish ko'prigi
 * (`infographic/input.ts infographicInputFromValues`) WP-C da yoziladi —
 * hozircha yo'q, shuning uchun DIFFERENSIAL zond hali dinamik import
 * bilan sinab ko'riladi va topilmasa HAMMA parametr o'tkazib yuboriladi
 * (`ENGINE_NOT_WIRED`). Reyestrning O'ZI (id, impacts, probe juftligi)
 * baribir TO'LIQ sinaladi — bu WP-C dan mustaqil.
 */

test("har parametr unikal id ga ega va shakli to'g'ri", () => {
  const ids = INFOGRAPHIC_PARAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `takroriy id: ${ids.filter((v, i) => ids.indexOf(v) !== i).join(", ")}`);
  assert.deepEqual(INFOGRAPHIC_FORM_FIELDS, ids);
  for (const p of INFOGRAPHIC_PARAMS) {
    assert.ok(/^[a-zA-Z][a-zA-Z0-9]*$/.test(p.id), `${p.id}: forma maydon nomi shakli`);
    assert.notEqual(p.probeA, p.probeB, `${p.id}: zond juftligi bir xil — farqni o'lchab bo'lmaydi`);
  }
  // Forma reyestrdagi HAMMA maydonni chizadi: mavzu, tur, blok soni, palitra, o'lcham, til, qo'shimcha.
  assert.ok(ids.length >= 6, `${ids.length} parametr — juda kam`);
  for (const id of ["topic", "infographicType", "blockCount", "palette", "size", "language"]) assert.ok(ids.includes(id), `«${id}» reyestrda yo'q`);
});

test("har parametrning TA'SIRI bor; narx HECH BIR parametrga bog'liq emas", () => {
  for (const p of INFOGRAPHIC_PARAMS) {
    assert.ok(p.impacts.length > 0, `${p.id}: «bezak maydon» — impacts bo'sh`);
    assert.equal(new Set(p.impacts).size, p.impacts.length, `${p.id}: takroriy impact`);
  }
  const impacts = new Set<string>(INFOGRAPHIC_PARAMS.flatMap((p) => p.impacts as readonly string[]));
  assert.ok(!impacts.has("price"), "MUTATSIYA: biror parametr narxga ta'sir qilsa, tekis 2 000 va'dasi buziladi");
  const KNOWN: readonly InfographicParamImpact[] = ["prompt", "structure", "layout", "palette", "review", "language", "budget"];
  for (const p of INFOGRAPHIC_PARAMS) for (const im of p.impacts) assert.ok((KNOWN as readonly string[]).includes(im), `${p.id}: noma'lum impact ${im}`);
});

test("`extra` — MA'LUMOT kanali (halollik qoidasi), shunchaki uslub emas", () => {
  const extra = INFOGRAPHIC_PARAMS.find((p) => p.id === "extra");
  assert.ok(extra, "«extra» reyestrda yo'q");
  assert.ok(extra!.impacts.includes("review"), "MUTATSIYA: `review` ta'siri olib tashlansa, foydalanuvchi raqami halollik qoidasiga bog'lanmay qolardi");
});

test("`blockCount` probeA/probeB IKKALA turda ham ruxsat etilgan (tur chegarasidan qat'i nazar farq o'lchanadi)", () => {
  const bc = INFOGRAPHIC_PARAMS.find((p) => p.id === "blockCount")!;
  // 3 va 6 — barcha 7 turning [min,max] oralig'iga tushadi (registry.ts).
  assert.equal(bc.probeA, 3);
  assert.equal(bc.probeB, 6);
});

/*
 * `infographicInputFromValues` hali WP-C da yoziladi — yo'l O'ZGARUVCHIDA
 * (`games/engine.ts`/`game-params.test.mts` naqshi), STATIK `import()`
 * emas: aks holda `tsc` fayl yo'qligida butun to'plamni yiqitardi.
 */
async function infographicInputFromValues(): Promise<((meta: DocMeta, values: FormValues) => unknown) | null> {
  try {
    const path = "../lib/generation/infographic/input.ts";
    const mod = (await import(path)) as { infographicInputFromValues?: (meta: DocMeta, values: FormValues) => unknown };
    return mod.infographicInputFromValues ?? null;
  } catch {
    return null;
  }
}

const FAKE_META = {} as unknown as DocMeta;
const ENGINE_NOT_WIRED: string[] = [];

test("differensial zond: probeA/probeB natijasi FARQ qiladi — WP-C ulangan bo'lsa sinaladi, bo'lmasa ANIQ o'tkazib yuboriladi", async () => {
  const input = await infographicInputFromValues();
  for (const p of INFOGRAPHIC_PARAMS) {
    if (!input) {
      ENGINE_NOT_WIRED.push(p.id);
      continue;
    }
    const base: FormValues = { ...(p.probeWith as FormValues | undefined) };
    const valuesA: FormValues = { ...base, [p.id]: p.probeA };
    const valuesB: FormValues = { ...base, [p.id]: p.probeB };
    assert.notDeepEqual(input(FAKE_META, valuesA), input(FAKE_META, valuesB), `${p.id}: probeA/probeB bir xil kiritma berdi`);
  }
  if (!input) {
    // WP-C hali yo'q — HAMMA parametr o'tkazib yuborilgan bo'lishi kerak (yashirin muvaffaqiyat emas).
    assert.equal(ENGINE_NOT_WIRED.length, INFOGRAPHIC_PARAMS.length, "o'tkazib yuborilganlar soni reyestr soniga teng bo'lishi kerak");
    console.log(`   [infographic-params] WP-C hali ulanmagan — o'tkazib yuborildi: ${ENGINE_NOT_WIRED.join(", ")}`);
  } else {
    assert.equal(ENGINE_NOT_WIRED.length, 0, "WP-C ulangan — hech narsa o'tkazib yuborilmasligi kerak");
  }
});
