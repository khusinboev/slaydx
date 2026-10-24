import "server-only";
import type { PoolClient } from "pg";
import { registerSoumPerUsdSource, soumPerUsd } from "../generation/llm-pricing";
import { TOOL_BY_ID } from "../tools";
import type { ToolId } from "../types";
import { ApiError } from "./api";
import { query } from "./db";
import { env } from "./env";
import { toJsonb } from "./jsonb";
import { log } from "./log";
import { PAYMENT_BONUS_DEFAULT, PAYMENT_BONUS_MAX, PAYMENT_BONUS_MIN } from "../payment-bonus";
import { AMBASSADOR_DEFAULT, AMBASSADOR_MAX, AMBASSADOR_MIN } from "../ambassador";
import { RATING_BONUS_DEFAULT, RATING_BONUS_MAX } from "../rating";
import {
  DQ_BUDGET_DEFAULT,
  DQ_CAP_DEFAULT,
  DQ_HOUR_DEFAULT,
  DQ_MONEY_MAX,
  DQ_REWARD_DEFAULT,
  DQ_REWARD_MAX,
} from "../daily-quiz/rules";
import { DOMLA_PRICE_DEFAULT, DOMLA_PRICE_MAX } from "../domla/rules";
import {
  TESTS_ENABLED_DEFAULT,
  TESTS_FIRST_FREE_DEFAULT,
  TESTS_MINUTES_ALL_DEFAULT,
  TESTS_MINUTES_MAX,
  TESTS_MINUTES_SUBJECT_DEFAULT,
  TESTS_PER_SUBJECT_DEFAULT,
  TESTS_PER_SUBJECT_MAX,
  TESTS_POINTS_DEFAULT,
  TESTS_POINTS_MAX,
  TESTS_PRICE_DEFAULT,
  TESTS_PRICE_MAX,
} from "../tests/rules";

/**
 * Runtime settings (docs/admin/02-plan.md §6.10, §17.7).
 *
 * A small typed catalog of flags the admin can change without a deploy. The
 * effective value of a key is the `app_settings` row when one exists,
 * otherwise the env value (or the code default for keys without an env var).
 * With no rows every value equals what the product used before this module,
 * so behavior is unchanged until an admin writes an override.
 *
 * Reads go through a 15 s per-process cache of ALL rows (one query). A write
 * invalidates the cache of the process that made it (the caller runs
 * `invalidateSettingsCache()` after COMMIT); other processes see the change
 * within 15 s. A failing read never fails product code: it logs and falls
 * back to the last good snapshot, or to env/default values.
 */

/** Value type of every key — the single source of truth for `SettingKey`. */
export type SettingValues = {
  "free_llm.disabled": boolean;
  "free_llm.daily.outline": number;
  "free_llm.daily.udk": number;
  "free_llm.daily.rewrite": number;
  "free_llm.daily.polish": number;
  "free_llm.daily.global": number;
  "generation.paused": boolean;
  "generation.paused_tools": ToolId[];
  "admin.wallet_confirm_threshold": number;
  "finance.soum_per_usd": number;
  payment_bonus_percent: number;
  "ambassador.percent": number;
  "bonus.rating_points": number;
  "oferta.gate_enabled": boolean;
  "oferta.version": number;
  "oferta.requisites": string;
  "pricing.target_markup": number;
  "pricing.payment_fee_percent": number;
  "queue.max_wait_sec": number;
  "queue.user_max_inflight": number;
  "queue.total_slots": number;
  "queue.mean_service_sec": number;
  "convert.daily_limit": number;
  "convert.disabled": boolean;
  "daily_quiz.enabled": boolean;
  "daily_quiz.reward": number;
  "daily_quiz.monthly_cap": number;
  "daily_quiz.daily_budget": number;
  "daily_quiz.hour": number;
  "domla.enabled": boolean;
  "domla.price": number;
  "free_llm.daily.chat": number;
  "chat.enabled": boolean;
  "chat.price_per_message": number;
  "tests.enabled": boolean;
  "tests.price_per_attempt": number;
  "tests.first_attempt_free": boolean;
  "tests.questions_per_subject": number;
  "tests.minutes_per_subject": number;
  "tests.minutes_all": number;
  "tests.points_per_correct": number;
};

export type SettingKey = keyof SettingValues;

export type SettingType = "bool" | "int" | "number" | "tool_ids" | "text";

/** Where an effective value comes from. */
export type SettingSource = "db" | "env" | "default";

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export type SettingDef<K extends SettingKey = SettingKey> = {
  key: K;
  /** Uzbek card title on the settings page. */
  group: string;
  label: string;
  description: string;
  type: SettingType;
  /** Inclusive bounds for numeric types (shown in the edit dialog). */
  min?: number;
  max?: number;
  /** Env variable behind the default, when there is one. */
  envVar?: string;
  /** Strict check of an admin-supplied value; returns the normalized value. */
  validate(raw: unknown): Validation<SettingValues[K]>;
  /** Value used when no DB row exists (env, or the code default). */
  envDefault(): SettingValues[K];
};

/** Upper bound for plain counters: generous, but stops a typo like 1e15. */
const INT_MAX = 1_000_000_000;

function boolValidator(raw: unknown): Validation<boolean> {
  return typeof raw === "boolean" ? { ok: true, value: raw } : { ok: false, error: "Qiymat true yoki false bo'lishi kerak" };
}

