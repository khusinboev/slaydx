import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MediaComposer } from "../../components/forms/MediaComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import { audioParamsOf } from "../../lib/generation/audio-params.ts";

/**
 * Media formasi (Formalar 3 / AUDIT-24, WP-D2a) — podkast va tabriknoma
 * bitta `MediaComposer`da. `tests/ui/essay-composer.test.mts` naqshi.
 *
 * Qulflanadigan qoidalar:
 *   • QAMROV — har `AUDIO_PARAMS.id` (o'z kind'i bo'yicha) formada
 *     `data-field` bilan chizilgan («bezak maydon yo'q»);
 *   • podkast rejimi (mavzu/matn/fayl) bittasini ko'rsatadi, qolganini
 *     yashiradi;
 *   • standart chiplar reyestrdan (`audioDefaultTypeId`);
 *   • davomiylik slayder — `data-range-value` yangilanadi, narx
 *     O'ZGARMAYDI (tekis 4 000);
 *   • Sozlamalar yopiq keladi;
 *   • submit tanasida kind'ga mos kalitlar;
 *   • `ToolWorkspace` dispatch (`custom: "media"`).
 *
 * Mutatsiyalar (qo'lda tekshirildi): `AUDIO_PARAMS`ga qamrov testidan
 * tashqarida maydon qo'shilsa yoki formadan `data-field` olib tashlansa
 * — QAMROV testi qizaradi; `RangeRow`ga narxni davomiylikdan hisoblab
 * uzatilsa — «narx davomiylikka bog'liq emas» testi qizaradi.
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const podcastTool = TOOL_BY_ID.podcast;
const greetingTool = TOOL_BY_ID.greeting;

type Call = { url: string; method: string; body?: unknown };
function stubApi(toolId: string, draft: Record<string, unknown> | null = null) {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (url === `/api/forms/${toolId}/draft` && method === "GET") return json(200, { draft: draft ? { data: draft, updatedAt: "now" } : null });
    if (url === `/api/forms/${toolId}/draft`) return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "66666666-6666-4666-8666-666666666666", price: 4000 });
    if (url === "/api/users/me") return json(200, { ok: true });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
}

function mount(tool: typeof podcastTool) {
  render(h(AppRouterContext.Provider, { value: router }, h(MediaComposer, { tool })));
}

const field = (id: string) => document.querySelector(`[data-field="${id}"]`);
const chips = (id: string) => [...document.querySelectorAll(`[data-field="${id}"] button`)] as HTMLButtonElement[];
const chipText = (id: string) => chips(id).map((b) => b.textContent?.trim() ?? "");
const checked = (id: string) => chips(id).find((b) => b.getAttribute("aria-checked") === "true")?.textContent?.trim() ?? "";
const selectValue = (id: string) => (field(id)?.querySelector("select") as HTMLSelectElement | null)?.value ?? "";

async function pick(id: string, re: RegExp) {
  const btn = chips(id).find((b) => re.test(b.textContent ?? ""));
  assert.ok(btn, `«${re}» tugmasi topilmadi (${id}): ${chipText(id).join(" | ")}`);
  await act(async () => {
    fireEvent.click(btn!);
  });
}

/* ══════════════════════════════ qamrov ══════════════════════════════ */

test("QAMROV (podkast): har `AUDIO_PARAMS` id (kind=podcast) formada `data-field` bilan — uch rejim bo'ylab", async () => {
  stubApi("podcast");
  await login();
  mount(podcastTool);
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });

  const seen = new Set<string>();
  const collect = () => {
    for (const el of document.querySelectorAll("[data-field]")) {
      const id = el.getAttribute("data-field");
      if (id) seen.add(id);
    }
  };
  collect(); // mode=topic
  await pick("mode", /^Matn$/);
  collect(); // mode=text -> sourceText
  await pick("mode", /^Fayl$/);
  collect(); // mode=file -> sourceText (SourceFileRow)

  const known = new Set(audioParamsOf("podcast").map((p) => p.id));
  const missing = [...known].filter((id) => !seen.has(id));
  assert.deepEqual(missing, [], `reyestrdagi maydon formada yo'q: ${missing.join(", ")}`);
  const extra = [...seen].filter((id) => !known.has(id));
  assert.deepEqual(extra, [], `formada reyestrsiz maydon: ${extra.join(", ")}`);
});

