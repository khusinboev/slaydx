# R5 — Flesh kartalar (bosma + interaktiv)

AUDIT-20 §1 shabloni bo'yicha. Har faktga URL berilgan.

## 1. Rasmiy shakl/standart

| Hujjat | Nima beradi | Manba |
|---|---|---|
| ISO kartocha o'lchamlari | **A7** — 74 × 105 mm (A4 dan 1/8, sakkitadan bitta) — bosma uchun standart; **A6** — 105 × 148 mm (A4 dan 1/4) — katta yozuv uchun; **4×6 inchi** — eng xalqaro, A6 ga yaqin | [scholarsail.com: Flashcard sizes](https://scholarsail.com/blog/flashcard-sizes-and-dimensions), [DoxZoo paper guide](https://help.doxzoo.com/en/articles/1362188-a-guide-to-paper-size) |
| Bosma sifati: kertas | Kartochka stock 90–110 lb cover (243–297 gsm) — A7/A6 uchun optimal; 300 DPI, CMYK rang modeli, 3 mm bleed | [DoxZoo: How to make flashcards](https://doxzoo.com/blog/how-to-make-your-own-flashcards/), [flashcard-maker.cc: Dimensions guide](https://flashcard-maker.cc/blog/flash-card-dimensions/) |
| Duplex (ikki tomonli) bosma | Flip on long edge — karti aylantirish ustun bo'yi bo'yicha (so'z → ta'rif rotatsiyada mantiqiy). Old betlar (10 ta) → orqa betlar oynali (10 ta) — 2×5 jadval A4'da. | [CalcBE: Index card generator](https://calcbe.com/en/tools/index-card-paper/), [flashcard-maker.cc guide](https://flashcard-maker.cc/blog/flash-card-dimensions/) |
| Leitner tizimi | 5 qutili sistem: kartocha noto'g'risi → 1-quti, to'g'risi → keying quti (2–5) bo'ladi; qayta ko'rib chiqish vaqti ortadigan intervalda (spaced repetition). Xodimlari 1972 yili ta'qdimlangan | [e-student.org: Leitner System](https://e-student.org/leitner-system/), [Wikipedia: Spaced repetition](https://en.wikipedia.org/wiki/Spaced_repetition) |
| Quizlet/Anki/Wordwall kartalar | Asosiy tur: term-ta'rif, savol-javob, rasm-so'z (muqaddas). Anki — front/back template; Quizlet — avtomatik q→a generatsiya. Til ma'lumotlar uchun "so'z → tarjima → misol" uchun-tur | [Quizlet help](https://help.quizlet.com/hc/en-us/articles/360030988091-Studying-with-Flashcards), [Anki manual](https://docs.ankiweb.net/getting-started.html), [e-student: Card types](https://e-student.org/flashcard-types/) |

**Muhim topilma:** A7 bosma standart ta'lim uchun (8 ta A4 sahifaga) — sodda.ai-da format tanlash yo'q bo'lsa ham, `paperSize` biz aniq belgilashimiz kerak. Duplex "flip on long edge" — karta aylanish psiholoji (so'z yuqorida qoladi) — tezkor o'rganish uchun.

## 2. Raqobatchilar parametrlari

| Parametr | sodda.ai | Bizda kerak |
|---|---|---|
| Narx | 2000 (tekis — karta soni ta'sir yo'q) | Baholandi: 2000 tekis (PM qaror) |
| Karta soni | 5 / 10 / 15 / 20 | 5/10/15/20 chips — standart 10 |
| Til | 18 (8 + «Ko'proq» +10) | 18 til (raqobatchi bilan mos) |
| Karta turi | aniqlanmadi (faqat "Flesh kartalar") | Bizda: atama-ta'rif / savol-javob (2 tur, keyin rasm-so'z) |
| Bosma format | aniqlanmadi (ehtimol veb faqat) | **A7 DOCX jadval 2×4 + duplex orqa** |
| Chiqish format tanlovi | yo'q | faqat DOCX (PDF keyin — DOCX o'rti) |
| F.I.Sh. maydon | aniqlanmadi | yo'q (faqat krossvordda) |
| O'qituvchi paneli | aniqlanmadi | yo'q (interaktivda 3-dasturda) |

