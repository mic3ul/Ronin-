import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildMusicKeyboardRows, duplicateFingerprint, extractMusicQuery, finishWhisperDraft, formatModerationFailureMessage, formatReportMessage, getProfileLevel, handleCallback, handlePrivateWhisper, isDrugSpam, isRepeatedMessage, normalizeCommandToken, normalizeMusicTracks, safeEqual, WHISPER_HELP_TEXT } from "../src/index.js";
test("command normalization strips Telegram bot mentions without losing command prefixes", () => {
  assert.equal(normalizeCommandToken("/help@RoninBot"), "/help");
  assert.equal(normalizeCommandToken("!mute@RoninBot"), "!mute");
  assert.equal(normalizeCommandToken("/مساعدة@RoninBot"), "/مساعدة");
  assert.equal(normalizeCommandToken("/help"), "/help");
});

test("music query extraction supports natural aliases, bot mentions, and keyboard prompts", () => {
  assert.equal(extractMusicQuery("/yt Drake"), "Drake");
  assert.equal(extractMusicQuery("/music Song title"), "Song title");
  assert.equal(extractMusicQuery("/يوت أغنية عربية"), "أغنية عربية");
  assert.equal(extractMusicQuery("/yt@RoninBot Radiohead"), "Radiohead");
  assert.equal(extractMusicQuery("/يوت", "/يوت"), "");
});

test("moderation failure messages escape HTML and use a real line break", () => {
  const message = formatModerationFailureMessage(new Error("<denied>"));
  assert.ok(message.includes("&lt;denied&gt;"));
  assert.equal(message.split("\n").length, 2);
  assert.equal(message.includes("\\n"), false);
});

test("whisper help describes the private composer and recipient-only reveal flow", () => {
  assert.ok(WHISPER_HELP_TEXT.includes("فتح المحرر"));
  assert.ok(WHISPER_HELP_TEXT.includes("المستلم قد بدأ البوت"));
  assert.ok(WHISPER_HELP_TEXT.includes("لا تكتب محتوى الهمسة بعد الأمر داخل المجموعة"));
  assert.ok(WHISPER_HELP_TEXT.includes("لا يظهر محتوى الهمسة في المجموعة"));
  assert.equal(WHISPER_HELP_TEXT.includes("سيحذف رونين رسالة الأمر من المجموعة ويرسل النص إلى الخاص"), false);
  assert.equal(WHISPER_HELP_TEXT.includes("همسة النص الذي تريد إرساله"), false);
});


test("Arabic report summaries escape untrusted group, member, and message text", () => {
  const report = formatReportMessage(
    { id: -100123, title: '<مجموعة & "خاصة">' },
    { id: 42, first_name: "<عضو>" },
    { id: 77 },
    '<script>alert("x")</script> & text',
  );

  assert.ok(report.includes("<b>بلاغ جديد</b>"));
  assert.match(report, /&lt;مجموعة &amp; &quot;خاصة&quot;&gt;/);
  assert.match(report, /&lt;عضو&gt;/);
  assert.ok(report.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; text"));
  assert.doesNotMatch(report, /<script>/);
});

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

test("profile levels advance at deterministic reputation thresholds", () => {
  assert.deepEqual(getProfileLevel(0), { level: 1, currentXp: 0, nextLevelXp: 50, remainingXp: 50 });
  assert.equal(getProfileLevel(49).level, 1);
  assert.equal(getProfileLevel(50).level, 2);
  assert.equal(getProfileLevel(199).level, 2);
  assert.equal(getProfileLevel(200).level, 3);
  assert.equal(getProfileLevel(-20).level, 1);
});

test("webhook setup endpoint rejects unauthenticated requests", async () => {
  const request = new Request("https://ronin.test/telegram/setup", { method: "POST" });
  const response = await worker.fetch(request, { TELEGRAM_WEBHOOK_SECRET: "expected-secret", TELEGRAM_BOT_TOKEN: "test" });
  assert.equal(response.status, 401);
});

test("webhook setup endpoint requires a configured bot token", async () => {
  const request = new Request("https://ronin.test/telegram/setup", {
    method: "POST",
    headers: { "X-Ronin-Setup-Key": "expected-secret" }
  });
  const response = await worker.fetch(request, { TELEGRAM_WEBHOOK_SECRET: "expected-secret" });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "bot_token_not_configured" });
});

