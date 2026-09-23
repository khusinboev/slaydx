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
