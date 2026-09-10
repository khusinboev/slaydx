import test from "node:test";
import assert from "node:assert/strict";
import { CROP_MAX_ZOOM, DEFAULT_CROP, clampZoom, cropRect, panCrop } from "../lib/photo-crop.ts";

/**
 * Surat kesish matematikasi (Rezyume 2, 6-band).
 *
 * Canvas jsdom da yo'q, shuning uchun hisob-kitob alohida modulda:
 * dialog ham, test ham AYNAN shu funksiyani chaqiradi.
 */

test("cropRect: kvadrat ramka qisqa tomon bo'yicha to'ladi (cover)", () => {
  const r = cropRect(1200, 800, DEFAULT_CROP);
  assert.equal(r.size, 800, "qisqa tomon");
  // Markazda: chapdan (1200-800)/2 = 200.
  assert.equal(Math.round(r.sx), 200);
  assert.equal(Math.round(r.sy), 0);
});

test("cropRect: zoom kesim maydonini kichraytiradi va chegaradan chiqmaydi", () => {
  const r = cropRect(1000, 1000, { x: 0.5, y: 0.5, zoom: 2 });
  assert.equal(r.size, 500);
  assert.equal(r.sx, 250);
  // MUTATSIYA: klamp olib tashlansa, markaz 0 da kesim manfiy `sx` beradi.
  const edge = cropRect(1000, 1000, { x: 0, y: 1, zoom: 2 });
  assert.ok(edge.sx >= 0 && edge.sy + edge.size <= 1000, `chegara: ${JSON.stringify(edge)}`);
});

test("clampZoom: 1..4 oralig'i, buzuq qiymat 1 ga tushadi", () => {
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(99), CROP_MAX_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
});

test("panCrop: sudrash markazni SURAT bo'ylab teskari yo'nalishda siljitadi", () => {
  const c = panCrop({ x: 0.5, y: 0.5, zoom: 2 }, 32, 0, 320, 1000, 1000);
  // O'ngga sudralsa surat o'ngga siljiydi, ya'ni ko'rinadigan markaz CHAPGA.
  assert.ok(c.x < 0.5, `x: ${c.x}`);
  assert.equal(c.y, 0.5);
  // 0..1 dan chiqmaydi.
  const far = panCrop({ x: 0.5, y: 0.5, zoom: 1 }, 5000, -5000, 320, 1000, 1000);
  assert.ok(far.x >= 0 && far.x <= 1 && far.y >= 0 && far.y <= 1);
});
