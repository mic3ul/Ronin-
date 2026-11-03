import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { deleteRepeatedMessage, duplicateFingerprint, escapeHtml, handleCallback, isDrugSpam, isRepeatedMessage, normalizeCommand, safeEqual } from "../src/index.js";

test("webhook secret comparison rejects wrong values", () => {
  assert.equal(safeEqual("secret_123", "secret_123"), true);
  assert.equal(safeEqual("secret_123", "secret_124"), false);
  assert.equal(safeEqual("short", "longer"), false);
});

test("short drug-shop bait is recognized without flagging normal prose", () => {
  assert.equal(isDrugSpam("на пробу"), true);
  assert.equal(isDrugSpam("2 г"), true);
  assert.equal(isDrugSpam("2.5 gr"), true);
  assert.equal(isDrugSpam("проба 3 грамма"), false);
  assert.equal(isDrugSpam("Это обычное сообщение о пробе продукта для лаборатории"), false);
  assert.equal(isDrugSpam(""), false);
});

test("health endpoint is public and reports native runtime", async () => {
  const response = await worker.fetch(new Request("https://ronin.test/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "ronin-cloudflare-bot",
    status: "ok",
    runtime: "workers+d1",
  });
});

test("webhook rejects missing or invalid secret before touching D1", async () => {
  const request = new Request("https://ronin.test/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ update_id: 1 }),
  });
  const response = await worker.fetch(request, { DB: {}, TELEGRAM_BOT_TOKEN: "test" });
  assert.equal(response.status, 401);
});


test("HTML escaping neutralizes Telegram HTML metacharacters", () => {
  assert.equal(escapeHtml(`<&>"`), "&lt;&amp;&gt;&quot;");
});

test("Arabic moderation command aliases normalize to supported commands", () => {
  assert.equal(normalizeCommand("/فحص@RoninBot"), "/ping");
  assert.equal(normalizeCommand("/القوانين"), "/rules");
  assert.equal(normalizeCommand("/ملفي"), "/me");
  assert.equal(normalizeCommand("/بلاغ"), "/report");
  assert.equal(normalizeCommand("/حظر"), "/ban");
  assert.equal(normalizeCommand("/فك_الحظر"), "/unban");
  assert.equal(normalizeCommand("/custom@RoninBot"), "/custom");
});


function createFakeReportDb() {
  const report = {
    report_chat_id: -200,
    report_message_id: 900,
    source_chat_id: -100,
    source_message_id: 55,
    reported_user_id: 42,
    status: "open",
  };
  return {
    report,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (sql.includes("SET status = 'dismissed'")) {
                const matches = report.status === "open"
                  && report.report_chat_id === values[0]
                  && report.report_message_id === values[1];
                if (matches) report.status = "dismissed";
                return { meta: { changes: matches ? 1 : 0 } };
              }
              if (sql.includes("SET status = 'processing'")) {
                const matches = report.status === "open"
                  && report.report_chat_id === values[0]
                  && report.report_message_id === values[1]
                  && report.source_chat_id === values[2]
                  && report.source_message_id === values[3]
                  && report.reported_user_id === values[4];
                if (matches) report.status = "processing";
                return { meta: { changes: matches ? 1 : 0 } };
              }
              if (sql.includes("SET status = 'open'")) {
                if (report.status === "processing") report.status = "open";
                return { meta: { changes: 1 } };
              }
              if (sql.includes("SET status = ?")) {
                const matches = report.status === "processing"
                  && report.report_chat_id === values[1]
                  && report.report_message_id === values[2];
                if (matches) report.status = values[0];
                return { meta: { changes: matches ? 1 : 0 } };
              }
              throw new Error("Unexpected test SQL: " + sql);
            },
          };
        },
      };
    },
  };
}

function mockTelegramApi(t, memberStatus = "administrator") {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const payload = JSON.parse(options.body || "{}");
    calls.push({ method, payload });
    const result = method === "getChatMember" ? { status: memberStatus } : true;
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return calls;
}

