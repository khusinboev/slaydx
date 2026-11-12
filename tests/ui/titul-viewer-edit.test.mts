import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act, useState } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { TitulViewer } from "../../components/viewers/TitulViewer.tsx";
import { EditActions, type EditActionsState } from "../../components/files/EditActions.tsx";
import { applyTitulOps, type TitulOp } from "../../lib/generation/title-page/edit.ts";
import { titulDoc } from "../../lib/generation/title-page/index.ts";
import { titulInputFromValues } from "../../lib/generation/title-page/input.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * «Titul» viewer editing (jsdom + a `fetch` stub that applies the ops with the SERVER's own `applyTitulOps`):
 * «Tahrirlash» → double click a text → type → Enter puts one op in the queue (no network); «Saqlash» sends one PATCH
 * and rebuilds the file; Esc restores; a blank signature line can be filled in.
 *
 * Mutations (each turned a test red, then restored):
 *   M1. `TitulEditor.commit` does not send the op -> «dblclick → Enter»;
 *   M2. Esc handler commits instead of cancelling -> «Esc cancels»;
 *   M3. `useTitulEdit` `hasModel` always false -> «Tahrirlash» missing («dblclick → Enter»).
 */

const GEN_ID = "gen-t1";
const META = { topic: "Sun'iy intellekt", language: "uz", toolId: "title-page", fileNameHint: "Suniy intellekt" } as unknown as DocMeta;

const makeDoc = (): AcademicDoc =>
  titulDoc(META, {
    input: titulInputFromValues({ topic: "Sun'iy intellekt", faculty: "Kompyuter injiniringi", author: "", supervisor: "Karimov B.", year: 2026 }),
    overrides: {},
  });

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Server = { calls: Call[]; doc: AcademicDoc; version: number };

function generation(s: Server) {
  return { id: GEN_ID, type: "title-page", status: "COMPLETED", doc: s.doc, docVersion: s.version, fileVersion: 1, hasFile: true, hasPrev: false };
}

function stubServer(): Server {
  const s: Server = { calls: [], doc: makeDoc(), version: 1 };
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    s.calls.push({ url, method, body });
    if (method === "PATCH" && url.endsWith("/doc")) {
      const res = applyTitulOps(s.doc, (body?.ops ?? []) as TitulOp[]);
      if (!res.ok) return json(422, { error: res.error, at: res.at });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s) });
    }
    if (method === "POST" && url.endsWith("/rebuild")) return json(200, { fileVersion: s.version, docVersion: s.version, rebuilt: true });
    if (method === "GET") return json(200, { generation: generation(s) });
    return json(404, { error: "yo'q" });
  };
  return s;
}

afterEach(() => cleanup());

const pause = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

function Page({ doc, gen }: { doc: AcademicDoc; gen: unknown }) {
  const [st, setSt] = useState<EditActionsState | null>(null);
  return h("div", null, h(EditActions, { state: st }), h(TitulViewer, { doc, gen, onEditState: setSt }));
}

function openEditor(s: Server) {
  render(h(Page, { doc: s.doc, gen: generation(s) }));
  fireEvent.click(screen.getByText("Tahrirlash"));
}

function byPath(path: string): HTMLElement {
  const el = document.querySelector(`[data-titul-editor] [data-path="${path}"]`);
  assert.ok(el, `«${path}» not found`);
  return el as HTMLElement;
}

function typeInto(el: HTMLElement, text: string) {
  fireEvent.dblClick(el);
  assert.equal(el.getAttribute("contenteditable"), "true", "the run did not open");
  el.textContent = text;
  fireEvent.keyDown(el, { key: "Enter" });
}

const saveBtn = () => screen.queryByText(/^Saqlash · /);

test("dblclick → Enter: one unsaved change on screen, no network; «Saqlash» sends one PATCH and rebuilds", async () => {
  const s = stubServer();
  openEditor(s);
  typeInto(byPath("heading"), "KURS LOYIHASI");
  await pause(0);
  assert.equal(s.calls.length, 0, "network before «Saqlash»");
  assert.ok(screen.getByText("KURS LOYIHASI"));
  const btn = saveBtn();
  assert.ok(btn, "no «Saqlash»");
  assert.match(btn!.textContent ?? "", /· 1\b/);

  await act(async () => {
    fireEvent.click(btn!);
  });
  await pause(20);
  const patches = s.calls.filter((c) => c.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0]!.body?.ops, [{ op: "text", id: "heading", value: "KURS LOYIHASI" }]);
  assert.ok(s.calls.some((c) => c.method === "POST" && c.url.endsWith("/rebuild")), "file not rebuilt");
  assert.equal(s.doc.titul?.overrides.heading, "KURS LOYIHASI", "server doc holds the edit");
});

test("Esc cancels: text and queue unchanged", async () => {
  const s = stubServer();
  openEditor(s);
  const el = byPath("topic.value");
  const before = el.textContent;
  fireEvent.dblClick(el);
  el.textContent = "Boshqa mavzu";
  fireEvent.keyDown(el, { key: "Escape" });
  await pause(0);
  assert.equal(el.textContent, before);
  assert.ok(!saveBtn(), "Esc queued an op");
});

test("a blank signature line can be filled in place", async () => {
  const s = stubServer();
  openEditor(s);
  typeInto(byPath("author.value"), "Valiyev A.");
  await pause(0);
  assert.equal(byPath("author.value").textContent, "Valiyev A.");
  assert.ok(saveBtn());
});

test("`initialEdit` (the bot's «Tahrirlash» → `/uz/files/<id>?edit=1`): the sheet opens with editing already on", () => {
  const s = stubServer();
  render(h(TitulViewer, { doc: s.doc, gen: generation(s), initialEdit: true }));
  // MUTATION: `useState(false)` instead of `useState(initialEdit)` -> the toggle is not pressed and no editor is mounted.
  assert.equal(screen.getByText("Tahrirlash").closest("button")?.getAttribute("aria-pressed"), "true");
  assert.ok(document.querySelector("[data-titul-editor]"), "the in-place editor is mounted");
  cleanup();
  render(h(TitulViewer, { doc: s.doc, gen: generation(s) }));
  assert.equal(screen.getByText("Tahrirlash").closest("button")?.getAttribute("aria-pressed"), "false", "default: view mode");
});
