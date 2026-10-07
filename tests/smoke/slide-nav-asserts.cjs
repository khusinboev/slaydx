/* eslint-disable @typescript-eslint/no-require-imports -- standalone Node script (CommonJS) */
/**
 * The assertions of `slide-nav.cjs` (T1): real touch taps (`page.touchscreen`) and swipes / pinch (CDP
 * `Input.dispatchTouchEvent`) in the enlarged («To‘liq ekran») slide mode, on phones and desktop.
 *
 * The laptop is often saturated by other jobs, so every expectation POLLS (up to a few seconds) instead of
 * sleeping a fixed time; a "stays put" expectation waits a fixed 700 ms and then reads.
 */
const path = require("node:path");

const PHONES = [
  { name: "360x740", viewport: { width: 360, height: 740 }, dark: false },
  { name: "390x844", viewport: { width: 390, height: 844 }, dark: true },
];

const ERR_IGNORED = /favicon|Hydration|net::ERR/;
const errorsOf = (errors) => errors.filter((e) => !ERR_IGNORED.test(e));

async function shot(page, outDir, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

/** Polls the slide counter until it equals `want` (or `ms` pass); returns what it last read. */
async function waitIdx(page, counter, want, ms = 2500) {
  const end = Date.now() + ms;
  let got = await counter(page);
  while (got !== want && Date.now() < end) {
    await page.waitForTimeout(80);
    got = await counter(page);
  }
  return got;
}

/** Waits a fixed time and reads — for "does NOT move" expectations. */
async function settledIdx(page, counter, ms = 700) {
  await page.waitForTimeout(ms);
  return counter(page);
}

async function phone(ctx, cfg) {
  const { browser, open, openPresent, counter, swipe, pinch, check, warn, outDir } = ctx;
  const tag = cfg.name;
  const { context, page, cdp, errors } = await open(browser, tag, cfg.viewport, { touch: true, tg: true, dark: cfg.dark });
  const W = cfg.viewport.width;
  const H = cfg.viewport.height;
  const y = Math.round(H / 2);

  const moves = async (label, action, want) => {
    await action();
    const got = await waitIdx(page, counter, want);
    check(`${tag} ${label}`, got === want, `expected ${want}, at ${got}`);
  };
  const stays = async (label, action, want) => {
    await action();
    const got = await settledIdx(page, counter);
    check(`${tag} ${label}`, got === want, `expected ${want}, at ${got}`);
  };
  /** A real touch tap on a bar button; one retry (reported as a WARN) because a loaded machine can lose a click. */
  const tapButton = async (label, locator, want) => {
    await locator.tap();
    let got = await waitIdx(page, counter, want, 1500);
    if (got !== want) {
      warn(`${tag} ${label}: first touch tap produced no click on a loaded machine (retrying)`);
      await locator.tap();
      got = await waitIdx(page, counter, want, 2500);
    }
    check(`${tag} ${label}`, got === want, `expected ${want}, at ${got}`);
  };

  // ── inline viewer first: a swipe on the small slide must not navigate, double tap still edits ──
  const pageLabel = () => page.locator("[data-slide-page]").first().textContent();
  const inline = await page.locator('[data-slide-stage="fit"]').boundingBox();
  const before = await pageLabel();
  await swipe(cdp, { x: inline.x + inline.width * 0.8, y: inline.y + inline.height / 2 }, { x: inline.x + inline.width * 0.2, y: inline.y + inline.height / 2 });
  await page.waitForTimeout(500);
  check(`${tag} inline viewer: a swipe on the stage does not change the slide`, (await pageLabel()) === before, `${before} -> ${await pageLabel()}`);

  const title = page.locator('[data-slide-frame] [data-src=\'{"f":"title"}\']').first();
  if (await title.count()) {
    const b = await title.boundingBox();
    if (b) {
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(120);
      await page.touchscreen.tap(cx, cy);
      await page.waitForSelector("[data-edit-key]", { timeout: 3000 }).catch(() => {});
      check(`${tag} inline viewer: double tap still opens the text editor`, (await page.locator("[data-edit-key]").count()) > 0);
      await shot(page, outDir, `${tag}-inline-editing`);
      // Leave the editor without saving anything.
      const done = page.getByText("Tayyor", { exact: true }).first();
      if (await done.count()) await done.tap();
      await page.waitForTimeout(500);
    }
  }

  // ── enlarged mode ──
  await openPresent(page);
  check(`${tag} enlarged: starts on slide 1`, (await counter(page)) === 1);
  const stage = await page.locator('[data-slide-stage="present"]').boundingBox();
  const rx = stage.x + stage.width * 0.85;
  const lx = stage.x + stage.width * 0.15;
  const mx = stage.x + stage.width * 0.5;
  const sx = (f) => stage.x + stage.width * f;
  await shot(page, outDir, `${tag}-present-1`);

  await moves("tap right → next (1→2)", () => page.touchscreen.tap(rx, y), 2);
  await moves("tap right again → exactly one more step (2→3, not 2→4)", () => page.touchscreen.tap(rx, y), 3);
  await moves("tap LEFT → previous (3→2)", () => page.touchscreen.tap(lx, y), 2);
  await shot(page, outDir, `${tag}-present-after-left-tap`);
  await moves("tap middle → advances like before (2→3)", () => page.touchscreen.tap(mx, y), 3);

  await moves("swipe RIGHT → previous (3→2)", () => swipe(cdp, { x: sx(0.3), y }, { x: sx(0.8), y }), 2);
  await moves("swipe LEFT → next (2→3)", () => swipe(cdp, { x: sx(0.8), y }, { x: sx(0.3), y }), 3);
  check(`${tag} the swipes did not close the enlarged mode (no history swipe)`, (await page.locator('[data-slide-stage="present"]').count()) === 1);
  await stays("vertical drag → no navigation", () => swipe(cdp, { x: sx(0.8), y: y - 120 }, { x: sx(0.7), y: y + 160 }), 3);
  await stays("a 25 px drag → no navigation", () => swipe(cdp, { x: sx(0.5), y }, { x: sx(0.5) + 25, y }), 3);
  await stays("pinch → no navigation", () => pinch(cdp, { x: sx(0.5), y }, 40, 130), 3);
  check(`${tag} …and the page was not left or closed`, (await page.locator('[data-slide-stage="present"]').count()) === 1);

  // Ends: first and last stay put.
  await moves("swipe right ×2 reaches slide 1", async () => {
    await swipe(cdp, { x: sx(0.3), y }, { x: sx(0.8), y });
    await waitIdx(page, counter, 2);
    await swipe(cdp, { x: sx(0.3), y }, { x: sx(0.8), y });
  }, 1);
  await stays("swipe right on slide 1 stays on 1", () => swipe(cdp, { x: sx(0.3), y }, { x: sx(0.8), y }), 1);
  await stays("tap left on slide 1 stays on 1 (no wrap)", () => page.touchscreen.tap(lx, y), 1);
  await moves("taps right reach the last slide (9)", async () => {
    for (let k = 1; k < 9; k++) {
      await page.touchscreen.tap(rx, y);
      await waitIdx(page, counter, k + 1);
    }
  }, 9);
  await stays("on the last slide a right tap stays on 9 (no wrap)", () => page.touchscreen.tap(rx, y), 9);
  await stays("on the last slide a swipe left stays on 9 (no wrap)", () => swipe(cdp, { x: sx(0.8), y }, { x: sx(0.3), y }), 9);
  await shot(page, outDir, `${tag}-present-last`);

  // Visible controls: real touch taps on the 44 px buttons.
  const prev = page.getByLabel("Oldingi slayd");
  const next = page.getByLabel("Keyingi slayd");
  const pb = await prev.boundingBox();
  const nb = await next.boundingBox();
  check(`${tag} prev/next buttons are ≥ 44 px`, pb.width >= 44 && pb.height >= 44 && nb.width >= 44 && nb.height >= 44, `${pb.width}x${pb.height}, ${nb.width}x${nb.height}`);
  check(`${tag} next button is disabled on the last slide`, await next.isDisabled());
  await tapButton("visible ‹ button (touch) → previous (9→8)", prev, 8);
  await tapButton("visible › button (touch) → next (8→9)", next, 9);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${tag} no horizontal overflow`, overflow <= 0, `scrollWidth - innerWidth = ${overflow}`);
  const cb = await page.locator("[data-slide-counter]").boundingBox();
  check(`${tag} the bar fits the screen`, cb.x >= 0 && nb.x + nb.width <= W + 0.5);

  // Keys still work (hardware keyboard on a phone / tablet).
  await moves("ArrowLeft key still goes back (9→8)", () => page.keyboard.press("ArrowLeft"), 8);

  // Telegram stub: vertical swipes were disabled; the phone's Back closes the enlarged mode first.
  check(`${tag} Telegram vertical swipe disabled (stub saw disableVerticalSwipes)`, (await page.evaluate(() => window.__tg.vertical)) >= 1);
  await page.evaluate(() => window.history.back());
  await page.waitForSelector('[data-slide-stage="present"]', { state: "detached", timeout: 3000 }).catch(() => {});
  check(`${tag} phone Back closes the enlarged mode first`, (await page.locator('[data-slide-stage="present"]').count()) === 0);
  check(`${tag} …and stays on the result page`, new URL(page.url()).pathname.startsWith("/uz/files/"));
  check(`${tag} no page errors`, errorsOf(errors).length === 0, errorsOf(errors).join(" | ").slice(0, 300));
  await context.close();
}

async function desktop(ctx) {
  const { browser, open, counter, check, outDir } = ctx;
  const tag = "1366x768";
  const { context, page, errors } = await open(browser, tag, { width: 1366, height: 768 }, { touch: false, tg: false, dark: false });
  await page.getByLabel("To‘liq ekran").first().click();
  await page.waitForSelector('[data-slide-stage="present"]');
  await page.waitForTimeout(400);
  const stage = await page.locator('[data-slide-stage="present"]').boundingBox();
  const y = stage.y + stage.height / 2;
  const moves = async (label, action, want) => {
    await action();
    const got = await waitIdx(page, counter, want);
    check(`${tag} ${label}`, got === want, `expected ${want}, at ${got}`);
  };
  await moves("mouse click in the LEFT third still advances (old behaviour, no zones for the mouse)", () => page.mouse.click(stage.x + stage.width * 0.1, y), 2);
  await moves("mouse click right advances", () => page.mouse.click(stage.x + stage.width * 0.9, y), 3);
  await moves("ArrowLeft goes back", () => page.keyboard.press("ArrowLeft"), 2);
  await moves("visible ‹ button (mouse) goes back", () => page.getByLabel("Oldingi slayd").click(), 1);
  check(`${tag} ‹ disabled on slide 1`, await page.getByLabel("Oldingi slayd").isDisabled());
  await moves("visible › button (mouse) goes forward", () => page.getByLabel("Keyingi slayd").click(), 2);
  await page.screenshot({ path: path.join(outDir, `${tag}-present.png`) });
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-slide-stage="present"]', { state: "detached", timeout: 3000 }).catch(() => {});
  check(`${tag} Escape closes the enlarged mode`, (await page.locator('[data-slide-stage="present"]').count()) === 0);
  check(`${tag} no page errors`, errorsOf(errors).length === 0, errorsOf(errors).join(" | ").slice(0, 300));
  await context.close();
}

async function run(ctx) {
  for (const cfg of PHONES) await phone(ctx, cfg);
  await desktop(ctx);
}

module.exports = { run };
