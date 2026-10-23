import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PortraitComposer } from "../../components/forms/PortraitComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import { PORTRAIT_PARAMS } from "../../lib/generation/portrait-params.ts";
import { PORTRAIT_GOWNS, PORTRAIT_SASHES } from "../../lib/generation/portrait/registry.ts";

/**
 * «Bitiruvchi portreti» formasi (program-17 item 14).
 *
 * Qulflanadi: QAMROV (har `PORTRAIT_PARAMS.id` — aynan bitta `data-field`); surat MAJBURIY (suratsiz
 * so'rov ketmaydi); suratni yuklash oqimi (kesish oynasi → `/api/uploads/photo`, ASL nusxa YUBORILMAYDI,
 * kvadrat shakl); variantlar narxni 2 000 → 4 000 qiladi, qolgan variantlar narxni o'zgartirmaydi; submit
 * tanasi; surat qoralamaga YOZILMAYDI (server uni tayyor bo'lgach o'chiradi); `ToolWorkspace` dispatch.
 *
 * Mutatsiya (qo'lda): `keepOriginal={false}` olib tashlansa — «asl nusxa yuborilmaydi» testi qizaradi;
 * submitdagi `photoAssetId` tekshiruvi olib tashlansa — «suratsiz so'rov ketmaydi» qizaradi.
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const tool = TOOL_BY_ID.portrait;
const PHOTO_ID = "0123456789abcdef01234567";

type Call = { url: string; method: string; body?: unknown };
function stubApi() {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (url === "/api/forms/portrait/draft" && method === "GET") return json(200, { draft: null });
    if (url === "/api/forms/portrait/draft") return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/uploads/photo" && method === "POST") return json(200, { assetId: PHOTO_ID, mime: "image/jpeg", size: 100, shape: "square" });
    if (url === `/api/uploads/photo/${PHOTO_ID}`) return new Response("img", { status: 200 });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "77777777-7777-4777-8777-777777777777", price: 2000 });
    if (url === "/api/users/me") return json(200, { ok: true });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
}

/** jsdom has no canvas / image decoding: the minimum the crop dialog needs. */
function stubCanvas() {
  const g = globalThis as unknown as Record<string, unknown>;
  class FakeImage {
    naturalWidth = 800;
    naturalHeight = 1000;
    width = 800;
    height = 1000;
    crossOrigin = "";
    onload: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  g.Image = FakeImage;
  const proto = (document.createElement("canvas").constructor as unknown as { prototype: Record<string, unknown> }).prototype;
  proto.getContext = () => ({ clearRect() {}, drawImage() {}, save() {}, restore() {}, beginPath() {}, arc() {}, closePath() {}, clip() {} });
  proto.toBlob = (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array(500)], { type: "image/jpeg" }));
  (URL as unknown as Record<string, unknown>).createObjectURL = () => "blob:stub";
  (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
}

function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(PortraitComposer, { tool })));
}

const field = (id: string) => document.querySelector(`[data-field="${id}"]`);
const chips = (id: string) => [...document.querySelectorAll(`[data-field="${id}"] button`)] as HTMLButtonElement[];
const checkedText = (id: string) => chips(id).find((b) => b.getAttribute("aria-checked") === "true")?.textContent?.trim() ?? "";
const price = () => document.querySelector("[data-price-total]")?.textContent ?? "";

async function uploadSelfie() {
  stubCanvas();
  const input = document.querySelector('[data-field="photoAssetId"] input[type="file"]') as HTMLInputElement;
  assert.ok(input, "fayl tanlash maydoni");
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(500)], "me.jpg", { type: "image/jpeg" })] } });
  });
  const done = await screen.findByText("Tayyor");
  await waitFor(() => assert.ok(!(done as HTMLButtonElement).closest("button")!.disabled));
  await act(async () => {
    fireEvent.click(done);
  });
  await waitFor(() => assert.ok(document.querySelector('[data-field="photoAssetId"] img')));
}

