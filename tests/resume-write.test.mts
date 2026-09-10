import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { llmComplete } from "../lib/generation/llm.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { languageDirective } from "../lib/generation/i18n.ts";
import {
  SUMMARY_LIMITS,
  buildResumeDoc,
  minSummaryChars,
  mergeLlm,
  parseResumeLlm,
  resumeSystemPrompt,
  resumeUserPrompt,
} from "../lib/generation/resume/write.ts";
import { draftModel, resumeInputFromValues } from "../lib/generation/resume/input.ts";
import { resumeLabels } from "../lib/generation/resume/model.ts";
import type { ResumeLlmOut } from "../lib/generation/resume/guard.ts";

/**
 * REZYUME DVIGATELI — LLM STUB bilan (tarjima dvigatelidagi naqsh).
 *
 * Tarmoq YO'Q: `buildResumeDoc` ga `deps.complete` beriladi va u
 * chaqiruvlarni yozib boradi. Shu bilan promptdagi qoidalar, qayta
 * urinish shartlari va yorliq yo'llari real kalitsiz sinaladi.
 */

const resume = TOOL_BY_ID.resume;

const VALUES: FormValues = {
  fullName: "Karimova Dilnoza",
  targetRole: "Moliya tahlilchisi",
  phone: "+998 90 123 45 67",
  email: "dilnoza@mail.uz",
  location: "Toshkent",
  about: "",
  tone: "professional",
  extra: "",
  skills: "Excel,SQL",
  // Ataylab XRONOLOGIK EMAS tartibda: `sortDesc` ishlamasa testlar qizaradi.
  experience: JSON.stringify([
    { id: "e2", company: "Korzinka", role: "Stajyor", start: "2017-01", end: "2019-07", bullets: ["Hisobot tayyorladi."] },
    { id: "e1", company: "Artel Electronics", role: "Tahlilchi", start: "2019-08", end: "now", bullets: ["Byudjet modelini tuzdi."] },
  ]),
  education: JSON.stringify([{ id: "d1", institution: "TDIU", degree: "Bakalavr", start: "2015", end: "2019" }]),
  certificates: JSON.stringify([{ id: "c1", name: "ACCA F3", issuer: "ACCA", year: "2021" }]),
  languages: JSON.stringify([{ id: "l1", language: "Ingliz", level: "B2" }]),
  links: JSON.stringify([{ id: "k1", kind: "linkedin", url: "https://linkedin.com/in/dk" }]),
};

const meta = (v: FormValues = {}) => extractMeta(resume, { ...VALUES, ...v });
const input = (v: FormValues = {}) => resumeInputFromValues({ ...VALUES, ...v });
const prompt = (v: FormValues = {}) => `${resumeSystemPrompt(meta(v), input(v))}\n${resumeUserPrompt(meta(v), input(v))}`;

const LONG_SUMMARY =
  "Byudjetlashtirish va boshqaruv hisoboti bo‘yicha tajribali mutaxassis. Ishlab chiqarish va chakana savdo kompaniyalarida oylik hisobot tsiklini yo‘lga qo‘ygan, xarajat tahlili asosida qarorlarni tayyorlagan. Excel va SQL bilan kunlik ishlaydi va jamoada muvofiqlashtiradi.";

function answer(over: Partial<Record<string, unknown>> = {}) {
  return {
    summary: LONG_SUMMARY,
    headline: "Yetakchi moliya tahlilchisi",
    experience: [
      { id: "e1", role: "Moliya tahlilchisi", bullets: [{ text: "Yillik byudjet modelini tuzdi va ijro nazoratini yo‘lga qo‘ydi." }] },
      { id: "e2", role: "Kichik tahlilchi", bullets: [{ text: "Haftalik hisobotlarni tayyorladi." }] },
    ],
    education: [{ id: "d1", degree: "Bakalavr, Moliya va kredit" }],
    skills: [{ text: "Excel" }, { text: "SQL" }],
    ...over,
  };
}

