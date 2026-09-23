/**
 * Foydalanuvchiga ko'rsatiladigan xato matni (AUDIT prod-readiness C31:
 * BEA-09, EXT-12).
 *
 * HTTP qatlami ichki xabarni allaqachon yashiradi (`api.ts serverError`),
 * lekin ish (worker) yo'li yashirmasdi: har qanday `e.message` —
 * pg («invalid input syntax for type json»), tarmoq («connect ECONNREFUSED
 * 10.0.0.5:5432»), sharp/docx, `TypeError`, provayder tanasi (Google:
 * «Consumer 'api_key:AIza…' has been suspended») — `generations.error` ga
 * (ko'ruvchi uni aynan ko'rsatadi) va refund izohiga (`/api/users/me`)
 * tushardi.
 *
 * Qoida: dvigatellar ATAYIN yozgan o'zbekcha xabarlar (sifat darvozasi,
 * «Fayl bo'sh chiqdi — qayta urinib ko'ring», «Tarjima qilinadigan matn
 * topilmadi…») o'zgarmaydi — ular foydalanuvchi uchun yozilgan. Faqat
 * kutubxona/provayder matni qisqa umumiy o'zbekcha matnga aylanadi;
 * tafsilot jurnalda qoladi (`log.ts`, ish id si bilan).
 *
 * Dvigatellar hali oddiy `Error` tashlaydi (ularni bu paket o'zgartirmaydi),
 * shuning uchun «atayin yozilgan» belgisi — matn shakli: o'zbekcha va
 * texnik iz (URL, JSON, SQL/tarmoq atamasi, kalit) yo'q. Yangi kod aniq
 * bo'lishi uchun `UserFacingError` tashlasin.
 */

/** Matni foydalanuvchiga AYNAN ko'rsatiladigan xato. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export const GENERIC_JOB_ERROR = "Yaratishda xatolik yuz berdi. Kredit qaytariladi — qayta urinib ko‘ring.";
export const TIMEOUT_JOB_ERROR = "Ish vaqti tugadi. Kredit qaytariladi — qayta urinib ko‘ring.";
export const VOICE_JOB_ERROR = "Ovoz yaratilmadi. Kredit qaytariladi — qayta urinib ko‘ring.";

const MAX_LEN = 300;

/** Nomi bo'yicha — har doim kutubxona/ichki xato (matni foydalanuvchi uchun yozilmagan). */
const LIBRARY_NAMES = new Set([
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
  "DatabaseError",
  "FetchError",
  "SystemError",
]);

/** Texnik iz: URL, JSON/HTML, stack, kalit, SQL/tarmoq/HTTP atamalari. */
const TECH_WORDS =
  /https?:\/\/|[{}<>\\]|\bat\s+\S+\s*\(|AIza|\bsk-|\bxai-|\b(api[_-]?key|apikey|bearer|authorization|password|secret|consumer|permission denied|forbidden|unauthorized|billing|syntax|relation|column|constraint|violates|duplicate key|undefined|null|NaN|ECONN\w*|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket|fetch failed|statement timeout|timeout exceeded|cannot read|is not a function|unexpected token|invalid input|unsupported|buffer)\b/i;
/** Ichki dasturchi prefiksi: `[llm] …`, `planWork: …`, `slide-progress: …`, HTTP status bilan boshlanish. */
const TECH_PREFIX = /^\s*(\[|[a-z]+[A-Z]\w*:|[a-z]+(-[a-z]+)+:|[45]\d\d\b|HTTP\b)/;
/** O'zbekcha matn belgisi: o'/g' (har xil apostrof) yoki tez-tez uchraydigan so'z. */
const UZBEK =
  /[oOgG][ʻ‘'’`][a-zA-Z]|\b(qayta|topilmadi|yaratilmadi|yozilmadi|tugadi|sozlanmagan|kredit|qaytaril\w*|emas|kerak|juda|hujjat\w*|sahifa\w*|vosita\w*|xatolik|urinib|yetmadi|yozing|tavsif\w*)\b|noma[ʻ‘'’]lum/i;

/** Matn foydalanuvchiga ko'rsatishga yaroqlimi (o'zbekcha va texnik izsiz). */
export function isUserSafeText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 1_000) return false;
  if (TECH_WORDS.test(t) || TECH_PREFIX.test(t)) return false;
  return UZBEK.test(t);
}

function hasLibraryShape(e: Error): boolean {
  const x = e as Error & { code?: unknown; severity?: unknown; routine?: unknown; syscall?: unknown; errno?: unknown };
  if (LIBRARY_NAMES.has(e.name)) return true;
  // pg: SQLSTATE (5 belgi) yoki `severity`/`routine`; Node tizim xatosi: `syscall`/`errno`/`E…` kodi.
  if (typeof x.code === "string" && (/^[0-9A-Z]{5}$/.test(x.code) || /^E[A-Z_]{2,}$/.test(x.code))) return true;
  return x.severity !== undefined || x.routine !== undefined || x.syscall !== undefined || x.errno !== undefined;
}

/**
 * Foydalanuvchiga ko'rsatiladigan qisqa o'zbekcha matn.
 *
 * `e` — xato obyekti yoki (bazadagi eski qator uchun) matn. Xom tafsilotni
 * chaqiruvchi jurnalga O'ZI yozadi — bu funksiya faqat tanlaydi.
 */
export function userMessage(e: unknown, fallback: string = GENERIC_JOB_ERROR): string {
  if (e instanceof UserFacingError) return e.message.slice(0, MAX_LEN);
  if (typeof e === "string") return isUserSafeText(e) ? e.trim().slice(0, MAX_LEN) : fallback;
  if (!(e instanceof Error)) return fallback;
  // `lib/generation/llm/chain.ts DeadlineError`, `tts/types.ts TtsError` — nomi bilan
  // (import qilinmaydi: bu modul dvigatelga bog'lanmasin).
  if (e.name === "DeadlineError") return TIMEOUT_JOB_ERROR;
  if (e.name === "TtsError") return VOICE_JOB_ERROR;
  if (hasLibraryShape(e)) return fallback;
  return isUserSafeText(e.message) ? e.message.trim().slice(0, MAX_LEN) : fallback;
}

/** Xatodagi provayder nomi (TTS/LLM xatolari `provider`/`role` maydonini olib yuradi) — jurnal uchun. */
export function providerOf(e: unknown): string | undefined {
  const p = (e as { provider?: unknown } | null)?.provider;
  return typeof p === "string" && p ? p : undefined;
}
