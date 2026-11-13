import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { DomlaChat } from "../../components/domla/DomlaChat.tsx";
import { DomlaPage } from "../../components/domla/DomlaPage.tsx";

/**
 * «Qattiqqo'l domla» web chat (owner decision 2026-11-13): bubbles from the polled state (question + voice player,
 * the student's text / voice answer, score + verdict, «Domla tinglayapti…»), the text composer, the mic (hidden where
 * MediaRecorder is missing; records and uploads multipart where it exists), «Botda davom etish» (channel API; the
 * link-Telegram hint without Telegram), the final grade, and the page's moves (`?davom=web`, «Saytda davom etish»).
 * Mutations are listed in the commit message.
 */

const realFetch = globalThis.fetch;
const w = window as unknown as Record<string, unknown>;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  delete w.MediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const SID = "11111111-2222-4333-8444-555555555555";
const Q = [
  { idx: 0, text: "Nega fotosintez faqat yorug'likda ketadi?", audio: true },
  { idx: 1, text: "Xlorofill nima?", audio: false },
];
const BASE_CHAT = {
  id: SID,
  status: "active",
  topic: "Fotosintez",
  grade: null,
  channel: "web",
  progress: { answered: 1, total: 5 },
  results: [],
  weakest: null,
  asked: Q,
  answers: [{ idx: 0, via: "voice", transcript: "Chunki xlorofill", score: 3, verdict: "Qisman to'g'ri" }],
  waiting: 1,
  scoring: false,
  notice: null,
};

type Call = { url: string; method: string; body: unknown };
/** Routes by URL; `chat` may be a function so a test can change the state after a POST. */
function stub(opts: { chat?: unknown | (() => unknown); page?: unknown; post?: (c: Call) => Response } = {}): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const c: Call = { url: String(input), method: (init.method ?? "GET").toUpperCase(), body: init.body ?? null };
    calls.push(c);
    if (c.method === "POST") return opts.post ? opts.post(c) : json(200, { ok: true });
    if (/\/audio\/\d+$/.test(c.url)) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    if (c.url.startsWith("/api/domla/sessions/")) return json(200, typeof opts.chat === "function" ? (opts.chat as () => unknown)() : (opts.chat ?? BASE_CHAT));
    return json(200, opts.page);
  }) as typeof fetch;
  return calls;
}
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const chat = (props: Partial<{ telegramLinked: boolean; onBot: () => void; onAgain: () => void }> = {}) =>
  h(DomlaChat, { sessionId: SID, telegramLinked: true, onBot: () => {}, onAgain: () => {}, ...props });

test("bubbles: the asked questions (with the voice player), the scored answer with score and verdict; nothing else", async () => {
  stub();
  render(chat());
  await waitFor(() => assert.ok(q("[data-domla-chat]")));
  assert.equal(all("[data-domla-question]").length, 2);
  assert.match(q('[data-domla-question="0"]')!.textContent!, /Savol 1\/5.*Nega fotosintez/);
  await waitFor(() => assert.ok(q('[data-domla-voice="0"]'), "the voice of question 1 is playable"));
  assert.ok(!q('[data-domla-voice="1"]'), "no player without a stored voice");
  assert.match(q('[data-domla-answer="0"]')!.textContent!, /🎤 Ovozli javob.*«Chunki xlorofill»/);
  assert.match(q('[data-domla-score="0"]')!.textContent!, /3\/5 — Hm… qisman to'g'ri\.\s*Qisman to'g'ri/);
  assert.equal(q("[data-domla-progress]")!.textContent, "1/5");
  assert.ok(!q("[data-domla-listening]") && !q("[data-domla-final]"));
});

test("a typed answer is posted as JSON to the answer route, echoed, and the field clears", async () => {
  let answered = false;
  const calls = stub({
    chat: () => (answered ? { ...BASE_CHAT, waiting: null, scoring: true } : BASE_CHAT),
    post: () => {
      answered = true;
      return json(200, { ok: true, idx: 1 });
    },
  });
  render(chat());
  await waitFor(() => assert.ok(q("[data-domla-text]")));
  fireEvent.change(q("[data-domla-text]")!, { target: { value: "  Yashil pigment  " } });
  fireEvent.click(q("[data-domla-send]")!);
  await waitFor(() => assert.ok(q("[data-domla-listening]"), "«Domla tinglayapti…» while scoring"));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, `/api/domla/sessions/${SID}/answer`);
  assert.deepEqual(JSON.parse(String(post.body)), { text: "Yashil pigment" });
  assert.match(q('[data-domla-answer-pending="1"]')!.textContent!, /Yashil pigment/);
  assert.equal((q("[data-domla-text]") as HTMLTextAreaElement).value, "");
});

