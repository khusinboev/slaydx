import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { sanitizeValues, MAX_FIELD, MAX_JSON } from "../lib/server/validate.ts";
import {
  RESUME_FORM_FIELDS,
  RESUME_PARAMS,
  isResumeLanguage,
  type ResumeParamImpact,
} from "../lib/generation/resume-params.ts";
import {
  RESUME_JSON_FIELDS,
  draftModel,
  encodeResumeValues,
  normalizePhone,
  parseResumeJson,
  resumeInputFromValues,
} from "../lib/generation/resume/input.ts";
import { RESUME_LIMITS } from "../lib/generation/resume/model.ts";
import { planResume } from "../lib/generation/resume/layout.ts";
import { guardResume, type ResumeLlmOut } from "../lib/generation/resume/guard.ts";
import { resumeSystemPrompt, resumeUserPrompt } from "../lib/generation/resume/write.ts";

/**
 * REZYUME PARAMETR SHARTNOMASI — «bezak maydon yo'q» kafolati.
 *
 * `tests/slide-params.test.mts` naqshi: reyestrdagi har parametr uchun
 * `probeA`/`probeB` bilan differensial zond o'tkaziladi va e'lon
 * qilingan HAR ta'sirda A ≠ B bo'lishi tekshiriladi.
 *
 * Rezyumeda bitta QO'SHIMCHA (teskari) kafolat bor: narx TEKIS. Slaydda
 * `price` ham ta'sir sifatida e'lon qilinadi, rezyumeda esa aksincha —
 * hech bir parametr narxni o'zgartirmasligi SHART, aks holda «shablon
 * tanlasang qimmat» degan yashirin tarif paydo bo'ladi.
 */

const resume = TOOL_BY_ID.resume;
const RESUME_PRICE = 3000;

/** Zond uchun boy asos — bo'sh rezyumeda ko'p ta'sir ko'rinmaydi. */
const BASE: FormValues = {
  fullName: "Karimova Dilnoza",
  targetRole: "Moliya tahlilchisi",
  phone: "+998 90 123 45 67",
  email: "dilnoza@mail.uz",
  location: "Toshkent",
  language: "uz",
  resumeTemplate: "modern",
  resumePalette: "ember",
  enrich: true,
  about: "Byudjetlashtirish bo‘yicha tajribali mutaxassis.",
  experience: JSON.stringify([
    { id: "e1", company: "Artel Electronics", role: "Moliya tahlilchisi", start: "2019-08", end: "now", bullets: ["Yillik byudjet modelini tuzdi."] },
  ]),
  education: JSON.stringify([{ id: "d1", kind: "university", institution: "TDIU", field: "Moliya", degree: "bakalavr", start: "2015", end: "2019" }]),
  certificates: JSON.stringify([{ id: "c1", name: "ACCA F3", issuer: "ACCA", year: "2021" }]),
  languages: JSON.stringify([{ id: "l1", language: "Ingliz", level: "B2" }]),
  links: JSON.stringify([{ id: "k1", kind: "linkedin", url: "https://linkedin.com/in/dk" }]),
  skills: "Excel,SQL",
  tone: "professional",
  extra: "",
};

const meta = (v: FormValues = {}) => extractMeta(resume, { ...BASE, ...v });

/** Model javobi maketi — `model` ta'siri (qo'riqchi qoidalari) uchun. */
const STUB_OUT: ResumeLlmOut = {
  summary: "Byudjetlashtirish va boshqaruv hisoboti bo‘yicha tajribali mutaxassis.",
  headline: "Moliya tahlilchisi",
  experience: [
    {
      id: "e1",
      role: "Moliya tahlilchisi",
      bullets: [
        { text: "Yillik byudjet modelini tuzdi." },
        { text: "Bo‘limlar bilan oylik rejani muvofiqlashtiradi." , ai: true },
        { text: "Boshqaruv hisobotini tayyorlaydi.", ai: true },
        { text: "Xarajat me’yorlarini qayta ko‘rib chiqadi.", ai: true },
      ],
    },
  ],
  education: [{ id: "d1", field: "Moliya" }],
  skills: [{ text: "Excel" }, { text: "Power BI", ai: true }],
};

// ───────────────────────────────────────────── reyestr tuzilishi

