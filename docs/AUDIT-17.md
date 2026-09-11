# AUDIT-17 — Maqola 2: 12 tuzilma × 5 nashr profili, tekshirilgan manbalar, sxema/jadval/formula, tayyorlik hisoboti, ko'ruvchida tahrir, ko'p provayderli LLM

Sana: 2026-09-11. `AUDIT-16` dan keyin. Reja: `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`.

## 1. Talablar va qarorlar

Mahsulot egasi: «maqola bo'limini mukammal va pro darajaga chiqarish — internetdan maqola tuzilmalari, shablonlari, rasm/sxema/jadval qonuniyatlarini chuqur o'rganib, parametr oynalarini qayta dizaynlash va to'liq qurish; narx tannarxdan past bo'lmasin; faqat Gemini'ga bog'lanib qolmaslik — sifatli, tadqiqotda kuchli, narxi me'yorida 2–3 qo'shimcha AI API».

| № | Qaror | Asos |
|---|---|---|
| Q-1 | Manbalar **haqiqiy, tekshiriladigan**: OpenAlex + Crossref; model faqat topilgan ro'yxatdan `[ID]` bilan iqtibos qiladi; generatsiyadan keyin har iqtibos qayta tekshiriladi; ro'yxatga faqat iqtibos qilingan manba kiradi | AI iqtiboslarining 20–32% uydirma (Scientific Reports 2023; 2025 tadqiqotlari); OAK: «foydalanilmagan manba ro'yxatga kirmaydi»; OpenAlex CC0 (2026-02 dan bepul kalit), Crossref ochiq |
| Q-2 | Vizuallar: jadval matn ichida (sarlavha TEPADA) + sxema/diagramma serverda SVG→PNG 300 dpi (sarlavha PASTDA); grafik faqat foydalanuvchi ma'lumotidan; stock/AI rasm yo'q | OAK/APA/IEEE — jadval nomi tepada, rasm nomi pastda; ma'lumotsiz grafik = uydirma raqam |
| Q-3 | Kirish materiallari: fayl (DOCX/PDF/TXT/XLSX) + «Natijalarim» matni + o'z manbalari (DOI/matn/BibTeX) | AI faqat foydalanuvchi faktlariga tayanadi |
| Q-4 | Narx hajmga qarab, hammasi ichida: **4 000 / 6 000 / 8 000 / 12 000** (tezis 1–2 / 3–5 / 5–10 / 10–15 bet) | Tannarx modeli (§4): 2026-da ≥4×, 2027-da ≥2× marja; eski 4/5/8 ming 2027-da 1,3–1,5× ga tushardi |
| Q-5 | Tillar uz/ru/en; annotatsiya va kalit so'zlar doim uchalasida | OAK va ko'p jurnallar talabi |
| Q-6 | Ko'ruvchida tahrir shu sprintda (`edit-adapters` ga `article`) | Rezyume/slayd naqshi tayyor |
| Q-7 | **12 tur**: imrad_oak ⭐, imrad_classic, three_part_uz, review_narrative, review_systematic (PRISMA), short_communication, case_study_care (CARE 13), conference_thesis (200–300 so'z), conference_extended, methodical, analytical, elsevier_ieee_style | Frontiers/JMIR tur tasnifi, CARE, PRISMA, oriens.uz/TATU/FarDU/fledu talablari |
| Q-8 | **5 nashr profili**: oak (TNR 14, 1.5, 2/2/3/1.5 sm, `[1; 25-b.]`, GOST + REFERENCES, UDK), university (TNR 14, yakka, UDK, `[1]`, ≤15 varaq), apa (TNR 12, 1.5, (Muallif, yil), ≥15 manba, >50% oxirgi 5 yil), ieee (raqamli, raqamlangan bo'limlar), conference | O'zbekistonda yagona standart yo'q — bitta tanlov hammasini beradi |
| Q-9 | Tayyorlik hisoboti to'liq: qoidalar + LLM-baholovchi, 0–100 ball, «Tuzatish» | Paperpal Preflight / Jenni claim validation analogi; taqrizchi checklistlari |
| Q-10 | Provayderlar: yozuvchi Gemini 3.7 Flash, baholovchi Claude Sonnet 5, tadqiqot OpenAlex+Crossref (+Gemini fast); zaxira zanjiri Gemini → Claude → OpenRouter; sotib olinadi **Anthropic + OpenRouter** | §3 |
| Q-11 | Token telemetriyasi `generations.cost_json`; narx jadvali sanaga bog'liq (Gemini 2027-01-01 dan 2×); `scripts/cost-report.mts` | Narx tannarxdan past bo'lmasin — o'lchanadi |

## 2. Tadqiqot xulosalari (manbalar bilan)

- **Turlar/tuzilmalar**: IMRAD va variantlari (IMRaD+C, ILMRDC — ijtimoiy fanlar va OAK jurnallari), narrative/systematic review (PRISMA flow majburiy), short communication (Frontiers ≤4 000 so'z), case report (CARE 13 punkt, Timeline), konferensiya tezisi (200–300 so'z, iqtibossiz), extended abstract, metodik, tahliliy. Bo'lim ulushlari — amaliyot tavsiyasi, rasmiy standart yo'q (Elsevier YPYW). Manbalar: frontiersin.org article-types, support.jmir.org, care-statement.org/checklist, editage IMRAD, elsevier.com guide-for-authors.
- **O'zbekiston (OAK)**: OAK Rayosati qarori 214/8 (2015, o'zg. 239/8, 2017; lex.uz/docs/3244217; oak.uz/userfiles/files/6_ Amaliyot.pdf): TNR 14, 1.5 interval, chegara 2/2/3/1.5 sm, xatboshi 1.27, iqtibos `[1; 25–26-b.]`, rasm nomi OSTIDA («1.1-rasm»), jadval nomi USTIDA, formula raqami o'ngda «(1.1)», foydalanilmagan adabiyot taqiq. Jurnallar: oriens.uz (IMRAD, annotatsiya 150–200 so'z, kalit so'z 8–12, APA/GOST, o'zbek adabiyotlari inglizcha REFERENCES sifatida takrorlanadi; o'z hujjatida Natijalar/Muhokama tartibi ziddiyatli), tuit.uz xabarnomasi (Kirish–Asosiy qism–Xulosa, UDK, TNR 14 yakka, ≤15 varaq, uch tilli annotatsiya), FarDU (APA 7, ≥15 manba, >50% oxirgi 5 yil, ORCID, AI disclosure), fledu.uz (12–15 bet, ≥30 manba, ikki ro'yxat GOST + APA), TDIU (≤7 bet). Antiplagiat: originallik ≥85% (scienceproblems.uz), ВАК amaliyoti 70–85%.
- **Xalqaro**: structured abstract 150–300 so'z; kalit so'zlar 4–6; Elsevier Highlights 3–5 × ≤85 belgi; graphical abstract 1328×531 px; bo'limlar 1., 1.1.; jadval nomi tepada, rasm nomi pastda — APA 7, IEEE, Springer (≥300 dpi); iqtibos oilalari APA/Harvard (muallif-yil) vs Vancouver/IEEE/GOST (raqamli); ГОСТ Р 7.0.5-2008 (havola) ≠ ГОСТ 7.1-2003 (tavsif); DOI majburiy (APA 7 `https://doi.org/`).
- **Uydirma manbalar**: ChatGPT 32,3% (nature.com s41598-023-41032-5), 2025: 19,9% mavjud emas + 45,4% xato; Springer Nature 2025 kitobni qaytarib oldi. Yechim: retrieval-first (OpenAlex/Crossref) + post-verify. API'lar: OpenAlex 250M+ (CC0, 2026-02 dan kalit, kunlik $1 bepul), Crossref (kalitsiz, polite `mailto`), Semantic Scholar (ODC-BY — atribut majburiy, shuning uchun asosiy emas).
- **Taqrizchi mezonlari**: yangilik, metodologiya takrorlanuvchanligi, natijalar jadval/grafikda, muhokamada adabiyot bilan taqqoslash, cheklovlar, xulosa ma'lumotdan oshmasligi (Elsevier reviewer guide, EQUATOR/PRISMA/CONSORT/STROBE/CARE). «AI izi»: manbasiz aniq raqamlar, «suv» iboralar, bir xil jumla uzunligi; AI-detektorlar ishonchsiz (~80%, non-native false positive) — detektor emas, faktlar tekshiriladi.
- **Vizuallar**: sxema/blok-sxema ma'lumot talab qilmaydi (AI uchun eng xavfsiz); grafik faqat real raqamda; har vizual matnda havola, o'z-o'zidan tushunarli, manba qatori; Mermaid/Graphviz → PNG naqshi; ma'lumotsiz — placeholder/sifatiy jadval.
- **Raqobatchilar**: SciSpace (800+ jurnal shabloni, compliance check), Paperpal (30+ preflight, 10 000+ iqtibos uslubi), Jenni (claim validation), Elicit/Consensus (manba qidiruv), Yomu, Writefull; rus bozori — Telegram botlar; **o'zbek bozorida AI generator yo'q**. Differensiator: uz/ru/en annotatsiya + UDK + OAK profili + GOST iqtibos + tekshirilgan manbalar.

