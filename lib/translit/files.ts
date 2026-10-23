/**
 * Script conversion of FILES (owner request 6): DOCX, PPTX and plain TXT, in place.
 *
 * Same principle as the translator (`lib/generation/translate/docx.ts`, `pptx.ts`): the document
 * is NOT rebuilt. The OOXML archive is opened with the translator's hardened reader
 * (`openOoxml`: entry-count / ZIP64 / unzipped-size limits) and only the CONTENT of text nodes
 * (`<w:t>` in Word, `<a:t>` in PowerPoint) is replaced by `convert(text)`. Run properties,
 * paragraphs, tables, drawings, styles, numbering and media stay byte for byte. No LibreOffice.
 *
 * Known limitation (documented, by design): every text node is converted on its own, so a word
 * that Word split across runs (`Ўз` + `бекистон`, different formatting inside one word) is converted
 * as two words — a dictionary exception or the word-start rules (`е`/`ye`, `ц`, Title-case
 * digraphs) may be missed on the second half. Fields, instructions (`w:instrText`) and
 * deleted text are not touched; the language tag of the runs (`w:lang`) is left as it is.
 */

import { xmlDecode, xmlEscape } from "../generation/xml";
import { openOoxml, saveOoxml } from "../generation/translate/xml-scan";
import { convert } from "./index";
import type { Script } from "./script";

export type FileConvertResult = { bytes: Uint8Array; /** text nodes seen */ nodes: number; /** text nodes whose text changed */ changed: number };

const WORD_PARTS = (name: string): boolean =>
  name === "word/document.xml" ||
  /^word\/(?:header|footer)\d+\.xml$/.test(name) ||
  name === "word/footnotes.xml" ||
  name === "word/endnotes.xml" ||
  name === "word/comments.xml";

const SLIDE_PARTS = (name: string): boolean => /^ppt\/(?:slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name);

/** `<w:t>` / `<w:t xml:space="preserve">`, never `<w:tab/>`, `<w:tbl>` or a self-closed `<w:t/>`. */
const W_T = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
const A_T = /(<a:t(?:\s[^>]*)?>)([^<]*)(<\/a:t>)/g;

function mapTextNodes(xml: string, re: RegExp, from: Script, to: Script, stats: { nodes: number; changed: number }): string {
  return xml.replace(re, (_all, open: string, text: string, close: string) => {
    stats.nodes++;
    const before = xmlDecode(text);
    const after = convert(before, from, to);
    if (after === before) return _all;
    stats.changed++;
    return open + xmlEscape(after) + close;
  });
}

async function convertOoxml(
  bytes: Uint8Array,
  want: (name: string) => boolean,
  re: RegExp,
  from: Script,
  to: Script,
): Promise<FileConvertResult> {
  const pkg = await openOoxml(bytes, want);
  const stats = { nodes: 0, changed: 0 };
  const changed = new Map<string, string>();
  for (const [name, xml] of pkg.parts) {
    const next = mapTextNodes(xml, re, from, to, stats);
    if (next !== xml) changed.set(name, next);
  }
  return { bytes: await saveOoxml(pkg, changed), ...stats };
}

export function convertDocx(bytes: Uint8Array, from: Script, to: Script): Promise<FileConvertResult> {
  return convertOoxml(bytes, WORD_PARTS, W_T, from, to);
}

export function convertPptx(bytes: Uint8Array, from: Script, to: Script): Promise<FileConvertResult> {
  return convertOoxml(bytes, SLIDE_PARTS, A_T, from, to);
}

export class NotTextError extends Error {
  constructor() {
    super("Not a UTF-8 text file");
    this.name = "NotTextError";
  }
}

/** UTF-8 text (BOM and line endings kept). Throws `NotTextError` for binary / non-UTF-8 content. */
export function convertTxt(bytes: Uint8Array, from: Script, to: Script): FileConvertResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new NotTextError();
  }
  if (text.includes("\u0000")) throw new NotTextError();
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const body = bom ? text.slice(1) : text;
  const out = convert(body, from, to);
  return { bytes: new TextEncoder().encode(bom + out), nodes: 1, changed: out === body ? 0 : 1 };
}