test("report moderation callback is bound to its stored report and cannot be replayed", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeReportDb();
  const env = { DB, TELEGRAM_BOT_TOKEN: "test-token" };
  const callback = {
    id: "callback-1",
    data: "report_del|-100|55|42",
    from: { id: 77 },
    message: { chat: { id: -200 }, message_id: 900 },
  };

  await handleCallback(env, callback);
  assert.equal(DB.report.status, "resolved");
  assert.equal(calls.filter((call) => call.method === "deleteMessage").length, 1);

  await handleCallback(env, callback);
  assert.equal(calls.filter((call) => call.method === "deleteMessage").length, 1);
  assert.equal(calls.filter((call) => call.method === "answerCallbackQuery").length, 2);
});

test("report callback cannot act on source-message data that differs from the stored report", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeReportDb();
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, {
    id: "callback-2",
    data: "report_ban|-101|55|42",
    from: { id: 77 },
    message: { chat: { id: -200 }, message_id: 900 },
  });

  assert.equal(DB.report.status, "open");
  assert.equal(calls.some((call) => call.method === "banChatMember"), false);
  assert.equal(calls.some((call) => call.method === "deleteMessage"), false);
});

test("report dismiss button records a single-use dismissed status", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeReportDb();
  const callback = {
    id: "callback-3",
    data: "report_dismiss",
    from: { id: 77 },
    message: { chat: { id: -200 }, message_id: 900 },
  };

  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, callback);
  assert.equal(DB.report.status, "dismissed");
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, callback);
  assert.equal(DB.report.status, "dismissed");
  assert.equal(calls.filter((call) => call.method === "answerCallbackQuery").length, 2);
});

test("non-admin report callbacks cannot change report state or delete messages", async (t) => {
  const calls = mockTelegramApi(t, "member");
  const DB = createFakeReportDb();
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, {
    id: "callback-4",
    data: "report_del|-100|55|42",
    from: { id: 88 },
    message: { chat: { id: -200 }, message_id: 900 },
  });

  assert.equal(DB.report.status, "open");
  assert.equal(calls.some((call) => call.method === "deleteMessage"), false);
});


function createProcessedUpdateDb({ status = "processing", stale = false } = {}) {
  const row = { status, stale };
  return {
    row,
    prepare(sql) {
      return {
        bind() {
          return {
            async run() {
              if (sql.startsWith("INSERT OR IGNORE INTO processed_updates")) {
                return { meta: { changes: 0 } };
              }
              if (sql.includes("SET processed_at = CURRENT_TIMESTAMP")) {
                const reclaimed = row.status === "processing" && row.stale;
                if (reclaimed) row.stale = false;
                return { meta: { changes: reclaimed ? 1 : 0 } };
              }
              if (sql.includes("SET status = 'done'")) {
                row.status = "done";
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("DELETE FROM processed_updates")) {
                row.status = null;
                return { meta: { changes: 1 } };
              }
              throw new Error("Unexpected test SQL: " + sql);
            },
            async first() {
              return row.status ? { status: row.status, processed_at: row.stale ? "2000-01-01 00:00:00" : "2099-01-01 00:00:00" } : null;
            },
          };
        },
      };
    },
  };
}

test("webhook reclaims a stale processing update after a previous Worker interruption", async () => {
  const DB = createProcessedUpdateDb({ status: "processing", stale: true });
  const response = await worker.fetch(new Request("https://ronin.test/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "webhook-secret",
    },
    body: JSON.stringify({ update_id: 42 }),
  }), {
    DB,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  });

  assert.equal(response.status, 200);
  assert.equal(DB.row.status, "done");
});

test("webhook does not steal a fresh processing update", async () => {
  const DB = createProcessedUpdateDb({ status: "processing", stale: false });
  const response = await worker.fetch(new Request("https://ronin.test/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "webhook-secret",
    },
    body: JSON.stringify({ update_id: 43 }),
  }), {
    DB,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  });

  assert.equal(response.status, 503);
  assert.equal(DB.row.status, "processing");
});

test("webhook acknowledges already completed updates without processing them again", async () => {
  const DB = createProcessedUpdateDb({ status: "done", stale: false });
  const response = await worker.fetch(new Request("https://ronin.test/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "webhook-secret",
    },
    body: JSON.stringify({ update_id: 44 }),
  }), {
    DB,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, duplicate: true });
  assert.equal(DB.row.status, "done");
});


