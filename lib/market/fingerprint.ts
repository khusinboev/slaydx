import { createHmac } from "node:crypto";
import { loadZipCapped, MAX_UNZIPPED_BYTES, readZipText, type ZipBudget } from "../generation/translate/xml-scan";

/**
 * The invisible per-buyer mark (docs/market/PLAN.md M13): `SLX-<code>` in the OOXML metadata, never on a page. Written
 * into `docProps/core.xml` keywords and a `SlaydX` property of `docProps/custom.xml`, so one surviving part is enough to
 * trace a leak. No other archive entry changes, apart from the package listing a part that did not exist.
 */

const CORE = "docProps/core.xml";
const CUSTOM = "docProps/custom.xml";
const TYPES = "[Content_Types].xml";
const RELS = "_rels/.rels";
const CUSTOM_TYPE = "application/vnd.openxmlformats-officedocument.custom-properties+xml";
const CUSTOM_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";
const CORE_TYPE = "application/vnd.openxmlformats-package.core-properties+xml";
const CORE_REL = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
const PROPERTY_FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";
export const FINGERPRINT_PROPERTY = "SlaydX";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CODE_RE = /SLX-[A-Z2-7]{10}/;
const CODE_LEN = 10;

/** `SLX-` + 10 base32 characters of HMAC(secret, purchaseId). */
export function fingerprintCode(secret: string, purchaseId: string): string {
  const digest = createHmac("sha256", secret).update(purchaseId).digest();
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < CODE_LEN) {
      bits -= 5;
      out += BASE32[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
    if (out.length === CODE_LEN) break;
  }
  return `SLX-${out}`;
}

function withKeywords(core: string, code: string): string {
  const full = /<cp:keywords>([\s\S]*?)<\/cp:keywords>/.exec(core);
  if (full) {
    const kept = full[1]!.trim();
    return core.replace(full[0], `<cp:keywords>${kept ? `${kept}, ` : ""}${code}</cp:keywords>`);
  }
  const tag = `<cp:keywords>${code}</cp:keywords>`;
  if (/<cp:keywords\s*\/>/.test(core)) return core.replace(/<cp:keywords\s*\/>/, tag);
  return core.replace("</cp:coreProperties>", `${tag}</cp:coreProperties>`);
}

const propertyXml = (pid: number, code: string): string =>
  `<property fmtid="${PROPERTY_FMTID}" pid="${pid}" name="${FINGERPRINT_PROPERTY}"><vt:lpwstr>${code}</vt:lpwstr></property>`;

function withProperty(custom: string | null, code: string): string {
  const closed = custom ? /<Properties\b[^>]*\/>/.exec(custom) : null;
  if (!custom || (!closed && !custom.includes("</Properties>"))) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${propertyXml(2, code)}</Properties>`;
  }
  const pids = [...custom.matchAll(/\bpid="(\d+)"/g)].map((m) => Number(m[1]));
  const next = Math.max(1, ...pids) + 1;
  if (closed) return custom.replace(closed[0], `${closed[0].slice(0, -2)}>${propertyXml(next, code)}</Properties>`);
  return custom.replace("</Properties>", `${propertyXml(next, code)}</Properties>`);
}

const withOverride = (types: string, part: string, type: string): string =>
  types.includes(`PartName="/${part}"`) ? types : types.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);

function withRelationship(rels: string, type: string, target: string): string {
  if (rels.includes(`Type="${type}"`)) return rels;
  const ids = [...rels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
  const id = `rId${Math.max(0, ...ids) + 1}`;
  return rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`);
}

const EMPTY_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"></cp:coreProperties>`;

/** The bytes of a DOCX/PPTX with the mark in its metadata. Throws on an archive that is not OOXML. */
export async function stampFingerprint(bytes: Uint8Array, code: string): Promise<Uint8Array> {
  const zip = await loadZipCapped(bytes);
  const budget: ZipBudget = { left: MAX_UNZIPPED_BYTES };
  const read = async (name: string): Promise<string | null> => {
    const file = zip.file(name);
    return file ? readZipText(file, budget) : null;
  };
  let types = await read(TYPES);
  let rels = await read(RELS);
  if (!types || !rels) throw new Error("fingerprint: not an OOXML package");
  const core = await read(CORE);
  zip.file(CORE, withKeywords(core ?? EMPTY_CORE, code));
  if (!core) {
    types = withOverride(types, CORE, CORE_TYPE);
    rels = withRelationship(rels, CORE_REL, CORE);
  }
  zip.file(CUSTOM, withProperty(await read(CUSTOM), code));
  zip.file(TYPES, withOverride(types, CUSTOM, CUSTOM_TYPE));
  zip.file(RELS, withRelationship(rels, CUSTOM_REL, CUSTOM));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** The marks found in a file (leak tracing); `null` for a part that carries none. */
export async function readFingerprint(bytes: Uint8Array): Promise<{ keywords: string | null; property: string | null }> {
  const zip = await loadZipCapped(bytes);
  const budget: ZipBudget = { left: MAX_UNZIPPED_BYTES };
  const text = async (name: string): Promise<string> => {
    const file = zip.file(name);
    return file ? readZipText(file, budget) : "";
  };
  return { keywords: CODE_RE.exec(await text(CORE))?.[0] ?? null, property: CODE_RE.exec(await text(CUSTOM))?.[0] ?? null };
}