## 3. Provayder tadqiqoti (2026-09 holati)

| Provayder | Narx (kirish/chiqish $/1M) | Tadqiqot | O'zbekistondan | Xulosa |
|---|---|---|---|---|
| Google Gemini 3.7 Flash (bor) | 0.75 / 3.75 (2027-01-01 dan 1.50 / 7.50) | Grounding 5 000 bepul/oy, keyin $14/1 000; Deep Research $1–7/vazifa | bor | Yozuvchi (arzon, Turkiy tillarda kuchli) |
| **Anthropic Claude Sonnet 5** | 2 / 10 (1M kontekst; tokenizator ~+30%) | Web search $10/1 000 + iqtibos `citations`; structured output GA | **rasman qo'llab-quvvatlanadi** (175 mamlakat ro'yxati) | Baholovchi + zaxira yozuvchi; **sotib olinadi** |
| OpenAI GPT-5.6 terra/luna | 2 / 12; 0.20 / 1.20 | web search $10/1 000; Deep Research $0.4–30/so'rov (oldindan noma'lum) | rasman bor | OpenRouter orqali zaxira |
| xAI grok-4.3 (bor) | 1.25 / 2.50 | web/X search $5/1 000 (2026-09-21 dan qimmatlashadi) | noaniq, EU'da bloklangan | Faqat zaxira yozuvchi |
| Perplexity Sonar / Search API | Search $5/1 000 so'rov (tokensiz); deep research $0.3–1.3 | akademik rejim, DOI bermaydi | tekshirilmagan | Hozircha yo'q |
| **OpenRouter** | provayder narxi + 5,5% | — | karta/AliPay/USDC | **sotib olinadi** (universal zaxira) |
| DeepSeek/Qwen/Mistral/Kimi | 0.14–2 / 0.42–6 | — | DeepSeek to'g'ridan-to'g'ri: +86 telefon | o'zbekcha sifat dalili yo'q — faqat inglizcha oraliq bosqichlar |
| OpenAlex / Crossref / Semantic Scholar | ~bepul | DOI, abstract, iqtibos soni | — | **Tadqiqot asosi** |

