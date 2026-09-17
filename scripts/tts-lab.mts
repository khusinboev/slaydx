/**
 * TTS LABORATORIYASI (AUDIT-22 WP-A) — `docs/research/tts.md` §4.
 *
 * Provayderlarni AYNI matnda solishtiradi: har biri bitta ~60 soniyalik
 * o'zbek namunasini aytadi, natija MP3 bo'lib diskka yoziladi va
 * konsolga jadval chiqadi (soniya / belgi / narx / latensiya). Bazaga
 * yozmaydi, navbatga qo'ymaydi — `image-lab.mts` bilan ayni naqsh:
 * haqiqiy adapterlar TO'G'RIDAN-TO'G'RI chaqiriladi.
 *
 * KALIT YO'Q bo'lsa skript YIQILMAYDI: provayder «sozlanmagan» deb
 * belgilanadi va qolganlari ishlaydi. Shuning uchun uni bugun ham
 * (kalitlarsiz) ishga tushirib, quvurning butunligini ko'rish mumkin.
 *
 * Foydalanish:
 *   npm run tts-lab                 — barcha provayderlar, uz
 *   npm run tts-lab -- --lang ru    — boshqa til
 *   npm run tts-lab -- --provider azure
 *
 * Og'ir buyruq (tarmoq I/O + parallel so'rov) — CLAUDE.md qoidasi
 * bo'yicha `scripts/heavy.sh` ostida yurgiziladi.
 *
 * CHIQISH JOYI: `eval-out/tts/` (tadqiqotdagi `scratch/tts/` emas) —
 * `eval-out/` allaqachon `.gitignore` da, ya'ni audio fayllar gitga
 * tushmaydi. Kalitlar ham hech qayerga yozilmaydi.
 *
 * EGASI QANDAY BAHOLAYDI (hisobot §4, 5 mezon, EShITIB): talaffuz
 * to'g'riligi (ʻ/ʼ tovushlar), tabiiylik, tezlik/pauza mosligi, ovoz
 * yoqimliligi, narx/sifat nisbati.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { makeAzureTts } from "../lib/generation/tts/azure.ts";
import { makeAishaTts } from "../lib/generation/tts/aisha.ts";
import { makeGeminiTts } from "../lib/generation/tts/gemini.ts";
import { chunkText, ttsCostUsd, TTS_LIMITS, type TtsProvider } from "../lib/generation/tts/types.ts";
import { ttsGroups } from "../lib/generation/tts/chain.ts";
import { mergeToMp3, mp3Seconds } from "../lib/generation/tts/mp3.ts";

/* ────────────────────────── namuna ────────────────────────── */

/**
 * ~60 soniyalik o'zbek namunasi (`tts.md` §4).
 *
 * Ataylab UCH xil material aralashgan: podkast ohangi, qo'shtirnoq
 * ichidagi savol va tabrik jumlasi — ikkala vosita ham shu bitta
 * namunada eshitiladi. `ʻ`/`'` belgilar SAQLANGAN: aynan ular
 * talaffuzni ajratadi.
 */
export const SAMPLE_UZ = [
  "Assalomu alaykum va SlaydX podkastiga xush kelibsiz!",
  "Bugun biz o'quvchilarning eng ko'p so'raydigan savoli —",
  "\"sun'iy intellekt yordamida qanday qilib o'z dars materialini tayyorlash mumkin\" — haqida gaplashamiz.",
  "Ko'pchilik o'ylaydiki, bu uchun dasturlashni bilish kerak. Aslida esa yo'q:",
  "sizga faqat aniq savol va tayyor manba kerak bo'ladi.",
  "Va albatta, tug'ilgan kuningiz bilan — omad va ilhom hamrohingiz bo'lsin!",
].join(" ");

const SAMPLES: Record<string, string> = {
  uz: SAMPLE_UZ,
  ru: "Здравствуйте и добро пожаловать в подкаст SlaydX! Сегодня мы говорим о том, как подготовить учебный материал с помощью искусственного интеллекта. И конечно — с днём рождения, удачи и вдохновения!",
  en: "Hello and welcome to the SlaydX podcast! Today we are talking about how to prepare your lesson material with the help of artificial intelligence. And of course — happy birthday, good luck and inspiration!",
};

/* ────────────────────────── argumentlar ────────────────────────── */

function arg(name: string, fallback = ""): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? String(process.argv[at + 1]) : fallback;
}

const lang = arg("lang", "uz").toLowerCase();
const only = arg("provider").toLowerCase();
const text = SAMPLES[lang] ?? SAMPLES.uz;
const OUT = "eval-out/tts";

/* ────────────────────────── o'lchov ────────────────────────── */

type Row = {
  provider: string;
  voice: string;
  status: "ok" | "sozlanmagan" | "xato";
  seconds: number;
  chars: number;
  usd: number;
  ms: number;
  parts: number;
  note: string;
};

