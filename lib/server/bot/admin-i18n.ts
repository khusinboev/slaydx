import type { Lang } from "./i18n";

/**
 * Texts of the in-bot admin panel (docs/bot-admin/PLAN.md) in the admin's bot
 * language (uz source, ru, en). Kept apart from `i18n.ts` (the user bot) so the
 * admin copy never leaks into user screens. Values are interpolated as `{name}`
 * and inserted as given: callers escape user data (`ui.ts esc`).
 *
 * Error messages that come from the shared admin services (`ApiError`) are
 * Uzbek in every language — the same text the web panel shows.
 */

type Entry = { uz: string; ru: string; en: string };

const A = {
  /* ── Keyboard / entry ── */
  "kb.admin": { uz: "Admin", ru: "Админ", en: "Admin" },

  /* ── Panel ── */
  "panel.title": { uz: "Admin panel", ru: "Админ-панель", en: "Admin panel" },
  "panel.lead": {
    uz: "{name}, rolingiz: <b>{role}</b>.\nKerakli bo‘limni tanlang.",
    ru: "{name}, ваша роль: <b>{role}</b>.\nВыберите раздел.",
    en: "{name}, your role: <b>{role}</b>.\nPick a section.",
  },
  "panel.stats": { uz: "Statistika", ru: "Статистика", en: "Statistics" },
  "panel.broadcast": { uz: "Xabar yuborish", ru: "Рассылка", en: "Broadcast" },
  "panel.channels": { uz: "Kanal ulash", ru: "Каналы", en: "Channels" },
  "panel.payBonus": { uz: "To‘lov bonusi: {p}%", ru: "Бонус за пополнение: {p}%", en: "Payment bonus: {p}%" },
  "panel.close": { uz: "Yopish", ru: "Закрыть", en: "Close" },
  "panel.closed": {
    uz: "Admin panel yopildi. Qayta ochish: /admin yoki «🛠 Admin» tugmasi.",
    ru: "Админ-панель закрыта. Открыть снова: /admin или кнопка «🛠 Админ».",
    en: "Admin panel closed. Open it again with /admin or the “🛠 Admin” button.",
  },
  "btn.back": { uz: "Orqaga", ru: "Назад", en: "Back" },
  "btn.cancel": { uz: "Bekor qilish", ru: "Отмена", en: "Cancel" },
  "btn.panel": { uz: "Admin panel", ru: "Админ-панель", en: "Admin panel" },
  "btn.refresh": { uz: "Yangilash", ru: "Обновить", en: "Refresh" },

  /* ── Roles ── */
  "role.owner": { uz: "ega", ru: "владелец", en: "owner" },
  "role.admin": { uz: "admin", ru: "админ", en: "admin" },
  "role.finance": { uz: "moliya", ru: "финансы", en: "finance" },
  "role.support": { uz: "yordam", ru: "поддержка", en: "support" },
  "role.moderator": { uz: "moderator", ru: "модератор", en: "moderator" },
  "role.viewer": { uz: "kuzatuvchi", ru: "наблюдатель", en: "viewer" },

  /* ── Toasts ── */
  "toast.denied": { uz: "Ruxsat yo‘q", ru: "Нет доступа", en: "Not allowed" },
  "toast.rate": { uz: "Juda tez — birozdan keyin urinib ko‘ring", ru: "Слишком часто — попробуйте чуть позже", en: "Too fast — try again in a moment" },
  "toast.expired": { uz: "Bu qadam eskirgan — qaytadan boshlang", ru: "Этот шаг устарел — начните заново", en: "This step expired — start again" },
  "toast.old": { uz: "Bu tugma eskirgan", ru: "Эта кнопка устарела", en: "This button is out of date" },
  "toast.cancelled": { uz: "Bekor qilindi", ru: "Отменено", en: "Cancelled" },
  "toast.refreshed": { uz: "Yangilandi", ru: "Обновлено", en: "Refreshed" },
  "toast.testSent": { uz: "🧪 Sinov xabari yuborildi", ru: "🧪 Тестовое сообщение отправлено", en: "🧪 Test message sent" },
  "toast.testFailed": {
    uz: "Sinov yuborilmadi — Telegram qabul qilmadi",
    ru: "Тест не отправлен — Telegram не принял",
    en: "The test was not sent — Telegram refused it",
  },
  "toast.queued": { uz: "✅ Navbatga qo‘yildi", ru: "✅ Поставлено в очередь", en: "✅ Queued" },
  "toast.countChanged": {
    uz: "Auditoriya o‘zgardi: hozir {n} kishi — qayta tasdiqlang",
    ru: "Аудитория изменилась: сейчас {n} — подтвердите снова",
    en: "The audience changed: now {n} — confirm again",
  },
  "toast.stopped": { uz: "⛔ To‘xtatildi", ru: "⛔ Остановлено", en: "⛔ Stopped" },
  "toast.chCreated": { uz: "✅ Kanal ulandi", ru: "✅ Канал подключён", en: "✅ Channel connected" },
  "toast.chOn": { uz: "✅ Yoqildi", ru: "✅ Включён", en: "✅ Enabled" },
  "toast.chOff": { uz: "⏸ To‘xtatildi", ru: "⏸ Приостановлен", en: "⏸ Paused" },
  "toast.stepUpOk": { uz: "🔐 Tasdiqlandi", ru: "🔐 Подтверждено", en: "🔐 Confirmed" },
  "toast.error": { uz: "Xatolik: {msg}", ru: "Ошибка: {msg}", en: "Error: {msg}" },

  /* ── Statistika ── */
  "st.title": { uz: "Statistika", ru: "Статистика", en: "Statistics" },
  "st.users": { uz: "Foydalanuvchilar", ru: "Пользователи", en: "Users" },
  "st.usersLine": {
    uz: "Jami: <b>{total}</b> · bugun +{today} · 7 kun +{week}",
    ru: "Всего: <b>{total}</b> · сегодня +{today} · 7 дней +{week}",
    en: "Total: <b>{total}</b> · today +{today} · 7 days +{week}",
  },
  "st.active": { uz: "Faol (30 kun): <b>{n}</b>", ru: "Активные (30 дней): <b>{n}</b>", en: "Active (30 days): <b>{n}</b>" },
  "st.docs": { uz: "Hujjatlar", ru: "Документы", en: "Documents" },
  "st.docsLine": { uz: "Bugun: <b>{today}</b> · 7 kun: <b>{week}</b>", ru: "Сегодня: <b>{today}</b> · 7 дней: <b>{week}</b>", en: "Today: <b>{today}</b> · 7 days: <b>{week}</b>" },
  "st.top": { uz: "Top vositalar (7 kun):", ru: "Топ инструментов (7 дней):", en: "Top tools (7 days):" },
  "st.none": { uz: "hali yo‘q", ru: "пока нет", en: "none yet" },
  "st.money": { uz: "Tushum (so‘m)", ru: "Выручка (сум)", en: "Revenue (UZS)" },
  "st.moneyLine": {
    uz: "Bugun: <b>{today}</b> ({todayN}) · 7 kun: <b>{week}</b> ({weekN})\n30 kun: <b>{month}</b> · to‘langan buyurtmalar: <b>{monthN}</b>",
    ru: "Сегодня: <b>{today}</b> ({todayN}) · 7 дней: <b>{week}</b> ({weekN})\n30 дней: <b>{month}</b> · оплаченных заказов: <b>{monthN}</b>",
    en: "Today: <b>{today}</b> ({todayN}) · 7 days: <b>{week}</b> ({weekN})\n30 days: <b>{month}</b> · paid orders: <b>{monthN}</b>",
  },
  "st.bonus": { uz: "Bonuslar (to‘langan, jami)", ru: "Бонусы (выплачено, всего)", en: "Bonuses (paid, all time)" },
  "st.bonus.join": { uz: "Kanalga obuna", ru: "Подписка на канал", en: "Channel join" },
  "st.bonus.stay": { uz: "Kanalda qolish", ru: "Остался в канале", en: "Channel stay" },
  "st.bonus.invite": { uz: "Do‘st taklifi", ru: "Приглашение друга", en: "Invite" },
  "st.bonus.signup": { uz: "Ro‘yxatdan o‘tish", ru: "Регистрация", en: "Sign-up" },
  "st.bonus.pay": { uz: "To‘lov bonusi", ru: "Бонус за пополнение", en: "Payment bonus" },
  "st.bonus.first": { uz: "Birinchi to‘ldirish", ru: "Первое пополнение", en: "First top-up" },
  "st.bonus.other": { uz: "Boshqa", ru: "Другое", en: "Other" },
  "st.bonusLine": { uz: "{label}: <b>{sum}</b> ({n} ta)", ru: "{label}: <b>{sum}</b> ({n})", en: "{label}: <b>{sum}</b> ({n})" },
  "st.channels": { uz: "Faol kanallar", ru: "Активные каналы", en: "Active channels" },
  "st.channelLine": {
    uz: "{title}: <b>{members}</b> obunachi · bonus orqali {joined}",
    ru: "{title}: <b>{members}</b> подписчиков · через бонус {joined}",
    en: "{title}: <b>{members}</b> subscribers · via bonus {joined}",
  },
  "st.noChannels": { uz: "Faol kanal yo‘q", ru: "Нет активных каналов", en: "No active channels" },
  "st.at": { uz: "Holat: {time} (Toshkent)", ru: "На {time} (Ташкент)", en: "As of {time} (Tashkent)" },

  /* ── Xabar yuborish ── */
  "bc.title": { uz: "Xabar yuborish", ru: "Рассылка", en: "Broadcast" },
  "bc.ask": {
    uz: "Foydalanuvchilarga yuboriladigan xabarni shu yerga yuboring: <b>matn</b>, yoki izohli <b>rasm</b> / <b>video</b>.\nFormatlash (qalin, kursiv, havola) saqlanadi.\n\n⏳ 10 daqiqa kutaman.",
    ru: "Пришлите сюда сообщение для рассылки: <b>текст</b> или <b>фото</b> / <b>видео</b> с подписью.\nФорматирование (жирный, курсив, ссылки) сохранится.\n\n⏳ Жду 10 минут.",
    en: "Send the message for the broadcast here: <b>text</b>, or a <b>photo</b> / <b>video</b> with a caption.\nFormatting (bold, italic, links) is kept.\n\n⏳ I wait 10 minutes.",
  },
  "bc.badType": {
    uz: "Faqat matn, rasm yoki video yuboring.",
    ru: "Пришлите только текст, фото или видео.",
    en: "Send only text, a photo or a video.",
  },
  "bc.tooLong": {
    uz: "Matn juda uzun: {n} belgi (ko‘pi bilan {max}).",
    ru: "Текст слишком длинный: {n} символов (максимум {max}).",
    en: "The text is too long: {n} characters (at most {max}).",
  },
  "bc.captionLong": {
    uz: "Izoh juda uzun: {n} belgi (rasm/video uchun ko‘pi bilan {max}).",
    ru: "Подпись слишком длинная: {n} символов (для фото/видео максимум {max}).",
    en: "The caption is too long: {n} characters (at most {max} for a photo/video).",
  },
  "bc.received": { uz: "Xabar qabul qilindi", ru: "Сообщение получено", en: "Message received" },
  "bc.kind.text": { uz: "matn", ru: "текст", en: "text" },
  "bc.kind.photo": { uz: "rasm", ru: "фото", en: "photo" },
  "bc.kind.video": { uz: "video", ru: "видео", en: "video" },
  "bc.kindLine": { uz: "Turi: <b>{kind}</b> · {n} belgi", ru: "Тип: <b>{kind}</b> · {n} символов", en: "Type: <b>{kind}</b> · {n} characters" },
  "bc.buttonLine": { uz: "Tugma: <b>{text}</b> → {url}", ru: "Кнопка: <b>{text}</b> → {url}", en: "Button: <b>{text}</b> → {url}" },
  "bc.noButton": { uz: "Tugma: yo‘q", ru: "Кнопка: нет", en: "Button: none" },
  "bc.draftHint": {
    uz: "Xohlasangiz, xabar ostiga havola tugmasi qo‘shing, so‘ng auditoriyani tanlang.",
    ru: "При желании добавьте кнопку-ссылку, затем выберите аудиторию.",
    en: "Optionally add a link button, then pick the audience.",
  },
  "bc.addButton": { uz: "Tugma qo‘shish", ru: "Добавить кнопку", en: "Add a button" },
  "bc.removeButton": { uz: "Tugmani olib tashlash", ru: "Убрать кнопку", en: "Remove the button" },
  "bc.toAudience": { uz: "Auditoriyani tanlash", ru: "Выбрать аудиторию", en: "Pick the audience" },
  "bc.buttonAsk": {
    uz: "Tugma matni va havolasini bitta xabarda yuboring:\n<code>Saytni ochish | https://slaydx.uz</code>\n\nHavola https:// bilan boshlanadi, matn {max} belgigacha.",
    ru: "Пришлите текст кнопки и ссылку одним сообщением:\n<code>Открыть сайт | https://slaydx.uz</code>\n\nСсылка начинается с https://, текст до {max} символов.",
    en: "Send the button text and link in one message:\n<code>Open the site | https://slaydx.uz</code>\n\nThe link starts with https://, the text is up to {max} characters.",
  },
  "bc.buttonBad": {
    uz: "Tushunmadim. Namuna: <code>Matn | https://…</code> (matn {max} belgigacha, havola https://).",
    ru: "Не понял. Пример: <code>Текст | https://…</code> (текст до {max} символов, ссылка https://).",
    en: "I did not get that. Example: <code>Text | https://…</code> (text up to {max} characters, an https:// link).",
  },
  "bc.audienceTitle": { uz: "Kimga yuboramiz?", ru: "Кому отправляем?", en: "Who gets it?" },
  "bc.audienceLead": {
    uz: "Raqamlar — bot xabar yubora oladigan (Telegram ulangan, bloklanmagan) foydalanuvchilar.",
    ru: "Числа — пользователи, которым бот может написать (Telegram подключён, не заблокированы).",
    en: "The numbers are users the bot can message (Telegram linked, not blocked).",
  },
  "aud.all": { uz: "Hamma", ru: "Все", en: "Everyone" },
  "aud.act": { uz: "Faollar (30 kun)", ru: "Активные (30 дней)", en: "Active (30 days)" },
  "aud.new": { uz: "Yangilar (7 kun)", ru: "Новые (7 дней)", en: "New (7 days)" },
  "bc.previewTitle": { uz: "Yuqorida — xabar aynan shunday boradi.", ru: "Выше — так сообщение и придёт.", en: "Above — exactly what recipients get." },
  "bc.previewLine": {
    uz: "Auditoriya: <b>{aud}</b> — <b>{n}</b> kishi.",
    ru: "Аудитория: <b>{aud}</b> — <b>{n}</b> чел.",
    en: "Audience: <b>{aud}</b> — <b>{n}</b> people.",
  },
  "bc.previewHint": {
    uz: "Avval o‘zingizga sinab ko‘ring, keyin yuboring. Yuborishni to‘xtatish mumkin.",
    ru: "Сначала проверьте на себе, затем отправьте. Рассылку можно остановить.",
    en: "Test it on yourself first, then send. The broadcast can be stopped.",
  },
  "bc.empty": { uz: "Bu auditoriyada hech kim yo‘q.", ru: "В этой аудитории никого нет.", en: "Nobody is in this audience." },
  "bc.test": { uz: "O‘zimga sinov", ru: "Тест себе", en: "Test to me" },
  "bc.send": { uz: "Yuborish ({n} kishiga)", ru: "Отправить ({n})", en: "Send (to {n})" },
  "bc.toAudienceBack": { uz: "Auditoriya", ru: "Аудитория", en: "Audience" },
  "bc.status": { uz: "Xabar #{id}", ru: "Рассылка #{id}", en: "Broadcast #{id}" },
  "bc.statusLine": { uz: "Holat: <b>{status}</b>", ru: "Статус: <b>{status}</b>", en: "Status: <b>{status}</b>" },
  "bc.progress": {
    uz: "Yetkazildi: <b>{sent}</b> / {total} · yetkazilmadi: {failed} · navbatda: {pending}",
    ru: "Доставлено: <b>{sent}</b> / {total} · не доставлено: {failed} · в очереди: {pending}",
    en: "Delivered: <b>{sent}</b> / {total} · failed: {failed} · pending: {pending}",
  },
  "bc.st.draft": { uz: "qoralama", ru: "черновик", en: "draft" },
  "bc.st.queued": { uz: "navbatda", ru: "в очереди", en: "queued" },
  "bc.st.sending": { uz: "yuborilmoqda", ru: "отправляется", en: "sending" },
  "bc.st.done": { uz: "tugadi", ru: "завершена", en: "done" },
  "bc.st.cancelled": { uz: "to‘xtatildi", ru: "остановлена", en: "stopped" },
  "bc.stop": { uz: "To‘xtatish", ru: "Остановить", en: "Stop" },
  "bc.stopAsk": {
    uz: "Xabar #{id} to‘xtatilsinmi? Hali yuborilmaganlar ({n}) olmaydi.",
    ru: "Остановить рассылку #{id}? Ещё не получившие ({n}) её не получат.",
    en: "Stop broadcast #{id}? Those not reached yet ({n}) will not get it.",
  },
  "bc.stopYes": { uz: "Ha, to‘xtatish", ru: "Да, остановить", en: "Yes, stop" },
  "bc.stopNo": { uz: "Yo‘q", ru: "Нет", en: "No" },
  "bc.doneTitle": { uz: "Xabar #{id} yuborildi", ru: "Рассылка #{id} завершена", en: "Broadcast #{id} finished" },
  "bc.doneLine": {
    uz: "Yetkazildi: <b>{sent}</b> · yetkazilmadi: {failed} (jami {total})",
    ru: "Доставлено: <b>{sent}</b> · не доставлено: {failed} (всего {total})",
    en: "Delivered: <b>{sent}</b> · failed: {failed} (total {total})",
  },

  /* ── Kanal ulash ── */
  "ch.title": { uz: "Bonus kanallar", ru: "Бонусные каналы", en: "Bonus channels" },
  "ch.empty": { uz: "Hali kanal ulanmagan.", ru: "Каналы пока не подключены.", en: "No channels connected yet." },
  "ch.line": {
    uz: "{icon} <b>{title}</b>{user} · {amount} · {n} ta bonus olgan",
    ru: "{icon} <b>{title}</b>{user} · {amount} · бонус получили {n}",
    en: "{icon} <b>{title}</b>{user} · {amount} · {n} got the bonus",
  },
  "ch.toggleHint": {
    uz: "Kanal tugmasi — yoqish ✅ / to‘xtatish ⏸.",
    ru: "Кнопка канала — включить ✅ / приостановить ⏸.",
    en: "A channel button toggles it: on ✅ / paused ⏸.",
  },
  "ch.viewOnly": { uz: "Kanallarni faqat ko‘rishingiz mumkin.", ru: "Каналы доступны только для просмотра.", en: "You can only view the channels." },
  "ch.connect": { uz: "Kanal ulash", ru: "Подключить канал", en: "Connect a channel" },
  "ch.ask": {
    uz: "Kanaldan istalgan postni shu yerga <b>forward</b> qiling yoki <b>@username</b> / <b>t.me</b> havolasini yuboring.\n\nAvval botni kanalga <b>admin</b> qiling — aks holda obunani tekshira olmaydi.",
    ru: "<b>Перешлите</b> сюда любой пост из канала или пришлите <b>@username</b> / ссылку <b>t.me</b>.\n\nСначала сделайте бота <b>админом</b> канала — иначе он не сможет проверять подписку.",
    en: "<b>Forward</b> any post of the channel here, or send its <b>@username</b> / <b>t.me</b> link.\n\nMake the bot a channel <b>admin</b> first — otherwise it cannot check subscriptions.",
  },
  "ch.notChannel": {
    uz: "Bu kanal posti emas. Kanaldan postni forward qiling yoki @username yuboring.",
    ru: "Это не пост канала. Перешлите пост из канала или пришлите @username.",
    en: "That is not a channel post. Forward a post of the channel or send its @username.",
  },
  "ch.bad": { uz: "Kanal aniqlanmadi: {why}", ru: "Канал не определён: {why}", en: "Channel not resolved: {why}" },
  "ch.exists": { uz: "Bu kanal allaqachon ulangan.", ru: "Этот канал уже подключён.", en: "This channel is already connected." },
  "ch.private": { uz: "yopiq kanal", ru: "закрытый канал", en: "private channel" },
  "ch.botAdmin": { uz: "✅ Bot kanalda admin.", ru: "✅ Бот — админ канала.", en: "✅ The bot is a channel admin." },
  "ch.botNotAdmin": {
    uz: "⚠️ Bot kanalda admin emas — obunani tekshira olmaydi. Botni admin qilib, keyin ulang.",
    ru: "⚠️ Бот не админ канала — он не сможет проверять подписку. Сделайте бота админом, затем подключите.",
    en: "⚠️ The bot is not a channel admin — it cannot check subscriptions. Make it an admin, then connect.",
  },
  "ch.botUnknown": {
    uz: "⚠️ Bot admin ekanini tekshirib bo‘lmadi (Telegram javob bermadi).",
    ru: "⚠️ Не удалось проверить, админ ли бот (Telegram не ответил).",
    en: "⚠️ Could not check whether the bot is an admin (Telegram did not answer).",
  },
  "ch.pickType": { uz: "Bonus turini tanlang:", ru: "Выберите тип бонуса:", en: "Pick the bonus type:" },
  "ch.type.n": { uz: "Yangiliklar", ru: "Новости", en: "News" },
  "ch.type.e": { uz: "Qo‘shimcha", ru: "Дополнительный", en: "Extra" },
  "ch.typeN": { uz: "Yangiliklar · {join}", ru: "Новости · {join}", en: "News · {join}" },
  "ch.typeE": { uz: "Qo‘shimcha · {join} + {days} kunda {stay}", ru: "Доп. · {join} + {stay} через {days} дн.", en: "Extra · {join} + {stay} after {days} days" },
  "ch.amountE": { uz: "{join} + {days} kunda {stay}", ru: "{join} + {stay} через {days} дн.", en: "{join} + {stay} after {days} days" },
  "ch.confirmType": { uz: "Turi: <b>{type}</b>", ru: "Тип: <b>{type}</b>", en: "Type: <b>{type}</b>" },
  "ch.confirmJoin": { uz: "Obuna bo‘lganda: <b>{join}</b>", ru: "За подписку: <b>{join}</b>", en: "On joining: <b>{join}</b>" },
  "ch.confirmStay": {
    uz: "{days} kun qolsa: yana <b>{stay}</b>",
    ru: "Если останется {days} дней: ещё <b>{stay}</b>",
    en: "After staying {days} days: another <b>{stay}</b>",
  },
  "ch.confirmAsk": { uz: "Ulansinmi?", ru: "Подключить?", en: "Connect it?" },
  "ch.confirm": { uz: "Ulash", ru: "Подключить", en: "Connect" },
  "ch.noInvite": {
    uz: "Yopiq kanal: obuna havolasini web paneldagi «Bonus kanallar»da qo‘shing.",
    ru: "Закрытый канал: добавьте ссылку-приглашение в веб-панели («Бонусные каналы»).",
    en: "Private channel: add its invite link in the web panel (“Bonus channels”).",
  },

  /* ── To‘lov bonusi (C-Q4, payment-bonus.ts) ── */
  "pb.title": { uz: "To‘lov bonusi", ru: "Бонус за пополнение", en: "Payment bonus" },
  "pb.now": {
    uz: "Hozir: <b>{p}%</b> — har bir to‘langan to‘ldirishga summaning {p}% i bonus ball bo‘lib tushadi.",
    ru: "Сейчас: <b>{p}%</b> — к каждому оплаченному пополнению начисляется {p}% суммы бонусными баллами.",
    en: "Now: <b>{p}%</b> — every paid top-up earns {p}% of its amount as bonus points.",
  },
  "pb.off": {
    uz: "Hozir: <b>0%</b> — to‘lov bonusi o‘chirilgan.",
    ru: "Сейчас: <b>0%</b> — бонус за пополнение выключен.",
    en: "Now: <b>0%</b> — the payment bonus is off.",
  },
  "pb.rule": {
    uz: "Yangi qiymat faqat keyingi to‘lovlarga qo‘llanadi. 0 — o‘chirish, ko‘pi bilan 50%.",
    ru: "Новое значение действует только для следующих платежей. 0 — выключить, максимум 50%.",
    en: "A new value applies to later payments only. 0 turns it off, 50% at most.",
  },
  "pb.pick": { uz: "Yangi foizni tanlang:", ru: "Выберите новый процент:", en: "Pick the new percent:" },
  "pb.viewOnly": { uz: "Sizda faqat ko‘rish huquqi bor.", ru: "У вас только просмотр.", en: "You can only view this." },
  "pb.other": { uz: "Boshqa (0–50)", ru: "Другое (0–50)", en: "Other (0–50)" },
  "pb.ask": {
    uz: "Yangi foizni yuboring — butun son, 0 dan 50 gacha (0 — bonusni o‘chirish).",
    ru: "Пришлите новый процент — целое число от 0 до 50 (0 — выключить бонус).",
    en: "Send the new percent — a whole number from 0 to 50 (0 turns the bonus off).",
  },
  "pb.bad": { uz: "Butun son yuboring: 0 dan 50 gacha.", ru: "Пришлите целое число от 0 до 50.", en: "Send a whole number from 0 to 50." },
  "pb.confirmAsk": {
    uz: "To‘lov bonusi <b>{from}%</b> dan <b>{to}%</b> ga o‘zgartirilsinmi? Yangi qiymat keyingi to‘lovlarga qo‘llanadi.",
    ru: "Изменить бонус за пополнение с <b>{from}%</b> на <b>{to}%</b>? Новое значение действует для следующих платежей.",
    en: "Change the payment bonus from <b>{from}%</b> to <b>{to}%</b>? The new value applies to later payments.",
  },
  "pb.confirm": { uz: "Ha, {to}% qilish", ru: "Да, сделать {to}%", en: "Yes, set {to}%" },
  "toast.pbSaved": { uz: "✅ Saqlandi: {p}%", ru: "✅ Сохранено: {p}%", en: "✅ Saved: {p}%" },

  /* ── Step-up (2FA mode) ── */
  "su.title": { uz: "Tasdiqlash kodi", ru: "Код подтверждения", en: "Confirmation code" },
  "su.ask": {
    uz: "Bu amal uchun autentifikator ilovadagi <b>6 xonali kodni</b> yuboring.",
    ru: "Для этого действия пришлите <b>6-значный код</b> из приложения-аутентификатора.",
    en: "Send the <b>6-digit code</b> from your authenticator app for this action.",
  },
} as const satisfies Record<string, Entry>;

export type AdminTextKey = keyof typeof A;
export const ADMIN_TEXT_KEYS = Object.keys(A) as AdminTextKey[];

export function at(lang: Lang, key: AdminTextKey, vars: Record<string, string | number> = {}): string {
  const s: string = A[key][lang] ?? A[key].uz;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function adminRawEntry(key: AdminTextKey): Entry {
  return A[key];
}
