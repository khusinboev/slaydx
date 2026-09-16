/**
 * INFOGRAFIKA KIRISHI (AUDIT-21 WP-C) — formadan dvigatelgacha.
 *
 * `teacher/input.ts` naqshi: `FormValues` bilan `InfographicInput`
 * orasidagi YAGONA ko'prik, ikki tomonga ishlaydi —
 *   • `infographicInputFromValues(meta, values)` — server (dvigatel, zond);
 *   • `encodeInfographicValues(input)`           — klient (qoralama, forma).
 *
 * Nega `DocMeta` YETARLI EMAS: `extractMeta` `infographicType`,
 * `blockCount`, `palette` va `size` ni BILMAYDI. Nega `meta` dan voz
 * kechib ham bo'lmaydi: `topic`, `language` va `extra` o'sha yerda
 * normallashtirilgan.
 *
 * DIAPAZON QAYTA TEKSHIRILADI: forma nima yuborishidan qat'i nazar tur,
 * blok soni (TUR chegarasida — `normalizeBlockCountFor`), palitra va
 * o'lcham shu yerda reyestr qiymatlariga siqiladi. Mijoz tomonida
 * tekshirilgan qiymat server uchun DALIL emas.
 *
 * Server importi YO'Q (izomorf: forma ham chaqiradi).
 */
import type { FormValues } from "../../types";
import type { DocMeta } from "../types";
import { INFOGRAPHIC_LIMITS, iconOf, infographicSizeOf, paletteOf, type InfographicBlock, type InfographicSize, type InfographicSpec, type InfographicTypeId, type PaletteId } from "./types";
import { infographicTypeOf, normalizeBlockCountFor } from "./registry";

export type InfographicInput = {
  type: InfographicTypeId;
  topic: string;
  /** Tur chegarasiga siqilgan blok soni. */
  blockCount: number;
  palette: PaletteId;
  size: InfographicSize;
  /** Chiqish tili (18 til kodi). */
  language: string;
  /**
   * Qo'shimcha ma'lumot — infografikada bu MA'LUMOT kanali, uslub
   * tilagi emas: `stat` va `source` FAQAT shu yerdagi (yoki manba
   * fayldagi) raqamlardan to'ldiriladi (hisobot §4 halollik chegarasi).
   */
  extra: string;
  /** Yuklangan manba matni (worker `sourceForJob`); odatda bo'sh. */
  sourceText: string;
};

