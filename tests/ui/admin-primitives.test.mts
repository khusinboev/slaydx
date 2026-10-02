import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import { fmtNumber } from "../../lib/admin-format.ts";
import { Badge } from "../../components/admin/ui/Badge.tsx";
import { ConfirmDialog, type ConfirmContext } from "../../components/admin/ui/ConfirmDialog.tsx";
import { Sparkline } from "../../components/admin/ui/charts/Sparkline.tsx";
import { CursorPager } from "../../components/admin/ui/CursorPager.tsx";
import { DataTable, type Column } from "../../components/admin/ui/DataTable.tsx";
import { DateRangePicker, type DateRange } from "../../components/admin/ui/DateRangePicker.tsx";
import { MultiSelectFilter, SearchInput } from "../../components/admin/ui/FilterBar.tsx";
import { LineChart } from "../../components/admin/ui/charts/LineChart.tsx";
import { StepUpDialog, StepUpProvider } from "../../components/admin/ui/StepUpDialog.tsx";
import { Toaster, toast, useToastStore } from "../../components/admin/ui/Toaster.tsx";
import { presetRange, previousRange, validateRange } from "../../components/admin/ui/date-range.ts";

/*
 * tsx loads the components (and everything they import) through `require`, while a
 * test's own `import` creates a second ESM instance of the same file. The step-up
 * handler registry lives in module state, so the test must use the SAME instance
 * the components registered with: load core through `require` as well.
 */
const core = createRequire(import.meta.url)("../../lib/admin-api/core.ts") as typeof CoreModule;
const {
  AdminAuthRequiredError,
  AdminForbiddenError,
  AdminNotFoundError,
  AdminReauthCancelledError,
  ApiError,
  adminGet,
  adminSend,
  newIdempotencyKey,
  setOnAdminAuthRequired,
  setStepUpHandler,
} = core;

const realFetch = globalThis.fetch;
const realLocation = Object.getOwnPropertyDescriptor(globalThis, "location");

