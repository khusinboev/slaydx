#!/usr/bin/env node
/**
 * Barcha vositalarni HAQIQIY navbat orqali sinaydi: POST /api/generations,
 * so'ng holatni polling qiladi va tayyor faylni yuklab olib baholaydi.
 *
 * Ilgari bu skript `POST /api/generate` ga murojaat qilardi — bunday
 * endpoint umuman yo'q. Ya'ni sifat nazorati yillar davomida yashil
 * ko'rinib, hech narsani tekshirmasdi.
 *
 * Kirish kerak (barcha /api/generations endpointlari sessiya talab qiladi):
 *   - EVAL_COOKIE="sodda_session=..."  yoki
 *   - DEV_LOGIN_ENABLED=true bo'lsa skript o'zi OTP orqali kiradi.
 *
 * Foydalanish:
 *   node scripts/eval-services.mjs [round] [only-slug]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROUND = process.argv[2] || "r1";
const ONLY = process.argv[3] || "";
const BASE = process.env.EVAL_URL || "http://127.0.0.1:3000";
const OUT = path.resolve(process.cwd(), "..", "namunalar", `eval-${ROUND}`);
const EVAL_USER = process.env.EVAL_USER || "evalbot";
/** Bitta ish uchun eng ko'p kutish — worker byudjeti 285 s. */
const POLL_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 330_000);

/**
 * Uydirma manba belgilari.
 *
 * Nashriyot nomining o'zi belgi EMAS: «– Toshkent: O'qituvchi, 2018» —
 * haqiqiy nashriyot va model ba'zan to'g'ri yozadi. Xavfli narsa —
 * tekshirib bo'lmaydigan aniqlik: DOI, ISSN, jurnal tomi/soni, havola.
 * Bularni model deyarli har doim uydiradi.
 */
