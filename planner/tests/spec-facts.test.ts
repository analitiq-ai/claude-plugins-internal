import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { readSpecFacts, type SpecFacts } from "../plugin/core/contracts/spec-facts.ts";
import { SpecFactsRefused, specFactsOf } from "../plugin/scripts/spec_facts.ts";

const SPEC_FACTS = fileURLToPath(new URL("../plugin/scripts/spec_facts.ts", import.meta.url));
const NO_SPEC = fileURLToPath(new URL("../plugin/scripts/no_spec.py", import.meta.url));
const ROOTCAUSE = fileURLToPath(new URL("../plugin/scripts/rootcause.py", import.meta.url));
const SPEC_TEMPLATE = fileURLToPath(
  new URL("../plugin/speckit/presets/settled-design/templates/spec-template.md", import.meta.url),
);

// The words of data-model.md "Spec facts", spelled out so a change to core's vocabulary fails here.
const NOT_A_DEFECT = "Not a defect report.";
const HYPOTHESIS = "Observed: nothing; this trace is a hypothesis from reading the code.";
const ANCHORED = "Observed: test_gate fails on main with a KeyError.";

type Row = { row: string; wrong: string | null; opening: string | null; facts: SpecFacts };

const ROWS: readonly Row[] = [
  {
    row: "a no-spec spec.md",
    wrong: null,
    opening: null,
    facts: { v: 1, kind: "no_spec", root_cause: { observed: "none" } },
  },
  {
    row: "a report that says no and a root cause that is not a defect report",
    wrong: "no",
    opening: NOT_A_DEFECT,
    facts: { v: 1, kind: "feature", root_cause: { observed: "none" } },
  },
  {
    row: "a report that says yes and a root cause opening with the hypothesis sentence",
    wrong: "yes",
    opening: `${HYPOTHESIS} The ledger was read, not run.`,
    facts: { v: 1, kind: "defect", root_cause: { observed: "hypothesis" } },
  },
  {
    row: "a report that says yes and any other filled Observed: opening",
    wrong: "yes",
    opening: ANCHORED,
    facts: { v: 1, kind: "defect", root_cause: { observed: "anchored" } },
  },
];

function refusedNaming(...said: string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof SpecFactsRefused, String(error));
    for (const phrase of [...said, "Next step:"]) assert.ok(error.message.includes(phrase), error.message);
    return true;
  };
}

function specMd(opening: string): string {
  return `# Feature Specification: dummy\n\n## Root cause\n\n${opening}\n\nThe ledger drops the verdict.\n\n## Requirements\n\n- x\n`;
}

type Folder = { folder: string; spec: string; report: string };