type Call = { system: string; user: string; maxTokens: number; opts: Record<string, unknown> };

/** `behave` har chaqiruvda javob beradi; `null` — model javob bermadi. */
function stub(behave: (call: Call, n: number) => unknown | null = () => answer()) {
  const calls: Call[] = [];
  const complete: typeof llmComplete = async (system, user, maxTokens = 0, opts = {}) => {
    const call = { system, user, maxTokens, opts: opts as Record<string, unknown> };
    calls.push(call);
    const out = behave(call, calls.length);
    return out === null ? null : typeof out === "string" ? out : JSON.stringify(out);
  };
  return { calls, complete };
}

const build = (v: FormValues, behave?: (call: Call, n: number) => unknown | null, over: { deadline?: number } = {}) => {
  const s = stub(behave);
  return {
    ...s,
    run: () => buildResumeDoc(meta(v), { ...VALUES, ...v }, { deadline: over.deadline ?? Date.now() + 120_000 }, { complete: s.complete }),
  };
};

// ───────────────────────────────────────────── prompt

test("tizim prompti: birinchi qator chiqish tili direktivasi (de)", () => {
  const sys = resumeSystemPrompt(meta({ language: "de" }), input({ language: "de" }));
  assert.ok(sys.startsWith(languageDirective("de")), "birinchi qator `languageDirective` bo'lishi kerak");
  assert.match(sys, /German/);
  assert.notEqual(sys, resumeSystemPrompt(meta({ language: "uz" }), input({ language: "uz" })));
});

test("prompt VERBATIM va «uydirmang» qoidalarini o'z ichiga oladi", () => {
  const p = prompt();
  assert.match(p, /NEVER invent an employer, job title, date, degree, institution, certificate or language/);
  assert.match(p, /VERBATIM/);
  assert.match(p, /phone number, e-mail, URLs, every year and month/);
  assert.match(p, /action verb \+ scope \+ measurable result/);
  assert.match(p, /between 250 and 700 characters/);
  assert.match(p, /MUST be written in the output language/, "lavozim/daraja tarjima qilinishi shart");
  assert.match(p, /do not reorder the experience or education arrays by date/i, "tartiblash — ilovaning ishi");
});

test("id lar promptda: model qaysi qatorga javob berishini biladi", () => {
  const p = prompt();
  assert.match(p, /"id":"e1"/);
  assert.match(p, /"id":"e2"/);
  assert.match(p, /"id":"d1"/);
  assert.match(p, /in this order: e2, e1/, "promptda KIRISH tartibi — tartiblash chiqishda");
  assert.match(p, /in this order: d1/);
  // Kompaniya/sana faktlar blokida bor, lekin javob sxemasida YO'Q.
  assert.match(p, /Artel Electronics/);
  assert.match(resumeUserPrompt(meta(), input()), /are NOT yours to change/);
});

test("boyitish ON/OFF promptda ochiq matn bilan farq qiladi", () => {
  const on = prompt({ enrich: true });
  const off = prompt({ enrich: false });
  assert.match(on, /ENRICHMENT IS ON/);
  assert.match(on, /at most 2 extra bullets/);
  assert.match(on, /at most 6 extra profession-relevant skills/);
  assert.match(on, /NO number, NO client or company name and NO date/);
  assert.match(off, /ENRICHMENT IS OFF: add NOTHING/);
  assert.doesNotMatch(off, /ENRICHMENT IS ON/);
  assert.notEqual(on, off);
});

