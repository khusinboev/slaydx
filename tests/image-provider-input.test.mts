import test from "node:test";
import assert from "node:assert/strict";
import { geminiInputParts, requestGeminiImage } from "../lib/generation/image-provider-gemini.ts";

/**
 * Gemini image provider with a SOURCE image (graduation portrait, program-17 item 14).
 * The shape `{ type: "image", data, mime_type }` as an `input` part of the interactions endpoint was
 * verified live on 2026-10-24 (one paid call: the face stayed identical, the gown was added). Here fetch
 * is stubbed: this file locks that the image part is really SENT, before the text, and that a request
 * without input images is byte-identical to the old text-only one.
 */

const PNG_B64 = Buffer.alloc(200, 7).toString("base64");
const OK = {
  steps: [{ type: "message", content: [{ data: Buffer.alloc(300, 1).toString("base64"), mime_type: "image/jpeg" }] }],
};
const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as never;

function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  return fn().finally(() => {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  });
}

test("geminiInputParts: no input images -> the single text part (unchanged request)", () => {
  assert.deepEqual(geminiInputParts({ prompt: "p" }), [{ type: "text", text: "p" }]);
});

test("geminiInputParts: images come first, then the text", () => {
  const parts = geminiInputParts({ prompt: "p", inputImages: [{ mime: "image/jpeg", base64: "AAA" }] });
  assert.deepEqual(parts, [
    { type: "image", data: "AAA", mime_type: "image/jpeg" },
    { type: "text", text: "p" },
  ]);
});

test("requestGeminiImage sends the input image part in the request body", async () => {
  await withKey(async () => {
    let body: { input: unknown } | null = null;
    const saved = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return res(200, OK);
    }) as unknown as typeof fetch;
    try {
      const r = await requestGeminiImage({
        prompt: "edit",
        size: { width: 896, height: 1120 },
        styleId: "photo",
        inputImages: [{ mime: "image/png", base64: PNG_B64 }],
      });
      assert.ok(r.ok);
      assert.deepEqual(body!.input, [
        { type: "image", data: PNG_B64, mime_type: "image/png" },
        { type: "text", text: "edit" },
      ]);
    } finally {
      globalThis.fetch = saved;
    }
  });
});

test("requestGeminiImage without input images still sends text only", async () => {
  await withKey(async () => {
    let body: { input: unknown } | null = null;
    const saved = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return res(200, OK);
    }) as unknown as typeof fetch;
    try {
      await requestGeminiImage({ prompt: "draw", size: { width: 1, height: 1 }, styleId: "photo" });
      assert.deepEqual(body!.input, [{ type: "text", text: "draw" }]);
    } finally {
      globalThis.fetch = saved;
    }
  });
});
