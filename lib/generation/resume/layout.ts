/**
 * Rezyume maketi — YAGONA MANBA («ko'rdim = oldim»).
 *
 * `planResume(model)` shablon + palitra + modelni zonalarga (header / aside /
 * main) va itemlarga yoyadi. DOCX renderer (`resume/render-docx.ts`) va
 * ko'ruvchi (`ResumePage.tsx`) faqat shu natijani chizadi — ikkalasida ham
 * "qaysi bo'lim qayerda, qanday tartibda" degan mantiq YO'Q.
 *
 * Har tahrirlanuvchi itemda `path` — model ichidagi manzil
 * (`RESUME_PATH_RE`), tahrir oplari (`edit.ts`) shu bo'yicha ishlaydi.
 */
import { formatPeriod, paletteOf, type ResumeModel, type ResumeSectionId } from "./model";
import { RESUME_TEMPLATES, type ResumePalette, type ResumeTemplate } from "./templates";

export type ResumePath = string;

export const RESUME_PATH_RE =
  /^(identity\.(fullName|headline)|contact\.(phone|email|location)|summary|experience\.\d{1,2}\.(company|role|start|end)|experience\.\d{1,2}\.bullets\.\d{1,2}\.text|education\.\d{1,2}\.(institution|degree|start|end)|certificates\.\d{1,2}\.(name|issuer|year)|languages\.\d{1,2}\.(language|level)|links\.\d{1,2}\.url|skills)$/;

export type ContactIcon = "phone" | "mail" | "pin" | "link";
export type ResumeContactLine = { icon: ContactIcon; text: string; href?: string; path: ResumePath };

export type ResumeItem =
  | { k: "name"; text: string; path: "identity.fullName" }
  | { k: "headline"; text: string; path: "identity.headline" }
  | { k: "photo"; url: string; shape: "circle" | "square"; sizeMm: number }
  | { k: "h2"; text: string; section: ResumeSectionId }
  | { k: "p"; text: string; path: ResumePath }
  | {
      k: "row";
      section: "experience" | "education" | "certificates";
      index: number;
      title: string;
      sub: string;
      period: string;
      /** `experience.2` — qator ildizi; maydonlar `${path}.role` va h.k. */
      path: ResumePath;
      titlePath: ResumePath;
      subPath: ResumePath;
    }
  | { k: "li"; text: string; ai: boolean; path: ResumePath }
  | { k: "kv"; key: string; val: string; path: ResumePath }
  | { k: "chips"; items: { text: string; ai: boolean }[]; path: "skills" }
  | { k: "contact"; lines: ResumeContactLine[] };

export type ResumeZoneId = "header" | "aside" | "main";
export type ResumeZone = { id: ResumeZoneId; items: ResumeItem[] };

export type ResumeLayout = {
  template: ResumeTemplate;
  palette: ResumePalette;
  zones: ResumeZone[];
  pageMm: { w: 210; h: 297 };
  /** Chegaralar ichidagi kenglik (mm). */
  contentWidthMm: number;
  /** Asosiy ustun kengligi (mm) — sidebar shablonlarda panel ayirilgan. */
  mainWidthMm: number;
  /** Panel kengligi (mm), 0 — panel yo'q. */
  asideWidthMm: number;
  /** Surat ko'rsatiladimi (modelda bor va shablon ruxsat beradi). */
  photo: boolean;
};

const PAGE_W = 210;

export function zoneOf(layout: ResumeLayout, id: ResumeZoneId): ResumeItem[] {
  return layout.zones.find((z) => z.id === id)?.items ?? [];
}

function contactLines(m: ResumeModel): ResumeContactLine[] {
  const lines: ResumeContactLine[] = [];
  if (m.contact.phone) lines.push({ icon: "phone", text: m.contact.phone, href: `tel:${m.contact.phone.replace(/\s+/g, "")}`, path: "contact.phone" });
  if (m.contact.email) lines.push({ icon: "mail", text: m.contact.email, href: `mailto:${m.contact.email}`, path: "contact.email" });
  if (m.contact.location) lines.push({ icon: "pin", text: m.contact.location, path: "contact.location" });
  return lines;
}

