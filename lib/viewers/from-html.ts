import type { AcademicDoc, Block, DocSection } from "@/lib/generation/types";
import type { Generation } from "@/lib/types";

export function academicDocFromHtml(html: string, gen: Generation): AcademicDoc {
  if (gen.doc) return gen.doc;
  if (typeof DOMParser === "undefined" || !html) return emptyDoc(gen);

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const sections: DocSection[] = [];
  const cover = parsed.querySelector("section.cover");
  const nodes = Array.from(parsed.body.children);

  for (const el of nodes) {
    if (el === cover) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "section") {
      const heading = el.querySelector("h1,h2,h3");
      const title = (heading?.textContent || "Bo‘lim").trim();
      const blocks: Block[] = [];
      for (const child of Array.from(el.children)) {
        if (child === heading) continue;
        const t = child.tagName.toLowerCase();
        const text = (child.textContent || "").trim();
        if (!text) continue;
        if (t === "ul" || t === "ol") {
          for (const li of Array.from(child.querySelectorAll("li"))) {
            const lt = (li.textContent || "").trim();
            if (lt) blocks.push({ kind: "li", text: lt });
          }
        } else if (t === "blockquote") blocks.push({ kind: "quote", text });
        else if (t === "h3" || t === "h4") blocks.push({ kind: "h3", text });
        else if (t === "table") continue;
        else blocks.push({ kind: "p", text });
      }
      sections.push({ id: `s${sections.length}`, title, blocks });
    }
  }

  return {
    meta: {
      toolId: gen.type,
      workLabel: gen.type,
      topic: gen.topic,
      language: String(gen.values.language || "uz"),
      extra: "",
      sourceText: "",
      author: String(gen.values.author || ""),
      university: String(gen.values.university || ""),
      faculty: String(gen.values.faculty || ""),
      department: String(gen.values.department || ""),
      subject: String(gen.values.subject || ""),
      teacher: String(gen.values.teacher || ""),
      city: String(gen.values.city || "Toshkent"),
      group: String(gen.values.group || ""),
      course: String(gen.values.course || ""),
      ministry: gen.values.ministry === "maktab" ? "maktab" : "oliy",
      kind: String(gen.values.kind || "standard"),
      pagesLabel: "",
      targetPages: 8,
      annotationLangs: "same",
      email: String(gen.values.email || ""),
      organization: String(gen.values.organization || ""),
      degree: String(gen.values.degree || ""),
      weeklyHours: Number(gen.values.weeklyHours || 0),
      totalHours: Number(gen.values.totalHours || 0),
      termCount: Number(gen.values.termCount || 0),
      grade: Number(gen.values.grade || 0),
      duration: Number(gen.values.duration || 0),
      fileNameHint: gen.topic,
      tocMethod: "ai",
      tocText: "",
      includeVisuals: true,
      titleSlide: true,
      premiumVisuals: false,
      design: String(gen.values.design || "iris"),
    },
    titlePage: Boolean(cover) || gen.type !== "resume",
    toc: sections.length > 2,
    sections: sections.length ? sections : [{ id: "body", title: gen.topic, blocks: [{ kind: "p", text: parsed.body.textContent || "" }] }],
  };
}

function emptyDoc(gen: Generation): AcademicDoc {
  return {
    meta: {
      toolId: gen.type,
      workLabel: gen.type,
      topic: gen.topic,
      language: "uz",
      extra: "",
      sourceText: "",
      author: "",
      university: "",
      faculty: "",
      department: "",
      subject: "",
      teacher: "",
      city: "Toshkent",
      group: "",
      course: "",
      ministry: "oliy",
      kind: "standard",
      pagesLabel: "",
      targetPages: 1,
      annotationLangs: "same",
      email: "",
      organization: "",
      degree: "",
      weeklyHours: 0,
      totalHours: 0,
      termCount: 0,
      grade: 0,
      duration: 0,
      fileNameHint: gen.topic,
      tocMethod: "ai",
      tocText: "",
      includeVisuals: true,
      titleSlide: true,
      premiumVisuals: false,
      design: "iris",
    },
    titlePage: false,
    toc: false,
    sections: [{ id: "body", title: gen.topic, blocks: [{ kind: "p", text: "Hujjat matni topilmadi." }] }],
  };
}
