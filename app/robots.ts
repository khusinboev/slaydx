import type { MetadataRoute } from "next";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Shaxsiy sahifalar va API indekslanmasin.
        disallow: ["/api/", "/uz/files/", "/uz/profile"],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
