# R8 — Saralash o'yini (`sorting`, interaktiv + bosma)

AUDIT-20 §1 R8 shabloni bo'yicha. Har faktga URL berilgan; manbasiz joyda
"aniqlanmadi" deb ochiq qoldirilgan.

## 1. Konvensiya/standart va UX naqshlari

| Naqsh | Tavsif | Manba |
|---|---|---|
| **Group sort** (Wordwall) | Har element to'g'ri guruhga tortiladi (drag-drop); **baholanadigan** faoliyat — tizim qaysi element qaysi guruhga tegishli ekanini biladi, lekin **leaderboard/ball hosil qilmaydi** | [wordwall.net/about/template/group-sort](https://wordwall.net/about/template/group-sort) |
| **Categorize** (Wordwall) | Ochiq turdagi, 2 ta boshlang'ich toifa bilan boshlanadi, kerak bo'lsa "Add a category" bilan ko'paytiriladi | [wordwall.zendesk.com/…Categorize-activity](https://wordwall.zendesk.com/hc/en-gb/articles/360015882118-How-to-create-a-Categorize-activity) |
| Ulashish | "Make Public" → yagona havola; **Embed**: Iframe / Thumbnail / Small icon uch shaklda; **QR kod** natija/ulashish panelida mavjud | [Embed yo'riqnoma](https://wordwall.zendesk.com/hc/en-gb/articles/360015617757--How-to-embed-a-Wordwall-resource-on-another-website) |
| O'yinchi oqimi (Kahoot/Quizizz/Blooket) | PIN/kod yoki QR → **ism/taxallus** kiritiladi (hisob shart emas, "guest mode") → o'ynaydi → natija | [Kahoot join](https://support.kahoot.com/hc/en-us/articles/360039890713-Kahoot-join-How-to-join-a-Kahoot-game), [Blooket join](https://www.makerstations.io/blooket-join/) |
| O'qituvchi hisobot | Har sessiyadan keyin avtomatik hisobot: ishtirokchilar, aniqlik, vaqt; **xlsx/CSV eksport** | [Quizizz Reports](https://support.quizizz.com/hc/en-us/articles/115000886691-Reports-on-Quizizz) |

## 2. Raqobatchilar parametrlari (sodda.ai `sortball-game`, `docs/research/slaydtop-b-oyinlar-1.md`)

| Parametr | sodda.ai | Biz olamizmi | Sabab |
|---|---|---|---|
| Mavzu | erkin matn, majburiy | ha | asosiy kirish |
| Til | 18 til, standart o'zbekcha | ha (mavjud til-selektor naqshi) | glossary/keys bilan bir xil komponent |
| **"To'p soni"** 2/4/6/8/10/12/15/20 | 1 ta miqdor chipsi — **kategoriya va element sonini ajratmaydi** | **yo'q, bizda ikkiga bo'linadi** | Wordwall Group Sort'da toifa va element soni MUSTAQIL sozlanadi; bitta "to'p soni" bilan LLM o'zi qaror qiladi nechta toifa — nazoratsiz, `impacts` shaffof emas |
| Narx | 2000 tekis, parametrga bog'liq emas | ha (PM qarori — 2000) | AUDIT-20 §1 band 6 |
| Timer/urinish | ko'rinmadi (yaratilmadi) | keyin | Wordwall Group Sort untimed; bizda ham MVP untimed |
| Leaderboard | ko'rinmadi | **yo'q** — AUDIT-20 §1 band 8 "jonli reyting yo'q" | Wordwall Group Sort ham grading bor, lekin leaderboard yo'q — mos keladi |

## 3. Bizga tavsiya — reyestr

**Parametrlar** (`id`, tur, variantlar, standart, majburiy, `impacts`):

| id | tur | variantlar | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `topic` | text | — | — | ha | prompt |
| `language` | select | mavjud til ro'yxati | uz | ha | prompt, audio (agar TTS ulansa) |
| `categoryCount` | chips | 2/3/4/5/6 | 4 | ha | prompt, layout (toifa ustunlari) |
| `itemsPerCategory` | chips | 3/4/5/6/8 | 5 | ha | prompt, `delivered` |

**Ma'lumot modeli** (`AcademicDoc.game.sorting`, AUDIT-20 §4 rejasi bilan mos):

```json
{
  "kind": "sorting",
  "sorting": {
    "categories": [
      { "id": "c1", "name": "Sut emizuvchilar", "items": ["Mushuk", "It", "Sigir"] }
    ]
  }
}
```

**O'yinchi oqimi (ekranlar):** 1) ochiq havola sahifasi (`/o/[token]`, noindex) — mavzu/toifalar sarlavhasi ko'rinmaydi (oldindan bilib olmasin) → 2) ism kiritish → 3) o'yin ekrani (barcha elementlar pastda aralash, toifalar yuqorida, tap-to-place mobil uchun drag'dan ustun) → 4) natija ekrani (ball + to'g'ri/xato belgilar) → 5) (egasi tomonida) natijalar jadvali + CSV eksport.

