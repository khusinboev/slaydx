/**
 * OpenAlex / Crossref JSON namunalari va `fetch` stub'i (Maqola 2 testlari).
 *
 * Shakl haqiqiy API javobidan (2026-09): OpenAlex `results[]` — `id`
 * URL ko'rinishida, `doi` `https://doi.org/` prefiksi bilan, annotatsiya
 * inverted index; Crossref `message` — `title[]`, `author[{given,family}]`,
 * `issued.date-parts`.
 */

export const OPENALEX_WORKS = {
  results: [
    {
      id: "https://openalex.org/W2741809807",
      title: "Artificial intelligence in intelligent tutoring systems toward sustainable education: a systematic review",
      publication_year: 2023,
      doi: "https://doi.org/10.1186/s40561-023-00260-y",
      authorships: [
        { author: { display_name: "Chien-Chang Lin" } },
        { author: { display_name: "Anna Y. Q. Huang" } },
        { author: { display_name: "Owen H. T. Lu" } },
      ],
      primary_location: { source: { display_name: "Smart Learning Environments" }, landing_page_url: "https://doi.org/10.1186/s40561-023-00260-y" },
      cited_by_count: 312,
      abstract_inverted_index: { Artificial: [0], intelligence: [1], improves: [2], tutoring: [3], systems: [4] },
    },
    {
      id: "https://openalex.org/W4385000001",
      title: "Exploring the potential impact of artificial intelligence on interactive learning",
      publication_year: 2023,
      doi: "https://doi.org/10.3390/app13116716",
      authorships: [{ author: { display_name: "Sayed Ahmad" } }, { author: { display_name: "Mohd Rahmat" } }],
      primary_location: { source: { display_name: "Applied Sciences" } },
      cited_by_count: 88,
      abstract_inverted_index: null,
    },
    {
      id: "https://openalex.org/W3000000003",
      title: "Adaptive learning platforms and student outcomes: a meta-analysis",
      publication_year: 2021,
      doi: "https://doi.org/10.1000/adaptive.2021",
      authorships: [{ author: { display_name: "Dilnoza Karimova" } }],
      primary_location: { source: { display_name: "Computers & Education" } },
      cited_by_count: 40,
      abstract_inverted_index: { Meta: [0], analysis: [1], of: [2], adaptive: [3], platforms: [4] },
    },
    // Sarlavhasiz yozuv — tashlanishi kerak.
    { id: "https://openalex.org/W9999999999", title: null, publication_year: 2020, doi: null, authorships: [] },
    // Dublikat DOI (boshqa id) — dedupda tushishi kerak.
    {
      id: "https://openalex.org/W2741809808",
      title: "Artificial intelligence in intelligent tutoring systems toward sustainable education: a systematic review (preprint)",
      publication_year: 2022,
      doi: "https://doi.org/10.1186/S40561-023-00260-Y",
      authorships: [{ author: { display_name: "Chien-Chang Lin" } }],
      primary_location: { source: { display_name: "SSRN" } },
      cited_by_count: 1,
    },
  ],
};

export const CROSSREF_WORK = {
  status: "ok",
  message: {
    DOI: "10.1186/s40561-023-00260-y",
    title: ["Artificial intelligence in intelligent tutoring systems toward sustainable education: a systematic review"],
    author: [
      { given: "Chien-Chang", family: "Lin" },
      { given: "Anna Y. Q.", family: "Huang" },
    ],
    issued: { "date-parts": [[2023, 5, 15]] },
    "container-title": ["Smart Learning Environments"],
    publisher: "Springer",
    page: "1-22",
    URL: "https://doi.org/10.1186/s40561-023-00260-y",
  },
};

export const CROSSREF_BIBLIO = {
  status: "ok",
  message: {
    items: [
      {
        DOI: "10.1234/uzb.2022.017",
        title: ["Ta’limda raqamli texnologiyalar: pedagogik tahlil"],
        author: [{ given: "A.", family: "Karimov" }],
        issued: { "date-parts": [[2022]] },
        "container-title": ["Pedagogika"],
        score: 62.4,
      },
    ],
  },
};

/** Mos kelmaydigan top-1 — bibliografik qidiruv `null` qaytarishi kerak. */
export const CROSSREF_BIBLIO_MISS = {
  status: "ok",
  message: {
    items: [
      {
        DOI: "10.5555/other.2019",
        title: ["Thermal conductivity of graphene composites"],
        author: [{ given: "J.", family: "Smith" }],
        issued: { "date-parts": [[2019]] },
        score: 8.1,
      },
    ],
  },
};

export type StubCall = { url: string; init?: RequestInit };

