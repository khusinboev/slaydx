# R1 — Texnologik xarita (maktab, 1–11 sinf; OTM variant qisqa)

AUDIT-20 §1 shabloni bo'yicha. Har faktga URL berilgan; manba topilmagan
joy "aniqlanmadi" deb ochiq qoldirilgan.

## 1. Rasmiy shakl/standart

| Hujjat | Raqam/sana | Nima beradi | Manba |
|---|---|---|---|
| Yillik ish rejasini shakllantirish yo'riqnomasi | 3058-son, 20.08.2018 (+ 3058-1-son, 29.06.2020) | O'qituvchi yillik ish rejasi ikki yo'nalishga bo'linadi: (1) o'quv-tarbiya jarayoniga oid, (2) metodik ta'minot/tashkiliy-pedagogik jarayon. 15-band: sinf jurnalidan (bosma/elektron) tashqari qo'shimcha hisobot **talab qilish taqiqlanadi** | [lex.uz/docs/-3876821](https://lex.uz/docs/-3876821), [lex.uz/docs/-4877855](https://lex.uz/docs/-4877855) |
| eMaktab.uz orqali yuklash amaliyoti | huquqiy talqin (Adliya vazirligi hududiy bo'limi maqolasi) | Agar o'qituvchi yillik/taqvim-mavzu rejani eMaktab.uz platformasiga yuklagan bo'lsa, **qog'oz nusxa qo'shimcha talab qilinishi noqonuniy** — 15-band asosida | [xalqtaliminfo.uz/post/399](https://xalqtaliminfo.uz/post/399) |
| Umumiy o'rta ta'lim DTS | 187-son, 06.04.2017 | Fanlar bo'yicha malaka talablari (3-ilova) — texnologik xarita/yillik reja shu malaka talablariga mos tuzilishi kerak, lekin bevosita jadval shaklini belgilamaydi | [lex.uz/ru/docs/-3153714](https://lex.uz/ru/docs/-3153714?ONDATE=28.04.2021+00) |
| Milliy o'quv dasturi (2021+) | uzedu.uz e'lonlari | Spiral yondashuv — yillik taqsimotda mavzular yuqori sinfda takrorlanib chuqurlashadi; taqvim-mavzu reja shu tuzilmaga mos bo'lishi kerak | [uzedu.uz/uz/news/514](https://uzedu.uz/uz/news/514) |
| BSB/ChSB (mezonli baholash) buyrug'i | 72-son, 27.02.2025 | ChSB — choraklik summativ baholash, BSB — bob/bo'lim summativ baholash; xarita jadvalida "Nazorat" ustuni shu bilan bog'liq bo'lishi mumkin | [talimxabarlari.uz/16160](https://talimxabarlari.uz/16160/) |

**Muhim topilma (halollik uchun):** "Texnologik xarita" atamasi rasmiy
buyruqlarda emas, ko'proq amaliy-metodik adabiyotda (masalan texnika/fizika
fanlari uchun) va o'qituvchilar amaliyotida ishlatiladi — u aslida
**taqvim-mavzu reja** (kalendar-tematik reja) bilan sinonim sifatida
qo'llanadi ([cyberleninka.ru maqolasi](https://cyberleninka.ru/article/n/fizika-fanini-o-qitishda-texnologik-xarita-ning-ahamiyati)).
Bitta rasmiy jadval shakli (ustunlar ro'yxati bilan) 3058-son
yo'riqnomada aniq berilmagan — yo'riqnoma yillik ish reja **yo'nalishlarini**
belgilaydi, jadval ustunlarini emas. Amalda tarqalgan ustunlar ro'yxati
(pastda) qidiruv natijalaridagi tavsiflardan yig'ilgan, rasmiy blank emas.

### Amalda tarqalgan ustunlar (taqvim-mavzu reja / "ish reja")

| Ustun | Izoh | Manba |
|---|---|---|
| Hafta / sana | Qaysi haftaga to'g'ri keladi | umumiy qidiruv natijasi |
| Soat | Shu mavzuga ajratilgan soat | |
| Mavzu | Aniq dars mavzusi | |
| Dars turi | Ma'ruza (yangi mavzu) / seminar / amaliy / laboratoriya | |
| Moddiy-texnik ta'minot | Kerakli jihoz/resurs (fan bo'yicha minimal ro'yxat) | |
| Mustaqil ish | Sinfdan tashqari mustaqil topshiriq turi (masala yechish, hisob-grafik ish, insho, taqdimot) | |
| Uyga vazifa | O'quvchi maksimal yuklamasini hisobga olib | |

(Yig'ma manba: [xalqtaliminfo.uz/post/399](https://xalqtaliminfo.uz/post/399) qidiruv xulosasi — aniq
bitta hujjat emas, bir nechta amaliy sahifadan sintez qilingan, shu
sababli **jadvalning bu versiyasi tavsiya, majburiy rasmiy blank emas**
deb belgilanadi.)

### OTM (oliy ta'lim) variant — qisqa izoh

OTMda ekvivalenti — "ishchi o'quv dastur" (silabus) va uning taqvim-mavzu
rejasi, odatda kafedra ishlab chiqib fakultet kengashida tasdiqlaydi;
tuzilishi kredit-modul tizimiga (haftalik soat, mustaqil ta'lim soati,
reyting nazorati NB1/NB2/YaN) bog'liq. Bu loyihaning fokusi maktab
(1–11 sinf) bo'lgani uchun OTM varianti chuqur tekshirilmadi — agar
kelajakda OTM segmenti qo'shilsa, alohida R-bosqich kerak.

## 2. Raqobatchilar parametrlari

| Parametr | sodda.ai | MagicSchool (Unit Plan) | Biz olamizmi |
|---|---|---|---|
| Narx | 6 000 tekis (statik render — JS talab qiladi, real forma maydonlari ushlanmadi) | LMS ichida, alohida narx yo'q | o'zgarmaydi (6 000, PM qarori) |
| Kirish parametrlari | aniqlanmadi (sahifa bo'sh render bo'ldi) | mavzu, standartlar, o'quv maqsadlari, davomiylik (5 kunlik intensiv yoki 2 haftalik) | bizda `subject`, `weeklyHours`, `totalHours` bor — **davomiylik (necha hafta/chorak) to'g'ridan-to'g'ri emas, soatdan hisoblanadi** (`mapWeeks`) |
| Chiqish tarkibi | aniqlanmadi | kunlik maqsadlar, faoliyat takliflari (laboratoriya/muhokama/modellashtirish), formativ baholash, summativ baholash g'oyalari | bizda hafta/mavzu/metod/natija/nazorat jadvali bor — **formativ vs summativ farqi yo'q** |
| Standart moslashtirish | aniqlanmadi | grade-level standard bilan bog'lash ixtiyoriy | keyin — DTS malaka talablariga moslashtirish `registry.ts` guidance orqali ichki bo'lishi mumkin |
| Chorak/semestr bo'linishi | aniqlanmadi | aniqlanmadi (unit = istalgan davr) | **yo'q** — hozirgi model haftalarni ketma-ket ro'yxat qiladi, choraklarga (I–IV) bo'lmaydi; bu maktab amaliyotiga (4 chorak) yaqinroq bo'lardi |
| Nazorat turi (og'zaki/yozma/BSB/ChSB) | aniqlanmadi | formativ/summativ umumiy tilda | bizda `pickMapControl` — Og'zaki/Yozma/Amaliy/Test tasodifiy tanlanadi, **mavzuga bog'liq emas** |

sodda.ai texnologik xarita sahifasi statik holatda deyarli bo'sh
render bo'lgani uchun (`slaydtop-public.md:45`) ularning aniq forma
maydonlarini solishtirib bo'lmadi — bu **audit qilinmagan** deb
qoldiriladi, boshqa vosita (login/JS orqali) bilan qayta tekshirish
kerak bo'lsa alohida band.

## 3. Bizga tavsiya — reyestr

**Turlar** (`MapModel.type`): `yillik` (standart, hozirgi xatti-harakat —
soatdan hafta hisoblanadi), `choraklik` (I–IV chorak alohida jadval,
har birida choraklik soat yig'indisi).

**Parametrlar:**

| id | tur | variantlar | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `subject` | text | — | — | ha | prompt |
| `weeklyHours` | number | 1–20 | — | ha | prompt, structure (soat hisob-kitobi) |
| `totalHours` | number | 1–400 | — | ha | prompt, structure |
| `mapType` | select | yillik / choraklik | yillik | yo'q | structure, layout |
| `grade` | range (ixtiyoriy, hozir yo'q) | 1–11 | — | yo'q | prompt |
| `controlLink` | select (ixtiyoriy) | erkin (hozirgi) / BSB-ChSB mos | erkin | yo'q | prompt (`pickMapControl` o'rniga mavzuga bog'liq tanlov) |
| `extra` | textarea | — | — | yo'q | prompt (hozir bor va ulangan) |
| `language` | select | uz/ru/en | uz | ha | prompt, structure |
| `institution`, `author` | text (TEACHER_FIELDS) | — | — | ha | structure (shapka) |

**Bo'limlar skeleti:** shapka (fan, o'quv yili, haftalik/jami soat) →
(ixtiyoriy) kirish qatori → yillik/choraklik jadval.

**Jadval ustunlari** (hozirgi `yearCols` — sinovdan o'tgan, o'zgarmasin):
`Hafta | Soat | Mavzu | Metod | Kutilgan natija | Nazorat`.
`choraklik` turi qo'shilsa, 4 ta jadval (har biri o'z sarlavhasi
`I chorak`/`II chorak`/... bilan) — sarlavha va'da qilingan yagona
manba (`layout.ts planTeacher`, kelajakdagi `teacher/map.ts`) orqali.

**Hajm chegaralari:** hafta soni `mapWeeks()` bilan 8–36 oralig'ida
kesilgan (mavjud, o'zgarmasin); noyob mavzu ≥70% chegara (mavjud,
`mapDoc:563`); soat yig'indisi `total` ga qat'iy teng (`normalizeMinutes`
bilan, mavjud).

## 4. Sifat mezonlari

**Deterministik qoidalar:**

| id | Nima tekshiradi | Chegara |
|---|---|---|
| `weekCount` | Qator soni `mapWeeks()` bilan mos | = (mavjud) |
| `uniqueTopics` | Noyob mavzular ulushi | ≥70% (mavjud) |
| `hoursSum` | Soat ustuni yig'indisi `totalHours` ga teng | qat'iy = (mavjud `normalizeMinutes`) |
| `noPlaceholderTopic` | "1-mavzu" kabi raqamli placeholder yo'q | regex rad (mavjud `mapDoc:531,544`) |
| `resultVariety` | `result` ustuni umumiy shablon ("Tushuncha shakllanadi") takrorlanmaydi | mavjud regex tekshiruvi bor, lekin faqat 1 ta variantni yopadi — kengaytirish tavsiya etiladi |
| `controlRelevance` (yangi) | `control` mavzu turiga mos (masalan laboratoriya darsida "Amaliy ish") | tavsiya — hozir `pickMapControl` tasodifiy indeksga bog'liq |

**Judge mezonlari (3–6, ingliz tilida):**

1. `topicProgression` — do topics move from simpler to more complex across the year/quarter, consistent with a spiral curriculum?
2. `methodDiversity` — is there a believable mix of lecture, practice, lab, and independent-work methods rather than one repeated pattern?
3. `hoursRealism` — do hour allocations per topic look proportionate to topic complexity, not uniformly identical?
4. `controlFit` — does the control/assessment type plausibly match the topic and method (e.g. lab topic → practical control, not a random label)?
5. `subjectCoherence` — do all topics genuinely belong to the stated subject and grade level, with no unrelated filler?

**Halollik chegarasi:** aniq darslik bob/bet raqami yoki rasmiy dastur
band raqami **o'ylab topilmasin** — faqat foydalanuvchi o'zi kiritsa
ishlatiladi; model "Milliy o'quv dasturi 34-band" kabi iqtibosni
o'zidan yaratmasligi kerak (hozir bunday cheklov aniq yozilmagan —
`mapSystemPrompt` da yo'q, qo'shilishi tavsiya etiladi).

## 5. Namunalar

- O'zbek tili fanidan 2025–2026 o'quv yili taqvim-mavzu reja (real, hafta/soat/mavzu formatida): [idum.uz/uz/archives/14545](https://idum.uz/uz/archives/14545).
- Yillik taqvim-mavzu reja arxivi (ko'p fan): [sadikov.uz](https://www.sadikov.uz/en/news/sections/yillik-taqvim-mavzu-rejalar) — sayt hozircha DNS xatosi bilan ochilmadi (`ENOTFOUND`), keyinroq qayta tekshirish kerak.
- Texnologik xarita ahamiyati (fizika fani misolida, metodik maqola): [cyberleninka.ru](https://cyberleninka.ru/article/n/fizika-fanini-o-qitishda-texnologik-xarita-ning-ahamiyati).

**LLM uchun yaxshi/yomon misol:**

- ✅ Yaxshi (`result` ustuni): «Uch xil moddiy holat orasidagi farqni
  aniq misollar bilan tushuntiradi» — mavzuga xos, tekshirib bo'ladigan.
- ❌ Yomon: «Tushuncha shakllanadi.» — har qanday mavzuga mos umumiy
  shablon; `mapDoc` da bu allaqachon `pickMapResult` bilan qisman
  filtrlangan, lekin faqat aynan shu 3 iboraga qarshi (mapDoc:535) —
  kengroq generik ibora ro'yxati kerak bo'lishi mumkin.

## 6. Ochiq savollar / egasidan kerak narsalar

1. Rasmiy yagona jadval shakli (ustun nomlari) topilmadi — davom
   etamizmi amaldagi "hafta/soat/mavzu/metod/natija/nazorat" (hozirgi
   kod) bilanmi, yoki egasi real maktab metodkabineti blankini
   (masalan choraklarga bo'lingan Excel/Word namuna) topib bera oladimi?
2. `choraklik` (chorak bo'yicha 4 alohida jadval) turini qo'shish
   kerakmi — bu maktab amaliyotiga (4 chorak tizimi) yaqinroq, lekin
   hozirgi `mapWeeks()` yagona yillik hisob-kitobni chorak bo'yicha
   qayta yozishni talab qiladi.
3. `pickMapControl` (Og'zaki/Yozma/Amaliy/Test) hozir mavzuga bog'liq
   emas, faqat tasodifiy indeks bilan tanlanadi — buni mavzu turiga
   bog'lash (masalan LLM javobidan olish, fallback sifatida saqlab)
   R1/R2 ish rejasiga kiritilsinmi?
4. OTM (universitet) segmenti kelajakda qo'shilishi kerakmi, yoki
   loyiha butunlay maktab fokusida qoladimi — hozircha faqat qisqa
   izoh berildi, chuqur tadqiqot qilinmadi.
