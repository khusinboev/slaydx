import JSZip from "jszip";

/**
 * Chuqurlikni biladigan XML teg skaneri.
 *
 * Nega o'z skanerimiz: tarjima adapteri hujjatni QAYTA YOZMAYDI — u
 * asl XML satrining ANIQ offsetlariga nuqtali tuzatish kiritadi. To'liq
 * DOM parser (yoki `fast-xml-parser` kabi kutubxona) hujjatni obyektga
 * aylantirib, keyin qayta serializatsiya qiladi — bu esa atribut
 * tartibi, bo'sh joy, nomlar fazosi prefikslari va bizga notanish
 * elementlarni jimgina o'zgartiradi. Word/PowerPoint bunday «tozalangan»
 * faylni ochadi, lekin uslub/raqamlash/rasm bog'lanishlari sindirilgan
 * bo'lishi mumkin. Offsetli tuzatishda esa TEGILMAGAN hamma narsa
 * bayt-ba-bayt saqlanadi.
 *
 * Skaner OOXML uchun yetarli darajada minimal: izohlar, `<?…?>`,
 * `<![CDATA[…]]>` o'tkaziladi, qolgani oddiy teglar.
 */

export type Tag = {
  name: string;
  /** `<` belgisining indeksi. */
  start: number;
  /** `>` dan keyingi indeks. */
  end: number;
  /** Teg nomidan keyingi xom atribut matni. */
  attrs: string;
  kind: "open" | "close" | "self";
};

export type Elem = {
  name: string;
  attrs: string;
  /** Butun element (`<w:p …>` dan `</w:p>` gacha). */
  start: number;
  end: number;
  /** Element ichi (o'z-o'zini yopganda `innerStart === innerEnd`). */
  innerStart: number;
  innerEnd: number;
  selfClosing: boolean;
};

/**
 * XML dagi teglarni ketma-ket qaytaradi.
 *
 * `from`/`to` chegaralari element ICHIDA skanerlash uchun — masalan
 * `<w:p>` ning bevosita bolalarini o'qiyotganda.
 */
export function* scanTags(xml: string, from = 0, to: number = xml.length): Generator<Tag> {
  let i = from;
  while (i < to) {
    const lt = xml.indexOf("<", i);
    if (lt < 0 || lt >= to) return;
    // Izoh / CDATA / e'lon — mazmuni teg emas, sakraymiz.
    if (xml.startsWith("<!--", lt)) {
      const close = xml.indexOf("-->", lt);
      i = close < 0 ? to : close + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const close = xml.indexOf("]]>", lt);
      i = close < 0 ? to : close + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const close = xml.indexOf(">", lt);
      i = close < 0 ? to : close + 1;
      continue;
    }
    const gt = closingBracket(xml, lt, to);
    if (gt < 0) return;

    const isClose = xml[lt + 1] === "/";
    const body = xml.slice(lt + (isClose ? 2 : 1), gt);
    const selfClosing = !isClose && body.endsWith("/");
    const clean = selfClosing ? body.slice(0, -1) : body;
    const m = /^[^\s/>]+/.exec(clean);
    if (m) {
      yield {
        name: m[0],
        start: lt,
        end: gt + 1,
        attrs: clean.slice(m[0].length),
        kind: isClose ? "close" : selfClosing ? "self" : "open",
      };
    }
    i = gt + 1;
  }
}

/**
 * Teg yopiladigan `>` ni topadi — atribut qiymati ichidagi `>` ni
 * hisobga olmasdan.
 *
 * OOXML da bu haqiqatan uchraydi (masalan `w:instr=" REF a>b "`), va
 * oddiy `indexOf(">")` tegni yarmida kesib, butun qismni siljitib
 * yuborardi.
 */
