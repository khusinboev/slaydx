/**
 * Namunaviy maqola (Maqola 2) — galereya, render/paritet testlari, jonli
 * sinov taqqoslovi. Haqiqiy manbalar emas (`verified: "user"` bilan
 * belgilangan), lekin shakli dvigatel chiqaradigan hujjat bilan bir xil.
 */
import type { AcademicDoc, DocMeta } from "../types";
import type { ArticleModel, ArticleTypeId, PublicationProfileId } from "./types";
import { ARTICLE_TYPES } from "./types-registry";
import { PUBLICATION_PROFILES } from "./profiles";
import { articleLabels } from "./labels";

export const SAMPLE_ARTICLE_MODEL: ArticleModel = {
  v: 1,
  type: "imrad_oak",
  profile: "oak",
  cite: "gost",
  udk: "004.8:37.02",
  language: "uz",
  authors: [
    { name: "Karimova Dilnoza Baxtiyorovna", degree: "PhD, dotsent", org: "Toshkent davlat iqtisodiyot universiteti", email: "d.karimova@tsue.uz", orcid: "0000-0002-1825-0097" },
    { name: "Aliyev Ali Valiyevich", degree: "magistrant", org: "Toshkent davlat iqtisodiyot universiteti", email: "a.aliyev@tsue.uz" },
  ],
  keywords: {
    uz: ["sun’iy intellekt", "adaptiv o‘qitish", "oliy ta’lim", "o‘zlashtirish", "baholash"],
    ru: ["искусственный интеллект", "адаптивное обучение", "высшее образование", "успеваемость", "оценивание"],
    en: ["artificial intelligence", "adaptive learning", "higher education", "academic performance", "assessment"],
  },
  references: [
    { id: "W2741809807", doi: "10.1186/s40561-023-00260-y", title: "Artificial intelligence in intelligent tutoring systems toward sustainable education: a systematic review", authors: ["Lin C.", "Huang A.", "Lu O."], year: 2023, venue: "Smart Learning Environments", verified: "openalex", cited: true },
    { id: "W4385", doi: "10.3390/app13116716", title: "Exploring the potential impact of artificial intelligence on interactive learning", authors: ["Ahmad S.", "Rahmat M.", "Mubarik M."], year: 2023, venue: "Applied Sciences", verified: "crossref", cited: true },
    { id: "u1", title: "Ta’limda raqamli texnologiyalar", authors: ["Karimov A."], year: 2022, publisher: "Fan", place: "Toshkent", pages: "120", verified: "user", cited: true },
  ],
  figures: [
    {
      id: "f1",
      kind: "scheme",
      caption: "Adaptiv o‘qitish tizimining umumiy tuzilmasi",
      spec: {
        kind: "flow",
        direction: "TB",
        nodes: [
          { id: "n1", label: "Talaba faoliyati", kind: "start" },
          { id: "n2", label: "Ma’lumot yig‘ish" },
          { id: "n3", label: "AI tahlil moduli" },
          { id: "n4", label: "Shaxsiy traektoriya", kind: "end" },
        ],
        edges: [
          { from: "n1", to: "n2" },
          { from: "n2", to: "n3" },
          { from: "n3", to: "n4" },
        ],
      },
      w: 1890,
      h: 1400,
      source: "Muallif tomonidan tuzilgan",
    },
  ],
  userFacts: "",
};