function intValidator(min: number, max: number) {
  return (raw: unknown): Validation<number> => {
    if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
      return { ok: false, error: "Qiymat butun son bo'lishi kerak" };
    }
    if (raw < min || raw > max) {
      return { ok: false, error: `Qiymat ${min} dan ${max} gacha bo'lishi kerak` };
    }
    return { ok: true, value: raw };
  };
}

function numberValidator(min: number, max: number) {
  return (raw: unknown): Validation<number> => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return { ok: false, error: "Qiymat son bo'lishi kerak" };
    }
    if (raw < min || raw > max) {
      return { ok: false, error: `Qiymat ${min} dan ${max} gacha bo'lishi kerak` };
    }
    return { ok: true, value: raw };
  };
}

/**
 * A number on a fixed grid (`step`) inside `[min, max]`: the stored value is
 * snapped to the grid and cleaned of float noise (0.1 × 3 → 0.3, not
 * 0.30000000000000004), so what the admin typed is what is stored.
 */
function stepNumberValidator(min: number, max: number, step: number) {
  const inRange = numberValidator(min, max);
  return (raw: unknown): Validation<number> => {
    const checked = inRange(raw);
    if (!checked.ok) return checked;
    const n = checked.value / step;
    if (Math.abs(n - Math.round(n)) > 1e-9) {
      return { ok: false, error: `Qiymat ${String(step).replace(".", ",")} qadam bilan bo'lishi kerak` };
    }
    return { ok: true, value: Number((Math.round(n) * step).toFixed(6)) };
  };
}

/** Longest accepted multi-line text setting (the oferta requisites are a handful of lines). */
const TEXT_MAX = 2000;

/** Multi-line text: CRLF folded to LF, each line trimmed, blank runs collapsed; empty is allowed. */
function textValidator(raw: unknown): Validation<string> {
  if (typeof raw !== "string") return { ok: false, error: "Qiymat matn bo'lishi kerak" };
  if (raw.length > TEXT_MAX * 2) return { ok: false, error: `Matn ${TEXT_MAX} belgidan oshmasligi kerak` };
  const value = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (value.length > TEXT_MAX) return { ok: false, error: `Matn ${TEXT_MAX} belgidan oshmasligi kerak` };
  if (/[\u27e6\u27e7]/.test(value)) return { ok: false, error: "Matnda ⟦ ⟧ belgilari qolmasligi kerak" };
  return { ok: true, value };
}

/** Registry order, so a stored list is stable regardless of input order. */
const TOOL_ORDER: readonly ToolId[] = Object.keys(TOOL_BY_ID) as ToolId[];

function isToolId(v: unknown): v is ToolId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TOOL_BY_ID, v);
}

function toolIdsValidator(raw: unknown): Validation<ToolId[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "Qiymat vositalar ro'yxati bo'lishi kerak" };
  if (raw.length > TOOL_ORDER.length * 2) return { ok: false, error: "Ro'yxat juda uzun" };
  const unknownIds = raw.filter((v) => !isToolId(v));
  if (unknownIds.length) {
    const shown = unknownIds.slice(0, 5).map((v) => String(v).slice(0, 40)).join(", ");
    return { ok: false, error: `Noma'lum vosita: ${shown}` };
  }
  const set = new Set(raw as ToolId[]);
  return { ok: true, value: TOOL_ORDER.filter((id) => set.has(id)) };
}

/** `soumPerUsd()` may return a fraction from env; the setting is an integer. */
function soumPerUsdDefault(): number {
  return Math.max(1, Math.round(soumPerUsd()));
}

const FREE_GROUP = "Bepul AI";
const GEN_GROUP = "Generatsiya";
const FIN_GROUP = "Moliya";
const PRICING_GROUP = "Narxlar";
const QUEUE_GROUP = "Navbat va yuklama";
const OFERTA_GROUP = "Oferta";
const CONVERT_GROUP = "Fayl konvertatsiya";
const QUIZ_GROUP = "Kunlik savollar";
const DOMLA_GROUP = "Qattiqqo‘l domla";
const CHAT_GROUP = "AI chat";
const TESTS_GROUP = "Test ishlash";
/** AI chat price per message after the free ones: default 100 so'm; the cap stops a typo from charging a fortune per message. */
const CHAT_PRICE_DEFAULT = 100;
const CHAT_PRICE_MAX = 10_000;

type DailyKey = "free_llm.daily.outline" | "free_llm.daily.udk" | "free_llm.daily.rewrite" | "free_llm.daily.polish" | "free_llm.daily.chat";

function dailyCap<K extends DailyKey>(key: K, label: string, envVar: string, read: () => number): SettingDef<K> {
  return {
    key,
    group: FREE_GROUP,
    label,
    description: "Bitta foydalanuvchi uchun kunlik urinishlar soni (Toshkent kuni). 0 — bu amal bepul ishlamaydi.",
    type: "int",
    min: 0,
    max: INT_MAX,
    envVar,
    validate: intValidator(0, INT_MAX),
    envDefault: read,
  };
}

type Catalog = { [K in SettingKey]: SettingDef<K> };

