import test from "node:test";
import assert from "node:assert/strict";
import { parseLlmJson, parseLlmJsonDetailed, parseLlmObject } from "../lib/generation/json.ts";
import { rewriteLenient } from "../lib/generation/json-repair.ts";
import { SseAssembler, llmStream } from "../lib/generation/llm.ts";
import { STRICT_JSON_REMINDER, checkJson, inspectJson, resetFailureCounters } from "../lib/generation/llm/failure.ts";
import { resetBreakers } from "../lib/generation/llm/breaker.ts";
import { resetLimiters } from "../lib/generation/llm/limiter.ts";
import { withJobCost, type JobCost } from "../lib/generation/job-cost.ts";
import { deckJsonSchema, deckResponseSchema } from "../lib/generation/slide-prompt/index.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { extractNewSlides, resolveDeckTemplate, slideListOf, writeSlidesWithLlm } from "../lib/generation/slide-write.ts";
import type { SlideBeat } from "../lib/generation/slide-templates.ts";

/**
 * Slide text «bad_json» incident (prod 2026-10-12..14, docs/llm/SLIDE-BAD-JSON.md).
 *
 * ~3.7 % of slide jobs ended with «Taqdimot matni yozilmadi»: Gemini's answer
 * (finishReason STOP) was not parseable and the stricter retry often failed too.
 * Locked here:
 *
 *  1. one test per malformation: input -> the exact repaired object, plus the
 *     repair name that production counts (`[llm] json repaired`);
 *  2. what must NOT be repaired (`null`, nothing invented) and that valid JSON is
 *     never touched by the rewriter;
 *  3. the slide wrapper shapes (`slideListOf`): bare array, NDJSON, duplicated answer;
 *  4. the retry: non-streaming, JSON mime type + response schema, stricter reminder,
 *     every paid attempt in the job cost;
 *  5. the SSE assembler (a chunk spread over several `data:` lines, dropped chunks counted);
 *  6. the response schema mirrors the prompt schema field by field.
 *
 * No live calls: `fetch` is stubbed.
 */

const SLIDES = { slides: [{ layout: "bullets", title: "Suv aylanishi", bullets: ["Bug‘lanish", "Kondensatsiya"] }] };
const SLIDES_TEXT = JSON.stringify(SLIDES);

/** Parse and assert both the value and the repair strategy that fixed it. */
function repaired(input: string, expected: unknown, strategy: string): void {
  const r = parseLlmJsonDetailed(input);
  assert.ok(r, `not repaired: ${input.slice(0, 60)}`);
  assert.deepEqual(r.value, expected);
  assert.ok(r.repairs.includes(strategy as never), `expected strategy ${strategy}, got [${r.repairs.join(",")}]`);
}

/* ───────────────────────── 1. one test per malformation ───────────────────────── */

test("repair: fenced ```json block", () => {
  repaired("```json\n" + SLIDES_TEXT + "\n```", SLIDES, "fence");
  repaired("```JSON\n" + SLIDES_TEXT + "\n```", SLIDES, "fence");
});

test("repair: prose before and after the object", () => {
  repaired(`Mana taqdimot:\n${SLIDES_TEXT}\nUmid qilamanki, foydali bo‘ldi.`, SLIDES, "prose");
  repaired(`Mana:\n\`\`\`json\n${SLIDES_TEXT}\n\`\`\`\nTayyor!`, SLIDES, "fence");
});

test("repair: trailing commas in objects and arrays", () => {
  repaired('{"slides":[{"layout":"bullets","title":"A","bullets":["x","y",],},],}', { slides: [{ layout: "bullets", title: "A", bullets: ["x", "y"] }] }, "trailing_comma");
});

