/**
 * Test qatlami uchun hermetik muhit — `npm test` `--import` bilan shu faylni
 * HAR bir test fayl processida (node:test har faylni alohida child
 * process qilib ishga tushiradi, lekin bitta `execArgv`, ya'ni `--import`
 * ham) eng birinchi bo'lib yuklaydi.
 *
 * Sabab (prod-readiness audit C40, DEPS-03 doirasidagi «2 ma'lum
 * muvaffaqiyatsizlik»): `npm test` skripti qulaylik uchun
 * `--env-file-if-exists=.env.local` bilan ishga tushadi — dasturchining
 * haqiqiy provayder kalitlari (Pexels/Pixabay/Gemini/...) shu yerdan
 * `process.env`ga tushib qoladi. Testlarning ko'pi bunga qarshi o'zi
 * ehtiyot chorasi ko'radi (masalan `GEMINI_API_KEY`ni saqlab-o'chiradi),
 * lekin `tests/document.test.mts`dagi `slideImageEnv()` yordamchisi faqat
 * `FAL_KEY`/`GEMINI_API_KEY`/`XAI_API_KEY`ni tozalaydi — `PEXELS_API_KEY`/
 * `PIXABAY_API_KEY` haqiqiy qiymati bilan qoladi. Natijada "FAL bloklangan"
 * ssenariysida test fetch'ni faqat FAL uchun kutadi, aslida kod haqiqiy
 * kalit borligi sababli Pexels/Pixabay'ga ham murojaat qiladi — testlar
 * `.env.local` bor/yo'qligiga qarab yashil/qizil bo'lib qoladi.
 *
 * Tuzatish shu yerda, HARNESS darajasida: barcha tashqi provayder
 * kalitlari/marshrutlash o'zgaruvchilari testlar boshlanishidan OLDIN
 * o'chiriladi. Har bir test o'ziga kerak bo'lgan qiymatni ANIQ o'zi
 * qo'yadi (kod bazasida allaqachon qat'iy amal qilinadigan naqsh) — bu
 * fayl faqat o'sha naqshni "standart holat"ga aylantiradi, yagona kalit
 * yoki test faylini o'zgartirmaydi.
 *
 * `DATABASE_URL`/`SESSION_SECRET`/`APP_URL` kabi infra o'zgaruvchilari
 * ATAYLAB tegilmaydi — ular provayder emas, va ba'zi testlar (masalan
 * navbat/baza testlari) ularni `.env.local`dan yoki `DATABASE_URL=...`
 * prefiksidan olishga tayanadi (`audit/FIXER-BRIEF.md` §3).
 */
const PROVIDER_ENV_KEYS = [
  // LLM matn provayderlari (asosiy + Maqola 2 rol zanjiri)
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_IMAGE_MODEL",
  "GEMINI_IMAGE_SIZE",
  "GEMINI_THINKING_BUDGET",
  "XAI_API_KEY",
  "XAI_MODEL",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "LLM_WRITER",
  "LLM_JUDGE",
  "LLM_RESEARCHER",
  "LLM_FAST",
  // Rasm provayderlari (fal.ai + bepul stock zanjiri)
  "FAL_KEY",
  "FAL_MODEL",
  "FAL_MODEL_PREMIUM",
  "FAL_STEPS_PREMIUM",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  // Ilmiy manba qidiruvi (Maqola 2)
  "OPENALEX_API_KEY",
  "OPENALEX_MAILTO",
  "CROSSREF_MAILTO",
  "GOOGLE_BOOKS_API_KEY",
  // Ovoz (AUDIT-22: podkast/tabriknoma)
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "AISHA_API_KEY",
  "TTS_GEMINI_MODEL",
  "TTS_VOICE_UZ",
  "TTS_VOICE_RU",
  "TTS_VOICE_EN",
  // To'lov provayderlari
  "CLICK_SERVICE_ID",
  "CLICK_MERCHANT_ID",
  "CLICK_SECRET_KEY",
  "CLICK_MERCHANT_USER_ID",
  "PAYME_MERCHANT_ID",
  "PAYME_KEY",
  "PAYME_TEST_KEY",
  // Telegram bot (login/webhook)
  "TELEGRAM_BOT_TOKEN",
] as const;

for (const key of PROVIDER_ENV_KEYS) delete process.env[key];