test("a refused answer shows the server's message and keeps the text", async () => {
  stub({ post: () => json(409, { error: "Domla oldingi javobingizni hali tinglayapti. Biroz kuting.", code: "busy" }) });
  render(chat());
  await waitFor(() => assert.ok(q("[data-domla-text]")));
  fireEvent.change(q("[data-domla-text]")!, { target: { value: "javob" } });
  fireEvent.keyDown(q("[data-domla-text]")!, { key: "Enter" });
  await waitFor(() => assert.match(q("[data-domla-chat-error]")!.textContent!, /hali tinglayapti/));
  assert.equal((q("[data-domla-text]") as HTMLTextAreaElement).value, "javob");
});

test("no MediaRecorder (old Telegram WebView): no mic, the text composer stays", async () => {
  stub();
  render(chat());
  await waitFor(() => assert.ok(q("[data-domla-composer]")));
  assert.ok(!q("[data-domla-mic]"), "mic hidden");
  assert.ok(q("[data-domla-send]") && q("[data-domla-text]"));
});

test("with MediaRecorder: tap the mic, the seconds run, ■ uploads the voice as multipart to the answer route", async () => {
  const tracks: { stopped: boolean }[] = [];
  class FakeRecorder {
    static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
    state = "inactive";
    mimeType: string;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_s: unknown, o: { mimeType?: string }) {
      this.mimeType = o.mimeType ?? "";
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9])], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  w.MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: async () => ({
        getTracks: () => {
          const t = { stopped: false, stop: () => (t.stopped = true) };
          tracks.push(t);
          return [t];
        },
      }),
    },
    configurable: true,
  });
  const calls = stub({ post: () => json(200, { ok: true, idx: 1 }) });
  render(chat());
  await waitFor(() => assert.ok(q("[data-domla-mic]")));
  assert.ok(!q("[data-domla-send]"), "an empty field shows the mic instead of send");
  await act(async () => {
    fireEvent.click(q("[data-domla-mic]")!);
  });
  await waitFor(() => assert.ok(q("[data-domla-recording]")));
  assert.match(q("[data-domla-rec-seconds]")!.textContent!, /^0:00 \/ 2:00$/);
  await act(async () => {
    fireEvent.click(q("[data-domla-rec-stop]")!);
  });
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, `/api/domla/sessions/${SID}/answer`);
  assert.ok(post.body instanceof FormData, "multipart");
  const audio = (post.body as FormData).get("audio") as Blob;
  assert.equal(audio.size, 5);
  assert.equal(audio.type, "audio/webm;codecs=opus");
  assert.ok(Number((post.body as FormData).get("seconds")) >= 0);
  assert.ok(tracks.length > 0 && tracks.every((t) => t.stopped), "the microphone is released");
  await waitFor(() => assert.match(q('[data-domla-answer-pending="1"]')!.textContent!, /Ovozli javob/));
});

test("«Botda davom etish» posts channel=bot and hands over to the bot card", async () => {
  let toBot = 0;
  const calls = stub();
  render(chat({ onBot: () => toBot++ }));
  await waitFor(() => assert.ok(q("[data-domla-to-bot]")));
  fireEvent.click(q("[data-domla-to-bot]")!);
  await waitFor(() => assert.equal(toBot, 1));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, `/api/domla/sessions/${SID}/channel`);
  assert.deepEqual(JSON.parse(String(post.body)), { channel: "bot" });
});

test("«Botda davom etish» without Telegram: the link-Telegram hint, no API call", async () => {
  const calls = stub();
  render(chat({ telegramLinked: false }));
  await waitFor(() => assert.ok(q("[data-domla-to-bot]")));
  fireEvent.click(q("[data-domla-to-bot]")!);
  await waitFor(() => assert.match(q("[data-domla-no-telegram]")!.textContent!, /Telegram akkauntini bog‘lang/));
  assert.ok(!calls.some((c) => c.method === "POST"));
});

