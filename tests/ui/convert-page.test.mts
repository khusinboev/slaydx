import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ConvertPage } from "../../components/convert/ConvertPage.tsx";
import { sourceOfName, targetsFor } from "../../lib/convert/matrix.ts";

/**
 * Free converter page (owner request 13): targets per source, «Bugun qoldi», errors.
 * Mutations (restored): `targetsFor` ignoring the file's own image format -> «image: own format»;
 * limit line not rendered -> «limit display»; error text dropped -> «server error is shown».
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
type Call = { url: string; method: string; body: FormData | null };
function stub(status: unknown, post?: () => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const c = { url: String(input), method: (init.method ?? "GET").toUpperCase(), body: init.body instanceof FormData ? init.body : null };
    calls.push(c);
    if (c.method === "POST") return post ? post() : new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "content-disposition": 'attachment; filename="Hisobot.pdf"' } });
    return json(200, status);
  }) as typeof fetch;
  return calls;
}
const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const targets = () => [...document.querySelectorAll('[role="radio"]')].map((b) => b.textContent);
const pick = (name: string, size = 10) => {
  const f = new File([new Uint8Array(size)], name);
  fireEvent.change(q("[data-convert-input]"), { target: { files: [f] } });
};
const OK = { enabled: true, limit: 20, used: 3, remaining: 17 };

test("matrix: valid targets per source (same table the server enforces)", () => {
  assert.deepEqual(targetsFor(sourceOfName("a.docx")!), ["pdf"]);
  assert.deepEqual(targetsFor(sourceOfName("a.pptx")!), ["pdf"]);
  assert.deepEqual(targetsFor(sourceOfName("a.pdf")!), ["png", "jpg", "docx"]);
  assert.deepEqual(targetsFor(sourceOfName("a.png")!, "a.png"), ["pdf", "jpg", "webp"]);
  assert.deepEqual(targetsFor(sourceOfName("a.JPEG")!, "a.JPEG"), ["pdf", "png", "webp"], "image: own format is not offered");
  assert.equal(sourceOfName("table.xlsx"), null, "Excel is not in v1");
});

test("limit display: «Bugun qoldi: N / 20»", async () => {
  stub(OK);
  render(h(ConvertPage));
  await waitFor(() => assert.match(q("[data-convert-left]").textContent!, /Bugun qoldi: 17 \/ 20/));
  assert.match(document.body.textContent!, /Fayl konvertatsiya — tekin/);
});

test("target options follow the detected source", async () => {
  stub(OK);
  render(h(ConvertPage));
  pick("kitob.pdf");
  await waitFor(() => assert.equal(q("[data-convert-source]").textContent, "PDF"));
  assert.deepEqual(targets(), ["PNG", "JPG", "Word (DOCX)"]);
  pick("rasm.png");
  await waitFor(() => assert.equal(q("[data-convert-source]").textContent, "Rasm"));
  assert.deepEqual(targets(), ["PDF", "JPG", "WebP"]);
  pick("hisobot.docx");
  await waitFor(() => assert.equal(q("[data-convert-source]").textContent, "Word hujjat"));
  assert.deepEqual(targets(), ["PDF"]);
});

test("unsupported type and oversize are refused before any upload", async () => {
  const calls = stub(OK);
  render(h(ConvertPage));
  pick("jadval.xlsx");
  await waitFor(() => assert.match(q("[data-convert-error]").textContent!, /qo'llab-quvvatlanmaydi/));
  assert.ok(!document.querySelector("[data-convert-options]"));
  pick("katta.png", 16 * 1024 * 1024);
  await waitFor(() => assert.match(q("[data-convert-error]").textContent!, /15 MB/));
  assert.equal((q("[data-convert-go]") as HTMLButtonElement).disabled, true);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("convert: posts file + target, shows progress, then the download link", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const calls = stub(OK, () => {
    throw new Error("unused");
  });
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    if ((init.method ?? "GET").toUpperCase() === "POST") {
      calls.push({ url: String(input), method: "POST", body: init.body as FormData });
      await gate;
      return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "content-disposition": 'attachment; filename="Hisobot.pdf"; filename*=UTF-8\'\'Hisobot.pdf' } });
    }
    return base(input as never, init);
  }) as typeof fetch;
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => undefined;
  render(h(ConvertPage));
  pick("Hisobot.docx");
  await waitFor(() => assert.equal((q("[data-convert-go]") as HTMLButtonElement).disabled, false));
  fireEvent.click(q("[data-convert-go]"));
  await waitFor(() => assert.match(q("[data-convert-go]").textContent!, /Konvertatsiya qilinmoqda/));
  assert.equal((q("[data-convert-go]") as HTMLButtonElement).disabled, true);
  release();
  await waitFor(() => assert.match(q("[data-convert-download]").textContent!, /Hisobot\.pdf/));
  assert.equal(q("[data-convert-download]").getAttribute("download"), "Hisobot.pdf");
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, "/api/convert");
  assert.equal(post.body!.get("target"), "pdf");
  assert.equal((post.body!.get("file") as File).name, "Hisobot.docx");
});

test("server error is shown (busy 503, daily limit 429)", async () => {
  stub(OK, () => json(503, { error: "Hozir band, bir daqiqadan keyin urinib ko'ring" }));
  render(h(ConvertPage));
  pick("rasm.png");
  await waitFor(() => assert.equal((q("[data-convert-go]") as HTMLButtonElement).disabled, false));
  fireEvent.click(q("[data-convert-go]"));
  await waitFor(() => assert.equal(q("[data-convert-error]").textContent, "Hozir band, bir daqiqadan keyin urinib ko'ring"));
  assert.ok(!document.querySelector("[data-convert-download]"));
});

test("switched off (limit 0 / kill switch): no picker, a clear note", async () => {
  stub({ enabled: false, limit: 0, used: 0, remaining: 0 });
  render(h(ConvertPage));
  await waitFor(() => assert.ok(q("[data-convert-off]")));
  assert.ok(!document.querySelector("[data-convert-drop]"));
});
