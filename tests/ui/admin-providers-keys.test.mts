import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { ProvidersPage } from "../../components/admin/providers/ProvidersPage.tsx";
import { keyProblem } from "../../components/admin/providers/ProviderDialogs.tsx";
import { keyState } from "../../components/admin/providers/format.ts";

/**
 * `/admin/providers` «Provayderlar» (program-17 decision D7): loading, error, forbidden; one row per provider with
 * its switch, key state («Bazada …a1B2» / «Env» / «Yo'q»), «Tez orada» for reserved providers; roles without edit
 * rights see no controls and no hint; «Kalitni kiritish» / «Almashtirish» use a PASSWORD field, send exactly
 * `{key, reason}` and never show the key again (not in the DOM, not in a toast); «O'chirish» and the switch ask
 * for a reason; «Tekshirish» shows the server's answer; a stale step-up is asked once and the same request is replayed.
 */
const req = createRequire(import.meta.url);
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  core.setStepUpHandler(null);
  useToastStore.getState().clear();
});

const PERMS = {
  owner: ["settings.view", "settings.edit"],
  finance: ["settings.view"],
  viewer: ["settings.view"],
} as const;
type Role = keyof typeof PERMS;

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };
function stubFetch(responders: Array<(c: Call) => Response | Promise<Response>>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const c = { url: String(url), init, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} };
    calls.push(c);
    const next = responders[calls.length - 1];
    assert.ok(next, `kutilmagan ${calls.length}-so'rov: ${String(url)}`);
    return next(c);
  }) as typeof fetch;
  return calls;
}

function mount(node: ReactNode, role: Role = "owner") {
  render(h(AdminIdentityProvider, { value: { adminId: "1", role, permissions: PERMS[role], name: "Admin", username: null, twoFactor: true }, children: node }));
}

const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

type Item = {
  id: string;
  label: string;
  kinds: string[];
  implemented: boolean;
  testable: boolean;
  keyFormat: string;
  enabled: boolean;
  hasDbKey: boolean;
  keyHint: string | null;
  envPresent: boolean;
  keySource: "db" | "env" | "none";
  unreadable: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};
const item = (p: Partial<Item> & Pick<Item, "id" | "label">): Item => ({
  kinds: ["llm"],
  implemented: true,
  testable: true,
  keyFormat: "sk-…",
  enabled: true,
  hasDbKey: false,
  keyHint: null,
  envPresent: false,
  keySource: "none",
  unreadable: false,
  updatedBy: null,
  updatedAt: null,
  ...p,
});

const GEMINI = item({ id: "gemini", label: "Google Gemini", kinds: ["llm", "image", "tts"], envPresent: true, keySource: "env" });
const FAL = item({ id: "fal", label: "fal.ai", kinds: ["image"], testable: false, hasDbKey: true, keyHint: "…a1B2", keySource: "db", updatedBy: "Dilnoza Admin", updatedAt: "2026-10-01T09:30:00.000Z" });
const XAI = item({ id: "xai", label: "xAI (Grok)" });
const PEXELS = item({ id: "pexels", label: "Pexels", kinds: ["image"], enabled: false, envPresent: true });
const KLING = item({ id: "kling", label: "Kling (video)", kinds: ["video"], implemented: false, testable: false });
const ITEMS = [GEMINI, FAL, XAI, PEXELS, KLING];
const BODY = { items: ITEMS, canStoreKeys: true, propagationSec: 30 };

const rowOf = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-provider="${id}"]`);
  assert.ok(el, `${id} qatori yo'q`);
  return el;
};
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const ready = async () => screen.findByText("Google Gemini");

const SECRET = "Zq7Kp9Xw3Lm5Rt8Vb2NcQ9ZZ";

/* ───────────────────────────── helpers (no DOM) ───────────────────────────── */