/**
 * `fetch` stub: URL bo'yicha javob tanlaydi, chaqiruvlarni yozadi.
 * `plan` — URL bo'lagi → javob (JSON obyekt yoki `{status}`); ketma-ket
 * javoblar uchun massiv (429 → 200 kabi).
 */
export function stubFetch(plan: Record<string, unknown | unknown[]>, calls: StubCall[] = []): typeof fetch & { calls: StubCall[] } {
  const queues = new Map<string, unknown[]>();
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    for (const [needle, resp] of Object.entries(plan)) {
      if (!url.includes(needle)) continue;
      let body: unknown = resp;
      if (Array.isArray(resp)) {
        const q = queues.get(needle) ?? [...resp];
        body = q.length > 1 ? q.shift() : q[0];
        queues.set(needle, q);
      }
      const status = body && typeof body === "object" && "__status" in (body as object) ? Number((body as { __status: number }).__status) : 200;
      // `__html` — HTML sahifasi (lex.uz): matn sifatida, `text/html` bilan.
      if (status === 200 && body && typeof body === "object" && "__html" in (body as object)) {
        return new Response(String((body as { __html: string }).__html), { status, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response(status === 200 ? JSON.stringify(body) : "", { status, headers: { "content-type": "application/json" } });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch & { calls: StubCall[] };
  fn.calls = calls;
  return fn;
}

/* ─────────── Google Books / lex.uz (Talaba ishlari 2, AUDIT-19) ─────────── */

/**
 * Google Books `volumes` javobi (2026-09 shakli): `items[].volumeInfo` —
 * `industryIdentifiers` da ISBN_10 va ISBN_13 birga, `publishedDate` to'liq
 * sana bo'lishi mumkin.
 */
export const BOOKS_VOLUMES = {
  totalItems: 3,
  items: [
    {
      id: "vol_ta_lim",
      volumeInfo: {
        title: "Ta’limda raqamli texnologiyalar",
        subtitle: "darslik",
        authors: ["Karimov A.", "Yusupova D."],
        publisher: "Fan va texnologiya",
        publishedDate: "2022-04-11",
        pageCount: 240,
        industryIdentifiers: [
          { type: "ISBN_10", identifier: "9943570125" },
          { type: "ISBN_13", identifier: "978-9943-57-012-3" },
        ],
        canonicalVolumeLink: "https://books.google.com/books/about/?id=vol_ta_lim",
        infoLink: "https://books.google.com/books?id=vol_ta_lim&info",
      },
    },
    {
      id: "vol_pedagogika",
      volumeInfo: {
        title: "Pedagogika nazariyasi",
        authors: ["Tursunov I."],
        publisher: "O‘qituvchi",
        publishedDate: "2019",
        industryIdentifiers: [{ type: "ISBN_10", identifier: "994322111X" }],
        infoLink: "https://books.google.com/books?id=vol_pedagogika",
      },
    },
    // Sarlavhasiz — `referenceFromVolume` `null` qaytaradi (ro'yxatga tushmaydi).
    { id: "vol_bad", volumeInfo: { authors: ["Nomsiz"], publishedDate: "2020" } },
  ],
};

/** `isbn:…` so'roviga bitta kitob. */
export const BOOKS_BY_ISBN = { totalItems: 1, items: [BOOKS_VOLUMES.items[0]] };

/**
 * lex.uz hujjat sahifasi (soddalashtirilgan HTML): `<title>`, `og:title`,
 * `<h1>`, sana va hujjat raqami — tasdiq shu belgilarga tayanadi.
 */
export const LEX_PAGE_563 = `<!DOCTYPE html><html><head>
<title>O‘zbekiston Respublikasining Qonuni, 20.09.2019-yildagi O‘RQ-563-son</title>
<meta property="og:title" content="Ta’lim to‘g‘risida" />
</head><body>
<h1>O‘zbekiston Respublikasining «Ta’lim to‘g‘risida»gi Qonuni</h1>
<div class="doc-meta">Qabul qilingan sana: 20.09.2019 &nbsp; Hujjat raqami: O‘RQ-563</div>
<p>Ushbu Qonun ta’lim sohasidagi munosabatlarni tartibga soladi.</p>
</body></html>`;

/** Sahifa BOSHQA hujjat haqida — model bergan raqam/sana/sarlavha tasdiqlanmaydi. */
export const LEX_PAGE_OTHER = `<!DOCTYPE html><html><head>
<title>Suv xo‘jaligi to‘g‘risidagi nizom, 03.02.2011</title>
</head><body>
<h1>Suv xo‘jaligi obyektlaridan foydalanish nizomi</h1>
<div>Qabul qilingan sana: 03.02.2011 Hujjat raqami: 27-son</div>
</body></html>`;