**Ball/natija formulasi:** `score = to'g'ri joylashtirilgan elementlar / jami elementlar × 100`; leaderboard yo'q (band 2-jadval asoslanishi). Qayta urinish cheklanmaydi (Group Sort untimed naqshiga mos), lekin urinishlar soni natija jadvalida saqlanadi (`answers_json`).

**Bosma versiya:** jadval — toifalar ustun sifatida, elementlar pastda aralash ro'yxatda (o'quvchi qo'lda yozadi); javob kaliti alohida bet.

## 4. Sifat mezonlari

**Deterministik qoidalar:**

| id | Nima tekshiradi | Chegara |
|---|---|---|
| `categoryCount` | Toifalar soni parametrga teng | qat'iy = |
| `itemsPerCategory` | Har toifada element soni parametrga teng | qat'iy = |
| `uniqueItems` | Elementlar takrorlanmaydi (toifalar ichida ham, orasida ham) | 0 dublikat |
| `noAmbiguousItem` | Element bitta toifaga aniq tegishli (LLM promptida "ikki toifaga mos keladigan so'z ishlatma" qoidasi + judge tekshiradi) | judge `distinctness` ≥2 |
| `sameTaxonomyLevel` | Toifa nomlari bir xil abstraksiya darajasida (masalan "hayvonlar"/"o'simliklar", "hayvonlar"/"mushuklar" emas) | judge |

**Judge mezonlari (ingliz, 3–5):**

1. `categoryClarity` — is each category name specific and unambiguous for the stated topic and grade level?
2. `distinctness` — does every item belong clearly to exactly one category, with no item plausibly fitting two?
3. `topicRelevance` — do all items and categories genuinely relate to the requested topic (no filler/generic items)?
4. `itemDifficulty` — are items age-appropriate and non-trivial (not all one-word obvious answers)?

**Halollik chegarasi:** raqamli fakt/statistika (masalan "17 turi bor") o'ylab topilmasin — faqat umumiy bilim darajasidagi tasniflash (masalan hayvon turlari, davrlar, kategoriyalar) ishlatiladi, aniq raqamli da'volardan saqlanadi.

## 5. Namunalar

- Haqiqiy Group Sort namunasi: [Sort the items into Categories](https://wordwall.net/resource/94239276/sort-the-items-into-categories)
- Haqiqiy Group Sort namunasi 2: [CATEGORIES](https://wordwall.net/resource/105217969/categories-categorie)

**LLM uchun yaxshi/yomon misol (mavzu: "Hayvonlar dunyosi", 3 toifa × 4 element):**

- ✅ Yaxshi: toifalar — «Sut emizuvchilar» (mushuk, it, sigir, fil), «Qushlar» (chumchuq, burgut, tovus, g'oz), «Baliqlar» (losos, akula, karp, tunets) — har element bitta toifaga aniq tegishli, bir xil taksonomik daraja.
- ❌ Yomon: toifalar — «Hayvonlar», «Uy hayvonlari», «Yovvoyi hayvonlar» — «mushuk» ham «Hayvonlar»ga, ham «Uy hayvonlari»ga tegishli (`noAmbiguousItem` buzilishi), toifalar bir xil darajada emas.

## 6. Ochiq savollar / egasidan kerak narsalar

1. `categoryCount` 2–6 va `itemsPerCategory` 3–8 diapazoni PM tomonidan tasdiqlanadimi, yoki raqobatchining bitta "to'p soni" (2–20) chipsi soddaroq UX sifatida afzalmi?
2. Timer/urinish cheklovi keyingi bosqichda qo'shiladimi (Wordwall'da yo'q, lekin Kahoot uslubidagi tezlik-bonusi jozibali bo'lishi mumkin)?
3. Bosma versiyada javob kaliti bir betdami yoki hujjat oxiridami (boshqa vositalar konvensiyasi — test kaliti alohida betdan, AUDIT-20 §2 test dvigateli bilan mos qilinsinmi)?