const CATALOG: Catalog = {
  "free_llm.disabled": {
    key: "free_llm.disabled",
    group: FREE_GROUP,
    label: "Bepul AI o'chirilgan",
    description:
      "Yoqilsa reja, UDK, «Tuzatish» va «Hammasini tuzatish» darhol to'xtaydi — provayder chaqirilmaydi.",
    type: "bool",
    envVar: "FREE_LLM_DISABLED",
    validate: boolValidator,
    envDefault: () => env.freeLlm.disabled,
  },
  "free_llm.daily.outline": dailyCap("free_llm.daily.outline", "Reja: kunlik limit", "FREE_LLM_DAILY_OUTLINE", () => env.freeLlm.dailyOutline),
  "free_llm.daily.udk": dailyCap("free_llm.daily.udk", "UDK: kunlik limit", "FREE_LLM_DAILY_UDK", () => env.freeLlm.dailyUdk),
  "free_llm.daily.rewrite": dailyCap("free_llm.daily.rewrite", "«Tuzatish»: kunlik limit", "FREE_LLM_DAILY_REWRITE", () => env.freeLlm.dailyRewrite),
  "free_llm.daily.polish": dailyCap("free_llm.daily.polish", "«Hammasini tuzatish»: kunlik limit", "FREE_LLM_DAILY_POLISH", () => env.freeLlm.dailyPolish),
  "free_llm.daily.global": {
    key: "free_llm.daily.global",
    group: FREE_GROUP,
    label: "Umumiy kunlik limit",
    description: "Barcha foydalanuvchilar bo'yicha kunlik birliklar (vazn bilan) — bepul AI xarajatining shifti.",
    type: "int",
    min: 0,
    max: INT_MAX,
    envVar: "FREE_LLM_DAILY_GLOBAL",
    validate: intValidator(0, INT_MAX),
    envDefault: () => env.freeLlm.dailyGlobal,
  },
  "generation.paused": {
    key: "generation.paused",
    group: GEN_GROUP,
    label: "Barcha generatsiyalar to'xtatilgan",
    description: "Yoqilsa yangi generatsiya qabul qilinmaydi (pul yechilmasdan). Navbatdagi ishlar davom etadi.",
    type: "bool",
    validate: boolValidator,
    envDefault: () => false,
  },
  "generation.paused_tools": {
    key: "generation.paused_tools",
    group: GEN_GROUP,
    label: "To'xtatilgan vositalar",
    description: "Faqat shu vositalar uchun yangi generatsiya qabul qilinmaydi (pul yechilmasdan).",
    type: "tool_ids",
    validate: toolIdsValidator,
    envDefault: () => [],
  },
  "admin.wallet_confirm_threshold": {
    key: "admin.wallet_confirm_threshold",
    group: FIN_GROUP,
    label: "Hamyon tuzatishini tasdiqlash chegarasi",
    description: "Shu miqdordan katta hamyon tuzatishi uchun admin miqdorni qayta yozib tasdiqlaydi.",
    type: "int",
    min: 0,
    max: INT_MAX,
    validate: intValidator(0, INT_MAX),
    envDefault: () => 1_000_000,
  },
  "finance.soum_per_usd": {
    key: "finance.soum_per_usd",
    group: FIN_GROUP,
    label: "Dollar kursi (so'm)",
    description: "1 AQSh dollari necha so'm — AI xarajati va marjani hisoblash uchun (faqat admin hisobotlari).",
    type: "int",
    min: 1,
    max: 1_000_000,
    envVar: "SOUM_PER_USD",
    validate: intValidator(1, 1_000_000),
    envDefault: soumPerUsdDefault,
  },
  payment_bonus_percent: {
    key: "payment_bonus_percent",
    group: FIN_GROUP,
    label: "To'lov bonusi (%)",
    description:
      "Har bir to'langan to'ldirishga shu foiz bonus so'm qo'shiladi (har qanday summa, shiftsiz). 0 — bonus o'chirilgan. Yangi qiymat faqat keyingi to'lovlarga qo'llanadi.",
    type: "int",
    min: PAYMENT_BONUS_MIN,
    max: PAYMENT_BONUS_MAX,
    validate: intValidator(PAYMENT_BONUS_MIN, PAYMENT_BONUS_MAX),
    envDefault: () => PAYMENT_BONUS_DEFAULT,
  },
  "ambassador.percent": {
    key: "ambassador.percent",
    group: FIN_GROUP,
    label: "Do'st to'lovidan bonus (%)",
    description:
      "Taklif qilingan foydalanuvchi to'lov qilganda, uni taklif qilgan kishiga to'langan summaning shu foizi bonus so'm sifatida beriladi (to'lovchining o'z bonusi hisobga olinmaydi, qaytarilmaydi). 0 — o'chirilgan. Yangi qiymat faqat keyingi to'lovlarga qo'llanadi.",
    type: "int",
    min: AMBASSADOR_MIN,
    max: AMBASSADOR_MAX,
    validate: intValidator(AMBASSADOR_MIN, AMBASSADOR_MAX),
    envDefault: () => AMBASSADOR_DEFAULT,
  },
  "bonus.rating_points": {
    key: "bonus.rating_points",
    group: FIN_GROUP,
    label: "Baholash bonusi (bonus so'm)",
    description:
      "Ilovani baholab, fikr yozgan foydalanuvchiga BIR MARTA beriladigan bonus so'm. 0 — bonus o'chirilgan (baholash baribir qabul qilinadi). Yangi qiymat faqat keyingi baholarga qo'llanadi.",
    type: "int",
    min: 0,
    max: RATING_BONUS_MAX,
    validate: intValidator(0, RATING_BONUS_MAX),
    envDefault: () => RATING_BONUS_DEFAULT,
  },
  "oferta.gate_enabled": {
    key: "oferta.gate_enabled",
    group: OFERTA_GROUP,
    label: "Oferta qabul qilishni talab qilish",
    description:
      "Yoqilsa, ofertani qabul qilmagan (yoki eski tahrirni qabul qilgan) foydalanuvchi yangi ish yarata olmaydi va to'lov qila olmaydi; botda yangi foydalanuvchiga /start da oferta ko'rsatiladi. Rekvizitlar kiritilmaguncha yoqib bo'lmaydi. Adminlar bu tekshiruvdan ozod.",
    type: "bool",
    validate: boolValidator,
    envDefault: () => false,
  },
  "oferta.version": {
    key: "oferta.version",
    group: OFERTA_GROUP,
    label: "Oferta tahriri (versiya)",
    description: "Oshirilsa, hamma foydalanuvchi ofertani qayta qabul qilishi kerak bo'ladi (agar yuqoridagi tekshiruv yoqilgan bo'lsa). Matn o'zgarganda oshiring.",
    type: "int",
    min: 1,
    max: 1000,
    validate: intValidator(1, 1000),
    envDefault: () => 1,
  },
  "oferta.requisites": {
    key: "oferta.requisites",
    group: OFERTA_GROUP,
    label: "Ijrochi rekvizitlari",
    description:
      "Ofertaning 1.1 va 9-bandlariga chiqadi. Birinchi qator — Ijrochi nomi (YaTT/MChJ), keyingi qatorlar: STIR, manzil, bank hisob raqami, telefon. Oferta sahifasi va PDF shundan olinadi.",
    type: "text",
    validate: textValidator,
    envDefault: () => "",
  },
  "pricing.target_markup": {
    key: "pricing.target_markup",
    group: PRICING_GROUP,
    label: "Maqsadli ustama (×)",
    description: "Narx tavsiyasi shu ustamaga intiladi: o'rtacha narx ÷ to'liq xarajat.",
    type: "number",
    min: 1,
    max: 20,
    validate: numberValidator(1, 20),
    envDefault: () => 3,
  },
  "pricing.payment_fee_percent": {
    key: "pricing.payment_fee_percent",
    group: PRICING_GROUP,
    label: "To'lov komissiyasi (%)",
    description:
      "To'lov tizimi (Click va h.k.) har bir tushumdan oladigan foiz, qadam 0,1. «Narxlar» sahifasidagi marja hisobida tushumning FAQAT naqd pul bilan to'langan qismidan shuncha foiz ayriladi (bonus so'm to'lov tizimidan o'tmaydi). 0 — hisobga olinmaydi.",
    type: "number",
    min: 0,
    max: 10,
    validate: stepNumberValidator(0, 10, 0.1),
    envDefault: () => 0,
  },
  "queue.max_wait_sec": {
    key: "queue.max_wait_sec",
    group: QUEUE_GROUP,
    label: "Eng uzun kutish (soniya)",
    description:
      "Navbatdagi taxminiy kutish shundan oshsa, yangi ish PUL YECHILMASDAN «navbat to'la» deb rad etiladi. Kattaroq qiymat — ko'proq ish qabul qilinadi, lekin foydalanuvchi uzoqroq kutadi.",
    type: "int",
    min: 60,
    max: 7200,
    envVar: "QUEUE_MAX_WAIT_SEC",
    validate: intValidator(60, 7200),
    envDefault: () => env.queue.maxWaitSec,
  },
  "queue.user_max_inflight": {
    key: "queue.user_max_inflight",
    group: QUEUE_GROUP,
    label: "Bir foydalanuvchining bir vaqtdagi ishlari",
    description:
      "Navbatda yoki tayyorlanayotgan ishlar shu sondan ko'p bo'lsa, shu foydalanuvchining yangi ishi rad etiladi (pul yechilmaydi). Bitta foydalanuvchi hamma slotni band qilib qo'ymasligi uchun.",
    type: "int",
    min: 1,
    max: 20,
    envVar: "USER_MAX_INFLIGHT",
    validate: intValidator(1, 20),
    envDefault: () => env.queue.userMaxInflight,
  },
  "queue.total_slots": {
    key: "queue.total_slots",
    group: QUEUE_GROUP,
    label: "Ish bajaruvchi slotlar soni",
    description:
      "Barcha worker'lar bir vaqtda necha ishni bajaradi (worker soni × WORKER_CONCURRENCY). Faqat kutish vaqtini hisoblash uchun: haqiqiy slotlar soniga teng bo'lsin — kattasi navbatni yengil, kichigi qattiq ko'rsatadi.",
    type: "int",
    min: 1,
    max: 64,
    envVar: "QUEUE_TOTAL_SLOTS",
    validate: intValidator(1, 64),
    envDefault: () => env.queue.totalSlots,
  },
  "queue.mean_service_sec": {
    key: "queue.mean_service_sec",
    group: QUEUE_GROUP,
    label: "Bitta ishning o'rtacha davomiyligi (soniya)",
    description:
      "0 — avtomatik: oxirgi tugagan ishlarning o'rtachasidan hisoblanadi (ma'lumot kam bo'lsa 200 s). Qo'lda berilsa avtomatik hisob o'chadi. Kutish = navbatdagi ishlar × shu qiymat ÷ slotlar.",
    type: "int",
    min: 0,
    max: 1800,
    envVar: "QUEUE_MEAN_SERVICE_SEC",
    validate: intValidator(0, 1800),
    envDefault: () => env.queue.meanServiceSec,
  },
  "convert.daily_limit": {
    key: "convert.daily_limit",
    group: CONVERT_GROUP,
    label: "Kunlik limit (bitta foydalanuvchi)",
    description: "Bitta foydalanuvchi kuniga (Toshkent kuni) nechta fayl o'gira oladi. 0 — bepul konvertatsiya o'chirilgan.",
    type: "int",
    min: 0,
    max: 1000,
    validate: intValidator(0, 1000),
    envDefault: () => 20,
  },
  "convert.disabled": {
    key: "convert.disabled",
    group: CONVERT_GROUP,
    label: "Konvertatsiya o'chirilgan",
    description: "Yoqilsa fayl konvertatsiyasi darhol to'xtaydi (LibreOffice ham, rasm o'girish ham) — favqulodda tugma.",
    type: "bool",
    validate: boolValidator,
    envDefault: () => false,
  },
  "daily_quiz.enabled": {
    key: "daily_quiz.enabled",
    group: QUIZ_GROUP,
    label: "Kunlik savollar yoqilgan",
    description:
      "Yoqilsa, bot har kuni ertalab (Toshkent vaqti) so'nggi 30 kunda faol bo'lgan, obunani o'chirmagan va botni bloklamagan foydalanuvchilarga 3 ta mantiqiy savol yuboradi; /savol buyrug'i ham ishlaydi. O'chiq bo'lsa hech narsa yuborilmaydi va bonus berilmaydi. Savollarni docs/program-17/daily-quiz-questions.md da tekshirib chiqing.",
    type: "bool",
    validate: boolValidator,
    envDefault: () => false,
  },
  "daily_quiz.reward": {
    key: "daily_quiz.reward",
    group: QUIZ_GROUP,
    label: "3/3 uchun bonus (bonus so'm)",
    description: "Uchala savolga to'g'ri javob bergan foydalanuvchiga kuniga BIR MARTA beriladigan bonus so'm. 0 — savollar bor, bonus yo'q.",
    type: "int",
    min: 0,
    max: DQ_REWARD_MAX,
    validate: intValidator(0, DQ_REWARD_MAX),
    envDefault: () => DQ_REWARD_DEFAULT,
  },
  "daily_quiz.monthly_cap": {
    key: "daily_quiz.monthly_cap",
    group: QUIZ_GROUP,
    label: "Oylik bonus chegarasi (bitta foydalanuvchi)",
    description:
      "Bitta foydalanuvchi kunlik savollar uchun bir kalendar oyda (Toshkent) ko'pi bilan shuncha bonus so'm oladi. Chegara to'lsa foydalanuvchi o'ynay oladi, lekin bonus berilmaydi va unga shu aytiladi. 0 — bonus umuman berilmaydi.",
    type: "int",
    min: 0,
    max: DQ_MONEY_MAX,
    validate: intValidator(0, DQ_MONEY_MAX),
    envDefault: () => DQ_CAP_DEFAULT,
  },
  "daily_quiz.daily_budget": {
    key: "daily_quiz.daily_budget",
    group: QUIZ_GROUP,
    label: "Kunlik umumiy bonus fondi (bonus so'm)",
    description:
      "Bir kunda (Toshkent) hamma foydalanuvchilarga kunlik savollar uchun beriladigan bonus so'mning umumiy yuqori chegarasi. Fond tugasa g'oliblar «bugungi bonus fondi tugadi» xabarini oladi, bonus berilmaydi. 0 — bonus umuman berilmaydi.",
    type: "int",
    min: 0,
    max: DQ_MONEY_MAX,
    validate: intValidator(0, DQ_MONEY_MAX),
    envDefault: () => DQ_BUDGET_DEFAULT,
  },
  "daily_quiz.hour": {
    key: "daily_quiz.hour",
    group: QUIZ_GROUP,
    label: "Yuborish soati (Toshkent)",
    description: "Kunlik savollar xabari shu soatdan (Toshkent vaqti, 0-23) boshlab yuboriladi; foydalanuvchilar ketma-ket, sekin yuboriladi.",
    type: "int",
    min: 0,
    max: 23,
    validate: intValidator(0, 23),
    envDefault: () => DQ_HOUR_DEFAULT,
  },
  "domla.enabled": {
    key: "domla.enabled",
    group: DOMLA_GROUP,
    label: "Qattiqqo‘l domla yoqilgan",
    description:
      "O‘chirilsa yangi himoya boshlab bo‘lmaydi (/domla va /uz/domla «hozircha o‘chiq» deydi). Boshlangan himoyalar to‘lov qilingani uchun tugatiladi. Favqulodda tugma: AI va ovoz sarfi oshib ketsa.",
    type: "bool",
    validate: boolValidator,
    envDefault: () => true,
  },
  "domla.price": {
    key: "domla.price",
    group: DOMLA_GROUP,
    label: "Bitta himoya narxi (so‘m)",
    description:
      "Bitta himoya (5 ta savol) boshlanganda yechiladigan narx. Savollar tuzilmasa to‘liq qaytariladi. 0 — bepul. Faqat shu qiymat ishlatiladi (klient narx yubormaydi).",
    type: "int",
    min: 0,
    max: DOMLA_PRICE_MAX,
    validate: intValidator(0, DOMLA_PRICE_MAX),
    envDefault: () => DOMLA_PRICE_DEFAULT,
  },
  "free_llm.daily.chat": dailyCap("free_llm.daily.chat", "AI chat: kunlik bepul xabarlar", "FREE_LLM_DAILY_CHAT", () => env.freeLlm.dailyChat),
  "chat.enabled": {
    key: "chat.enabled",
    group: CHAT_GROUP,
    label: "AI chat yoqilgan",
    description: "O'chirilsa AI chat (sayt va bot) darhol to'xtaydi — provayder chaqirilmaydi, pul yechilmaydi.",
    type: "bool",
    validate: boolValidator,
    envDefault: () => true,
  },
  "chat.price_per_message": {
    key: "chat.price_per_message",
    group: CHAT_GROUP,
    label: "AI chat: bepul xabarlardan keyingi narx (so'm)",
    description:
      "Kunlik bepul xabarlar tugagach har bir xabar uchun yechiladigan so'm (bonus so'm ham ishlatiladi). 0 — kunlik bepul chegaradan keyin chat yopiladi. Yangi qiymat keyingi xabarlarga qo'llanadi.",
    type: "int",
    min: 0,
    max: CHAT_PRICE_MAX,
    validate: intValidator(0, CHAT_PRICE_MAX),
    envDefault: () => CHAT_PRICE_DEFAULT,
  },
  "tests.enabled": {
    key: "tests.enabled",
    group: TESTS_GROUP,
    label: "Test ishlash yoqilgan",
    description:
      "O‘chirilsa yangi urinish boshlab bo‘lmaydi (/test va /uz/tests «hozircha o‘chiq» deydi). Boshlangan urinishlar to‘lov qilingani uchun yakunlanadi. Standart: o‘chiq — egasi savollarni ko‘rib chiqqach yoqiladi.",
    type: "bool",
    validate: boolValidator,
    envDefault: () => TESTS_ENABLED_DEFAULT,
  },
  "tests.price_per_attempt": {
    key: "tests.price_per_attempt",
    group: TESTS_GROUP,
    label: "Bitta urinish narxi (so‘m)",
    description:
      "Urinish boshlanganda BIR marta yechiladi (bonus so‘m ham ishlatiladi); bitta fan ham, «Hammasi» ham shu narxda. 0 — bepul. Faqat shu qiymat ishlatiladi (klient narx yubormaydi).",
    type: "int",
    min: 0,
    max: TESTS_PRICE_MAX,
    validate: intValidator(0, TESTS_PRICE_MAX),
    envDefault: () => TESTS_PRICE_DEFAULT,
  },
  "tests.first_attempt_free": {
    key: "tests.first_attempt_free",
    group: TESTS_GROUP,
    label: "Birinchi urinish bepul",
    description: "Yoqilsa, foydalanuvchining eng birinchi test urinishi (bitta fan yoki «Hammasi») bepul bo‘ladi.",
    type: "bool",
    validate: boolValidator,
    envDefault: () => TESTS_FIRST_FREE_DEFAULT,
  },
  "tests.questions_per_subject": {
    key: "tests.questions_per_subject",
    group: TESTS_GROUP,
    label: "Fan bo‘yicha savollar soni",
    description: "Bitta fandan tasodifiy variantdagi shuncha savol beriladi. «Hammasi» = bu son × fanlar soni (standart 10 × 3 = 30). Yangi qiymat keyingi urinishlarga qo‘llanadi.",
    type: "int",
    min: 1,
    max: TESTS_PER_SUBJECT_MAX,
    validate: intValidator(1, TESTS_PER_SUBJECT_MAX),
    envDefault: () => TESTS_PER_SUBJECT_DEFAULT,
  },
  "tests.minutes_per_subject": {
    key: "tests.minutes_per_subject",
    group: TESTS_GROUP,
    label: "Bitta fan uchun vaqt (daqiqa)",
    description: "Server hisoblaydi: muddatdan keyingi javoblar hisobga olinmaydi va urinish o‘zi yakunlanadi.",
    type: "int",
    min: 1,
    max: TESTS_MINUTES_MAX,
    validate: intValidator(1, TESTS_MINUTES_MAX),
    envDefault: () => TESTS_MINUTES_SUBJECT_DEFAULT,
  },
  "tests.minutes_all": {
    key: "tests.minutes_all",
    group: TESTS_GROUP,
    label: "«Hammasi» uchun vaqt (daqiqa)",
    description: "Barcha fanlar birga bo‘lgan urinish uchun umumiy vaqt (standart 60).",
    type: "int",
    min: 1,
    max: TESTS_MINUTES_MAX,
    validate: intValidator(1, TESTS_MINUTES_MAX),
    envDefault: () => TESTS_MINUTES_ALL_DEFAULT,
  },
  "tests.points_per_correct": {
    key: "tests.points_per_correct",
    group: TESTS_GROUP,
    label: "To‘g‘ri javob uchun ball",
    description: "Har to‘g‘ri javobga shuncha ball (standart 1,1), noto‘g‘ri javob uchun ayirilmaydi. Urinish boshlanganda qiymat urinishga yoziladi.",
    type: "number",
    min: 0.1,
    max: TESTS_POINTS_MAX,
    validate: stepNumberValidator(0.1, TESTS_POINTS_MAX, 0.1),
    envDefault: () => TESTS_POINTS_DEFAULT,
  },
};

