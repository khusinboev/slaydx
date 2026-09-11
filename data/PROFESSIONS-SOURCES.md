# `professions.json` — manbalar, litsenziya va yasash tartibi

Rezyume formasidagi **kasb tavsiyasi** va **ko'nikma tavsiyasi** shu
fayldan oziqlanadi (`lib/professions.ts`). Fayl qo'lda yozilmaydi —
`scripts/gen-professions.mts` bilan yasaladi va kommit qilinadi.

## Nega tashqi manba

Ro'yxatni LLM dan «o'ylab topishini» so'rash bir necha yuz yozuvdan
keyin takrorlana boshlaydi va qamrov tasodifiy bo'lib qoladi: qaysi
kasb kirgani modelning kayfiyatiga bog'liq. Shuning uchun **kasb
nomlari ikkita rasmiy, ochiq taksonomiyadan** olinadi, LLM esa faqat
**tarjima** qiladi va **o'zbekcha ko'nikma** yozadi — ya'ni u nimani
yaxshi bilsa shuni qiladi, ro'yxat tuzishni emas.

## Manbalar

### 1. ESCO — European Skills, Competences, Qualifications and Occupations

- Egasi: **Yevropa Komissiyasi** (DG EMPL).
- Hajmi: 3 008 kasb, 13 890 ko'nikma, 27 tilda (o'zbek va rus tili
  YO'Q — shuning uchun undan faqat **inglizcha nom** va **ISCO-08
  guruhi** olinadi).
- API: `https://ec.europa.eu/esco/api/` — kalitsiz, ochiq.
  Hujjat: <https://esco.ec.europa.eu/en/use-esco/use-esco-services-api>,
  yuklab olish: <https://esco.ec.europa.eu/en/use-esco/download>.
