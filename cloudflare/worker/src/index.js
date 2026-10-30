const WEBHOOK_PATH = "/telegram/webhook";
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULTS = { links: 20, media: 15, emoji: 15, drug: 30, burstRep: 15, burstWindow: 120, burstCount: 4, autoban: 20, autobanRep: 50 };

export function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

export function isDrugSpam(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  const normalized = value.normalize("NFKC").toLocaleLowerCase()
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "")
    .replace(/a/g, "а").replace(/o/g, "о").replace(/p/g, "р");
  return /^(?:(?:на\s+)?проб[ау]|\d{1,2}(?:[.,]\d{1,2})?\s*(?:гр|г|gr|g)|(?:(?:на\s+)?проб[ау])\s+\d{1,2}(?:[.,]\d{1,2})?\s*(?:гр|г|gr|g)|\d{1,2}(?:[.,]\d{1,2})?\s*(?:гр|г|gr|g)\s+(?:на\s+)?проб[ау])$/u.test(normalized);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;");
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function parseIds(value) {
  try { const parsed = JSON.parse(value || "[]"); return new Set(Array.isArray(parsed) ? parsed.map(Number).filter(Number.isSafeInteger) : []); }
  catch { return new Set(); }
}
function isGroup(chat) { return chat && (chat.type === "group" || chat.type === "supergroup"); }
function getText(message) { return message.text || message.caption || ""; }
function isMedia(message) { return ["photo", "video", "document", "audio", "voice", "video_note", "animation", "sticker"].some((key) => Boolean(message[key])); }
function containsLink(message, text) {
  const entities = (message.entities || []).concat(message.caption_entities || []);
  return entities.some((item) => item.type === "url" || item.type === "text_link") || /(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i.test(text);
}
function isSingleEmoji(text) {
  const compact = text.replace(/[\s\uFE0F\u200D\u200E\u200F]/g, "");
  return compact.length > 0 && compact.length <= 16 && /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\u200E\u200F\s]+$/u.test(text);
}
function escapeRegex(value) { return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&"); }
function getSpamReason(text, env) {
  const lowered = text.toLocaleLowerCase();
  const tokens = (env.SPAM_TOKENS || "official_vpnbot,rkt_vpn_bot,vpnbot,vpn_bot,oflvpn").split(",").map((s) => s.trim().toLocaleLowerCase()).filter(Boolean);
  if (tokens.some((token) => lowered.includes(token))) return "known spam pattern";
  if (env.DRUG_SPAM_ENABLED !== "false" && isDrugSpam(text)) return "drug-shop bait";
  const terms = (env.PROFANITY_TERMS || "").split("|").map((s) => s.trim()).filter(Boolean);
  if (terms.some((term) => new RegExp("(^|[^\\p{L}\\p{N}_])" + escapeRegex(term) + "($|[^\\p{L}\\p{N}_])", "iu").test(text))) return "profanity";
  return null;
}
async function telegram(env, method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error("Telegram " + method + " failed: " + (data.description || response.status));
  return data.result;
}
async function sendText(env, chatId, text, extra = {}) {
  return telegram(env, "sendMessage", Object.assign({ chat_id: chatId, text, parse_mode: "HTML" }, extra));
}
async function isChatAdmin(env, chatId, userId) {
  const member = await telegram(env, "getChatMember", { chat_id: chatId, user_id: userId });
  return member.status === "creator" || member.status === "administrator";
}
async function ensureMember(db, userId) {
  await db.prepare("INSERT OR IGNORE INTO members (user_id) VALUES (?)").bind(userId).run();
}
async function getMember(db, userId) {
  return db.prepare("SELECT user_id, message_count, reputation_points, profanity_violations, spam_violations FROM members WHERE user_id = ?").bind(userId).first();
}
async function recordClean(db, userId) {
  await db.prepare("UPDATE members SET message_count = message_count + 1, reputation_points = reputation_points + 1, last_seen_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(userId).run();
}
async function recordViolation(db, userId, reason) {
  const column = reason === "profanity" ? "profanity_violations" : "spam_violations";
  await db.prepare("UPDATE members SET " + column + " = " + column + " + 1, reputation_points = MAX(-5000, reputation_points - 10), last_seen_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(userId).run();
}
async function logModeration(env, chat, user, reason, text) {
  if (!env.LOGS_CHAT_ID) return;
  const excerpt = String(text || "").slice(0, 400).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const name = escapeHtml([user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 80));
  await sendText(env, env.LOGS_CHAT_ID, "<b>Ronin moderation</b>\nReason: " + reason + "\nChat: " + escapeHtml(chat.title || chat.id) + "\nUser: " + name + " (<code>" + user.id + "</code>)\n<code>" + excerpt + "</code>");
}
async function maybeAutoBan(env, chatId, userId, member) {
  if (env.AUTOBAN_ENABLED !== "true") return;
  const count = Number(env.AUTOBAN_THRESHOLD || DEFAULTS.autoban);
  const rep = Number(env.AUTOBAN_REP_THRESHOLD || DEFAULTS.autobanRep);
  if (member.spam_violations >= count && member.reputation_points < rep) await telegram(env, "banChatMember", { chat_id: chatId, user_id: userId });
}
async function checkBurst(env, db, message, member) {
  if (env.BURST_ENABLED === "false" || member.reputation_points >= Number(env.BURST_REP_THRESHOLD || DEFAULTS.burstRep)) return;
  const chatId = message.chat.id;
  const seconds = Number(env.BURST_WINDOW_SECONDS || DEFAULTS.burstWindow);
  await db.prepare("DELETE FROM newcomer_events WHERE created_at < datetime('now', ?)").bind("-" + seconds + " seconds").run();
  await db.prepare("INSERT OR IGNORE INTO newcomer_events (chat_id, user_id) VALUES (?, ?)").bind(chatId, message.from.id).run();
  const result = await db.prepare("SELECT COUNT(DISTINCT user_id) AS total FROM newcomer_events WHERE chat_id = ? AND created_at >= datetime('now', ?)").bind(chatId, "-" + seconds + " seconds").first();
  if ((result && result.total || 0) < Number(env.BURST_MIN_ACCOUNTS || DEFAULTS.burstCount)) return;
  const prior = await db.prepare("SELECT chat_id FROM burst_alerts WHERE chat_id = ? AND alerted_at >= datetime('now', '-5 minutes')").bind(chatId).first();
  if (prior) return;
  await db.prepare("INSERT OR REPLACE INTO burst_alerts (chat_id, alerted_at) VALUES (?, CURRENT_TIMESTAMP)").bind(chatId).run();
  if (env.LOGS_CHAT_ID) await sendText(env, env.LOGS_CHAT_ID, "⚠️ <b>Newcomer burst detected</b>\nChat: " + escapeHtml(message.chat.title || chatId) + "\nDistinct low-reputation users: " + result.total);
  if (env.BURST_ACTION === "delete") await telegram(env, "deleteMessage", { chat_id: chatId, message_id: message.message_id });
}

const QUIZ_BANK = [
  { q: "ما عاصمة السودان؟", a: ["الخرطوم", "مدني", "بورتسودان", "كسلا"], correct: 0 },
  { q: "كم عدد أضلاع المثلث؟", a: ["2", "3", "4", "5"], correct: 1 },
  { q: "ما الكوكب المعروف بالكوكب الأحمر؟", a: ["الزهرة", "المشتري", "المريخ", "زحل"], correct: 2 },
  { q: "أي حيوان يُلقّب بسفينة الصحراء؟", a: ["الحصان", "الجمل", "الفيل", "الغزال"], correct: 1 },
  { q: "كم دقيقة في ساعتين؟", a: ["60", "90", "100", "120"], correct: 3 },
  { q: "ما أكبر محيط على الأرض؟", a: ["الأطلسي", "الهندي", "الهادئ", "المتجمد"], correct: 2 },
];
const CAR_QUIZ_BANK = [
  { q: "أي شركة تصنع سيارة كورولا؟", a: ["هوندا", "تويوتا", "نيسان", "مازدا"], correct: 1 },
  { q: "ما بلد منشأ مرسيدس-بنز؟", a: ["إيطاليا", "فرنسا", "ألمانيا", "السويد"], correct: 2 },
  { q: "أي شركة تنتج موستانغ؟", a: ["فورد", "شيفروليه", "دودج", "جيب"], correct: 0 },
  { q: "ما نوع الوقود الذي تستخدمه سيارة كهربائية بالكامل؟", a: ["ديزل", "بنزين", "كهرباء", "غاز"], correct: 2 },
  { q: "لامبورغيني شركة إيطالية أم ألمانية؟", a: ["إيطالية", "ألمانية", "يابانية", "بريطانية"], correct: 0 },
];
const RPS = ["حجر 🪨", "ورقة 📄", "مقص ✂️"];
async function createGame(env, chatId, userId, type, payload) {
  const result = await env.DB.prepare("INSERT INTO game_sessions (chat_id, creator_user_id, game_type, payload) VALUES (?, ?, ?, ?)").bind(chatId, userId, type, JSON.stringify(payload)).run();
  return result.meta.last_row_id;
}
async function registerPrivateUser(env, user) {
  if (!user || user.is_bot) return;
  await env.DB.prepare("INSERT INTO private_users (user_id, username, first_name, chat_id) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, chat_id=excluded.chat_id, updated_at=CURRENT_TIMESTAMP")
    .bind(user.id, user.username ? user.username.toLowerCase() : null, user.first_name || "", user.id).run();
}
async function handleWhisper(env, message, text) {
  const match = text.match(/^(?:\/whisper(?:@\w+)?|\/همسة)\s+@([A-Za-z0-9_]{5,32})\s+([\s\S]{1,700})$/i);
  if (!match) {
    await sendText(env, message.chat.id, "الاستخدام: /whisper @username نص الهمسة\\nلازم المستلم يكون فتح البوت وأرسل /start أولاً.");
    return true;
  }
  try {
    await telegram(env, "deleteMessage", { chat_id: message.chat.id, message_id: message.message_id });
  } catch {
    await sendText(env, message.chat.id, "لم أرسل الهمسة حتى لا يظهر نصها في المجموعة. امنح البوت صلاحية حذف الرسائل ثم أعد المحاولة.");
    return true;
  }
  const username = match[1].toLowerCase();
  const recipient = await env.DB.prepare("SELECT user_id, first_name FROM private_users WHERE username = ?").bind(username).first();
  if (!recipient) {
    await sendText(env, message.chat.id, "ما لقيت @" + escapeHtml(username) + " ضمن مستخدمي البوت. خليه يفتح البوت ويرسل /start أولاً.");
    return true;
  }
  if (Number(recipient.user_id) === Number(message.from.id)) {
    await sendText(env, message.chat.id, "ما ممكن ترسل همسة لنفسك 🙂");
    return true;
  }
  const result = await env.DB.prepare("INSERT INTO whispers (sender_user_id, recipient_user_id, body) VALUES (?, ?, ?)")
    .bind(message.from.id, recipient.user_id, match[2].trim()).run();
  const id = result.meta.last_row_id;
  try {
    await sendText(env, recipient.user_id, "📩 عندك همسة جديدة. اضغط لفتحها.", {
      reply_markup: { inline_keyboard: [[{ text: "افتح الهمسة", callback_data: "whisper_open:" + id }]] }
    });
    await sendText(env, message.chat.id, "تم إرسال الهمسة إلى @" + escapeHtml(username) + " بشكل خاص.");
  } catch {
    await env.DB.prepare("UPDATE whispers SET status='failed' WHERE id=?").bind(id).run();
    await sendText(env, message.chat.id, "تعذر إرسال الهمسة. المستلم قد يكون حظر البوت؛ خليه يرسل /start مجدداً.");
  }
  return true;
}
async function handleNewCallback(env, callback) {
  const data = callback.data || "";
  if (data.startsWith("whisper_open:")) {
    const id = Number(data.split(":")[1]);
    const whisper = await env.DB.prepare("SELECT * FROM whispers WHERE id=?").bind(id).first();
    if (!whisper || Number(whisper.recipient_user_id) !== Number(callback.from.id)) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "هذه الهمسة ليست لك.", show_alert: true });
      return true;
    }
    if (whisper.status === "opened") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "سبق وفتحت الهمسة." });
      return true;
    }
    await env.DB.prepare("UPDATE whispers SET status='opened', opened_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(id).run();
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "تم فتح الهمسة." });
    await sendText(env, callback.from.id, "💌 <b>همستك:</b>\\n" + escapeHtml(whisper.body));
    await sendText(env, whisper.sender_user_id, "📭 تم فتح همستك من المستلم.");
    return true;
  }
  if (data.startsWith("quiz:")) {
    const [, rawId, rawChoice] = data.split(":");
    const id = Number(rawId), choice = Number(rawChoice);
    const game = await env.DB.prepare("SELECT * FROM game_sessions WHERE id=?").bind(id).first();
    if (!game || game.status !== "active" || game.game_type !== "quiz") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "انتهت هذه الجولة." });
      return true;
    }
    const payload = JSON.parse(game.payload);
    const correct = choice === payload.correct;
    await env.DB.prepare("UPDATE game_sessions SET status='finished', finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(id).run();
    if (correct) {
      await ensureMember(env.DB, callback.from.id);
      await env.DB.prepare("UPDATE members SET reputation_points=reputation_points+3 WHERE user_id=?").bind(callback.from.id).run();
    }
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: correct ? "إجابة صحيحة! +3 نقاط" : "إجابة خاطئة، حاول مرة أخرى في الجولة القادمة." });
    await telegram(env, "editMessageText", {
      chat_id: callback.message.chat.id, message_id: callback.message.message_id,
      text: "🧠 <b>" + escapeHtml(payload.q) + "</b>\\nالإجابة الصحيحة: <b>" + escapeHtml(payload.a[payload.correct]) + "</b>\\nالفائز: " + (correct ? escapeHtml(callback.from.first_name || "لاعب") : "لا أحد"),
      parse_mode: "HTML"
    });
    return true;
  }
  if (data.startsWith("rps:")) {
    const [, rawId, rawChoice] = data.split(":");
    const id = Number(rawId), choice = Number(rawChoice);
    const game = await env.DB.prepare("SELECT * FROM game_sessions WHERE id=?").bind(id).first();
    if (!game || game.status !== "active" || game.game_type !== "rps" || !Number.isInteger(choice) || choice < 0 || choice > 2) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "انتهت الجولة أو الاختيار غير صالح." });
      return true;
    }
    const botChoice = Math.floor(Math.random() * 3);
    const outcome = choice === botChoice ? "تعادل!" : (choice - botChoice + 3) % 3 === 1 ? "فزت! +2 نقاط" : "فاز البوت هذه المرة.";
    await env.DB.prepare("UPDATE game_sessions SET status='finished', finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(id).run();
    if (outcome.startsWith("فزت")) {
      await ensureMember(env.DB, callback.from.id);
      await env.DB.prepare("UPDATE members SET reputation_points=reputation_points+2 WHERE user_id=?").bind(callback.from.id).run();
    }
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: outcome });
    await telegram(env, "editMessageText", {
      chat_id: callback.message.chat.id, message_id: callback.message.message_id,
      text: "✊ <b>حجر ورقة مقص</b>\\nاختيارك: " + RPS[choice] + "\\nاختيار البوت: " + RPS[botChoice] + "\\n<b>" + outcome + "</b>",
      parse_mode: "HTML"
    });
    return true;
  }
  return false;
}

