import type { MetadataRoute } from "next";
import { TOOLS } from "@/lib/tools";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

/** Asked at request time: the market is switched on at runtime and its items change daily. */
export const dynamic = "force-dynamic";

/** Sitemap pages of market items (each ≤ 48 rows): enough for the catalog, and bounded. */
const MARKET_PAGES = 10;

/** The catalog + every active item while the market is on; nothing at all while it is dark or the database is away. */
async function marketEntries(now: Date): Promise<MetadataRoute.Sitemap> {
  try {
    const { marketEnabled } = await import("@/lib/server/market/items");
    if (!(await marketEnabled())) return [];
    const { listMarketItems, MARKET_PAGE_MAX } = await import("@/lib/server/market/search");
    const out: MetadataRoute.Sitemap = [{ url: `${APP_URL}/uz/market`, lastModified: now, changeFrequency: "daily", priority: 0.9 }];
    let cursor: string | null = null;
    for (let i = 0; i < MARKET_PAGES; i += 1) {
      const page: Awaited<ReturnType<typeof listMarketItems>> = await listMarketItems({ sort: "new", limit: MARKET_PAGE_MAX, cursor });
      for (const item of page.items) out.push({ url: `${APP_URL}/uz/market/${item.id}`, lastModified: now, changeFrequency: "weekly", priority: 0.6 });
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return out;
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  return [
    { url: `${APP_URL}/uz`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${APP_URL}/uz/create`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    // `/uz/purchase` is a redirect to the wallet (redesign F0): list the real page, not the alias.
    { url: `${APP_URL}/uz/wallet`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    ...TOOLS.map((t) => ({
      url: `${APP_URL}/uz/${t.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...(await marketEntries(now)),
  ];
}
