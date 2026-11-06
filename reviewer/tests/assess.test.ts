import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FindingRuling, RoundVerdict } from "../plugin/core/values.ts";
import { assessmentSchema, findingsSchema, readAssessment, readReport, REDESIGN_DIAGNOSES, type AssessmentRead } from "../plugin/lib/round/assess.ts";
import { admissibleVerdicts, ASSESSOR_VERDICTS, RESHAPE_SPEC, type Assessment } from "../plugin/lib/rules/rounds.ts";

const { FIX, PUSH_BACK, DEFER, ESCALATE: ESCALATE_RULING } = FindingRuling.schema.enum;
const { PATCH, CLASS_FIX, REDESIGN, CONVERGED_PUSHBACK, ESCALATE } = RoundVerdict.schema.enum;

const REF = "acme/demo#7:internal-1";
const TOKEN = "tok";
const IDS = ["code-reviewer-1", "code-reviewer-2", "silent-failure-hunter-1"];
const [ONE, TWO, THREE] = IDS;

function entry(id: string, verdict: string = FIX, kind = "defect", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, verdict, kind, spec_ref: "D1", mechanism: "m", reason: "r", ...extra };
}

function check(overrides: Record<string, unknown> = {}, { burden = false, churned = false } = {}): AssessmentRead {
  const body = { round_ref: REF, brief_token: TOKEN, round_verdict: PATCH, findings: IDS.map((id) => entry(id)), rationale: "x", user_decision: null, ...overrides };
  return readAssessment(body, { roundRef: REF, findingIds: IDS, admissible: admissibleVerdicts(churned), burden, token: TOKEN });
}

function errorsOf(read: AssessmentRead): string[] {
  return read.ok ? [] : read.errors;
}

function refused(read: AssessmentRead, named: RegExp): void {
  assert.ok(errorsOf(read).some((error) => named.test(error)), `no error matches ${named}: ${JSON.stringify(errorsOf(read))}`);
}

