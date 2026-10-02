import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as ExportButtonModule from "../../components/admin/payments/ExportButton.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";

/*
 * `adminDownload` (lib/admin-api/core.ts): the one step-up-aware file download
 * every admin CSV export uses. Loaded through `require` so the step-up and
 * auth handler registry is the same module instance the components use.
 */
const req = createRequire(import.meta.url);
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const { ExportButton } = req("../../components/admin/payments/ExportButton.tsx") as typeof ExportButtonModule;
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;

type Call = { url: string; init: RequestInit };

const realFetch = globalThis.fetch;
const realClick = window.HTMLAnchorElement.prototype.click;
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

/** Files handed to the browser: the anchor's `download` name and the blob behind its object URL. */
let saved: { name: string; blob: Blob }[] = [];

beforeEach(() => {
  saved = [];
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = (b: Blob | MediaSource) => {
    const url = `blob:fake-${blobs.size}`;
    blobs.set(url, b as Blob);
    return url;
  };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blobs.get(this.getAttribute("href") ?? "")! });
  };
  core.setStepUpHandler(null);
  core.setOnAdminAuthRequired(null);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.HTMLAnchorElement.prototype.click = realClick;
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
  core.setStepUpHandler(null);
  core.setOnAdminAuthRequired(null);
  useToastStore.getState().clear();
});

function stubFetch(responders: Array<() => Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responders[calls.length - 1];
    assert.ok(next, `unexpected request #${calls.length}: ${String(url)}`);
    return next();
  }) as typeof fetch;
  return calls;
}

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const CSV_BODY = '﻿"ID","Ism"\r\n"1","Ali"\r\n';
/** Raw bytes (`Blob.text()` would silently drop the UTF-8 BOM that Excel needs). */
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const csv = (disposition: string | null) =>
  new Response(CSV_BODY, { status: 200, headers: disposition ? { "content-type": "text/csv", "content-disposition": disposition } : { "content-type": "text/csv" } });

test("adminDownload: success saves the body under the Content-Disposition name, with the query built from params", async () => {
  const calls = stubFetch([() => csv('attachment; filename="buyurtmalar-2026-10-02.csv"')]);
  const ctrl = new AbortController();
  const name = await core.adminDownload(
    "/api/admin/orders/export",
    { status: ["PAID", "REFUNDED"], q: "", cursor: undefined },
    { signal: ctrl.signal, fallbackName: "buyurtmalar.csv" },
  );
  assert.equal(name, "buyurtmalar-2026-10-02.csv");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "/api/admin/orders/export?status=PAID%2CREFUNDED");
  assert.equal(calls[0]!.init.credentials, "same-origin");
  assert.equal(calls[0]!.init.signal, ctrl.signal, "the caller's AbortSignal reaches fetch");
  assert.equal(saved.length, 1);
  assert.equal(saved[0]!.name, "buyurtmalar-2026-10-02.csv");
  assert.deepEqual(await bytesOf(saved[0]!.blob), new TextEncoder().encode(CSV_BODY), "exact bytes, BOM kept");
});

test("adminDownload: RFC 5987 filename* wins; no header falls back to the given name", async () => {
  stubFetch([() => csv(`attachment; filename="audit_.csv"; filename*=UTF-8''${encodeURIComponent("audit-jurnal ‘2026’.csv")}`), () => csv(null)]);
  assert.equal(await core.adminDownload("/api/admin/audit/export", undefined, { fallbackName: "audit.csv" }), "audit-jurnal ‘2026’.csv");
  assert.equal(await core.adminDownload("/api/admin/audit/export", undefined, { fallbackName: "audit.csv" }), "audit.csv");
  assert.deepEqual(saved.map((s) => s.name), ["audit-jurnal ‘2026’.csv", "audit.csv"]);
  assert.equal(core.dispositionFilename('attachment; filename="../../etc/passwd"'), ".._.._etc_passwd", "path separators are dropped");
  assert.equal(core.dispositionFilename('attachment; filename=""'), null);
});

