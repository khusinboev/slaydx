import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { VideoComposer } from "../../components/forms/VideoComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import { VIDEO_PARAMS } from "../../lib/generation/video-params.ts";

/**
 * «Video yaratish» formasi (program-17 item 5).
 *
 * Locked: COVERAGE (every `VIDEO_PARAMS.id` drawn exactly once -- the provider selector only when two providers are
 * offered); the provider list is the SERVER's (`features.videoProviders`); the price follows provider x length
 * (Veo 3 000 / Kling 2 000 so'm per second); the submit body; the PAID-balance hint (bonus so'm does not count);
 * Kling + a start picture disables the aspect row (its endpoint takes the picture's proportions); the picture id is
 * kept out of the draft; `ToolWorkspace` dispatch.
 *
 * Mutation (by hand): drop `paidOnly` from `ToolChrome` -> «paid balance» goes red; draw `provider` unconditionally ->
 * «single provider» goes red; send `seconds` as the Veo default after a Kling switch -> «lengths follow the provider» red.
 *
 * Space key (prompt kept as typed, normalized only on the way out) -- mutations, each turned the named tests red, then restored:
 *   per-keystroke `videoInputFromValues({ prompt })` in the change handler -> «the space key works», «whitespace is normalized only on the way out», «a restored draft»;
 *   submit sends `encodeVideoValues(input)` (raw)                          -> «whitespace is normalized only on the way out»;
 *   validation on `input.prompt` (raw length)                              -> «validity is judged on the normalized prompt»;
 *   draft saves the raw prompt                                             -> «whitespace is normalized only on the way out»;
 *   `set()` / `setProvider()` drop the raw prompt                          -> «changing another setting mid-sentence».
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const tool = TOOL_BY_ID.video;
const IMG = "0123456789abcdef01234567";

type Call = { url: string; method: string; body?: unknown };
function stubApi(stored?: Record<string, unknown>) {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (url === "/api/forms/video/draft" && method === "GET") return json(200, { draft: stored ? { data: stored, updatedAt: "now" } : null });
    if (url === "/api/forms/video/draft") return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/uploads/photo" && method === "POST") return json(200, { assetId: IMG, mime: "image/jpeg", size: 100, shape: "square" });
    if (url === `/api/uploads/photo/${IMG}`) return new Response("img", { status: 200 });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "88888888-8888-4888-8888-888888888888", price: 15000 });
    if (url === "/api/users/me") return json(200, { ok: true });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

async function setup(providers: string[] | undefined, user?: Record<string, unknown>) {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    ...(user ? { user: user as never } : {}),
    features: { llm: true, images: true, ...(providers ? { videoProviders: providers } : {}), telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
}
function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(VideoComposer, { tool })));
}
const field = (id: string) => document.querySelector(`[data-field="${id}"]`);
const chips = (id: string) => [...document.querySelectorAll(`[data-field="${id}"] button`)] as HTMLButtonElement[];
const chipText = (id: string) => chips(id).map((b) => b.textContent?.trim() ?? "");
const checked = (id: string) => chips(id).find((b) => b.getAttribute("aria-checked") === "true")?.textContent?.trim() ?? "";
const price = () => document.querySelector("[data-price-total]")?.textContent ?? "";
const pick = async (id: string, re: RegExp) => {
  const b = chips(id).find((x) => re.test(x.textContent ?? ""));
  assert.ok(b, `«${re}» not found in ${id}: ${chipText(id).join(" | ")}`);
  await act(async () => {
    fireEvent.click(b!);
  });
};
const typePrompt = async (text: string) => {
  const ta = document.querySelector('[data-field="prompt"] textarea') as HTMLTextAreaElement;
  assert.ok(ta, "prompt textarea");
  await act(async () => {
    fireEvent.change(ta, { target: { value: text } });
  });
};

const promptBox = () => document.querySelector('[data-field="prompt"] textarea') as HTMLTextAreaElement;
/** Types like a browser: ONE change event per character, each appended to what the textarea shows RIGHT NOW. */
const typeKeys = async (text: string) => {
  const ta = promptBox();
  assert.ok(ta, "prompt textarea");
  const shown: string[] = [];
  for (const ch of text) {
    await act(async () => {
      fireEvent.change(ta, { target: { value: ta.value + ch } });
    });
    shown.push(ta.value);
  }
  return shown;
};
const submitBody = (calls: Call[]) => calls.find((c) => c.url === "/api/generations" && c.method === "POST")?.body as { values: Record<string, unknown> } | undefined;

