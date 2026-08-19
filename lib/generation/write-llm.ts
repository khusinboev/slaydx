import { sectionLabels } from "./i18n";
import { parseLlmObject } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { writerSystemPrompt, essaySystemPrompt } from "./prompts";
import {
  blocksFromText,
  isGenericFiller,
  mapPool,
  parseManualToc,
  remainingMs,
  section,
  splitCodeBlocks,
  targetWords,
  wordCount,
} from "./quality";
import {
  writeGlossaryWithLlm,
  writeImradWithLlm,
  writeKeysWithLlm,
  writeLessonWithLlm,
  writeMapWithLlm,
  writeResumeWithLlm,
  writeTranslationWithLlm,
} from "./write-specials";
import type { AcademicDoc, Block, DocMeta, DocSection } from "./types";

function wantsCodeSample(meta: DocMeta) {
  const t = `${meta.topic} ${meta.subject} ${meta.extra}`.toLowerCase();
  return /ai|dastur|python|kod|algoritm|informatika|sun.?iy|javascript|machine|machine learning|\bit\b|web dastur|sql|c\+\+|java\b/.test(
    t,
  );
}

function isReferenceLine(r: string): boolean {
  if (r.length < 24 || r.length > 280) return false;
  if (/^(ushbu|tadqiqot|maqola|izoh|manba|quyida|mana|these|the following|ниже|данн)/i.test(r)) return false;
  const sentences = (r.match(/[.!?]\s+[A-ZА-ЯЁO‘]/g) ?? []).length;
  if (sentences > 3) return false;
  const hasYear = /\b(1[89]\d{2}|20\d{2})\b/.test(r);
  const hasPublisher =
    /[–—]\s*[^,]+[:,]/.test(r) || /\b(nashriyot|publishing|press|изд|қўлланма|qo‘llanma|darslik)/i.test(r);
  return hasYear || hasPublisher;
}

async function writeSection(
  sys: string,
  title: string,
  brief: string,
  meta: DocMeta,
  minParas: number,
  timeoutMs: number,
): Promise<Block[]> {
  if (timeoutMs < 4_000) return [];
  const user = [
    `Bo‘lim sarlavhasi (matnga qayta yozilmasin): ${title}`,
    `Mavzu: ${meta.topic}`,
    `Fan: ${meta.subject || "mavzuga mos fan"}`,
    `Nima yozish: ${brief}`,
    `Kamida ${minParas} ta to‘la paragraf (har biri 80–130 so‘z). Faqat shu bo‘lim.`,
    `Mavzuga xos atama, mexanizm yoki misol yozing. Umumiy shior va boshqa soha aralashmasin.`,
  ].join("\n");
  const text = await llmComplete(sys, user, Math.min(7000, 900 + minParas * 420), { timeoutMs });
  if (!text) {
    console.warn("[write-llm] empty response for", title);
    return [];
  }
  const mixed = splitCodeBlocks(text);
  if (mixed.some((b) => b.kind === "code") && mixed.some((b) => b.kind === "p")) return mixed;
  const blocks = blocksFromText(text.replace(/```[\s\S]*?```/g, "\n"));
  if (blocks.length) return blocks;
  console.warn("[write-llm] parse failed for", title, "len", text.length);
  return [];
}

type OutlineChapter = { title: string; subs: { title: string; brief: string }[] };