test("reyestr: 20 parametr, id lar noyob, har birida ta'sir va ikki xil zond bor", () => {
  assert.equal(RESUME_PARAMS.length, 20);
  const ids = new Set<string>();
  for (const p of RESUME_PARAMS) {
    assert.ok(!ids.has(p.id), `${p.id}: takror`);
    ids.add(p.id);
    assert.ok(p.impacts.length > 0, `${p.id}: ta'sir e'lon qilinmagan — bezak maydon`);
    assert.notEqual(p.probeA, p.probeB, `${p.id}: zond qiymatlari bir xil`);
  }
  // Forma qamrovi shu ro'yxatdan chiziladi (komponent testi lead tomonda).
  assert.deepEqual(RESUME_FORM_FIELDS, RESUME_PARAMS.map((p) => p.id));
  // JSON maydonlar reyestrdagi `encode: "json"` bilan mos.
  assert.deepEqual(
    RESUME_PARAMS.filter((p) => p.encode === "json").map((p) => p.id).sort(),
    [...RESUME_JSON_FIELDS].sort(),
  );
});

// ───────────────────────────────────────────── extractMeta klamplari

test("extractMeta: shablon/palitra/surat/boyitish klamplanadi", () => {
  assert.equal(meta({ resumeTemplate: "banner" }).resumeTemplate, "banner");
  assert.equal(meta({ resumeTemplate: "yo‘q-shablon" }).resumeTemplate, undefined, "noma'lum shablon — berilmaydi, draftModel `modern` qo'yadi");
  assert.equal(meta({ resumePalette: "plum" }).resumePalette, "plum");
  assert.equal(meta({ resumePalette: "neon" }).resumePalette, undefined);
  assert.equal(meta({ photoAssetId: "0123456789ABCDEF01234567" }).photoAssetId, "0123456789abcdef01234567");
  assert.equal(meta({ photoAssetId: "../etc/passwd" }).photoAssetId, "");
  assert.equal(meta({ photoAssetId: "0123" }).photoAssetId, "", "24 lik hex dan qisqasi rad etiladi");
  assert.equal(meta({ enrich: false }).enrich, false);
  assert.equal(meta({ enrich: true }).enrich, true);
  assert.equal(meta({}).enrich, true, "standart — boyitish yoqilgan");
  assert.equal(extractMeta(resume, { fullName: "A" }).enrich, true, "maydon umuman yubormaganda ham yoqilgan");
});

test("B-4: rezyume tili 18 talik ro'yxatdan, noma'lum kod «uz» ga tushadi", () => {
  for (const code of ["uz", "ru", "en", "de", "fr", "es", "ar", "zh", "ja", "ko", "tr", "kk", "ky", "tg", "tk", "kaa", "it", "pt"]) {
    assert.ok(isResumeLanguage(code), `${code}: ro'yxatda bo'lishi kerak`);
    assert.equal(meta({ language: code }).language, code);
  }
  assert.equal(meta({ language: "klingon" }).language, "uz");
  assert.equal(meta({ language: "" }).language, "uz");
  // Akademik vositalarda cheklov YO'Q — u yerda skelet uch tilda.
  assert.equal(extractMeta(TOOL_BY_ID.referat, { language: "klingon" }).language, "klingon");
});

// ───────────────────────────────────────────── kirish qatlami

test("resumeInputFromValues: id lar beriladi, limitlar qo'llanadi, telefon normallashadi", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ company: `K${i}`, role: "R", start: "2020", end: "2021", bullets: Array.from({ length: 20 }, (_, j) => `band ${j}`) }));
  const input = resumeInputFromValues({
    ...BASE,
    experience: JSON.stringify(many),
    skills: Array.from({ length: 60 }, (_, i) => `k${i}`).join(","),
    phone: "+998 (90) 123-45-67",
  });
  assert.equal(input.experience.length, RESUME_LIMITS.experience);
  assert.deepEqual(input.experience.map((e) => e.id).slice(0, 3), ["e1", "e2", "e3"]);
  assert.equal(input.experience[0].bullets.length, RESUME_LIMITS.bullets);
  assert.equal(input.skills.length, RESUME_LIMITS.skills);
  assert.equal(input.contact.phone, "+998901234567");
  assert.equal(input.education[0].id, "d1");
  assert.equal(input.certificates[0].id, "c1");
  assert.equal(input.languages[0].id, "l1");
  assert.equal(input.links[0].id, "k1");
  // Berilgan id saqlanadi (tahrir oplari va `mergeLlm` shunga tayanadi).
  assert.equal(resumeInputFromValues({ experience: JSON.stringify([{ id: "e9", role: "R" }]) }).experience[0].id, "e9");
});

