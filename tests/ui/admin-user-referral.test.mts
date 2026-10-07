import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { createRequire } from "node:module";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import { UserDetail } from "../../components/admin/users/UserDetail.tsx";

/*
 * Admin user page (S5), referral rows (T3, read-only): «Kim taklif qilgan»
 * links to the inviter's page with source, date and reward; «Taklif
 * qilganlar soni» shows the count and points. A detail response without the
 * referral block (an older server during a deploy swap) renders without them.
 *
 * Mutations (each turned a test red, then restored):
 *   1. the rows not rendered → «inviter link and count»;
 *   2. `rewardPoints > 0` check inverted → «mukofotsiz» row of a blocked inviter.
 */
const req = createRequire(import.meta.url);
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

const USER = {
  id: "42",
  name: "Ali Valiyev",
  username: "ali",
  telegramId: "5123456789",
  points: 300,
  quota: 0,
  balance: 12_000,
  isBlocked: false,
  isAdmin: false,
  createdAt: "2026-09-01T05:00:00.000Z",
  lastSeenAt: "2026-10-01T07:30:00.000Z",
  phone: "+998 ** *** ** 67",
  localId: null,
  profile: { university: "", faculty: "", department: "", group: "", course: "", author: "", subject: "", teacher: "", city: "", position: "", organization: "" },
  language: "uz",
  updatedAt: "2026-09-02T05:00:00.000Z",
  revealed: false,
};
const DETAIL = {
  user: USER,
  stats: { generations: 0, completed: 0, failed: 0, spentTanga: 0, paidSoum: 0, storageBytes: 0 },
  flags: { isAdminAccount: false, adminRole: null, adminStatus: null, self: false },
  counts: { activeSessions: 0, queuedJobs: 0, activeGameLinks: 0 },
  walletConfirmThreshold: 1_000_000,
};

function mount(node: ReactNode) {
  const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} };
  return render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(
        PathnameContext.Provider,
        { value: "/admin/users/42" },
        h(
          SearchParamsContext.Provider,
          { value: new URLSearchParams() },
          h(AdminIdentityProvider, {
            value: { adminId: "1", role: "viewer", permissions: ["users.view"], name: "Ko'ruvchi", username: null, twoFactor: true },
            children: node,
          }),
        ),
      ),
    ),
  );
}

function serve(detail: unknown) {
  globalThis.fetch = (async (input: unknown) => {
    assert.equal(String(input).split("?")[0], "/api/admin/users/42");
    return json(detail);
  }) as typeof fetch;
}

test("UserDetail: «Kim taklif qilgan» links the inviter (source, date, reward); «Taklif qilganlar soni» count and points", async () => {
  serve({
    ...DETAIL,
    referral: {
      referredBy: { id: "7", name: "Vali Taklifchi", source: "bot", at: "2026-10-06T08:00:00.000Z", rewardPoints: 2000 },
      invitedCount: 3,
      earnedPoints: 6000,
    },
  });
  mount(h(UserDetail, { id: "42", tools: [] }));
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(screen.getByText("Kim taklif qilgan"), "MUTATSIYA 1");
  const link = screen.getByRole("link", { name: "Vali Taklifchi" });
  assert.equal(link.getAttribute("href"), "/admin/users/7");
  const by = document.querySelector("[data-referred-by]")!.textContent!;
  assert.match(by, /\(bot, .+, \+2\s000 ball\)/);
  assert.ok(screen.getByText("Taklif qilganlar soni"));
  assert.match(document.querySelector("[data-invited-count]")!.textContent!, /^3 \(6\s000 ball\)$/);
});

test("UserDetail: no inviter → empty row; blocked inviter (0 points) → «mukofotsiz»; deleted inviter → no link", async () => {
  serve({ ...DETAIL, referral: { referredBy: null, invitedCount: 0, earnedPoints: 0 } });
  mount(h(UserDetail, { id: "42", tools: [] }));
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(screen.getByText("Kim taklif qilgan"));
  assert.ok(!document.querySelector("[data-referred-by]"));
  assert.match(document.querySelector("[data-invited-count]")!.textContent!, /^0 \(0 ball\)$/);
  cleanup();

  serve({
    ...DETAIL,
    referral: { referredBy: { id: null, name: "", source: "web", at: "2026-10-06T08:00:00.000Z", rewardPoints: 0 }, invitedCount: 0, earnedPoints: 0 },
  });
  mount(h(UserDetail, { id: "42", tools: [] }));
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  const by = document.querySelector("[data-referred-by]")!;
  assert.match(by.textContent!, /o'chirilgan foydalanuvchi/);
  assert.match(by.textContent!, /\(sayt, .+, mukofotsiz\)/, "MUTATSIYA 2");
  assert.ok(!by.querySelector("a"));
});

test("UserDetail: a response without the referral block (older server) renders without the rows", async () => {
  serve(DETAIL);
  mount(h(UserDetail, { id: "42", tools: [] }));
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  await waitFor(() => assert.ok(screen.getByText("Statistika")));
  assert.ok(!screen.queryByText("Kim taklif qilgan"));
  assert.ok(!screen.queryByText("Taklif qilganlar soni"));
});
