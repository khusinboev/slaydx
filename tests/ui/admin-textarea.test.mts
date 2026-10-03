import "./setup.ts";
import test, { afterEach, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BroadcastEditor } from "../../components/admin/broadcasts/BroadcastEditor.tsx";
import { ConfirmDialog } from "../../components/admin/ui/ConfirmDialog.tsx";
import { MessageDialog } from "../../components/admin/users/UserDialogs.tsx";

/**
 * Textarea policy in the admin panel (docs/TEXTAREA-POLICY.md): every textarea is an
 * AutoTextarea — no resize grip, auto height between a minimum and a cap.
 *   reason (ConfirmDialog) 2 → 6 rows, direct message 4 → 12, broadcast text 5 → 16.
 *
 * jsdom has no layout, so `scrollHeight` is stubbed to one LINE per text line (no padding
 * or border in jsdom, content-box) and the computed line height is 1.5 × 16px = 24px.
 *
 * Mutations (each made the named test fail, then restored):
 *   - BroadcastEditor maxRows 16 → 8 → "broadcast editor grows to 16 rows" fails;
 *   - a raw `<textarea` put back in ConfirmDialog → "no raw textarea / resize class" fails;
 *   - `resize-y` class put back on the reason field → the same scan fails.
 */

const LINE = 24;
const lines = (n: number) => Array.from({ length: n }, (_, i) => `qator ${i + 1}`).join("\n");
const px = (rows: number) => `${rows * LINE}px`;

const proto = (globalThis as unknown as { window: Window & typeof globalThis }).window.HTMLTextAreaElement.prototype;
const original = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
const realFetch = globalThis.fetch;

before(() => {
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      const n = this.value === "" ? 1 : this.value.split("\n").length;
      return n * LINE;
    },
  });
});
after(() => {
  if (original) Object.defineProperty(proto, "scrollHeight", original);
  else delete (proto as unknown as Record<string, unknown>).scrollHeight;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

/** Type 1 / 5 / 30 lines and check: minimum, grows, cap + internal scroll, never a resize grip. */
function checkGrowth(el: HTMLTextAreaElement, min: number, max: number) {
  assert.equal(el.style.resize, "none", "no manual resize handle");
  assert.equal(el.style.height, px(min), "empty → minimum rows");
  fireEvent.change(el, { target: { value: lines(1) } });
  assert.equal(el.style.height, px(min), "1 line still shows the minimum");
  fireEvent.change(el, { target: { value: lines(5) } });
  assert.equal(el.style.height, px(Math.min(Math.max(5, min), max)));
  fireEvent.change(el, { target: { value: lines(30) } });
  assert.equal(el.style.height, px(max), "30 lines → capped");
  assert.equal(el.style.overflowY, "auto", "past the cap it scrolls inside");
  assert.equal(el.style.resize, "none");
}

test("ConfirmDialog: the reason field is auto 2 → 6 rows without a resize handle", () => {
  render(h(ConfirmDialog, { open: true, onClose: () => {}, title: "Hamyonni tuzatish", confirmLabel: "Tuzatish", reason: { minLength: 5 }, onConfirm: () => {} }));
  const reason = screen.getByLabelText("Sabab") as HTMLTextAreaElement;
  assert.ok(!reason.className.split(/\s+/).some((c) => c.startsWith("resize")));
  assert.equal(reason.getAttribute("rows"), "2", "rows attribute mirrors minRows (no fixed 3-row box)");
  checkGrowth(reason, 2, 6);
});

test("ConfirmDialog: the forwarded textarea still takes the initial focus and keeps its props", async () => {
  render(h(ConfirmDialog, { open: true, onClose: () => {}, title: "Bloklash", confirmLabel: "Tuzatish", reason: { minLength: 5 }, onConfirm: () => {} }));
  const reason = screen.getByLabelText("Sabab") as HTMLTextAreaElement;
  await waitFor(() => assert.ok(document.activeElement === reason, "reason textarea is focused"));
  assert.equal(reason.maxLength, 500);
  assert.ok(reason.getAttribute("aria-describedby"));
  assert.equal(reason.id.endsWith("-reason"), true);
});

test("MessageDialog: direct message grows 4 → 12 rows and keeps its character counter", () => {
  const user = { id: "1", name: "Sinov", username: null, isBlocked: false, activeSessions: 0, queuedJobs: 0, activeGameLinks: 0 };
  render(h(MessageDialog, { open: true, onClose: () => {}, user }));
  const area = screen.getByLabelText("Xabar") as HTMLTextAreaElement;
  checkGrowth(area, 4, 12);
  assert.ok(screen.getByText(/ \/ /), "counter is still rendered");
});

test("BroadcastEditor: the text grows to 16 rows, then scrolls; it is focused on open", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ count: 10 }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  render(h(BroadcastEditor, { open: true, onClose: () => {}, onCreated: () => {} }));
  const area = screen.getByLabelText(/Matn/) as HTMLTextAreaElement;
  await waitFor(() => assert.ok(document.activeElement === area, "focused on open"));
  assert.equal(area.style.height, px(5), "starts at 5 rows");
  fireEvent.change(area, { target: { value: lines(9) } });
  assert.equal(area.style.height, px(9));
  fireEvent.change(area, { target: { value: lines(40) } });
  assert.equal(area.style.height, px(16), "broadcast editor grows to 16 rows");
  assert.equal(area.style.overflowY, "auto");
  assert.equal(area.style.resize, "none");
});

test("no raw textarea / resize class anywhere under components/admin", () => {
  const root = resolve(import.meta.dirname, "../../components/admin");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(root);
  assert.ok(files.length > 20);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/<textarea[\s>]/.test(src), `${f}: raw <textarea> (use components/common/AutoTextarea)`);
    assert.ok(!/\bresize-(y|x|both)\b/.test(src), `${f}: resize-* class`);
  }
});
