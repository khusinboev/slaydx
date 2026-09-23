import type JSZip from "jszip";
import { loadZipCapped, readZipText, type ZipBudget } from "./generation/translate/xml-scan";
import { MAX_PDF_PAGES } from "./generation/translate/pdf";

const ENT: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * XML entity larni ochadi.
 *
 * Ilgari raqamli entity lar (`&#8217;`, `&#x2019;`) jadvalda yo'qligi
 * uchun matnda xom holida qolardi — hujjatga «Ona&#8217;m» kabi
 * yozuvlar tushardi.
 */
function decode(s: string) {
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Surrogat va noto'g'ri kodlar `String.fromCodePoint` da xato beradi.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      if (code >= 0xd800 && code <= 0xdfff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENT[m.toLowerCase()] ?? m;
  });
}

/*
 * Chiziqli skanerlar (SECB-01).
 *
 * Ilgari bu yerda `/[ \t]+\n/`, `/<[^>]+>/`, `/<w:br\b[^/]*\/>/`,
 * `/<w:t\b[^>]*>([^<]*)<\/w:t>/` turardi. Ularning har biri «yopilmagan»
 * uzun qatorda HAR boshlanish nuqtasidan oxirigacha qayta skanerlardi —
 * O(n²): 40 000 bo'shliq ≈ 1 s, 1 MB ≈ 12 daqiqa, butun web jarayoni shu
 * vaqt javob bermasdi. Quyidagi funksiyalar AYNAN o'sha regexlar natijasini
 * beradi (bayt-ba-bayt), lekin muvaffaqiyatsiz urinishdan keyin qidiruv
 * o'sha urinish ko'rgan joydan davom etadi — oradagi boshlanishlar ham
 * aynan shu sabab bilan muvaffaqiyatsiz bo'ladi.
 */