function specFolder(t: TestContext): Folder {
  const root = mkdtempSync(join(tmpdir(), "planner-spec-facts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, "specs", "7-demo");
  mkdirSync(folder, { recursive: true });
  return { folder, spec: join(folder, "spec.md"), report: join(root, "premise-report.md") };
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [SPEC_FACTS, ...args], { encoding: "utf8" });
}

function writeNoSpec({ folder, report }: Folder): void {
  writeFileSync(report, "Rests on: needs-spec\nReason: a typo, fixed by the request\n");
  const written = spawnSync("python3", [NO_SPEC, "write", folder, report], { encoding: "utf8" });
  assert.equal(written.status, 0, written.stderr);
}

describe("specFactsOf", () => {
  for (const { row, wrong, opening, facts } of ROWS) {
    it(`reads ${facts.kind} with observed ${facts.root_cause.observed} from ${row}`, () => {
      assert.deepEqual(specFactsOf(wrong, opening), facts);
    });
  }

  it("refuses a Reports wrong behaviour value that is missing or neither yes nor no", () => {
    for (const wrong of ["", "maybe", "Yes"]) {
      assert.throws(() => specFactsOf(wrong, ANCHORED), refusedNaming("Reports wrong behaviour", `\`${wrong}\``));
    }
  });

  it("refuses a defect whose root cause does not open with a filled Observed: line", () => {
    const unfilled = ["Observed:", "Observed:   ", "Observed: [the failing test, log line or reproduction]"];
    for (const opening of [null, "", NOT_A_DEFECT, "The ledger drops the verdict.", ...unfilled]) {
      assert.throws(() => specFactsOf("yes", opening), refusedNaming("## Root cause", "Observed:"));
    }
  });

  it("reads a feature's filled Observed: opening as it reads a defect's", () => {
    assert.deepEqual(specFactsOf("no", ANCHORED), { v: 1, kind: "feature", root_cause: { observed: "anchored" } });
    assert.deepEqual(specFactsOf("no", HYPOTHESIS), { v: 1, kind: "feature", root_cause: { observed: "hypothesis" } });
  });

  it("refuses a feature whose root cause has no opening the vocabulary knows", () => {
    for (const opening of [null, "The ledger drops the verdict."]) {
      assert.throws(() => specFactsOf("no", opening), refusedNaming("## Root cause", NOT_A_DEFECT));
    }
  });
});

describe("spec_facts.ts write", () => {
  for (const { row, wrong, opening, facts } of ROWS) {
    it(`writes spec.md facts core reads as ${facts.kind}/${facts.root_cause.observed} for ${row}`, (t) => {
      const where = specFolder(t);
      let done;
      if (wrong === null) {
        writeNoSpec(where);
        done = run("write", where.folder);
      } else {
        writeFileSync(where.spec, specMd(opening ?? ""));
        writeFileSync(where.report, `Reports wrong behaviour: ${wrong}\n`);
        done = run("write", where.folder, where.report);
      }
      assert.equal(done.status, 0, done.stderr);
      assert.deepEqual(readSpecFacts(readFileSync(where.spec, "utf8")), facts);
    });
  }

  it("writes the facts of a feature spec rootcause.py passes with a filled Observed: opening", (t) => {
    const where = specFolder(t);
    writeFileSync(where.spec, specMd(ANCHORED));
    writeFileSync(where.report, "Reports wrong behaviour: no\n");
    const graded = spawnSync("python3", [ROOTCAUSE, "check", where.folder, where.report], { encoding: "utf8" });
    assert.equal(graded.status, 0, graded.stderr);
    const done = run("write", where.folder, where.report);
    assert.equal(done.status, 0, done.stderr);
    assert.deepEqual(readSpecFacts(readFileSync(where.spec, "utf8")), {
      v: 1,
      kind: "feature",
      root_cause: { observed: "anchored" },
    });
  });

  it("rewrites the block when the root cause goes from hypothesis to anchored, leaving one", (t) => {
    const where = specFolder(t);
    writeFileSync(where.report, "Reports wrong behaviour: yes\n");
    writeFileSync(where.spec, specMd(HYPOTHESIS));
    assert.equal(run("write", where.folder, where.report).status, 0);
    const graded = readFileSync(where.spec, "utf8").replace(HYPOTHESIS, ANCHORED);
    writeFileSync(where.spec, graded);
    const done = run("write", where.folder, where.report);
    assert.equal(done.status, 0, done.stderr);
    const text = readFileSync(where.spec, "utf8");
    assert.equal(text.match(/^codeworks:/gm)?.length, 1, text);
    assert.deepEqual(readSpecFacts(text).root_cause, { observed: "anchored" });
  });

  it("writes a no-spec spec.md's facts again, leaving one block, and keeps it a no-spec spec.md", (t) => {
    const where = specFolder(t);
    writeNoSpec(where);
    assert.equal(run("write", where.folder).status, 0);
    const done = run("write", where.folder);
    assert.equal(done.status, 0, done.stderr);
    const text = readFileSync(where.spec, "utf8");
    assert.equal(text.match(/^codeworks:/gm)?.length, 1, text);
    assert.match(text, /^---\n[\s\S]*?\n---\n# No spec needed\n/);
  });

  it("refuses the spec template's own block until the writer sets it, then leaves the one block", (t) => {
    const template = readFileSync(SPEC_TEMPLATE, "utf8");
    assert.throws(
      () => readSpecFacts(template),
      (error: unknown) => error instanceof Error && /Invalid option/.test(error.message),
    );
    const where = specFolder(t);
    writeFileSync(where.spec, template.replace(/^Observed: \[.*\]$/m, ANCHORED));
    writeFileSync(where.report, "Reports wrong behaviour: yes\n");
    const done = run("write", where.folder, where.report);
    assert.equal(done.status, 0, done.stderr);
    const text = readFileSync(where.spec, "utf8");
    assert.equal(text.match(/^codeworks:/gm)?.length, 1, text);
    assert.deepEqual(readSpecFacts(text), { v: 1, kind: "defect", root_cause: { observed: "anchored" } });
  });

  for (const [what, setUp] of [
    ["a report whose Reports wrong behaviour is neither yes nor no", ({ spec, report }: Folder) => {
      writeFileSync(spec, specMd(ANCHORED));
      writeFileSync(report, "Reports wrong behaviour: maybe\n");
      return [report];
    }],
    ["a report with no Reports wrong behaviour line", ({ spec, report }: Folder) => {
      writeFileSync(spec, specMd(ANCHORED));
      writeFileSync(report, "Recommendation: write the spec\n");
      return [report];
    }],
    ["a report with two Reports wrong behaviour lines", ({ spec, report }: Folder) => {
      writeFileSync(spec, specMd(ANCHORED));
      writeFileSync(report, "Reports wrong behaviour: yes\nReports wrong behaviour: no\n");
      return [report];
    }],
    ["a defect whose root cause section is missing", ({ spec, report }: Folder) => {
      writeFileSync(spec, "# Feature Specification: dummy\n\n## Requirements\n\n- x\n");
      writeFileSync(report, "Reports wrong behaviour: yes\n");
      return [report];
    }],
    ["a spec.md whose front matter does not parse", ({ spec, report }: Folder) => {
      writeFileSync(spec, `---\ncodeworks: [\n---\n${specMd(ANCHORED)}`);
      writeFileSync(report, "Reports wrong behaviour: yes\n");
      return [report];
    }],
    ["no report for a spec.md that is not a no-spec one", ({ spec }: Folder) => {
      writeFileSync(spec, specMd(NOT_A_DEFECT));
      return [];
    }],
  ] as const) {
    it(`exits 1 on ${what}, naming the next step and leaving spec.md as it was`, (t) => {
      const where = specFolder(t);
      const report = setUp(where);
      const before = readFileSync(where.spec, "utf8");
      const done = run("write", where.folder, ...report);
      assert.equal(done.status, 1, done.stderr);
      assert.equal(done.stdout, "");
      assert.match(done.stderr, /^.+ Next step: .+\n$/);
      assert.equal(readFileSync(where.spec, "utf8"), before);
    });
  }

  it("exits 2 naming the file when spec.md or the report cannot be read", (t) => {
    const where = specFolder(t);
    let done = run("write", where.folder);
    assert.equal(done.status, 2, done.stderr);
    assert.ok(done.stderr.includes(where.spec), done.stderr);
    writeFileSync(where.spec, specMd(ANCHORED));
    done = run("write", where.folder, where.report);
    assert.equal(done.status, 2, done.stderr);
    assert.ok(done.stderr.includes(where.report), done.stderr);
  });

  it("exits 2 on arguments other than write, a folder and at most one report", (t) => {
    const where = specFolder(t);
    for (const args of [[], ["write"], ["read", where.folder], ["write", where.folder, where.report, where.report]]) {
      const done = run(...args);
      assert.equal(done.status, 2, `${args.join(" ")}: ${done.stderr}`);
      assert.match(done.stderr, /Usage: spec_facts\.ts write <spec folder> \[<premise report>\]/);
    }
  });
});
