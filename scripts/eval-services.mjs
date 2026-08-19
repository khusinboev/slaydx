#!/usr/bin/env node
/**
 * Barcha vositalarni /api/generate orqali sinaydi, fayl saqlaydi, sifat balli beradi.
 *   node scripts/eval-services.mjs [round] [only-slug]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROUND = process.argv[2] || "r1";
const ONLY = process.argv[3] || "";
const BASE = process.env.EVAL_URL || "http://127.0.0.1:3000";
const OUT = path.resolve(process.cwd(), "..", "namunalar", `eval-${ROUND}`);

const GENERIC = [
  /tizimli o[‘'`]rganishni talab qiladigan mavzu/i,
  /alohida fakt emas, balki bog/i,
  /tajriba bandi to[‘'`]ldirilmagan/i,
  /tarjima matni topilmadi/i,
  /soha nazariyasi asoslari/i,
  /kompetensiya/i,
  /tushuncha shakllanadi/i,
];

const CASES = [
  {
    slug: "essay",
    values: {
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
    minWords: 450,
    expect: ["Kirish", "Xulosa"],
  },
  {
    slug: "referat",
    values: {
      topic: "Ichki yonuv dvigatellari sovutish tizimlari",
      language: "uz",
      author: "Aliyev Ali — 3-kurs, 301-guruh",
      university: "Toshkent davlat texnika universiteti",
      faculty: "Mexanika",
      department: "Avtomobillar",
      subject: "Avtomobillar va traktorlar",
      teacher: "Ergashov B.",
      city: "Toshkent",
      pages: "10-15",
    },
    minWords: 1800,
    expect: ["Kirish", "Xulosa", "Adabiyot"],
  },
  {
    slug: "coursework",
    values: {
      topic: "Boshlang'ich sinf o'quvchilarida o'qish ko'nikmalarini rivojlantirish",
      language: "uz",
      author: "Karimova M.",
      university: "TDPU",
      faculty: "Boshlang'ich ta'lim",
      department: "Boshlang'ich ta'lim",
      subject: "Pedagogika",
      city: "Toshkent",
      ministry: "maktab",
      pages: "15-20",
      images: "yes",
      tocMethod: "ai",
    },
    minWords: 2200,
    expect: ["Kirish", "Xulosa"],
  },
  {
    slug: "article",
    values: {
      topic: "Qayta tiklanuvchi energiya manbalari: muammo va yechimlar",
      language: "uz",
      author: "Aliyev Ali Valiyevich",
      organization: "Toshkent davlat universiteti, Toshkent",
      email: "ali@example.com",
      degree: "Talaba",
      kind: "standard",
      pages: "5-10",
      annotationLangs: "same",
    },
    minWords: 1400,
    expect: ["Kirish"],
  },
  {
    slug: "thesis",
    values: {
      topic: "Yoshlar orasida internet qaramligi",
      language: "uz",
      author: "Saidova Sevara — 4-kurs",
      university: "O'zMU",
      faculty: "Psixologiya",
      subject: "Ijtimoiy psixologiya",
      city: "Toshkent",
      kind: "standard",
      pages: "5-10",
    },
    minWords: 1400,
    expect: ["Kirish", "Xulosa"],
  },
  {
    slug: "mustaqil-ish",
    values: {
      topic: "Suv resurslarini muhofaza qilish",
      language: "uz",
      author: "Toshmatov J.",
      university: "Toshkent irrigatsiya instituti",
      subject: "Ekologiya",
      city: "Toshkent",
      pages: "10-15",
      tocMethod: "ai",
    },
    minWords: 1800,
    expect: ["Kirish"],
  },
  {
    slug: "resume",
    values: {
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
    minWords: 120,
    expect: ["Tajriba", "Nizomiy"],
    noTitleMinistry: true,
  },
  {
    slug: "translation",
    values: {
      language: "uz",
      sourceLang: "en",
      fileName: "note.txt",
      sourceText:
        "Photosynthesis is the process by which green plants convert light energy into chemical energy. Carbon dioxide and water are used to produce glucose and oxygen. Light-dependent reactions occur in the thylakoid membrane. The Calvin cycle takes place in the stroma. Chlorophyll absorbs mainly blue and red light.",
      topic: "Fotosintez",
    },
    minWords: 40,
    expect: ["Fotosintez", "glyukoza"],
    noTitleMinistry: true,
  },
  {
    slug: "glossary",
    values: { topic: "Moliyaviy savodxonlik", language: "uz" },
    minWords: 350,
    expect: ["inflyatsiya", "kredit"],
    forbid: ["kompetensiya", "refleksiya", "differensiatsiya"],
  },
  {
    slug: "keys",
    values: { topic: "Maktabda o'quvchilar o'rtasida zo'ravonlik (bulling)", language: "uz" },
    minWords: 500,
    expect: ["Keys", "Topshiriq"],
  },
  {
    slug: "lesson-plan",
    values: { topic: "Kasrlar ustida amallar", subject: "Matematika", grade: 6, duration: "45", language: "uz" },
    minWords: 250,
    expect: ["Kasr", "daq"],
    forbid: ["umumiy «salomlashish»dan tashqari"],
  },
  {
    slug: "texnologik-xarita",
    values: { subject: "Biologiya", weeklyHours: 2, totalHours: 68, extra: "8-sinf, o'simliklar fiziologiyasi", language: "uz" },
    minWords: 200,
    expect: ["Hafta", "Mavzu"],
  },
  {
    slug: "slide",
    values: {
      topic: "Fotosintez jarayoni",
      language: "uz",
      quality: "standard",
      slideTheme: "atlas",
      slideTemplate: "lecture",
    },
    minWords: 80,
    expect: ["Fotosintez"],
    isPptx: true,
  },
  {
    slug: "rasm",
    values: {
      prompt: "Buxoro Ark qal'asi, kechki oltin nur, keng hovli, cinеmatic",
      imageStyle: "cinematic",
      imageRatio: "3:4",
      imageCount: 1,
    },
    minWords: 0,
    isImage: true,
  },
];

function words(t) {
  return (t.match(/\S+/g) || []).length;
}

function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-z]+);/g, (m) => {
    const map = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
    return map[m] || m;
  });
}

async function textFromDocx(buf) {
  const { unzipSync, strFromU8 } = await import("fflate").catch(() => ({ unzipSync: null }));
  if (!unzipSync) {
    // fallback: treat as zip via unzip if jszip in node_modules
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const file = zip.file("word/document.xml");
    if (!file) return "";
    const xml = await file.async("string");
    return decodeEntities(
      xml
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
        .replace(/<[^>]+>/g, ""),
    );
  }
  return "";
}

async function analyzeDocx(bytes) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  if (!file) return { text: "", words: 0 };
  const xml = await file.async("string");
  const text = decodeEntities(
    xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
      .replace(/<[^>]+>/g, ""),
  );
  return { text, words: words(text) };
}

async function analyzePptx(bytes) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const chunks = [];
  let images = 0;
  for (const name of names) {
    const xml = await zip.file(name).async("string");
    const t = decodeEntities(
      xml
        .replace(/<\/a:p>/g, "\n")
        .replace(/<a:t[^>]*>([^<]*)<\/a:t>/g, "$1")
        .replace(/<[^>]+>/g, ""),
    );
    if (t.trim()) chunks.push(t.trim());
    if (/a:blip|p:pic/.test(xml)) images += 1;
  }
  const text = chunks.join("\n\n");
  return { text, words: words(text), slides: names.length, images };
}

function score(c, info, html) {
  const issues = [];
  const text = `${info.text || ""}\n${html || ""}`;
  if (!c.isImage && info.words < c.minWords) issues.push(`so‘z ${info.words} < ${c.minWords}`);
  for (const re of GENERIC) {
    if (re.test(text)) issues.push(`shablon: ${re.source.slice(0, 28)}`);
  }
  for (const e of c.expect || []) {
    if (!new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) issues.push(`yo‘q: ${e}`);
  }
  for (const e of c.forbid || []) {
    if (new RegExp(e, "i").test(text)) issues.push(`taqiqlangan: ${e}`);
  }
  if (c.noTitleMinistry && /OLIY TA’LIM|OLIY TA'LIM, FAN/.test(text)) issues.push("ortiqcha titul");
  if (c.isPptx && (info.slides || 0) < 8) issues.push(`slayd ${info.slides || 0} < 8`);
  if (c.isImage && !(info.bytes > 8000)) issues.push("rasm bo‘sh");
  return issues;
}

async function runOne(c) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 170_000);
  try {
    const res = await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: c.slug, values: c.values }),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (!res.ok || !data.base64) {
      return { slug: c.slug, ok: false, ms: Date.now() - t0, error: data.error || `HTTP ${res.status}`, issues: ["generate fail"] };
    }
    const bytes = Buffer.from(data.base64, "base64");
    const ext = c.isImage ? "jpg" : c.isPptx ? "pptx" : "docx";
    const fname = `${c.slug}__${String(c.values.topic || c.values.subject || c.values.prompt || "out").slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, "-")}.${ext}`;
    await writeFile(path.join(OUT, fname), bytes);
    let info = { text: "", words: 0, bytes: bytes.length };
    if (c.isImage) info = { text: data.html || "", words: 0, bytes: bytes.length };
    else if (c.isPptx) info = { ...info, ...(await analyzePptx(bytes)) };
    else info = { ...info, ...(await analyzeDocx(bytes)) };
    const issues = score(c, info, data.html);
    return {
      slug: c.slug,
      ok: issues.length === 0,
      ms: Date.now() - t0,
      words: info.words,
      bytes: bytes.length,
      slides: info.slides,
      images: info.images,
      file: fname,
      issues,
      preview: (info.text || "").replace(/\s+/g, " ").slice(0, 220),
    };
  } catch (e) {
    return { slug: c.slug, ok: false, ms: Date.now() - t0, error: e.message, issues: ["exception"] };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const cur = items[i++];
      out.push(await fn(cur));
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

const cases = CASES.filter((c) => !ONLY || c.slug === ONLY);
await mkdir(OUT, { recursive: true });
console.log(`eval ${ROUND} → ${OUT}  (${cases.length} vosita, ${BASE})`);
const results = await pool(cases, 2, async (c) => {
  console.log("…", c.slug);
  const r = await runOne(c);
  console.log(r.ok ? "OK " : "FAIL", c.slug, `${Math.round(r.ms / 1000)}s`, r.words ?? "", (r.issues || []).join("; ") || r.error || "");
  return r;
});
await writeFile(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
const fail = results.filter((r) => !r.ok);
console.log("\n=== XULOSA ===");
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.slug.padEnd(20)} ${String(r.words ?? "-").padStart(5)} so‘z  ${(r.issues || []).join(" | ") || "pro"}`);
}
console.log(`\n${results.length - fail.length}/${results.length} o‘tdi`);
process.exit(fail.length ? 1 : 0);
