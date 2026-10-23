import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { portraitPrompt, PORTRAIT_PRESERVE, PORTRAIT_ONLY_CHANGE, PORTRAIT_NO_TEXT, PORTRAIT_REFUSAL, PORTRAIT_MODEST } from "../lib/generation/portrait/prompt.ts";
import { PORTRAIT_BACKGROUNDS, PORTRAIT_GOWNS, PORTRAIT_SASHES, portraitInputFromValues } from "../lib/generation/portrait/registry.ts";
import { buildPortraitArtifact } from "../lib/generation/portrait/engine.ts";
import { geminiProvider } from "../lib/generation/image-provider-gemini.ts";
import { isUserSafeText } from "../lib/server/user-error.ts";

/**
 * Graduation portrait: prompt contract + engine paths (stubbed fetch; the live shape was verified once on
 * 2026-10-24). The provider here is the REAL Gemini provider, so "the selfie is sent" is asserted on the
 * HTTP body that would leave the process.
 */

const tool = TOOL_BY_ID.portrait;
const VALUES = { photoAssetId: "0123456789abcdef01234567", gown: "black", background: "studio", sash: "none", variants: 1 };
const SELFIE_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(400, 5)]).toString("base64");
const photo = { url: `data:image/jpeg;base64,${SELFIE_B64}` };
const OUT_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(2000, 8)]).toString("base64");

const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as never;
const imageBody = () => ({ steps: [{ type: "message", content: [{ data: OUT_B64, mime_type: "image/jpeg" }] }] });

async function withGemini<T>(fetchImpl: (body: { input: Array<Record<string, unknown>> }) => unknown, fn: () => Promise<T>): Promise<T> {
  const savedKey = process.env.GEMINI_API_KEY;
  const savedFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = (async (_u: string, init: RequestInit) => fetchImpl(JSON.parse(String(init.body)))) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  }
}

test("prompt: identity-preservation, only-clothing-and-background, no-text, modesty and refusal sentences are present", () => {
  const p = portraitPrompt({ gown: "black", background: "studio", sash: "none" });
  for (const s of [PORTRAIT_PRESERVE, PORTRAIT_ONLY_CHANGE, PORTRAIT_NO_TEXT, PORTRAIT_REFUSAL, PORTRAIT_MODEST]) assert.ok(p.includes(s), s.slice(0, 40));
  assert.match(p, /skin tone/);
  assert.match(p, /hairstyle/);
  assert.match(p, /glasses/);
  assert.match(p, /DSLR/);
  assert.match(p, /mortarboard/);
  assert.match(p, /do NOT generate any image/);
});

test("prompt: every gown / background / sash option reaches the prompt, and each is distinct", () => {
  const gowns = PORTRAIT_GOWNS.map((g) => portraitPrompt({ gown: g.id, background: "studio", sash: "none" }));
  assert.equal(new Set(gowns).size, PORTRAIT_GOWNS.length);
  PORTRAIT_GOWNS.forEach((g, i) => assert.ok(gowns[i].includes(g.prompt), g.id));
  const bgs = PORTRAIT_BACKGROUNDS.map((b) => portraitPrompt({ gown: "black", background: b.id, sash: "none" }));
  assert.equal(new Set(bgs).size, PORTRAIT_BACKGROUNDS.length);
  PORTRAIT_BACKGROUNDS.forEach((b, i) => assert.ok(bgs[i].includes(b.prompt), b.id));
  const sashes = PORTRAIT_SASHES.map((s) => portraitPrompt({ gown: "black", background: "studio", sash: s.id }));
  assert.equal(new Set(sashes).size, PORTRAIT_SASHES.length);
  assert.match(sashes[0], /No stola or sash/);
  assert.match(sashes[1], /gold graduation stola/);
});

test("prompt: variant B differs in framing, never in identity", () => {
  const a = portraitPrompt({ gown: "navy", background: "hall", sash: "red" }, 0);
  const b = portraitPrompt({ gown: "navy", background: "hall", sash: "red" }, 1);
  assert.notEqual(a, b);
  assert.ok(b.includes(PORTRAIT_PRESERVE));
});

test("input normalizer: junk falls back to defaults, ids are validated", () => {
  const i = portraitInputFromValues({ gown: "pink", background: "x", sash: "x", variants: "9", photoAssetId: "NOT-HEX" });
  assert.deepEqual(i, { gown: "black", background: "studio", sash: "none", variants: 2, photoAssetId: "" });
});

