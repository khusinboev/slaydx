# R4 — O'quv bazasi (`data/curriculum/`) yig'ish rejasi

AUDIT-20 §1 R4. Manba: WebSearch/WebFetch + `curl`/`pdftotext` bilan haqiqiy
fayllarni tekshirish (2026-09-16). Hech narsa bazaga yozilmadi — bu WP-B
(curriculum-data) ishi; bu yerda faqat manba, sxema, jarayon va mini-sinov.

## 1. Manbalar inventarizatsiyasi

| # | Manba | Nima beradi | Format | Yil | Ochiqlik |
|---|---|---|---|---|---|
| 1 | **uzbmb.uz** (Bilimni baholash agentligi, ex-DTM) `/page/o_dasturlar` → 10 fan sahifasi (`ona_tili_dastur`, `matematika_dastur`, `fizika_dastur`, `kimyo_dastur`, `biologiya_dastur`, `tarix_dastur`, `geografiya_dastur`, `huquq_dastur`, `xorijiy_til_dastur`, `rus_tili_dastur`, `qq_adab_dastur`) | **Rasmiy fan o'quv dasturi PDF, HAR SINF ALOHIDA FAYL** (`5-sinf-Matematika fanidan o'quv dastur.pdf` kabi), muallifi Respublika ta'lim markazi (RTM) — ya'ni bu aslida `rtm.uz` hujjatlari, uzbmb.uz orqali qayta e'lon qilingan | PDF, 15–30 bet | 2018 (matn ichida, qayta ko'rib chiqilmagan nashr) | Davlat hujjati, litsenziya yozilmagan — faktik ma'lumot sifatida ishlatsa bo'ladi (pastda 5-bo'lim) |
| 2 | **dts.rtmuzedu.uz** — RTM ning 2026 yil YANGI (loyiha) davlat ta'lim standarti va o'quv dastur portali | 1–4, 5–9, 10–11 bosqich uchun QAYTA KO'RIB CHIQILGAN dastur loyihalari, jamoatchilik muhokamasida (20-avgustdan 15 kun) | Next.js SPA (JS bilan render, `curl` bilan matn olinmadi — headless kerak) | 2026 (loyiha, hali tasdiqlanmagan) | Ochiq, lekin **beqaror** — hozircha loyiha, final matn keyin chiqadi |
| 3 | **uzedu.uz / uzedu.itsm.uz** (Maktabgacha va maktab ta'limi vazirligi) | Vazir buyruqlari — **tayanch o'quv reja** (fan×sinf haftalik soat, rasmiy `1-ILOVA`), yillik taqvim, PF/PQ farmonlari | PDF (skanerlangan emas, matnli — `pdftotext` ishladi) | Har yil yangilanadi (2025-yil 10-aprel, 121-son buyruq — joriy) | Davlat hujjati, ochiq yuklash |
| 4 | **lex.uz** | DTS asosiy huquqiy hujjati — **VM qarori 187-son, 06.04.2017** «Umumiy o'rta va o'rta maxsus ta'limning davlat ta'lim standartlarini tasdiqlash to'g'risida» (2020-2021 yillarda tahrirlangan, eski 390-son 1999 hujjat 2020-09-01 kuchini yo'qotgan) | HTML (qonun matni) | 2017 (amaldagi, tahrir tarixi bilan) | Ochiq, rasmiy huquqiy portal |
| 5 | **eduportal.uz** → aslida `old.eduportal.uz` ga 301 qayta yo'naltiradi | Darsliklar elektron shakli, video darslar, metodik ishlanmalar, 5–9-sinf ko'rinadi; sayt hozir «test rejimida» | HTML/PDF, ro'yxatdan o'tish talab qilinishi mumkin | 2018 dan beri, yangilanish holati noaniq | Vazirlik portali, ammo beqaror (eski domenga ko'chgan) |
| 6 | **kitob.uz** | Umumiy elektron kitob/audiokitob platformasi (3190+ kitob), «O'quv darsliklar» toifasi bor, lekin **mundarija/soat ma'lumoti yo'q** — faqat darslik matni | PDF/EPUB | — | Tijorat platforma, litsenziya aniq emas — **mundarija manbai sifatida mos emas**, faqat matn manbai bo'lishi mumkin |
| 7 | **erp.maktab.uz** | Rasmiy «yagona elektron dastur» — maktablarning tasdiqlangan o'quv rejalari shu yerga kiritiladi (uzedu buyrug'ida tilga olingan), lekin login talab qiladigan tizim tuyuladi (200 qaytardi, lekin ochiq API topilmadi) | — | joriy | Ehtimol yopiq/login talab |
| 8 | **infoedu.uz, qogozcha.uz, bilimmarkazi.uz, hasanboy.uz, mbaza.uz** (nostandart oynalar) | 1–11-sinf darsliklar PDF (Cambridge Informatika ham bor: `old.eduportal.uz/Umumiyfiles/darsliklar/5/informatika_5_uzb.pdf`) | PDF | turli | Norasmiy oyna — **faqat darslik matni uchun zaxira**, mundarija/soat rasmiy emas |

**Fan × sinf qamrovi — kim nima beradi** (✓ = to'liq, ~ = qisman, ✗ = yo'q):

| Fan | uzbmb.uz (5–11) | uzedu (1–11 soat) | boshlang'ich (1–4) mundarija |
|---|---|---|---|
| Ona tili / O'qish savodxonligi | ✓ (5–11) | ✓ soat | ✗ — alohida qidirilmadi, vaqt yetmadi |
| Adabiyot | ✓ (5-11 yagona fayl) | ✓ | ✗ |
| Rus tili (rus maktablari uchun) | ✓ (1-11 yagona fayl) | ✓ | ✗ |
| Matematika / Algebra / Geometriya | ✓ (5,6-7,8,10,11 alohida; 9-sinf FAYLI TOPILMADI — tekshirish kerak) | ✓ | ✗ |
| Fizika (+ astronomiya 11-sinf) | ✓ (6–11) | ✓ | — (fan yo'q) |
| Kimyo | ✓ (7–11) | ✓ | — |
| Biologiya | ✓ (5–11) | ✓ | — |
| Tarix (Jahon + O'zbekiston alohida 7-11) | ✓ (5–11) | ✓ | ✗ (boshlang'ichda «Tarixdan hikoyalar» bor) |
| Geografiya | ✓ (5–10; 11-sinf fayli sahifada YO'Q) | ✓ | — |
| Ingliz/chet tili | ✓ (1-11 yagona fayl) | ✓ (7-sinfda 3→4 soatga oshgan, 2025/26 yangilik) | ✗ |
| Informatika | **✗ uzbmb `o_dasturlar` ro'yxatida yo'q**; alohida qidiruvda `qabul2026/dasturlar/.../informatika/5-6-7.pdf`, `7-9.pdf` topildi — boshqa yil/tuzilish | ✓ (2025/26 dan 3-sinfdan boshlab yangi kiritildi) | ✗ — yangi, mundarija hali qidirilmadi |
| Tarbiya | ✗ — alohida qidirilmadi | ✓ (soat jadvalida bor) | ✗ |
| Huquq | ✓ (8–11) | — | — |

**Xulosa**: eng ishonchli, bir xil formatdagi, HAQIQIY mundarija+soat manbai — **uzbmb.uz `/page/<fan>_dastur`** (10 fan, 5–11-sinf, PDF, bevosita yuklab olinadi, SSL sertifikati eskirgan — `curl -k`/Node `rejectUnauthorized:false` kerak). 1–4-sinf va Informatika uchun qo'shimcha qidiruv kerak (pastda ochiq savol).

## 2. Rasmiy soatlar (haftalik) va chorak

- **Tayanch o'quv reja 2025-2026**: O'zbekiston Respublikasi Maktabgacha va maktab ta'limi vazirining **2025-yil 10-apreldagi 121-son buyrug'i**, 1-ILOVA (o'zbek tilida ta'lim beruvchi maktablar uchun) — https://uzedu.itsm.uz/uploads/downloads/D3DbQ0d7svuszu0A7IQ7l6xK_G3yOwBl.pdf (`pdftotext` bilan o'qildi, matnli PDF). Jadval tuzilishi: bo'lim (Filologiya/Ijtimoiy/Aniq/Tabiiy-iqtisodiy/Amaliy fanlar) → fan → 1–11-sinf ustunlari (haftalik soat). Eski (2024-2025, 94-son buyruq) 2025-08-31 da kuchini yo'qotgan — **har yil yangi buyruq chiqadi, bazaga yil belgisi bilan saqlash kerak**.
- 2025/26 o'quv yilining yangiliklari (gazeta.uz orqali topilgan qisqa xulosa, asl matn tasdiqlanmadi): 7-sinf chet tili 3→4 soat, 10-sinf chet tili 3→2 soat; 3-sinfdan «Informatika va AKT» joriy etildi (shu buyruqning 4-bandi, yuqoridagi PDF matnida tasdiqlandi: «2025-2026-o'quv yilidan boshlab... 3-sinfida "Informatika va axborot texnologiyalari" fani joriy etilsin»).
- **Chorak/taqvim**: aniq 2025/26 chorak sanalari (I–IV chorak boshi/oxiri) alohida qidirilmadi — vaqt yetmadi; odatda shu buyruqning boshqa ilovasida yoki alohida "o'quv yili taqvimi" buyrug'ida bo'ladi. **Ochiq savol #1** (pastda).
- **Yangi DTS islohoti** (2026, loyiha): https://www.gazeta.uz/oz/2026/08/31/school-program/ — kompetensiyaviy yondashuv, ba'zi fanlarda soat qisqarishi (ona tili 64→60), tabiiy fanlarga 13 soat (oldingi 9 o'rniga — kontekst noaniq, maqolada aniq sinf ko'rsatilmagan), "Iqtisodiyot va biznes" nomli YANGI birlashtirilgan fan (9-11-sinf). Loyihalar `dts.rtmuzedu.uz` da, 2026-09-20 dan 15 kun muhokamada. **Bu R4/AUDIT-20 uchun asosiy xavf** — bazani hozir 2025/26 amaldagi dasturga qurish kerak, lekin 2026/27 dan standart o'zgarishi mumkin (X-1, pastda).

## 3. JSON sxema — tasdiqlash va kengaytirish

AUDIT-20 dagi bazaviy sxema ishlaydi, quyidagi aniqlashtirish bilan:

```ts
type CurriculumSubject = {
  subject: { id: string; uz: string; ru: string; en: string };  // id: "matematika", "ona-tili" — lib/professions.ts uslubida qo'lda beriladi
  grade: number;                // 1–11; qo'shma fayllar (masalan "6-7-sinf") YIG'ISH BOSQICHIDA sinfga ajratiladi — bitta grade = bitta fayl
  source: {
    title: string;              // hujjat sarlavhasi aynan PDF ichidan
    url: string;                // to'g'ridan-to'g'ri PDF havolasi
    year: number;                // nashr yili (matn ichida — pastga qarang, ko'p hujjatda yo'q, shunda yuklab olingan sanadan kelib chiqib belgilanadi)
    publisher?: string;          // "Respublika ta'lim markazi" va h.k. — bor bo'lsa
  };
  units: {
    title: string;               // "I BOB. HOSILA VA UNING TATBIQLARI"
    hours?: number;              // BOB darajasida ko'p hujjatda bor ("40 soat"); mavzu darajasida odatda YO'Q
    quarter?: 1 | 2 | 3 | 4;      // ko'p hujjatda YO'Q — faqat taqvim-mavzu rejasi (alohida hujjat, uzedu/erp.maktab.uz) berilsa to'ldiriladi
    topics: { id: string; title: string; hours?: number; quarter?: number; page?: number }[];
  }[];
};
```

Aniqlashtirishlar:
- **`topics[].id` qoidasi**: `slug(unit.title)` + tartib raqami (mini-sinovda ishlatilgan naqsh: `hosila-va-uning-tatbiqlari-3`). Fan+sinf ichida unikal bo'lishi kifoya (`tests/curriculum.test.mts` shuni tekshiradi), global emas.
- **Tillar**: `subject.{uz,ru,en}` — `lib/professions.ts` naqshi (uch tilli qidiruv). PDFlarning o'zi FAQAT o'zbekcha (lotin), ba'zan rus tili uchun alohida fayl bor (qardosh tillar — qoraqalpoq/qozoq/qirg'iz/tojik/turkman — alohida fayl, 1-son emas). `en` maydoni LLM tarjimasi bo'ladi (fan nomi uchun, mavzu emas — mavzu tarjimasi hajmni 3x oshiradi, MVP uchun shart emas).
- **Darslik sahifasi**: sxemaga ixtiyoriy `page?: number` qo'shishni tavsiya qilaman (test/atestatsiya vositasi darslikka reference berishi mumkin — AUDIT-20 §1 dagi «darslik sahifasi ixtiyoriy» talabiga mos), lekin uzbmb dasturi darslik sahifasini ko'rsatmaydi — bu maydon HOZIRCHA doim bo'sh qoladi, keyingi bosqichda darslik mundarijasi bilan bog'lash kerak (alohida ish).
- **Bo'lim/chorak bog'lanishi**: uzbmb dasturi BOB darajasida soat beradi, chorak bermaydi («soatlar taqsimoti faqat boblar bo'yicha berildi, mavzu/dars taqsimoti — namunaviy taqvim rejada» — matndan iqtibos, `math11.pdf`). Demak **`quarter` maydonini MVP da to'ldirib bo'lmaydi** — faqat `hours` unit darajasida ishonchli. Taqvim-mavzu reja (chorak bilan) alohida hujjat turi, R4 doirasida topilmadi (Ochiq savol #2).
- **Hajm bahosi**: 10 fan × ~7 sinf (5–11, ba'zi fan kamroq) × ~9 BOB × ~15–25 xom qator (LLM normalizatsiyasidan OLDIN, mini-sinovdagi kabi) ≈ 10×7×9×18 ≈ **11 300 xom qator** → LLM normalizatsiyasidan keyin (duplikat/shovqin olib tashlansa) taxminan **40–60%** qisqaradi ≈ **5000–6500 yakuniy mavzu qatori**, JSON hajmi AUDIT-20 dagi «~1.5 MB» baholashi bilan mos keladi (o'rtacha mavzu satri ~80–120 bayt × 6000 ≈ 500–700 KB + unit/meta overhead → 1–1.5 MB oqilona).

## 4. Yig'ish jarayoni

**`scripts/fetch-curriculum.mts`** (`scripts/fetch-professions.mts` naqshi — tarmoq bosqichi alohida, keshlanadi):

1. Fan × sinf → PDF URL xaritasi **qo'lda** yoziladi (uzbmb.uz strukturasi barqaror emas — fayl nomlari orasida bo'sh joy/apostrof farqlari bor: `10-sinf Kimyo fanidan...` vs `10-sinf-Kimyo...`; avtomatik directory listing yo'q, sahifa HTML'ini parslash kerak — `o_dasturlar` → 10 ta `<fan>_dastur` sahifa → har birida `.pdf` havolalar, xuddi shu R4 tadqiqotida qilingan `grep -oiE 'href="[^"]*\.pdf"'` yondashuvi ishladi).
2. Har PDF: `fetch(url, {agent: sertifikatni tekshirmaydigan https.Agent})` (uzbmb.uz sertifikati eskirgan — production kodda buni **hujjatlashtirish** kerak, xavfsizlik nazari bilan tekshirilsin) → bayt buferi → **`lib/extract-text.ts extractFromBuffer(name, buf)`** (loyihada allaqachon bor, PDF/DOCX/TXT ni qamraydi — bu R4 mini-sinovda AYNAN shu funksiya bilan tekshirildi, pastga qarang) → xom matn `node_modules/.cache/slaydx-curriculum-raw/<fan>-<sinf>.txt` ga keshlanadi.
3. **Mundarija heuristikasi** (LLM dan OLDIN, arzon va determinist):
   - BOB sarlavhasi: `/^(I{1,3}V?|IV|V)\s*BOB\.\s*(.+)$/` (rim raqam + "BOB." + sarlavha; ba'zan ikki qatorga bo'linadi — keyingi qatorni ADABIYOT/TARIX kabi fanlarda ham moslashtirish kerak, chunki ular "BOB" so'zini ishlatmasligi mumkin — **fan-xos regex kerak bo'lishi mumkin**, mini-sinovda faqat Matematika tekshirildi).
   - Soat: `/\((\d+)\s*soat/` — BOB sarlavhasidan keyingi qatorda "(40 soat, B1+: 9 soat)".
   - Mavzu qatorlari: BOB matnini BITTA blokka birlashtirib (PDF qator uzilishlari so'zni bo'lib tashlaydi — mini-sinovda aniqlangan haqiqiy muammo), so'ng `/(?<=\.)\s+(?=[A-ZʻʼʼO‘])/` bo'yicha gap-gap ajratish (nuqta + bosh harf) — bu satr-bo'yicha ajratishdan ANCHA toza natija berdi (pastga qarang).
   - Shovqin filtri: `/^\d+[-–]\s*Nazorat ishi|^Masalalar yechish\.?$|^Yakuniy nazorat/i` kabi qatorlar (nazorat ishi, "masalalar yechish") — bular DASTUR qismi, lekin "mavzu" emas, `topics` dan chiqariladi yoki alohida `type:"nazorat"` bilan belgilanadi (qaror kerak — Ochiq savol #3).
4. **LLM FAQAT normalizatsiya**: heuristika chiqargan xom mavzu ro'yxatini (mini-sinovda 9 BOB / 275 qator) bitta fan-sinf uchun bitta LLM chaqiruviga beradi — birlashtirish (bitta mavzuni 2-3 qatorga bo'lib yuborgan joylarni qo'shish), dublikatlarni olib tashlash, `id` yasash, `en`/`ru` fan nomi tarjimasi. Ro'yxat TUZILMAYDI — faqat tozalanadi (professions naqshi bilan bir xil falsafa).
5. **Tekshirish** (`tests/curriculum.test.mts`): (a) `topics[].id` fan-sinf ichida unikal; (b) `Σ unit.hours` rasmiy yillik soat bilan **taxminan** mos (`uzedu` tayanch reja jadvalidan haftalik soat × ~34 hafta — ± 10% chegara, chunki nazorat/takrorlash soatlari ikki hujjatda boshqacha hisoblanishi mumkin); (c) bo'sh `topics` bo'lgan unit yo'q; (d) `title` uzunligi 3–200 belgi (juda qisqa — parsing xatosi, juda uzun — bo'linmagan blok).
6. **Qo'lda ko'rib chiqish hajmi**: 10 fan × ~7 sinf = ~70 fayl; har biri LLM normalizatsiyasidan keyin ~1–2 daqiqa ko'z bilan tekshirish (BOB soni, soat yig'indisi, 2-3 tasodifiy mavzu) ≈ **2–2.5 soat jami** — bitta odam bir kunda bosib o'tadi (AUDIT-20 dagi "1-2 kun R bosqichi" ga mos).

### Mini-sinov natijasi (haqiqiy, 2026-09-16 bajarilgan)

Manba: `uzbmb.uz/upload/file/pdf/qabul2025/dasturlar/5.Matematika/11-sinf-Matematika fanidan o'quv dastur.pdf` (308 KB, 21 bet) — `curl -k` bilan yuklab olindi, keyin **loyihaning `lib/extract-text.ts extractFromBuffer()`** funksiyasi `npx tsx` orqali chaqirildi (script: scratchpad `mini-sinov.mts`, repoga kommit qilinmadi — vaqtinchalik):

```
[ok] extractFromBuffer: 38135 belgi
[ok] 9 BOB topildi, jami mavzu qatori: 275
```

Namuna (2 BOB, ~28 mavzu — `subject/grade/source/units` sxemasi bo'yicha, HAQIQIY hujjatdan, qo'lda o'zgartirilmagan):

```json
{
  "subject": { "id": "matematika", "uz": "Matematika", "ru": "Математика", "en": "Mathematics" },
  "grade": 11,
  "source": {
    "title": "Aniq fanlar blok moduli bo'yicha umumiy o'rta ta'limning o'quv dasturi (XI sinf) — Matematika",
    "url": "https://uzbmb.uz/upload/file/pdf/qabul2025/dasturlar/5.Matematika/11-sinf-Matematika%20fanidan%20o'quv%20dastur.pdf",
    "year": 2018,
    "publisher": "Respublika ta'lim markazi (Xalq ta'limi vazirligi)"
  },
  "units": [
    {
      "title": "HOSILA VA UNING TATBIQLARI",
      "hours": 40,
      "topics": [
        { "id": "hosila-va-uning-tatbiqlari-1", "title": "X- sinfda o'tilganlarni takrorlash." },
        { "id": "hosila-va-uning-tatbiqlari-2", "title": "O'zgaruvchi miqdorlar orttirmalarining nisbati va uning ma'nosi." },
        { "id": "hosila-va-uning-tatbiqlari-5", "title": "Limit haqida tushuncha." },
        { "id": "hosila-va-uning-tatbiqlari-10", "title": "Hosila, uning geometrik va fizik ma'nosi." },
        { "id": "hosila-va-uning-tatbiqlari-14", "title": "Hosilani hisoblash qoidalari." }
      ]
    },
    {
      "title": "INTEGRAL VA UNING TATBIQLARI",
      "hours": 21,
      "topics": [
        { "id": "integral-va-uning-tatbiqlari-1", "title": "Boshlang'ich funksiya va aniqmas integral tushunchalari." },
        { "id": "integral-va-uning-tatbiqlari-4", "title": "Integrallar jadvali." },
        { "id": "integral-va-uning-tatbiqlari-8", "title": "Bo'laklab integrallash." },
        { "id": "integral-va-uning-tatbiqlari-9", "title": "Aniq integral." },
        { "id": "integral-va-uning-tatbiqlari-10", "title": "Nyuton-Leybnits formulasi." }
      ]
    }
  ]
}
```

Bu **jarayonning ishlashini isbotlaydi**: haqiqiy tarmoq yuklab olish → loyihaning mavjud `extractFromBuffer` (unpdf) → regex heuristika → to'g'ri shakldagi JSON, hech qanday qo'lda kiritish yo'q. Kamchilik (kutilgan, LLM normalizatsiya bosqichi tuzatadi): ba'zi mavzular haddan tashqari qisqa bo'lib ketdi ("Ayirmali nisbat."), ba'zi qatorlar takrorlanadi (manba matnining o'zida takror — "Integrallar jadvali." ikki marta), "4- Nazorat ishi" kabi shovqin bazida ba'zan filtrdan o'tib ketdi (regex mukammal emas — fan-xos sozlash kerak).

## 5. Xavflar

- **X-1 Standart o'zgaryapti**: 2026-08-20 dan jamoatchilik muhokamasidagi YANGI DTS/dastur (`dts.rtmuzedu.uz`, gazeta.uz/oz/2026/08/31/school-program) 2026/27 o'quv yilidan kuchga kirishi mumkin — sxema `source.year`/`source.title` bilan versiyalanishi shart, eski (2018/2025) dastur "legacy" sifatida saqlanadi, yangisi chiqqanda faqat YANGI fayl qo'shiladi (eskisi o'chirilmaydi) — AUDIT-20 dagi reyestr `type` yondashuviga mos.
- **X-2 uzbmb.uz strukturasi barqaror emas**: fayl nomlarida bo'sh joy/apostrof nomuvofiqligi (`10-sinf Kimyo...` vs `10-sinf-Kimyo...`), ba'zi sinf fayli umuman yo'q (9-sinf matematika, 11-sinf geografiya sahifada topilmadi — qo'lda tekshirish kerak, ehtimol boshqa nom bilan). SSL sertifikati eskirgan (`unable to verify the first certificate`) — ishonchsiz kanal, faqat davlat ma'lumoti ekanligi uchun qabul qilinadi, lekin fetch skriptida aniq izohlansin.
- **X-3 1–4-sinf va Informatika qamrovi topilmadi**: vaqt yetmagani sabab boshlang'ich sinf (1-4) mundarijasi va Informatika (barcha sinf) alohida qidiruv talab qiladi — Ochiq savol #4.
- **X-4 Lotin/kirill**: barcha topilgan PDF lotin yozuvida edi; rus tili ta'lim tili uchun alohida (kirill) fayl bor (`4.Rus tili va adabiyot/...`), qoraqalpoq/qardosh tillar ham alohida — bazada `lang` maydoni yo'q, MVP faqat o'zbek-lotin uchun qurilsin, boshqa tillar keyingi bosqich.
- **X-5 Mualliflik**: mundarija (bob/mavzu nomlari, soat) — DAVLAT hujjati, faktik ma'lumot, tushuntirish xati/uslubiy matnlar (LLM uchun "yomon misol" bo'lishi mumkin) ko'chirilmasin — faqat BOB sarlavhasi + mavzu ro'yxati saqlanadi, "Tushuntirish xati" bo'limi (matematika hujjatida 4+ bet) bazaga KIRITILMAYDI.
- **X-6 Bir nechta darslik/muqobil**: uzbmb dasturi ba'zan bitta fanga ikki hujjat beradi (Tarix: Jahon + O'zbekiston alohida; 10-sinf ba'zi fanlarda "(MO'D)" — Milliy o'quv dasturi belgisi, muqobil versiya bo'lishi mumkin) — sxemada `subject.id` bunday holatlarda ikkiga bo'linadi (`tarix-jahon`, `tarix-ozbekiston`), bitta faylga majburlanmaydi.

## Ochiq savollar

1. Chorak sanalari/taqvim (2025/26) qayerdan olinadi — alohida "o'quv yili taqvimi" buyrug'i qidirilmadi.
2. Mavzu-darajasida soat/chorak beruvchi **taqvim-mavzu reja** namunasi bormi (uzedu/erp.maktab.uz login talab qilishi mumkin) — buni topsak `quarter` maydoni to'lar.
3. Nazorat ishi/loyiha ishi qatorlari `topics` ichida qoldiriladimi yoki chiqariladimi (pedagogik qaror, egasidan so'ralsin).
4. 1–4-sinf va Informatika (barcha sinf) uchun qo'shimcha manba qidiruvi — keyingi qadam sifatida tavsiya etiladi.
5. `dts.rtmuzedu.uz` yangi standarti qachon tasdiqlanadi — bazani hozir eski (amaldagi) dastur ustida qurish, yangisi rasmiylashgach yangilash tavsiya etiladi.
