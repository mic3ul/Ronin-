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
const RONIN_KEYBOARD = {
  keyboard: [
    [{ text: "🎮 الألعاب" }, { text: "👤 ملفي" }, { text: "🏆 المتصدرون" }],
    [{ text: "🧠 سؤال" }, { text: "🚘 سيارات" }, { text: "🎭 صراحة" }],
    [{ text: "✊ حجر ورقة مقص" }, { text: "⚖️ هذا أم ذاك" }, { text: "🪙 رمية عملة" }],
    [{ text: "📅 حضوري" }, { text: "📜 المساعدة" }, { text: "🆔 معرّفاتي" }],
    [{ text: "📩 همسة" }, { text: "🎵 موسيقى" }, { text: "📋 القوانين" }, { text: "🚨 بلاغ" }]
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "اختر أمراً من قائمة رونين"
};

const CATEGORY_CARDS = {
  games: { title: "🎲 الألعاب والتحديات", photo: "https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=1000&auto=format&fit=crop&q=85", description: "اختر لعبة وابدأ التحدي مع المجموعة.", buttons: [[["سؤال سريع","/سؤال"],["تحدي السيارات","/سيارات"]],[["صراحة","/صراحة"],["هذا أم ذاك","/هذا_ام_ذاك"]],[["حجر ورقة مقص","/حجر"],["رمية عملة","/عملة"]]] },
  profile: { title: "👤 الملف والتفاعل", photo: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1000&auto=format&fit=crop&q=85", description: "تابع مستواك ونقاطك وترتيبك داخل المجموعة.", buttons: [[["ملفي","/ملفي"],["المتصدرون","/المتصدرين"]],[["الحضور اليومي","/حضور"],["معرّفاتي","/ايدي"]]] },
  ranks: { title: "🏅 الرتب", photo: "https://images.unsplash.com/photo-1513151233558-d860c5398176?w=1000&auto=format&fit=crop&q=85", description: "نظام الرتب والصلاحيات داخل المجموعة.", buttons: [[["عرض الرتب","/الرتب"]]] },
  moderation: { title: "🛡️ الإدارة والحماية", photo: "https://images.unsplash.com/photo-1560253023-3ec5d502959f?w=1000&auto=format&fit=crop&q=85", description: "أوامر الإشراف تعمل بالرد على رسالة العضو.", buttons: [[["القوانين","/القوانين"],["طريقة البلاغ","/بلاغ"]]] },
  privacy: { title: "✉️ الخصوصية والموسيقى", photo: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=1000&auto=format&fit=crop&q=85", description: "أرسل همسة بالرد على رسالة العضو، اختر نصاً أو وسائط، ثم أكملها في الخاص. الردود تصل سراً داخل المجموعة.", buttons: [[["شرح الهمسة","/whisper_help"],["بحث موسيقي","/يوت"]]] }
};
async function sendCategoryCard(env, chatId, key) {
  const card = CATEGORY_CARDS[key];
  if (!card) return;
  const keyboard = card.buttons.map(row => row.map(([label, command]) => ({ text: label, callback_data: "cmd:" + command })));
  keyboard.push([{ text: "↩️ رجوع للفئات", callback_data: "menu:home" }]);
  const payload = { chat_id: chatId, photo: card.photo, caption: "<b>" + card.title + "</b>\n" + card.description, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } };
  try { await telegram(env, "sendPhoto", payload); }
  catch (error) { console.warn("Category image unavailable", key, error); await sendText(env, chatId, payload.caption, { reply_markup: payload.reply_markup }); }
}
async function sendCategoryHome(env, chatId) {
  await sendText(env, chatId, "⚔️ <b>دليل رونين</b>\nاختر القسم الذي تريد فتحه:", {
    reply_markup: { inline_keyboard: [
      [{ text: "🎲 الألعاب", callback_data: "menu:games" }, { text: "👤 الملف والتفاعل", callback_data: "menu:profile" }],
      [{ text: "🏅 الرتب", callback_data: "menu:ranks" }, { text: "🛡️ الإدارة", callback_data: "menu:moderation" }],
      [{ text: "✉️ الهمسات والموسيقى", callback_data: "menu:privacy" }]
    ] }
  });
}
async function searchMusic(env, chatId, query) {
  const clean = String(query || "").trim().slice(0, 100);
  if (!clean) { await sendText(env, chatId, "اكتب اسم الأغنية بعد /يوت. مثال: /يوت Naruto Blue Bird"); return; }
  let tracks = [], provider = "apple";
  try {
    const response = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(clean) + "&entity=song&limit=6&country=US", { headers: { "accept": "application/json" } });
    if (!response.ok) throw new Error("Apple HTTP " + response.status);
    const data = await response.json();
    tracks = (data.results || []).filter(track => track.previewUrl && track.trackId);
  } catch (error) { console.warn("Apple music provider failed", String(error)); }
  if (!tracks.length) {
    provider = "deezer";
    const response = await fetch("https://api.deezer.com/search?q=" + encodeURIComponent(clean) + "&limit=6", { headers: { "accept": "application/json" } });
    if (!response.ok) throw new Error("Music providers unavailable (Deezer HTTP " + response.status + ")");
    const data = await response.json();
    tracks = (data.data || []).filter(track => track.preview && track.id);
  }
  if (!tracks.length) { await sendText(env, chatId, "ما لقيت معاينة موسيقية متاحة لهذا البحث. جرّب اسم الأغنية أو الفنان بالإنجليزية."); return; }
  const rows = tracks.slice(0, 6).map(track => [{ text: (track.title + " — " + (track.artist?.name || track.artistName || "")).slice(0, 60), callback_data: (provider === "apple" ? "music:" : "deezer:") + track.id }]);
  await sendText(env, chatId, "🎵 <b>نتائج البحث عن:</b> " + escapeHtml(clean) + "\nاختر مقطعاً لفتح معاينة قصيرة:", { reply_markup: { inline_keyboard: rows } });
}
async function sendMusicPreview(env, callback, trackId) {
  const response = await fetch("https://itunes.apple.com/lookup?id=" + encodeURIComponent(trackId) + "&country=US");
  if (!response.ok) throw new Error("Music lookup unavailable");
  const data = await response.json();
  const track = (data.results || []).find(item => item.trackId === Number(trackId) && item.previewUrl && item.trackViewUrl);
  if (!track) {
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "المعاينة غير متاحة لهذا المقطع.", show_alert: true });
    return;
  }
  await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "جهزت روابط المقطع." });
  await sendText(env, callback.message.chat.id,
    "🎵 <b>" + escapeHtml(track.trackName) + "</b>\n" + escapeHtml(track.artistName) + "\nمعاينة رسمية قصيرة من Apple — اضغط للاستماع عبر البث، أو افتح صفحة المقطع.",
    { reply_markup: { inline_keyboard: [[
      { text: "▶️ استمع للمعاينة", url: track.previewUrl },
      { text: " فتح في Apple Music", url: track.trackViewUrl }
    ]] } });
}
async function sendText(env, chatId, text, extra = {}) {
  return telegram(env, "sendMessage", Object.assign({ chat_id: chatId, text, parse_mode: "HTML" }, extra));
}
async function sendRoninWelcome(env, chatId, group = false) {
  const caption = group
    ? "⚔️ <b>رونين وصل للمجموعة</b>\nأنا Ronin، رفيقكم للألعاب والتفاعل وإدارة المجموعة. استخدموا الأزرار بالأسفل أو /help لعرض الأوامر."
    : "⚔️ <b>أهلاً بك في Ronin</b>\nأنا رفيقك في المجموعات. لإرسال همسة: اعمل رد على رسالة العضو واكتب «همسة»، أو اكتب «همسة @username»، ثم اختر نصاً أو وسائط وأكمل الإرسال في الخاص.";
  const extra = group ? { reply_markup: RONIN_KEYBOARD } : {};
  try {
    const me = await telegram(env, "getMe", {});
    const photos = await telegram(env, "getUserProfilePhotos", { user_id: me.id, limit: 1 });
    const photo = photos.photos?.[0]?.at(-1);
    if (photo?.file_id) {
      await telegram(env, "sendPhoto", { chat_id: chatId, photo: photo.file_id, caption, parse_mode: "HTML", ...extra });
      return;
    }
  } catch (error) {
    console.warn("Ronin profile photo unavailable; using text welcome", error);
  }
  await sendText(env, chatId, caption, extra);
}
async function isChatAdmin(env, chatId, userId) {
  const member = await telegram(env, "getChatMember", { chat_id: chatId, user_id: userId });
  return member.status === "creator" || member.status === "administrator";
}
const RANKS = {
  member: { level: 0, label: "عضو" },
  ansar: { level: 20, label: "مناصر" },
  munadil: { level: 40, label: "مناضل" },
  mujahid: { level: 60, label: "مجاهد" },
  thaer: { level: 80, label: "ثائر" },
  rafiq: { level: 100, label: "رفيق" },
  admin: { level: 90, label: "إداري تيليجرام" },
  owner: { level: 110, label: "مؤسس المجموعة" }
};
async function getRank(env, chatId, userId) {
  const member = await telegram(env, "getChatMember", { chat_id: chatId, user_id: userId }).catch(() => null);
  if (member?.status === "creator") return "owner";
  if (member?.status === "administrator") return "admin";
  const row = await env.DB.prepare("SELECT role FROM group_roles WHERE chat_id=? AND user_id=?").bind(chatId,userId).first();
  return RANKS[row?.role] ? row.role : "member";
}
async function rankLevel(env, chatId, userId) {
  const rank = await getRank(env,chatId,userId);
  return RANKS[rank].level;
}
function parseModerationDuration(value) {
  const match=String(value||"").match(/^(\d{1,5})(s|m|h|d)?$/i);
  if(!match) return 3600;
  const factor=({s:1,m:60,h:3600,d:86400})[(match[2]||"m").toLowerCase()];
  return Math.min(2592000,Math.max(30,Number(match[1])*factor));
}
async function ensureMember(db, userId) {
  await db.prepare("INSERT OR IGNORE INTO members (user_id) VALUES (?)").bind(userId).run();
}
async function getMember(db, userId) {
  return db.prepare("SELECT user_id, message_count, reputation_points, profanity_violations, spam_violations FROM members WHERE user_id = ?").bind(userId).first();
}

