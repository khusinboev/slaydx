import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { Document, Packer, Paragraph } from "docx";
import { FINGERPRINT_PROPERTY, fingerprintCode, readFingerprint, stampFingerprint } from "../lib/market/fingerprint.ts";

/**
 * The per-buyer mark in OOXML metadata (docs/market/PLAN.md M13, §3.1). Real packages: one written by the `docx` library,
 * one a bare hand-made package without `docProps` at all. The clone test checks the real PPTX of a bought deck.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. keywords not written                       -> «both parts carry the mark»;
 *   2. `custom.xml` not written                   -> «both parts carry the mark»;
 *   3. content type override not added            -> «a bare package gets its parts listed»;
 *   4. relationship not added                     -> «a bare package gets its parts listed»;
 *   5. HMAC keyed by a constant                   -> «the code»;
 *   6. existing keywords replaced                 -> «kept keywords»;
 *   7. pid not advanced past the existing ones    -> «an existing custom part».
 */

const SECRET = "test-session-secret-at-least-32-characters";
const CODE = "SLX-ABCDEFGH23";

const docx = async (): Promise<Uint8Array> => new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Salom")] }] })));

async function bare(extra: Record<string, string> = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", "<w:document/>");
  zip.file("word/media/image1.png", Buffer.from([0x89, 0x50, 0xff, 0x00, 0xfe]));
  for (const [k, v] of Object.entries(extra)) zip.file(k, v);
  return zip.generateAsync({ type: "uint8array" });
}

const part = async (bytes: Uint8Array, name: string) => (await JSZip.loadAsync(bytes)).file(name)?.async("string");

test("the code: SLX- + 10 base32 characters, stable per purchase, keyed by the secret", () => {
  const a = fingerprintCode(SECRET, "11111111-1111-4111-8111-111111111111");
  assert.match(a, /^SLX-[A-Z2-7]{10}$/);
  assert.equal(a, fingerprintCode(SECRET, "11111111-1111-4111-8111-111111111111"));
  assert.notEqual(a, fingerprintCode(SECRET, "22222222-2222-4222-8222-222222222222"));
  assert.notEqual(a, fingerprintCode(`${SECRET}x`, "11111111-1111-4111-8111-111111111111"));
});

test("both parts carry the mark in a real DOCX", async () => {
  const out = await stampFingerprint(await docx(), CODE);
  assert.deepEqual(await readFingerprint(out), { keywords: CODE, property: CODE });
  assert.match((await part(out, "docProps/core.xml"))!, new RegExp(`<cp:keywords>${CODE}</cp:keywords>`));
  assert.match((await part(out, "docProps/custom.xml"))!, new RegExp(`name="${FINGERPRINT_PROPERTY}"><vt:lpwstr>${CODE}</vt:lpwstr>`));
});

test("a clean file carries no mark", async () => {
  assert.deepEqual(await readFingerprint(await docx()), { keywords: null, property: null });
});

test("a bare package gets its parts listed in [Content_Types].xml and _rels/.rels", async () => {
  const out = await stampFingerprint(await bare(), CODE);
  const types = (await part(out, "[Content_Types].xml"))!;
  assert.ok(types.includes(`PartName="/docProps/core.xml"`));
  assert.ok(types.includes(`PartName="/docProps/custom.xml"`));
  const rels = (await part(out, "_rels/.rels"))!;
  assert.ok(rels.includes(`Target="docProps/core.xml"`));
  assert.ok(rels.includes(`Target="docProps/custom.xml"`));
  assert.equal(new Set([...rels.matchAll(/Id="(rId\d+)"/g)].map((m) => m[1])).size, 3, "relationship ids stay unique");
  assert.deepEqual(await readFingerprint(out), { keywords: CODE, property: CODE });
});

test("kept keywords: the document's own keywords stay next to the mark", async () => {
  const core = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x"><cp:keywords>energiya, fizika</cp:keywords></cp:coreProperties>`;
  const out = await stampFingerprint(await bare({ "docProps/core.xml": core }), CODE);
  assert.match((await part(out, "docProps/core.xml"))!, /<cp:keywords>energiya, fizika, SLX-ABCDEFGH23<\/cp:keywords>/);
  const empty = await stampFingerprint(await bare({ "docProps/core.xml": core.replace(/<cp:keywords>.*<\/cp:keywords>/, "<cp:keywords/>") }), CODE);
  assert.match((await part(empty, "docProps/core.xml"))!, /<cp:keywords>SLX-ABCDEFGH23<\/cp:keywords>/);
});

test("an existing custom part keeps its properties, the new pid follows them", async () => {
  const custom = `<?xml version="1.0"?><Properties xmlns="x" xmlns:vt="y"><property fmtid="{A}" pid="7" name="Eski"><vt:lpwstr>q</vt:lpwstr></property></Properties>`;
  const out = await stampFingerprint(await bare({ "docProps/custom.xml": custom }), CODE);
  const xml = (await part(out, "docProps/custom.xml"))!;
  assert.ok(xml.includes(`name="Eski"`));
  assert.ok(xml.includes(`pid="8" name="${FINGERPRINT_PROPERTY}"`));
  const selfClosed = await stampFingerprint(await bare({ "docProps/custom.xml": `<Properties xmlns="x" xmlns:vt="y"/>` }), CODE);
  assert.ok((await part(selfClosed, "docProps/custom.xml"))!.includes(`</Properties>`));
  assert.equal((await readFingerprint(selfClosed)).property, CODE);
});

test("nothing else changes: body and media keep their bytes", async () => {
  const before = await JSZip.loadAsync(await bare());
  const after = await JSZip.loadAsync(await stampFingerprint(await bare(), CODE));
  for (const name of ["word/document.xml", "word/media/image1.png"]) {
    assert.deepEqual(await after.file(name)!.async("nodebuffer"), await before.file(name)!.async("nodebuffer"), name);
  }
});

test("a file that is no OOXML package is refused", async () => {
  const zip = new JSZip();
  zip.file("a.txt", "x");
  await assert.rejects(stampFingerprint(await zip.generateAsync({ type: "uint8array" }), CODE), /OOXML/);
});
