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
    uz: "Do‘st taklif qiling — har biriga <b>{n}</b>",
    ru: "Приглашайте друзей — <b>{n}</b> за каждого",
    en: "Invite friends — <b>{n}</b> for each",
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
    uz: "Har bir yangi do'st uchun {n} ball. Do'stingiz ilovaga birinchi marta kirganda hisoblanadi.",
    ru: "{n} баллов за каждого нового друга. Начисляются, когда друг впервые войдёт в приложение.",
    en: "{n} points for every new friend. Counted when your friend opens the app for the first time.",
  },
  "ref.link": { uz: "Sizning havolangiz:", ru: "Ваша ссылка:", en: "Your link:" },
  "ref.counts": {
    uz: "Taklif qilinganlar: <b>{a}</b> · Ishlangan ball: <b>{b}</b>",
    ru: "Приглашено: <b>{a}</b> · Заработано баллов: <b>{b}</b>",
    en: "Invited: <b>{a}</b> · Points earned: <b>{b}</b>",
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
    uz: "{total} tanga · {star} {points} ball",
    ru: "{total} монет · {star} {points} баллов",
    en: "{total} coins · {star} {points} points",
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
    uz: "Hisobingiz vaqtincha bloklangan. Savol bo‘lsa, admin bilan bog‘laning.",
    ru: "Ваш аккаунт временно заблокирован. Если есть вопросы, свяжитесь с администратором.",
    en: "Your account is temporarily blocked. Please contact the admin if you have questions.",
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
  "wallet.bonus": { uz: "Shundan bonus: {n}", ru: "Из них бонус: {n}", en: "Of which bonus: {n}" },
  "wallet.recent": { uz: "So‘nggi amallar", ru: "Последние операции", en: "Recent activity" },
  "wallet.none": { uz: "Hali amallar yo‘q.", ru: "Операций пока нет.", en: "No activity yet." },
  "wallet.payNote": {
    uz: "To‘lov ilovada — Click yoki Payme orqali. Hujjat yaratilmasa, pul to‘liq qaytariladi.",
    ru: "Оплата — в приложении, через Click или Payme. Если документ не создан, деньги вернутся полностью.",
    en: "Payment is in the app, via Click or Payme. If a document is not made, you get a full refund.",
  },
  "btn.topup": { uz: "To‘ldirish", ru: "Пополнить", en: "Top up" },
  "btn.inviteFriend": { uz: "Do‘st taklif qilish", ru: "Пригласить друга", en: "Invite a friend" },
  "btn.backWallet": { uz: "Hamyonga qaytish", ru: "Назад в кошелёк", en: "Back to wallet" },
  "unit.tanga": { uz: "{n} tanga", ru: "{n} монет", en: "{n} coins" },
  "unit.ball": { uz: "{n} ball", ru: "{n} баллов", en: "{n} points" },
  "ledger.charge": { uz: "Hujjat uchun to‘lov", ru: "Оплата документа", en: "Document payment" },
  "ledger.refund": { uz: "Pul qaytarildi", ru: "Возврат", en: "Refund" },
  "ledger.topup": { uz: "Balans to‘ldirildi", ru: "Пополнение баланса", en: "Balance top-up" },
  "ledger.topupVia": { uz: "To‘ldirish · {p}", ru: "Пополнение · {p}", en: "Top-up · {p}" },
  "ledger.bonus": { uz: "Bonus ball", ru: "Бонусные баллы", en: "Bonus points" },
  "ledger.bonusFriend": { uz: "Taklif bonusi · {f}", ru: "Бонус за приглашение · {f}", en: "Invite bonus · {f}" },
  "ledger.signup": { uz: "Ro‘yxatdan o‘tish bonusi", ru: "Бонус за регистрацию", en: "Sign-up bonus" },
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

  /* ── Bonus olish (docs/bonus/PLAN.md) ── */
  "btn.bonus": { uz: "Bonus olish", ru: "Получить бонус", en: "Get bonuses" },
  "bonus.title": { uz: "Bonus olish", ru: "Получить бонус", en: "Get bonuses" },
  "bonus.lead": {
    uz: "Vazifalarni bajaring va ball oling. Ball xizmatlar uchun tanga kabi sarflanadi.",
    ru: "Выполняйте задания и получайте баллы. Баллы тратятся на услуги так же, как монеты.",
    en: "Complete tasks to earn points. Points pay for services just like coins.",
  },
  "bonus.earned": { uz: "Bonuslardan topilgan: <b>{n}</b>", ru: "Заработано на бонусах: <b>{n}</b>", en: "Earned from bonuses: <b>{n}</b>" },
  "bonus.invite": { uz: "Do‘st taklif qilish: +{n} har biri", ru: "Пригласить друга: +{n} за каждого", en: "Invite a friend: +{n} each" },
  "bonus.inviteCounts": {
    uz: "Taklif qilinganlar: <b>{a}</b> · topilgan: <b>{b}</b>",
    ru: "Приглашено: <b>{a}</b> · заработано: <b>{b}</b>",
    en: "Invited: <b>{a}</b> · earned: <b>{b}</b>",
  },
  "bonus.rewardJoin": { uz: "+{n}", ru: "+{n}", en: "+{n}" },
  "bonus.rewardJoinStay": {
    uz: "+{n}, {d} kundan keyin yana +{s}",
    ru: "+{n}, через {d} дн. ещё +{s}",
    en: "+{n}, then +{s} more after {d} days",
  },
  "bonus.stateNew": { uz: "Yangi", ru: "Новое", en: "New" },
  "bonus.stateDone": { uz: "Olindi", ru: "Получено", en: "Claimed" },
  "bonus.stateWait": { uz: "{d} kun: {n} kun qoldi", ru: "{d} дн.: осталось {n} дн.", en: "{d} days: {n} days left" },
  "bonus.stateDue": {
    uz: "{d} kun o‘tdi — tez orada tekshiriladi",
    ru: "{d} дн. прошло — скоро проверим",
    en: "{d} days passed — checking soon",
  },
  "bonus.none": {
    uz: "Hozircha kanal vazifalari yo‘q — tez orada qo‘shiladi.",
    ru: "Пока заданий с каналами нет — скоро появятся.",
    en: "No channel tasks yet — more are coming soon.",
  },
  "bonus.hint": {
    uz: "Kanalga obuna bo‘ling, so‘ng «Tekshirish»ni bosing.",
    ru: "Подпишитесь на канал, затем нажмите «Проверить».",
    en: "Join the channel, then tap «Check».",
  },
  "bonus.celebrateTitle": { uz: "+{n} ball!", ru: "+{n} баллов!", en: "+{n} points!" },
  "bonus.celebrateJoin": {
    uz: "«{c}» obunasi uchun ball hamyoningizga qo‘shildi.",
    ru: "Баллы за подписку на «{c}» зачислены в кошелёк.",
    en: "Points for joining «{c}» are in your wallet.",
  },
  "bonus.celebrateStay": {
    uz: "{d} kun obuna bo‘lib qolsangiz — yana +{s} ball.",
    ru: "Останьтесь подписанным {d} дн. — и получите ещё +{s} баллов.",
    en: "Stay subscribed for {d} days to get +{s} more points.",
  },
  "bonus.confirmed": { uz: "Obuna tasdiqlandi", ru: "Подписка подтверждена", en: "Subscription confirmed" },
  "bonus.stayText": {
    uz: "«{c}» kanalida {d} kun qolganingiz uchun rahmat! Ball hamyoningizga qo‘shildi.",
    ru: "Спасибо, что остаётесь в канале «{c}» {d} дн.! Баллы зачислены в кошелёк.",
    en: "Thanks for staying in «{c}» for {d} days! The points are in your wallet.",
  },
  "btn.subscribe": { uz: "{i}. Obuna bo‘lish", ru: "{i}. Подписаться", en: "{i}. Join" },
  "btn.check": { uz: "{i}. Tekshirish", ru: "{i}. Проверить", en: "{i}. Check" },
  "btn.moreTasks": { uz: "Boshqa vazifalar", ru: "Другие задания", en: "More tasks" },
  "toast.bonusPaid": { uz: "🎉 +{n} ball!", ru: "🎉 +{n} баллов!", en: "🎉 +{n} points!" },
  "toast.bonusAlready": { uz: "Bu vazifa allaqachon bajarilgan", ru: "Это задание уже выполнено", en: "This task is already done" },
  "toast.bonusNotMember": {
    uz: "Avval kanalga obuna bo‘ling, so‘ng «Tekshirish»ni bosing",
    ru: "Сначала подпишитесь на канал, затем нажмите «Проверить»",
    en: "Join the channel first, then tap «Check»",
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
    uz: "Hujjat yaratilmasa, tanga to‘liq qaytariladi.",
    ru: "Если документ не создан, монеты возвращаются полностью.",
    en: "If a document is not made, the coins are fully refunded.",
  },
  "help.q3": { uz: "Ball nima?", ru: "Что такое баллы?", en: "What are points?" },
  "help.a3": {
    uz: "Bonus: ro‘yxatdan o‘tganda va har bir taklif qilingan do‘st uchun beriladi, tanga bilan birga sarflanadi.",
    ru: "Бонус: даётся при регистрации и за каждого приглашённого друга, тратится вместе с монетами.",
    en: "A bonus: given at sign-up and for every friend you invite, spent together with coins.",
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

  /* ── Til ── */
  "lang.title": { uz: "Bot tilini tanlang", ru: "Выберите язык бота", en: "Choose the bot language" },
  "lang.saved": { uz: "Bot tili: O‘zbekcha", ru: "Язык бота: русский", en: "Bot language: English" },

  /* ── Commands (setMyCommands) ── */
  "cmd.start": { uz: "Saytga kirish havolasi", ru: "Главное меню и вход", en: "Main menu and sign-in" },
  "cmd.login": { uz: "Yangi kirish havolasi", ru: "Новая ссылка для входа", en: "New sign-in link" },
  "cmd.taklif": { uz: "Do'stlarni taklif qilish havolasi", ru: "Ссылка для приглашения друзей", en: "Invite link for friends" },
  "cmd.admin": { uz: "Admin sifatida tasdiqlash", ru: "Подтвердить права админа", en: "Confirm admin rights" },
  "cmd.til": { uz: "Bot tilini o‘zgartirish", ru: "Сменить язык бота", en: "Change the bot language" },
  "menu.app": { uz: "Ilova", ru: "Приложение", en: "App" },
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
};

/** A tool's title in `lang` — the Uzbek web title for uz (or an unknown id in any language). */
export function toolTitle(lang: Lang, toolId: string, uzTitle: string): string {
  if (lang === "uz") return uzTitle;
  return TOOL_TITLES[toolId]?.[lang] ?? uzTitle;
}
