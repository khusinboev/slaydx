// End-to-end reproduction of a webview that refuses cookies (docs/auth/COOKIELESS.md).
//
// A tiny reverse proxy in front of the app removes every `Set-Cookie` header,
// so the browser never holds our session cookie — the observable behaviour of
// the Telegram Desktop webview in the owner's report. Chromium opens
// `/uz?bt=<link>` through the proxy, taps «Kirish», then visits the consumer
// pages and records every `/api/*` status and whether it carried a bearer.
//
// Usage (the repo has no Playwright dependency; pass playwright-core yourself):
//   PW_CORE=<dir of playwright-core> CHROME=<chrome binary> UPSTREAM=http://127.0.0.1:3917 \
//   BT=<signed bot link> USER_NAME=<expected display name> OUT=<screenshot dir> \
//   node scripts/smoke/cookieless-login.cjs
// Exit code 0 = no cookie in the jar, signed in, and no consumer page got a 401.
/* eslint-disable @typescript-eslint/no-require-imports -- plain Node CommonJS smoke script, run outside the app bundle. */

const http = require("node:http");
const { chromium } = require(process.env.PW_CORE || "playwright-core");
const { launchGpu } = require("./gpu-launch.cjs");

const UPSTREAM = new URL(process.env.UPSTREAM || "http://127.0.0.1:3917");
const PORT = Number(process.env.PROXY_PORT || 3918);
const BASE = `http://127.0.0.1:${PORT}`;
const BT = process.env.BT;
const NAME = process.env.USER_NAME || "Sinov";
const OUT = process.env.OUT || ".";
const PAGES = ["/uz", "/uz/files", "/uz/wallet", "/uz/profile", "/uz/create"];

let stripped = 0;
function startProxy() {
  const server = http.createServer((req, res) => {
    const up = http.request(
      { host: UPSTREAM.hostname, port: UPSTREAM.port, path: req.url, method: req.method, headers: req.headers },
      (r) => {
        const headers = { ...r.headers };
        if (headers["set-cookie"]) {
          stripped += headers["set-cookie"].length;
          delete headers["set-cookie"];
        }
        res.writeHead(r.statusCode || 502, headers);
        r.pipe(res);
      },
    );
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

async function main() {
  if (!BT) throw new Error("BT is required");
  const proxy = await startProxy();
  const browser = await launchGpu(chromium, { executablePath: process.env.CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  const api = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) {
      api.push({ path: `${r.request().method()} ${u.pathname}`, status: r.status(), bearer: Boolean(r.request().headers().authorization) });
    }
  });

  await page.goto(`${BASE}/uz?bt=${encodeURIComponent(BT)}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("[data-bot-login-go]", { timeout: 60_000 });
  await page.click("[data-bot-login-go]");
  await page.waitForTimeout(4000);

  const results = [];
  for (const p of PAGES) {
    const before = api.length;
    await page.goto(`${BASE}${p}`, { waitUntil: "load", timeout: 120_000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    const calls = api.slice(before);
    results.push({
      page: p,
      showsUser: text.includes(NAME),
      unauthorized: calls.filter((c) => c.status === 401).map((c) => c.path),
      bearerCalls: calls.filter((c) => c.bearer).length,
      calls: calls.length,
    });
    await page.screenshot({ path: `${OUT}/cookieless${p.replace(/\//g, "_")}.png` });
  }
  const cookies = await context.cookies();
  const report = {
    strippedSetCookie: stripped,
    cookiesInJar: cookies.map((c) => c.name),
    loginCalls: api.filter((c) => c.path.includes("/api/auth/")),
    results,
  };
  console.log(JSON.stringify(report));
  await browser.close();
  proxy.close();
  const profile = results.find((r) => r.page === "/uz/profile");
  const ok = cookies.length === 0 && results.every((r) => r.unauthorized.length === 0) && Boolean(profile && profile.showsUser);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
