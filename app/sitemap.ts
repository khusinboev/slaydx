import type { MetadataRoute } from "next";
import { TOOLS } from "@/lib/tools";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${APP_URL}/uz`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${APP_URL}/uz/create`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${APP_URL}/uz/purchase`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    ...TOOLS.map((t) => ({
      url: `${APP_URL}/uz/${t.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
