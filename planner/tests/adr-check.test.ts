import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { ADR_INSTALL, ADR_VERSION } from "../plugin/core/adr.ts";
import { AdrVerdict, readTouchedPaths } from "../plugin/core/contracts/decision-check.ts";
import { couldNotRun } from "../plugin/core/outcomes.ts";
import { CheckOutcome } from "../plugin/core/values.ts";
import { ADR_STOPS, adrStop, changedSince, decideCheck, decideFolder } from "../plugin/lib/adr-check.ts";
import { git, scratchCheckout, storeToken, tempHome, writeFiles } from "./support/checkout.ts";

// Spec 177, US3 (with US4's tasks.md): the stop table and the pure decisions first, then each round step of the
// adr-check loop driven in a scratch checkout, the test writing what the touches step, the tasks command and the judge
// would. A `quickstart Planner:` comment quotes the row of quickstart.md's Planner table its case comes from. Not here:
// the rows of review questions (US6).

const SCRIPT = fileURLToPath(new URL("../plugin/scripts/adr_check.ts", import.meta.url));
const GITHUB_AT = fileURLToPath(new URL("./support/github-at.ts", import.meta.url));
const PATH = process.env.PATH ?? "";
const { PASS, FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;
const EXIT: Readonly<Record<string, number>> = { [PASS]: 0, [FAIL]: 1, [COULD_NOT_RUN]: 2 };

type Asked = Parameters<typeof decideCheck>[0];
type AskedFolder = Parameters<typeof decideFolder>[0];
type AskedPaths = Parameters<typeof decideFolder>[1];
type Verdict = NonNullable<Parameters<typeof decideCheck>[1]>;
type Ruling = Parameters<typeof decideCheck>[2][number];
type StopItem = Parameters<typeof adrStop>[0][number];
type StopKind = keyof typeof ADR_STOPS;

const INSIDE = "docs/adr";
const OUTSIDE = "../org/docs/adr";
const MISSING = "../missing/docs/adr";
const X = "core/src/x.ts";
const Y = "lib/y.ts";
const UNGOVERNED = "docs/guide.md";
const ISSUE = "7";
const SPEC = "specs/7-demo";
const RUN = ".specify/workflows/runs/r1";
const NEW = "new";
const RESCOPE = "rescope";

const R0004 = { recordId: "0004", title: "Read the ADR folders from settings, never from discovery" };
const R0005 = { recordId: "0005", title: "Keep the stop table in planner" };
const R0001 = { recordId: "0001", title: "Org records live in the org repository" };
const BROKEN = {
  file: "docs/adr/0009-new.md",
  rule: "frontmatter-fence",
  message: "ADR files must start with a leading --- YAML frontmatter fence",
};
const WHY = "it reads the folders from tracked discovery";

// --- the lines, as workflow-steps.md's stop table gives them ------------------------------------------------------

const PASS_EMPTY = "PASS: codeworks.toml: No ADR folder is listed in [shared] adr_folders.";
const governedLine = (entry: string, ...records: { recordId: string; title: string }[]): string =>
  `PASS: ${entry}: governing: ${records.map(({ recordId, title }) => `${recordId} ${title}`).join(", ")}.`;
const ungovernedLine = (entry: string): string => `PASS: ${entry}: no record governs these paths.`;
const CHANGE_PLAN = "change plan.md (the next round writes tasks.md again from it)";
const RULE_ON = (entry: string, id: string, path: string): string =>
  `resume with adr_ruling naming ${entry}, ${id}, ${path} and your reason`;
const storiesOf = (stories: readonly string[]): string => (stories.length === 0 ? "" : ` (story ${stories.join(", ")})`);
const departsInsideLine = (id: string, path: string, stories: readonly string[] = [], why = WHY): string =>
  `FAIL: ${INSIDE}: ${id} on ${path}${storiesOf(stories)}: ${why}. Next step: ${CHANGE_PLAN}; draft a superseding ` +
  `record into the spec PR (planner ADR-0009 d3); or ${RULE_ON(INSIDE, id, path)}.`;
const departsOutsideLine = (id: string, path: string, stories: readonly string[] = [], why = WHY): string =>
  `FAIL: ${OUTSIDE}: ${id} on ${path}${storiesOf(stories)}: ${why}. Next step: ${CHANGE_PLAN}; change record ${id} in ` +
  `the repo that holds ${OUTSIDE}; or ${RULE_ON(OUTSIDE, id, path)}.`;
const BROKEN_LINE =
  `FAIL: ${INSIDE}: ${BROKEN.file}: ${BROKEN.rule}: ${BROKEN.message}. Next step: fix that record (in the spec PR, or ` +
  `in the repo that holds ${INSIDE}).`;
const CHECK_AGAIN = ". Next step: resume to run the check again.";
const couldNotRunLine = (label: string, what: string): string => `COULD_NOT_RUN: ${label}: ${what}${CHECK_AGAIN}`;
const mismatchLine = (entry: string, what: string): string => couldNotRunLine(entry, `the verdict ${what}`);
const TASKS_REFUSED_NEXT =
  ". Next step: delete tasks.md, then resume: the next round writes it again from the plan; if the line comes back, " +
  "change spec.md or plan.md first.";
const TASKS_EMPTY_LINE =
  "COULD_NOT_RUN: tasks.md: no task line names a path. Next step: delete tasks.md, then resume: the next round writes " +
  "it again from the plan.";
const TOUCHES_STALE_LINE = couldNotRunLine("touches.json", "plan.md or spec.md changed after this round listed the plan's paths");
const STOP_UNREAD_LINE = couldNotRunLine("adr-stop.json", "does not parse");
const stepUnfinishedLine = (...ids: string[]): string =>
  `COULD_NOT_RUN: adr-check: step ${ids.join(", ")} did not finish this round (no done record). Next step: fix what ` +
  "the step's error names, then resume.";
const GUARD_LINE =
  `COULD_NOT_RUN: adr-rulings.json: entry ${INSIDE} 0004 ${X} was not written by the check. Next step: remove the ` +
  "entry; only a resume with adr_ruling adds one.";
const RULING_REFUSED_NEXT = ". Next step: resume with a corrected adr_ruling, or without one.";
const SETTINGS_NEXT = ". Next step: fix codeworks.toml at HEAD, then resume.";
const GIT_NEXT = ". Next step: run from a git checkout of the repo, then resume.";

/** tasks.md is derived (planner ADR-0009 d4): a next step may delete it, or say the next round writes it again; it
 *  never sends the admin to edit it. */
function assertNoTasksEdit(texts: readonly string[]): void {
  for (const text of texts) {
    const at = text.indexOf("Next step: ");
    const next = (at === -1 ? text : text.slice(at))
      .replaceAll("`", "")
      .replaceAll("delete tasks.md", "")
      .replaceAll("writes tasks.md again", "");
    assert.ok(!next.includes("tasks.md"), `a next step sends the admin to tasks.md: ${text}`);
  }
}

// --- the pure functions --------------------------------------------------------------------------------------------

type PathEntry = AskedPaths[number];
const planPath = (path: string, line: number): PathEntry => ({ path, artifact: "plan", line, story: null }) as PathEntry;
const taskPath = (path: string, line: number, story: string): PathEntry => ({ path, artifact: "tasks", line, story }) as PathEntry;
const PLAN_PATHS = [planPath(X, 1), planPath(Y, 2)];

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

function askedRecord(folders: AskedFolder[], paths: PathEntry[] = PLAN_PATHS): Asked {
  return { v: 1, paths, folders } as Asked;
}

type Judged = { folder: string; record: string; judgment: "WITHIN" | "DEPARTS"; paths: string[]; why: string };
const within = (folder: string, record: string): Judged => ({ folder, record, judgment: "WITHIN", paths: [], why: "it keeps to the record" });
const departs = (folder: string, record: string, paths: string[], why = WHY): Judged => ({ folder, record, judgment: "DEPARTS", paths, why });

function verdict(...verdicts: Judged[]): Verdict {
  return { v: 1, verdicts } as Verdict;
}

function ruling(folder: string, record: string, path: string, reason = "the user keeps discovery for this one path"): Ruling {
  return { folder, record, path, reason };
}

const item = (kind: StopKind, label: string, what: string): StopItem => ({ kind, label, what }) as StopItem;

describe("ADR_STOPS", () => {
  // workflow-steps.md's stop table, row for row.
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
    rounds: COULD_NOT_RUN,
    "stop-unread": COULD_NOT_RUN,
    "step-unfinished": COULD_NOT_RUN,
    "tasks-unfinished": COULD_NOT_RUN,
    "touches-refused": COULD_NOT_RUN,
    "touches-missing": COULD_NOT_RUN,
    "touches-stale": COULD_NOT_RUN,
    "questions-refused": FAIL,
    "tasks-refused": FAIL,
    "tasks-empty": COULD_NOT_RUN,
    "sub-issues-extra": FAIL,
    "sub-issues-foreign": FAIL,
    "sub-issues-misplaced": FAIL,
    github: COULD_NOT_RUN,
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

  // quickstart Planner: "any stop line" — no next step names an edit to `tasks.md`
  it("has no row whose next step sends the admin to edit tasks.md", () => {
    assertNoTasksEdit(Object.values(ADR_STOPS).flatMap((row) => (row.next === null ? [] : [String(row.next)])));
  });
});

describe("adrStop", () => {
  // Every row but those whose line needs a fill or core's CouldNotRun, rendered by the tests of the step that stops on
  // them: departure-*, broken and folder (decideCheck below), rounds (`stop rounds`), sub-issues-* (stories),
  // rulings-refused (ask).
  const ROWS: [StopKind, string, string, string][] = [
    ["empty", "codeworks.toml", "No ADR folder is listed in [shared] adr_folders", PASS_EMPTY],
    ["governed", INSIDE, `governing: 0004 ${R0004.title}, 0005 ${R0005.title}`, governedLine(INSIDE, R0004, R0005)],
    ["ungoverned", INSIDE, "no record governs these paths", ungovernedLine(INSIDE)],
    [
      "verdict-unread",
      "adr-verdict.json",
      "the judge did not answer (its exit code not 0)",
      couldNotRunLine("adr-verdict.json", "the judge did not answer (its exit code not 0)"),
    ],
    ["verdict-mismatch", INSIDE, "the verdict misses governing 0005", mismatchLine(INSIDE, "misses governing 0005")],
    ["stop-unread", "adr-stop.json", "does not parse", STOP_UNREAD_LINE],
    ["step-unfinished", "adr-check", "step adr-ask did not finish this round (no done record)", stepUnfinishedLine("adr-ask")],
    [
      "tasks-unfinished",
      "tasks.md",
      "the tasks command did not answer (its exit code not 0)",
      couldNotRunLine("tasks.md", "the tasks command did not answer (its exit code not 0)"),
    ],
    ["touches-refused", "touches.json", `${X}: entry twice`, couldNotRunLine("touches.json", `${X}: entry twice`)],
    ["touches-missing", "touches.json", "the file is missing", couldNotRunLine("touches.json", "the file is missing")],
    ["touches-stale", "touches.json", "plan.md or spec.md changed after this round listed the plan's paths", TOUCHES_STALE_LINE],
    [
      "questions-refused",
      "review-questions.json",
      "questions.0.hold: expected a string",
      "FAIL: review-questions.json: questions.0.hold: expected a string. Next step: rerun the rescope from " +
        "/planner:issue-spec rescope.",
    ],
    [
      "tasks-refused",
      "tasks.md:12",
      "a/{b,c}.ts: a brace group names files the check cannot list",
      `FAIL: tasks.md:12: a/{b,c}.ts: a brace group names files the check cannot list${TASKS_REFUSED_NEXT}`,
    ],
    ["tasks-empty", "tasks.md", "no task line names a path", TASKS_EMPTY_LINE],
    [
      "github",
      "GitHub",
      "GET /repos/acme/widgets/issues/7/sub_issues: 502 Bad Gateway",
      couldNotRunLine("GitHub", "GET /repos/acme/widgets/issues/7/sub_issues: 502 Bad Gateway"),
    ],
    ["ruling-refused", "adr_ruling", "not JSON", `FAIL: adr_ruling: not JSON${RULING_REFUSED_NEXT}`],
    ["guard-rulings", "adr-rulings.json", `entry ${INSIDE} 0004 ${X} was not written by the check`, GUARD_LINE],
    [
      "guard-paths",
      "touches.json",
      `changed after ask: added ${Y}, removed ${X}`,
      couldNotRunLine("touches.json", `changed after ask: added ${Y}, removed ${X}`),
    ],
    ["guard-asked", "adr-asked.json", "changed after ask", couldNotRunLine("adr-asked.json", "changed after ask")],
    [
      "settings",
      "codeworks.toml",
      "codeworks.toml [shared]: adr_folders: expected array",
      `COULD_NOT_RUN: codeworks.toml: codeworks.toml [shared]: adr_folders: expected array${SETTINGS_NEXT}`,
    ],
    [
      "git",
      "git",
      "git rev-parse --show-toplevel exited 128: fatal: not a git repository",
      `COULD_NOT_RUN: git: git rev-parse --show-toplevel exited 128: fatal: not a git repository${GIT_NEXT}`,
    ],
  ];

  for (const [kind, label, what, line] of ROWS) {
    it(`renders a ${kind} stop as the table's line, exiting as its outcome`, () => {
      assert.ok(Object.hasOwn(ADR_STOPS, kind), `ADR_STOPS has no ${kind} row`);
      assert.deepEqual(adrStop([item(kind, label, what)]), { lines: [line], exit: EXIT[ADR_STOPS[kind].outcome] });
    });
  }

  it("exits 0 when every line is PASS", () => {
    const { lines, exit } = adrStop([
      item("ungoverned", INSIDE, "no record governs these paths"),
      item("governed", OUTSIDE, "governing: 0001 Org discovery"),
      item("empty", "codeworks.toml", "No ADR folder is listed in [shared] adr_folders"),
    ]);
    assert.deepEqual(lines.map((line) => line.split(":")[0]), [PASS, PASS, PASS]);
    assert.equal(exit, 0);
  });

  it("exits 1 when a line is FAIL and none COULD_NOT_RUN", () => {
    assert.equal(adrStop([item("ungoverned", INSIDE, "no record governs these paths"), item("ruling-refused", "adr_ruling", "y")]).exit, 1);
  });

  it("exits 2 when any line is COULD_NOT_RUN, whatever else fails", () => {
    assert.equal(adrStop([item("ruling-refused", "adr_ruling", "y"), item("git", "git", "y")]).exit, 2);
  });

  it("prints one line per item, in order", () => {
    const { lines } = adrStop([item("git", "git", "y"), item("ruling-refused", "adr_ruling", "y")]);
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

  it("fails a folder on each DEPARTS path when there is no ruling, a path only the plan names having no story", () => {
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

  // T031: a `[US2]` task and a phase task naming one governed path
  it("names every story whose task names a departing path, the tag's or the phase heading's", () => {
    const paths = [planPath(X, 1), taskPath(X, 12, "US2"), taskPath(Y, 13, "US2"), taskPath(X, 20, "Phase 4: Polish")];
    const decided = decideFolder(answered(INSIDE, true, [R0004]), paths, verdict(departs(INSIDE, "0004", [X])), []);
    assert.deepEqual(decided.departures, [{ record: "0004", path: X, stories: ["US2", "Phase 4: Polish"], why: WHY }]);
  });

  it("drops each departure a ruling names by folder, record and path, and fails on the rest", () => {
    const decided = decideFolder(answered(INSIDE, true, [R0004]), PLAN_PATHS, verdict(departs(INSIDE, "0004", [X, Y])), [
      ruling(INSIDE, "0004", X),
    ]);
    assert.equal(decided.outcome, FAIL);
    assert.deepEqual(decided.departures, [{ record: "0004", path: Y, stories: [], why: WHY }]);
  });

  for (const [named, paths] of [
    ["a task names", [taskPath(X, 12, "US1")]],
    ["the plan names", [planPath(X, 1)]],
    ["the plan and a task name", [planPath(X, 1), taskPath(X, 12, "US1")]],
  ] as const) {
    it(`drops a departure on a path ${named} when a ruling names its key`, () => {
      const decided = decideFolder(answered(INSIDE, true, [R0004]), paths, verdict(departs(INSIDE, "0004", [X])), [ruling(INSIDE, "0004", X)]);
      assert.deepEqual(decided, outcome({ entry: INSIDE, inside: true, outcome: PASS, governing: [R0004] }));
    });
  }

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

  it("prints one FAIL per departure from a folder inside, the next step changing plan.md (departure-inside)", () => {
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

  // quickstart Planner: "`tasks.md` task `[US2]` and a `## Phase 4: …` task name one governed path" (US3 AS2); T031
  it("names every story whose task names the departing path, still sending the admin to plan.md", () => {
    const paths = [planPath(Y, 1), taskPath(X, 12, "US2"), taskPath(X, 20, "Phase 4: Polish")];
    const { lines, exit } = adrStop(decideCheck(askedRecord([answered(INSIDE, true, [R0004])], paths), verdict(departs(INSIDE, "0004", [X])), []));
    assert.deepEqual({ lines, exit }, { lines: [departsInsideLine("0004", X, ["US2", "Phase 4: Polish"])], exit: 1 });
    assertNoTasksEdit(lines);
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
    ["misses a governing record", verdict(within(INSIDE, "0004")), mismatchLine(INSIDE, "misses governing 0005")],
    [
      "names a record that does not govern",
      verdict(within(INSIDE, "0004"), within(INSIDE, "0005"), within(INSIDE, "0009")),
      mismatchLine(INSIDE, "names 0009 not governing"),
    ],
    [
      "names a path not asked",
      verdict(within(INSIDE, "0004"), departs(INSIDE, "0005", ["lib/z.ts"])),
      mismatchLine(INSIDE, "names lib/z.ts not asked"),
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
      { lines: [governedLine(INSIDE, R0004), mismatchLine(ELSE, "names 0001 not governing")], exit: 2 },
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
  const at = (path: string, line: number, story: string | null = null) => ({ path, line, story });

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

  it("compares whole values: a task path whose story changed is removed and added", () => {
    assert.deepEqual(changedSince([at(X, 12, "US1")], [at(X, 12, "US2")]), { added: [at(X, 12, "US2")], removed: [at(X, 12, "US1")] });
  });

  it("compares whole values: a ruling whose reason changed is removed and added", () => {
    const before = ruling(INSIDE, "0004", X, "the user's words");
    const after = ruling(INSIDE, "0004", X, "words someone else wrote");
    assert.deepEqual(changedSince([before], [after]), { added: [after], removed: [before] });
  });
});

// --- adr_check.ts, driven round by round ----------------------------------------------------------------------------

const SPEC_MD = "# Feature Specification: demo\n";
const PLAN = `# Implementation Plan: demo\n\n## Project Structure\n\n- \`${X}\`: the check.\n`;
const RESEARCH = "# Research: demo\n";
const CONSTITUTION = "# Constitution\n";

/** A tasks.md as Spec Kit's tasks command writes it: Setup, one phase per story, Polish. */
function tasksMd({
  setup = "Create the spec's folders",
  us1 = `Read the folders in \`${X}\``,
  us2 = "Print the lines",
  polish = "Tidy the docs",
  above = "",
} = {}): string {
  return (
    `# Tasks: demo\n\n${above}## Phase 1: Setup\n\n- [ ] T001 ${setup}\n\n` +
    `## Phase 2: User Story 1 - Check the plan (Priority: P1)\n\n- [ ] T002 [US1] ${us1}\n\n` +
    `## Phase 3: User Story 2 - Report the check (Priority: P2)\n\n- [ ] T003 [US2] ${us2}\n\n` +
    `## Phase 4: Polish\n\n- [ ] T004 ${polish}\n`
  );
}

const TASKS = tasksMd();

/** The 1-based number of the first line of `text` holding `part`. */
function lineOf(text: string, part: string): number {
  const at = text.split("\n").findIndex((line) => line.includes(part));
  assert.notEqual(at, -1, `no line holds ${part}`);
  return at + 1;
}

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

type AdrRecord = { recordId: string; title: string; paths: string[] };
type FolderAnswer = { records: AdrRecord[]; broken?: (typeof BROKEN)[]; unanswered?: true };

type World = {
  root: string;
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
 *  answers file by `--dir`, governing with each record one of whose paths it is given; for an `unanswered` folder it
 *  exits 3 with no answer. */
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
if (folder.unanswered) process.exit(3);
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
 * beside it, a spec folder with no tasks.md yet (the first round's tasks command writes it), and a stand-in `adr`
 * first on PATH answering: 0004 governs core/src/x.ts and 0005 lib/y.ts in docs/adr, 0001 core/src/x.ts in
 * ../org/docs/adr. HOME is the test's own, so no step reads the admin's planner token.
 */
function world(t: TestContext, folders: readonly string[] = [INSIDE, OUTSIDE]): World {
  tempHome(t);
  const { root, checkout } = scratchCheckout(t);
  const settings = join(checkout, "codeworks.toml");
  const seeded = readFileSync(settings, "utf8");
  const listed = seeded.replace("adr_folders = []", `adr_folders = ${JSON.stringify(folders)}`);
  assert.ok(folders.length === 0 || listed !== seeded, "the scratch checkout's settings no longer read adr_folders = []");
  writeFileSync(settings, listed);
  git(checkout, "commit", "-q", "--allow-empty", "-am", "list the ADR folders");
  for (const dir of [join(checkout, INSIDE), join(root, "org", "docs", "adr"), join(checkout, RUN)]) mkdirSync(dir, { recursive: true });
  writeFiles(checkout, {
    [`${SPEC}/spec.md`]: SPEC_MD,
    [`${SPEC}/plan.md`]: PLAN,
    [`${SPEC}/research.md`]: RESEARCH,
    ".specify/memory/constitution.md": CONSTITUTION,
  });
  const bin = join(root, "bin");
  const noAdr = join(root, "no-adr");
  mkdirSync(bin);
  mkdirSync(noAdr);
  // A PATH narrowed to no adr must still find git: the steps read settings at HEAD through it.
  const gitBinary = PATH.split(delimiter).map((dir) => join(dir, "git")).find((path) => existsSync(path));
  if (gitBinary === undefined) throw new Error("git is not on PATH");
  symlinkSync(gitBinary, join(noAdr, "git"));
  const real = realpathSync(checkout);
  const w: World = {
    root,
    checkout: real,
    run: join(real, RUN),
    spec: join(real, SPEC),
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
  return w;
}

/** `answers` keyed by entry; the outside entry stands for its realpath, the `--dir` adr is given for it. */
function answer(w: World, answers: Record<string, FolderAnswer>): void {
  const byDir = Object.fromEntries(Object.entries(answers).map(([entry, folder]) => [entry === OUTSIDE ? w.outside : entry, folder]));
  writeFileSync(w.answers, JSON.stringify(byDir));
}

/** In the touches step's place. */
function writeTouches(w: World, json: unknown): void {
  writeFileSync(join(w.run, "touches.json"), typeof json === "string" ? json : JSON.stringify(json));
}

/** In the tasks command's place. */
function writeTasks(w: World, text: string): void {
  writeFileSync(join(w.spec, "tasks.md"), text);
}

/** In the judge's place. */
function writeVerdict(w: World, judged: readonly Judged[] | string): void {
  writeFileSync(join(w.run, "adr-verdict.json"), typeof judged === "string" ? judged : JSON.stringify({ v: 1, verdicts: judged }));
}

function commitRulings(w: World, rulings: Ruling[]): void {
  writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings }) });
  git(w.checkout, "add", `${SPEC}/adr-rulings.json`);
  git(w.checkout, "commit", "-q", "-m", "rulings");
}

function adrFoldersNotAList(w: World): void {
  const settings = join(w.checkout, "codeworks.toml");
  const listed = readFileSync(settings, "utf8");
  const broken = listed.replace(/^adr_folders = .*$/m, `adr_folders = ${JSON.stringify(INSIDE)}`);
  assert.notEqual(broken, listed, "replacing the adr_folders line changed nothing in the scratch checkout's codeworks.toml");
  writeFileSync(settings, broken);
  git(w.checkout, "commit", "-q", "-am", "adr_folders not a list");
}

type Ran = { exit: number | null; lines: string[]; stdout: string };

function environment(path: string, env: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  // A ruling or a GitHub reaches a step only as the test hands it one.
  delete inherited.ADR_RULING;
  delete inherited.PLANNER_TEST_GITHUB_API;
  return { ...inherited, PATH: path, ...env };
}

function script(cwd: string, args: string[], env: Record<string, string> = {}, path = PATH): Ran {
  const done = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env: environment(path, env) });
  assert.equal(done.error, undefined, String(done.error));
  return { exit: done.status, lines: done.stderr.split("\n").filter((line) => line !== ""), stdout: done.stdout };
}

function adrCheck(w: World, args: string[], env: Record<string, string> = {}, path?: string): Ran {
  return script(w.checkout, args, env, path ?? `${w.bin}${delimiter}${PATH}`);
}

// The exit code the workflow passes for a model step that answered: only this literal is answered.
const ANSWERED = "0";
const NOT_ANSWERED = ["1", "", "00", "-1"] as const;

const stopFile = (w: World) => join(w.run, "adr-stop.json");
const doneFile = (w: World, step: string) => join(w.run, "adr-steps", `${step}.json`);
const rulingsFile = (w: World) => join(w.spec, "adr-rulings.json");
const writtenFile = (w: World) => join(w.run, "adr-rulings-written.json");
const askedFile = (w: World) => join(w.run, "adr-asked.json");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

type StopRecord = { v: 1; exit: number; lines: string[]; shown: boolean; unanswered: boolean };

function stopRecord(w: World): StopRecord {
  assert.ok(existsSync(stopFile(w)), "no stop record was written");
  return readJson(stopFile(w)) as StopRecord;
}

/** A round step that exits 0 printing nothing, whether or not it recorded a stop. */
function quiet(ran: Ran, step: string): void {
  assert.deepEqual(ran, { exit: 0, lines: [], stdout: "" }, step);
}

function clear(w: World): void {
  quiet(adrCheck(w, ["clear", SPEC, RUN]), "clear");
}

/** tasks-due's stdout is its JSON alone. */
function tasksDue(w: World): boolean {
  const ran = adrCheck(w, ["tasks-due", SPEC, RUN]);
  assert.equal(ran.exit, 0, ran.lines.join("\n"));
  assert.deepEqual(ran.lines, []);
  const printed = JSON.parse(ran.stdout) as { due: boolean };
  assert.deepEqual(Object.keys(printed), ["due"], ran.stdout);
  assert.equal(typeof printed.due, "boolean");
  return printed.due;
}

function tasksWritten(w: World, tasksExit: string): void {
  quiet(adrCheck(w, ["tasks-written", RUN, tasksExit]), "tasks-written");
}

function stories(w: World, kind: string, path?: string): void {
  quiet(adrCheck(w, ["stories", ISSUE, kind, SPEC, RUN], {}, path), "stories");
}

type Asking = Ran & { judge: boolean; decide: boolean; asked: string };

/** ask's stdout is its JSON alone: `asked` the sha256 of the asked record's bytes, or, on a stop, nothing to decide. */
function asking(w: World, touchesExit: string, path?: string): Asking {
  const ran = adrCheck(w, ["ask", SPEC, RUN, touchesExit], {}, path);
  assert.equal(ran.exit, 0, ran.lines.join("\n"));
  const printed = JSON.parse(ran.stdout) as { judge: boolean; decide: boolean; asked: string };
  assert.deepEqual(Object.keys(printed).sort(), ["asked", "decide", "judge"], ran.stdout);
  assert.deepEqual(readJson(doneFile(w, "ask")), { v: 1, step: "ask", decide: printed.decide });
  if (printed.decide) {
    assert.equal(typeof printed.judge, "boolean");
    assert.equal(printed.asked, sha256(readFileSync(askedFile(w))));
  } else {
    assert.deepEqual(printed, { judge: false, decide: false, asked: "" });
    assert.deepEqual(ran.lines, [], "ask printed a line beside the stop it recorded");
  }
  return { ...ran, ...printed };
}

function decide(w: World, asked: string, judgeExit: string, env: Record<string, string> = {}, path?: string): Ran {
  return adrCheck(w, ["decide", SPEC, RUN, asked, judgeExit], env, path);
}

function report(w: World): Ran {
  return adrCheck(w, ["report", SPEC, RUN]);
}

/** A report that showed no stop: exit 0, no line, and stdout its JSON alone. */
function again(ran: Ran): boolean {
  assert.equal(ran.exit, 0, ran.lines.join("\n"));
  assert.deepEqual(ran.lines, []);
  const printed = JSON.parse(ran.stdout) as { again: boolean };
  assert.deepEqual(Object.keys(printed), ["again"], ran.stdout);
  return printed.again;
}

/** Every governing record of the asked record WITHIN, as a judge that finds no departure writes it. */
function withinAll(w: World): Judged[] {
  const asked = readJson(askedFile(w)) as { folders: { entry: string; governing?: { recordId: string }[] }[] };
  return asked.folders.flatMap(({ entry, governing = [] }) => governing.map(({ recordId }) => within(entry, recordId)));
}

type Round = {
  /** What the touches step writes; null: it writes nothing. */
  touches?: unknown;
  touchesExit?: string;
  /** What the tasks command writes when the round is due; null: it writes nothing. */
  tasks?: string | null;
  tasksExit?: string;
  /** What the judge writes when ask says judge; null: nothing. Every governing record WITHIN when absent. */
  verdict?: readonly Judged[] | string | null;
  judgeExit?: string;
  kind?: string;
  /** decide's environment, as the resume exports ADR_RULING to it. */
  env?: Record<string, string>;
  /** PATH for stories, ask and decide. */
  path?: string;
  afterClear?: () => void;
  beforeAsk?: () => void;
  beforeDecide?: () => void;
};

type RoundRan = { due: boolean; asked: Asking; decided: Ran | null };

/** One round of the adr-check loop from clear up to report (settled-design is not adr_check.ts's), each model step's
 *  place taken by the test, each `if` as the workflow gives it. */
function runRound(w: World, r: Round = {}): RoundRan {
  clear(w);
  r.afterClear?.();
  if (r.touches !== null) writeTouches(w, r.touches ?? { v: 1, paths: [X] });
  const due = tasksDue(w);
  assert.deepEqual(readJson(doneFile(w, "tasks-due")), { v: 1, step: "tasks-due", due });
  if (due) {
    if (r.tasks !== null) writeTasks(w, r.tasks ?? TASKS);
    tasksWritten(w, r.tasksExit ?? ANSWERED);
    assert.deepEqual(readJson(doneFile(w, "tasks-written")), { v: 1, step: "tasks-written" });
  }
  stories(w, r.kind ?? RESCOPE, r.path);
  assert.deepEqual(readJson(doneFile(w, "stories")), { v: 1, step: "stories" });
  r.beforeAsk?.();
  const asked = asking(w, r.touchesExit ?? ANSWERED, r.path);
  if (asked.judge && r.verdict !== null) writeVerdict(w, r.verdict ?? withinAll(w));
  if (!asked.decide) return { due, asked, decided: null };
  r.beforeDecide?.();
  const decided = decide(w, asked.asked, r.judgeExit ?? ANSWERED, r.env ?? {}, r.path);
  assert.equal(decided.exit, 0, decided.lines.join("\n"));
  assert.equal(decided.stdout, "");
  assert.deepEqual(readJson(doneFile(w, "decide")), { v: 1, step: "decide" });
  if (existsSync(stopFile(w))) assert.deepEqual(decided.lines, [], "decide printed a line beside the stop it recorded");
  return { due, asked, decided };
}

type Shown = { exit: number | null; lines: string[]; unanswered: boolean };

/** report on the stop record a round step wrote: its lines on stderr and its exit, the record rewritten shown. */
function shown(w: World): Shown {
  const record = stopRecord(w);
  assert.equal(record.shown, false, JSON.stringify(record));
  const { exit, lines, stdout } = report(w);
  assert.deepEqual({ exit, lines, stdout }, { exit: record.exit, lines: record.lines, stdout: "" });
  assert.deepEqual(readJson(stopFile(w)), { ...record, shown: true });
  assertNoTasksEdit(lines);
  return { exit, lines, unanswered: record.unanswered };
}

/** A round that recorded a stop, as report shows it. */
function stops(w: World, r: Round = {}): Shown {
  runRound(w, r);
  return shown(w);
}

function askStops(w: World, r: Round = {}): Shown {
  const beforeAsk = () => {
    assert.equal(existsSync(stopFile(w)), false, "a step before ask recorded a stop");
    r.beforeAsk?.();
  };
  assert.equal(runRound(w, { ...r, beforeAsk }).asked.decide, false);
  return shown(w);
}

/** A round that recorded no stop: decide's lines, and report ending the loop. */
function passes(w: World, r: Round = {}): string[] {
  const { decided } = runRound(w, r);
  assert.equal(existsSync(stopFile(w)), false, existsSync(stopFile(w)) ? readFileSync(stopFile(w), "utf8") : "");
  assert.equal(again(report(w)), false);
  assert.ok(decided !== null, "ask decided nothing");
  return decided.lines;
}

type Called = { rounds: number; exit: number | null; lines: string[] };

/** The rounds one `specify` call runs: a new round while report asks for one, up to `most`. */
function rounds(w: World, r: Round = {}, most = 3): Called {
  for (let n = 1; n <= most; n++) {
    const { decided } = runRound(w, r);
    const reported = report(w);
    if (reported.exit !== 0) return { rounds: n, exit: reported.exit, lines: reported.lines };
    if (!again(reported)) return { rounds: n, exit: 0, lines: decided?.lines ?? [] };
  }
  return assert.fail(`report asked for another round ${most} times`);
}

/** The resume after a shown stop: it re-runs report, which asks for a new round, then the rounds of that call. */
function resume(w: World, r: Round = {}): Called {
  assert.equal(again(report(w)), true);
  return rounds(w, r);
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

const forgetCalls = (w: World) => () => rmSync(w.calls, { force: true });

/** A folder outside any checkout holding the run folder. */
function away(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "planner-adr-away-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, RUN), { recursive: true });
  return dir;
}

const sortedJson = (values: readonly unknown[]): string[] => values.map((value) => JSON.stringify(value)).sort();

const DEPARTS_INSIDE = [departs(INSIDE, "0004", [X]), within(OUTSIDE, "0001")];
const RULED = ruling(INSIDE, "0004", X, "the user keeps discovery for x.ts");
const ruled = (...rulings: unknown[]): Record<string, string> => ({ ADR_RULING: JSON.stringify(rulings) });

describe("adr_check.ts ask and decide", () => {
  // quickstart Planner: "ask" — stdout is `{"judge", "decide", "asked"}` only; `decide` true when it recorded no stop
  it("ask writes the asked record from touches.json and tasks.md, one entry per artifact, and each folder's answer", (t) => {
    const w = world(t);
    const { asked } = runRound(w, { beforeAsk: forgetCalls(w) });
    assert.equal(asked.judge, true);
    const record = readJson(askedFile(w)) as { paths: unknown[] };
    assert.deepEqual(Object.keys(record).sort(), ["folders", "paths", "v"]);
    assert.deepEqual(
      sortedJson(record.paths),
      sortedJson([
        { path: X, artifact: "plan", line: 1, story: null },
        { path: X, artifact: "tasks", line: lineOf(TASKS, X), story: "US1" },
      ]),
    );
    assert.deepEqual(readJson(askedFile(w)), {
      v: 1,
      paths: record.paths,
      folders: [
        { entry: INSIDE, path: join(w.checkout, INSIDE), inside: true, governing: [R0004], broken: [] },
        { entry: OUTSIDE, path: w.outside, inside: false, governing: [R0001], broken: [] },
      ],
    });
    // The folders are checked at once, so the stand-in logs their calls in no fixed order.
    assert.deepEqual(checkCalls(w).map((args) => args.slice(0, 3)).sort(), [["check", "--dir", INSIDE], ["check", "--dir", w.outside]].sort());
    assert.ok(checkCalls(w).every((args) => args.includes(X)), JSON.stringify(checkCalls(w)));
    assert.ok(adrCalls(w).every((call) => call.cwd === w.checkout), JSON.stringify(adrCalls(w)));
  });

  // quickstart Planner: "verdict all `WITHIN`" (US3 AS1)
  it("passes when the verdict finds every governing record WITHIN, a PASS line per folder", (t) => {
    const w = world(t);
    assert.deepEqual(passes(w, { verdict: [within(INSIDE, "0004"), within(OUTSIDE, "0001")] }), [
      governedLine(INSIDE, R0004),
      governedLine(OUTSIDE, R0001),
    ]);
  });

  // quickstart Planner: "no record governs"
  it("passes with no judge when no record governs the paths", (t) => {
    const w = world(t);
    answer(w, {});
    const { asked, decided } = runRound(w);
    assert.equal(asked.judge, false);
    assert.equal(existsSync(stopFile(w)), false);
    assert.deepEqual(decided?.lines, [ungovernedLine(INSIDE), ungovernedLine(OUTSIDE)]);
    assert.equal(again(report(w)), false);
  });

  // quickstart Planner: "one `DEPARTS` on `core/src/x.ts` from `0004` (folder inside)" (AS2)
  it("stops on a departure from a record inside, naming record, path, story and why, the next step changing plan.md", (t) => {
    const w = world(t);
    assert.deepEqual(stops(w, { verdict: DEPARTS_INSIDE }), {
      exit: 1,
      lines: [departsInsideLine("0004", X, ["US1"]), governedLine(OUTSIDE, R0001)],
      unanswered: false,
    });
  });

  // quickstart Planner: "one `DEPARTS` from a record in `../org/docs/adr` (outside)" (AS2)
  it("stops on a departure from a record outside, the next step naming the repo that holds the folder", (t) => {
    const w = world(t);
    assert.deepEqual(stops(w, { verdict: [within(INSIDE, "0004"), departs(OUTSIDE, "0001", [X])] }), {
      exit: 1,
      lines: [governedLine(INSIDE, R0004), departsOutsideLine("0001", X, ["US1"])],
      unanswered: false,
    });
  });

  // quickstart Planner: "`adr` answers a record with its own error" (AS8)
  it("stops on a record adr finds broken, naming its file, rule and message", (t) => {
    const w = world(t);
    answer(w, {
      [INSIDE]: { records: [{ ...R0004, paths: [X] }], broken: [BROKEN] },
      [OUTSIDE]: { records: [{ ...R0001, paths: [X] }] },
    });
    assert.deepEqual(stops(w), { exit: 1, lines: [BROKEN_LINE, governedLine(OUTSIDE, R0001)], unanswered: false });
  });

  describe("one folder could not run (AS3)", () => {
    // quickstart Planner: "one entry missing, `adr` absent, or verdict missing a record" — one entry missing
    it("shows a missing folder's COULD_NOT_RUN once, among the other folders' lines, exiting 2", (t) => {
      const w = world(t, [INSIDE, MISSING, OUTSIDE]);
      const { exit, lines } = stops(w);
      assert.equal(exit, 2, lines.join("\n"));
      assert.equal(lines.length, 3, lines.join("\n"));
      assert.equal(lines[0], governedLine(INSIDE, R0004));
      assert.ok(lines[1].startsWith(`COULD_NOT_RUN: ${MISSING}: not a readable folder, so adr was not called. Next step: `), lines[1]);
      assert.equal(lines[1].split(`${MISSING}: `).length, 2, lines[1]);
      assert.equal(lines[2], governedLine(OUTSIDE, R0001));
    });

    // quickstart Planner: "one entry missing, `adr` absent, or verdict missing a record" — `adr` absent
    it("shows each folder's COULD_NOT_RUN naming the install when adr is not on PATH", (t) => {
      const w = world(t);
      const absent = (entry: string) =>
        `COULD_NOT_RUN: ${entry}: the adr command was not found (adrkit needs node 22 or later). Next step: ${ADR_INSTALL}.`;
      assert.deepEqual(stops(w, { path: w.noAdr }), { exit: 2, lines: [absent(INSIDE), absent(OUTSIDE)], unanswered: false });
    });

    // quickstart Planner: "one entry missing, `adr` absent, or verdict missing a record" — verdict missing a record
    it("could not run in a folder whose verdict misses a governing record, still showing the other folder", (t) => {
      const w = world(t);
      assert.deepEqual(stops(w, { touches: { v: 1, paths: [X, Y] }, verdict: [within(INSIDE, "0004"), within(OUTSIDE, "0001")] }), {
        exit: 2,
        lines: [mismatchLine(INSIDE, "misses governing 0005"), governedLine(OUTSIDE, R0001)],
        unanswered: false,
      });
    });
  });

  describe("a verdict decide cannot read", () => {
    const unread = ({ exit, lines, unanswered }: Shown) => {
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(
        lines.some((line) => line.startsWith("COULD_NOT_RUN: adr-verdict.json: ") && line.endsWith(CHECK_AGAIN)),
        lines.join("\n"),
      );
      // The row names the judge as its Unanswered step.
      assert.equal(unanswered, true);
    };

    // quickstart Planner: "verdict file missing or not an `AdrVerdict`"
    for (const [what, text] of [
      ["missing", null],
      ["not JSON", "{ verdicts"],
      ["not an AdrVerdict", JSON.stringify({ v: 1, verdicts: [{ ...within(INSIDE, "0004"), judgment: "PASS" }, within(OUTSIDE, "0001")] })],
      ["with an artifact key", JSON.stringify({ v: 1, artifact: "plan", verdicts: [within(INSIDE, "0004"), within(OUTSIDE, "0001")] })],
    ] as const) {
      it(`could not run on a verdict ${what}`, (t) => {
        unread(stops(world(t), { verdict: text }));
      });
    }

    it("never reads a verdict left from an earlier round: clear deletes it first", (t) => {
      const w = world(t);
      writeVerdict(w, [within(INSIDE, "0004"), within(OUTSIDE, "0001")]);
      unread(stops(w, { verdict: null }));
    });

    // quickstart Planner: "`decide` with judge exit code other than `0` and a valid all-`WITHIN` verdict, the asked
    // record saying `judge`"
    for (const judgeExit of NOT_ANSWERED) {
      it(`could not run on a judge exit code ${JSON.stringify(judgeExit)}, however valid the verdict it left`, (t) => {
        unread(stops(world(t), { judgeExit }));
      });
    }
  });

  // quickstart Planner: "`decide` with judge exit code `1` or empty, the asked record saying no judge"
  for (const judgeExit of ["1", ""]) {
    it(`ignores a judge exit code ${JSON.stringify(judgeExit)} when the asked record says no judge, and passes`, (t) => {
      const w = world(t);
      answer(w, {});
      assert.deepEqual(passes(w, { judgeExit }), [ungovernedLine(INSIDE), ungovernedLine(OUTSIDE)]);
    });
  }

  describe("ADR_RULING", () => {
    // quickstart Planner: "`ADR_RULING` names the departure" (AS5) and "`decide` appending a ruling"
    it("rules the departure it names: decide appends it and passes, report asks again, and the next round finds it satisfied", (t) => {
      const w = world(t);
      const first = runRound(w, { verdict: DEPARTS_INSIDE, env: ruled(RULED), beforeDecide: forgetCalls(w) });
      assert.deepEqual(first.decided?.lines, [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)]);
      // One `adr check` per new ruling, given that ruling's path alone.
      assert.deepEqual(checkCalls(w), [["check", "--dir", INSIDE, "--json", "--", X]]);
      assert.equal(existsSync(stopFile(w)), false);
      assert.deepEqual(readJson(rulingsFile(w)), { v: 1, rulings: [RULED] });
      assert.deepEqual(readJson(writtenFile(w)), { v: 1, rulings: [RULED] });
      // The rulings file changed after stories hashed it, so that round's pass is no pass.
      assert.equal(again(report(w)), true);
      assert.deepEqual(rounds(w, { verdict: DEPARTS_INSIDE, env: ruled(RULED) }), {
        rounds: 1,
        exit: 0,
        lines: [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)],
      });
      assert.deepEqual(readJson(rulingsFile(w)), { v: 1, rulings: [RULED] });
      assert.deepEqual(readJson(writtenFile(w)), { v: 1, rulings: [RULED] });
    });

    it("leaves a departure it does not name to stop the check", (t) => {
      const w = world(t);
      answer(w, { [INSIDE]: { records: [{ ...R0004, paths: [X, Y] }] }, [OUTSIDE]: { records: [{ ...R0001, paths: [X] }] } });
      const judged = [departs(INSIDE, "0004", [X, Y]), within(OUTSIDE, "0001")];
      assert.deepEqual(rounds(w, { touches: { v: 1, paths: [X, Y] }, verdict: judged, env: ruled(RULED) }), {
        rounds: 2,
        exit: 1,
        lines: [departsInsideLine("0004", Y), governedLine(OUTSIDE, R0001)],
      });
    });

    // quickstart Planner: "`ADR_RULING` valid, no departure this round on its key"; T031
    it("refuses a valid ruling on a key no departure of the round names, appending nothing", (t) => {
      const w = world(t);
      const { exit, lines } = stops(w, { verdict: [within(INSIDE, "0004"), within(OUTSIDE, "0001")], env: ruled(RULED) });
      assert.equal(exit, 1, lines.join("\n"));
      assert.ok(
        lines.some((line) => line.startsWith("FAIL: adr_ruling: ") && line.includes("0004") && line.includes(X) && line.endsWith(RULING_REFUSED_NEXT)),
        lines.join("\n"),
      );
      assert.equal(existsSync(rulingsFile(w)), false);
      assert.equal(existsSync(writtenFile(w)), false);
    });

    // quickstart Planner: "`ADR_RULING` not JSON, or with an unlisted folder, an unasked path, or a record not governing
    // its path, beside a valid one"
    for (const [what, value] of [
      ["not JSON", "[{folder: docs/adr}"],
      ["not a list of rulings", JSON.stringify(RULED)],
      ["a ruling with no reason, beside a valid one", JSON.stringify([RULED, { folder: INSIDE, record: "0004", path: X }])],
      ["an unlisted folder, beside a valid one", JSON.stringify([RULED, ruling("../else/docs/adr", "0004", X)])],
      ["an unasked path, beside a valid one", JSON.stringify([RULED, ruling(INSIDE, "0005", Y)])],
    ] as const) {
      it(`refuses the whole ruling for ${what}, appending nothing`, (t) => {
        const w = world(t);
        const { exit, lines } = stops(w, { verdict: DEPARTS_INSIDE, env: { ADR_RULING: value } });
        assert.equal(exit, 1, lines.join("\n"));
        assert.ok(lines.some((line) => line.startsWith("FAIL: adr_ruling: ") && line.endsWith(RULING_REFUSED_NEXT)), lines.join("\n"));
        assert.equal(existsSync(rulingsFile(w)), false);
        assert.equal(existsSync(writtenFile(w)), false);
      });
    }

    // A ruling on a listed folder, an asked path and a departure of the round: only adr's answer for its one path
    // refuses it, the stand-in giving 0005 alone for lib/y.ts.
    it("refuses the whole ruling for a record not governing its path, beside a valid one, appending nothing", (t) => {
      const w = world(t);
      const { exit, lines } = stops(w, {
        touches: { v: 1, paths: [X, Y] },
        verdict: [departs(INSIDE, "0004", [X, Y]), within(INSIDE, "0005"), within(OUTSIDE, "0001")],
        env: ruled(RULED, ruling(INSIDE, "0004", Y)),
      });
      assert.equal(exit, 1, lines.join("\n"));
      assert.ok(
        lines.some((line) => line.startsWith("FAIL: adr_ruling: ") && line.includes(`0004 not governing ${Y}`) && line.endsWith(RULING_REFUSED_NEXT)),
        lines.join("\n"),
      );
      assert.equal(existsSync(rulingsFile(w)), false);
      assert.equal(existsSync(writtenFile(w)), false);
    });

    // FR-009: a refused ruling stops the check beside every folder's outcome, and a folder that could not run sets
    // the exit.
    it("still decides every folder when it refuses the ruling, exiting 2 when one could not run, appending nothing", (t) => {
      const w = world(t, [INSIDE, MISSING, OUTSIDE]);
      const { exit, lines } = stops(w, { env: { ADR_RULING: "not json" } });
      assert.equal(exit, 2, lines.join("\n"));
      assert.equal(lines.length, 4, lines.join("\n"));
      assert.ok(lines[0].startsWith("FAIL: adr_ruling: not JSON: ") && lines[0].endsWith(RULING_REFUSED_NEXT), lines[0]);
      assert.equal(lines[1], governedLine(INSIDE, R0004));
      assert.ok(lines[2].startsWith(`COULD_NOT_RUN: ${MISSING}: not a readable folder, so adr was not called. Next step: `), lines[2]);
      assert.equal(lines[3], governedLine(OUTSIDE, R0001));
      assert.equal(existsSync(rulingsFile(w)), false);
      assert.equal(existsSync(writtenFile(w)), false);
    });

    // artifact-grammar.md, ADR_RULING: a ruling's check that could not run makes the check could not run, nothing
    // appended, so not the valid ruling whose call ran either.
    it("could not run when the check of one ruling cannot run, appending none of them", (t) => {
      const w = world(t);
      const unanswered = () => {
        forgetCalls(w)();
        answer(w, { [INSIDE]: { records: [{ ...R0004, paths: [X] }] }, [OUTSIDE]: { records: [], unanswered: true } });
      };
      const { exit, lines } = stops(w, {
        verdict: [departs(INSIDE, "0004", [X]), departs(OUTSIDE, "0001", [X])],
        env: ruled(RULED, ruling(OUTSIDE, "0001", X)),
        beforeDecide: unanswered,
      });
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(lines.some((line) => line.startsWith("COULD_NOT_RUN: ") && line.includes(OUTSIDE)), lines.join("\n"));
      assert.deepEqual(checkCalls(w).map((args) => args[2]).sort(), [INSIDE, w.outside].sort());
      assert.equal(existsSync(rulingsFile(w)), false);
      assert.equal(existsSync(writtenFile(w)), false);
    });

    // quickstart Planner: "`ADR_RULING` already in `adr-rulings.json`"
    it("leaves the rulings file as it was for a ruling it already holds, checking it no more", (t) => {
      const w = world(t);
      commitRulings(w, [RULED]);
      const before = readFileSync(rulingsFile(w));
      assert.deepEqual(passes(w, { verdict: DEPARTS_INSIDE, env: ruled(RULED), beforeDecide: forgetCalls(w) }), [
        governedLine(INSIDE, R0004),
        governedLine(OUTSIDE, R0001),
      ]);
      assert.deepEqual(readFileSync(rulingsFile(w)), before);
      assert.deepEqual(checkCalls(w), []);
    });
  });

  describe("the rulings file (AS6, AS7)", () => {
    // quickstart Planner: "`adr-rulings.json` holds the key; a later round departs from it, on a plan or a task path"
    for (const [what, touched, tasks] of [
      ["a path only the plan names", [X], tasksMd({ us1: `Write \`${UNGOVERNED}\`` })],
      ["a path only a task names", [UNGOVERNED], TASKS],
    ] as const) {
      it(`passes a round that departs where a committed ruling names, on ${what}`, (t) => {
        const w = world(t);
        commitRulings(w, [RULED]);
        assert.deepEqual(passes(w, { touches: { v: 1, paths: touched }, tasks, verdict: DEPARTS_INSIDE }), [
          governedLine(INSIDE, R0004),
          governedLine(OUTSIDE, R0001),
        ]);
      });
    }

    // T031: a ruling written in one round honoured in the next with no ADR_RULING set (US3 AS6)
    it("passes a later resume with no ADR_RULING on the ruling an earlier one wrote, before it is committed", (t) => {
      const w = world(t);
      assert.equal(rounds(w, { verdict: DEPARTS_INSIDE, env: ruled(RULED) }).exit, 0);
      assert.deepEqual(rounds(w, { verdict: DEPARTS_INSIDE }), {
        rounds: 1,
        exit: 0,
        lines: [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)],
      });
    });

    /** decide's guard records the same line, so only ask deciding nothing shows the stop is ask's. */
    function askGuards(w: World): void {
      const { asked } = runRound(w);
      assert.equal(asked.decide, false, asked.stdout);
      assert.equal(existsSync(doneFile(w, "decide")), false, "decide ran");
      assert.ok(stopRecord(w).lines.includes(GUARD_LINE), JSON.stringify(stopRecord(w)));
      const { exit, lines } = shown(w);
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(lines.includes(GUARD_LINE), lines.join("\n"));
    }

    // quickstart Planner: "an entry, or an entry's `reason`, neither at `HEAD` nor in the run record" (AS7)
    it("ask records a stop on an entry written by hand, naming it", (t) => {
      const w = world(t);
      writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [RULED] }) });
      askGuards(w);
    });

    it("ask records a stop on an entry whose reason was changed by hand", (t) => {
      const w = world(t);
      commitRulings(w, [RULED]);
      writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [{ ...RULED, reason: "not the user's words" }] }) });
      askGuards(w);
    });

    // The rulings file is a round input: decide's stop is out of date, so report runs a new round, whose ask stops.
    it("decide records a stop on an entry written by hand after ask, and the next round's ask shows it", (t) => {
      const w = world(t);
      const handWritten = () => writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [RULED] }) });
      runRound(w, { verdict: DEPARTS_INSIDE, beforeDecide: handWritten });
      assert.ok(stopRecord(w).lines.includes(GUARD_LINE), JSON.stringify(stopRecord(w)));
      assert.equal(again(report(w)), true);
      askGuards(w);
    });

    // quickstart Planner: "an entry removed by hand"
    it("does not stop on an entry removed by hand", (t) => {
      const w = world(t);
      commitRulings(w, [RULED, ruling(OUTSIDE, "0001", X)]);
      writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [RULED] }) });
      assert.deepEqual(passes(w), [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)]);
    });

    // artifact-grammar.md, rulings file: a rulings-written record that does not parse is deleted, and the guard runs
    // without it.
    it("ask deletes a rulings-written record that does not parse and names the entry the run added", (t) => {
      const w = world(t);
      assert.equal(rounds(w, { verdict: DEPARTS_INSIDE, env: ruled(RULED) }).exit, 0);
      writeFileSync(writtenFile(w), "{");
      askGuards(w);
      assert.equal(existsSync(writtenFile(w)), false);
    });

    it("decide deletes a rulings-written record that does not parse and names the entry the run added", (t) => {
      const w = world(t);
      assert.equal(rounds(w, { verdict: DEPARTS_INSIDE, env: ruled(RULED) }).exit, 0);
      const { exit, lines } = stops(w, { verdict: DEPARTS_INSIDE, beforeDecide: () => writeFileSync(writtenFile(w), "{") });
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(lines.includes(GUARD_LINE), lines.join("\n"));
      assert.equal(existsSync(writtenFile(w)), false);
    });

    it("ask refuses a rulings file that does not parse, naming the spec folder's file to correct", (t) => {
      const w = world(t);
      writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: "{ rulings" });
      const { exit, lines } = askStops(w);
      assert.equal(exit, 1, lines.join("\n"));
      assert.equal(lines.length, 1, lines.join("\n"));
      assert.ok(
        lines[0].startsWith("FAIL: adr-rulings.json: ") && lines[0].endsWith(`. Next step: correct ${SPEC}/adr-rulings.json, then resume.`),
        lines[0],
      );
    });
  });

  // quickstart Planner: "asked record, `touches.json` or `tasks.md` changed between ask and decide"
  describe("what ask recorded, changed before decide", () => {
    const changedAfterAsk = (file: string, part: string) => (lines: readonly string[]) =>
      lines.some((line) => line.startsWith(`COULD_NOT_RUN: ${file}: changed after ask: `) && line.includes(part) && line.endsWith(CHECK_AGAIN));

    it("could not run when touches.json gained a path after ask, naming it", (t) => {
      const w = world(t);
      const { exit, lines } = stops(w, { beforeDecide: () => writeTouches(w, { v: 1, paths: [X, Y] }) });
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(changedAfterAsk("touches.json", `added ${Y}`)(lines), lines.join("\n"));
    });

    it("could not run when touches.json lost a path after ask, naming it", (t) => {
      const w = world(t);
      const { exit, lines } = stops(w, { touches: { v: 1, paths: [X, Y] }, beforeDecide: () => writeTouches(w, { v: 1, paths: [X] }) });
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(changedAfterAsk("touches.json", `removed ${Y}`)(lines), lines.join("\n"));
    });

    // A file that no longer reads is named by why, never as every path it held removed.
    for (const [what, change, why] of [
      ["removed", (w: World) => rmSync(join(w.run, "touches.json")), "the file is missing"],
      ["emptied", (w: World) => writeTouches(w, { v: 1, paths: [] }), "the file has no path"],
    ] as const) {
      it(`could not run when touches.json was ${what} after ask, naming why it no longer reads`, (t) => {
        const w = world(t);
        const { exit, lines } = stops(w, { beforeDecide: () => change(w) });
        assert.deepEqual({ exit, lines }, { exit: 2, lines: [couldNotRunLine("touches.json", `changed after ask: ${why}`)] });
      });
    }

    it("could not run when touches.json gained a path it refuses after ask, naming the refusal", (t) => {
      const w = world(t);
      const { exit, lines } = stops(w, { beforeDecide: () => writeTouches(w, { v: 1, paths: [X, "core/src/{a,b}.ts"] }) });
      assert.equal(exit, 2, lines.join("\n"));
      assert.equal(lines.length, 1, lines.join("\n"));
      assert.ok(changedAfterAsk("touches.json", "core/src/{a,b}.ts")(lines), lines[0]);
      assert.ok(lines[0].includes("a glob or brace group names files the check cannot list"), lines[0]);
      assert.ok(!lines[0].includes("removed"), lines[0]);
    });

    it("decide records tasks.md gaining a span it refuses after ask by the refusal, not as its paths removed", (t) => {
      const w = world(t);
      runRound(w, { beforeDecide: () => writeTasks(w, tasksMd({ us2: "Print the lines from `core/src/{a,b}.ts`" })) });
      const record = stopRecord(w);
      assert.equal(record.exit, 2, JSON.stringify(record));
      assert.equal(record.lines.length, 1, JSON.stringify(record));
      const [line] = record.lines;
      assert.ok(line.startsWith("COULD_NOT_RUN: tasks.md: changed after ask: tasks.md:") && line.endsWith(CHECK_AGAIN), line);
      assert.ok(line.includes("core/src/{a,b}.ts: a glob or brace group names files the check cannot list"), line);
      assert.ok(!line.includes("removed"), line);
    });

    it("decide records tasks.md gaining a task path after ask, naming it, and report asks for a new round", (t) => {
      const w = world(t);
      runRound(w, { beforeDecide: () => writeTasks(w, tasksMd({ us2: `Print the lines from \`${Y}\`` })) });
      const record = stopRecord(w);
      assert.equal(record.exit, 2, JSON.stringify(record));
      assert.ok(changedAfterAsk("tasks.md", `added ${Y}`)(record.lines), JSON.stringify(record));
      assert.equal(again(report(w)), true);
      assert.deepEqual(stopRecord(w), record);
    });

    it("could not run when the asked record's bytes are not those ask printed the digest of", (t) => {
      const w = world(t);
      const { exit, lines } = stops(w, { beforeDecide: () => appendFileSync(askedFile(w), "\n") });
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(lines.includes(couldNotRunLine("adr-asked.json", "changed after ask")), lines.join("\n"));
    });
  });

  // quickstart Planner: "`plan.md` or `spec.md` changed after `clear`"
  for (const file of ["plan.md", "spec.md"]) {
    it(`ask records touches-stale when ${file} changed after clear, before the round hashed it`, (t) => {
      const w = world(t);
      const changed = () => appendFileSync(join(w.spec, file), "\nA line the touches step did not read.\n");
      assert.deepEqual(askStops(w, { afterClear: changed }), { exit: 2, lines: [TOUCHES_STALE_LINE], unanswered: false });
    });
  }

  describe("settings or git that cannot be read", () => {
    it("could not run on an adr_folders that is not a list, asking adr nothing", (t) => {
      const w = world(t);
      adrFoldersNotAList(w);
      runRound(w);
      const { exit, lines, stdout } = report(w);
      assert.equal(exit, 2, lines.join("\n"));
      assert.equal(stdout, "");
      assert.equal(lines.length, 1, lines.join("\n"));
      assert.ok(lines[0].startsWith("COULD_NOT_RUN: codeworks.toml: ") && lines[0].includes("adr_folders"), lines[0]);
      assert.ok(lines[0].endsWith(SETTINGS_NEXT), lines[0]);
      assert.deepEqual(adrCalls(w), []);
    });

    it("ask records a git stop when run from no git checkout", (t) => {
      const dir = away(t);
      const ran = script(dir, ["ask", SPEC, RUN, ANSWERED], { GIT_CEILING_DIRECTORIES: dirname(dir) });
      assert.deepEqual({ exit: ran.exit, lines: ran.lines }, { exit: 0, lines: [] });
      assert.deepEqual(JSON.parse(ran.stdout), { judge: false, decide: false, asked: "" });
      const record = readJson(join(dir, RUN, "adr-stop.json")) as StopRecord;
      assert.equal(record.exit, 2);
      assert.equal(record.lines.length, 1, JSON.stringify(record));
      assert.ok(record.lines[0].startsWith("COULD_NOT_RUN: git: ") && record.lines[0].includes("not a git repository"), record.lines[0]);
      assert.ok(record.lines[0].endsWith(GIT_NEXT), record.lines[0]);
    });
  });
});