beforeEach(() => {
  setOnAdminAuthRequired(null);
  setStepUpHandler(null);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  if (realLocation) Object.defineProperty(globalThis, "location", realLocation);
  else Reflect.deleteProperty(globalThis, "location");
  useToastStore.getState().clear();
  setOnAdminAuthRequired(null);
  setStepUpHandler(null);
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NB = " ";
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* ───────────────────────────── DataTable ───────────────────────────── */

type Row = { id: string; name: string; balance: number };
const ROWS: Row[] = [
  { id: "a", name: "Ali", balance: 10 },
  { id: "b", name: "Vali", balance: 20 },
  { id: "c", name: "Sami", balance: 30 },
];
const COLUMNS: Column<Row>[] = [
  { id: "name", header: "Ism", cell: (r) => r.name },
  { id: "balance", header: "Balans", cell: (r) => h("button", { type: "button", "data-inner": r.id }, r.balance), sortKey: "balance_desc", align: "right" },
  { id: "created", header: "Yaratilgan", cell: () => "01.10.2026", sortKey: "created_desc", sortKeyReverse: "created_asc" },
];

function table() {
  const el = document.querySelector("table");
  assert.ok(el, "jadval topilmadi");
  return within(el as HTMLElement);
}

test("DataTable: tartiblanadigan sarlavhalar aria-sort beradi va faqat ruxsat etilgan kalitlarni yuboradi", () => {
  const calls: string[] = [];
  const { rerender } = render(
    h(DataTable<Row>, { columns: COLUMNS, rows: ROWS, rowKey: (r) => r.id, caption: "Foydalanuvchilar", sort: "created_desc", onSortChange: (k) => calls.push(k) }),
  );
  const headers = document.querySelectorAll("th");
  assert.equal(headers[0].getAttribute("aria-sort"), null, "tartiblanmaydigan ustunda aria-sort yo'q");
  assert.equal(headers[1].getAttribute("aria-sort"), "none");
  assert.equal(headers[2].getAttribute("aria-sort"), "descending");

  // Tartiblanmaydigan sarlavhada tugma yo'q.
  assert.ok(within(headers[0] as HTMLElement).queryByRole("button") === null);

  fireEvent.click(within(headers[1] as HTMLElement).getByRole("button"));
  fireEvent.click(within(headers[2] as HTMLElement).getByRole("button"));
  assert.deepEqual(calls, ["balance_desc", "created_asc"], "joriy yo'nalish teskarisiga almashadi");

  rerender(
    h(DataTable<Row>, { columns: COLUMNS, rows: ROWS, rowKey: (r) => r.id, caption: "Foydalanuvchilar", sort: "created_asc", onSortChange: (k) => calls.push(k) }),
  );
  assert.equal(document.querySelectorAll("th")[2].getAttribute("aria-sort"), "ascending");
  fireEvent.click(within(document.querySelectorAll("th")[2] as HTMLElement).getByRole("button"));
  assert.equal(calls[2], "created_desc");
});

test("DataTable: tanlash — qator katagi, hammasini tanlash, qisman holat", () => {
  const seen: Array<string[]> = [];
  function Harness() {
    const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
    return h(DataTable<Row>, {
      columns: COLUMNS,
      rows: ROWS,
      rowKey: (r) => r.id,
      caption: "Foydalanuvchilar",
      selectable: true,
      selected: sel,
      onSelectedChange: (next) => {
        seen.push([...next].sort());
        setSel(next);
      },
    });
  }
  render(h(Harness));
  const t = table();
  const all = t.getByLabelText("Hammasini tanlash") as HTMLInputElement;
  const rowBoxes = t.getAllByLabelText("Qatorni tanlash") as HTMLInputElement[];
  assert.equal(rowBoxes.length, 3);

  fireEvent.click(rowBoxes[1]);
  assert.deepEqual(seen.at(-1), ["b"]);
  assert.equal(all.indeterminate, true, "bitta tanlangan — qisman");
  assert.equal(all.checked, false);

  fireEvent.click(all);
  assert.deepEqual(seen.at(-1), ["a", "b", "c"]);
  assert.equal(all.checked, true);

  fireEvent.click(all);
  assert.deepEqual(seen.at(-1), []);
});

test("DataTable: qator bosilishi onRowClick ni chaqiradi, ichki tugma esa chaqirmaydi", () => {
  const clicked: string[] = [];
  render(h(DataTable<Row>, { columns: COLUMNS, rows: ROWS, rowKey: (r) => r.id, caption: "Foydalanuvchilar", onRowClick: (r) => clicked.push(r.id) }));
  const t = table();
  fireEvent.click(t.getByText("Vali"));
  assert.deepEqual(clicked, ["b"]);
  fireEvent.click(document.querySelector("table [data-inner='c']") as HTMLElement);
  assert.deepEqual(clicked, ["b"], "tugma bosilishi qator bosilishi hisoblanmaydi");
  const row = document.querySelector("tr[data-row-key='a']") as HTMLElement;
  fireEvent.keyDown(row, { key: "Enter" });
  assert.deepEqual(clicked, ["b", "a"], "Enter ham qatorni ochadi");
});

test("DataTable: yuklanayotganda skelet, bo'sh bo'lsa empty slot, kichik ekran uchun kartochkalar", () => {
  const { rerender } = render(h(DataTable<Row>, { columns: COLUMNS, rows: [], rowKey: (r) => r.id, caption: "T", loading: true, skeletonRows: 6 }));
  assert.equal(document.querySelectorAll("[data-skeleton-row]").length, 6);
  assert.equal(document.querySelector("[aria-busy='true']") !== null, true);

  rerender(h(DataTable<Row>, { columns: COLUMNS, rows: [], rowKey: (r) => r.id, caption: "T", empty: h("p", null, "Hech narsa topilmadi") }));
  assert.ok(screen.getByText("Hech narsa topilmadi"));
  assert.ok(document.querySelector("table") === null);

  rerender(h(DataTable<Row>, { columns: COLUMNS, rows: ROWS, rowKey: (r) => r.id, caption: "T" }));
  assert.equal(document.querySelectorAll("tbody tr").length, 3);
  assert.equal(document.querySelectorAll("[data-card-list] > li").length, 3, "sm dan kichik ekran uchun karta ro'yxati");
});

/* ───────────────────────────── CursorPager ───────────────────────────── */

const PAGES: Record<string, { next: string | null }> = {
  first: { next: "c1" },
  c1: { next: "c2" },
  c2: { next: null },
};

function PagerHarness({ log, resetKey }: { log: Array<string | null>; resetKey?: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = PAGES[cursor ?? "first"];
  return h(
    "div",
    null,
    h("output", { "data-testid": "cursor" }, String(cursor)),
    h(CursorPager, {
      cursor,
      nextCursor: page.next,
      total: 10_000,
      totalCapped: true,
      resetKey,
      onCursorChange: (c: string | null) => {
        log.push(c);
        setCursor(c);
      },
    }),
  );
}

test("CursorPager: Keyingi/Oldingi mijoz tomonidagi kursor steki bilan ishlaydi", () => {
  const log: Array<string | null> = [];
  render(h(PagerHarness, { log }));
  const prev = () => screen.getByRole("button", { name: "Oldingi" }) as HTMLButtonElement;
  const next = () => screen.getByRole("button", { name: "Keyingi" }) as HTMLButtonElement;
  assert.equal(prev().disabled, true, "birinchi sahifada Oldingi o'chiq");
  assert.equal(next().disabled, false);
  assert.equal(document.querySelector("nav span")?.textContent, `10${NB}000+ natija`, "chegaralangan jami '10 000+'");

  fireEvent.click(next());
  fireEvent.click(next());
  assert.deepEqual(log, ["c1", "c2"]);
  assert.equal(next().disabled, true, "nextCursor yo'q — Keyingi o'chiq");

  fireEvent.click(prev());
  fireEvent.click(prev());
  assert.deepEqual(log, ["c1", "c2", "c1", null], "stek teskari tartibda qaytadi");
  assert.equal(prev().disabled, true);
});

test("CursorPager: resetKey o'zgarsa stek tozalanadi; aniq jami '{N} ta natija'", () => {
  const log: Array<string | null> = [];
  const { rerender } = render(h(PagerHarness, { log, resetKey: "a" }));
  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  assert.equal((screen.getByRole("button", { name: "Oldingi" }) as HTMLButtonElement).disabled, false);
  rerender(h(PagerHarness, { log, resetKey: "b" }));
  assert.equal((screen.getByRole("button", { name: "Oldingi" }) as HTMLButtonElement).disabled, true, "filtr o'zgardi — orqaga qaytish yo'q");

  cleanup();
  render(h(CursorPager, { cursor: null, nextCursor: null, total: 1234, onCursorChange: () => {} }));
  assert.equal(document.querySelector("nav span")?.textContent, `${fmtNumber(1234)} ta natija`);
});

/* ───────────────────────────── ConfirmDialog ───────────────────────────── */

function openConfirm(props: Partial<Parameters<typeof ConfirmDialog>[0]> & { onConfirm: (c: ConfirmContext) => Promise<void> | void }) {
  const onClose = props.onClose ?? (() => {});
  return render(h(ConfirmDialog, { open: true, onClose, title: "Hamyonni tuzatish", confirmLabel: "Tuzatish", ...props }));
}

const confirmBtn = () => screen.getByRole("button", { name: "Tuzatish" }) as HTMLButtonElement;

test("ConfirmDialog: sabab (min uzunlik) va yozib tasdiqlash bajarilmaguncha tugma o'chiq", async () => {
  const calls: ConfirmContext[] = [];
  openConfirm({
    reason: { minLength: 5 },
    typedConfirmation: "1 000 000",
    onConfirm: (c) => {
      calls.push(c);
    },
  });
  const reason = screen.getByLabelText("Sabab") as HTMLTextAreaElement;
  const typed = screen.getByLabelText(/Tasdiqlash uchun/) as HTMLInputElement;
  assert.equal(confirmBtn().disabled, true);

  fireEvent.change(reason, { target: { value: "abc" } });
  fireEvent.change(typed, { target: { value: "1 000 000" } });
  assert.equal(confirmBtn().disabled, true, "sabab 5 belgidan qisqa");

  fireEvent.change(reason, { target: { value: "  kompensatsiya  " } });
  fireEvent.change(typed, { target: { value: "1 000" } });
  assert.equal(confirmBtn().disabled, true, "yozib tasdiqlash mos emas");

  fireEvent.change(typed, { target: { value: "1 000 000" } });
  assert.equal(confirmBtn().disabled, false);

  fireEvent.click(confirmBtn());
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].reason, "kompensatsiya", "sabab qirqilgan holda uzatiladi");
  assert.match(calls[0].idempotencyKey, UUID_V4);
});

test("ConfirmDialog: xato dialog ichida ko'rinadi, ochiq qoladi, qayta urinish o'sha Idempotency kalitini ishlatadi", async () => {
  const keys: string[] = [];
  let closed = 0;
  let attempt = 0;
  openConfirm({
    reason: { minLength: 5 },
    onClose: () => closed++,
    onConfirm: async ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      attempt++;
      if (attempt === 1) throw new ApiError("Balans yetarli emas", 409, { code: "insufficient" });
    },
  });
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "to'g'rilash" } });
  fireEvent.click(confirmBtn());
  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "Balans yetarli emas");
  assert.equal(closed, 0, "xatoda dialog yopilmaydi");
  assert.equal(confirmBtn().disabled, false, "xatodan keyin qayta urinish mumkin");

  fireEvent.click(confirmBtn());
  await waitFor(() => assert.equal(closed, 1));
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1], "qayta urinishda kalit o'zgarmaydi");
});