test("uslub va qo'shimcha talab promptga tushadi", () => {
  assert.match(prompt({ tone: "professional" }), /Tone: formal, confident, precise/);
  assert.match(prompt({ tone: "qisqa" }), /Tone: extremely terse/);
  assert.match(prompt({ tone: "ijodiy" }), /Tone: lively and distinctive/);
  assert.match(prompt({ tone: "yo‘q-uslub" }), /Tone: formal, confident, precise/, "noma'lum uslub — professional");
  assert.match(prompt({ extra: "diplomni yuqoriga chiqaring" }), /Extra request from the user: diplomni yuqoriga chiqaring/);
  assert.doesNotMatch(prompt({ extra: "" }), /Extra request from the user/);
});

test("yorliqlar: uz/ru/en da so'ralmaydi, boshqa tilda so'raladi", () => {
  for (const code of ["uz", "ru", "en"]) {
    assert.match(prompt({ language: code }), /Do NOT return "labels"/, `${code}: kod yorliqlari ishlatiladi`);
  }
  for (const code of ["de", "ar", "zh"]) {
    const p = prompt({ language: code });
    assert.match(p, /"labels" — translate these section headings/, `${code}: yorliq so'ralishi kerak`);
    assert.match(p, /summary, experience, education, certificates, languages, skills, links, contact, present, resume/);
  }
});

// ───────────────────────────────────────────── chaqiruv va qayta urinish

test("chaqiruv: JSON rejimi, token va timeout chegarasi", async () => {
  const b = build({});
  const doc = await b.run();
  assert.ok(doc);
  assert.equal(b.calls.length, 1, "muvaffaqiyatli javobda qayta urinish yo'q");
  assert.equal(b.calls[0].maxTokens, 3200);
  assert.equal(b.calls[0].opts.json, true);
  assert.ok(Number(b.calls[0].opts.timeoutMs) > 0 && Number(b.calls[0].opts.timeoutMs) <= 70_000);
});

test("qisqa qisqacha → BIR marta qat'iy qayta so'rov, ikkinchisi qabul qilinadi", async () => {
  const b = build({}, (_c, n) => (n === 1 ? answer({ summary: "Juda qisqa." }) : answer()));
  const doc = await b.run();
  assert.equal(b.calls.length, 2, "aynan bitta qayta urinish");
  assert.match(b.calls[1].user, /previous answer was rejected/i);
  assert.match(b.calls[1].user, /at least 250 characters/);
  assert.match(b.calls[1].user, /shorter than 200 characters/);
  assert.equal(b.calls[0].user.length < b.calls[1].user.length, true, "qat'iy qo'shimcha ikkinchi so'rovda");
  assert.equal(doc?.resume?.summary, LONG_SUMMARY);
  assert.ok(LONG_SUMMARY.length >= minSummaryChars("uz"));
});

/**
 * JONLI SINOV REGRESSIYASI (uz→en): uzunlik darvozasi QO'RIQCHIDAN KEYIN.
 *
 * Model 240 belgi yozgan, qo'riqchi uydirma yilli bitta jumlani
 * tashlagan va natija 173 belgiga tushgan edi. Eski darvoza
 * (parse'dan keyin, 150) buni ko'rmasdi — hujjat qisqa qisqacha bilan
 * chiqib ketardi.
 */
test("qisqacha qo'riqchidan KEYIN o'lchanadi — jumla tashlansa qayta so'raladi", async () => {
  // Xom qisqacha 200 dan uzun, lekin uydirma yilli jumla tashlangach qisqaradi.
  const trimmed = "Byudjetlashtirish bo‘yicha tajribali mutaxassis, jamoada ishlaydi.";
  const raw =
    `${trimmed} 2013-yildan boshlab moliya sohasida ishlab kelmoqda, ishlab chiqarish va chakana savdo kompaniyalarida ` +
    `boshqaruv hisobotini yo‘lga qo‘ygan va katta jamoalarni muvofiqlashtirgan.`;
  assert.ok(raw.length > minSummaryChars("uz"), "zond xom holda darvozadan o'tishi kerak");
  assert.ok(trimmed.length < minSummaryChars("uz"), "qo'riqchidan keyin darvozadan o'tmasligi kerak");

  const b = build({}, (_c, n) => (n === 1 ? answer({ summary: raw }) : answer()));
  const doc = await b.run();
  assert.equal(b.calls.length, 2, "qo'riqchidan keyingi qisqarish qayta so'rovni ishga tushirmadi");
  assert.match(b.calls[1].user, /invented years or invented organisation names/);
  assert.equal(doc?.resume?.summary, LONG_SUMMARY, "uzunroq ikkinchi javob tanlanadi");
});