test("COVERAGE: with two providers offered every VIDEO_PARAMS.id is drawn exactly once", async () => {
  stubApi();
  await setup(["veo", "kling"]);
  mount();
  const seen = [...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")!);
  assert.deepEqual([...seen].sort(), VIDEO_PARAMS.map((p) => p.id).sort());
});

test("single provider: the selector is not drawn (the form works as if there was no choice)", async () => {
  stubApi();
  await setup(["kling"]);
  mount();
  assert.ok(!field("provider"), "MUTATSIYA: provider doim chizilsa qizaradi");
  assert.deepEqual(chipText("seconds"), ["5 soniya", "10 soniya"], "Kling's lengths");
  assert.match(price(), /10\s?000/, "5 s x 2 000");
});

test("the provider list is the server's: veo+kling shows both with their so'm/s, only the keyed one otherwise", async () => {
  stubApi();
  await setup(["veo", "kling"]);
  mount();
  assert.equal(chipText("provider").length, 2);
  assert.match(chipText("provider")[0]!, /Veo.*3\s?000/);
  assert.match(chipText("provider")[1]!, /Kling.*2\s?000/);
});

test("price follows provider x length; lengths follow the provider", async () => {
  stubApi();
  await setup(["veo", "kling"]);
  mount();
  assert.equal(checked("provider").startsWith("Veo"), true);
  assert.deepEqual(chipText("seconds"), ["5 soniya", "8 soniya"]);
  assert.match(price(), /15\s?000/);
  await pick("seconds", /8 soniya/);
  assert.match(price(), /24\s?000/);
  await pick("provider", /Kling/);
  assert.deepEqual(chipText("seconds"), ["5 soniya", "10 soniya"], "8 s does not exist for Kling");
  assert.equal(checked("seconds"), "5 soniya", "an unavailable length falls back to the provider's first");
  assert.match(price(), /10\s?000/);
  await pick("seconds", /10 soniya/);
  assert.match(price(), /20\s?000/);
  // Aspect does not move the price.
  await pick("aspect", /9:16/);
  assert.match(price(), /20\s?000/);
});

test("a short prompt does not go out; the message is shown and POST /api/generations is not called", async () => {
  const calls = stubApi();
  await setup(["veo"]);
  mount();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tool.submitLabel }));
  });
  await waitFor(() => assert.ok(screen.getByText("Videoda nima bo‘lishini yozing")));
  assert.ok(!calls.some((c) => c.url === "/api/generations"));
});

test("submit body: provider, prompt, seconds, aspect, imageAssetId -- and the picture is NOT written to the draft", async () => {
  const calls = stubApi();
  await setup(["veo", "kling"]);
  mount();
  await typePrompt("Tong chog‘ida Registon maydoni");
  await pick("provider", /Kling/);
  await pick("seconds", /10 soniya/);
  await pick("aspect", /9:16/);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tool.submitLabel }));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const body = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { slug: string; values: Record<string, unknown> };
  assert.equal(body.slug, "video");
  assert.deepEqual(body.values, { provider: "kling", prompt: "Tong chog‘ida Registon maydoni", seconds: 10, aspect: "9:16", imageAssetId: "" });
  await waitFor(() => assert.ok(pushes.some((u) => u.includes("/uz/files/"))));
  const drafts = calls.filter((c) => c.method === "PUT" && c.url === "/api/forms/video/draft");
  for (const d of drafts) assert.equal((d.body as { data?: { imageAssetId?: string } }).data?.imageAssetId ?? "", "", "the picture id never reaches the draft");
});

test("the space key works: typing «salom dunyo» char by char keeps every space, and the payload carries the text", async () => {
  const calls = stubApi();
  await setup(["veo"]);
  mount();
  const shown = await typeKeys("salom dunyo");
  const typed = [..."salom dunyo"].map((_, i) => "salom dunyo".slice(0, i + 1));
  assert.deepEqual(shown, typed, "MUTATSIYA: prompt har tugmada normallashtirilsa («salom » -> «salom») qizaradi");
  assert.equal(promptBox().value, "salom dunyo");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tool.submitLabel }));
  });
  await waitFor(() => assert.ok(submitBody(calls)));
  assert.equal(submitBody(calls)!.values.prompt, "salom dunyo");
});

test("changing another setting mid-sentence does not eat the typed space (length, aspect, provider)", async () => {
  stubApi();
  await setup(["veo", "kling"]);
  mount();
  await typeKeys("salom ");
  await pick("seconds", /8 soniya/);
  assert.equal(promptBox().value, "salom ", "MUTATSIYA: set() xom promptni tashlab ketsa qizaradi");
  await pick("aspect", /9:16/);
  assert.equal(promptBox().value, "salom ");
  await pick("provider", /Kling/);
  assert.equal(promptBox().value, "salom ");
  await typeKeys("dunyo");
  assert.equal(promptBox().value, "salom dunyo");
});

test("whitespace is normalized only on the way out: the box shows what was typed, the payload and the draft are collapsed and trimmed", async () => {
  const calls = stubApi();
  await setup(["veo"]);
  mount();
  const raw = "  salom   dunyo \n";
  const shown = await typeKeys(raw);
  assert.deepEqual(shown, [...raw].map((_, i) => raw.slice(0, i + 1)), "every keystroke is shown exactly as typed");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tool.submitLabel }));
  });
  await waitFor(() => assert.ok(submitBody(calls)));
  assert.equal(submitBody(calls)!.values.prompt, "salom dunyo", "MUTATSIYA: xom matn yuborilsa qizaradi");
  const drafts = calls.filter((c) => c.method === "PUT" && c.url === "/api/forms/video/draft");
  assert.ok(drafts.length > 0, "the draft was flushed on submit");
  assert.equal((drafts[drafts.length - 1]!.body as { data: { prompt: string } }).data.prompt, "salom dunyo", "the draft keeps the normalized prompt");
});

