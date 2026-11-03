import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { ADR_INSTALL, ADR_VERSION } from "../plugin/core/adr.ts";
import { couldNotRun } from "../plugin/core/outcomes.ts";
import { CheckOutcome } from "../plugin/core/values.ts";
import { ADR_STOPS, adrStop, changedSince, decideCheck, decideFolder } from "../plugin/lib/adr-check.ts";
import { git, scratchCheckout, writeFiles } from "./support/checkout.ts";

// Spec 177, US3: the stop table and the pure decisions first, then `adr_check.ts ask plan` and `decide plan` driven
// in a scratch checkout. A `quickstart Planner:` comment quotes the row of quickstart.md's Planner table its case
// tests. Not here: the rows of the tasks check (US4) and of review questions (US6).

const SCRIPT = fileURLToPath(new URL("../plugin/scripts/adr_check.ts", import.meta.url));
const PATH = process.env.PATH ?? "";
const { PASS, FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;
const EXIT: Readonly<Record<string, number>> = { [PASS]: 0, [FAIL]: 1, [COULD_NOT_RUN]: 2 };

type Asked = Parameters<typeof decideCheck>[0];
type AskedFolder = Parameters<typeof decideFolder>[0];
type Verdict = NonNullable<Parameters<typeof decideCheck>[1]>;
type Ruling = Parameters<typeof decideCheck>[2][number];
type StopItem = Parameters<typeof adrStop>[0][number];
type StopKind = keyof typeof ADR_STOPS;

const INSIDE = "docs/adr";
const OUTSIDE = "../org/docs/adr";
const MISSING = "../missing/docs/adr";
const X = "core/src/x.ts";
const Y = "lib/y.ts";
const SPEC = "specs/7-demo";
const RUN = ".specify/workflows/runs/r1";

const R0004 = { recordId: "0004", title: "Read the ADR folders from settings, never from discovery" };
const R0005 = { recordId: "0005", title: "Keep the stop table in planner" };
const R0001 = { recordId: "0001", title: "Org records live in the org repository" };
const BROKEN = {
  file: "docs/adr/0009-new.md",
  rule: "frontmatter-fence",
  message: "ADR files must start with a leading --- YAML frontmatter fence",
};
// No trailing period: the line puts its own after `what`.
const WHY = "it reads the folders from tracked discovery";

const PASS_EMPTY = "PASS: codeworks.toml: No ADR folder is listed in [shared] adr_folders.";
const governedLine = (entry: string, ...records: { recordId: string; title: string }[]): string =>
  `PASS: ${entry}: governing: ${records.map(({ recordId, title }) => `${recordId} ${title}`).join(", ")}.`;
const ungovernedLine = (entry: string): string => `PASS: ${entry}: no record governs these paths.`;
const RULE_ON = (entry: string, id: string, path: string): string =>
  `resume with adr_ruling naming ${entry}, ${id}, ${path} and your reason`;
const departsInsideLine = (id: string, path: string, why = WHY): string =>
  `FAIL: ${INSIDE}: ${id} on ${path}: ${why}. Next step: change plan.md; draft a superseding record into the spec PR ` +
  `(planner ADR-0009 d3); or ${RULE_ON(INSIDE, id, path)}.`;
const departsOutsideLine = (id: string, path: string, why = WHY): string =>
  `FAIL: ${OUTSIDE}: ${id} on ${path}: ${why}. Next step: change plan.md; change record ${id} in the repo that holds ` +
  `${OUTSIDE}; or ${RULE_ON(OUTSIDE, id, path)}.`;
const BROKEN_LINE =
  `FAIL: ${INSIDE}: ${BROKEN.file}: ${BROKEN.rule}: ${BROKEN.message}. Next step: fix that record (in the spec PR, or ` +
  `in the repo that holds ${INSIDE}).`;
const mismatchLine = (what: string): string => `COULD_NOT_RUN: ${INSIDE}: ${what}. Next step: resume to run the judge again.`;
const JUDGE_LINE = "COULD_NOT_RUN: adr-plan-judge: the judge did not answer. Next step: resume to run the judge again.";
const TOUCHES_LINE = "COULD_NOT_RUN: adr-plan-touches: the touches step did not answer. Next step: resume to run it again.";

const PLAN_PATHS = [
  { path: X, line: 1, story: null },
  { path: Y, line: 2, story: null },
];

function answered(
  entry: string,
  inside: boolean,
  governing: { recordId: string; title: string }[],
  broken: (typeof BROKEN)[] = [],
): AskedFolder {
  return { entry, path: `/work/${entry.replaceAll("../", "")}`, inside, governing, broken } as AskedFolder;
}

const NOT_RUN_REASON =
  "not a readable folder, so adr was not called. Next step: make /work/missing/docs/adr a readable folder, or remove " +
  "the entry from [shared] adr_folders.";
const NOT_RUN = couldNotRun(MISSING, NOT_RUN_REASON);
const notRun = (): AskedFolder => ({ entry: MISSING, path: "/work/missing/docs/adr", inside: false, outcome: NOT_RUN }) as AskedFolder;

function askedRecord(folders: AskedFolder[], paths = PLAN_PATHS): Asked {
  return { v: 1, artifact: "plan", paths, folders } as Asked;
}

type Judged = { folder: string; record: string; judgment: "WITHIN" | "DEPARTS"; paths: string[]; why: string };
const within = (folder: string, record: string): Judged => ({ folder, record, judgment: "WITHIN", paths: [], why: "it keeps to the record" });
const departs = (folder: string, record: string, paths: string[], why = WHY): Judged => ({ folder, record, judgment: "DEPARTS", paths, why });

function verdict(...verdicts: Judged[]): Verdict {
  return { v: 1, artifact: "plan", verdicts } as Verdict;
}

function ruling(folder: string, record: string, path: string, reason = "the user keeps discovery for this one path"): Ruling {
  return { folder, record, path, reason };
}

describe("ADR_STOPS", () => {
  // workflow-steps.md's stop table: each kind's outcome, a CheckOutcome value.
  const OUTCOMES: Record<string, string> = {
    empty: PASS,
    governed: PASS,
    ungoverned: PASS,
    "departure-inside": FAIL,
    "departure-outside": FAIL,
    broken: FAIL,
    folder: COULD_NOT_RUN,
    "verdict-unread": COULD_NOT_RUN,
    "verdict-mismatch": COULD_NOT_RUN,
    judge: COULD_NOT_RUN,
    touches: COULD_NOT_RUN,
    "touches-refused": FAIL,
    "touches-missing": COULD_NOT_RUN,
    "questions-refused": FAIL,
    "tasks-refused": FAIL,
    "tasks-empty": COULD_NOT_RUN,
    "rulings-refused": FAIL,
    "ruling-refused": FAIL,
    "guard-rulings": COULD_NOT_RUN,
    "guard-paths": COULD_NOT_RUN,
    "guard-asked": COULD_NOT_RUN,
    settings: COULD_NOT_RUN,
    git: COULD_NOT_RUN,
  };

  it("has one row per stop kind of the table, each with the table's outcome", () => {
    assert.deepEqual(Object.fromEntries(Object.entries(ADR_STOPS).map(([kind, row]) => [kind, row.outcome])), OUTCOMES);
  });

  it("gives every row a CheckOutcome value", () => {
    for (const row of Object.values(ADR_STOPS)) assert.ok(CheckOutcome.schema.options.includes(row.outcome), row.outcome);
  });
});

describe("adrStop", () => {
  // Every row but a folder outcome's (governed, ungoverned, departure-*, broken, folder, verdict-mismatch), which the
  // decideCheck cases below render.
  // An item gives only its row's placeholder values: the label, what and next step are the table's.
  const ROWS: [StopKind, Record<string, string>, string][] = [
    ["empty", {}, PASS_EMPTY],
    [
      "verdict-unread",
      { file: "adr-plan-verdict.json", what: "missing" },
      "COULD_NOT_RUN: adr-plan-verdict.json: missing. Next step: resume to run the judge again.",
    ],
    ["judge", { a: "plan" }, JUDGE_LINE],
    ["touches", {}, TOUCHES_LINE],
    [
      "touches-missing",
      { what: "missing" },
      "COULD_NOT_RUN: touches.json: missing. Next step: resume to run the touches step again.",
    ],
    [
      "touches-refused",
      { what: `${X}: entry twice`, run: RUN },
      `FAIL: touches.json: ${X}: entry twice. Next step: correct ${RUN}/touches.json, then resume.`,
    ],
    [
      "questions-refused",
      { what: "questions.0.hold: expected a string" },
      "FAIL: review-questions.json: questions.0.hold: expected a string. Next step: rerun the rescope from " +
        "/planner:issue-spec rescope.",
    ],
    [
      "tasks-refused",
      { line: "12", what: "a/{b,c}.ts: a brace group names files the check cannot list" },
      "FAIL: tasks.md:12: a/{b,c}.ts: a brace group names files the check cannot list. Next step: change tasks.md, then " +
        "resume.",
    ],
    [
      "tasks-empty",
      {},
      "COULD_NOT_RUN: tasks.md: no task line names a path. Next step: name each task's files, one per backtick span, " +
        "then resume.",
    ],
    [
      "rulings-refused",
      { what: "rulings.0.reason: expected a non-empty string", "spec folder": SPEC },
      `FAIL: adr-rulings.json: rulings.0.reason: expected a non-empty string. Next step: correct ${SPEC}/adr-rulings.json, ` +
        "then resume.",
    ],
    [
      "ruling-refused",
      { what: "not JSON" },
      "FAIL: adr_ruling: not JSON. Next step: resume with a corrected adr_ruling, or without one.",
    ],
    [
      "guard-rulings",
      { folder: INSIDE, id: "0004", path: X },
      `COULD_NOT_RUN: adr-rulings.json: entry ${INSIDE} 0004 ${X} was not written by the check. Next step: remove the ` +
        "entry; only a resume with adr_ruling adds one.",
    ],
    [
      "guard-paths",
      { file: "touches.json", changes: `added ${Y}, removed ${X}` },
      `COULD_NOT_RUN: touches.json: changed after ask: added ${Y}, removed ${X}. Next step: resume to run the check again.`,
    ],
    [
      "guard-asked",
      { file: "adr-plan-asked.json" },
      "COULD_NOT_RUN: adr-plan-asked.json: changed after ask. Next step: resume to run the check again.",
    ],
    [
      "settings",
      { what: "codeworks.toml [shared]: adr_folders: expected array" },
      "COULD_NOT_RUN: codeworks.toml: codeworks.toml [shared]: adr_folders: expected array. Next step: fix codeworks.toml " +
        "at HEAD, then resume.",
    ],
    [
      "git",
      { what: "git rev-parse --show-toplevel exited 128: fatal: not a git repository" },
      "COULD_NOT_RUN: git: git rev-parse --show-toplevel exited 128: fatal: not a git repository. Next step: run from a " +
        "git checkout of the repo, then resume.",
    ],
  ];

  for (const [kind, fill, line] of ROWS) {
    it(`renders a ${kind} stop as the table's line, exiting as its outcome`, () => {
      const exit = EXIT[ADR_STOPS[kind].outcome];
      assert.deepEqual(adrStop([{ kind, fill } as StopItem]), { lines: [line], exit });
    });
  }

  it("throws on an item that lacks a value its row names, naming the kind and the placeholder", () => {
    assert.throws(() => adrStop([{ kind: "judge", fill: {} } as StopItem]), /judge.*<a>/);
  });

  const item = (kind: StopKind, fill: Record<string, string> = {}): StopItem => ({ kind, fill }) as StopItem;

  it("exits 1 when a line is FAIL and none COULD_NOT_RUN", () => {
    assert.equal(adrStop([item("empty"), item("ruling-refused", { what: "y" })]).exit, 1);
  });

  it("exits 2 when any line is COULD_NOT_RUN, whatever else fails", () => {
    assert.equal(adrStop([item("ruling-refused", { what: "y" }), item("empty"), item("git", { what: "y" })]).exit, 2);
  });

  it("prints one line per item, in order", () => {
    const lines = adrStop([item("git", { what: "y" }), item("ruling-refused", { what: "y" })]).lines;
    assert.deepEqual(lines.map((line) => line.split(":")[0]), [COULD_NOT_RUN, FAIL]);
  });
});

describe("decideFolder", () => {
  const outcome = (fields: Record<string, unknown>) => ({
    governing: [],
    departures: [],
    broken: [],
    couldNotRun: null,
    ...fields,
  });

  it("gives a folder core could not check its CouldNotRun, judging nothing", () => {
    assert.deepEqual(
      decideFolder(notRun(), PLAN_PATHS, verdict(), []),
      outcome({ entry: MISSING, inside: false, outcome: COULD_NOT_RUN, couldNotRun: NOT_RUN }),
    );
  });

  it("passes a folder whose governing records the verdict finds all WITHIN", () => {
    assert.deepEqual(
      decideFolder(answered(INSIDE, true, [R0004, R0005]), PLAN_PATHS, verdict(within(INSIDE, "0004"), within(INSIDE, "0005")), []),
      outcome({ entry: INSIDE, inside: true, outcome: PASS, governing: [R0004, R0005] }),
    );
  });

  it("passes a folder no record governs, with no verdict", () => {
    assert.deepEqual(
      decideFolder(answered(OUTSIDE, false, []), PLAN_PATHS, null, []),
      outcome({ entry: OUTSIDE, inside: false, outcome: PASS }),
    );
  });

  it("fails a folder on each DEPARTS path no ruling names, the plan's paths with no story", () => {
    assert.deepEqual(
      decideFolder(answered(INSIDE, true, [R0004]), PLAN_PATHS, verdict(departs(INSIDE, "0004", [X, Y])), []),
      outcome({
        entry: INSIDE,
        inside: true,
        outcome: FAIL,
        governing: [R0004],
        departures: [
          { record: "0004", path: X, stories: [], why: WHY },
          { record: "0004", path: Y, stories: [], why: WHY },
        ],
      }),
    );
  });

  it("drops each departure a ruling names by folder, record and path, and fails on the rest", () => {
    const decided = decideFolder(answered(INSIDE, true, [R0004]), PLAN_PATHS, verdict(departs(INSIDE, "0004", [X, Y])), [
      ruling(INSIDE, "0004", X),
    ]);
    assert.equal(decided.outcome, FAIL);
    assert.deepEqual(decided.departures, [{ record: "0004", path: Y, stories: [], why: WHY }]);
  });

  it("passes a folder whose every departure is ruled on", () => {
    const decided = decideFolder(answered(INSIDE, true, [R0004]), PLAN_PATHS, verdict(departs(INSIDE, "0004", [X])), [
      ruling(INSIDE, "0004", X),
    ]);
    assert.deepEqual(decided, outcome({ entry: INSIDE, inside: true, outcome: PASS, governing: [R0004] }));
  });

  for (const [what, other] of [
    ["another folder", ruling(OUTSIDE, "0004", X)],
    ["another record", ruling(INSIDE, "0005", X)],
    ["another path", ruling(INSIDE, "0004", Y)],
  ] as const) {
    it(`does not drop a departure for a ruling on ${what}`, () => {
      const decided = decideFolder(answered(INSIDE, true, [R0004]), PLAN_PATHS, verdict(departs(INSIDE, "0004", [X])), [other]);
      assert.equal(decided.outcome, FAIL);
      assert.deepEqual(decided.departures, [{ record: "0004", path: X, stories: [], why: WHY }]);
    });
  }

  it("reads only the verdicts of its own folder", () => {
    const decided = decideFolder(
      answered(INSIDE, true, [R0004]),
      PLAN_PATHS,
      verdict(within(INSIDE, "0004"), departs(OUTSIDE, "0001", [X])),
      [],
    );
    assert.equal(decided.outcome, PASS);
  });

  it("fails a folder adr names a broken record in, keeping its governing records", () => {
    assert.deepEqual(
      decideFolder(answered(INSIDE, true, [R0004], [BROKEN]), PLAN_PATHS, verdict(within(INSIDE, "0004")), []),
      outcome({ entry: INSIDE, inside: true, outcome: FAIL, governing: [R0004], broken: [BROKEN] }),
    );
  });

  for (const [what, judged] of [
    ["misses a governing record", verdict(within(INSIDE, "0004"))],
    ["names a record that does not govern", verdict(within(INSIDE, "0004"), within(INSIDE, "0005"), within(INSIDE, "0009"))],
    ["names a path not asked", verdict(within(INSIDE, "0004"), departs(INSIDE, "0005", ["lib/z.ts"]))],
  ] as const) {
    it(`could not run on a verdict that ${what}`, () => {
      assert.equal(decideFolder(answered(INSIDE, true, [R0004, R0005]), PLAN_PATHS, judged, []).outcome, COULD_NOT_RUN);
    });
  }
});

describe("decideCheck, as adrStop prints it", () => {
  it("prints a folder whose records all keep as PASS naming each, titles in full (governed)", () => {
    assert.deepEqual(
      adrStop(decideCheck(askedRecord([answered(INSIDE, true, [R0004, R0005])]), verdict(within(INSIDE, "0004"), within(INSIDE, "0005")), [])),
      { lines: [governedLine(INSIDE, R0004, R0005)], exit: 0 },
    );
  });

  it("prints a folder no record governs as PASS saying so (ungoverned)", () => {
    assert.deepEqual(adrStop(decideCheck(askedRecord([answered(INSIDE, true, [])]), null, [])), {
      lines: [ungovernedLine(INSIDE)],
      exit: 0,
    });
  });

  it("prints one FAIL per departure from a folder inside, with the inside next step (departure-inside)", () => {
    assert.deepEqual(adrStop(decideCheck(askedRecord([answered(INSIDE, true, [R0004])]), verdict(departs(INSIDE, "0004", [X, Y])), [])), {
      lines: [departsInsideLine("0004", X), departsInsideLine("0004", Y)],
      exit: 1,
    });
  });

  it("prints a departure from a folder outside with the outside next step (departure-outside)", () => {
    assert.deepEqual(adrStop(decideCheck(askedRecord([answered(OUTSIDE, false, [R0001])]), verdict(departs(OUTSIDE, "0001", [X])), [])), {
      lines: [departsOutsideLine("0001", X)],
      exit: 1,
    });
  });

  it("prints one FAIL per broken record, naming its file, rule and message (broken)", () => {
    assert.deepEqual(adrStop(decideCheck(askedRecord([answered(INSIDE, true, [], [BROKEN])]), null, [])), {
      lines: [BROKEN_LINE],
      exit: 1,
    });
  });

  it("prints core's CouldNotRun after COULD_NOT_RUN as it is, so the label appears once (folder)", () => {
    assert.deepEqual(adrStop(decideCheck(askedRecord([notRun()]), null, [])), {
      lines: [`COULD_NOT_RUN: ${NOT_RUN.reason}`],
      exit: 2,
    });
  });

  for (const [what, judged, line] of [
    ["misses a governing record", verdict(within(INSIDE, "0004")), mismatchLine("the verdict misses governing 0005")],
    [
      "names a record that does not govern",
      verdict(within(INSIDE, "0004"), within(INSIDE, "0005"), within(INSIDE, "0009")),
      mismatchLine("the verdict names 0009 not governing"),
    ],
    [
      "names a path not asked",
      verdict(within(INSIDE, "0004"), departs(INSIDE, "0005", ["lib/z.ts"])),
      mismatchLine("the verdict names lib/z.ts not asked"),
    ],
  ] as const) {
    it(`prints a verdict that ${what} as the folder's COULD_NOT_RUN (verdict-mismatch)`, () => {
      assert.deepEqual(adrStop(decideCheck(askedRecord([answered(INSIDE, true, [R0004, R0005])]), judged, [])), { lines: [line], exit: 2 });
    });
  }

  it("prints no line for a departure a ruling names", () => {
    assert.deepEqual(
      adrStop(decideCheck(askedRecord([answered(INSIDE, true, [R0004])]), verdict(departs(INSIDE, "0004", [X])), [ruling(INSIDE, "0004", X)])),
      { lines: [governedLine(INSIDE, R0004)], exit: 0 },
    );
  });

  it("prints a COULD_NOT_RUN for a folder the verdict names that was not asked, after the asked folders", () => {
    const ELSE = "../else/docs/adr";
    assert.deepEqual(
      adrStop(decideCheck(askedRecord([answered(INSIDE, true, [R0004])]), verdict(within(INSIDE, "0004"), within(ELSE, "0001")), [])),
      {
        lines: [governedLine(INSIDE, R0004), `COULD_NOT_RUN: ${ELSE}: the verdict names 0001 not governing. Next step: resume to run the judge again.`],
        exit: 2,
      },
    );
  });

  // quickstart Planner: "one entry missing, `adr` absent, or verdict missing a record" (AS3)
  it("prints every folder in list order when one could not run, each label once, exiting 2", () => {
    const { lines, exit } = adrStop(
      decideCheck(
        askedRecord([answered(INSIDE, true, [R0004]), notRun(), answered(OUTSIDE, false, [R0001])]),
        verdict(within(INSIDE, "0004"), departs(OUTSIDE, "0001", [X])),
        [],
      ),
    );
    assert.deepEqual(lines, [governedLine(INSIDE, R0004), `COULD_NOT_RUN: ${NOT_RUN.reason}`, departsOutsideLine("0001", X)]);
    assert.equal(exit, 2);
    assert.equal(lines[1].split(`${MISSING}: `).length, 2, lines[1]);
  });
});

describe("changedSince", () => {
  const at = (path: string, line: number) => ({ path, line, story: null });

  it("names nothing when the values are the same, in any order", () => {
    assert.deepEqual(changedSince([at(X, 1), at(Y, 2)], [at(Y, 2), at(X, 1)]), { added: [], removed: [] });
  });

  it("names each value added and each removed", () => {
    assert.deepEqual(changedSince([at(X, 1), at(Y, 2)], [at(X, 1), at("lib/z.ts", 2)]), {
      added: [at("lib/z.ts", 2)],
      removed: [at(Y, 2)],
    });
  });

  it("compares whole values: a path whose line moved is removed and added", () => {
    assert.deepEqual(changedSince([at(X, 1)], [at(X, 2)]), { added: [at(X, 2)], removed: [at(X, 1)] });
  });

  it("compares whole values: a ruling whose reason changed is removed and added", () => {
    const before = ruling(INSIDE, "0004", X, "the user's words");
    const after = ruling(INSIDE, "0004", X, "words someone else wrote");
    assert.deepEqual(changedSince([before], [after]), { added: [after], removed: [before] });
  });

  it("compares text", () => {
    assert.deepEqual(changedSince(["a1"], ["b2"]), { added: ["b2"], removed: ["a1"] });
  });
});

// --- adr_check.ts, driven ------------------------------------------------------------------------------------------

type AdrRecord = { recordId: string; title: string; paths: string[] };
type FolderAnswer = { records: AdrRecord[]; broken?: (typeof BROKEN)[] };

type World = {
  checkout: string;
  run: string;
  spec: string;
  outside: string;
  bin: string;
  noAdr: string;
  calls: string;
  answers: string;
};

/** An `adr` that is not adrkit: it logs each call, answers `--version` with ADR_VERSION, and answers `check` from the
 *  answers file by `--dir`, governing with each record one of whose paths it is given. */
function standInAdr(bin: string, answers: string, calls: string): void {
  writeFileSync(
    join(bin, "adr"),
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ cwd: process.cwd(), args }) + "\\n");
if (args[0] === "--version") {
  console.log(${JSON.stringify(ADR_VERSION)});
  process.exit(0);
}
const dir = args[args.indexOf("--dir") + 1];
const paths = args.slice(args.indexOf("--") + 1);
const folder = JSON.parse(fs.readFileSync(${JSON.stringify(answers)}, "utf8"))[dir] ?? { records: [] };
const governing = folder.records
  .filter((record) => record.paths.some((path) => paths.includes(path)))
  .map(({ recordId, title }) => ({ recordId, title }));
