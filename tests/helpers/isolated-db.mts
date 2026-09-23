/**
 * Navbat testlari uchun ALOHIDA baza (bir xil Postgres serverida).
 *
 * `claimJob`, navbat o'rni va qabul qarori GLOBAL holatni (butun
 * `generations` jadvalidagi QUEUED/IN_PROGRESS qatorlarni) o'qiydi. Umumiy
 * test bazasida boshqa testlar (yoki parallel agentlar) ham qator
 * qo'yadi/oladi — natija tasodifiy bo'lib qolardi, `claimJob` esa
 * begona testning ishini «o'g'irlab» qo'yardi. Shuning uchun bu yordamchi
 * `DATABASE_URL` serverida yangi, bo'sh baza yaratadi va
 * `process.env.DATABASE_URL` ni unga buradi — `lib/server/db.ts` hovuzi
 * birinchi so'rovda shu manzilni oladi (import'dan OLDIN chaqiring).
 *
 * Baza yaratib bo'lmasa (huquq yo'q) — asl baza qoladi va `isolated: false`
 * qaytadi; test aniq global sanoqlarga tayangan joylarni o'tkazib yuboradi.
 */
import pg from "pg";

export type IsolatedDb = { isolated: boolean; drop: () => Promise<void> };

export async function useIsolatedDb(tag: string): Promise<IsolatedDb> {
  const base = process.env.DATABASE_URL ?? "";
  if (!base || base.includes("unused")) return { isolated: false, drop: async () => {} };
  const url = new URL(base);
  const name = `${url.pathname.slice(1) || "slaydx"}_${tag}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  const admin = new pg.Client({ connectionString: base, connectionTimeoutMillis: 5_000 });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (e) {
    await admin.end();
    console.warn(`# alohida baza yaratilmadi (${(e as Error).message}) — umumiy baza ishlatiladi`);
    return { isolated: false, drop: async () => {} };
  }
  await admin.end();
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  return {
    isolated: true,
    drop: async () => {
      const c = new pg.Client({ connectionString: base, connectionTimeoutMillis: 5_000 });
      await c.connect();
      try {
        await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await c.end();
      }
    },
  };
}
