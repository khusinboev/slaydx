import JSZip from "jszip";
import type { Box } from "./slide-layout";

/**
 * «O'Z SHABLONIM» — foydalanuvchi PPTX namunasining TAHLILI (Sprint B).
 *
 * Namuna fayldan faqat SHABLON qismi o'qiladi: slayd o'lchami, tema
 * ranglari va shriftlari, master va layoutlar, ularning placeholder'lari
 * (turi, `idx`, pozitsiyasi). Slaydlarning o'zi (mazmuni) E'TIBORGA
 * OLINMAYDI — biz keyin o'z slaydlarimizni aynan shu layoutlarga yozamiz
 * (`render-pptx-template.ts`), ya'ni chiqqan fayl namunaning master/
 * layout/temasi bilan bir xil ko'rinadi.
 *
 * XML tahlili regex bilan (`extract-text.ts` naqshi): OOXML bu yerda
 * tor, oldindan ma'lum tuzilmada, to'liq XML kutubxona og'irligiga
 * arzimaydi. Har qadam ehtiyotkor — foydalanuvchi fayli ishonchsiz.
 */

export type PhType = "title" | "ctrTitle" | "subTitle" | "body" | "obj" | "pic" | "dt" | "ftr" | "sldNum" | "other";
export type Placeholder = { type: PhType; idx: number | null; name: string; box: Box | null };
export type LayoutKind = "cover" | "section" | "content" | "two" | "picture" | "titleOnly" | "blank" | "other";
export type TemplateLayout = { path: string; name: string; kind: LayoutKind; placeholders: Placeholder[] };
export type TemplateRole = "cover" | "section" | "content" | "two" | "picture" | "blank";
export type TemplateProfile = {
  /** Slayd o'lchami (dyuym). */
  size: { w: number; h: number };
  /** Tema ranglari — `dk1`, `lt1`, `dk2`, `lt2`, `accent1..6` (hex, `#` bilan). */
  colors: Record<string, string>;
  fonts: { major: string; minor: string };
  masterPath: string;
  themePath: string | null;
  layouts: TemplateLayout[];
  /** Har rol uchun tanlangan layout yo'li — dekadagi maketlar shu ro'yxatdan oladi. */
  roles: Partial<Record<TemplateRole, string>>;
};

/** Layout foni rasteri (yuklashda LibreOffice + pdftoppm) — ko'ruvchi foni; `dark` — matn rangi tanlovi uchun. */
export type TemplatePreview = { png: string; dark: boolean };
/**
 * Hujjatga (`AcademicDoc.customTemplate`) yoziladigan yengil nusxa: bayt
 * YO'Q (u `template_uploads` da), faqat profil va rol → fon rasmi.
 * Ko'ruvchi shundan chizadi (B3), PPTX esa baytdan (`renderPptxWithTemplate`).
 */
export type CustomTemplate = {
  assetId: string;
  name: string;
  profile: TemplateProfile;
  previews: Partial<Record<TemplateRole, TemplatePreview>>;
};

