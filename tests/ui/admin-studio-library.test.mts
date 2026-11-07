import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LibraryOverview } from "../../lib/admin-api/studio-library.ts";
import { AdminIdentityProvider } from "../../components/admin/shell/admin-identity.tsx";
import { StudioLibraryPage } from "../../components/admin/studio/StudioLibraryPage.tsx";

/**
 * /admin/studio «Studio kutubxonasi» opens: ONE request, then the prompts. Regression of 2026-11-03 — the page passed
 * an inline arrow to `useLoad`, whose effect re-runs when the loader changes: every render refetched (36 requests in
 * 10 s in the browser) and the page never left its skeleton.
 *
 *   page    one GET /api/admin/studio-library, the title, the prompt rows; still one request after more renders;
 *   source  no admin component passes an inline arrow to the shared `useLoad(load)` (the dashboard's keyed `useLoad`
 *           takes `(key, load)` and is exempt: it re-runs on the key).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. the page's loader back to `useLoad((signal) => getLibrary({ signal }))`  -> «page», «source».
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const OVERVIEW: LibraryOverview = {
  categories: [{ id: "portret", label: "Portret", media: "image" }],
  models: [{ id: "google/nano-banana", media: "image", label: "Nano Banana", available: true, params: [] }],
  prompts: [
    { id: "p1", media: "image", category: "portret", title: "Studiya portreti", prompt: "studio portrait, soft light", previewId: null, previewUrl: null, sort: 10, enabled: true, updatedAt: "2026-11-03T10:00:00Z" },
  ],
  templates: [],
};

test("page: the kind selector filters the list, the editor offers only that kind's models", async () => {
  const data: LibraryOverview = {
    ...OVERVIEW,
    categories: [...OVERVIEW.categories, { id: "sayohat", label: "Sayohat", media: "video" }],
    models: [...OVERVIEW.models, { id: "kling/kling-4-flash", media: "video", label: "Kling 4.0 Flash", available: true, params: [] }],
    prompts: [...OVERVIEW.prompts, { ...OVERVIEW.prompts[0]!, id: "p2", media: "video", category: "sayohat", title: "Tog‘ yo‘lida" }],
  };
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  render(h(AdminIdentityProvider, { value: { adminId: "1", role: "owner", permissions: ["settings.view", "settings.edit"], name: "Test", username: null, twoFactor: true }, children: h(StudioLibraryPage) }));
  await waitFor(() => assert.ok(document.querySelector('[data-lib-prompt="p1"]')));
  assert.ok(!document.querySelector('[data-lib-prompt="p2"]'), "pictures first");
  await act(async () => void fireEvent.change(document.querySelector("[data-lib-media]")!, { target: { value: "video" } }));
  assert.ok(document.querySelector('[data-lib-prompt="p2"]'));
  assert.ok(!document.querySelector('[data-lib-prompt="p1"]'));
  await act(async () => void fireEvent.click(screen.getByRole("tab", { name: /Shablonlar/ })));
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Qo.shish/ })));
  const model = document.querySelector<HTMLSelectElement>("[data-lib-model]")!;
  assert.deepEqual([...model.options].map((o) => o.value), ["kling/kling-4-flash"], "only the kind's models");
  assert.equal(document.querySelector<HTMLSelectElement>("[data-lib-template-media]")!.value, "video");
});

test("page: «Studio kutubxonasi» loads with ONE request and shows the prompts (no refetch loop)", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string) => {
    calls.push(String(input));
    return new Response(JSON.stringify(OVERVIEW), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const { container } = render(
    h(AdminIdentityProvider, { value: { adminId: "1", role: "owner", permissions: ["settings.view", "settings.edit"], name: "Test", username: null, twoFactor: true }, children: h(StudioLibraryPage) }),
  );
  await waitFor(() => assert.ok(container.querySelector('[data-lib-prompt="p1"]'), "the prompt row is drawn"));
  assert.match(container.textContent ?? "", /Studio kutubxonasi/);
  // Give a looping page room to refetch: several more ticks and renders.
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
  });
  assert.deepEqual(calls.map((u) => new URL(u, "http://localhost").pathname), ["/api/admin/studio-library"], "MUTATSIYA 1: exactly one request");
});

test("source: no admin component passes an inline arrow to `useLoad(load)`", () => {
  const root = path.resolve("components/admin");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !p.includes(`${path.sep}dashboard${path.sep}`)) files.push(p);
    }
  };
  walk(root);
  const bad = files.flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/\buseLoad(?:<[^>]*>)?\(\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/g)].map((m) => `${path.relative(process.cwd(), f)}: ${m[0]}`),
  );
  assert.deepEqual(bad, [], "an inline loader refetches on every render — hoist it or wrap it in useCallback");
});