test("keyProblem mirrors the server's key check", () => {
  assert.equal(keyProblem(""), null, "empty: nothing to complain about yet");
  assert.equal(keyProblem(SECRET), null);
  assert.match(keyProblem("short") ?? "", /qisqa/);
  assert.match(keyProblem("a".repeat(513)) ?? "", /uzun/);
  assert.match(keyProblem("abcd efgh ijkl") ?? "", /bo'sh joy/);
  assert.match(keyProblem("kalit-ўзбек-1234") ?? "", /ASCII/);
});

test("keyState: Bazada …a1B2 / Env / Yo'q / unreadable", () => {
  assert.deepEqual(keyState(FAL), { tone: "success", label: "Bazada …a1B2" });
  assert.deepEqual(keyState({ ...FAL, keyHint: null }), { tone: "success", label: "Bazada" });
  assert.deepEqual(keyState(GEMINI), { tone: "info", label: "Env" });
  assert.deepEqual(keyState(XAI), { tone: "neutral", label: "Yo'q" });
  assert.equal(keyState({ ...FAL, unreadable: true, envPresent: true }).tone, "warning");
  assert.match(keyState({ ...FAL, unreadable: true, envPresent: true }).label, /Env ishlatiladi/);
});

/* ───────────────────────────── states ───────────────────────────── */

test("loading: skeleton and the propagation note from the start", async () => {
  stubFetch([() => new Promise<Response>(() => {})]);
  mount(h(ProvidersPage));
  assert.ok(document.querySelector('[aria-busy="true"]'));
  assert.ok(screen.getByRole("note").textContent?.includes("30 soniyagacha"));
});

test("ready: one row per provider with switch, key state and actions", async () => {
  const calls = stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  assert.equal(calls[0].url, "/api/admin/providers");
  assert.equal(document.querySelectorAll("[data-provider]").length, ITEMS.length);

  const gemini = within(rowOf("gemini"));
  assert.ok(gemini.getByText("Matn (LLM)") && gemini.getByText("Rasm") && gemini.getByText("Ovoz"));
  assert.equal(gemini.getByRole("switch").getAttribute("aria-checked"), "true");
  assert.equal(rowOf("gemini").querySelector("[data-key-state]")!.textContent, "Env");
  assert.ok(gemini.getByRole("button", { name: "Kalitni kiritish" }));
  assert.ok(!gemini.queryByRole("button", { name: "O'chirish" }), "nothing stored: nothing to delete");
  assert.ok(gemini.getByRole("button", { name: "Tekshirish" }));

  const fal = within(rowOf("fal"));
  assert.equal(rowOf("fal").querySelector("[data-key-state]")!.textContent, "Bazada …a1B2");
  assert.ok(fal.getByRole("button", { name: "Almashtirish" }));
  assert.ok(fal.getByRole("button", { name: "O'chirish" }));
  assert.ok(!fal.queryByRole("button", { name: "Tekshirish" }), "no cheap live call for fal.ai");
  assert.ok(fal.getByText("Dilnoza Admin"));
  assert.ok(fal.getByText(/01\.10\.2026 14:30/), "Tashkent time");

  assert.equal(rowOf("xai").querySelector("[data-key-state]")!.textContent, "Yo'q");

  const pexels = within(rowOf("pexels"));
  assert.equal(pexels.getByRole("switch").getAttribute("aria-checked"), "false");
  assert.equal(rowOf("pexels").getAttribute("data-enabled"), "0");
  assert.ok(pexels.getByText(/kalit ishlatilmaydi/), "off: says the env key is not in use");

  const kling = within(rowOf("kling"));
  assert.ok(kling.getByText("Tez orada"));
  assert.ok(!kling.queryByRole("switch"), "a reserved provider has no switch");
  assert.ok(kling.getByRole("button", { name: "Kalitni kiritish" }), "but a key can be stored");
  assert.ok(!screen.queryByRole("alert"), "sealing key present: no warning");
});

test("no sealing key on the server: warning, key buttons disabled, switches still work", async () => {
  stubFetch([() => json(200, { ...BODY, canStoreKeys: false })]);
  mount(h(ProvidersPage));
  await ready();
  assert.ok(document.querySelector("[data-crypto-missing]"));
  assert.match(screen.getByRole("alert").textContent ?? "", /PROVIDER_KEYS_KEY/);
  assert.equal(within(rowOf("xai")).getByRole("button", { name: "Kalitni kiritish" }).hasAttribute("disabled"), true);
  assert.equal(within(rowOf("xai")).getByRole("switch").hasAttribute("disabled"), false);
});

test("error: message + request id, retry loads again; forbidden: «Ruxsat yo'q»", async () => {
  const calls = stubFetch([() => json(500, { error: "Ichki xatolik", requestId: "req-909" }), () => json(200, BODY)]);
  mount(h(ProvidersPage));
  await screen.findByText("Ichki xatolik");
  assert.ok(screen.getByText("req-909"));
  fireEvent.click(button("Qayta urinish"));
  await ready();
  assert.equal(calls.length, 2);
  cleanup();
  stubFetch([() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" })]);
  mount(h(ProvidersPage));
  await screen.findByText("Ruxsat yo'q");
});

test("viewer and finance: read only -- no switch, no buttons, no hint", async () => {
  for (const role of ["viewer", "finance"] as const) {
    stubFetch([() => json(200, { ...BODY, items: ITEMS.map((i) => ({ ...i, keyHint: null })) })]);
    mount(h(ProvidersPage), role);
    await ready();
    assert.equal(screen.queryAllByRole("switch").length, 0, role);
    for (const name of ["Kalitni kiritish", "Almashtirish", "O'chirish", "Tekshirish"]) assert.equal(screen.queryAllByRole("button", { name }).length, 0, `${role}: ${name}`);
    assert.ok(screen.getByText(/faqat ko'rish huquqi/));
    assert.equal(rowOf("fal").querySelector("[data-key-state]")!.textContent, "Bazada", `${role}: no hint`);
    assert.ok(!document.body.textContent?.includes("a1B2"));
    assert.equal(within(rowOf("pexels")).getByText("O'chirilgan", { selector: "span" }) !== null, true, "the state is still visible");
    cleanup();
  }
});

/* ───────────────────────────── key dialog ───────────────────────────── */

test("«Kalitni kiritish»: password field, reason, exact body, the key is never shown again", async () => {
  const saved = { ...XAI, hasDbKey: true, keyHint: `…${SECRET.slice(-4)}`, keySource: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, BODY), () => json(200, { item: saved })]);
  mount(h(ProvidersPage));
  await ready();

  fireEvent.click(within(rowOf("xai")).getByRole("button", { name: "Kalitni kiritish" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Kalitni kiritish", { selector: "h2, h3, [id]" }) || true);
  const input = within(dialog).getByLabelText("API kalit") as HTMLInputElement;
  assert.equal(input.type, "password", "never a visible text field");
  assert.equal(input.getAttribute("autocomplete"), "new-password");
  assert.equal(input.getAttribute("spellcheck"), "false");
  assert.ok(within(dialog).getByText(/Ko'rinishi: sk-/), "format hint");
  assert.equal(button("Saqlash").disabled, true, "nothing typed");

  fireEvent.change(input, { target: { value: "short" } });
  assert.match(within(dialog).getByText(/qisqa/).textContent ?? "", /kamida 8/);
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Yangi kalit olindi" } });
  assert.equal(button("Saqlash").disabled, true, "invalid key");
  fireEvent.change(input, { target: { value: `  ${SECRET}  ` } });
  assert.equal(button("Saqlash").disabled, false);
  fireEvent.click(button("Saqlash"));

  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls.length, 2, "no refetch: the answer replaces the row");
  assert.equal(calls[1].url, "/api/admin/providers/xai/key");
  assert.equal(calls[1].init.method, "PUT");
  assert.deepEqual(calls[1].body, { key: SECRET, reason: "Yangi kalit olindi" }, "trimmed, exactly key + reason");
  assert.equal(rowOf("xai").querySelector("[data-key-state]")!.textContent, `Bazada …${SECRET.slice(-4)}`);
  assert.ok(within(rowOf("xai")).getByRole("button", { name: "Almashtirish" }));
  assert.ok(toasts().some((m) => m.includes("30 soniyagacha")), toasts().join(" | "));
  // The key is gone from everything the user can see.
  assert.ok(!document.body.innerHTML.includes(SECRET), "not in the DOM");
  assert.ok(!toasts().join("|").includes(SECRET), "not in a toast");
  for (const i of document.querySelectorAll("input")) assert.notEqual((i as HTMLInputElement).value, SECRET);
});

test("«Almashtirish»: titled as a replacement, the server error stays inline and the typed key is kept for a retry", async () => {
  const calls = stubFetch([
    () => json(200, BODY),
    () => json(503, { error: "Shifrlash kaliti sozlanmagan", code: "crypto_unavailable" }),
    () => json(200, { item: { ...FAL, keyHint: `…${SECRET.slice(-4)}` } }),
  ]);
  mount(h(ProvidersPage));
  await ready();
  fireEvent.click(within(rowOf("fal")).getByRole("button", { name: "Almashtirish" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Kalitni almashtirish"));
  fireEvent.change(within(dialog).getByLabelText("API kalit"), { target: { value: SECRET } });
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kalit eskirgan edi" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Almashtirish" }));
  const alert = await within(dialog).findByRole("alert");
  assert.equal(alert.textContent, "Shifrlash kaliti sozlanmagan");
  assert.ok(screen.getByRole("dialog"), "dialog stays open");
  assert.equal((within(dialog).getByLabelText("API kalit") as HTMLInputElement).value, SECRET);
  fireEvent.click(within(dialog).getByRole("button", { name: "Almashtirish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls.length, 3);
  assert.equal(rowOf("fal").querySelector("[data-key-state]")!.textContent, `Bazada …${SECRET.slice(-4)}`);
  assert.ok(!document.body.innerHTML.includes(SECRET));
});

test("cancelling the key dialog discards the typed key", async () => {
  stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  fireEvent.click(within(rowOf("xai")).getByRole("button", { name: "Kalitni kiritish" }));
  let dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("API kalit"), { target: { value: SECRET } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Bekor qilish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.ok(!document.body.innerHTML.includes(SECRET));
  fireEvent.click(within(rowOf("xai")).getByRole("button", { name: "Kalitni kiritish" }));
  dialog = await screen.findByRole("dialog");
  assert.equal((within(dialog).getByLabelText("API kalit") as HTMLInputElement).value, "", "a fresh dialog starts empty");
});

/* ───────────────────────────── delete, switch, test ───────────────────────────── */

test("«O'chirish» (key): confirmation with a reason, DELETE {reason}, the row falls back to «Yo'q» / «Env»", async () => {
  const calls = stubFetch([() => json(200, BODY), () => json(200, { item: { ...FAL, hasDbKey: false, keyHint: null, keySource: "none" } })]);
  mount(h(ProvidersPage));
  await ready();
  fireEvent.click(within(rowOf("fal")).getByRole("button", { name: "O'chirish" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Saqlangan kalitni o'chirish"));
  assert.ok(within(dialog).getByText(/Muhitda \(env\) kalit yo'q/), "no env fallback: warns");
  assert.equal(button("Kalitni o'chirish").disabled, true, "reason missing");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kalit sizib chiqdi" } });
  fireEvent.click(button("Kalitni o'chirish"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls[1].url, "/api/admin/providers/fal/key");
  assert.equal(calls[1].init.method, "DELETE");
  assert.deepEqual(calls[1].body, { reason: "Kalit sizib chiqdi" });
  assert.equal(rowOf("fal").querySelector("[data-key-state]")!.textContent, "Yo'q");
  assert.ok(!within(rowOf("fal")).queryByRole("button", { name: "O'chirish" }));
});

test("the switch: confirmation, PUT {enabled, reason}; a 409 reloads the list", async () => {
  const calls = stubFetch([
    () => json(200, BODY),
    () => json(200, { item: { ...GEMINI, enabled: false, keySource: "none" } }),
    () => json(409, { error: "Provayder allaqachon yoqilgan", code: "state" }),
    () => json(200, { ...BODY, items: ITEMS.map((i) => (i.id === "pexels" ? { ...i, enabled: true } : i)) }),
  ]);
  mount(h(ProvidersPage));
  await ready();

  fireEvent.click(within(rowOf("gemini")).getByRole("switch"));
  let dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Provayderni o'chirish"));
  assert.ok(within(dialog).getByText(/hatto muhitda kalit bo'lsa ham/));
  const confirm = within(dialog).getByRole("button", { name: "O'chirish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true, "reason missing");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kvota tugadi" } });
  fireEvent.click(confirm);
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls[1].url, "/api/admin/providers/gemini/enabled");
  assert.equal(calls[1].init.method, "PUT");
  assert.deepEqual(calls[1].body, { enabled: false, reason: "Kvota tugadi" });
  assert.equal(rowOf("gemini").getAttribute("data-enabled"), "0");
  assert.equal(within(rowOf("gemini")).getByRole("switch").getAttribute("aria-checked"), "false");

  // Switching on, but someone else already did: 409 -> the list is reloaded and the dialog shows the message.
  fireEvent.click(within(rowOf("pexels")).getByRole("switch"));
  dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Provayderni yoqish"));
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Qayta yoqish" } });
  fireEvent.click(button("Yoqish"));
  await within(dialog).findByRole("alert");
  await waitFor(() => assert.equal(calls.length, 4), { timeout: 2000 });
  await waitFor(() => assert.equal(rowOf("pexels").getAttribute("data-enabled"), "1"));
});

test("«Tekshirish»: shows the server's answer inline; the cancelled step-up leaves no message", async () => {
  const calls = stubFetch([
    () => json(200, BODY),
    () => json(200, { ok: true, message: "Kalit qabul qilindi" }),
    () => json(200, { ok: false, message: "Provayder rad etdi (HTTP 401)" }),
  ]);
  mount(h(ProvidersPage));
  await ready();
  fireEvent.click(within(rowOf("gemini")).getByRole("button", { name: "Tekshirish" }));
  await waitFor(() => assert.equal(rowOf("gemini").querySelector("[data-test-result]")?.getAttribute("data-test-result"), "ok"));
  assert.equal(calls[1].url, "/api/admin/providers/gemini/test");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(rowOf("gemini").querySelector("[data-test-result]")!.textContent, "Kalit qabul qilindi");
  fireEvent.click(within(rowOf("gemini")).getByRole("button", { name: "Tekshirish" }));
  await waitFor(() => assert.equal(rowOf("gemini").querySelector("[data-test-result]")?.getAttribute("data-test-result"), "fail"));
  assert.match(rowOf("gemini").querySelector("[data-test-result]")!.textContent ?? "", /HTTP 401/);

  cleanup();
  core.setStepUpHandler(async () => false);
  stubFetch([() => json(200, BODY), () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" })]);
  mount(h(ProvidersPage));
  await ready();
  fireEvent.click(within(rowOf("gemini")).getByRole("button", { name: "Tekshirish" }));
  await waitFor(() => assert.ok(!within(rowOf("gemini")).getByRole("button", { name: "Tekshirish" }).hasAttribute("aria-busy")));
  assert.equal(rowOf("gemini").querySelector("[data-test-result]"), null);
});

test("step-up: 401 reauth on a key write -> the code is asked once and the SAME request is replayed", async () => {
  const saved = { ...XAI, hasDbKey: true, keyHint: `…${SECRET.slice(-4)}`, keySource: "db" };
  let asked = 0;
  core.setStepUpHandler(async () => {
    asked += 1;
    return true;
  });
  const calls = stubFetch([
    () => json(200, BODY),
    () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" }),
    () => json(200, { item: saved }),
  ]);
  mount(h(ProvidersPage));
  await ready();
  fireEvent.click(within(rowOf("xai")).getByRole("button", { name: "Kalitni kiritish" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("API kalit"), { target: { value: SECRET } });
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Yangi kalit olindi" } });
  fireEvent.click(button("Saqlash"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(asked, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].body, calls[2].body);
  assert.ok(!document.body.innerHTML.includes(SECRET));
});