describe("adr_check.ts, the paths a round asks about", () => {
  // quickstart Planner: "`tasks.md` task `[US2]` and a `## Phase 4: …` task name one governed path" (US3 AS2); T031
  it("stops on a departure on a path a [US2] task and a phase task name, naming both stories", (t) => {
    const w = world(t);
    const tasks = tasksMd({ us1: "Read the folders", us2: `Print the lines from \`${X}\``, polish: `Tidy \`${X}\`` });
    assert.deepEqual(stops(w, { touches: { v: 1, paths: [UNGOVERNED] }, tasks, verdict: DEPARTS_INSIDE }), {
      exit: 1,
      lines: [departsInsideLine("0004", X, ["US2", "Phase 4: Polish"]), governedLine(OUTSIDE, R0001)],
      unanswered: false,
    });
  });

  // T031: a path both `touches.json` and a task name → one entry per artifact
  it("asks one entry per artifact for a path both touches.json and a task name", (t) => {
    const w = world(t);
    runRound(w);
    const { paths } = readJson(askedFile(w)) as { paths: { path: string; artifact: string }[] };
    assert.deepEqual(paths.filter(({ path }) => path === X).map(({ artifact }) => artifact).sort(), ["plan", "tasks"]);
  });

  // quickstart Planner: "`tasks.md` task names `` `codeworks.toml` `` (root file) / `` `adr check` `` / a URL"
  it("asks a tracked root file a task names, and neither a command nor a URL", (t) => {
    const w = world(t);
    const tasks = tasksMd({ us1: `Read the folders in \`${X}\` and \`codeworks.toml\`, run \`adr check\`, see \`https://example.com/a/b.md\`` });
    runRound(w, { tasks });
    const { paths } = readJson(askedFile(w)) as { paths: { artifact: string }[] };
    const line = lineOf(tasks, "codeworks.toml");
    assert.deepEqual(
      sortedJson(paths.filter(({ artifact }) => artifact === "tasks")),
      sortedJson([
        { path: X, artifact: "tasks", line, story: "US1" },
        { path: "codeworks.toml", artifact: "tasks", line, story: "US1" },
      ]),
    );
  });

  // quickstart Planner: "`tasks.md` task names `` `new.toml` ``, untracked, listed in `touches.json`"
  it("asks an untracked root file a task names when touches.json lists it, and not one it does not", (t) => {
    const w = world(t);
    const tasks = tasksMd({ us1: `Write \`${X}\`, \`new.toml\` and \`other.toml\`` });
    runRound(w, { touches: { v: 1, paths: [X, "new.toml"] }, tasks });
    const { paths } = readJson(askedFile(w)) as { paths: { path: string; artifact: string }[] };
    assert.deepEqual(
      paths
        .filter(({ artifact }) => artifact === "tasks")
        .map(({ path }) => path)
        .sort(),
      [X, "new.toml"].sort(),
    );
  });

  // quickstart Planner: "`tasks.md` task names `` `a/{b,c}.ts` `` or `` `a/*.ts` ``"
  for (const span of ["a/{b,c}.ts", "a/*.ts"]) {
    it(`stops on a task naming ${span}, naming tasks.md's line and the span, the next step deleting tasks.md`, (t) => {
      const w = world(t);
      const tasks = tasksMd({ us2: `Print the lines from \`${span}\`` });
      const { exit, lines } = stops(w, { tasks });
      assert.equal(exit, 1, lines.join("\n"));
      assert.equal(lines.length, 1, lines.join("\n"));
      assert.ok(lines[0].startsWith(`FAIL: tasks.md:${lineOf(tasks, span)}: `) && lines[0].includes(span), lines[0]);
      assert.ok(lines[0].endsWith(TASKS_REFUSED_NEXT), lines[0]);
    });
  }

  // quickstart Planner: "a task line above every `## ` heading"
  it("stops on a task line above every phase heading, naming its line", (t) => {
    const w = world(t);
    const tasks = tasksMd({ above: `- [ ] T000 Prepare \`${X}\`\n\n` });
    const { exit, lines } = stops(w, { tasks });
    assert.equal(exit, 1, lines.join("\n"));
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.ok(lines[0].startsWith(`FAIL: tasks.md:${lineOf(tasks, "T000")}: `) && lines[0].endsWith(TASKS_REFUSED_NEXT), lines[0]);
  });

  // quickstart Planner: "`touches.json` missing or `paths` empty, or `tasks.md` names no path"
  for (const [what, touches, why] of [
    ["missing", null, "the file is missing"],
    ["with no path", { v: 1, paths: [] }, "the file has no path"],
  ] as const) {
    it(`ask records touches-missing on a touches.json ${what}, asking adr nothing`, (t) => {
      const w = world(t);
      const { exit, lines, unanswered } = askStops(w, { touches, beforeAsk: forgetCalls(w) });
      assert.equal(exit, 2, lines.join("\n"));
      assert.deepEqual(lines, [couldNotRunLine("touches.json", why)]);
      assert.equal(unanswered, true);
      assert.deepEqual(adrCalls(w), []);
    });
  }

  it("ask records tasks-empty on a tasks.md that names no path, the next step deleting it", (t) => {
    const w = world(t);
    assert.deepEqual(askStops(w, { tasks: tasksMd({ us1: "Read the folders" }) }), {
      exit: 2,
      lines: [TASKS_EMPTY_LINE],
      unanswered: false,
    });
  });

  // quickstart Planner: "`touches.json` unparsable, an extra key, an entry not a `PATH`, or an entry twice". The stop
  // table's touches-refused row is COULD_NOT_RUN: the touches step writes the file again in the next round.
  for (const [what, touches, why] of [
    ["unparsable", "{ paths", "not JSON: "],
    ["with an extra key", { v: 1, paths: [X], artifact: "plan" }, 'Unrecognized key: "artifact"'],
    ["with an entry that is not a PATH", { v: 1, paths: ["core/src/*.ts"] }, "a glob or brace group names files the check cannot list"],
    ["with an entry twice", { v: 1, paths: [X, X] }, "is listed more than once"],
  ] as const) {
    it(`ask records touches-refused on a touches.json ${what}, naming it`, (t) => {
      const w = world(t);
      const { exit, lines, unanswered } = askStops(w, { touches, beforeAsk: forgetCalls(w) });
      assert.equal(exit, 2, lines.join("\n"));
      assert.equal(lines.length, 1, lines.join("\n"));
      assert.ok(lines[0].startsWith("COULD_NOT_RUN: touches.json: ") && lines[0].endsWith(CHECK_AGAIN), lines[0]);
      assert.ok(lines[0].includes(why), lines[0]);
      assert.equal(unanswered, false);
      assert.deepEqual(adrCalls(w), []);
    });
  }

  // quickstart Planner: "`ask` with touches exit code `1`, empty, or `00`, and a valid `touches.json`"
  for (const touchesExit of NOT_ANSWERED) {
    it(`ask records touches-missing on a touches exit code ${JSON.stringify(touchesExit)}, beside a valid touches.json`, (t) => {
      const w = world(t);
      const { exit, lines, unanswered } = askStops(w, { touchesExit, beforeAsk: forgetCalls(w) });
      assert.equal(exit, 2, lines.join("\n"));
      assert.deepEqual(lines, [couldNotRunLine("touches.json", "the touches step did not answer (its exit code not 0)")]);
      assert.equal(unanswered, true);
      assert.deepEqual(adrCalls(w), []);
    });
  }

  // quickstart Planner: "`adr_folders = []`, with or without `touches.json`". ask reads the list before the paths, so
  // the touches step's outcome does not matter: whatever its exit code, whatever file it left.
  const EMPTY_LIST_ROUNDS: [string, Round][] = [
    ["a touches.json", {}],
    ["no touches.json", { touches: null }],
    ["a touches.json it would refuse", { touches: "not json" }],
    ...NOT_ANSWERED.map((touchesExit): [string, Round] => [`a touches exit code ${JSON.stringify(touchesExit)}`, { touchesExit }]),
    ['a touches exit code "-1" and no touches.json', { touchesExit: "-1", touches: null }],
  ];
  for (const [what, round] of EMPTY_LIST_ROUNDS) {
    it(`passes an empty adr_folders with ${what}, reading no path and asking adr nothing`, (t) => {
      const w = world(t, []);
      const { asked, decided } = runRound(w, round);
      assert.equal(asked.judge, false);
      assert.equal(asked.decide, true);
      assert.deepEqual(readJson(askedFile(w)), { v: 1, paths: [], folders: [] });
      assert.equal(existsSync(stopFile(w)), false);
      assert.deepEqual(decided?.lines, [PASS_EMPTY]);
      assert.equal(again(report(w)), false);
      assert.deepEqual(adrCalls(w), []);
    });
  }
});