/** Catalog order = display order. */
export const SETTING_KEYS: readonly SettingKey[] = Object.keys(CATALOG) as SettingKey[];

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(CATALOG, key);
}

export function settingDef<K extends SettingKey>(key: K): SettingDef<K> {
  return CATALOG[key] as SettingDef<K>;
}

/** Validates an admin-supplied value for `key` (no DB access). */
export function validateSetting<K extends SettingKey>(key: K, raw: unknown): Validation<SettingValues[K]> {
  return settingDef(key).validate(raw);
}

/** Source of the fallback value: the env var is set, or only the code default applies. */
function fallbackSource(def: SettingDef): SettingSource {
  return def.envVar && (process.env[def.envVar] ?? "").trim() !== "" ? "env" : "default";
}

/**
 * Stored rows are re-validated on read: a row edited by hand, or a tool id
 * removed from the registry later, must not break product code. Unknown tool
 * ids are dropped from a stored list (the rest of the override still applies);
 * any other invalid row is ignored in favour of the env/default value.
 */
function parseStored<K extends SettingKey>(key: K, raw: unknown): Validation<SettingValues[K]> {
  const def = settingDef(key);
  const input = def.type === "tool_ids" && Array.isArray(raw) ? raw.filter(isToolId) : raw;
  return def.validate(input);
}

