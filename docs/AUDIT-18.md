# AUDIT-18 — Maqola 3: Avto-sayqal, sxema turlari, tur/profil «ovozi»

Davomi: `docs/AUDIT-17.md` (Maqola 2, prod 2026-09-12). Boshlangan: 2026-09-12.

## 1. Talab va qarorlar

Foydalanuvchi savollari (2026-09-12): «77 % ni AI o'zi 100 % ga yaqinlashtira oladimi?», «sxemalar mavzuga qarab turli shaklda bo'lsinmi, resurs?», «tur va profil parametrlari bezakmi?». Tahlil (§2) va qarorlar:

| # | Qaror | Asos |
|---|---|---|
| Q-1 | **Avto-sayqal sukut bo'yicha YOQIQ**: hisobotdan keyin dvigatel tuzatiladigan bandlarni o'zi tuzatadi va Claude qayta baholaydi; ≥ 90 yoki foyda yo'q → to'xtaydi; ko'pi bilan 1 aylanish dvigatelda (vaqt byudjeti), natija sahifasida «Hammasini tuzatish» bilan yana (bepul, 3 marta/maqola/kun) | Qo'shimcha tannarx ≈ $0.05–0.08 (Claude qayta bahosi $0.03 + 3–5 Gemini qayta yozuvi), narx ichida (8 000 vs ~2 000 so'm); vaqt +60–90 s |
| Q-2 | **Halollik chegarasi**: AI faqat matnni kuchaytiradi — tajriba natijasi, dastgoh/datchik parametri, aniqlik foizi o'ylab TOPMAYDI; bunday bandlar hisobotda «Sizdan kutiladi» blokiga tushadi (UDK, email/ORCID, «Natijalarim») | Asosiy mahsulot qoidasi (AUDIT-17 Q-1); soxta maqola = obro' yo'qotish |
| Q-3 | Ballni tushirmaslik kafolati: sayqal natijasi faqat ball OSHSA qabul qilinadi (aks holda eski hujjat qoladi, hisobotda izoh) | Foydalanuvchi «tuzatish»dan keyin yomonlashganini ko'rmasin |
| Q-4 | UDK — formada **taklif** (LLM `fast`, «tekshiring» belgisi), dvigatel jimgina to'ldirmaydi | UDK noto'g'ri bo'lsa jurnal qaytaradi |
| Q-5 | Sxemalar: **5 yangi tur** — `layers` (qatlamli arxitektura), `cycle` (sikl), `timeline` (vaqt chizig'i), `matrix` (2×2 / SWOT), `compare` (ikki ustun taqqoslash); uslub o'zgarmaydi (qora-oq, vektor, TNR); AI rasm generatsiyasi YO'Q | Jurnal talabi — mazmunga moslik; runtime xarajat ≈ 0 (server chizadi) |
| Q-6 | Formada ixtiyoriy «Sxema turlari» tanlovi (standart — avtomatik, mazmunga qarab); reyestrga `figureKinds` parametri, zond bilan | «Bezak maydon yo'q» qoidasi |
| Q-7 | Har turga **yozish qoidalari** (`guidance`) va **turga bog'liq baholovchi mezonlari** (`judge` — tavsif + o'tkazib yuboriladigan mezonlar); tezis 3–4 mezon | Sharh maqolasi «metodlar takrorlanuvchanligi» bilan adolatsiz qizil edi (77 % holati) |
| Q-8 | `maxPages` → hisobot bandi (`pageLimit`) va forma ko'rsatmasi; `figureNumbering` qoladi (universitet profili uchun «1.1-rasm» keyin) | Bezak maydon yo'q |
| Q-9 | 12 tur × 5 profil to'liq matritsa testi: har tur qo'shnisidan reja+prompt bilan, har profil render+hisobot bilan farq qiladi | Zond faqat A/B juftlikni tekshirardi |

## 2. Tahlil xulosasi (2026-09-12)

- 12 tur skeleti turlicha; tur reja/hajm/PRISMA/timeline/numbered/highlights/structured/profil/paketga ta'sir qiladi — bezak emas; LEKIN promptda faqat «Article type: …» — turga xos yozish qoidalari yo'q, baholovchi tur bilmaydi.
- 5 profil: 22 maydondan 19 tasi iste'mol qilinadi va farq qiladi; `maxPages` ishlatilmaydi; `figureNumbering` hammada `flat`; `recentYearsMin` hammada 5.
- Qolgan 13 parametr — reyestr zondi bilan tasdiqlangan.
- 77 % maqola (`5ce1774e`): qoidalar 15 yashil/4 sariq (UDK, email/ORCID, jadval havolasi, hajm 78 %); baholovchi 11/18. Avto-tuzatish bilan ≈ 88–92; 95–100 faqat foydalanuvchi ma'lumoti bilan.

## 3. Arxitektura

```
engine.ts 7-bosqich: review (qoidalar + judge)  ──►  8. polish (Q-1)
   polish.ts  planPolish(review, doc) → PolishFix[] (qoidalar: length/visuals/limitations/filler/repetition + judge fixes; Q-2 filtr: userFacts talab qiladiganlar chiqariladi)
              applyPolish(doc, fixes, {complete, deadline}) → ops (rewriteArticleSection mapPool 3 — article-rewrite.ts dan ko'chirilgan sof mantiq)
              → reviewArticle(judge: true) → ball oshsa qabul (Q-3) → review.polish = {before, after, applied[], skipped[]}
   9. render
server: POST /api/generations/[id]/polish  (limit 3/maqola/kun, 20/foydalanuvchi/kun) → shu polish.ts → commitDocOps (review op)
UI: ArticleReviewPanel — «Hammasini tuzatish» (fixing holati), «Sizdan kutiladi» bloki (udk/authors/userFacts → forma qoralamasiga havola), sayqal jurnali («Avto-sayqal: 74 → 86, 4 band tuzatildi»)
Forma: UDK «Taklif» tugmasi (POST /api/article/udk → fast), «Sxema turlari» chips (auto | …)
figures/: model.ts FigureSpec += layers|cycle|timeline|matrix|compare; layout-*.ts har turga; svg.ts primitivlar; prompts figureSpecHelp + tur→tur tavsiyasi
types.ts: ArticleType += guidance: string[], judge?: {skip?: JudgeCriterion[], describe?: Partial<Record<JudgeCriterion,string>>}; PublicationProfile.maxPages → review pageLimit
```

## 4. Ish paketlari

- **WP-A (opus, agent)** — Avto-sayqal: `article/polish.ts` (sof), `article-rewrite.ts` refaktor (sof qism polish.ts ga, server o'rami qoladi), engine 8-bosqich (byudjet: `remainingMs ≥ 90 s`, aks holda o'tkazib yuboriladi va hisobotda izoh), `POST …/polish`, `api-edit.ts polishArticle`, `ArticleReviewPanel` («Hammasini tuzatish», «Sizdan kutiladi», sayqal jurnali), `ResultView` ulanishi, `ArticleReview.polish` tipi, UDK taklif (`POST /api/article/udk`, `ArticleComposer` «Taklif» tugmasi); testlar: `article-polish` (reja/filtr/qabul-rad), `article-polish-route`, `ui/article-polish`, engine testi (8-bosqich stub bilan); mutatsiya ≥ 5.
- **WP-B (opus, agent)** — Sxema turlari: `figures/model.ts` 5 tur + `figureSpecFromLlm` tekshiruvlari (layers 2–7 qatlam ×≤4 band; cycle 3–8; timeline 3–10; matrix 2×2 + o'q yorliqlari; compare 2 ustun × ≤6 qator), `figures/layout-{layers,cycle,timeline,matrix,compare}.ts`, `svg.ts` primitivlar (yoy o'q, aylana joylashuv), `prompts.ts figureSpecHelp` (qachon qaysi tur; tur→tavsiya: analytical → matrix/compare, review → timeline/layers, methodical → process/cycle, imrad → flow/layers), `article-params.ts` `figureKinds` (json, probe), `input.ts`, `ArticleComposer` chips, `scripts/figures-lab.mts` 5 yangi namunа + PNG ko'z; testlar `figures-{layers,cycle,timeline,matrix,compare}`, mutatsiya ≥ 5 (sikl o'qlari, timeline tartibi, matrix kvadrantlari…).
- **WP-C (lead)** — Tur/profil: `types.ts` `guidance`/`judge`, `types-registry.ts` 12 tur uchun qoidalar (en, 2–4 qator) va baholovchi moslamasi (review/systematic/methodical/case/thesis/extended/analytical/short), `prompts.ts articleSystemPrompt` «TYPE RULES», `review.ts` judge prompti turga bog'liq + `skip` (ball formulasi faqat sanalganlar), `pageLimit` bandi (`estimateArticlePages` bilan) + forma ko'rsatmasi, `tests/article-matrix.test.mts` (12×5), guard/review testlari; mutatsiya ≥ 4.
- **R (lead)** — integratsiya, jonli (`article-oak`, `article-review` — sayqal bilan ball o'sishi, sxema turlari), Chromium smoke (natija sahifasi «Hammasini tuzatish», forma UDK taklif, sxema turi chips), LibreOffice ko'z (5 sxema), docs, deploy.

Cheklovlar (CLAUDE.md): og'ir buyruqlar faqat `scripts/heavy.sh`, bitta test fayli, ≤ 2 agent, `assert.ok(!el)`; agentlar avval `git merge main`.

## 5. Bajarilish yozuvi

(pastga yoziladi)