describe("adr_check.ts clear", () => {
  const ROUND_FILES = ["adr-steps", "touches.json", "adr-inputs.json", "adr-asked.json", "adr-verdict.json", "adr-stop.json"];

  // quickstart Planner: "`clear` with every round file and done record left from the last round"
  it("deletes every round file and done record the last round left, keeping tasks-sources.json, and writes touches-from.json", (t) => {
    const w = world(t);
    assert.equal(stops(w, { verdict: DEPARTS_INSIDE }).exit, 1);
    for (const file of ROUND_FILES) assert.ok(existsSync(join(w.run, file)), `the round left no ${file}`);
    assert.ok(existsSync(join(w.run, "tasks-sources.json")), "the round left no tasks-sources.json");
    appendFileSync(join(w.spec, "plan.md"), "\nChanged before the resume.\n");
    clear(w);
    for (const file of ROUND_FILES) assert.equal(existsSync(join(w.run, file)), false, `clear left ${file}`);
    assert.ok(existsSync(join(w.run, "tasks-sources.json")), "clear deleted tasks-sources.json");
    assert.deepEqual(readJson(join(w.run, "touches-from.json")), {
      v: 1,
      files: {
        [`${SPEC}/plan.md`]: sha256(readFileSync(join(w.spec, "plan.md"))),
        [`${SPEC}/spec.md`]: sha256(readFileSync(join(w.spec, "spec.md"))),
      },
    });
  });

  it("deletes a stop record left in the run folder before the round, so the round passes", (t) => {
    const w = world(t);
    writeFileSync(stopFile(w), JSON.stringify({ v: 1, exit: 1, lines: [departsInsideLine("0004", X)], shown: false, unanswered: false }));
    assert.deepEqual(passes(w), [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)]);
  });
});

