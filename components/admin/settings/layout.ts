/**
 * Owner-facing layout of the settings page: which tab every catalog key lives in,
 * how its value is written (units) and what a feature switch does. Pure data, no
 * server imports (admin client code must not reach `lib/server/**`); the pin test
 * `tests/admin-settings-tabs.test.mts` proves every catalog key is listed exactly once.
 */

export const OVERVIEW_TAB = "overview";
export const OTHER_TAB = "other";

export type TabDef = { id: string; label: string; /** One line under the tab strip. */ blurb: string; keys: readonly string[] };

/** Tabs after «Umumiy», in display order. The order of `keys` is the row order. */
export const TAB_DEFS: readonly TabDef[] = [
  {
    id: "features",
    label: "Funksiyalar",
    blurb: "Yangi imkoniyatlarni bir tugma bilan yoqing yoki o'chiring. Narx va chegaralar alohida tablarda.",
    keys: ["tests.enabled", "video.enabled", "daily_quiz.enabled", "domla.enabled", "chat.enabled", "oferta.gate_enabled"],
  },
  {
    id: "money",
    label: "Pul va bonuslar",
    blurb: "Foydalanuvchiga beriladigan bonuslar. Yangi qiymat faqat keyingi to'lov va baholarga qo'llanadi.",
    keys: ["payment_bonus_percent", "ambassador.percent", "bonus.rating_points"],
  },
  {
    id: "pricing",
    label: "Narx va marja",
    blurb: "Hisobotlardagi marja va tavsiya etilgan narx shu qiymatlardan hisoblanadi.",
    keys: ["pricing.payment_fee_percent", "pricing.target_markup", "finance.soum_per_usd", "domla.price"],
  },
  {
    id: "queue",
    label: "Navbat va generatsiya",
    blurb: "Ishlar qancha kutishi, kim qancha ish yubora olishi va favqulodda to'xtatish.",
    keys: [
      "generation.paused",
      "generation.paused_tools",
      "queue.max_wait_sec",
      "queue.user_max_inflight",
      "queue.total_slots",
      "queue.mean_service_sec",
      "convert.disabled",
      "convert.daily_limit",
    ],
  },
  {
    id: "free",
    label: "Bepul AI va chat",
    blurb: "Bepul AI xarajatining shifti va AI chat narxi.",
    keys: [
      "free_llm.disabled",
      "free_llm.daily.global",
      "free_llm.daily.outline",
      "free_llm.daily.udk",
      "free_llm.daily.rewrite",
      "free_llm.daily.polish",
      "free_llm.daily.chat",
      "chat.price_per_message",
    ],
  },
  {
    id: "quiz",
    label: "Kunlik savol",
    blurb: "Botdagi kunlik 3 ta savol: bonus va yuborish vaqti. Yoqish — «Funksiyalar» tabida.",
    keys: ["daily_quiz.reward", "daily_quiz.monthly_cap", "daily_quiz.daily_budget", "daily_quiz.hour"],
  },
  {
    id: "tests",
    label: "Testlar",
    blurb: "Test ishlash: narx, savollar soni, vaqt va ball. Yoqish — «Funksiyalar» tabida.",
    keys: [
      "tests.price_per_attempt",
      "tests.first_attempt_free",
      "tests.questions_per_subject",
      "tests.minutes_per_subject",
      "tests.minutes_all",
      "tests.points_per_correct",
    ],
  },
  {
    id: "video",
    label: "Video",
    blurb: "Video pullik provayderga ketadi, shuning uchun cheklang. Yoqish — «Funksiyalar» tabida.",
    keys: ["video.max_concurrent"],
  },
  {
    id: "oferta",
    label: "Oferta",
    blurb: "Ommaviy oferta matni uchun rekvizitlar va tahrir raqami. Majburiy qabul qilish — «Funksiyalar» tabida.",
    keys: ["oferta.requisites", "oferta.version"],
  },
  {
    id: "admin",
    label: "Admin",
    blurb: "Adminlar uchun xavfsizlik chegaralari.",
    keys: ["admin.wallet_confirm_threshold"],
  },
];

/** Where a key lives; unknown keys (a catalog key not listed above) fall to the «Boshqa» tab so none ever disappears. */
export function tabOfKey(key: string): string {
  return TAB_DEFS.find((t) => t.keys.includes(key))?.id ?? OTHER_TAB;
}

export const OTHER_DEF: TabDef = { id: OTHER_TAB, label: "Boshqa", blurb: "Hali guruhlanmagan sozlamalar.", keys: [] };

/** Keys of `items` for one tab, in the tab's own order (unknown keys keep the catalog order, after the known ones). */
export function keysForTab<T extends { key: string }>(tab: TabDef, items: ReadonlyArray<T>): T[] {
  if (tab.id === OTHER_TAB) return items.filter((i) => tabOfKey(i.key) === OTHER_TAB);
  return tab.keys.map((k) => items.find((i) => i.key === k)).filter((i): i is T => i !== undefined);
}

/** Feature switches: «on» is the good state. Their rows get a big ON/OFF and the sentence below. */
export const FEATURE_EFFECT: Readonly<Record<string, string>> = {
  "tests.enabled": "Yoqilsa: foydalanuvchilar sayt va botda pullik test topshira oladi. Boshlangan urinishlar yakunlanadi.",
  "video.enabled": "Yoqilsa: «Video yaratish» hamma uchun ochiladi. Har soniya pullik provayderga ketadi — ehtiyot bo'ling.",
  "daily_quiz.enabled": "Yoqilsa: bot har kuni faol foydalanuvchilarga 3 ta savol yuboradi va 3/3 uchun bonus beradi.",
  "domla.enabled": "Yoqilsa: «Qattiqqo'l domla» himoyasi ochiq. O'chirilsa yangi himoya boshlanmaydi (AI va ovoz sarfini to'xtatadi).",
  "chat.enabled": "Yoqilsa: AI chat sayt va botda ishlaydi. O'chirilsa darhol to'xtaydi, pul yechilmaydi.",
  "oferta.gate_enabled": "Yoqilsa: ofertani qabul qilmagan foydalanuvchi ish yarata olmaydi va to'lov qila olmaydi. Rekvizitlarsiz yoqib bo'lmaydi.",
};

/** Emergency stops: «on» means something is switched OFF for users (shown as a warning). */
export const STOP_KEYS: ReadonlySet<string> = new Set(["generation.paused", "free_llm.disabled", "convert.disabled"]);

export const isFeatureKey = (key: string): boolean => key in FEATURE_EFFECT;

/** First sentence of the catalog description: the one-line explanation under a label. */
export function shortHint(description: string): string {
  const m = /^.*?[.!?](?=\s|$)/s.exec(description.trim());
  const first = (m ? m[0] : description).trim();
  return first.length > 150 ? `${first.slice(0, 147).trimEnd()}…` : first;
}
