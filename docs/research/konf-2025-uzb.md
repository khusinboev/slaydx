# Mahalliy namuna tahlili — «Xalqaro ilmiy-amaliy anjuman, 2025-yil 19-aprel» to'plami

Manba: `Xalqaro konferensiya to'plami 2025 y 19 aprel.pdf` (ToshDTU, 797 bet, `pdftotext -layout`
bilan matnga aylantirilgan, `pdftoppm` bilan bir necha bet vizual tekshirilgan). Bu — O'zbekistonda
2025-yil 19-aprelda o'tkazilgan yoshlar ilmiy-amaliy anjumani (talaba/magistrant/yosh olim
ma'ruzalari, oltita yo'nalish: fundamental fanlar; elektronika-avtomatika; energetika; mexanika-
mashinasozlik; geologiya-metallurgiya; neft-gaz) materiallari to'plami — **haqiqiy, tahrirlanmagan,
"chala-standart" mahalliy hujjat**, OAK jurnali emas, balki konferensiya to'plami janri.

**Metodologiya**: `grep/awk` bilan butun korpus bo'yicha statistik hisob (UDK, iqtibos uslubi,
kalit so'z, adabiyotlar ro'yxati sarlavhalari va h.k.), 8 ta turli maqola to'liq o'qildi (matematika-RU,
sanoat raqamlashtirish-UZ, irrigatsiya-UZ, nemis tili o'qitish-RU, biomatematika-UZ kirill,
lazer-tosh mexanikasi-EN/xitoy muallif, spiral-bionika-RU, nanotexnologiya-RU), 4 bet
`pdftoppm -r 80` bilan rasmga aylantirilib ko'zdan kechirildi (bet 2, 24, 198, 219). **Bet raqamlari**
— PDF faylning pastki kolontituli (footer)dagi bosma raqam (`pdftotext -f N -l N` bilan har bir
iqtibos alohida tekshirilib tasdiqlangan); muqova/kirish qismi tufayli bosma raqam = jismoniy PDF
bet + 1 (mas., jismoniy 37-bet footerida «38» yozilgan). Taxminan **100–115 ta maqola** bor
(102 ta aniq "adabiyotlar ro'yxati" sarlavhasi topildi, ba'zilarida yo'q yoki boshqa nom bilan).

---

## 1. Tuzilma statistikasi

### 1.1 Umumiy hajm va bo'lim tarkibi

