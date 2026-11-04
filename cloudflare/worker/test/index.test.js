import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildMusicKeyboardRows, duplicateFingerprint, getProfileLevel, handleCallback, isDrugSpam, normalizeMusicTracks, safeEqual } from "../src/index.js";

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

test("report dismissal is stored and cannot be repeated", async (t) => {
  const calls = mockTelegramApi(t);
  const DB = createFakeReportDb();
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, reportCallback("report_dismiss"));
  await handleCallback({ DB, TELEGRAM_BOT_TOKEN: "test-token" }, reportCallback("report_dismiss"));

  assert.equal(DB.report.status, "dismissed");
  assert.equal(calls.filter((call) => call.method === "answerCallbackQuery").length, 2);
});


test("duplicate fingerprints ignore slash and bang commands", async () => {
  assert.equal(await duplicateFingerprint({ text: "/help" }), null);
  assert.equal(await duplicateFingerprint({ text: "!help" }), null);
  assert.equal(
    await duplicateFingerprint({ text: "  ordinary   repeated text " }),
    await duplicateFingerprint({ text: "ordinary repeated text" }),
  );
});
