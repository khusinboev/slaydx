import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/*
 * BANDL BO'LINISHI (FE-11): sahifaning BIRINCHI yuklanishiga faqat STATIK
 * importlar kiradi. Har vositaning formasi, har hujjat turining ko'ruvchisi
 * va og'ir ma'lumot/kutubxonalar (`data/professions.json` ~580 KB, JSZip,
 * server LLM mijozi, KaTeX) faqat `import()` orqali — kerak bo'lganda —
 * yuklanishi kerak. Ilgari `/uz/[slug]` har vosita sahifasiga 12 ta
 * composer, kasblar bazasi va JSZip ni birdan yuborardi (~500 KB gz).
 *
 * Bu test build QILMAYDI: u statik import grafini yuradi (dinamik
 * `import()` chegarasida to'xtaydi) va taqiqlangan modulga yetib
 * bo'lmasligini tekshiradi. Build raqamlari hisobotda.
 */
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : path.resolve(path.dirname(from), spec);
  if (/\.(tsx?|mts|json)$/.test(base) && existsSync(base)) return base;
  for (const e of EXT) if (existsSync(base + e)) return base + e;
  return null;
}

/** Statik graf: fayl → uni birinchi topgan zanjir. Paketlar `pkg:<nom>` bo'lib yoziladi. */
function staticGraph(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const stack: [string, string[]][] = [[entry, [entry]]];
  while (stack.length) {
    const [file, chain] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.set(file, chain);
    if (file.startsWith("pkg:") || file.endsWith(".json")) continue;
    const src = readFileSync(file, "utf8");
    const re = /^(?:import|export)\s+(?:type\s+)?[^;]*?from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm;
    for (const m of src.matchAll(re)) {
      if (/^(?:import|export)\s+type\s/.test(m[0])) continue; // faqat tiplar — bandlga kirmaydi
      const spec = m[1] ?? m[2]!;
      const local = spec.startsWith(".") || spec.startsWith("@/");
      const next = local ? resolveLocal(file, spec) : `pkg:${spec}`;
      if (next) stack.push([next, [...chain, next]]);
    }
  }
  return seen;
}

const rel = (f: string) => (f.startsWith("pkg:") ? f : path.relative(ROOT, f));

function assertUnreachable(entry: string, forbidden: (f: string) => boolean, what: string) {
  const g = staticGraph(path.join(ROOT, entry));
  const hit = [...g.keys()].find(forbidden);
  assert.ok(!hit, `${entry}: ${what} birinchi yuklanishda: ${hit ? g.get(hit)!.map(rel).join(" → ") : ""}`);
}

const COMPOSERS = [
  "SlideForm",
  "ProSlideForm",
  "ResumeComposer",
  "TranslationForm",
  "ImageStudio",
  "ArticleComposer",
  "EssayComposer",
  "WorkComposer",
  "TeacherComposer",
  "MediaComposer",
  "InfographicComposer",
  "GameComposer",
];

test("FE-11: vosita sahifasi composerlarni statik import qilmaydi (har biri import() bilan)", () => {
  for (const c of COMPOSERS) {
    assertUnreachable("app/uz/[slug]/page.tsx", (f) => f.endsWith(`/components/forms/${c}.tsx`), c);
  }
});

test("FE-11: vosita sahifasi kasblar bazasini, JSZip va server LLM mijozini birinchi yuklamaydi", () => {
  assertUnreachable("app/uz/[slug]/page.tsx", (f) => f.endsWith("/data/professions.json"), "professions.json");
  assertUnreachable("app/uz/[slug]/page.tsx", (f) => f === "pkg:jszip", "jszip");
  assertUnreachable("app/uz/[slug]/page.tsx", (f) => f.endsWith("/lib/generation/llm.ts"), "llm.ts");
});

test("FE-11: composerlarning o'zi ham kasblar bazasi va JSZip ni statik tortmaydi", () => {
  for (const c of COMPOSERS) {
    const entry = `components/forms/${c}.tsx`;
    assertUnreachable(entry, (f) => f.endsWith("/data/professions.json"), "professions.json");
    assertUnreachable(entry, (f) => f === "pkg:jszip", "jszip");
  }
});

test("FE-11: hujjat sahifasi ko'ruvchilarni va KaTeX ni birinchi yuklamaydi", () => {
  const page = "app/uz/files/[id]/page.tsx";
  for (const v of ["WordViewer", "SlideViewer", "ResumeViewer", "TranslationViewer", "ImageViewer", "AudioViewer"]) {
    assertUnreachable(page, (f) => f.endsWith(`/components/viewers/${v}.tsx`), v);
  }
  assertUnreachable(page, (f) => f === "pkg:katex", "katex");
  assertUnreachable(page, (f) => f.endsWith("/lib/generation/llm.ts"), "llm.ts");
});

test("FE-11: ajratilgan klient chegaralari server manbasi bilan bir xil (extract limitlari)", async () => {
  const leaf = await import("../lib/extract-limits.ts");
  const full = await import("../lib/extract-text.ts");
  assert.equal(leaf.EXTRACT_ACCEPT, full.EXTRACT_ACCEPT);
  assert.equal(leaf.EXTRACT_MAX_BYTES, full.EXTRACT_MAX_BYTES);
});
