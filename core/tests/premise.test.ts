import { test } from "node:test";
import assert from "node:assert/strict";
import { PremisePick, REPORTS_WRONG_BEHAVIOUR, ROOT_CAUSE } from "../src/contracts/premise.ts";

// The spelling is data-model.md "Premise vocabulary"'s, which planner's form and template are written in; these
// literals pin it.
test("the picks are write the spec, no spec needed and not worth doing, in that order, each with a meaning", () => {
  assert.deepEqual(PremisePick.schema.options, ["write the spec", "no spec needed", "not worth doing"]);
  assert.deepEqual(Object.keys(PremisePick.meaning), PremisePick.schema.options);
  for (const [pick, meaning] of Object.entries(PremisePick.meaning)) assert.match(meaning, /\S/, `${pick} has no meaning`);
});

test("Reports wrong behaviour is answered yes or no", () => {
  assert.deepEqual(REPORTS_WRONG_BEHAVIOUR, { label: "Reports wrong behaviour", yes: "yes", no: "no" });
});

test("the root cause section opens with Observed:, the hypothesis sentence or the no-defect sentence", () => {
  assert.deepEqual(ROOT_CAUSE, {
    heading: "## Root cause",
    observed: "Observed:",
    not_a_defect: "Not a defect report.",
    hypothesis: "Observed: nothing; this trace is a hypothesis from reading the code.",
  });
});