test("QAMROV (tabriknoma): har `AUDIO_PARAMS` id (kind=greeting) formada `data-field` bilan", async () => {
  stubApi("greeting");
  await login();
  mount(greetingTool);
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });
  const seen = new Set([...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")).filter(Boolean) as string[]);
  const known = new Set(audioParamsOf("greeting").map((p) => p.id));
  assert.deepEqual([...known].filter((id) => !seen.has(id)), [], "reyestr maydoni yo'q");
  assert.deepEqual([...seen].filter((id) => !known.has(id)), [], "reyestrsiz maydon bor");
});

/* ══════════════════════════════ rejim ══════════════════════════════ */

test("podkast rejimi: mavzu/matn/fayl BITTASINI ko'rsatadi, qolganini yashiradi", async () => {
  stubApi("podcast");
  await login();
  mount(podcastTool);
  assert.ok(screen.getByPlaceholderText(podcastTool.topicPlaceholder!), "topic rejimi — TopicRow");
  assert.ok(!document.querySelector("textarea[aria-label='Manba matni']"), "matn rejimi hali yashirin");

  await pick("mode", /^Matn$/);
  assert.ok(document.querySelector("textarea[aria-label='Manba matni']"), "matn rejimida LimitedTextarea ko'rinadi");
  assert.ok(!screen.queryByPlaceholderText(podcastTool.topicPlaceholder!), "matn rejimida TopicRow yo'q");

  await pick("mode", /^Fayl$/);
  assert.ok(screen.getByLabelText("Fayl"), "fayl rejimida SourceFileRow ko'rinadi");
  assert.ok(!document.querySelector("textarea[aria-label='Manba matni']"), "fayl rejimida matn qutisi yo'q");
});

/*
 * W4-D R2: FE-17 fayldan olingan matnni qoralamaga kiritmaydi (`fileName`
 * bor bo'lsa). Podkastda esa fayl biriktirilgach «Matn» rejimida o'sha
 * matnni TAHRIRLASH mumkin — tahrirlangan matn foydalanuvchiniki va
 * qoralamada qolishi shart (ilgari `fileName` qolib ketib, u tashlanardi).
 */
test("qoralama: fayl matni «Matn» rejimida tahrirlangach qoralamaga KIRADI (fayl havolasi tushadi)", async () => {
  const calls = stubApi("podcast", { mode: "file", fileName: "kitob.docx", sourceText: "Fayldan olingan matn", topic: "Kitob" });
  await login();
  mount(podcastTool);
  await waitFor(() => assert.ok(calls.some((c) => c.method === "GET" && c.url === "/api/forms/podcast/draft")));
  await waitFor(() => assert.ok(screen.getByText("kitob.docx"), "fayl biriktirilgan holda tiklandi"));
  await pick("mode", /^Matn$/);
  const area = document.querySelector("textarea[aria-label='Manba matni']") as HTMLTextAreaElement;
  assert.equal(area.value, "Fayldan olingan matn");
  await act(async () => {
    fireEvent.change(area, { target: { value: "Fayldan olingan matn — va mening qo‘shimcham" } });
  });
  const lastPut = () => calls.filter((c) => c.method === "PUT" && c.url === "/api/forms/podcast/draft").at(-1)?.body as { data?: Record<string, unknown> } | undefined;
  await waitFor(() => assert.equal(lastPut()?.data?.sourceText, "Fayldan olingan matn — va mening qo‘shimcham"), { timeout: 4000 });
  assert.ok(!lastPut()?.data?.fileName, "tahrirlangan matn endi fayl emas — havola olib tashlandi");
});

/* ══════════════════════════════ standartlar ══════════════════════════════ */

