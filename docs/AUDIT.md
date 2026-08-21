# sodda-web — YAKUNIY AUDIT HISOBOTI

**Sana:** 2026-08-19
**Auditor:** Claude (Opus 5) — mustaqil kod auditi + 3 ta AI hisobotining meta-tahlili + chiqish fayllarining empirik o'lchovi
**Auditlangan versiya:** `sodda-web` v1.0.0 (`bee80a3`), 18 887 qator TS/TSX/SQL/CSS
**Maqsad:** xizmatlar sifatini oshirish bo'yicha yagona, dalilga asoslangan ish rejasini berish

---

## 0. Hisobot pasporti — nima qilindi

Bu hisobot uchta manbadan yig'ildi. Uchalasi ham mustaqil ravishda bajarildi:

| # | Manba | Hajm |
|---|---|---|
| 1 | **Kodning to'g'ridan-to'g'ri auditi** — `lib/generation/` (24 modul), `lib/server/` (16 modul), `app/api/` (14 endpoint), `lib/tools.ts`, formalar va viewerlar | 18 887 qator |
| 2 | **Uchta AI hisobotining meta-tahlili** — ai-1 (9 fayl, 79 KB), ai-2 (5 fayl, 208 KB), ai-3 (DOCX, 15 KB) | 302 KB |
| 3 | **Chiqish fayllarining empirik o'lchovi** — `namunalar/` jildidagi haqiqiy generatsiya natijalari | 43 DOCX + 12 PPTX |

Qo'shimcha: `tsc --noEmit` (toza), `npm test` (49 test: 47 o'tdi, 2 skip, 0 fail), `npm audit` (5 ta high).

**Nega empirik o'lchov muhim:** uchala AI ham faqat kodni o'qigan. Men kodni o'qishdan tashqari **haqiqiy chiqqan fayllarni ochib o'lchadim** — so'z soni, slayd soni, bullet uzunligi, speaker notes borligi, fayl hajmi. Shu sababli quyidagi bir nechta xulosa uchala hisobotdan ham aniqroq, ba'zilari esa ularning da'volarini rad etadi.

---

## 1. Boshqaruv xulosasi — 60 soniyalik

> **Poydevor mahsulotga tayyor. Chiqish sifati esa tayyor emas — va asosiy muammo sifatning pastligi emas, uning oldindan aytib bo'lmasligi.**

Uchta jumlada:

1. **Infratuzilma professional darajada.** Navbat, kredit, to'lov, auth, egalik, TTL, refund — bularning hammasi to'g'ri qurilgan va ularga tegmaslik kerak. Bu odatda bu bosqichdagi loyihalarda uchramaydi.
2. **Generatsiya dvigateli va'dani bajarmaydi.** Bir xil so'rov 2–4 baravar farq qiladigan hajmdagi natija beradi; hech bir joyda «va'da bajarildimi?» degan tekshiruv yo'q; LLM yiqilsa umumiy shablon matn `COMPLETED` bo'lib, pul qaytmaydi.
3. **Slayd narx paketi ishlamaydi.** 8 000 tanga to'lagan foydalanuvchi 3 000 tangalik bilan **bir xil** natija oladi — bu texnik nuqson emas, **tijoriy nuqson**.

**Umumiy baho (10 ballik):**

| Qatlam | Ball | Izoh |
|---|---:|---|
| Arxitektura va navbat | 9 | Sanoat darajasida |
| Xavfsizlik (auth, IDOR, CSRF, SSRF, zip-bomb) | 8 | Kuchli; CSP `unsafe-inline` va 5 ta npm advisory qoldi |
| Kredit va to'lov | 9 | Idempotent, jurnalli, tranzaksion |
| Kod sifati va izohlar | 9 | Har bir qaror o'zbekcha izohlangan — kamdan-kam holat |
| **Hujjat (DOCX) chiqish sifati** | **5** | Matn yaxshi bo'lishi mumkin, lekin hajm va tuzilma kafolatlanmagan |
| **Taqdimot (PPTX) chiqish sifati** | **4.5** | Fayl ochiladi, lekin professional taqdimot emas |
| **Sifat nazorati (test/eval)** | **1** | `lib/generation/` uchun bironta test yo'q; eval skript mavjud bo'lmagan endpointga murojaat qiladi |
| Mahsulot rostgo'yligi (va'da = natija) | 3 | Sifat paketi, `titleSlide`, `includeVisuals`, TOC raqamlari — hammasi yolg'on va'da |

**Yakuniy o'rtacha: ~6.0/10.** Ochilishga tayyor emas — lekin ochilishgacha bo'lgan masofa **3–4 hafta**, oy emas.

---

## 1.1. BAJARILDI — Sprint 0 va Sprint 1 (jonli natija)

> Quyidagi raqamlar **haqiqiy Gemini chaqiruvlari** bilan olingan: har vosita
> `POST /api/generations` orqali navbatga qo'yildi, worker bajardi, tayyor
> fayl yuklab olinib o'lchandi. Rasm zanjiri (fal.ai) bu sinovda o'chirilgan.

**Sifat darvozasi: birinchi jonli o'lchov 6/14 → oxirgi o'lchov 14/14.**

| Vosita | Ilgari | Hozir | Darvoza | Holat |
|---|---:|---:|---:|---|
| Insho (2 varaq) | 616 | 806 | 368 | ✅ |
| Referat (10–15 bet) | 2 560 | 3 142 | 2 392 | ✅ |
| Kurs ishi (15–20 bet) | 3 551 | 3 872 | 3 312 | ✅ |
| Maqola (5–10 bet) | 1 757 | 2 097 | 1 472 | ✅ |
| Tezis (5–10 bet) | 1 881 | 2 065 | 1 472 | ✅ |
| Mustaqil ish (10–15 bet) | 2 411 | 2 940 | 2 392 | ✅ |
| Glossariy | 583 | 818 | 350 | ✅ |
| Slayd — standart | 7–10 slayd | 10 slayd · 10 notes | 10 | ✅ |
| **Slayd — premium uzun** | **7–10 slayd · 0 notes** | **16 slayd · 16 notes** | 16 | ✅ |

Eng muhim qator — oxirgisi: 8 000 tangalik paket endi 3 000 tangalikdan
haqiqatan farq qiladi (P0-1), speaker notes esa 0 dan 16 ga chiqdi (P0-5).

### Jonli sinov ochgan yangi nuqsonlar

Bu uchtasi statik tahlilda ham, uchala AI hisobotida ham yo'q edi.

| Topilma | Qanday ko'rindi | Yechim |
|---|---|---|
| **Bitta tarmoq uzilishi butun hujjatni yo'q qilardi** | `[gemini] fetch failed` ×6 → 4 bo'lim ham bo'sh → FAILED | `llmComplete` o'tkinchi xatoda (tarmoq, 429, 5xx) 3 martagacha urinadi; timeout'da urinmaydi |
| **Model o'zi ishonarli manba uydiradi** | «Qosimova K. Ona tili o'qitish metodikasi. – Toshkent: Nosir, 2009» — tekshirib bo'lmaydi | Ro'yxat qoladi, lekin hujjatda **TEKSHIRILMAGAN** deb belgilanadi; DOI/ISSN/jurnal tomi/havola filtrlanadi |
| **Filler filtri jonli matnni o'ldirardi** | Insho «qalbida bir tushuncha shakllanadi» deb boshlangan — shablon deb belgilandi | Ibora endi faqat ≤70 belgilik matnda (jadval katagi) shablon hisoblanadi |
| *(operatsion)* **Inline worker hot reload olmaydi** | Bir tur eval eski kodni sinadi | README ga ogohlantirish qo'shildi |

### Qamrov

| Ko'rsatkich | Ilgari | Hozir |
|---|---:|---:|
| Testlar | 49 | 99 |
| `lib/generation/` uchun test | 0 | 50 |
| Eval (jonli, uchidan-uchiga) | ishlamasdi | 14/14 |
| WCAG AA dan yiqilgan tema juftlari | 5 | 0 |

### Sprint 1 — slayd vizuali