**Xulosa:** sodda.ai faqat **interaktiv veb** (rejim tanlash umuman yo'q); bizda **bosme DOCX birinchi bosqich, keyin interaktiv+ Leitner 3-dasturda**.

## 3. Bizga tavsiya — reyestr

**Turlar** (`AcademicDoc.game.cards.type`): `term-definition` (atama-ta'rif), `question-answer` (savol-javob), keyin `image-word` (2-bosqich).

**Parametrlar:**

| id | tur | variantlar | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `cards` | chips | 5/10/15/20 | 10 | ha | prompt, delivered |
| `cardType` | select | term-definition / question-answer | term-definition | ha | prompt (yozish tartibi) |
| `language` | select | uz/ru/en + 15 | uz | ha | prompt, karta tili |
| `subject` | text (ixtiyoriy) | — | — | yo'q | prompt (context) |
| `includeExamples` | toggle (ixtiyoriy) | true/false | false | yo'q | prompt (3+ ta misol qo'shishi) |
| `extra` | textarea (ixtiyoriy) | — | — | yo'q | prompt (glossariy, qo'shimcha) |
| `paperSize` | fixed | A7 (74×105 mm) | A7 | yo'q | layout (A4 da 8 ta karta) |
| `duplexOrder` | fixed | long-edge-flip | long-edge-flip | yo'q | layout (orqa bet tartibi) |