test("ConfirmDialog: har ochilishda yangi kalit va toza holat", async () => {
  const keys: string[] = [];
  const onConfirm = ({ idempotencyKey }: ConfirmContext) => {
    keys.push(idempotencyKey);
  };
  const props = { title: "Bloklash", confirmLabel: "Tuzatish", reason: { minLength: 5 }, onConfirm, onClose: () => {} };
  const { rerender } = render(h(ConfirmDialog, { ...props, open: true }));
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "birinchi sabab" } });
  fireEvent.click(confirmBtn());
  await waitFor(() => assert.equal(keys.length, 1));

  rerender(h(ConfirmDialog, { ...props, open: false }));
  assert.ok(screen.queryByRole("dialog") === null);
  rerender(h(ConfirmDialog, { ...props, open: true }));
  assert.equal((screen.getByLabelText("Sabab") as HTMLTextAreaElement).value, "", "sabab maydoni tozalangan");
  assert.equal(confirmBtn().disabled, true);
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "ikkinchi sabab" } });
  fireEvent.click(confirmBtn());
  await waitFor(() => assert.equal(keys.length, 2));
  assert.notEqual(keys[0], keys[1]);
});

test("ConfirmDialog: so'rov ketayotganda tugmalar o'chadi, Escape yopmaydi", async () => {
  let release: () => void = () => {};
  let closed = 0;
  openConfirm({
    onClose: () => closed++,
    onConfirm: () => new Promise<void>((r) => (release = r)),
  });
  fireEvent.click(confirmBtn());
  await waitFor(() => assert.equal(confirmBtn().disabled, true));
  assert.equal((screen.getByRole("button", { name: "Bekor qilish" }) as HTMLButtonElement).disabled, true);
  fireEvent.keyDown(window, { key: "Escape" });
  assert.equal(closed, 0, "so'rov ketayotganda Escape e'tiborsiz");
  await act(async () => {
    release();
    await tick();
  });
  await waitFor(() => assert.equal(closed, 1));
});

test("ConfirmDialog: oldin → keyin bloki va ixtiyoriy sabab", async () => {
  const calls: ConfirmContext[] = [];
  openConfirm({ before: "4 000", after: "10 000", reason: { required: false }, onConfirm: (c) => void calls.push(c) });
  assert.ok(screen.getByText("4 000"));
  assert.ok(screen.getByText("10 000"));
  assert.equal(confirmBtn().disabled, false, "sabab ixtiyoriy — tugma darhol faol");
  fireEvent.click(confirmBtn());
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].reason, "");
});

/* ───────────────────────────── DateRangePicker ───────────────────────────── */