describe("readAssessment", () => {
  it("takes a complete, consistent PATCH, as the assessment the round's verdict is ruled from", () => {
    const read = check();
    assert.ok(read.ok, JSON.stringify(errorsOf(read)));
    const assessment: Assessment = read.assessment;
    assert.deepEqual([assessment.round_verdict, assessment.findings.map(({ id }) => id)], [PATCH, IDS]);
  });

  it("refuses an assessment made without reading the brief, saying only that", () => {
    assert.deepEqual(errorsOf(check({ brief_token: "guessed", round_verdict: CLASS_FIX })), [
      "brief_token does not match: run the brief command from your instructions first; it prints the token together with the facts this assessment must build on",
    ]);
  });

  it("refuses an assessment for another round", () => {
    refused(check({ round_ref: "acme/demo#7:internal-2" }), /round_ref/);
  });

  it("needs exactly one entry per finding of the round", () => {
    for (const ids of [IDS.slice(0, -1), [...IDS, ONE], [ONE, TWO, "code-reviewer-99"]]) {
      refused(check({ findings: ids.map((id) => entry(id)) }), /exactly one entry per finding/);
    }
  });

  it("refuses a round verdict the round is not offered, naming the ones it is", () => {
    refused(check({}, { churned: true }), /round_verdict PATCH is not admissible for this round; admissible: REDESIGN, RESHAPE_SPEC, CONVERGED_PUSHBACK, ESCALATE/);
  });

  it("needs a CLASS_FIX to state its invariant, its sites and how they were listed", () => {
    const stated = { round_verdict: CLASS_FIX, invariant: "every reader validates", sites: ["a.py:1", "b.py:2"], enumeration_command: "rg -n 'read_cfg\\('" };
    assert.deepEqual(errorsOf(check(stated)), []);
    const lacking = [{ invariant: undefined }, { invariant: " " }, { enumeration_command: undefined }, { enumeration_command: " " }, { sites: undefined }, { sites: ["a.py:1"] }];
    for (const gap of lacking) refused(check({ ...stated, ...gap }), /CLASS_FIX needs invariant, enumeration_command and at least two sites/);
  });

  it("needs a REDESIGN to name the structure that replaces the current one and its diagnosis (ADR-0018 d1)", () => {
    const lacking = [{}, { invariant: "one parser owns the grammar" }, { diagnosis: "review_polish" }, { invariant: " ", diagnosis: "review_polish" }];
    for (const gap of lacking) refused(check({ round_verdict: REDESIGN, ...gap }), /REDESIGN needs invariant, the structure that replaces the current one, and diagnosis/);
    for (const diagnosis of REDESIGN_DIAGNOSES) {
      assert.deepEqual(errorsOf(check({ round_verdict: REDESIGN, invariant: "one parser owns the grammar", diagnosis })), [], diagnosis);
    }
    refused(check({ round_verdict: REDESIGN, invariant: "one parser owns the grammar", diagnosis: "tired" }), /^diagnosis: /);
  });

  it("refuses a diagnosis from every verdict but REDESIGN", () => {
    for (const verdict of ASSESSOR_VERDICTS.filter((each) => each !== REDESIGN)) {
      refused(check({ round_verdict: verdict, diagnosis: "review_polish" }), new RegExp(`^${verdict} rewrites nothing, so it gives no diagnosis$`));
    }
  });

  it("refuses a PATCH over findings labelled as one class or as caused by a fix", () => {
    for (const kind of ["class_sibling", "fix_induced"]) {
      refused(check({ findings: [entry(ONE, FIX, kind), entry(TWO), entry(THREE)] }), new RegExp(`PATCH contradicts ${ONE} being labelled class_sibling/fix_induced`));
    }
  });

  it("refuses a CONVERGED_PUSHBACK while a finding is ruled FIX", () => {
    refused(check({ round_verdict: CONVERGED_PUSHBACK }), /CONVERGED_PUSHBACK means nothing is to be fixed/);
    const pushed = IDS.map((id) => entry(id, PUSH_BACK, "bikeshed"));
    assert.deepEqual(errorsOf(check({ round_verdict: CONVERGED_PUSHBACK, findings: pushed })), []);
  });

  it("refuses a fixing verdict with nothing ruled FIX", () => {
    const pushed = IDS.map((id) => entry(id, PUSH_BACK, "bikeshed"));
    for (const verdict of [PATCH, CLASS_FIX, REDESIGN]) refused(check({ round_verdict: verdict, findings: pushed }), new RegExp(`${verdict} needs at least one finding with verdict FIX`));
  });

  it("refuses a FIX on a finding of a kind not worth fixing", () => {
    for (const kind of ["bikeshed", "gold_plating", "not_real"]) {
      refused(check({ findings: [entry(ONE, FIX, kind), entry(TWO), entry(THREE)] }), new RegExp(`${ONE}: kind ${kind} cannot carry verdict FIX`));
    }
  });

  it("needs a RESHAPE_SPEC to rest on a spec_gap finding", () => {
    refused(check({ round_verdict: RESHAPE_SPEC, user_decision: "q?" }), /RESHAPE_SPEC needs at least one finding of kind spec_gap/);
    const findings = [entry(ONE, FIX, "spec_gap"), entry(TWO), entry(THREE)];
    assert.deepEqual(errorsOf(check({ round_verdict: RESHAPE_SPEC, findings, user_decision: "q?" })), []);
  });

  it("needs a verdict that locks the branch to state the question the user answers", () => {
    const findings = [entry(ONE, FIX, "spec_gap"), entry(TWO), entry(THREE)];
    for (const verdict of [RESHAPE_SPEC, ESCALATE]) {
      for (const user_decision of [null, " "]) {
        refused(check({ round_verdict: verdict, findings, user_decision }), new RegExp(`${verdict} locks the branch until the user answers: give user_decision`));
      }
    }
  });

  it("refuses a question from a verdict that does not lock the branch", () => {
    refused(check({ user_decision: "should we?" }), /PATCH does not lock the branch, so it asks the user nothing: drop user_decision/);
  });

  it("takes a finding ruled ESCALATE, the ruling for one the assessor cannot rule (ADR-0017 d2)", () => {
    const findings = [entry(ONE, ESCALATE_RULING, "defect", { reason: "whether FR-3 covers the empty name" }), entry(TWO), entry(THREE)];
    assert.deepEqual(errorsOf(check({ round_verdict: ESCALATE, findings, user_decision: "Which reading of FR-3 holds?" })), []);
  });

  it("needs every finding to name its mechanism (ADR-0017 d3)", () => {
    IDS.forEach((id, index) => {
      const { mechanism: _, ...unnamed } = entry(id);
      for (const lacking of [unnamed, entry(id, FIX, "defect", { mechanism: "" }), entry(id, FIX, "defect", { mechanism: " " })]) {
        const findings = IDS.map((each) => (each === id ? lacking : entry(each)));
        refused(check({ findings }), new RegExp(`^findings\\.${index}\\.mechanism: `));
      }
    });
  });

  it("refuses a next_step, which the ruling now gives (ADR-0017 d3), and any other field the schema does not name", () => {
    for (const field of ["next_step", "notes"]) {
      refused(check({ [field]: "fix it" }), new RegExp(`^Unrecognized key: "${field}"$`));
      refused(check({ findings: [entry(ONE, FIX, "defect", { [field]: "fix it" }), entry(TWO), entry(THREE)] }), new RegExp(`^findings\\.0: Unrecognized key: "${field}"$`));
    }
  });

  it("needs a DEFER to name the issue the finding moves to, and only a DEFER to name one (ADR-0017 d3)", () => {
    const deferred = (issue: Record<string, unknown>) => check({ findings: [entry(ONE), entry(TWO), entry(THREE, DEFER, "defect", issue)] });
    refused(deferred({}), new RegExp(`${THREE}: a DEFER names the issue the finding moves to`));
    for (const issue of ["#12", "acme/other-repo#3"]) assert.deepEqual(errorsOf(deferred({ issue })), [], issue);
    for (const issue of ["12", "#0", "#12 later", "acme#3"]) refused(deferred({ issue }), /issue/);
    for (const ruling of [FIX, PUSH_BACK, ESCALATE_RULING]) {
      refused(check({ findings: [entry(ONE), entry(TWO, ruling, "defect", { issue: "#12" }), entry(THREE)] }), new RegExp(`^${TWO}: only a DEFER names an issue$`));
    }
  });

  it("takes one defect raised by two reviewers as a duplicate of the first, still a PATCH", () => {
    const findings = [entry(ONE), entry(TWO), entry(THREE, FIX, "duplicate", { duplicate_of: ONE })];
    assert.deepEqual(errorsOf(check({ findings })), []);
  });

  it("needs a duplicate to name another finding of the round that is not itself a duplicate", () => {
    for (const target of [undefined, THREE, "code-reviewer-99"]) {
      const duplicate = entry(THREE, FIX, "duplicate", target === undefined ? {} : { duplicate_of: target });
      refused(check({ findings: [entry(ONE), entry(TWO), duplicate] }), new RegExp(`${THREE}: duplicate_of must name another finding of this round`));
    }
    const chained = [entry(ONE), entry(TWO, FIX, "duplicate", { duplicate_of: ONE }), entry(THREE, FIX, "duplicate", { duplicate_of: TWO })];
    refused(check({ findings: chained }), new RegExp(`${THREE}: duplicate_of must name another finding`));
  });

  it("needs a duplicate to carry the ruling of the finding it repeats", () => {
    const findings = [entry(ONE), entry(TWO), entry(THREE, PUSH_BACK, "duplicate", { duplicate_of: ONE })];
    refused(check({ findings }), new RegExp(`${THREE}: a duplicate carries the verdict of ${ONE} \\(FIX\\)`));
  });

  it("refuses duplicate_of on a finding that is not a duplicate", () => {
    refused(check({ findings: [entry(ONE), entry(TWO), entry(THREE, FIX, "defect", { duplicate_of: ONE })] }), new RegExp(`${THREE}: only a finding of kind duplicate names duplicate_of`));
  });

  it("needs a PATCH under the burden of proof to defend itself", () => {
    refused(check({}, { burden: true }), /the computed facts put the burden of proof on PATCH; give patch_defense/);
    refused(check({ patch_defense: " " }, { burden: true }), /patch_defense/);
    assert.deepEqual(errorsOf(check({ patch_defense: "three unrelated modules, no shared code path" }, { burden: true })), []);
  });
});