test("Apple music results use normalized fields and valid callback identifiers", () => {
  const tracks = normalizeMusicTracks({ results: [{
    trackId: 123456,
    trackName: "Song title",
    artistName: "Artist name",
    previewUrl: "https://audio.example/preview",
    trackViewUrl: "https://music.apple.com/song/123456",
  }] }, "apple");

  assert.deepEqual(tracks, [{
    id: "123456",
    title: "Song title",
    artist: "Artist name",
    preview: "https://audio.example/preview",
    page: "https://music.apple.com/song/123456",
  }]);
  assert.deepEqual(buildMusicKeyboardRows(tracks, "apple"), [[{
    text: "Song title — Artist name",
    callback_data: "music:123456",
  }]]);
});

test("Deezer music results use normalized fields and Deezer callback identifiers", () => {
  const tracks = normalizeMusicTracks({ data: [{
    id: 789,
    title: "Another song",
    artist: { name: "Another artist" },
    preview: "https://audio.example/deezer-preview",
    link: "https://www.deezer.com/track/789",
  }] }, "deezer");

  assert.deepEqual(buildMusicKeyboardRows(tracks, "deezer"), [[{
    text: "Another song — Another artist",
    callback_data: "deezer:789",
  }]]);
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
              throw new Error("Unexpected report-test SQL: " + sql);
            },
          };
        },
      };
    },
  };
}

function mockTelegramApi(t, { memberStatus = "administrator", results = {} } = {}) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const payload = JSON.parse(options.body || "{}");
    calls.push({ method, payload });
    const result = method === "getChatMember" ? { status: memberStatus } : (results[method] ?? true);
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return calls;
}

function reportCallback(data = "report_del|-100|55|42") {
  return {
    id: "report-callback",
    data,
    from: { id: 77 },
    message: { chat: { id: -200 }, message_id: 900 },
  };
}

test("report moderation is admin-only, bound to stored data, and single-use", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeReportDb();
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, reportCallback());

  assert.equal(DB.report.status, "resolved");
  assert.equal(calls.filter((call) => call.method === "deleteMessage").length, 1);

  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, reportCallback());
  assert.equal(calls.filter((call) => call.method === "deleteMessage").length, 1);
});

test("non-admin report callbacks cannot change state or delete messages", async (t) => {
  const calls = mockTelegramApi(t, { memberStatus: "member" });
  const DB = createFakeReportDb();
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, reportCallback());

  assert.equal(DB.report.status, "open");
  assert.equal(calls.some((call) => call.method === "deleteMessage"), false);
});

test("report callback rejects source-message data that differs from the stored report", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeReportDb();
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, reportCallback("report_ban|-101|55|42"));

  assert.equal(DB.report.status, "open");
  assert.equal(calls.some((call) => call.method === "banChatMember"), false);
  assert.equal(calls.some((call) => call.method === "deleteMessage"), false);
});

test("failed report deletion leaves the report open for a safe retry", async (t) => {
  const calls = mockTelegramApi(t, { results: { deleteMessage: false } });
  const DB = createFakeReportDb();
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, reportCallback());

  assert.equal(DB.report.status, "open");
  assert.equal(calls.filter((call) => call.method === "deleteMessage").length, 1);
});

test("a confirmed report ban is not repeated when message deletion fails", async (t) => {
  const calls = mockTelegramApi(t, { results: { deleteMessage: false } });
  const DB = createFakeReportDb();
  const callback = reportCallback("report_ban|-100|55|42");

  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, callback);

  assert.equal(DB.report.status, "banned");
  assert.equal(calls.filter((call) => call.method === "banChatMember").length, 1);
  assert.equal(calls.filter((call) => call.method === "deleteMessage").length, 1);
  assert.ok(calls.some((call) => call.method === "answerCallbackQuery"
    && call.payload.text.includes("لن نكرر الحظر")));

  // A second click must not issue the already-confirmed ban again.
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, callback);
  assert.equal(calls.filter((call) => call.method === "banChatMember").length, 1);
});

test("report dismissal is stored and cannot be repeated", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeReportDb();
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, reportCallback("report_dismiss"));
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, reportCallback("report_dismiss"));

  assert.equal(DB.report.status, "dismissed");
  assert.equal(calls.filter((call) => call.method === "answerCallbackQuery").length, 2);
});