test("standart tur/sabab reyestrdan (`audioDefaultTypeId`)", async () => {
  stubApi("podcast");
  await login();
  mount(podcastTool);
  assert.equal(checked("podcastType"), "Mavzu tushuntirish", "standart podkast turi");

  stubApi("greeting");
  cleanup();
  mount(greetingTool);
  assert.equal(selectValue("occasion"), "umumiy", "standart tabriknoma sababi");
});

test("davomiylik slayder: `data-range-value` yangilanadi, narx O'ZGARMAYDI", async () => {
  const calls = stubApi("podcast");
  void calls;
  await login();
  mount(podcastTool);
  const range = field("durationMin")!.querySelector("input[type=range]") as HTMLInputElement;
  assert.equal(field("durationMin")?.querySelector("[data-range-value]")?.textContent, "2 daqiqa", "standart 2 daqiqa");
  const priceBefore = document.querySelector("[data-price-total]")?.textContent;
  await act(async () => {
    fireEvent.change(range, { target: { value: "5" } });
  });
  assert.equal(field("durationMin")?.querySelector("[data-range-value]")?.textContent, "5 daqiqa");
  /*
   * MUTATSIYA: `RangeRow`ga `priceFor` o'rniga davomiylikdan hisoblangan
   * narx uzatilsa bu tenglik buziladi — narx reyestr qoidasi bo'yicha
   * (egasi qarori 6) davomiylikka BOG'LIQ EMAS.
   */
  assert.equal(document.querySelector("[data-price-total]")?.textContent, priceBefore, "narx davomiylikdan o'zgarmadi");
  assert.match(document.querySelector("[data-price-rule]")?.textContent ?? "", /bog['‘]liq emas/);
});

test("tur almashsa narx bir xil qoladi (tekis 4 000)", async () => {
  stubApi("podcast");
  await login();
  mount(podcastTool);
  assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /4\s?000/);
  await pick("podcastType", /Intervyu/i);
  assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /4\s?000/);
});

/* ══════════════════════════════ Sozlamalar ══════════════════════════════ */

test("Sozlamalar YOPIQ keladi (`<details>` open emas)", async () => {
  stubApi("podcast");
  await login();
  mount(podcastTool);
  const details = document.querySelector("details[data-settings]") as HTMLDetailsElement;
  assert.ok(details, "SettingsDetails chizilgan");
  assert.equal(details.open, false);
});

/* ══════════════════════════════ submit ══════════════════════════════ */

test("podkast submit: tanasida topic/mode/podcastType/durationMin/language/extra", async () => {
  const calls = stubApi("podcast");
  await login();
  mount(podcastTool);
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(podcastTool.topicPlaceholder!), { target: { value: "Sun'iy intellekt darsda" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(podcastTool.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const post = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!;
  const body = post.body as { slug: string; values: Record<string, unknown> };
  assert.equal(body.slug, "podcast");
  assert.equal(body.values.topic, "Sun'iy intellekt darsda");
  assert.equal(body.values.mode, "topic");
  assert.equal(body.values.podcastType, "tushuntirish");
  assert.equal(body.values.durationMin, 2);
  assert.equal(body.values.language, "uz");
  await waitFor(() => assert.ok(pushes.some((u) => u.includes("/uz/files/"))));
});

test("podkast submit: mavzusiz `topic` rejimida rad etiladi", async () => {
  const calls = stubApi("podcast");
  await login();
  mount(podcastTool);
  await act(async () => {
    fireEvent.click(screen.getByText(podcastTool.submitLabel));
  });
  assert.equal(calls.filter((c) => c.url === "/api/generations").length, 0, "so'rov yuborilmadi");
  assert.ok(screen.getByText(/Mavzuni kiriting/));
});

test("tabriknoma submit: tanasida recipient/relation/occasion/durationMin", async () => {
  const calls = stubApi("greeting");
  await login();
  mount(greetingTool);
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("Dilnoza opa"), { target: { value: "Malika opa" } });
  });
  await pick("relation", /Ustozim/i);
  await act(async () => {
    fireEvent.click(screen.getByText(greetingTool.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const body = (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, unknown> }).values;
  assert.equal(body.recipient, "Malika opa");
  assert.equal(body.relation, "ustozim");
  assert.equal(body.occasion, "umumiy");
  assert.equal(body.durationMin, 1);
});

test("tabriknoma «Kim bo‘ladi»: «Boshqa» erkin matn maydonini ochadi", async () => {
  stubApi("greeting");
  await login();
  mount(greetingTool);
  assert.ok(!field("relation")?.querySelector("input[type=text], input:not([type])"), "boshlanishda erkin matn yopiq");
  await pick("relation", /^Boshqa$/);
  const input = field("relation")!.querySelector("input") as HTMLInputElement;
  assert.ok(input, "«Boshqa» tanlansa matn maydoni chiqadi");
  await act(async () => {
    fireEvent.change(input, { target: { value: "qo'shnim" } });
  });
  assert.equal(input.value, "qo'shnim");
});

/* ══════════════════════════════ dispatch ══════════════════════════════ */

test("vosita sahifasi podkast/tabriknoma uchun `MediaComposer` chizadi (`custom: media` dispatch)", async () => {
  stubApi("podcast");
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
  render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool: podcastTool })));
  await waitFor(() => assert.ok(document.querySelectorAll("[data-field]").length >= 5, "yangi formaning maydonlari"));
  assert.equal(TOOL_BY_ID.podcast.custom, "media");
  assert.equal(TOOL_BY_ID.greeting.custom, "media");
});