**Maket qoidalari (DOCX):**
- **Bet 1 (old yuzlar):** 2 ustun × 4 qator = 8 ta 74×105 mm kasonik jadval; har kasonikda "OLD" USTUN (qalinroq font, Lato/Geist, 14 pt);
- **Bet 2 (orqa yuzlar, oynali flip):** 2×4 jadval o'sha o'rinda, har kasonikda "ORQA" (faqat javob/ta'rif/misolli, font 11 pt);
- **Kesish chiziqlari:** 0.5 pt, oq rang, katalogu(keraaksiz).

**Interaktiv 2-bosqich model:**
```
AcademicDoc.game = {
  kind: "flashcards",
  cardType: "term-definition" | "question-answer",
  cards: [
    {id, front, back, hint?, example?},  // front = atama/savol, back = ta'rif/javob
    ...
  ],
  settings: {leitnerBoxes: 5, reviewInterval: [1,3,7,14,30] /* kunlar */}
}
```

**Leitner dvigateli** — server `game_sessions` + `game_results`: kartocha to'g'ri → quti n+1; noto'g'ri → quti 1; vaqt cheklovi yo'q (uy uchun).

## 4. Sifat mezonlari

**Deterministik qoidalar**:

| id | Nima tekshiradi | Chegara |
|---|---|---|
| `cardCount` | Karta soni | = `cards` parametri (5/10/15/20) |
| `frontLength` | Har atama/savol | 5–50 belgi (o'zbekcha) |
| `backLength` | Har ta'rif/javob | 20–200 belgi (misol bilan) |
| `noDuplicate` | Bitta kartada davom etuvchi atama | 0 (bitta set ichida) |
| `examplePresence` | Agar `includeExamples=true` | ≥50% kartada misol bor |
| `cardTypeMatch` | Har karta `front`/`back` mavzug'i | atama-ta'rif mus(A);mos, savol-javob mus(A)mos |

**Judge mezonlari** (4–5, ingliz):

1. `termClarity` — is the front (term/question) unambiguous and self-contained?
2. `definitionCompleteness` — does the back fully answer/define without needing the front?
3. `languageLevel` — is vocabulary appropriate for the stated grade/subject?
4. `exampleRelevance` (agar misol bor) — does the example directly illustrate the term?
5. `memorability` — is the back concise enough to remember (not a paragraph)?

**Halollik chegarasi:** Atama/javob rasmiy lug'at yoki darslik manbasidan kelinadimi — foydalanuvchi o'zi e'lon qilganda faqat ishlatiladi (LLM o'ylab topmaydi).

## 5. Namunalar

- **A7 kartochka shablon (bosma):** [printables.com: A7 flashcards](https://printables.com/model/209419-card-index-for-flash-cards-a7) — PDF шаблон, kesish chiziqlari bilan.
- **Quizlet javohirlar (veb):** [quizlet.com/flashcards](https://quizlet.com) — interaktiv o'rganish, mobile app, Leitner-uslub.
- **Anki kartalar (o'z-o'z qupala):** [docs.ankiweb.net](https://docs.ankiweb.net/getting-started.html) — ochiq APKG format, spaced repetition engine.
- **Wordwall flashcards:** sodda.ai-dagi kabi, interaktiv veb, lekin qo'shimcha "Memory match" mode.

**LLM uchun yaxshi/yomon misol (o'zbekcha):**

✅ **Yaxshi (term-definition):**
- **Old:** FOTOSINTEZ | **Orqa:** O'simlik barglari quyosh nurida organik moddalar (glyukoza) yaratadigan jarayon; CO₂ + H₂O + nur → C₆H₁₂O₆ + O₂. **Misol:** "Barglar yashil rangda fotosintez tez ko'rinadi."

✅ **Yaxshi (question-answer):**
- **Old:** "Umuman o'rta o'quvchi yig'indisida nechta atom bor?" | **Orqa:** ~7×10²⁷ atomi (Avogadro raqami ≈ 6.022×10²³); inson tanasida ≈ 10²⁸ atom. **Misol:** "Bir damla suv ≈ 10²¹ molekula."

❌ **Yomon:**
- **Old:** BIOLOGIYA | **Orqa:** Narsalarni o'rganish (juda keng, boshqa fanlar uchun ham mos).
- **Old:** "Nima?" | **Orqa:** "Kitob" (savolmi, savol emas; to'liqsiz).

## 6. Ochiq savollar / egasidan kerak narsalar

1. **Kartocha turi — keyin o'zgartiramizmi?** Birinchi bosqich faqat `term-definition` / `question-answer`; keyin `image-word` (AUDIT-22 3-dastur) qo'shamizmi?
2. **Misol qo'shish** — `includeExamples` toggleni qo'shish uchun LLM extra chaqiruv kerakmi yoki bitta promptda?
3. **Duplex chop etish** — real DOCX'da "flip on long edge" — LibreOffice/Word duplex print dialog so'zlari qaysi inglizchada?
4. **Uzbek alfavit** — oʻ, gʻ, ʼ bitta katak qaysi shriftda normal chiqadi (A7'da 11 pt)? Geist/Tinos?
5. **Interaktiv runtime** (3-dastur) — real vaqt sinhronizatsiya (server → client, kartocha aylanishi) kerakmi yoki "offline o'yin, natija yakuniy qilish"?

## 7. Kod/git

Tayyor: Leitner algoritm, bosme A7 javalol, judge metrikalari. Kerak:
- `lib/generation/games/flashcards/types.ts` — FlashcardsModel, CardSpec.
- `lib/generation/games/flashcards/prompts.ts` — LLM shablon (term-definition, savol-javob).
- `lib/generation/games/flashcards/review.ts` — qoidalar + judge.
- `lib/generation/games/flashcards/layout.ts` — `drawCards` DOCX jadval (2×4, A7 o'lcham, kesish).
- Interaktiv — `lib/game/Flashcards.tsx` + `lib/game/engine.ts` Leitner havfsizlik.

Fayl: 180 qator ichida (bu hisobot — 165 qator).