// ---------------------------------------------------------------------------
// Cache

type Row = { key: string; value: unknown; updated_by: string | null; updated_at: Date };

/** Validated effective overrides by key (rows that failed validation are left out). */
type Snapshot = Map<SettingKey, unknown>;

type Cache = {
  values: Snapshot | null;
  /** Epoch ms after which the snapshot is reloaded. */
  expiresAt: number;
  /** Bumped by `invalidateSettingsCache`; a load started earlier is discarded. */
  version: number;
  inflight: Promise<Snapshot | null> | null;
};

const TTL_MS = 15_000;
/** After a failed load: retry no sooner than this (do not hammer a sick DB). */
const ERROR_RETRY_MS = 5_000;

// On globalThis: Next dev reloads modules, and a second module instance must
// share the snapshot that `invalidateSettingsCache` clears.
const g = globalThis as typeof globalThis & { __slaydxSettingsCache?: Cache };

function cache(): Cache {
  return (g.__slaydxSettingsCache ??= { values: null, expiresAt: 0, version: 0, inflight: null });
}

/** Rows are validated once per load, so a bad row logs every 15 s, not per request. */
function toSnapshot(rows: Row[]): Snapshot {
  const out: Snapshot = new Map();
  for (const r of rows) {
    if (!isSettingKey(r.key)) continue; // a key removed from the catalog: ignored
    const parsed = parseStored(r.key, r.value);
    if (parsed.ok) out.set(r.key, parsed.value);
    else log("warn", "[settings] bazadagi qiymat yaroqsiz — env/standart ishlatiladi", { setting: r.key, error: parsed.error });
  }
  return out;
}