/* ══════════════════════════════ voice choice (female / male) ══════════════════════════════ */

/*
 * The `voice` field (both forms): two cards «👩 Ayol ovozi» / «👨 Erkak ovozi», female
 * selected by default, each with a ▶︎ sample button. jsdom has no media pipeline, so
 * `HTMLMediaElement.prototype.play/pause` are stubbed and record WHICH file was asked
 * to play. Mutations (hand-checked, see the PR description):
 *   1. a card plays the other card's file        -> "▶︎ plays the right file";
 *   2. starting one sample does not stop the other -> "one sample at a time";
 *   3. the form never posts `voice`               -> "value posted".
 */

let restoreMedia: (() => void) | null = null;
afterEach(() => {
  restoreMedia?.();
  restoreMedia = null;
});

function stubMedia(opts: { rejectPlay?: boolean } = {}) {
  const proto = window.HTMLMediaElement.prototype as unknown as { play: () => Promise<void>; pause: () => void };
  const orig = { play: proto.play, pause: proto.pause };
  const log = { played: [] as string[], paused: [] as string[] };
  proto.play = function (this: HTMLMediaElement) {
    log.played.push(this.getAttribute("src") ?? "");
    this.dispatchEvent(new window.Event("play"));
    return opts.rejectPlay ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
  };
  proto.pause = function (this: HTMLMediaElement) {
    log.paused.push(this.getAttribute("src") ?? "");
    this.dispatchEvent(new window.Event("pause"));
  };
  restoreMedia = () => {
    proto.play = orig.play;
    proto.pause = orig.pause;
  };
  return log;
}

const radios = () => [...(field("voice")?.querySelectorAll('[role="radio"]') ?? [])] as HTMLButtonElement[];
const sampleBtn = (v: "female" | "male") => document.querySelector(`[data-voice-sample="${v}"]`) as HTMLButtonElement;
const sampleAudio = (v: "female" | "male") => document.querySelector(`[data-voice-audio="${v}"]`) as HTMLAudioElement;
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

