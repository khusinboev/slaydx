import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * `docker-compose.yml` faqat SANAB O'TILGAN o'zgaruvchilarni konteynerga
 * uzatadi — `.env` ga qo'shish yetarli emas. 2026-09-12 deployda (AUDIT-17)
 * `LLM_JUDGE`/`ANTHROPIC_API_KEY`/`OPENALEX_API_KEY` `.env` da bor edi, lekin
 * worker ularni ko'rmadi: baholovchi Gemini'da qoldi, OpenAlex kalitsiz
 * 5 manba topdi. Bu test LLM rollari va manba qidiruv kalitlarini ikkala
 * servisda (web — «Tuzatish», worker — generatsiya) qulflaydi.
 */
const KEYS = [
  "LLM_WRITER",
  "LLM_JUDGE",
  "LLM_RESEARCHER",
  "LLM_FAST",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "OPENAI_API_KEY",
  "OPENALEX_API_KEY",
  "OPENALEX_MAILTO",
  "CROSSREF_MAILTO",
  // AUDIT-19: Google Books (kitob manbalari) — kalit ixtiyoriy, lekin
  // berilsa konteynerga YETIB BORISHI kerak (aks holda kunlik kvota anonim).
  "GOOGLE_BOOKS_API_KEY",
  /*
   * AUDIT-22 (WP-A): TTS zanjiri. `AZURE_SPEECH_REGION` — KALIT EMAS,
   * lekin usiz Azure URL i qurilmaydi; uni ro'yxatdan tushirib qoldirish
   * aynan 2026-09-12 dagi nuqsonni (`.env` da bor, konteynerda yo'q)
   * takrorlardi. `TTS_GEMINI_MODEL` preview provayderni YOQADIGAN
   * o'zgaruvchi — u yetib bormasa Gemini zvenosi jimgina o'chiq qolardi.
   */
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "AISHA_API_KEY",
  "TTS_GEMINI_MODEL",
  /*
   * 2026-09-22: «Rasm» vositasi fal.ai'dan Gemini'ga o'tdi. Rasm modeli
   * `.env` dan almashtirilsin (standart — kod ichida `gemini-3.1-flash-
   * lite-image`, $0.034/rasm) — 2026-09-21 gacha compose bu ikkalasini
   * konteynerga umuman uzatmasdi.
   */
  "GEMINI_IMAGE_MODEL",
  "GEMINI_IMAGE_SIZE",
];

function envBlock(yaml: string, service: string): string {
  const start = yaml.indexOf(`\n  ${service}:`);
  assert.ok(start >= 0, `${service} servisi yo'q`);
  const rest = yaml.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z]/);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

test("docker-compose: LLM rollari va manba qidiruv kalitlari web va worker'ga uzatiladi", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  for (const service of ["web", "worker"]) {
    const block = envBlock(yaml, service);
    for (const k of KEYS) {
      assert.match(block, new RegExp(`^\\s+${k}: \\$\\{${k}:-\\}$`, "m"), `${service}: ${k} compose'da uzatilmaydi`);
    }
  }
  // `.env.example` da ham hujjatlangan bo'lsin.
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const k of KEYS.filter((k) => !/^(XAI|OPENAI)_/.test(k))) assert.match(example, new RegExp(`^${k}=`, "m"), `${k} .env.example da yo'q`);
});

/**
 * AUDIT-22: ovoz jadvalini muhitdan ALMASHTIRISH (`TTS_VOICE_<TIL>`,
 * `tts/chain.ts`) faqat o'zgaruvchi konteynerga YETIB BORSA ishlaydi.
 * Uchta asosiy til (uz/ru/en) qulflanadi — qolganlari jadval bo'yicha
 * ketadi va compose qatoridan mustaqil.
 */
test("docker-compose: TTS ovoz zanjiri o'zgaruvchilari (uz/ru/en) ikkala servisda", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  for (const service of ["web", "worker"]) {
    const block = envBlock(yaml, service);
    for (const k of ["TTS_VOICE_UZ", "TTS_VOICE_RU", "TTS_VOICE_EN"]) {
      assert.match(block, new RegExp(`^\\s+${k}: \\$\\{${k}:-\\}$`, "m"), `${service}: ${k} compose'da uzatilmaydi`);
    }
  }
});

/**
 * INFRA-09: `lib/brand.ts` `NEXT_PUBLIC_BRAND_NAME`/`NEXT_PUBLIC_BRAND_LOGO`ni
 * `process.env`dan to'g'ridan-to'g'ri o'qiydi (Next.js build-vaqtidagi inline
 * qilish worker'ga tegishli emas — u oddiy `tsx` processi). PPTX/DOCX
 * metama'lumotini (`render-pptx.ts` — `pptx.author`) va navbatdagi boshqa
 * brendlash aynan WORKER ichida chiziladi, lekin ilgari bu ikkalasi faqat
 * `web` blokida bor edi — nom o'zgarsa generatsiya qilingan fayl eski nom
 * bilan chiqib qolardi (compose-env qulfi qoldirgan tuynuk turlaridan biri,
 * `LLM_JUDGE`/`OPENALEX_API_KEY` bilan bir xil sinf).
 *
 * Mutatsiya: `worker` blokidan `NEXT_PUBLIC_BRAND_NAME`/`_LOGO` qatorlarini
 * olib tashlang — test qizaradi.
 */
