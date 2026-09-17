-- INTERAKTIV O'YIN RUNTIME (AUDIT-22 R0): ochiq havola + natijalar.
--
-- Egasi qarorlari (AUDIT-20 §1, band 8): o'yinchi tomoni LOGINSIZ —
-- ochiq havola + QR, o'quvchi faqat ismini kiritadi; natijalar
-- O'QITUVCHIGA (jadval + CSV); jonli reyting/real-time YO'Q.
--
-- Shundan ikkita jadval kelib chiqadi.
--
-- 1. `game_sessions` — bitta HAVOLA (bitta generatsiyaning bitta
--    tarqatilishi). Nega generatsiyaning o'zida `token` ustuni emas:
--    o'qituvchi ayni o'yinni ikki sinfga ikki havola bilan berishi va
--    natijalarni ALOHIDA ko'rishi kerak; bitta ustun buni qila olmasdi.
--
--    `kind` — `publicGameKindOf` qaytargan OCHIQ o'yin turi (`quiz`,
--    `crossword`, `flashcards`, `sorting`, `listening`), vosita id si
--    emas: test `teacher/` oilasida, lekin runtime uchun u «quiz».
--
--    `settings_json` — havolaga xos sozlamalar (masalan urinishlar
--    soni, ko'rsatiladigan ism formati). R0 da bo'sh obyekt; ustun
--    HOZIR qo'shiladi, chunki keyin `ALTER TABLE` + eski qatorlarni
--    to'ldirish kerak bo'lardi.
--
--    `expires_at` — havola MUDDATLI (standart 30 kun, `game-sessions.ts`).
--    Muddati o'tgan havola 404 beradi: tarqalib ketgan havola abadiy
--    ochiq qolmasin.
--
-- 2. `game_results` — bitta O'YINCHINING bitta urinishi. `player_name`
--    o'quvchi kiritgan ism (≤40 belgi, route kesadi) — hech qanday
--    shaxsiy ma'lumot so'ralmaydi.
--
--    `ip_hash` — IP NING O'ZI EMAS, xeshi: spamni ko'rish uchun yetarli,
--    lekin o'quvchining manzilini saqlamaydi (loginsiz xizmatda bu
--    maxfiylik talabi).
--
--    `answers_json` — element id → to'g'rimi (`scoreAnswers` natijasi) va
--    urinishlar soni; o'qituvchi «qaysi savolda ko'pchilik yiqildi» ni
--    shu ustundan ko'radi.
--
-- Ikkala jadval ham generatsiya bilan birga o'chadi (`ON DELETE CASCADE`):
-- o'qituvchi hujjatni o'chirsa, uning havolasi ham, natijalari ham
-- qolmasligi kerak.

CREATE TABLE IF NOT EXISTS game_sessions (
  -- Id NI DASTUR BERADI (`randomUUID`) — `generations` bilan bir xil
  -- qoida: `gen_random_uuid()` Postgres versiyasiga/kengaytmaga bog'liq,
  -- bu yerda esa hech qanday kengaytma talab qilinmasligi kerak.
  id            UUID PRIMARY KEY,
  generation_id UUID NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Egasining «O'yin havolasi» paneli: bitta generatsiyaning havolalari.
CREATE INDEX IF NOT EXISTS game_sessions_generation_idx ON game_sessions (generation_id);
-- «Mening havolalarim» va tozalash (`purgeExpiredSessions`).
CREATE INDEX IF NOT EXISTS game_sessions_user_idx ON game_sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_results (
  id          UUID PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- O'yinga sarflangan vaqt (soniya) — o'qituvchi uchun «kim shoshdi».
  seconds     INTEGER NOT NULL DEFAULT 0,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Natijalar jadvali DOIM bitta sessiya bo'yicha va vaqt tartibida
-- o'qiladi; indekssiz u butun jadvalni skanerlardi.
CREATE INDEX IF NOT EXISTS game_results_session_idx ON game_results (session_id, created_at DESC);
