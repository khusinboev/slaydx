import type { MetadataRoute } from "next";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // «Ishlar bozori» is public on purpose (M15); search result pages carry `noindex` themselves, «Xaridlarim» is private.
        allow: ["/", "/uz/market"],
        /*
         * Shaxsiy sahifalar va API indekslanmasin. `/o/` — AUDIT-22 R:
         * o'yin havolalari (`app/o/[token]`) — sahifaning o'zida ham
         * `robots: noindex, nofollow` bor, bu yerda esa QIDIRUV
         * ROBOTI havolaga umuman KIRMASIN (loginsiz, token bilan ochiq
         * — indekslansa boshqa sinfning o'yini qidiruvda chiqib qolardi).
         */
        disallow: ["/api/", "/uz/files/", "/uz/profile", "/o/", "/uz/market/purchases"],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
