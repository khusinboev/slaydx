import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, within, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SlideForm } from "../../components/forms/SlideForm.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Slide quality §A (docs/slide-quality/SPEC.md): the «Rang» row has an «Avtomatik» dot, the untouched form sends
 * `slideTheme: "auto"`, an explicit dot wins, and drafts saved before v3 (when the form always wrote «atlas»)
 * restore to «auto» only when that «atlas» was the untouched default.
 */
afterEach(() => cleanup());

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const profile: UserProfile = {
  name: "Aliyev Ali", language: "uz", points: 0, quota: 0, balance: 100000,
  university: "TDPU", faculty: "", department: "", group: "", course: "", author: "Aliyev Ali", subject: "Biologiya",
  teacher: "", city: "Toshkent", position: "", organization: "",
};
const AUTO_LABEL = "Avtomatik — mavzu va dizaynga mos rang";

const mount = () => render(h(AppRouterContext.Provider, { value: router }, h(SlideForm, { tool: TOOL_BY_ID.slide, profile })));
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function stubFetch(draft: Record<string, unknown> | null) {
  const realFetch = globalThis.fetch;
  const posts: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    if (url === "/api/forms/slide/draft" && method === "GET") return json(200, { draft: draft ? { data: draft, updatedAt: "now" } : null });
    if (url === "/api/forms/slide/draft") return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") {
      posts.push((JSON.parse(String(opts?.body ?? "{}")) as { values?: Record<string, unknown> }).values ?? {});
      return json(200, { id: "gen1", price: 1000, status: "QUEUED" });
    }
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  return { posts, restore: () => void (globalThis.fetch = realFetch) };
}

function submit(topic = "Mavzu") {
  fireEvent.change(screen.getByPlaceholderText(TOOL_BY_ID.slide.topicPlaceholder ?? ""), { target: { value: topic } });
  fireEvent.click(screen.getByRole("button", { name: new RegExp(String(TOOL_BY_ID.slide.submitLabel)) }));
}

test("untouched form: the «Avtomatik» dot is checked and the request sends slideTheme «auto»", async () => {
  const cap = stubFetch(null);
  try {
    mount();
    const active = within(screen.getByRole("radiogroup", { name: "Rang" }))
      .getAllByRole("radio")
      .find((r) => r.getAttribute("aria-checked") === "true");
    // MUTATION: initialValues `slideTheme: "atlas"` again → Atlas is checked and this fails.
    assert.equal(active?.getAttribute("aria-label"), AUTO_LABEL);
    submit();
    await waitFor(() => assert.ok(cap.posts.length > 0));
    assert.equal(cap.posts[0].slideTheme, "auto");
  } finally {
    cap.restore();
  }
});

test("pro slayd keeps main's defaults: no «Avtomatik» dot, untouched form sends atlas (review M2)", async () => {
  const { ProSlideForm } = await import("../../components/forms/ProSlideForm.tsx");
  const cap = stubFetch(null);
  try {
    render(h(AppRouterContext.Provider, { value: router }, h(ProSlideForm, { tool: TOOL_BY_ID["pro-slide"], profile })));
    const radios = within(screen.getByRole("radiogroup", { name: "Rang" })).getAllByRole("radio");
    // MUTATION: `allowAutoTheme` always true → the dot appears on pro.
    assert.ok(!radios.some((r) => r.getAttribute("aria-label") === AUTO_LABEL));
    assert.equal(radios.find((r) => r.getAttribute("aria-checked") === "true")?.getAttribute("aria-label"), "Universitet Atlas");
    fireEvent.change(screen.getByPlaceholderText(TOOL_BY_ID["pro-slide"].topicPlaceholder ?? ""), { target: { value: "Mavzu" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(String(TOOL_BY_ID["pro-slide"].submitLabel)) }));
    await waitFor(() => assert.ok(cap.posts.length > 0));
    assert.equal(cap.posts[0].slideTheme, "atlas");
  } finally {
    cap.restore();
  }
});

test("an explicit palette dot wins over «auto»", async () => {
  const cap = stubFetch(null);
  try {
    mount();
    const dot = within(screen.getByRole("radiogroup", { name: "Rang" })).getByRole("radio", { name: "Bog‘" });
    fireEvent.click(dot);
    assert.equal(dot.getAttribute("aria-checked"), "true");
    submit();
    await waitFor(() => assert.ok(cap.posts.length > 0));
    assert.equal(cap.posts[0].slideTheme, "grove");
  } finally {
    cap.restore();
  }
});

for (const [label, draft, want] of [
  ["v2 draft with the old untouched default (atlas + auto template) restores to «auto»", { slideTheme: "atlas", slideTemplate: "auto" }, "auto"],
  ["v2 draft with atlas picked together with a template keeps atlas", { slideTheme: "atlas", slideTemplate: "lecture" }, "atlas"],
  ["v2 draft with another palette keeps it", { slideTheme: "ink", slideTemplate: "auto" }, "ink"],
  ["v3 draft keeps an explicit atlas", { slideTheme: "atlas", slideTemplate: "auto", v: 3 }, "atlas"],
] as const) {
  test(`draft: ${label}`, async () => {
    const { useAppStore } = await import("../../lib/store.ts");
    useAppStore.setState({ loggedIn: true, sessionChecked: true });
    const cap = stubFetch({ topic: "Qoralama", v: 2, ...draft });
    try {
      mount();
      await waitFor(() => assert.equal((screen.getByLabelText("Taqdimot mavzusini kiriting") as HTMLInputElement).value, "Qoralama"));
      submit("Qoralama");
      await waitFor(() => assert.ok(cap.posts.length > 0));
      // MUTATION: drop the v<3 atlas rule in `sanitizeRestoredDraft` → the first case sends «atlas» and fails.
      assert.equal(cap.posts[0].slideTheme, want);
    } finally {
      cap.restore();
      useAppStore.setState({ loggedIn: false, sessionChecked: false });
    }
  });
}
