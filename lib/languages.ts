/**
 * Hujjat CHIQISH tillari.
 *
 * Ro'yxatda faqat hujjat skeleti to'liq tarjima qilingan tillar turadi
 * (`lib/generation/i18n.ts` dagi `SECTIONS`, `SLIDE_LABELS`, `DocLabels`).
 * Ilgari bu yerda 18 ta til bor edi, lekin sarlavhalar faqat uch tilda:
 * tojikcha maqola so'ragan foydalanuvchi tojikcha matn va O'ZBEKCHA
 * «Kirish / Xulosa / Mundarija» olardi. Yangi til qo'shishdan oldin
 * avval o'sha uch to'plamga tarjima yoziladi.
 */
export const TARGET_LANGUAGES = [
  { value: "uz", label: "O'zbekcha", flag: "🇺🇿" },
  { value: "ru", label: "Русский", flag: "🇷🇺" },
  { value: "en", label: "English", flag: "🇬🇧" },
] as const;

/**
 * Tarjima uchun MANBA tillari.
 *
 * Bu ro'yxat kengroq va shunday qolishi kerak: manba tilini bilish faqat
 * modelga ko'rsatma berish uchun kerak — hujjat sarlavhalari baribir
 * chiqish tilida yoziladi. Nemis maqolasini o'zbekchaga tarjima qilish
 * mumkin, aksi esa hozircha yo'q.
 */
export const SOURCE_LANGUAGES = [
  ...TARGET_LANGUAGES,
  { value: "kaa", label: "Qaraqalpaqsha", flag: "🇺🇿" },
  { value: "kk", label: "Қазақ тілі", flag: "🇰🇿" },
  { value: "ky", label: "Кыргызча", flag: "🇰🇬" },
  { value: "tg", label: "Забони тоҷикӣ", flag: "🇹🇯" },
  { value: "tk", label: "Türkmençe", flag: "🇹🇲" },
  { value: "tr", label: "Türkçe", flag: "🇹🇷" },
  { value: "ar", label: "العربية", flag: "🇸🇦" },
  { value: "de", label: "Deutsch", flag: "🇩🇪" },
  { value: "fr", label: "Français", flag: "🇫🇷" },
  { value: "es", label: "Español", flag: "🇪🇸" },
  { value: "zh", label: "中文", flag: "🇨🇳" },
  { value: "ko", label: "한국어", flag: "🇰🇷" },
  { value: "ja", label: "日本語", flag: "🇯🇵" },
  { value: "it", label: "Italiano", flag: "🇮🇹" },
  { value: "pt", label: "Português", flag: "🇵🇹" },
] as const;

export const ALL_LANGUAGES = SOURCE_LANGUAGES;

/** Hujjat shu tilda to'liq chiqa oladimi. */
export function isTargetLanguage(code: string) {
  return TARGET_LANGUAGES.some((l) => l.value === code);
}

export function languageName(code: string) {
  return ALL_LANGUAGES.find((l) => l.value === code)?.label ?? code;
}

export const ESSAY_DESIGNS = [
  { value: "vintage", label: "Vintage", from: "#8b5e34", to: "#d4a373" },
  { value: "midnight", label: "Midnight", from: "#0f172a", to: "#334155" },
  { value: "smoke", label: "Smoke", from: "#52525b", to: "#a1a1aa" },
  { value: "soft", label: "Soft", from: "#e2e8f0", to: "#f8fafc" },
  { value: "iris", label: "Iris", from: "#4f46e5", to: "#a78bfa" },
  { value: "nightfall", label: "Nightfall", from: "#1e1b4b", to: "#6d28d9" },
  { value: "autumn", label: "Autumn", from: "#9a3412", to: "#f59e0b" },
  { value: "crystal", label: "Crystal", from: "#0e7490", to: "#67e8f9" },
  { value: "nature", label: "Nature", from: "#166534", to: "#86efac" },
  { value: "ocean", label: "Ocean", from: "#0c4a6e", to: "#38bdf8" },
] as const;
