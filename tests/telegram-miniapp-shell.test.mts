import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure Mini App shell rules (`lib/telegram-miniapp.ts`, docs/mobile/PLAN.md
 * O6/O8, R5 §3.G): page colour → Telegram's `#RRGGBB`, version gates for the
 * header / background / bottom bar, safe-area CSS variables with `env()`
 * fallbacks, and the shell store that decides whether the in-app «←» hides.
 */

const {
  normalizeHexColor,
  telegramChromeColors,
  safeAreaCssVars,
  SAFE_AREA_CSS_VARS,
  clientSupports,
  getMiniAppShellState,
  getServerMiniAppShellState,
  setMiniAppShellState,
  subscribeMiniAppShell,
  shouldHideInAppBack,
} = await import("../lib/telegram-miniapp.ts");

const upTo = (max: string) => (v: string) => {
  const [a1, a2 = 0] = v.split(".").map(Number);
  const [b1, b2 = 0] = max.split(".").map(Number);
  return a1! < b1! || (a1 === b1 && a2 <= b2);
};

test("normalizeHexColor: hex and opaque rgb only, lower-case #rrggbb", () => {
  assert.equal(normalizeHexColor("#FAF5EE"), "#faf5ee");
  assert.equal(normalizeHexColor("  #faf5ee "), "#faf5ee", "custom property values keep their leading space");
  assert.equal(normalizeHexColor("#abc"), "#aabbcc");
  assert.equal(normalizeHexColor("rgb(18, 16, 20)"), "#121014");
  assert.equal(normalizeHexColor("rgb(250 245 238)"), "#faf5ee");
  assert.equal(normalizeHexColor("rgba(18, 16, 20, 1)"), "#121014");
  assert.equal(normalizeHexColor("rgba(0, 0, 0, 0)"), null, "transparent body background is not a colour");
  assert.equal(normalizeHexColor("rgba(18, 16, 20, 0.5)"), null);
  assert.equal(normalizeHexColor("rgb(256, 0, 0)"), null);
  assert.equal(normalizeHexColor("#faf5e"), null);
  assert.equal(normalizeHexColor("oklch(0.9 0.02 80)"), null);
  assert.equal(normalizeHexColor("bg_color"), null);
  assert.equal(normalizeHexColor(""), null);
  assert.equal(normalizeHexColor(null), null);
});

test("telegramChromeColors: each member behind its Bot API version", () => {
  const all = telegramChromeColors("#FAF5EE", upTo("8.0"));
  assert.deepEqual(all, { header: "#faf5ee", background: "#faf5ee", bottomBar: "#faf5ee" });
  // 7.9: no setBottomBarColor (7.10).
  assert.deepEqual(telegramChromeColors("#faf5ee", upTo("7.9")), { header: "#faf5ee", background: "#faf5ee", bottomBar: null });
  // 6.8: header only takes Telegram's colour keys before 6.9 → skipped.
  assert.deepEqual(telegramChromeColors("#faf5ee", upTo("6.8")), { header: null, background: "#faf5ee", bottomBar: null });
  assert.deepEqual(telegramChromeColors("#faf5ee", upTo("6.0")), { header: null, background: null, bottomBar: null });
  assert.deepEqual(telegramChromeColors("not-a-colour", upTo("8.0")), { header: null, background: null, bottomBar: null });
  assert.deepEqual(telegramChromeColors("#faf5ee", undefined), { header: null, background: null, bottomBar: null });
  const throwing = () => {
    throw new Error("WebAppMethodUnsupported");
  };
  assert.deepEqual(telegramChromeColors("#faf5ee", throwing), { header: null, background: null, bottomBar: null });
});

test("clientSupports: dotted versions, missing or throwing check is false", () => {
  assert.equal(clientSupports(upTo("7.7"), "7.7"), true);
  assert.equal(clientSupports(upTo("7.6"), "7.7"), false);
  assert.equal(clientSupports(upTo("7.10"), "7.7"), true, "7.10 > 7.7");
  assert.equal(clientSupports(undefined, "6.1"), false);
  assert.equal(clientSupports(() => "yes" as unknown as boolean, "6.1"), false, "only a real true counts");
});

