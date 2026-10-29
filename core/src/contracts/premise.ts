import { valueSet } from "../values.ts";

// The words the premise report and spec.md's root cause section are written in. Planner's Python grades those
// lines and its TypeScript reads facts from them, so each word is spelled here once and reaches the Python through
// generated/premise.json (root ADR-0010 d1).

// The outcome the user picks at the premise. The order is the form's, and planner's Python unpacks the picks by it.
export const PremisePick = valueSet({
  "write the spec": "the issue has decisions in it, so the run writes its spec",
  "no spec needed": "the request fixes the outcome, so the run writes a spec.md that says no spec is needed",
  "not worth doing": "the issue is not worth doing, so the run writes no spec",
});

export const REPORTS_WRONG_BEHAVIOUR = { label: "Reports wrong behaviour", yes: "yes", no: "no" } as const;

export const ROOT_CAUSE = {
  heading: "## Root cause",
  observed: "Observed:",
  not_a_defect: "Not a defect report.",
  hypothesis: "Observed: nothing; this trace is a hypothesis from reading the code.",
} as const;