test("uz kirish → en chiqish: lavozim va daraja TARJIMASI saqlanadi", async () => {
  const b = build({ language: "en" }, () =>
    answer({
      summary:
        "Finance professional with hands-on experience in budgeting and management reporting. Built the monthly reporting cycle for manufacturing and retail companies and prepared cost analyses that supported management decisions.",
      experience: [
        { id: "e1", role: "Senior IFRS Reporting Analyst", bullets: [{ text: "Built the annual budget model and monthly execution controls." }] },
        { id: "e2", role: "Financial Analyst", bullets: [{ text: "Prepared weekly profitability reports." }] },
      ],
      education: [{ id: "d1", degree: "CIMA Advanced Diploma in Management Accounting" }],
      skills: [{ text: "Excel" }, { text: "SQL" }],
    }),
  );
  const m = (await b.run())!.resume!;
  assert.equal(m.experience[0].role, "Senior IFRS Reporting Analyst", "o'zbekcha lavozimga qaytmasligi kerak");
  assert.equal(m.experience[1].role, "Financial Analyst");
  assert.equal(m.education[0].degree, "CIMA Advanced Diploma in Management Accounting");
  // Kompaniya/muassasa esa VERBATIM kirishdan — tarjima qilinmaydi.
  assert.deepEqual(m.experience.map((e) => e.company), ["Artel Electronics", "Korzinka"]);
  assert.equal(m.education[0].institution, "TDIU");
  assert.equal(m.language, "en");
});

test("buzuq JSON → qayta so'rov; ikkalasi ham yiqilsa null (chaqiruvchi zaxiraga o'tadi)", async () => {
  const broken = build({}, (_c, n) => (n === 1 ? "shunchaki matn, JSON emas" : answer()));
  assert.ok(await broken.run());
  assert.equal(broken.calls.length, 2);

  const dead = build({}, () => null);
  assert.equal(await dead.run(), null);
  assert.equal(dead.calls.length, 2, "ikkinchi urinish ham bo'ladi");
});

/**
 * Uzunlik darvozasi yiqilganda SABAB bog'lanadigan bo'lishi kerak.
 *
 * Jonli sinovda «summary 201 belgi» va «jumla 1» ikki alohida qatorda
 * turar va ularni bog'lash faqat qo'lda bo'lardi. Tashlangan jumlalar
 * QAYTA TIKLANMAYDI — uydirmani uzunlik uchun qaytarish qo'riqchining
 * ma'nosini yo'q qilardi — lekin nima bo'lgani jurnalda turadi.
 */
test("qayta so'rovdan keyin ham qisqa qolsa jurnalda alohida qator bo'ladi", async () => {
  const short = "Moliya sohasida ishlaydi.";
  const lines: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const b = build({}, () => answer({ summary: `${short} 2013-yilda ishga kirgan.` }));
    const m = (await b.run())!.resume!;
    assert.equal(b.calls.length, 2, "qat'iy qayta so'rov bo'lishi kerak");
    assert.ok(!m.summary.includes("2013"), "uydirma jumla QAYTA TIKLANMAYDI");
  } finally {
    console.warn = realWarn;
  }
  assert.ok(
    lines.some((l) => l.includes("[resume] summary qisqa qoldi") && l.includes("qayta so'rov yordam bermadi")),
    `jurnal qatori yo'q:\n${lines.join("\n")}`,
  );
  assert.ok(lines.some((l) => l.includes("[resume] qisqachadan tashlandi (yil)")), "tashlangan jumla sababi ham yozilsin");
});

