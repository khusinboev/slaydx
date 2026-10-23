import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AlifboPage } from "../../components/alifbo/AlifboPage.tsx";

/**
 * Script converter page (`/uz/alifbo`, owner request 6): live client-side output, swap, copy, count, file upload.
 * Mutations (restored): the output not recomputed on `from` change -> «changing a script re-converts»;
 * `swap` not moving the output into the input -> «swap»; the `mode` field dropped from the upload -> «file upload».
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
type Call = { url: string; method: string; body: FormData | null };
function stub(status: unknown, post?: () => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const c = { url: String(input), method: (init.method ?? "GET").toUpperCase(), body: init.body instanceof FormData ? init.body : null };
    calls.push(c);
    if (c.method === "POST") return post ? post() : new Response("x", { headers: { "content-disposition": 'attachment; filename="Hisobot-lotin.docx"' } });
    return json(200, status);
  }) as typeof fetch;
  return calls;
}
const OK = { enabled: true, limit: 20, used: 3, remaining: 17 };
const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const input = () => q("[data-alifbo-input]") as HTMLTextAreaElement;
const output = () => q("[data-alifbo-output]") as HTMLTextAreaElement;
const radios = (label: string) => [...document.querySelectorAll(`[role="radiogroup"][aria-label="${label}"] [role="radio"]`)] as HTMLElement[];
const on = (label: string) => radios(label).find((r) => r.getAttribute("aria-checked") === "true")!.textContent;
const choose = (label: string, text: string) => fireEvent.click(radios(label).find((r) => r.textContent === text)!);
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

test("page: names the three alphabets, labels both selectors and cites the law", () => {
  stub(OK);
  render(h(AlifboPage));
  assert.match(document.body.textContent!, /Alifbo: Kirill ↔ Lotin ↔ Yangi lotin — tekin/);
  assert.match(q("[data-alifbo-note]").textContent!, /Yangi lotin alifbosi — ЎРҚ-1184 qonuni \(21\.10\.2026\), 22\.04\.2027 dan kuchga kiradi\./);
  assert.match(document.body.textContent!, /Faylni o'girish \(DOCX, PPTX, TXT\)/);
  assert.deepEqual(radios("Boshlang'ich alifbo").map((r) => r.textContent), ["Kirill", "Lotin", "Yangi lotin"]);
  assert.deepEqual(radios("Natija alifbosi").map((r) => r.textContent), ["Kirill", "Lotin", "Yangi lotin"]);
});

test("defaults to Kirill -> Lotin and converts live, without any server call for the text", async () => {
  const calls = stub(OK);
  render(h(AlifboPage));
  assert.equal(on("Boshlang'ich alifbo"), "Kirill");
  assert.equal(on("Natija alifbosi"), "Lotin");
  await waitFor(() => assert.equal(calls.length, 1)); // the «Bugun qoldi» status only
  type("Ўзбекистон шаҳри");
  assert.equal(output().value, "Oʻzbekiston shahri");
  type("Ўзбекистон шаҳри — Ёшлар");
  assert.equal(output().value, "Oʻzbekiston shahri — Yoshlar");
  type("");
  assert.equal(output().value, "");
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  assert.equal(calls.length, 1, "typing makes no request");
  assert.equal(output().readOnly, true);
});

test("changing a script re-converts the same input", () => {
  stub(OK);
  render(h(AlifboPage));
  type("Ўзбекистон шаҳри");
  choose("Natija alifbosi", "Yangi lotin");
  assert.equal(output().value, "Özbekiston şahri");
  choose("Boshlang'ich alifbo", "Lotin");
  // from = Lotin, to = Yangi lotin on Cyrillic input: Cyrillic letters are not Latin words, so they pass through
  assert.equal(on("Boshlang'ich alifbo"), "Lotin");
  type("Oʻzbekiston shahri, gʻalaba, chiroyli");
  assert.equal(output().value, "Özbekiston şahri, ğalaba, çiroyli");
});

test("picking the other side's script swaps the pair (from and to are never equal)", () => {
  stub(OK);
  render(h(AlifboPage));
  choose("Boshlang'ich alifbo", "Lotin"); // to is Lotin -> to becomes Kirill
  assert.equal(on("Boshlang'ich alifbo"), "Lotin");
  assert.equal(on("Natija alifbosi"), "Kirill");
  choose("Natija alifbosi", "Lotin"); // from is Lotin -> from becomes Kirill
  assert.equal(on("Boshlang'ich alifbo"), "Kirill");
  assert.equal(on("Natija alifbosi"), "Lotin");
});

test("swap: scripts exchange places and the result becomes the input", () => {
  stub(OK);
  render(h(AlifboPage));
  type("Ўзбекистон шаҳри");
  assert.equal(output().value, "Oʻzbekiston shahri");
  fireEvent.click(q("[data-alifbo-swap]"));
  assert.equal(on("Boshlang'ich alifbo"), "Lotin");
  assert.equal(on("Natija alifbosi"), "Kirill");
  assert.equal(input().value, "Oʻzbekiston shahri");
  assert.equal(output().value, "Ўзбекистон шаҳри", "the round trip is back at the original");
  assert.equal(q("[data-alifbo-swap]").getAttribute("aria-label"), "Alifbolarni almashtirish");
});

test("character count follows the input", () => {
  stub(OK);
  render(h(AlifboPage));
  assert.match(q("[data-alifbo-count]").textContent!, /Belgilar: 0/);
  type("Салом");
  assert.match(q("[data-alifbo-count]").textContent!, /Belgilar: 5/);
  type("Салом\nдунё");
  assert.match(q("[data-alifbo-count]").textContent!, /Belgilar: 10/);
});

test("copy button copies the converted text and confirms; it is disabled with no output", async () => {
  stub(OK);
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true });
  render(h(AlifboPage));
  const btn = q("[data-alifbo-copy]") as HTMLButtonElement;
  assert.equal(btn.disabled, true);
  type("Ўзбек");
  assert.equal(btn.disabled, false);
  await act(async () => {
    fireEvent.click(btn);
  });
  assert.deepEqual(copied, ["Oʻzbek"]);
  await waitFor(() => assert.match(btn.textContent!, /Nusxalandi/));
});

test("both areas are AutoTextarea: no resize handle; the result area is read-only", () => {
  stub(OK);
  render(h(AlifboPage));
  for (const el of [input(), output()]) {
    assert.equal(el.tagName, "TEXTAREA");
    assert.equal(el.style.resize, "none");
  }
  assert.equal(input().readOnly, false);
  assert.equal(output().readOnly, true);
});

test("«Bugun qoldi» is shown for the file card", async () => {
  stub(OK);
  render(h(AlifboPage));
  await waitFor(() => assert.match(q("[data-alifbo-left]").textContent!, /Bugun qoldi: 17 \/ 20/));
});

const pick = (name: string, size = 10) => fireEvent.change(q("[data-alifbo-file]"), { target: { files: [new File([new Uint8Array(size)], name)] } });

test("file upload: posts mode=alifbo with the chosen scripts, then offers the download", async () => {
  const calls = stub(OK);
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => undefined;
  render(h(AlifboPage));
  choose("Natija alifbosi", "Yangi lotin");
  pick("Hisobot.docx");
  await waitFor(() => assert.equal((q("[data-alifbo-go]") as HTMLButtonElement).disabled, false));
  fireEvent.click(q("[data-alifbo-go]"));
  await waitFor(() => assert.match(q("[data-alifbo-download]").textContent!, /Hisobot-lotin\.docx/));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, "/api/convert");
  assert.equal(post.body!.get("mode"), "alifbo");
  assert.equal(post.body!.get("from"), "cyr");
  assert.equal(post.body!.get("to"), "new");
  assert.equal((post.body!.get("file") as File).name, "Hisobot.docx");
  assert.equal(post.body!.get("target"), null);
});

test("file upload: unsupported type and oversize are refused before any upload", async () => {
  const calls = stub(OK);
  render(h(AlifboPage));
  pick("kitob.pdf");
  await waitFor(() => assert.match(q("[data-alifbo-error]").textContent!, /Faqat DOCX, PPTX yoki TXT/));
  assert.equal((q("[data-alifbo-go]") as HTMLButtonElement).disabled, true);
  pick("katta.txt", 6 * 1024 * 1024);
  await waitFor(() => assert.match(q("[data-alifbo-error]").textContent!, /5 MB/));
  pick("katta.docx", 21 * 1024 * 1024);
  await waitFor(() => assert.match(q("[data-alifbo-error]").textContent!, /20 MB/));
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("file upload: server errors are shown (401 asks to sign in, 429 shows the limit text)", async () => {
  stub(OK, () => json(401, {}));
  render(h(AlifboPage));
  pick("a.txt");
  await waitFor(() => assert.equal((q("[data-alifbo-go]") as HTMLButtonElement).disabled, false));
  fireEvent.click(q("[data-alifbo-go]"));
  await waitFor(() => assert.match(q("[data-alifbo-error]").textContent!, /tizimga kiring/));
  cleanup();
  stub(OK, () => json(429, { error: "Bugungi limit tugadi (20 ta)." }));
  render(h(AlifboPage));
  pick("a.txt");
  await waitFor(() => assert.equal((q("[data-alifbo-go]") as HTMLButtonElement).disabled, false));
  fireEvent.click(q("[data-alifbo-go]"));
  await waitFor(() => assert.equal(q("[data-alifbo-error]").textContent, "Bugungi limit tugadi (20 ta)."));
});

test("switched off: the file card says so, the text converter still works", async () => {
  stub({ enabled: false, limit: 0, used: 0, remaining: 0 });
  render(h(AlifboPage));
  await waitFor(() => assert.ok(q("[data-alifbo-off]")));
  assert.ok(!document.querySelector("[data-alifbo-drop]"));
  type("Салом");
  assert.equal(output().value, "Salom");
});
