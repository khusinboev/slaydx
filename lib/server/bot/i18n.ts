import { isBotLanguage, type BotLanguage, type ProfileField, type FieldStepId } from "../../profile/fields";

/**
 * Bot texts in three languages (owner decision 2026-10-08, docs/bot/PLAN.md).
 *
 * Uzbek Latin is the source. The user's choice lives in `users.language`
 * (uz | ru | en); the web app stays Uzbek. Every bot text and button label
 * goes through `t()`; values are interpolated as `{name}` and are inserted
 * as given — callers escape user data (`ui.ts esc`) before passing it.
 *
 * A few Uzbek strings keep the straight apostrophe on purpose: they are the
 * bot's historical texts that other tests and users' habits lock
 * (`/login`, contact replies, `/taklif`). New copy uses ‘ ’.
 */

export type Lang = BotLanguage;
export const LANGS: readonly Lang[] = ["uz", "ru", "en"];

type Entry = { uz: string; ru: string; en: string };

const T = {
  /* ── Paid tests «Test ishlash» (owner request 7; every key starts with `tests.`) ── */
  "tests.cmd": { uz: "Test ishlash — fanlar bo‘yicha testlar", ru: "Тесты по предметам", en: "Subject tests" },
  "tests.intro": {
    uz: "📝 <b>Test ishlash</b>\nMatematika, Ona tili va Tarix bo‘yicha tayyor testlar: vaqt bilan ishlaysiz, test tugagach to‘g‘ri javoblar va har xato javobning AI tahlili ko‘rsatiladi.\nNarx: bitta fan — <b>{subject}</b>, «Hammasi» — <b>{all}</b>.",
    ru: "📝 <b>Тесты</b>\nГотовые тесты по математике, родному языку и истории: на время, после завершения — правильные ответы и разбор каждой ошибки от ИИ.\nЦена: один предмет — <b>{subject}</b>, «Все предметы» — <b>{all}</b>.",
    en: "📝 <b>Tests</b>\nReady-made tests in mathematics, the mother tongue and history: timed; when you finish you see the correct answers and an AI analysis of every mistake.\nPrice: one subject — <b>{subject}</b>, «All subjects» — <b>{all}</b>.",
  },
  "tests.introFree": {
    uz: "📝 <b>Test ishlash</b>\nMatematika, Ona tili va Tarix bo‘yicha tayyor testlar: vaqt bilan ishlaysiz, test tugagach to‘g‘ri javoblar va har xato javobning AI tahlili ko‘rsatiladi.\nBirinchi urinish <b>bepul</b>, keyingilari: bitta fan — <b>{subject}</b>, «Hammasi» — <b>{all}</b>.",
    ru: "📝 <b>Тесты</b>\nГотовые тесты по математике, родному языку и истории: на время, после завершения — правильные ответы и разбор каждой ошибки от ИИ.\nПервая попытка <b>бесплатно</b>, далее: один предмет — <b>{subject}</b>, «Все предметы» — <b>{all}</b>.",
    en: "📝 <b>Tests</b>\nReady-made tests in mathematics, the mother tongue and history: timed; when you finish you see the correct answers and an AI analysis of every mistake.\nThe first attempt is <b>free</b>, then: one subject — <b>{subject}</b>, «All subjects» — <b>{all}</b>.",
  },
  "tests.disabled": {
    uz: "📝 Testlar hozircha yopiq. Birozdan keyin qayting.",
    ru: "📝 Тесты пока закрыты. Загляните позже.",
    en: "📝 Tests are closed for now. Please come back later.",
  },
  "tests.openBtn": { uz: "Testni ochish", ru: "Открыть тесты", en: "Open the tests" },
  "tests.lastResultBtn": { uz: "Oxirgi natija va AI tahlil", ru: "Последний результат и разбор ИИ", en: "Last result and AI analysis" },

  /* ── Qattiqqo‘l domla (owner request 15; every key starts with `domla.`) ── */
  "domla.intro": {
    uz: "🎓 <b>Qattiqqo‘l domla</b>\nSlaydingizni himoya qiling: domla 5 ta savolni OVOZ bilan so‘raydi, siz ovozli xabar bilan javob berasiz. Oxirida baho qo‘yadi va adashgan joyingizni aytadi.\nNarxi: <b>{price}</b>. Qaysi ishni himoya qilamiz?",
    ru: "🎓 <b>Строгий профессор</b>\nЗащитите свои слайды: профессор задаёт 5 вопросов ГОЛОСОМ, вы отвечаете голосовыми сообщениями. В конце он ставит оценку и показывает, где вы ошиблись.\nЦена: <b>{price}</b>. Какую работу защищаем?",
    en: "🎓 <b>The Strict Professor</b>\nDefend your slides: the professor asks 5 questions OUT LOUD and you answer with voice messages. At the end you get a grade and the question you got wrong.\nPrice: <b>{price}</b>. Which work shall we defend?",
  },
  "domla.none": {
    uz: "🎓 Himoya qilish uchun tayyor slayd yo‘q. Avval slayd yarating, keyin qaytib keling.",
    ru: "🎓 Нет готовых слайдов для защиты. Сначала создайте презентацию, затем возвращайтесь.",
    en: "🎓 You have no finished slides to defend yet. Create a presentation first, then come back.",
  },
  "domla.disabled": {
    uz: "🎓 Qattiqqo‘l domla hozircha dam olyapti. Birozdan keyin qayting.",
    ru: "🎓 Строгий профессор сейчас отдыхает. Загляните позже.",
    en: "🎓 The Strict Professor is taking a break. Please come back later.",
  },
  "domla.open": {
    uz: "🎓 Sizda tugallanmagan himoya bor: «{topic}». Davom ettiramizmi?",
    ru: "🎓 У вас есть незавершённая защита: «{topic}». Продолжим?",
    en: "🎓 You have an unfinished defence: “{topic}”. Shall we continue?",
  },
  "domla.resumeBtn": { uz: "Davom ettirish", ru: "Продолжить", en: "Continue" },
  "domla.appBtn": { uz: "Tarix va ilova", ru: "История и приложение", en: "History and app" },
  "domla.topUpBtn": { uz: "Hisobni to‘ldirish", ru: "Пополнить счёт", en: "Top up" },
  "domla.started": {
    uz: "🎓 Domla savollarni tayyorlayapti… Birozdan keyin birinchi savol ovozli xabar bo‘lib keladi. To‘landi: {price}.",
    ru: "🎓 Профессор готовит вопросы… Скоро придёт первый вопрос голосовым сообщением. Оплачено: {price}.",
    en: "🎓 The professor is preparing the questions… The first one arrives as a voice message shortly. Paid: {price}.",
  },
  "domla.again": {
    uz: "🎓 Bu himoya allaqachon boshlangan — qayta to‘lov yechilmadi.",
    ru: "🎓 Эта защита уже начата — повторно деньги не списаны.",
    en: "🎓 This defence has already started — nothing was charged again.",
  },
  "domla.insufficient": {
    uz: "Hisobda mablag‘ yetarli emas. Himoya narxi: {price}.",
    ru: "Недостаточно средств. Цена защиты: {price}.",
    en: "Not enough balance. The defence costs {price}.",
  },
  "domla.notFound": { uz: "Bu ish topilmadi.", ru: "Эта работа не найдена.", en: "That work was not found." },
  "domla.openFirst": {
    uz: "Avval boshlangan himoyani tugating.",
    ru: "Сначала завершите начатую защиту.",
    en: "Finish the defence you already started first.",
  },
  "domla.resumed": { uz: "Savol qayta yuboriladi", ru: "Вопрос отправляется снова", en: "The question is being sent again" },
  "domla.expired": { uz: "Himoya muddati tugagan", ru: "Время защиты истекло", en: "The defence has expired" },
  "domla.preparing": { uz: "Savollar tayyorlanmoqda…", ru: "Вопросы готовятся…", en: "The questions are being prepared…" },
  "domla.finished": { uz: "Bu himoya tugagan", ru: "Эта защита завершена", en: "This defence is over" },
  "domla.voiceHint": {
    uz: "Hozir domlaning savoli yo‘q. /domla bilan himoyani boshlang.",
    ru: "Сейчас нет вопроса профессора. Начните защиту командой /domla.",
    en: "There is no question from the professor right now. Start a defence with /domla.",
  },
  "domla.voiceBad": {
    uz: "Bu turdagi audio qabul qilinmaydi. Oddiy ovozli xabar yuboring.",
    ru: "Этот тип аудио не принимается. Отправьте обычное голосовое сообщение.",
    en: "This audio type is not accepted. Send a regular voice message.",
  },
  "domla.listening": { uz: "🎧 Domla tinglayapti…", ru: "🎧 Профессор слушает…", en: "🎧 The professor is listening…" },
  "domla.busy": {
    uz: "Domla oldingi javobingizni hali tinglayapti. Biroz kuting.",
    ru: "Профессор ещё слушает предыдущий ответ. Подождите немного.",
    en: "The professor is still listening to your previous answer. Please wait.",
  },
  "domla.wait": {
    uz: "Domla savolni hali aytib bo‘lmadi. Biroz kuting.",
    ru: "Профессор ещё не договорил вопрос. Подождите немного.",
    en: "The professor has not finished asking yet. Please wait.",
  },
  "domla.tooBig": {
    uz: "Ovozli xabar juda katta (2 MB dan oshmasin). Qisqaroq qilib qayta yuboring.",
    ru: "Голосовое сообщение слишком большое (не более 2 МБ). Отправьте покороче.",
    en: "The voice message is too big (2 MB at most). Send a shorter one.",
  },
  "domla.tooLong": {
    uz: "Ovozli xabar juda uzun (ko‘pi bilan 2 daqiqa). Qisqaroq qilib qayta yuboring.",
    ru: "Голосовое сообщение слишком длинное (не более 2 минут). Отправьте покороче.",
    en: "The voice message is too long (2 minutes at most). Send a shorter one.",
  },
  /* ── Main keyboard ── */
  "kb.slide": { uz: "Slayd", ru: "Слайды", en: "Slides" },
  "kb.image": { uz: "Rasm", ru: "Картинка", en: "Image" },
  "kb.pro": { uz: "Pro slayd", ru: "Pro слайды", en: "Pro slides" },
  "kb.files": { uz: "Ishlarim", ru: "Мои работы", en: "My files" },
  "kb.independent": { uz: "Mustaqil ish", ru: "Самостоятельная работа", en: "Independent work" },
  "kb.referat": { uz: "Referat", ru: "Реферат", en: "Report" },
  "kb.resume": { uz: "Rezyume", ru: "Резюме", en: "Resume" },
  "kb.wallet": { uz: "Hamyon / Bonus", ru: "Кошелёк / Бонус", en: "Wallet / Bonus" },
  "kb.profile": { uz: "Profil", ru: "Профиль", en: "Profile" },
  "kb.help": { uz: "Yordam", ru: "Помощь", en: "Help" },
  "kb.placeholder": {
    uz: "Vositani tanlang yoki xabar yozing…",
    ru: "Выберите инструмент или напишите сообщение…",
    en: "Pick a tool or type a message…",
  },
  "kb.note": { uz: "Pastdagi tugmalardan birini tanlang", ru: "Выберите одну из кнопок внизу", en: "Pick one of the buttons below" },
  "kb.refreshed": {
    uz: "Pastdagi tugmalar yangilandi.",
    ru: "Кнопки внизу обновлены.",
    en: "The buttons below are refreshed.",
  },
  "tool.blocked": {
    uz: "«{tool}» vaqtincha o‘chiq. Birozdan keyin qayta urinib ko‘ring.",
    ru: "«{tool}» временно недоступен. Попробуйте чуть позже.",
    en: "“{tool}” is temporarily unavailable. Please try again a bit later.",
  },
  "tool.noApp": {
    uz: "«{tool}» ilovada ochiladi — /start bosing va «Ilovani ochish» tugmasidan foydalaning.",
    ru: "«{tool}» открывается в приложении — нажмите /start и кнопку «Открыть приложение».",
    en: "“{tool}” opens in the app — send /start and tap “Open the app”.",
  },

  /* ── /start ── */
  "welcome.hello": { uz: "Assalomu alaykum, {name}!", ru: "Здравствуйте, {name}!", en: "Hello, {name}!" },
  "welcome.helloAnon": { uz: "Assalomu alaykum!", ru: "Здравствуйте!", en: "Hello!" },
  "welcome.pitch": {
    uz: "SlaydX — taqdimot, referat, rasm va boshqa hujjatlarni bir necha daqiqada tayyorlaydi.",
    ru: "SlaydX за несколько минут готовит презентации, рефераты, картинки и другие документы.",
    en: "SlaydX makes presentations, essays, images and other documents in a few minutes.",
  },
  "welcome.balance": { uz: "Balans: <b>{n}</b>", ru: "Баланс: <b>{n}</b>", en: "Balance: <b>{n}</b>" },
  "welcome.invite": {
    uz: "Do‘st taklif qiling — har biriga <b>{n}</b> gacha",
    ru: "Приглашайте друзей — до <b>{n}</b> за каждого",
    en: "Invite friends — up to <b>{n}</b> for each",
  },
  "welcome.app": {
    uz: "<b>Ilovani ochish</b> — SlaydX shu yerning o‘zida, Telegram ichida ochiladi va siz avtomatik kirasiz.",
    ru: "<b>Открыть приложение</b> — SlaydX откроется прямо в Telegram, вход автоматический.",
    en: "<b>Open the app</b> — SlaydX opens right here in Telegram and signs you in automatically.",
  },
  "welcome.site": {
    uz: "<b>Saytda ochish</b> — brauzerda; havola <b>bir martalik</b> va 5 daqiqa amal qiladi (yangisi: /login).",
    ru: "<b>Открыть на сайте</b> — в браузере; ссылка <b>одноразовая</b> и действует 5 минут (новая: /login).",
    en: "<b>Open the website</b> — in a browser; the link is <b>one-time</b> and valid for 5 minutes (new one: /login).",
  },
  "btn.openApp": { uz: "Ilovani ochish", ru: "Открыть приложение", en: "Open the app" },
  "btn.allTools": { uz: "Barcha vositalar", ru: "Все инструменты", en: "All tools" },
  "btn.invite": { uz: "Taklif", ru: "Пригласить", en: "Invite" },
  "btn.site": { uz: "Saytda ochish", ru: "Открыть на сайте", en: "Open the website" },

  /* ── /login and the site ticket (historical Uzbek copy) ── */
  "login.text": {
    uz: [
      "Qayerda ochishni tanlang 👇",
      "",
      "📱 <b>Ilovada ochish</b> — Telegram ichida, avtomatik kirish bilan.",
      "🌐 <b>Saytda ochish</b> — brauzerda; havola <b>bir martalik</b> va 5 daqiqa amal qiladi.",
    ].join("\n"),
    ru: [
      "Выберите, где открыть 👇",
      "",
      "📱 <b>В приложении</b> — внутри Telegram, вход автоматический.",
      "🌐 <b>На сайте</b> — в браузере; ссылка <b>одноразовая</b> и действует 5 минут.",
    ].join("\n"),
    en: [
      "Choose where to open 👇",
      "",
      "📱 <b>In the app</b> — inside Telegram, signed in automatically.",
      "🌐 <b>On the website</b> — in a browser; the link is <b>one-time</b> and valid for 5 minutes.",
    ].join("\n"),
  },
  "login.app": { uz: "Ilovada ochish", ru: "В приложении", en: "In the app" },
  "login.site": { uz: "Saytda ochish", ru: "На сайте", en: "On the website" },

  /* ── /alifbo: the free script converter (web page; the bot only links to it) ── */
  "alifbo.text": {
    uz: [
      "<b>Alifbo o‘giruvchi</b> — tekin",
      "",
      "Matn va fayllarni (DOCX, PPTX, TXT) Kirill, Lotin va yangi Lotin alifbolari orasida o‘giring.",
      "",
      "<i>Yangi lotin alifbosi — ЎРҚ-1184 qonuni (21.10.2026), 22.04.2027 dan kuchga kiradi.</i>",
    ].join("\n"),
    ru: [
      "<b>Конвертер алфавита</b> — бесплатно",
      "",
      "Переводите текст и файлы (DOCX, PPTX, TXT) между кириллицей, латиницей и новой латиницей.",
      "",
      "<i>Новый латинский алфавит — закон ЎРҚ-1184 (21.10.2026), вступает в силу 22.04.2027.</i>",
    ].join("\n"),
    en: [
      "<b>Alphabet converter</b> — free",
      "",
      "Convert text and files (DOCX, PPTX, TXT) between Cyrillic, the current Latin and the new Latin alphabet.",
      "",
      "<i>The new Latin alphabet is Law ЎРҚ-1184 (21.10.2026), in force from 22.04.2027.</i>",
    ].join("\n"),
  },
  "alifbo.open": { uz: "Alifbo o‘giruvchini ochish", ru: "Открыть конвертер", en: "Open the converter" },
  "ticket.text": {
    uz: [
      "Kirish uchun quyidagi tugmani bosing 👇",
      "",
      "Havola <b>bir martalik</b> va 5 daqiqa amal qiladi.",
      "Agar bu siz bo'lmasangiz — havolani hech kimga yubormang.",
    ].join("\n"),
    ru: [
      "Нажмите кнопку ниже, чтобы войти 👇",
      "",
      "Ссылка <b>одноразовая</b> и действует 5 минут.",
      "Если это были не вы — никому не пересылайте ссылку.",
    ].join("\n"),
    en: [
      "Tap the button below to sign in 👇",
      "",
      "The link is <b>one-time</b> and valid for 5 minutes.",
      "If this was not you, do not forward the link to anyone.",
    ].join("\n"),
  },
  "ticket.button": { uz: "Saytga kirish", ru: "Войти на сайт", en: "Sign in to the website" },
  "ticket.expired": {
    uz: "Bu havola eskirgan. Saytga qaytib «Telegram orqali kirish» tugmasini qayta bosing.",
    ru: "Эта ссылка устарела. Вернитесь на сайт и снова нажмите «Войти через Telegram».",
    en: "This link has expired. Go back to the website and tap “Sign in with Telegram” again.",
  },
  fallback: {
    uz: "Saytga kirish uchun /login yozing yoki saytdagi «Telegram orqali kirish» tugmasini bosing.",
    ru: "Чтобы войти на сайт, отправьте /login или нажмите «Войти через Telegram» на сайте.",
    en: "To sign in to the website, send /login or tap “Sign in with Telegram” on the site.",
  },

  /* ── /admin, contact ── */
  "admin.ask": {
    uz: "Admin sifatida tasdiqlash uchun raqamingizni ulashing.",
    ru: "Чтобы подтвердить права администратора, поделитесь своим номером.",
    en: "Share your phone number to confirm you are an admin.",
  },
  "admin.shareButton": { uz: "Raqamni ulashish", ru: "Поделиться номером", en: "Share my number" },
  "contact.onlyOwn": {
    uz: "Faqat o'zingizning raqamingizni ulashing.",
    ru: "Поделитесь только своим собственным номером.",
    en: "Please share only your own number.",
  },
  "contact.taken": {
    uz: "Bu raqam allaqachon boshqa akkauntga bog'langan.",
    ru: "Этот номер уже привязан к другому аккаунту.",
    en: "This number is already linked to another account.",
  },
  "contact.noAccount": {
    uz: "Avval saytga «Telegram orqali kirish» orqali bir marta kiring, keyin qaytadan /admin bosing.",
    ru: "Сначала один раз войдите на сайт через «Войти через Telegram», затем снова отправьте /admin.",
    en: "First sign in to the website once with “Sign in with Telegram”, then send /admin again.",
  },
  "contact.admin": { uz: "✅ Admin sifatida tasdiqlandingiz.", ru: "✅ Права администратора подтверждены.", en: "✅ You are confirmed as an admin." },
  "contact.notAdmin": { uz: "Bu raqam admin ro'yxatida yo'q.", ru: "Этого номера нет в списке администраторов.", en: "This number is not on the admin list." },
  "btn.adminPanel": { uz: "Admin panel", ru: "Админ-панель", en: "Admin panel" },

  /* ── Referral ── */
  "ref.title": { uz: "Do'stlarni taklif qiling", ru: "Приглашайте друзей", en: "Invite your friends" },
  "ref.rule": {
    uz: "Har bir do'st uchun: 1–{u1}-do'st — {a} bonus so'm, {u1p}–{u2}-do'st — {b} bonus so'm, {u2p}-dan boshlab — {c} bonus so'm. Keyingi do'stingiz uchun: {n} bonus so'm. Do'stingiz ilovaga birinchi marta kirganda hisoblanadi.",
    ru: "За каждого друга: 1–{u1}-й — {a} бонусных сум, {u1p}–{u2}-й — {b} бонусных сум, с {u2p}-го — {c} бонусных сум. За следующего друга: {n} бонусных сум. Начисляется, когда друг впервые войдёт в приложение.",
    en: "Per friend: friends 1–{u1} — {a} bonus UZS, {u1p}–{u2} — {b} bonus UZS, from {u2p} on — {c} bonus UZS. Your next friend earns {n} bonus UZS. Counted when your friend opens the app for the first time.",
  },
  "ref.link": { uz: "Sizning havolangiz:", ru: "Ваша ссылка:", en: "Your link:" },
  "ref.counts": {
    uz: "Taklif qilinganlar: <b>{a}</b> · Topilgan: <b>{b} bonus so'm</b>",
    ru: "Приглашено: <b>{a}</b> · Получено: <b>{b} бонусных сум</b>",
    en: "Invited: <b>{a}</b> · Earned: <b>{b} bonus UZS</b>",
  },
  "ref.groupOnly": {
    uz: "Taklif havolasini olish uchun botga shaxsiy chatda /taklif yozing.",
    ru: "Чтобы получить ссылку-приглашение, напишите боту /taklif в личном чате.",
    en: "To get your invite link, send /taklif to the bot in a private chat.",
  },
  "btn.shareFriends": { uz: "Do'stlarga yuborish", ru: "Отправить друзьям", en: "Send to friends" },
  "btn.copyLink": { uz: "Havolani nusxalash", ru: "Скопировать ссылку", en: "Copy the link" },
  "btn.copyInvite": { uz: "Taklif havolasini nusxalash", ru: "Скопировать ссылку-приглашение", en: "Copy my invite link" },

  /* ── Profilim ── */
  "prof.title": { uz: "Profilim", ru: "Мой профиль", en: "My profile" },
  "prof.name": { uz: "Ism", ru: "Имя", en: "Name" },
  "prof.phone": { uz: "Telefon", ru: "Телефон", en: "Phone" },
  "prof.city": { uz: "Shahar", ru: "Город", en: "City" },
  "prof.study": { uz: "O‘qish", ru: "Учёба", en: "Study" },
  "prof.work": { uz: "Ish joyi", ru: "Работа", en: "Work" },
  "prof.course": { uz: "{n}-kurs", ru: "{n} курс", en: "year {n}" },
  "prof.money": {
    uz: "{total} so‘m · {star} {points} bonus so‘m",
    ru: "{total} сум · {star} {points} бонусных сум",
    en: "{total} UZS · {star} {points} bonus UZS",
  },
  "prof.complete": { uz: "Profil {p}% to‘ldirilgan", ru: "Профиль заполнен на {p}%", en: "Profile {p}% complete" },
  "prof.lead": {
    uz: "Bo‘limni tanlang — har maydonni shu yerda o‘zgartirish mumkin.",
    ru: "Выберите раздел — любое поле можно изменить прямо здесь.",
    en: "Pick a section — any field can be changed right here.",
  },
  "btn.wallet": { uz: "Hamyon", ru: "Кошелёк", en: "Wallet" },
  "btn.lang": { uz: "Til", ru: "Язык", en: "Language" },
  "btn.openFull": { uz: "Ilovada to‘liq ochish", ru: "Открыть полностью в приложении", en: "Open in full in the app" },
  "btn.backProfile": { uz: "Profilga qaytish", ru: "Назад в профиль", en: "Back to profile" },
  "btn.cancel": { uz: "Bekor qilish", ru: "Отмена", en: "Cancel" },
  "btn.back": { uz: "Orqaga", ru: "Назад", en: "Back" },
  "sec.shaxsiy": { uz: "Shaxsiy", ru: "Личное", en: "Personal" },
  "sec.oqish": { uz: "O‘qish joyi", ru: "Учёба", en: "Study" },
  "sec.ish": { uz: "Ish joyi", ru: "Работа", en: "Work" },
  "sec.shaxsiy.title": { uz: "Shaxsiy ma’lumotlar", ru: "Личные данные", en: "Personal details" },
  "sec.oqish.title": { uz: "O‘qish joyi", ru: "Место учёбы", en: "Place of study" },
  "sec.ish.title": { uz: "Ish joyi", ru: "Место работы", en: "Workplace" },
  "sec.shaxsiy.lead": {
    uz: "Ism va muallif har yangi ishning titul sahifasiga o‘zi yoziladi.",
    ru: "Имя и автор сами попадают на титульный лист каждой новой работы.",
    en: "Your name and author line go onto the title page of every new work.",
  },
  "sec.oqish.lead": {
    uz: "Kurs ishi, referat va mustaqil ish titulida shu ma’lumotlar chiqadi.",
    ru: "Эти данные выводятся на титульном листе курсовой, реферата и самостоятельной работы.",
    en: "These details appear on the title page of course papers, essays and assignments.",
  },
  "sec.ish.lead": {
    uz: "Slayd, dars rejasi va maqolada muallif lavozimi va tashkiloti sifatida ishlatiladi.",
    ru: "Используется как должность и организация автора в слайдах, планах уроков и статьях.",
    en: "Used as the author’s position and organisation in slides, lesson plans and articles.",
  },
  "saved.title": { uz: "Saqlandi!", ru: "Сохранено!", en: "Saved!" },
  "saved.shaxsiy": {
    uz: "Endi yangi ishlarning titul sahifasiga avtomatik yoziladi.",
    ru: "Теперь это автоматически попадёт на титульный лист новых работ.",
    en: "It now goes onto the title page of new works automatically.",
  },
  "saved.oqish": {
    uz: "Endi referat va kurs ishlarida titulga avtomatik yoziladi.",
    ru: "Теперь это автоматически попадёт на титул рефератов и курсовых.",
    en: "It now goes onto the title page of essays and course papers automatically.",
  },
  "saved.ish": {
    uz: "Endi slayd, dars rejasi va maqolalarda avtomatik ishlatiladi.",
    ru: "Теперь это автоматически используется в слайдах, планах уроков и статьях.",
    en: "It is now used in slides, lesson plans and articles automatically.",
  },
  "prompt.current": { uz: "Hozirgi qiymat: {v}", ru: "Сейчас: {v}", en: "Current value: {v}" },
  "prompt.example": { uz: "Masalan: {v}", ru: "Например: {v}", en: "For example: {v}" },
  "prompt.howto": {
    uz: "Javobni shu chatga yozing (10 daqiqa ichida).",
    ru: "Напишите ответ в этот чат (в течение 10 минут).",
    en: "Type your answer in this chat (within 10 minutes).",
  },
  "err.empty": { uz: "Qiymat bo‘sh bo‘lmasin.", ru: "Значение не может быть пустым.", en: "The value cannot be empty." },
  "err.rate": {
    uz: "Juda tez-tez saqlanmoqda — bir necha daqiqadan keyin qayta yozing.",
    ru: "Слишком часто — попробуйте снова через несколько минут.",
    en: "Too many changes — please try again in a few minutes.",
  },
  "account.blocked": {
    uz: "Hisobingiz vaqtincha bloklangan. Savol bo‘lsa, admin bilan bog‘laning: {url}",
    ru: "Ваш аккаунт временно заблокирован. Если есть вопросы, свяжитесь с администратором: {url}",
    en: "Your account is temporarily blocked. Please contact the admin if you have questions: {url}",
  },
  "private.only": {
    uz: "Bu buyruq faqat botning shaxsiy chatida ishlaydi.",
    ru: "Эта команда работает только в личном чате с ботом.",
    en: "This command works only in a private chat with the bot.",
  },
  "err.long": {
    uz: "Juda uzun: {max} belgidan oshmasin (hozir {n}).",
    ru: "Слишком длинно: не больше {max} символов (сейчас {n}).",
    en: "Too long: at most {max} characters (now {n}).",
  },
  "toast.cancelled": { uz: "Bekor qilindi", ru: "Отменено", en: "Cancelled" },
  "toast.notYours": { uz: "Bu tugma siz uchun emas", ru: "Эта кнопка не для вас", en: "This button is not for you" },
  "toast.start": { uz: "Avval /start bosing", ru: "Сначала нажмите /start", en: "Send /start first" },
  "toast.old": { uz: "Bu tugma eskirgan", ru: "Эта кнопка устарела", en: "This button is out of date" },

  /* ── Ishlarim ── */
  "files.title": { uz: "Ishlarim", ru: "Мои работы", en: "My files" },
  "files.empty": {
    uz: "Hali ishlaringiz yo‘q. Birinchisini ilovada yarating — bir necha daqiqa oladi.",
    ru: "Работ пока нет. Создайте первую в приложении — это займёт несколько минут.",
    en: "No files yet. Create your first one in the app — it takes a few minutes.",
  },
  "files.hint": { uz: "Ochish uchun ishni bosing.", ru: "Нажмите на работу, чтобы открыть.", en: "Tap a file to open it." },
  "files.range": { uz: "{a}–{b}", ru: "{a}–{b}", en: "{a}–{b}" },
  "status.done": { uz: "Tayyor", ru: "Готово", en: "Ready" },
  "status.running": { uz: "Yozilmoqda {p}%", ru: "Пишется {p}%", en: "Writing {p}%" },
  "status.queued": { uz: "Navbatda", ru: "В очереди", en: "Queued" },
  "status.failed": { uz: "Xato", ru: "Ошибка", en: "Failed" },
  "status.cancelled": { uz: "Bekor qilindi", ru: "Отменено", en: "Cancelled" },
  "btn.newWork": { uz: "Yangi ish yaratish", ru: "Создать новую работу", en: "Create a new file" },
  "btn.prev": { uz: "Oldingi", ru: "Назад", en: "Previous" },
  "btn.next": { uz: "Keyingi", ru: "Далее", en: "Next" },

  /* ── Hamyon ── */
  "wallet.title": { uz: "Hamyon", ru: "Кошелёк", en: "Wallet" },
  "wallet.balance": { uz: "Balans: <b>{n}</b>", ru: "Баланс: <b>{n}</b>", en: "Balance: <b>{n}</b>" },
  "wallet.bonus": { uz: "Shundan: {n}", ru: "Из них: {n}", en: "Of which: {n}" },
  "wallet.recent": { uz: "So‘nggi amallar", ru: "Последние операции", en: "Recent activity" },
  "wallet.none": { uz: "Hali amallar yo‘q.", ru: "Операций пока нет.", en: "No activity yet." },
  "wallet.paynet": {
    uz: "Paynet orqali ham to‘ldirish mumkin. Paynet’da «SlaydX» xizmatini tanlab, SlaydX ID ni kiriting: <code>{id}</code>",
    ru: "Пополнить можно и через Paynet: выберите услугу «SlaydX» и введите SlaydX ID: <code>{id}</code>",
    en: "You can also top up via Paynet: pick the «SlaydX» service and enter your SlaydX ID: <code>{id}</code>",
  },
  "btn.paynet": { uz: "Paynet’da to‘lash", ru: "Оплатить в Paynet", en: "Pay in Paynet" },
  "wallet.payNote": {
    uz: "To‘lov ilovada — Click yoki Payme orqali. Hujjat yaratilmasa, pul to‘liq qaytariladi.",
    ru: "Оплата — в приложении, через Click или Payme. Если документ не создан, деньги вернутся полностью.",
    en: "Payment is in the app, via Click or Payme. If a document is not made, you get a full refund.",
  },
  /** C-Q4: the payment bonus line on the wallet card while the percent is > 0. */
  "wallet.payBonus": { uz: "Har bir to‘ldirishga <b>+{p}%</b> bonus", ru: "<b>+{p}%</b> бонус к каждому пополнению", en: "<b>+{p}%</b> bonus on every top-up" },
  "btn.topup": { uz: "To‘ldirish", ru: "Пополнить", en: "Top up" },
  "btn.inviteFriend": { uz: "Do‘st taklif qilish", ru: "Пригласить друга", en: "Invite a friend" },
  "btn.backWallet": { uz: "Hamyonga qaytish", ru: "Назад в кошелёк", en: "Back to wallet" },
  /** Paid amounts and the whole balance (program 17 D1: 1 point = 1 so‘m). */
  "unit.som": { uz: "{n} so‘m", ru: "{n} сум", en: "{n} UZS" },
  /** Bonus amounts (program 17 D1): bonus so‘m / бонусных сум / bonus UZS. */
  "unit.bonusSom": { uz: "{n} bonus so‘m", ru: "{n} бонусных сум", en: "{n} bonus UZS" },
  "ledger.charge": { uz: "Hujjat uchun to‘lov", ru: "Оплата документа", en: "Document payment" },
  "ledger.refund": { uz: "Pul qaytarildi", ru: "Возврат", en: "Refund" },
  "ledger.topup": { uz: "Balans to‘ldirildi", ru: "Пополнение баланса", en: "Balance top-up" },
  "ledger.topupVia": { uz: "To‘ldirish · {p}", ru: "Пополнение · {p}", en: "Top-up · {p}" },
  "ledger.bonus": { uz: "Bonus", ru: "Бонус", en: "Bonus" },
  "ledger.bonusFriend": { uz: "Taklif bonusi · {f}", ru: "Бонус за приглашение · {f}", en: "Invite bonus · {f}" },
  "ledger.signup": { uz: "Ro‘yxatdan o‘tish bonusi", ru: "Бонус за регистрацию", en: "Sign-up bonus" },
  "ledger.firstTopup": { uz: "Birinchi to‘ldirish bonusi", ru: "Бонус за первое пополнение", en: "First top-up bonus" },
  "ledger.paymentBonus": { uz: "To‘lov bonusi ({p}%)", ru: "Бонус за пополнение ({p}%)", en: "Payment bonus ({p}%)" },
  "ledger.subscription": { uz: "To‘lov balansga tushdi", ru: "Платёж зачислен на баланс", en: "Payment added to balance" },
  "ledger.admin": { uz: "Ma’muriy tuzatish", ru: "Административная корректировка", en: "Admin adjustment" },
  "ledger.merge": {
    uz: "Eski hisob qoldig‘i balansga o‘tkazildi",
    ru: "Остаток старого счёта переведён на баланс",
    en: "Old account remainder moved to balance",
  },
  "ledger.other": { uz: "Hisob harakati", ru: "Операция по счёту", en: "Account activity" },
  "ledger.channelJoin": { uz: "Kanal obunasi · {c}", ru: "Подписка на канал · {c}", en: "Channel subscription · {c}" },
  "ledger.channelStay": { uz: "Kanalda qolish bonusi · {c}", ru: "Бонус за верность каналу · {c}", en: "Channel stay bonus · {c}" },

  /* ── «Sizning bonuslaringiz» (docs/bonus/PLAN.md, Bonus 2) — every bonus amount in so‘m (B2-Q3) ── */
  "btn.bonus": { uz: "Bonuslar", ru: "Бонусы", en: "Bonuses" },
  "btn.refresh": { uz: "Yangilash", ru: "Обновить", en: "Refresh" },
  "bonus.title": { uz: "Sizning bonuslaringiz", ru: "Ваши бонусы", en: "Your bonuses" },
  "bonus.summary": {
    uz: "Jami olgan: <b>{e}</b> · yana olish mumkin: <b>{a}</b>",
    ru: "Всего получено: <b>{e}</b> · можно получить ещё: <b>{a}</b>",
    en: "Earned so far: <b>{e}</b> · still available: <b>{a}</b>",
  },
  "bonus.lead": {
    uz: "Har bir tugma — bitta vazifa: bajaring, bonus hamyoningizga o‘zi tushadi (✅ — bajarilgan). Bonus so‘m xizmatlar uchun to‘langan so‘m kabi sarflanadi.",
    ru: "Каждая кнопка — одно задание: выполните его, и бонус сам придёт в кошелёк (✅ — выполнено). Бонусные сумы тратятся на услуги так же, как обычные.",
    en: "Each button is one task: complete it and the bonus lands in your wallet by itself (✅ — done). Bonus UZS pays for services just like regular UZS.",
  },
  "bonus.refreshHint": {
    uz: "Kanalga obuna bo‘lgach bonus tushmasa — «Yangilash»ni bosing.",
    ru: "Подписались, а бонус не пришёл — нажмите «Обновить».",
    en: "Joined a channel but no bonus yet? Tap «Refresh».",
  },
  "task.signup": { uz: "Ro‘yxatdan o‘tish", ru: "Регистрация", en: "Sign-up" },
  "task.invite": { uz: "Do‘st taklif qilish · +{n}", ru: "Пригласить друга · +{n}", en: "Invite a friend · +{n}" },
  "task.invited": { uz: "{a} do‘st taklif qildingiz · +{n}", ru: "Приглашено друзей: {a} · +{n}", en: "Friends invited: {a} · +{n}" },
  "task.stayWait": { uz: "⏳ {d} kun: {n} kun", ru: "⏳ {d} дн.: {n} дн.", en: "⏳ {d}d: {n}d" },
  /** C-Q4 payment bonus (`payment-bonus.ts`): every paid top-up earns +{p}%. */
  "task.topup": { uz: "Har to‘ldirishga +{p}% bonus", ru: "+{p}% бонус к каждому пополнению", en: "+{p}% bonus on every top-up" },
  // Rating bonus (lib/server/ratings.ts): ledger title and the bonus-task button.
  "rating.ledger": { uz: "Ilovani baholash bonusi", ru: "Бонус за оценку приложения", en: "App rating bonus" },
  "ambassador.ledger": { uz: "Do'st to'lovi bonusi ({p}%)", ru: "Бонус за пополнение друга ({p}%)", en: "Friend's payment bonus ({p}%)" },
  "ambassador.rule": {
    uz: "Do'stlaringiz har to'lovidan {p} % bonus so'm",
    ru: "{p} % бонусных сум с каждого платежа ваших друзей",
    en: "{p} % bonus UZS from every payment your friends make",
  },
  "ambassador.title": { uz: "Elchi dasturi", ru: "Программа «Посол»", en: "Ambassador programme" },
  "ambassador.block": {
    uz: "<b>🏅 Elchi dasturi</b>\nDo'stingiz sizning havolangiz orqali kirib to'lov qilsa — har to'lovdan <b>{p} %</b> bonus so'm sizga (muddatsiz, avtomatik; pulga yechib bo'lmaydi).\nKodingiz: <code>{code}</code>\nDo'stlar: <b>{a}</b> · Elchi bonusi: <b>{b} bonus so'm</b>",
    ru: "<b>🏅 Программа «Посол»</b>\nЕсли друг зашёл по вашей ссылке и пополнил баланс — вы получаете <b>{p} %</b> бонусных сум с каждого платежа (без срока, автоматически; вывести деньгами нельзя).\nВаш код: <code>{code}</code>\nДрузей: <b>{a}</b> · Бонус посла: <b>{b} бонусных сум</b>",
    en: "<b>🏅 Ambassador programme</b>\nWhen a friend joins via your link and tops up, you get <b>{p} %</b> bonus UZS of every payment (no time limit, automatic; cannot be cashed out).\nYour code: <code>{code}</code>\nFriends: <b>{a}</b> · Ambassador bonus: <b>{b} bonus UZS</b>",
  },
  "ambassador.dm": {
    uz: "🎉 Siz taklif qilgan do'stingiz to'lov qildi — sizga +{n} bonus so'm!",
    ru: "🎉 Приглашённый вами друг совершил оплату — вам +{n} бонусных сум!",
    en: "🎉 A friend you invited made a payment — you get +{n} bonus UZS!",
  },
  "rating.task": { uz: "Ilovani baholash · +{n}", ru: "Оценить приложение · +{n}", en: "Rate the app · +{n}" },
  "rating.done": { uz: "Ilovani baholadingiz · +{n}", ru: "Вы оценили приложение · +{n}", en: "You rated the app · +{n}" },
  "bonus.paidTitle": { uz: "+{n}!", ru: "+{n}!", en: "+{n}!" },
  "bonus.joinText": {
    uz: "«{c}» kanaliga obuna bo‘lganingiz uchun.",
    ru: "За подписку на канал «{c}».",
    en: "For joining the channel «{c}».",
  },
  "bonus.joinStay": {
    uz: "{d} kun obuna bo‘lib qolsangiz — yana +{s}.",
    ru: "Останьтесь подписанным {d} дн. — и получите ещё +{s}.",
    en: "Stay subscribed for {d} days to get +{s} more.",
  },
  "bonus.stayText": {
    uz: "«{c}» kanalida {d} kun qolganingiz uchun rahmat! Bonus hamyoningizga qo‘shildi.",
    ru: "Спасибо, что остаётесь в канале «{c}» {d} дн.! Бонус зачислен в кошелёк.",
    en: "Thanks for staying in «{c}» for {d} days! The bonus is in your wallet.",
  },
  "toast.bonusPaid": { uz: "🎉 +{n}!", ru: "🎉 +{n}!", en: "🎉 +{n}!" },
  "toast.ratingLocked": {
    uz: "Baholash uchun avval kamida bitta hujjat yarating — tayyor bo‘lgach baholab, bonus olasiz.",
    ru: "Чтобы оценить приложение, сначала создайте хотя бы один документ — после готовности оцените и получите бонус.",
    en: "To rate the app, first create at least one document — rate it once it is ready and get the bonus.",
  },
  "toast.bonusDone": { uz: "✅ Bajarilgan", ru: "✅ Выполнено", en: "✅ Done" },
  "toast.bonusRefreshed": { uz: "Yangilandi", ru: "Обновлено", en: "Updated" },
  "toast.bonusAlready": { uz: "Bu vazifa allaqachon bajarilgan", ru: "Это задание уже выполнено", en: "This task is already done" },
  "mand.title": {
    uz: "Botdan to‘liq foydalanish uchun kanalga obuna bo‘ling",
    ru: "Чтобы пользоваться ботом полностью, подпишитесь на канал",
    en: "Join the channel to use the bot in full",
  },
  "mand.lead": {
    uz: "Obuna bo‘lmaguncha yangi hujjat yaratib bo‘lmaydi. Obuna bo‘lgach «Tekshirish»ni bosing.",
    ru: "Пока вы не подписаны, новые документы создавать нельзя. После подписки нажмите «Проверить».",
    en: "You cannot create new documents until you join. After joining, tap “Check”.",
  },
  "oferta.caption": {
    uz: "<b>Ommaviy oferta</b>\n\nSlaydX xizmatlaridan foydalanish shartlari ilova qilingan PDF'da. O‘qib chiqib, davom etish uchun «Qabul qilaman» tugmasini bosing.",
    ru: "<b>Публичная оферта</b>\n\nУсловия использования SlaydX — в приложенном PDF. Прочитайте и нажмите «Принимаю», чтобы продолжить.",
    en: "<b>Public offer</b>\n\nThe SlaydX terms of use are in the attached PDF. Read them and tap “I accept” to continue.",
  },
  "oferta.captionLink": {
    uz: "<b>Ommaviy oferta</b>\n\nSlaydX xizmatlaridan foydalanish shartlari saytda. PDF hozir tayyor emas — «Ofertani o‘qish» tugmasi orqali o‘qib chiqing, so‘ng «Qabul qilaman»ni bosing.",
    ru: "<b>Публичная оферта</b>\n\nУсловия использования SlaydX — на сайте. PDF сейчас недоступен: прочитайте оферту по кнопке «Читать оферту», затем нажмите «Принимаю».",
    en: "<b>Public offer</b>\n\nThe SlaydX terms of use are on the website. The PDF is not ready right now: read the offer with the “Read the offer” button, then tap “I accept”.",
  },
  "oferta.outdated": {
    uz: "Oferta yangilandi — iltimos, qaytadan o‘qing",
    ru: "Оферта обновлена — пожалуйста, прочитайте заново",
    en: "The offer was updated — please read it again",
  },
  "oferta.accept": { uz: "Qabul qilaman", ru: "Принимаю", en: "I accept" },
  "oferta.read": { uz: "Ofertani o‘qish", ru: "Читать оферту", en: "Read the offer" },
  "oferta.accepted": {
    uz: "Rahmat! Oferta qabul qilindi.",
    ru: "Спасибо! Оферта принята.",
    en: "Thank you! The offer is accepted.",
  },
  "mand.check": { uz: "Tekshirish", ru: "Проверить", en: "Check" },
  "mand.done": {
    uz: "Rahmat! Endi botdan to‘liq foydalanishingiz mumkin.",
    ru: "Спасибо! Теперь вы можете пользоваться ботом полностью.",
    en: "Thank you! You can now use the bot in full.",
  },
  "toast.mandMissing": {
    uz: "Hali hamma kanalga obuna bo‘lmagansiz",
    ru: "Вы ещё подписаны не на все каналы",
    en: "You have not joined every channel yet",
  },
  "toast.bonusNotMember": {
    uz: "Obuna topilmadi — avval kanalga obuna bo‘ling",
    ru: "Подписка не найдена — сначала подпишитесь на канал",
    en: "No subscription found — join the channel first",
  },
  "toast.bonusUnknown": {
    uz: "Hozir tekshirib bo‘lmadi — birozdan keyin qayta urinib ko‘ring",
    ru: "Сейчас не удалось проверить — попробуйте чуть позже",
    en: "Could not check right now — please try again a bit later",
  },
  "toast.bonusInactive": { uz: "Bu vazifa endi faol emas", ru: "Это задание больше не активно", en: "This task is no longer active" },
  "toast.bonusRate": {
    uz: "Juda tez — bir daqiqadan keyin qayta urinib ko‘ring",
    ru: "Слишком часто — попробуйте через минуту",
    en: "Too fast — please try again in a minute",
  },

  /* ── Yordam ── */
  "help.title": { uz: "Yordam", ru: "Помощь", en: "Help" },
  "help.about": {
    uz: "SlaydX bot — AI yordamida slayd, referat, kurs ishi, maqola, rasm va boshqa hujjatlarni yaratadi.",
    ru: "Бот SlaydX с помощью ИИ создаёт слайды, рефераты, курсовые, статьи, картинки и другие документы.",
    en: "The SlaydX bot uses AI to make slides, essays, course papers, articles, images and other documents.",
  },
  "help.how": {
    uz: "Qanday yaratiladi: pastdagi «Slayd», «Rasm» yoki «Pro slayd» tugmasini bosing — vosita ilovada ochiladi. Mavzuni yozing, narx oldindan ko‘rsatiladi; tayyor fayl «Ishlarim»da.",
    ru: "Как создать: нажмите внизу «Слайды», «Картинка» или «Pro слайды» — инструмент откроется в приложении. Напишите тему, цена видна заранее; готовый файл — в «Мои работы».",
    en: "How to create: tap “Slides”, “Image” or “Pro slides” below — the tool opens in the app. Type a topic, the price is shown up front; the finished file is in “My files”.",
  },
  "help.faq": { uz: "Ko‘p so‘raladigan savollar", ru: "Частые вопросы", en: "FAQ" },
  "help.q1": { uz: "Balans qanday to‘ldiriladi?", ru: "Как пополнить баланс?", en: "How do I top up?" },
  "help.a1": {
    uz: "«Hamyon» → «To‘ldirish»: Click yoki Payme orqali, ilovada.",
    ru: "«Кошелёк» → «Пополнить»: через Click или Payme, в приложении.",
    en: "“Wallet” → “Top up”: via Click or Payme, in the app.",
  },
  "help.q2": { uz: "Ish yaratilmasa pul nima bo‘ladi?", ru: "Что с деньгами, если работа не создалась?", en: "What if a file is not made?" },
  "help.a2": {
    uz: "Hujjat yaratilmasa, summa hisobingizga to‘liq qaytariladi.",
    ru: "Если документ не создан, сумма полностью возвращается на ваш баланс.",
    en: "If a document is not made, the amount goes back to your balance in full.",
  },
  "help.q3": { uz: "Bonus nima?", ru: "Что такое бонус?", en: "What is a bonus?" },
  "help.a3": {
    uz: "Bonus so‘mda hisoblanadi: ro‘yxatdan o‘tganda, har bir taklif qilingan do‘st, kanal obunasi va birinchi to‘ldirish uchun beriladi; to‘langan so‘m bilan birga sarflanadi. Hammasi «Hamyon / Bonus» → «Bonuslar»da.",
    ru: "Считается в бонусных сумах: даётся при регистрации, за каждого приглашённого друга, подписку на канал и первое пополнение; тратится вместе с оплаченными сумами. Всё — в «Кошелёк / Бонус» → «Бонусы».",
    en: "Counted in bonus UZS: given at sign-up, for every friend you invite, for joining channels and for your first top-up; spent together with paid UZS. See «Wallet / Bonus» → «Bonuses».",
  },
  "help.q4": { uz: "Profil nimaga kerak?", ru: "Зачем заполнять профиль?", en: "Why fill in the profile?" },
  "help.a4": {
    uz: "Ism, o‘qish va ish joyi titul sahifasiga avtomatik yoziladi.",
    ru: "Имя, место учёбы и работы автоматически попадают на титульный лист.",
    en: "Your name, study and workplace go onto title pages automatically.",
  },
  "help.q5": { uz: "Balansning muddati bormi?", ru: "Сгорает ли баланс?", en: "Does the balance expire?" },
  "help.a5": { uz: "Yo‘q, balans muddatsiz saqlanadi.", ru: "Нет, баланс хранится бессрочно.", en: "No, the balance never expires." },
  "btn.support": { uz: "Admin bilan bog‘lanish", ru: "Связаться с админом", en: "Contact the admin" },

  /* ── Payment reminder (worker DM, 5 min after an unpaid Click order) ── */
  "payReminder.text": {
    uz: "To‘lovingiz yakunlanmadi. Yordam kerakmi?",
    ru: "Ваш платёж не завершён. Нужна помощь?",
    en: "Your payment was not completed. Need help?",
  },
  "payReminder.help": { uz: "Yordam", ru: "Помощь", en: "Help" },
  "payReminder.retry": { uz: "Qayta to‘lash", ru: "Оплатить снова", en: "Pay again" },

  /* ── Daily logic quiz (lib/server/daily-quiz.ts; questions are Uzbek only) ── */
  "dq.invite": {
    uz: "🧠 Kunlik savollar: 3 ta savolga to‘g‘ri javob bering — +{n}!",
    ru: "🧠 Вопросы дня: ответьте правильно на 3 вопроса — +{n}!",
    en: "🧠 Daily questions: answer 3 questions correctly — +{n}!",
  },
  "dq.inviteNoReward": {
    uz: "🧠 Kunlik savollar: bugungi 3 ta mantiqiy savolga javob bering!",
    ru: "🧠 Вопросы дня: ответьте на 3 логических вопроса!",
    en: "🧠 Daily questions: try today’s 3 logic questions!",
  },
  "dq.ledger": { uz: "Kunlik savollar bonusi", ru: "Бонус за вопросы дня", en: "Daily questions bonus" },
  "dq.start": { uz: "Boshlash", ru: "Начать", en: "Start" },
  "dq.offBtn": { uz: "Obunani o‘chirish", ru: "Отписаться", en: "Unsubscribe" },
  "dq.onBtn": { uz: "Obunani yoqish", ru: "Подписаться", en: "Subscribe" },
  "dq.question": { uz: "Savol {i}/{n}", ru: "Вопрос {i}/{n}", en: "Question {i}/{n}" },
  "dq.right": { uz: "✅ To‘g‘ri!", ru: "✅ Верно!", en: "✅ Correct!" },
  "dq.wrong": { uz: "❌ Noto‘g‘ri. To‘g‘ri javob: {a}", ru: "❌ Неверно. Правильный ответ: {a}", en: "❌ Wrong. The right answer: {a}" },
  "dq.toastRight": { uz: "✅ To‘g‘ri!", ru: "✅ Верно!", en: "✅ Correct!" },
  "dq.toastWrong": { uz: "❌ Noto‘g‘ri", ru: "❌ Неверно", en: "❌ Wrong" },
  "dq.toastLocked": { uz: "Bu savolga javob allaqachon qabul qilingan", ru: "Ответ на этот вопрос уже принят", en: "This question is already answered" },
  "dq.won": {
    uz: "3/3 — +{n} hamyoningizga tushdi!",
    ru: "3/3 — +{n} зачислено на ваш кошелёк!",
    en: "3/3 — +{n} added to your wallet!",
  },
  "dq.lost": { uz: "{c}/3 — ertaga yana urinib ko‘ring", ru: "{c}/3 — попробуйте завтра снова", en: "{c}/3 — try again tomorrow" },
  "dq.none": { uz: "3/3 — barakalla!", ru: "3/3 — отлично!", en: "3/3 — well done!" },
  "dq.cap": {
    uz: "3/3 — barakalla! Lekin bu oy uchun kunlik savollar bonusi chegarasi ({n}) to‘lgan, bonus berilmaydi.",
    ru: "3/3 — отлично! Но месячный лимит бонуса за вопросы дня ({n}) исчерпан, бонус не начисляется.",
    en: "3/3 — well done! But this month’s daily-questions bonus limit ({n}) is used up, so no bonus is paid.",
  },
  "dq.budget": {
    uz: "3/3 — barakalla! Lekin bugungi bonus fondi tugadi, bonus berilmaydi. Ertaga yana urinib ko‘ring.",
    ru: "3/3 — отлично! Но бонусный фонд на сегодня закончился, бонус не начисляется. Попробуйте завтра.",
    en: "3/3 — well done! But today’s bonus fund is used up, so no bonus is paid. Try again tomorrow.",
  },
  "dq.done": {
    uz: "Siz bugungi savollarga allaqachon javob berdingiz ({c}/3). Yangi savollar ertaga.",
    ru: "Вы уже ответили на сегодняшние вопросы ({c}/3). Новые вопросы будут завтра.",
    en: "You already answered today’s questions ({c}/3). New ones tomorrow.",
  },
  "dq.disabled": { uz: "Kunlik savollar hozircha o‘chiq.", ru: "Вопросы дня сейчас отключены.", en: "Daily questions are switched off for now." },
  "dq.stale": {
    uz: "Bu savol eskirgan — yangisini /savol bilan oling.",
    ru: "Этот вопрос устарел — получите новый командой /savol.",
    en: "This question is out of date — get a new one with /savol.",
  },
  "dq.error": {
    uz: "Hozir bajarib bo‘lmadi, birozdan keyin qayta urinib ko‘ring.",
    ru: "Сейчас не получилось, попробуйте чуть позже.",
    en: "That did not work right now, please try again a bit later.",
  },
  "dq.offDone": {
    uz: "Kunlik savollar xabari o‘chirildi. Qayta yoqish: /obuna. Savollarni istalgan payt /savol orqali olishingiz mumkin.",
    ru: "Рассылка вопросов дня отключена. Включить снова: /obuna. Вопросы всегда можно получить командой /savol.",
    en: "The daily-questions message is switched off. Turn it back on with /obuna. You can always get the questions with /savol.",
  },
  "dq.onDone": {
    uz: "Kunlik savollar xabari yoqildi: har kuni ertalab 3 ta savol yuboramiz.",
    ru: "Рассылка вопросов дня включена: каждое утро мы будем присылать 3 вопроса.",
    en: "The daily-questions message is on: we will send 3 questions every morning.",
  },

  /* ── Til ── */
  "lang.title": { uz: "Bot tilini tanlang", ru: "Выберите язык бота", en: "Choose the bot language" },
  "lang.saved": { uz: "Bot tili: O‘zbekcha", ru: "Язык бота: русский", en: "Bot language: English" },

  /* ── Commands (setMyCommands) ── */
  "cmd.start": { uz: "Saytga kirish havolasi", ru: "Главное меню и вход", en: "Main menu and sign-in" },
  "cmd.login": { uz: "Yangi kirish havolasi", ru: "Новая ссылка для входа", en: "New sign-in link" },
  "cmd.taklif": { uz: "Do'stlarni taklif qilish havolasi", ru: "Ссылка для приглашения друзей", en: "Invite link for friends" },
  "cmd.admin": { uz: "Admin sifatida tasdiqlash", ru: "Подтвердить права админа", en: "Confirm admin rights" },
  "cmd.til": { uz: "Bot tilini o‘zgartirish", ru: "Сменить язык бота", en: "Change the bot language" },
  "cmd.alifbo": { uz: "Kirill ↔ Lotin ↔ Yangi lotin", ru: "Кириллица ↔ латиница ↔ новая латиница", en: "Cyrillic ↔ Latin ↔ new Latin" },
  "cmd.savol": { uz: "Kunlik 3 ta savol (bonus)", ru: "3 вопроса дня (бонус)", en: "Today’s 3 questions (bonus)" },
  "help.domla": {
    uz: "🎓 «Qattiqqo‘l domla»: slaydingizni domla oldida ovoz bilan himoya qiling — /domla yoki pastdagi tugma.",
    ru: "🎓 «Строгий профессор»: защитите слайды голосом перед профессором — /domla или кнопка ниже.",
    en: "🎓 “Strict Professor”: defend your slides out loud in front of a professor — /domla or the button below.",
  },
  "btn.domla": { uz: "Qattiqqo‘l domla", ru: "Строгий профессор", en: "Strict Professor" },
  "domla.cmd": { uz: "Qattiqqo‘l domla — slayd himoyasi", ru: "Строгий профессор — защита слайдов", en: "Strict Professor — defend your slides" },
  "cmd.obuna": { uz: "Kunlik savollar xabarini yoqish/o‘chirish", ru: "Включить/выключить вопросы дня", en: "Turn the daily questions on/off" },
  "menu.app": { uz: "Ilova", ru: "Приложение", en: "App" },

  /* ── AI chat (owner request 8; keys are prefixed `chat.`) ── */
  "chat.cmd": { uz: "AI yordamchi bilan suhbat", ru: "Чат с ИИ-помощником", en: "Chat with the AI assistant" },
  "chat.cmdStop": { uz: "AI suhbatni tugatish", ru: "Завершить чат с ИИ", en: "End the AI chat" },
  "chat.on": {
    uz: "AI yordamchi yoqildi. Savol bering yoki hujjat buyuring — masalan: «Suv haqida 10 slaydli taqdimot qil».\nTugatish: /stop\n{free}",
    ru: "ИИ-помощник включён. Задайте вопрос или закажите документ — например: «Сделай презентацию на 10 слайдов про воду».\nЗавершить: /stop\n{free}",
    en: "The AI assistant is on. Ask a question or order a document — e.g. “Make a 10-slide presentation about water”.\nEnd: /stop\n{free}",
  },
  "chat.off": {
    uz: "AI suhbat tugadi. Oddiy menyuga qaytdingiz.",
    ru: "Чат с ИИ завершён. Вы вернулись в обычное меню.",
    en: "The AI chat has ended. You are back in the normal menu.",
  },
  "chat.offAlready": {
    uz: "AI suhbat yoqilmagan. Boshlash: /chat",
    ru: "Чат с ИИ не включён. Начать: /chat",
    en: "The AI chat is not on. Start it with /chat",
  },
  "chat.free": { uz: "Bugun tekin: {left}/{limit}", ru: "Бесплатно сегодня: {left}/{limit}", en: "Free today: {left}/{limit}" },
  "chat.next": { uz: "Keyingi xabar: {price}", ru: "Следующее сообщение: {price}", en: "Next message: {price}" },
  "chat.price": { uz: "Narx: {price}", ru: "Цена: {price}", en: "Price: {price}" },
  "chat.expires": {
    uz: "10 daqiqa ichida tasdiqlang.",
    ru: "Подтвердите в течение 10 минут.",
    en: "Confirm within 10 minutes.",
  },
  "chat.yes": { uz: "Tasdiqlash", ru: "Подтвердить", en: "Confirm" },
  "chat.no": { uz: "Bekor qilish", ru: "Отмена", en: "Cancel" },
  "chat.topup": { uz: "Hamyonni to‘ldirish", ru: "Пополнить кошелёк", en: "Top up the wallet" },
  "chat.openFiles": { uz: "Ishlarim", ru: "Мои работы", en: "My files" },
  "chat.cancelled": { uz: "Bekor qilindi.", ru: "Отменено.", en: "Cancelled." },
  "chat.started": {
    uz: "Boshlandi! Natijani «Ishlarim» bo‘limida kuzating.",
    ru: "Запущено! Следите за результатом в разделе «Мои работы».",
    en: "Started! Follow the result in “My files”.",
  },
  "chat.adjust": {
    uz: "{tool}: ma’lumotni to‘g‘rilash kerak:\n{issues}\nYetishmayotgan qiymatni yozing — kartani qayta tayyorlayman.",
    ru: "{tool}: нужно поправить данные:\n{issues}\nНапишите недостающее — я подготовлю карточку заново.",
    en: "{tool}: the details need fixing:\n{issues}\nSend the missing value and I will prepare the card again.",
  },
  "chat.err.disabled": { uz: "AI chat hozircha o‘chirilgan.", ru: "ИИ-чат сейчас отключён.", en: "The AI chat is switched off for now." },
  "chat.err.insufficient": {
    uz: "Bugungi tekin xabarlar tugadi. Davom etish uchun {price} kerak, hamyonda {have} bor.",
    ru: "Бесплатные сообщения на сегодня закончились. Чтобы продолжить, нужно {price}, в кошельке {have}.",
    en: "Today’s free messages are used up. To continue you need {price}; the wallet has {have}.",
  },
  "chat.err.freeExhausted": {
    uz: "Bugungi tekin xabarlar tugadi — ertaga (Toshkent vaqti bilan 00:00 dan keyin) davom eting.",
    ru: "Бесплатные сообщения на сегодня закончились — продолжайте завтра (после 00:00 по Ташкенту).",
    en: "Today’s free messages are used up — continue tomorrow (after 00:00 Tashkent time).",
  },
  "chat.err.busy": { uz: "Xabar hali qayta ishlanmoqda — biroz kuting.", ru: "Сообщение ещё обрабатывается — подождите.", en: "The message is still being processed — please wait." },
  "chat.err.noAnswer": {
    uz: "AI hozir javob bermadi. Birozdan keyin qayta urinib ko‘ring (pul yechilmadi).",
    ru: "ИИ сейчас не ответил. Попробуйте чуть позже (деньги не списаны).",
    en: "The AI did not answer. Try again in a moment (nothing was charged).",
  },
  "chat.err.rate": { uz: "Juda tez yozyapsiz — biroz kuting.", ru: "Вы пишете слишком быстро — подождите.", en: "You are writing too fast — please wait." },
  "chat.err.generic": { uz: "Xabarni yuborib bo‘lmadi. Qayta urinib ko‘ring.", ru: "Не удалось отправить сообщение. Попробуйте ещё раз.", en: "The message could not be sent. Please try again." },
  "chat.err.invalid": { uz: "Bu tugma eskirgan. Taklifni qaytadan so‘rang.", ru: "Эта кнопка устарела. Запросите предложение заново.", en: "This button is out of date. Ask for the proposal again." },
  "chat.err.used": { uz: "Bu taklif allaqachon ishlatilgan.", ru: "Это предложение уже использовано.", en: "This proposal was already used." },
  "chat.err.expired": { uz: "Taklif muddati tugadi — qaytadan so‘rang.", ru: "Срок предложения истёк — запросите заново.", en: "The proposal expired — ask again." },
  "chat.err.priceChanged": {
    uz: "Narx o‘zgardi: {price}. Taklifni qaytadan so‘rang.",
    ru: "Цена изменилась: {price}. Запросите предложение заново.",
    en: "The price changed: {price}. Ask for the proposal again.",
  },
  "chat.err.confirmInsufficient": {
    uz: "Balans yetarli emas: kerak {price}, mavjud {have}. Hamyonni to‘ldirib, «Tasdiqlash» ni qayta bosing.",
    ru: "Недостаточно средств: нужно {price}, доступно {have}. Пополните кошелёк и снова нажмите «Подтвердить».",
    en: "Not enough balance: {price} needed, {have} available. Top up and tap “Confirm” again.",
  },
  "chat.err.refused": { uz: "Hozir yaratib bo‘lmadi: {reason}", ru: "Сейчас создать нельзя: {reason}", en: "Cannot create it now: {reason}" },
} as const satisfies Record<string, Entry>;