test("repair: unescaped quotes inside strings (Uzbek o\"/g\" spelling, inline quotes)", () => {
  repaired(
    '{"slides":[{"title":"O"zbekiston "mustaqillik" yillarida","notes":"G"oya: u "yaxshi", dedi","bullets":["a","b"]}]}',
    { slides: [{ title: 'O"zbekiston "mustaqillik" yillarida', notes: 'G"oya: u "yaxshi", dedi', bullets: ["a", "b"] }] },
    "inner_quotes",
  );
  // A comma after the inner quote must not be mistaken for the end of the string.
  repaired('{"q":"U "ha", dedi va ketdi","n":1}', { q: 'U "ha", dedi va ketdi', n: 1 }, "inner_quotes");
  repaired('["He said "yes", then left","b"]', ['He said "yes", then left', "b"], "inner_quotes");
});

test("repair: raw newline / tab / control character inside a string", () => {
  repaired('{"slides":[{"title":"A","notes":"birinchi qator\nikkinchi\tuchinchi"}]}', { slides: [{ title: "A", notes: "birinchi qator\nikkinchi\tuchinchi" }] }, "control_chars");
  repaired('{"a":"x\u0001y","b":"z\r\nw"}', { a: "x\u0001y", b: "z\r\nw" }, "control_chars");
});

test("repair: typographic quotes used as string delimiters", () => {
  repaired("{“slides”:[{“layout”:“bullets”,“title”:“Suv”}]}", { slides: [{ layout: "bullets", title: "Suv" }] }, "smart_quote_delimiters");
  // Typographic quotes INSIDE an ordinary string stay as text and cost no repair.
  const inside = parseLlmJsonDetailed('{"t":"u «dedi» va “keldi”"}');
  assert.deepEqual(inside?.value, { t: "u «dedi» va “keldi”" });
  assert.deepEqual(inside?.repairs, []);
});

test("repair: the whole object written twice (duplicated top-level object)", () => {
  repaired(`${SLIDES_TEXT}\n${SLIDES_TEXT}`, SLIDES, "duplicate_object");
  repaired(`${SLIDES_TEXT}${SLIDES_TEXT}`, SLIDES, "duplicate_object");
});

test("repair: NDJSON / several top-level objects become an array", () => {
  const a = { layout: "title", title: "A" };
  const b = { layout: "bullets", title: "B", bullets: ["x"] };
  repaired(`${JSON.stringify(a)}\n${JSON.stringify(b)}`, [a, b], "multi_object");
  // A cut-off last object is dropped, the complete ones stay.
  repaired(`${JSON.stringify(a)}\n${JSON.stringify(b)}\n{"layout":"bullets","title":"C","bul`, [a, b], "multi_object");
  repaired(`${JSON.stringify(a)}\n{"layout":"bullets","title":"B","bul`, a, "prose");
  // Same, but the first object itself needs a repair, so the lenient rewriter handles the whole text.
  repaired('{"layout":"title","title":"A",}\n{"layout":"bullets","title":"B","bul', a, "extra_fragment");
});

test("repair: invalid escapes (LaTeX, \\_, \\') keep the backslash as text", () => {
  repaired('{"f":"x = \\alpha + \\(y\\) \\_z"}', { f: "x = \\alpha + \\(y\\) \\_z" }, "bad_escape");
  repaired("{\"s\":\"it\\'s\"}", { s: "it's" }, "bad_escape");
  // `\u` without four hex digits is an invalid escape, not a unicode one.
  repaired('{"u":"\\underline{x}"}', { u: "\\underline{x}" }, "bad_escape");
  // Valid escapes are untouched.
  assert.deepEqual(parseLlmJson('{"n":"a\\nb","q":"\\"x\\"","u":"\\u00e9"}'), { n: "a\nb", q: '"x"', u: "é" });
});

test("repair: stray control characters and NBSP between tokens, BOM in front", () => {
  repaired('{"a": 1,\u0000"b":​2}', { a: 1, b: 2 }, "stray_chars");
  repaired("﻿" + SLIDES_TEXT, SLIDES, "bom");
});

test("repair: missing commas between pairs, elements and objects", () => {
  repaired('{"a":"x"\n"b":"y","c":[1 2,{"d":1}{"e":2}]}', { a: "x", b: "y", c: [1, 2, { d: 1 }, { e: 2 }] }, "missing_comma");
  repaired('{"bullets":["a"\n"b"\n"c"]}', { bullets: ["a", "b", "c"] }, "missing_comma");
});