async function loadSnapshot(): Promise<Snapshot | null> {
  const c = cache();
  // Fresh snapshot, or backing off after an error (then `values` may be null).
  if (Date.now() < c.expiresAt) return c.values;
  if (c.inflight) return c.inflight;
  const version = c.version;
  const p: Promise<Snapshot | null> = query<Row>("SELECT key, value, updated_by, updated_at FROM app_settings").then(
    (rows) => {
      const snap = toSnapshot(rows);
      if (c.version === version) {
        c.values = snap;
        c.expiresAt = Date.now() + TTL_MS;
      }
      return snap;
    },
    (err: unknown) => {
      log("warn", "[settings] o'qib bo'lmadi — oxirgi qiymatlar yoki env ishlatiladi", { err });
      if (c.version === version) c.expiresAt = Date.now() + ERROR_RETRY_MS;
      return c.values;
    },
  );
  c.inflight = p;
  void p.finally(() => {
    if (c.inflight === p) c.inflight = null;
  });
  return p;
}

/**
 * Drops the snapshot freshness so the next read reloads. Call after the
 * transaction that wrote `app_settings` has committed. The last snapshot is
 * kept only as the fallback for a failing reload.
 */
export function invalidateSettingsCache(): void {
  const c = cache();
  c.version++;
  c.expiresAt = 0;
  c.inflight = null;
}

