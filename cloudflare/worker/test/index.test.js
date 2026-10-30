import test from "node:test";
import assert from "node:assert/strict";
import worker, { isDrugSpam, safeEqual } from "../src/index.js";

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