describe("adr_check.ts tasks-due and tasks-written", () => {
  const sources = (w: World) => join(w.run, "tasks-sources.json");
  const nextSources = (w: World) => join(w.run, "tasks-sources-next.json");

  // quickstart Planner: "`tasks-due`: no `tasks.md` / no `tasks-sources.json` / a source changed / none changed"
  it("is due with no tasks.md, deleting tasks-sources.json", (t) => {
    const w = world(t);
    passes(w);
    rmSync(join(w.spec, "tasks.md"));
    clear(w);
    assert.equal(existsSync(sources(w)), true);
    assert.equal(tasksDue(w), true);
    assert.equal(existsSync(sources(w)), false);
  });

  it("is due with no tasks-sources.json, writing tasks-sources-next.json", (t) => {
    const w = world(t);
    writeTasks(w, TASKS);
    clear(w);
    assert.equal(tasksDue(w), true);
    assert.ok(existsSync(nextSources(w)));
    assert.deepEqual(readJson(doneFile(w, "tasks-due")), { v: 1, step: "tasks-due", due: true });
  });

  for (const [what, change] of [
    ["plan.md", (w: World) => appendFileSync(join(w.spec, "plan.md"), "\nOne more line.\n")],
    ["research.md", (w: World) => appendFileSync(join(w.spec, "research.md"), "\nOne more finding.\n")],
    ["a new contract", (w: World) => writeFiles(w.spec, { "contracts/api.md": "# API\n" })],
    ["the constitution", (w: World) => appendFileSync(join(w.checkout, ".specify/memory/constitution.md"), "\nOne more rule.\n")],
  ] as const) {
    it(`is due once ${what} changed, deleting tasks-sources.json`, (t) => {
      const w = world(t);
      passes(w);
      change(w);
      clear(w);
      assert.equal(existsSync(sources(w)), true);
      assert.equal(tasksDue(w), true);
      assert.equal(existsSync(sources(w)), false);
    });
  }

  it("is not due when no source changed, keeping tasks-sources.json", (t) => {
    const w = world(t);
    passes(w);
    const before = readFileSync(sources(w));
    clear(w);
    assert.equal(tasksDue(w), false);
    assert.deepEqual(readFileSync(sources(w)), before);
    assert.deepEqual(readJson(doneFile(w, "tasks-due")), { v: 1, step: "tasks-due", due: false });
  });

  // quickstart Planner: "`tasks-written` with tasks exit code `0`"
  it("tasks-written renames tasks-sources-next.json to tasks-sources.json and writes its done record", (t) => {
    const w = world(t);
    clear(w);
    assert.equal(tasksDue(w), true);
    const next = readFileSync(nextSources(w));
    writeTasks(w, TASKS);
    tasksWritten(w, ANSWERED);
    assert.equal(existsSync(nextSources(w)), false);
    assert.deepEqual(readFileSync(sources(w)), next);
    assert.deepEqual(readJson(doneFile(w, "tasks-written")), { v: 1, step: "tasks-written" });
    assert.equal(existsSync(stopFile(w)), false);
  });

  // quickstart Planner: "`tasks-written` with tasks exit code `1`, empty or `-1`"
  for (const tasksExit of ["1", "", "-1"]) {
    it(`tasks-written records tasks-unfinished on a tasks exit code ${JSON.stringify(tasksExit)}, renaming nothing`, (t) => {
      const w = world(t);
      clear(w);
      assert.equal(tasksDue(w), true);
      writeTasks(w, TASKS);
      tasksWritten(w, tasksExit);
      assert.ok(existsSync(nextSources(w)));
      assert.equal(existsSync(sources(w)), false);
      assert.deepEqual(readJson(doneFile(w, "tasks-written")), { v: 1, step: "tasks-written" });
      const record = stopRecord(w);
      assert.deepEqual({ ...record, lines: [] }, { v: 1, exit: 2, lines: [], shown: false, unanswered: true });
      assert.equal(record.lines.length, 1, JSON.stringify(record));
      assert.ok(
        record.lines[0].startsWith("COULD_NOT_RUN: tasks.md: the tasks command did not answer") && record.lines[0].endsWith(CHECK_AGAIN),
        record.lines[0],
      );
    });
  }

  // quickstart Planner: "`tasks-written` with neither hash file"
  it("tasks-written fails with neither hash file, writing no done record", (t) => {
    const w = world(t);
    clear(w);
    writeTasks(w, TASKS);
    assert.equal(existsSync(nextSources(w)) || existsSync(sources(w)), false);
    const ran = adrCheck(w, ["tasks-written", RUN, ANSWERED]);
    assert.notEqual(ran.exit, 0);
    assert.ok(ran.lines.some((line) => line.includes("ENOENT") && line.includes("tasks-sources-next.json")), ran.lines.join("\n"));
    assert.equal(existsSync(doneFile(w, "tasks-written")), false);
  });

  // quickstart Planner: "`tasks.md` deleted, the tasks command writes part of it and fails, then a resume" and
  // "`stories` after that, the partial `tasks.md` breaking the story plan"
  it("shows tasks-unfinished when the tasks command fails after writing part of tasks.md, and the resume writes tasks.md again", (t) => {
    const w = world(t);
    passes(w);
    rmSync(join(w.spec, "tasks.md"));
    const partial = "# Tasks: demo\n\n## Phase 3: User Story 2 - Report the check (Priority: P2)\n\n- [ ] T003 [US2] Print\n";
    const { due, asked } = runRound(w, { tasks: partial, tasksExit: "1", beforeAsk: forgetCalls(w) });
    assert.equal(due, true);
    assert.equal(asked.decide, false);
    assert.ok(existsSync(join(w.run, "adr-inputs.json")), "stories wrote no adr-inputs.json");
    assert.deepEqual(adrCalls(w), []);
    const { exit, lines, unanswered } = shown(w);
    assert.equal(exit, 2, lines.join("\n"));
    assert.equal(unanswered, true);
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.ok(lines[0].startsWith("COULD_NOT_RUN: tasks.md: the tasks command did not answer"), lines[0]);
    // No tasks-sources.json: the resume's first round is due.
    assert.equal(existsSync(sources(w)), false);
    assert.deepEqual(resume(w, { tasks: TASKS }), {
      rounds: 1,
      exit: 0,
      lines: [governedLine(INSIDE, R0004), governedLine(OUTSIDE, R0001)],
    });
    assert.equal(readFileSync(join(w.spec, "tasks.md"), "utf8"), TASKS);
  });
});