describe("readReport", () => {
  const finding = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: "t", file: "b.py", line: 1, severity: "HIGH", detail: "d", ...extra });
  const report = (...findings: Record<string, unknown>[]) => ({ round_ref: REF, findings });

  it("takes unique ids carrying the reviewer's prefix", () => {
    const read = readReport(report(finding("code-reviewer-1"), finding("code-reviewer-2")), REF, "code-reviewer");
    assert.ok(read.ok);
    assert.deepEqual(read.report.findings.map(({ id }) => id), ["code-reviewer-1", "code-reviewer-2"]);
  });

  it("refuses an id given twice", () => {
    assert.deepEqual(readReport(report(finding("code-reviewer-1"), finding("code-reviewer-1")), REF, "code-reviewer"), { ok: false, errors: ["finding ids must be unique"] });
  });

  it("refuses an id of another reviewer, the prefix read as written and not as a pattern", () => {
    assert.equal(readReport(report(finding("other-1")), REF, "code-reviewer").ok, false);
    assert.equal(readReport(report(finding("axb-1")), REF, "a.b").ok, false);
    assert.equal(readReport(report(finding("a.b-1")), REF, "a.b").ok, true);
  });

  it("takes a finding that names no line, as a whole-branch judgement does", () => {
    const { line: _, ...whole } = finding("history-shape-1");
    assert.equal(readReport(report(whole), REF, "history-shape").ok, true);
  });

  it("refuses a report for another round", () => {
    assert.equal(readReport(report(), REF, "code-reviewer").ok, true);
    const read = readReport({ ...report(), round_ref: "acme/demo#7:internal-2" }, REF, "code-reviewer");
    assert.ok(!read.ok && read.errors.length === 1 && read.errors[0].startsWith("round_ref: "), JSON.stringify(read));
  });
});

