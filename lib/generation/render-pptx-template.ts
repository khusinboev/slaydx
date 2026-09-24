import JSZip from "jszip";
import { fetchImageBytes, type ImageBytes } from "./slide-images";
import { buildSlideDeck } from "./slides";
import { slideNotes } from "./slide-layout";
import { TEMPLATE_MAX_XML, type Placeholder, type TemplateLayout, type TemplateProfile, type TemplateRole } from "./pptx-template";
import { loadZipCapped, readZipText, type ZipBudget } from "./translate/xml-scan";
import { contentOf, roleFor, type Para } from "./template-content";
import { xmlEscape } from "./xml";
export { contentOf, roleFor };
/**
 * `xmlEscape` endi `lib/generation/xml.ts` da yashaydi — tarjima
 * adapterlari (`translate/docx.ts`, `pptx.ts`, `xlsx.ts`) ham aynan shu
 * funksiya bilan yozadi va ular bu og'ir modulni tortib kelmasligi kerak.
 * Bu yerdan re-eksport qilinadi, ya'ni mavjud importlar va
 * `tests/render-pptx-template.test.mts` o'zgarmaydi.
 */
export { xmlEscape };
import type { AcademicDoc, BuiltFile } from "./types";

/**
 * «O'Z SHABLONIM» — dekani foydalanuvchi PPTX namunasining O'Z
 * master/layout/temasi ichiga yozish (Sprint B, B2).
 *
 * Yondashuv — PowerPoint'dagi «shablonni qo'llash» ning o'zi: namuna
 * faylning slaydlari o'chiriladi, master, layoutlar, tema, media
 * QOLADI; har `SlideModel` uchun yangi `slideN.xml` yoziladi, unda faqat
 * PLACEHOLDER'lar (`<p:ph type/idx>`) bor — matn shrift, rang, o'lcham,
 * joylashuvni layoutdan MEROS oladi. Shuning uchun chiqqan fayl
 * namunaning aynan o'zi bo'lib ko'rinadi (gradientlar, shakllar, logotip —
 * vektor holida), biz esa faqat mazmunni beramiz.
 *
 * `normAutofit` — uzun matn placeholder'ga sig'masa PowerPoint/LibreOffice
 * shriftni o'zi kichraytiradi (`fitSize` bu yerda qo'llanmaydi: shrift
 * namunaniki).
 *
 * Rasm: layoutda `pic` placeholder bo'lsa (rasmli maket) — unga; bo'lmasa
 * rasm YOZILMAYDI (matn ustiga tushib ketmasin). Jadval — haqiqiy
 * `<a:tbl>` tana placeholder'i qutisida.
 */

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const REL_LAYOUT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const REL_NOTES_MASTER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
const CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const CT_NOTES = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
const EMU = 914400;

type Box = { x: number; y: number; w: number; h: number };

function paras(items: Para[]): string {
  if (!items.length) return '<a:p><a:endParaRPr lang="uz-UZ"/></a:p>';
  return items
    .map((p) => {
      const pPr = p.lvl ? `<a:pPr lvl="${p.lvl}"/>` : "";
      const rPr = `<a:rPr lang="uz-UZ"${p.bold ? ' b="1"' : ""} dirty="0"/>`;
      return `<a:p>${pPr}<a:r>${rPr}<a:t>${xmlEscape(p.text)}</a:t></a:r></a:p>`;
    })
    .join("");
}

/** Placeholder ko'rsatkichi — layoutdagi bilan AYNAN mos (type + idx). */
function phTag(ph: Placeholder): string {
  const type = ph.type === "obj" ? "" : ` type="${ph.type}"`;
  const idx = ph.idx !== null && ph.idx !== undefined ? ` idx="${ph.idx}"` : "";
  return `<p:ph${type}${idx}/>`;
}

