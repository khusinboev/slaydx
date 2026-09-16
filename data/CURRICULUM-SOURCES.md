# `data/curriculum/` — manbalar, sxema va yig'ish tartibi

Fan × sinf × mavzu bazasi. Test yaratuvchining **darslik rejimi**
(`mode: "curriculum"`), shuningdek dars rejasi va texnologik xaritaning
ixtiyoriy mavzu tanlovi shu fayllardan oziqlanadi (`lib/curriculum.ts`).

Fayllar **qo'lda yozilmaydi**: `scripts/fetch-curriculum.mts` rasmiy PDF
larni yuklab oladi, `scripts/gen-curriculum.mts` esa xom matnni
normallashtiradi va JSON yozadi (AUDIT-20 WP-B). Ikkalasi ham
`professions.json` naqshi bo'yicha: **ro'yxatni LLM tuzmaydi**, u faqat
PDF dan chiqarilgan qatorlarni tozalaydi.

## Nega baza, LLM emas

«11-sinf matematikasining mavzularini sana» degan so'rov har safar
boshqacha ro'yxat beradi va qaysi bob kirgani modelning kayfiyatiga
bog'liq bo'ladi. O'qituvchi esa DASTURDAGI mavzu bo'yicha test so'raydi
— ro'yxat rasmiy hujjatdan kelishi shart, aks holda «darslik rejimi»
va'dasi yolg'on bo'ladi (halollik chegarasi, AUDIT-20 §7).

## Manba

**Respublika ta'lim markazi (Xalq ta'limi vazirligi)** — umumiy o'rta
ta'limning fan o'quv dasturlari, `uzbmb.uz` saytining qabul to'plamida
PDF ko'rinishida e'lon qilingan:

- To'plam: <https://uzbmb.uz/upload/file/pdf/qabul2025/dasturlar/>
- Namuna (hozir bazada): `5.Matematika/11-sinf-Matematika fanidan o'quv dastur.pdf`
  (308 KB, 21 bet, 2018-yil nashri).

**Litsenziya:** rasmiy davlat hujjati, ochiq e'lon qilingan. Hujjatda
qayta nashr taqiqi yo'q; biz **mavzu SARLAVHALARINI** (faktik ma'lumot)
va bob soatlarini olamiz, matnni qayta nashr qilmaymiz. Har yozuvda
manba sarlavhasi va to'g'ridan-to'g'ri PDF havolasi saqlanadi
(`entries[].source`), ya'ni foydalanuvchi hamisha asliga qaytishi mumkin.