test("duplicate fingerprints normalize Arabic text and prefer media identity over captions", async () => {
  const plain = await duplicateFingerprint({ text: "السلام" });
  assert.equal(await duplicateFingerprint({ text: "السَّلَامُ" }), plain);
  assert.equal(await duplicateFingerprint({ text: "الســلام" }), plain);

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

test("duplicate media fingerprint falls back to file_id when file_unique_id is absent", async () => {
  const first = await duplicateFingerprint({
    document: { file_id: "legacy-file-id" },
    caption: "first caption",
  });
  const second = await duplicateFingerprint({
    document: { file_id: "legacy-file-id" },
    caption: "different caption",
  });
  assert.equal(first, second);
});

test("duplicate fingerprints ignore slash and bang commands", async () => {
  assert.equal(await duplicateFingerprint({ text: "/help" }), null);
  assert.equal(await duplicateFingerprint({ text: "!help" }), null);
  assert.equal(
    await duplicateFingerprint({ text: "  ordinary   repeated text " }),
    await duplicateFingerprint({ text: "ordinary repeated text" }),
  );
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

test("duplicate detection atomically rejects concurrent repeats and isolates groups", async () => {
  const DB = createDuplicateDb();
  const env = { DB };
  const message = { chat: { id: -1001 }, message_id: 10, text: "same message" };
  const results = await Promise.all([
    isRepeatedMessage(env, message),
    isRepeatedMessage(env, { ...message, message_id: 11 }),
  ]);

  assert.deepEqual(results.slice().sort(), [false, true]);
  assert.equal(await isRepeatedMessage(env, {
    ...message,
    chat: { id: -1002 },
    message_id: 12,
  }), false);
  assert.equal(await isRepeatedMessage(env, { ...message, message_id: 13 }), true);
});

test("duplicate detection ignores messages without valid identifiers or content", async () => {
  const DB = createDuplicateDb();
  assert.equal(await isRepeatedMessage({ DB }, { chat: { id: -1001 }, text: "hello" }), false);
  assert.equal(await isRepeatedMessage({ DB }, { chat: { id: -1001 }, message_id: 1 }), false);
  assert.equal(DB.entries.size, 0);
});


function createFakeWhisperDb(initialWhisper = null) {
  let whisper = initialWhisper ? { ...initialWhisper } : null;
  let draftStatus = "composing";
  const nextId = initialWhisper?.id || 42;
  return {
    get whisper() { return whisper ? { ...whisper } : null; },
    get draftStatus() { return draftStatus; },
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() {
          if (sql.includes("SELECT * FROM whispers WHERE id=?")) {
            return whisper && Number(whisper.id) === Number(values[0]) ? { ...whisper } : null;
          }
          throw new Error("Unexpected whisper-test SELECT: " + sql);
        },
        async run() {
          if (sql.includes("INSERT INTO whispers")) {
            whisper = {
              id: nextId,
              sender_user_id: values[0],
              recipient_user_id: values[1],
              body: values[2],
              status: "pending",
              opened_at: null,
            };
            return { meta: { last_row_id: nextId, changes: 1 } };
          }
          if (sql.includes("UPDATE whispers SET status='opening'")) {
            const matches = whisper && Number(whisper.id) === Number(values[0]) && whisper.status === "pending";
            if (matches) whisper.status = "opening";
            return { meta: { changes: matches ? 1 : 0 } };
          }
          if (sql.includes("UPDATE whispers SET status='opened'")) {
            const matches = whisper && Number(whisper.id) === Number(values[0]) && whisper.status === "opening";
            if (matches) { whisper.status = "opened"; whisper.opened_at = "2026-11-09 12:00:00"; }
            return { meta: { changes: matches ? 1 : 0 } };
          }
          if (sql.includes("UPDATE whispers SET status='pending'")) {
            const matches = whisper && Number(whisper.id) === Number(values[0]) && whisper.status === "opening";
            if (matches) whisper.status = "pending";
            return { meta: { changes: matches ? 1 : 0 } };
          }
          if (sql.includes("UPDATE whispers SET status='failed'")) {
            if (whisper && Number(whisper.id) === Number(values[0])) whisper.status = "failed";
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE whisper_drafts SET status='sending'")) {
            const matches = draftStatus === "composing";
            if (matches) draftStatus = "sending";
            return { meta: { changes: matches ? 1 : 0 } };
          }
          if (sql.includes("UPDATE whisper_drafts SET status='composing'")) {
            const matches = draftStatus === "sending";
            if (matches) draftStatus = "composing";
            return { meta: { changes: matches ? 1 : 0 } };
          }
          if (sql.includes("UPDATE whisper_drafts SET status='sent'")) {
            if (draftStatus === "sending") draftStatus = "sent";
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE whisper_drafts SET status='failed'")) {
            draftStatus = "failed";
            return { meta: { changes: 1 } };
          }
          throw new Error("Unexpected whisper-test SQL: " + sql);
        },
      };
    },
  };
}

function whisperOpenCallback({ id = 42, actorId = 200, chatId = -100123 } = {}) {
  return {
    id: "whisper-open-callback",
    data: "whisper_open:" + id,
    from: { id: actorId, first_name: "المستلم" },
    message: { chat: { id: chatId }, message_id: 0, ephemeral_message_id: 12 },
  };
}

test("private /start deep links activate only the matching sender's whisper composer", async (t) => {
  const calls = mockTelegramApi(t);
  const token = "a".repeat(24);
  let draftStatus = "choosing";
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() {
          assert.ok(sql.includes("FROM whisper_drafts"));
          assert.equal(values[0], token);
          assert.equal(values[1], 100);
          return { token, sender_user_id: 100, status: "choosing" };
        },
        async run() {
          assert.ok(sql.includes("UPDATE whisper_drafts SET status='composing'"));
          draftStatus = "composing";
          return { meta: { changes: 1 } };
        },
      };
    },
  };

  await handlePrivateWhisper(
    { DB, TELEGRAM_BOT_TOKEN: "test-token" },
    { from: { id: 100 }, chat: { id: 100 }, text: "/start w_" + token },
  );

  assert.equal(draftStatus, "composing");
  assert.ok(calls.some((call) => call.method === "sendMessage"
    && call.payload.text.includes("أرسل نص الهمسة")));
});

