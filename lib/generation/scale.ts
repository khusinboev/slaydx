import type { AcademicDoc, Block, DocSection } from "./types";

const WORDS_PER_PAGE = 280;

function wordCount(doc: AcademicDoc): number {
  let n = 0;
  const add = (s: string) => {
    n += s.trim().split(/\s+/).filter(Boolean).length;
  };
  for (const s of doc.sections) {
    add(s.title);
    for (const b of s.blocks) add(b.text);
  }
  for (const r of doc.references ?? []) add(r);
  return n;
}

function p(text: string): Block {
  return { kind: "p", text };
}

type Angle = { heading: string; write: (topic: string) => string[] };

const ANGLES: Angle[] = [
  {
    heading: "Mohiyat va chegaralar",
    write: (topic) => [
      `«${topic}» ni aniq ta’riflash — tahlilning birinchi sharti. Chegara ochiq bo‘lmasa, xulosa ham yuzaki qoladi.`,
      `Tushunchani kengaytirish yoki toraytirish natijani o‘zgartiradi: shuning uchun asosiy belgilarni avval belgilash kerak.`,
    ],
  },
  {
    heading: "Tarkibiy unsurlari",
    write: (topic) => [
      `${topic} alohida faktlar yig‘indisi emas, balki o‘zaro bog‘liq unsurlardan iborat.`,
      `Har bir unsur o‘z vazifasini bajaradi; birining zaifligi butun holatga ta’sir qiladi.`,
    ],
  },
  {
    heading: "Omillar va sharoit",
    write: (topic) => [
      `${topic} ga ichki va tashqi omillar ta’sir qiladi. Sharoit e’tiborga olinmasa, tavsiya amalda ishlamaydi.`,
      `Omillarni ajratib ko‘rish tahlilni tartibga soladi va ustuvorlikni ko‘rsatadi.`,
    ],
  },
  {
    heading: "Amaliy qo‘llanish",
    write: (topic) => [
      `${topic} ni amaliyotda ko‘rish nazariyani tekshiradi: qayerda ishlaydi, qayerda cheklanadi.`,
      `Misollar mavzu kontekstidan olinishi kerak, umumiy shiorlardan emas.`,
    ],
  },
  {
    heading: "Xulosa sari chuqurlashtirish",
    write: (topic) => [
      `${topic} bo‘yicha barqaror yondashuv: ta’rif — tahlil — amaliy qadam — nazorat.`,
      `Keyingi ish aniq mezon va mahalliy sharoitga bog‘langan bo‘lishi lozim.`,
    ],
  },
];

export function scaleDoc(doc: AcademicDoc): AcademicDoc {
  const target = Math.max(1, doc.meta.targetPages);
  if (wordCount(doc) >= target * WORDS_PER_PAGE * 0.85) return doc;

  const topic = doc.meta.topic;
  const extra: DocSection[] = [];
  for (let i = 0; i < ANGLES.length; i++) {
    if (wordCount({ ...doc, sections: [...doc.sections, ...extra] }) >= target * WORDS_PER_PAGE * 0.9) break;
    const angle = ANGLES[i];
    extra.push({
      id: `scale-${i}`,
      title: `${i + 1}. ${angle.heading}`,
      blocks: [{ kind: "h2", text: angle.heading }, ...angle.write(topic).map(p)],
    });
  }

  const insertAt = Math.max(1, doc.sections.length - 1);
  return {
    ...doc,
    sections: [...doc.sections.slice(0, insertAt), ...extra, ...doc.sections.slice(insertAt)],
  };
}

export function describeLength(doc: AcademicDoc) {
  const words = wordCount(doc);
  return { words, approxPages: Math.max(1, Math.round(words / WORDS_PER_PAGE)) };
}
