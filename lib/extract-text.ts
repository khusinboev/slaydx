import JSZip from "jszip";

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

function tidy(s: string) {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fromDocxXml(xml: string) {
  const withBreaks = xml.replace(/<\/w:p>/g, "\n").replace(/<w:br\b[^/]*\/>/g, "\n").replace(/<w:tab\b[^/]*\/>/g, "\t");
  const texts = [...withBreaks.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => decode(m[1]));
  if (texts.length) {
    return tidy(
      withBreaks
        .replace(/<w:t\b[^>]*>([^<]*)<\/w:t>/g, (_, t) => decode(t))
        .replace(/<[^>]+>/g, ""),
    );
  }
  return "";
}

function fromPptxXml(xml: string) {
  return tidy(
    xml
      .replace(/<\/a:p>/g, "\n")
      .replace(/<a:br\b[^/]*\/>/g, "\n")
      .replace(/<a:t\b[^>]*>([^<]*)<\/a:t>/g, (_, t) => decode(t))
      .replace(/<[^>]+>/g, ""),
  );
}

function fromXlsxShared(xml: string) {
  const parts = [...xml.matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)].map((m) => decode(m[1]).trim());
  return tidy(parts.filter(Boolean).join("\n"));
}

/**
 * Arxivdan bitta yozuvni ochadi — ochilgan hajm chegarasi bilan.
 *
 * DOCX/PPTX oddiy ZIP. 8 MB lik arxiv gigabaytlab XML ga ochilishi
 * mumkin («zip bomb»): ilgari `file.async("string")` shunday yozuvni
 * so'zsiz xotiraga chiqarardi va processni yiqitardi.
 */
async function readEntry(
  zip: JSZip,
  name: string,
  budget: { left: number },
): Promise<string> {
  const file = zip.file(name);
  if (!file) return "";

  // JSZip yozuvning ochilgan hajmini metadatada saqlaydi.
  const declared = (file as unknown as { _data?: { uncompressedSize?: number } })._data
    ?.uncompressedSize;
  if (typeof declared === "number" && declared > budget.left) {
    throw new Error("Hujjat ichidagi ma'lumot juda katta");
  }

  const text = await file.async("string");
  budget.left -= text.length;
  if (budget.left < 0) throw new Error("Hujjat ichidagi ma'lumot juda katta");
  return text;
}

async function fromZip(buf: ArrayBuffer, kind: "docx" | "pptx" | "xlsx") {
  const zip = await JSZip.loadAsync(buf);
  // Ochilgan XML uchun umumiy byudjet.
  const budget = { left: MAX_UNZIPPED_BYTES };

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

export async function extractPdfBuffer(buf: ArrayBuffer): Promise<string> {
  if (typeof window !== "undefined") {
    throw new Error("PDF serverda o‘qiladi");
  }
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(buf), { mergePages: true });
  const raw = result.text;
  const text = Array.isArray(raw) ? raw.join("\n\n") : String(raw || "");
  return tidy(text);
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

export async function extractFromBuffer(name: string, buf: ArrayBuffer): Promise<{ text: string; error?: string }> {
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
      return { text: await extractPdfBuffer(buf) };
    }

    return { text: "", error: "Bu format qo‘llab-quvvatlanmaydi. DOCX, PDF, PPTX, TXT yuboring." };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fayldan matn olinmadi";
    console.warn("[extract]", ext, message);
    // Ichki kutubxona xatosi foydalanuvchiga tushunarsiz — umumlashtiramiz.
    return {
      text: "",
      error: /juda katta/.test(message)
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