const findings = (folder.broken ?? []).map(({ file, rule, message }) => ({ rule, severity: "error", message, path: file }));
console.log(JSON.stringify({ ok: findings.length === 0, governing, findings }));
process.exit(findings.length === 0 ? 0 : 1);
`,
    { mode: 0o755 },
  );
}

/**
 * A scratch checkout listing `folders` in `[shared] adr_folders` at HEAD, `docs/adr` in it and `../org/docs/adr`
 * beside it, with a stand-in `adr` first on PATH answering: 0004 governs core/src/x.ts and 0005 lib/y.ts in docs/adr,
 * 0001 core/src/x.ts in ../org/docs/adr. The touches step's place is taken by a touches.json naming core/src/x.ts.
 */
function world(t: TestContext, folders: readonly string[] = [INSIDE, OUTSIDE]): World {
  const { root, checkout } = scratchCheckout(t);
  const settings = join(checkout, "codeworks.toml");
  const seeded = readFileSync(settings, "utf8");
  const listed = seeded.replace("adr_folders = []", `adr_folders = ${JSON.stringify(folders)}`);
  assert.ok(folders.length === 0 || listed !== seeded, "the scratch checkout's settings no longer read adr_folders = []");
  writeFileSync(settings, listed);
  git(checkout, "commit", "-q", "--allow-empty", "-am", "list the ADR folders");
  for (const dir of [join(checkout, INSIDE), join(root, "org", "docs", "adr"), join(checkout, SPEC), join(checkout, RUN)]) {
    mkdirSync(dir, { recursive: true });
  }
  const bin = join(root, "bin");
  const noAdr = join(root, "no-adr");
  mkdirSync(bin);
  mkdirSync(noAdr);
  // The case that takes adr off PATH must leave git on it: the script reads settings at HEAD through git.
  const gitBinary = PATH.split(delimiter).map((dir) => join(dir, "git")).find((path) => existsSync(path));
  if (gitBinary === undefined) throw new Error("git is not on PATH");
  symlinkSync(gitBinary, join(noAdr, "git"));
  const w: World = {
    checkout: realpathSync(checkout),
    run: join(checkout, RUN),
    spec: join(checkout, SPEC),
    // adr gets an outside folder's realpath as its --dir.
    outside: realpathSync(join(root, "org", "docs", "adr")),
    bin,
    noAdr,
    calls: join(root, "adr-calls.log"),
    answers: join(root, "adr-answers.json"),
  };
  standInAdr(bin, w.answers, w.calls);
  answer(w, {
    [INSIDE]: { records: [{ ...R0004, paths: [X] }, { ...R0005, paths: [Y] }] },
    [OUTSIDE]: { records: [{ ...R0001, paths: [X] }] },
  });
  touches(w, { v: 1, paths: [X] });
  return w;
}

/** `answers` keyed by entry; the outside entry stands for its realpath, the `--dir` adr is given for it. */
function answer(w: World, answers: Record<string, FolderAnswer>): void {
  const byDir = Object.fromEntries(Object.entries(answers).map(([entry, folder]) => [entry === OUTSIDE ? w.outside : entry, folder]));
  writeFileSync(w.answers, JSON.stringify(byDir));
}

function touches(w: World, json: unknown): void {
  writeFileSync(join(w.run, "touches.json"), typeof json === "string" ? json : JSON.stringify(json));
}

function writeVerdict(w: World, ...verdicts: Judged[]): void {
  writeFileSync(join(w.run, "adr-plan-verdict.json"), JSON.stringify({ v: 1, artifact: "plan", verdicts }));
}

function commitRulings(w: World, rulings: Ruling[]): void {
  writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings }) });
  git(w.checkout, "add", `${SPEC}/adr-rulings.json`);
  git(w.checkout, "commit", "-q", "-m", "rulings");
}

type Ran = { exit: number | null; lines: string[]; stdout: string };

function adrCheck(w: World, args: string[], env: Record<string, string> = {}, path = `${w.bin}${delimiter}${PATH}`): Ran {
  const inherited = { ...process.env };
  delete inherited.ADR_RULING;
  const done = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: w.checkout,
    encoding: "utf8",
    env: { ...inherited, PATH: path, ...env },
  });
  assert.equal(done.error, undefined, String(done.error));
  return { exit: done.status, lines: done.stderr.split("\n").filter((line) => line !== ""), stdout: done.stdout };
}

type Asking = Ran & { judge: boolean; asked: string };

/** ask's stdout is its JSON alone, `asked` the sha256 of the asked record's bytes. */
function ask(w: World, path?: string): Asking {
  const ran = adrCheck(w, ["ask", "plan", SPEC, RUN], {}, path);
  assert.equal(ran.exit, 0, ran.lines.join("\n"));
  const printed = JSON.parse(ran.stdout) as { judge: boolean; asked: string };
  assert.deepEqual(Object.keys(printed).sort(), ["asked", "judge"], ran.stdout);
  assert.equal(typeof printed.judge, "boolean");
  const bytes = readFileSync(join(w.run, "adr-plan-asked.json"));
  assert.equal(printed.asked, createHash("sha256").update(bytes).digest("hex"));
  return { ...ran, ...printed };
}

function decide(w: World, asked: string, env: Record<string, string> = {}, path?: string): Ran {
  return adrCheck(w, ["decide", "plan", SPEC, RUN, asked], env, path);
}

function adrCalls(w: World): { cwd: string; args: string[] }[] {
  if (!existsSync(w.calls)) return [];
  return readFileSync(w.calls, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { cwd: string; args: string[] });
}

function checkCalls(w: World): string[][] {
  return adrCalls(w)
    .filter((call) => call.args[0] === "check")
    .map((call) => call.args);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const rulingsFile = (w: World) => join(w.spec, "adr-rulings.json");
const writtenFile = (w: World) => join(w.run, "adr-rulings-written.json");

describe("adr_check.ts ask plan, then decide plan", () => {
  // quickstart Planner: "ask" — stdout is `{"judge", "asked"}` only
  it("ask writes the asked record from touches.json and each folder's answer, printing only judge and its digest", (t) => {
    const w = world(t);
    const asking = ask(w);
    assert.equal(asking.judge, true);
    assert.deepEqual(readJson(join(w.run, "adr-plan-asked.json")), {
      v: 1,
      artifact: "plan",
      paths: [{ path: X, line: 1, story: null }],
      folders: [
        { entry: INSIDE, path: join(w.checkout, INSIDE), inside: true, governing: [R0004], broken: [] },
        { entry: OUTSIDE, path: w.outside, inside: false, governing: [R0001], broken: [] },
      ],
    });
    // The folders are checked at once, so the stand-in logs their calls in no fixed order.
    assert.deepEqual(
      checkCalls(w).sort(),
      [
        ["check", "--dir", INSIDE, "--json", "--", X],
        ["check", "--dir", w.outside, "--json", "--", X],
      ].sort(),
    );
    assert.ok(adrCalls(w).every((call) => call.cwd === w.checkout), JSON.stringify(adrCalls(w)));
  });

  // quickstart Planner: "verdict all `WITHIN`" (US3 AS1)
  it("passes when the verdict finds every governing record WITHIN, a PASS line per folder", (t) => {
    const w = world(t);
    const { asked } = ask(w);
    writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
    rmSync(w.calls, { force: true });
    assert.deepEqual(decide(w, asked), {
      exit: 0,
      lines: [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)],
      stdout: "",
    });
    assert.deepEqual(checkCalls(w), []);
  });

  // quickstart Planner: "no record governs"
  it("passes with no judge when no record governs the paths", (t) => {
    const w = world(t);
    answer(w, {});
    const { judge, asked } = ask(w);
    assert.equal(judge, false);
    assert.deepEqual(decide(w, asked), { exit: 0, lines: [ungovernedLine(INSIDE), ungovernedLine(OUTSIDE)], stdout: "" });
  });

  // quickstart Planner: "one `DEPARTS` on `core/src/x.ts` from `0004` (folder inside)" (AS2)
  it("fails on a departure from a record inside, naming record, path and why, with the inside next step", (t) => {
    const w = world(t);
    const { asked } = ask(w);
    writeVerdict(w, departs(INSIDE, "0004", [X]), within(OUTSIDE, "0001"));
    assert.deepEqual(decide(w, asked), {
      exit: 1,
      lines: [departsInsideLine("0004", X), governedLine(OUTSIDE, R0001)],
      stdout: "",
    });
  });

  // quickstart Planner: "one `DEPARTS` from a record in `../org/docs/adr` (outside)" (AS2)
  it("fails on a departure from a record outside, the next step naming the repo that holds the folder", (t) => {
    const w = world(t);
    const { asked } = ask(w);
    writeVerdict(w, within(INSIDE, "0004"), departs(OUTSIDE, "0001", [X]));
    assert.deepEqual(decide(w, asked), {
      exit: 1,
      lines: [governedLine(INSIDE, R0004), departsOutsideLine("0001", X)],
      stdout: "",
    });
  });

  // quickstart Planner: "`adr` answers a record with its own error" (AS8)
  it("fails on a record adr finds broken, naming its file, rule and message", (t) => {
    const w = world(t);
    answer(w, {
      [INSIDE]: { records: [{ ...R0004, paths: [X] }], broken: [BROKEN] },
      [OUTSIDE]: { records: [{ ...R0001, paths: [X] }] },
    });
    const { asked } = ask(w);
    writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
    assert.deepEqual(decide(w, asked), { exit: 1, lines: [BROKEN_LINE, governedLine(OUTSIDE, R0001)], stdout: "" });
  });

  describe("one folder could not run (AS3)", () => {
    // quickstart Planner: "one entry missing, `adr` absent, or verdict missing a record" — one entry missing
    it("prints a missing folder's COULD_NOT_RUN once, among the other folders' lines, exiting 2", (t) => {
      const w = world(t, [INSIDE, MISSING, OUTSIDE]);
      const { asked } = ask(w);
      writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
      const { exit, lines } = decide(w, asked);
      assert.equal(exit, 2, lines.join("\n"));
      assert.equal(lines.length, 3, lines.join("\n"));
      assert.equal(lines[0], governedLine(INSIDE, R0004));
      assert.ok(lines[1].startsWith(`COULD_NOT_RUN: ${MISSING}: not a readable folder, so adr was not called. Next step: `), lines[1]);
      assert.equal(lines[1].split(`${MISSING}: `).length, 2, lines[1]);
      assert.equal(lines[2], governedLine(OUTSIDE, R0001));
    });

    // quickstart Planner: "one entry missing, `adr` absent, or verdict missing a record" — `adr` absent
    it("prints each folder's COULD_NOT_RUN naming the install when adr is not on PATH", (t) => {
      const w = world(t);
      const { judge, asked } = ask(w, w.noAdr);
      assert.equal(judge, false);
      const absent = (entry: string) =>
        `COULD_NOT_RUN: ${entry}: the adr command was not found (adrkit needs node 22 or later). Next step: ${ADR_INSTALL}.`;
      assert.deepEqual(decide(w, asked, {}, w.noAdr), { exit: 2, lines: [absent(INSIDE), absent(OUTSIDE)], stdout: "" });
    });

    // quickstart Planner: "one entry missing, `adr` absent, or verdict missing a record" — verdict missing a record
    it("could not run in a folder whose verdict misses a governing record, still printing the other folder", (t) => {
      const w = world(t);
      touches(w, { v: 1, paths: [X, Y] });
      const { asked } = ask(w);
      writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
      assert.deepEqual(decide(w, asked), {
        exit: 2,
        lines: [mismatchLine("the verdict misses governing 0005"), governedLine(OUTSIDE, R0001)],
        stdout: "",
      });
    });
  });

  // quickstart Planner: "verdict file missing or not an `AdrVerdict`"
  describe("a verdict decide cannot read", () => {
    const unread = (lines: string[]) =>
      lines.some((line) => line.startsWith("COULD_NOT_RUN: adr-plan-verdict.json: ") && line.endsWith(". Next step: resume to run the judge again."));

    for (const [what, text] of [
      ["missing", null],
      ["not JSON", "{ verdicts"],
      ["not an AdrVerdict", JSON.stringify({ v: 1, artifact: "plan", verdicts: [{ ...within(INSIDE, "0004"), judgment: "PASS" }] })],
    ] as const) {
      it(`could not run on a verdict ${what}`, (t) => {
        const w = world(t);
        const { asked } = ask(w);
        if (text !== null) writeFileSync(join(w.run, "adr-plan-verdict.json"), text);
        const { exit, lines } = decide(w, asked);
        assert.equal(exit, 2, lines.join("\n"));
        assert.ok(unread(lines), lines.join("\n"));
      });
    }

    it("never reads a verdict left from an earlier ask: ask removes it first", (t) => {
      const w = world(t);
      writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
      const { asked } = ask(w);
      assert.equal(existsSync(join(w.run, "adr-plan-verdict.json")), false);
      const { exit, lines } = decide(w, asked);
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(unread(lines), lines.join("\n"));
    });
  });

  describe("ADR_RULING", () => {
    const RULED = ruling(INSIDE, "0004", X, "the user keeps discovery for x.ts");

    // quickstart Planner: "`ADR_RULING` names the departure" (AS5)
    it("rules the departure it names: decide passes and both rulings files gain it", (t) => {
      const w = world(t);
      const { asked } = ask(w);
      writeVerdict(w, departs(INSIDE, "0004", [X]), within(OUTSIDE, "0001"));
      rmSync(w.calls, { force: true });
      assert.deepEqual(decide(w, asked, { ADR_RULING: JSON.stringify([RULED]) }), {
        exit: 0,
        lines: [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)],
        stdout: "",
      });
      assert.deepEqual(readJson(rulingsFile(w)), { v: 1, rulings: [RULED] });
      assert.deepEqual(readJson(writtenFile(w)), { v: 1, rulings: [RULED] });
      // One `adr check` per new ruling, given that ruling's path alone.
      assert.deepEqual(checkCalls(w), [["check", "--dir", INSIDE, "--json", "--", X]]);
    });

    it("leaves a departure it does not name to stop the check", (t) => {
      const w = world(t);
      touches(w, { v: 1, paths: [X, Y] });
      answer(w, { [INSIDE]: { records: [{ ...R0004, paths: [X, Y] }] }, [OUTSIDE]: { records: [{ ...R0001, paths: [X] }] } });
      const { asked } = ask(w);
      writeVerdict(w, departs(INSIDE, "0004", [X, Y]), within(OUTSIDE, "0001"));
      assert.deepEqual(decide(w, asked, { ADR_RULING: JSON.stringify([RULED]) }), {
        exit: 1,
        lines: [departsInsideLine("0004", Y), governedLine(OUTSIDE, R0001)],
        stdout: "",
      });
    });

    // quickstart Planner: "`ADR_RULING` valid, the verdict names no such departure"
    it("appends a valid ruling also when the verdict names no such departure", (t) => {
      const w = world(t);
      const { asked } = ask(w);
      writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
      assert.equal(decide(w, asked, { ADR_RULING: JSON.stringify([RULED]) }).exit, 0);
      assert.deepEqual(readJson(rulingsFile(w)), { v: 1, rulings: [RULED] });
      assert.deepEqual(readJson(writtenFile(w)), { v: 1, rulings: [RULED] });
    });

    // quickstart Planner: "`ADR_RULING` not JSON, or with an unlisted folder, an unasked path, or a record not governing
    // its path, beside a valid one"
    for (const [what, value] of [
      ["not JSON", "[{folder: docs/adr}"],
      ["not a list of rulings", JSON.stringify(RULED)],
      ["a ruling with no reason, beside a valid one", JSON.stringify([RULED, { folder: INSIDE, record: "0004", path: X }])],
      ["an unlisted folder, beside a valid one", JSON.stringify([RULED, ruling("../else/docs/adr", "0004", X)])],
      ["an unasked path, beside a valid one", JSON.stringify([RULED, ruling(INSIDE, "0005", Y)])],
      ["a record not governing its path, beside a valid one", JSON.stringify([RULED, ruling(INSIDE, "0005", X)])],
    ] as const) {
      it(`refuses the whole ruling for ${what}, appending nothing`, (t) => {
        const w = world(t);
        const { asked } = ask(w);
        writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
        const { exit, lines } = decide(w, asked, { ADR_RULING: value });
        assert.equal(exit, 1, lines.join("\n"));
        assert.ok(
          lines.some((line) => line.startsWith("FAIL: adr_ruling: ") && line.endsWith(". Next step: resume with a corrected adr_ruling, or without one.")),
          lines.join("\n"),
        );
        assert.equal(existsSync(rulingsFile(w)), false);
        assert.equal(existsSync(writtenFile(w)), false);
      });
    }

    // quickstart Planner: "`ADR_RULING` already in `adr-rulings.json`"
    it("leaves the rulings file as it was for a ruling it already holds, checking it no more", (t) => {
      const w = world(t);
      commitRulings(w, [RULED]);
      const before = readFileSync(rulingsFile(w));
      const { asked } = ask(w);
      writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
      rmSync(w.calls, { force: true });
      assert.equal(decide(w, asked, { ADR_RULING: JSON.stringify([RULED]) }).exit, 0);
      assert.deepEqual(readFileSync(rulingsFile(w)), before);
      assert.deepEqual(checkCalls(w), []);
    });
  });

  describe("the rulings file (AS6, AS7)", () => {
    const RULED = ruling(INSIDE, "0004", X, "the user keeps discovery for x.ts");

    // quickstart Planner: "`adr-rulings.json` holds the key; rerun or `tasks` check departs from it" (AS6) — the rerun
    it("passes a rerun that departs where a committed ruling names", (t) => {
      const w = world(t);
      commitRulings(w, [RULED]);
      const { asked } = ask(w);
      writeVerdict(w, departs(INSIDE, "0004", [X]), within(OUTSIDE, "0001"));
      assert.deepEqual(decide(w, asked), {
        exit: 0,
        lines: [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)],
        stdout: "",
      });
    });

    it("passes a rerun of the run that wrote the ruling, before the ruling is committed", (t) => {
      const w = world(t);
      const first = ask(w);
      writeVerdict(w, departs(INSIDE, "0004", [X]), within(OUTSIDE, "0001"));
      assert.equal(decide(w, first.asked, { ADR_RULING: JSON.stringify([RULED]) }).exit, 0);
      const rerun = ask(w);
      writeVerdict(w, departs(INSIDE, "0004", [X]), within(OUTSIDE, "0001"));
      assert.equal(decide(w, rerun.asked).exit, 0);
    });

    // quickstart Planner: "an entry, or an entry's `reason`, neither at `HEAD` nor in the run record" (AS7)
    const GUARD_LINE =
      `COULD_NOT_RUN: adr-rulings.json: entry ${INSIDE} 0004 ${X} was not written by the check. Next step: remove the ` +
      "entry; only a resume with adr_ruling adds one.";

    it("ask could not run on an entry written by hand, naming it", (t) => {
      const w = world(t);
      writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [RULED] }) });
      const ran = adrCheck(w, ["ask", "plan", SPEC, RUN]);
      assert.equal(ran.exit, 2, ran.lines.join("\n"));
      assert.ok(ran.lines.includes(GUARD_LINE), ran.lines.join("\n"));
    });

    it("ask could not run on an entry whose reason was changed by hand", (t) => {
      const w = world(t);
      commitRulings(w, [RULED]);
      writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [{ ...RULED, reason: "not the user's words" }] }) });
      const ran = adrCheck(w, ["ask", "plan", SPEC, RUN]);
      assert.equal(ran.exit, 2, ran.lines.join("\n"));
      assert.ok(ran.lines.includes(GUARD_LINE), ran.lines.join("\n"));
    });

    it("decide could not run on an entry written by hand after ask, naming it", (t) => {
      const w = world(t);
      const { asked } = ask(w);
      writeVerdict(w, departs(INSIDE, "0004", [X]), within(OUTSIDE, "0001"));
      writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [RULED] }) });
      const { exit, lines } = decide(w, asked);
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(lines.includes(GUARD_LINE), lines.join("\n"));
    });

    // quickstart Planner: "an entry removed by hand"
    it("does not stop on an entry removed by hand", (t) => {
      const w = world(t);
      commitRulings(w, [RULED, ruling(OUTSIDE, "0001", X)]);
      writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [RULED] }) });
      const { asked } = ask(w);
      writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
      assert.deepEqual(decide(w, asked), {
        exit: 0,
        lines: [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)],
        stdout: "",
      });
    });
  });

  // quickstart Planner: "asked record or `touches.json` changed between ask and decide"
  describe("what ask recorded, changed before decide", () => {
    it("could not run when touches.json gained a path after ask, naming it", (t) => {
      const w = world(t);
      const { asked } = ask(w);
      writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
      touches(w, { v: 1, paths: [X, Y] });
      const { exit, lines } = decide(w, asked);
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(
        lines.some(
          (line) =>
            line.startsWith("COULD_NOT_RUN: touches.json: changed after ask: ") &&
            line.includes(`added ${Y}`) &&
            line.endsWith(". Next step: resume to run the check again."),
        ),
        lines.join("\n"),
      );
    });

    it("could not run when touches.json lost a path after ask, naming it", (t) => {
      const w = world(t);
      touches(w, { v: 1, paths: [X, Y] });
      const { asked } = ask(w);
      writeVerdict(w, within(INSIDE, "0004"), within(INSIDE, "0005"), within(OUTSIDE, "0001"));
      touches(w, { v: 1, paths: [X] });
      const { exit, lines } = decide(w, asked);
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(
        lines.some((line) => line.startsWith("COULD_NOT_RUN: touches.json: changed after ask: ") && line.includes(`removed ${Y}`)),
        lines.join("\n"),
      );
    });

    for (const [what, change] of [
      ["removed", (w: World) => rmSync(join(w.run, "touches.json"))],
      ["emptied", (w: World) => touches(w, { v: 1, paths: [] })],
    ] as const) {
      it(`could not run when touches.json was ${what} after ask, naming the path it lost`, (t) => {
        const w = world(t);
        const { asked } = ask(w);
        writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
        change(w);
        assert.deepEqual(decide(w, asked), {
          exit: 2,
          lines: [`COULD_NOT_RUN: touches.json: changed after ask: removed ${X}. Next step: resume to run the check again.`],
          stdout: "",
        });
      });
    }

    it("could not run when the asked record's bytes are not those ask printed the digest of", (t) => {
      const w = world(t);
      const { asked } = ask(w);
      writeVerdict(w, within(INSIDE, "0004"), within(OUTSIDE, "0001"));
      const record = join(w.run, "adr-plan-asked.json");
      writeFileSync(record, `${readFileSync(record, "utf8")}\n`);
      const { exit, lines } = decide(w, asked);
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(
        lines.includes("COULD_NOT_RUN: adr-plan-asked.json: changed after ask. Next step: resume to run the check again."),
        lines.join("\n"),
      );
    });
  });

  // quickstart Planner: "`touches.json` missing or `paths` empty (plan or tasks), or `tasks.md` names no path" — plan
  for (const [what, text] of [
    ["missing", null],
    ["with no path", JSON.stringify({ v: 1, paths: [] })],
  ] as const) {
    it(`ask could not run on a touches.json ${what}, naming it, and asks adr nothing`, (t) => {
      const w = world(t);
      if (text === null) rmSync(join(w.run, "touches.json"));
      else touches(w, text);
      const ran = adrCheck(w, ["ask", "plan", SPEC, RUN]);
      assert.equal(ran.exit, 2, ran.lines.join("\n"));
      assert.ok(
        ran.lines.some((line) => line.startsWith("COULD_NOT_RUN: touches.json: ") && line.endsWith(". Next step: resume to run the touches step again.")),
        ran.lines.join("\n"),
      );
      assert.deepEqual(checkCalls(w), []);
    });
  }

  // quickstart Planner: "`touches.json` unparsable, an extra key, an entry not a `PATH`, or an entry twice"
  for (const [what, text] of [
    ["unparsable", '{"v": 1, "paths": ['],
    ["with an extra key", JSON.stringify({ v: 1, paths: [X], extra: [] })],
    ["with an entry not a PATH", JSON.stringify({ v: 1, paths: ["core/src/*.ts"] })],
    ["with an entry twice", JSON.stringify({ v: 1, paths: [X, X] })],
  ] as const) {
    it(`ask refuses a touches.json ${what}, naming it`, (t) => {
      const w = world(t);
      touches(w, text);
      const ran = adrCheck(w, ["ask", "plan", SPEC, RUN]);
      assert.equal(ran.exit, 1, ran.lines.join("\n"));
      assert.ok(
        ran.lines.some((line) => line.startsWith("FAIL: touches.json: ") && line.endsWith(`. Next step: correct ${RUN}/touches.json, then resume.`)),
        ran.lines.join("\n"),
      );
      assert.deepEqual(checkCalls(w), []);
    });
  }

  it("ask refuses a rulings file that does not parse, naming the spec folder's file to correct", (t) => {
    const w = world(t);
    writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: '{"v": 1, "rulings": [' });
    const ran = adrCheck(w, ["ask", "plan", SPEC, RUN]);
    assert.equal(ran.exit, 1, ran.lines.join("\n"));
    assert.equal(ran.lines.length, 1, ran.lines.join("\n"));
    assert.ok(ran.lines[0].startsWith("FAIL: adr-rulings.json: not JSON: "), ran.lines[0]);
    assert.ok(ran.lines[0].endsWith(`. Next step: correct ${SPEC}/adr-rulings.json, then resume.`), ran.lines[0]);
    assert.deepEqual(checkCalls(w), []);
  });

  // quickstart Planner: "`adr_folders = []`, with or without `touches.json`"
  for (const [what, text] of [
    ["no touches.json", null],
    ["a touches.json it would refuse", "not json"],
  ] as const) {
    it(`passes an empty adr_folders with ${what}, reading no path and asking adr nothing`, (t) => {
      const w = world(t, []);
      if (text === null) rmSync(join(w.run, "touches.json"));
      else touches(w, text);
      const asking = ask(w);
      assert.equal(asking.judge, false);
      assert.deepEqual(readJson(join(w.run, "adr-plan-asked.json")), { v: 1, artifact: "plan", paths: [], folders: [] });
      assert.deepEqual(decide(w, asking.asked), { exit: 0, lines: [PASS_EMPTY], stdout: "" });
      assert.deepEqual(adrCalls(w), []);
    });
  }
});

// quickstart Planner: "`stop plan judge` / `stop plan touches`"
describe("adr_check.ts stop", () => {
  // Outside any checkout: stop reads no settings.
  function stop(t: TestContext, ...args: string[]): Ran {
    const away = mkdtempSync(join(tmpdir(), "planner-adr-stop-"));
    t.after(() => rmSync(away, { recursive: true, force: true }));
    const done = spawnSync(process.execPath, [SCRIPT, "stop", ...args], { cwd: away, encoding: "utf8" });
    return { exit: done.status, lines: done.stderr.split("\n").filter((line) => line !== ""), stdout: done.stdout };
  }

  it("prints the judge stop for a plan judge that did not answer, exiting 2", (t) => {
    assert.deepEqual(stop(t, "plan", "judge"), { exit: 2, lines: [JUDGE_LINE], stdout: "" });
  });

  it("prints the touches stop for a touches step that did not answer, exiting 2", (t) => {
    assert.deepEqual(stop(t, "plan", "touches"), { exit: 2, lines: [TOUCHES_LINE], stdout: "" });
  });

  // 64, an exit no stop uses: drive_workflow.py's check that stop exited 2 catches a call routed wrong.
  for (const args of [["tasks", "judge"], ["tasks", "touches"], ["plan", "ask"], ["plan"]]) {
    it(`prints the usage for stop ${args.join(" ")}, exiting 64`, (t) => {
      const { exit, lines } = stop(t, ...args);
      assert.equal(exit, 64, lines.join("\n"));
      assert.equal(lines.length, 1, lines.join("\n"));
      assert.ok(lines[0].startsWith("Usage: adr_check.ts "), lines[0]);
      assert.ok(lines[0].endsWith("stop plan judge | stop plan touches"), lines[0]);
    });
  }
});
