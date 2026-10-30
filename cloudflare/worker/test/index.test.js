import test from "node:test";
import assert from "node:assert/strict";
import { isDrugSpam, safeEqual } from "../src/index.js";

test("webhook secret comparison rejects wrong values", () => {
  assert.equal(safeEqual("secret_123", "secret_123"), true);
  assert.equal(safeEqual("secret_123", "secret_124"), false);
  assert.equal(safeEqual("short", "longer"), false);
});
test("short drug-shop bait is recognized", () => {
  assert.equal(isDrugSpam("на пробу"), true);
  assert.equal(isDrugSpam("2 г"), true);
  assert.equal(isDrugSpam("2.5 gr"), true);
  assert.equal(isDrugSpam("проба 3 грамма"), false);
});
test("ordinary text is not drug-shop bait", () => {
  assert.equal(isDrugSpam("Это обычное сообщение о пробе продукта для лаборатории"), false);
  assert.equal(isDrugSpam(""), false);
});