test("duplicate fingerprints normalize text, ignore commands, and hash media identity", async () => {
  const first = await duplicateFingerprint({ text: "  Hello   WORLD " });
  const normalized = await duplicateFingerprint({ text: "hello world" });
  assert.equal(first, normalized);
  assert.equal(await duplicateFingerprint({ text: "/ping" }), null);
  assert.equal(await duplicateFingerprint({ text: "!rules" }), null);

  const photoA = await duplicateFingerprint({
    photo: [{ file_unique_id: "small-id" }, { file_unique_id: "large-id" }],
    caption: "first caption",
  });
  const photoB = await duplicateFingerprint({
    photo: [{ file_unique_id: "small-id" }, { file_unique_id: "large-id" }],
    caption: "different caption",
  });
  assert.equal(photoA, photoB);
});

function createDuplicateDb() {
  const entries = new Map();
  return {
    entries,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (sql.startsWith("DELETE FROM duplicate_messages")) return { meta: { changes: 0 } };
              if (sql.startsWith("INSERT INTO duplicate_messages")) {
                const [chatId, fingerprint, messageId] = values;
                const key = String(chatId) + ":" + fingerprint;
                if (entries.has(key)) return { meta: { changes: 0 } };
                entries.set(key, { messageId });
                return { meta: { changes: 1 } };
              }
              throw new Error("Unexpected duplicate-test SQL: " + sql);
            },
          };
        },
      };
    },
  };
}

test("duplicate detection is scoped to each group and flags the second matching message", async () => {
  const DB = createDuplicateDb();
  const message = { chat: { id: -1001 }, message_id: 10, text: "same message" };

  assert.equal(await isRepeatedMessage(DB, message), false);
  assert.equal(await isRepeatedMessage(DB, { ...message, message_id: 11 }), true);
  assert.equal(await isRepeatedMessage(DB, {
    ...message,
    chat: { id: -1002 },
    message_id: 12,
  }), false);
});

test("duplicate detection does not register messages without usable content", async () => {
  const DB = createDuplicateDb();
  assert.equal(await isRepeatedMessage(DB, { chat: { id: -1001 }, message_id: 1 }), false);
  assert.equal(DB.entries.size, 0);
});


test("failed Telegram deletion does not count as a successful duplicate moderation action", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    description: "not enough rights to delete messages",
  }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const deleted = await deleteRepeatedMessage({
    TELEGRAM_BOT_TOKEN: "test-token",
  }, {
    chat: { id: -100123, title: "Test group" },
    from: { id: 456, first_name: "Member" },
    message_id: 789,
    text: "repeated content",
  });

  assert.equal(deleted, false);
});

test("duplicate moderation proceeds only after Telegram confirms deletion", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ method: String(url).split("/").pop(), payload: JSON.parse(options.body || "{}") });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const deleted = await deleteRepeatedMessage({
    TELEGRAM_BOT_TOKEN: "test-token",
  }, {
    chat: { id: -100123, title: "Test group" },
    from: { id: 456, first_name: "Member" },
    message_id: 790,
    text: "repeated content",
  });

  assert.equal(deleted, true);
  assert.deepEqual(calls.map((call) => call.method), ["deleteMessage"]);
  assert.deepEqual(calls[0].payload, { chat_id: -100123, message_id: 790 });
});


test("a false Telegram deleteMessage result is not treated as deletion", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: false }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const deleted = await deleteRepeatedMessage({
    TELEGRAM_BOT_TOKEN: "test-token",
  }, {
    chat: { id: -100123, title: "Test group" },
    from: { id: 456, first_name: "Member" },
    message_id: 791,
    text: "repeated content",
  });

  assert.equal(deleted, false);
});


test("final duplicate index migration removes legacy indexes and keeps the chat-time index", () => {
  const sql = readFileSync(
    new URL("../migrations/0008_duplicate_index_cleanup.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /DROP INDEX IF EXISTS idx_duplicate_messages_created;/);
  assert.match(sql, /DROP INDEX IF EXISTS idx_duplicate_messages_created_at;/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_duplicate_messages_chat_time/);
  assert.match(sql, /ON duplicate_messages\\(chat_id, created_at\\)/);
});