export function getProfileLevel(points) {
  const xp = Math.max(0, Number(points) || 0);
  const level = Math.floor(Math.sqrt(xp / 50)) + 1;
  const currentFloor = (level - 1) ** 2 * 50;
  const nextFloor = level ** 2 * 50;
  return { level, currentXp: xp - currentFloor, nextLevelXp: nextFloor - currentFloor, remainingXp: Math.max(0, nextFloor - xp) };
}
async function ensureGroupMember(db, chatId, user) {
  await db.prepare("INSERT INTO group_members (chat_id, user_id, first_name, username) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, user_id) DO UPDATE SET first_name=excluded.first_name, username=excluded.username, last_seen_at=CURRENT_TIMESTAMP")
    .bind(chatId, user.id, user.first_name || "", user.username || null).run();
}
async function recordClean(db, userId, chatId) {
  await db.prepare("UPDATE members SET message_count = message_count + 1, reputation_points = reputation_points + 1, last_seen_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(userId).run();
  await db.prepare("UPDATE group_members SET message_count=message_count+1, reputation_points=reputation_points+1, last_seen_at=CURRENT_TIMESTAMP WHERE chat_id=? AND user_id=?").bind(chatId, userId).run();
}
async function recordViolation(db, userId, reason, chatId) {
  const column = reason === "profanity" ? "profanity_violations" : "spam_violations";
  await db.prepare("UPDATE members SET " + column + " = " + column + " + 1, reputation_points = MAX(-5000, reputation_points - 10), last_seen_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(userId).run();
  await db.prepare("UPDATE group_members SET reputation_points=MAX(-5000, reputation_points-10), last_seen_at=CURRENT_TIMESTAMP WHERE chat_id=? AND user_id=?").bind(chatId, userId).run();
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
  const target = message.reply_to_message?.from;
  const m = text.match(/^(?:همسة|\/whisper(?:@\w+)?|\/همسة)\s+@([A-Za-z0-9_]{5,32})\s*$/i);
  let recipient = target ? { user_id: target.id, first_name: target.first_name } :
    (m ? await env.DB.prepare("SELECT user_id, first_name FROM private_users WHERE username=?").bind(m[1].toLowerCase()).first() : null);
  if (!recipient || target?.is_bot || Number(recipient.user_id) === Number(message.from.id)) {
    await sendText(env, message.chat.id, "لإرسال همسة: اعمل رد على رسالة المستلم واكتب «همسة»، أو اكتب «همسة @username»."); return true;
  }
  try {
    const member = await telegram(env, "getChatMember", { chat_id: message.chat.id, user_id: recipient.user_id });
    if (member.status === "left" || member.status === "kicked") { await sendText(env, message.chat.id, "المستلم ليس عضواً في المجموعة."); return true; }
  } catch { await sendText(env, message.chat.id, "تعذر التحقق من المستلم."); return true; }
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  await env.DB.prepare("INSERT INTO whisper_drafts(token,chat_id,sender_user_id,recipient_user_id,status,created_at,expires_at) VALUES(?,?,?,?,'choosing',CURRENT_TIMESTAMP,datetime('now','+15 minutes'))")
    .bind(token,message.chat.id,message.from.id,recipient.user_id).run();
  await sendText(env,message.chat.id,"📨 <b>همسة إلى "+escapeHtml(recipient.first_name||"الرفيق")+"</b>\nاختر نوع الهمسة:",{reply_markup:{inline_keyboard:[[
    {text:"✍️ نص",callback_data:"whisper_type:"+token+":text"},
    {text:"🖼️ وسائط",callback_data:"whisper_type:"+token+":media"}
  ]]}});
  return true;
}
async function sendWhisperDeepLink(env,callback,token,label) {
  const me=await telegram(env,"getMe",{});
  const url="https://t.me/"+me.username+"?start=w_"+token;
  await telegram(env,"sendMessage",{
    chat_id:callback.message.chat.id,
    text:label+"\nاضغط لفتح محرر الهمسة:",
    ephemeral_message_parameters:{receiver_user_id:callback.from.id,callback_query_id:callback.id},
    reply_markup:{inline_keyboard:[[{text:"✉️ فتح المحرر",url}]]}
  });
}
function whisperMedia(message) {
  if(message.photo?.length) return ["photo",message.photo[message.photo.length-1].file_id];
  for(const k of ["video","animation","document","audio","voice","video_note","sticker"]) if(message[k]?.file_id) return [k,message[k].file_id];
  return null;
}
async function finishWhisperDraft(env,draft,message) {
  const media=whisperMedia(message), body=(message.text||message.caption||"").trim();
  if((draft.mode==="text" && (!body||media)) || (draft.mode==="media"&&!media)) {
    await sendText(env,message.chat.id,draft.mode==="text"?"أرسل نصاً فقط.":"أرسل صورة أو فيديو أو ملفاً أو صوتاً أو ملصقاً."); return true;
  }
  const bot=await telegram(env,"getMe",{});
  const botMember=await telegram(env,"getChatMember",{chat_id:draft.chat_id,user_id:bot.id});
  if(!["administrator","creator"].includes(botMember.status)) {
    await sendText(env,message.chat.id,"يجب أن يكون Ronin مشرفاً في المجموعة حتى يرسل الهمسات الخاصة داخلها.");
    await env.DB.prepare("UPDATE whisper_drafts SET status='failed' WHERE token=?").bind(draft.token).run(); return true;
  }
  const row=await env.DB.prepare("INSERT INTO whispers(sender_user_id,recipient_user_id,body) VALUES(?,?,?)").bind(draft.sender_user_id,draft.recipient_user_id,body).run();
  const id=row.meta.last_row_id, base={chat_id:draft.chat_id,ephemeral_message_parameters:{receiver_user_id:draft.recipient_user_id},reply_markup:{inline_keyboard:[[{text:"↩️ رد على الهمسة",callback_data:"whisper_reply:"+id}]]}};
  try {
    if(!media) await telegram(env,"sendMessage",{...base,text:"📩 <b>يا رفيق وصلتك برقية</b>\n"+escapeHtml(body),parse_mode:"HTML"});
    else {
      const methods={photo:"sendPhoto",video:"sendVideo",animation:"sendAnimation",document:"sendDocument",audio:"sendAudio",voice:"sendVoice",video_note:"sendVideoNote",sticker:"sendSticker"};
      const [kind,fileId]=media,payload={...base,[kind]:fileId};
      if(["photo","video","animation","document","audio","voice"].includes(kind)){payload.caption="📩 يا رفيق وصلتك برقية"+(body?"\n"+escapeHtml(body.slice(0,850)):"");payload.parse_mode="HTML";}
      await telegram(env,methods[kind],payload);
    }
    await env.DB.prepare("UPDATE whispers SET status='opened' WHERE id=?").bind(id).run();
    await env.DB.prepare("UPDATE whisper_drafts SET status='sent' WHERE token=?").bind(draft.token).run();
    await sendText(env,message.chat.id,"✅ تم إرسال الهمسة سراً داخل المجموعة.");
  } catch(error) {
    console.error("ephemeral whisper failed",error);
    await env.DB.prepare("UPDATE whispers SET status='failed' WHERE id=?").bind(id).run();
    await sendText(env,message.chat.id,"تعذر إيصال الهمسة. تحقق من إصدار تيليجرام وصلاحيات Ronin.");
  }
  return true;
}
async function handlePrivateWhisper(env,message) {
  const text=(message.text||"").trim(),start=text.match(/^\/start\s+w_([a-f0-9]{24})$/i);
  if(start) {
    const draft=await env.DB.prepare("SELECT * FROM whisper_drafts WHERE token=? AND sender_user_id=? AND status='choosing' AND expires_at>CURRENT_TIMESTAMP").bind(start[1],message.from.id).first();
    if(!draft){await sendText(env,message.chat.id,"انتهت صلاحية محرر الهمسة. ابدأ من المجموعة مجدداً.");return true;}
    await env.DB.prepare("UPDATE whisper_drafts SET status='composing',expires_at=datetime('now','+15 minutes') WHERE token=?").bind(start[1]).run();
    await sendText(env,message.chat.id,"أرسل نص الهمسة أو الوسائط الآن. إذا اخترت الوسائط من المجموعة، أرسل الملف أو الصورة هنا.");
    return true;
  }
  const draft=await env.DB.prepare("SELECT * FROM whisper_drafts WHERE sender_user_id=? AND status='composing' AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at DESC LIMIT 1").bind(message.from.id).first();
  if(!draft)return false;
  return finishWhisperDraft(env,draft,message);
}

async function handleNewCallback(env, callback) {
  const data = callback.data || "";
  if (data.startsWith("menu:")) {
    const key = data.slice(5);
    if (key === "home") await sendCategoryHome(env, callback.message.chat.id);
    else await sendCategoryCard(env, callback.message.chat.id, key);
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "تم فتح القسم." });
    return true;
  }
  if (data.startsWith("deezer:")) {
    const id=data.slice(7);
    if(!/^\d{1,15}$/.test(id)){await telegram(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"اختيار غير صالح.",show_alert:true});return true;}
    try {
      const response=await fetch("https://api.deezer.com/track/"+encodeURIComponent(id));
      if(!response.ok) throw new Error("Deezer lookup HTTP "+response.status);
      const track=await response.json();
      if(!track.preview||!track.link) throw new Error("Preview unavailable");
      await telegram(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"جهزت المعاينة."});
      await sendText(env,callback.message.chat.id,"🎵 <b>"+escapeHtml(track.title||"مقطع موسيقي")+"</b>\n"+escapeHtml(track.artist?.name||"")+"\nمعاينة قصيرة من Deezer.",{reply_markup:{inline_keyboard:[[{text:"▶️ استمع للمعاينة",url:track.preview},{text:"فتح Deezer",url:track.link}]]}});
    } catch(error){console.error("Deezer preview failed",error);await telegram(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"تعذر جلب المعاينة.",show_alert:true});}
    return true;
  }
  if (data.startsWith("music:")) {
    const trackId = data.slice(6);
    if (!/^\d{1,15}$/.test(trackId)) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "اختيار غير صالح.", show_alert: true });
      return true;
    }
    try { await sendMusicPreview(env, callback, trackId); }
    catch (error) {
      console.error("Music preview failed", error);
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "تعذر إرسال المعاينة حالياً.", show_alert: true });
    }
    return true;
  }
  if (data.startsWith("cmd:")) {
    const commandText = data.slice(4);
    const member = await getMember(env.DB, callback.from.id);
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "تم." });
    if (member) await handleCommands(env, { ...callback.message, from: callback.from, text: commandText, reply_to_message: null }, member);
    return true;
  }
  if (data.startsWith("whisper_type:")) {
    const [,token,mode]=data.split(":");
    if(!/^[a-f0-9]{24}$/i.test(token)||!["text","media"].includes(mode)){await telegram(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"اختيار غير صالح.",show_alert:true});return true;}
    const draft=await env.DB.prepare("SELECT * FROM whisper_drafts WHERE token=? AND sender_user_id=? AND status='choosing' AND expires_at>CURRENT_TIMESTAMP").bind(token,callback.from.id).first();
    if(!draft){await telegram(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"انتهت صلاحية الهمسة.",show_alert:true});return true;}
    await env.DB.prepare("UPDATE whisper_drafts SET mode=? WHERE token=?").bind(mode,token).run();
    await telegram(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"افتح الخاص لإكمال الهمسة."});
    await sendWhisperDeepLink(env,callback,token,mode==="text"?"✍️ همسة نصية":"🖼️ همسة وسائط");return true;
  }
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
    const opened = await env.DB.prepare("UPDATE whispers SET status='opened', opened_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(id).run();
    if (!opened.meta || opened.meta.changes !== 1) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "تم فتح الهمسة بالفعل." });
      return true;
    }
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "تم فتح الهمسة." });
    await sendText(env, callback.from.id, "💌 <b>همستك:</b>\n" + escapeHtml(whisper.body));
    await sendText(env, whisper.sender_user_id, "📭 تم فتح همستك من المستلم.");
    return true;
  }
  if (data.startsWith("whisper_reply:")) {
    const id=Number(data.slice("whisper_reply:".length));
    const w=await env.DB.prepare("SELECT * FROM whispers WHERE id=?").bind(id).first();
    if(!w||Number(w.recipient_user_id)!==Number(callback.from.id)){await telegram(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"هذه الهمسة ليست لك.",show_alert:true});return true;}
    const token=crypto.randomUUID().replace(/-/g,"").slice(0,24);
    await env.DB.prepare("INSERT INTO whisper_drafts(token,chat_id,sender_user_id,recipient_user_id,mode,reply_to_id,status,created_at,expires_at) VALUES(?,?,?,?, 'text',?,'choosing',CURRENT_TIMESTAMP,datetime('now','+15 minutes'))")
      .bind(token,w.chat_id||callback.message.chat.id,callback.from.id,w.sender_user_id,id).run();
    await telegram(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"افتح محرر الرد."});
    await sendWhisperDeepLink(env,callback,token,"↩️ اكتب ردك على الهمسة");
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
    if (Number(game.chat_id) !== Number(callback.message.chat.id)) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "هذه الجولة لا تخص هذه المجموعة.", show_alert: true });
      return true;
    }
    const payload = JSON.parse(game.payload);
    const correct = choice === payload.correct;
    const claimed = await env.DB.prepare("UPDATE game_sessions SET status='finished', finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(id).run();
    if (!claimed.meta || claimed.meta.changes !== 1) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "سبقك لاعب آخر!" });
      return true;
    }
    if (correct) {
      await ensureMember(env.DB, callback.from.id);
      await ensureGroupMember(env.DB, callback.message.chat.id, callback.from);
      await env.DB.prepare("UPDATE members SET reputation_points=reputation_points+3 WHERE user_id=?").bind(callback.from.id).run();
      await env.DB.prepare("UPDATE group_members SET reputation_points=reputation_points+3 WHERE chat_id=? AND user_id=?").bind(callback.message.chat.id, callback.from.id).run();
    }
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: correct ? "إجابة صحيحة! +3 نقاط" : "إجابة خاطئة، حاول مرة أخرى في الجولة القادمة." });
    await telegram(env, "editMessageText", {
      chat_id: callback.message.chat.id, message_id: callback.message.message_id,
      text: "🧠 <b>" + escapeHtml(payload.q) + "</b>\nالإجابة الصحيحة: <b>" + escapeHtml(payload.a[payload.correct]) + "</b>\nالفائز: " + (correct ? escapeHtml(callback.from.first_name || "لاعب") : "لا أحد"),
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
    if (Number(game.chat_id) !== Number(callback.message.chat.id) || Number(game.creator_user_id) !== Number(callback.from.id)) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "هذه الجولة لصاحب التحدي فقط.", show_alert: true });
      return true;
    }
    const botChoice = Math.floor(Math.random() * 3);
    const outcome = choice === botChoice ? "تعادل!" : (choice - botChoice + 3) % 3 === 1 ? "فزت! +2 نقاط" : "فاز البوت هذه المرة.";
    const claimed = await env.DB.prepare("UPDATE game_sessions SET status='finished', finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(id).run();
    if (!claimed.meta || claimed.meta.changes !== 1) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "انتهت الجولة بالفعل." });
      return true;
    }
    if (outcome.startsWith("فزت")) {
      await ensureMember(env.DB, callback.from.id);
      await ensureGroupMember(env.DB, callback.message.chat.id, callback.from);
      await env.DB.prepare("UPDATE members SET reputation_points=reputation_points+2 WHERE user_id=?").bind(callback.from.id).run();
      await env.DB.prepare("UPDATE group_members SET reputation_points=reputation_points+2 WHERE chat_id=? AND user_id=?").bind(callback.message.chat.id, callback.from.id).run();
    }
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: outcome });
    await telegram(env, "editMessageText", {
      chat_id: callback.message.chat.id, message_id: callback.message.message_id,
      text: "✊ <b>حجر ورقة مقص</b>\nاختيارك: " + RPS[choice] + "\nاختيار البوت: " + RPS[botChoice] + "\n<b>" + outcome + "</b>",
      parse_mode: "HTML"
    });
    return true;
  }
  return false;
}

