import { langInfo, sectionLabels } from "./i18n";
import { parseLlmJson, parseLlmObject } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import {
  glossarySystemPrompt,
  imradSystemPrompt,
  keysSystemPrompt,
  lessonSystemPrompt,
  mapSystemPrompt,
  resumeSystemPrompt,
  translationSystemPrompt,
} from "./prompts";
import {
  blocksFromText,
  cleanText,
  isGenericGlossaryTerm,
  mapPool,
  remainingMs,
  section,
  targetWords,
  unverifiedReferenceNote,
  wordCount,
} from "./quality";
import type { AcademicDoc, Block, DocMeta, DocSection, DocTable } from "./types";

function asText(s: unknown): string {
  if (Array.isArray(s)) return s.map((x) => asText(x)).filter(Boolean).join("\n");
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    return [o.title, o.text, o.value, o.name].map((x) => asText(x)).filter(Boolean).join(" — ");
  }
  return cleanText(String(s ?? ""));
}

function clip(s: unknown, n: number) {
  const t = asText(s);
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

function pickMapMethod(topic: string, i: number): string {
  const t = topic.toLowerCase();
  if (/laborator|tajriba|mikroskop|preparat|hujayra/.test(t)) return "Laboratoriya";
  if (/nazorat|takror|test|mustahkamlash/.test(t)) return "Takror va nazorat";
  if (/amaliy|mashq|hisob|yechim/.test(t)) return "Amaliy mashg‘ulot";
  if (/loyiha|mustaqil|referat/.test(t)) return "Mustaqil ish / loyiha";
  if (/kirish|ahamiyat|predmet/.test(t)) return "Ma’ruza + suhbat";
  return ["Ma’ruza + suhbat", "Amaliy mashg‘ulot", "Laboratoriya", "Mustaqil ish / loyiha", "Takror va nazorat"][i % 5];
}

function pickMapResult(topic: string): string {
  const t = topic.toLowerCase();
  if (/hujayra/.test(t)) return "Hujayra tuzilishini tushuntiradi";
  if (/fotosintez/.test(t)) return "Fotosintez bosqichlarini ayta oladi";
  if (/suv/.test(t)) return "Suv almashinuvini izohlaydi";
  if (/nafas/.test(t)) return "Nafas olishni tushuntiradi";
  if (/ko‘pay|kopay|urug‘/.test(t)) return "Ko‘payish turlarini ajratadi";
  if (/nazorat|test/.test(t)) return "O‘zlashtirishni namoyish etadi";
  const word = topic.split(/\s+/).slice(0, 3).join(" ");
  return `${word} bo‘yicha tushuntira oladi`;
}

function pickMapControl(i: number): string {
  return ["Og‘zaki so‘rov", "Yozma topshiriq", "Amaliy ish", "Test"][i % 4];
}

const parseJson = parseLlmJson;

export async function writeLessonWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const d = meta.duration || 45;
  const ask = (timeoutMs: number) =>
    llmComplete(
      lessonSystemPrompt(meta),
      [
        `JSON: {"goal":"","tools":"","stages":[{"title":"","minutes":3,"activity":"","result":""}],"homework":""}.`,
        `6 bosqich, jami ${d} daq. Daqiqalar yig‘indisi ${d} ga teng bo‘lsin.`,
        `Har bosqichda «${meta.topic}» bo‘yicha ANIQ misol, savol yoki mashq (umumiy «salomlashish»dan tashqari).`,
        `activity 2–4 gap, konkret. Masalan kasr bo‘lsa 1/2+1/3 kabi misol.`,
      ].join("\n"),
      2400,
      { json: true, timeoutMs },
    );
  let raw = await ask(Math.min(55_000, remainingMs(deadline) || 55_000));
  let data = (raw ? parseJson(raw) : null) as {
    goal?: string;
    tools?: string;
    stages?: { title?: string; minutes?: number; activity?: string; result?: string }[];
    homework?: string;
  } | null;
  if (!data?.stages?.length && remainingMs(deadline) > 10_000) {
    raw = await ask(Math.min(40_000, remainingMs(deadline)));
    data = (raw ? parseJson(raw) : null) as typeof data;
  }
  if (!data?.stages?.length) return null;
  const L = sectionLabels(meta.language);
  const stages = data.stages.slice(0, 8);
  /**
   * Daqiqalarni dars davomiyligiga moslash.
   *
   * Promptda «yig'indi ${d} ga teng bo'lsin» deyilgan, lekin hech qachon
   * TEKSHIRILMAGAN: 45 daqiqalik darsda bosqichlar yig'indisi 60 yoki 35
   * chiqardi va o'qituvchi buni qo'lda tuzatishga majbur bo'lardi.
   * Endi nisbat saqlangan holda qayta taqsimlanadi, qoldiq esa eng katta
   * bosqichga qo'shiladi.
   */
  const minutes = normalizeMinutes(stages.map((st) => st.minutes), d);
  stages.forEach((st, i) => {
    st.minutes = minutes[i];
  });
  const topicHits = stages.filter((st) =>
    `${st.title} ${st.activity}`.toLowerCase().includes(meta.topic.toLowerCase().slice(0, 12)),
  ).length;
  if (topicHits === 0 && stages.every((st) => (st.activity || "").length < 40)) return null;
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      section("passport", L.lessonPassport, [
        {
          kind: "p",
          text: `${L.fieldSubject}: ${meta.subject || L.fieldSubject}. ${L.fieldGrade}: ${meta.grade}. ${L.fieldDuration}: ${d} ${L.minutesShort}.`,
        },
        { kind: "p", text: `${L.fieldTopic}: ${meta.topic}` },
        {
          kind: "p",
          text: (() => {
            const g = clip(data.goal || L.goalFallback(meta.topic), 500);
            return /^(maqsad|цель|goal)\b/i.test(g) ? g : `Maqsad: ${g}`;
          })(),
        },
        { kind: "p", text: clip(data.tools || L.equipmentFallback, 320) },
      ]),
      section("map", L.lessonMap, [
        ...stages.flatMap((st, i) => [
          {
            kind: "h3" as const,
            text: `${i + 1}. ${st.title || L.stage} (${st.minutes || 5} ${L.minutesShort})`,
          },
          { kind: "p" as const, text: clip(st.activity || "", 700) },
        ]),
        { kind: "h3", text: L.homework },
        { kind: "p", text: clip(data.homework || L.homeworkFallback(meta.topic), 400) },
      ]),
    ],
    tables: [
      {
        caption: L.timeTable,
        headers: [...L.timeCols],
        rows: stages.map((st) => [
          clip(st.title || L.stage, 40),
          String(st.minutes || ""),
          clip(st.activity || "", 120),
          clip(st.result || "", 80),
        ]),
      },
    ],
  };
}