/**
 * JONLI SINOV REGRESSIYASI (`--lang ja`) — uzunlik YOZUV TIZIMIGA bog'liq.
 *
 * 209 ta yapon belgisi inglizcha 400–500 belgiga teng ma'lumot tashiydi.
 * Yagona lotin chegarasi (200) yaponcha javobni «qisqa» deb rad etar,
 * behuda qat'iy qayta so'rov yuborar va byudjetni yer edi — model esa
 * to'g'ri uzunlikda yozgan bo'lardi.
 */
test("uzunlik darvozasi yozuv tizimiga qarab: zh/ja/ko past, qolganlari lotin chegarasida", () => {
  for (const code of ["ja", "zh", "ko", "JA"]) {
    assert.equal(minSummaryChars(code), SUMMARY_LIMITS.dense.gate, `${code}: zich yozuv chegarasi`);
  }
  for (const code of ["uz", "ru", "en", "de", "tr", "ar", "fa"]) {
    assert.equal(minSummaryChars(code), SUMMARY_LIMITS.latin.gate, `${code}: lotin chegarasi`);
  }
  assert.ok(SUMMARY_LIMITS.dense.gate < SUMMARY_LIMITS.latin.gate);
  // Prompt HAM shu diapazonni aytadi — aks holda ko'rsatma va darvoza ajralib ketadi.
  assert.match(prompt({ language: "ja" }), /between 100 and 300 characters/);
  assert.match(prompt({ language: "en" }), /between 250 and 700 characters/);
});

test("ja: 120 belgilik qisqacha QABUL qilinadi (qayta so'rov yo'q), en da esa qayta so'raladi", async () => {
  // 120 ta yapon belgisi — mazmunan to'liq qisqacha.
  const jaSummary = "予算管理と経営報告の分野で五年以上の実務経験を持つ財務アナリスト。製造業と小売業の月次報告サイクルを構築し、原価分析にもとづく経営判断を支援した。表計算とデータベースを日常的に利用する。".slice(0, 120);
  assert.ok(jaSummary.length >= minSummaryChars("ja") && jaSummary.length < minSummaryChars("en"), `zond uzunligi: ${jaSummary.length}`);

  const ja = build({ language: "ja" }, () => answer({ summary: jaSummary, labels: { summary: "概要", experience: "職務経歴", education: "学歴" } }));
  const doc = await ja.run();
  assert.equal(ja.calls.length, 1, "yaponchada qayta so'rov ishga tushmasligi kerak");
  assert.equal(doc?.resume?.summary, jaSummary);
  assert.equal(doc?.resume?.labels.experience, "職務経歴", "yorliqlar modeldan");

  // AYNAN shu uzunlik inglizchada qayta so'rovni chaqiradi.
  const en = build({ language: "en" }, () => answer({ summary: "x".repeat(120) }));
  await en.run();
  assert.equal(en.calls.length, 2, "inglizchada 120 belgi qisqa — qayta so'ralishi kerak");
  assert.match(en.calls[1].user, /at least 250 characters/);
});

test("deadline yetmasa umuman chaqirilmaydi", async () => {
  const b = build({}, () => answer(), { deadline: Date.now() + 3_000 });
  assert.equal(await b.run(), null);
  assert.equal(b.calls.length, 0);
});

// ───────────────────────────────────────────── natija

