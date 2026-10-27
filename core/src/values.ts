import * as z from "zod";

// The meaning record is the one list of a set's values: the enum is built from its keys, so neither can name a
// value the other lacks (root ADR-0010 d3).
function valueSet<const Meaning extends Record<string, string>>(meaning: Meaning) {
  type Value = keyof Meaning & string;
  return {schema: z.enum(Object.keys(meaning) as [Value, ...Value[]]), meaning};
}

// reviewer ADR-0021 d4.
export const RoundResult = valueSet({
  CLEAN: "every expected reviewer answered and none found anything",
  DIRTY: "every expected reviewer answered and at least one found something",
  INCOMPLETE: "an expected reviewer was silent",
});

// Ruled on a DIRTY round only; reviewer ADR-0013, ADR-0017, ADR-0018.
export const RoundVerdict = valueSet({
  PATCH: "the findings to fix are independent defects, each with its own mechanism",
  CLASS_FIX: "two or more findings are one mechanism at several sites, fixed at every site",
  REDESIGN: "the findings come from the shape of the change, which one rewrite replaces",
  RESCOPE: "a decision the spec does not settle is being settled in the diff; the spec is reopened",
  CONVERGED_PUSHBACK: "nothing must change: every finding is pushed back or deferred",
  ESCALATE: "the assessor cannot tell, or no admissible verdict fits; an admin decides",
});

// reviewer ADR-0017.
export const FindingRuling = valueSet({
  FIX: "real, and this change is where it belongs",
  PUSH_BACK: "not real, or not worth the change",
  DEFER: "real, but independent of this change; it moves to an issue",
});

// The root-cause reviewer's verdict on a round; reviewer ADR-0017.
export const RootCause = valueSet({
  AT_CAUSE: "the change alters the mechanism the spec's root cause names",
  AT_SYMPTOM: "the change reacts to the wrong state instead of changing how it comes to exist",
  SPEC_WRONG: "the spec's root cause is not the mechanism",
  CANNOT_TELL: "the reviewer could not locate the mechanism",
  NOT_APPLICABLE: "the spec records no observed root cause, so none is judged",
});

// root ADR-0003 d1, d6 and ADR-0004.
export const CheckOutcome = valueSet({
  PENDING: "the check has not yet read the head asked, and its timeout has not run",
  PASS: "the check read the head asked and passed it",
  FAIL: "the check read the head asked and failed it",
  SILENT: "the check gave no reading of the head asked within its timeout",
  COULD_NOT_RUN: "the check could not run: never a pass, never a finding against the author",
  WAIVED: "the external reviewer is out of credits and gave no verdict; counts as a pass",
});

// Lower case, as a hold kind is its hold id's prefix (root ADR-0010 d2); reviewer ADR-0013 d4, d5.
export const HoldKind = valueSet({
  rescope: "a RESCOPE verdict, or the rescope's spec PR open; refuses every code commit but a default-branch merge",
  escalation: "an ESCALATE verdict, or a trusted thread answered too often after its ruling; refuses commits and rounds",
  pushback: "a github round ruled no FIX while a merge blocker fails at the head; refuses rounds",
  claim: "a lineage reached its count of WRONG claim rulings; refuses commits touching its file",
  shim: "a bug reached its hold count; refuses commits touching its lines",
  audit: "escalation audits not ruled CONVERGED_PUSHBACK reached their count; refuses rounds",
});

// reviewer ADR-0011, ADR-0013.
export const HoldState = valueSet({
  OPEN: "the hold refuses what its kind refuses",
  RELEASED: "a Ready move and an admin's comment, or a reset, released it; its row stays",
});

// reviewer ADR-0019.
export const RoundStage = valueSet({
  INTERNAL: "reviewer's own agents review the committed head",
  AUDIT: "the whole PR is reviewed, once a stage has used its max_rounds",
  GITHUB: "the PR's findings from external reviewers and threads, read through core's modules",
});

export const CoreSource = z.enum(["threads", "required-checks"]);

// A module name is also a folder in validators/, a `[shared] validators` entry and part of the check name
// `<module>-review`, so one grammar keeps it fit for all three; no list of modules exists (root ADR-0010 d2).
export const ModuleName = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .refine((name) => !CoreSource.safeParse(name).success, {error: "a module name cannot be a core source"});

export const FindingSource = z.union([CoreSource, ModuleName]);
