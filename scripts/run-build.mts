/**
 * Engine ni to‘g‘ridan-to‘g‘ri chaqiradi (next start keshi yo‘q).
 *   npx tsx scripts/run-build.mts essay
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { TOOL_BY_SLUG } from "../lib/tools";
import { buildArtifact } from "../lib/generation";
import type { FormValues } from "../lib/types";

function loadEnv() {
  const p = resolve(process.cwd(), ".env.local");
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const slug = process.argv[2];
if (!slug || !TOOL_BY_SLUG[slug]) {
  console.error("slug kerak:", Object.keys(TOOL_BY_SLUG).join(", "));
  process.exit(1);
}

const VALUES: Record<string, FormValues> = {
  essay: {
    topic: "Vatan — muqaddas tushuncha",
    language: "uz",
    author: "Karimova Madina",
    university: "TDPU",
    faculty: "Filologiya",
    subject: "Ona tili",
    city: "Toshkent",
    pages: "2",
    design: "iris",
  },
  resume: {
    fullName: "Karimova Madina",
    targetRole: "Maktab biologiya o'qituvchisi",
    location: "Toshkent",
    email: "madina@example.com",
    phone: "+998901112233",
    summary: "3 yil maktabda dars bergan, fan olimpiadasi g'oliblari tayyorlagan",
    experience: "2021–2024 15-maktab, biologiya o'qituvchisi",
    education: "Nizomiy nomidagi TDPU, Biologiya, 2021",
    skills: "dars ishlanmasi, laboratoriya, sinf rahbarligi",
    topic: "Maktab biologiya o'qituvchisi",
  },
  glossary: { topic: "Moliyaviy savodxonlik", language: "uz" },
  "lesson-plan": {
    topic: "Kasrlar ustida amallar",
    subject: "Matematika",
    grade: 6,
    duration: "45",
    language: "uz",
  },
  "texnologik-xarita": {
    subject: "Biologiya",
    weeklyHours: 2,
    totalHours: 68,
    extra: "8-sinf, o'simliklar fiziologiyasi",
    language: "uz",
  },
};

const tool = TOOL_BY_SLUG[slug];
const values = VALUES[slug];
if (!values) {
  console.error("bu slug uchun fixture yo‘q");
  process.exit(1);
}

const t0 = Date.now();
// Lokal sinov: worker bilan bir xil byudjet (~4.5 daqiqa).
const file = await buildArtifact(tool, values, { deadline: Date.now() + 270_000 });
const outDir = resolve(process.cwd(), "..", "namunalar", "eval-direct");
mkdirSync(outDir, { recursive: true });
const dest = resolve(outDir, file.fileName);
writeFileSync(dest, file.bytes);
console.log(JSON.stringify({
  slug,
  file: dest,
  ms: Date.now() - t0,
  bytes: file.bytes.length,
  sections: file.doc.sections.map((s) => s.title),
  ministry: file.doc.meta.ministry,
  university: file.doc.meta.university,
  subject: file.doc.meta.subject,
}, null, 2));