/** A reply from the stand-in GitHub. */
function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const REPO_URL = "https://api.github.com/repos/acme/widgets";
const subIssue = (number: number, repo = "acme/widgets") => ({
  id: 9000 + number,
  number,
  title: `US: #${number}`,
  repository_url: `https://api.github.com/repos/${repo}`,
});

/** A GitHub answering acme/widgets and #7's sub-issues as `subIssues` does, anything else 404, logging each request
 *  as `<method> <path>` in `requests`. */
async function standInGitHub(t: TestContext, subIssues: (res: ServerResponse) => void, requests: string[]): Promise<string> {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://stand-in");
    requests.push(`${req.method} ${pathname}`);
    if (req.method === "GET" && pathname === "/repos/acme/widgets") reply(res, 200, { full_name: "acme/widgets", url: REPO_URL, default_branch: "main" });
    else if (req.method === "GET" && pathname === `/repos/acme/widgets/issues/${ISSUE}/sub_issues`) subIssues(res);
    else reply(res, 404, { message: "Not Found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The script with core's GitHub client sent to `api`; run apart from this process, whose server answers it. */
function scriptReachingGitHub(w: World, args: string[], api: string): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", GITHUB_AT, SCRIPT, ...args], {
      cwd: w.checkout,
      env: environment(`${w.bin}${delimiter}${PATH}`, { PLANNER_TEST_GITHUB_API: api }),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ exit: status, lines: stderr.split("\n").filter((line) => line !== ""), stdout }));
  });
}

