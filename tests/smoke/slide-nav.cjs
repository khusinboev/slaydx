/* eslint-disable @typescript-eslint/no-require-imports -- standalone Node script (CommonJS, like scripts/smoke/gpu-launch.cjs) */
/**
 * Browser smoke for slide navigation in the enlarged («To‘liq ekran») mode — T1, todo sprint 2026-10-07.
 *
 * Real Chromium, Telegram Mini App stub, REAL touch input: taps through `page.touchscreen`,
 * swipes through CDP `Input.dispatchTouchEvent` (Playwright has no swipe API).
 *
 *   node tests/smoke/slide-nav.cjs <baseUrl> <session-token> <generationId> <outDir> [--measure]
 *
 *   PW_CORE=/path/to/node_modules/playwright-core   (else resolved normally)
 *   CHROME=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
 *
 * Seed first with `tests/smoke/slide-nav-seed.mts` (test database only). `--measure` only prints what
 * fires (baseline diagnosis); without it the script ASSERTS the contract and exits 1 on any failure.
 */
const fs = require("node:fs");
const path = require("node:path");

const [baseUrl, token, genId, outDir] = process.argv.slice(2);
const MEASURE = process.argv.includes("--measure");
if (!baseUrl || !token || !genId || !outDir) {
  console.error("usage: node tests/smoke/slide-nav.cjs <baseUrl> <token> <generationId> <outDir> [--measure]");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const { chromium } = require(process.env.PW_CORE || "playwright-core");
const { launchGpu } = require("../../scripts/smoke/gpu-launch.cjs");
const executablePath =
  process.env.CHROME || path.join(process.env.HOME, ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome");

/** Minimal Telegram Mini App stub: the page counts as a genuine Mini App and records the bridge calls. */
const TG_STUB = `
(() => {
  window.__tg = { vertical: 0, back: [] };
  window.TelegramWebviewProxy = { postEvent() {} };
  let backCb = null;
  window.Telegram = { WebApp: {
    initData: "", version: "9.0", isExpanded: true,
    ready() {}, expand() {}, isVersionAtLeast() { return true; },
    disableVerticalSwipes() { window.__tg.vertical++; },
    setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
    onEvent() {}, offEvent() {},
    BackButton: {
      show() { window.__tg.back.push("show"); }, hide() { window.__tg.back.push("hide"); },
      onClick(cb) { backCb = cb; }, offClick() { backCb = null; },
    },
  } };
  window.__tgBack = () => backCb && backCb();
  // Event log — which handlers actually fire on the stage.
  window.__ev = [];
  for (const t of ["pointerdown", "pointerup", "pointercancel", "click", "touchstart", "touchend", "touchcancel"]) {
    window.addEventListener(t, (e) => window.__ev.push(t + (e.pointerType ? ":" + e.pointerType : "")), true);
  }
})();
`;

const results = [];
const warnings = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
function warn(msg) {
  warnings.push(msg);
  console.log(`WARN  ${msg}`);
}

async function counter(page) {
  // Enlarged mode: the top bar shows «i / n».
  const t = await page.locator("[data-slide-counter]").first().textContent({ timeout: 3000 }).catch(() => null);
  const m = /(\d+)\s*\/\s*(\d+)/.exec(t || "");
  return m ? Number(m[1]) : null;
}

async function swipe(cdp, from, to, { steps = 8, stepMs = 12 } = {}) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let k = 1; k <= steps; k++) {
    const x = from.x + ((to.x - from.x) * k) / steps;
    const y = from.y + ((to.y - from.y) * k) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
    await new Promise((r) => setTimeout(r, stepMs));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((r) => setTimeout(r, 250));
}

async function pinch(cdp, c, from, to, steps = 6) {
  const pts = (d) => [
    { x: c.x - d, y: c.y, id: 1 },
    { x: c.x + d, y: c.y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(from) });
  for (let k = 1; k <= steps; k++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(from + ((to - from) * k) / steps) });
    await new Promise((r) => setTimeout(r, 12));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((r) => setTimeout(r, 250));
}

async function openPresent(page) {
  await page.getByLabel("To‘liq ekran").first().tap();
  await page.waitForSelector('[data-slide-stage="present"]', { timeout: 5000 });
  await page.waitForTimeout(300);
}

async function open(browser, label, viewport, { touch = true, tg = true, dark = false } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: touch ? 3 : 1,
    isMobile: touch,
    hasTouch: touch,
    colorScheme: dark ? "dark" : "light",
    locale: "uz-UZ",
  });
  await context.addCookies([{ name: "slaydx_session", value: token, url: baseUrl }]);
  if (tg) await context.addInitScript(TG_STUB);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${baseUrl}/uz/files/${genId}${tg ? "#tgWebAppData=stub" : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-slide-stage]", { timeout: 60_000 });
  await page.waitForTimeout(800);
  const cdp = touch ? await context.newCDPSession(page) : null;
  return { context, page, cdp, errors, label };
}

async function measure(browser, label, viewport) {
  const { context, page, cdp } = await open(browser, label, viewport);
  await openPresent(page);
  const rect = await page.locator('[data-slide-stage="present"]').boundingBox();
  const W = rect.width;
  const y = rect.y + rect.height / 2;
  console.log(`\n== ${label} — stage ${Math.round(rect.width)}x${Math.round(rect.height)}; start index ${await counter(page)}`);
  const probe = async (what, fn) => {
    await page.evaluate(() => (window.__ev.length = 0));
    const before = await counter(page);
    await fn();
    await page.waitForTimeout(250);
    const after = await counter(page);
    const ev = await page.evaluate(() => window.__ev.join(" "));
    const st = await page.evaluate(() => ({ stage: document.querySelector("[data-slide-stage]")?.getAttribute("data-slide-stage"), path: location.pathname, fs: Boolean(document.fullscreenElement) }));
    console.log(`${what.padEnd(26)} ${before} -> ${after}   events: ${ev}   state: ${JSON.stringify(st)}`);
    return { before, after };
  };
  await probe("tap right (x=85%)", () => page.touchscreen.tap(rect.x + W * 0.85, y));
  await probe("tap right (x=85%)", () => page.touchscreen.tap(rect.x + W * 0.85, y));
  await probe("tap left  (x=15%)", () => page.touchscreen.tap(rect.x + W * 0.15, y));
  await probe("tap middle (x=50%)", () => page.touchscreen.tap(rect.x + W * 0.5, y));
  await probe("swipe right (to prev)", () => swipe(cdp, { x: rect.x + W * 0.3, y }, { x: rect.x + W * 0.8, y }));
  await probe("swipe left  (to next)", () => swipe(cdp, { x: rect.x + W * 0.8, y }, { x: rect.x + W * 0.3, y }));
  await page.screenshot({ path: path.join(outDir, `measure-${label}.png`) });
  await context.close();
}

(async () => {
  const browser = await launchGpu(chromium, { executablePath });
  try {
    if (MEASURE) {
      await measure(browser, "390x844", { width: 390, height: 844 });
      await measure(browser, "360x740", { width: 360, height: 740 });
    } else {
      const mod = require("./slide-nav-asserts.cjs");
      await mod.run({ browser, open, openPresent, counter, swipe, pinch, check, warn, outDir, baseUrl, genId });
    }
  } finally {
    await browser.close();
  }
  if (!MEASURE) {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${warnings.length} warning(s)`);
    process.exit(failed.length ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
