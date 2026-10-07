import type { MetadataRoute } from "next";
import { TOOLS } from "@/lib/tools";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
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
  ];
}