async function buildOutline(meta: DocMeta, sys: string, L: ReturnType<typeof sectionLabels>, deadline?: number) {
  const pages = Math.max(4, meta.targetPages || 8);
  const long = pages >= 18;
  const chapterN = long ? 3 : 2;
  const manual = meta.tocMethod === "manual" ? parseManualToc(meta.tocText || meta.extra) : [];

  if (manual.length) {
    const chapters: OutlineChapter[] = manual.map((title, i) => ({
      title,
      subs: [
        { title: `${i + 1}.1`, brief: `«${meta.topic}»: ${title} ning mohiyati.` },
        { title: `${i + 1}.2`, brief: `«${meta.topic}»: ${title} bo‘yicha tahlil va misol.` },
      ],
    }));
    return { chapters };
  }

  const raw = await llmComplete(
    sys,
    [
      `«${meta.topic}» uchun ${chapterN} bobli reja. JSON:`,
      `{"chapters":[{"title":"","subs":[{"title":"1.1 ...","brief":"2 gap"}]}]}`,
      `Har bobda 2–3 ostmavzu. Sarlavha mavzuga xos (umumiy «Nazariy asoslar» emas).`,
      `brief — shu ostmavzuda nima yozilishini 1–2 gapda.`,
      meta.extra ? `Qo‘shimcha: ${meta.extra}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    1200,
    { json: true, timeoutMs: Math.min(40_000, remainingMs(deadline)) },
  );
  const data = parseLlmObject<{ chapters?: OutlineChapter[] }>(raw);
  const chapters = (data?.chapters ?? [])
    .map((c, i) => {
      const title = String(c?.title || "").trim();
      const subs = Array.isArray(c?.subs)
        ? c.subs
            .map((s) => ({
              title: String(s?.title || "").trim(),
              brief: String(s?.brief || "").trim(),
            }))
            .filter((s) => s.title)
            .slice(0, 3)
        : [];
      if (!title || !subs.length) return null;
      return {
        title: title.length > 8 ? title : i === 0 ? L.chapterTheory(meta.topic) : L.chapterPractice,
        subs,
      };
    })
    .filter((x): x is OutlineChapter => Boolean(x))
    .slice(0, chapterN);

  if (chapters.length >= 2) return { chapters };

  return {
    chapters: long
      ? [
          {
            title: L.chapterTheory(meta.topic),
            subs: [
              { title: L.sub11, brief: `«${meta.topic}» tushunchasi, tasnifi.` },
              { title: L.sub12, brief: `Asosiy unsurlar va jarayon.` },
            ],
          },
          {
            title: L.chapterAnalysis,
            subs: [
              { title: L.sub21, brief: `Qanday ishlaydi / kechadi.` },
              { title: "2.2", brief: `Omillar va bog‘liqlik.` },
            ],
          },
          {
            title: L.chapterProblems,
            subs: [
              { title: "3.1", brief: `Muammo va sabab.` },
              { title: "3.2", brief: `Yechim va tavsiya.` },
            ],
          },
        ]
      : [
          {
            title: L.chapterTheory(meta.topic),
            subs: [
              { title: L.sub11, brief: `«${meta.topic}» tushunchasi, tasnifi.` },
              { title: L.sub12, brief: `Asosiy unsurlar va jarayon.` },
            ],
          },
          {
            title: L.chapterPractice,
            subs: [
              { title: L.sub21, brief: `Amaliy tomon, muammo.` },
              { title: L.sub22, brief: `Yechim va tavsiya.` },
            ],
          },
        ],
  };
}

export async function writeWriterWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const sys = writerSystemPrompt(meta);
  const L = sectionLabels(meta.language);
  const topic = meta.topic;
  const pages = Math.max(4, meta.targetPages || 8);
  const want = targetWords(pages);
  const perChapterParas = Math.min(10, Math.max(4, Math.round(want / 450)));

  const { chapters } = await buildOutline(meta, sys, L, deadline);

  type Job = { id: string; title: string; brief: string; min: number; split?: boolean };
  const jobs: Job[] = [
    {
      id: "kirish",
      title: L.intro,
      brief: `Faqat «${topic}» haqida: dolzarblik, maqsad, 3–4 vazifa, obyekt/predmet, usul.`,
      min: Math.max(3, Math.round(pages / 4)),
    },
    ...chapters.map((ch, i) => ({
      id: `bob${i + 1}`,
      title: ch.title,
      brief: ch.subs.map((s) => `${s.title}: ${s.brief}`).join("\n"),
      min: perChapterParas,
      split: true,
      subs: ch.subs,
    })),
    {
      id: "xulosa",
      title: L.conclusion,
      brief: `3–5 ta aniq xulosa va amaliy tavsiya. Takror shior bo‘lmasin.`,
      min: 3,
    },
  ];

  const written = await mapPool(jobs, 3, async (item) => {
    const left = remainingMs(deadline);
    if (left < 5_000) return { item, blocks: [] as Block[] };
    let blocks = await writeSection(sys, item.title, item.brief, meta, item.min, Math.min(45_000, left));
    if (!blocks.length && remainingMs(deadline) > 8_000) {
      blocks = await writeSection(
        sys,
        item.title,
        item.brief,
        meta,
        Math.max(2, item.min - 2),
        Math.min(35_000, remainingMs(deadline)),
      );
    }
    if (item.split && "subs" in item && Array.isArray((item as Job & { subs: OutlineChapter["subs"] }).subs)) {
      const subs = (item as Job & { subs: OutlineChapter["subs"] }).subs;
      const mid = Math.ceil(blocks.length / Math.max(1, subs.length));
      const withHeads: Block[] = [];
      subs.forEach((sub, i) => {
        withHeads.push({ kind: "h2", text: sub.title });
        withHeads.push(...blocks.slice(i * mid, i === subs.length - 1 ? undefined : (i + 1) * mid));
      });
      if (withHeads.some((b) => b.kind === "p")) blocks = withHeads;
    }
    return { item, blocks };
  });

  const sections: DocSection[] = [];
  for (const { item, blocks } of written) {
    if (!blocks.length) {
      console.warn("[write-llm] empty section", item.id);
      continue;
    }
    sections.push(section(item.id, item.title, blocks));
  }
  if (sections.length < 3) {
    console.warn("[write-llm] too few sections", sections.length);
    return sections.length ? { meta, titlePage: true, toc: true, sections } : null;
  }

  if (wantsCodeSample(meta) && remainingMs(deadline) > 12_000 && !sections.some((s) => s.blocks.some((b) => b.kind === "code"))) {
    const sample = await llmComplete(
      sys,
      `«${topic}» uchun BITTA qisqa, ishlaydigan kod namunasi. JSON: {"caption":"","lang":"python","code":""}. 8–20 qator. Iris/sklearn takrorlamang.`,
      800,
      { json: true, timeoutMs: Math.min(30_000, remainingMs(deadline)) },
    );
    const data = parseLlmObject<{ caption?: string; lang?: string; code?: string }>(sample);
    const code = (data?.code || "").trim();
    if (code.length > 20 && code.length < 1800) {
      const target = sections.find((s) => s.id === "bob2") ?? sections.find((s) => s.id.startsWith("bob"));
      target?.blocks.push(
        { kind: "h3", text: L.codeSample },
        { kind: "code", text: code, caption: data?.caption, lang: data?.lang },
      );
    }
  }

  if (meta.includeVisuals && remainingMs(deadline) > 12_000) {
    const tableRaw = await llmComplete(
      sys,
      `«${topic}» bo‘yicha 1 ta qisqa jadval. JSON: {"caption":"","headers":["",""],"rows":[["",""]]}. 3–5 qator. Uydirma foiz/DOI yo‘q. Atama yoki bosqich taqqoslash.`,
      700,
      { json: true, timeoutMs: Math.min(25_000, remainingMs(deadline)) },
    );
    const tb = parseLlmObject<{ caption?: string; headers?: string[]; rows?: string[][] }>(tableRaw);
    if (tb?.headers?.length && tb.rows?.length) {
      const docTables = [
        {
          caption: String(tb.caption || topic).slice(0, 80),
          headers: tb.headers.map((h) => String(h).slice(0, 40)).slice(0, 5),
          rows: tb.rows.slice(0, 6).map((r) => r.map((c) => String(c).slice(0, 80))),
        },
      ];
      (meta as DocMeta & { _tables?: typeof docTables })._tables = docTables;
    }
  }

  const refRaw =
    remainingMs(deadline) > 8_000
      ? await llmComplete(
          sys,
          `«${topic}» bo‘yicha 6–8 ta USLUBIY adabiyot qatori. Format: Muallif. Nom. – Shahar: Nashriyot, yil.\nSoxta DOI/jurnal/GOST YO‘Q. Umumiy darslik/qo‘llanma, faqat shu mavzu sohasida.`,
          700,
          { timeoutMs: Math.min(25_000, remainingMs(deadline)) },
        )
      : null;
  const references = (refRaw ? blocksFromText(refRaw).map((b) => b.text) : [])
    .map((r) => r.replace(/\*\*/g, "").replace(/^[_*]+|[_*]+$/g, "").trim())
    .filter(isReferenceLine)
    .slice(0, 10);

  const tables = (meta as DocMeta & { _tables?: AcademicDoc["tables"] })._tables;

  const doc: AcademicDoc = {
    meta,
    titlePage: true,
    toc: true,
    sections,
    tables,
    references:
      references.length >= 4
        ? references
        : [
            `${topic}. O‘quv qo‘llanma. – Toshkent: O‘qituvchi, 2020.`,
            `Soha bo‘yicha ma’ruza matnlari. – Toshkent, 2019.`,
            `O‘zbekiston Respublikasi Oliy ta’lim, fan va innovatsiyalar vazirligi. O‘quv-uslubiy ko‘rsatmalar. – Toshkent, 2022.`,
            `Umumiy nazariy asoslar. O‘quv-uslubiy qo‘llanma. – ${meta.city || "Toshkent"}, 2018.`,
          ],
  };

  if (wordCount(doc) < want * 0.55 && remainingMs(deadline) > 20_000) {
    const extra = await writeSection(
      sys,
      `${topic}: chuqurlashtirish`,
      `«${topic}» bo‘yicha qo‘shimcha tahlil: aniq misol, cheklov, amaliy qadam. Oldingi bobni takrorlamang.`,
      meta,
      4,
      Math.min(40_000, remainingMs(deadline)),
    );
    if (extra.length) {
      const insertAt = Math.max(1, sections.length - 1);
      sections.splice(insertAt, 0, section("extra", `${topic}: chuqurlashtirish`, extra));
    }
  }

  return doc;
}

export async function writeEssayWithLlm(meta: DocMeta, deadline?: number): Promise<AcademicDoc | null> {
  if (!llmEnabled()) return null;
  const sys = essaySystemPrompt(meta);
  const L = sectionLabels(meta.language);
  const n = Math.min(5, Math.max(1, meta.targetPages));
  const minParas = n <= 1 ? 4 : n <= 2 ? 7 : n * 3;
  const raw = await llmComplete(
    sys,
    [
      `Mavzu: «${meta.topic}». ${n} varaqli insho.`,
      `JSON: {"intro":["paragraf"],"sections":[{"title":"I. ...","paras":["",""]}],"conclusion":["",""]}`,
      `intro 2 paragraf. sections ${n <= 2 ? 2 : 3} ta, har birida 2–3 to‘la paragraf.`,
      `Jami kamida ${minParas} paragraf. Har paragraf 70–110 so‘z.`,
      `Jonli mushohada, aniq misol. Shior va takror yo‘q.`,
    ].join("\n"),
    3600,
    { json: true, timeoutMs: Math.min(70_000, remainingMs(deadline) || 70_000) },
  );
  const data = parseLlmObject<{
    intro?: unknown;
    sections?: { title?: string; paras?: unknown }[];
    conclusion?: unknown;
  }>(raw);

  const asParas = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter((s) => s.length > 40);
    if (typeof v === "string") return blocksFromText(v).map((b) => b.text);
    return [];
  };

  const intro = asParas(data?.intro);
  const bodySecs = (data?.sections ?? [])
    .map((s, i) => ({
      title: String(s?.title || `${L.main} ${i + 1}`).slice(0, 80),
      paras: asParas(s?.paras),
    }))
    .filter((s) => s.paras.length);
  const conclusion = asParas(data?.conclusion);

  if (intro.length + bodySecs.reduce((n, s) => n + s.paras.length, 0) + conclusion.length >= 4) {
    return {
      meta,
      titlePage: true,
      toc: false,
      sections: [
        section("kirish", L.intro, intro.map((t) => ({ kind: "p", text: t }))),
        ...bodySecs.map((s, i) => section(`asosiy${i + 1}`, s.title, s.paras.map((t) => ({ kind: "p", text: t })))),
        section("xulosa", L.conclusion, conclusion.map((t) => ({ kind: "p", text: t }))),
      ],
    };
  }

  const text = await llmComplete(
    sys,
    `Mavzu: «${meta.topic}». ${n} varaqli insho: kirish, 2–3 asosiy band, xulosa. Har band 2–3 to‘la paragraf. Ajratish: KIRISH *** ASOSIY *** XULOSA`,
    3200,
    { timeoutMs: Math.min(50_000, remainingMs(deadline) || 50_000) },
  );
  if (!text) return null;
  const paras = blocksFromText(text).map((b) => b.text).filter((t) => !isGenericFiller(t));
  if (paras.length < 4) return null;
  const third = Math.max(1, Math.floor(paras.length / 3));
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      section("kirish", L.intro, paras.slice(0, third).map((t) => ({ kind: "p", text: t }))),
      section("asosiy", L.main, paras.slice(third, -Math.max(1, third - 1)).map((t) => ({ kind: "p", text: t }))),
      section("xulosa", L.conclusion, paras.slice(-Math.max(1, third - 1)).map((t) => ({ kind: "p", text: t }))),
    ],
  };
}

const WRITER = new Set(["referat", "coursework", "mustaqil-ish", "article", "thesis"]);

export async function writeWithLlm(
  meta: DocMeta,
  values: Record<string, unknown> = {},
  deadline?: number,
): Promise<AcademicDoc | null> {
  if (meta.toolId === "essay") return writeEssayWithLlm(meta, deadline);
  if ((meta.toolId === "article" || meta.toolId === "thesis") && meta.kind === "imrad") {
    return writeImradWithLlm(meta, deadline);
  }
  if (WRITER.has(meta.toolId)) return writeWriterWithLlm(meta, deadline);
  if (meta.toolId === "translation") return writeTranslationWithLlm(meta, values, deadline);
  if (meta.toolId === "lesson-plan") return writeLessonWithLlm(meta, deadline);
  if (meta.toolId === "glossary") return writeGlossaryWithLlm(meta, deadline);
  if (meta.toolId === "keys") return writeKeysWithLlm(meta, deadline);
  if (meta.toolId === "texnologik-xarita") return writeMapWithLlm(meta, deadline);
  if (meta.toolId === "resume") return writeResumeWithLlm(meta, values, deadline);
  return null;
}