test("a different sender cannot activate another user's whisper deep link", async (t) => {
  const calls = mockTelegramApi(t);
  const token = "b".repeat(24);
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() {
          assert.ok(sql.includes("sender_user_id=?"));
          assert.ok(sql.includes("expires_at>CURRENT_TIMESTAMP"));
          assert.equal(values[0], token);
          assert.equal(values[1], 999);
          return null;
        },
        async run() {
          throw new Error("An unauthorized deep link must not change draft state");
        },
      };
    },
  };

  await handlePrivateWhisper(
    { DB, TELEGRAM_BOT_TOKEN: "test-token" },
    { from: { id: 999 }, chat: { id: 999 }, text: "/start w_" + token },
  );

  assert.ok(calls.some((call) => call.method === "sendMessage"
    && call.payload.text.includes("انتهت صلاحية محرر الهمسة")));
  assert.equal(calls.some((call) => call.method === "sendMessage"
    && call.payload.text.includes("أرسل نص الهمسة")), false);
});

test("finishing a whisper sends only an ephemeral open prompt and keeps content pending", async (t) => {
  const calls = mockTelegramApi(t, { results: { getMe: { id: 999, username: "ronin_bot" } } });
  const DB = createFakeWhisperDb();
  await finishWhisperDraft(
    { DB, TELEGRAM_BOT_TOKEN: "test-token" },
    { token: "draft-token", chat_id: -100123, sender_user_id: 100, recipient_user_id: 200, mode: "text" },
    { from: { id: 100 }, chat: { id: 100 }, text: "محتوى سري لا يظهر قبل الفتح" },
  );

  const prompt = calls.find((call) => call.method === "sendMessage" && call.payload.ephemeral_message_parameters);
  assert.ok(prompt);
  assert.ok(prompt.payload.text.includes("\nاضغط"));
  assert.equal(prompt.payload.text.includes("\\nاضغط"), false);
  assert.equal(prompt.payload.ephemeral_message_parameters.receiver_user_id, 200);
  assert.equal(prompt.payload.text.includes("محتوى سري"), false);
  assert.equal(prompt.payload.reply_markup.inline_keyboard[0][0].callback_data, "whisper_open:42");
  assert.equal(DB.whisper.status, "pending");
  assert.ok(DB.whisper.body.includes('"version":1'));
});