describe("the schemas the agents answer in", () => {
  type Schema = { properties: Record<string, Schema>; items: Schema; enum: string[]; pattern: string; additionalProperties: boolean };
  const asSchema = (schema: unknown): Schema => schema as Schema;

  it("pin the round, so an answer cannot land on another round", () => {
    assert.deepEqual(asSchema(findingsSchema(REF, "code-reviewer")).properties.round_ref.enum, [REF]);
    const schema = asSchema(assessmentSchema(REF, [CLASS_FIX, ESCALATE]));
    assert.deepEqual(schema.properties.round_ref.enum, [REF]);
    assert.deepEqual(schema.properties.round_verdict.enum, [CLASS_FIX, ESCALATE]);
  });

  it("give a reviewer's finding ids its prefix", () => {
    assert.equal(asSchema(findingsSchema(REF, "code-reviewer")).properties.findings.items.properties.id.pattern, "^code-reviewer-[0-9]+$");
  });

  it("offer each finding the rulings, the duplicate kind and duplicate_of, and a DEFER's issue", () => {
    const item = asSchema(assessmentSchema(REF, [...ASSESSOR_VERDICTS])).properties.findings.items;
    assert.deepEqual(item.properties.verdict.enum, [FIX, PUSH_BACK, DEFER, ESCALATE_RULING]);
    assert.ok(item.properties.kind.enum.includes("duplicate"));
    for (const field of ["duplicate_of", "issue", "mechanism"]) assert.ok(field in item.properties, field);
  });

  it("offer the question, a REDESIGN's diagnoses, and no next_step or other field", () => {
    const schema = asSchema(assessmentSchema(REF, [...ASSESSOR_VERDICTS]));
    assert.ok("user_decision" in schema.properties);
    assert.deepEqual(schema.properties.diagnosis.enum, [...REDESIGN_DIAGNOSES]);
    assert.ok(!("next_step" in schema.properties));
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.findings.items.additionalProperties, false);
  });
});
