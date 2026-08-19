import { sectionLabels } from "./i18n";
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
import { blocksFromText, cleanText, isGenericGlossaryTerm, mapPool, remainingMs, section } from "./quality";
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
  const rawMinutes = stages.map((st) => Math.max(1, Math.round(Number(st.minutes) || 0) || 1));
  const rawSum = rawMinutes.reduce((a, b) => a + b, 0);
  const minutes =
    rawSum === d ? rawMinutes : rawMinutes.map((m) => Math.max(1, Math.round((m / rawSum) * d)));
  // Yaxlitlash qoldig'ini eng uzun bosqichga qo'shamiz/ayiramiz.
  // Tsikl chegaralangan: har bosqich kamida 1 daqiqa bo'lgani uchun
  // kamaytirish imkonsiz holat ham bo'lishi mumkin.
  for (let guard = 0; guard < 200; guard++) {
    const diff = d - minutes.reduce((a, b) => a + b, 0);
    if (diff === 0) break;
    const peak = Math.max(...minutes);
    if (diff < 0 && peak <= 1) break;
    minutes[minutes.indexOf(peak)] += diff > 0 ? 1 : -1;
  }
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

function pickTerms(data: unknown): { term: string; def: string }[] {
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
  return out.slice(0, 16);
}

export async function writeGlossaryWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const ask = async (timeoutMs: number) =>
    llmComplete(
      glossarySystemPrompt(meta),
      [
        `JSON: {"intro":"","terms":[{"term":"","def":""}]}.`,
        `«${meta.topic}» bo‘yicha 14 ta sohaga xos atama.`,
        `TAQIQLANADI: kompetensiya, mezon, metod, tahlil, sintez, innovatsiya, refleksiya, differensiatsiya, integratsiya, indikator, resurs — agar bular shu sohaning maxsus termini bo‘lmasa.`,
        `Har izoh 2 aniq gap, shu soha misoli bilan.`,
      ].join("\n"),
      2600,
      { json: true, timeoutMs },
    );
  let raw = await ask(Math.min(55_000, remainingMs(deadline) || 55_000));
  let data = raw ? parseJson(raw) : null;
  let terms = pickTerms(data).filter((t) => !isGenericGlossaryTerm(t.term));
  if (terms.length < 8 && remainingMs(deadline) > 10_000) {
    raw = await ask(Math.min(40_000, remainingMs(deadline)));
    data = raw ? parseJson(raw) : null;
    terms = pickTerms(data).filter((t) => !isGenericGlossaryTerm(t.term));
  }
  if (terms.length < 6) return null;
  const L = sectionLabels(meta.language);
  const intro = data && typeof data === "object" ? (data as { intro?: string }).intro : "";
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

