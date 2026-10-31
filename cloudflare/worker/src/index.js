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

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;");
}
const COMMAND_ALIASES = new Map([
  ["/فحص", "/ping"],
  ["/حالة", "/ping"],
  ["/قواعد", "/rules"],
  ["/القوانين", "/rules"],
  ["/ملفي", "/me"],
  ["/معلوماتي", "/me"],
  ["/بلاغ", "/report"],
  ["/حظر", "/ban"],
  ["/فك_الحظر", "/unban"],
  ["/الغاء_الحظر", "/unban"],
]);
export function normalizeCommand(value) {
  const token = String(value ?? "").trim().split(/\s+/)[0] || "";
  const command = token.split("@")[0].toLowerCase();
  return COMMAND_ALIASES.get(command) || command;
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
  await sendText(env, env.LOGS_CHAT_ID, "<b>إجراء إشرافي من Ronin</b>\nالسبب: " + reason + "\nالمجموعة: " + escapeHtml(chat.title || chat.id) + "\nUser: " + name + " (<code>" + user.id + "</code>)\n<code>" + excerpt + "</code>");
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
  if (env.LOGS_CHAT_ID) await sendText(env, env.LOGS_CHAT_ID, "⚠️ <b>رصد انضمام جماعي</b>\nالمجموعة: " + escapeHtml(message.chat.title || chatId) + "\nDistinct low-reputation users: " + result.total);
  if (env.BURST_ACTION === "delete") await telegram(env, "deleteMessage", { chat_id: chatId, message_id: message.message_id });
}
async function handleCommands(env, message, member) {
  const text = getText(message).trim();
  const command = normalizeCommand(text);
  const chatId = message.chat.id;
  if (["/ping", "!ping"].includes(command)) { await sendText(env, chatId, "رونين يعمل."); return true; }
  if (["/rules", "!rules", "/правила"].includes(command)) { await sendText(env, chatId, env.RULES_TEXT || "يرجى الالتزام بقوانين المجموعة واحترام الأعضاء."); return true; }
  if (["/me", "!me", "/info", "/lvl"].includes(command)) {
    await sendText(env, chatId, "<b>" + escapeHtml(message.from.first_name || "Member") + "</b>\nالرسائل: " + member.message_count + "\nالسمعة: " + member.reputation_points + "\nمخالفات الإزعاج: " + member.spam_violations + "\nمخالفات الألفاظ: " + member.profanity_violations);
    return true;
  }
  if (command === "/report" || command === "!report") {
    const target = message.reply_to_message;
    if (!target || !target.from || target.from.id === message.from.id || !env.REPORTS_CHAT_ID) {
      await sendText(env, chatId, "ردّ على رسالة العضو المراد الإبلاغ عنه. استقبال البلاغات غير مفعّل حتى تُضبط قناة البلاغات.");
      return true;
    }
    if (await isChatAdmin(env, chatId, target.from.id).catch(() => false)) { await sendText(env, chatId, "لا يمكن الإبلاغ عن مشرفي المجموعة."); return true; }
    const note = await sendText(env, env.REPORTS_CHAT_ID,
      "<b>بلاغ جديد</b>\nالمجموعة: " + escapeHtml(message.chat.title || chatId) + "\nالعضو المبلّغ عنه: " + escapeHtml(target.from.first_name || "Member") + " (<code>" + target.from.id + "</code>)\nمقدّم البلاغ: <code>" + message.from.id + "</code>\nالرسالة: " + escapeHtml(getText(target).slice(0, 600)),
      { reply_markup: { inline_keyboard: [[
        { text: "حذف الرسالة", callback_data: "report_del|" + chatId + "|" + target.message_id + "|" + target.from.id },
        { text: "حظر وحذف", callback_data: "report_ban|" + chatId + "|" + target.message_id + "|" + target.from.id },
        { text: "تجاهل", callback_data: "report_dismiss" },
      ]] } });
    await env.DB.prepare("INSERT OR IGNORE INTO reports (report_chat_id, report_message_id, source_chat_id, source_message_id, reported_user_id, reporter_user_id) VALUES (?, ?, ?, ?, ?, ?)").bind(env.REPORTS_CHAT_ID, note.message_id, chatId, target.message_id, target.from.id, message.from.id).run();
    await sendText(env, chatId, "تم إرسال البلاغ إلى المشرفين.");
    return true;
  }
  if (["/ban", "!ban", "/unban", "!unban"].includes(command)) {
    if (!message.reply_to_message || !message.reply_to_message.from || !await isChatAdmin(env, chatId, message.from.id).catch(() => false)) return true;
    const targetId = message.reply_to_message.from.id;
    if (await isChatAdmin(env, chatId, targetId).catch(() => false)) { await sendText(env, chatId, "لا يمكن حظر مشرف في المجموعة أو فك حظره."); return true; }
    const method = command.endsWith("unban") ? "unbanChatMember" : "banChatMember";
    await telegram(env, method, { chat_id: chatId, user_id: targetId });
    await sendText(env, chatId, method === "banChatMember" ? "تم حظر العضو." : "تم فك حظر العضو.");
    return true;
  }
  return false;
}
async function handleCallback(env, callback) {
  const parts = (callback.data || "").split("|");
  const action = parts[0];
  if (action === "report_dismiss") {
    const authorized = await isChatAdmin(env, callback.message.chat.id, callback.from.id).catch(() => false);
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: authorized ? "تم تجاهل البلاغ." : "هذه العملية للمشرفين فقط.", show_alert: !authorized });
    return;
  }
  if (!["report_del", "report_ban"].includes(action)) { await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "إجراء غير معروف." }); return; }
  const chatId = Number(parts[1]), messageId = Number(parts[2]), userId = Number(parts[3]);
  const authorized = await isChatAdmin(env, callback.message.chat.id, callback.from.id).catch(() => false);
  if (![chatId, messageId, userId].every(Number.isSafeInteger) || !authorized) {
    await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "هذه العملية للمشرفين فقط.", show_alert: true }); return;
  }
  await telegram(env, "deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => null);
  if (action === "report_ban") await telegram(env, "banChatMember", { chat_id: chatId, user_id: userId });
  await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id, text: action === "report_ban" ? "تم حظر العضو وحذف رسالته." : "تم حذف الرسالة." });
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
