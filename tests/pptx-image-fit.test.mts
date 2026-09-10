import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { renderPptx } from "../lib/generation/render-pptx.ts";
import { planSlide } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * PPTX'da rasm NISBATI (AUDIT-14): pptxgenjs `sizing.contain/cover` Node'da
 * rasmning haqiqiy o'lchamini bilmaydi va rasmni qutiga cho'zardi — saytda
 * logotip asl nisbatda, faylda eniga cho'zilgan edi. Endi `render-pptx`
 * baytlardan o'lcham o'qiydi: `contain` — quti ichida markazda, nisbat
 * saqlanadi; `cover` — `srcRect` bilan kesiladi (ko'ruvchi `object-fit` bilan bir xil).
 */
const EMU = 914400;

/** Minimal PNG: IHDR da berilgan o'lcham (pptxgenjs baytlarni o'qimaydi, faqat joylaydi). */
function png(w: number, h: number): string {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 6; // RGBA
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return `data:image/png;base64,${Buffer.concat([sig, ihdr, iend]).toString("base64")}`;
}

type Pic = { cx: number; cy: number; x: number; y: number; srcRect: string | null };
function pics(xml: string): Pic[] {
  return [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => {
    const s = m[0];
    const off = s.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/)!;
    const ext = s.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/)!;
    const src = s.match(/<a:srcRect[^>]*\/>/);
    return { x: Number(off[1]) / EMU, y: Number(off[2]) / EMU, cx: Number(ext[1]) / EMU, cy: Number(ext[2]) / EMU, srcRect: src ? src[0] : null };
  });
}

const LOGO = png(400, 100); // 4:1 — keng logotip
const PHOTO = png(1600, 400); // 4:1 — foto, titul qutisi ~4:3 → yon tomonlari kesiladi

function doc(): AcademicDoc {
  const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Fotosintez", slideTemplate: "lecture", slideTheme: "atlas" } as never);
  const slides: SlideModel[] = [{ id: "s0", layout: "title", title: "Fotosintez", subtitle: "Izoh", image: { url: PHOTO } }];
  return { meta, titlePage: false, toc: false, sections: [], slides, slideTemplate: "lecture", slideVisual: "academic", slideLogo: { url: LOGO } };
}

test("logotip (contain): PPTX'da asl 4:1 nisbat, quti ichida, srcRect yo'q — cho'zilmaydi", async () => {
  const d = doc();
  const file = await renderPptx(d, "t.pptx");
  const zip = await JSZip.loadAsync(file.bytes);
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const all = pics(xml);
  assert.ok(all.length >= 2, `rasmlar: ${all.length}`);
  // Logotip qatlami — `planSlide` dagi contain qatlamining qutisi.
  const theme = getSlideTheme("atlas");
  const plan = planSlide(d.slides![0], theme, "academic", 0, 1, "auto", "lecture", { logo: LOGO });
  const logoLayer = plan.layers.find((l) => l.t === "image" && l.fit === "contain");
  assert.ok(logoLayer && logoLayer.t === "image");
  const box = logoLayer.box;
  const logo = all.find((p) => p.x >= box.x - 0.01 && p.y >= box.y - 0.01 && p.x + p.cx <= box.x + box.w + 0.01 && p.y + p.cy <= box.y + box.h + 0.01 && !p.srcRect);
  assert.ok(logo, `logotip quti ichida topilmadi: ${JSON.stringify(all)} quti ${JSON.stringify(box)}`);
  assert.ok(Math.abs(logo!.cx / logo!.cy - 4) < 0.02, `nisbat 4:1 emas: ${logo!.cx}×${logo!.cy}`);
  assert.ok(logo!.cx <= box.w + 0.001 && logo!.cy <= box.h + 0.001, "quti ichida");
  // Markazda (kamida bitta o'q bo'yicha to'liq, ikkinchisida ortiqcha joy teng bo'lingan).
  const dx = logo!.x - box.x;
  const dy = logo!.y - box.y;
  assert.ok(Math.abs(dx - (box.w - logo!.cx) / 2) < 0.01 && Math.abs(dy - (box.h - logo!.cy) / 2) < 0.01, "markazlanmagan");
});

test("foto (cover): quti o'lchamida joylanadi, rasm nisbati bo'yicha srcRect bilan KESILADI (manfiy emas)", async () => {
  const file = await renderPptx(doc(), "t.pptx");
  const zip = await JSZip.loadAsync(file.bytes);
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const cover = pics(xml).find((p) => p.srcRect);
  assert.ok(cover, "cover rasmda srcRect bo'lishi kerak");
  const l = Number(cover!.srcRect!.match(/l="(-?\d+)"/)?.[1] ?? 0);
  const t = Number(cover!.srcRect!.match(/t="(-?\d+)"/)?.[1] ?? 0);
  // 4:1 foto ~4:3 qutida — yon tomonlari kesiladi (l > 0), tepasi emas.
  assert.ok(l > 0 && t === 0, `kesish noto'g'ri: ${cover!.srcRect}`);
  assert.ok(l < 50000, "yarmidan ko'p kesilmaydi");
  // Joylashuv — quti (cover to'ldiradi).
  assert.ok(cover!.cx > 2 && cover!.cy > 1.5, `quti o'lchami: ${cover!.cx}×${cover!.cy}`);
});
