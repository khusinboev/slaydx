import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PhotoField } from "../../components/forms/PhotoField.tsx";

/**
 * C41 klient qismi (BEA-19/FE-20): rezyume surati 90 kundan keyin
 * serverdan o'chiriladi (`purgeOldPhotos`), qoralama esa `photoAssetId`
 * ni muddatsiz saqlaydi. Ilgari qaytgan foydalanuvchi SINIQ rasm ko'rardi,
 * hech qanday ishora yo'q edi, pullik rezyume esa jimgina suratsiz chiqardi.
 * Endi rasm yuklanmasa — serverdan holati so'raladi: 404 bo'lsa maydon
 * tozalanadi (o'lik id yuborilmaydi), o'rnida bo'sh joy va «Suratni qayta
 * yuklang» ishorasi.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

type Value = { assetId: string; originalAssetId: string };
let last: Value | null = null;

function Harness({ initial }: { initial: Value }) {
  const [v, setV] = useState(initial);
  return h(PhotoField, {
    assetId: v.assetId,
    originalAssetId: v.originalAssetId,
    shape: "circle",
    onChange: (next: Value) => {
      last = next;
      setV(next);
    },
  });
}

function stubPhoto(status: number): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(status === 200 ? "img" : JSON.stringify({ error: "Surat topilmadi" }), { status });
  }) as typeof fetch;
  return calls;
}

const ID = "a".repeat(32);

test("tiklangan qoralamadagi surat o'chirilgan (404) — siniq rasm yo'q, maydon tozalanadi, «Suratni qayta yuklang»", async () => {
  last = null;
  const calls = stubPhoto(404);
  render(h(Harness, { initial: { assetId: ID, originalAssetId: ID } }));
  const img = screen.getByAltText("Rezyume surati");
  await act(async () => {
    fireEvent.error(img);
  });
  await waitFor(() => assert.ok(screen.getByText(/Suratni qayta yuklang/)));
  assert.ok(!screen.queryByAltText("Rezyume surati"), "siniq <img> qolmaydi");
  assert.ok(calls.some((u) => u === `/api/uploads/photo/${ID}`), "holat serverdan so'raldi");
  assert.equal((last as Value | null)?.assetId, "", "o'lik id forma qiymatidan olib tashlandi (suratsiz pullik rezyume yo'q)");
  assert.ok(screen.getByText("Surat qo‘shish"), "qayta yuklash tugmasi");
});

test("rasm vaqtincha ochilmadi (server 200 / tarmoq) — id saqlanadi, faqat bo'sh joy va ogohlantirish", async () => {
  last = null;
  stubPhoto(200);
  render(h(Harness, { initial: { assetId: ID, originalAssetId: ID } }));
  await act(async () => {
    fireEvent.error(screen.getByAltText("Rezyume surati"));
  });
  await waitFor(() => assert.ok(screen.getByText(/Surat ochilmadi/)));
  assert.equal(last, null, "vaqtinchalik xatoda maydon tozalanmaydi");
  assert.ok(!screen.queryByAltText("Rezyume surati"), "siniq rasm o'rnida bo'sh joy");
});
