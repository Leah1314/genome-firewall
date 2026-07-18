const test = require("node:test");
const assert = require("node:assert/strict");
const { heldOutCases } = require("../src/demo-cases");

test("held-out cases are scored from the real committed features/models, not placeholders", async () => {
  const results = await heldOutCases();
  assert.equal(results.length, 3);
  for (const antibiotic of results) {
    assert.equal(antibiotic.available, true);
    assert.ok(antibiotic.cases.length > 0);
    for (const item of antibiotic.cases) {
      assert.ok(item.sampleId);
      assert.ok(item.groupId);
      assert.ok(["resistant", "susceptible"].includes(item.trueLabel));
      assert.ok(["likely_to_fail", "likely_to_work", "no_call"].includes(item.decision));
      assert.ok(item.probabilityOfFailure >= 0 && item.probabilityOfFailure <= 1);
      if (item.decision === "no_call") {
        assert.equal(item.correct, null);
      } else {
        assert.equal(typeof item.correct, "boolean");
      }
    }
  }
});