O'zbek tili dalillari: arXiv 2508.14586 («Filling the Gap for Uzbek», 2025) — Gemini 2.0 Flash uzn→eng eng yaxshi (32.81 BLEU), Claude Sonnet 4 uzs→uzn eng yaxshi (83.63 chrF++); 2026 avlodi uchun benchmark yo'q. Iqtibos ishonchliligi bo'yicha manbalar ziddiyatli (FACT: Claude search 94%, OpenAI DR 78%; boshqa tadqiqotlarda Perplexity/Gemini 37–76% xato) — shuning uchun har iqtibos OpenAlex/Crossref bilan post-verifikatsiya qilinadi, deep-research agentlariga tayanilmaydi.

## 4. Tannarx modeli

1 tanga = 1 so'm (`SOUM_PER_COIN`), 12 700 so'm/$. Chiqish(p bet) ≈ 6 000 + 1 265×p token, kirish ≈ 30 000 + 10 400×p; ×1,12 (yiqilgan ishlar, tuzatishlar).

| Paket | Gemini tannarx 2026 | 2027 | + Claude baholovchi (~$0,09) | Narx | Marja 2026 |
|---|---|---|---|---|---|
| Tezis 1–2 | 907 | 1 814 | ~2 050 | 4 000 | ~2× (tezisda baholovchi arzonroq, ~1 500 → 2,7×) |
| 3–5 | 1 354 | 2 708 | ~2 500 | 6 000 | 2,4× |
| 5–10 | 1 979 | 3 958 | ~3 100 | 8 000 | 2,6× |
| 10–15 | 2 871 | 5 742 | ~4 000 | 12 000 | 3× (2027: ~1,7×) |

Baholovchi bitta chaqiruv (~25k kirish / 2k chiqish, Claude tokenizatori +30%). 2027 o'sishi `llm-pricing.ts` jadvalida; `cost-report` haqiqiy marjani ko'rsatadi — narx `ARTICLE_PRICES` bitta qatori bilan o'zgaradi.

## 5. Arxitektura

(Reja faylidagi diagramma.) Yagona manba: matn `sections` + `Block` (`figure`/`formula`/`tableRef` — har blokda `text`: sarlavha yoki LaTeX), metama'lumot `doc.article` (`ArticleModel`), tartib/raqamlash `article/layout.ts planArticle` → DOCX va `flow.ts`.

## 6. Bajarilish yozuvi