export type TemplateErrorCode = "not-pptx" | "no-layouts" | "no-content";
export class TemplateError extends Error {
  code: TemplateErrorCode;
  constructor(code: TemplateErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const EMU = 914400;

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** `<a:xfrm><a:off x y/><a:ext cx cy/></a:xfrm>` → dyuym qutisi. */
function xfrmBox(xml: string): Box | null {
  const m = xml.match(/<a:xfrm[^>]*>\s*<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>\s*<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/);
  if (!m) return null;
  const [x, y, w, h] = m.slice(1).map((v) => Number(v) / EMU);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function phType(raw: string | null): PhType {
  if (!raw) return "body"; // `type` yo'q → OOXML da bu `obj` (mazmun) — tana deb hisoblanadi
  const t = raw as PhType;
  return ["title", "ctrTitle", "subTitle", "body", "obj", "pic", "dt", "ftr", "sldNum"].includes(t) ? t : "other";
}

/** Bitta layout/master XML dan placeholder'lar (faqat `<p:sp>` ichidagilar). */
function placeholdersOf(xml: string): Placeholder[] {
  const out: Placeholder[] = [];
  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let m: RegExpExecArray | null;
  while ((m = spRe.exec(xml))) {
    const sp = m[1];
    const ph = sp.match(/<p:ph\b[^>]*\/?>/);
    if (!ph) continue;
    const idxRaw = attr(ph[0], "idx");
    const name = attr(sp.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "", "name") ?? "";
    out.push({ type: phType(attr(ph[0], "type")), idx: idxRaw === null ? null : Number(idxRaw), name, box: xfrmBox(sp) });
  }
  return out;
}

function layoutKind(xml: string, phs: Placeholder[]): LayoutKind {
  const t = attr(xml.match(/<p:sldLayout\b[^>]*>/)?.[0] ?? "", "type");
  const map: Record<string, LayoutKind> = {
    title: "cover",
    secHead: "section",
    obj: "content",
    tx: "content",
    twoObj: "two",
    twoTxTwoObj: "two",
    picTx: "picture",
    titleOnly: "titleOnly",
    blank: "blank",
    objAndTx: "two",
    txAndObj: "two",
    vertTx: "content",
  };
  if (t && map[t]) return map[t];
  const has = (k: PhType) => phs.some((p) => p.type === k);
  const bodies = phs.filter((p) => p.type === "body" || p.type === "obj").length;
  if (has("ctrTitle")) return "cover";
  if (has("pic") && has("title")) return "picture";
  if (bodies >= 2 && has("title")) return "two";
  if (bodies >= 1 && has("title")) return "content";
  if (has("title")) return "titleOnly";
  if (!phs.length) return "blank";
  return "other";
}

/** `.rels` dan berilgan tur bo'yicha nishon yo'li (zip ichidagi normal yo'l). */
function relTarget(rels: string, typeSuffix: string, fromDir: string): string | null {
  const re = new RegExp(`<Relationship\\b[^>]*Type="[^"]*/${typeSuffix}"[^>]*/>`);
  const m = rels.match(re);
  if (!m) return null;
  const target = attr(m[0], "Target");
  if (!target) return null;
  return normalizePath(fromDir, target);
}

function normalizePath(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${dir}/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function relsPathOf(path: string): string {
  const i = path.lastIndexOf("/");
  return `${path.slice(0, i)}/_rels/${path.slice(i + 1)}.rels`;
}

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/** Tema ranglari: `srgbClr val` yoki `sysClr lastClr`. */
function themeColors(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const scheme = xml.match(/<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/)?.[1] ?? "";
  const re = /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scheme))) {
    const hex = m[2].match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/)?.[1] ?? m[2].match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1];
    if (hex) out[m[1]] = `#${hex.toUpperCase()}`;
  }
  return out;
}

function themeFonts(xml: string): { major: string; minor: string } {
  const pick = (tag: string) => xml.match(new RegExp(`<a:${tag}>[\\s\\S]*?<a:latin\\s+typeface="([^"]*)"`))?.[1] ?? "";
  return { major: pick("majorFont"), minor: pick("minorFont") };
}

/** Rollar: har maket turi uchun eng mos layout. */
function pickRoles(layouts: TemplateLayout[]): TemplateProfile["roles"] {
  const first = (k: LayoutKind) => layouts.find((l) => l.kind === k)?.path;
  const withTitleBody = layouts.find((l) => l.placeholders.some((p) => p.type === "title") && l.placeholders.some((p) => p.type === "body" || p.type === "obj"))?.path;
  const roles: TemplateProfile["roles"] = {};
  roles.cover = first("cover") ?? first("titleOnly") ?? withTitleBody;
  // Muqova `ctrTitle`siz namunada (pptxgenjs, ba'zi Google Slides eksportlari)
  // birinchi title+body layoutga tushadi — mazmun uchun boshqa content layout
  // bo'lsa, o'shani olamiz, toki muqova bilan mazmun bir xil ko'rinmasin.
  const contents = layouts.filter((l) => l.kind === "content").map((l) => l.path);
  roles.content = contents.find((p) => p !== roles.cover) ?? contents[0] ?? withTitleBody ?? first("two");
  roles.section = first("section") ?? roles.cover;
  const two = first("two");
  if (two) roles.two = two;
  const pic = first("picture");
  if (pic) roles.picture = pic;
  roles.blank = first("blank") ?? first("titleOnly") ?? roles.content;
  return roles;
}

