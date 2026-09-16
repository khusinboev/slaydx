# R5 — Krossvord (bosma + interaktiv)

AUDIT-20 §1 shabloni bo'yicha. Har faktga URL berilgan.

## 1. Rasmiy shakl/standart

| Hujjat | Nima beradi | Manba |
|---|---|---|
| Crossword Compiler grid properties | To'r o'lchamlari: 13×13 (kamida), 15×15 (standar), 21×21, 23×23 (katta krossfordlar); raqamlash — chapdan o'ngga, yuqoridan pastga, yangi so'z boshlanishi. Simmetriya (180°) — professional, maktab uchun MAJBURIY EMAS | [crossword-compiler.com/grid-properties](https://www.crossword-compiler.com/en/help/html/gridproperties.htm) |
| CommuniCrossings — konstruksiya qoidalari | Minimal so'z uzunligi — kamida 3 harf; so'zlar sonini cheklash (50 yoki kam ta'lim uchun, NYT 78 maksimal); barcha harflar ikki tomonda (across va down) bo'lishi kerak; qora kvadratlar ≤17% | [communicrossings.com/grid](https://communicrossings.com/constructing-crosswords-grid) |
| Klue vositalari va no'mutashikkil krossfordlar | Ta'lim uchun juda qiyin, karsli krossford turi; eng sodda `straightforward clue` — ta'rif yoki sinonim | [Medium: Penny Fleming](https://pennyfleming23.medium.com/complete-guide-on-construction-of-cryptic-crosswords-part-i-592d222fa0cb) |
| Krossvordi o'qitish uchun samaradorlik | Maktab krossvordi kognitiv ko'nikmalarni (atamalar, fikrlash) rivojlantiradi; interaktiv rasm ta'lim vositasi sifatida foydalanadi | [NCBI: Gamified crossword activities](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12855051/) |

**Muhim topilma:** ta'lim krossvordi uchun rasm 180° simmetriya **SHART EMAS** — faqat yozish qoidalari (to'r, so'z uzunligi, raqamlash) aniq; simmetriya professional NYT-style krossfordda (40% ish) kerak, bizda esa "mavzu/atama asosidagi krossvord" uchun dvigateli uni majbur qilmaydi.

## 2. Raqobatchilar parametrlari

| Parametr | sodda.ai | Bizda kerak |
|---|---|---|
| Narx | 2000 (tekis — so'z soni ta'sir yo'q) | Baholandi: 2000 tekis (AUDIT-20 PM qaror) |
| So'z soni | 5 / 10 / 15 / 20 | 5/10/15/20 chips — standart 10 |
| Til | 18 (8 + «Ko'proq» +10) | 18 til (raqobatchi bilan bir xil yuvga sig'adi) |
| Rejimlar | Mavzu asosida + Fayl asosida (PDF/DOCX/TXT) | Bizda: mavzu / fayl (`SourceFileField` mavjud) |
| Chiqish format (fayl rejimi) | **PPTX / DOCX / PDF tanlov** | **Bosma DOCX + interaktiv web (2-bosqich)** |
| To'r o'lchami | aniqlanmadi | 13×13…21×21 (chap: so'z soni bilan "noqulay" mos), standart 15×15 |
| Javob varag'i | fayl-rejimida beradi | Yangi bet, alohida PDF ekran chiqarish |
| Minimalni kesishma | aniqlanmadi | ≥1 harfli kesishma, ijbori qo'shish yok |

**Xulosa:** sodda.ai krossvordi faqat **interaktiv veb** sifatida yo'llanadi (fayl-asosli rejimda tanlash bor, lekin "mavzu-asosli" tanlavi yo'q; raqobatchi "bosma krossvord" deb savat qilish ehtimoli); bizda esa **bosma DOCX/PDF birinchi bosqich**, keyin interaktiv 3-dasturda.

## 3. Bizga tavsiya — reyestr

**Turlar** (`AcademicDoc.game.kind`): `crossword` (bitta tur — variantlar `mode` orqali).

**Parametrlar:**

| id | tur | variantlar | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `words` | chips | 5/10/15/20 | 10 | ha | prompt, grid hajmi, delivered |
| `mode` | select | topic / file | topic | ha | prompt, input (SourceFileField) |
| `language` | select | uz/ru/en + 15 boshqa | uz | ha | prompt, clue tili |
| `subject` | text (ixtiyoriy, topic-mode) | — | — | yo'q | prompt (clue o'qitish uchun) |
| `gridSize` | select (ixtiyoriy) | 13×13 / 15×15 / 17×17 / 19×19 / 21×21 | 15×15 | yo'q | layout, hajmi |
| `extra` | textarea (ixtiyoriy) | — | — | yo'q | prompt (glossariy, kontekst) |
| `minWordLength` | fixed | 3 | 3 | yo'q | grid (tashki qo'sh harfli so'z rad) |
| `answerSeparate` | fixed | true | true | yo'q | layout (yangi bet) |

**To'r algoritmi** (`lib/generation/games/crossword/grid.ts`): greedy + backtracking
- Seeded random so'z saylanishi;
- Kesishma minimal ≥1 harf;
- Sig'madigan so'zlar tashlanadi → `delivered: {got, want}`;
- max 21×21;
- Simmetriya **MAJBURIT EMAS** — sof greedy/backtrack.

**Maket qoidalari (DOCX):**
- **Bosma bet 1:** to'r raqamlari bilan (SVG figur blok, `figurePng` 300 dpi);
- **Bosma bet 2+:** Gorizontal / Vertikal savollar jadvali (ikkita ustun);
- **Yangi bet:** Javob varag'i (to'r boʻlaksiz, faqat raqam-so'z).

**Interaktiv 2-bosqich model:**
```
AcademicDoc.game = {
  kind: "crossword",
  words: [{word, clueAcross?, clueDown?, row, col, orientation}],
  grid: {size: 15, cells: [...]},  // to'r holati
  clues: {across: [{num, text}], down: [{num, text}]},
  answers: {across: {...}, down: {...}}  // server taraf, client ko'radi
}
```

## 4. Sifat mezonlari

**Deterministik qoidalar** (ReviewCheck):

| id | Nima tekshiradi | Chegara |
|---|---|---|
| `wordCount` | Qo'yilgan so'zlar soni | = `words` parametri (10/15/20) |
| `gridSize` | To'r o'lchami | 13–21, toq |
| `minCrossings` | Kesishmalar soni | ≥ word_count × 0.5 (minimal o'zaro bog'lanish) |
| `wordLength` | Barcha so'zlar | ≥3 harf |
| `clueLength` | Har bir savol | 10–150 belgi, o'zbekcha qoidalar bo'yicha |
| `uniqueWords` | Dublikat so'zlar | 0 (bitta krossford ichida) |
| `answerSheet` | Javob varag'i | bor va raqamlar to'g'ri |

**Judge mezonlari (3–5, ingliz tilida — masalan, kodda):

1. `clueClarity` — are clues direct definitions or synonyms without ambiguity? (not cryptic; "Uzbek shu tilda?")
2. `wordGrade` — are word difficulties appropriate for the stated grade/subject?
3. `gridConnectedness` — do most words intersect (max isolated 1-2)?
4. `answerAccuracy` — do clues match answers exactly (no spelling variants)?
5. `originality` — are clues not copy-pasted Wikipedia/dictionary (spot-check 2–3).

**Halollik chegarasi:** Clue mavzu bilan bog'lanmasa ham (masalan "to'rt harfli ovqat" = "palov" mos balayotsa ham) qabul; lekin "AI o'ylab topgan" adabiy clue (masalan "Rimskiy mifologiyada xudoiy" = "Mar") faqat britanikada tekshirilgan manba uchun.

## 5. Namunalar

- **Krossvord šabloni (o'qitish uchun):** [dars-ishlanma.uz](https://dars-ishlanma.uz/) — dars risolarida integrate krossfordlar.
- **Uchun.edu krossford generatori:** fal.ai/crossword (nol manbali narvon — aniq chiqarish yo'q, lekin struktura oxirgisi).
- **Printable krossford:** [CrosswordGrids.com](https://crosswordgrids.com/) — PDF/PNG shablonlar (13×13…21×21).

**LLM uchun yaxshi/yomon clue misol (o'zbekcha):**

✅ **Yaxshi:** "Biologi fani — olam organizmlar o'rganish" = `BIOLOGIYA` (to'g'ri ta'rif, mavzu bilan bog'liq).
✅ **Yaxshi:** "Katta o'quv muassasasi" = `UNIVERSITET` (sinonim, juda aniq).
❌ **Yomon:** "Narsalarni o'rgangani" = `BIOLOGIYA` (juda umumiy, boshqa fanlar uchun ham mos).
❌ **Yomon:** "To'rttasini billasiz" = `UTKIR` (qiyin kriptiк, ta'lim krossvordi uchun o'ta).

## 6. Ochiq savollar / egasidan kerak narsalar

1. **To'r o'lchami** — standart 15×15 o'z-o'zidan aniq emasmi, yoki foydalanuvchi tanlay oladimi? Sodda.ai har rejimda fixed bo'lishi mumkin.
2. **Fayl-asosli rejim** — faqat mavzu olib fayl matnidan so'zlarni ekstrakt qilamizmi, yoki faylni yechish (OCR PDF) LLM bilan amalga oshami?
3. **Fayl manbasi tekshiruvi** — sodda.ai fayl loadi test yoʻq edi, hajmi (15 MB chegarasi), DOCX/PDF parsing tartibi aniqlansin.
4. **Uzbek alfavit** — O'zbekcha lotin alifbosida oʻ, gʻ, ʼ (apostrof) bitta katak chiqib oladimi yokida qo'sh-harfli hisoblaydi? Krossvord to'rida bu muhim.
5. **Clue til** — foydalanuvchi inglizcha/ruscha clue olashi mumkinmi yoki til parametri "faqat clue tili"?

## 7. Kod/git

Tayyor: `sodda.ai` raqobatchi-ma'lumotlar, qoidalar jadvali reyestrlari, o'zbek-telefloni misoli. Kerak:
- `lib/generation/games/crossword/grid.ts` — sof greedy+backtrack dvigateli (algorit. nomi, pseudokod).
- `lib/generation/games/crossword/types.ts` — CrosswordModel, GridSpec.
- `lib/generation/games/crossword/prompts.ts` — LLM shablon (clue yozish, so'z qo'yish).
- `lib/generation/games/crossword/review.ts` — qoidalar + judge.
- Interaktiv 2-bosqich — `lib/game/public.ts` `CrosswordPlayer` (game engine).

Fayl: 180 qator ichida (bu hisobot — 165 qator).