export type TextKey = keyof typeof T;

/** The text of `key` in `lang` with `{name}` placeholders filled. */
export function t(lang: Lang, key: TextKey, vars: Record<string, string | number> = {}): string {
  const s: string = T[key][lang] ?? T[key].uz;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Every key (tests check that all three languages are filled). */
export const TEXT_KEYS = Object.keys(T) as TextKey[];
export function rawEntry(key: TextKey): Entry {
  return T[key];
}

/** `users.language` → a bot language (anything unknown → uz). */
export function langOf(value: unknown): Lang {
  return isBotLanguage(value) ? value : "uz";
}

/** Telegram `language_code` → the default for a NEW user: ru → ru, en → en, else uz. */
export function langFromTelegram(code: string | null | undefined): Lang {
  const base = String(code ?? "").toLowerCase().split(/[-_]/)[0];
  return base === "ru" ? "ru" : base === "en" ? "en" : "uz";
}

/** Native names on the language buttons (never translated). */
export const LANG_NAMES: Record<Lang, string> = { uz: "O‘zbekcha", ru: "Русский", en: "English" };

/* ── Profile fields: label, prompt, example ── */

type FieldText = { label: Entry; prompt: Entry; example: Entry };

export const FIELD_TEXT: Record<ProfileField, FieldText> = {
  name: {
    label: { uz: "Ism", ru: "Имя", en: "Name" },
    prompt: { uz: "Ismingizni yozing", ru: "Напишите ваше имя", en: "Type your name" },
    example: { uz: "Dilnoza", ru: "Дильноза", en: "Dilnoza" },
  },
  author: {
    label: { uz: "Muallif (F.I.Sh)", ru: "Автор (ФИО)", en: "Author (full name)" },
    prompt: { uz: "Muallifning to‘liq ismini yozing", ru: "Напишите ФИО автора", en: "Type the author’s full name" },
    example: { uz: "Karimova Dilnoza Akmalovna", ru: "Каримова Дильноза Акмаловна", en: "Karimova Dilnoza Akmalovna" },
  },
  city: {
    label: { uz: "Shahar", ru: "Город", en: "City" },
    prompt: { uz: "Shahar nomini yozing", ru: "Напишите город", en: "Type your city" },
    example: { uz: "Toshkent", ru: "Ташкент", en: "Tashkent" },
  },
  university: {
    label: { uz: "Universitet", ru: "Университет", en: "University" },
    prompt: { uz: "Universitet nomini yozing", ru: "Напишите название университета", en: "Type the university name" },
    example: {
      uz: "Toshkent davlat pedagogika universiteti",
      ru: "Ташкентский государственный педагогический университет",
      en: "Tashkent State Pedagogical University",
    },
  },
  faculty: {
    label: { uz: "Fakultet", ru: "Факультет", en: "Faculty" },
    prompt: { uz: "Fakultet nomini yozing", ru: "Напишите название факультета", en: "Type the faculty name" },
    example: { uz: "Tarix fakulteti", ru: "Исторический факультет", en: "Faculty of History" },
  },
  department: {
    label: { uz: "Kafedra", ru: "Кафедра", en: "Department" },
    prompt: { uz: "Kafedra nomini yozing", ru: "Напишите название кафедры", en: "Type the department name" },
    example: { uz: "Jahon tarixi kafedrasi", ru: "Кафедра всемирной истории", en: "Department of World History" },
  },
  group: {
    label: { uz: "Guruh", ru: "Группа", en: "Group" },
    prompt: { uz: "Guruhingizni yozing", ru: "Напишите вашу группу", en: "Type your group" },
    example: { uz: "301-guruh", ru: "301", en: "301" },
  },
  course: {
    label: { uz: "Kurs", ru: "Курс", en: "Year" },
    prompt: { uz: "Nechanchi kursdasiz? Raqam yetarli", ru: "На каком вы курсе? Достаточно цифры", en: "Which year are you in? A number is enough" },
    example: { uz: "3", ru: "3", en: "3" },
  },
  position: {
    label: { uz: "Lavozim", ru: "Должность", en: "Position" },
    prompt: { uz: "Lavozimingizni yozing", ru: "Напишите вашу должность", en: "Type your position" },
    example: { uz: "tarix fani o‘qituvchisi", ru: "учитель истории", en: "history teacher" },
  },
  organization: {
    label: { uz: "Tashkilot", ru: "Организация", en: "Organisation" },
    prompt: { uz: "Tashkilot (maktab, markaz) nomini yozing", ru: "Напишите организацию (школа, центр)", en: "Type your organisation (school, centre)" },
    example: { uz: "45-umumta’lim maktabi", ru: "Школа № 45", en: "School No. 45" },
  },
  subject: {
    label: { uz: "Fan", ru: "Предмет", en: "Subject" },
    prompt: { uz: "Fan nomini yozing", ru: "Напишите предмет", en: "Type the subject" },
    example: { uz: "Tarix", ru: "История", en: "History" },
  },
  teacher: {
    label: { uz: "Ilmiy rahbar", ru: "Научный руководитель", en: "Supervisor" },
    prompt: { uz: "Ilmiy rahbar (o‘qituvchi) ismini yozing", ru: "Напишите имя научного руководителя", en: "Type your supervisor’s name" },
    example: { uz: "Aliyev Jasur", ru: "Алиев Жасур", en: "Aliyev Jasur" },
  },
};

export function fieldText(lang: Lang, field: ProfileField, part: keyof FieldText): string {
  return FIELD_TEXT[field][part][lang];
}

export function sectionKey(step: FieldStepId, part: "button" | "title" | "lead" | "saved"): TextKey {
  if (part === "button") return `sec.${step}` as TextKey;
  if (part === "saved") return `saved.${step}` as TextKey;
  return `sec.${step}.${part}` as TextKey;
}

/* ── Tool titles (file list, ledger) — the web names in Uzbek, translated here ── */

const TOOL_TITLES: Record<string, { ru: string; en: string }> = {
  slide: { ru: "Слайды", en: "Slides" },
  "pro-slide": { ru: "Pro слайды", en: "Pro slides" },
  image: { ru: "Картинка", en: "Image" },
  coursework: { ru: "Курсовая работа", en: "Course paper" },
  referat: { ru: "Реферат", en: "Report" },
  essay: { ru: "Эссе", en: "Essay" },
  article: { ru: "Статья", en: "Article" },
  resume: { ru: "Резюме", en: "Résumé" },
  thesis: { ru: "Тезисы", en: "Abstract" },
  translation: { ru: "Переводчик", en: "Translator" },
  "texnologik-xarita": { ru: "Технологическая карта", en: "Lesson flow chart" },
  glossary: { ru: "Глоссарий", en: "Glossary" },
  keys: { ru: "Кейсы", en: "Case studies" },
  "mustaqil-ish": { ru: "Самостоятельная работа", en: "Independent assignment" },
  "lesson-plan": { ru: "План урока", en: "Lesson plan" },
  test: { ru: "Тест", en: "Test" },
  crossword: { ru: "Кроссворд", en: "Crossword" },
  flashcards: { ru: "Флеш-карточки", en: "Flashcards" },
  infographic: { ru: "Инфографика", en: "Infographic" },
  sorting: { ru: "Игра «Сортировка»", en: "Sorting game" },
  listening: { ru: "Игра на аудирование", en: "Listening game" },
  podcast: { ru: "Подкаст", en: "Podcast" },
  greeting: { ru: "Поздравительная открытка", en: "Greeting card" },
  portrait: { ru: "Выпускной портрет", en: "Graduation portrait" },
  video: { ru: "Создание видео", en: "Video creation" },
};

/** A tool's title in `lang` — the Uzbek web title for uz (or an unknown id in any language). */
export function toolTitle(lang: Lang, toolId: string, uzTitle: string): string {
  if (lang === "uz") return uzTitle;
  return TOOL_TITLES[toolId]?.[lang] ?? uzTitle;
}
