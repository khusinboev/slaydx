import { parentPort } from "node:worker_threads";
import { runParseTask, serializeError, type ParseTask } from "./parse-tasks";

/**
 * Fayl tahlili worker thread'ining kirish nuqtasi (CONC-09).
 *
 * Bitta vazifa — bitta thread: javob yuborilgach `parse-pool.ts` threadni
 * to'xtatadi (xotira to'liq qaytadi). Dev/testda bu fayl tsx bilan
 * yuklanadi, prodda esa esbuild to'plami (`parse-worker.mjs`) —
 * `parse-pool.ts` `resolveParseWorkerEntry` ga qarang.
 */
parentPort?.once("message", (msg: { task: ParseTask }) => {
  runParseTask(msg.task).then(
    (result) => parentPort?.postMessage({ ok: true, result }),
    (e: unknown) => parentPort?.postMessage({ ok: false, error: serializeError(e) }),
  );
});