test("presetRange: Toshkent kunlari bo'yicha to'g'ri oraliqlar", () => {
  const today = "2026-10-01";
  assert.deepEqual(presetRange("today", today), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(presetRange("yesterday", today), { from: "2026-09-30", to: "2026-09-30" });
  assert.deepEqual(presetRange("7d", today), { from: "2026-09-25", to: "2026-10-01" });
  assert.deepEqual(presetRange("30d", today), { from: "2026-09-02", to: "2026-10-01" });
  assert.deepEqual(presetRange("month", today), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(presetRange("lastMonth", today), { from: "2026-09-01", to: "2026-09-30" });
  // Yanvarda o'tgan oy — oldingi yil dekabri.
  assert.deepEqual(presetRange("lastMonth", "2027-01-15"), { from: "2026-12-01", to: "2026-12-31" });
  // Kabisa yili fevrali.
  assert.deepEqual(presetRange("lastMonth", "2024-03-10"), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(previousRange({ from: "2026-09-25", to: "2026-10-01" }), { from: "2026-09-18", to: "2026-09-24" });
  assert.equal(validateRange({ from: "2026-01-01", to: "2026-12-31" }), null);
  assert.match(validateRange({ from: "2026-01-01", to: "2027-01-02" }) ?? "", /366/);
  assert.equal(validateRange({ from: "2026-01-01", to: "2027-01-01" }), null, "ikkala chegara bilan aynan 366 kun");
  assert.ok(validateRange({ from: "2026-10-02", to: "2026-10-01" }));
});

test("DateRangePicker: tayyor davrlar Toshkent bo'yicha oraliq beradi (UTC kechasi ham)", () => {
  const out: DateRange[] = [];
  // 2026-09-30 20:00 UTC = 2026-10-01 01:00 Toshkent: «Bugun» 1-oktabr bo'lishi kerak.
  const now = Date.UTC(2026, 8, 30, 20, 0, 0);
  render(h(DateRangePicker, { value: { from: "2026-01-01", to: "2026-01-02" }, onChange: (r: DateRange) => out.push(r), now }));
  for (const label of ["Bugun", "Kecha", "7 kun", "30 kun", "Shu oy", "O'tgan oy"]) {
    fireEvent.click(screen.getByRole("button", { name: label }));
  }
  assert.deepEqual(out, [
    { from: "2026-10-01", to: "2026-10-01" },
    { from: "2026-09-30", to: "2026-09-30" },
    { from: "2026-09-25", to: "2026-10-01" },
    { from: "2026-09-02", to: "2026-10-01" },
    { from: "2026-10-01", to: "2026-10-01" },
    { from: "2026-09-01", to: "2026-09-30" },
  ]);
});

test("DateRangePicker: faol davr aria-pressed bilan belgilanadi; boshqa oraliq selectlar bilan, 366 kundan oshsa rad etiladi", () => {
  const out: DateRange[] = [];
  const now = Date.UTC(2026, 9, 1, 10, 0, 0);
  const { rerender } = render(h(DateRangePicker, { value: presetRange("30d", "2026-10-01"), onChange: (r: DateRange) => out.push(r), now }));
  assert.equal(screen.getByRole("button", { name: "30 kun" }).getAttribute("aria-pressed"), "true");
  assert.equal(screen.getByRole("button", { name: "7 kun" }).getAttribute("aria-pressed"), "false");
  assert.ok(document.querySelector("select") === null, "tayyor davrda select ko'rinmaydi");

  fireEvent.click(screen.getByRole("button", { name: "Boshqa…" }));
  const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  // Oldingi qiymatdan boshlanadi (2026-09-02 … 2026-10-01); boshlanishni 2025 ga ko'chiramiz.
  pick("Boshlanish sanasi — yil", "2025");
  assert.match(String(screen.getByRole("alert").textContent), /366/, "395 kun — rad etiladi");
  assert.equal(out.length, 0, "yaroqsiz oraliq onChange ni chaqirmaydi");

  // 2025-10-02 … 2026-10-01 = 365 kun — yaroqli.
  pick("Boshlanish sanasi — oy", "10");
  assert.deepEqual(out, [{ from: "2025-10-02", to: "2026-10-01" }]);
  assert.ok(screen.queryByRole("alert") === null, "xato yo'qoladi");
  rerender(h(DateRangePicker, { value: out[0], onChange: (r: DateRange) => out.push(r), now }));
  assert.equal(screen.getByRole("button", { name: "Boshqa…" }).getAttribute("aria-pressed"), "true");
});

test("DateRangePicker: ochiq custom oraliq to'liq va yaroqli bo'lsa onChange chaqiradi", () => {
  const out: DateRange[] = [];
  const now = Date.UTC(2026, 9, 1, 10, 0, 0);
  render(h(DateRangePicker, { value: { from: "2026-08-10", to: "2026-08-20" }, onChange: (r: DateRange) => out.push(r), now }));
  // Qiymat tayyor davrlarga mos kelmaydi — custom qator o'zi ochiq.
  const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  pick("Tugash sanasi — kun", "25");
  assert.deepEqual(out.at(-1), { from: "2026-08-10", to: "2026-08-25" });
  pick("Boshlanish sanasi — kun", "30");
  assert.equal(out.length, 1, "boshlanish tugashdan keyin — chaqirilmaydi");
  assert.ok(screen.getByRole("alert"));
});

/* ───────────────────────────── SearchInput ───────────────────────────── */

test("SearchInput: debounce, Enter darhol, tashqi tozalash matnni tiklaydi", async () => {
  const seen: string[] = [];
  function Harness() {
    const [v, setV] = useState("");
    return h(
      "div",
      null,
      h(SearchInput, { value: v, placeholder: "Ism, @username yoki ID", delayMs: 30, onChange: (x: string) => { seen.push(x); setV(x); } }),
      h("button", { type: "button", onClick: () => setV("") }, "tashqaridan tozalash"),
    );
  }
  render(h(Harness));
  const input = screen.getByPlaceholderText("Ism, @username yoki ID") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "a" } });
  fireEvent.change(input, { target: { value: "al" } });
  assert.deepEqual(seen, [], "yozish paytida so'rov ketmaydi");
  await waitFor(() => assert.deepEqual(seen, ["al"]));
  fireEvent.change(input, { target: { value: "ali" } });
  fireEvent.keyDown(input, { key: "Enter" });
  assert.deepEqual(seen, ["al", "ali"], "Enter kutmaydi");
  fireEvent.click(screen.getByText("tashqaridan tozalash"));
  assert.equal(input.value, "", "tashqi qiymat o'zgardi — maydon yangilanadi");
});

/* ───────────────────────────── MultiSelectFilter ───────────────────────────── */

