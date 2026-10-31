import type { ProviderItem, ProvidersResponse, PurposeId, PurposeItem, RouteItem, Verdict } from "@/lib/admin-api/providers";
import { providerNeedsAttention, totalsOf, usageKindLabel, type Period } from "./format";

/**
 * The page groups the server's eight PURPOSES into seven tabs (the owner's mental model): one «Umumiy» overview and a
 * tab per cost category. The mapping lives on the client; the server keeps its finer purposes.
 */
export type TabId = "overview" | "text" | "image" | "tts" | "video" | "sources" | "listen";
export type CategoryId = Exclude<TabId, "overview">;

type CategoryDef = { id: CategoryId; label: string; desc: string; purposes: readonly PurposeId[]; noRoutes: string };

export const CATEGORY_DEFS: readonly CategoryDef[] = [
  { id: "text", label: "Matn (LLM)", desc: "Slayd, kurs ishi, maqola, tarjima, AI chat — barcha matn", purposes: ["text"], noRoutes: "Bu toifada sozlanadigan tartib yo'q." },
  {
    id: "image",
    label: "Rasm",
    desc: "AI rasm, pro-slayd rasmlari, portret va stok fotolar",
    purposes: ["image", "stock"],
    noRoutes: "Bu toifada sozlanadigan tartib yo'q.",
  },
  { id: "tts", label: "Ovoz", desc: "Podkast, tabriknoma, tinglash o'yini, domla", purposes: ["tts"], noRoutes: "Bu toifada sozlanadigan tartib yo'q." },
  {
    id: "video",
    label: "Video",
    desc: "Matndan qisqa video (har soniyasi pullik)",
    purposes: ["video"],
    noRoutes: "Qaysi provayder ishlashini foydalanuvchi formada tanlaydi. Vositani yoqish: Sozlamalar → «Video yaratish yoqilgan».",
  },
  {
    id: "sources",
    label: "Ilmiy manbalar",
    desc: "Maqola va kurs ishidagi adabiyotlarni topish va tekshirish",
    purposes: ["sources"],
    noRoutes: "Bu toifada tartib yo'q: manbalar birga ishlatiladi.",
  },
  {
    id: "listen",
    label: "Tinglash va qidiruv",
    desc: "Domla javobini tinglash, pro-slayd internet qidiruvi",
    purposes: ["stt", "search"],
    noRoutes: "Sozlanadigan tartib yo'q.",
  },
];

export const TAB_IDS: readonly TabId[] = ["overview", ...CATEGORY_DEFS.map((c) => c.id)];

/** Reads a `?tab=` value; anything unknown is the overview. */
export function parseTab(raw: string | null | undefined): TabId {
  return TAB_IDS.includes(raw as TabId) ? (raw as TabId) : "overview";
}

const PURPOSE_CATEGORY: Readonly<Record<PurposeId, CategoryId>> = {
  text: "text",
  image: "image",
  stock: "image",
  tts: "tts",
  video: "video",
  sources: "sources",
  stt: "listen",
  search: "listen",
};

/**
 * Worst verdict of a tab. «Off» (switched off in Sozlamalar) is not a problem, so it only shows when EVERY purpose of the
 * tab is off; otherwise a missing / single-provider purpose wins over an ok one.
 */
const VERDICT_RANK: Readonly<Record<Verdict, number>> = { missing: 3, single: 2, ok: 1, off: 0 };
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((w, v) => (VERDICT_RANK[v] > VERDICT_RANK[w] ? v : w), "off");
}

export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = { ok: "Yetarli", single: "Yetarli, zaxirasiz", missing: "Yetarli emas", off: "O'chirilgan" };

export type SpendRow = { key: string; label: string; calls: number; usd: number; free: boolean };

export type ProviderRowData = {
  item: ProviderItem;
  /** Figures of the chosen period, scoped to this tab when the provider also serves other tabs (30 days only). */
  calls: number;
  usd: number;
  errors: number | null;
  /** The figures are the provider's total, not only this tab's share. */
  shared: boolean;
};

export type Category = {
  id: CategoryId;
  label: string;
  desc: string;
  purposes: PurposeItem[];
  verdict: Verdict;
  headline: string;
  /** One entry per purpose (a tab with two purposes names each). */
  details: { title: string; text: string; minimum: string }[];
  primary: string;
  fallback: string;
  providers: ProviderItem[];
  routes: RouteItem[];
  settings: { key: string; label: string; enabled: boolean }[];
  noRoutes: string;
  spendUsd: number;
  spendCalls: number;
  spendRows: SpendRow[];
};

/** Which tab a usage kind of a provider belongs to. Free providers' `requests` follow the provider's own purpose. */
function kindCategory(kind: string, item: ProviderItem): CategoryId {
  if (kind === "llm") return "text";
  if (kind === "image") return "image";
  if (kind === "tts") return "tts";
  if (kind === "video") return "video";
  if (kind === "grounding") return "listen";
  const p = item.purposes[0];
  return p ? PURPOSE_CATEGORY[p] : "text";
}

/** First and second WORKING provider of a purpose; a voice order decides by its own order. */
function leaders(p: PurposeItem, byId: Readonly<Record<string, ProviderItem>>): string[] {
  const order = p.routes.find((r) => r.shape === "order");
  const ids = order ? order.entries.filter((e) => e.usable).map((e) => e.provider) : [...p.providerIds, ...p.premiumIds].filter((id) => byId[id]?.usable);
  return [...new Set(ids)].map((id) => byId[id]?.label ?? id);
}