test("QAMROV: har `PORTRAIT_PARAMS.id` formada aynan bitta `data-field`, reyestrsiz maydon yo'q", async () => {
  stubApi();
  await login();
  mount();
  const seen = [...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")!);
  assert.deepEqual([...seen].sort(), PORTRAIT_PARAMS.map((p) => p.id).sort());
});

test("standartlar: qora xalat, studiya, stolasiz, 1 variant, narx 2 000", async () => {
  stubApi();
  await login();
  mount();
  assert.equal(screen.getByLabelText(PORTRAIT_GOWNS[0]!.label).getAttribute("aria-checked"), "true");
  assert.equal(checkedText("background"), "Studiya");
  assert.equal(checkedText("sash"), "Yo‘q");
  assert.equal(checkedText("variants"), "1 ta");
  assert.match(price(), /2\s?000/);
});

test("narx: 2 variant = 4 000; xalat/fon/stola narxni o'zgartirmaydi", async () => {
  stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByLabelText(PORTRAIT_GOWNS[2]!.label));
    fireEvent.click(chips("background").find((b) => b.textContent === "Kutubxona")!);
    fireEvent.click(screen.getByLabelText(PORTRAIT_SASHES[1]!.label));
  });
  assert.match(price(), /2\s?000/, "xalat/fon/stola narxni o'zgartirmadi");
  await act(async () => {
    fireEvent.click(chips("variants").find((b) => b.textContent === "2 ta")!);
  });
  assert.match(price(), /4\s?000/);
  await act(async () => {
    fireEvent.click(chips("variants").find((b) => b.textContent === "1 ta")!);
  });
  assert.match(price(), /2\s?000/);
});

test("stola: «Yo'q» va rang nuqtalari bir-birini almashtiradi", async () => {
  stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByLabelText(PORTRAIT_SASHES[1]!.label));
  });
  assert.equal(screen.getByLabelText(PORTRAIT_SASHES[1]!.label).getAttribute("aria-checked"), "true");
  assert.equal(checkedText("sash").includes("Yo‘q"), false);
  await act(async () => {
    fireEvent.click(chips("sash").find((b) => b.textContent === "Yo‘q")!);
  });
  assert.equal(screen.getByLabelText(PORTRAIT_SASHES[1]!.label).getAttribute("aria-checked"), "false");
});

test("suratsiz so'rov ketmaydi: xabar chiqadi, POST /api/generations yo'q", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.ok(screen.getByText("Avval suratingizni yuklang")));
  assert.ok(!calls.some((c) => c.url === "/api/generations"));
});

test("surat yuklash: kvadrat kesish, ASL nusxa yuborilmaydi; keyin submit tanasi to'liq", async () => {
  const calls = stubApi();
  await login();
  mount();
  await uploadSelfie();
  const up = calls.find((c) => c.url === "/api/uploads/photo" && c.method === "POST")!;
  const form = up.body as FormData;
  assert.equal(form.get("shape"), "square", "yuz portreti kvadrat kesiladi");
  assert.ok(form.has("file"));
  assert.ok(!form.has("original"), "asl surat serverga yuborilmaydi (maxfiylik)");

  await act(async () => {
    fireEvent.click(screen.getByLabelText(PORTRAIT_GOWNS[1]!.label));
    fireEvent.click(chips("variants").find((b) => b.textContent === "2 ta")!);
  });
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const post = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!;
  const body = post.body as { slug: string; values: Record<string, unknown> };
  assert.equal(body.slug, "portrait");
  assert.deepEqual(body.values, { photoAssetId: PHOTO_ID, gown: "navy", background: "studio", sash: "none", variants: 2 });
  await waitFor(() => assert.ok(pushes.some((u) => u.includes("/uz/files/"))));
});

test("surat qoralamaga YOZILMAYDI (server uni tayyor bo'lgach o'chiradi)", async () => {
  const calls = stubApi();
  await login();
  mount();
  await uploadSelfie();
  await act(async () => {
    fireEvent.click(chips("variants").find((b) => b.textContent === "2 ta")!);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1200));
  });
  const drafts = calls.filter((c) => c.url === "/api/forms/portrait/draft" && c.method !== "GET");
  assert.ok(drafts.length > 0, "qoralama saqlanishi kerak");
  for (const d of drafts) {
    assert.ok(!JSON.stringify(d.body).includes(PHOTO_ID), "qoralamada surat id si yo'q");
  }
});

test("maxfiylik va surat bo'yicha ko'rsatma matnlari formada turadi", async () => {
  stubApi();
  await login();
  mount();
  const text = document.body.textContent ?? "";
  assert.ok(text.includes("serverdan o‘chiriladi"), "maxfiylik izohi");
  assert.ok(text.includes("yolg‘iz o‘zingiz tushgan"), "yuz surati ko'rsatmasi");
  assert.ok(field("photoAssetId"));
});

test("ToolWorkspace: `custom: portrait` PortraitComposer ga yo'naltiradi", async () => {
  stubApi();
  await login();
  render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool })));
  await screen.findByText("Sizning suratingiz");
  assert.ok(field("gown"));
});
