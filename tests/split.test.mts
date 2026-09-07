import test from "node:test";
import assert from "node:assert/strict";
import { cutWords, splitByHeight, type TextSplitter } from "../lib/viewers/split.ts";

/**
 * Sahifadan uzun matnli bandlarni bo'lish (AUDIT-6 3-band).
 *
 * Brauzer ko'ruvchisi har varaqni qat'iy balandlikdagi `word-sheet`
 * sifatida chizadi; Word esa uzun paragrafni sahifalar orasida bo'lib
 * turadi. `splitByHeight` aynan shu bo'linishni taqlid qiladi: sig'magan
 * matnli band so'zlar bo'yicha ikkiga bo'linadi.
 */

type Item = { k: "p" | "h1"; text: string };

const SP: TextSplitter<Item> = {
  takeText: (it) => (it.k === "p" ? it.text : null),
  makePart: (it, part) => ({ ...it, text: part, k: it.k } as Item),
};

test("cutWords: sig'adigan matn bo'linmaydi (ratio >= 1)", () => {
  const text = "a b c d e f g h i j";
  assert.equal(cutWords(text, 1.2), null);
  assert.equal(cutWords(text, 1), null);
});

test("cutWords: 3 dan kam so'z bo'linmaydi", () => {
  assert.equal(cutWords("bir ikki", 0.2), null, "ikki so'zli satrni bo'lish xato bo'lardi");
});

test("cutWords: ratio bo'yicha ikkiga bo'ladi, bo'sh bo'lak yo'q", () => {
  const text = "bir ikki uch to'rt besh olti yetti sakkiz to'qqiz o'n";
  const parts = cutWords(text, 0.7);
  assert.ok(parts, "bo'linishi kerak");
  const [head, tail] = parts;
  assert.equal(`${head} ${tail}`, text, "so'zlar yo'qolmasin");
  assert.ok(head.length > 0 && tail.length > 0, "ikkala bo'lak ham to'la bo'lsin");
  assert.ok(head.length > tail.length, "ratio > 0.5 bo'lgani uchun head kattaroq");
});

test("cutWords: juda uzun matn kamida yarmini beradi (convergence)", () => {
  const text = Array.from({ length: 40 }, (_, i) => `s${i}`).join(" ");
  const parts = cutWords(text, 0.01);
  assert.ok(parts, "bo'linishi kerak");
  const [head, tail] = parts;
  assert.equal(`${head} ${tail}`, text, "so'zlar yo'qolmasin");
  // 0.5 pastki chegara — aks holda bitta bo'lak cheksiz kichrayib borardi.
  const headCount = head.split(" ").length;
  assert.ok(headCount >= 20, `head kamida yarmi bo'lsin (oldi ${headCount})`);
});

test("splitByHeight: sig'gan bandlar o'zgarmaydi", () => {
  const items: Item[] = [{ k: "p", text: "qisqa" }, { k: "h1", text: "Sarlavha" }];
  const res = splitByHeight(items, [100, 40], 300, SP);
  assert.equal(res.changed, false);
  assert.deepEqual(res.list, items);
});

test("splitByHeight: uzun p band bo'linadi, sarlavha esa bo'linmaydi", () => {
  const long = Array.from({ length: 50 }, (_, i) => `soz${i}`).join(" ");
  const items: Item[] = [
    { k: "h1", text: "Sarlavha" },
    { k: "p", text: long },
    { k: "p", text: "qisqa" },
  ];
  // Sarlavha 40 px — sig'adi; p 2000 px — ratio 0.25 → kamida yarmi (0.5)
  // → 25/25 bo'linadi; oxirgi p 100 px — sig'adi.
  const res = splitByHeight(items, [40, 2000, 100], 500, SP);
  assert.equal(res.changed, true);
  assert.equal(res.list.length, 4, "h1 + p(2 bo'lak) + qisqa p");
  assert.equal(res.list[0].text, "Sarlavha");
  assert.equal(res.list[0].k, "h1");
  const head = res.list[1];
  const tail = res.list[2];
  assert.equal(`${head.text} ${tail.text}`, long, "so'zlar yo'qolmasin");
  assert.equal(res.list[3].text, "qisqa");
});

test("splitByHeight: qisqa matnli uzun band bo'linmaydi (bitta so'z)", () => {
  const items: Item[] = [{ k: "p", text: "superuzunsatr" }];
  const res = splitByHeight(items, [2000], 500, SP);
  assert.equal(res.changed, false, "bo'linmaydigan band — kesilishi mumkin, lekin sikl bo'lmaydi");
  assert.equal(res.list.length, 1);
});

test("splitByHeight: bo'lak yana sig'masa keyingi aylanishda yana bo'linadi", () => {
  // 1-aylanish: 2000px → ratio 0.25 → min 0.5 → yarmi (taxminan 1000px) hali katta.
  const long = Array.from({ length: 40 }, (_, i) => `soz${i}`).join(" ");
  const run = (items: Item[], hs: number[]) => splitByHeight(items, hs, 500, SP);
  const first = run([{ k: "p", text: long }], [2000]);
  assert.equal(first.changed, true);
  assert.equal(first.list.length, 2);
  // 2-aylanish: ikkala bo'lak ham 1000px → ularning har biri yana bo'linadi.
  const second = run(first.list, [1000, 1000]);
  assert.equal(second.changed, true, "bo'laklar hali ham sig'mayapti — bo'linishi kerak");
  assert.equal(second.list.length, 4, "2 bo'lak → 4 bo'lak (har biri yana ikkiga)");
  const joined = second.list.map((it) => it.text).join(" ");
  assert.equal(joined, long, "hech qanday so'z yo'qolmasin");
});