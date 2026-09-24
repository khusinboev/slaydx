import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useFormDraft } from "../../components/forms/useFormDraft.ts";
import { DraftNotice } from "../../components/forms/DraftNotice.tsx";
import type { FormValues } from "../../lib/types.ts";

/**
 * FE-17 — forma qoralamasi.
 *
 * Ilgari `ArticleComposer`/`MediaComposer`/`WorkComposer` fayldan olingan
 * matnni (`sourceText`, 200 000 belgigacha; kirill — 2 bayt) HAR qoralama
 * PUT iga qo'shardi. 200 KB dan oshgach server 413 qaytarar, klient uni
 * JIM yutardi — shundan keyin formaning HECH bir maydoni saqlanmasdi,
 * foydalanuvchi esa «avtomatik saqlanyapti» deb o'ylardi. Endi:
 *   • fayldan olingan matn qoralamaga KIRMAYDI — faqat fayl nomi (havola);
 *     tiklanganda fayl «biriktirilgan» ko'rinmaydi, «qayta biriktiring» deyiladi;
 *   • saqlash yiqilsa (413, tarmoq) — kichik ogohlantirish chiqadi;
 *   • sahifa yopilayotganda yuborish `keepalive` bilan (brauzer uni bekor qilmaydi).
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

type Call = { url: string; method: string; body: string; keepalive: boolean };
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function stub(opts: { draft?: FormValues | null; put?: (body: string) => Response } = {}): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body, keepalive: Boolean(init?.keepalive) });
    if (url === "/api/forms/article/draft" && method === "GET") {
      return json(200, { draft: opts.draft ? { data: opts.draft, updatedAt: "now" } : null });
    }
    if (url === "/api/forms/article/draft" && method === "PUT") {
      // Server chegarasi (`lib/server/form-draft.ts` DRAFT_MAX_BYTES).
      if (new TextEncoder().encode(body).length > 200_000) return json(413, { error: "So‘rov juda katta" });
      return opts.put ? opts.put(body) : json(200, { updatedAt: "now" });
    }
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  return calls;
}

let api: ReturnType<typeof useFormDraft> | null = null;
function Harness({ values }: { values?: FormValues }) {
  api = useFormDraft("article", { enabled: true });
  const { ready, save } = api;
  useEffect(() => {
    if (ready && values) save(values);
  }, [ready, values, save]);
  return h(DraftNotice);
}

const puts = (calls: Call[]) => calls.filter((c) => c.method === "PUT");
const BIG = "Кириш матни. ".repeat(12_000); // ~156 000 belgi, ~290 KB UTF-8

test("fayldan olingan katta matn qoralamaga kirmaydi — qolgan maydonlar saqlanadi (413 yo'q)", async () => {
  const calls = stub();
  render(h(Harness, { values: { topic: "Sun’iy intellekt", fileName: "kitob.docx", sourceText: BIG } }));
  await waitFor(() => assert.equal(puts(calls).length, 1), { timeout: 3000 });
  const body = JSON.parse(puts(calls)[0].body) as { data: FormValues };
  assert.equal(body.data.topic, "Sun’iy intellekt", "mavzu saqlandi");
  assert.ok(!body.data.sourceText, "fayl matni qoralamaga kirmaydi");
  assert.equal(body.data.fileName, "kitob.docx", "havola — fayl nomi");
  assert.ok(puts(calls)[0].body.length < 5_000, `PUT tanasi kichik (${puts(calls)[0].body.length} bayt)`);
  assert.ok(!screen.queryByRole("status"), "muvaffaqiyatda ogohlantirish yo'q");
});

test("qo'lda yozilgan matn (fayl yo'q) qoralamada qoladi", async () => {
  const calls = stub();
  render(h(Harness, { values: { topic: "T", fileName: "", sourceText: "O‘zim yozgan matn" } }));
  await waitFor(() => assert.equal(puts(calls).length, 1), { timeout: 3000 });
  assert.equal((JSON.parse(puts(calls)[0].body) as { data: FormValues }).data.sourceText, "O‘zim yozgan matn");
});

test("saqlash yiqilsa (juda katta qoralama / server xatosi) — kichik ogohlantirish, keyingi muvaffaqiyatda yo'qoladi", async () => {
  let fail = true;
  const calls = stub({ put: () => (fail ? json(500, { error: "Ichki xato" }) : json(200, { updatedAt: "now" })) });
  const view = render(h(Harness, { values: { topic: "Birinchi" } }));
  await waitFor(() => assert.ok(screen.getByRole("status")), { timeout: 3000 });
  assert.match(screen.getByRole("status").textContent ?? "", /Qoralama saqlanmadi/);

  fail = false;
  view.rerender(h(Harness, { values: { topic: "Ikkinchi" } }));
  await waitFor(() => assert.ok(puts(calls).length >= 2 && !screen.queryByRole("status")), { timeout: 3000 });
});

test("juda katta qoralama (fayl matnisiz ham) serverga yuborilmaydi — ogohlantirish chiqadi", async () => {
  const calls = stub();
  render(h(Harness, { values: { topic: "T", extra: "x".repeat(260_000) } }));
  await waitFor(() => assert.ok(screen.getByRole("status")), { timeout: 3000 });
  assert.match(screen.getByRole("status").textContent ?? "", /Qoralama saqlanmadi/);
  assert.equal(puts(calls).length, 0, "413 ga olib boradigan so'rov yuborilmaydi");
});

test("tiklash: fayl nomi bor, matni yo'q — fayl biriktirilgan ko'rinmaydi, «qayta biriktiring» deyiladi", async () => {
  stub({ draft: { topic: "Eski mavzu", fileName: "kitob.docx" } });
  render(h(Harness));
  await waitFor(() => assert.ok(api?.ready));
  assert.equal(api!.draft?.topic, "Eski mavzu");
  assert.ok(!api!.draft?.fileName, "matnsiz fayl «biriktirilgan» bo'lib tiklanmaydi");
  const note = screen.getByRole("status");
  assert.match(note.textContent ?? "", /kitob\.docx/);
  assert.match(note.textContent ?? "", /qayta biriktiring/);
});

test("sahifa yashirilganda kutilayotgan qoralama keepalive bilan darhol yuboriladi", async () => {
  const calls = stub();
  render(h(Harness, { values: { topic: "Oxirgi harf" } }));
  await waitFor(() => assert.ok(api?.ready));
  await act(async () => {
    document.dispatchEvent(new window.Event("visibilitychange"));
  });
  await waitFor(() => assert.equal(puts(calls).length, 1));
  assert.equal(puts(calls)[0].keepalive, true, "keepalive — yopilayotgan sahifada ham yetib boradi");
});