test("a composing whisper draft can be claimed only once under concurrent private updates", async (t) => {
  const calls = mockTelegramApi(t, { results: { getMe: { id: 999, username: "ronin_bot" } } });
  const DB = createFakeWhisperDb();
  const env = { DB, TELEGRAM_BOT_TOKEN: "test-token" };
  const draft = { token: "draft-token", chat_id: -100123, sender_user_id: 100, recipient_user_id: 200, mode: "text" };
  const message = { from: { id: 100 }, chat: { id: 100 }, text: "رسالة واحدة فقط" };

  await Promise.all([
    finishWhisperDraft(env, draft, message),
    finishWhisperDraft(env, draft, message),
  ]);

  const prompts = calls.filter((call) => call.method === "sendMessage"
    && call.payload.text?.includes("وصلتك همسة خاصة"));
  assert.equal(prompts.length, 1);
  assert.equal(DB.draftStatus, "sent");
  assert.ok(calls.some((call) => call.method === "sendMessage"
    && call.payload.text?.includes("سبق استخدامه")));
});

test("failed whisper notification closes the draft instead of allowing duplicate retries", async (t) => {
  const calls = mockTelegramApi(t, { results: { getMe: { id: 999, username: "ronin_bot" } } });
  const normalFetch = globalThis.fetch;
  let failPrompt = true;
  globalThis.fetch = async (url, options = {}) => {
    const method = String(url).split("/").pop();
    const payload = JSON.parse(options.body || "{}");
    if (method === "sendMessage" && payload.ephemeral_message_parameters && failPrompt) {
      failPrompt = false;
      calls.push({ method, payload });
      return new Response(JSON.stringify({ ok: false, description: "simulated delivery failure" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return normalFetch(url, options);
  };
  const DB = createFakeWhisperDb();
  await finishWhisperDraft(
    { DB, TELEGRAM_BOT_TOKEN: "test-token" },
    { token: "draft-token", chat_id: -100123, sender_user_id: 100, recipient_user_id: 200, mode: "text" },
    { from: { id: 100 }, chat: { id: 100 }, text: "رسالة اختبار" },
  );

  assert.equal(DB.draftStatus, "failed");
  assert.equal(DB.whisper.status, "failed");
  assert.ok(calls.some((call) => call.method === "sendMessage"
    && call.payload.text?.includes("ابدأ همسة جديدة")));
});

test("overlapping composing drafts are cancelled instead of choosing the newest recipient", async (t) => {
  const calls = mockTelegramApi(t);
  const drafts = [
    { token: "draft-one", sender_user_id: 100, recipient_user_id: 200, status: "composing" },
    { token: "draft-two", sender_user_id: 100, recipient_user_id: 300, status: "composing" },
  ];
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async all() {
          if (sql.includes("FROM whisper_drafts") && sql.includes("LIMIT 2")) {
            return { results: drafts.filter((draft) => draft.sender_user_id === values[0]).slice(0, 2) };
          }
          throw new Error("Unexpected private-whisper test query: " + sql);
        },
        async run() {
          if (sql.includes("UPDATE whisper_drafts SET status='failed'")) {
            for (const draft of drafts) {
              if (draft.sender_user_id === values[0] && draft.status === "composing") draft.status = "failed";
            }
            return { meta: { changes: 2 } };
          }
          throw new Error("Unexpected private-whisper test update: " + sql);
        },
      };
    },
  };

  await handlePrivateWhisper(
    { DB, TELEGRAM_BOT_TOKEN: "test-token" },
    { from: { id: 100 }, chat: { id: 100 }, text: "لا ترسلها لأي مستلم" },
  );

  assert.deepEqual(drafts.map((draft) => draft.status), ["failed", "failed"]);
  assert.ok(calls.some((call) => call.method === "sendMessage"
    && call.payload.text?.includes("أكثر من محرر همسة مفتوح")));
});

test("opening a text whisper reveals it ephemerally and notifies the sender", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeWhisperDb({
    id: 42,
    sender_user_id: 100,
    recipient_user_id: 200,
    body: JSON.stringify({ version: 1, text: "رسالة لا يراها إلا المستلم", media: null }),
    status: "pending",
  });

  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, whisperOpenCallback());

  const delivery = calls.find((call) => call.method === "sendMessage"
    && call.payload.ephemeral_message_parameters?.callback_query_id === "whisper-open-callback");
  assert.ok(delivery);
  assert.equal(delivery.payload.ephemeral_message_parameters.receiver_user_id, 200);
  assert.ok(delivery.payload.text.includes("رسالة لا يراها إلا المستلم"));
  assert.equal(delivery.payload.reply_markup.inline_keyboard[0][0].callback_data, "whisper_reply:42");
  assert.equal(DB.whisper.status, "opened");
  assert.ok(calls.some((call) => call.method === "sendMessage"
    && call.payload.ephemeral_message_parameters?.receiver_user_id === 100
    && call.payload.text.includes("تم فتح همستك")));
});