export async function writeKeysWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const raw = await llmComplete(
    keysSystemPrompt(meta),
    `JSON: {"intro":"","cases":[{"title":"","situation":"","tasks":["",""],"key":""}]}. «${meta.topic}» bo‘yicha 5 ta turlicha, aniq ism-vaziyatli keys. Umumiy «resurs cheklangan» shablon yo‘q.`,
    2800,
    { json: true, timeoutMs: Math.min(70_000, remainingMs(deadline) || 70_000) },
  );
  if (!raw) return null;
  const data = parseJson(raw) as {
    intro?: string;
    cases?: { title?: string; situation?: string; tasks?: string[]; key?: string }[];
  } | null;
  const cases = (data?.cases ?? []).slice(0, 5);
  if (cases.length < 3) return null;
  const L = sectionLabels(meta.language);
  return {
    meta,
    titlePage: true,
    toc: true,
    sections: [
      section("kirish", L.intro, [
        { kind: "p", text: clip(data?.intro || L.keysIntroFallback(meta.topic), 400) },
      ]),
      ...cases.map((c, i) =>
        section(`keys${i + 1}`, `${L.caseWord} ${i + 1}. ${clip(c.title || meta.topic, 60)}`, [
          { kind: "p", text: clip(c.situation || "", 420) },
          { kind: "h3", text: L.tasks },
          ...(c.tasks ?? []).slice(0, 4).map((t) => ({ kind: "li" as const, text: clip(t, 180) })),
          { kind: "h3", text: L.answerKey },
          { kind: "p", text: clip(c.key || "", 360) },
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
    resumeSystemPrompt(meta),
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
  const inputYears = new Set(inputFacts.match(/\b(19|20)\d{2}\b/g) ?? []);

  /** Tashkilot/joy nomi kiritilgan matndan olinganmi. */
  function orgIsKnown(head: string): boolean {
    if (!inputFacts.trim()) return true;
    const tokens = head
      .toLowerCase()
      .replace(/\b(?:19|20)\d{2}\b/g, " ")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 4);
    if (!tokens.length) return true;
    return tokens.some((t) => inputFacts.includes(t));
  }

  /**
   * Kiritilmagan yilni olib tashlaydi.
   *
   * Model ko'pincha mantiqiy, lekin O'YLAB TOPILGAN sana qo'shadi:
   * bakalavr 2021-yilda tugagan bo'lsa, u «2017–2021» deb yozadi.
   * Taxmin to'g'ri bo'lishi mumkin, lekin rezyume — da'vo hujjati:
   * u yerda faqat foydalanuvchi bergan sana turishi kerak.
   *
   * Oraliqda bitta yil notanish bo'lsa butun oraliq olib tashlanadi —
   * yarim oraliq («–2021») ma'nosiz.
   */
  function stripUnknownYears(text: string): string {
    if (!inputYears.size) return text;
    return text
      .replace(/\b(?:19|20)\d{2}\s*[–—-]\s*(?:19|20)\d{2}\b/g, (range) =>
        (range.match(/\b(?:19|20)\d{2}\b/g) ?? []).every((y) => inputYears.has(y)) ? range : "",
      )
      .replace(/\b(?:19|20)\d{2}\b/g, (y) => (inputYears.has(y) ? y : ""))
      .replace(/\s*·\s*(?=·|$)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s·,;—–-]+|[\s·,;—–-]+$/g, "")
      .trim();
  }

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
  const table: DocTable = {
    caption: L.yearPlan,
    headers: [...L.yearCols],
    rows: filled.map((row, i) => [
      String(i + 1),
      String(weekly),
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

  const plan = [
    {
      id: "intro",
      title: L.imradIntro,
      brief: `Tadqiqot savoli, nima ma’lum, bo‘shliq, maqsad. Faqat «${topic}». Kamida 3 paragraf.`,
    },
    {
      id: "methods",
      title: L.imradMethods,
      brief: `Adabiyot tahlili, qiyoslash, tanlov mezoni, cheklov. Uydirma so‘rovnoma yo‘q. Kamida 2 paragraf.`,
    },
    {
      id: "results",
      title: L.imradResults,
      brief: `Asosiy tahliliy topilmalar: omillar, yondashuvlar, farqlar. Uydirma foiz yo‘q. Kamida 3 paragraf.`,
    },
    {
      id: "discussion",
      title: L.imradDiscussion,
      brief: `Topilmalarning ahamiyati, cheklov, amaliy xulosa. Shior emas. Kamida 3 paragraf.`,
    },
  ];

  const written = await mapPool(plan, 3, async (item) => {
    const text = await llmComplete(
      sys,
      `Bo‘lim: ${item.title}\nMavzu: ${topic}\n${item.brief}\nSarlavhani qayta yozmang.`,
      2200,
      { timeoutMs: Math.min(40_000, remainingMs(deadline) || 40_000) },
    );
    return { item, blocks: text ? blocksFromText(text) : [] };
  });

  const sections: DocSection[] = [];
  for (const { item, blocks } of written) {
    if (blocks.length < 1) return null;
    sections.push(section(item.id, item.title, blocks));
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
  };
}

function chunkSource(text: string, max = 3200) {
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
  return chunks.slice(0, 12);
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
  const parts = await mapPool(chunks, 2, async (chunk, i) => {
    const raw = await llmComplete(
      translationSystemPrompt(target, sourceLang),
      `Quyidagi matnni ${target} tiliga tarjima qiling. JSON: {"title":"","paragraphs":[""]}.\nQism ${i + 1}/${chunks.length}.\n---\n${chunk}`,
      4000,
      { json: true, timeoutMs: Math.min(70_000, remainingMs(deadline) || 70_000) },
    );
    const data = parseLlmObject<{ title?: string; paragraphs?: unknown }>(raw);
    const paras = Array.isArray(data?.paragraphs)
      ? data!.paragraphs.map((x) => String(x ?? "").trim()).filter((s) => s.length > 1)
      : raw
        ? blocksFromText(raw).map((b) => b.text)
        : [];
    return { title: data?.title || "", paras };
  });
  const paras = parts.flatMap((p) => p.paras);
  const title = parts.find((p) => p.title)?.title || "";
  if (paras.length < 1) return null;
  const L = sectionLabels(target);
  return {
    meta: { ...meta, topic: title || meta.topic },
    titlePage: false,
    toc: false,
    sections: [
      section("info", L.translation, [
        { kind: "p", text: `Manba: ${String(values.fileName || "matn")}` },
        { kind: "p", text: `Tildan: ${sourceLang === "avto" ? "avtomatik" : sourceLang} → ${target}` },
        { kind: "p", text: `Hajm: ${source.length.toLocaleString("uz-UZ")} belgi` },
      ]),
      section(
        "body",
        clip(title || L.translationBody, 80),
        paras.map((t) => ({ kind: "p" as const, text: t })),
      ),
    ],
  };
}