export function buildCategories(data: ProvidersResponse): Category[] {
  const byId = Object.fromEntries(data.items.map((i) => [i.id, i])) as Record<string, ProviderItem>;
  const defs = CATEGORY_DEFS.map((def) => ({ def, purposes: data.purposes.filter((p) => def.purposes.includes(p.id)) })).filter((d) => d.purposes.length > 0);

  // Which tabs each provider serves (decides whether its 30-day figures must be split).
  const providerIdsOf = (purposes: PurposeItem[], def: CategoryDef): string[] => {
    const listed = purposes.flatMap((p) => [...p.providerIds, ...p.premiumIds]);
    const extra = data.items.filter((i) => i.purposes.some((p) => def.purposes.includes(p))).map((i) => i.id);
    return [...new Set([...listed, ...extra])].filter((id) => byId[id]);
  };
  const tabsOf = new Map<string, number>();
  const idsByTab = defs.map(({ def, purposes }) => {
    const ids = providerIdsOf(purposes, def);
    for (const id of ids) tabsOf.set(id, (tabsOf.get(id) ?? 0) + 1);
    return ids;
  });

  return defs.map(({ def, purposes }, idx) => {
    const providers = idsByTab[idx].map((id) => byId[id]);
    const worst = purposes.reduce((w, p) => (VERDICT_RANK[p.verdict] > VERDICT_RANK[w.verdict] ? p : w), purposes[0]);
    const verdict = worstVerdict(purposes.map((p) => p.verdict));

    const spendRows: SpendRow[] = [];
    for (const item of providers) {
      for (const k of item.usage.kinds) {
        if (kindCategory(k.kind, item) !== def.id || k.calls + k.usd <= 0) continue;
        spendRows.push({ key: `${item.id}:${k.kind}`, label: `${item.label} · ${usageKindLabel(k.kind)}`, calls: k.calls, usd: k.usd, free: item.billing === "free" });
      }
    }
    spendRows.sort((a, b) => b.usd - a.usd || b.calls - a.calls);

    const lead = purposes.map((p) => leaders(p, byId));
    const unique = (xs: string[]) => [...new Set(xs)];
    const primary = unique(lead.map((l) => l[0]).filter((x): x is string => Boolean(x)));
    const fallbacks = purposes.map((p, i) => (lead[i][1] ? lead[i][1] : p.fallback ? "— (yo'q)" : "— (variant yo'q)"));
    const fallback = unique(fallbacks.filter((f, i) => lead[i].length > 0 || f.startsWith("—")));

    return {
      id: def.id,
      label: def.label,
      desc: def.desc,
      purposes,
      verdict,
      headline: worst.headline,
      details: purposes.map((p) => ({ title: p.title, text: p.detail, minimum: p.minimum })),
      primary: primary.length > 0 ? primary.join(" · ") : "— (yo'q)",
      fallback: fallback.length > 0 ? fallback.join(" · ") : "—",
      providers,
      routes: purposes.flatMap((p) => p.routes),
      settings: purposes.flatMap((p) => (p.setting ? [p.setting] : [])),
      noRoutes: def.noRoutes,
      spendUsd: spendRows.reduce((s, r) => s + r.usd, 0),
      spendCalls: spendRows.reduce((s, r) => s + r.calls, 0),
      spendRows,
    };
  });
}

/** How many tabs a provider serves (for the «shared» marker). */
export function tabCountOf(categories: readonly Category[], id: string): number {
  return categories.filter((c) => c.providers.some((p) => p.id === id)).length;
}

/**
 * A provider's figures in one tab. The 30-day split by kind is exact, so a provider that serves several tabs (Gemini)
 * shows only this tab's share for 30 days; «Bugun» and «7 kun» have no per-kind split and show the provider's total
 * (`shared: true`, the row says so).
 */
export function providerFigures(item: ProviderItem, category: CategoryId, period: Period, tabs: number): ProviderRowData {
  const t = totalsOf(item.usage, period);
  const split = period === "d30" && tabs > 1 && item.usage.kinds.length > 0;
  if (split) {
    const mine = item.usage.kinds.filter((k) => kindCategory(k.kind, item) === category);
    return { item, calls: mine.reduce((s, k) => s + k.calls, 0), usd: mine.reduce((s, k) => s + k.usd, 0), errors: t.errors, shared: false };
  }
  return { item, calls: t.calls, usd: t.usd, errors: t.errors, shared: tabs > 1 && period !== "d30" };
}

/** The four KPI numbers. */
export function kpis(data: ProvidersResponse, categories: readonly Category[]) {
  const usable = data.items.filter((i) => i.usable);
  const paid = usable.filter((i) => i.billing !== "free").length;
  const top = [...categories].sort((a, b) => b.spendUsd - a.spendUsd)[0];
  const attributed = categories.reduce((s, c) => s + c.spendUsd, 0);
  const topProviders = top
    ? top.providers
        .map((p) => ({ label: p.label, usd: providerFigures(p, top.id, "d30", tabCountOf(categories, p.id)).usd }))
        .filter((p) => p.usd > 0)
        .sort((a, b) => b.usd - a.usd)
        .slice(0, 2)
    : [];

  const issues: string[] = [];
  for (const p of data.purposes) if (p.verdict === "missing" || p.verdict === "single") issues.push(`${p.title}: ${p.headline.toLowerCase()}`);
  const purposeIssues = issues.length;
  for (const i of data.items) if (providerNeedsAttention(i)) issues.push(`${i.label}: ${i.hasDbKey && i.unreadable ? "kalit o'qilmaydi" : "vaqtincha to'xtagan"}`);
  return {
    usable: usable.length,
    total: data.items.length,
    paidUsable: paid,
    freeUsable: usable.length - paid,
    top: top && top.spendUsd > 0 ? { label: top.label, share: attributed > 0 ? Math.round((top.spendUsd / attributed) * 100) : 0, providers: topProviders } : null,
    attention: issues.length,
    purposeIssues,
    reason: issues[0] ?? null,
  };
}
