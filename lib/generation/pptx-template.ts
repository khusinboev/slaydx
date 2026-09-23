import type JSZip from "jszip";
import type { Box } from "./slide-layout";
import { loadZipCapped, readZipText, ZipLimitError, type ZipBudget } from "./translate/xml-scan";

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

export type TemplateErrorCode = "not-pptx" | "no-layouts" | "no-content" | "too-big";
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

/*
 * SECB-01: namuna XML i ham foydalanuvchi fayli. Ilgari `/<p:sp>([\s\S]*?)<\/p:sp>/`,
 * `/<a:xfrm[^>]*>…/`, `/<Relationship\b[^>]*Type="…"[^>]*\/>/` kabi regexlar
 * yopilmagan tegda har boshlanishdan oxirigacha qayta skanerlardi (O(n²)).
 * Quyidagi skanerlar oddiy OOXML da aynan o'sha natijani beradi, lekin
 * muvaffaqiyatsiz urinishdan keyin qidiruvni o'sha joydan davom ettiradi.
 */

function isWordCode(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/** `xml.match(/<name\b[^>]*>/)?.[0]` ning chiziqli teng varianti. */
function firstTag(xml: string, name: string): string | null {
  const open = `<${name}`;
  for (let o = xml.indexOf(open); o >= 0; o = xml.indexOf(open, o + 1)) {
    const after = o + open.length;
    if (after < xml.length && isWordCode(xml.charCodeAt(after))) continue;
    const gt = xml.indexOf(">", after);
    // Undan keyingi hech bir ochilishda ham `>` bo'lmaydi.
    return gt < 0 ? null : xml.slice(o, gt + 1);
  }
  return null;
}

/**
 * `.rels` dagi `<Relationship … Type="…/{suffix}" … />` teglari (hujjat tartibida).
 * Teg — `<Relationship` dan birinchi `>` gacha (`[^>]*`), `/>` bilan tugashi shart.
 */
function relTags(rels: string, suffix: string): string[] {
  const out: string[] = [];
  const open = "<Relationship";
  const want = `/${suffix}`;
  for (let o = rels.indexOf(open); o >= 0; ) {
    const after = o + open.length;
    if (after < rels.length && isWordCode(rels.charCodeAt(after))) {
      o = rels.indexOf(open, o + 1);
      continue;
    }
    const gt = rels.indexOf(">", after);
    if (gt < 0) break;
    const tag = rels.slice(o, gt + 1);
    if (tag.endsWith("/>")) {
      for (let p = tag.indexOf('Type="', open.length); p >= 0; p = tag.indexOf('Type="', p + 1)) {
        const q = tag.indexOf('"', p + 6);
        if (q < 0) break;
        if (q < tag.length - 2 && tag.slice(p + 6, q).endsWith(want)) {
          out.push(tag);
          break;
        }
      }
    }
    o = rels.indexOf(open, gt + 1);
  }
  return out;
}

const XFRM_REST = /\s*<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>\s*<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/y;

/** `<a:xfrm><a:off x y/><a:ext cx cy/></a:xfrm>` → dyuym qutisi. */
function xfrmBox(xml: string): Box | null {
  let m: RegExpExecArray | null = null;
  for (let o = xml.indexOf("<a:xfrm"); o >= 0 && !m; ) {
    const gt = xml.indexOf(">", o + 7);
    if (gt < 0) return null;
    XFRM_REST.lastIndex = gt + 1;
    m = XFRM_REST.exec(xml);
    // `(o, gt)` oralig'idagi ochilishlar ham aynan shu `>` ga tayanadi.
    o = xml.indexOf("<a:xfrm", gt + 1);
  }
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
  // `/<p:sp>([\s\S]*?)<\/p:sp>/g` — yopuvchisiz ochilishdan keyin moslik bo'lmaydi.
  for (let o = xml.indexOf("<p:sp>"); o >= 0; ) {
    const close = xml.indexOf("</p:sp>", o + 6);
    if (close < 0) break;
    const sp = xml.slice(o + 6, close);
    o = xml.indexOf("<p:sp>", close + 7);
    // `/<p:ph\b[^>]*\/?>/` — `[^>]*` `/` ni ham yeydi, ya'ni birinchi `>` gacha.
    const ph = firstTag(sp, "p:ph");
    if (!ph) continue;
    const idxRaw = attr(ph, "idx");
    const name = attr(firstTag(sp, "p:cNvPr") ?? "", "name") ?? "";
    out.push({ type: phType(attr(ph, "type")), idx: idxRaw === null ? null : Number(idxRaw), name, box: xfrmBox(sp) });
  }
  return out;
}

function layoutKind(xml: string, phs: Placeholder[]): LayoutKind {
  const t = attr(firstTag(xml, "p:sldLayout") ?? "", "type");
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
  const tag = relTags(rels, typeSuffix)[0];
  if (!tag) return null;
  const target = attr(tag, "Target");
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
  // `/<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/` — birinchi ochilish yetarli:
  // undan keyingilarning yopuvchisi ham faqat shu qidiruv sohasida bo'lardi.
  const openTag = firstTag(xml, "a:clrScheme");
  let scheme = "";
  if (openTag) {
    const start = xml.indexOf(openTag) + openTag.length;
    const close = xml.indexOf("</a:clrScheme>", start);
    if (close >= 0) scheme = xml.slice(start, close);
  }
  // `/<a:(dk1|…)>([\s\S]*?)<\/a:\1>/g` — har nom uchun yopuvchi topilmasa, keyingi
  // shu nomli ochilishlar ham yopilmaydi (eslab qolinadi).
  const re = /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>/g;
  const noClose = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(scheme))) {
    const name = m[1];
    if (noClose.has(name)) continue;
    const close = scheme.indexOf(`</a:${name}>`, re.lastIndex);
    if (close < 0) {
      noClose.add(name);
      continue;
    }
    const inner = scheme.slice(re.lastIndex, close);
    re.lastIndex = close + name.length + 5;
    const hex = inner.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/)?.[1] ?? inner.match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1];
    if (hex) out[name] = `#${hex.toUpperCase()}`;
  }
  return out;
}