function effective<K extends SettingKey>(key: K, row: Row | undefined): { value: SettingValues[K]; source: SettingSource } {
  const def = settingDef(key);
  if (row) {
    const parsed = parseStored(key, row.value);
    if (parsed.ok) return { value: parsed.value, source: "db" };
  }
  return { value: def.envDefault(), source: fallbackSource(def) };
}

/** Effective value of `key`. Never throws because of the database. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
  const snap = await loadSnapshot();
  if (snap?.has(key)) {
    const v = snap.get(key) as SettingValues[K];
    // A copy, so a caller cannot mutate the shared snapshot.
    return (Array.isArray(v) ? [...v] : v) as SettingValues[K];
  }
  return settingDef(key).envDefault();
}

// Cost RECORDING (TTS priced in so'm) converts with the same rate the admin cost pages show: this setting.
registerSoumPerUsdSource(() => getSetting("finance.soum_per_usd"));

/**
 * Effective value of `key` read inside the caller's transaction straight from
 * `app_settings` (no cache, no lock). A money path that must apply the value in
 * force at that moment — not a snapshot up to 15 s old — uses this
 * (`payment-bonus.ts`). An invalid row falls back to env/default, as on reads.
 */
export async function getSettingInTx<K extends SettingKey>(client: Pick<PoolClient, "query">, key: K): Promise<SettingValues[K]> {
  const res = await client.query<Row>("SELECT key, value, updated_by, updated_at FROM app_settings WHERE key = $1", [key]);
  return effective(key, res.rows[0]).value;
}