**Ehtiyot (WP-B uchun):** `uzbmb.uz` TLS sertifikati eskirgan — R4
tadqiqotida fayl `curl -k` bilan olingan. `scripts/fetch-curriculum.mts`
sertifikat tekshiruvini o'chirgan `https.Agent` bilan ishlaydi; bu
FAQAT yig'ish skriptida, ishlab turgan xizmatda emas, va kodda aniq
izohlanishi kerak (xavfsizlik ko'rigi bandi).

## Sxema

`index.json` — KLIENTGA ketadigan yengil ro'yxat (~5 KB): qaysi fanning
qaysi sinfi bazada bor.

```jsonc
{
  "version": "2026-09-16",              // baza versiyasi (yangi DTS 2026-08 — X-1)
  "sources": [{ "title", "url", "publisher", "year" }],
  "subjects": [{ "id", "uz", "ru", "en", "grades": [11] }]
}
```

`<fan>.json` — bitta fanning barcha sinflari. Mavzular klient bandliga
KIRMAYDI: ular `GET /api/curriculum?subject=&grade=` orqali olinadi.

```jsonc
{
  "version": "2026-09-16",
  "subject": { "id", "uz", "ru", "en" },
  "entries": [
    {
      "grade": 11,
      "source": { "title", "url", "year", "publisher" },
      "units": [                         // BOB
        {
          "title": "HOSILA VA UNING TATBIQLARI",
          "hours": 40,                   // soat BOB darajasida (mavzuda yo'q — pastga qarang)
          "topics": [{ "id", "title", "hours?", "quarter?", "page?" }]
        }
      ]
    }
  ]
}
```

R4 hisobotidan (`docs/research/curriculum.md` §3) olingan qarorlar:

- **`topics[].id`** = `slug(unit.title)` + BOBDAGI tartib raqami
  (`hosila-va-uning-tatbiqlari-3`). Fan+sinf ichida unikal bo'lishi
  kifoya, global emas (`tests/curriculum.test.mts` shuni tekshiradi).
- **Mavzu darajasida soat YO'Q.** uzbmb dasturi soatni faqat BOB
  darajasida beradi («soatlar taqsimoti faqat boblar bo'yicha berildi,
  mavzu/dars taqsimoti — namunaviy taqvim rejada»). `topics[].hours`
  maydoni sxemada bor, lekin hozir doim bo'sh.
- **`quarter` ham bo'sh.** Chorak taqsimoti alohida hujjat
  (taqvim-mavzu reja) — R4 doirasida topilmadi (ochiq savol).
- **`page`** (darslik sahifasi) — sxemada bor, doim bo'sh: dastur
  darslik sahifasini ko'rsatmaydi, darslik mundarijasi bilan bog'lash
  alohida ish.
- **Tillar:** `subject.{uz,ru,en}` — `professions.json` naqshi (uch tilli
  qidiruv). PDF larning o'zi faqat o'zbekcha; `en` LLM tarjimasi va u
  FAQAT fan nomiga tegishli — mavzular tarjima qilinmaydi (hajmni 3×
  oshiradi, MVP uchun shart emas).
- **Har sinf alohida yozuv.** «6–7-sinf» qo'shma fayllari yig'ish
  bosqichida sinflarga ajratiladi.


## Hozirgi qamrov (AUDIT-20 WP-B, 2026-09-16)

**8 fan · 42 fan×sinf yozuvi · 311 bob · 2 424 mavzu** (≈480 KB) —
hammasi yuqoridagi uzbmb.uz to'plamidan avtomatik yig'ilgan, qo'lda
kiritilgan qator YO'Q.

| Fan (`id`) | Sinflar | Yozuv | Bob | Mavzu |
|---|---|---|---|---|
| `matematika` | 5, 6, 7, 8, 10, 11 | 6 | 80 | 425 |
| `fizika` | 6, 7, 8, 9, 10, 11 | 6 | 43 | 318 |
| `kimyo` | 7, 8, 9, 10, 11 | 5 | 29 | 210 |
| `biologiya` | 5, 6, 7, 8, 9, 10, 11 | 7 | 49 | 333 |
| `geografiya` | 5, 6, 7, 8, 9, 10 | 6 | 40 | 419 |
| `tarix` | 5, 6 | 2 | 15 | 128 |
| `jahon-tarixi` | 7, 8, 9, 10, 11 | 5 | 26 | 289 |
| `ozbekiston-tarixi` | 7, 8, 9, 10, 11 | 5 | 29 | 302 |

Har yozuvning `source.url` i — AYNAN o'sha sinfning PDF havolasi
(`entries[].source`), ya'ni o'qituvchi hamisha asliga qaytishi mumkin.

**Qamrovdagi bo'shliqlar (manbada shunday, biz to'ldirmaymiz):**

- **Matematika 9-sinf fayli sahifada YO'Q** (R4 X-2 da ham qayd
  etilgan). Qidirib topilmadi — bazada 9-sinf matematikasi yo'q, forma
  uni ko'rsatmaydi (`hasCurriculum`).
- **Geografiya 11-sinf fayli sahifada yo'q** (5–10 bor).
- **Matematika 6–7-sinf BITTA hujjatda**: shuning uchun 6 va 7-sinf
  yozuvlari AYNI mundarijaga ega va ikkalasi ham shu bitta faylga
  ishora qiladi. Bu manbaning tuzilishi, bizning taxminimiz emas.
- **Tarix UCHGA bo'lingan** (`tarix` 5–6, `jahon-tarixi` 7–11,
  `ozbekiston-tarixi` 7–11) — manba shunday: 7-sinfdan boshlab ikki
  alohida dastur, har birining o'z bobi, soati va havolasi.
- **1–4-sinf, informatika, ona tili/adabiyot, chet tillari** — bu
  sprintda yig'ilmadi (R4 X-3). Sahifalar bor, format boshqacha.