async function roundReachingGitHub(
  t: TestContext,
  w: World,
  kind: string,
  subIssues: (res: ServerResponse) => void,
  { tasks = TASKS, requests = [] }: { tasks?: string; requests?: string[] } = {},
): Promise<void> {
  storeToken(60);
  const api = await standInGitHub(t, subIssues, requests);
  clear(w);
  writeTouches(w, { v: 1, paths: [X] });
  if (tasksDue(w)) {
    writeTasks(w, tasks);
    tasksWritten(w, ANSWERED);
  }
  quiet(await scriptReachingGitHub(w, ["stories", ISSUE, kind, SPEC, RUN], api), "stories");
  const asked = asking(w, ANSWERED);
  if (asked.judge) writeVerdict(w, withinAll(w));
  if (asked.decide) assert.equal(decide(w, asked.asked, ANSWERED).exit, 0);
}

const answering = (...issues: ReturnType<typeof subIssue>[]) => (res: ServerResponse) => reply(res, 200, issues);

describe("adr_check.ts stories", () => {
  // quickstart Planner: "`stories`: `tasks.md` breaking the story plan or a task-block label"
  for (const [what, tasks] of [
    ["no story tag", tasksMd().replaceAll(/\[US\d\] /g, "")],
    ["two stories in one phase", tasksMd({ us2: "[US1] Print the lines" })],
    ["a story with no task before one with tasks", tasksMd().replace("[US1] ", "")],
    ["a task-block label that names no issue", tasksMd().replace("## Phase 1: Setup\n", "## Phase 1: Setup\nStory issue: #x\n")],
  ] as const) {
    it(`records tasks-refused on a tasks.md with ${what}, the next step deleting tasks.md`, (t) => {
      const w = world(t);
      const { exit, lines } = stops(w, { tasks, beforeAsk: forgetCalls(w) });
      assert.equal(exit, 1, lines.join("\n"));
      assert.equal(lines.length, 1, lines.join("\n"));
      assert.match(lines[0], /^FAIL: tasks\.md(:\d+)?: /);
      assert.ok(lines[0].endsWith(TASKS_REFUSED_NEXT), lines[0]);
      // quickstart Planner: "`stories` stop recorded, then `ask`" — ask reads nothing.
      assert.deepEqual(adrCalls(w), []);
    });
  }

  it("writes adr-inputs.json in a round whose tasks.md it refuses", (t) => {
    const w = world(t);
    runRound(w, { tasks: tasksMd().replaceAll(/\[US\d\] /g, "") });
    assert.match(stopRecord(w).lines[0], /^FAIL: tasks\.md/);
    assert.ok(existsSync(join(w.run, "adr-inputs.json")), "stories wrote no adr-inputs.json");
  });

  // quickstart Planner: "`stories` on a `new` run: extra, foreign or out-of-order sub-issues / the same on a `rescope`"
  it("on a new run, records sub-issues-extra for more sub-issues than stories", async (t) => {
    const w = world(t);
    await roundReachingGitHub(t, w, NEW, answering(subIssue(101), subIssue(102), subIssue(103)));
    assert.deepEqual(shown(w), {
      exit: 1,
      lines: [
        "FAIL: #7: 3 sub-issues for 2 stories; the extra: #103. Next step: remove them from #7's sub-issues, or add their " +
          "stories to spec.md, then resume.",
      ],
      unanswered: false,
    });
  });

  it("on a new run, records sub-issues-foreign for a sub-issue in another repository", async (t) => {
    const w = world(t);
    await roundReachingGitHub(t, w, NEW, answering(subIssue(101), subIssue(102, "acme/gadgets")));
    assert.deepEqual(shown(w), {
      exit: 1,
      lines: ["FAIL: #7: sub-issue acme/gadgets#102 is in another repository. Next step: remove it from #7's sub-issues, then resume."],
      unanswered: false,
    });
  });

  it("on a new run, records sub-issues-misplaced for a sub-issue out of story order", async (t) => {
    const w = world(t);
    const labelled = TASKS.replace("(Priority: P1)\n", "(Priority: P1)\nStory issue: #101\n").replace(
      "(Priority: P2)\n",
      "(Priority: P2)\nStory issue: #102\n",
    );
    await roundReachingGitHub(t, w, NEW, answering(subIssue(101), subIssue(120)), { tasks: labelled });
    assert.deepEqual(shown(w), {
      exit: 1,
      lines: [
        "FAIL: #7: sub-issue 2 is #120, but tasks.md labels US2 with #102. Next step: order #7's sub-issues so sub-issue 2 is " +
          "US2's issue, then resume.",
      ],
      unanswered: false,
    });
  });

  it("on a new run with no sub-issue yet, reads #7's sub-issues and records no stop", async (t) => {
    const w = world(t);
    const requests: string[] = [];
    await roundReachingGitHub(t, w, NEW, answering(), { requests });
    assert.ok(requests.includes(`GET /repos/acme/widgets/issues/${ISSUE}/sub_issues`), requests.join("\n"));
    assert.equal(existsSync(stopFile(w)), false);
    assert.equal(again(report(w)), false);
  });

  // A rescope's sub-issues are its existing stories, which its new tasks.md may drop or reorder (#178).
  it("on a rescope, checks no sub-issue and asks GitHub nothing", async (t) => {
    const w = world(t);
    const requests: string[] = [];
    await roundReachingGitHub(t, w, RESCOPE, answering(subIssue(101), subIssue(102), subIssue(103)), { requests });
    assert.equal(existsSync(stopFile(w)), false);
    assert.equal(again(report(w)), false);
    assert.deepEqual(requests, []);
  });

  // quickstart Planner: "`stories`: GitHub unanswered"
  it("on a new run, records a github stop when GitHub does not answer", async (t) => {
    const w = world(t);
    await roundReachingGitHub(t, w, NEW, (res) => reply(res, 502, { message: "Bad Gateway" }));
    const { exit, lines } = shown(w);
    assert.equal(exit, 2, lines.join("\n"));
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.ok(lines[0].startsWith("COULD_NOT_RUN: GitHub: ") && lines[0].endsWith(CHECK_AGAIN), lines[0]);
  });
});