test("finished: the grade, the results and the weakest question with its right answer; no composer", async () => {
  let again = 0;
  stub({
    chat: {
      ...BASE_CHAT,
      status: "finished",
      grade: 4,
      waiting: null,
      progress: { answered: 5, total: 5 },
      results: [
        { question: "Nega yorug'lik?", score: 5, verdict: "" },
        { question: "Xlorofill nima?", score: 2, verdict: "" },
      ],
      weakest: { question: "Xlorofill nima?", mistake: "Pigment ekanini aytmadingiz", ideal: "Yashil pigment." },
    },
  });
  render(chat({ onAgain: () => again++ }));
  await waitFor(() => assert.ok(q("[data-domla-final]")));
  assert.equal(q("[data-domla-final-grade]")!.textContent, "4");
  assert.match(q("[data-domla-final]")!.textContent!, /Domla senga 4 qo'ydi/);
  assert.match(q("[data-domla-weakest]")!.textContent!, /Xlorofill nima\? — Pigment ekanini aytmadingiz.*To‘g‘ri javob: Yashil pigment\./);
  assert.ok(!q("[data-domla-composer]") && !q("[data-domla-to-bot]"));
  fireEvent.click(q("[data-domla-again]")!);
  assert.equal(again, 1);
});

test("a notice from the server (voice not heard) is shown while the defence is open", async () => {
  stub({ chat: { ...BASE_CHAT, notice: "Domla javobingizni eshita olmadi." } });
  render(chat());
  await waitFor(() => assert.match(q("[data-domla-notice]")!.textContent!, /eshita olmadi/));
});

test("the bot moved the defence (an answer sent in the bot): the chat hands over to the bot card", async () => {
  let toBot = 0;
  stub({ chat: { ...BASE_CHAT, channel: "bot" } });
  render(chat({ onBot: () => toBot++ }));
  await waitFor(() => assert.equal(toBot, 1));
});

test("a new question scrolls the composer into view (not on the first load)", async () => {
  const proto = (window as unknown as { HTMLElement: { prototype: Record<string, unknown> } }).HTMLElement.prototype;
  const had = proto.scrollIntoView;
  let scrolled = 0;
  proto.scrollIntoView = () => void scrolled++;
  try {
    let answered = false;
    stub({
      chat: () => (answered ? { ...BASE_CHAT, asked: [...Q, { idx: 2, text: "Uchinchi savol matni?", audio: false }], waiting: 2 } : BASE_CHAT),
      post: () => {
        answered = true;
        return json(200, { ok: true, idx: 1 });
      },
    });
    render(chat());
    await waitFor(() => assert.ok(q("[data-domla-text]")));
    assert.equal(scrolled, 0, "the first load does not jump");
    fireEvent.change(q("[data-domla-text]")!, { target: { value: "javob" } });
    fireEvent.click(q("[data-domla-send]")!);
    await waitFor(() => assert.ok(q('[data-domla-question="2"]')));
    assert.equal(scrolled, 1);
  } finally {
    proto.scrollIntoView = had;
  }
});

/* ───────────────────────── the page ───────────────────────── */

const WORKS = [{ id: "w-1", toolId: "slide", topic: "Fotosintez", slides: 8, createdAt: "2026-10-20T10:00:00Z" }];
const PAGE = { enabled: true, price: 3000, telegramLinked: true, botUrl: "https://t.me/slaydx_test_bot", works: WORKS, history: [] };
const OPEN = { id: SID, status: "active", topic: "Fotosintez", grade: null, createdAt: "2026-11-13T10:00:00Z", progress: { answered: 1, total: 5 }, results: [], weakest: null };

test("page: an open WEB defence opens straight into the chat", async () => {
  stub({ page: { ...PAGE, open: { ...OPEN, channel: "web" } } });
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-chat]")));
  assert.ok(!q("[data-domla-open]"));
});

test("page: a BOT defence shows its card; «Saytda davom etish» moves it here (channel=web) and opens the chat", async () => {
  const calls = stub({ page: { ...PAGE, open: { ...OPEN, channel: "bot" } } });
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-to-web]")));
  assert.ok(q("[data-domla-bot-link]"));
  fireEvent.click(q("[data-domla-to-web]")!);
  await waitFor(() => assert.ok(q("[data-domla-chat]")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, `/api/domla/sessions/${SID}/channel`);
  assert.deepEqual(JSON.parse(String(post.body)), { channel: "web" });
});

test("page: the bot's «Saytda davom etish» link (?davom=web) moves the defence on load and drops the parameter", async () => {
  window.history.replaceState(null, "", "/uz/domla?davom=web");
  const calls = stub({ page: { ...PAGE, open: { ...OPEN, channel: "bot" } } });
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-chat]")));
  assert.deepEqual(JSON.parse(String(calls.find((c) => c.method === "POST")!.body)), { channel: "web" });
  assert.equal(window.location.search, "", "the parameter is consumed");
  window.history.replaceState(null, "", "/");
});