test("docker-compose: NEXT_PUBLIC_BRAND_NAME/_LOGO web va worker'da bir xil standart bilan", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const defaults: Record<string, string> = {
    NEXT_PUBLIC_BRAND_NAME: "SlaydX",
    NEXT_PUBLIC_BRAND_LOGO: "/logo.png",
  };
  for (const service of ["web", "worker"]) {
    const block = envBlock(yaml, service);
    for (const [k, def] of Object.entries(defaults)) {
      const escaped = def.replace(/[/.]/g, "\\$&");
      assert.match(
        block,
        new RegExp(`^\\s+${k}: \\$\\{${k}:-${escaped}\\}$`, "m"),
        `${service}: ${k} compose'da (standart ${def} bilan) uzatilmaydi`,
      );
    }
  }
});

/**
 * W2-D1 / C18 (INFRA-04, OBS-10, INFRA-15): resurs chegarasi va log
 * aylanishi HAR service'da bo'lishi kerak — box uchta loyiha bilan umumiy
 * (`.claude/deploy.md`), chegarasiz konteyner qo'shnilarni OOM bilan
 * siqib qo'yishi yoki disklarini log bilan to'ldirishi mumkin.
 *
 * Mutatsiya: `mem_limit`/`logging` qatorlaridan birini olib tashlang —
 * mos assertion qizaradi.
 */
test("docker-compose: har service'da mem_limit/cpus va json-file log aylanishi bor", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  for (const service of ["postgres", "web", "worker"]) {
    const block = envBlock(yaml, service);
    assert.match(block, /mem_limit: \$\{\w+_MEM_LIMIT:-\w+\}/, `${service}: mem_limit sozlanadigan emas`);
    assert.match(block, /cpus: \$\{\w+_CPUS:-[\d.]+\}/, `${service}: cpus sozlanadigan emas`);
    assert.match(block, /logging:\s*\n\s+driver: json-file/, `${service}: json-file logging yo'q`);
    assert.match(block, /max-size: 20m/, `${service}: max-size yo'q`);
    assert.match(block, /max-file: "5"/, `${service}: max-file yo'q`);
  }
});

/**
 * C22 (owner qarori, audit/designs/capacity.md): 2 worker konteyner ×
 * WORKER_CONCURRENCY=4 = 8 slot. `container_name` ATAYLAB yo'q — aks
 * holda 2-nusxa ko'tarilmay qoladi (nom to'qnashuvi).
 */
test("docker-compose: worker 2 replika, WORKER_CONCURRENCY standart 4, container_name yo'q", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const block = envBlock(yaml, "worker");
  assert.match(block, /deploy:\s*\n\s+replicas: 2/, "worker: deploy.replicas: 2 yo'q");
  assert.match(block, /WORKER_CONCURRENCY: \$\{WORKER_CONCURRENCY:-4\}/, "WORKER_CONCURRENCY standart 4 emas");
  assert.ok(!/container_name:/.test(block), "worker: container_name qattiq yozilgan bo'lmasin — replikalar to'qnashadi");
  assert.ok(!/container_name:/.test(envBlock(yaml, "web")), "web: container_name qattiq yozilgan bo'lmasin");
});

/**
 * C19 (INFRA-06): worker HTTP tinglamaydi, shuning uchun HEALTHCHECK
 * `/tmp/slaydx-worker-alive` fayl yoshiga qaraydi. Shartnoma bir xil
 * bo'lishi kerak — `Dockerfile`dagi HEALTHCHECK bilan compose'dagisi
 * boshqacha bo'lib qolsa, biri konteynerni "sog'lom" deb, ikkinchisi
 * "kasal" deb ko'rsatishi mumkin.
 */
test("docker-compose: worker healthcheck /tmp/slaydx-worker-alive shartnomasi Dockerfile bilan bir xil", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const block = envBlock(yaml, "worker");
  assert.match(block, /find \/tmp\/slaydx-worker-alive -mmin -2 \| grep -q \./, "worker: healthcheck test satri yo'q/mos emas");
  assert.match(dockerfile, /find \/tmp\/slaydx-worker-alive -mmin -2 \| grep -q \./, "Dockerfile: worker HEALTHCHECK yo'q/mos emas");
});

/**
 * C18 (INFRA-08 qo'shnisi): deploy paytida SIGTERM kelganda web/worker
 * hali ishlab turgan uzun so'rovlarni (tahrir ~45–60 s, ish budjeti
 * daqiqalarcha) tugatishga vaqt topsin — Docker'ning standart 10 s'i
 * buni kesib tashlaydi.
 */