describe("adr_check.ts report", () => {
  const LINES = [departsInsideLine("0004", X, ["US1"]), governedLine(OUTSIDE, R0001)];
  const writeStop = (w: World, record: unknown) => writeFileSync(stopFile(w), typeof record === "string" ? record : JSON.stringify(record));

  // quickstart Planner: "`report`, stop record `shown: false`"
  for (const exit of [1, 2]) {
    it(`shows a stop not yet shown: its lines on stderr, exit ${exit}, the record rewritten shown`, (t) => {
      const w = world(t);
      passes(w);
      writeStop(w, { v: 1, exit, lines: LINES, shown: false, unanswered: false });
      assert.deepEqual(shown(w), { exit, lines: LINES, unanswered: false });
    });
  }

  // quickstart Planner: "`report`, stop record `shown: true`"
  it("on the resume after a stop, keeps the record and asks for a new round, whose clear deletes it", (t) => {
    const w = world(t);
    assert.equal(stops(w, { verdict: DEPARTS_INSIDE }).exit, 1);
    const record = readFileSync(stopFile(w));
    assert.equal(again(report(w)), true);
    assert.deepEqual(readFileSync(stopFile(w)), record);
    clear(w);
    assert.equal(existsSync(stopFile(w)), false);
  });

  // quickstart Planner: "`report`, no stop record"
  it("with no stop record, ends the loop", (t) => {
    const w = world(t);
    passes(w);
    assert.equal(again(report(w)), false);
  });

  // quickstart Planner: "`report`, stop record that does not parse"
  for (const [what, record] of [
    ["not JSON", '{"v": 1, "exit": '],
    ["with an exit of 0", { v: 1, exit: 0, lines: LINES, shown: false, unanswered: false }],
    ["with no line", { v: 1, exit: 1, lines: [], shown: false, unanswered: false }],
    ["with no unanswered", { v: 1, exit: 1, lines: LINES, shown: false }],
  ] as const) {
    it(`could not run on a stop record ${what}, writing it valid and shown so the resume asks for a new round`, (t) => {
      const w = world(t);
      passes(w);
      writeStop(w, record);
      assert.deepEqual(report(w), { exit: 2, lines: [STOP_UNREAD_LINE], stdout: "" });
      assert.deepEqual(readJson(stopFile(w)), { v: 1, exit: 2, lines: [STOP_UNREAD_LINE], shown: true, unanswered: false });
      assert.equal(again(report(w)), true);
    });
  }

  // A stop record that does not parse is neither shown nor unanswered: report shows it only where it shows a stop.
  const UNPARSABLE = '{"v": 1, "exit": ';

  it("asks for a new round, showing nothing, on a stop record that does not parse once plan.md changed after stories", (t) => {
    const w = world(t);
    runRound(w);
    writeStop(w, UNPARSABLE);
    appendFileSync(join(w.spec, "plan.md"), "\nOne more line.\n");
    assert.equal(again(report(w)), true);
    assert.equal(readFileSync(stopFile(w), "utf8"), UNPARSABLE);
  });

  it("could not run naming the step that did not finish, not the stop record that does not parse", (t) => {
    const w = world(t);
    runRound(w);
    writeStop(w, UNPARSABLE);
    rmSync(doneFile(w, "stories"));
    const line = stepUnfinishedLine("adr-stories");
    assert.deepEqual(report(w), { exit: 2, lines: [line], stdout: "" });
    assert.deepEqual(readJson(stopFile(w)), { v: 1, exit: 2, lines: [line], shown: true, unanswered: false });
  });

  // quickstart Planner: "`report`, every done record present, a file of `adr-inputs.json` changed (`plan.md`, a tasks
  // source, `tasks.md`, the rulings file, `review-questions.json`, `codeworks.toml`, a listed folder's file), stop record
  // `shown: false` / no stop record / `adr-inputs.json` not reading / a tasks source differing from
  // `tasks-sources.json`"
  const CHANGES: [string, (w: World) => void][] = [
    ["plan.md", (w) => appendFileSync(join(w.spec, "plan.md"), "\nOne more line.\n")],
    ["a tasks source", (w) => appendFileSync(join(w.spec, "research.md"), "\nOne more finding.\n")],
    ["tasks.md", (w) => appendFileSync(join(w.spec, "tasks.md"), "\n")],
    ["the rulings file", (w) => writeFiles(w.checkout, { [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [] }) })],
    ["review-questions.json", (w) => writeFileSync(join(w.run, "review-questions.json"), JSON.stringify({ v: 1, questions: [] }))],
    ["codeworks.toml", (w) => appendFileSync(join(w.checkout, "codeworks.toml"), "# one more comment\n")],
    ["a listed folder's file", (w) => writeFileSync(join(w.checkout, INSIDE, "0009-new.md"), "# ADR-0009\n")],
    ["a file of the listed folder outside the repo", (w) => writeFileSync(join(w.outside, "0002-org.md"), "# ADR-0002\n")],
    ["adr-inputs.json, so it does not read", (w) => writeFileSync(join(w.run, "adr-inputs.json"), "{")],
    [
      "tasks-sources.json, so a tasks source differs from it",
      (w) => writeFileSync(join(w.run, "tasks-sources.json"), JSON.stringify({ v: 1, files: { [`${SPEC}/plan.md`]: "0".repeat(64) } })),
    ],
  ];

  for (const [what, change] of CHANGES) {
    it(`asks for a new round, showing nothing and keeping the stop record, once ${what} changed after stories`, (t) => {
      const w = world(t);
      runRound(w, { verdict: DEPARTS_INSIDE });
      const record = readFileSync(stopFile(w));
      change(w);
      assert.equal(again(report(w)), true);
      assert.deepEqual(readFileSync(stopFile(w)), record);
    });

    it(`asks for a new round with no stop record, once ${what} changed after stories`, (t) => {
      const w = world(t);
      runRound(w);
      assert.equal(existsSync(stopFile(w)), false);
      change(w);
      assert.equal(again(report(w)), true);
    });
  }

  // quickstart Planner: "`report`, the done record of tasks-due, stories or ask missing; of tasks-written with
  // tasks-due's `due`; of decide with ask's `decide`"
  for (const step of ["tasks-due", "tasks-written", "stories", "ask", "decide"]) {
    it(`could not run when ${step}'s done record is missing, even with plan.md changed`, (t) => {
      const w = world(t);
      const { due, asked } = runRound(w);
      assert.equal(due, true);
      assert.equal(asked.decide, true);
      rmSync(doneFile(w, step));
      appendFileSync(join(w.spec, "plan.md"), "\nOne more line.\n");
      const line = stepUnfinishedLine(`adr-${step}`);
      assert.deepEqual(report(w), { exit: 2, lines: [line], stdout: "" });
      assert.deepEqual(readJson(stopFile(w)), { v: 1, exit: 2, lines: [line], shown: true, unanswered: false });
    });
  }

  it("names every step whose done record is missing in one line", (t) => {
    const w = world(t);
    runRound(w);
    rmSync(doneFile(w, "stories"));
    rmSync(doneFile(w, "decide"));
    assert.deepEqual(report(w), { exit: 2, lines: [stepUnfinishedLine("adr-stories", "adr-decide")], stdout: "" });
  });

  // quickstart Planner: "`report`, tasks-written's record missing with `due` false, or decide's with `decide` false"
  it("expects no tasks-written record from a round that was not due", (t) => {
    const w = world(t);
    passes(w);
    const { due } = runRound(w);
    assert.equal(due, false);
    assert.equal(existsSync(doneFile(w, "tasks-written")), false);
    assert.equal(again(report(w)), false);
  });

  it("expects no decide record from a round whose ask decided nothing, showing ask's stop", (t) => {
    const w = world(t);
    const { exit, lines } = askStops(w, { touches: { v: 1, paths: [X, X] } });
    assert.equal(existsSync(doneFile(w, "decide")), false);
    assert.equal(exit, 2, lines.join("\n"));
    assert.ok(lines[0].startsWith("COULD_NOT_RUN: touches.json: "), lines[0]);
  });

  // quickstart Planner: "`report`, stop record `unanswered: true`, a file of `adr-inputs.json` changed"
  for (const [what, change] of [
    ...CHANGES,
    ["every one of them", (w: World) => CHANGES.forEach(([, each]) => each(w))],
  ] as [string, (w: World) => void][]) {
    it(`shows the stop a touches step that did not answer left, once ${what} changed`, (t) => {
      const w = world(t);
      runRound(w, { touchesExit: "1" });
      assert.equal(stopRecord(w).unanswered, true);
      change(w);
      const { exit, lines } = shown(w);
      assert.equal(exit, 2, lines.join("\n"));
      assert.ok(lines[0].startsWith("COULD_NOT_RUN: touches.json: "), lines[0]);
    });
  }
});