test("normalizePhone: bo'shliq/qavs/chiziq olib tashlanadi, «+» saqlanadi", () => {
  assert.equal(normalizePhone("+998 90 123 45 67"), "+998901234567");
  assert.equal(normalizePhone("(90) 123-45-67"), "901234567");
  assert.equal(normalizePhone("  "), "");
  assert.equal(normalizePhone("telefon yo‘q"), "");
  assert.equal(normalizePhone(null), "");
});

test("B-3: kesilgan JSON oxirgi to'liq elementgacha tiklanadi, butunlay buzuq — bo'sh", () => {
  const full = JSON.stringify([
    { id: "e1", company: "Artel", role: "Tahlilchi", start: "2019", end: "now", bullets: ["Bir."] },
    { id: "e2", company: "Korzinka", role: "Tahlilchi", start: "2017", end: "2019", bullets: ["Ikki."] },
    { id: "e3", company: "Uzum", role: "Stajyor", start: "2016", end: "2017", bullets: ["Uch."] },
  ]);
  // `sanitizeValues` obyekt o'rtasidan kesgan holat.
  const cut = full.slice(0, full.indexOf('"id":"e3"') + 6);
  assert.throws(() => JSON.parse(cut), "zond o'zi haqiqatan buzuq JSON bo'lishi kerak");
  const rows = resumeInputFromValues({ experience: cut }).experience;
  assert.equal(rows.length, 2, "ikki to'liq qator saqlanadi");
  assert.deepEqual(rows.map((r) => r.company), ["Artel", "Korzinka"]);
  // Ro'yxat oxiridagi vergul ham tiklanadi.
  assert.equal(resumeInputFromValues({ experience: '[{"id":"e1","role":"R"},' }).experience.length, 1);
  // Umuman tiklab bo'lmasa — bo'sh, lekin qolgan maydonlar zarar ko'rmaydi.
  const broken = resumeInputFromValues({ ...BASE, experience: '[{"id":"e1","rol' });
  assert.deepEqual(broken.experience, []);
  assert.equal(broken.identity.fullName, "Karimova Dilnoza");
  assert.equal(parseResumeJson("shunchaki matn", "experience"), null);
});

test("sanitizeValues: JSON maydonlarga 24 000 chegara, oddiy maydon 4 000 da qoladi", () => {
  const long = "x".repeat(30_000);
  const v = sanitizeValues({ ...Object.fromEntries(RESUME_JSON_FIELDS.map((f) => [f, long])), about: long, fullName: long })!;
  assert.equal(MAX_JSON, 24_000);
  for (const f of RESUME_JSON_FIELDS) assert.equal(String(v[f]).length, MAX_JSON, `${f}: JSON chegarasi`);
  assert.equal(String(v.about).length, MAX_FIELD, "oddiy maydon o'zgarmaydi");
  assert.equal(String(v.fullName).length, MAX_FIELD);
  // Haqiqiy hajm sinovi: 12 ta ish joyi × 10 band 4 000 ga sig'maydi, 24 000 ga sig'adi.
  const big = JSON.stringify(
    Array.from({ length: RESUME_LIMITS.experience }, (_, i) => ({
      id: `e${i + 1}`,
      company: `Kompaniya ${i + 1} nomi`,
      role: "Yetakchi mutaxassis",
      start: "2019-01",
      end: "2021-12",
      bullets: Array.from({ length: RESUME_LIMITS.bullets }, (_, j) => `Band ${j + 1}: vazifa, ko‘lam va o‘lchanadigan natija haqida jumla.`),
    })),
  );
  assert.ok(big.length > MAX_FIELD, `zond 4 000 dan uzun bo'lishi kerak (${big.length})`);
  assert.ok(big.length <= MAX_JSON, `zond 24 000 ga sig'ishi kerak (${big.length})`);
  const kept = String(sanitizeValues({ experience: big })!.experience);
  assert.equal(kept, big, "24 000 chegarasida JSON kesilmaydi");
  assert.equal(resumeInputFromValues({ experience: kept }).experience.length, RESUME_LIMITS.experience);
});

