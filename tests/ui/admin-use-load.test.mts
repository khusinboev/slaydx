import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createElement as h, useCallback, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type * as UiModule from "../../components/admin/ui/index.ts";
import type * as CoreModule from "../../lib/admin-api/core.ts";

/*
 * `useLoad` is a shared admin primitive (components/admin/ui, exported from
 * the barrel); the errors, audit, admins and system screens use it. Loaded
 * through `require`, the same module instances the components use under tsx.
 */
const req = createRequire(import.meta.url);
const { useLoad } = req("../../components/admin/ui/index.ts") as typeof UiModule;
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const ROOT = resolve(import.meta.dirname, "../..");

afterEach(() => cleanup());

type Loader = (signal: AbortSignal) => Promise<string>;

/** Renders the hook's state as text; `key` changes the loader identity like a filter change does. */
function Probe({ make }: { make: (key: number) => Loader }) {
  const [key, setKey] = useState(0);
  const load = useCallback((signal: AbortSignal) => make(key)(signal), [make, key]);
  const [state, retry] = useLoad(load);
  const text =
    state.status === "ready" ? `ready:${state.data}` : state.status === "error" ? `error:${state.message}:${state.requestId ?? "-"}` : state.status;
  return h("div", null, h("p", { "data-testid": "state" }, text), h("button", { onClick: retry }, "retry"), h("button", { onClick: () => setKey((k) => k + 1) }, "next"));
}

const stateText = () => screen.getByTestId("state").textContent;

test("useLoad: loading → ready; retry reloads; 403 → forbidden; 500 → error with requestId", async () => {
  let n = 0;
  const answers: Array<() => Promise<string>> = [
    async () => "birinchi",
    async () => "ikkinchi",
    async () => {
      throw new core.AdminForbiddenError("Bu amal uchun ruxsatingiz yo'q", { code: "forbidden" });
    },
    async () => {
      throw new core.ApiError("Server xatosi", 500, { requestId: "req-42" });
    },
  ];
  render(h(Probe, { make: () => () => answers[n++]!() }));
  assert.equal(stateText(), "loading");
  await waitFor(() => assert.equal(stateText(), "ready:birinchi"));
  for (const want of ["ready:ikkinchi", "forbidden", "error:Server xatosi:req-42"]) {
    act(() => screen.getByText("retry").click());
    await waitFor(() => assert.equal(stateText(), want));
  }
});

test("useLoad: a newer loader aborts the stale request and its late answer is never shown", async () => {
  const signals: AbortSignal[] = [];
  const resolvers: Array<(v: string) => void> = [];
  const make = (key: number): Loader => (signal) => {
    signals[key] = signal;
    return new Promise<string>((r) => (resolvers[key] = r));
  };
  render(h(Probe, { make }));
  act(() => screen.getByText("next").click());
  await waitFor(() => assert.ok(signals[1]));
  assert.equal(signals[0]!.aborted, true, "the first request was aborted");
  await act(async () => resolvers[0]!("eski"));
  assert.equal(stateText(), "loading", "a stale answer does not overwrite the pending one");
  await act(async () => resolvers[1]!("yangi"));
  assert.equal(stateText(), "ready:yangi");
});

test("useLoad lives in components/admin/ui (barrel) and the screens import it from there", () => {
  for (const f of [
    "components/admin/admins/AdminsPage.tsx",
    "components/admin/audit/AuditPage.tsx",
    "components/admin/audit/AuditDrawer.tsx",
    "components/admin/errors/ErrorsPage.tsx",
    "components/admin/errors/ErrorDrawer.tsx",
    "components/admin/system/SystemPage.tsx",
  ]) {
    const src = readFileSync(resolve(ROOT, f), "utf8");
    assert.match(src, /import \{[^}]*\buseLoad\b[^}]*\} from "@\/components\/admin\/ui";/, f);
    assert.ok(!/from "@\/components\/admin\/system\/shared"/.test(src), `${f}: still imports from system/shared`);
    assert.ok(!/\{[^}]*\buseLoad\b[^}]*\} from "\.\/shared"/.test(src), `${f}: useLoad from a local shared module`);
  }
  assert.ok(!/export function useLoad/.test(readFileSync(resolve(ROOT, "components/admin/system/shared.ts"), "utf8")), "no second copy in system/shared");
});