/**
 * Dars bosqichlari daqiqasini davomiylikka moslaydi.
 *
 * Promptda «yig'indi ${duration} ga teng bo'lsin» deyilgan, lekin hech
 * qachon TEKSHIRILMAGAN: 45 daqiqalik darsda bosqichlar yig'indisi 60
 * yoki 35 chiqardi va o'qituvchi buni qo'lda tuzatardi. Nisbat
 * saqlanadi, yaxlitlash qoldig'i esa eng uzun bosqichga qo'shiladi.
 *
 * Alohida funksiya, chunki bu sof arifmetika va u yiqilsa hujjat jim
 * noto'g'ri chiqadi — aynan shunday mantiq testsiz qolmasligi kerak.
 */
export function normalizeMinutes(raw: unknown[], duration: number): number[] {
  const d = Math.max(1, Math.round(duration) || 1);
  const minutes = raw.map((m) => Math.max(1, Math.round(Number(m) || 0) || 1));
  if (!minutes.length) return [];
  const sum = minutes.reduce((a, b) => a + b, 0);
  const scaled = sum === d ? minutes : minutes.map((m) => Math.max(1, Math.round((m / sum) * d)));
  // Tsikl chegaralangan: har bosqich kamida 1 daqiqa bo'lgani uchun
  // kamaytirish imkonsiz holat ham bo'lishi mumkin.
  for (let guard = 0; guard < 500; guard++) {
    const diff = d - scaled.reduce((a, b) => a + b, 0);
    if (diff === 0) break;
    const peak = Math.max(...scaled);
    if (diff < 0 && peak <= 1) break;
    scaled[scaled.indexOf(peak)] += diff > 0 ? 1 : -1;
  }
  return scaled;
}

/**
 * Rezyume uchun fakt qo'riqchisi.
 *
 * Rezyume hujjat emas, DA'VO: yo'q ish joyi yozilgan CV bilan suhbatga
 * borish foydalanuvchi uchun jiddiy zarar. Promptda «yil/joy uydirmang»
 * deyilgan, lekin tekshirilmasdi.
 *
 * Ilgari bu mantiq `writeResumeWithLlm` ichidagi yopiq funksiyalar edi,
 * ya'ni uni sinash uchun jonli LLM chaqiruvi kerak bo'lardi. Endi
 * alohida — chunki u ikki xil qaror qabul qiladi va ikkalasi ham
 * noto'g'ri bo'lishi mumkin:
 *   • uydirma TASHKILOT — butun band tashlanadi;
 *   • uydirma YIL — faqat yil o'chiriladi.
 * Shu farq tufayli haqiqiy qayta ifodalash («15-maktab» → «15-sonli
 * umumiy o'rta ta'lim maktabi») saqlanadi.
 */
export function resumeFactGuard(inputFacts: string) {
  const facts = String(inputFacts ?? "").toLowerCase();
  const years = new Set(facts.match(/\b(19|20)\d{2}\b/g) ?? []);

  /** Tashkilot/joy nomi kiritilgan matndan olinganmi. */
  function orgIsKnown(head: string): boolean {
    if (!facts.trim()) return true;
    const tokens = String(head ?? "")
      .toLowerCase()
      .replace(/\b(?:19|20)\d{2}\b/g, " ")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 4);
    if (!tokens.length) return true;
    return tokens.some((t) => facts.includes(t));
  }

  /**
   * Kiritilmagan yilni olib tashlaydi.
   *
   * Model ko'pincha mantiqiy, lekin O'YLAB TOPILGAN sana qo'shadi:
   * bakalavr 2021-yilda tugagan bo'lsa, u «2017–2021» deb yozadi.
   * Oraliqda bitta yil notanish bo'lsa BUTUN oraliq olib tashlanadi —
   * yarim oraliq («–2021») ma'nosiz.
   */
  function stripUnknownYears(text: string): string {
    const t = String(text ?? "");
    if (!years.size) return t;
    return t
      .replace(/\b(?:19|20)\d{2}\s*[–—-]\s*(?:19|20)\d{2}\b/g, (range) =>
        (range.match(/\b(?:19|20)\d{2}\b/g) ?? []).every((y) => years.has(y)) ? range : "",
      )
      .replace(/\b(?:19|20)\d{2}\b/g, (y) => (years.has(y) ? y : ""))
      .replace(/\s*·\s*(?=·|$)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s·,;—–-]+|[\s·,;—–-]+$/g, "")
      .trim();
  }

  return { orgIsKnown, stripUnknownYears };
}

function pickTerms(data: unknown, limit: number): { term: string; def: string }[] {
  const bag = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(bag.terms)
      ? bag.terms
      : Array.isArray(bag.items)
        ? bag.items
        : [];
  const out: { term: string; def: string }[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const term = clip(o.term ?? o.name ?? o.atama ?? o.title, 60);
    const def = clip(o.def ?? o.definition ?? o.izoh ?? o.text, 280);
    if (term && def) out.push({ term, def });
  }
  return out.slice(0, limit);
}