- `b774836` WP0 — `Block`/`DocTable.id`/`AcademicDoc.article`, 12 tur skeleti (`types-registry.ts`), 5 profil (`profiles.ts`), yorliqlar, `ARTICLE_PARAMS`, `DocMeta` maydonlari, 020 migratsiya (`cost_json`, `form_drafts` ← `resume_drafts`, `source_cache`), `sharp`/`katex`/`@anthropic-ai/sdk`, worker timeout 660 s; `tests/article-registry.test.mts` (5).
- `47222fa` WP0b — `llm-roles.ts` fasadi (`complete(role,…)`, `CostMeter`), `article/samples.ts`.
- `0027803` WP2 (opus, 6 kommit) birlashtirildi — `article/layout.ts planArticle` (ArticlePlan: head/body/refs/refs2, raqamlash flat/chapter, `renderCitations` 4 uslub, `orderReferences`, `legacyArticleModel`), `omml.ts` (LaTeX → OMML, qoplanmagan → MathRun), `articleProfile`, `render-docx.ts drawArticle` (UDK/mualliflar/annotatsiya ×3/highlights, figure o'rinbosar/ImageRun + sarlavha pastda, tableRef sarlavha tepada, formula markaz + (1), REFERENCES), `flow.ts`/`paginate.ts`/`WordViewer.tsx`/`ArticleHead.tsx` (KaTeX SSR, `data-ref-verified` ✅/⚠️); 7 test fayli, 72 test, 10/10 mutatsiya, LibreOffice ko'z (oak 3 varaq, ieee 3 varaq). KaTeX shriftlari Next build orqali `/_next/static/media` — `public/katex` kerak bo'lmadi.
- `727385a` WP1 (opus, 5 kommit) birlashtirildi — `article/{input,prompts,engine,guard}`, `research/{http,openalex,crossref,cache,pipeline,verify}` (retrieval-first: foydalanuvchi manbalari → `fast` so'rovlar → OpenAlex → dedup → `researcher` faqat ro'yxatdan tanlaydi → Crossref tasdiq; `[ID]` iqtibos; `verifyCitations` noma'lum ID ni o'chiradi; `citedOnly`), `write-llm` dispatch, `structure` (tur `hard` bo'limlari + PRISMA), `budget`, `tools.ts` (`ARTICLE_PRICES`, `custom:"article"`, `normalizeArticlePages` — tezis «10-15» so'rasa ham 1-2), `live-engine` 4 holat. **Jonli (haqiqiy Gemini 3.7 Flash + OpenAlex kalitsiz):** article-oak 15 manba (13 OpenAlex, 1 Crossref, 1 foydalanuvchi), 46 iqtibos, 0 noma'lum, annotatsiya 156/170/161 so'z, 11 bet, 30 s, 12 chaqiruv; article-review 35 manba, 108 iqtibos, structured annotatsiya, 14 bet; article-thesis 3 manba, 219 so'z, 15 s; article-en-ieee 33 manba, 95 iqtibos, 4 highlights ≤85. Ko'z bilan: barcha raqamlar foydalanuvchi faktlaridan, manbasiz foiz 0, DOI'lar haqiqiy. Jonli topib tuzatilganlar: JSON rejimida bo'lim hajmi 45% → paragraf soni + pastki chegara; «kengaytir» takror yozardi → mavjud matn promptda; `citedBy` bo'yicha to'ldirish umumiy sharhlarni kiritardi → relevantlik bo'yicha aralashtirish. 57 test, 8 mutatsiya. Chetlanish: `writeImradWithLlm` tezis uchun qoldi (dispatch toraytirildi); eski `StandardForm` article uchun WP6 gacha vaqtincha ishlamaydi.
- `f95a696` WP4 (sonnet, 5 kommit) birlashtirildi — `lib/server/form-draft.ts` (`form_drafts`, `ON CONFLICT (user_id, tool_id)`, tool tekshiruvi 400), `/api/forms/[toolId]/draft` (+ `/api/resume/draft` o'ram), `useFormDraft` (+ `useResumeDraft` o'ram, rezyume UI 12/12), `jobs.ts setCost` (egalik `locked_by`, `price` ga tegmaydi), `worker.ts` → `cost_json`, `extractAssets` figure PNG → aktiv, `preview.ts` maqola kartasi, `scripts/cost-report.mts` (lokal: article 19 ish, o'rtacha tannarx ≈1 429 so'm, narx 6 158, marja ≈4,3×); 24 test, 5 mutatsiya (jumladan `price` ni ham yangilash → qizardi).
- R2/R3: WP3 sxemalar (opus) va WP6 forma (sonnet) — davom etmoqda.