export function sampleArticleDoc(meta: DocMeta, over: { type?: ArticleTypeId; profile?: PublicationProfileId } = {}): AcademicDoc {
  const type = over.type ?? "imrad_oak";
  const profile = over.profile ?? ARTICLE_TYPES[type].defaultProfile;
  const L = articleLabels(meta.language);
  const model: ArticleModel = { ...SAMPLE_ARTICLE_MODEL, type, profile, cite: PUBLICATION_PROFILES[profile].cite, language: meta.language };
  return {
    meta: { ...meta, articleType: type, pubProfile: profile, topic: meta.topic || "Sun’iy intellektning oliy ta’limdagi o‘rni" },
    titlePage: false,
    toc: false,
    abstracts: [
      { lang: "uz", label: "Annotatsiya", text: "Maqolada sun’iy intellekt asosidagi adaptiv o‘qitish tizimlarining oliy ta’limdagi samaradorligi tahlil qilinadi. 120 talaba ishtirokidagi tajribada o‘zlashtirish ko‘rsatkichi 4,1 dan 4,6 ballga oshgani aniqlandi. Natijalar tizimni fanlararo joriy etish bo‘yicha tavsiyalarga asos bo‘ladi.", keywords: "sun’iy intellekt, adaptiv o‘qitish, oliy ta’lim" },
      { lang: "ru", label: "Аннотация", text: "В статье анализируется эффективность адаптивных систем обучения на основе искусственного интеллекта в высшем образовании. В эксперименте с участием 120 студентов показатель успеваемости вырос с 4,1 до 4,6 балла. Результаты служат основой для рекомендаций по межпредметному внедрению.", keywords: "искусственный интеллект, адаптивное обучение, высшее образование" },
      { lang: "en", label: "Abstract", text: "The article analyses the effectiveness of AI-based adaptive learning systems in higher education. In an experiment with 120 students the average grade rose from 4.1 to 4.6. The results support recommendations for cross-disciplinary adoption.", keywords: "artificial intelligence, adaptive learning, higher education" },
    ],
    sections: [
      { id: "intro", title: L.section.intro, blocks: [
        { kind: "p", text: "Oliy ta’limda raqamli transformatsiya sun’iy intellekt vositalarini o‘quv jarayoniga joriy etishni dolzarb masalaga aylantirdi [W2741809807]. Adaptiv tizimlar har talabaning o‘zlashtirish sur’atiga moslashadi [W4385]." },
        { kind: "p", text: "Maqolaning maqsadi — adaptiv o‘qitish tizimining o‘zlashtirishga ta’sirini empirik baholash." },
      ] },
      { id: "litreview_methods", title: L.section.litreview_methods, blocks: [
        { kind: "p", text: "Adabiyotlar tahlili shuni ko‘rsatadiki, intellektual o‘qitish tizimlari 2020-yildan keyin keskin rivojlandi [W2741809807]. Mahalliy tadqiqotlarda raqamli texnologiyalar pedagogik nuqtai nazardan o‘rganilgan [u1]." },
        { kind: "figure", text: "Adaptiv o‘qitish tizimining umumiy tuzilmasi", figureId: "f1" },
        { kind: "p", text: "Tadqiqot 2024/2025 o‘quv yilida 120 talaba ishtirokida o‘tkazildi; nazorat va tajriba guruhlari 60 tadan." },
      ] },
      { id: "results", title: L.section.results, blocks: [
        { kind: "p", text: "Tajriba guruhida o‘rtacha ball 4,1 dan 4,6 ga oshdi; nazorat guruhida o‘zgarish sezilarli emas." },
        { kind: "tableRef", text: "Guruhlar bo‘yicha o‘zlashtirish ko‘rsatkichlari", tableId: "t1" },
        { kind: "formula", text: "\\Delta = \\frac{\\bar{x}_2 - \\bar{x}_1}{\\bar{x}_1} \\cdot 100\\%", display: true },
      ] },
      { id: "discussion", title: L.section.discussion, blocks: [
        { kind: "p", text: "Olingan natijalar xalqaro tadqiqotlar bilan hamohang [W2741809807; W4385]; farq mahalliy o‘quv dasturlarining tuzilmasi bilan izohlanadi." },
      ] },
      { id: "conclusion", title: L.section.conclusion, blocks: [
        { kind: "p", text: "Adaptiv tizim o‘zlashtirishni sezilarli oshiradi; fanlararo joriy etish tavsiya etiladi." },
      ] },
    ],
    tables: [
      { id: "t1", caption: "Guruhlar bo‘yicha o‘zlashtirish ko‘rsatkichlari", headers: ["Guruh", "Boshlang‘ich ball", "Yakuniy ball"], rows: [["Tajriba (n=60)", "4,1", "4,6"], ["Nazorat (n=60)", "4,1", "4,2"]], anchor: "results" },
    ],
    article: model,
  };
}