- `10-sinf` tarix va biologiya hujjatlari **(MO'D)** — Milliy o'quv
  dasturi belgisi bilan; u `source.title` ga qavs ichida yoziladi.

## Yillik soat: 121-son buyruq OCHILMADI

R4 rejasida bob soatlari **tayanch o'quv reja** (MMTV 2025-yil
10-apreldagi 121-son buyrug'i, 1-ILOVA) jadvaliga solishtirilishi
ko'zda tutilgandi. 2026-09-16 da o'sha PDF havolasi
(`uzedu.itsm.uz/uploads/downloads/D3DbQ0d7svuszu0A7IQ7l6xK_G3yOwBl.pdf`)
**HTTP 502** qaytardi, boshqa barqaror ko'zgu topilmadi.

Taxmin yozilmadi. Buning o'rniga yillik soat **shu dasturning o'zidan**
olinadi — u ham ayni rasmiy hujjat: sarlavha qatorida «(68 soat)»,
«(34-soat, haftasiga 1 soatdan)», «(A2: 51 soat, A2+: 68 soat)»
ko'rinishida turadi va `entries[].hours` ga yoziladi (42 yozuvdan 25
tasida bor, qolganida hujjatda umuman e'lon qilinmagan).

**Nega bob soatlari yig'indisi yillik soatdan katta bo'lishi mumkin:**
ba'zi hujjat IKKI moduldan iborat — «Fizika va astronomiya» (11-sinf:
68 + 34 soat), matematika 8/10/11 (algebra + geometriya), matematika
6–7 (ikki o'quv yili). Yillik soat esa faqat BIRINCHI modulniki.
Shuning uchun `tests/curriculum-data.test.mts` qat'iy tenglikni emas,
oqilona ustki chegarani tekshiradi (har bob ≤ yillik soat, yig'indi
≤ 2,5 × yillik soat).

## Yig'ish quvuri

```
scripts/heavy.sh npx tsx scripts/fetch-curriculum.mts   # sahifa → PDF → matn kesh
scripts/heavy.sh npx tsx scripts/gen-curriculum.mts     # kesh → data/curriculum/*.json
```

1. **`fetch-curriculum.mts`** — `/page/<fan>_dastur` sahifasidan
   `dasturlar/…pdf` havolalarini O'QIYDI (qo'lda yozilmaydi: fayl
   nomlari barqaror emas), PDF ni yuklab `lib/extract-text.ts
   extractFromBuffer` bilan matnga o'giradi va
   `node_modules/.cache/curriculum/<fan>-<sinf>.json` ga keshlaydi.
   Bayroqlar: `--subject`, `--grade`, `--force`, `--dry`.
2. **`gen-curriculum.mts`** — keshdan o'qib mundarijani ajratadi va
   JSON yozadi. Bayroqlar: `--only`, `--stats`, `--dry`, `--llm`.

**Ikki hujjat formati** (R4 da bittasi ko'rilgan edi):

- **A** — «`12-mavzu: Sarlavha. (2 soat, A2+: 3 soat)`»: mavzular aniq
  belgilangan (geografiya 6–7, tarix 6–7, biologiya 6–7, fizika 6–7,
  kimyo 7, matematika 6–7);
- **B** — «`I BOB. SARLAVHA` / `(19 soat)` / `<mavzu nomi>. <tavsif>.`»:
  mavzu nomi PDF da QALIN shriftda edi, matn olinganda qalinlik
  yo'qoladi. Chegara QATOR UZILISHI bilan topiladi (oldingi qator nuqta
  bilan tugab, yangisi bosh harf bilan boshlansa — yangi mavzu), nomi
  esa bo'lakning BIRINCHI GAPI.

**Bazaga KIRMAYDIGAN qismlar** (X-5 mualliflik chegarasi + pedagogik
qaror): «Tushuntirish xati», kompetensiya ro'yxatlari, «o'quvchilar …
biladi/tushunadi» talablari, jihozlar ro'yxati, nazorat ishi va
«xatolar ustida ishlash» qatorlari. Bazada faqat BOB sarlavhasi, soat
va MAVZU NOMLARI — ya'ni faktik ma'lumot.

**LLM (`--llm`) ixtiyoriy va faqat TOZALAYDI**: bo'linib ketgan mavzuni
birlashtiradi, mavzu bo'lmagan qatorni olib tashlaydi. Javobdagi har
element kirishdagi INDEKSGA ishora qiladi, ya'ni «ro'yxatni LLM
tuzmaydi» qoidasi kod bilan majburlanadi; kalit bo'lmasa baza
o'zgarishsiz to'liq yig'iladi. Joriy `data/curriculum/` **LLM siz**
(faqat heuristika bilan) yig'ilgan.

## Tekshirish

`tests/curriculum.test.mts` (R0) — indeks/fayl mosligi, id unikalligi,
`hasCurriculum`, route shakli.

`tests/curriculum-data.test.mts` (WP-B) — BAZANING O'ZI:

1. kamida 6 fan va 30 fan×sinf yozuvi (X-2: rejim faqat bazada bor
   fan/sinfda ko'rinadi);
2. `topics[].id` fan+sinf ichida unikal va `slug` shaklida;
3. bo'sh bob yo'q, sarlavha 3–200 belgi, yopishib qolgan so'z yo'q;
4. bob soatlari: har bob ≤ yillik soat, yig'indi ≤ 2,5 × yillik
   (yuqoridagi ikki modulli hujjatlar sababi);
5. har fanda ≥1 sinf, har yozuvda `source.url` — `uzbmb.uz` havolasi;
6. mavzu nomlarida uslubiy nasr/kompetensiya/nazorat ishi qatorlari
   YO'Q (parser filtri qulflanadi);
7. `hasCurriculum`/`curriculumTopics`/`pickTopics` haqiqiy ma'lumot
   ustida ishlaydi;
8. `index.json` va fayllar bir xil versiyada.