test("MultiSelectFilter: tugmaning nomi filtr yorlig'i va tanlangan qiymatlarni o'z ichiga oladi", () => {
  const STATUS = [
    { value: "QUEUED", label: "Navbatda" },
    { value: "FAILED", label: "Xato" },
    { value: "COMPLETED", label: "Tayyor" },
  ];
  function Harness() {
    const [v, setV] = useState<string[]>(["FAILED", "QUEUED"]);
    return h(MultiSelectFilter, { label: "Holat", values: v, options: STATUS, onChange: setV });
  }
  render(h(Harness));
  // Selection order is kept; the visible text stays the short summary.
  const button = screen.getByRole("button", { name: "Holat: Xato, Navbatda" });
  assert.equal(button.textContent, "2 ta tanlangan");
  assert.equal(button.getAttribute("aria-haspopup"), "true");

  fireEvent.click(button);
  fireEvent.click(screen.getByRole("checkbox", { name: "Xato" }));
  assert.equal(screen.getByRole("button", { name: "Holat: Navbatda" }).textContent, "Navbatda");

  fireEvent.click(screen.getByRole("button", { name: "Tanlovni tozalash" }));
  assert.equal(screen.getByRole("button", { name: "Holat: Hammasi" }).textContent, "Hammasi");
});

/* ───────────────────────────── LineChart ───────────────────────────── */

/** Tick labels (gridline texts) and the line's y coordinates of a rendered LineChart. */
function lineChartGeometry(title: string) {
  const svg = screen.getByRole("img", { name: title });
  const tickTexts = [...svg.querySelectorAll("g > text")].map((t) => t.textContent ?? "");
  const pts = (svg.querySelector("polyline")?.getAttribute("points") ?? "").split(" ").filter(Boolean);
  const ys = pts.map((p) => Number(p.split(",")[1]));
  return { svg, tickTexts, ys };
}

test("LineChart: 1 dan kichik qiymatlar o'z shkalasini oladi (tekis chiziqqa aylanmaydi)", () => {
  const title = "Kunlik AI xarajat";
  render(
    h(LineChart, {
      title,
      formatValue: (n: number) => String(n),
      points: [
        { label: "01.10", value: 0.012 },
        { label: "02.10", value: 0.03 },
        { label: "03.10", value: 0.021 },
      ],
    }),
  );
  const { tickTexts, ys } = lineChartGeometry(title);
  assert.deepEqual(tickTexts, ["0", "0.01", "0.02", "0.03"], "nice 0.01 steps, top tick at the data maximum");
  assert.ok(ys.every((y) => Number.isFinite(y)));
  // Plot height = 200 - 12 - 26 = 162 px; the series spans most of it instead of ~3 %.
  const spread = Math.max(...ys) - Math.min(...ys);
  assert.ok(spread > 80, `the line uses the plot height (spread ${spread.toFixed(1)} px)`);
});

test("LineChart: hammasi nol bo'lgan qator — domen 0..1, chiziq nol chizig'ida, NaN yo'q", () => {
  const title = "Kunlik ro'yxatdan o'tish";
  render(
    h(LineChart, {
      title,
      formatValue: (n: number) => String(n),
      points: [
        { label: "01.10", value: 0 },
        { label: "02.10", value: 0 },
        { label: "03.10", value: 0 },
      ],
    }),
  );
  const { svg, tickTexts, ys } = lineChartGeometry(title);
  assert.deepEqual(tickTexts, ["0", "0.5", "1"]);
  assert.equal(ys.length, 3);
  assert.ok(ys.every((y) => Number.isFinite(y) && y === ys[0]), "flat line, finite coordinates");
  assert.equal(ys[0], 200 - 26, "on the zero baseline at the bottom of the plot");
  assert.ok(!svg.innerHTML.includes("NaN"));
});

/* ───────────────────────────── StepUpDialog ───────────────────────────── */

test("StepUpDialog: faqat 6 raqam, yuborilganda onSubmit(kod) va onClose(true)", async () => {
  const submitted: string[] = [];
  const closed: boolean[] = [];
  render(h(StepUpDialog, { open: true, onClose: (c: boolean) => closed.push(c), onSubmit: async (code: string) => void submitted.push(code) }));
  const input = screen.getByLabelText("Tasdiqlash kodi") as HTMLInputElement;
  const ok = () => screen.getByRole("button", { name: "Tasdiqlash" }) as HTMLButtonElement;
  fireEvent.change(input, { target: { value: "12a3-45678" } });
  assert.equal(input.value, "123456", "raqam bo'lmagan belgilar olib tashlanadi, 6 ta bilan cheklanadi");
  fireEvent.change(input, { target: { value: "123" } });
  assert.equal(ok().disabled, true);
  fireEvent.change(input, { target: { value: "654321" } });
  assert.equal(ok().disabled, false);
  fireEvent.click(ok());
  await waitFor(() => assert.deepEqual(closed, [true]));
  assert.deepEqual(submitted, ["654321"]);
});

test("StepUpDialog: noto'g'ri kod — xato dialog ichida, yopilmaydi; Bekor qilish onClose(false)", async () => {
  const closed: boolean[] = [];
  render(
    h(StepUpDialog, {
      open: true,
      onClose: (c: boolean) => closed.push(c),
      onSubmit: async () => {
        throw new ApiError("Kod noto'g'ri", 401, { code: "bad_code" });
      },
    }),
  );
  fireEvent.change(screen.getByLabelText("Tasdiqlash kodi"), { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Tasdiqlash" }));
  assert.equal((await screen.findByRole("alert")).textContent, "Kod noto'g'ri");
  assert.deepEqual(closed, []);
  assert.equal((screen.getByLabelText("Tasdiqlash kodi") as HTMLInputElement).value, "", "kod maydoni tozalanadi");
  fireEvent.click(screen.getByRole("button", { name: "Bekor qilish" }));
  assert.deepEqual(closed, [false]);
});

/* ───────────────────────────── admin-api/core ───────────────────────────── */

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; init: RequestInit };
function stubFetch(responses: Array<() => Response | Promise<Response>>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses[calls.length - 1];
    assert.ok(next, `kutilmagan ${calls.length}-so'rov`);
    return next();
  }) as typeof fetch;
  return calls;
}