function linkLines(m: ResumeModel): ResumeContactLine[] {
  return m.links.map((l, i) => ({ icon: "link" as const, text: l.url.replace(/^https?:\/\//, ""), href: l.url, path: `links.${i}.url` }));
}

/** Bo'lim itemlari (h2 siz). Bo'sh bo'lim → []. */
function sectionItems(m: ResumeModel, id: ResumeSectionId): ResumeItem[] {
  const L = m.labels;
  const out: ResumeItem[] = [];
  switch (id) {
    case "summary":
      if (m.summary) out.push({ k: "p", text: m.summary, path: "summary" });
      break;
    case "experience":
      m.experience.forEach((e, i) => {
        out.push({
          k: "row",
          section: "experience",
          index: i,
          title: e.role,
          sub: e.company,
          period: formatPeriod(e.start, e.end, L, m.language),
          path: `experience.${i}`,
          titlePath: `experience.${i}.role`,
          subPath: `experience.${i}.company`,
        });
        e.bullets.forEach((b, j) => out.push({ k: "li", text: b.text, ai: b.ai === true, path: `experience.${i}.bullets.${j}.text` }));
      });
      break;
    case "education":
      m.education.forEach((e, i) => {
        out.push({
          k: "row",
          section: "education",
          index: i,
          title: e.degree,
          sub: e.institution,
          period: formatPeriod(e.start, e.end, L, m.language),
          path: `education.${i}`,
          titlePath: `education.${i}.degree`,
          subPath: `education.${i}.institution`,
        });
      });
      break;
    case "certificates":
      m.certificates.forEach((c, i) => {
        out.push({
          k: "row",
          section: "certificates",
          index: i,
          title: c.name,
          sub: c.issuer,
          period: c.year,
          path: `certificates.${i}`,
          titlePath: `certificates.${i}.name`,
          subPath: `certificates.${i}.issuer`,
        });
      });
      break;
    case "languages":
      m.languages.forEach((l, i) => out.push({ k: "kv", key: l.language, val: l.level, path: `languages.${i}.language` }));
      break;
    case "skills":
      if (m.skills.length) out.push({ k: "chips", items: m.skills.map((k) => ({ text: k.text, ai: k.ai === true })), path: "skills" });
      break;
    case "links": {
      const lines = linkLines(m);
      if (lines.length) out.push({ k: "contact", lines });
      break;
    }
  }
  return out;
}

function withHeading(m: ResumeModel, id: ResumeSectionId): ResumeItem[] {
  const items = sectionItems(m, id);
  return items.length ? [{ k: "h2", text: m.labels[id], section: id }, ...items] : [];
}

/**
 * Maket rejasi. Tartib:
 *  - header: (surat) ism, lavozim, kontakt — bir ustunli va banner shablonlarda;
 *  - aside: surat, ism, lavozim, kontakt (+ `asideSections`) — sidebar shablonlarda;
 *  - main: `order` bo'yicha qolgan bo'limlar.
 */
export function planResume(m: ResumeModel): ResumeLayout {
  const template = RESUME_TEMPLATES[m.template] ?? RESUME_TEMPLATES.modern;
  const palette = paletteOf(m);
  const photo = Boolean(m.photo?.url);
  const contentWidthMm = PAGE_W - template.marginsMm.left - template.marginsMm.right;
  const asideWidthMm = template.columns === "sidebar-left" || template.columns === "sidebar-right" ? template.sidebarMm : 0;
  const mainWidthMm = contentWidthMm - asideWidthMm;

  const identity: ResumeItem[] = [];
  if (photo && m.photo) identity.push({ k: "photo", url: m.photo.url, shape: template.photo.shape, sizeMm: template.photo.sizeMm });
  identity.push({ k: "name", text: m.identity.fullName, path: "identity.fullName" });
  if (m.identity.headline) identity.push({ k: "headline", text: m.identity.headline, path: "identity.headline" });
  const contact = contactLines(m);

  const aside: ResumeItem[] = [];
  const header: ResumeItem[] = [];
  const main: ResumeItem[] = [];
  const asideSet = new Set<ResumeSectionId>(asideWidthMm ? template.asideSections : []);

  if (asideWidthMm) {
    aside.push(...identity);
    if (contact.length) aside.push({ k: "h2", text: m.labels.contact, section: "summary" }, { k: "contact", lines: contact });
    for (const id of template.asideSections) aside.push(...withHeading(m, id));
  } else {
    header.push(...identity);
    if (contact.length) header.push({ k: "contact", lines: contact });
  }
  for (const id of m.order) {
    if (asideSet.has(id)) continue;
    main.push(...withHeading(m, id));
  }

  const zones: ResumeZone[] = [];
  if (header.length) zones.push({ id: "header", items: header });
  if (aside.length) zones.push({ id: "aside", items: aside });
  zones.push({ id: "main", items: main });

  return { template, palette, zones, pageMm: { w: 210, h: 297 }, contentWidthMm, mainWidthMm, asideWidthMm, photo };
}

/** Tahrirlanuvchi itemlarning path ro'yxati (test va editor uchun). */
export function editablePaths(layout: ResumeLayout): ResumePath[] {
  const out: ResumePath[] = [];
  for (const z of layout.zones) {
    for (const it of z.items) {
      if (it.k === "name" || it.k === "headline" || it.k === "p" || it.k === "li" || it.k === "kv" || it.k === "chips") out.push(it.path);
      else if (it.k === "row") out.push(it.titlePath, it.subPath);
      else if (it.k === "contact") for (const l of it.lines) out.push(l.path);
    }
  }
  return out;
}