export async function parsePptxTemplate(bytes: Uint8Array | ArrayBuffer): Promise<TemplateProfile> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new TemplateError("not-pptx", "Fayl PPTX emas (zip ochilmadi)");
  }
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  if (!pres) throw new TemplateError("not-pptx", "Fayl PPTX emas (ppt/presentation.xml yo'q)");

  const sz = pres.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
  const size = sz ? { w: round(Number(sz[1]) / EMU), h: round(Number(sz[2]) / EMU) } : { w: 13.333, h: 7.5 };

  // Master: presentation.xml.rels → birinchi slideMaster.
  const presRels = (await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")) ?? "";
  const masterPath = relTarget(presRels, "slideMaster", "ppt") ?? "ppt/slideMasters/slideMaster1.xml";
  const masterXml = (await zip.file(masterPath)?.async("string")) ?? "";
  const masterRels = (await zip.file(relsPathOf(masterPath))?.async("string")) ?? "";
  const masterPhs = placeholdersOf(masterXml);
  const themePath = relTarget(masterRels, "theme", dirOf(masterPath));
  const themeXml = themePath ? ((await zip.file(themePath)?.async("string")) ?? "") : "";

  // Layoutlar — master rels tartibida (PowerPoint ko'rsatadigan tartib).
  const layoutPaths: string[] = [];
  const lre = /<Relationship\b[^>]*Type="[^"]*\/slideLayout"[^>]*\/>/g;
  let lm: RegExpExecArray | null;
  while ((lm = lre.exec(masterRels))) {
    const t = attr(lm[0], "Target");
    if (t) layoutPaths.push(normalizePath(dirOf(masterPath), t));
  }
  if (!layoutPaths.length) {
    for (const name of Object.keys(zip.files)) if (/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name)) layoutPaths.push(name);
    layoutPaths.sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1]) - Number(b.match(/(\d+)\.xml$/)?.[1]));
  }
  if (!layoutPaths.length) throw new TemplateError("no-layouts", "Namunada slayd maketlari (layout) topilmadi");

  const layouts: TemplateLayout[] = [];
  for (const path of layoutPaths) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const phs = placeholdersOf(xml).map((p) => {
      if (p.box) return p;
      // Pozitsiyasiz placeholder masterdagi shu tur/idx dan meros oladi.
      const inherit = masterPhs.find((m) => m.idx !== null && m.idx === p.idx) ?? masterPhs.find((m) => m.type === p.type || (p.type === "ctrTitle" && m.type === "title"));
      return { ...p, box: inherit?.box ?? null };
    });
    const name = attr(xml.match(/<p:cSld\b[^>]*>/)?.[0] ?? "", "name") ?? path;
    layouts.push({ path, name, kind: layoutKind(xml, phs), placeholders: phs });
  }

  const roles = pickRoles(layouts);
  const usable = layouts.some((l) => l.placeholders.some((p) => p.type === "title" || p.type === "ctrTitle"));
  if (!usable || !roles.content) {
    throw new TemplateError("no-content", "Namunada sarlavha va matn placeholder'li maket topilmadi — bu fayl shablon sifatida ishlamaydi");
  }

  return {
    size,
    colors: themeColors(themeXml),
    fonts: themeFonts(themeXml),
    masterPath,
    themePath,
    layouts,
    roles,
  };
}
