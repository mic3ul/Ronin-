import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const secret = "ronin-test-secret";

test("health endpoint is public and does not expose configuration", async () => {
  const response = await worker.fetch(
    new Request("https://ronin.example/health"),
    {},
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "ronin-cloudflare-gateway",
    status: "ok",
  });
});

test("unknown routes are rejected", async () => {
  const response = await worker.fetch(
    new Request("https://ronin.example/unknown"),
    { TELEGRAM_WEBHOOK_SECRET: secret },
  );
  assert.equal(response.status, 404);
});

test("webhook rejects invalid secret before contacting backend", async () => {
  const response = await worker.fetch(
    new Request("https://ronin.example/telegram/webhook", { method: "POST", body: "{}" }),
    { TELEGRAM_WEBHOOK_SECRET: secret, BACKEND_URL: "https://origin.example" },
  );
  assert.equal(response.status, 401);
});

test("webhook forwards authenticated updates to the configured HTTPS origin", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://ronin.example/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": secret,
        },
        body: JSON.stringify({ update_id: 123 }),
      }),
      {
        TELEGRAM_WEBHOOK_SECRET: secret,
        BACKEND_URL: "https://origin.example/base-path",
      },
    );

    assert.equal(response.status, 200);
    assert.equal(captured.url, "https://origin.example/telegram/webhook");
    assert.equal(captured.options.headers.get("X-Ronin-Edge"), "cloudflare");
    assert.equal(captured.options.headers.get("X-Telegram-Bot-Api-Secret-Token"), secret);
    assert.equal(await response.text(), '{"ok":true}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("backend URL must use HTTPS", async () => {
  const response = await worker.fetch(
    new Request("https://ronin.example/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: "{}",
    }),
    { TELEGRAM_WEBHOOK_SECRET: secret, BACKEND_URL: "http://origin.example" },
  );
  assert.equal(response.status, 500);
});