test("natija: faktlar KIRISHDAN, matn modeldan, tartib sortDesc bilan", async () => {
  const b = build({});
  const doc = (await b.run())!;
  const m = doc.resume!;
  // Kompaniya, sana, muassasa, sertifikat, til, havola — model javobida umuman yo'q edi.
  assert.deepEqual(m.experience.map((e) => e.company), ["Artel Electronics", "Korzinka"]);
  assert.deepEqual(m.experience.map((e) => e.id), ["e1", "e2"], "hozirgi ish joyi birinchi (sortDesc)");
  assert.equal(m.experience[0].start, "2019-08");
  assert.equal(m.education[0].institution, "TDIU");
  assert.equal(m.certificates[0].name, "ACCA F3");
  assert.equal(m.languages[0].language, "Ingliz");
  assert.equal(m.links[0].url, "https://linkedin.com/in/dk");
  assert.equal(m.contact.phone, "+998901234567", "telefon normallashgan");
  // Modeldan olingani: qisqacha, lavozim matni, bandlar, ko'nikmalar.
  assert.equal(m.summary, LONG_SUMMARY);
  assert.equal(m.experience[0].role, "Moliya tahlilchisi");
  assert.match(m.experience[0].bullets[0].text, /ijro nazoratini/);
  assert.deepEqual(m.skills.map((s) => s.text), ["Excel", "SQL"]);
  // Hujjat qobig'i.
  assert.equal(doc.titlePage, false);
  assert.equal(doc.toc, false);
  assert.equal(doc.meta.author, "Karimova Dilnoza");
});

test("headline: kirishda bo'lsa model uni ALMASHTIRA olmaydi, bo'sh bo'lsa modeldan", async () => {
  const withRole = (await build({}).run())!.resume!;
  assert.equal(withRole.identity.headline, "Moliya tahlilchisi", "foydalanuvchi yozgan lavozim ustun");
  const noRole = (await build({ targetRole: "" }).run())!.resume!;
  assert.equal(noRole.identity.headline, "Yetakchi moliya tahlilchisi", "bo'sh bo'lsa modelnikini oladi");
});

test("sortDesc natijaga qo'llanadi — model tartibi hurmat qilinmaydi", async () => {
  // Model qatorlarni teskari qaytarsa ham xronologiya saqlanadi.
  const b = build({}, () => ({ ...answer(), experience: [...answer().experience].reverse() }));
  const m = (await b.run())!.resume!;
  assert.deepEqual(m.experience.map((e) => e.id), ["e1", "e2"]);
  assert.equal(m.experience[0].end, "now");
});

test("boyitish ON — ai bandlar qoladi va `enriched` yoqiladi; OFF — hech narsa qo'shilmaydi", async () => {
  const enriched = () =>
    answer({
      experience: [
        { id: "e1", role: "Moliya tahlilchisi", bullets: [{ text: "Byudjet modelini tuzdi." }, { text: "Boshqaruv hisobotini tayyorlaydi.", ai: true }] },
        { id: "e2", role: "Kichik tahlilchi", bullets: [{ text: "Hisobot tayyorladi." }] },
      ],
      skills: [{ text: "Excel" }, { text: "Power BI", ai: true }],
    });
  const on = (await build({ enrich: true }, enriched).run())!.resume!;
  assert.equal(on.enriched, true);
  assert.equal(on.experience[0].bullets.filter((b) => b.ai).length, 1);
  assert.ok(on.skills.some((s) => s.ai));

  const off = (await build({ enrich: false }, enriched).run())!.resume!;
  assert.equal(off.enriched, false);
  assert.ok(!off.experience.some((e) => e.bullets.some((b) => b.ai)), "OFF da ai band qolmasligi kerak");
  assert.ok(!off.skills.some((s) => s.ai));
  assert.deepEqual(off.skills.map((s) => s.text), ["Excel"]);
});

test("qo'riqchi ulangan: uydirma ish joyi va uydirma yil natijaga tushmaydi", async () => {
  const b = build({}, () =>
    answer({
      summary: `${LONG_SUMMARY} 2013-yilda Respublika Taʼlim Markazida ishlagan.`,
      experience: [
        ...answer().experience,
        { id: "e9", role: "Bosh direktor", bullets: [{ text: "Kompaniyani boshqardi." }] },
      ],
    }),
  );
  const m = (await b.run())!.resume!;
  assert.equal(m.experience.length, 2, "kirishda yo'q ish joyi tushmaydi");
  assert.ok(!/2013/.test(m.summary));
  assert.ok(!/Taʼlim Markaz/.test(m.summary));
  assert.equal(m.summary, LONG_SUMMARY);
});