function closingBracket(xml: string, lt: number, to: number): number {
  let quote: string | null = null;
  for (let i = lt + 1; i < to; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  return -1;
}

/**
 * Berilgan nomdagi BARCHA elementlarni (ichma-ichlarini ham) hujjat
 * tartibida qaytaradi.
 *
 * Ichma-ich muhim: `<w:txbxContent>` ichidagi `<w:p>` ham alohida
 * paragraf va u ham tarjima qilinishi kerak.
 */
export function findAll(xml: string, name: string, from = 0, to: number = xml.length): Elem[] {
  const out: Elem[] = [];
  const stack: Tag[] = [];
  for (const t of scanTags(xml, from, to)) {
    if (t.name !== name) continue;
    if (t.kind === "self") {
      out.push({
        name,
        attrs: t.attrs,
        start: t.start,
        end: t.end,
        innerStart: t.end,
        innerEnd: t.end,
        selfClosing: true,
      });
      continue;
    }
    if (t.kind === "open") {
      stack.push(t);
      continue;
    }
    const open = stack.pop();
    if (!open) continue;
    out.push({
      name,
      attrs: open.attrs,
      start: open.start,
      end: t.end,
      innerStart: open.end,
      innerEnd: t.start,
      selfClosing: false,
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Elementning BEVOSITA bolalari (ichma-ich tushmaydi).
 *
 * Paragrafni qismlarga ajratishda kerak: `<w:r>` ni ko'ramiz, lekin
 * uning ichidagi `<w:r>` (matn qutisi ichida bo'lishi mumkin) ni emas.
 */
export function children(xml: string, innerStart: number, innerEnd: number): Elem[] {
  const out: Elem[] = [];
  let depth = 0;
  let open: Tag | null = null;
  for (const t of scanTags(xml, innerStart, innerEnd)) {
    if (t.kind === "self") {
      if (depth === 0) {
        out.push({
          name: t.name,
          attrs: t.attrs,
          start: t.start,
          end: t.end,
          innerStart: t.end,
          innerEnd: t.end,
          selfClosing: true,
        });
      }
      continue;
    }
    if (t.kind === "open") {
      if (depth === 0) open = t;
      depth++;
      continue;
    }
    depth--;
    if (depth === 0 && open) {
      out.push({
        name: open.name,
        attrs: open.attrs,
        start: open.start,
        end: t.end,
        innerStart: open.end,
        innerEnd: t.start,
        selfClosing: false,
      });
      open = null;
    }
    // Muvozanatsiz yopuvchi teg (buzuq XML) — chuqurlik manfiyga tushmasin.
    if (depth < 0) depth = 0;
  }
  return out;
}

/** Xom atribut matnidan bitta atribut qiymatini oladi (ochilmagan holida). */
export function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*("([^"]*)"|'([^']*)')`);
  const m = re.exec(attrs);
  if (!m) return undefined;
  return m[2] ?? m[3] ?? "";
}

/* ────────────────────────────────────────────────────────────────────
 * OOXML arxivi — DOCX/PPTX/XLSX uchun umumiy.
 *
 * Bu yerda turadi, chunki uchala adapter ham bir xil ish qiladi: ZIP ni
 * ochish, bir necha XML yozuvini o'qish, ularni almashtirib arxivni
 * qayta yig'ish. Alohida `zip.ts` yozilmadi — WP2 fayl ro'yxati qat'iy,
 * va bu qatlam skaner bilan bir xil «past daraja» ga tegishli.
 * ──────────────────────────────────────────────────────────────────── */

/** Ochilgan XML uchun umumiy byudjet — «zip bomba» himoyasi. */
export const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024;

export type Ooxml = {
  zip: JSZip;
  /** Ochilgan XML yozuvlari (yo'l → matn). */
  parts: Map<string, string>;
  names: string[];
};

export async function openOoxml(bytes: Uint8Array, want: (name: string) => boolean): Promise<Ooxml> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const parts = new Map<string, string>();
  let budget = MAX_UNZIPPED_BYTES;
  for (const name of names) {
    if (!want(name)) continue;
    const file = zip.file(name);
    if (!file) continue;
    const declared = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declared === "number" && declared > budget) {
      throw new Error("Hujjat ichidagi ma'lumot juda katta");
    }
    const text = await file.async("string");
    budget -= text.length;
    if (budget < 0) throw new Error("Hujjat ichidagi ma'lumot juda katta");
    parts.set(name, text);
  }
  return { zip, parts, names };
}

/**
 * Almashtirilgan XML yozuvlari bilan arxivni qayta yig'adi.
 *
 * TEGILMAGAN yozuvlar (media, tema, uslublar, raqamlash, master) o'z
 * baytlari bilan qoladi — faqat qayta siqiladi. Aynan shu sabab tarjima
 * qilingan fayl Word/PowerPoint da asl ko'rinishida ochiladi.
 */
export async function saveOoxml(o: Ooxml, changed: Map<string, string>): Promise<Uint8Array> {
  for (const [name, xml] of changed) o.zip.file(name, xml);
  const out = await o.zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return out;
}

/** `slide12.xml` → 12. Raqamli tartiblash uchun. */
export function numIn(name: string): number {
  const m = /(\d+)\.xml$/i.exec(name);
  return m ? Number(m[1]) : 0;
}

export type Edit = { start: number; end: number; text: string };

/**
 * Tuzatishlarni KAMAYUVCHI offset tartibida qo'llaydi.
 *
 * Tartib SHART: o'sish tartibida birinchi almashtirish undan keyingi
 * hamma offsetlarni siljitadi va ikkinchi tuzatish tegning o'rtasiga
 * tushadi. Kamayuvchi tartibda esa hali qo'llanmagan tuzatishlar
 * offsetlari umuman o'zgarmaydi.
 *
 * Kesishgan tuzatish — chaqiruvchidagi mantiq xatosi (bir joyni ikki
 * marta yozish); u jimgina fayl buzishdan ko'ra darrov ko'rinishi kerak.
 */
export function applyEdits(xml: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = xml;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const e of sorted) {
    if (e.end > lastStart) throw new Error("XML tuzatishlari kesishdi");
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}