- **Litsenziya: CC-BY 4.0**
  (<https://creativecommons.org/licenses/by/4.0/>).

  > **Atributsiya:** This dataset contains occupation titles derived
  > from the ESCO classification of the European Commission
  > (<https://esco.ec.europa.eu>), used under CC-BY 4.0. The titles have
  > been translated into Uzbek and Russian, filtered for the Uzbek
  > labour market and extended with locally relevant skills; ESCO's own
  > skill concepts are **not** redistributed here.

- Qanday olinadi: `scripts/fetch-professions.mts` ISCO-08 daraxti
  bo'ylab yuradi — 10 ta katta guruh → 43 → 130 → 436 ta «unit group»,
  har unit group ning `narrowerOccupation` ro'yxati. Qidiruv
  (`/search?text=`) ishlatilmaydi: u fuzzy va takrorlanuvchi, daraxt
  esa to'liq va takrorsiz.
- **Ikkinchi qatlam** (`--deepen <sektorlar>`): unit group ostidagi
  asosiy kasblar ~1 700 ta; qolgan ~1 300 tasi ularning ixtisosliklari
  («lawyer» → «corporate lawyer»). Huquq, HR, sport, turizm kabi yupqa
  sektorlarda faqat shu qatlam ham olinadi — har asosiy kasb uchun bitta
  so'rov. Keshda `deepened` ro'yxati bor, qayta so'ralmaydi.
- Olinmagan shoxlar (`missed`) keshda qoladi va keyingi yugurishda
  faqat ular qayta so'raladi — ESCO ning ba'zi IP lari vaqti-vaqti
  bilan javob bermaydi (jonli kuzatilgan, 5 urinishda ham).
- **Sektor taxmin qilinmaydi** — ISCO kod prefiksidan keladi
  (`ISCO_SECTOR` jadvali). Masalan `2142` → `qurilish`, `25*` → `it`.
- O'zbekistonda umuman uchramaydigan shoxlar OLINMAYDI: `62`
  (o'rmonchilik, ov, baliqchilik), `63` (o'zini boqish uchun
  dehqonchilik), `95` (ko'chada savdo).

### 2. hh.ru `professional_roles`

- Egasi: **HeadHunter** (hh.ru). O'zbekistondagi **hh.uz** ham aynan
  shu taksonomiyani ishlatadi — shuning uchun bu ro'yxat mahalliy
  mehnat bozoriga eng yaqini.
- Hajmi: 27 kategoriya, 304 rol, **ruscha**.
- API: `https://api.hh.ru/professional_roles` — kalitsiz.
- Shartlar: hh.ru ochiq API si ro'yxatdan o'tishsiz o'qishga ruxsat
  beradi, lekin **`User-Agent` sarlavhasini talab qiladi** va so'rov
  chastotasini cheklaydi (<https://api.hh.ru/openapi/redoc>,
  <https://dev.hh.ru/>). Skript bitta so'rov yuboradi va o'zini
  `SlaydX/1.0` deb tanitadi. Ma'lumot **taksonomiya nomlari** sifatida
  ishlatiladi (faktik ma'lumot, ijodiy asar emas) va o'zbekchaga
  tarjima qilinib qayta ishlangan; hh.ru ning bo'sh ish o'rinlari yoki
  rezyumelari KO'CHIRILMAYDI.
- Sektor: hh kategoriyasidan (`HH_CATEGORY`), ba'zi rollar esa nom
  bo'yicha aniqlashtiriladi (`HH_ROLE_SECTOR`) — hh da bitta rol bir
  necha kategoriyada uchraydi.

### 3. Zaxira (hozircha ishlatilmagan)

**O\*NET** (AQSh Mehnat vazirligi, public domain, inglizcha, 1 000+
kasb va 57 000 muqobil nom) — <https://www.onetcenter.org/database.html>.
ESCO + hh.ru qamrovi yetarli bo'lgani uchun chaqirilmadi; ro'yxatni
yana kengaytirish kerak bo'lsa keyingi manba shu.

## Tarjima va ko'nikmalar

Nomlarni o'zbekchaga/ruschaga o'girish va **o'zbekcha ko'nikma**
yozish `lib/generation/llm.ts` (Gemini) orqali, 14 tadan partiyalarda.
LLM shu bilan birga nomzodni `ok: false` bilan rad etishi mumkin —
O'zbekistonda uchramaydigan kasb yoki hech kim rezyumega yozmaydigan
tor Yevropa ixtisosligi bo'lsa.

Skript **idempotent**: mavjud `data/professions.json` USTUN va hech
qachon qayta yozilmaydi, faqat yetishmayotgani qo'shiladi.

## Yasash

```bash
npx tsx --conditions=react-server --env-file-if-exists=.env.local \
  scripts/gen-professions.mts --limit 48
```

Bayroqlar: `--only <sektorlar>`, `--limit N` (sektordagi JAMI yozuv
chegarasi), `--batch N`, `--concurrency N`, `--deepen <sektorlar>`,
`--refresh-sources`, `--dry`.

Og'ir buyruq — `scripts/heavy.sh -m 2G -t 1800 …` orqali, sektorlarni
6 tadan partiyalab (`--only`), har partiyadan keyin kommit.

Tashqi manbalar keshi `node_modules/.cache/slaydx-professions-sources.json`
ga tushadi (repoga kirmaydi) — ESCO daraxtini yurish ~620 ta so'rov,
har safar takrorlash shart emas.

## Joriy holat (2026-09-11, AUDIT-16)

**1 093 ta kasb**, 24 sektor, o'rtacha 7 ko'nikma, 3 247 alias.

| Kelib chiqishi | Soni |
|---|---|
| Asl ro'yxat (2026-03, Gemini bilan yasalgan, qo'lda ko'rilgan) | 346 |
| hh.ru `professional_roles` | 65 |
| ESCO — asosiy qatlam (ISCO unit group ostidagi kasblar) | 513 |
| ESCO — ikkinchi qatlam (`--deepen`, 12 yupqa sektor) | 95 |
| ESCO/hh (LLM inglizcha nomni o'zgartirgani uchun manbaga aniq bog'lanmadi) | 72 |
| Qo'lda qo'shilgan («Haydovchi», «O'qituvchi» — manbalarda umumiy nom yo'q edi) | 2 |

Manba keshi: 2 226 xom yozuv (ESCO 2 033, hh.ru 193 unikal rol). LLM
`ok:false` bilan **738 nomzodni rad etgan** (O'zbekistonda yo'q kasb,
tor Yevropa ixtisosligi, partiya ichidagi takror).

Sektorlar: energetika 60, davlat 58, transport 58, sanat 54, tibbiyot 54,
fan 53, media 53, talim 53, ishlab-chiqarish 51, qurilish 51, moliya 50,
it 49, marketing 49, xizmat 49, qishloq 47, savdo 44, mamuriy 43,
logistika 37, xavfsizlik 37, dizayn 32, turizm 32, sport 30, huquq 26,
hr 23.

### Qo'lda ko'rib chiqish (AUDIT-16)

Yasalgandan keyin 10 sektordan 15–22 tadan yozuv ko'zdan kechirildi va
yaqin-dublikat qidiruvi (nom = boshqa yozuv aliasi, qavssiz nom teng)
yurgizildi. Natija:

- **47 ta yozuv tashlandi** — yaqin dublikatlar (masalan «Kollej va
  texnikum o'qituvchisi» ≈ «Kasb-hunar ta'limi o'qituvchisi», «Mulkni
  baholovchi mutaxassis» ≈ «Baholovchi», uchta anderrayter, «Militsiya
  xodimi» ≈ «Ichki ishlar xodimi»), 6 ta tor bosmaxona operatori,
  O'zbekistonga xos bo'lmaganlar («Kema agenti», «O'rmon texnikasi
  operatori»), kasb emas lavozim/unvon («Serjant», «Senator», «Deputat»).
  Tashlangan yozuvning aliaslari qoluvchiga ko'chirildi. Asl ro'yxatdan
  bitta yozuv («Kategoriya xaridlari menejeri» ≈ «Kategoriya menejeri»)
  ham shu yo'l bilan birlashtirildi.
- **15 ta nom tuzatildi** — noto'g'ri tarjima yoki qo'pol shakl:
  «Avtotransport baholovchisi» → «Avariya komissari» (loss adjuster),
  «Porters (bellboy)» → «Bellboy», «Usta (er bir soatga)» → «Soatbay
  usta», «Biotibbiyot laboranti» → «Klinik laboratoriya diagnostikasi
  shifokori», «Kraspopultchi» yozuvi olib tashlandi va h.k.
- **55 ta yozuv sektori ko'chirildi** — ISCO/hh guruhi bizning sektorga
  qo'pol tushgan joylar: ijtimoiy xizmat xodimlari huquq → davlat,
  ChPU dasturchisi it → ishlab-chiqarish, gaz operatorlari logistika →
  energetika, aeroport rollari logistika → transport va h.k.
- **Eski ro'yxatdagi 3 ta nom dublikati** («Motion dizayner» media va
  dizaynda, «Komplayens» moliya va huquqda, «Avtoyuklagich haydovchisi»
  transport va logistikada) birlashtirildi — test avval faqat `uz`
  bo'yicha tekshirgani uchun o'tib ketgan edi; endi `uz`/`ru`/`en`
  uchalasi qulflangan.
- Apostrof: asl faylda 3 ta yozuv `‘` bilan edi, hammasi `'` ga
  keltirildi; test endi tipografik apostrofni rad etadi.

## Tuzilma (o'zgartirilmaydi)

```json
{ "id": "kebab-case", "uz": "", "ru": "", "en": "", "aliases": [], "sector": "", "skills": ["5-12 ta, o'zbekcha, har biri ≤40 belgi"] }
```

Sxemani `lib/professions.ts` va `tests/professions.test.mts` qulflaydi.