test("repair: several malformations at once, even in a cut-off answer", () => {
  const r = parseLlmJsonDetailed('Mana:\n```json\n{"slides":[{"title":"A","notes":"bir\nik","bullets":["x",]},{"title":"B","notes":"yarim\nmat');
  assert.ok(r);
  const slides = (r.value as { slides: { title: string; notes?: string; bullets?: string[] }[] }).slides;
  assert.equal(slides[0].title, "A");
  assert.equal(slides[0].notes, "bir\nik");
  assert.deepEqual(slides[0].bullets, ["x"]);
  assert.equal(slides[1].title, "B", "the half-written second slide keeps what was complete");
  assert.equal(slides[1].notes, undefined);
  for (const s of ["fence", "control_chars", "trailing_comma", "truncated"]) assert.ok(r.repairs.includes(s as never), s);
});

/* ───────────────────────── 2. what stays unrepaired ───────────────────────── */

test("cannot repair: still null / bad_json, nothing is invented", () => {
  for (const bad of [
    "Kechirasiz, bu so‘rovni bajara olmayman.",
    "{slides: [{title: 'A'}]}", // unquoted keys and single quotes: a different dialect, not a syntax slip
    '{"a":[1,2}', // mismatched brackets: structure is not guessed
    '{"a":1]',
    '{"a" "b"}', // key without a value
    '{"a":None}', // Python literal
    "{",
    "[",
    "```json\n```",
  ]) {
    assert.equal(parseLlmJson(bad), null, bad);
    assert.equal(checkJson(bad, "STOP"), "bad_json", bad);
  }
});

test("cannot repair: a repaired object has exactly the fields the model wrote", () => {
  const r = parseLlmObject<Record<string, unknown>>('{"slides":[{"title":"A",},],}');
  assert.deepEqual(r, { slides: [{ title: "A" }] }, "no layout, bullets or notes appear out of nowhere");
  // An unfinished key without a value is dropped, never completed.
  assert.deepEqual(parseLlmJson('{"title":"A","bullets"'), { title: "A" });
  assert.deepEqual(parseLlmJson('{"title":"A","bullets":'), { title: "A" });
});

test("valid JSON is never changed by the lenient rewriter", () => {
  const docs = [
    SLIDES_TEXT,
    '{"t":"he said \\"hi\\", then \\"left\\"","a":[1,2.5,-3e2,true,false,null],"o":{}}',
    '{"s":"line\\nbreak\\ttab \\u00e9 «q» “q” ,\\"x\\" ]}"}',
    '[{"a":"x"},{"a":"y"}]',
    JSON.stringify({ slides: Array.from({ length: 12 }, (_, i) => ({ layout: "bullets", title: `Sarlavha ${i} "qo‘sh" , {qavs}`, bullets: ["a,b", "c]d", 'e"f'] })) }),
  ];
  for (const d of docs) {
    const r = rewriteLenient(d, 0);
    assert.ok(r, d.slice(0, 40));
    assert.equal(r.incomplete, false);
    assert.deepEqual(r.repairs, [], d.slice(0, 40));
    assert.deepEqual(JSON.parse(r.text), JSON.parse(d));
    assert.deepEqual(parseLlmJsonDetailed(d)?.repairs, []);
  }
});

test("prose with its own brackets before the JSON is the documented ambiguity (first bracket wins, as before)", () => {
  // Not a regression: the old parser also started at the first `[`. Pinned so a change is deliberate.
  assert.deepEqual(parseLlmJson('Slaydlar [1] uchun:\n{"slides":[]}'), [1]);
});

/* ───────────────────────── 3. slide wrapper shapes ───────────────────────── */