for (const [name, tool] of [["podcast", podcastTool], ["greeting", greetingTool]] as const) {
  test(`voice (${name}): two options, female selected by default, a labeled ▶︎ button each, nothing plays on its own`, async () => {
    const media = stubMedia();
    stubApi(tool.id);
    await login();
    mount(tool);

    assert.equal(document.querySelectorAll('[data-field="voice"]').length, 1, "exactly one voice field");
    assert.ok(field("voice")?.querySelector('[role="radiogroup"][aria-label="Ovoz"]'));
    assert.deepEqual(radios().map((r) => r.textContent?.trim()), ["👩 Ayol ovozi", "👨 Erkak ovozi"]);
    assert.deepEqual(radios().map((r) => r.getAttribute("aria-checked")), ["true", "false"], "female is the default");

    // Accessible label of the sample buttons.
    const play = screen.getAllByRole("button", { name: "Namunani tinglash" });
    assert.equal(play.length, 2);

    // No autoplay: the files are not even requested until a tap, and nothing was played.
    for (const v of ["female", "male"] as const) {
      assert.equal(sampleAudio(v).getAttribute("preload"), "none");
      assert.ok(!sampleAudio(v).hasAttribute("autoplay"));
    }
    assert.deepEqual(media.played, []);
  });

  test(`voice (${name}): ▶︎ plays the RIGHT file, one sample at a time, pressing again stops`, async () => {
    const media = stubMedia();
    stubApi(tool.id);
    await login();
    mount(tool);

    // Each card carries its own file (a swapped pair would play the male voice for «Ayol»).
    assert.equal(sampleAudio("female").getAttribute("src"), "/audio/voices/female.mp3");
    assert.equal(sampleAudio("male").getAttribute("src"), "/audio/voices/male.mp3");
    assert.ok(document.querySelector('[data-voice-option="female"]')?.contains(sampleBtn("female")));
    assert.ok(document.querySelector('[data-voice-option="male"]')?.contains(sampleBtn("male")));

    await click(sampleBtn("female"));
    assert.deepEqual(media.played, ["/audio/voices/female.mp3"]);
    assert.equal(sampleBtn("female").getAttribute("aria-pressed"), "true");
    assert.equal(sampleBtn("male").getAttribute("aria-pressed"), "false");

    // Starting the other one silences the first.
    await click(sampleBtn("male"));
    assert.deepEqual(media.played, ["/audio/voices/female.mp3", "/audio/voices/male.mp3"]);
    assert.ok(media.paused.includes("/audio/voices/female.mp3"), "the female sample must be paused when the male one starts");
    assert.equal(sampleBtn("female").getAttribute("aria-pressed"), "false");
    assert.equal(sampleBtn("male").getAttribute("aria-pressed"), "true");

    // Pressing the playing one again stops it (and does not restart it).
    const playedBefore = media.played.length;
    await click(sampleBtn("male"));
    assert.equal(media.played.length, playedBefore, "second press must stop, not play again");
    assert.equal(media.paused.at(-1), "/audio/voices/male.mp3");
    assert.equal(sampleBtn("male").getAttribute("aria-pressed"), "false");

    // The sample ending on its own releases the button.
    await click(sampleBtn("female"));
    assert.equal(sampleBtn("female").getAttribute("aria-pressed"), "true");
    await act(async () => {
      sampleAudio("female").dispatchEvent(new window.Event("ended"));
    });
    assert.equal(sampleBtn("female").getAttribute("aria-pressed"), "false");
  });

  test(`voice (${name}): choosing a card does not play, playing a sample does not choose`, async () => {
    const media = stubMedia();
    stubApi(tool.id);
    await login();
    mount(tool);

    await click(radios()[1]!);
    assert.deepEqual(radios().map((r) => r.getAttribute("aria-checked")), ["false", "true"]);
    assert.deepEqual(media.played, [], "selecting must not play");

    await click(sampleBtn("female"));
    assert.deepEqual(radios().map((r) => r.getAttribute("aria-checked")), ["false", "true"], "▶︎ must not change the selection");
  });

  test(`voice (${name}): a refused/missing sample leaves a short note and a usable form`, async () => {
    stubMedia({ rejectPlay: true });
    stubApi(tool.id);
    await login();
    mount(tool);
    await click(sampleBtn("male"));
    await waitFor(() => assert.ok(screen.getByRole("status")));
    assert.match(screen.getByRole("status").textContent ?? "", /Namunani yuklab bo‘lmadi/);
    assert.equal(sampleBtn("male").getAttribute("aria-pressed"), "false");
    await click(radios()[1]!);
    assert.equal(radios()[1]!.getAttribute("aria-checked"), "true", "the voice can still be chosen");
  });

  test(`voice (${name}): leaving the form silences a playing sample`, async () => {
    const media = stubMedia();
    stubApi(tool.id);
    await login();
    mount(tool);
    await click(sampleBtn("female"));
    const before = media.paused.length;
    cleanup();
    assert.ok(media.paused.length > before, "unmount must pause the sample");
  });

  test(`voice (${name}): the chosen voice is POSTED (default female, male after choosing it)`, async () => {
    stubMedia();
    for (const choose of [null, "male"] as const) {
      cleanup();
      const calls = stubApi(tool.id);
      await login();
      mount(tool);
      if (tool.id === "podcast") {
        await act(async () => {
          fireEvent.change(screen.getByPlaceholderText(podcastTool.topicPlaceholder!), { target: { value: "Sun'iy intellekt darsda" } });
        });
      } else {
        await act(async () => {
          fireEvent.change(screen.getByPlaceholderText("Dilnoza opa"), { target: { value: "Malika opa" } });
        });
      }
      if (choose) await click(radios()[1]!);
      await act(async () => {
        fireEvent.click(screen.getByText(tool.submitLabel));
      });
      await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
      const body = (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, unknown> }).values;
      assert.equal(body.voice, choose ?? "female", `${name}: posted voice`);
    }
  });

  test(`voice (${name}): the draft restores a chosen voice; an old draft without the field reads as female`, async () => {
    stubMedia();
    const seed = tool.id === "podcast" ? { topic: "Mavzu" } : { recipient: "Malika opa" };
    stubApi(tool.id, { ...seed, voice: "male" });
    await login();
    mount(tool);
    await waitFor(() => assert.equal(radios()[1]!.getAttribute("aria-checked"), "true"));

    cleanup();
    stubApi(tool.id, seed);
    mount(tool);
    // Give the (empty-voice) draft time to apply, then check the default held.
    await waitFor(() => assert.ok(document.querySelector("[data-field]")));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    assert.equal(radios()[0]!.getAttribute("aria-checked"), "true");
  });

  test(`voice (${name}): 44 px touch targets on a coarse pointer`, async () => {
    stubMedia();
    stubApi(tool.id);
    await login();
    mount(tool);
    const TOUCH = /(?:^|\s)pointer-coarse:(?:min-h-11|h-11|size-11)(?:\s|$)/;
    for (const r of radios()) assert.match(r.getAttribute("class") ?? "", TOUCH, "radio card");
    for (const v of ["female", "male"] as const) assert.match(sampleBtn(v).getAttribute("class") ?? "", TOUCH, "sample button");
  });
}