test("opening a media whisper sends the stored Telegram file only to its recipient", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeWhisperDb({
    id: 42,
    sender_user_id: 100,
    recipient_user_id: 200,
    body: JSON.stringify({ version: 1, text: "", media: { type: "photo", fileId: "photo-file-id" } }),
    status: "pending",
  });

  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, whisperOpenCallback());

  const delivery = calls.find((call) => call.method === "sendPhoto");
  assert.ok(delivery);
  assert.equal(delivery.payload.photo, "photo-file-id");
  assert.equal(delivery.payload.ephemeral_message_parameters.receiver_user_id, 200);
  assert.equal(delivery.payload.ephemeral_message_parameters.callback_query_id, "whisper-open-callback");
  assert.equal(delivery.payload.reply_markup.inline_keyboard[0][0].callback_data, "whisper_reply:42");
  assert.equal(DB.whisper.status, "opened");
});

test("a user cannot open another member's whisper", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeWhisperDb({
    id: 42,
    sender_user_id: 100,
    recipient_user_id: 200,
    body: JSON.stringify({ version: 1, text: "private", media: null }),
    status: "pending",
  });

  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, whisperOpenCallback({ actorId: 201 }));

  assert.equal(DB.whisper.status, "pending");
  assert.equal(calls.some((call) => call.payload.ephemeral_message_parameters?.callback_query_id), false);
});

test("a whisper can only be opened once", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeWhisperDb({
    id: 42,
    sender_user_id: 100,
    recipient_user_id: 200,
    body: "legacy plain-text whisper",
    status: "pending",
  });

  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, whisperOpenCallback());
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, whisperOpenCallback());

  assert.equal(DB.whisper.status, "opened");
  assert.equal(calls.filter((call) => call.method === "sendMessage"
    && call.payload.ephemeral_message_parameters?.callback_query_id).length, 1);
  const delivery = calls.find((call) => call.method === "sendMessage"
    && call.payload.ephemeral_message_parameters?.callback_query_id);
  assert.ok(delivery.payload.text.includes("legacy plain-text whisper"));
});


test("callback acknowledgement failure does not reopen an already delivered whisper", async (t) => {
  const calls = mockTelegramApi(t);
  const normalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/answerCallbackQuery")) throw new Error("simulated callback acknowledgement failure");
    return normalFetch(url, options);
  };
  const DB = createFakeWhisperDb({
    id: 42,
    sender_user_id: 100,
    recipient_user_id: 200,
    body: JSON.stringify({ version: 1, text: "تم تسليمها", media: null }),
    status: "pending",
  });

  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, whisperOpenCallback());

  assert.equal(DB.whisper.status, "opened");
  assert.equal(calls.filter((call) => call.method === "sendMessage"
    && call.payload.ephemeral_message_parameters?.callback_query_id).length, 1);
});

test("a delivered whisper stays locked when D1 cannot commit its opened state", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeWhisperDb({
    id: 42,
    sender_user_id: 100,
    recipient_user_id: 200,
    body: JSON.stringify({ version: 1, text: "تم تسليمها مرة واحدة", media: null }),
    status: "pending",
  });
  const originalPrepare = DB.prepare.bind(DB);
  DB.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (!sql.includes("UPDATE whispers SET status='opened'")) return statement;
    return {
      bind(...values) {
        statement.bind(...values);
        return {
          async run() {
            throw new Error("simulated D1 finalization failure");
          },
        };
      },
    };
  };

  const env = { DB, TELEGRAM_BOT_TOKEN: "test-token" };
  await handleCallback(env, whisperOpenCallback());

  const deliveries = () => calls.filter((call) => call.method === "sendMessage"
    && call.payload.ephemeral_message_parameters?.callback_query_id === "whisper-open-callback");
  assert.equal(deliveries().length, 1);
  assert.equal(DB.whisper.status, "opening");
  assert.ok(calls.some((call) => call.method === "answerCallbackQuery"
    && call.payload.text.includes("لن نعيد إرسالها تلقائياً")));

  // A second callback cannot claim an indeterminate opening and deliver the secret again.
  await handleCallback(env, whisperOpenCallback());
  assert.equal(deliveries().length, 1);
  assert.equal(DB.whisper.status, "opening");
});