function themeFonts(xml: string): { major: string; minor: string } {
  // `<a:tag>[\s\S]*?<a:latin…>` — birinchi ochilishdan keyingi birinchi `<a:latin>`.
  const pick = (tag: string) => {
    const at = xml.indexOf(`<a:${tag}>`);
    if (at < 0) return "";
    const re = /<a:latin\s+typeface="([^"]*)"/g;
    re.lastIndex = at + tag.length + 4;
    return re.exec(xml)?.[1] ?? "";
  };
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

/**
 * Namunadan o'qiladigan XML ning umumiy chegarasi (SECB-02). Ilgari bu
 * yerda hech qanday chegara yo'q edi: 20 MB lik PPTX ning master/layout
 * XML i gigabaytlarga ochilishi mumkin edi. Real namunaning shu qismlari
 * (presentation, master, tema, layoutlar) bir necha MB dan oshmaydi.
 */
export const TEMPLATE_MAX_XML = 40 * 1024 * 1024;
/** Layoutlar soni chegarasi — real namunada 10–50 ta. */
export const MAX_TEMPLATE_LAYOUTS = 100;

export async function parsePptxTemplate(bytes: Uint8Array | ArrayBuffer): Promise<TemplateProfile> {
  let zip: JSZip;
  try {
    zip = await loadZipCapped(bytes);
  } catch (e) {
    if (e instanceof ZipLimitError) throw new TemplateError("too-big", e.message);
    throw new TemplateError("not-pptx", "Fayl PPTX emas (zip ochilmadi)");
  }
  const budget: ZipBudget = { left: TEMPLATE_MAX_XML };
  const read = async (path: string): Promise<string> => {
    const file = zip.file(path);
    if (!file) return "";
    try {
      return await readZipText(file, budget);
    } catch (e) {
      if (e instanceof ZipLimitError) throw new TemplateError("too-big", "Namuna ichidagi ma'lumot juda katta");
      throw new TemplateError("not-pptx", "Fayl PPTX sifatida o'qilmadi (buzilgan arxiv)");
    }
  };

  const pres = await read("ppt/presentation.xml");
  if (!pres) throw new TemplateError("not-pptx", "Fayl PPTX emas (ppt/presentation.xml yo'q)");

  const sz = pres.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
  const size = sz ? { w: round(Number(sz[1]) / EMU), h: round(Number(sz[2]) / EMU) } : { w: 13.333, h: 7.5 };

  // Master: presentation.xml.rels → birinchi slideMaster.
  const presRels = await read("ppt/_rels/presentation.xml.rels");
  const masterPath = relTarget(presRels, "slideMaster", "ppt") ?? "ppt/slideMasters/slideMaster1.xml";
  const masterXml = await read(masterPath);
  const masterRels = await read(relsPathOf(masterPath));
  const masterPhs = placeholdersOf(masterXml);
  const themePath = relTarget(masterRels, "theme", dirOf(masterPath));
  const themeXml = themePath ? await read(themePath) : "";

  // Layoutlar — master rels tartibida (PowerPoint ko'rsatadigan tartib).
  const layoutPaths: string[] = [];
  for (const tag of relTags(masterRels, "slideLayout")) {
    const t = attr(tag, "Target");
    if (t) layoutPaths.push(normalizePath(dirOf(masterPath), t));
  }
  if (!layoutPaths.length) {
    for (const name of Object.keys(zip.files)) if (/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name)) layoutPaths.push(name);
    layoutPaths.sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1]) - Number(b.match(/(\d+)\.xml$/)?.[1]));
  }
  if (!layoutPaths.length) throw new TemplateError("no-layouts", "Namunada slayd maketlari (layout) topilmadi");
  if (layoutPaths.length > MAX_TEMPLATE_LAYOUTS) {
    throw new TemplateError("too-big", `Namunada maketlar juda ko'p (${layoutPaths.length}, chegara ${MAX_TEMPLATE_LAYOUTS})`);
  }

  const layouts: TemplateLayout[] = [];
  for (const path of layoutPaths) {
    const xml = await read(path);
    if (!xml) continue;
    const phs = placeholdersOf(xml).map((p) => {
      if (p.box) return p;
      // Pozitsiyasiz placeholder masterdagi shu tur/idx dan meros oladi.
      const inherit = masterPhs.find((m) => m.idx !== null && m.idx === p.idx) ?? masterPhs.find((m) => m.type === p.type || (p.type === "ctrTitle" && m.type === "title"));
      return { ...p, box: inherit?.box ?? null };
    });
    const name = attr(firstTag(xml, "p:cSld") ?? "", "name") ?? path;
    layouts.push({ path, name, kind: layoutKind(xml, phs), placeholders: phs });
  }

  const roles = pickRoles(layouts);
  const usable = layouts.some((l) => l.placeholders.some((p) => p.type === "title" || p.type === "ctrTitle"));
  if (!usable || !roles.content) {
    throw new TemplateError("no-content", "Namunada sarlavha va matn placeholder'li maket topilmadi — bu fayl shablon sifatida ishlamaydi");
  }
  /*
   * `[Content_Types].xml` ni tahlil ishlatmaydi, lekin keyin `renderLayoutSheet`
   * (web, rasterlash) va `renderPptxWithTemplate` (worker) uni cheklovsiz
   * ochadi — bomba shu yerda, byudjet ichida ushlanadi.
   */
  await read("[Content_Types].xml");

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