function spText(id: number, ph: Placeholder, items: Para[], autofit = true): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(ph.name || `Placeholder ${id}`)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phTag(ph)}</p:nvPr></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr>${autofit ? "<a:normAutofit/>" : ""}</a:bodyPr><a:lstStyle/>${paras(items)}</p:txBody></p:sp>`
  );
}

function xfrmOf(box: Box | null | undefined): string {
  if (!box) return "";
  return `<a:xfrm><a:off x="${Math.round(box.x * EMU)}" y="${Math.round(box.y * EMU)}"/><a:ext cx="${Math.round(box.w * EMU)}" cy="${Math.round(box.h * EMU)}"/></a:xfrm>`;
}

function spPic(id: number, ph: Placeholder | null, rId: string, box: Box | null): string {
  const nvPr = ph ? `<p:nvPr>${phTag(ph)}</p:nvPr>` : "<p:nvPr/>";
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Rasm ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>${nvPr}</p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmOf(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

/** Jadval — tana placeholder'i qutisida `graphicFrame`. */
function spTable(id: number, box: Box, headers: string[], rows: string[][]): string {
  const cols = Math.max(1, headers.length);
  const colW = Math.round((box.w * EMU) / cols);
  const rowH = Math.round((box.h * EMU) / Math.max(1, rows.length + 1));
  const cell = (t: string, bold: boolean) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="uz-UZ"${bold ? ' b="1"' : ""}/><a:t>${xmlEscape(t)}</a:t></a:r></a:p></a:txBody></a:tc>`;
  const tr = (cells: string[], bold: boolean) =>
    `<a:tr h="${rowH}">${Array.from({ length: cols }, (_, c) => cell(cells[c] ?? "", bold)).join("")}</a:tr>`;
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Jadval ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${Math.round(box.x * EMU)}" y="${Math.round(box.y * EMU)}"/><a:ext cx="${Math.round(box.w * EMU)}" cy="${Math.round(box.h * EMU)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join("")}</a:tblGrid>` +
    tr(headers, true) +
    rows.map((r) => tr(r, false)).join("") +
    `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

function layoutFor(profile: TemplateProfile, role: TemplateRole): TemplateLayout {
  const path = profile.roles[role] ?? profile.roles.content ?? profile.roles.cover ?? profile.layouts[0].path;
  return profile.layouts.find((l) => l.path === path) ?? profile.layouts[0];
}

function findPh(lay: TemplateLayout, ...types: Placeholder["type"][]): Placeholder[] {
  return lay.placeholders.filter((p) => types.includes(p.type));
}

async function loadImage(
  url: string,
  resolveImage?: (url: string) => Promise<ImageBytes | null>,
): Promise<{ bytes: Buffer; ext: "png" | "jpeg" } | null> {
  const img = (resolveImage ? await resolveImage(url) : null) ?? (await fetchImageBytes(url));
  if (!img) return null;
  const comma = img.data.indexOf(",");
  return { bytes: Buffer.from(comma === -1 ? img.data : img.data.slice(comma + 1), "base64"), ext: img.type === "png" ? "png" : "jpeg" };
}

const RELS_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

/** Bitta chiqish slaydi — yig'uvchi (`assemble`) uchun tayyor qismlar. */
type SlideEntry = {
  layoutPath: string;
  /** `<p:spTree>` ichidagi shakllar (XML). */
  shapes: string[];
  /** Slayd rels'iga qo'shimcha bog'lar (rId2… — rId1 layoutniki). */
  rels: string[];
  media: { path: string; bytes: Buffer }[];
  notes?: string;
};

/*
 * SECB-01 (W1-D review R1): `assemble` foydalanuvchi namunasining XML iga
 * qo'llaydigan `/<Override\b[^>]*PartName="…"[^>]*\/>/g`,
 * `/<Relationship\b[^>]*Type="…"[^>]*\/>/g`, `/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/`
 * yopilmagan tegda har boshlanishdan oxirigacha qayta skanerlardi (O(n²):
 * 200 KB ≈ 2,5 s, 40 MB byudjet ichida — daqiqalar, web jarayonida).
 * Quyidagilar o'sha regexlar bilan AYNAN bir xil natija beradi (differensial
 * fuzz), lekin har tegni bir marta ko'radi.
 */