test("voice hint follows the format: a dialog podcast says the choice decides who leads", async () => {
  stubMedia();
  stubApi("podcast");
  await login();
  mount(podcastTool);
  assert.match(document.querySelector("[data-voice-hint]")?.textContent ?? "", /Butun podkast shu ovozda/, "default type is a monologue");
  await pick("podcastType", /Intervyu/i);
  assert.match(document.querySelector("[data-voice-hint]")?.textContent ?? "", /Ikki ovozli turda tanlangan ovoz suhbatni boshlaydi/);

  cleanup();
  stubApi("greeting");
  mount(greetingTool);
  assert.match(document.querySelector("[data-voice-hint]")?.textContent ?? "", /Butun tabrik shu ovozda/);
});

test("voice samples: both files exist, are real MP3 audio, and differ", async () => {
  const { readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { AUDIO_VOICE_OPTIONS } = await import("../../lib/generation/audio/registry.ts");
  const bytes = AUDIO_VOICE_OPTIONS.map((o) => {
    const file = join(import.meta.dirname, "..", "..", "public", o.sample);
    assert.ok(statSync(file).size > 10_000, `${o.sample}: too small for a ~7 s sample`);
    assert.ok(statSync(file).size < 200_000, `${o.sample}: unexpectedly large for a short 48 kbps sample`);
    const buf = readFileSync(file);
    // MP3: an ID3v2 tag or an MPEG frame sync at the start.
    assert.ok(buf.subarray(0, 3).toString("latin1") === "ID3" || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0), `${o.sample}: not an MP3`);
    return buf;
  });
  assert.ok(!bytes[0]!.equals(bytes[1]!), "the female and male samples must be different recordings");
});
