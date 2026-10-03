const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validAnnotation } = require("../dist/contracts.js");
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

test("annotations reject missing and non-finite provider data", () => {
  for (const value of [
    null,
    {},
    { kind: "arrow", x: NaN, y: 0, width: 0.1, height: 0.1 },
  ])
    assert.equal(validAnnotation(value), false);
});