export async function writeGlossaryWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const want = meta.termCount || 10;
  const collected: { term: string; def: string }[] = [];
  const seen = new Set<string>();
  let intro = "";

  const ask = (count: number, timeoutMs: number) =>
    llmComplete(
      glossarySystemPrompt(meta),
      [
        `JSON: {"intro":"","terms":[{"term":"","def":""}]}.`,
        `«${meta.topic}» bo‘yicha ${count} ta sohaga xos atama.`,
        `TAQIQLANADI: kompetensiya, mezon, metod, tahlil, sintez, innovatsiya, refleksiya, differensiatsiya, integratsiya, indikator, resurs — agar bular shu sohaning maxsus termini bo‘lmasa.`,
        `Har izoh 2 aniq gap, shu soha misoli bilan.`,
        collected.length
          ? `ALLAQACHON YOZILGAN atamalar — TAKRORLAMANG:\n${collected.map((t) => t.term).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      Math.min(6000, 1200 + count * 130),
      { json: true, timeoutMs },
    );

  /**
   * `termCount` (10/20/40) tanlovi endi narxni ham, so'ralayotgan sonni
   * ham belgilaydi — ilgari doim qattiq yozilgan «14» so'ralar va
   * `pickTerms` 16 tadan kesib tashlardi.
   *
   * 40 ta bitta chaqiruvda ishonchsiz: `write-llm.ts`dagi saboq bilan
   * bir xil — modeldan bitta javobda ko'p element so'ralganda kamroq
   * qaytadi. Shuning uchun so'rov 20 talik bo'laklarga bo'linadi va
   * har bo'lak oldingi atamalarni ko'rib, takrorlamaslikka harakat
   * qiladi.
   */
  const CHUNK = 20;
  let guard = 0;
  while (collected.length < want && guard < 4 && remainingMs(deadline) > 10_000) {
    guard++;
    const need = want - collected.length;
    const raw = await ask(Math.min(CHUNK, need), Math.min(55_000, remainingMs(deadline) || 55_000));
    const data = raw ? parseJson(raw) : null;
    if (!intro) intro = (data && typeof data === "object" ? (data as { intro?: string }).intro : "") || "";
    const batch = pickTerms(data, need + 6).filter((t) => !isGenericGlossaryTerm(t.term));
    let added = 0;
    for (const t of batch) {
      const key = t.term.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(t);
      added++;
    }
    // Model progress bermay qo'ydi — tsiklni davom ettirish foydasiz.
    if (!added) break;
  }
  // Va'da qilingan sonning kamida 70% i — xuddi texnologik xaritadagi
  // 70% chegara kabi (bir xil naqsh: to'liq to'ldirmasak, halol qisman).
  if (collected.length < Math.max(6, Math.ceil(want * 0.7))) return null;
  const terms = collected.slice(0, want);
  /*
   * Alifbo tartibi — glossariy uchun asosiy talab.
   *
   * Ilgari atamalar model qaytargan tartibda chiqardi, ya'ni tasodifiy
   * edi: o'quvchi kerakli atamani izlab butun ro'yxatni o'qib chiqishi
   * kerak bo'lardi. Saralash `terms` ustida BIR MARTA bajariladi —
   * matn qismi ham, jadval ham shu ro'yxatdan quriladi, shuning uchun
   * ikkalasi bir xil tartibda qoladi.
   *
   * Taqqoslash hujjat tilida: kirill (ru) va lotin (uz/en) uchun
   * tartib boshqacha. Boshidagi qo'shtirnoq va tirelar hisobga
   * olinmaydi — «"Aksiya"» «B» dan keyin turib qolmasin.
   */
  const collator = new Intl.Collator(meta.language || "uz", { sensitivity: "base", numeric: true });
  const sortKey = (t: string) => String(t).replace(/^[^\p{L}\p{N}]+/u, "").trim();
  terms.sort((a, b) => collator.compare(sortKey(a.term), sortKey(b.term)));
  const L = sectionLabels(meta.language);
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      section("kirish", L.intro, [
        { kind: "p", text: clip(intro || L.glossaryIntroFallback(meta.topic), 500) },
      ]),
      section(
        "atamalar",
        L.terms,
        terms.flatMap((t) => [
          { kind: "h3" as const, text: String(t.term) },
          { kind: "p" as const, text: clip(String(t.def), 420) },
        ]),
      ),
    ],
    tables: [
      {
        caption: L.shortTable,
        headers: [...L.termCols],
        rows: terms.map((t) => [String(t.term), clip(String(t.def), 200)]),
      },
    ],
  };
}

/**
 * Keys uchun baholash rubrikasi.
 *
 * Vosita ilgari faqat «namunaviy kalit» berardi — ya'ni TO'G'RI javobni.
 * O'qituvchiga esa javobning o'zi emas, uni QANDAY baholash kerakligi
 * kerak: qaysi mezon nechchi ball. Rubrikasiz keys darsda ishlatilganda
 * har o'qituvchi o'zicha baholaydi.
 *
 * Model mezon bermasa yoki ball noto'g'ri kelsa — bo'lim umuman
 * chiqmaydi. Yarim rubrika (mezoni bor, balli yo'q) yo'qdan yomonroq.
 */
export function rubricBlocks(
  rubric: { criterion?: string; points?: unknown }[] | undefined,
  L: ReturnType<typeof sectionLabels>,
): Block[] {
  if (!Array.isArray(rubric)) return [];
  const rows = rubric
    .map((r) => ({ criterion: clip(String(r?.criterion ?? ""), 140), points: Number(r?.points) }))
    .filter((r) => r.criterion.length > 2 && Number.isFinite(r.points) && r.points > 0)
    .slice(0, 5);
  if (rows.length < 2) return [];
  /**
   * Ball yig'indisi 10 ga MAJBURAN tenglashtiriladi.
   *
   * Prompt «ballar yig'indisi 10» deb so'raydi, lekin bu tavsiya edi —
   * hech narsa tekshirmasdi, model 8, 12 yoki 15 qaytarishi mumkin edi.
   * O'qituvchi bunday rubrikani ishlata olmaydi. `normalizeMinutes`
   * bilan BIR XIL algoritm qo'llaniladi (nisbat saqlab moslashtirish,
   * qoldiqni eng kattasiga qo'shish) — u ham aslida «bir nechta qiymatni
   * kamida 1 shart bilan aniq yig'indiga moslash» masalasi, faqat
   * daqiqa emas, ball uchun.
   */
  const points = normalizeMinutes(rows.map((r) => r.points), 10);
  const total = points.reduce((a, b) => a + b, 0);
  return [
    { kind: "h3", text: L.rubric },
    ...rows.map((r, i) => ({ kind: "li" as const, text: `${r.criterion} — ${points[i]} ${L.points}` })),
    { kind: "p", text: `${L.totalPoints}: ${total} ${L.points}` },
  ];
}

export async function writeKeysWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  /**
   * Ikkinchi urinish — kichikroq so'rov bilan.
   *
   * Bu vosita bitta chaqiruvli edi va 70 soniyalik timeout'ga tayanardi.
   * Jonli sinovda model yuk ostida sekinlashganda so'rov timeout'ga
   * urildi va butun ish `FAILED` bo'ldi — holbuki `glossary` va
   * `lesson-plan` allaqachon ikkinchi urinishga ega. Timeout bo'yicha
   * `llmComplete` qayta urinmaydi (byudjet sarflangan), shuning uchun
   * qayta urinish shu yerda va YENGILROQ so'rov bilan bo'lishi kerak.
   */
  const ask = (timeoutMs: number, count: number) =>
    llmComplete(
      keysSystemPrompt(meta),
      [
        `JSON: {"intro":"","cases":[{"title":"","situation":"","tasks":["",""],"key":"","rubric":[{"criterion":"","points":0}]}]}.`,
        `«${meta.topic}» bo‘yicha ${count} ta turlicha, aniq ism-vaziyatli keys. Umumiy «resurs cheklangan» shablon yo‘q.`,
        `rubric — o‘qituvchi shu keysni BAHOLASH uchun 3–4 ta mezon. Har mezon shu keysga xos (umumiy «to‘g‘ri javob» emas), ballar yig‘indisi 10.`,
      ].join("\n"),
      count >= 5 ? 2800 : 2000,
      { json: true, timeoutMs },
    );

  type KeysData = {
    intro?: string;
    cases?: {
      title?: string;
      situation?: string;
      tasks?: string[];
      key?: string;
      rubric?: { criterion?: string; points?: unknown }[];
    }[];
  };
  const pick = (raw: string | null) => ((raw ? parseJson(raw) : null) as KeysData | null)?.cases ?? [];

  let data = (await ask(Math.min(60_000, remainingMs(deadline) || 60_000), 5)) as string | null;
  let cases = pick(data).slice(0, 5);
  if (cases.length < 3 && remainingMs(deadline) > 20_000) {
    console.warn("[write-keys] qayta urinish:", cases.length, "keys");
    data = await ask(Math.min(45_000, remainingMs(deadline)), 4);
    cases = pick(data).slice(0, 5);
  }
  if (cases.length < 3) return null;
  const intro = ((data ? parseJson(data) : null) as KeysData | null)?.intro;
  const L = sectionLabels(meta.language);
  return {
    meta,
    titlePage: true,
    toc: true,
    sections: [
      section("kirish", L.intro, [
        { kind: "p", text: clip(intro || L.keysIntroFallback(meta.topic), 400) },
      ]),
      ...cases.map((c, i) =>
        section(`keys${i + 1}`, `${L.caseWord} ${i + 1}. ${clip(c.title || meta.topic, 60)}`, [
          { kind: "p", text: clip(c.situation || "", 420) },
          { kind: "h3", text: L.tasks },
          ...(c.tasks ?? []).slice(0, 4).map((t) => ({ kind: "li" as const, text: clip(t, 180) })),
          { kind: "h3", text: L.answerKey },
          { kind: "p", text: clip(c.key || "", 360) },
          ...rubricBlocks(c.rubric, L),
        ]),
      ),
    ],
  };
}

export async function writeResumeWithLlm(
  meta: DocMeta,
  values: Record<string, unknown>,
  deadline?: number,
): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const raw = await llmComplete(
    resumeSystemPrompt(meta, String(values.tone || "professional")),
    [
      `JSON: {"summary":"","experience":[{"period":"","org":"","role":"","bullets":[""]}],"education":[{"place":"","degree":"","years":""}],"skills":[""]}.`,
      `summary — 4–6 professional gap, natija bilan.`,
      `experience — 1–3 joy, har birida 3–5 bullet (vazifa + natija). Faktni o‘zgartirmang, yil/joy uydirmang.`,
      `Xom nusxa qilmang, lekin yangi ish joyi qo‘shmang.`,
      `Ism: ${values.fullName || meta.author}`,
      `Lavozim: ${values.targetRole || meta.topic}`,
      `Joylashuv: ${values.location || meta.city}`,
      `Email: ${values.email || ""}`,
      `Tel: ${values.phone || ""}`,
      `Berilgan qisqacha: ${values.summary || ""}`,
      `Tajriba: ${values.experience || ""}`,
      `Ta’lim: ${values.education || ""}`,
      `Ko‘nikma: ${values.skills || ""}`,
    ].join("\n"),
    2000,
    { json: true, timeoutMs: Math.min(50_000, remainingMs(deadline) || 50_000) },
  );
  const data = parseLlmObject<{
    summary?: unknown;
    experience?: unknown;
    education?: unknown;
    skills?: unknown;
  }>(raw);
  if (!data?.summary || asText(data.summary).length < 80) return null;

  const expItems = Array.isArray(data.experience)
    ? data.experience.map((item) =>
        typeof item === "string" ? { period: "", org: "", role: "", bullets: [item] } : item,
      )
    : typeof data.experience === "string"
      ? [{ period: "", org: "", role: "", bullets: [data.experience] }]
      : [];
  const eduItems = Array.isArray(data.education)
    ? data.education
    : [{ place: asText(data.education || values.education || meta.university), degree: "", years: "" }];
  const skills = Array.isArray(data.skills)
    ? data.skills.map((x) => asText(x)).filter(Boolean)
    : asText(data.skills || values.skills)
        .split(/[,;•\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

  const L = sectionLabels(meta.language);
  const name = String(values.fullName || meta.author || "F.I.Sh");
  const contact = [values.location, values.email, values.phone].filter(Boolean).join(" · ") || meta.city;

  /**
   * Model kiritilmagan ish joyi yoki yilni qo'shmasligi kerak.
   *
   * Promptda «yil/joy uydirmang» deyilgan, lekin tekshirilmagan edi —
   * rezyume esa hujjat emas, DA'VO: yo'q ish joyi yozilgan CV bilan
   * suhbatga borish foydalanuvchi uchun jiddiy zarar.
   *
   * Tekshiruv ehtiyotkor: model qayta ifodalashi mumkin, shuning uchun
   * yil ANIQ mos kelishi, tashkilot esa kamida bitta mazmunli bo'lakni
   * kiritilgan matndan olishi talab qilinadi.
   */
  const inputFacts = [values.experience, values.education, values.summary, values.skills]
    .map((x) => asText(x).toLowerCase())
    .join(" ");
  const { orgIsKnown, stripUnknownYears } = resumeFactGuard(inputFacts);

  const expBlocks: Block[] = [];
  let lastHead = "";
  let dropped = 0;
  for (const item of expItems.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const rawHead = [asText(o.period), asText(o.role), asText(o.org)].filter(Boolean).join(" — ");
    // Uydirma ish joyi — butun band tashlanadi; uydirma yil — faqat yil.
    if (rawHead && !orgIsKnown(rawHead)) {
      console.warn("[resume] kiritilmagan ish joyi tashlandi:", rawHead.slice(0, 80));
      dropped += 1;
      continue;
    }
    const head = stripUnknownYears(rawHead);
    if (head && head !== lastHead) {
      expBlocks.push({ kind: "h3", text: clip(head, 120) });
      lastHead = head;
    }
    const bullets = Array.isArray(o.bullets) ? o.bullets : [o.text, o.value];
    for (const b of bullets) {
      let t = clip(b, 220);
      if (head && t.includes(head)) t = t.replace(head, "").replace(/^[—\-\s]+/, "");
      const parts = t.split(/\s+[—–-]\s+/);
      if (parts.length >= 2 && /^\d{4}/.test(parts[0])) t = parts[parts.length - 1];
      t = clip(t, 220);
      if (t && t !== head) expBlocks.push({ kind: "li", text: t });
    }
  }
  if (!expBlocks.length) {
    // Hammasi filtrdan o'tmagan bo'lsa foydalanuvchi yozganini o'zini beramiz —
    // uydirma tajribadan ko'ra xom matn yaxshiroq.
    if (dropped) console.warn("[resume] barcha tajriba bandlari tashlandi, xom matn ishlatiladi");
    const rawExp = asText(values.experience);
    if (rawExp) expBlocks.push({ kind: "p", text: clip(rawExp, 800) });
  }

  const eduBlocks: Block[] = [];
  for (const item of eduItems.slice(0, 3)) {
    if (!item || typeof item !== "object") {
      const t = stripUnknownYears(asText(item));
      if (t) eduBlocks.push({ kind: "p", text: t });
      continue;
    }
    const o = item as Record<string, unknown>;
    const line = stripUnknownYears([asText(o.place), asText(o.degree), asText(o.years)].filter(Boolean).join(" · "));
    if (line) eduBlocks.push({ kind: "p", text: clip(line, 200) });
  }

  return {
    meta: { ...meta, topic: String(values.targetRole || meta.topic), author: name },
    titlePage: false,
    toc: false,
    sections: [
      section("summary", L.summary, [
        { kind: "p", text: clip(data.summary, 700) },
        { kind: "p", text: contact },
      ]),
      section("exp", L.experience, expBlocks),
      section("edu", L.education, eduBlocks.length ? eduBlocks : [{ kind: "p", text: asText(values.education || meta.university) }]),
      section("skills", L.skills, [
        { kind: "p", text: skills.slice(0, 16).join(" · ") || asText(values.skills) },
      ]),
    ],
  };
}

export async function writeMapWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const weekly = Math.max(1, meta.weeklyHours);
  const total = Math.max(weekly, meta.totalHours);
  const weeks = Math.max(8, Math.min(36, Math.round(total / weekly)));
  // Ilgari 24 ta qator so'ralib, keyin `weeks` gacha TSIKL bilan
  // to'ldirilardi — 34 haftalik xaritada mavzular takrorlanardi va
  // hujjat yaroqsiz bo'lardi. Endi qancha hafta bo'lsa shuncha so'raymiz.
  const want = weeks;
  const raw = await llmComplete(
    mapSystemPrompt(meta),
    [
      `JSON: {"intro":"","weeks":[{"topic":"","method":"","result":"","control":""}]}.`,
      `${want} ta qator. Fan: ${meta.subject || meta.topic}.`,
      `topic — aniq dars mavzusi («1-mavzu» YO‘Q). method — Ma’ruza / Amaliy / Laboratoriya / Mustaqil / Nazorat.`,
      `result — shu mavzuga xos 4–8 so‘z (umumiy «Tushuncha shakllanadi» TAKRORLANMASIN).`,
      `control — Og‘zaki / Yozma / Amaliy ish / Test.`,
    ].join("\n"),
    2800,
    { json: true, timeoutMs: Math.min(70_000, remainingMs(deadline) || 70_000) },
  );
  const data = raw ? (parseJson(raw) as { intro?: string; topics?: unknown; weeks?: unknown } | null) : null;

  type Week = { topic: string; method: string; result: string; control: string };
  const weeksRows: Week[] = [];
  if (Array.isArray(data?.weeks)) {
    for (const x of data.weeks) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const topic = clip(o.topic ?? o.title ?? o.name, 80);
      if (!topic || /^\d+-?mavzu/i.test(topic)) continue;
      weeksRows.push({
        topic,
        method: clip(o.method, 40) || pickMapMethod(topic, weeksRows.length),
        result: /tushuncha shakllanadi|ko‘nikma mustahkamlanadi|mustaqil ishlay oladi/i.test(clip(o.result, 60))
          ? pickMapResult(topic)
          : clip(o.result, 60) || pickMapResult(topic),
        control: clip(o.control, 40) || pickMapControl(weeksRows.length),
      });
    }
  } else if (Array.isArray(data?.topics)) {
    for (const x of data.topics) {
      const topic = clip(x, 80);
      if (!topic || /^\d+-?mavzu/i.test(topic)) continue;
      weeksRows.push({
        topic,
        method: pickMapMethod(topic, weeksRows.length),
        result: pickMapResult(topic),
        control: pickMapControl(weeksRows.length),
      });
    }
  }
  // Takror mavzuni tashlaymiz: model ba'zan bir mavzuni ikki marta beradi.
  const seen = new Set<string>();
  const unique = weeksRows.filter((r) => {
    const key = r.topic.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Va'da qilingan haftalarning kamida 70% i noyob mavzu bilan
  // to'lmasa xarita yaroqsiz — tsikl bilan to'ldirmaymiz.
  if (unique.length < Math.max(6, Math.ceil(weeks * 0.7))) {
    console.warn("[write-map] few unique topics", unique.length, "want", weeks);
    return null;
  }
  const L = sectionLabels(meta.language);
  const filled = unique.slice(0, weeks);
  /**
   * Soat ustuni yig'indisi `total` ga QAT'IY teng (N-11).
   *
   * Ilgari har qator doim `weekly` soat olardi. 70% chegara `filled.length`
   * ni `weeks` dan kam qoldirsa (masalan 34 talab qilingan, 25 noyob mavzu
   * topilgan), jadval yig'indisi `25 × weekly` bo'lib qolar, pasportdagi
   * `total` esa (masalan 136) o'zgarmasdi — o'qituvchi ikkitasini
   * solishtirsa mos kelmasdi. `normalizeMinutes` bilan bir xil algoritm:
   * soatlar nisbat saqlab `total` ga taqsimlanadi — kamroq mavzu bo'lsa,
   * har biriga biroz ko'proq soat (chuqurroq o'rganish), ko'p bo'lsa kamroq.
   */
  const hours = normalizeMinutes(new Array(filled.length).fill(weekly), total);
  const table: DocTable = {
    caption: L.yearPlan,
    headers: [...L.yearCols],
    rows: filled.map((row, i) => [
      String(i + 1),
      String(hours[i]),
      row.topic,
      row.method,
      row.result,
      row.control,
    ]),
  };
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      section("passport", L.subjectPassport, [
        {
          kind: "p",
          text: `${L.fieldSubject}: ${meta.subject || meta.topic}. ${L.fieldWeeklyHours}: ${weekly}. ${L.fieldTotalHours}: ${total}. ${L.fieldWeeks}: ${filled.length}.`,
        },
        { kind: "p", text: clip(data?.intro || L.mapIntroFallback, 400) },
      ]),
    ],
    tables: [table],
  };
}

export async function writeImradWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const sys = imradSystemPrompt(meta);
  const L = sectionLabels(meta.language);
  const topic = meta.topic;
  /**
   * Annotatsiya kalitlari HUJJAT TILIDAN olinadi.
   *
   * Ilgari asosiy annotatsiya doim `"uz"` kalitidan o'qilardi: ruscha
   * maqolada model `"ru"` kalitini to'ldirar, kod esa `"uz"` ni izlab
   * bo'sh qaytarardi — annotatsiya yo'qolardi. `all` rejimida esa ruscha
   * maqola ikki marta ruscha annotatsiya olardi.
   */
  const primaryLang = ["uz", "ru", "en"].includes(meta.language) ? meta.language : "uz";
  const absLangs =
    meta.annotationLangs === "all"
      ? [primaryLang, ...["uz", "en", "ru"].filter((c) => c !== primaryLang)]
      : [primaryLang];
  const absPrompt = `JSON: {${absLangs.map((c) => `"${c}":{"text":"","keywords":""}`).join(",")}}`;
  const absRaw = await llmComplete(sys, `Annotatsiya. ${absPrompt}. Mavzu: «${topic}». Har biri 4–6 gap.`, 900, {
    json: true,
    timeoutMs: Math.min(40_000, remainingMs(deadline) || 40_000),
  });
  const absData = (absRaw ? parseJson(absRaw) : null) as Record<string, { text?: string; keywords?: string }> | null;
  const abstracts = absLangs
    .map((code) => {
      const x = absData?.[code];
      if (!x?.text) return null;
      return {
        lang: code,
        label: sectionLabels(code).abstract,
        text: clip(x.text, 700),
        keywords: clip(x.keywords || topic, 120),
      };
    })
    .filter((x): x is { lang: string; label: string; text: string; keywords: string } => Boolean(x));

  /**
   * IMRAD hajmi endi TANLANGAN BETGA bog'liq.
   *
   * Ilgari to'rt bo'limning har biriga qat'iy paragraf soni berilardi
   * (3/2/3/3) va `meta.targetPages` umuman o'qilmasdi. Ya'ni «10–15 bet»
   * uchun 8 000 tanga to'lagan foydalanuvchi «3–5 bet» uchun 4 000 tanga
   * to'lagani bilan AYNAN bir xil hujjat olardi — bu P0-1 (slayd sifat
   * paketi) nuqsonining hujjatdagi ko'rinishi edi.
   *
   * Ulushlar IMRAD me'yoriga mos: natija va muhokama eng katta qism,
   * metodika eng kichigi. Paragraf ~105 so'z deb hisoblanadi (promptda
   * shu so'raladi).
   */
  const want = targetWords(meta.targetPages);
  const SHARE = { intro: 0.2, methods: 0.15, results: 0.35, discussion: 0.3 } as const;
  const parasFor = (share: number, floor: number) =>
    Math.max(floor, Math.min(12, Math.round((want * share) / 105)));

  const plan = [
    {
      id: "intro",
      title: L.imradIntro,
      brief: `Tadqiqot savoli, nima ma’lum, bo‘shliq, maqsad. Faqat «${topic}».`,
      min: parasFor(SHARE.intro, 3),
    },
    {
      id: "methods",
      title: L.imradMethods,
      brief: `Adabiyot tahlili, qiyoslash, tanlov mezoni, cheklov. Uydirma so‘rovnoma yo‘q.`,
      min: parasFor(SHARE.methods, 2),
    },
    {
      id: "results",
      title: L.imradResults,
      brief: `Asosiy tahliliy topilmalar: omillar, yondashuvlar, farqlar. Uydirma foiz yo‘q.`,
      min: parasFor(SHARE.results, 3),
    },
    {
      id: "discussion",
      title: L.imradDiscussion,
      brief: `Topilmalarning ahamiyati, cheklov, amaliy xulosa. Shior emas.`,
      min: parasFor(SHARE.discussion, 3),
    },
  ];

  /** Bir bo'limni yozadi; token va timeout byudjeti paragraf soniga ergashadi. */
  const writeImradSection = async (item: { title: string; brief: string; min: number }, min: number) => {
    const timeoutMs = Math.min(45_000, remainingMs(deadline) || 45_000);
    if (timeoutMs < 5_000) return [];
    const text = await llmComplete(
      sys,
      [
        `Bo‘lim: ${item.title}`,
        `Mavzu: ${topic}`,
        item.brief,
        `Kamida ${min} ta to‘la paragraf (har biri 80–130 so‘z). Sarlavhani qayta yozmang.`,
      ].join("\n"),
      Math.min(7000, 700 + min * 420),
      { timeoutMs },
    );
    return text ? blocksFromText(text) : [];
  };

  const written = await mapPool(plan, 3, async (item) => {
    let blocks = await writeImradSection(item, item.min);
    // Bitta bo'sh bo'lim butun maqolani yo'q qiladi — bir marta qayta uriniladi.
    if (!blocks.length && remainingMs(deadline) > 10_000) {
      blocks = await writeImradSection(item, Math.max(2, item.min - 2));
    }
    return { item, blocks };
  });

  const sections: DocSection[] = [];
  for (const { item, blocks } of written) {
    if (blocks.length < 1) return null;
    sections.push(section(item.id, item.title, blocks));
  }

  /**
   * Hajmni va'daga yetkazish.
   *
   * IMRAD ga yangi BO'LIM qo'shib bo'lmaydi — tuzilma qat'iy, beshinchi
   * bo'lim uni buzadi. Shuning uchun mavjud «Natijalar» va «Muhokama»
   * chuqurlashtiriladi: ikkalasi ham IMRAD da kengaytirishga ochiq va
   * aynan shu yerda ko'proq tahlil kutiladi.
   */
  const deepen = [
    {
      id: "results",
      brief: `«${topic}» bo‘yicha QO‘SHIMCHA topilmalar: yuqorida aytilmagan omil, qarama-qarshi dalil yoki alohida holat. Takrorlamang.`,
    },
    {
      id: "discussion",
      brief: `«${topic}» bo‘yicha QO‘SHIMCHA muhokama: cheklovlar, amaliy tavsiya va keyingi tadqiqot yo‘nalishi. Takrorlamang.`,
    },
  ];
  for (const step of deepen) {
    const doc = { meta, sections } as AcademicDoc;
    if (wordCount(doc) >= want * 0.9) break;
    if (remainingMs(deadline) < 25_000) {
      console.warn("[imrad] chuqurlashtirish tashlandi: byudjet tugadi");
      break;
    }
    const target = sections.find((x) => x.id === step.id);
    if (!target) continue;
    const need = want - wordCount(doc);
    const extra = await writeImradSection(
      { title: target.title, brief: step.brief, min: 0 },
      Math.max(3, Math.min(10, Math.round(need / 110))),
    );
    if (!extra.length) break;
    target.blocks.push(...extra);
  }

  const refRaw = await llmComplete(
    sys,
    `«${topic}» bo‘yicha 6 ta uslubiy manba. Format: Muallif. Nom. – Shahar: Nashriyot, yil. Kirish gap yo‘q.`,
    700,
    { timeoutMs: Math.min(25_000, remainingMs(deadline) || 25_000) },
  );
  const references = (refRaw || "")
    .split(/\n+/)
    .map((s) => s.replace(/^\d+[\).]\s*/, "").trim())
    .filter((s) => s.length > 20 && s.length < 240 && /[.–—]/.test(s))
    .slice(0, 8);

  return {
    meta,
    titlePage: true,
    toc: true,
    abstracts: abstracts.length
      ? abstracts
      : [
          {
            lang: meta.language,
            label: L.abstract,
            text: `Maqolada «${topic}» IMRAD tuzilmasi asosida yoritiladi.`,
            keywords: topic,
          },
        ],
    sections,
    references: references.length >= 3 ? references : undefined,
    /**
     * Model bergan manbalar TEKSHIRILMAGAN deb belgilanadi.
     *
     * P0-4 yozuvchi yo'lida (`write-llm.ts`) va shablon yo'lida
     * (`content.ts`) yopilgan edi, IMRAD esa e'tibordan chetda qolgan:
     * u ro'yxatni ogohlantirishsiz chiqarardi. Aynan maqola — jurnalga
     * yoki ilmiy rahbarga boradigan hujjat, ya'ni soxta manba eng ko'p
     * zarar keltiradigan joy. Nuqsonni evalning yangi `article-imrad`
     * keysi ushladi.
     */
    referencesNote: references.length >= 3 ? unverifiedReferenceNote(meta.language) : undefined,
  };
}

export function chunkSource(text: string, max = 3200) {
  const paras = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras.length ? paras : [text]) {
    if (cur && cur.length + p.length + 2 > max) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Bir ishda tarjima qilinadigan eng ko'p bo'lak.
 *
 * Ilgari `chunkSource` oxirida `.slice(0, 12)` turardi — ortiqcha bo'lak
 * JIM tashlanardi. Endi kesish yo'q: chegaradan oshsa ish xato bilan
 * tugaydi va kredit qaytadi. `lib/tools.ts` dagi `TRANSLATION_MAX_CHARS`
 * (48 000) buni forma darajasida oldini oladi; bu yer esa abzas
 * taqsimoti yomon bo'lgan (har abzas o'z bo'lagini egallagan) holat
 * uchun zaxira to'siq.
 */
export const MAX_CHUNKS = 15;

/** Bo'laklar `POOL` tadan parallel ketadi. */
const CHUNK_POOL = 3;

const TRANSLATED_KINDS = new Set(["h2", "h3", "p", "li"]);

/**
 * Tarjima bo'laklarini TURI bilan o'qiydi.
 *
 * Ilgari model faqat `paragraphs: string[]` qaytarardi va natija
 * `kind: "p"` ga tekislanardi — ya'ni asl hujjatdagi sarlavhalar va
 * ro'yxatlar yo'qolardi. Bu tizim prompti bilan ochiq ziddiyat edi:
 * u «sarlavha, ro'yxat va paragraf chegaralarini saqlang» deb turardi,
 * sxema esa buni ifodalashga imkon bermasdi.
 *
 * Eski shakl (`paragraphs`) va umuman JSON bo'lmagan javob ham
 * qabul qilinadi — model har doim ham yangi sxemaga bo'ysunmaydi.
 */
export function translatedBlocks(
  data: { blocks?: unknown; paragraphs?: unknown } | null,
  raw: string | null,
): Block[] {
  if (Array.isArray(data?.blocks)) {
    const out = data.blocks
      .map((b) => {
        const rec = b as { kind?: unknown; text?: unknown };
        const text = String(rec?.text ?? "").trim();
        if (text.length < 2) return null;
        const kind = String(rec?.kind ?? "p");
        return { kind: TRANSLATED_KINDS.has(kind) ? kind : "p", text } as Block;
      })
      .filter((b): b is Block => Boolean(b));
    if (out.length) return out;
  }
  if (Array.isArray(data?.paragraphs)) {
    return data.paragraphs
      .map((x) => String(x ?? "").trim())
      .filter((t) => t.length > 1)
      .map((text) => ({ kind: "p" as const, text }));
  }
  return raw ? blocksFromText(raw) : [];
}

export async function writeTranslationWithLlm(
  meta: DocMeta,
  values: Record<string, unknown>,
  deadline?: number,
): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const source = String(values.sourceText || meta.sourceText || meta.extra || "").trim();
  if (source.length < 8) return null;
  const target = String(values.language || meta.language || "uz");
  const sourceLang = String(values.sourceLang || "avto");
  const chunks = chunkSource(source, 4000);
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(
      `Matn juda uzun: ${chunks.length} bo‘lak (eng ko‘pi ${MAX_CHUNKS}). ` +
        `Kredit qaytariladi — hujjatni bo‘laklarga bo‘lib yuboring.`,
    );
  }

  /**
   * Bo'lak timeouti QOLGAN byudjetdan hisoblanadi.
   *
   * Ilgari har bo'lakka 70 s berilardi. 12 bo'lak 2 tadan ketsa bu
   * 6 to'lqin × 70 s = 420 s, worker esa 285 s beradi — ya'ni uzun
   * tarjima byudjetni oshirib, oxirgi bo'laklari bo'sh qaytardi.
   * Endi to'lqinlar soniga bo'linadi va pool 3 ga ko'tarildi.
   */
  const waves = Math.max(1, Math.ceil(chunks.length / CHUNK_POOL));
  const perChunkMs = Math.max(20_000, Math.min(70_000, Math.floor((remainingMs(deadline) || 210_000) / waves)));

  const parts = await mapPool(chunks, CHUNK_POOL, async (chunk, i) => {
    const raw = await llmComplete(
      translationSystemPrompt(target, sourceLang),
      `Quyidagi matnni ${target} tiliga tarjima qiling. JSON: {"title":"","blocks":[{"kind":"h2|h3|p|li","text":""}]}.\nHar bo‘lak asl matndagi turini SAQLASIN: sarlavha — h2/h3, ro‘yxat bandi — li, oddiy matn — p.\nQism ${i + 1}/${chunks.length}.\n---\n${chunk}`,
      4000,
      { json: true, timeoutMs: perChunkMs },
    );
    const data = parseLlmObject<{ title?: string; blocks?: unknown; paragraphs?: unknown }>(raw);
    return { title: data?.title || "", blocks: translatedBlocks(data, raw) };
  });
  /**
   * Bo'lak yo'qolsa tarjima «tayyor» bo'lmaydi.
   *
   * Ilgari yiqilgan bo'lak shunchaki bo'sh ro'yxat qaytarardi va qolgani
   * birlashtirilib `COMPLETED` bo'lardi: foydalanuvchi to'lagan hujjatning
   * o'rtasidan bir necha sahifa JIM tushib qolardi va buni faqat asl
   * matn bilan solishtirib bilish mumkin edi. Tarjimada to'liqlik —
   * sifatning o'zi emas, mahsulotning shartI: yarim tarjima yaroqsiz.
   *
   * Shuning uchun bu yerda xato TASHLANADI (null emas): `buildArtifact`
   * `null` ni «matn olinmadi» deb boshqacha xabar bilan qaytarardi,
   * bu esa sababni yashirardi. Xato worker orqali kreditni qaytaradi.
   */
  const lost = parts.filter((p) => !p.blocks.length).length;
  if (lost) {
    throw new Error(
      `Tarjima to‘liq chiqmadi: ${chunks.length} bo‘lakdan ${lost} tasi tarjima qilinmadi. ` +
        `Kredit qaytariladi — qayta urinib ko‘ring yoki matnni kichikroq bo‘lib yuboring.`,
    );
  }

  const blocks = parts.flatMap((p) => p.blocks);
  const title = parts.find((p) => p.title)?.title || "";
  if (blocks.length < 1) return null;
  /*
   * Model hujjat sarlavhasini `title` da HAM, birinchi `h2` bo'lagida ham
   * qaytaradi. Bo'lim sarlavhasi `title` dan olingani uchun natijada
   * bir xil matn ketma-ket ikki marta chiqardi.
   */
  const norm = (t: string) => t.toLocaleLowerCase("uz").replace(/[^\p{L}\p{N}]+/gu, "");
  if (title && blocks[0].kind.startsWith("h") && norm(blocks[0].text) === norm(title)) blocks.shift();
  const L = sectionLabels(target);
  return {
    meta: { ...meta, topic: title || meta.topic },
    titlePage: false,
    toc: false,
    sections: [
      /*
       * Ilgari bu uch qator doim o'zbekcha edi ("Manba/Tildan/Hajm"),
       * rus/ingliz tiliga tarjima qilingan hujjatda ham. `L` maqsad
       * tilidan olinadi (`sectionLabels(target)`), shuning uchun endi
       * shu bloklar ham tarjima tiliga mos chiqadi. Kod bilan raqam
       * emas, INSON o'qiydigan til nomi ko'rsatiladi (`langInfo`).
       */
      section("info", L.translation, [
        { kind: "p", text: L.translationSource(String(values.fileName || L.pastedText)) },
        {
          kind: "p",
          // `native` (masalan «русский язык») o'quvchi uchun `name`
          // («Russian» — bu modelga mo'ljallangan inglizcha yorliq)
          // dan tabiiyroq o'qiladi.
          text: L.translationDirection(
            sourceLang === "avto" ? L.autoDetected : langInfo(sourceLang).native,
            langInfo(target).native,
          ),
        },
        { kind: "p", text: L.translationLength(source.length.toLocaleString("uz-UZ")) },
      ]),
      section("body", clip(title || L.translationBody, 80), blocks),
    ],
  };
}