test("adminDownload: 401 reauth runs the step-up handler once, retries once and saves the retried body", async () => {
  let stepUps = 0;
  core.setStepUpHandler(async () => {
    stepUps += 1;
    return true;
  });
  const calls = stubFetch([
    () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" }),
    () => csv('attachment; filename="foydalanuvchilar-2026-10-02.csv"'),
  ]);
  const name = await core.adminDownload("/api/admin/users/export", { blocked: "1" }, { fallbackName: "foydalanuvchilar.csv" });
  assert.equal(stepUps, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, "/api/admin/users/export?blocked=1", "the retry repeats the same request");
  assert.equal(name, "foydalanuvchilar-2026-10-02.csv");
  assert.equal(saved.length, 1);
  assert.deepEqual(await bytesOf(saved[0]!.blob), new TextEncoder().encode(CSV_BODY), "the 401 JSON body is never saved");
});

test("adminDownload: a second 401 reauth after the retry is an error, not a file; a cancelled step-up throws AdminReauthCancelledError", async () => {
  core.setStepUpHandler(async () => true);
  const reauth = () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" });
  const calls = stubFetch([reauth, reauth]);
  await assert.rejects(core.adminDownload("/api/admin/users/export", undefined, { fallbackName: "x.csv" }), (e: unknown) => {
    assert.ok(e instanceof core.ApiError);
    assert.equal(e.status, 401);
    assert.equal(e.message, "Bu amal uchun kodni qayta kiriting");
    return true;
  });
  assert.equal(calls.length, 2, "exactly one retry");

  core.setStepUpHandler(async () => false);
  stubFetch([reauth]);
  await assert.rejects(core.adminDownload("/api/admin/users/export", undefined, { fallbackName: "x.csv" }), core.AdminReauthCancelledError);
  assert.equal(saved.length, 0);
});

test("adminDownload: 401 admin_auth fires the registered login redirect and saves nothing", async () => {
  const redirects: string[] = [];
  core.setOnAdminAuthRequired((next) => void redirects.push(next));
  stubFetch([() => json(401, { error: "Admin sessiyasi tugagan. Qaytadan kiring.", code: "admin_auth" })]);
  await assert.rejects(core.adminDownload("/api/admin/audit/export", undefined, { fallbackName: "audit.csv" }), core.AdminAuthRequiredError);
  assert.equal(redirects.length, 1);
  assert.equal(saved.length, 0);
});

test("adminDownload: a non-JSON 5xx body is not saved and gets a generic Uzbek message", async () => {
  stubFetch([() => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })]);
  await assert.rejects(core.adminDownload("/api/admin/orders/export", undefined, { fallbackName: "x.csv" }), (e: unknown) => {
    assert.ok(e instanceof core.ApiError);
    assert.equal(e.status, 502);
    assert.equal(e.message, "Faylni yuklab bo'lmadi (502)");
    return true;
  });
  assert.equal(saved.length, 0);
});

test("export button: a 403 shows the server's {error} in a toast and downloads nothing", async () => {
  const message = "Bu amal uchun ruxsatingiz yo'q";
  stubFetch([() => json(403, { error: message, code: "forbidden" })]);
  let thrown: unknown = null;
  render(
    h(ExportButton, {
      onExport: async () => {
        try {
          await core.adminDownload("/api/admin/orders/export", undefined, { fallbackName: "buyurtmalar.csv" });
        } catch (e) {
          thrown = e;
          throw e;
        }
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "CSV yuklab olish" }));
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.message === message && t.tone === "error")));
  assert.ok(thrown instanceof core.AdminForbiddenError);
  assert.equal(saved.length, 0, "the 403 body is never saved as the file");
});

test("export button: success toast after the file is handed to the browser", async () => {
  stubFetch([() => csv('attachment; filename="hisob-kitobi-2026-10-02.csv"')]);
  render(h(ExportButton, { onExport: async () => void (await core.adminDownload("/api/admin/transactions/export", undefined, { fallbackName: "hisob-kitobi.csv" })) }));
  fireEvent.click(screen.getByRole("button", { name: "CSV yuklab olish" }));
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => /Eksport tayyor/.test(t.message))));
  assert.deepEqual(saved.map((s) => s.name), ["hisob-kitobi-2026-10-02.csv"]);
});