const headerOf = (c: Call, name: string) => new Headers(c.init.headers as HeadersInit).get(name);

test("core: 401 reauth — step-up so'raladi va so'rov BIR marta, o'sha Idempotency kaliti bilan takrorlanadi", async () => {
  const calls = stubFetch([() => json(401, { error: "Qayta tasdiqlang", code: "reauth" }), () => json(201, { ok: true })]);
  let stepUps = 0;
  setStepUpHandler(async () => {
    stepUps++;
    return true;
  });
  const key = newIdempotencyKey();
  const res = await adminSend<{ ok: boolean }>("POST", "/api/admin/users/7/wallet-adjustments", { delta: 5 }, { idempotencyKey: key });
  assert.deepEqual(res, { ok: true });
  assert.equal(stepUps, 1);
  assert.equal(calls.length, 2);
  assert.equal(headerOf(calls[0], "idempotency-key"), key);
  assert.equal(headerOf(calls[1], "idempotency-key"), key, "qayta urinishda kalit bir xil");
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(calls[1].init.method, "POST");
});

test("core: reauth qayta urinishda yana reauth bersa — uchinchi urinish yo'q", async () => {
  const calls = stubFetch([() => json(401, { code: "reauth", error: "x" }), () => json(401, { code: "reauth", error: "Qayta tasdiqlang" })]);
  let stepUps = 0;
  setStepUpHandler(async () => {
    stepUps++;
    return true;
  });
  await assert.rejects(adminSend("POST", "/api/admin/x", {}), (e: unknown) => e instanceof ApiError && e.status === 401);
  assert.equal(calls.length, 2);
  assert.equal(stepUps, 1);
});

test("core: step-up bekor qilinsa yoki handler bo'lmasa — AdminReauthCancelledError, qayta so'rov yo'q", async () => {
  let calls = stubFetch([() => json(401, { code: "reauth", error: "x" })]);
  setStepUpHandler(async () => false);
  await assert.rejects(adminSend("POST", "/api/admin/x", {}), AdminReauthCancelledError);
  assert.equal(calls.length, 1);

  setStepUpHandler(null);
  calls = stubFetch([() => json(401, { code: "reauth", error: "x" })]);
  await assert.rejects(adminGet("/api/admin/x"), AdminReauthCancelledError);
  assert.equal(calls.length, 1);
});

test("core: bir vaqtdagi bir nechta reauth bitta step-up dialogini bo'lishadi", async () => {
  let n = 0;
  globalThis.fetch = (async () => {
    n++;
    // Har yo'l birinchi urinishda reauth, ikkinchisida muvaffaqiyat.
    return n <= 2 ? json(401, { code: "reauth", error: "x" }) : json(200, { ok: n });
  }) as typeof fetch;
  let stepUps = 0;
  setStepUpHandler(async () => {
    stepUps++;
    await tick(5);
    return true;
  });
  const [a, b] = await Promise.all([adminGet("/api/admin/a"), adminGet("/api/admin/b")]);
  assert.ok(a && b);
  assert.equal(stepUps, 1);
});

test("core: 401 admin_auth — ro'yxatdan o'tgan handler joriy yo'l bilan chaqiriladi", async () => {
  stubFetch([() => json(401, { code: "admin_auth", error: "Admin sessiyasi tugadi" })]);
  Object.defineProperty(globalThis, "location", { value: { pathname: "/admin/users", search: "?q=ali", assign: () => {} }, configurable: true });
  const seen: string[] = [];
  setOnAdminAuthRequired((next) => seen.push(next));
  await assert.rejects(adminGet("/api/admin/users"), AdminAuthRequiredError);
  assert.deepEqual(seen, ["/admin/users?q=ali"]);
});

test("core: 401 admin_auth — standart handler /admin/login?next=… ga yo'naltiradi (login sahifasida esa yo'q)", async () => {
  const assigned: string[] = [];
  Object.defineProperty(globalThis, "location", { value: { pathname: "/admin/users", search: "?q=a b", assign: (u: string) => assigned.push(u) }, configurable: true });
  stubFetch([() => json(401, { code: "admin_auth", error: "x" })]);
  await assert.rejects(adminGet("/api/admin/users"), AdminAuthRequiredError);
  assert.deepEqual(assigned, [`/admin/login?next=${encodeURIComponent("/admin/users?q=a b")}`]);

  Object.defineProperty(globalThis, "location", { value: { pathname: "/admin/login", search: "", assign: (u: string) => assigned.push(u) }, configurable: true });
  stubFetch([() => json(401, { code: "admin_auth", error: "x" })]);
  await assert.rejects(adminGet("/api/admin/session"), AdminAuthRequiredError);
  assert.equal(assigned.length, 1, "login sahifasida qayta yo'naltirish sikli yo'q");
});

test("core: 403 → AdminForbiddenError, 404 → AdminNotFoundError, boshqa xatolar ApiError bo'lib qoladi", async () => {
  stubFetch([() => json(403, { code: "forbidden", error: "Ruxsat yo'q" })]);
  await assert.rejects(adminGet("/api/admin/audit"), (e: unknown) => e instanceof AdminForbiddenError && e.code === "forbidden" && e.message === "Ruxsat yo'q");
  stubFetch([() => json(404, {})]);
  await assert.rejects(adminGet("/api/admin/session"), (e: unknown) => e instanceof AdminNotFoundError && e.status === 404);
  stubFetch([() => json(429, { error: "Juda ko'p urinish", retryAfterSec: 30 })]);
  await assert.rejects(adminGet("/api/admin/x"), (e: unknown) => e instanceof ApiError && !(e instanceof AdminForbiddenError) && e.retryAfterSec === 30);
});