function isWordCode(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/** `lit` `s` ning `i` o'rnida; `dotAny` — regexdagi `.` (qator oxiridan boshqa har belgi). */
function litAt(s: string, i: number, lit: string, dotAny: boolean): boolean {
  if (i + lit.length > s.length) return false;
  for (let k = 0; k < lit.length; k++) {
    const c = lit.charCodeAt(k);
    const d = s.charCodeAt(i + k);
    if (dotAny && c === 46) {
      if (d === 10 || d === 13 || d === 0x2028 || d === 0x2029) return false;
      continue;
    }
    if (c !== d) return false;
  }
  return true;
}

/**
 * `xml.replace(/<NAME\b[^>]*(LIT₁|LIT₂…)([^"]*")?[^>]*\/>/g, "")` ning chiziqli
 * teng varianti (`quoteTail` — LIT dan keyin `[^"]*"` bormi).
 *
 * Birinchi `[^>]*` birinchi `>` (`g1`) dan o'tolmaydi, ya'ni LIT shu oraliqda;
 * u ochko'z — eng o'ngdagi mos LIT birinchi sinaladi. Oxirgi `[^>]*\/>` —
 * LIT (va qo'shtirnoq) dan keyingi birinchi `>` va undan oldin `/`. Moslik
 * bo'lmasa, `(o, g1)` dagi boshqa ochilishlar ham aynan shu sabab bilan
 * yiqiladi — qidiruv `g1` dan davom etadi.
 */
function removeTags(xml: string, name: string, lits: string[], opts: { quoteTail: boolean; dotAny: boolean }): string {
  const open = `<${name}`;
  let out = "";
  let from = 0;
  let o = xml.indexOf(open);
  while (o >= 0) {
    const a = o + open.length;
    if (a < xml.length && isWordCode(xml.charCodeAt(a))) {
      o = xml.indexOf(open, o + 1);
      continue;
    }
    const g1 = xml.indexOf(">", a);
    // `/>` uchun `>` kerak — undan keyingi ochilishlarda ham bo'lmaydi.
    if (g1 < 0) break;
    let end = -1;
    for (let p = g1 - 1; p >= a && end < 0; p--) {
      for (const lit of lits) {
        if (!litAt(xml, p, lit, opts.dotAny)) continue;
        let q = p + lit.length;
        if (opts.quoteTail) {
          const quote = xml.indexOf('"', q);
          if (quote < 0) continue;
          q = quote + 1;
        }
        // `[a, g1)` da `>` yo'q: q ≤ g1 bo'lsa birinchi `>` — aynan g1.
        const g2 = q <= g1 ? g1 : xml.indexOf(">", q);
        if (g2 > q && xml.charCodeAt(g2 - 1) === 47) {
          end = g2 + 1;
          break;
        }
      }
    }
    if (end < 0) {
      o = xml.indexOf(open, g1);
      continue;
    }
    out += xml.slice(from, o);
    from = end;
    o = xml.indexOf(open, end);
  }
  return from ? out + xml.slice(from) : xml;
}

/** `xml.replace(/OPEN[\s\S]*?CLOSE/, rep)` — birinchi ochilishdan keyingi birinchi yopilish. */
function replaceFirstBlock(xml: string, open: string, close: string, rep: string): string {
  const o = xml.indexOf(open);
  if (o < 0) return xml;
  const c = xml.indexOf(close, o + open.length);
  if (c < 0) return xml;
  return xml.slice(0, o) + rep + xml.slice(c + close.length);
}

/**
 * Namuna zip'idan XML — `parsePptxTemplate` bilan bir xil byudjet ichida.
 * Tuzatishdan OLDIN saqlangan namunalar hech qachon tekshirilmagan edi.
 */
async function readTemplateText(zip: JSZip, path: string, budget: ZipBudget): Promise<string> {
  const file = zip.file(path);
  return file ? readZipText(file, budget) : "";
}

/**
 * Namuna zip'idagi eski slaydlarni olib tashlab, `entries` ni yozadi:
 * `slideN.xml` + rels, notes, `[Content_Types].xml`, `presentation.xml`
 * `sldIdLst` va `presentation.xml.rels`. Master/layout/tema/media QOLADI.
 */
async function assemble(zip: JSZip, entries: SlideEntry[]): Promise<Uint8Array> {
  for (const name of Object.keys(zip.files)) {
    if (/^ppt\/slides\//.test(name) || /^ppt\/notesSlides\//.test(name)) zip.remove(name);
  }
  const budget: ZipBudget = { left: TEMPLATE_MAX_XML };
  let ct = await readTemplateText(zip, "[Content_Types].xml", budget);
  ct = removeTags(ct, "Override", ['PartName="/ppt/slides/', 'PartName="/ppt/notesSlides/'], { quoteTail: true, dotAny: false });
  if (!/Extension="jpeg"/i.test(ct)) ct = ct.replace("</Types>", '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
  if (!/Extension="png"/i.test(ct)) ct = ct.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');

  let presRels = await readTemplateText(zip, "ppt/_rels/presentation.xml.rels", budget);
  // Eski kod `new RegExp` bilan qurardi — URI dagi `.` regex «har belgi» edi; shu saqlanadi.
  presRels = removeTags(presRels, "Relationship", [`Type="${REL_SLIDE}"`], { quoteTail: false, dotAny: true });
  let pres = await readTemplateText(zip, "ppt/presentation.xml", budget);
  pres = replaceFirstBlock(pres, "<p:sldIdLst>", "</p:sldIdLst>", "<p:sldIdLst/>");
  if (!/<p:sldIdLst\/>/.test(pres)) {
    // Namunada umuman slayd bo'lmagan — ro'yxatni masterlardan keyin qo'shamiz.
    pres = pres.replace(/(<\/p:sldMasterIdLst>)/, "$1<p:sldIdLst/>");
  }

  const usedRIds = new Set(Array.from(presRels.matchAll(/Id="(rId\d+)"/g)).map((m) => m[1]));
  let nextR = 1;
  const freshRId = () => {
    while (usedRIds.has(`rId${nextR}`)) nextR++;
    const id = `rId${nextR++}`;
    usedRIds.add(id);
    return id;
  };
  const notesMaster = Object.keys(zip.files).find((f) => /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(f));

  const sldIds: string[] = [];
  entries.forEach((e, i) => {
    const n = i + 1;
    const rels = [`<Relationship Id="rId1" Type="${REL_LAYOUT}" Target="../${e.layoutPath.replace(/^ppt\//, "")}"/>`, ...e.rels];
    for (const m of e.media) zip.file(m.path, m.bytes);

    if (e.notes && notesMaster) {
      const notesPath = `ppt/notesSlides/notesSlide${n}.xml`;
      zip.file(
        notesPath,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
          `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras(e.notes.split("\n").map((t) => ({ text: t })))}</p:txBody></p:sp>` +
          `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
      );
      zip.file(
        `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
        `${RELS_HEAD}<Relationship Id="rId1" Type="${REL_NOTES_MASTER}" Target="../${notesMaster.replace(/^ppt\//, "")}"/><Relationship Id="rId2" Type="${REL_SLIDE}" Target="../slides/slide${n}.xml"/></Relationships>`,
      );
      ct = ct.replace("</Types>", `<Override PartName="/${notesPath}" ContentType="${CT_NOTES}"/></Types>`);
      rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${REL_NOTES}" Target="../notesSlides/notesSlide${n}.xml"/>`);
    }

    const slidePath = `ppt/slides/slide${n}.xml`;
    zip.file(
      slidePath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${e.shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, `${RELS_HEAD}${rels.join("")}</Relationships>`);
    ct = ct.replace("</Types>", `<Override PartName="/${slidePath}" ContentType="${CT_SLIDE}"/></Types>`);
    const rId = freshRId();
    presRels = presRels.replace("</Relationships>", `<Relationship Id="${rId}" Type="${REL_SLIDE}" Target="slides/slide${n}.xml"/></Relationships>`);
    sldIds.push(`<p:sldId id="${256 + i}" r:id="${rId}"/>`);
  });

  pres = pres.replace("<p:sldIdLst/>", `<p:sldIdLst>${sldIds.join("")}</p:sldIdLst>`);
  zip.file("ppt/presentation.xml", pres);
  zip.file("ppt/_rels/presentation.xml.rels", presRels);
  zip.file("[Content_Types].xml", ct);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Rollar tartibi — rasterlashda sahifa ↔ rol mosligi shu tartibda. */
export const TEMPLATE_ROLES: TemplateRole[] = ["cover", "section", "content", "two", "picture", "blank"];

/**
 * Har rol layouti uchun BO'SH slayd (placeholder'siz) — fon rasterlash
 * uchun (B1). Qaytadi: PPTX va sahifa tartibidagi rollar (takror layout
 * bir marta chiziladi, bir necha rol shu sahifaga ishora qiladi).
 */
export async function renderLayoutSheet(
  templateBytes: Uint8Array | ArrayBuffer,
  profile: TemplateProfile,
): Promise<{ bytes: Uint8Array; pages: { layoutPath: string; roles: TemplateRole[] }[] }> {
  const zip = await loadZipCapped(templateBytes);
  const pages: { layoutPath: string; roles: TemplateRole[] }[] = [];
  for (const role of TEMPLATE_ROLES) {
    const path = profile.roles[role];
    if (!path) continue;
    const page = pages.find((p) => p.layoutPath === path);
    if (page) page.roles.push(role);
    else pages.push({ layoutPath: path, roles: [role] });
  }
  const bytes = await assemble(
    zip,
    pages.map((p) => ({ layoutPath: p.layoutPath, shapes: [], rels: [], media: [] })),
  );
  return { bytes, pages };
}

/**
 * Namuna PPTX + deka → yangi PPTX (namuna master/layout/temasi bilan).
 */
export async function renderPptxWithTemplate(
  doc: AcademicDoc,
  fileName: string,
  templateBytes: Uint8Array | ArrayBuffer,
  profile: TemplateProfile,
  opts?: { resolveImage?: (url: string) => Promise<ImageBytes | null> },
): Promise<BuiltFile> {
  const zip = await loadZipCapped(templateBytes);
  const deck = buildSlideDeck(doc);
  const entries: SlideEntry[] = [];
  let mediaN = 1;

  for (const s of deck.slides) {
    const role = roleFor(s.layout, Boolean(s.image?.url), profile.roles);
    const lay = layoutFor(profile, role);
    const c = contentOf(s);
    const entry: SlideEntry = { layoutPath: lay.path, shapes: [], rels: [], media: [], notes: slideNotes(s, deck.speakerNotes) || undefined };
    let id = 2;

    const [titlePh] = findPh(lay, "ctrTitle", "title");
    if (titlePh) entry.shapes.push(spText(id++, titlePh, [{ text: c.title }]));
    const [subPh] = findPh(lay, "subTitle");
    if (subPh && c.sub) entry.shapes.push(spText(id++, subPh, [{ text: c.sub }]));

    const bodyPhs = findPh(lay, "body", "obj").filter((p) => p !== subPh);
    const bodies = c.bodies.filter((b) => b.length);
    if (c.table && bodyPhs[0]?.box) {
      entry.shapes.push(spTable(id++, bodyPhs[0].box, c.table.headers, c.table.rows));
    } else if (bodyPhs.length >= 2 && bodies.length >= 2) {
      entry.shapes.push(spText(id++, bodyPhs[0], bodies[0]));
      entry.shapes.push(spText(id++, bodyPhs[1], bodies[1]));
    } else if (bodyPhs[0] && bodies.length) {
      const merged = bodies.length > 1 ? bodies.flatMap((b, k) => (k ? [{ text: "" }, ...b] : b)) : bodies[0];
      entry.shapes.push(spText(id++, bodyPhs[0], merged));
    } else if (!bodyPhs[0] && subPh && !c.sub && bodies.length) {
      // Muqova maketida tana yo'q — birinchi blok izoh placeholder'iga (masalan iqtibos).
      entry.shapes.push(spText(id++, subPh, bodies[0]));
    } else if (c.table && !bodyPhs[0]) {
      // Jadval, tana qutisi yo'q — slayd markazida.
      const { w, h } = profile.size;
      entry.shapes.push(spTable(id++, { x: w * 0.06, y: h * 0.22, w: w * 0.88, h: h * 0.62 }, c.table.headers, c.table.rows));
    }

    // Rasm — faqat `pic` placeholder bo'lsa.
    const [picPh] = findPh(lay, "pic");
    if (picPh && s.image?.url) {
      const img = await loadImage(s.image.url, opts?.resolveImage);
      if (img) {
        const media = `ppt/media/slaydx-${mediaN++}.${img.ext}`;
        entry.media.push({ path: media, bytes: img.bytes });
        const rId = `rId${entry.rels.length + 2}`;
        entry.rels.push(`<Relationship Id="${rId}" Type="${REL_IMAGE}" Target="../${media.replace(/^ppt\//, "")}"/>`);
        entry.shapes.push(spPic(id++, picPh, rId, null));
      }
    }
    entries.push(entry);
  }

  const bytes = await assemble(zip, entries);
  return {
    html: "",
    bytes,
    fileName,
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc,
  };
}