test("encodeResumeValues teskari yo'l: qayta o'qilganda kirish o'zgarmaydi", () => {
  const input = resumeInputFromValues(BASE);
  const again = resumeInputFromValues(encodeResumeValues(input));
  assert.deepEqual(again, input);
});

// ═══════════════════════════════════════════ DIFFERENSIAL ZOND

type Probe = Record<ResumeParamImpact, string>;

function probe(values: FormValues): Probe {
  const m = extractMeta(resume, { ...BASE, ...values });
  const input = resumeInputFromValues({ ...BASE, ...values });
  // Haqiqiy oqimda worker `photoAssetId` ni `data:` URL ga aylantiradi;
  // zond uchun mavjudligi yetarli (slayd logotipidagi bilan bir xil naqsh).
  const photo = m.photoAssetId ? { url: "data:image/png;base64,iVBORw0KGgo=", assetId: m.photoAssetId, crop: input.photoCrop } : undefined;
  const model = draftModel(m, input, photo);
  return {
    prompt: `${resumeSystemPrompt(m, input)}\n${resumeUserPrompt(m, input)}`,
    layout: JSON.stringify(planResume(model)),
    template: `${model.template}/${model.palette}`,
    photo: JSON.stringify(model.photo ?? null),
    language: `${m.language}/${model.language}`,
    model: JSON.stringify(guardResume(input, STUB_OUT, { enrich: m.enrich, language: m.language }).out),
  };
}

test("differensial zond: reyestrdagi HAR parametr e'lon qilingan ta'sirini beradi", () => {
  const failures: string[] = [];
  for (const p of RESUME_PARAMS) {
    const base = p.probeWith ?? {};
    const a = probe({ ...base, [p.id]: p.probeA });
    const b = probe({ ...base, [p.id]: p.probeB });
    for (const impact of p.impacts) {
      if (a[impact] === b[impact]) failures.push(`${p.id} → ${impact}`);
    }
  }
  assert.deepEqual(failures, [], `bezak parametrlar (A va B bir xil chiqdi):\n  ${failures.join("\n  ")}`);
});

/**
 * TESKARI kafolat — narx TEKIS.
 *
 * Slaydda `price` e'lon qilinadigan ta'sir; rezyumeda esa aksincha:
 * hech bir parametr narxni qimirlatmasligi kerak. Bu tijorat va'dasi —
 * «rezyume 3 000 tanga», shablon yoki boyitish uchun ustama yo'q.
 */
test("narx TEKIS: hech bir parametr 3 000 tangani o'zgartirmaydi", () => {
  assert.equal(resume.basePrice, RESUME_PRICE);
  assert.equal(priceFor(resume, {}), RESUME_PRICE);
  for (const p of RESUME_PARAMS) {
    const base = p.probeWith ?? {};
    const a = priceFor(resume, { ...BASE, ...base, [p.id]: p.probeA });
    const b = priceFor(resume, { ...BASE, ...base, [p.id]: p.probeB });
    assert.equal(a, RESUME_PRICE, `${p.id}=A narxni o'zgartirdi`);
    assert.equal(b, RESUME_PRICE, `${p.id}=B narxni o'zgartirdi`);
  }
  // Slayd maydonlari rezyume formasiga tushib qolsa ham narx qimirlamaydi.
  assert.equal(priceFor(resume, { slideCount: 30, imageCount: 4, pages: "40-45" }), RESUME_PRICE);
});

test("zond maydonlari haqiqatan turlicha: har ta'sir kamida bitta parametrda e'lon qilingan", () => {
  const declared = new Set(RESUME_PARAMS.flatMap((p) => p.impacts));
  for (const impact of ["prompt", "layout", "template", "photo", "language", "model"] as ResumeParamImpact[]) {
    assert.ok(declared.has(impact), `${impact}: hech bir parametr bu ta'sirni e'lon qilmagan — zond o'lik`);
  }
});
