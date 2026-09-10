import type { CustomTemplate, Placeholder, TemplateLayout, TemplateRole } from "./pptx-template";
import { LAYOUT_KIT, type Box, type SlideLayer, type SlidePlan } from "./slide-layout";
import type { SlideModel, SlideSrc } from "./slide-types";
import { contentOf, roleFor, type Para } from "./template-content";

/**
 * «O'z shablonim» — KO'RUVCHI planeri (Shablonlar 2, B3).
 *
 * PPTX bu yo'lda `planSlide` bilan chizilmaydi (u namuna placeholder'lariga
 * yoziladi, `render-pptx-template.ts`); ko'ruvchi esa fayl qanday
 * ko'rinishini ko'rsatishi kerak. Yaqinlashuv: fon — yuklashda rasterlangan
 * layout PNG si (namunaning butun bezagi vektor-aniq), matn — placeholder
 * qutilarida, namuna shrift oilasi va tema rangi bilan. Shrift o'lchami
 * PowerPoint `normAutofit` kabi `fitSize` bilan qutiga sig'diriladi.
 *
 * Bir xil xarita: qaysi slayd qaysi layoutga (`roleFor`) va unda qaysi matn
 * (`contentOf`) — PPTX yozuvchisi bilan BITTA modul (`template-content.ts`).
 */

const FALLBACK_TITLE: Box = { x: 0.6, y: 0.45, w: 12.1, h: 1.2 };
const FALLBACK_BODY: Box = { x: 0.6, y: 1.85, w: 12.1, h: 4.9 };
const FALLBACK_COVER_TITLE: Box = { x: 0.9, y: 2.3, w: 11.5, h: 1.8 };
const FALLBACK_COVER_SUB: Box = { x: 0.9, y: 4.2, w: 11.5, h: 1.0 };

function pick(lay: TemplateLayout | undefined, ...types: Placeholder["type"][]): Placeholder[] {
  return (lay?.placeholders ?? []).filter((p) => types.includes(p.type));
}

function scaleBox(b: Box, sx: number, sy: number): Box {
  const { W, H } = LAYOUT_KIT;
  const x = Math.max(0, Math.min(W - 0.2, b.x * sx));
  const y = Math.max(0, Math.min(H - 0.2, b.y * sy));
  return { x, y, w: Math.max(0.2, Math.min(W - x, b.w * sx)), h: Math.max(0.2, Math.min(H - y, b.h * sy)) };
}

export function planCustom(s: SlideModel, custom: CustomTemplate, index: number, total: number): SlidePlan {
  const { W, H, fitSize, fitLines } = LAYOUT_KIT;
  const { profile, previews } = custom;
  const role: TemplateRole = roleFor(s.layout, Boolean(s.image?.url), profile.roles);
  const path = profile.roles[role] ?? profile.roles.content ?? profile.roles.cover;
  const lay = profile.layouts.find((l) => l.path === path);
  const preview = previews[role] ?? (path ? Object.values(previews).find(Boolean) : undefined);
  const sx = W / (profile.size.w || W);
  const sy = H / (profile.size.h || H);
  const isCover = role === "cover" || role === "section";

  const colors = profile.colors;
  const dark = preview ? preview.dark : isCover;
  const ink = (dark ? colors.lt1 : colors.dk1) || (dark ? "#FFFFFF" : "#1A1A1A");
  const soft = (dark ? colors.lt2 : colors.dk2) || ink;
  const bg = (dark ? colors.dk2 || colors.dk1 : colors.lt1) || (dark ? "#1F2937" : "#FFFFFF");
  const major = profile.fonts.major || undefined;
  const minor = profile.fonts.minor || undefined;

  const layers: SlideLayer[] = [];
  if (preview) layers.push({ t: "image", box: { x: 0, y: 0, w: W, h: H }, url: preview.png, fit: "cover" });

  const c = contentOf(s);
  const box = (ph: Placeholder | undefined, fallback: Box): Box => (ph?.box ? scaleBox(ph.box, sx, sy) : fallback);

  // Sarlavha.
  const [titlePh] = pick(lay, "ctrTitle", "title");
  const titleBox = box(titlePh, isCover ? FALLBACK_COVER_TITLE : FALLBACK_TITLE);
  const titleBase = isCover ? 40 : 30;
  if (c.title) {
    layers.push({
      t: "text",
      box: titleBox,
      text: c.title,
      color: ink,
      size: fitSize(c.title, titleBox, titleBase, 16),
      bold: true,
      font: major,
      valign: isCover ? "middle" : "top",
      align: titlePh?.type === "ctrTitle" ? "center" : "left",
      src: { f: "title" },
    });
  }

  // Izoh (muqova/bo'lim).
  const [subPh] = pick(lay, "subTitle");
  const bodyPhs = pick(lay, "body", "obj").filter((p) => p !== subPh);
  if (c.sub) {
    const subBox = box(subPh ?? bodyPhs[0], FALLBACK_COVER_SUB);
    layers.push({
      t: "text",
      box: subBox,
      text: c.sub,
      color: soft,
      size: fitSize(c.sub, subBox, 20, 11),
      font: minor,
      valign: "top",
      align: subPh?.type === "subTitle" && titlePh?.type === "ctrTitle" ? "center" : "left",
      src: { f: "subtitle" },
    });
  }

  const pushLines = (items: Para[], b: Box, bullets: boolean) => {
    const lines = items.map((p) => p.text);
    if (!lines.filter(Boolean).length) return;
    const srcLines = items.map((p) => p.src as SlideSrc);
    const editable = srcLines.every(Boolean);
    layers.push({
      t: "text",
      box: b,
      lines,
      color: ink,
      size: fitLines(lines, b, 20, 11, 4),
      font: minor,
      valign: "top",
      bullets,
      paraSpace: 4,
      ...(editable ? { srcLines } : {}),
    });
  };

  const bodies = c.bodies.filter((b) => b.length);
  if (c.table) {
    const b = box(bodyPhs[0], FALLBACK_BODY);
    const rows = [c.table.headers.join("  ·  "), ...c.table.rows.map((r) => r.join("  ·  "))];
    pushLines(rows.map((text) => ({ text })), b, false);
  } else if (bodyPhs.length >= 2 && bodies.length >= 2) {
    pushLines(bodies[0], box(bodyPhs[0], FALLBACK_BODY), true);
    pushLines(bodies[1], box(bodyPhs[1], FALLBACK_BODY), true);
  } else if (bodies.length) {
    const target = bodyPhs[0] ?? (!c.sub ? subPh : undefined);
    const b = target ? box(target, FALLBACK_BODY) : isCover ? FALLBACK_COVER_SUB : FALLBACK_BODY;
    const merged = bodies.length > 1 ? bodies.flat() : bodies[0];
    pushLines(merged, b, s.layout !== "quote" && s.layout !== "section");
  }

  // Rasm — faqat `pic` placeholder bo'lsa (PPTX bilan bir xil qoida).
  const [picPh] = pick(lay, "pic");
  if (picPh?.box && s.image?.url) {
    layers.push({ t: "image", box: scaleBox(picPh.box, sx, sy), url: s.image.url, fit: "cover" });
  }

  // Sahifa raqami — namuna `sldNum` bo'lsa o'z joyida, bo'lmasa yo'q.
  const [numPh] = pick(lay, "sldNum");
  if (numPh?.box && index > 0) {
    layers.push({ t: "text", box: scaleBox(numPh.box, sx, sy), text: `${index + 1} / ${total}`, color: soft, size: 11, font: minor, align: "right", valign: "bottom" });
  }

  return { bg, layers };
}