const FABRICATED_REF = [/doi\.org/i, /\bDOI[:\s]/i, /\bISSN\b/i, /\bISBN\b/i, /\bvol\.\s*\d/i, /https?:\/\//i];

/** Sifat paketi nechta slayd va'da qiladi. */
const SLIDE_PACK = { standard: 10, long: 14, premium: 12, premium_long: 16 };

/**
 * Shablon (filler) izlari.
 *
 * Ro'yxat ataylab tor: `kompetensiya` va `tushuncha shakllanadi` olib
 * tashlandi, chunki ular jonli matnda ham uchraydi — pedagogika kurs
 * ishida «kompetensiya» o'rinli atama, inshoda esa «qalbida bir tushuncha
 * shakllanadi» oddiy jumla. Ular endi kerakli keysda `forbid` orqali
 * tekshiriladi.
 */
const GENERIC = [
  /tizimli o[‘'`]rganishni talab qiladigan mavzu/i,
  /alohida fakt emas, balki bog/i,
  /tajriba bandi to[‘'`]ldirilmagan/i,
  /tarjima matni topilmadi/i,
  /soha nazariyasi asoslari/i,
  /umumiy nazariy asoslar/i,
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
    minWords: 368, // 2 varaq × 230 × 0.8
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
    minWords: 2392, // 13 bet × 230 × 0.8
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
    minWords: 3312, // 18 bet × 230 × 0.8
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
    minWords: 1472, // 8 bet × 230 × 0.8
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
    minWords: 1472, // 8 bet × 230 × 0.8
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
    minWords: 2392, // 13 bet × 230 × 0.8
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
    forbid: ["tushuncha shakllanadi", "1-mavzu"],
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
    slug: "slide",
    name: "slide-premium",
    values: {
      topic: "Alisher Navoiy hayoti va ijodi",
      language: "uz",
      quality: "premium_long",
      slideTheme: "parchment",
      slideTemplate: "bio",
    },
    minWords: 200,
    expect: ["Navoiy"],
    isPptx: true,
  },
  /**
   * ENG QIMMAT TARIFLAR.
   *
   * Ilgari eval har vositani faqat BITTA (odatda eng arzon) tarifda
   * sinardi: kurs ishi «15–20 bet», maqola «5–10 bet». Natijada
   * 18 000–24 000 tangalik tariflar hech qachon tekshirilmasdi va
   * ularning hajm darvozasidan MUNTAZAM yiqilishi sezilmay qoldi.
   * Qoida: har vositaning eng qimmat tarifi ham sinovga tushadi —
   * aynan u eng ko'p pul yo'qotadi.
   */
  {
    name: "coursework-max",
    slug: "coursework",
    values: {
      topic: "Umumiy o'rta ta'lim maktablarida ekologik tarbiyani tashkil etish",
      language: "uz",
      author: "Toshmatova Nilufar — 4-kurs, 402-guruh",
      university: "TDPU",
      faculty: "Pedagogika",
      department: "Pedagogika nazariyasi",
      subject: "Pedagogika",
      teacher: "Prof. S. Nazarov",
      city: "Toshkent",
      ministry: "maktab",
      pages: "40-45",
      images: "yes",
      tocMethod: "ai",
    },
    minWords: 7912, // 43 bet × 230 × 0.8
    expect: ["Kirish", "Xulosa", "BOB"],
  },
  {
    name: "referat-max",
    slug: "referat",
    values: {
      topic: "Quyosh energetikasi va uning O'zbekistondagi istiqbollari",
      language: "uz",
      author: "Rahimov Sardor — 2-kurs, 205-guruh",
      university: "Toshkent davlat texnika universiteti",
      faculty: "Energetika",
      department: "Qayta tiklanuvchi energiya",
      subject: "Energetika",
      city: "Toshkent",
      pages: "25-30",
    },
    minWords: 5060, // 27.5 → 28 bet × 230 × 0.8
    expect: ["Kirish", "Xulosa"],
  },
  /**
   * IMRAD yo'li.
   *
   * Bu yo'l (`kind: "imrad"`) evalda UMUMAN yo'q edi, holbuki maqola va
   * tezis uchun 8 000 tangagacha turadi. Ustiga u `targetPages` ni
   * o'qimasdi — 4 000 va 8 000 tangalik maqola aynan bir xil chiqardi.
   */
  {
    name: "article-imrad",
    slug: "article",
    values: {
      topic: "Yoshlar orasida internet qaramligi",
      kind: "imrad",
      language: "uz",
      author: "Saidova Sevara",
      university: "O'zbekiston Milliy universiteti",
      organization: "O'zbekiston Milliy universiteti",
      email: "sevara@example.uz",
      subject: "Ijtimoiy psixologiya",
      city: "Toshkent",
      pages: "10-15",
      annotationLangs: "same",
    },
    minWords: 2300, // 12.5 → 13 bet × 230 × 0.8
    expect: ["Annotatsiya", "Natija", "Muhokama"],
  },
  /**
   * Uzun tarjima.
   *
   * Tarjima chegaraga yaqin matnda sinalmagan edi: bo'laklar jim
   * kesilardi va yarim tarjima `COMPLETED` bo'lardi. `expect` oxirgi
   * bo'lakning yetib kelganini tekshiradi.
   */
  {
    name: "translation-long",
    slug: "translation",
    values: {
      mode: "file",
      fileName: "photosynthesis-long.txt",
      language: "uz",
      sourceLang: "en",
      sourceText: Array.from(
        { length: 30 },
        (_, i) =>
          `Part ${i + 1}. Photosynthesis converts light energy into chemical energy stored in glucose. ` +
          `Chloroplasts contain chlorophyll, which absorbs light in the blue and red parts of the spectrum. ` +
          `The light-dependent reactions occur in the thylakoid membrane and produce ATP and NADPH, which ` +
          `the Calvin cycle then uses to fix carbon dioxide into three-carbon sugars.`,
      ).join("\n\n"),
    },
    minWords: 900,
    // Birinchi va OXIRGI bo'lak ham yetib kelishi shart — jim kesilish belgisi.
    expect: ["1-", "30-"],
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
  // Speaker notes — `notesSlide` fayllari doim yaratiladi, shuning uchun
  // shunchaki mavjudligi emas, ICHIDA matn borligi tekshiriladi.
  // (Bo'sh notes'da faqat slayd raqami turadi.)
  let withNotes = 0;
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(n))) {
    const xml = await zip.file(name).async("string");
    const t = (xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [])
      .map((m) => m.replace(/<[^>]+>/g, ""))
      .join(" ")
      .trim();
    if (t.replace(/\d+/g, "").trim().length > 20) withNotes += 1;
  }

  // Bullet zichligi: 15 belgidan uzun matn bo'laklari.
  const lines = [];
  for (const name of names) {
    const xml = await zip.file(name).async("string");
    for (const m of xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || []) {
      const t = decodeEntities(m.replace(/<[^>]+>/g, "")).trim();
      if (t.length > 15) lines.push(t);
    }
  }
  const bulletWords = lines.length ? lines.reduce((n, t) => n + words(t), 0) / lines.length : 0;

  const text = chunks.join("\n\n");
  return {
    text,
    words: words(text),
    slides: names.length,
    images,
    withNotes,
    maxLine: lines.reduce((n, t) => Math.max(n, t.length), 0),
    bulletWords: Math.round(bulletWords * 10) / 10,
  };
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
  if (c.isImage && !(info.bytes > 8000)) issues.push("rasm bo‘sh");

  // --- Hujjat: manbalar halolligi ---
  if (!c.isPptx && !c.isImage) {
    for (const re of FABRICATED_REF) {
      if (re.test(text)) issues.push(`uydirma manba: ${re.source.slice(0, 20)}`);
    }
    // Adabiyotlar bo'lsa, ular tekshirilmagani yozilgan bo'lishi SHART.
    if (/ADABIYOT|ЛИТЕРАТУР|REFERENCES/i.test(text) && !/TEKSHIRILMAGAN|tasdiqlanmagan|НЕ ПРОВЕРЕН|NOT VERIFIED/i.test(text)) {
      issues.push("manbalar ogohlantirishsiz");
    }
  }

  // --- Taqdimot: Slide Law ---
  if (c.isPptx) {
    const want = SLIDE_PACK[c.values.quality || "standard"] || 10;
    if ((info.slides || 0) < want) issues.push(`slayd ${info.slides || 0} < ${want} (paket)`);
    if ((info.withNotes || 0) < Math.ceil((info.slides || 1) * 0.7)) {
      issues.push(`notes ${info.withNotes || 0}/${info.slides || 0}`);
    }
    if ((info.bulletWords || 0) > 14) issues.push(`bullet ${info.bulletWords} so‘z > 14`);
  }
  return issues;
}

// ---------------------------------------------------------------- kirish

let COOKIE = process.env.EVAL_COOKIE || "";

function headers(extra = {}) {
  return {
    "Content-Type": "application/json",
    Origin: BASE,
    "Sec-Fetch-Site": "same-origin",
    ...(COOKIE ? { Cookie: COOKIE } : {}),
    ...extra,
  };
}

function takeCookie(res) {
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")].filter(Boolean);
  for (const line of raw) {
    const m = /(^|,\s*)(sodda_session=[^;]+)/.exec(line);
    if (m) COOKIE = m[2];
  }
}

/**
 * Sessiya ochadi. EVAL_COOKIE berilgan bo'lsa shu ishlatiladi,
 * aks holda dev OTP (DEV_LOGIN_ENABLED=true) orqali kiriladi.
 */
async function login() {
  if (COOKIE) return true;
  const req = await fetch(`${BASE}/api/auth/otp?action=request`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ identifier: EVAL_USER }),
  });
  const data = await req.json().catch(() => ({}));
  if (!req.ok || !data.devCode) {
    console.error(
      `kirish yo‘q: ${data.error || req.status}. EVAL_COOKIE bering yoki DEV_LOGIN_ENABLED=true qo‘ying.`,
    );
    return false;
  }
  const ver = await fetch(`${BASE}/api/auth/otp?action=verify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ identifier: EVAL_USER, code: data.devCode }),
  });
  takeCookie(ver);
  if (!ver.ok || !COOKIE) {
    console.error("kirish tasdiqlanmadi:", ver.status);
    return false;
  }
  console.log(`kirdi: ${EVAL_USER}`);
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ish tugaguncha holatni so'rab turadi. */
async function waitForJob(id) {
  const until = Date.now() + POLL_TIMEOUT_MS;
  let last = "";
  while (Date.now() < until) {
    const res = await fetch(`${BASE}/api/generations/${id}`, { headers: headers() });
    if (!res.ok) return { status: "HTTP", error: `holat ${res.status}` };
    const g = await res.json();
    const gen = g.generation ?? g;
    if (gen.step && gen.step !== last) last = gen.step;
    if (gen.status === "COMPLETED") return { status: "COMPLETED", gen };
    if (gen.status === "FAILED" || gen.status === "REVOKED") {
      return { status: gen.status, error: gen.error || gen.step || "xato" };
    }
    await sleep(2500);
  }
  return { status: "TIMEOUT", error: `${Math.round(POLL_TIMEOUT_MS / 1000)}s ichida tugamadi` };
}

async function runOne(c) {
  const t0 = Date.now();
  try {
    // Navbat rate limit'i daqiqasiga 5 ta. Eval 14 ta keys yuboradi,
    // shuning uchun 429 da kutib qayta urinamiz — aks holda vositalar
    // «navbatga qo'yilmadi» deb yiqilib, sifat o'lchanmay qolardi.
    let res, data;
    for (let attempt = 0; attempt < 6; attempt++) {
      res = await fetch(`${BASE}/api/generations`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ slug: c.slug, values: c.values }),
      });
      data = await res.json().catch(() => ({}));
      if (res.status !== 429) break;
      await sleep(20_000);
    }
    if (!res.ok || !data.id) {
      return {
        slug: c.slug,
        ok: false,
        ms: Date.now() - t0,
        error: data.error || `HTTP ${res.status}`,
        issues: ["navbatga qo‘yilmadi"],
      };
    }

    const done = await waitForJob(data.id);
    if (done.status !== "COMPLETED") {
      return {
        slug: c.slug,
        ok: false,
        ms: Date.now() - t0,
        error: done.error,
        issues: [`${done.status}: ${done.error}`],
      };
    }

    const fileRes = await fetch(`${BASE}/api/generations/${data.id}/file`, { headers: headers() });
    if (!fileRes.ok) {
      return { slug: c.slug, ok: false, ms: Date.now() - t0, error: `fayl ${fileRes.status}`, issues: ["fayl yo‘q"] };
    }
    const bytes = Buffer.from(await fileRes.arrayBuffer());

    const ext = c.isImage ? "jpg" : c.isPptx ? "pptx" : "docx";
    const fname = `${c.name || c.slug}__${String(c.values.topic || c.values.subject || c.values.prompt || "out")
      .slice(0, 40)
      .replace(/[^\p{L}\p{N}]+/gu, "-")}.${ext}`;
    await writeFile(path.join(OUT, fname), bytes);

    let info = { text: "", words: 0, bytes: bytes.length };
    if (c.isImage) info = { ...info };
    else if (c.isPptx) info = { ...info, ...(await analyzePptx(bytes)) };
    else info = { ...info, ...(await analyzeDocx(bytes)) };

    const issues = score(c, info, done.gen?.html || "");
    return {
      slug: c.slug,
      ok: issues.length === 0,
      ms: Date.now() - t0,
      words: info.words,
      bytes: bytes.length,
      slides: info.slides,
      images: info.images,
      notes: info.withNotes,
      bulletWords: info.bulletWords,
      price: data.price,
      file: fname,
      issues,
      preview: (info.text || "").replace(/\s+/g, " ").slice(0, 220),
    };
  } catch (e) {
    return { slug: c.slug, ok: false, ms: Date.now() - t0, error: e.message, issues: ["exception"] };
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

// Ixtiyoriy provayder o'chiq bo'lsa keysni chetlab o'tish uchun:
//   EVAL_SKIP=rasm node scripts/eval-services.mjs
const SKIP = new Set((process.env.EVAL_SKIP || "").split(",").map((x) => x.trim()).filter(Boolean));
const cases = CASES.filter(
  (c) => (!ONLY || c.slug === ONLY || c.name === ONLY) && !SKIP.has(c.slug) && !SKIP.has(c.name || ""),
);
if (SKIP.size) console.log(`chetlab o'tildi: ${[...SKIP].join(", ")}`);
await mkdir(OUT, { recursive: true });

if (!(await login())) process.exit(2);

console.log(`eval ${ROUND} → ${OUT}  (${cases.length} vosita, ${BASE})`);
// Parallel 2: navbat rate limit'i daqiqasiga 5 ta.
const results = await pool(cases, 2, async (c) => {
  const label = c.name || c.slug;
  console.log("…", label);
  const r = await runOne(c);
  console.log(
    r.ok ? "OK  " : "FAIL",
    label.padEnd(16),
    `${Math.round(r.ms / 1000)}s`,
    (r.issues || []).join("; ") || r.error || "",
  );
  return { ...r, label };
});
/**
 * TARIF FARQI — qimmatroq paket haqiqatan ko'proq berishi shart.
 *
 * Bu nuqson loyihada UCH MARTA takrorlandi: slayd sifat paketi
 * (`targetPages` o'qilmasdi), IMRAD maqola (bet soni e'tiborsiz edi) va
 * uzun kurs ishi (tuzilma 3 bob bilan cheklangan edi). Har safar
 * foydalanuvchi ikki baravar to'lab bir xil hujjat olardi va buni hech
 * bir test ushlamasdi, chunki eval har vositani bitta tarifda sinardi.
 *
 * Shuning uchun juftlar ALOHIDA tekshiriladi: qimmat tarif arzonidan
 * kamida shu ulushcha katta bo'lishi kerak.
 */
const TIER_PAIRS = [
  { cheap: "coursework", rich: "coursework-max", minRatio: 1.6, note: "kurs ishi 15–20 → 40–45 bet" },
  { cheap: "referat", rich: "referat-max", minRatio: 1.4, note: "referat 10–15 → 25–30 bet" },
  { cheap: "slide", rich: "slide-premium", minRatio: 1.5, note: "slayd standart → premium uzun", field: "slides" },
];

const tierIssues = [];
for (const pair of TIER_PAIRS) {
  const a = results.find((r) => (r.label || r.slug) === pair.cheap);
  const b = results.find((r) => (r.label || r.slug) === pair.rich);
  if (!a?.ok || !b?.ok) continue; // yiqilgan keys o'z xatosi bilan qayd etilgan
  const field = pair.field || "words";
  const lo = a[field] || 0;
  const hi = b[field] || 0;
  const ratio = lo ? hi / lo : 0;
  const ok = ratio >= pair.minRatio;
  if (!ok) {
    tierIssues.push(`${pair.note}: ${lo} → ${hi} (${ratio.toFixed(2)}×, kerak ≥${pair.minRatio}×)`);
  }
  console.log(`${ok ? "OK  " : "FAIL"} tarif farqi     ${pair.note}: ${lo} → ${hi} (${ratio.toFixed(2)}×)`);
}

await writeFile(
  path.join(OUT, "report.json"),
  JSON.stringify({ results, tierIssues }, null, 2),
);
const fail = results.filter((r) => !r.ok);
console.log("\n=== XULOSA ===");
for (const r of results) {
  const shape = r.slides ? `${r.slides} slayd · ${r.notes ?? 0} notes` : `${r.words ?? "-"} so‘z`;
  console.log(`${r.ok ? "✓" : "✗"} ${(r.label || r.slug).padEnd(18)} ${shape.padStart(18)}  ${(r.issues || []).join(" | ") || "pro"}`);
}
if (tierIssues.length) {
  console.log("\n=== TARIF FARQI BUZILGAN ===");
  for (const t of tierIssues) console.log(`✗ ${t}`);
}
console.log(`\n${results.length - fail.length}/${results.length} o‘tdi`);
process.exit(fail.length || tierIssues.length ? 1 : 0);