`coerceLayout` (kontent yo'qolmaydi) · `shrinkText: false` + aniq sig'dirish
(**preview = eksport** tiklandi) · 4 bullet / 120 belgi · process 2 qatorga
bo'linadi va `→` konnektor oladi · stats 3+ raqamda diagrammaga aylanadi
(`rect` qatlamlaridan, ya'ni preview mosligi buzilmaydi) · `magazine`
subtitle · `chrome: "split"` haqiqiy · rasm `seed` + premium model ·
`persistImage` yiqilsa muddatli URL saqlanmaydi · layout i18n ·
`inferSlideTemplate` toraytirildi · **`accentInk`** qo'shildi — `atlas`
temasining oltin aksenti krem fonda 2.20 dan 4.51 ga chiqdi.

### Sprint 2 — akademik yozuv

**Kurs ishi endi referatdan farq qiladi** (P0-7). Jonli tekshiruv, 42 soniya:

| Talab | Natija |
|---|---|
| Uch bob majburiy (hajmdan qat'i nazar) | ✅ Kirish + 3 bob + chuqurlashtirish + Xulosa |
| Kirishda aniq tadqiqot savoli | ✅ *«…aniq tadqiqot savoli quyidagicha shakllantirildi: …?»* |
| Kamida bitta jadval | ✅ 1 ta (`images=no` tanlangan bo'lsa ham) |
| 8–10 manba | ✅ 8 ta + TEKSHIRILMAGAN ogohlantirishi |
| Hajm | ✅ 3 882 so'z ≈ 17 bet (va'da 15–20) |
| Titul: kurs va guruh alohida | ✅ «Bajardi: Karimova Madina» + «3-kurs, 301-guruh» |
| Titul: imzo qatorlari | ✅ 2 ta |
| Ramka yo'q | ✅ |

Boshqa tuzatishlar:

| Nuqson | Yechim |
|---|---|
| **P1-8** IMRAD annotatsiyasi doim `uz` kalitidan o'qilardi | Kalitlar hujjat tilidan olinadi; `all` rejimida asosiy til takrorlanmaydi |
| **Standart maqola annotatsiyasiz** edi — jurnalga yaroqsiz | Har qanday maqolaga annotatsiya + kalit so'zlar qo'shiladi |
| **P1-22** Xaritada qator yetmasa tsikl bilan takrorlanardi | Takror mavzu tashlanadi; 70% dan kam noyob mavzu bo'lsa ish xato beradi. Pasportda haqiqiy qator soni yoziladi |
| **Dars daqiqalari** yig'indisi hech qachon tekshirilmasdi | Nisbat saqlangan holda `duration` ga moslanadi (45 daq → yig'indi 45) |
| **P1-19** Rezyumeda LLM yangi ish joyi/yil uydirishi mumkin edi | Chiqishdagi yil kiritilgan matnda bo'lishi shart; tashkilot nomi kamida bitta mazmunli bo'lakni kiritmadan olishi kerak. O'tmagan band tashlanadi |
| **P2-11** `course`/`group` maydoni yo'q edi | Muallif satridan ajratiladi (`«Aliyev Ali — 3-kurs, 301-guruh»`) |
| **P2-10** Titulda imzo qatori yo'q | `Bajardi` va `Rahbar` yoniga imzo chizig'i qo'shildi |

**Regressiya sinovi (jonli, Gemini):** Sprint 2 tekkan 5 vosita — maqola,
tezis, rezyume, dars rejasi, texnologik xarita — **5/5 o'tdi**. Fayllardagi
aniq tekshiruv:

| Da'vo | O'lchov |
|---|---|
| Maqolada annotatsiya + kalit so'zlar | ✅ *«Kalit so'zlar: qayta tiklanuvchi energiya, …»* |
| Dars daqiqalari yig'indisi = davomiylik | ✅ `[5,10,10,8,7,5]` → **45** (kerak 45) |
| Xaritada takror mavzu yo'q | ✅ 69 mavzu, takror **0**, pasportda 34 hafta |
| Rezyumeda uydirma yil yo'q | ⚠️→✅ 1-urinishda **2017** chiqdi (ta'lim qatorida), filtr kengaytirildi, 2-urinishda uydirma yil **0** |

Rezyume filtri ikki xil javob beradi: **uydirma tashkilot** — butun band
tashlanadi, **uydirma yil** — faqat yil o'chiriladi. Shu bilan haqiqiy
qayta ifodalash (`15-maktab` → `15-sonli umumiy o'rta ta'lim maktabi`)
saqlanadi, lekin o'ylab topilgan `2017–2021` oralig'i chiqmaydi.

> **Eslatma:** gerb va «TASDIQLAYMAN» bloki ataylab qo'shilmadi — ular
> muassasadan muassasaga farq qiladi va noto'g'ri shablon foydalanuvchiga
> zarar qiladi. Bular forma orqali ixtiyoriy qilinishi kerak.


### Sprint 3 — 3/4

| Ish | Holat |
|---|---|
| **Jadval layouti** | ✅ `report` va `defense` decklariga jadval beat. `pptx.addTable` ishlatilmadi — jadval `rect`/`text` qatlamlaridan quriladi, preview = eksport saqlanadi |
| **`audience` rejimi** | ✅ himoya 18/15 pt · 4 band; maktab **24/20 pt · 3 band**; pitch 20/16 · 3. Promptga ham auditoriya ko'rsatmasi tushadi |
| **Reja tahriri** | ✅ `POST /api/outline` — **bepul**. Jonli sinov: reja olindi, unga yangi bob qo'shildi, ostmavzu nomlari o'zgartirildi — hujjat aynan shunga amal qildi |
| **4:3 nisbat** | ⛔ ataylab qoldirildi — pastga qarang |

**Reja tahriri: narx qarori.** Reja bepul. Uni pulli qilish narxni bo'lish,
«renderdan voz kechsa qaytadimi» qoidasi va yangi tranzaksiya turlarini
talab qilardi. Bepul bo'lgani uchun foydalanuvchi rejani tuzatib keyin
qimmat renderga o'tadi — yaroqsiz hujjatlar va qaytarishlar kamayadi.
Suiiste'moldan himoya: kirish + 10 daqiqada 12 so'rov.

Yangi UI qurilmadi — mavjud «Mundarijani o'zim yozaman» mexanizmi
kuchaytirildi. U yarim yolg'on edi: reja qabul qilinardi-yu,
foydalanuvchi yozgan **ostmavzular tashlab yuborilardi** (o'rniga generic
«1.1», «1.2»). `parseManualOutline` endi bob va ostmavzuni ajratadi.

**4:3 nima uchun qilinmadi.** `slide-layout.ts` da 11 ta layout funksiyasi
16:9 ga qo'lda moslangan ~40 ta gorizontal konstantaga tayanadi. Ularni
parametrlash **asosiy 16:9 yo'lini** xavf ostiga qo'yadi, chegara testi
esa to'lib ketishni ushlaydi-yu «xunuk maket»ni ushlamaydi — ya'ni
natijani avtomatik tasdiqlab bo'lmaydi. Ikkinchi darajali format uchun
birinchi darajalisini buzish xavfi oqlanmaydi. Bu renderlangan slaydlarni
ko'z bilan ko'rib qilinadigan alohida vazifa.

### Yakuniy regressiya (jonli, 14 vosita)

**13/14 o'tdi.** Yagona yiqilish — `keys`: 73 soniyada timeout. Sababi
tuzilmaviy edi (bitta chaqiruv, qayta urinish yo'q — `glossary` va
`lesson-plan` dan farqli), tuzatildi va alohida tekshirildi: 855 so'z,
o'tdi. To'liq to'plam tuzatishdan keyin qaytadan yaxlit ishga
tushirilmagan — keyingi seansning birinchi qadami shu bo'lsin.

Hajm oxirgi o'lchovda yana o'sdi (ostmavzu qayta qurilishi ta'siri):

| Vosita | r1 (audit) | r8 (hozir) | Darvoza |
|---|---:|---:|---:|
| Referat | 2 560 | **3 212** | 2 392 |
| Kurs ishi | 3 551 | **4 087** | 3 312 |
| Maqola | 1 757 | **2 482** | 1 472 |
| Tezis | 1 881 | **2 427** | 1 472 |
| Mustaqil ish | 2 411 | **3 227** | 2 392 |
| Slayd premium | 7–10 slayd · 0 notes | **16 slayd · 16 notes** | 16 |

**Rasm zanjiri tekshirildi** (fal.ai): standart 8 rasm, premium **10** —
premium darajasi haqiqiy farq beradi. Hamma rasm `data:` URL sifatida
saqlandi (muddatli havola qolmadi), hammasi noyob.


### Raqobat tahlili — Gamma PPTX eksporti

Gamma.app da yaratilgan taqdimotning PPTX paketi ochib o'rganildi
(10 slayd, 88 MB). Natija reja ustuvorligini ikki joyda o'zgartirdi.

| Element | Gamma | Biz |
|---|---|---|
| Master / layout | 1 + 11 | yo'q |
| Tema ranglari | **standart Office palitrasi** | 15 ta o'z palitramiz |
| Slaydda rang | `srgbClr` ×16, **`schemeClr` ×0** | inline hex |
| Placeholder | **0** | 0 |
| Shrift | 2 ta juft, **8 ta joylashtirilgan** | Calibri, joylashtirilmagan |
| Matn sig'dirish | `normAutofit` | oldindan hisoblash |
| Native chart | **yo'q** (`ppt/charts` bo'sh) | `rect` bilan chizamiz |
| Speaker notes | **10/10 bo'sh** | 16/16 matnli |
| Fayl hajmi | **88 MB** (4K PNG) | 5–7 MB (JPEG) |

**1. «Slide master / theme XML» bandi pasaytirildi.** Auditda u Sprint 4
da edi. Lekin dalil ko'rsatdiki bozor yetakchisining master'i ham
dekorativ: layoutlarning 10 tasi bir xil 1 847 baytlik bo'sh fayl,
slaydlar temaga umuman murojaat qilmaydi. Ularning deck'ida ham
«Dizayn → variant» hech narsa qilmaydi. Bu rejalashtirilgan ishni tejaydi.

**2. Yangi band: shriftni PPTX ichiga joylashtirish.** Bu Gamma'dagi
yagona haqiqiy texnik ustunlik va u bizga **ko'proq** foyda beradi,
chunki bizning maket oldindan hisoblangan o'lchamga tayanadi. Biz
`Calibri` ni qattiq yozganmiz, u esa faqat Windows'da bor:
`fc-match Calibri` → Noto Sans (metrik mos EMAS), va bizning PPTX
haqiqatan shu bilan chizilyapti. Vaqtinchalik yechim sifatida
`CHAR_EM = 0.55` qo'yildi (eng keng ehtimoliy almashtiruv), to'liq
yechim — `ppt/fonts/*.fntdata` + `presentation.xml` da `embeddedFontLst`.

**Nusxa olinmaydigan narsalar:** 88 MB deck, fotosurat uchun 4K PNG,
`normAutofit` ga tayanish, bo'sh speaker notes.

#### Shrift joylashtirish — texnik tafsilot va qaror

Format teskari muhandislik qilindi, shunda kelajakda ish noldan
boshlanmasin:

- `ppt/fonts/fontN.fntdata` — bu **EOT** (Embedded OpenType).
  Birinchi 4 bayt = fayl hajmi (LE), 34-offsetda `MagicNumber 0x504C`.
- Gamma'da `Flags = 0x00000004` = `TTEMBED_TTCOMPRESSED`, ya'ni shrift
  ma'lumoti **MicroType Express** bilan siqilgan — shuning uchun faylda
  TTF imzosi umuman yo'q. Siqilmagan EOT ham spetsifikatsiyada ruxsat
  etilgan.
- `[Content_Types].xml` ga `<Default Extension="fntdata"
  ContentType="application/x-fontdata"/>`, `presentation.xml` ga esa
  `<p:embeddedFontLst>` kerak.

**Qaror: hozir qurilmaydi.** Uch sabab:

1. **Asosiy foyda allaqachon boshqa yo'l bilan olingan.** «Hamma joyda
   bir xil ko'rinsin» talabini **PDF eksporti** yopadi: LibreOffice
   shriftni PDF ichiga subset qilib joylashtiradi (tekshirildi —
   `BAAAAA+NotoSans-Bold` kabi). Aniq maket kerak bo'lgan foydalanuvchi
   PDF yuklab oladi.
2. **Qabul qilinishini bu yerda tekshirib bo'lmaydi.** Siqilmagan EOT ni
   PowerPoint qabul qiladimi — sinash uchun PowerPoint kerak. Yiqilsa
   ish behuda ketadi (natija bugungidan yomon bo'lmaydi, lekin yaxshi
   ham bo'lmaydi).
3. **Fayl hajmi.** Subsetsiz 4 ta qiyofa ≈ 1.4 MB, ya'ni deck +20–25%.
   Gamma'da 26–55 KB, chunki ular subset + MTX siqish qiladi — ikkalasi
   ham alohida ish.

Vaqtinchalik yechim (`CHAR_EM = 0.55`) amaliy foydaning katta qismini
beradi: almashtirilgan shrift kengroq bo'lsa ham matn qutidan chiqmaydi.


### Qolgan cheklov

Rasm zanjiri (fal.ai) jonli sinalmadi — slayd rasmlarining yangi `seed`
va premium modeli faqat kod darajasida tekshirilgan.


---

## 2. Uchta AI hisobotining meta-tahlili

Bu bo'lim eng muhimi: siz uchta hisobotga pul/vaqt sarfladingiz, ular **bir-biriga zid tavsiyalar** beradi. Quyida qaysi biriga ishonish kerakligi hakamlik qilingan.

### 2.1 Ishonchlilik reytingi

| Hisobot | Ishonchlilik | Kuchli tomoni | Zaif tomoni |
|---|---|---|---|
| **ai-1** (9 fayl) | **Yuqori** | Har bir da'vo aniq fayl va qator bilan bog'langan; mahsulot va tijorat nuqtai nazari bor; taqdimot dizayni bo'yicha to'g'ri (Duarte/Reynolds maktabi); sprint rejasi realistik | Ba'zi raqamlar taxminiy (masalan «6×18 so'z» — o'lchov 12–20 so'z ko'rsatdi); ba'zi P2 lar aslida P3 |
| **ai-2** (5 fayl) | **O'rtacha-yuqori** | Eng batafsil; har bir vosita alohida ochilgan; `inferSubject`/`SUBJECT_BANK` g'oyasi qimmatli; kuchli tomonlarni ham adolatli sanaydi | **2 ta zararli tavsiya bor** (pastda); P0 deb belgilangan 1 ta muammo aslida o'lik kod; byudjet tahlili noto'g'ri; ba'zi matematik hisoblar xato |
| **ai-3** (DOCX) | **Past (audit sifatida), O'rta (g'oyalar katalogi sifatida)** | KPI/chart/timeline layoutlari, WCAG va 60-30-10 qoidasi, auto-fit g'oyasi — o'rinli | **Faktik xatolar:** «OpenAI/Anthropic wrapperlar» (yo'q — Gemini/xAI), «Redis» (yo'q), «`from-html.ts` — HTML→PPTX adapteri» (yo'q — u viewer uchun HTML→AcademicDoc qayta tiklovchi). Taklif qilgan kodi mavjud tizimdan **orqaga qadam**: `planSlide` yagona manbasini yo'q qiladi, `fontFace: "Arial"` qattiq yozilgan, tema tizimi va i18n yo'q |

### 2.2 Uchalasi kelishgan nuqtalar (= ishonchli, darhol bajariladi)

Bu 6 ta nuqta uchala hisobotda ham bor. Ular haqida bahs yo'q:

1. `shrinkText: true` ishonchsiz — matn yo o'qib bo'lmas darajada kichrayadi, yo qutidan chiqadi.
2. Fallback shablon matni (`content.ts`) umumiy va mavzuga bog'liq emas.
3. Uydirma adabiyotlar ro'yxati — akademik xavf.
4. PDF eksport yo'q, lekin universitetlar so'raydi.
5. Rasm sifati past (Flux schnell, 4 qadam) va premium paketda ham o'zgarmaydi.
6. `lib/generation/` uchun sifat testi yo'q.

### 2.3 Ziddiyatlar va hakamlik

| # | Savol | ai-1 | ai-2 | ai-3 | **Hakamlik va sabab** |
|---|---|---|---|---|---|
| A | Slaydda nechta bullet? | **≤4 ta, har biri ≤12 so'z** | **8 taga oshirilsin, 200 belgi** | Sarlavha ≤40 belgi | **ai-1 haq.** ai-2 tavsiyasi natijani **yomonlashtiradi**. Taqdimot dizaynining butun adabiyoti (Duarte «Slide:ology», Reynolds «Presentation Zen», Tufte) qarama-qarshi yo'nalishni ko'rsatadi: slayd — hujjat emas. Mening o'lchovim: hozirgi bulletlar allaqachon 94–154 belgi (12–20 so'z), ya'ni **allaqachon chegaradan yuqori**. 200 belgiga chiqarish proyektorda o'qib bo'lmaydigan devor yaratadi. |
| B | LLM yiqilganda nima qilinsin? | **FAILED + refund** | Shablon bankini boyitish (`SUBJECT_BANK`) | — | **Ikkalasi ham qisman haq, lekin tartib muhim.** To'g'ri qoida: **LLM kaliti bor → yiqilsa FAILED + refund** (foydalanuvchi pul to'lagan, generic matn olmasligi kerak). **LLM kaliti yo'q (dev/demo) → shablon + UI da «namuna matn» yorlig'i.** ai-2 ning soha banki foydali, lekin u P1 emas, P2 — chunki kalit bor muhitda u umuman ishlamasligi kerak. |
| C | `BUILD_BUDGET_MS = 105s` muammo mi? | Ko'tarilmagan | **P1: 180s ga oshirilsin** | — | **ai-2 xato.** `index.ts:52` — `opts.deadline ?? Date.now() + BUILD_BUDGET_MS`. Worker **doim** o'z deadline'ini uzatadi: `worker.ts:141` — `jobTimeoutMs - 15s` ≈ **285 soniya**. 105s faqat hech qachon ishlatilmaydigan zaxira yo'lda amal qiladi. **Muammo emas (P3: konstantani olib tashlash).** |
| D | `slideAcademicDoc` bo'sh fallback | Ko'tarilmagan | **P0-1** | — | **ai-2 noto'g'ri tasniflagan.** Bu funksiya butun kod bazasida **hech qayerdan chaqirilmaydi** (`grep` bilan tasdiqlandi). O'lik eksport. **P3: o'chirish.** P0 emas. |
| E | `perChapterParas` kichikligi | «Tuzilmaviy yechim kerak» | **10 → 25 ga oshirish** | — | **Yo'nalish to'g'ri, hisob xato.** ai-2 ning «40 bet uchun 11 200 so'z» hisobi 280 so'z/bet me'yoriga asoslangan, u esa shishirilgan. To'g'ri yechim: `WORDS_PER_PAGE` ni **230** ga tushirish + `perChapterParas` ni `targetWords` dan qayta hisoblash + oxirida **hajm darvozasi** qo'yish (pastda C-blok). |
| F | PPTX yondashuvi | Mavjud dvigatelni bosqichma-bosqich tuzatish | Slot va shriftlarni kengaytirish | **`render-pptx.ts` ni noldan qayta yozish (McKinsey 12 layout)** | **ai-3 ni rad etaman.** Loyihaning eng qimmatli arxitektura yutug'i — `planSlide()` **yagona manba**: PPTX ham, saytdagi viewer ham bir xil koordinatalardan chiziladi. Gamma'da preview ≠ export, bu yerda mos. ai-3 ning kodi bu xususiyatni yo'q qiladi, temalarni (15 palitra) tashlaydi, `fontFace: "Arial"` ni qattiq yozadi va i18n ni buzadi. **G'oyalarini oling** (chart, KPI karta, timeline, kontrast qoidasi), **kodini olmang.** |
| G | Rasm slotlari | 6 ta layoutda rasm — ritm to'g'ri, avval sifatni oshiring | **Slotlar juda kam, kengaytirish kerak** | 5 xil rasm joylashuvi | **ai-1 ga yaqinroq, lekin ai-2 ham qisman haq.** Har slaydga rasm — ritmni o'ldiradi va byudjetni yeydi. Lekin `compare`/`twoCol` uchun kichik thumb va `stats` uchun fon rasmi qo'shish o'rinli. **Tartib: avval mavjud 6 slot sifatini oshiring (seed, model, kadrlash), keyin 2 ta yangi slot.** |

### 2.4 Uchala hisobot ham o'tkazib yuborgan narsalar

Quyidagilarni faqat empirik o'lchov ko'rsatdi:

1. **Chiqish hajmi takrorlanmaydi (eng muhim topilma).** Bir xil so'rov 2–4× farqli natija beradi. Pastdagi 3-bo'limga qarang.
2. **Speaker notes PPTX da `notesSlide` sifatida mavjud, lekin ichida faqat slayd raqami bor.** ai-1 «notes yo'q» deb yozgan — bu yarim haqiqat: fayllar yaratiladi, matn yozilmaydi. Bu tuzatishni **bir qatorlik** qiladi (`addNotes`), chunki infratuzilma allaqachon joyida.
3. **Fayl hajmi portlashi:** `slide-img-pitch.pptx` — atigi 2 ta rasm bilan **7.84 MB**. `MAX_FILE_BYTES = 25MB` ga 3 barobar yaqin. 16 slaydli premium paket bu chegarani buzishi mumkin.
4. **`npm audit`: 5 ta high** — `pptxgenjs→image-size` (README da qayd etilgan), lekin **shuningdek** `next→postcss` (4 ta advisory) va `next→sharp` (libvips CVE lari). README da bular yo'q.
5. **18 til taklif qilinadi, 3 tasi qo'llab-quvvatlanadi.** `i18n.ts:18` — 18 ta til; `SECTIONS`/`SLIDE_LABELS` — faqat `uz`, `ru`, `en`. Qolgan 15 tilda (qoraqalpoq, qozoq, tojik, arab, xitoy…) hujjat skeleti — sarlavhalar, «Kirish», «Xulosa», «Adabiyotlar» — o'zbekcha chiqadi. Foydalanuvchi arabcha maqola so'rab, o'zbekcha sarlavhali hujjat oladi.

---

## 3. Empirik o'lchov — haqiqiy chiqish fayllari

`namunalar/` jildidagi 43 DOCX va 12 noyob PPTX ochilib o'lchandi.

### 3.1 Asosiy topilma: hajm barqaror emas

| Vosita | Bir xil/o'xshash so'rov | O'lchangan so'z soni | Tarqoqlik |
|---|---|---|---|
| Insho, «Vatan», 2 varaq | 5 ta namuna | 394 / 616 / 727 / 755 / 858 | **2.2×** |
| Glossariy, «Moliyaviy savodxonlik» | 4 ta namuna | 203 / 371 / 583 / 838 | **4.1×** |
| Kurs ishi, «O'qish ko'nikmasi» | 2 ta namuna | 1 671 / 3 551 | **2.1×** |
| IMRAD tezis, «Kitobxonlik» | 2 ta namuna | 1 349 / 1 600 | 1.2× |
| Texnologik xarita, «Biologiya» | 6 ta namuna | 509 … 589 | 1.16× (barqaror) |
| Rezyume | 5 ta namuna | 23 / 33 / 166 / 174 / 192 | **8.3×** (2 tasi buzilgan) |

**Talqin:** shablon asosidagi vositalar (xarita) barqaror; LLM erkin yozadigan vositalar (insho, glossariy, kurs ishi) — barqaror emas. Sabab: **hech bir joyda «yozilgan matn va'da qilingan hajmga yetdimi?» degan darvoza yo'q.** `write-llm.ts:322` da bitta yumshoq tekshiruv bor (`wordCount < want * 0.55`), lekin u 55% dan yuqori bo'lsa jim o'tadi — ya'ni 20 betlik va'daga 11 bet yozilsa ham `COMPLETED`.

Bu **eng katta P0**: foydalanuvchi 24 000 tanga to'lab, natijaning qanchaligini oldindan bila olmaydi.

### 3.2 Va'da vs natija (230 so'z/bet me'yorida — Times 14, 1.5 interval, 3 sm chap)

| Vosita | Va'da | Kerak (so'z) | O'lchangan | Bajarilish |
|---|---|---:|---:|---|
| Kurs ishi | 15–20 bet | 3 450–4 600 | 3 551 | ⚠️ eng quyi chegara |
| Kurs ishi (2-namuna) | 15 bet | 3 450 | 1 671 | ❌ **48%** |
| Referat | 10–15 bet | 2 300–3 450 | 2 133–2 560 | ⚠️ chegarada |
| Mustaqil ish | 10–15 bet | 2 300–3 450 | 2 411 | ⚠️ chegarada |
| Maqola | 5–10 bet | 1 150–2 300 | 1 757–1 787 | ✅ |
| Tezis | 5–10 bet | 1 150–2 300 | 1 669–1 881 | ✅ |
| Insho | 2 varaq | ~460 | 394–858 | ⚠️ barqaror emas |

**Xulosa:** qisqa hujjatlar va'dani bajaradi, uzunlari — yo'q. Va bu aynan **eng qimmat** vositalar (kurs ishi 12 000–24 000 tanga).

> ⚠️ **Muhim tuzatish:** kod `WORDS_PER_PAGE = 280` dan foydalanadi (`quality.ts:3` **va** `scale.ts:3` — ikkita nusxa). Times New Roman 14, 1.5 interval, A4, 3+1.5 sm hoshiya sharoitida real ko'rsatkich **~230**. Ya'ni kod o'zining hajm hisobida ~22% shishiradi. 280 dan 230 ga o'tish tanqidiy — aks holda barcha darvozalar yolg'on natija beradi.

### 3.3 PPTX o'lchovi

| Ko'rsatkich | O'lchangan | Baho |
|---|---|---|
| Slayd soni (12 namuna) | **7–10 ta**, sifat paketidan qat'i nazar | ❌ paket ishlamaydi |
| `notesSlide` fayllari | 12/12 namunada bor | ✅ infratuzilma joyida |
| Notes ichidagi matn | **faqat slayd raqami** («1», «2», …) | ❌ speaker notes eksport qilinmaydi |
| Eng uzun bullet | 94–154 belgi (≈12–20 so'z) | ⚠️ 6×6 qoidasidan yuqori |
| Rasm soni | 1–9 ta | ⚠️ tarqoq |
| Fayl hajmi | 0.12–**7.84 MB** | ⚠️ 25 MB chegarasiga yaqinlashadi |

Kontent sifati **yomon emas** — masalan `slide__Fotosintez` da bullet: *«Fotosintez — yorug'lik energiyasi hisobiga noorganik moddalardan organik birikmalar sintezlanishidir»* — aniq, mavzuga xos, uydirmasiz. **Muammo matnda emas, va'da va qadoqlashda.**

### 3.4 Generic filler chiqishga tushgan holatlar

Namunalarni `isGenericFiller` naqshlari bo'yicha skanerlash: **3 ta faylda** («texnologik-xarita») shablon iborasi topildi — ya'ni `content.ts` fallback matni **haqiqatan foydalanuvchiga yetib borgan**. Bu nazariy xavf emas, sodir bo'lgan hodisa.

---

## 4. Nima yaxshi — buzmang

Bu ro'yxat qisqartirish uchun emas, **himoya qilish uchun**. Refaktoring paytida shu qarorlar saqlanishi shart:

| # | Yechim | Nega qimmatli |
|---|---|---|
| 1 | **Navbat + worker** (`FOR UPDATE SKIP LOCKED`, `locked_by` tekshiruvi, heartbeat, stale reclaim) | Uzun ish yo'qolmaydi, ikki marta bajarilmaydi, natija ustma-ust yozilmaydi |
| 2 | **Yechish + navbat bitta tranzaksiyada** (`jobs.ts:enqueueGeneration`) | To'lanmagan ish navbatga tushmaydi |
| 3 | **`reference` bo'yicha idempotentlik** | Bitta webhook ikki marta pul qo'shmaydi |
| 4 | **Egalik SQL darajasida** | IDOR strukturaviy jihatdan mumkin emas |
| 5 | **`planSlide()` — yagona layout manbai** | Preview = eksport. Gamma bunga erisha olmagan. **ai-3 shuni buzishni taklif qiladi — rad eting** |
| 6 | **`json.ts` — kesilgan JSON ni tiklash** | LLM javoblari muntazam kesiladi; bu modul mahsulotni tik ushlab turadi |
| 7 | **`languageDirective()`** | Tizim prompti o'zbekcha bo'lsa ham chiqish tili majburlanadi — nozik va to'g'ri yechim |
| 8 | **Promptlardagi taqiqlar** («kompetensiya, UNESCO, dvigatel aralashmasin; uydirma DOI/GOST yo'q») | Bu promptlar juda yaxshi yozilgan; ai-2 ham shuni tasdiqlaydi |
| 9 | **15 original palitra + 20 narrative shablon** | Nusxa emas, o'z tizimi. ai-3 ni tinglab bularni tashlash — yo'qotish |
| 10 | **Xavfsizlik madaniyati** (CSRF, SSRF, zip-bomb, rate limit, hash'langan OTP) | MVP darajasida kamdan-kam uchraydi |

---

## 5. Tasdiqlangan nuqson reyestri

Har bir band **men shaxsan tasdiqlaganman** (kod o'qildi yoki chiqish fayli o'lchandi). Manba: qaysi AI ko'targan.

### P0 — foydalanuvchi pul to'lab yomon narsa oladi

| ID | Nuqson | Joy | Dalil | Manba |
|---|---|---|---|---|
| **P0-1** | **Sifat paketi slayd soniga ta'sir qilmaydi.** `want = tpl.beats.length \|\| targetPages` — 20 shablonning hammasida `beats` 6–10 ta, `auto` ham real shablonga aylanadi. Demak `targetPages` (10/12/14/16) **hech qachon** ishlatilmaydi | `slide-write.ts:229`, `slide-templates.ts:401`, `meta.ts:37` | 12/12 namunada 7–10 slayd. Premium uzun (8 000) = Standart (3 000) | ai-1 |
| **P0-2** | **Chiqish hajmi kafolatlanmagan.** Bir xil so'rov 2–4× farqli hajm beradi; `COMPLETED` dan oldin «va'da bajarildimi» darvozasi yo'q | `write-llm.ts:322` (0.55 yumshoq chegara), `index.ts` | O'lchov: insho 2.2×, glossariy 4.1×, kurs ishi 2.1× | **yangi** |
| **P0-3** | **LLM yiqilsa generic shablon `COMPLETED` bo'ladi, pul qaytmaydi** | `index.ts:71` — `llmDoc ?? buildAcademicDoc(...)` | 3 ta namunada shablon iborasi topildi | ai-1, ai-2 |
| **P0-4** | **Uydirma adabiyotlar.** LLM 4 tadan kam bersa — qattiq yozilgan 4 ta soxta manba; `content.ts:refs()` — 6 ta soxta manba | `write-llm.ts:330`, `content.ts:24` | Kod o'qildi | ai-1, ai-2 |
| **P0-5** | **Speaker notes PPTX ga yozilmaydi.** `slideNotes()` mavjud, `addNotes` chaqirilmaydi | `render-pptx.ts` (chaqiruv yo'q), `slide-layout.ts:95` | 12/12 PPTX da `notesSlide` bor, ichida faqat raqam | ai-1 (qisman) |
| **P0-6** | **`titleSlide` checkbox o'qilmaydi.** Forma yuboradi, `sanitizeValues` o'tkazadi, `extractMeta` e'tiborsiz qoldiradi | `SlideForm.tsx:30,160` → `meta.ts` | Kod o'qildi | ai-1 |
| **P0-7** | **Kurs ishi = referat, narxi 4×.** Bitta `writeWriterWithLlm`; majburiy 3 bob, tadqiqot savoli, TASDIQLAYMAN, jadval — yo'q | `write-llm.ts:412` (`WRITER` set) | Kod + namuna solishtiruvi | ai-1, ai-2 |
| **P0-8** | **Sifat nazorati yo'q.** `eval-services.mjs` `POST /api/generate` ga murojaat qiladi — bunday endpoint **yo'q** (`/api/generations`). 49 test ichida `lib/generation/` ni tekshiradigani **0 ta** | `scripts/eval-services.mjs:301` | `grep` + test ro'yxati | ai-1 |

### P1 — sifat va to'g'rilik

| ID | Nuqson | Joy | Manba |
|---|---|---|---|
| P1-1 | `WORDS_PER_PAGE = 280` shishirilgan **va ikki joyda dublikat** | `quality.ts:3`, `scale.ts:3` | ai-1 |
| P1-2 | `scaleDoc` 5 ta universal «angle» qo'shadi — mavzuga bog'liq emas | `scale.ts:24` | ai-1, ai-2 |
| P1-3 | Layout majburan qayta yoziladi → LLM kontenti yo'qoladi (`quote` yozdi, `stats` qo'yildi → bo'sh slayd) | `slide-write.ts:243` | ai-1 |
| P1-4 | Boblar parallel yoziladi, bir-birini ko'rmaydi → takror va ziddiyat | `write-llm.ts:263` (`mapPool(jobs, 3)`) | ai-1, ai-2 |
| P1-5 | Ostmavzu matematik kesiladi (`mid = ceil(len/subs)`), mantiqiy emas | `write-llm.ts:276` | ai-1 |
| P1-6 | Akademik hujjatlarga sahifa ramkasi qo'yiladi (GOST talab qilmaydi) | `render-docx.ts:283,307` | ai-1, ai-2 |
| P1-7 | Mundarija sahifa raqamlari taxminiy — yolg'on ma'lumot | `render-docx.ts:124` | ai-1 |
| P1-8 | IMRAD annotatsiyasi doim `uz` kalitidan o'qiladi | `write-specials.ts` (`key: "uz"`) | ai-1 |
| P1-9 | Gemini `thinkingConfig: { thinkingBudget: 0 }` — akademik yozuvda zarar | `llm.ts:66` | ai-1 |
| P1-10 | xAI da JSON rejimi yo'q (`response_format` yuborilmaydi) — Gemini o'chsa slayd/dars/xarita yiqiladi | `llm.ts:105` | ai-1 |
| P1-11 | **18 til taklif qilinadi, 3 tasida hujjat skeleti bor** | `i18n.ts:18` vs `SECTIONS`/`SLIDE_LABELS` | **yangi** |
| P1-12 | `MAX_IMAGES = 8`, lekin premium_long 16 slayd | `slide-images.ts:13` | ai-2 |
| P1-13 | Flux schnell 4 qadam premium paketda ham o'zgarmaydi; `seed` yo'q → 8 xil uslub | `slide-images.ts:54` | ai-1, ai-2 |
| P1-14 | `persistImage` yiqilsa muddati o'tuvchi fal URL bazada qoladi → ertaga 404 | `slide-images.ts:141` | ai-1 |
| P1-15 | `slide-layout.ts` da o'zbekcha matn qattiq yozilgan («Taqdimot», «Savollar va muhokama») → ruscha taqdimot aralash chiqadi | `slide-layout.ts:179,434` | ai-1 |
| P1-16 | Tema `chrome: "split"` alohida chizilmaydi — `bar-left` ga tushadi (tema maydoni yolg'on) | `slide-layout.ts:131` | ai-1 |
| P1-17 | `magazine` title layout da `subtitle` umuman chizilmaydi | `slide-layout.ts:176` | ai-1 |
| P1-18 | `includeVisuals` («Jadval va rasmlar: Ha») DOCX ga rasm qo'ymaydi — faqat 1 jadval | `write-llm.ts:296` | ai-1 |
| P1-19 | Rezyumeda LLM yangi ish joyi/yil uydirishi tekshirilmaydi | `write-specials.ts:writeResumeWithLlm` | ai-1, ai-2 |
| P1-20 | Tarjimada jadval, ro'yxat, sarlavha darajasi yo'qoladi | `write-specials.ts:writeTranslationWithLlm` | ai-1, ai-2 |
| P1-21 | `SOURCE_TEXT_LIMIT = 24 000` vs `MAX_SOURCE = 60 000` — ikki xil chegara | `meta.ts:29`, `validate.ts:15` | ai-1 |
| P1-22 | Texnologik xaritada qator yetmasa tsikl bilan **takrorlanadi** | `write-specials.ts:writeMapWithLlm` | ai-1, ai-2 |

### P2 — dizayn va UX

| ID | Nuqson | Manba |
|---|---|---|
| P2-1 | `shrinkText: true` — preview kichraytirmaydi, PPTX kichraytiradi → **preview ≠ eksport** (yagona buzilgan nuqta) | uchalasi |
| P2-2 | `stats` layout diagramma emas, matn kartasi. `pptx.addChart` ishlatilmaydi | ai-1, ai-3 |
| P2-3 | `process` layoutda strelka/konnektor yo'q — «kartalar qatori», jarayon emas | ai-1 |
| P2-4 | Agenda 6 band × 0.76" — o'zbekcha 2 qatorli bandlar footer ustiga chiqadi | ai-1 |
| P2-5 | Master slide / theme XML yo'q — PowerPoint da «Dizayn» ishlamaydi, rangni 15 slaydda qo'lda o'zgartirish kerak | ai-1, ai-3 |
| P2-6 | Jadval layouti yo'q (`pptx.addTable`) | ai-1, ai-3 |
| P2-7 | 4:3 nisbat yo'q (maktab proyektorlari) | ai-1, ai-2 |
| P2-8 | Font `Calibri` qattiq yozilgan, tema `font` maydoniga ega emas | ai-2, ai-3 |
| P2-9 | Tema kontrasti WCAG bo'yicha tekshirilmagan (`sakura`, `grove` chegaraviy) | ai-1, ai-3 |
| P2-10 | Titul sahifa OTME standartidan uzoq: gerb, TASDIQLAYMAN, imzo qatori yo'q | ai-1 |
| P2-11 | `course` / `group` alohida forma maydoni yo'q — `author` satriga tiqilgan | ai-1 |
| P2-12 | Progress bar 95% da qotadi (asimptotik) — texnik to'g'ri, psixologik yomon | ai-2 |
| P2-13 | Fayl hajmi 7.84 MB gacha chiqadi (25 MB chegara, BYTEA) | **yangi** |

### P3 — qarz

`enrich.ts` o'lik kod · `slideAcademicDoc` o'lik eksport · `BUILD_BUDGET_MS` o'lik konstanta · `legacyFromSections` faqat `bullets` · konsol loglar strukturalanmagan · CSP `unsafe-inline` · **npm audit 5 ta high** (`pptxgenjs→image-size`, `next→postcss` ×4, `next→sharp`) · brend `sodda.ai` (huquqiy) · OTP yetkazuvchi yo'q · interfeys i18n yo'q · S3 ga ko'chish · formula/OMML yo'q · Sentry yo'q.

---

## 6. Sifat doktrinasi — dvigatelga yoziladigan qonun

Tuzatishlarni birma-bir qilish yetarli emas: **qoida kerak**, aks holda keyingi PR yana buzadi. Quyidagi ikki blokni `lib/generation/rules.ts` sifatida kodga kiriting va prompt ham, renderer ham, eval ham shundan foydalansin.

### 6.1 SLIDE LAW — taqdimot qonuni

Me'yor: foydalanuvchi PPTX ni **proyektorda 3–8 metrdan** ko'radi.

```
 1. Bir slayd — bir g'oya. Sarlavha to'liq gap, 6–10 so'z.
 2. Bullet ≤ 4 ta, har biri ≤ 12 so'z (agenda ≤ 5).
 3. Matn ≥ 18 pt (maktab auditoriyasi ≥ 22 pt). shrinkText TAQIQLANADI —
    o'rniga oldindan sig'dirish (pre-fit) va kesish.
 4. Kontrast ≥ 4.5:1 (WCAG AA). Har tema uchun avtomatik test.
 5. 3+ raqam bo'lsa — stats emas, chart (pptx.addChart).
 6. 3+ bosqich bo'lsa — process + konnektor strelka. Maks 4 ustun, 5+ → 2 qator.
 7. Rasm mavzuning o'zi. Butun deck bo'ylab bitta seed → bitta uslub.
 8. Har slaydda speaker notes: 40–80 so'z, og'zaki, bulletni takrorlamaydi.
 9. Kicker 2–4 so'z, uppercase YO'Q (o'zbek «O'», «G'» buziladi).
10. Closing da savol yoki keyingi qadam, yolg'iz «Rahmat» emas.
11. Interfeys matnlari hech qachon qattiq yozilmaydi — slideLabels(lang) orqali.
```

**Nima uchun ai-2 ning «8 bullet, 200 belgi» tavsiyasini rad etaman:** slayd — o'qish uchun emas, **ko'rish** uchun. 8×200 belgi = 1 600 belgilik devor; auditoriya uni o'qiy boshlaydi va notiqni tinglashni to'xtatadi. Agar foydalanuvchiga ko'p matn kerak bo'lsa — u speaker notes ga tushishi kerak, slaydga emas. Bu aynan `addNotes` ni yoqish bir vaqtning o'zida ikki muammoni yechishi sababidir.

### 6.2 DOCUMENT LAW — hujjat qonuni

Me'yor: talaba hujjatni **chop etib rahbariga beradi**.

```
1. WORDS_PER_PAGE = 230 (bitta konstanta, ikkita nusxa emas).
2. HAJM DARVOZASI: wordCount < targetWords * 0.80 bo'lsa —
   avval yetishmayotgan bo'limni QAYTA yozish, keyin ham yetmasa FAILED + refund.
   Generic to'ldirgich bilan to'ldirish TAQIQLANADI.
3. LLM kaliti bor + LLM yiqildi = FAILED + refund. Shablon ishlatilmaydi.
   LLM kaliti yo'q = shablon + UI da «NAMUNA MATN» yorlig'i.
4. Uydirma manba TAQIQLANADI. LLM 4 tadan kam bersa —
   «Adabiyotlar ro'yxatini rahbaringiz bilan aniqlashtiring» + 5 ta qidiruv so'rovi.
   Aniq familiya, DOI, ISSN, jurnal tomi — hech qachon.
5. Sahifa ramkasi FAQAT insho uchun. Akademik ishlarda ramkasiz.
6. Mundarijada taxminiy sahifa raqami TAQIQLANADI:
   yo Word TOC field, yo raqamsiz ro'yxat.
7. Kurs ishi ≠ referat: majburiy 3 bob, tadqiqot savoli, obyekt/predmet,
   ≥1 jadval, ≥8 manba, TASDIQLAYMAN bloki.
8. Sarlavhalar tanlangan tilda. Til qo'llab-quvvatlanmasa —
   forma ro'yxatida ko'rsatilmaydi (18 emas, 3 til).
9. Har generatsiya oxirida metrik loglanadi:
   {toolId, targetWords, actualWords, ratio, llmCalls, failedSections}.
```

---

## 7. Yo'l xaritasi

Jamoa: 1–2 kishi. Har sprint oxirida **5 ta real fayl qo'lda baholanadi**.

### Sprint 0 — «Rostgo'ylik» (3–4 kun) 🔴 ochilishdan oldin majburiy

Maqsad: yolg'on va'da va to'lanган filler yo'qolsin.

| # | Ish | Fayl | Nuqson |
|---|---|---|---|
| 1 | Sifat paketi → haqiqiy slayd soni (`expandBeats`) + UI da «N slayd» yozuvi | `slide-write.ts`, `slide-templates.ts`, `SlideForm.tsx` | P0-1 |
| 2 | `addNotes()` — PPTX ga speaker notes; LLM promptiga `notes` maydoni | `render-pptx.ts`, `slide-write.ts` | P0-5 |
| 3 | `titleSlide` → `DocMeta` va unshift sharti | `meta.ts`, `slide-write.ts` | P0-6 |
| 4 | LLM kaliti bor + natija yo'q → `throw` (shablon emas) | `index.ts` | P0-3 |
| 5 | Hajm darvozasi: `< 0.80 * targetWords` → qayta yozish → FAILED+refund | `index.ts`, `write-llm.ts` | P0-2 |
| 6 | `WORDS_PER_PAGE = 230`, bitta konstanta | `quality.ts`, `scale.ts` | P1-1 |
| 7 | Uydirma adabiyot fallbackini o'chirish | `write-llm.ts`, `content.ts` | P0-4 |
| 8 | Sahifa ramkasi faqat inshoda | `render-docx.ts` | P1-6 |
| 9 | TOC sahifa raqamlarini olib tashlash (yoki Word TOC field) | `render-docx.ts` | P1-7 |
| 10 | `eval-services.mjs` → `POST /api/generations` + polling | `scripts/eval-services.mjs` | P0-8 |
| 11 | Forma til ro'yxatini `uz/ru/en` bilan cheklash | `lib/languages.ts`, `i18n.ts` | P1-11 |

**Tayyorlik mezoni:** `premium_long` ≥ 16 slayd · notes PowerPoint da ochiladi · kalit bor holatda filler `COMPLETED` bo'lmaydi · eval yashil.

### Sprint 1 — «Slayd vizuali» (1 hafta)

`coerceLayout` (overwrite o'rniga konvertatsiya) · `MAX_BULLETS = 4` + `shrinkText: false` + pre-fit · process konnektor va maks 4 ustun · agenda maks 5 / 2 ustun · `magazine` subtitle · `chrome: "split"` haqiqiy · dark tema uchun dim moslash · rasm `seed` + premium modeli + `persistImage` yiqilsa URL saqlamaslik · `slide-layout.ts` i18n · `inferSlideTemplate` regexini toraytirish · `stats` → `addChart` (3+ parse bo'ladigan raqam) · tema kontrast testi.

**Tayyorlik mezoni:** 5 mavzu proyektorda «chiqaraman» deyiladi. Preview = PPTX.

### Sprint 2 — «Akademik yozuv» (1 hafta)

Boblarni ketma-ket yoki 2 bosqichli (qoralama → muharrir) yozish · ostmavzuni alohida `writeSection` · kurs ishi uchun alohida pipeline (3 bob, tadqiqot savoli, jadval, 8 manba) · titul: universitet majburiy, `course`/`group` parse, imzo qatori · IMRAD annotatsiya kaliti = til · standart maqolaga annotatsiya · rezyume fakt filtri · glossariy/keys/xarita fallbacki `COMPLETED` bo'lmasin · xaritada takror mavzu → FAILED · dars daqiqalari normalizatsiyasi · `includeVisuals` ni haqiqiy qilish yoki checkbox matnini o'zgartirish.

**Tayyorlik mezoni:** kurs ishi tuzilmasi referatdan farq qiladi (eval bilan) · 12 betlik referat ≥ 2 300 so'z · uydirma DOI = 0.

### Sprint 3 — «Slayd mahsuloti» (1 hafta)

Outline bosqichi (arzon `stage=outline` job → foydalanuvchi tahrirlaydi → to'liq render) · `audience: defense | lecture | school | pitch` (shrift, slayd soni, rasm uslubi shundan) · jadval layouti · 4:3 nisbat · deck JSON ni 2 chaqiruvga bo'lish (kesilish kamayadi) · presenter view.

### Sprint 4 — «Fayl va eksport» (1 hafta)

PDF (Gotenberg yoki `libreoffice --headless`) · `defineSlideMaster` + ixtiyoriy logo/gerb · Word TOC field · `thinkingBudget` kurs ishi uchun 1024 · xAI `response_format: json_object` · rasmlarni asset jadvaliga to'liq chiqarish (BYTEA yengillashadi).

### Sprint 5 — «Ochilish qarzlari»

Brend/logo/domen (huquqiy — birinchi) · OTP yetkazish · Click/Payme kalitlari · `npm audit` 5 ta high ni yopish · Sentry · `enrich.ts` va o'lik eksportlarni o'chirish · S3.

> **Qoida:** Sprint 0–2 yopilmasdan pullik ochilish bo'lmasin. Aks holda birinchi 100 foydalanuvchining bir qismi generic matn oladi va bu qaytarib bo'lmaydigan obro' zarari.

---

## 8. Sifat darvozasi — bu safar haqiqiy eval

Hozirgi `eval-services.mjs` **ishlamaydi** (mavjud bo'lmagan endpoint). Uni tiklash va kengaytirish Sprint 0 ning eng qimmatli bandi, chunki qolgan hamma narsani u himoya qiladi.

**Arxitektura:** `POST /api/generations` → `id` → 300 s davomida `GET /api/generations/{id}` polling → fayl yuklab olish → o'lchash.

**Hujjat metrikalari:**

| Metrika | Chegara |
|---|---|
| `actualWords / targetWords` | ≥ 0.80 |
| Generic filler naqshlari | 0 |
| Kutilgan bo'limlar (`Kirish`, `Xulosa`, boblar) | 100% |
| Uydirma manba belgilari (DOI, ISSN, jurnal tomi) | 0 |
| Kurs ishi: bob soni | ≥ 3 |
| Kurs ishi: jadval | ≥ 1 |
| Mavzu-soha mosligi (taqiqlangan soha so'zlari) | 0 |

**Taqdimot metrikalari:**

| Metrika | Chegara |
|---|---|
| Slayd soni | paketga mos (10/12/14/16) |
| Birinchi slayd `title`, oxirgisi `closing` | ha |
| Noyob sarlavhalar | ≥ 80% |
| O'rtacha bullet/slayd | ≤ 4.5 |
| O'rtacha bullet so'z soni | ≤ 14 |
| Speaker notes bor slaydlar | ≥ 70% |
| Layout xilma-xilligi | ≥ 4 tur |
| Rasm (FAL_KEY bor) | ≥ 3 |
| Fayl hajmi | ≤ 15 MB |

**Doimiy test to'plami (5 mavzu, har release da):**
fotosintez (biologiya) · Alisher Navoiy (adabiyot) · ichki yonuv dvigateli vs elektromobil (texnika) · maktabda bulling (ijtimoiy) · startap pitch (biznes).

Nima uchun aynan shu 5 tasi: ular promptdagi «soha aralashmasin» taqiqini har tomondan sinaydi.

**Inson darvozasi (har juma, 3 kishi):**

| Fayl | Savol | O'tish |
|---|---|---|
| Slayd | Proyektorga chiqaramanmi? | ≥ 4/5 ha |
| Referat | Rahbarga beramanmi (qayta ishlab)? | ≥ 4/5 |
| Kurs ishi | Referatdan farq qiladimi? | ha |
| Dars rejasi | Ertaga shu bilan sinfga kiramanmi? | ≥ 3/5 |
| Rezyume | Shu CV ni yuboramanmi? | ≥ 3/5 |

Ikki hafta ketma-ket o'tmasa — **yangi vosita qo'shilmaydi**.

---

## 9. Qilmaslik kerak

| Qilmang | Nega |
|---|---|
| `render-pptx.ts` ni noldan qayta yozish (ai-3 tavsiyasi) | `planSlide()` yagona manbai yo'qoladi — preview ≠ eksport bo'ladi. Bu loyihaning eng kuchli tomoni |
| Bullet sonini/uzunligini oshirish (ai-2 tavsiyasi) | Taqdimot sifatini bevosita pasaytiradi. Ko'p matn → speaker notes ga |
| 12 yoki 101 ta yangi layout qo'shish | 10 ta yaxshi layout + 3 yangisi (`table`, `chart`, `bigNumber`) yetadi. Xilma-xillik emas, **sifat** yetishmayapti |
| Shablon bankini (`SUBJECT_BANK`) P0 sifatida qurish | Katta ish, lekin kalit bor muhitda umuman ishlamasligi kerak. P2 |
| Byudjetni 180s ga oshirish | Muammo yo'q — worker allaqachon 285s beradi |
| Animatsiya, morph, SmartArt | Proyektor va PDF da o'ladi, vaqt ketadi |
| Interfeys i18n ni hozir | Avval hujjat i18n si (3 til) to'g'ri ishlasin |
| Sprint 0–2 dan oldin pullik ochilish | Filler skandali qaytarib bo'lmaydi |

---

## 10. Birinchi kun — aniq commitlar

Sprint 0 ni shu 8 commit tashkil qiladi. Har biri mustaqil va qaytariladigan:

```
fix(slide): sifat paketini haqiqiy slayd soniga bog'lash
fix(slide): speaker notes ni PPTX ga yozish (addNotes)
fix(slide): titleSlide bayrog'ini hurmat qilish
fix(gen): LLM kaliti bor holatda shablonga tushmaslik — FAILED + refund
feat(gen): hajm darvozasi — targetWords ning 80% i majburiy
fix(gen): WORDS_PER_PAGE = 230, bitta konstanta
fix(docx): uydirma adabiyot o'rniga qidiruv ro'yxati; ramka faqat inshoda
fix(eval): /api/generations + polling; hujjat va slayd metrikalari
```

---

## 11. Ilova — mas'uliyat xaritasi

| Qism | Asosiy fayllar | Sprint |
|---|---|---|
| Slayd dvigateli | `slide-write.ts`, `slide-templates.ts`, `slide-layout.ts`, `render-pptx.ts` | 0, 1, 3 |
| Slayd UI | `SlideForm.tsx`, `SlideViewer.tsx`, `SlideCanvas.tsx` | 0, 3 |
| Akademik yozuv | `write-llm.ts`, `prompts.ts`, `quality.ts`, `scale.ts` | 0, 2 |
| Maxsus vositalar | `write-specials.ts` | 2 |
| DOCX render | `render-docx.ts` | 0, 2, 4 |
| Meta va narx | `meta.ts`, `tools.ts` | 0 |
| Xato/refund | `index.ts`, `worker.ts` | 0 |
| Sifat nazorati | `scripts/eval-services.mjs`, `tests/` | 0 (doimiy) |
| Rasm | `slide-images.ts`, `slide-image-prompts.ts`, `image-studio.ts` | 1 |
| i18n | `i18n.ts`, `languages.ts` | 0, 2 |

---

## 12. Yakuniy so'z

Loyihaning muammosi **texnik emas, dissiplinar**. Kod yaxshi yozilgan, arxitektura to'g'ri, xavfsizlik kuchli. Yetishmayotgani — **chiqishni o'lchaydigan va va'daga bog'laydigan mexanizm**. Hozir tizim «bir narsa chiqardi → COMPLETED» mantiqida ishlaydi. Kerak: «va'da qilingan narsa chiqdimi? → COMPLETED, aks holda FAILED + refund».

Shu bitta o'zgarish (Sprint 0, 5-band) qolgan barcha sifat ishlarini **himoya qiladi**: chunki keyin har qanday regressiya darhol FAILED ko'rinishida chiqadi va e'tiborsiz qolmaydi.

Uchala AI hisobotidan olingan eng qimmatli xulosa esa shu: **ai-1 ni asos qilib oling, ai-2 dan detallarni oling, ai-3 dan faqat g'oyalarni oling** — va uning taklif qilgan kodini ishlatmang.


---

## 13. Sprint 4 — hujjat tuzilmasi (bajarildi)

### 13.1. Word mundarija maydoni + raqamlash nuqsoni

Reja bandi «Word TOC field» edi. Uni bajarish jarayonida **rejadan tashqari, kattaroq nuqson** topildi.

**Nima qilindi va nima uchun aynan shunday:**

1. *Sof `TableOfContents` maydoni* qo'yib ko'rildi → LibreOffice uni to'ldirmaydi, ya'ni **PDF eksportida mundarija butunlay bo'sh** chiqdi. PDF bizda birinchi darajali chiqish — bu regressiya, qabul qilinmadi.
2. *`cachedEntries`* varianti sinaldi → matn ko'rindi, lekin ikki kamchilik bilan: `TOC1/TOC2` uslublari hujjatda yo'qligi sababli **ichki daraja surilmadi**, va sahifa raqami bo'lmagani uchun nuqtali yo'lakcha **hech qayerga olib bormasdi**.
3. Yakuniy yechim — **maydon + o'z paragraflarimiz** (`contentChildren`): tarkib hamma joyda ko'rinadi, Word esa hujjat ochilganda maydonni yangilab, haqiqiy sahifa raqamlarini o'zi qo'yadi. Sahifa raqami atayin yozilmaydi: uni bu bosqichda faqat taxmin qilish mumkin, noto'g'ri raqam esa raqamsizdan yomonroq.

**Yo'l-yo'lakay topilgan nuqson (undan ham muhimroq).** PDF'da ko'rinib qoldi: bob sarlavhasi **raqamsiz** chiqardi («ICHKI YONUV DVIGATELLARIDA…»), ostidagi ostmavzu esa «1.1.» edi — ya'ni «1» hech nimaga ishora qilmasdi. Sabab: raqamni **model** yozardi. Shablon yo'li (`content.ts`) allaqachon to'g'ri edi («I BOB.» + «1.1.»), LLM yo'li esa emas.

Yechim: raqam **qurilish yo'li bilan** qo'yiladi (`numberOutline`), modeldan kelgan har qanday raqam esa `stripHeadingNumber` bilan olib tashlanadi. Qolip ehtiyotkor: «IT sohasida», «3D modellashtirish», «COVID-19» kabi sarlavhalar buzilmaydi — bu holatlar testga bog'langan.

**Ko'rinish ≠ fayl.** Viewer mundarijani mustaqil qurardi: faqat boblarni ko'rsatardi va ustiga o'zi «1.», «2.» qo'shardi. Endi ikkala tomon `tocRows()` dan foydalanadi — slaydlardagi `planSlide` bilan bir xil yondashuv.

### 13.2. Uzun deka bitta chaqiruvga sig'masligi

16 slaydli deka javobi token chegarasiga urilib, **JSON o'rtasida kesilardi** — kesilgan JSON parse bo'lmaydi, ya'ni oxirgi slaydlar emas, **butun deka** yo'qolardi.

Reja bo'laklarga bo'linadi (8 tadan). Dastlab bo'laklar **parallel** so'raldi: 16 slayd 33 soniyada tayyor bo'ldi, lekin sinovda 2- va 11-slayd deyarli bir xil chiqdi — bo'laklar bir-birining nima yozganini bilmasdi. Shuning uchun ular **ketma-ket** qilindi va keyingisiga oldingilarning sarlavhalari uzatiladi. Narxi 8 soniya (33 → 41,6 s), natijasi — takror yo'q.

Natija absolyut o'rin bo'yicha yig'iladi: oddiy birlashtirishda bir bo'lak bitta ortiq slayd qaytarsa, undan keyingi hamma slayd siljib, `coerceLayout` ularga boshqa rejadagi layoutni majburlab qo'yardi.

### 13.3. Taqdimotchi rejimi

Taqdimot ilgari faqat `fixed inset-0` qoplama edi — proyektorda brauzer manzil satri ko'rinib turardi. Endi **haqiqiy Fullscreen API** ishlatiladi (rad etilsa eski qoplama ishlaydi), va `P` tugmasi **taqdimotchi panelini** ochadi: o'tgan vaqt (to'xtatish/noldan), keyingi slayd eskizi va kattalashtirilgan eslatma.

### 13.4. Jadval sarlavhasi

Sarlavha qat'iy 28 belgiga qirqilardi: 3 ustunli jadvalda «Quyosh fotoelektr stansiyalari» (30 belgi) «…» bilan tugardi, holbuki ustun to'liq matnni ko'tarardi. Endi chegara ustunlar soniga bog'liq (≤3 ustun — 40 belgi), `planTable` esa shriftni baribir o'zi moslaydi.

### 13.5. Tekshiruv

Barchasi **haqiqiy fayl** ustida tasdiqlandi: DOCX yaratildi → LibreOffice orqali PDF → sahifalar rasmga o'girilib **ko'z bilan** ko'rildi. Deka Gemini API orqali jonli yaratildi. `npm run check`: 109 test, 0 xato. Prod build o'tadi.

Taqdimotchi rejimi — yagona istisno: muhitda brauzer avtomatlashtiruvi yo'q, shuning uchun u tip tekshiruvi, lint va prod build bilan tasdiqlandi, ekran surati bilan emas.


---

## 14. Boshqa hisobotlarni qayta ko'rish — rejaga tushmagan nuqsonlar

Reja `ai-1` ning xizmat checklisti va `ai-2` ning xatolar ro'yxati bo'yicha qayta solishtirildi. To'rtta haqiqiy nuqson topildi — hammasi koddan tasdiqlandi, keyin tuzatildi.

### 14.1. Tarjimada tuzilma yo'qolardi

Tizim prompti «sarlavha, ro'yxat va paragraf chegaralarini saqlang» deb turardi, JSON sxemasi esa faqat `paragraphs: string[]` berardi — ya'ni model tuzilmani **ifodalay olmasdi**, va chiqishda hamma narsa `kind: "p"` ga tekislanardi. Prompt bajarib bo'lmaydigan va'da berardi.

Sxema `blocks: [{kind, text}]` ga o'zgartirildi. Eski shakl va umuman JSON bo'lmagan javob ham qabul qilinadi. Jonli sinovda ingliz matnidagi ikkita sarlavha `h2`, uchta ro'yxat bandi `li` bo'lib saqlandi.

Yo'l-yo'lakay: model hujjat sarlavhasini `title` da ham, birinchi `h2` da ham qaytarardi — natijada bir xil matn ketma-ket ikki marta chiqardi. Endi takrorlanuvchi birinchi sarlavha tashlanadi.

### 14.2. Glossariyda alifbo tartibi yo'q edi

Atamalar model qaytargan tartibda, ya'ni tasodifiy chiqardi. Saralash `terms` ustida bir marta bajariladi — matn qismi ham, jadval ham shu ro'yxatdan quriladi, demak ikkalasi doim mos. Taqqoslash hujjat tilida (`Intl.Collator`): kirill va lotin uchun tartib boshqacha. Boshidagi qo'shtirnoq hisobga olinmaydi.

### 14.3. Keysda baholash rubrikasi yo'q edi

Vosita faqat «namunaviy kalit» — ya'ni to'g'ri javobni berardi. O'qituvchiga esa javobning o'zi emas, uni **qanday baholash** kerakligi kerak. Endi har keys 3–4 ta keysga xos mezon oladi, ballar yig'indisi 10. Yarim rubrika (mezoni bor, balli yo'q) umuman chiqmaydi — u yo'qdan yomonroq.

### 14.4. Sarlavhada brend ikki marta

`app/layout.tsx` `template: "%s — Sodda.ai"` qo'yardi, sahifa esa **yana bir marta** qo'shardi: «Slayd — Sodda.ai — Sodda.ai». Prod serverdan `curl` bilan ko'rindi.

---

## 15. Slayd shrifti — Calibri'dan Arial'ga

Muammo `ai-2` P2-2 da qayd etilgan edi va `CHAR_EM` izohi uni allaqachon tan olgan: Calibri faqat Windows'da bor, boshqa joyda almashtiriladi va almashtiruv **metrik mos emas** (bu mashinada `fc-match Calibri` → Noto Sans, ~10% kengroq).

Uch nomzod o'lchandi:

| Shrift | Windows | macOS | Linux | O'zbek `ʻ` (U+02BB) |
|---|---|---|---|---|
| Calibri | ✓ | ✗ | ✗ → Noto Sans (metrikasi boshqa) | — |
| Open Sans | ✗ | ✗ | ✓ | ⛔ **umuman yo'q** |
| Noto Sans | ✗ | ✗ | ✓ | ✓ |
| **Arial** | ✓ | ✓ | ✓ → Liberation Sans (**metrik mos**, OFL) | ✓ |

**Open Sans rad etildi** aniq dalil bilan: unda U+02BB yo'q, ya'ni «oʻ» va «gʻ» buziladi — o'zbek taqdimoti uchun yaroqsiz. **Noto Sans rad etildi**, chunki u Windows va macOS'da yo'q: muammoni Linux'dan Windows'ga ko'chirardi, foydalanuvchilarimizning ko'pchiligi esa aynan Windows'da.

**Arial tanlandi.** Uchala platformada ham hal bo'ladi va Linux'dagi almashtiruvi metrik mos, ya'ni joylashuv hamma joyda bir xil. `CHAR_EM = 0.55` o'zgarishsiz qoldi: Arial/Liberation ~0.52, farq esa xavfsizlik zaxirasi bo'lib qoladi.

**Shrift joylashtirish (embedding) bandi shu bilan yopiladi.** U kerak emas bo'lib qoldi: joylashtirishning maqsadi platformalararo bir xillik edi, Arial buni joylashtirmasdan beradi. Qo'shimcha sabab — joylashtirishni bu muhitda **tekshirib bo'lmaydi**: PowerPoint qabul qiladimi-yo'qmi sinash uchun PowerPoint kerak, noto'g'ri EOT esa faylni umuman ochilmaydigan qiladi. Kelajakda kerak bo'lsa, Liberation Sans joylashtiriladi — u OFL va Arial bilan metrik bir xil.

---

## 16. 4:3 nisbat — rejadan olib tashlandi

4:3 bu 10×7,5 dyuym: balandlik 16:9 bilan **bir xil**, kenglik 25% kam. `slide-layout.ts` da kenglikka bog'liq **45 ta** raqam bor.

Ikki yo'l o'lchandi:

1. **Masshtablash** — shrift 18pt dan 13,5pt ga tushadi, bu §6.1 dagi «tana matni ≥18pt» qoidasini buzadi. Ya'ni format qo'shib, sifatni pasaytirgan bo'lardik.
2. **Har layoutni qayta joylashtirish** — 11 ta layout uchun alohida dizayn (rasm o'ngda emas, tepada). Bu haqiqiy yechim, lekin katta ish.

**Qaror: 4:3 qurilmaydi.** Zamonaviy proyektor, televizor va monitorlar 16:9. Sifatni pasaytiruvchi variant qabul qilinmaydi, to'liq variantning narxi esa foydasidan yuqori. Vaqt tuzilma va matn sifatiga yo'naltirildi.

---

## 17. Xavfsizlik qarzi — o'lchangan, xayoliy emas

`npm audit --omit=dev` 5 ta high ko'rsatadi. Har biri tekshirildi.

**`npm audit fix --force` — tuzoq.** U `pptxgenjs` ni 4.0.1 dan **1.1.5 ga tushiradi**, ya'ni butun slayd dvigatelini buzadi. Ishlatilmadi.

**`image-size` — yetib bo'lmaydigan.** `pptxgen.es.js:5012` da uni ishlatadigan funksiya `/** FIXME: TODO: currently unused */` izohi bilan **butunlay izohga olingan** va u umuman boshqa paket nomini (`sizeof`, defislarsiz) chaqiradi — bu paket o'rnatilmagan ham. Tuzatilgan versiya **mavjud emas**: advisory `<=2.0.2` ni qamraydi, oxirgi versiya ham 2.0.2. `overrides` sinab ko'rildi va foyda bermagani uchun qaytarildi. Xavf dalil bilan qabul qilinadi.

**`sharp` / `postcss` / `next` — kod yo'li yopildi.** `next/image` loyihada umuman ishlatilmaydi (grep bo'sh). `images: { unoptimized: true }` qo'yildi — endi `/_next/image` hech qanday tasvirni qayta ishlamaydi, ya'ni `libvips` CVE'lariga (GHSA-f88m-g3jw-g9cj) kirish yo'li yo'q. To'liq yechim Next 16 ga o'tish, u kechiktirilgan.

**CSP qattiqlashtirildi.** `unsafe-eval` endi faqat ishlab chiqishda (uni Turbopack HMR talab qiladi). Prod to'plamidagi barcha chunk'lar tekshirildi: `eval(` va `new Function(` — **0 ta**, ya'ni olib tashlash xavfsiz ekani isbotlangan. Prod serverdan `curl` bilan sarlavha tasdiqlandi.

`unsafe-inline` **ongli ravishda qoldirildi**: undan qutulish uchun har so'rovga nonce qo'yuvchi middleware kerak, nonce esa oldindan chizilgan sahifalar bilan mos kelmaydi — build chiqishida SSG (`/uz/[slug]`, 14 yo'l) va statik sahifalar bor. Nonce ularning HTML'iga kirmaydi, skriptlar bloklanadi va sayt ishlamay qoladi.

---

*Hisobot oxiri. Keyingi qadam: Sprint 0 ning 1-bandidan boshlash.*

---

## 18. Mustaqil qayta audit va tuzatishlar (2026-08-20)

Hisobot yozilgandan keyin kod holati **mustaqil ravishda** qayta
tekshirildi: `tsc`, `eslint`, `npm test`, prod build ishga tushirildi,
`eval-r10` natijalari o'qildi, keyin sakkizta yangi nuqson topildi va
tuzatildi. Har biri sinov bilan yopildi.

### 18.1. Hisobotning eskirgan bandi

§1.1 dagi «to'liq to'plam qaytadan ishga tushirilmagan» bandi eskirgan:
`eval-r10` (19-avgust 23:46) **15/15** bilan o'tgan. Holat hisobotda
yozilganidan yaxshiroq edi.

### 18.2. Topilgan va tuzatilgan nuqsonlar

| # | Nuqson | Qanday tasdiqlandi | Holat |
|---|---|---|---|
| 1 | **Eng qimmat kurs ishi tariflari sotib olib bo'lmasdi.** 25–30 bet (18 000) va 40–45 bet (24 000) hajm darvozasidan MUNTAZAM yiqilardi | Jonli: ikkalasi ham ~5 000 so'zda to'xtadi, byudjetning ⅔ ishlatilmadi | ✅ |
| 2 | **IMRAD `targetPages` ni umuman o'qimasdi** — 8 000 va 4 000 tangalik maqola aynan bir xil chiqardi | Jonli: 1 355 vs 1 321 so'z | ✅ |
| 3 | **Tarjima jim qirqilardi.** Forma 60 000 belgi qabul qilardi, dvigatel 48 000 ini ishlardi; yiqilgan bo'lak `COMPLETED` bo'lardi | Kod + jonli sinov | ✅ |
| 4 | **`stripHeadingNumber` muallif initsialini yerdi:** «I. Karimov asarlarida…» → «Karimov asarlarida…» | Ishga tushirib o'lchandi | ✅ |
| 5 | **Inshoda matnsiz «KIRISH»/«XULOSA» sarlavhasi** chiqishi mumkin edi | DOCX render qilib ichidagi matn o'qildi | ✅ |
| 6 | **`write-llm.ts` va `write-specials.ts` (1 473 qator) testsiz** — regressiya CI da ushlanmasdi | Test importlari sanaldi | ✅ |
| 7 | **Premium rasm cheklovi mos slot soniga TENG edi** (10 = 10) — mix o'zgarsa rasm jim yo'qolardi | Slot zichligi o'lchandi | ✅ |
| 8 | **Ishning hammasi lokal shoxchada** edi: `origin/main` = `bee80a3`, 29 commit push qilinmagan, 16 fayl commit qilinmagan | `git log` | ✅ |

Yon tuzatishlar: `db:migrate`/`worker`/`topup`/`bot`/`smoke` `.env.local`
ni o'zi o'qiydi · P1-21 (`MAX_SOURCE` vs `SOURCE_TEXT_LIMIT`) yozib
qo'yildi · README `next.config.ts` bilan moslashtirildi.

### 18.3. Asosiy sabab — bitta naqsh, uch marta takrorlangan

1 va 2-nuqsonlar P0-1 (slayd sifat paketi) bilan **bir xil naqsh**:
qimmatroq tarif arzoni bilan bir xil natija beradi. Uchalasi ham
sezilmay qoldi, chunki **eval har vositani bitta (eng arzon) tarifda
sinardi**.

Shuning uchun eval kengaytirildi: `coursework-max` (40–45 bet),
`referat-max` (25–30), `article-imrad`, `translation-long`. Ustiga
**`TIER_PAIRS`** qo'shildi — qimmat tarif arzonidan kamida belgilangan
ulushcha katta bo'lishi shart, aks holda eval qizil bo'ladi. Bu mantiq
tarixiy nuqsonlar bilan alohida sinaldi.

Ikkinchi sabab — texnik va qarshi-intuitiv: **modeldan bitta javobda 9
paragraf so'ralganda u ~45% ini beradi**, 4–5 paragraf so'ralganda esa
deyarli to'liq bajaradi. Hajm chaqiruv KATTALIGI orqali emas, chaqiruv
SONI orqali olinishi kerak. Shu sababli `outlineShape` reja o'lchamini
betga bog'laydi (33+ bet → 5 bob × 4 ostmavzu), `perSub` chegarasi esa
9 dan 6 ga **tushirildi**.

### 18.4. Jonli sinov natijalari (Gemini)

| Sinov | Ilgari | Hozir |
|---|---:|---:|
| Kurs ishi 25–30 bet | 5 049 so'z ❌ (darvoza 5 152) | **6 492 so'z** ✅ |
| IMRAD maqola 3–5 bet | 1 321 so'z | 1 300 so'z ✅ |
| IMRAD maqola 10–15 bet | 1 355 so'z (farqsiz) | **3 044 so'z** ✅ |
| Tarjima, 40 abzas | jim kesilardi | **40/40 bo'lim**, 13.9 s ✅ |
| Tarjima, 54 400 belgi | pul yechilardi | navbatga **umuman qo'yilmadi** ✅ |
| Testlar | 111 | **121** |
| Smoke | 29/30 | **30/30** |

### 18.5. Yakunlash — hammasi jonli tasdiqlandi

Kredit tiklangach ish oxiriga yetkazildi. Model ham almashtirildi:
**`gemini-3.5-flash` → `gemini-3.7-flash`** (kirish 2×, chiqish 2.4×
arzon; chegirma 2026-12-31 gacha, keyin $1.50/$7.50).

| Sinov | Natija |
|---|---|
| To'liq eval `r15` | **19/19** |
| Tarif farqi (kurs ishi / referat / slayd) | **2.22× / 1.96× / 1.60×** |
| Smoke (LLM ishlagan holda) | **33/33** — PDF eksporti bilan |
| Birlik testlari | **121** (119 o'tdi, 2 skip) |

**Kurs ishi 40–45 bet (24 000 tanga): 9 329 so'z** — ilgari ~5 476
bilan har safar yiqilardi.

#### Jonli hujjatni ochib ko'rish yana ikkita nuqson topdi

Ikkalasi ham statik tahlilda ham, evalning raqamlarida ham ko'rinmasdi —
faqat DOCX ni ochib mundarijani o'qiganda chiqdi.

1. **IMRAD adabiyotlari ogohlantirishsiz chiqardi.** P0-4 yozuvchi va
   shablon yo'llarida yopilgan edi, IMRAD chetda qolgan. Aynan maqola
   jurnalga boradigan hujjat, ya'ni soxta manba eng ko'p zarar
   keltiradigan joy. Buni evalning YANGI `article-imrad` keysi ushladi —
   kengaytirish birinchi kunda o'zini oqladi.

2. **Qo'shimcha matn raqamsiz bo'lim bo'lib tushardi** va sarlavhasi
   mavzuni to'liq takrorlardi. Mundarijada ketma-ket besh qator, hammasi
   bir xil 60 belgi bilan boshlanardi. Bu **regressiya** edi: burchaklar
   sonini 2 dan 5 ga chiqarish uni kuchaytirgan. Endi ular «VI BOB.
   QO'SHIMCHA TAHLIL VA ISTIQBOL» ichida 6.1, 6.2 … bo'lib turadi.

> **Saboq:** raqam yashil bo'lgani hujjat yaxshi degani emas. Har
> release da kamida bitta eng qimmat hujjatni ochib **mundarijasini
> o'qib chiqish** kerak — hisobotning §8 «inson darvozasi» bandi aynan
> shu haqda.

Sinov kontenti egasining hisobida: **`+998997333896` — 141 tayyor
fayl**. `EVAL_USER` va `SMOKE_USER` standarti ham shu.

### 18.6. Ataylab qilinmagan

`twoCol`, `compare`, `process`, `stats`, `table` layoutlariga rasm sloti
**qo'shilmadi**. Sabab 4:3 bilan bir xil (§16): bu 5 ta layoutni qayta
joylashtirishni talab qiladi, natijani esa faqat renderlangan slaydlarni
ko'z bilan ko'rib tasdiqlash mumkin. Cheklovning **jim bog'lovchi**
qismi (rasm byudjeti mos slot soniga teng edi) tuzatildi; zichlikni
oshirish alohida, vizual tasdiq talab qiladigan vazifa.

§17 dagi xavfsizlik qarzi o'zgarmadi — `npm audit` hamon 5 ta high va
yechim Next 16 ga o'tish.
