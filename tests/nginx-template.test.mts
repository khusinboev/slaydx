import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * INFRA-11: nginx sozlamalari ilgari REPO'DA UMUMAN YO'Q edi — faqat
 * prod host'da qo'lda tahrirlanardi, hech qanday nusxasi/diffi yo'q edi.
 * `deploy/nginx/slaydx.conf.example` endi shablon sifatida repo'da —
 * bu test uni asosiy talablarga (yuklash chegarasi, uzoq route timeout,
 * proxy sarlavhalari, HSTS) qarshi qulflaydi, haqiqiy `/etc/nginx/
 * sites-available/slaydx` bilan qo'lda solishtirilishini talab qilmaydi.
 *
 * Mutatsiya: `client_max_body_size 32m;` qatorini olib tashlang yoki
 * `20m`ga tushiring — birinchi/ikkinchi assertion qizaradi
 * (`SOURCE_MAX_BYTES`/`TEMPLATE_MAX_BYTES` = 20 MB dan YUQORI bo'lishi
 * shart, aks holda nginx o'zi ilovaning aniq xatosidan OLDIN rad etadi).
 */
test("nginx shabloni: yuklash chegarasi ilova limitidan (20 MB) yuqori", () => {
  const conf = readFileSync(new URL("../deploy/nginx/slaydx.conf.example", import.meta.url), "utf8");
  const m = conf.match(/client_max_body_size\s+(\d+)m;/);
  assert.ok(m, "client_max_body_size topilmadi");
  assert.ok(Number(m![1]) >= 21, `client_max_body_size ${m![1]}m — SOURCE_MAX_BYTES (20 MB) dan yuqori bo'lishi kerak`);
});

test("nginx shabloni: /api/generations/ uchun uzoq proxy_read_timeout (tahrir yo'nalishlari)", () => {
  const conf = readFileSync(new URL("../deploy/nginx/slaydx.conf.example", import.meta.url), "utf8");
  const start = conf.indexOf("location /api/generations/");
  assert.ok(start >= 0, "location /api/generations/ bloki topilmadi");
  const block = conf.slice(start, conf.indexOf("}", start));
  const m = block.match(/proxy_read_timeout\s+(\d+)s;/);
  assert.ok(m, "/api/generations/ blokida proxy_read_timeout yo'q");
  // deploy.md §2a: rebuild/image-regenerate ~45-60s eng yomon holat.
  assert.ok(Number(m![1]) >= 90, `proxy_read_timeout ${m![1]}s — 45-60s eng yomon holatga yetarli zaxira bilan yopilmagan`);
});

test("nginx shabloni: X-Forwarded-For/X-Real-IP va HSTS bor", () => {
  const conf = readFileSync(new URL("../deploy/nginx/slaydx.conf.example", import.meta.url), "utf8");
  assert.match(conf, /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/, "X-Forwarded-For yo'q");
  assert.match(conf, /proxy_set_header\s+X-Real-IP\s+\$remote_addr;/, "X-Real-IP yo'q");
  assert.match(conf, /Strict-Transport-Security/, "HSTS sarlavhasi yo'q");
});

test("nginx shabloni: web konteyner manziliga (127.0.0.1:3000) proxy qiladi", () => {
  const conf = readFileSync(new URL("../deploy/nginx/slaydx.conf.example", import.meta.url), "utf8");
  assert.match(conf, /proxy_pass\s+http:\/\/127\.0\.0\.1:3000;/, "proxy_pass 127.0.0.1:3000'ga emas");
});

/**
 * SCALE-15: birinchi tashrif buyuruvchilar uchun `/_next/static/*` hozir
 * HAR safar `web` konteynerdagi Node jarayoni tomonidan gzip qilinardi —
 * bu testlar shablonni uzoq muddatli brauzer keshi + nginx `proxy_cache`
 * (host papkasi/CDN'ga qaraganda eng kam xavfli tanlov — konf faylidagi
 * izohga qarang) va `/api/*` doim uncached qolishiga qarshi qulflaydi.
 *
 * Mutatsiya: `location /_next/static/` blokidan `expires 1y;` yoki
 * `Cache-Control`dagi `immutable`ni olib tashlang — mos assertion qizaradi.
 */
test("nginx shabloni: /_next/static/ uzoq muddatli keshlanadi (expires + immutable)", () => {
  const conf = readFileSync(new URL("../deploy/nginx/slaydx.conf.example", import.meta.url), "utf8");
  const start = conf.indexOf("location /_next/static/");
  assert.ok(start >= 0, "location /_next/static/ bloki topilmadi");
  const block = conf.slice(start, conf.indexOf("\n    }", start));
  assert.match(block, /expires\s+1y;/, "/_next/static/ uchun expires 1y yo'q");
  assert.match(
    block,
    /Cache-Control\s+"public,\s*max-age=31536000,\s*immutable"/,
    "/_next/static/ uchun Cache-Control: public, max-age=31536000, immutable yo'q",
  );
});

/**
 * Mutatsiya: `proxy_cache slaydx_static;` qatorini olib tashlang —
 * assertion qizaradi (kesh butunlay ishlamay qoladi).
 */
test("nginx shabloni: /_next/static/ nginx proxy_cache orqali keshlanadi (dokumentlangan zona bilan)", () => {
  const conf = readFileSync(new URL("../deploy/nginx/slaydx.conf.example", import.meta.url), "utf8");
  assert.match(
    conf,
    /proxy_cache_path\s+\S+\s+levels=\S+\s+keys_zone=(\w+):/,
    "proxy_cache_path (kesh zonasi e'loni) topilmadi",
  );
  const zoneMatch = conf.match(/proxy_cache_path\s+\S+\s+levels=\S+\s+keys_zone=(\w+):/);
  const zone = zoneMatch![1];
  const start = conf.indexOf("location /_next/static/");
  assert.ok(start >= 0, "location /_next/static/ bloki topilmadi");
  const block = conf.slice(start, conf.indexOf("\n    }", start));
  assert.match(block, new RegExp(`proxy_cache\\s+${zone};`), `/_next/static/ blokida proxy_cache ${zone}; yo'q`);
});

/**
 * Mutatsiya: `gzip on;`ni `gzip off;`ga o'zgartiring yoki `gzip_types`ni
 * bo'sh qoldiring — assertion qizaradi.
 */
test("nginx shabloni: matn turlari uchun gzip yoqilgan", () => {
  const conf = readFileSync(new URL("../deploy/nginx/slaydx.conf.example", import.meta.url), "utf8");
  // Izoh qatorlarini (`#` bilan boshlanadigan) chiqarib tashlaymiz — aks
  // holda izohdagi misol matn ("brotli on;" kabi) ham mos kelib qolishi mumkin.
  const code = conf
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  assert.match(code, /\bgzip\s+on;/, "gzip on; topilmadi (yoki faqat izohda qolgan)");
  assert.match(code, /gzip_types[^;]*text\/css/, "gzip_types ichida text/css yo'q");
  assert.match(code, /gzip_types[^;]*application\/javascript/, "gzip_types ichida application/javascript yo'q");
});

/**
 * SCALE-15: `/api/*` hech qachon nginx keshidan berilmasligi kerak —
 * navbat holati/pul/generatsiya holati har foydalanuvchi uchun XOS.
 * Mutatsiya: `/api/` blokidagi `proxy_cache off;`ni olib tashlang —
 * assertion qizaradi.
 */
test("nginx shabloni: /api/* uncached (proxy_cache off har ikkala /api/ blokida)", () => {
  const conf = readFileSync(new URL("../deploy/nginx/slaydx.conf.example", import.meta.url), "utf8");

  const apiStart = conf.indexOf("location /api/ ");
  assert.ok(apiStart >= 0, "location /api/ bloki topilmadi");
  const apiBlock = conf.slice(apiStart, conf.indexOf("\n    }", apiStart));
  assert.match(apiBlock, /proxy_cache\s+off;/, "location /api/ blokida proxy_cache off; yo'q");

  const genStart = conf.indexOf("location /api/generations/");
  assert.ok(genStart >= 0, "location /api/generations/ bloki topilmadi");
  const genBlock = conf.slice(genStart, conf.indexOf("\n    }", genStart));
  assert.match(genBlock, /proxy_cache\s+off;/, "location /api/generations/ blokida proxy_cache off; yo'q");
});
