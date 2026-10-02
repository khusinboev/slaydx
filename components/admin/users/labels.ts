import type { ProfileField, UserSort } from "@/lib/admin-api/users";

/** Uzbek labels shared by the users list (S4) and the user page (S5). */

export const SORT_LABEL: Record<UserSort, string> = {
  created_desc: "Yangi avval",
  created_asc: "Eski avval",
  balance_desc: "Balans ↓",
  last_seen_desc: "Oxirgi faollik ↓",
};

export const PROFILE_LABEL: Record<ProfileField, string> = {
  university: "OTM",
  faculty: "Fakultet",
  department: "Kafedra",
  group: "Guruh",
  course: "Kurs",
  author: "Muallif",
  subject: "Fan",
  teacher: "O'qituvchi",
  city: "Shahar",
  position: "Lavozim",
  organization: "Tashkilot",
};

/** A short device label from a user agent ("Chrome · Android"); the full string stays in the title. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Noma'lum qurilma";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /YaBrowser/.test(ua)
        ? "Yandex"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : /Telegram/i.test(ua)
                ? "Telegram"
                : "Brauzer";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iOS/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}