const PROVIDERS: TtsProvider[] = [makeAzureTts(), makeAishaTts(), makeGeminiTts()];

/**
 * Bitta provayder × bitta ovoz.
 *
 * Matn AYNAN ishlab chiqarishdagidek bo'laklanadi (`chunkText`, ≤900)
 * va AYNAN o'shanday birlashtiriladi (`mergeToMp3`) — lab «ideal
 * sharoitda» emas, HAQIQIY quvurda o'lchasin.
 */
async function measure(provider: TtsProvider, voice: string): Promise<Row> {
  const base: Row = { provider: provider.id, voice, status: "ok", seconds: 0, chars: 0, usd: 0, ms: 0, parts: 0, note: "" };
  if (!provider.configured()) return { ...base, status: "sozlanmagan", note: keyHint(provider.id) };

  const parts = chunkText(text, TTS_LIMITS.chunkChars);
  const started = Date.now();
  try {
    const audios = [];
    let chars = 0;
    for (const part of parts) {
      const a = await provider.synthesize(part, { lang, voice, pauseMs: 300 });
      audios.push(a);
      chars += a.chars || part.length;
    }
    const ms = Date.now() - started;
    const mp3 = await mergeToMp3(audios);
    if (!mp3) return { ...base, status: "xato", ms, parts: parts.length, note: "bo'laklar MP3 ga birlashmadi (profil mos emas yoki enkoder yo'q)" };

    const name = `${provider.id}-${voice.replace(/[^\w.-]+/g, "_")}.mp3`;
    await writeFile(`${OUT}/${name}`, mp3);
    return { ...base, seconds: mp3Seconds(mp3), chars, usd: ttsCostUsd(provider.id, chars), ms, parts: parts.length, note: name };
  } catch (e) {
    return { ...base, status: "xato", ms: Date.now() - started, parts: parts.length, note: e instanceof Error ? e.message.slice(0, 120) : String(e) };
  }
}

/** Kalitni qayerdan olish (`tts.md` §4 jadvali) — kalitning O'ZI hech qachon chop etilmaydi. */
function keyHint(id: string): string {
  if (id === "azure") return "AZURE_SPEECH_KEY + AZURE_SPEECH_REGION (portal.azure.com → Speech → Keys and Endpoint)";
  if (id === "aisha") return "AISHA_API_KEY (voicelab.uz/app → profil → API)";
  if (id === "gemini") return "TTS_GEMINI_MODEL (preview model ataylab o'chirilgan; GEMINI_API_KEY yetarli emas)";
  return "kalit yo'q";
}

/* ────────────────────────── ishga tushirish ────────────────────────── */

await mkdir(OUT, { recursive: true });

console.log(`== TTS lab · til: ${lang} · namuna ${text.length} belgi ==\n`);

const rows: Row[] = [];
for (const group of ttsGroups(lang)) {
  if (only && group.provider !== only) continue;
  const provider = PROVIDERS.find((p) => p.id === group.provider);
  if (!provider) {
    rows.push({ provider: group.provider, voice: group.voices[0] ?? "-", status: "xato", seconds: 0, chars: 0, usd: 0, ms: 0, parts: 0, note: "adapter yo'q" });
    continue;
  }
  for (const voice of group.voices) {
    const row = await measure(provider, voice);
    rows.push(row);
    const mark = row.status === "ok" ? "✔" : row.status === "sozlanmagan" ? "·" : "✘";
    console.log(`  ${mark} ${row.provider}:${row.voice} — ${row.status}${row.note ? `  ${row.note}` : ""}`);
  }
}

/* ────────────────────────── jadval ────────────────────────── */

const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log(`\n${pad("provayder:ovoz", 34)}${pad("holat", 14)}${pad("soniya", 9)}${pad("belgi", 8)}${pad("narx $", 10)}${pad("latensiya", 11)}bo'lak`);
console.log("-".repeat(96));
for (const r of rows) {
  console.log(
    pad(`${r.provider}:${r.voice}`, 34) +
      pad(r.status, 14) +
      pad(r.seconds ? r.seconds.toFixed(1) : "-", 9) +
      pad(r.chars || "-", 8) +
      pad(r.usd ? r.usd.toFixed(5) : "-", 10) +
      pad(r.ms ? `${r.ms} ms` : "-", 11) +
      String(r.parts || "-"),
  );
}

const okRows = rows.filter((r) => r.status === "ok");
console.log(`\n${okRows.length} ta provayder ovoz berdi, fayllar: ${OUT}/`);
if (!okRows.length) {
  console.log("Hech bir provayder sozlanmagan — kalitlar kelgach qayta yurgizing (yuqoridagi izohlar qayerdan olishni ko'rsatadi).");
}

await writeFile(`${OUT}/report.json`, JSON.stringify({ lang, sampleChars: text.length, at: new Date().toISOString(), rows }, null, 2));
console.log(`Hisobot: ${OUT}/report.json`);