test("slideListOf: asked shape, bare array, duplicated answer, lone slide", () => {
  const s1 = { layout: "title", title: "A" };
  const s2 = { layout: "bullets", title: "B" };
  assert.deepEqual(slideListOf({ slides: [s1, s2] }), [s1, s2]);
  assert.deepEqual(slideListOf([s1, s2]), [s1, s2]);
  assert.deepEqual(slideListOf([{ slides: [s1] }, { slides: [s2] }]), [s1], "several wrapped answers: the first one");
  assert.deepEqual(slideListOf(s1), [s1]);
  assert.equal(slideListOf({ foo: 1 }), null);
  assert.equal(slideListOf(null), null);
  assert.equal(slideListOf("x"), null);
});

const footer = "Test · 2026";
const rules = bodyRules(extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi" }), "lecture");
const raw = (n: number) => ({ layout: "bullets", title: `Slayd ${n}`, bullets: [`A${n}`, `B${n}`] });

test("extractNewSlides: NDJSON, bare array and duplicated answer all yield the slides", () => {
  const objs = [raw(1), raw(2), raw(3)];
  const titles = (text: string) => extractNewSlides(text, 0, footer, rules, { final: true }).map((x) => x.slide.title);
  assert.deepEqual(titles(objs.map((o) => JSON.stringify(o)).join("\n")), ["Slayd 1", "Slayd 2", "Slayd 3"], "NDJSON");
  assert.deepEqual(titles(JSON.stringify(objs)), ["Slayd 1", "Slayd 2", "Slayd 3"], "bare array");
  const dup = JSON.stringify({ slides: objs });
  assert.deepEqual(titles(`${dup}\n${dup}`), ["Slayd 1", "Slayd 2", "Slayd 3"], "duplicated answer, no double slides");
  const cut = extractNewSlides(dup.slice(0, -3), 0, footer, rules, { final: false }).map((x) => x.slide.title);
  assert.deepEqual(cut, ["Slayd 1", "Slayd 2"], "a cut answer still honours the live-stream rule (last element not ready)");
});

/* ───────────────────────── 4. the retry ───────────────────────── */

type Seen = { url: string; body: { system_instruction?: { parts?: { text?: string }[] }; generationConfig: { responseMimeType?: string; responseSchema?: unknown } } };

const enc = new TextEncoder();
const sseBody = (text: string, finishReason = "STOP") => {
  const chunks = [text.slice(0, Math.floor(text.length / 2)), text.slice(Math.floor(text.length / 2))];
  let i = 0;
  const payloads = chunks.map((t, k) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, ...(k === chunks.length - 1 ? { finishReason } : {}) }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 * (k + 1) } })}\n\n`);
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < payloads.length) c.enqueue(enc.encode(payloads[i++]));
      else c.close();
    },
  });
};
const streamReply = (text: string, finishReason?: string) => ({ ok: true, status: 200, body: sseBody(text, finishReason), json: async () => ({}) });
const plainReply = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 300 } }),
});

async function withGemini(reply: (seen: Seen, index: number) => unknown, fn: (seen: Seen[], logs: string[]) => Promise<void>): Promise<void> {
  resetBreakers();
  resetLimiters();
  resetFailureCounters();
  const saved = { fetch: globalThis.fetch, warn: console.warn, log: console.log, g: process.env.GEMINI_API_KEY, s: process.env.LLM_STREAM };
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.LLM_STREAM;
  const seen: Seen[] = [];
  const logs: string[] = [];
  console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const s = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) } as Seen;
    seen.push(s);
    return reply(s, seen.length - 1) as never;
  }) as unknown as typeof fetch;
  try {
    await fn(seen, logs);
  } finally {
    globalThis.fetch = saved.fetch;
    console.warn = saved.warn;
    console.log = saved.log;
    for (const [k, v] of [["GEMINI_API_KEY", saved.g], ["LLM_STREAM", saved.s]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const schemaMarker = { type: "OBJECT", properties: { marker: { type: "STRING" } } };
const sysOf = (s: Seen) => String(s.body.system_instruction?.parts?.[0]?.text ?? "");

test("retry: an unrepairable stream answer is retried NON-streaming in JSON mode with the schema and the reminder", async () => {
  await withGemini(
    (_s, i) => (i === 0 ? streamReply("Kechirasiz, bu so‘rovni bajara olmayman.") : plainReply(SLIDES_TEXT)),
    async (seen, logs) => {
      const shown: string[] = [];
      const out = await llmStream("SYS", "USER", 3000, { json: true, retrySchema: schemaMarker, timeoutMs: 20_000, onText: (t) => shown.push(t) });
      assert.equal(out, SLIDES_TEXT);
      assert.equal(seen.length, 2);
      // first attempt: streaming, JSON mime type, NO schema (unchanged behaviour), no reminder
      assert.ok(seen[0].url.includes(":streamGenerateContent"), seen[0].url);
      assert.equal(seen[0].body.generationConfig.responseMimeType, "application/json");
      assert.equal(seen[0].body.generationConfig.responseSchema, undefined);
      assert.ok(!sysOf(seen[0]).includes(STRICT_JSON_REMINDER.trim()));
      // retry: plain generateContent (not streaming), JSON mime type + schema + stricter reminder
      assert.ok(seen[1].url.endsWith(":generateContent"), seen[1].url);
      assert.ok(!seen[1].url.includes("stream"));
      assert.equal(seen[1].body.generationConfig.responseMimeType, "application/json");
      assert.deepEqual(seen[1].body.generationConfig.responseSchema, schemaMarker);
      assert.ok(sysOf(seen[1]).startsWith("SYS") && sysOf(seen[1]).includes(STRICT_JSON_REMINDER.trim()));
      // the live-text callback still receives the final answer
      assert.equal(shown[shown.length - 1], SLIDES_TEXT);
      const lines = logs.filter((l) => l.includes("[llm] attempt failed")).map((l) => JSON.parse(l));
      assert.equal(lines[0]?.kind, "bad_json");
    },
  );
});

test("retry: without a retry schema it is still non-streaming JSON mode (no responseSchema key)", async () => {
  await withGemini(
    (_s, i) => (i === 0 ? streamReply("yo‘q") : plainReply('{"a":1}')),
    async (seen) => {
      assert.equal(await llmStream("S", "U", 1000, { json: true, onText: () => {} }), '{"a":1}');
      assert.ok(seen[1].url.endsWith(":generateContent"));
      assert.equal(seen[1].body.generationConfig.responseMimeType, "application/json");
      assert.ok(!("responseSchema" in seen[1].body.generationConfig));
    },
  );
});

test("a repairable answer needs NO retry; the rescuing strategy is logged without content", async () => {
  const broken = '{"slides":[{"layout":"bullets","title":"Maxfiy-mavzu-QWERTY","notes":"bir\nikki","bullets":["a","b",],}],}';
  await withGemini(
    () => streamReply(broken),
    async (seen, logs) => {
      const out = await llmStream("S", "U", 1000, { json: true, onText: () => {} });
      assert.equal(out, broken);
      assert.equal(seen.length, 1, "no second request: the first answer was repaired");
      const line = logs.map((l) => (l.startsWith("{") ? JSON.parse(l) : null)).find((l) => l?.msg === "[llm] json repaired");
      assert.ok(line, "repair line logged");
      assert.match(String(line.repairs), /control_chars/);
      assert.match(String(line.repairs), /trailing_comma/);
      assert.equal(line.role, "stream");
      assert.ok(!logs.some((l) => l.includes("QWERTY")), "answer text never reaches the log");
      assert.ok(!logs.some((l) => l.includes("attempt failed")));
    },
  );
});

test("a clean answer logs no repair line and makes one request", async () => {
  await withGemini(
    () => streamReply(SLIDES_TEXT),
    async (seen, logs) => {
      await llmStream("S", "U", 1000, { json: true, onText: () => {} });
      assert.equal(seen.length, 1);
      assert.ok(!logs.some((l) => l.includes("json repaired")));
    },
  );
});

test("cost: the failed streamed attempt AND the retry are both counted", async () => {
  await withGemini(
    (_s, i) => (i === 0 ? streamReply("bu JSON emas") : plainReply(SLIDES_TEXT)),
    async () => {
      const { cost } = await withJobCost(async () => llmStream("S", "U", 1000, { json: true, retrySchema: schemaMarker, onText: () => {} }));
      const j = (cost as JobCost).toJson();
      assert.equal(j.calls, 2, "both paid attempts");
      assert.equal(j.inputTokens, 2000, "1000 input tokens per attempt");
      assert.equal(j.outputTokens, 400 + 300, "streamed attempt 400 (cumulative usage), retry 300");
    },
  );
});

test("retry that is still unparseable: the better first answer is kept, both attempts logged and paid", async () => {
  await withGemini(
    (_s, i) => (i === 0 ? streamReply('{"slides":[{"title":"A"},{"title":"B', "MAX_TOKENS") : plainReply("hali ham JSON emas")),
    async (seen, logs) => {
      const { value, cost } = await withJobCost(async () => llmStream("S", "U", 1000, { json: true, onText: () => {} }));
      assert.equal(seen.length, 2);
      assert.equal(value, '{"slides":[{"title":"A"},{"title":"B', "the recoverable first answer wins");
      assert.equal((cost as JobCost).toJson().calls, 2);
      assert.ok(logs.some((l) => l.includes("retry still not parseable JSON")));
    },
  );
});

test("slide end to end: a repairable stream answer produces the deck with ONE request", async () => {
  const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi" });
  const tpl = resolveDeckTemplate(meta);
  const beats: SlideBeat[] = Array.from({ length: 3 }, (_, i) => ({ layout: "bullets" as const, role: `Rol ${i + 1}` }));
  // NDJSON slides with an inner quote, a raw newline and a trailing comma: no wrapper object at all.
  const answer = [1, 2, 3].map((n) => `{"layout":"bullets","title":"Slayd ${n} "qo‘sh" belgisi","notes":"qator\nqator","bullets":["A${n}","B${n}",]}`).join("\n");
  await withGemini(
    () => streamReply(answer),
    async (seen) => {
      const out = await writeSlidesWithLlm(meta, tpl, beats, Date.now() + 120_000, {}, () => {});
      assert.equal(seen.length, 1);
      assert.equal(out?.length, 5, "title + 3 content + closing");
      assert.equal(out?.[1].title, 'Slayd 1 "qo‘sh" belgisi');
      assert.equal(out?.[3].title, 'Slayd 3 "qo‘sh" belgisi');
    },
  );
});

test("slide end to end: unparseable first answer -> schema retry rescues the chunk", async () => {
  const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi" });
  const tpl = resolveDeckTemplate(meta);
  const beats: SlideBeat[] = Array.from({ length: 3 }, (_, i) => ({ layout: "bullets" as const, role: `Rol ${i + 1}` }));
  await withGemini(
    (_s, i) => (i === 0 ? streamReply("Men buni yoza olmayman, kechirasiz.") : plainReply(JSON.stringify({ slides: [raw(1), raw(2), raw(3)] }))),
    async (seen) => {
      const out = await writeSlidesWithLlm(meta, tpl, beats, Date.now() + 120_000, {}, () => {});
      assert.equal(seen.length, 2);
      assert.deepEqual(seen[1].body.generationConfig.responseSchema, deckResponseSchema(), "the slide path passes the deck schema to the retry");
      assert.equal(seen[0].body.generationConfig.responseSchema, undefined);
      assert.deepEqual(out?.slice(1, 4).map((s) => s.title), ["Slayd 1", "Slayd 2", "Slayd 3"]);
    },
  );
});

/* ───────────────────────── 5. SSE assembler ───────────────────────── */

const chunkOf = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

test("SseAssembler: ordinary single-line events pass through", () => {
  const a = new SseAssembler();
  const ev = a.feed(`data: ${JSON.stringify(chunkOf("salom"))}`);
  assert.equal(ev.kind, "text");
  assert.equal(a.feed("").kind, "skip");
  assert.equal(a.feed("data: [DONE]").kind, "skip");
  a.end();
  assert.equal(a.dropped, 0);
});

test("SseAssembler: an event pretty-printed over several data: lines is assembled, not lost", () => {
  const a = new SseAssembler();
  const pretty = JSON.stringify(chunkOf("ko‘p qatorli"), null, 1).split("\n");
  const kinds = pretty.map((line) => a.feed(`data: ${line}`).kind);
  assert.deepEqual(kinds.slice(0, -1).every((k) => k === "skip"), true);
  const last = a.feed("");
  a.end();
  assert.equal(a.dropped, 0);
  assert.ok(kinds[kinds.length - 1] === "text" || last.kind === "text", "text event surfaced when the JSON completed");
});

test("SseAssembler: a chunk that never becomes JSON is dropped and COUNTED; the next event still works", () => {
  const a = new SseAssembler();
  assert.equal(a.feed('data: {"candidates":[{"content"').kind, "skip");
  const next = a.feed(`data: ${JSON.stringify(chunkOf("keyingi"))}`);
  assert.equal(next.kind, "text");
  assert.equal(a.dropped, 1);
  a.feed("data: {broken");
  a.end();
  assert.equal(a.dropped, 2, "unfinished at the end of the stream counts too");
});

/* ───────────────────────── 6. schema mirrors the prompt ───────────────────────── */
/** The slice of a Gemini schema node these tests read (loose on purpose: every access is asserted). */
type Sch = { type: string; properties: Record<string, Sch>; items: Sch; propertyOrdering?: string[]; enum?: string[]; required?: string[] };


function promptSample(): unknown {
  return JSON.parse(deckJsonSchema().replace(/^JSON sxema: /, ""));
}

/** Property names of the prompt sample vs the Gemini schema, recursively. */
function shape(sample: unknown, schema: Sch, path: string): void {
  if (Array.isArray(sample)) {
    assert.equal(schema.type, "ARRAY", path);
    if (sample.length && typeof sample[0] === "object" && sample[0] !== null) shape(sample[0], schema.items, `${path}[]`);
    else assert.ok(schema.items, path);
    return;
  }
  if (sample && typeof sample === "object") {
    assert.equal(schema.type, "OBJECT", path);
    assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(sample).sort(), `${path}: same fields as the prompt`);
    if (schema.propertyOrdering) assert.deepEqual([...schema.propertyOrdering].sort(), Object.keys(sample).sort(), `${path}: ordering lists every field`);
    for (const [k, v] of Object.entries(sample)) shape(v, schema.properties[k], `${path}.${k}`);
    return;
  }
  assert.ok(["STRING", "INTEGER"].includes(schema.type), path);
  assert.equal(schema.type, typeof sample === "number" ? "INTEGER" : "STRING", path);
}

test("deckResponseSchema mirrors deckJsonSchema field by field, layout enum included", () => {
  const schema = deckResponseSchema() as unknown as Sch;
  shape(promptSample(), schema, "$");
  const promptLayouts = ((promptSample() as { slides: { layout: string }[] }).slides[0].layout).split("|");
  assert.deepEqual(schema.properties.slides.items.properties.layout.enum, promptLayouts);
  assert.deepEqual(schema.properties.slides.items.required, ["layout", "title"]);
});

test("inspectJson: clean answers report no repairs; truncated by the limit stays `truncated`", () => {
  assert.deepEqual(inspectJson(SLIDES_TEXT, "STOP"), { quality: "ok", repairs: [] });
  assert.equal(inspectJson('{"slides":[{"title":"A"},', "MAX_TOKENS").quality, "truncated");
  assert.equal(inspectJson('{"slides":[{"title":"A",},],}', "STOP").quality, "ok");
  assert.deepEqual(inspectJson('{"slides":[{"title":"A",},],}', "STOP").repairs, ["trailing_comma"]);
});
