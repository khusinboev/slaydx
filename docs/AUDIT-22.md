# AUDIT-22 — TTS (podkast, tabriknoma, tinglash o'yini) + interaktiv runtime (saralash o'yini; test/krossvord/flesh karta 2-bosqichi)

Umumiy dastur va egasi qarorlari: `docs/AUDIT-20.md` §1. Tadqiqot: `docs/research/{tts,podcast,greeting,listening-game,sorting-game}.md`.

## 1. Reja (AUDIT-20 §1 dan, 2026-09-17)

### 3-dastur (AUDIT-22) — TTS + interaktiv runtime

- **TTS adapteri** `lib/generation/tts/{types,google,azure,elevenlabs,chain}.ts` (`llm/chain.ts` naqshi: `TTS_VOICE=provider:voice,…` zanjir, `synthesize(text,{lang,voice,speed}) → {mp3, seconds, chars}`, `TtsMeter` → `cost_json`, `env.ts` kalitlari, `compose-env` qulfi); uzun matn 4 500 belgili bo'laklar; MP3 birlashtirish — CBR frame konkatenatsiya (`tts/mp3.ts`), aks holda `ffmpeg` (tadqiqotdan keyin).
- **Vositalar** (Media, 4 000): `podcast` (mavzu/matn/fayl, 1–5 daq, ssenariy → 1–2 ovoz → MP3), `greeting` (kimga/sabab/til/1–4 daq); `ToolConfig.output`/`Generation.format` += `mp3`, `ViewerKind "audio"` → `AudioViewer.tsx` (`<audio src=…/file?inline=1>` + transkript), model `AcademicDoc.audio = {script[{speaker,text}], seconds, voice}`, `delivered` soniya.
- **Interaktiv runtime**: `021_games.sql` — `game_sessions(id, generation_id, user_id, token unique, kind, settings_json, expires_at)` + `game_results(id, session_id, player_name, score, total, answers_json, seconds, ip_hash)`; ochiq `app/o/[token]/page.tsx` (noindex) + `app/api/o/[token]` (GET — `publicGameView(doc)`: to'g'ri javob CHIQMAYDI; `submit` POST `checkOrigin` + `rateLimit` 30/daq, ball serverda); egasi `POST /api/generations/[id]/share`, `results` (jadval + CSV), `ResultView` «O'yin havolasi + QR» (`qrcode` npm, SVG); `components/game/{Player,Sorting,Listening,Quiz,Crossword,Cards}.tsx` + `lib/game/engine.ts` (sof holat mashinasi, jsdom testlari). Saralash (`sorting`, 2 000): `game.sorting = {categories[2–20]{name, items[]}}`, bosma versiya jadval. Tinglash (`listening`, 2 000): so'z/ibora → TTS parchalar (`putAssetBytes`), o'yinchi variant tanlaydi.
- WP (≈9–10 kun): R0 lead — TTS lab/egasi tanlovi, migratsiya, `mp3`, `ToolGroup "media"` (1); WP-A opus — `tts/**` + podcast/greeting + `AudioViewer` (2.5); WP-B opus — sessions/results + ochiq API + `publicGameView` (javob sizmasligi — mutatsiya majburiy) (2); WP-C sonnet — o'yinchi UI 5 tur + `lib/game/engine.ts` (2.5); WP-D sonnet — saralash/tinglash dvigateli + bosma (1.5); R lead — QR/natijalar paneli, jonli, smoke (havola → ism → o'yin → natija egasida), deploy (1.5).


### Aniqlashtirishlar (tadqiqotdan)
- **TTS** (`tts.md`): o'zbek ovozi faqat **Azure** (`uz-UZ-MadinaNeural`/`SardorNeural`) va mahalliy **Aisha AI** (1 so'm/belgi, WAV, ≤1 000 belgi/so'rov); Google/ElevenLabs/Gemini TTS da yo'q; zanjir Azure → Aisha → Gemini (bepul sinov); bo'laklash ≤900 belgi; MP3 birlashtirish bitta provayder ichida CBR-xavfsiz, aralash/WAV → ffmpeg (worker Dockerfile) yoki WASM; `TtsMeter` → `cost_json`; kalitlar: `AZURE_SPEECH_KEY`+`AZURE_SPEECH_REGION`, `AISHA_API_KEY` (egasidan), `GEMINI_API_KEY` bor. **TTS lab** (`scripts/tts-lab.mts`) kalitlar kelgach.
- **Podkast/tabriknoma** (`podcast.md`, `greeting.md`): ssenariy intro/3 blok/outro, 150 so'z/daq ishchi qiymat; tabriknoma janrlari; ovoz tanlanmaydi (til → ovoz jadvali); fon musiqasi yo'q (litsenziya); narx 4 000 tekis.
- **Saralash** (`sorting-game.md`): `categoryCount` 2–6 × `itemsPerCategory` 3–8; ball = to'g'ri/jami, leaderboard yo'q; bosma jadval versiyasi. **Tinglash** (`listening-game.md`): so'z/ibora → 3–4 variant, ona til × o'rganiladigan til; TTS parchalar aktivga. Narx 2 000 tekis.
- **Runtime**: `021_games.sql` (`game_sessions`, `game_results`), ochiq `app/o/[token]` (noindex) + `app/api/o/[token]` (`publicGameView` — javob sizmaydi; `submit` rate-limit, ball serverda), egasi `share`/`results` (CSV), QR (`qrcode` npm), `components/game/*` + `lib/game/engine.ts`; test/krossvord/flesh karta interaktiv 2-bosqichi shu runtime orqali.
- Tartib: **R0** substrat (migratsiya, `ToolGroup media`, 4 vosita, `output mp3`, `ViewerKind audio`, runtime jadvallari/route skeleti) → **WP-B** runtime server + ochiq API (kalitsiz) → **WP-C** o'yinchi UI → **WP-D** saralash dvigateli + bosma → **WP-A** TTS adapterlari + podkast/tabriknoma/tinglash (kalitlar kelgach; kalitsiz — adapter interfeysi + mock testlar) → R jonli/smoke/deploy.

## 5. Bajarilish yozuvi