test("core: adminGet query qurish (massiv, null, mantiqiy) va signal uzatish; bekor qilish AbortError beradi", async () => {
  const calls = stubFetch([() => json(200, { items: [], nextCursor: null, total: 0, totalCapped: false })]);
  await adminGet("/api/admin/generations", { status: ["FAILED", "QUEUED"], q: "", userId: null, hasError: true, unrefunded: false, limit: 50, cursor: undefined });
  assert.equal(calls[0].url, "/api/admin/generations?status=FAILED%2CQUEUED&hasError=1&unrefunded=0&limit=50");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.signal instanceof AbortSignal, true);

  const ctrl = new AbortController();
  globalThis.fetch = ((_u: string, init: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
    })) as typeof fetch;
  const p = adminGet("/api/admin/users", {}, { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, (e: unknown) => e instanceof DOMException && e.name === "AbortError");
});

test("core: adminSend JSON tana yuboradi; tanasiz DELETE Content-Type qo'shmaydi; newIdempotencyKey — UUID v4", async () => {
  const calls = stubFetch([() => json(200, { ok: true }), () => json(200, { ok: true })]);
  await adminSend("POST", "/api/admin/me/sessions/abc/revoke", {});
  await adminSend("DELETE", "/api/admin/session");
  assert.equal(calls[0].init.body, "{}");
  assert.equal(headerOf(calls[0], "content-type"), "application/json");
  assert.equal(calls[1].init.body, undefined);
  assert.equal(headerOf(calls[1], "content-type"), null);
  assert.match(newIdempotencyKey(), UUID_V4);
  assert.notEqual(newIdempotencyKey(), newIdempotencyKey());
});

test("StepUpProvider: 401 reauth dialogni ochadi; kod qabul qilinsa so'rov o'sha kalit bilan takrorlanadi", async () => {
  const calls = stubFetch([() => json(401, { code: "reauth", error: "x" }), () => json(200, { done: true })]);
  const codes: string[] = [];
  render(h(StepUpProvider, { submit: async (code: string) => void codes.push(code), children: h("p", null, "sahifa") }));
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = adminSend("POST", "/api/admin/payments/1/refund", { reason: "xato" }, { idempotencyKey: "11111111-1111-4111-8111-111111111111" });
    await tick(5);
  });
  const input = await screen.findByLabelText("Tasdiqlash kodi");
  fireEvent.change(input, { target: { value: "123456" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Tasdiqlash" }));
    await tick(10);
  });
  assert.deepEqual(await result, { done: true });
  assert.deepEqual(codes, ["123456"]);
  assert.equal(calls.length, 2);
  assert.equal(headerOf(calls[1], "idempotency-key"), "11111111-1111-4111-8111-111111111111");
  await waitFor(() => assert.ok(screen.queryByRole("dialog") === null));
});

test("StepUpProvider: dialog bekor qilinsa so'rov AdminReauthCancelledError bilan tugaydi", async () => {
  stubFetch([() => json(401, { code: "reauth", error: "x" })]);
  render(h(StepUpProvider, { submit: async () => {}, children: h("p", null, "sahifa") }));
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = adminSend("POST", "/api/admin/x", {}).catch((e: unknown) => e);
    await tick(5);
  });
  fireEvent.click(await screen.findByRole("button", { name: "Bekor qilish" }));
  assert.ok((await result) instanceof AdminReauthCancelledError);
});

/* ───────────────────────────── Toaster ───────────────────────────── */

test("Toaster: toast() xabarni polite live region ichida ko'rsatadi va yopiladi", async () => {
  render(h(Toaster));
  const region = screen.getByRole("status");
  assert.equal(region.getAttribute("aria-live"), "polite");
  await act(async () => {
    toast("Hamyon tuzatildi");
    toast("Xatolik yuz berdi", { tone: "error" });
  });
  assert.ok(within(region).getByText("Hamyon tuzatildi"));
  assert.ok(within(region).getByText("Xatolik yuz berdi"));
  fireEvent.click(within(region).getAllByRole("button", { name: "Xabarni yopish" })[0]);
  assert.ok(within(region).queryByText("Hamyon tuzatildi") === null);
  assert.ok(within(region).getByText("Xatolik yuz berdi"));
});

test("Toaster: xabar muddati o'tgach o'zi yo'qoladi", async () => {
  render(h(Toaster));
  await act(async () => {
    toast("Tez o'tadi", { durationMs: 20 });
  });
  assert.ok(screen.getByText("Tez o'tadi"));
  await waitFor(() => assert.ok(screen.queryByText("Tez o'tadi") === null));
});

/* ───────────────────────────── Phase 4 UX review fixes ───────────────────────────── */

/*
 * Finding 3 (row focus). Mutation: drop the row ring classes → fails; give the scroll area
 * tabIndex even with clickable rows → the "no region" assertion fails.
 */
test("DataTable: bosiladigan qatorda ko'rinadigan fokus halqasi; scroll maydoni o'zi fokuslanmaydi", () => {
  render(h(DataTable<Row>, { columns: COLUMNS, rows: ROWS, rowKey: (r) => r.id, caption: "Foydalanuvchilar", onRowClick: () => {} }));
  const row = document.querySelector("tr[data-row-key='a']") as HTMLElement;
  assert.equal(row.tabIndex, 0);
  const rowCls = row.className.split(/\s+/);
  for (const cls of ["focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-inset", "focus-visible:bg-muted/50"]) {
    assert.ok(rowCls.includes(cls), `qator klassi: ${cls}`);
  }
  const card = document.querySelector("li[data-card-key='a']") as HTMLElement;
  assert.ok(card.className.split(/\s+/).includes("focus-visible:ring-2"), "kartochka ham halqa oladi");
  assert.ok(!document.querySelector("[role='region']"), "qatorlar fokuslanadi — maydon tab tartibiga qo'shilmaydi");
});