test("hamma jumla uydirma bo'lsa qisqacha zaxira matnga tushadi (bo'sh qolmaydi)", async () => {
  const b = build({}, () => answer({ summary: "2013-yilda ishga kirdi." }));
  const m = (await b.run())!.resume!;
  assert.ok(m.summary.length > 0, "qisqacha bo'sh qolmasligi kerak");
  assert.equal(m.summary, draftModel(meta(), input()).summary);
});

// ───────────────────────────────────────────── yorliqlar

test("yorliqlar: uz → koddan, de → modeldan, model yorliqsiz → inglizcha", async () => {
  const uz = (await build({ language: "uz" }, () => answer({ labels: { summary: "HACKED", experience: "HACKED" } })).run())!.resume!;
  assert.deepEqual(uz.labels, resumeLabels("uz"), "uz da model yorliqlari e'tiborsiz");

  const de = (await build({ language: "de" }, () =>
    answer({ labels: { summary: "Profil", experience: "Berufserfahrung", skills: "Kenntnisse" } }),
  ).run())!.resume!;
  assert.equal(de.labels.summary, "Profil");
  assert.equal(de.labels.experience, "Berufserfahrung");
  assert.equal(de.labels.skills, "Kenntnisse");
  assert.equal(de.labels.education, resumeLabels("en").education, "berilmagan yorliq — inglizcha");

  const bare = (await build({ language: "de" }, () => answer()).run())!.resume!;
  assert.deepEqual(bare.labels, resumeLabels("en"), "model yorliq bermasa hammasi inglizcha");
  // uz/ru/en dan tashqari tilda `sectionLabels` (akademik) ISHLATILMAYDI.
  assert.notEqual(bare.labels.summary, resumeLabels("uz").summary);
});

// ───────────────────────────────────────────── sof funksiyalar

test("parseResumeLlm: satr bandlar, yetishmagan id va bo'sh javob", () => {
  const i = input();
  const m = meta();
  const out = parseResumeLlm(
    JSON.stringify({ summary: "S", experience: [{ role: "R", bullets: ["a", { text: "b", ai: true }] }], skills: ["Excel", { text: "SQL", ai: true }] }),
    i,
    m,
  )!;
  assert.equal(out.experience[0].id, "e2", "id berilmasa KIRISH tartibi bo'yicha (birinchi qator)");
  assert.deepEqual(out.experience[0].bullets, [{ text: "a" }, { text: "b", ai: true }]);
  assert.deepEqual(out.skills, [{ text: "Excel" }, { text: "SQL", ai: true }]);
  assert.equal(out.headline, "Moliya tahlilchisi", "headline bo'sh bo'lsa kirishdan");
  assert.equal(parseResumeLlm("shunchaki matn", i, m), null);
  assert.equal(parseResumeLlm(null, i, m), null);
  assert.equal(parseResumeLlm("[]", i, m), null, "massiv — obyekt emas");
});

test("mergeLlm: bo'sh javob kirishni buzmaydi", () => {
  const i = input();
  const m = meta();
  const empty: ResumeLlmOut = { summary: "", headline: "", experience: [], education: [], skills: [] };
  const merged = mergeLlm(i, empty, m);
  const draft = draftModel(m, i);
  assert.equal(merged.summary, draft.summary, "qisqacha zaxira matndan");
  assert.deepEqual(merged.experience.map((e) => e.role), draft.experience.map((e) => e.role));
  assert.deepEqual(merged.skills, draft.skills);
  assert.equal(merged.enriched, false);
});