function isWordCode(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/** Regexdagi `\b`: nomdan keyin so'z belgisi kelmasa (yoki satr tugasa). */
function boundaryAt(s: string, i: number): boolean {
  return i >= s.length || !isWordCode(s.charCodeAt(i));
}

/** `s.replace(/<name\b[^/]*\/>/g, rep)` ning chiziqli teng varianti. */
function replaceEmptyTag(s: string, name: string, rep: string): string {
  const open = `<${name}`;
  let out = "";
  let from = 0;
  let at = 0;
  for (;;) {
    const o = s.indexOf(open, at);
    if (o < 0) break;
    if (!boundaryAt(s, o + open.length)) {
      at = o + 1;
      continue;
    }
    // `[^/]*` birinchi `/` da to'xtaydi; moslik faqat undan keyin `>` bo'lsa.
    const slash = s.indexOf("/", o + open.length);
    if (slash < 0) break;
    if (s.charCodeAt(slash + 1) !== 62) {
      at = slash + 1;
      continue;
    }
    out += s.slice(from, o) + rep;
    from = at = slash + 2;
  }
  return from ? out + s.slice(from) : s;
}

/**
 * `s.replace(/<name\b[^>]*>([^<]*)<\/name>/g, (_, t) => onMatch(t))` ning
 * chiziqli teng varianti; `found` — kamida bitta moslik bo'ldimi.
 */
function mapElemText(s: string, name: string, onMatch: (text: string) => string): { out: string; found: boolean } {
  const open = `<${name}`;
  const close = `</${name}>`;
  let out = "";
  let from = 0;
  let at = 0;
  let found = false;
  for (;;) {
    const o = s.indexOf(open, at);
    if (o < 0) break;
    if (!boundaryAt(s, o + open.length)) {
      at = o + 1;
      continue;
    }
    const gt = s.indexOf(">", o + open.length);
    if (gt < 0) break;
    const lt = s.indexOf("<", gt + 1);
    if (lt < 0) break;
    if (!s.startsWith(close, lt)) {
      at = lt;
      continue;
    }
    found = true;
    out += s.slice(from, o) + onMatch(s.slice(gt + 1, lt));
    from = at = lt + close.length;
  }
  return { out: from ? out + s.slice(from) : s, found };
}

/** `s.replace(/<[^>]+>/g, "")` ning chiziqli teng varianti. */
function stripTags(s: string): string {
  let out = "";
  let from = 0;
  let at = 0;
  for (;;) {
    const lt = s.indexOf("<", at);
    if (lt < 0) break;
    const gt = s.indexOf(">", lt + 1);
    // Undan keyin `>` yo'q — keyingi hech bir `<` ham yopilmaydi.
    if (gt < 0) break;
    if (gt === lt + 1) {
      at = lt + 1;
      continue;
    }
    out += s.slice(from, lt);
    from = at = gt + 1;
  }
  return from ? out + s.slice(from) : s;
}

/** Qator oxiridagi `[ \t]+` (boshqa bo'shliq turlari emas). */
function trimBlankEnd(line: string): string {
  let end = line.length;
  while (end > 0) {
    const c = line.charCodeAt(end - 1);
    if (c !== 32 && c !== 9) break;
    end--;
  }
  return end === line.length ? line : line.slice(0, end);
}

function tidy(s: string) {
  // `/[ \t]+\n/g → "\n"` = oxirgisidan boshqa har qator oxiridagi bo'shliqni kesish.
  const lines = s.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length - 1; i++) lines[i] = trimBlankEnd(lines[i]);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fromDocxXml(xml: string) {
  const withBreaks = replaceEmptyTag(replaceEmptyTag(xml.replace(/<\/w:p>/g, "\n"), "w:br", "\n"), "w:tab", "\t");
  const { out, found } = mapElemText(withBreaks, "w:t", (t) => decode(t));
  return found ? tidy(stripTags(out)) : "";
}

function fromPptxXml(xml: string) {
  const withBreaks = replaceEmptyTag(xml.replace(/<\/a:p>/g, "\n"), "a:br", "\n");
  return tidy(stripTags(mapElemText(withBreaks, "a:t", (t) => decode(t)).out));
}

function fromXlsxShared(xml: string) {
  const parts: string[] = [];
  mapElemText(xml, "t", (t) => {
    parts.push(decode(t).trim());
    return "";
  });
  return tidy(parts.filter(Boolean).join("\n"));
}

/**
 * Arxivdan bitta yozuvni ochadi — ochilgan hajm chegarasi bilan.
 *
 * DOCX/PPTX oddiy ZIP. 8 MB lik arxiv gigabaytlab XML ga ochilishi
 * mumkin («zip bomb»). Ilgari chegara metadatadagi hajmga ishonardi va
 * haqiqiy uzunlik faqat butun yozuv xotiraga ochilgach tekshirilardi;
 * endi `readZipText` oqimni sanab, chegarada to'xtatadi (SECB-02).
 */
async function readEntry(zip: JSZip, name: string, budget: ZipBudget): Promise<string> {
  const file = zip.file(name);
  return file ? readZipText(file, budget) : "";
}

async function fromZip(buf: ArrayBuffer, kind: "docx" | "pptx" | "xlsx") {
  const zip = await loadZipCapped(buf);
  // Ochilgan XML uchun umumiy byudjet.
  const budget: ZipBudget = { left: MAX_UNZIPPED_BYTES };

  if (kind === "docx") {
    return fromDocxXml(await readEntry(zip, "word/document.xml", budget));
  }
  if (kind === "xlsx") {
    return fromXlsxShared(await readEntry(zip, "xl/sharedStrings.xml", budget));
  }

  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) =>
      (a.match(/\d+/)?.[0] || "0").localeCompare(b.match(/\d+/)?.[0] || "0", undefined, {
        numeric: true,
      }),
    )
    // Juda ko'p slaydli fayl ham byudjetni yeydi.
    .slice(0, 500);

  const chunks: string[] = [];
  for (const name of slides) {
    const xml = await readEntry(zip, name, budget);
    if (!xml) continue;
    const t = fromPptxXml(xml);
    if (t) chunks.push(t);
  }
  return tidy(chunks.join("\n\n"));
}

type PdfTextItem = { str?: string | null; hasEOL?: boolean };

/**
 * PDF matni — ko'pi bilan `MAX_PDF_PAGES` sahifa (SECB-04/FILE-04).
 *
 * Ilgari `unpdf.extractText` HAMMA sahifani o'qirdi (20 MB = o'n minglab
 * sahifa). Endi birinchi `MAX_PDF_PAGES` tasi o'qiladi va `truncated`
 * qaytadi — javob baribir 200 000 belgiga kesiladi, ya'ni «fayl asosida»
 * rejimi uchun bu natijani o'zgartirmaydi. Sahifa matni va birlashtirish
 * `extractText({ mergePages: true })` bilan aynan bir xil.
 */