const str = (v: unknown, max: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function infographicInputFromValues(meta: DocMeta, values: FormValues): InfographicInput {
  const type = infographicTypeOf(values.infographicType).id;
  return {
    type,
    topic: str(values.topic ?? meta.topic, INFOGRAPHIC_LIMITS.topicChars),
    blockCount: normalizeBlockCountFor(type, values.blockCount),
    palette: paletteOf(values.palette).id,
    size: infographicSizeOf(values.size),
    language: String(values.language ?? meta.language ?? "uz").toLowerCase(),
    extra: str(values.extra ?? meta.extra, INFOGRAPHIC_LIMITS.extraChars),
    sourceText: String(meta.sourceText ?? values.sourceText ?? "").slice(0, INFOGRAPHIC_LIMITS.extraChars * 4),
  };
}

/** Qoralama/forma uchun teskari yo'nalish (`teacher/input.ts` naqshi). */
export function encodeInfographicValues(input: InfographicInput): FormValues {
  return {
    topic: input.topic,
    infographicType: input.type,
    blockCount: input.blockCount,
    palette: input.palette,
    size: input.size,
    language: input.language,
    extra: input.extra,
  };
}

/* ══════════════════════════ model javobi → spetsifikatsiya ══════════════════════════ */

/**
 * LLM javobi → `InfographicSpec`. Javob QISMAN/BUZUQ bo'lishi mumkin
 * degan qoidadan (CLAUDE.md) kelib chiqadi: har maydon kesiladi,
 * chegaraga siqiladi, noma'lum qiymat standartga tushadi.
 *
 * Nega `type`/`palette`/`size`/`language` MODELDAN OLINMAYDI: ular
 * FORMADAN keladi. Model ularni «tuzatishga» urinsa (masalan
 * `type: "list"` deb qaytarsa), foydalanuvchi tanlagan tur jimgina
 * almashardi — bu «bezak maydon» ning eng yomon ko'rinishi bo'lardi.
 *
 * `opts.ids` — sayqal/qayta so'rov uchun: blok id lari SAQLANADI,
 * shunda hisobotdagi `noOverflow` bandi va tahrir havolalari eski
 * javobga bog'langan holicha qoladi.
 */
export function normalizeSpec(raw: Record<string, unknown> | null, input: InfographicInput, opts: { ids?: string[] } = {}): InfographicSpec | null {
  if (!raw) return null;
  const type = infographicTypeOf(input.type);
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : Array.isArray((raw as { items?: unknown }).items) ? ((raw as { items: unknown[] }).items) : [];
  const [, max] = type.limits.blocks;
  const blocks: InfographicBlock[] = [];
  for (const [i, item] of rawBlocks.slice(0, max).entries()) {
    const o = (item ?? {}) as Record<string, unknown>;
    const heading = str(o.heading ?? o.title, INFOGRAPHIC_LIMITS.headingCharsMax * 2);
    const text = str(o.text ?? o.body, 1200);
    if (!heading && !text) continue;
    const id = opts.ids?.[blocks.length] ?? `b${blocks.length + 1}`;
    const block: InfographicBlock = { id, icon: iconOf(o.icon), heading, text };
    const stat = (o.stat ?? null) as Record<string, unknown> | string | null;
    if (typeof stat === "string" && stat.trim()) {
      // Hisobot §3 sxemasida `stat` SATR edi; model ba'zan shunday qaytaradi.
      block.stat = { value: str(stat, INFOGRAPHIC_LIMITS.statValueCharsMax * 3), label: "" };
    } else if (stat && typeof stat === "object") {
      const value = str(stat.value, INFOGRAPHIC_LIMITS.statValueCharsMax * 3);
      if (value) block.stat = { value, label: str(stat.label, INFOGRAPHIC_LIMITS.statLabelCharsMax) };
    }
    const when = str(o.when, 40);
    if (when) block.when = when;
    if (o.role === "cause" || o.role === "effect") block.role = o.role;
    if (o.side === "left" || o.side === "right") block.side = o.side;
    const order = Number(o.order);
    block.order = Number.isFinite(order) && order > 0 ? Math.round(order) : i + 1;
    const parent = str(o.parent, 20);
    if (parent) block.parent = /^\d+$/.test(parent) ? `b${Number(parent)}` : parent;
    blocks.push(block);
  }
  if (!blocks.length) return null;

  return {
    title: str(raw.title ?? input.topic, INFOGRAPHIC_LIMITS.titleCharsMax) || input.topic.slice(0, INFOGRAPHIC_LIMITS.titleCharsMax),
    ...(str(raw.subtitle, INFOGRAPHIC_LIMITS.subtitleCharsMax) ? { subtitle: str(raw.subtitle, INFOGRAPHIC_LIMITS.subtitleCharsMax) } : {}),
    type: type.id,
    blocks,
    palette: input.palette,
    size: input.size,
    language: input.language,
    ...(str(raw.source, INFOGRAPHIC_LIMITS.sourceCharsMax) ? { source: str(raw.source, INFOGRAPHIC_LIMITS.sourceCharsMax) } : {}),
  };
}

/**
 * Foydalanuvchi BERGAN matn — halollik tekshiruvining yagona manbasi
 * (`sourceGrounded`, `statPresent` va promptdagi taqiq shundan o'qiydi).
 * Mavzu ham kiradi: «Yer yuzasining 71 % i suv» mavzuning O'ZIDA
 * yozilgan bo'lsa, u ham foydalanuvchi bergan raqam.
 */
export function infographicUserFacts(input: Pick<InfographicInput, "topic" | "extra" | "sourceText">): string {
  return [input.topic, input.extra, input.sourceText].filter(Boolean).join("\n");
}
