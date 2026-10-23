import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor, basePriceFor, missingRequired } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { ImageAsk, ImageProvider } from "../lib/generation/image-provider.ts";
import { PORTRAIT_FORM_FIELDS, PORTRAIT_PARAMS, type PortraitParamImpact } from "../lib/generation/portrait-params.ts";
import { buildPortraitArtifact } from "../lib/generation/portrait/engine.ts";
import { budgetFor } from "../lib/generation/budget.ts";

/**
 * Graduation portrait parameter contract -- "every param must work". The provider is a stub that records
 * the asks it receives and answers with a tiny valid JPEG; the probe compares what REACHED the model
 * (prompt text, source image bytes, ask count) and the price for value A vs B.
 *
 * Mutation (checked by hand): ignore `gown` in `portraitPrompt` -> "gown -> prompt" turns red; drop
 * `inputImages` from the ask -> "photoAssetId -> input" turns red; fix `variants` at 1 -> count and price red.
 */

const tool = TOOL_BY_ID.portrait;

const BASE: FormValues = { photoAssetId: "0123456789abcdef01234567", gown: "black", background: "studio", sash: "none", variants: 1 };

/** A real (decodable by magic bytes) JPEG header + padding; `decodeDataUrl` only sniffs the bytes. */
function jpegDataUrl(seed: number): string {
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(400, seed)]);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

const photoFor = (assetId: string) => ({ url: jpegDataUrl(assetId.charCodeAt(1)) });

function stubProvider(asks: ImageAsk[]): ImageProvider {
  return {
    id: "gemini",
    minMs: 0,
    hasKey: () => true,
    async fetchImage(ask) {
      asks.push(ask);
      return { ok: true, image: { url: jpegDataUrl(9) } };
    },
  };
}

type Probe = Record<PortraitParamImpact, string>;

async function probe(values: FormValues): Promise<Probe> {
  const v = { ...BASE, ...values };
  const asks: ImageAsk[] = [];
  await buildPortraitArtifact(tool, v, { provider: stubProvider(asks), photo: photoFor(String(v.photoAssetId)) });
  const sorted = [...asks].sort((a, b) => a.prompt.localeCompare(b.prompt));
  return {
    prompt: sorted.map((a) => a.prompt).join("\n--\n"),
    // The DISTINCT source images: a second variant re-sends the same selfie, which is not a different input.
    input: JSON.stringify([...new Set(sorted.map((a) => JSON.stringify(a.inputImages)))]),
    count: String(asks.length),
    price: String(priceFor(tool, v)),
  };
}

test("registry: 5 params, ids unique, form fields mirror the registry", () => {
  assert.equal(PORTRAIT_PARAMS.length, 5);
  assert.equal(new Set(PORTRAIT_FORM_FIELDS).size, PORTRAIT_PARAMS.length);
  assert.deepEqual(PORTRAIT_FORM_FIELDS, ["photoAssetId", "gown", "background", "sash", "variants"]);
});

test("differential probe: every param delivers its declared impacts", async () => {
  const failures: string[] = [];
  for (const p of PORTRAIT_PARAMS) {
    const a = await probe({ [p.id]: p.probeA });
    const b = await probe({ [p.id]: p.probeB });
    for (const impact of p.impacts) if (a[impact] === b[impact]) failures.push(`${p.id} -> ${impact}`);
  }
  assert.deepEqual(failures, [], `decorative params (A and B came out identical):\n  ${failures.join("\n  ")}`);
});

test("no param leaks an UNdeclared impact (a declared list that is too short hides a wiring change)", async () => {
  const undeclared: string[] = [];
  for (const p of PORTRAIT_PARAMS) {
    const a = await probe({ [p.id]: p.probeA });
    const b = await probe({ [p.id]: p.probeB });
    for (const impact of ["prompt", "input", "count", "price"] as PortraitParamImpact[]) {
      if (a[impact] !== b[impact] && !p.impacts.includes(impact)) undeclared.push(`${p.id} -> ${impact}`);
    }
  }
  assert.deepEqual(undeclared, []);
});

test("every impact is declared by at least one param", () => {
  const declared = new Set(PORTRAIT_PARAMS.flatMap((p) => p.impacts));
  for (const impact of ["prompt", "input", "count", "price"] as PortraitParamImpact[]) assert.ok(declared.has(impact), impact);
});

test("price: 2 000 so'm per variant, via basePriceFor/priceFor", () => {
  assert.equal(basePriceFor(tool, { ...BASE, variants: 1 }), 2000);
  assert.equal(basePriceFor(tool, { ...BASE, variants: 2 }), 4000);
  assert.equal(priceFor(tool, { ...BASE, variants: 2 }), 4000);
  // Out-of-range / junk counts normalize like the engine does.
  assert.equal(priceFor(tool, { ...BASE, variants: 7 }), 4000);
  assert.equal(priceFor(tool, { ...BASE, variants: "zzz" }), 2000);
  // The other options never change the price.
  assert.equal(priceFor(tool, { ...BASE, gown: "green", background: "hall", sash: "red" }), 2000);
});

test("budget: a fixed budget covers two edits", () => {
  assert.ok(budgetFor(tool, { ...BASE, variants: 2 }, 600_000) >= 120_000);
});

test("the selfie is required on the server contract", () => {
  assert.deepEqual(missingRequired(tool, { ...BASE, photoAssetId: "" }), ["Surat"]);
  assert.deepEqual(missingRequired(tool, BASE), []);
});
