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

## Hozirgi holat (AUDIT-20 R0)

Bazada **bitta yozuv**: matematika, 11-sinf, 2 bob / 10 mavzu — R4
mini-sinovi chiqargan, HAQIQIY hujjatdan olingan qatorlar
(`docs/research/curriculum.md` §3 dagi JSON namunasi, qo'lda
o'zgartirilmagan). Mavzu id laridagi tartib raqamlari uzluksiz emas
(`…-1`, `…-2`, `…-5`, `…-10`, `…-14`) — bu ataylab: raqam BOBDAGI xom
qator o'rnini bildiradi, oraliq qatorlar hali normallashtirilmagan.

To'liq yig'ish (≈10 fan × 7 sinf ≈ 5 000–6 500 mavzu, 1–1,5 MB) —
**WP-B**. Shu vaqtgacha `hasCurriculum()` faqat matematika 11-sinf
uchun `true` qaytaradi va test yaratuvchining darslik rejimi boshqa
fan/sinfda ko'rinmaydi (X-2: «`curriculum` rejimi faqat bazada mavjud
fan/sinfda»).

## Tekshirish

`tests/curriculum.test.mts`:

1. `index.json` yuklanadi, fan id lari unikal, `grades` bo'sh emas;
2. har fayl indeks bilan MOS (indeksdagi har sinf faylda bor va aksincha);
3. `topics[].id` fan+sinf ichida unikal;
4. bo'sh `topics` bo'lgan bob yo'q, bo'sh sarlavha yo'q (3–200 belgi);
5. `hasCurriculum` faqat mavjud juftlikda `true`;
6. route shakli: `requireUser` (401), chegara 60/daq, mavjud bo'lmagan
   fan/sinf → 404, `?subject=`siz → 400.

Soat yig'indisini rasmiy yillik soat bilan solishtirish (R4 §4.5b,
± 10 %) — WP-B da, to'liq baza kelgandan keyin: bitta bob namunasida
yillik soatni tekshirib bo'lmaydi.