async function handleCommands(env, message, member) {
  const text = getText(message).trim();
  const command = (text.split(/\s+/)[0] || "").split("@")[0].toLowerCase();
  const chatId = message.chat.id;
  if (["/ping", "!ping"].includes(command)) { await sendText(env, chatId, "Ronin is online."); return true; }
  if (["/rules", "!rules", "/правила"].includes(command)) { await sendText(env, chatId, env.RULES_TEXT || "Please follow the group rules and respect other members."); return true; }
  if (["/me", "!me", "/info", "/lvl"].includes(command)) {
    await sendText(env, chatId, "<b>" + escapeHtml(message.from.first_name || "Member") + "</b>\nMessages: " + member.message_count + "\nReputation: " + member.reputation_points + "\nSpam violations: " + member.spam_violations + "\nProfanity violations: " + member.profanity_violations);
    return true;
  }
  if (command === "/report" || command === "!report") {
    const target = message.reply_to_message;
    if (!target || !target.from || target.from.id === message.from.id || !env.REPORTS_CHAT_ID) {
      await sendText(env, chatId, "Reply to a message to report it. Reports are unavailable until REPORTS_CHAT_ID is configured.");
      return true;
    }
    if (await isChatAdmin(env, chatId, target.from.id).catch(() => false)) { await sendText(env, chatId, "Administrators cannot be reported."); return true; }
    const note = await sendText(env, env.REPORTS_CHAT_ID,
      "<b>New report</b>\nChat: " + (message.chat.title || chatId) + "\nReported user: " + escapeHtml(target.from.first_name || "Member") + " (<code>" + target.from.id + "</code>)\nReporter: <code>" + message.from.id + "</code>\nMessage: " + escapeHtml(getText(target).slice(0, 600)),
      { reply_markup: { inline_keyboard: [[
        { text: "Delete", callback_data: "report_del|" + chatId + "|" + target.message_id + "|" + target.from.id },
        { text: "Ban + delete", callback_data: "report_ban|" + chatId + "|" + target.message_id + "|" + target.from.id },
        { text: "Dismiss", callback_data: "report_dismiss" },
      ]] } });
    await env.DB.prepare("INSERT OR IGNORE INTO reports (report_chat_id, report_message_id, source_chat_id, source_message_id, reported_user_id, reporter_user_id) VALUES (?, ?, ?, ?, ?, ?)").bind(env.REPORTS_CHAT_ID, note.message_id, chatId, target.message_id, target.from.id, message.from.id).run();
    await sendText(env, chatId, "Your report has been sent to the moderators.");
    return true;
  }
  if (["/games", "!games", "/العاب", "/ألعاب"].includes(command)) {
    await sendText(env, chatId, "🎮 <b>ألعاب رونين</b>\\n/quiz — سؤال سريع بأربع إجابات\\n/cars — تحدي معلومات السيارات\\n/rps — حجر ورقة مقص ضد البوت\\n/checkin — حضور يومي +5 نقاط\\n/top — أفضل 10 أعضاء\\n/whisper @username نص — أرسل همسة خاصة");
    return true;
  }
  if (["/quiz", "!quiz", "/cars", "/سيارات"].includes(command)) {
    const bank = command === "/cars" || command === "/سيارات" ? CAR_QUIZ_BANK : QUIZ_BANK;
    const question = bank[Math.floor(Math.random() * bank.length)];
    const id = await createGame(env, chatId, message.from.id, "quiz", question);
    await sendText(env, chatId, (command === "/cars" || command === "/سيارات" ? "🚘 " : "🧠 ") + "<b>" + escapeHtml(question.q) + "</b>", {
      reply_markup: { inline_keyboard: [question.a.map((answer, index) => ({ text: answer, callback_data: "quiz:" + id + ":" + index }))] }
    });
    return true;
  }
  if (["/rps", "!rps", "/حجره", "/حجر"].includes(command)) {
    const id = await createGame(env, chatId, message.from.id, "rps", {});
    await sendText(env, chatId, "✊ <b>حجر ورقة مقص</b>\\nاختر حركتك لمواجهة البوت:", {
      reply_markup: { inline_keyboard: [[
        { text: "حجر 🪨", callback_data: "rps:" + id + ":0" },
        { text: "ورقة 📄", callback_data: "rps:" + id + ":1" },
        { text: "مقص ✂️", callback_data: "rps:" + id + ":2" }
      ]] }
    });
    return true;
  }
  if (command === "/whisper" || command === "!whisper" || command === "/همسة") return handleWhisper(env, message, text);
  if (["/checkin", "!checkin", "/حضور"].includes(command)) {
    const result = await env.DB.prepare("INSERT OR IGNORE INTO daily_checkins (chat_id, user_id, checkin_date, reward) VALUES (?, ?, date('now'), 5)").bind(chatId, message.from.id).run();
    if (!result.meta || result.meta.changes === 0) {
      await sendText(env, chatId, "سجلت حضورك اليوم بالفعل. ارجع بكرة وخذ نقاطك.");
    } else {
      await ensureMember(env.DB, message.from.id);
      await env.DB.prepare("UPDATE members SET reputation_points=reputation_points+5 WHERE user_id=?").bind(message.from.id).run();
      await sendText(env, chatId, "☀️ تم تسجيل حضورك اليومي! حصلت على +5 نقاط.");
    }
    return true;
  }
  if (["/top", "!top", "/المتصدرين"].includes(command)) {
    const rows = await env.DB.prepare("SELECT user_id, reputation_points, message_count FROM members ORDER BY reputation_points DESC, message_count DESC LIMIT 10").all();
    const lines = (rows.results || []).map((row, i) => (i + 1) + ". <code>" + row.user_id + "</code> — " + row.reputation_points + " نقطة");
    await sendText(env, chatId, "🏆 <b>أفضل 10 أعضاء</b>\\n" + (lines.length ? lines.join("\\n") : "لا توجد نتائج بعد."));
    return true;
  }
  if (["/ban", "!ban", "/unban", "!unban"].includes(command)) {
    if (!message.reply_to_message || !message.reply_to_message.from || !await isChatAdmin(env, chatId, message.from.id).catch(() => false)) return true;
    const targetId = message.reply_to_message.from.id;
    if (await isChatAdmin(env, chatId, targetId).catch(() => false)) { await sendText(env, chatId, "I cannot ban or unban a group administrator."); return true; }
    const method = command.endsWith("unban") ? "unbanChatMember" : "banChatMember";
    await telegram(env, method, { chat_id: chatId, user_id: targetId });
    await sendText(env, chatId, method === "banChatMember" ? "User banned." : "User unbanned.");
    return true;
  }
  return false;
}
async function handleCallback(env, callback) {
  if (await handleNewCallback(env, callback)) return;
  const parts = (callback.data || "").split("|");
  const action = parts[0];
  if (action === "report_dismiss") {
    const authorized = await isChatAdmin(env, callback.message.chat.id, callback.from.id).catch(() => false);
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: authorized ? "Report dismissed." : "Administrator access required.", show_alert: !authorized });
    return;
  }
  if (!["report_del", "report_ban"].includes(action)) { await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "Unknown action." }); return; }
  const chatId = Number(parts[1]), messageId = Number(parts[2]), userId = Number(parts[3]);
  const authorized = await isChatAdmin(env, callback.message.chat.id, callback.from.id).catch(() => false);
  if (![chatId, messageId, userId].every(Number.isSafeInteger) || !authorized) {
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "Administrator access required.", show_alert: true }); return;
  }
  await telegram(env, "deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => null);
  if (action === "report_ban") await telegram(env, "banChatMember", { chat_id: chatId, user_id: userId });
  await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: action === "report_ban" ? "User banned and message deleted." : "Message deleted." });
}
async function handleMessage(env, message, edited = false) {
  if (!message || !message.from || message.from.is_bot || !isGroup(message.chat)) return;
  if (!parseIds(env.MAIN_GROUP_IDS).has(Number(message.chat.id))) return;
  const userId = message.from.id;
  await ensureMember(env.DB, userId);
  let member = await getMember(env.DB, userId);
  if (!member) return;
  if (!edited && await handleCommands(env, message, member)) return;
  const text = getText(message);
  const reason = getSpamReason(text, env);
  const lowMedia = isMedia(message) && member.reputation_points < Number(env.MEDIA_REP_THRESHOLD || DEFAULTS.media);
  const lowLink = containsLink(message, text) && member.reputation_points < Number(env.LINK_REP_THRESHOLD || DEFAULTS.links);
  const lowEmoji = isSingleEmoji(text) && member.reputation_points < Number(env.SINGLE_EMOJI_REP_THRESHOLD || DEFAULTS.emoji);
  const moderationReason = reason || (lowMedia ? "media from low-reputation account" : null) || (lowLink ? "link from low-reputation account" : null) || (lowEmoji ? "single-emoji spam" : null);
  if (moderationReason) {
    if (await isChatAdmin(env, message.chat.id, userId).catch(() => false)) { if (!edited) await recordClean(env.DB, userId); return; }
    await telegram(env, "deleteMessage", { chat_id: message.chat.id, message_id: message.message_id }).catch(() => null);
    await recordViolation(env.DB, userId, moderationReason === "profanity" ? "profanity" : "spam");
    member = await getMember(env.DB, userId);
    await logModeration(env, message.chat, message.from, moderationReason, text).catch(() => null);
    if (member) await maybeAutoBan(env, message.chat.id, userId, member).catch(() => null);
    return;
  }
  if (!edited) await recordClean(env.DB, userId);
  member = await getMember(env.DB, userId);
  if (!edited && member) await checkBurst(env, env.DB, message, member).catch(() => null);
}
async function processUpdate(update, env) {
  if (update.message && update.message.chat && update.message.chat.type === "private") {
    await registerPrivateUser(env, update.message.from);
  }
  if (update.message) await handleMessage(env, update.message);
  if (update.edited_message) await handleMessage(env, update.edited_message, true);
  if (update.callback_query) await handleCallback(env, update.callback_query);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ service: "ronin-cloudflare-bot", status: "ok", runtime: "workers+d1" });
    if (url.pathname !== WEBHOOK_PATH) return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "", env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: "unauthorized" }, 401);
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN) return json({ error: "worker_not_configured" }, 503);
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
    let update;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
      update = JSON.parse(raw);
    } catch { return json({ error: "invalid_json" }, 400); }
    if (!Number.isSafeInteger(update.update_id)) return json({ error: "invalid_update_id" }, 400);
    try {
      const inserted = await env.DB.prepare("INSERT OR IGNORE INTO processed_updates (update_id, status) VALUES (?, 'processing')").bind(update.update_id).run();
      if (inserted.meta && inserted.meta.changes === 0) {
        const prior = await env.DB.prepare("SELECT status FROM processed_updates WHERE update_id = ?").bind(update.update_id).first();
        if (prior && prior.status === "done") return json({ ok: true, duplicate: true });
        return json({ error: "update_in_progress" }, 503);
      }
      await processUpdate(update, env);
      await env.DB.prepare("UPDATE processed_updates SET status = 'done', processed_at = CURRENT_TIMESTAMP WHERE update_id = ?").bind(update.update_id).run();
      return json({ ok: true });
    } catch (error) {
      await env.DB.prepare("DELETE FROM processed_updates WHERE update_id = ?").bind(update.update_id).run().catch(() => null);
      console.error("Ronin update failed", error);
      return json({ error: "processing_failed" }, 500);
    }
  },
};
