import test from "node:test";
import assert from "node:assert/strict";
import { LEX_PAGE_563, LEX_PAGE_OTHER, stubFetch } from "./helpers/research-fixtures.ts";
import {
  docDateInPage,
  docNoInPage,
  fetchLaw,
  findLaws,
  isoToDotted,
  issuerOf,
  lawsPrompt,
  lexDocId,
  matchLawPage,
  parseLawCandidates,
  verifyLawPage,
  type LawCandidate,
} from "../lib/generation/research/lexuz.ts";
import { memorySourceCache, setSourceCacheStore } from "../lib/generation/research/cache.ts";

/**
 * lex.uz qatlami (Talaba ishlari 2, AUDIT-19 WP-B). Eng muhim qoida —
 * SAHIFA TASDIQLAMASA MANBA RAD ETILADI (uydirma qonun hujjatga
 * tushmaydi). Tarmoq YO'Q — `fetchImpl` stub, HTML `__html` orqali.
 *
 * Mutatsiyalar (har biri qizardi):
 *   • `matchLawPage` doim `verified:true` qaytaradigan qilindi — «uydirma
 *     hujjat RAD» testi yiqildi (aynan shu bandning mohiyati);
 *   • `LEX_TITLE_MATCH` 0.6 → 0.2 — «boshqa hujjat sahifasi» tasdiqlanib ketdi;
 *   • bloklangan javob ham keshlanadigan qilindi — «403 keshlanmaydi» yiqildi;
 *   • `parseLawCandidates` lex.uz bo'lmagan havolani ham qabul qildi — parse testi yiqildi;
 *   • `fetchLaw` keshi olib tashlandi — «rad etilgan keshlanadi» yiqildi.
 */

test.beforeEach(() => setSourceCacheStore(null));
test.after(() => setSourceCacheStore(undefined));

const EDU: LawCandidate = {
  title: "O‘zbekiston Respublikasining «Ta’lim to‘g‘risida»gi Qonuni",
  type: "law",
  docNo: "O‘RQ-563",
  docDate: "2019-09-20",
  url: "https://lex.uz/docs/5013009",
};

const TODAY = "2026-09-16";
const PAGES = { "lex.uz/docs/5013009": { __html: LEX_PAGE_563 }, "lex.uz/docs/4444444": { __html: LEX_PAGE_OTHER } };

const completeWith = (text: string | null) =>
  (async () => (text === null ? null : { text })) as never;

const LAWS_JSON = JSON.stringify({
  laws: [
    { title: EDU.title, type: "law", docNo: "O‘RQ-563", docDate: "2019-09-20", url: "https://lex.uz/docs/5013009" },
    { title: "Raqamli ta’lim to‘g‘risidagi Qonun", type: "law", docNo: "O‘RQ-999", docDate: "2024-01-01", url: "https://lex.uz/docs/4444444" },
  ],
});

test("lexDocId: faqat lex.uz havolasi; parseLawCandidates — tur/raqam/sana, dedup, boshqa host tashlanadi", () => {
  assert.equal(lexDocId("https://lex.uz/docs/5013009"), "5013009");
  assert.equal(lexDocId("https://www.lex.uz/ru/docs/5013009-page"), "5013009");
  assert.equal(lexDocId("https://example.org/docs/5013009"), "");
  assert.equal(lexDocId("https://lex.uz/acts/5013009"), "");

  const cands = parseLawCandidates(
    JSON.stringify({
      laws: [
        { title: "Ta’lim to‘g‘risida", type: "law", docNo: "O‘RQ-563", docDate: "2019-09-20", url: "https://lex.uz/docs/5013009" },
        { title: "Ikkinchi marta", type: "law", url: "https://lex.uz/docs/5013009" },
        { title: "Boshqa saytdan", type: "law", url: "https://qonun.uz/docs/1" },
        { title: "Farmon", type: "decree", docDate: "20.09.2019", url: "https://lex.uz/docs/4444444" },
      ],
    }),
  );
  assert.equal(cands.length, 2, "dedup + lex.uz bo'lmagan havola tashlanadi");
  assert.deepEqual(cands[0], { title: "Ta’lim to‘g‘risida", type: "law", url: "https://lex.uz/docs/5013009", docNo: "O‘RQ-563", docDate: "2019-09-20" });
  assert.equal(cands[1].type, "decree");
  assert.equal(cands[1].docDate, undefined, "ISO bo'lmagan sana qabul qilinmaydi");
  assert.deepEqual(parseLawCandidates("javob emas"), []);
  assert.deepEqual(parseLawCandidates(undefined), []);
});