// ---------------------------------------------------------------------------
// Admin listing and writes

export type SettingItem<K extends SettingKey = SettingKey> = {
  key: K;
  group: string;
  label: string;
  description: string;
  type: SettingType;
  min: number | null;
  max: number | null;
  value: SettingValues[K];
  source: SettingSource;
  /** What applies without a DB override (env value, or the code default). */
  envValue: SettingValues[K];
  /** `admin_accounts.id` of the last writer (null when no row, or the admin was removed). */
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
};

type ListRow = Row & { updated_by_name: string | null };

/**
 * Every catalog key with its effective value and provenance. Reads the DB
 * directly (not the cache) so the admin page is always current; a DB error
 * propagates here — the admin should see it, not stale data.
 */
export async function listSettings(): Promise<SettingItem[]> {
  const rows = await query<ListRow>(
    `SELECT s.key, s.value, s.updated_by, s.updated_at, u.name AS updated_by_name
       FROM app_settings s
       LEFT JOIN admin_accounts a ON a.id = s.updated_by
       LEFT JOIN users u ON u.id = a.user_id`,
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTING_KEYS.map((key) => {
    const def = settingDef(key);
    const row = byKey.get(key);
    const eff = effective(key, row);
    const fromDb = eff.source === "db" && row;
    return {
      key,
      group: def.group,
      label: def.label,
      description: def.description,
      type: def.type,
      min: def.min ?? null,
      max: def.max ?? null,
      value: eff.value,
      source: eff.source,
      envValue: def.envDefault(),
      updatedBy: fromDb ? (row.updated_by ?? null) : null,
      updatedByName: fromDb ? (row.updated_by_name ?? null) : null,
      updatedAt: fromDb ? new Date(row.updated_at).toISOString() : null,
    };
  });
}

/** Audit snapshot (§8): only the value and its provenance, never more. */
export type SettingSnapshot<K extends SettingKey = SettingKey> = { value: SettingValues[K]; source: SettingSource };

function requireKey(key: string): SettingKey {
  if (!isSettingKey(key)) throw new ApiError("Bunday sozlama yo'q", 404);
  return key;
}

async function snapshotInTx<K extends SettingKey>(client: PoolClient, key: K): Promise<SettingSnapshot<K>> {
  const res = await client.query<Row>(
    "SELECT key, value, updated_by, updated_at FROM app_settings WHERE key = $1 FOR UPDATE",
    [key],
  );
  return effective(key, res.rows[0]);
}

/**
 * Cross-key rule of the oferta gate: it cannot be switched on while the Ijrochi requisites are empty
 * (the owner has not supplied them; the public text would have a hole), and the requisites cannot be
 * emptied while the gate is on. Evaluated against the values in force inside the caller's transaction.
 */
async function assertOfertaConsistent(client: PoolClient, key: SettingKey, value: unknown): Promise<void> {
  if (key !== "oferta.gate_enabled" && key !== "oferta.requisites") return;
  // Serialises the two oferta keys (their rows may not exist yet, so no row lock): "enable" and "clear the
  // requisites" can never both pass their check against the same old state. Released at COMMIT/ROLLBACK.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('slaydx:oferta-settings'))");
  if (key === "oferta.gate_enabled" && value === true) {
    const requisites = await getSettingInTx(client, "oferta.requisites");
    if (!requisites.trim()) throw new ApiError("Avval Ijrochi rekvizitlarini kiriting — ularsiz ofertani yoqib bo'lmaydi", 400);
  }
  if (key === "oferta.requisites" && typeof value === "string" && !value.trim()) {
    if (await getSettingInTx(client, "oferta.gate_enabled")) {
      throw new ApiError("Oferta yoqilgan — rekvizitlarni bo'sh qoldirib bo'lmaydi", 400);
    }
  }
}

/**
 * Validates and stores an override inside the caller's transaction and
 * returns before/after snapshots for the audit row. Throws `ApiError` 404 for
 * an unknown key and 400 for an invalid value. The caller must call
 * `invalidateSettingsCache()` after COMMIT.
 */
export async function setSettingInTx(
  client: PoolClient,
  key: string,
  rawValue: unknown,
  adminId: string | number | null,
): Promise<{ key: SettingKey; before: SettingSnapshot; after: SettingSnapshot }> {
  const k = requireKey(key);
  const checked = validateSetting(k, rawValue);
  if (!checked.ok) throw new ApiError(checked.error, 400);
  await assertOfertaConsistent(client, k, checked.value);
  const before = await snapshotInTx(client, k);
  await client.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [k, toJsonb(checked.value), adminId === null ? null : String(adminId)],
  );
  return { key: k, before, after: { value: checked.value, source: "db" } };
}

/**
 * Removes the override (back to env/default) inside the caller's transaction.
 * Same contract as `setSettingInTx`; resetting a key without a row is a no-op
 * whose before and after are equal.
 */
export async function resetSettingInTx(
  client: PoolClient,
  key: string,
): Promise<{ key: SettingKey; before: SettingSnapshot; after: SettingSnapshot }> {
  const k = requireKey(key);
  if (k === "oferta.requisites") await assertOfertaConsistent(client, k, "");
  const before = await snapshotInTx(client, k);
  await client.query("DELETE FROM app_settings WHERE key = $1", [k]);
  return { key: k, before, after: effective(k, undefined) };
}
