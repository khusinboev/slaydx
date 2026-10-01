import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysIso,
  daysInMonth,
  diffDaysIso,
  fmtBytes,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtIsoDate,
  fmtNumber,
  fmtPercent,
  fmtRelative,
  fmtSoum,
  fmtTanga,
  fmtUsd,
  isIsoDate,
  todayTashkent,
} from "../lib/admin-format.ts";

const NB = " ";

test("fmtNumber: guruhlash NBSP bilan, kasr vergul bilan, bo'sh qiymat — tire", () => {
  assert.equal(fmtNumber(0), "0");
  assert.equal(fmtNumber(999), "999");
  assert.equal(fmtNumber(1234), `1${NB}234`);
  assert.equal(fmtNumber(1234567), `1${NB}234${NB}567`);
  assert.equal(fmtNumber(-1234567), `-1${NB}234${NB}567`);
  assert.equal(fmtNumber(1234.5, { digits: 2 }), `1${NB}234,5`);
  assert.equal(fmtNumber(1234.5, { digits: 2, fixed: true }), `1${NB}234,50`);
  assert.equal(fmtNumber(0.256, { digits: 1 }), "0,3");
  assert.equal(fmtNumber(1234567.8), `1${NB}234${NB}568`);
  assert.equal(fmtNumber(null), "—");
  assert.equal(fmtNumber(undefined), "—");
  assert.equal(fmtNumber(Number.NaN), "—");
  assert.equal(fmtNumber(Number.POSITIVE_INFINITY), "—");
});

test("fmtNumber: -0 va +0 chiqmaydi, sign faqat musbatga", () => {
  assert.equal(fmtNumber(-0.4), "0");
  assert.equal(fmtNumber(0, { sign: true }), "0");
  assert.equal(fmtNumber(12, { sign: true }), "+12");
  assert.equal(fmtNumber(-12, { sign: true }), "-12");
});

test("fmtSoum / fmtTanga / fmtUsd / fmtPercent", () => {
  assert.equal(fmtSoum(1500000), `1${NB}500${NB}000${NB}so'm`);
  assert.equal(fmtTanga(6000), `6${NB}000${NB}tanga`);
  assert.equal(fmtSoum(null), "—");
  assert.equal(fmtUsd(0), "$0,00");
  assert.equal(fmtUsd(12.3), "$12,30");
  assert.equal(fmtUsd(1234.567), `$1${NB}234,57`);
  assert.equal(fmtUsd(0.0024), "$0,0024", "juda kichik AI xarajati 4 xonagacha");
  assert.equal(fmtUsd(-3.5), "-$3,50");
  assert.equal(fmtUsd(1.5, 0), "$2");
  assert.equal(fmtPercent(12.5), "12,5%");
  assert.equal(fmtPercent(12), "12%");
  assert.equal(fmtPercent(8.04, { sign: true }), "+8%");
  assert.equal(fmtPercent(-0.44, { digits: 2, sign: true }), "-0,44%");
  assert.equal(fmtPercent(null), "—");
});

test("fmtDateTime / fmtDate: Asia/Tashkent (UTC+5), brauzer tiliga bog'liq emas", () => {
  assert.equal(fmtDateTime("2026-10-01T10:40:00Z"), "01.10.2026 15:40");
  assert.equal(fmtDate("2026-10-01T10:40:00Z"), "01.10.2026");
  // UTC kechasi Toshkentda ertasi kun.
  assert.equal(fmtDateTime("2026-12-31T19:30:00Z"), "01.01.2027 00:30");
  assert.equal(fmtDate("2026-12-31T19:30:00Z"), "01.01.2027");
  // epoch (ms) va Date ham qabul qilinadi.
  assert.equal(fmtDateTime(Date.UTC(2026, 0, 5, 7, 5)), "05.01.2026 12:05");
  assert.equal(fmtDateTime(new Date(Date.UTC(2026, 0, 5, 7, 5))), "05.01.2026 12:05");
  assert.equal(fmtDateTime(null), "—");
  assert.equal(fmtDateTime("nonsense"), "—");
  assert.equal(fmtDate(""), "—");
});

test("fmtIsoDate: kalendar kuni DD.MM.YYYY ga o'giriladi", () => {
  assert.equal(fmtIsoDate("2026-02-09"), "09.02.2026");
  assert.equal(fmtIsoDate("2026-02-30"), "—");
  assert.equal(fmtIsoDate(null), "—");
});

test("fmtRelative: o'tgan va kelasi vaqt, 30 kundan keyin to'liq sana", () => {
  const now = Date.UTC(2026, 9, 1, 10, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(fmtRelative(ago(3_000), now), "hozirgina");
  assert.equal(fmtRelative(ago(42_000), now), "42 soniya oldin");
  assert.equal(fmtRelative(ago(5 * 60_000), now), "5 daqiqa oldin");
  assert.equal(fmtRelative(ago(3 * 3_600_000), now), "3 soat oldin");
  assert.equal(fmtRelative(ago(2 * 86_400_000), now), "2 kun oldin");
  assert.equal(fmtRelative(ago(60 * 86_400_000), now), fmtDate(ago(60 * 86_400_000)));
  assert.equal(fmtRelative(new Date(now + 5 * 60_000), now), "5 daqiqadan keyin");
  assert.equal(fmtRelative(new Date(now + 2 * 3_600_000), now), "2 soatdan keyin");
  assert.equal(fmtRelative(null, now), "—");
});

test("fmtBytes", () => {
  assert.equal(fmtBytes(0), `0${NB}B`);
  assert.equal(fmtBytes(512), `512${NB}B`);
  assert.equal(fmtBytes(1536), `1,5${NB}KB`);
  assert.equal(fmtBytes(5 * 1024 * 1024), `5${NB}MB`);
  assert.equal(fmtBytes(200 * 1024 ** 3), `200${NB}GB`);
  assert.equal(fmtBytes(-1), "—");
  assert.equal(fmtBytes(null), "—");
});

test("fmtDuration", () => {
  assert.equal(fmtDuration(0), "0 s");
  assert.equal(fmtDuration(42), "42 s");
  assert.equal(fmtDuration(59.6), "1 daq 00 s");
  assert.equal(fmtDuration(192), "3 daq 12 s");
  assert.equal(fmtDuration(3725), "1 soat 02 daq");
  assert.equal(fmtDuration(90_000), "1 kun 1 soat");
  assert.equal(fmtDuration(-5), "—");
  assert.equal(fmtDuration(undefined), "—");
});

test("Toshkent kalendar kunlari: today, siljitish, farq, oy kunlari", () => {
  // 19:30 UTC = 00:30 Toshkent ertasi kuni.
  assert.equal(todayTashkent(Date.UTC(2026, 11, 31, 19, 30)), "2027-01-01");
  assert.equal(todayTashkent(Date.UTC(2026, 11, 31, 18, 59)), "2026-12-31");
  assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysIso("2024-03-01", -1), "2024-02-29");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
  assert.equal(diffDaysIso("2026-09-01", "2026-09-30"), 29);
  assert.equal(diffDaysIso("2026-01-01", "2027-01-01"), 365);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.ok(isIsoDate("2026-02-28"));
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("2026-2-3"));
  assert.ok(!isIsoDate("26-02-03"));
});