async function readPdfText(buf: ArrayBuffer): Promise<{ text: string; truncated: boolean }> {
  if (typeof window !== "undefined") {
    throw new Error("PDF serverda o‘qiladi");
  }
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  try {
    const count = Math.min(doc.numPages, MAX_PDF_PAGES);
    const texts: string[] = [];
    for (let n = 1; n <= count; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      texts.push(
        (content.items as PdfTextItem[])
          .filter((item) => item.str != null)
          .map((item) => item.str + (item.hasEOL ? "\n" : ""))
          .join(""),
      );
    }
    const merged = texts.join("\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
    return { text: tidy(merged), truncated: doc.numPages > MAX_PDF_PAGES };
  } finally {
    await doc.loadingTask.destroy().catch((e: unknown) => console.warn("[extract] pdf yopilmadi", e));
  }
}

export async function extractPdfBuffer(buf: ArrayBuffer): Promise<string> {
  return (await readPdfText(buf)).text;
}

/** Fayl kengaytmasi emas, haqiqiy imzosi bo'yicha turini aniqlaydi. */
function sniff(buf: ArrayBuffer): "zip" | "pdf" | "unknown" {
  const b = new Uint8Array(buf.slice(0, 5));
  // PK\x03\x04 — ZIP (DOCX/PPTX/XLSX shu formatda).
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) {
    return "zip";
  }
  // %PDF-
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  return "unknown";
}

export function extOf(name: string) {
  return (name.split(".").pop() || "").toLowerCase();
}

/** `truncated` — PDF `MAX_PDF_PAGES` sahifadan uzun edi, faqat boshi o'qildi. */
export async function extractFromBuffer(
  name: string,
  buf: ArrayBuffer,
): Promise<{ text: string; error?: string; truncated?: boolean }> {
  const ext = extOf(name);
  const kind = sniff(buf);
  try {
    if (ext === "txt" || ext === "md" || ext === "csv") {
      // `fatal: false` — noto'g'ri baytlar U+FFFD ga aylanadi, xato tashlamaydi.
      return { text: tidy(new TextDecoder("utf-8").decode(buf)) };
    }

    // Kengaytma va haqiqiy tur mos kelmasa, aniq xabar beramiz —
    // aks holda JSZip tushunarsiz «Can't find end of central directory»
    // xatosini foydalanuvchiga ko'rsatardi.
    if (ext === "docx" || ext === "pptx" || ext === "xlsx") {
      if (kind !== "zip") {
        return {
          text: "",
          error: `Fayl haqiqiy ${ext.toUpperCase()} emas (ichki formati mos kelmadi). Boshqa fayl yuboring.`,
        };
      }
      return { text: await fromZip(buf, ext) };
    }

    if (ext === "pdf") {
      if (kind !== "pdf") {
        return { text: "", error: "Fayl haqiqiy PDF emas. Boshqa fayl yuboring." };
      }
      const pdf = await readPdfText(buf);
      return pdf.truncated ? { text: pdf.text, truncated: true } : { text: pdf.text };
    }

    return { text: "", error: "Bu format qo‘llab-quvvatlanmaydi. DOCX, PDF, PPTX, TXT yuboring." };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fayldan matn olinmadi";
    console.warn("[extract]", ext, message);
    // Ichki kutubxona xatosi foydalanuvchiga tushunarsiz — umumlashtiramiz.
    return {
      text: "",
      error: /juda (katta|ko'p)/.test(message)
        ? message
        : "Faylni o‘qib bo‘lmadi. U buzilgan yoki parol bilan himoyalangan bo‘lishi mumkin.",
    };
  }
}

export const EXTRACT_ACCEPT = ".txt,.md,.csv,.docx,.pdf,.pptx,.xlsx";
export const EXTRACT_MAX_BYTES = 8 * 1024 * 1024;

/** ZIP ichidan ochiladigan XML uchun umumiy chegara (zip bomb himoyasi). */
export const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024;

/** Klientga qaytariladigan matnning eng katta uzunligi. */
export const EXTRACT_MAX_CHARS = 200_000;
