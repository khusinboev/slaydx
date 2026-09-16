import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { curriculumIndex, curriculumTopics, hasCurriculum } from "@/lib/curriculum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mavzu so'rovi — forma har fan/sinf almashganda bittadan chaqiradi. */
const LIMIT_PER_MIN = 60;

/**
 * O'quv dasturi mavzulari (AUDIT-20 R0) — test yaratuvchining DARSLIK
 * rejimi (`mode: "curriculum"`) va dars rejasi/xarita formasidagi
 * ixtiyoriy mavzu tanlovi uchun.
 *
 * Nega route: to'liq baza ≈1–1,5 MB va u klient bandliga KIRMASLIGI
 * kerak (`lib/curriculum.ts` ikki qatlami). Forma yengil `index.json` ni
 * o'zi biladi, mavzularni esa tanlov qilinganda shu yerdan oladi.
 *
 *   GET /api/curriculum                     → indeks (fan × sinf)
 *   GET /api/curriculum?subject=…&grade=…   → shu yozuvning boblari/mavzulari
 *
 * Bepul, lekin LOGINLI: baza mahsulotning qismi, anonim skraping uchun
 * emas. Chegara 60/daqiqa — forma bir necha marta almashsa yetadi.
 */
export const GET = handler("curriculum", async (req) => {
  const { user } = await requireUser(req);
  await limit(`curriculum:${user.id}`, LIMIT_PER_MIN, 60);

  const url = new URL(req.url);
  const subject = (url.searchParams.get("subject") ?? "").trim();
  const gradeRaw = (url.searchParams.get("grade") ?? "").trim();

  // Parametrsiz so'rov — indeks (forma boshlang'ich holati).
  if (!subject && !gradeRaw) return json(curriculumIndex());

  if (!subject) throw new ApiError("Fan ko'rsatilmagan", 400);
  const grade = Number(gradeRaw);
  if (!Number.isInteger(grade) || grade < 1 || grade > 11) throw new ApiError("Sinf 1–11 oralig'ida bo'lishi kerak", 400);

  /*
   * «Bazada yo'q» — 404, bo'sh ro'yxat EMAS: forma bu ikkisini ajrata
   * olishi kerak (X-2 — mavjud bo'lmagan fan/sinfda darslik rejimi
   * umuman ko'rsatilmaydi, «mavzu topilmadi» deb turmaydi).
   */
  if (!hasCurriculum(subject, grade)) throw new ApiError("Bu fan va sinf uchun o'quv dasturi bazada yo'q", 404);
  const entry = await curriculumTopics(subject, grade);
  if (!entry) throw new ApiError("Bu fan va sinf uchun o'quv dasturi bazada yo'q", 404);

  return json({ subject, grade: entry.grade, source: entry.source, units: entry.units });
});
