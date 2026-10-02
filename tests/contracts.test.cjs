const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isAction, validAnnotation } = require("../dist/contracts.js");
test("IPC rejects unknown and malformed actions", () => {
  for (const value of [null, {}, "capture", 3])
    assert.equal(isAction(value), false);
  assert.equal(isAction("clear"), true);
});
test("annotations stay within display coordinates", () => {
  assert.equal(
    validAnnotation({
      kind: "arrow",
      x: 0.35,
      y: 0.35,
      width: 0.15,
      height: 0.15,
    }),
    true,
  );
  assert.equal(
    validAnnotation({
      kind: "highlight",
      x: 0.9,
      y: 0.4,
      width: 0.2,
      height: 0.2,
    }),
    false,
  );
});

test('annotations reject missing and non-finite provider data', () => { for (const value of [null, {}, { kind:'arrow', x:NaN, y:0, width:.1, height:.1 }]) assert.equal(validAnnotation(value), false); });
