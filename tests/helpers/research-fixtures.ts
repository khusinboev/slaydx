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
      return new Response(status === 200 ? JSON.stringify(body) : "", { status, headers: { "content-type": "application/json" } });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch & { calls: StubCall[] };
  fn.calls = calls;
  return fn;
}