test("validity is judged on the normalized prompt: spaces alone do not make a prompt", async () => {
  const calls = stubApi();
  await setup(["veo"]);
  mount();
  await typeKeys("a  b      ");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tool.submitLabel }));
  });
  await waitFor(() => assert.ok(screen.getByText("Videoda nima bo‘lishini yozing")));
  assert.ok(!submitBody(calls), "MUTATSIYA: uzunlik xom matndan olinsa (9 belgi) qizaradi");
});

test("a restored draft shows its prompt and typing continues after it (space included)", async () => {
  const calls = stubApi({ provider: "veo", prompt: "salom dunyo", seconds: 8, aspect: "9:16", imageAssetId: "" });
  await setup(["veo"]);
  mount();
  await waitFor(() => assert.equal(promptBox().value, "salom dunyo"));
  assert.equal(checked("seconds"), "8 soniya");
  const shown = await typeKeys(" yana");
  assert.equal(shown[0], "salom dunyo ", "the space right after the restored text stays");
  assert.equal(promptBox().value, "salom dunyo yana");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tool.submitLabel }));
  });
  await waitFor(() => assert.ok(submitBody(calls)));
  assert.deepEqual(submitBody(calls)!.values, { provider: "veo", prompt: "salom dunyo yana", seconds: 8, aspect: "9:16", imageAssetId: "" });
});

test("paid balance: bonus so'm does not count -- the short-balance hint names the PAID balance and the bonus", async () => {
  stubApi();
  await setup(["veo"], { id: "1", points: 500_000, quota: 0, balance: 4_000, name: "T" });
  mount();
  const hint = await waitFor(() => {
    const el = document.querySelector("[data-balance-short]");
    assert.ok(el, "short-balance hint");
    return el!;
  });
  const text = hint.textContent ?? "";
  assert.match(text, /To‘langan balansingiz/);
  assert.match(text, /4\s?000/);
  assert.match(text, /15\s?000/);
  assert.match(text, /Bonus so‘m video uchun ishlamaydi/);
  assert.ok(document.querySelector("[data-topup]"), "a top-up link is offered");
});

test("paid balance enough: no hint, even with no bonus", async () => {
  stubApi();
  await setup(["veo"], { id: "1", points: 0, quota: 0, balance: 50_000, name: "T" });
  mount();
  assert.ok(!document.querySelector("[data-balance-short]"));
});

test("a server 402 for a bonus-only wallet shows a top-up link", async () => {
  const calls = stubApi();
  await setup(["veo"], { id: "1", points: 0, quota: 0, balance: 50_000, name: "T" });
  const real = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    if (String(input) === "/api/generations" && opts?.method === "POST") {
      return new Response(JSON.stringify({ error: "Video faqat to'langan balans bilan yaratiladi. Kerak: 15 000 so'm. Balansni to'ldiring: /uz/wallet", code: "paid_balance_required" }), { status: 402, headers: { "content-type": "application/json" } });
    }
    return real(input as never, opts);
  };
  mount();
  await typePrompt("Tong chog‘ida Registon maydoni");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tool.submitLabel }));
  });
  await waitFor(() => assert.ok(document.querySelector('[role="alert"] [data-topup]'), "top-up link under the error"));
  void calls;
});

/** jsdom has no canvas / image decoding: the minimum the crop dialog needs (portrait-composer.test.mts). */
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
async function uploadPicture() {
  stubCanvas();
  const input = document.querySelector('[data-field="imageAssetId"] input[type="file"]') as HTMLInputElement;
  assert.ok(input, "file input");
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(500)], "start.jpg", { type: "image/jpeg" })] } });
  });
  const done = await screen.findByText("Tayyor");
  await waitFor(() => assert.ok(!(done as HTMLButtonElement).closest("button")!.disabled));
  await act(async () => {
    fireEvent.click(done);
  });
  await waitFor(() => assert.ok(document.querySelector('[data-field="imageAssetId"] img')));
}

test("a start picture: sent as imageAssetId; with Kling the aspect row is disabled (its endpoint takes the picture's proportions), with Veo it stays", async () => {
  const calls = stubApi();
  await setup(["veo", "kling"]);
  mount();
  await typePrompt("Rasmni jonlantiring, kamera aylanadi");
  await uploadPicture();
  assert.ok(chips("aspect").every((b) => !b.disabled), "Veo: aspect applies to image-to-video");
  await pick("provider", /Kling/);
  assert.ok(chips("aspect").every((b) => b.disabled), "Kling + picture: aspect row disabled");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: tool.submitLabel }));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const body = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, unknown> };
  assert.equal(body.values.imageAssetId, IMG);
  assert.equal(body.values.provider, "kling");
});

test("ToolWorkspace draws the VideoComposer for the video tool", async () => {
  stubApi();
  await setup(["veo"]);
  render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool })));
  await waitFor(() => assert.ok(document.querySelector('[data-field="prompt"]'), "video form"));
});