test("safeAreaCssVars: Telegram px when known, env() / 0px fallbacks otherwise", () => {
  assert.deepEqual(SAFE_AREA_CSS_VARS, [
    "--tg-safe-top",
    "--tg-safe-bottom",
    "--tg-safe-left",
    "--tg-safe-right",
    "--tg-content-safe-top",
    "--tg-content-safe-bottom",
  ]);
  assert.deepEqual(safeAreaCssVars({ top: 47, bottom: 34, left: 0, right: 0 }, { top: 56, bottom: 0 }), {
    "--tg-safe-top": "47px",
    "--tg-safe-bottom": "34px",
    "--tg-safe-left": "0px",
    "--tg-safe-right": "0px",
    "--tg-content-safe-top": "56px",
    "--tg-content-safe-bottom": "0px",
  });
  assert.deepEqual(safeAreaCssVars(null, null), {
    "--tg-safe-top": "env(safe-area-inset-top, 0px)",
    "--tg-safe-bottom": "env(safe-area-inset-bottom, 0px)",
    "--tg-safe-left": "env(safe-area-inset-left, 0px)",
    "--tg-safe-right": "env(safe-area-inset-right, 0px)",
    "--tg-content-safe-top": "0px",
    "--tg-content-safe-bottom": "0px",
  });
  // Garbage per side falls back per side; fractions round.
  const v = safeAreaCssVars({ top: "x", bottom: 33.6, left: -4, right: Number.NaN }, { top: "12" });
  assert.equal(v["--tg-safe-top"], "env(safe-area-inset-top, 0px)");
  assert.equal(v["--tg-safe-bottom"], "34px");
  assert.equal(v["--tg-safe-left"], "env(safe-area-inset-left, 0px)");
  assert.equal(v["--tg-safe-right"], "env(safe-area-inset-right, 0px)");
  assert.equal(v["--tg-content-safe-top"], "12px");
  assert.equal(v["--tg-content-safe-bottom"], "0px");
});

test("shell store + shouldHideInAppBack: hides only in an active Mini App whose BackButton works or is being set up", () => {
  setMiniAppShellState(null);
  assert.equal(shouldHideInAppBack(getServerMiniAppShellState()), false, "server / hydration never hides");
  assert.equal(shouldHideInAppBack(getMiniAppShellState()), false, "browser");

  let notified = 0;
  const off = subscribeMiniAppShell(() => notified++);
  setMiniAppShellState({ active: true, backButton: "pending" });
  assert.equal(notified, 1);
  assert.equal(shouldHideInAppBack(getMiniAppShellState()), true, "script still loading: Telegram's button is coming");
  setMiniAppShellState({ backButton: true });
  assert.equal(shouldHideInAppBack(getMiniAppShellState()), true);
  setMiniAppShellState({ backButton: true });
  assert.equal(notified, 2, "no-op update does not notify");
  setMiniAppShellState({ backButton: false });
  assert.equal(shouldHideInAppBack(getMiniAppShellState()), false, "no working BackButton: keep the «←»");

  // Inactive ⇒ never hides, whatever backButton says.
  setMiniAppShellState({ active: false, backButton: true });
  assert.deepEqual(getMiniAppShellState(), { active: false, backButton: false });
  assert.equal(shouldHideInAppBack({ active: false, backButton: true }), false);
  assert.equal(shouldHideInAppBack({ active: true, backButton: false }), false);
  off();
  setMiniAppShellState({ active: true, backButton: true });
  assert.equal(notified, 4, "unsubscribed listener is not called (4 before off)");
  setMiniAppShellState(null);
  assert.equal(getMiniAppShellState(), getServerMiniAppShellState(), "reset returns the stable inactive snapshot");
});