test("prompt: qonun/farmon/qaror turlari, lex.uz URL shakli va «bilmasang bo'sh ro'yxat» taqiqi", () => {
  const p = lawsPrompt("Ta'lim sohasini raqamlashtirish", ["ta'lim", "raqamli"]);
  assert.match(p, /law \| decree \| resolution \| cabinet \| ministry/);
  assert.match(p, /https:\/\/lex\.uz\/docs\/<number>/);
  assert.match(p, /return an EMPTY list/i);
  assert.match(p, /checked against the lex\.uz page/i);
});

test("tasdiq: RAQAM bo'yicha; SANA bo'yicha; SARLAVHA ≥60 % bo'yicha", () => {
  // Raqam mos (sana va sarlavha bo'lmasa ham).
  const byNo = matchLawPage({ ...EDU, title: "Nomi mutlaqo boshqacha hujjat", docDate: undefined }, LEX_PAGE_563);
  assert.equal(byNo.docNo, true);
  assert.equal(byNo.verified, true);
  // Sana mos (raqam noto'g'ri).
  const byDate = matchLawPage({ ...EDU, title: "Nomi mutlaqo boshqacha hujjat", docNo: "O‘RQ-777" }, LEX_PAGE_563);
  assert.equal(byDate.docNo, false);
  assert.equal(byDate.docDate, true);
  assert.equal(byDate.verified, true);
  // Sarlavha mos (raqam ham, sana ham yo'q).
  const byTitle = matchLawPage({ ...EDU, docNo: undefined, docDate: undefined }, LEX_PAGE_563);
  assert.ok(byTitle.titleShare >= 0.6, `sarlavha ulushi: ${byTitle.titleShare}`);
  assert.equal(byTitle.verified, true);
});

test("TASDIQLANMASA RAD: uydirma raqam/sana/sarlavha bilan hujjat ro'yxatga TUSHMAYDI", () => {
  const fake: LawCandidate = {
    title: "Raqamli ta’lim to‘g‘risidagi Qonun",
    type: "law",
    docNo: "O‘RQ-999",
    docDate: "2024-01-01",
    url: "https://lex.uz/docs/4444444",
  };
  const m = matchLawPage(fake, LEX_PAGE_OTHER);
  assert.equal(m.docNo, false);
  assert.equal(m.docDate, false);
  assert.ok(m.titleShare < 0.6, `sarlavha ulushi: ${m.titleShare}`);
  assert.equal(m.verified, false);
  const v = verifyLawPage(fake, LEX_PAGE_OTHER, TODAY);
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.reason, "rejected");
  // Qisqa sarlavha (3 ta uzun so'zdan kam) o'zi tasdiq bera olmaydi.
  assert.equal(matchLawPage({ title: "Suv nizomi", type: "law", url: "https://lex.uz/docs/4444444" }, LEX_PAGE_OTHER).verified, false);
});

test("verifyLawPage: tasdiqlangan yozuv — kind/id/issuer/docNo/docDate/year/url/accessed", () => {
  const v = verifyLawPage(EDU, LEX_PAGE_563, TODAY);
  assert.ok(v.ok);
  const r = (v as { ok: true; ref: import("../lib/generation/types.ts").Reference }).ref;
  assert.equal(r.id, "lex:5013009");
  assert.equal(r.kind, "law");
  assert.equal(r.verified, "lexuz");
  assert.equal(r.cited, false);
  assert.equal(r.docNo, "O‘RQ-563");
  assert.equal(r.docDate, "2019-09-20");
  assert.equal(r.year, 2019);
  assert.equal(r.url, "https://lex.uz/docs/5013009");
  assert.equal(r.accessed, TODAY);
  assert.equal(r.issuer, "O‘zbekiston Respublikasi");
  // Model sana/raqam bermasa — sahifadan olinadi.
  const fromPage = verifyLawPage({ ...EDU, docNo: undefined, docDate: undefined }, LEX_PAGE_563, TODAY);
  assert.ok(fromPage.ok);
  const r2 = (fromPage as { ok: true; ref: import("../lib/generation/types.ts").Reference }).ref;
  assert.equal(r2.docNo, "O‘RQ-563");
  assert.equal(r2.docDate, "2019-09-20");
});