test("docker-compose: stop_grace_period — web >= 60s, worker >= 30s", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const webMatch = envBlock(yaml, "web").match(/stop_grace_period: (\d+)s/);
  const workerMatch = envBlock(yaml, "worker").match(/stop_grace_period: (\d+)s/);
  assert.ok(webMatch, "web: stop_grace_period yo'q");
  assert.ok(workerMatch, "worker: stop_grace_period yo'q");
  assert.ok(Number(webMatch![1]) >= 60, `web: stop_grace_period ${webMatch![1]}s < 60s`);
  assert.ok(Number(workerMatch![1]) >= 30, `worker: stop_grace_period ${workerMatch![1]}s < 30s`);
});

/**
 * W2-A topilmasi: `node`/`tsx` PID 1 sifatida ishlaydi, init bo'lmasa
 * o'ldirilgan `soffice.bin`/`sharp` grandchild'lari zombie bo'lib qoladi.
 */
test("docker-compose: web va worker'da init: true bor", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  assert.match(envBlock(yaml, "web"), /^\s+init: true$/m, "web: init: true yo'q");
  assert.match(envBlock(yaml, "worker"), /^\s+init: true$/m, "worker: init: true yo'q");
});

/**
 * W3-E (`lib/server/db.ts`, C35 kelishuvi): baza so'rov/ulanish
 * shiftlari — kod standarti mos ravishda 30000/5000 ms. Bu ikkalasi
 * `env.ts` emas, to'g'ridan-to'g'ri `db.ts` o'qishi rejalashtirilgan
 * (W3-E o'z paketida ulaydi) — bu test faqat compose PLUMBING'ini
 * qulflaydi (`LLM_JUDGE`/`OPENALEX_API_KEY` sinfidagi «.env'da bor,
 * konteynerda yo'q» tuynugi takrorlanmasin), `db.ts`ning o'zini emas.
 */
test("docker-compose: DATABASE_STATEMENT_TIMEOUT_MS/DATABASE_CONNECT_TIMEOUT_MS web va worker'ga uzatiladi", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  for (const service of ["web", "worker"]) {
    const block = envBlock(yaml, service);
    for (const k of ["DATABASE_STATEMENT_TIMEOUT_MS", "DATABASE_CONNECT_TIMEOUT_MS"]) {
      assert.match(block, new RegExp(`^\\s+${k}: \\$\\{${k}:-\\}$`, "m"), `${service}: ${k} compose'da uzatilmaydi`);
    }
  }
});

/**
 * DEPS-08 (W3-I): admin telefon ro'yxati ilgari `lib/server/admin-phones.ts`da
 * QATTIQ YOZILGAN edi — public repo'da kim admin ekani ko'rinib turardi.
 * Endi `process.env.ADMIN_PHONES`dan o'qiladi; bu test faqat compose
 * PLUMBING'ini qulflaydi (o'zgaruvchi `.env`da bor-u, konteynerga
 * YETIB BORMASA — admin ro'yxati bo'sh qolib, hech kim admin panelga
 * kirolmay qoladi — jim, aniqlash qiyin nosozlik).
 */
test("docker-compose: ADMIN_PHONES web va worker'ga uzatiladi", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  for (const service of ["web", "worker"]) {
    const block = envBlock(yaml, service);
    assert.match(block, /^\s+ADMIN_PHONES: \$\{ADMIN_PHONES:-\}$/m, `${service}: ADMIN_PHONES compose'da uzatilmaydi`);
  }
});

/**
 * C23 (retention.md §6): `FILE_TTL_HOURS` hech qachon o'qilmagan — o'chirib
 * tashlash o'rniga chalg'ituvchi konfiguratsiya bo'lib turardi.
 */
test("docker-compose: dead FILE_TTL_HOURS o'zgaruvchisi yo'q", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  assert.ok(!/FILE_TTL_HOURS/.test(yaml), "FILE_TTL_HOURS hali ham compose'da bor — o'chirilishi kerak edi (C23)");
});

/**
 * Prod-readiness W2 sig'im/saqlash/PDF/Payme/pool o'zgaruvchilari
 * compose'da UZATILADI, lekin `lib/server/env.ts` ularni O'QIYAPTIMI —
 * aks holda o'zgaruvchi konteynerga yetib boradi-yu, hech narsaga
 * ta'sir qilmaydi (jim o'lik konfiguratsiya).
 */
test("docker-compose: W2 navbat/saqlash/pool o'zgaruvchilari env.ts'da o'qiladi", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const envSrc = readFileSync(new URL("../lib/server/env.ts", import.meta.url), "utf8");
  const w2Vars = [
    "QUEUE_TOTAL_SLOTS",
    "QUEUE_MEAN_SERVICE_SEC",
    "QUEUE_MAX_WAIT_SEC",
    "USER_MAX_INFLIGHT",
    "QUEUE_TTL_SEC",
    "RETENTION_BONUS_DAYS",
    "PDF_MAX_CONCURRENCY",
    "PAYME_SANDBOX",
    "DATABASE_POOL_MAX",
  ];
  const webBlock = envBlock(yaml, "web");
  for (const k of w2Vars) {
    assert.match(webBlock, new RegExp(`\\b${k}: \\$\\{${k}:-`), `web: ${k} compose'da yo'q`);
    assert.match(envSrc, new RegExp(`\\("${k}"`), `${k} lib/server/env.ts'da hech qayerda o'qilmaydi — o'lik konfiguratsiya`);
  }
});