async function handleCommands(env, message, member) {
  const text = getText(message).trim();
  const buttonCommands = {
    "🎮 الألعاب": "/العاب", "👤 ملفي": "/ملفي", "🏆 المتصدرون": "/المتصدرين",
    "🧠 سؤال": "/سؤال", "🚘 سيارات": "/سيارات", "🎭 صراحة": "/صراحة",
    "✊ حجر ورقة مقص": "/حجر", "⚖️ هذا أم ذاك": "/هذا_ام_ذاك", "🪙 رمية عملة": "/عملة",
    "📅 حضوري": "/حضور", "📜 المساعدة": "/مساعدة", "🆔 معرّفاتي": "/ايدي",
    "📩 همسة": "/whisper", "🎵 موسيقى": "/يوت", "📋 القوانين": "/القوانين", "🚨 بلاغ": "/بلاغ"
  };
  if (/^همسة(?:\s|$)/i.test(text) || /^\/whisper(?:@\w+)?(?:\s|$)/i.test(text) || /^\/همسة(?:\s|$)/i.test(text)) return handleWhisper(env, message, text);
  const command = buttonCommands[text] || (text.split(/\s+/)[0] || "").split("@")[0].toLowerCase();
  const chatId = message.chat.id;
  const rankCommands = {
    "/اضف_رفيق":"rafiq", "/رفع_رفيق":"rafiq", "/اضف_ثائر":"thaer", "/اضف_مجاهد":"mujahid",
    "/اضف_مناضل":"munadil", "/اضف_مناصر":"ansar", "/ازالة_رتبة":"member"
  };
  if (Object.prototype.hasOwnProperty.call(rankCommands,command)) {
    const target=message.reply_to_message?.from;
    if(!target || target.is_bot || target.id===message.from.id) {
      await sendText(env,chatId,"استخدم الأمر بالرد على رسالة العضو المطلوب."); return true;
    }
    const actorRank=await rankLevel(env,chatId,message.from.id);
    const targetRank=await rankLevel(env,chatId,target.id);
    const next=rankCommands[command], nextLevel=RANKS[next].level;
    if(actorRank<80 || actorRank<=targetRank || actorRank<=nextLevel || (next==="rafiq" && actorRank!==110)) {
      await sendText(env,chatId,"لا تملك الصلاحية الكافية لمنح هذه الرتبة أو تعديل رتبة أعلى منك."); return true;
    }
    if(next==="member") {
      await env.DB.prepare("DELETE FROM group_roles WHERE chat_id=? AND user_id=?").bind(chatId,target.id).run();
    } else {
      await env.DB.prepare("INSERT INTO group_roles(chat_id,user_id,role,granted_by) VALUES(?,?,?,?) ON CONFLICT(chat_id,user_id) DO UPDATE SET role=excluded.role,granted_by=excluded.granted_by,updated_at=CURRENT_TIMESTAMP").bind(chatId,target.id,next,message.from.id).run();
    }
    await sendText(env,chatId,"تم تحديث رتبة <b>"+escapeHtml(target.first_name||"العضو")+"</b> إلى <b>"+RANKS[next].label+"</b>.");
    return true;
  }
  const moderation={"/حظر":"ban","/فك_الحظر":"unban","/كتم":"mute","/تقييد":"restrict","/الغاء_كتم":"unmute"};
  if(moderation[command]) {
    const target=message.reply_to_message?.from;
    if(!target || target.is_bot || target.id===message.from.id) {
      await sendText(env,chatId,"استخدم الأمر بالرد على رسالة العضو المطلوب."); return true;
    }
    const actor=await rankLevel(env,chatId,message.from.id);
    const targetLevel=await rankLevel(env,chatId,target.id);
    const action=moderation[command];
    const required=action==="ban"||action==="unban"?100:60;
    if(actor<required || actor<=targetLevel) {
      await sendText(env,chatId,"رتبتك لا تسمح بهذا الإجراء على هذا العضو."); return true;
    }
    const duration=parseModerationDuration(text.split(/\s+/)[1]);
    const until=Math.floor(Date.now()/1000)+duration;
    try {
      if(action==="ban") await telegram(env,"banChatMember",{chat_id:chatId,user_id:target.id});
      else if(action==="unban") await telegram(env,"unbanChatMember",{chat_id:chatId,user_id:target.id,only_if_banned:true});
      else {
        const me=await telegram(env,"getMe",{});
        const botMember=await telegram(env,"getChatMember",{chat_id:chatId,user_id:me.id});
        if(!["administrator","creator"].includes(botMember.status) || (botMember.status==="administrator" && !botMember.can_restrict_members)) throw new Error("Ronin lacks can_restrict_members");
        const permissions=action==="mute"
          ? {can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false,can_manage_topics:false,can_pin_messages:false,can_change_info:false,can_invite_users:false}
          : action==="restrict"
            ? {can_send_messages:true,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false}
            : {can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true};
        await telegram(env,"restrictChatMember",{chat_id:chatId,user_id:target.id,permissions,use_independent_chat_permissions:true,...(action==="unmute"?{}:{until_date:until})});
      }
      const labels={ban:"حظر",unban:"فك الحظر",mute:"كتم",restrict:"تقييد",unmute:"إلغاء الكتم"};
      await sendText(env,chatId,"تم تنفيذ <b>"+labels[action]+"</b> على العضو.");
    } catch(error) {
      console.error("Ronin moderation action failed",error);
      await sendText(env,chatId,"تعذر تنفيذ الأمر. تأكد أن Ronin مشرف ويملك صلاحية حظر وتقييد الأعضاء.");
    }
    return true;
  }
  if (["/ping", "!ping"].includes(command)) { await sendText(env, chatId, "Ronin is online."); return true; }
  if (["/rules", "!rules", "/правила", "/القوانين"].includes(command)) { await sendText(env, chatId, env.RULES_TEXT || "Please follow the group rules and respect other members."); return true; }
  if (["/me", "!me", "/info", "/lvl"].includes(command)) {
    await sendText(env, chatId, "<b>" + escapeHtml(message.from.first_name || "Member") + "</b>\nMessages: " + member.message_count + "\nReputation: " + member.reputation_points + "\nSpam violations: " + member.spam_violations + "\nProfanity violations: " + member.profanity_violations);
    return true;
  }
  if (["/profile", "!profile", "/بروفايل", "/ملفي", "/rank"].includes(command)) {
    const row = await env.DB.prepare("SELECT first_name, username, message_count, reputation_points FROM group_members WHERE chat_id=? AND user_id=?").bind(chatId, message.from.id).first();
    const profile = row || { first_name: message.from.first_name || "Member", username: message.from.username || null, message_count: 0, reputation_points: 0 };
    const level = getProfileLevel(profile.reputation_points);
    const politicalRank = RANKS[await getRank(env,chatId,message.from.id)]?.label || "عضو";
    const rankRow = await env.DB.prepare("SELECT COUNT(*) + 1 AS rank FROM group_members WHERE chat_id=? AND (reputation_points > ? OR (reputation_points = ? AND message_count > ?))").bind(chatId, profile.reputation_points, profile.reputation_points, profile.message_count).first();
    const badges = [];
    if (profile.message_count >= 10) badges.push("💬 متفاعل");
    if (profile.message_count >= 100) badges.push("🗣️ صوت المجموعة");
    if (profile.reputation_points >= 100) badges.push("⭐ موثوق");
    if (profile.reputation_points >= 500) badges.push("🏅 نخبة رونين");
    if (!badges.length) badges.push("🌱 عضو جديد");
    await sendText(env, chatId,
      "👤 <b>ملف العضو</b>\n<b>" + escapeHtml(profile.first_name || "Member") + "</b>" +
      (profile.username ? " · @" + escapeHtml(profile.username) : "") +
      "\nالرتبة: <b>" + politicalRank + "</b>\n🏆 المستوى: <b>" + level.level + "</b> · الترتيب: <b>#" + (rankRow?.rank || 1) + "</b>" +
      "\n⭐ السمعة: <b>" + profile.reputation_points + "</b>" +
      "\n📈 التقدم: " + level.currentXp + " / " + level.nextLevelXp + " XP" +
      "\n💬 الرسائل: " + profile.message_count +
      "\n🎖️ الشارات: " + badges.join("، "));
    return true;
  }
  if (command === "/الرتب" || command === "/رتب") {
    await sendText(env,chatId,"<b>سُلّم رتب المجموعة</b>\nرفيق — أعلى رتبة تنظيمية\nثائر — قيادة المجموعة\nمجاهد — إشراف متقدم\nمناضل — إشراف مساعد\nمناصر — رتبة مساندة\nعضو — الصلاحيات الأساسية");
    return true;
  }
  if (["/id", "!id", "/ايدي", "/معرفاتي"].includes(command)) {
    await sendText(env, chatId, "🆔 <b>معرّف المجموعة:</b> <code>" + chatId + "</code>\n<b>معرّفك:</b> <code>" + message.from.id + "</code>");
    return true;
  }
  if (["/help", "!help", "/مساعدة", "/مساعده"].includes(command)) {
    await sendCategoryHome(env, chatId);
    return true;
  }
  if (["/whisper_help", "/همسة_مساعدة"].includes(command)) {
    await sendText(env, chatId, "✉️ <b>طريقة إرسال همسة</b>\nاعمل رد على رسالة الشخص ثم اكتب:\n<code>همسة النص الذي تريد إرساله</code>\nسيحذف رونين رسالة الأمر من المجموعة ويرسل النص إلى الخاص. يجب أن يكون الشخص قد فتح البوت وأرسل /start.\nويمكنك أيضاً استخدام: <code>/همسة @username النص</code>.");
    return true;
  }
  if (["/يوت", "/yt", "/music"].includes(command)) {
    const query = text.replace(/^(?:\/يوت|\/yt|\/music)(?:@\w+)?\s*/i, "").trim();
    try { await searchMusic(env, chatId, query); }
    catch (error) { console.error("Music search failed", error); await sendText(env, chatId, "تعذر البحث الموسيقي الآن. حاول بعد قليل."); }
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
    await sendCategoryCard(env, chatId, "games");
    return true;
  }
  if (["/quiz", "!quiz", "/سؤال", "/cars", "/سيارات"].includes(command)) {
    const bank = command === "/cars" || command === "/سيارات" ? CAR_QUIZ_BANK : QUIZ_BANK;
    const question = bank[Math.floor(Math.random() * bank.length)];
    const id = await createGame(env, chatId, message.from.id, "quiz", question);
    await sendText(env, chatId, (command === "/cars" || command === "/سيارات" ? "🚘 " : "🧠 ") + "<b>" + escapeHtml(question.q) + "</b>", {
      reply_markup: { inline_keyboard: [question.a.map((answer, index) => ({ text: answer, callback_data: "quiz:" + id + ":" + index }))] }
    });
    return true;
  }
  if (command === "/truth" || command === "!truth" || command === "/صراحة") {
    const prompts = [
      "ما أكثر قرار اتخذته وتمنيت لو فكرت فيه أكثر؟",
      "ما عادة غريبة لا يعرفها عنك معظم أصدقائك؟",
      "ما أكثر موقف محرج ما زلت تتذكره؟",
      "ما صفة فيك تحاول تغييرها؟",
      "من الشخص الذي تفهمه دون أن يتكلم؟",
      "ما شيء تتظاهر أنك لا تهتم به بينما تهتم فعلاً؟",
      "ما أكثر مجاملة بقيت في ذاكرتك؟",
      "لو استطعت الاعتذار لشخص واحد، فمن سيكون؟"
    ];
    await sendText(env, chatId, "🎭 <b>سؤال صراحة</b>\n" + escapeHtml(prompts[Math.floor(Math.random() * prompts.length)]));
    return true;
  }
  if (["/wyr", "!wyr", "/thisorthat", "/هذاامذاك", "/هذا_ام_ذاك"].includes(command)) {
    const pairs = [
      ["السفر عبر الزمن", "السفر إلى الفضاء"],
      ["قراءة الأفكار", "الاختفاء"],
      ["العيش بلا موسيقى", "العيش بلا أفلام"],
      ["معرفة المستقبل", "تغيير الماضي"],
      ["الشهرة", "الثروة"],
      ["مدينة بلا إنترنت", "غابة بلا كهرباء"],
      ["أن تكون الأذكى", "أن تكون الأكثر حظاً"],
      ["إجازة سنة كاملة", "راتب مضاعف مدى الحياة"]
    ];
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    await sendText(env, chatId, "⚖️ <b>هذا أم ذاك؟</b>\n1️⃣ " + escapeHtml(pair[0]) + "\nأم\n2️⃣ " + escapeHtml(pair[1]) + "\nاكتب اختيارك في المجموعة.");
    return true;
  }
  if (["/coin", "!coin", "/عملة"].includes(command)) {
    const side = Math.random() < 0.5 ? "🪙 صورة" : "🪙 كتابة";
    await sendText(env, chatId, "رونين رمى العملة...\n<b>" + side + "</b>");
    return true;
  }
  if (["/rps", "!rps", "/حجره", "/حجر"].includes(command)) {
    const id = await createGame(env, chatId, message.from.id, "rps", {});
    await sendText(env, chatId, "✊ <b>حجر ورقة مقص</b>\nاختر حركتك لمواجهة البوت:", {
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
      await ensureGroupMember(env.DB, chatId, message.from);
      await env.DB.prepare("UPDATE members SET reputation_points=reputation_points+5 WHERE user_id=?").bind(message.from.id).run();
      await env.DB.prepare("UPDATE group_members SET reputation_points=reputation_points+5 WHERE chat_id=? AND user_id=?").bind(chatId, message.from.id).run();
      await sendText(env, chatId, "☀️ تم تسجيل حضورك اليومي! حصلت على +5 نقاط.");
    }
    return true;
  }
  if (["/top", "!top", "/المتصدرين"].includes(command)) {
    const rows = await env.DB.prepare("SELECT user_id, first_name, username, reputation_points, message_count FROM group_members WHERE chat_id=? ORDER BY reputation_points DESC, message_count DESC LIMIT 10").bind(chatId).all();
    const lines = (rows.results || []).map((row, i) => (i + 1) + ". " + escapeHtml(row.first_name || (row.username ? "@" + row.username : "عضو")) + " — " + row.reputation_points + " نقطة");
    await sendText(env, chatId, "🏆 <b>أفضل 10 أعضاء</b>\n" + (lines.length ? lines.join("\n") : "لا توجد نتائج بعد."));
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
async function duplicateFingerprint(message) {
  const text=getText(message).normalize("NFKC").toLocaleLowerCase().replace(/\s+/g," ").trim();
  const media=whisperMedia(message);
  const mediaKey=media ? String(media[1]) : "";
  const source=text || mediaKey;
  if(!source || source.length<2) return null;
  const bytes=new TextEncoder().encode(source);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function isRepeatedMessage(env,message) {
  const fingerprint=await duplicateFingerprint(message);
  if(!fingerprint) return false;
  const prior=await env.DB.prepare("SELECT message_id FROM duplicate_messages WHERE chat_id=? AND fingerprint=? AND created_at>=datetime('now','-5 minutes')").bind(message.chat.id,fingerprint).first();
  if(prior) return true;
  await env.DB.prepare("INSERT INTO duplicate_messages(chat_id,fingerprint,message_id,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(chat_id,fingerprint) DO UPDATE SET message_id=excluded.message_id,created_at=CURRENT_TIMESTAMP").bind(message.chat.id,fingerprint,message.message_id).run();
  await env.DB.prepare("DELETE FROM duplicate_messages WHERE created_at<datetime('now','-10 minutes')").run();
  return false;
}
async function handleMessage(env, message, edited = false) {
  if (!message || !isGroup(message.chat)) return;
  if (!edited && message.new_chat_members?.length) {
    const bot = await telegram(env,"getMe",{});
    if (message.new_chat_members.some((member) => member.id === bot.id)) {
      await env.DB.prepare("INSERT INTO allowed_groups(chat_id,title,active) VALUES(?,?,1) ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title,active=1,updated_at=CURRENT_TIMESTAMP").bind(message.chat.id,message.chat.title||"").run();
      await sendRoninWelcome(env,message.chat.id,true);
      return;
    }
  }
  if (!message.from || message.from.is_bot) return;
  const registered = await env.DB.prepare("SELECT chat_id FROM allowed_groups WHERE chat_id=? AND active=1").bind(message.chat.id).first();
  if (!registered) return;
  const userId = message.from.id;
  await ensureMember(env.DB, userId);
  await ensureGroupMember(env.DB, message.chat.id, message.from);
  let member = await getMember(env.DB, userId);
  if (!member) return;
  if (!edited && await handleCommands(env, message, member)) return;
  const text = getText(message);
  if (!edited && !/^\//.test(text.trim()) && await isRepeatedMessage(env,message).catch(error=>{console.warn("duplicate detection failed",error);return false;})) {
    await telegram(env,"deleteMessage",{chat_id:message.chat.id,message_id:message.message_id}).catch(error=>console.warn("duplicate delete failed",error));
    await recordViolation(env.DB,userId,"spam",message.chat.id);
    return;
  }
  const reason = getSpamReason(text, env);
  const lowMedia = isMedia(message) && member.reputation_points < Number(env.MEDIA_REP_THRESHOLD || DEFAULTS.media);
  const lowLink = containsLink(message, text) && member.reputation_points < Number(env.LINK_REP_THRESHOLD || DEFAULTS.links);
  const lowEmoji = isSingleEmoji(text) && member.reputation_points < Number(env.SINGLE_EMOJI_REP_THRESHOLD || DEFAULTS.emoji);
  const moderationReason = reason || (lowMedia ? "media from low-reputation account" : null) || (lowLink ? "link from low-reputation account" : null) || (lowEmoji ? "single-emoji spam" : null);
  if (moderationReason) {
    if (await isChatAdmin(env, message.chat.id, userId).catch(() => false)) { if (!edited) await recordClean(env.DB, userId, message.chat.id); return; }
    await telegram(env, "deleteMessage", { chat_id: message.chat.id, message_id: message.message_id }).catch(() => null);
    await recordViolation(env.DB, userId, moderationReason === "profanity" ? "profanity" : "spam", message.chat.id);
    member = await getMember(env.DB, userId);
    await logModeration(env, message.chat, message.from, moderationReason, text).catch(() => null);
    if (member) await maybeAutoBan(env, message.chat.id, userId, member).catch(() => null);
    return;
  }
  if (!edited) await recordClean(env.DB, userId, message.chat.id);
  member = await getMember(env.DB, userId);
  if (!edited && member) await checkBurst(env, env.DB, message, member).catch(() => null);
}
async function processUpdate(update, env) {
  if (update.my_chat_member && isGroup(update.my_chat_member.chat)) {
    const change = update.my_chat_member;
    const status = change.new_chat_member?.status;
    const isActive = status === "member" || status === "administrator" ||
      (status === "restricted" && change.new_chat_member?.is_member === true);
    if (isActive) {
      await env.DB.prepare("INSERT INTO allowed_groups (chat_id, title, active) VALUES (?, ?, 1) ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title, active=1, updated_at=CURRENT_TIMESTAMP")
        .bind(change.chat.id, change.chat.title || "").run();
      const oldStatus = change.old_chat_member?.status;
      const wasActive = oldStatus === "member" || oldStatus === "administrator" ||
        (oldStatus === "restricted" && change.old_chat_member?.is_member === true);
      if (!wasActive) await sendRoninWelcome(env, change.chat.id, true);
    } else if (status === "left" || status === "kicked") {
      await env.DB.prepare("UPDATE allowed_groups SET active=0, updated_at=CURRENT_TIMESTAMP WHERE chat_id=?").bind(change.chat.id).run();
    }
  }
  if (update.message && update.message.chat && update.message.chat.type === "private") {
    await registerPrivateUser(env, update.message.from);
    const handledWhisper = await handlePrivateWhisper(env, update.message);
    if (!handledWhisper && (update.message.text || "").trim().split(/\s+/)[0] === "/start") await sendRoninWelcome(env, update.message.chat.id, false);
  }
  if (update.message) await handleMessage(env, update.message);
  if (update.edited_message) await handleMessage(env, update.edited_message, true);
  if (update.callback_query) await handleCallback(env, update.callback_query);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ service: "ronin-cloudflare-bot", status: "ok", runtime: "workers+d1" });
    if (url.pathname === "/telegram/setup") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(request.headers.get("X-Ronin-Setup-Key") || "", env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: "unauthorized" }, 401);
      if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "bot_token_not_configured" }, 503);
      try {
        await telegram(env, "setWebhook", {
          url: url.origin + WEBHOOK_PATH,
          secret_token: env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member"],
          drop_pending_updates: false
        });
        const webhook = await telegram(env, "getWebhookInfo", {});
        return json({ ok: true, webhook });
      } catch (error) {
        console.error("Ronin webhook setup failed", error);
        return json({ error: "webhook_setup_failed" }, 502);
      }
    }
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