- 797 bet / ~105–115 maqola → **o'rtacha 6–7 bet/maqola** (front-matter va bo'lim
  muqovalarini hisobga olib taxminan 5–6 bet sof matn). Bu bizning `imrad_oak` (3-5/5-10/10-15
  bet) diapazonimizga yaqin — «conference_thesis» (1-2 bet) yoki «conference_extended»
  (500-1500 so'z) hajmidagi maqolalar bu to'plamda **deyarli yo'q**: hamma narsa to'liq maqola
  shaklida, tezis emas (bet 8-12: 5 betlik "raqamli iqtisodiyot" maqolasi bitta muallifli oddiy
  o'rta hajm namunasi).
- **Bo'lim sarlavhalari deyarli hech qachon alohida, markazlashtirilgan formatda emas** —
  ular ko'pincha **satr ichida qalin (bold) so'z** sifatida beriladi: «**Kirish.** Bakteriya so'zi...»,
  «**Asosiy qism.** *Bakteryaning ko'payishi...*» (bet 25), «**Kalit so'zlar:** mikrokontroller...»,
  «**Programmable logic controller (PLC)**» kichik bo'lim sifatida (bet 199). Bu — bizning
  DOCX/ko'ruvchi darajasidagi alohida sarlavha paragrafi konventsiyasidan farq qiladi: mahalliy
  amaliyotda sarlavha ko'pincha **run-in (bir xil paragraf ichida qalin so'z + davomi)**.
- «Kirish»/«Введение» sarlavhasi butun korpusda faqat **59 marta** aniq uchraydi, «Xulosa»/
  «Заключение»/«Вывод» esa **76 marta** — ya'ni ko'p maqolalarda (~yarmidan ko'pi) **Kirish
  atalgan sarlavhasiz to'g'ridan-to'g'ri matn boshlanadi** (masalan, nemis tili o'qitish maqolasi,
  bet 104-108 — hech qanday "Kirish" so'zisiz, kalit so'zlardan keyin darhol oqim matn), ammo
  Xulosa ko'proq intizom bilan alohida ajratiladi.
- Qat'iy IMRAD (Metodlar/Natijalar/Muhokama alohida sarlavhali) juda kam — asosan xalqaro
  hamkorlikda yozilgan ingliz tilidagi maqolalarda ko'rinadi: **"LASER-INDUCED STRENGTHENING…"**
  (bet 162-165, Xitoy universiteti bilan hamkorlik) raqamlangan «1. Introduction / 2. Materials and
  Methods / 3. Results (3.1/3.2/3.3) / 4. Discussion / 5. Conclusions / References» — bu bizning
  `elsevier_ieee_style` yoki `imrad_classic` turiga to'g'ridan-to'g'ri mos keladi. Ammo o'zbek/rus
  tilidagi mahalliy mualliflarning aksariyati **erkin oqim (Kirish → asosiy tahlil → Xulosa,
  ichki sarlavhalarsiz yoki run-in)** yozadi — bu aynan bizning `three_part_uz` turining tavsiflagan
  shakli.
- **Xulosa**: mahalliy amaliyotning eng ko'p tarqalgan shakli — bizning `three_part_uz`
  (Kirish–Asosiy qism–Xulosa erkin bo'limlar bilan), ikkinchi o'rinda — xalqaro/texnik
  maqolalarda qat'iy IMRAD (`imrad_classic`/`elsevier_ieee_style`). `imrad_oak` (5 bo'limli:
  Kirish/Adabiyotlar tahlili va metodlar/Natijalar/Muhokama/Xulosa) korpusda **sof holda deyarli
  uchramadi** — mahalliy mualliflar "Adabiyotlar sharhi"ni alohida bo'lim emas, balki Kirish
  ichiga run-in frazasi bilan joylashtiradi (bet 9: "…yangi talablar qo'yilmoqda. **Adabiyotlar
  sharhi.** Raqamli texnologiyalar bugungi kunda…" — bitta paragraf ichida, yangi bo'lim emas).

### 1.2 Annotatsiya (abstract)

- **Til tarkibi tasodifiy, standart yo'q**: ba'zi maqolalarda uz+ru+en (3 til), ba'zilarida faqat
  2 til (masalan, "raqamli iqtisodiyot" maqolasida faqat **uz+en**, ru yo'q — bet 8), ba'zilarida
  faqat 1 til ("LASER-INDUCED…" — faqat en, bet 161-162, garchi kalit so'zlar 3 tilda bo'lsa ham!).
  Tillar tartibi ham beqaror: goh uz→ru→en, goh ru→en→uz (nemis tili maqolasi, bet 104), goh
  uz→en→ru (irrigatsiya kanali maqolasi, bet 219-220).
- **Jiddiy nom-chalkashligi xatosi (takroriy holat, kamida 2 marta ko'rildi)**: ba'zi mualliflar
  rus VA o'zbek-kirill annotatsiyasi uchun **bir xil «Аннотация:» yorlig'ini ikki marta ishlatadi**
  — faqat matn tili bilan ajratish mumkin. Namuna (bet 150, "ВВЕДЕНИЕ В НАНОТЕХНОЛОГИЮ"):
  > «**Аннотация:** Описывая историю становления, раскрывается суть и значение
  > нанотехнологии…» *(rus)*
  > «**Аннотация:** Ташкил топиш тарихини тавсифлаш орқали нанотехнологиянинг асл
  > мохияти ва ахамияти очиб берилади…» *(o'zbek kirill!)*

  Xuddi shu naqsh "ПОДСТАНОВКА ЭЙЛЕРА" maqolasida ham (bet 4): rus "Аннотация" + o'zbek-kirill
  "Аннотация" + inglizcha "Abstract" — ya'ni yorliq so'zi tilga bog'liq emas, faqat matn tili
  bog'liq. **Bu — til aniqlashda yorliqqa emas, matn tiliga tayanish kerakligini ko'rsatadi**
  (bizning generator bu xatoni takrorlamaydi, lekin foydalanuvchi yuklagan fayllarni tahlil qilishda
  hisobga olish kerak bo'lishi mumkin).
- **Uzunlik — bizning minimal chegaramizdan (150 so'z) sezilarli past**: real namunalarda
  so'z soni (aniq sanalgan):
  - Digital iqtisodiyot, uz (bet 8): **40 so'z**
  - Digital iqtisodiyot, en (bet 8): **46 so'z**
  - Biomatematika, uz-kirill (bet 110): **53 so'z**
  - Spiral-bionika, ru (bet 27): **~35 so'z**
  - Filtratsiya/kanal, uz (bet 220): **~20 so'z** (bir jumla!)
  - "LASER-INDUCED…", en (bet 161-162): **101 so'z** — eng uzuni, chunki xalqaro/tajriba maqolasi.

  **Median ≈ 45–55 so'z**, faqat xalqaro hamkorlikdagi maqolalarda 100 so'zga yaqinlashadi.
  Bu bizning OAK profilimiz talab qiladigan 150–250 so'zdan **3–5 baravar qisqa**. Demak,
  mahalliy konferensiya amaliyoti rasmiy OAK qoidasining o'zidan ham pastroq — bizning
  generator OAK rasmiy talabiga (150-200 so'z, AUDIT-17 §2 dagi tadqiqot) mos, mahalliy
  "amaliy o'rtacha"dan yuqori — bu **ataylab tanlangan yuqori standart**, ammo baholovchi/
  foydalanuvchiga tushuntirish kerak bo'lishi mumkin ("bizning annotatsiya nega uzunroq" savoli
  tug'ilishi mumkin).
- **Punktuatsiya**: yorliqdan keyin nuqta yoki ikki nuqta — deyarli teng taqsimlangan
  ("Annotatsiya." 92 marta / "Annotatsiya:" 56 marta / "Аннотация." 75 / "Аннотация:" 60 /
  "Abstract." 43 / "Abstract:" 38) — qat'iy qoida yo'q.

### 1.3 Kalit so'zlar

- Soni: real namunalarda **4–9 ta** (digital iqtisodiyot 8, nemis tili 5, biomatematika 9, lazer-tosh 4,
  filtratsiya 4, spiral 6) — **median ≈ 5–6**. Bizning profillarimiz oralig'i (`oak` 5-12, `apa`/`ieee`
  4-6, `university` 5-10) real amaliyot bilan **yaxshi mos keladi** — bu yo'nalishda o'zgartirish
  shart emas.
- Ajratuvchi: vergul bilan, yorliqdan keyin nuqta yoki ikki nuqta (yana aralash).
- Tartib bir xil emas (§1.2 dagi kabi til tartibi tasodifiy).

### 1.4 UDK

- **UDK deyarli yo'q**: butun 797 betlik korpusda **haqiqiy per-maqola UDK kodi bitta ham
  topilmadi**. `UDK/УДК/UDC` so'zi jami 4 marta uchraydi — ikkitasi ingliz sarlavha so'zi «UDC»
  bo'lib (front-matter yaqinida, tasodifiy joylashuv), qolgan ikkitasi esa **boshqa (tashqi) ishlarga
  iqtibos ichida**: «…параметром» УДК 519.6:517.585.» (bet 23295-satr atrofida, adabiyotlar
  ro'yxati ichida, boshqa muallifning dissertatsiyasi nomi sifatida, o'sha maqolaning **o'zining**
  UDK'si emas). **Xulosa**: bu konferensiya to'plami UDK talab qilmaydi — demak bu manbadan
  "UDK → soha" jadvali uchun **hech qanday real namuna olib bo'lmaydi** (item (a) — quyida
  "Ochiq band" sifatida qayd etilgan). Bizning `oak`/`university`/`conference` profillaridagi
  `udk: true` talabi shu sababli **boshqa manba** (OAK rasmiy jadvali yoki mavjud ichki bilim)
  asosida qolishi kerak — bu to'plam faqat **"UDK ixtiyoriy/konferensiyada shart emas"** faktini
  tasdiqlaydi.

### 1.5 Mualliflar bloki

- Format: **F.I.Sh. (lavozim/unvon prefiksi bilan yoki bez) + tashkilot nomi** — ikkinchi qatorda.
  Unvon prefikslari chastotasi: `talaba` (student, uz) — **69 marta**, `студент` (ru) — **42 marta**
  (jami >110 — **ko'pchilik mualliflar talaba**, chunki bu yoshlar konferensiyasi!), `PhD` — 16,
  `dots.`/`доцент` (dotsent) — 8+1, `magistrant` — 6, `prof.`/`акад.` unvonlari kam ammo
  ustozlar hammuallif sifatida ko'p uchraydi (mas. bet 8: "Muradov Botir Xayat" — unvonsiz yakka
  muallif; bet 162: "student Zewei Li, associate professor Xiaowei Feng" — talaba+professor
  hamkorligi tipik namuna).
  - Xalqaro namuna: "LASER-INDUCED…" mualliflari — Xitoy universiteti (China University of
    Mining and Technology, Xuzhou) — konferensiya faqat mahalliy emas, xorijiy talabalar/
    olimlar ham qatnashgan.
- **Email deyarli yo'q**: 797 bet ichida atigi **4 ta** email manzili topildi (masalan
  `botir.muradov2022@gmail.com`) — ya'ni ~100+ maqoladan atigi 3-4 tasida muallif emaili bor.
  **ORCID — 0 marta** (butunlay yo'q). Bu OAK/FarDU rasmiy talablaridan (ORCID majburiy) farqli —
  konferensiya darajasida bu amaliyot umuman yo'q.
- Tashkilot ko'rsatilishi ba'zan to'liq (shahar, mamlakat bilan: "Toshkent davlat texnika
  universiteti, Toshkent, Uzbekistan" yoki "…г Ташкент, Республика Узбекистан"), ba'zan
  qisqa (faqat universitet nomi).

---

## 2. Adabiyotlar (iqtibos va ro'yxat)

### 2.1 Matndagi iqtibos uslubi

- **Deyarli 100% oddiy raqamli qavs** `[N]`, ro'yxat yoki oraliq bilan: `[1]`, `[1-3]`, `[1,3]`,
  `[4, 5]`, `[2,3,5]` — korpus bo'yicha **480+ ta** yakka `[N]` va o'nlab ro'yxat/oraliq shakli
  topildi.
- **GOST sahifali uslub `[1; 25-b.]` — butun 797 bet ichida BITTA HAM topilmadi** (`grep`
  bilan qidirilgan naqsh `\[N;...\]` — 0 ta natija). Bu bizning `oak` profilimizning standart
  iqtibos shakli (`cite: "gost"`, `[1; 25-b.]`) — **rasmiy OAK qoidasi**, ammo **amaliyotda
  hech kim ishlatmaydi** (hatto rasmiy hujjatlarda tavsiya qilingan bo'lsa ham). Bu muhim
  farqlash: bizning generator OAK **rasmiy qoidasiga** amal qiladi, ammo mahalliy **amaliy
  norma** oddiy `[N]` ekanini bilish kerak (baholovchi izohida yoki foydalanuvchiga tushuntirish
  uchun foydali kontekst).
- Muallif-yil uslubi (APA/Harvard, `(Muallif, yil)`) — matn ichida **0 marta** ishlatilgan, hatto
  ingliz tilidagi "LASER-INDUCED…" maqolasida ham (garchi uning **ro'yxati** Harvard uslubida
  yozilgan bo'lsa-da!) — matnda `[1]`, `[3]`, `[4, 5]` kabi raqamli qavslar ishlatilgan. Bu **ichki
  ziddiyat namunasi**: reference ro'yxati bitta uslubda (muallif-yil), matndagi iqtibos boshqa
  uslubda (raqamli) — chinakam "tipik xato", chunki ikki uslub bir-biriga mos kelmaydi.

### 2.2 Adabiyotlar ro'yxati — sarlavha, soni, uslub

- **Sarlavha nomi kamida 6 xil variantda** uchraydi (barchasi bir xil narsani anglatadi):
  «Foydalanilgan adabiyotlar ro'yxati.» (bet 12), «FOYDALANILGAN ADABIYOTLAR RO'YXATI:»
  (bet 22, katta harflarda), «Adabiyotlar» (bet 24), «Библиографический список» (bet 109),
  «ИСПОЛЬЗОВАННАЯ ЛИТЕРАТУРА» (bet 37 atrofida), «REFERENCES»/«References:» (ingliz
  maqolalarda, bet 164). Rasmiy yagona standart yo'q.
- **O'rtacha manba soni juda kam**: 102 ta aniqlangan ro'yxatning taqsimoti (avtomatik
  hisoblangan, yiliy raqamlar bilan aralashib ketgan chekka qiymatlar chiqarib tashlangan):

  | Manbalar soni | Maqolalar soni (taxminiy) |
  |---|---|
  | 0-1 | 4 |
  | 2-3 | 25 |
  | 4-5 | 26 |
  | 6-7 | 12 |
  | 8-10 | 9 |
  | 12-22 | 2-3 |

  **Median ≈ 4-5 manba**, mode 3-5 oralig'ida. Bizning `oak` profilimiz `refsMin: 10`, `apa`/
  `ieee` `refsMin: 15` — bu mahalliy amaliy o'rtachadan **2-3 baravar yuqori**. Yana — bu
  bizning **ataylab yuqori sifat standarti** ekanini tasdiqlaydi (AUDIT-17 Q-1: haqiqiy,
  tekshiriladigan manbalar), lekin "mahalliy standart past" ekanini biladigan kontekst sifatida
  foydali (item g).
- **Til ulushi**: namunalarda ko'pincha ruscha/o'zbekcha manbalar ustunlik qiladi (mas.
  digital iqtisodiyot maqolasida 6 tadan 5 tasi ruscha/o'zbekcha, faqat 1-2 tasi rasmiy hujjat),
  faqat texnik/energetika sohalarida (elektr, fizika, geologiya) xorijiy inglizcha manbalar va
  **DOI** ko'proq uchraydi (32 ta aniq `doi.org/...` havolasi topildi, asosan energetika/fizika
  maqolalarida to'plangan — bet 209, 224, 329, va h.k.). Boshqa sohalarda (gumanitar, ijtimoiy)
  DOI **deyarli yo'q**.
- **Tipik xatolar (aniq namunalar bilan)**:
  1. **Vikipediya va ixtiyoriy URL manbalar** to'g'ridan-to'g'ri ro'yxatda, hech qanday rasmiylashtirilmagan:
     > «4. https://xs.uz/uz/post/tabiij-resurslardan-samarali-fojdalanish-ustuvor-jonalishlardanbiri;
     > 5. https://uz.wikipedia.org/wiki/Tabiatni_muhofaza_qilish;» (bet 22)
  2. **Rasmiy hujjat + jurnal maqolasi + veb-sahifa bitta ro'yxatda aralash format bilan**,
     hech biri GOST/APA to'liq talabiga mos emas (bet 12): «2. Б.Х. Мурадов. Innovations in
     the economy and public sector… Журнал Young Scientist Research Journal Of
     Karakalpakstan, Том-2, NNUC, 2023/12/7. Страницы 301-308,» — sana formati
     "2023/12/7" (ISO/AQSH aralash), nuqta o'rniga vergul bilan tugaydi.
  3. **Bitta ro'yxat ichida uch til aralash** (o'zbek qonun hujjati + rus jurnal maqolasi + ingliz
     nomi) — tartib/format izchil emas.
  4. **Nomer + nuqta yoki nomer + qavs** ikkalasi ham ishlatiladi (`1.` va `1)` aralash holatlar
     uchraydi turli maqolalarda).
  5. Muallif-yil uslubidagi ro'yxat (Harvard) + matnda raqamli iqtibos — §2.1 da tasvirlangan
     ziddiyat.

---

## 3. Vizuallar (jadval, rasm, formula)

- **Jadval sarlavhasi — TEPADA, tasdiqlangan** (bet 219): «Таблица 1.» so'zidan keyin jadval
  ma'lumotlari boshlanadi — bu bizning qarorimizga (Q-2, jadval sarlavha tepada) **to'liq mos**.
  Raqamlash uslubi ham aralash: «Jadval 1.» (so'z oldin), «1-Jadval.»/«1-jadval.» (raqam oldin,
  o'zbekcha qo'shimchali), «Таблица 1.»/«Table 1» — hammasi **flat (bo'lim bo'yicha emas)**
  raqamlash, bizning `figureNumbering: "flat"` qarorimizga mos.
- **Rasm sarlavhasi — asosan PASTDA**, lekin uslub xilma-xil: «1-rasm. SCADA tizimi…» (bet
  198-199, raqam-so'z-nuqta, pastda), «Рис. 1. Морфология…» (rus, pastda), «Rasm 1.
  Akkumulyatorlarni…» (so'z-raqam tartibida, kam uchraydi). Bizning tanlagan format
  («N-rasm.» / «Рис. N.» / «Figure N.», pastda) — real amaliyotning eng ko'p tarqalgan varianti
  bilan mos keladi.
- **Formulalar**: matn sifatida chiqariladi (Unicode belgilar bilan, masalan «𝑘𝑛(𝑡) − 𝑎𝑛2(𝑡)»)
  yoki murakkab kasr/ildiz holatlarida **alohida joylashtirilgan rasm-obyekt** sifatida (Equation
  Editor/MathType — pdftoppm bilan ko'rilganda aniq kasr chizig'i va kursiv o'zgaruvchilar
  ko'rinadi, bet 220: `Q_f = 0.0116 k_f (B+2d_c)`). **Raqamlash — o'ngga tekislangan, FLAT
  (1), (2), (3)…** (bo'lim-ichi emas), markazda joylashgan formula bilan — bizning
  "formula markaz + (1)" yechimimizga mos (bet 24: «(1)», «(2)», «(3)», «(4)»; bet 220-221:
  «(1)»–«(5)»).
- Rasm/jadval zichligi: 87 ta rasm-sarlavhaga o'xshash qator va ~10 ta aniq jadval sarlavhasi
  topildi (avtomatik qidiruv aniqlik cheklangan, chunki ko'p jadvallar sarlavhasiz yoki matn
  ichida erigan holda keladi) — texnik/muhandislik maqolalarida (elektr, energetika, mexanika)
  vizual zichlik yuqori, gumanitar/tilshunoslik maqolalarida deyarli yo'q.

---

## 4. Til va uslub — tipik iboralar (chastota va bet bilan)

O'zbek ilmiy uslubining eng ko'p takrorlanadigan "formula" iboralari (chastota butun korpus
bo'yicha):

| Ibora | Marta | Namuna (bet) |
|---|---|---|
| «bugungi kunda» | 17 | «...texnologiyalar **bugungi kunda** bizning hayotimizning bir qismi...» (bet 9) |
| «muhim ahamiyat kasb etadi» | 11 | «...loyihalash fanlarining integratsiyasi **muhim ahamiyat kasb etadi** [1]» (bet 53) |
| «Shunday qilib,» (xulosa boshlovchisi) | 10 | — |
| «dolzarb masalalardan biri»/«dolzarbligi» | 8+ | «Suv resurslarining samarali boshqaruvi... global miqyosda **dolzarb masalalardan biri** bo'lib qolmoqda» (bet 38) |
| «Xulosa qilib aytganda» | 6 | — |
| «muhim rol o'ynaydi» | 5 | — |
| «Xulosa qilib shuni ta'kidlash mumkinki» | 3 | «...**Xulosa qilib shuni ta'kidlash mumkinki**, ishlab chiqarishni tashkil etishda...» (bet 12) |
| «keng qamrovli» | 2 | — |

Boshqa tipik (sifat jihatidan ko'zga tashlangan, aniq chastota sanalmagan) iboralar:
- Kirish ochuvchilari: «Mavzuning dolzarbligi shundaki...», «...ning dolzarbligini belgilaydi»,
  «Zamonaviy sharoitlarda iqtisodiy jarayonlarni raqamlashtirish... faoliyatning barcha
  sohalariga kirib bormoqda» (bet 8), «Yangi O'zbekistonning 2022-2026 yillarga
  mo'ljallangan Taraqqiyot strategiyasida...» (davlat hujjatiga murojaat — juda tipik ochilish).
- Xulosa yopuvchilari: «Yuqoridagi fikrlarni umumlashtirgan xolda... quyidagi yo'nalishlarini
  taklif qilinadi» (bet 12), «Shuningdek, ... hisobga olish kerak», «Bu borada olib borilgan
  tadqiqotlar shuni ko'rsatadiki...».
- Rus tilida tipik: «Актуальность данной статьи состоит в необходимости...» (bet 105),
  «Таким образом,», «Следует отметить, что…».
- Ingliz tilida (asosan xalqaro hamkorlik maqolalarida): «This study investigates…», «Results
  demonstrate that…», «The findings reveal…» (bet 161) — bular ancha "standart ilmiy uslub",
  suvli iboralar kamroq (ehtimol xorijiy hammualliflar tahriri tufayli).
- **"Suv" (bo'sh) iboralar**: «bugungi kunda dunyo miqyosida», «zamonaviy sharoitda»,
  «keng ko'lamli chora-tadbirlar», «turli sohalarda amaliyot yuritishda keng tarqalgan» —
  ma'noga unchalik qo'shimcha bermaydigan, faqat matnni "ilmiy" ko'rsatish uchun ishlatiladigan
  klişelar; bular ko'pincha kirish paragrafining birinchi 2-3 jumlasida to'planadi.

---

## 5. Bizga foydali xulosalar

**(a) UDK → soha jadvali**: **bu manba bunday jadval bermaydi** — konferensiya to'plamida
UDK umuman ishlatilmagan (§1.4). Demak, bizning mavjud/rejalashtirilgan UDK jadvalimiz
boshqa manbadan (OAK rasmiy UDK jadvali, kutubxona klassifikatori) olinishi kerak; bu PDF
faqat **"UDK konferensiya darajasida ixtiyoriy"** faktini beradi — baholovchi qoidasida buni
hisobga olish mumkin (`conference` profilida UDK'ni yumshoqroq/ogohlantiruvchi qilish, qattiq
talab emas).

**(b) Haqiqiy annotatsiya namunalari** — yuqorida §1.2 da 5+5+4 ta aniq matn keltirilgan
(bet raqamlari bilan): eng qisqasi 20 so'z (filtratsiya, uz, bet 220), eng uzuni 101 so'z (lazer-tosh,
en, bet 161) — bularni prompt-namuna ("bu qanchalik qisqa bo'lishi MUMKIN emas" ko'rsatmasi
uchun teskari misol) sifatida ishlatish mumkin, ammo **to'g'ridan-to'g'ri nusxalash tavsiya
etilmaydi** — sifat past (§1.2, §4dagi "suv" ibora tahlili).

**(c) Bo'lim sarlavhalari lug'ati — `labels.ts` bilan solishtirish**: bizning `labels.ts`dagi barcha
asosiy kalitlar (`intro`→Kirish, `conclusion`→Xulosa, `methods`→Tadqiqot metodologiyasi,
`results`→Natijalar, `discussion`→Muhokama) korpusda uchraydigan nomlar bilan mos keladi.
Farq — korpusda bu sarlavhalar **alohida emas, run-in bold** shaklda ko'proq uchraydi (§1.1);
`litreview_methods` ("Adabiyotlar tahlili va metodlar") kabi qo'shma bo'lim nomi to'g'ridan-to'g'ri
uchramadi — o'rniga "Adabiyotlar sharhi." Kirish ichiga run-in sifatida kiritiladi. Yetishmayotgan
narsa yo'q — bizning lug'at aslida **rasmiy/tozalangan** versiyasi, real amaliyot esa
soddalashtirilgan.

**(d) Tipik kirish/xulosa iboralari** — §4 jadvali + ro'yxati to'g'ridan-to'g'ri prompt-material
sifatida ishlatilishi mumkin, lekin **ehtiyot bilan**: bu iboralarning aksariyati aynan "AI izi"
mezonlarimizga (AUDIT-17 §2: "suv" iboralar, klişelar) zid — ya'ni ular **taqlid qilinmasligi
kerak bo'lgan namunalar**, ijobiy emas, salbiy o'rnak sifatida foydali (`article/guard.ts` yoki
`review.ts`dagi "filler" qoidasi uchun aniq so'z ro'yxati: "bugungi kunda", "keng qamrovli",
"muhim ahamiyat kasb etadi", "dolzarb masalalardan biri" — bularni ma'nosiz/klişe sifatida
belgilash mumkin, agar ular hech qanday keyingi faktik gap bilan bog'lanmasa).

**(e) Formatlash faktlari**: TNR shriftga o'xshash serif shrift, justified (ikki tomonlama
tekislangan) paragraf, ~1,25 sm xatboshi, bet raqami pastda markazda, ustunlar bitta (single-
column) — vizual jihatdan ko'rilgan 4 bet (2, 24, 198, 219) barchasida bir xil. Qator oralig'i
ko'zga **yagona (single) yoki yaqin unga** ko'rinadi (OAK'ning rasmiy 1.5 emas) — bu bizning
`conference` profili (`line: 1`) bilan yaqinroq, `oak` profilining 1.5 talabidan farqli. Chegaralar
taxminan simmetrik ko'rinadi (OAK'ning 2/2/3/1.5 sm asimmetrik "bog'lash uchun chap keng"
qoidasi aniq ko'zga tashlanmaydi) — **bu faqat vizual kuzatuv, pixel o'lchov qilinmagan**.

**(f) Bizning 12 tur bilan mos kelmaydigan, lekin ko'p uchraydigan shakl**: aslida yo'q — eng
ko'p tarqalgan shakl (erkin Kirish–tahlil–Xulosa, run-in sarlavhalar, qisqa annotatsiya) bizning
`three_part_uz` turi bilan **konseptual jihatdan to'liq qamrab olingan** (faqat bizniki tozalangan/
standartlashtirilgan versiyasi — bo'limlar aniq sarlavha bilan ajratiladi, annotatsiya OAK
uzunligida). Yagona "yangi" kuzatuv: run-in (satr-ichi) sarlavha uslubi — agar kimdir "mahalliy
konferensiya" ko'rinishini so'ndan-so'ngacha taqlid qilmoqchi bo'lsa (past ustuvorlik, chunki
bizning maqsadimiz sifatni OSHIRISH, pasaytirish emas).

**(g) Baholovchi uchun "mahalliy standart"** — biz qanchalik yuqori/past baholayapmiz:
mahalliy konferensiya amaliyoti (annotatsiya ~45-55 so'z, adabiyot 3-5 ta, UDK yo'q, email yo'q,
ORCID yo'q, GOST sahifali iqtibos yo'q, ko'p mualliflar talaba) — bizning eng past profilimiz
(`conference`: annotatsiya 80-200, adabiyot 0-20) dan ham **pastroq**. Bu shuni ko'rsatadiki:
**bizning generator eng qat'iy profilida ham (`oak`, `apa`) mahalliy o'rtacha nashr sifatidan
sezilarli yuqori chiqadi** — bu ataylab shunday (mahsulot maqsadi: sifatni oshirish), lekin
foydalanuvchiga ("nega mening maqolam 90 ball, lekin men ko'rgan boshqa maqolalarda hech
qanday tekshirilgan manba yo'q edi") tushuntirish kerak bo'lsa, bu tahlil aynan shu savolga javob
beradi.

---

## Generatorga tavsiyalar (ustuvorlik bilan)

1. **[Past xavf, tez] `docs/AUDIT-17.md`/ichki bilim bazasiga izoh qo'shish**: "mahalliy
   konferensiya amaliyoti" bilan bizning profillarimiz orasidagi farqni hujjatlashtirish (§5g) —
   `PUBLICATION_PROFILES`dagi `hint` maydonlariga yoki alohida qo'llanmaga bitta jumla: "Bu
   profil mahalliy konferensiya amaliyotidan yuqori sifat standarti beradi" — foydalanuvchi
   kutilmalarini boshqarish uchun. Fayl: `lib/generation/article/profiles.ts`.
2. **[Past xavf] `conference` profilining `refsMin`ni real amaliyotga moslashtirish**: hozirgi
   `refsMin: 0, refsMax: 20` — bu mahalliy median (4-5) bilan allaqachon mos, o'zgartirish shart
   emas, faqat tasdiqlangan; boshqa profillar (`oak refsMin:10`, `apa/ieee refsMin:15`) ataylab
   yuqoriroq qoldirilsin (sifat maqsadi). Fayl: `lib/generation/article/profiles.ts` — harakat
   talab qilinmaydi, faqat tasdiqlash.
3. **[O'rta, foydali] `article/review.ts`dagi "filler" (suv ibora) qoidasiga aniq so'z-ro'yxat
   qo'shish**: §4/§5d dagi real klişelar ("bugungi kunda", "muhim ahamiyat kasb etadi", "dolzarb
   masalalardan biri", "keng qamrovli", "Shunday qilib," boshida) — bularni **faqat modelning
   o'z generatsiyasida** cheklash uchun (foydalanuvchi matnini emas) filler-detektor so'zlar
   ro'yxatiga qo'shish mumkin, chunki bular haqiqiy mahalliy maqolalarda eng ko'p uchraydigan,
   demak eng ko'p AI tomonidan ham "tabiiy" deb o'ylab takrorlanadigan iboralar. Fayl:
   `lib/generation/article/review.ts` (yoki `guard.ts` — filler ro'yxati qayerda saqlanishiga
   qarab).
4. **[O'rta] Prompt darajasida (yozuvchi LLM) ogohlantirish**: `article/prompts.ts`da yozuvchi
   modeliga "mahalliy konferensiya uslubidagi klişelarni (bugungi kunda, muhim ahamiyat kasb
   etadi, dolzarb masalalardan biri) ishlatma, o'rniga aniq faktlarga tayangan jumla yoz" ko'rsatmasi
   qo'shish — bu bizning sifat maqsadimizni (AUDIT-17: AI-izidan qochish) mahalliy tilga moslab
   kuchaytiradi. Fayl: `lib/generation/article/prompts.ts`.
5. **[Past xavf, ma'lumot uchun] `three_part_uz` turi tavsifiga (`types-registry.ts`) izoh**:
   bu tur mahalliy amaliyotning eng yaqin ko'zgusi ekanini ta'kidlash (hozirgi `hint` maydoni
   allaqachon yaqin — "universitet xabarnomalari, TATU tipidagi jurnallar" — konferensiya
   to'plamlarini ham qo'shish mumkin: "…konferensiya to'plamlari"). Fayl:
   `lib/generation/article/types-registry.ts`.
6. **[Past ustuvorlik, ixtiyoriy] Run-in sarlavha uslubi variant sifatida ko'rib chiqish emas** —
   bizning alohida-sarlavha DOCX formatimiz (Word/OAK standarti) aslida **yaxshiroq** amaliyot
   (§1.1) — o'zgartirish TAVSIYA ETILMAYDI, faqat qayd etildi (item f).
7. **[Ma'lumot, harakat shart emas] UDK jadvali manbasi** — bu PDF'dan UDK jufti olinmaydi
   (§5a); agar kelajakda UDK-taklif funksiyasi qurilsa, boshqa manba (OAK rasmiy UDK
   klassifikatori, kutubxona ma'lumot bazasi) kerak bo'ladi — bu tadqiqot shunchaki **manba
   yetishmasligini** hujjatlashtiradi.

---

## Ilova — tekshirilgan maqolalar ro'yxati (bet, til, soha)

| # | Sarlavha (qisqa) | Bet | Til | Soha |
|---|---|---|---|---|
| 1 | Подстановка Эйлера | 4-7 | ru/uz-kirill/en | Matematika |
| 2 | Raqamli iqtisodiyotda innovatsion texnologiyalar (Olmaliq KMK) | 8-12 | uz/en | Sanoat iqtisodiyoti |
| 3 | Irrigatsiya kanallari suv resurslari matematik modellari | 38-? | uz | Amaliy matematika/irrigatsiya |
| 4 | Организация проектной работы студентов (nemis tili) | 105-109 | ru/en/uz | Pedagogika/tilshunoslik |
| 5 | Биоматематик моделлаштириш (tibbiyotda matematika) | 110-? | uz-kirill/en/ru | Biomatematika/tibbiyot |
| 6 | Laser-Induced Strengthening of Soft Rocks (Xitoy hamkorligi) | 161-165 | en | Gorniy-mexanika/geoinjiniring |
| 7 | Применение спиральных принципов живой природы в мебели | 27-28 | ru/en/uz | Dizayn/bionika |
| 8 | Введение в нанотехнологию | 150-? | ru/uz-kirill/en | Fizika/nanotexnologiya |
| — | Расчет фильтрационных потерь (jadval/formula namunasi) | 219-221 | uz/en/ru | Gidrotexnika |
| — | SCADA/PLC bilan suv boshqaruvi (rasm namunasi) | 198-199 | uz | Avtomatika |