test("yordamchilar: issuerOf turlari (uz/ru), sahifadan raqam/sana, ISO → nuqtali", () => {
  assert.equal(issuerOf("decree"), "O‘zbekiston Respublikasi Prezidenti");
  assert.equal(issuerOf("resolution"), "O‘zbekiston Respublikasi Prezidenti");
  assert.equal(issuerOf("cabinet"), "O‘zbekiston Respublikasi Vazirlar Mahkamasi");
  assert.equal(issuerOf("ministry"), "O‘zbekiston Respublikasi vazirligi");
  assert.equal(issuerOf("cabinet", "ru"), "Кабинет Министров Республики Узбекистан");
  assert.equal(docNoInPage("… Hujjat raqami: O‘RQ-563 …"), "O‘RQ-563");
  assert.equal(docNoInPage("… Hujjat raqami: 207-son …"), "207-son");
  assert.equal(docNoInPage("raqamsiz matn"), "");
  assert.equal(docDateInPage("Qabul qilingan sana: 20.09.2019"), "2019-09-20");
  assert.equal(isoToDotted("2019-09-20"), "20.09.2019");
  assert.equal(isoToDotted("20.09.2019"), "");
});

test("fetchLaw: 403/timeout → blocked (hech narsa qo'shilmaydi) va KESHLANMAYDI", async () => {
  const store = memorySourceCache();
  setSourceCacheStore(store);
  const f = stubFetch({ "lex.uz/docs/5013009": { __status: 403 } });
  const v = await fetchLaw(EDU, { fetchImpl: f, retries: 0, retryBaseMs: 0, today: TODAY });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.reason, "blocked");
  assert.equal(store.size, 0, "bloklangan javob keshlanmaydi — o'tkinchi holat");
  // Sahifa keyin ochilsa — tasdiqlanadi.
  const ok = await fetchLaw(EDU, { fetchImpl: stubFetch(PAGES), retryBaseMs: 0, today: TODAY });
  assert.equal(ok.ok, true);
  setSourceCacheStore(null);
});

test("kesh `lex:` — RAD ETILGAN hukm ham keshlanadi (qayta urinilmaydi)", async () => {
  const store = memorySourceCache();
  setSourceCacheStore(store);
  const fake: LawCandidate = { ...EDU, title: "Raqamli ta’lim to‘g‘risidagi Qonun", docNo: "O‘RQ-999", docDate: "2024-01-01", url: "https://lex.uz/docs/4444444" };
  const f = stubFetch(PAGES);
  assert.equal((await fetchLaw(fake, { fetchImpl: f, retryBaseMs: 0, today: TODAY })).ok, false);
  assert.equal((await fetchLaw(fake, { fetchImpl: f, retryBaseMs: 0, today: TODAY })).ok, false);
  assert.equal(f.calls.length, 1, "rad etilgan hujjat ikkinchi marta so'ralmaydi");
  assert.deepEqual([...store.map.keys()], ["lex:4444444"]);
  setSourceCacheStore(null);
});

test("findLaws: tasdiqlangan qo'shiladi, uydirma RAD — stats.rejected; model javobsiz → bo'sh", async () => {
  const f = stubFetch(PAGES);
  const res = await findLaws("Ta'lim sohasini raqamlashtirish", {
    complete: completeWith(LAWS_JSON),
    http: { fetchImpl: f, retryBaseMs: 0 },
    deadline: Date.now() + 20_000,
    today: TODAY,
    keywords: ["ta'lim"],
  });
  assert.equal(res.candidates, 2);
  assert.equal(res.refs.length, 1, "faqat tasdiqlangani");
  assert.equal(res.refs[0].id, "lex:5013009");
  assert.equal(res.rejected, 1);
  assert.equal(res.blocked, 0);

  const none = await findLaws("mavzu", { complete: completeWith(null), http: { fetchImpl: f, retryBaseMs: 0 }, deadline: Date.now() + 20_000, today: TODAY });
  assert.deepEqual(none, { refs: [], candidates: 0, rejected: 0, blocked: 0 });
  assert.deepEqual(
    await findLaws("mavzu", { complete: completeWith('{"laws":[]}'), http: { fetchImpl: f, retryBaseMs: 0 }, deadline: Date.now() + 20_000 }),
    { refs: [], candidates: 0, rejected: 0, blocked: 0 },
  );
});

test("findLaws: lex.uz butunlay bloklansa — blocked sanaladi, ro'yxat bo'sh (xato emas)", async () => {
  const res = await findLaws("Ta'lim", {
    complete: completeWith(LAWS_JSON),
    http: { fetchImpl: stubFetch({ "lex.uz": { __status: 403 } }), retries: 0, retryBaseMs: 0 },
    deadline: Date.now() + 20_000,
    today: TODAY,
  });
  assert.deepEqual(res.refs, []);
  assert.equal(res.blocked, 2);
  assert.equal(res.rejected, 0);
});
