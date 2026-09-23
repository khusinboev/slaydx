import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * W1-D (`lib/server/parse-worker.ts`, worker_threads tahlil hovuzi) prod
 * `standalone` to'plamida manba/`tsx` yo'q — bitta yig'ilgan `.mjs` kerak,
 * aks holda prod jimgina in-process parslashga qaytadi (hovuzning butun
 * maqsadi — asosiy event loop'ni bloklamaslik — yo'qoladi). `builder`
 * bosqichi shu `.mjs`ni `npm run build`dan KEYIN yig'ishi va `runner`ning
 * ko'chiradigan `standalone` papkasiga tushishi SHART.
 */
test("Dockerfile: `builder` bosqichi `npm run build`dan keyin `parse-worker.mjs`ni esbuild bilan yig'adi", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

  const buildAt = dockerfile.indexOf("RUN npm run build");
  assert.ok(buildAt >= 0, "`RUN npm run build` topilmadi");

  const esbuildAt = dockerfile.indexOf("npx esbuild lib/server/parse-worker.ts");
  assert.ok(esbuildAt >= 0, "esbuild bilan parse-worker.ts yig'ish qatori topilmadi");
  assert.ok(esbuildAt > buildAt, "esbuild qadami `npm run build`dan KEYIN kelishi kerak — Next standalone chiqishi shundan oldin mavjud emas");

  // esbuild qadami `runner`/`worker` bosqichlaridan OLDIN, ya'ni `builder`
  // ichida turishi kerak — aks holda manba fayllar (`lib/`) allaqachon yo'q.
  const runnerAt = dockerfile.indexOf("AS runner");
  assert.ok(runnerAt > esbuildAt, "esbuild qadami `builder` bosqichida (runner'dan oldin) bo'lishi kerak");

  // Natija aynan `standalone` papkaga tushishi kerak — `runner` shu
  // papkani `COPY --from=builder /app/.next/standalone ./` bilan ko'chiradi.
  assert.match(dockerfile, /--outfile=\.next\/standalone\/parse-worker\.mjs/, "chiqish `.next/standalone/parse-worker.mjs`ga yozilishi kerak");
  assert.match(dockerfile, /--bundle/);
  assert.match(dockerfile, /--platform=node/);
  assert.match(dockerfile, /--format=esm/);
});