describe("adr_check.ts stop rounds", () => {
  const roundsLine = (folder: string, startAgain: string): string =>
    `COULD_NOT_RUN: adr-check: the check ran 100 rounds in one run. Next step: discard the run's changes to ${folder}, then ` +
    `start again: ${startAgain}.`;

  /** The one line `stop rounds` prints run from `project`, a folder of a scratch checkout, as the workflow calls it:
   *  the spec folder from the project. */
  function rounded(t: TestContext, kind: string, project: string): string {
    const { checkout } = scratchCheckout(t);
    const cwd = join(checkout, project);
    mkdirSync(cwd, { recursive: true });
    const ran = script(cwd, ["stop", "rounds", kind, ISSUE, SPEC]);
    assert.deepEqual({ exit: ran.exit, stdout: ran.stdout, count: ran.lines.length }, { exit: 2, stdout: "", count: 1 }, ran.lines.join("\n"));
    assertNoTasksEdit(ran.lines);
    return ran.lines[0];
  }

  // quickstart Planner: "`stop rounds new <issue> <folder>` / `stop rounds rescope …`"; the skill's entry points take
  // the spec folder and `<dir>` from the checkout's top.
  for (const [where, project, folder, dir] of [
    ["at the checkout's top", ".", SPEC, ""],
    ["in a project below the checkout's top", "planner", `planner/${SPEC}`, " planner"],
  ] as const) {
    it(`sends a new run to remove the spec folder and run the spec again: ${where}`, (t) => {
      assert.equal(rounded(t, NEW, project), roundsLine(folder, `remove ${folder} and run /planner:issue-spec #${ISSUE}${dir}`));
    });

    it(`sends a rescope to restore the spec folder and run the rescope again: ${where}`, (t) => {
      assert.equal(
        rounded(t, RESCOPE, project),
        roundsLine(folder, `restore ${folder} to the branch's last commit and run /planner:issue-spec rescope ${folder} #${ISSUE}`),
      );
    });
  }

  it("could not run outside a git checkout, naming git", (t) => {
    const dir = away(t);
    const ran = script(dir, ["stop", "rounds", NEW, ISSUE, SPEC], { GIT_CEILING_DIRECTORIES: dirname(dir) });
    assert.equal(ran.exit, 2, ran.lines.join("\n"));
    assert.equal(ran.lines.length, 1, ran.lines.join("\n"));
    assert.ok(ran.lines[0].startsWith("COULD_NOT_RUN: git: ") && ran.lines[0].endsWith(GIT_NEXT), ran.lines[0]);
  });
});

// What the prompt steps are told to write is a copy of core's contracts: each example must read as that contract.
describe("the files the prompt steps are shown", () => {
  const WORKFLOW = fileURLToPath(new URL("../plugin/speckit/workflows/issue-spec/", import.meta.url));
  const example = (file: string): unknown => {
    const found = /```json\n([\s\S]*?)\n```/.exec(readFileSync(join(WORKFLOW, file), "utf8"));
    assert.ok(found, `${file} shows no json`);
    return JSON.parse(found[1]);
  };

  it("adr-judge.md's verdict is an AdrVerdict, with no artifact key", () => {
    const shownVerdict = example("adr-judge.md");
    assert.equal(Object.hasOwn(shownVerdict as object, "artifact"), false, JSON.stringify(shownVerdict));
    const parsed = AdrVerdict.safeParse(shownVerdict);
    assert.ok(parsed.success, parsed.error?.message);
  });

  it("adr-touches.md's touches.json reads as touched paths", () => {
    assert.notDeepEqual(readTouchedPaths(example("adr-touches.md")), []);
  });
});