test("engine: the selfie bytes + prompt reach Gemini; result is the picture (1 variant, no delivered gap)", async () => {
  let body: { input: Array<Record<string, unknown>> } | null = null;
  const built = await withGemini(
    (b) => {
      body = b;
      return res(200, imageBody());
    },
    () => buildPortraitArtifact(tool, VALUES, { photo, provider: geminiProvider }),
  );
  assert.equal(body!.input.length, 2);
  assert.deepEqual(body!.input[0], { type: "image", data: SELFIE_B64, mime_type: "image/jpeg" });
  assert.equal(body!.input[1].type, "text");
  assert.match(String(body!.input[1].text), /graduation portrait of the SAME person/);
  assert.equal(built.mime, "image/jpeg");
  assert.match(built.fileName, /^bitiruvchi-portreti\.jpg$/);
  assert.equal(built.delivered, undefined);
  assert.equal(built.doc.images?.length, 1);
  assert.deepEqual(built.doc.portrait, { gown: "black", background: "studio", sash: "none", variants: 1 });
  // The selfie is not stored in the document.
  assert.ok(!JSON.stringify(built.doc).includes(SELFIE_B64));
});

test("engine: the model answers with text only (no clear face) -> user-facing refund message, nothing delivered", async () => {
  await withGemini(
    () => res(200, { status: "completed", steps: [{ type: "message", content: [{ type: "text", text: "I cannot see a clear face." }] }] }),
    async () => {
      await assert.rejects(
        buildPortraitArtifact(tool, VALUES, { photo, provider: geminiProvider }),
        (e: Error) => {
          assert.equal(e.name, "UserFacingError");
          assert.match(e.message, /aniq yuz/);
          assert.match(e.message, /Pul qaytariladi/);
          assert.ok(isUserSafeText(e.message));
          return true;
        },
      );
    },
  );
});

test("engine: provider blocked (billing) -> service message, no stack of provider text", async () => {
  await withGemini(
    () => res(403, { error: { message: "Consumer 'api_key:AIzaXXXX' has been suspended" } }),
    async () => {
      await assert.rejects(buildPortraitArtifact(tool, VALUES, { photo, provider: geminiProvider }), (e: Error) => {
        assert.match(e.message, /vaqtincha/);
        assert.ok(!e.message.includes("AIza"));
        return true;
      });
    },
  );
});

test("engine: 2 variants, one fails -> 1 picture + delivered {got:1, want:2}; both fail -> throws", async () => {
  let n = 0;
  const built = await withGemini(
    () => (++n === 1 ? res(200, imageBody()) : res(500, { error: "boom" })),
    () => buildPortraitArtifact(tool, { ...VALUES, variants: 2 }, { photo, provider: geminiProvider }),
  );
  assert.deepEqual(built.delivered, { got: 1, want: 2 });
  assert.equal(built.doc.images?.length, 1);

  await withGemini(
    () => res(500, { error: "boom" }),
    async () => {
      await assert.rejects(buildPortraitArtifact(tool, { ...VALUES, variants: 2 }, { photo, provider: geminiProvider }), /Pul qaytariladi/);
    },
  );
});

test("engine: 2 variants -> a ZIP of 2 pictures, each request carries the selfie and its own framing", async () => {
  const bodies: Array<{ input: Array<Record<string, unknown>> }> = [];
  const built = await withGemini(
    (b) => {
      bodies.push(b);
      return res(200, imageBody());
    },
    () => buildPortraitArtifact(tool, { ...VALUES, variants: 2 }, { photo, provider: geminiProvider }),
  );
  assert.equal(bodies.length, 2);
  for (const b of bodies) assert.equal(b.input[0].data, SELFIE_B64);
  assert.notEqual(bodies[0].input[1].text, bodies[1].input[1].text);
  assert.equal(built.mime, "application/zip");
  assert.equal(built.delivered, undefined);
  assert.equal(built.doc.images?.length, 2);
});

test("engine: no selfie / undecodable selfie -> throws before any request is made", async () => {
  let calls = 0;
  await withGemini(
    () => {
      calls++;
      return res(200, imageBody());
    },
    async () => {
      await assert.rejects(buildPortraitArtifact(tool, VALUES, { provider: geminiProvider }), /Surat topilmadi/);
      await assert.rejects(buildPortraitArtifact(tool, VALUES, { photo: { url: "data:text/plain;base64,AAAA" }, provider: geminiProvider }), /Surat topilmadi/);
    },
  );
  assert.equal(calls, 0);
});
