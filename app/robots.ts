import type { MetadataRoute } from "next";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        /*
         * Shaxsiy sahifalar va API indekslanmasin. `/o/` — AUDIT-22 R:
         * o'yin havolalari (`app/o/[token]`) — sahifaning o'zida ham
         * `robots: noindex, nofollow` bor, bu yerda esa QIDIRUV
         * ROBOTI havolaga umuman KIRMASIN (loginsiz, token bilan ochiq
         * — indekslansa boshqa sinfning o'yini qidiruvda chiqib qolardi).
         */
        disallow: ["/api/", "/uz/files/", "/uz/profile", "/o/"],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