/* Finding 11. Mutation: drop tabIndex/role from the scroll area → the region lookup fails. */
test("DataTable: onRowClick bo'lmasa scroll maydoni klaviatura bilan aylantiriladi (region, tabIndex, nom)", () => {
  const { rerender } = render(h(DataTable<Row>, { columns: COLUMNS, rows: ROWS, rowKey: (r) => r.id, caption: "Foydalanuvchilar" }));
  const region = screen.getByRole("region", { name: "Foydalanuvchilar" });
  assert.equal(region.tabIndex, 0);
  assert.ok(region.querySelector("table"), "region jadvalni o'rab turadi");
  assert.ok(region.className.split(/\s+/).includes("focus-visible:ring-2"), "fokus ko'rinadi");

  rerender(h(DataTable<Row>, { columns: COLUMNS, rows: ROWS, rowKey: (r) => r.id, caption: "Foydalanuvchilar", regionLabel: "Jarayonlar jadvali" }));
  assert.ok(screen.getByRole("region", { name: "Jarayonlar jadvali" }));
});

/*
 * Finding 10. Mutation: focus the reason textarea first (the old ref logic) → the
 * wallet-style amount assertion fails.
 */
test("ConfirmDialog: boshlang'ich fokus birinchi qo'shimcha maydonga (hamyon miqdori), bo'lmasa sababga", async () => {
  openConfirm({
    reason: { minLength: 5 },
    onConfirm: () => {},
    children: h("label", null, "Miqdor", h("input", { "data-testid": "amount", inputMode: "numeric" })),
  });
  await waitFor(() => assert.ok(document.activeElement === screen.getByTestId("amount"), "miqdor maydoni fokusda"));
  cleanup();

  openConfirm({ reason: { minLength: 5 }, onConfirm: () => {} });
  await waitFor(() => assert.ok(document.activeElement === screen.getByLabelText("Sabab"), "sabab fokusda"));
  cleanup();

  openConfirm({ typedConfirmation: "OK", onConfirm: () => {} });
  await waitFor(() => assert.ok(document.activeElement === screen.getByLabelText(/Tasdiqlash uchun/), "yozib tasdiqlash fokusda"));
});

/*
 * Finding 1. The sr-only data table must sit inside a clipped block: a `table` ignores the
 * 1px width / overflow of `sr-only` and widened /admin/pricing by 773 px. Mutation: put
 * `sr-only` back on the table itself → fails.
 */
test("Sparkline: ekran o'quvchi jadvali sr-only blok ichida, figura relative", () => {
  render(h(Sparkline, { values: [1, 2, 3, 40], title: "Tannarx trendi" }));
  const figure = document.querySelector("figure") as HTMLElement;
  assert.ok(figure.className.split(/\s+/).includes("relative"));
  const tableEl = figure.querySelector("table") as HTMLElement;
  assert.ok(tableEl);
  assert.ok(!tableEl.className.includes("sr-only"), "jadvalning o'zi sr-only emas");
  const wrap = tableEl.parentElement as HTMLElement;
  assert.equal(wrap.tagName, "DIV");
  assert.ok(wrap.className.split(/\s+/).includes("sr-only"));
  assert.ok(wrap.parentElement === figure);
  assert.equal(tableEl.querySelectorAll("td").length, 4);
});

/*
 * Finding 2. Badge text uses dedicated tokens whose contrast on the badge tint is computed
 * here from app/globals.css (WCAG 2.x relative luminance; 15 % tint composited over card,
 * page background and muted). Mutation: point Badge back at `text-warning`, or set
 * `--badge-warning-text` to #a16207 → fails.
 */
test("Badge: holat matni o'z tokenida va AA kontrastda (yorug' va qorong'i)", () => {
  const TOKENS = { success: "success", warning: "warning", danger: "destructive", info: "info" } as const;
  const tones = Object.keys(TOKENS) as Array<keyof typeof TOKENS>;
  for (const tone of tones) {
    render(h(Badge, { tone, children: tone }));
    const cls = screen.getByText(tone).className.split(/\s+/);
    assert.ok(cls.includes(`text-badge-${tone}-text`), `${tone}: ${cls.join(" ")}`);
    assert.ok(cls.includes(`bg-${TOKENS[tone]}/15`), `${tone} foni`);
    cleanup();
  }

  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const block = (sel: RegExp) => {
    const m = sel.exec(css);
    assert.ok(m, String(sel));
    return css.slice(m.index, css.indexOf("\n}", m.index));
  };
  const varOf = (b: string, name: string) => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(b);
    assert.ok(m, `--${name}`);
    return m[1];
  };
  for (const tone of tones) assert.match(css, new RegExp(`--color-badge-${tone}-text:\\s*var\\(--badge-${tone}-text\\)`));
  const rgb = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const [theme, b] of [["light", block(/^:root \{/m)], ["dark", block(/^\.dark \{/m)]] as const) {
    for (const tone of tones) {
      const text = rgb(varOf(b, `badge-${tone}-text`));
      const tint = rgb(varOf(b, TOKENS[tone]));
      for (const parent of ["card", "background", "muted"]) {
        const under = rgb(varOf(b, parent));
        const bg = tint.map((v, i) => v * 0.15 + under[i] * 0.85);
        const r = ratio(text, bg);
        assert.ok(r >= 4.5, `${theme} ${tone} on ${parent}: ${r.toFixed(2)}:1`);
      }
    }
  }
});
