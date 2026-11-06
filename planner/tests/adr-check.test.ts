import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { fakeGitHub, type FakeGitHub } from "../../core/tests/support/fake-github.ts";

import type { AdrAsked, AdrRuling, AdrVerdict, ArtifactPath } from "../plugin/core/contracts/decision-check.ts";
import { ADR_INSTALL } from "../plugin/core/adr.ts";
import { couldNotRun } from "../plugin/core/outcomes.ts";
import { CheckOutcome } from "../plugin/core/values.ts";
import { GitHubUnanswered } from "../plugin/core/github.ts";
import { ADR_STOPS, adrStop, changedSince, decideCheck, decideFolder, roundsStop, type StopItem, type StopKind } from "../plugin/lib/adr-check.ts";
import { main } from "../plugin/scripts/adr_check.ts";
import { BOARD, fakeMint, LOGIN, output, scratchCheckout, storedToken, storeToken, tempHome, writeFiles, type Scratch } from "./support/checkout.ts";

const { PASS, FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;

type AskedFolder = AdrAsked["folders"][number];

const PLAN = (path: string, line = 1): ArtifactPath => ({ path, artifact: "plan", line, story: null });
const TASK = (path: string, line: number, story: string): ArtifactPath => ({ path, artifact: "tasks", line, story });

type Broken = { file: string; id?: string; rule: string; message: string }[];

function inside(governing: string[] = [], broken: Broken = []): AskedFolder {
  return { entry: "docs/adr", path: "/r/docs/adr", inside: true, governing: governing.map((recordId) => ({ recordId, title: `Title ${recordId}` })), broken };
}

function outside(governing: string[] = []): AskedFolder {
  return { entry: "../org/docs/adr", path: "/org/docs/adr", inside: false, governing: governing.map((recordId) => ({ recordId, title: `Title ${recordId}` })), broken: [] };
}

type Verdict = AdrVerdict["verdicts"][number];
const within = (record: string, folder = "docs/adr"): Verdict => ({ folder, record, judgment: "WITHIN", paths: [], why: "stays inside" });
const departs = (record: string, paths: string[], folder = "docs/adr"): Verdict => ({ folder, record, judgment: "DEPARTS", paths, why: "reads env" });
const ruling = (record: string, path: string, folder = "docs/adr"): AdrRuling => ({ folder, record, path, reason: "the user says so" });

describe("decideFolder", () => {
  const asked = [PLAN("core/src/x.ts"), TASK("core/src/x.ts", 40, "US2"), TASK("core/src/x.ts", 52, "Phase 4: Polish"), TASK("core/src/y.ts", 41, "US2")];

  it("passes a folder no record governs", () => {
    const outcome = decideFolder(inside(), [], asked, []);
    assert.equal(outcome.outcome, PASS);
    assert.deepEqual(outcome.departures, []);
  });

  it("passes a folder whose every governing record the verdict finds WITHIN", () => {
    assert.equal(decideFolder(inside(["0004", "0005"]), [within("0004"), within("0005")], asked, []).outcome, PASS);
  });

  it("fails a DEPARTS on a path, naming every story whose task names it", () => {
    const outcome = decideFolder(inside(["0004"]), [departs("0004", ["core/src/x.ts"])], asked, []);
    assert.equal(outcome.outcome, FAIL);
    assert.deepEqual(outcome.departures, [{ record: "0004", path: "core/src/x.ts", stories: ["US2", "Phase 4: Polish"], why: "reads env" }]);
  });

  it("drops a departure a ruling names by folder, record and path, whichever artifact named the path", () => {
    // x.ts the plan and a task name, y.ts only a task, z.ts only the plan.
    const named = [...asked, PLAN("core/src/z.ts")];
    const paths = ["core/src/x.ts", "core/src/y.ts", "core/src/z.ts"];
    const left = (rulings: AdrRuling[]) => decideFolder(inside(["0004"]), [departs("0004", paths)], named, rulings).departures.map((d) => d.path);
    for (const path of paths) assert.deepEqual(left([ruling("0004", path)]), paths.filter((one) => one !== path), path);
    assert.deepEqual(left([ruling("0005", "core/src/x.ts")]), paths, "a ruling on another record dropped a departure");
    const ruled = decideFolder(inside(["0004"]), [departs("0004", ["core/src/x.ts"])], asked, [ruling("0004", "core/src/x.ts")]);
    assert.equal(ruled.outcome, PASS);
  });

  it("does not drop a departure for a ruling on another folder", () => {
    const outcome = decideFolder(inside(["0004"]), [departs("0004", ["core/src/x.ts"])], asked, [ruling("0004", "core/src/x.ts", "../org/docs/adr")]);
    assert.equal(outcome.outcome, FAIL);
  });

  it("fails a broken record, even when every verdict is WITHIN", () => {
    const broken = [{ file: "docs/adr/0004-x.md", id: "0004", rule: "status-invalid", message: "status is wrong" }];
    const outcome = decideFolder(inside(["0005"], broken), [within("0005")], asked, []);
    assert.equal(outcome.outcome, FAIL);
    assert.deepEqual(outcome.broken, broken);
  });

  it("could not run for core's CouldNotRun, carrying it", () => {
    const failed = couldNotRun("docs/adr", "adr was not found. Next step: install it.");
    const outcome = decideFolder({ entry: "docs/adr", path: "/r/docs/adr", inside: true, outcome: failed }, [], asked, []);
    assert.equal(outcome.outcome, COULD_NOT_RUN);
    assert.deepEqual(outcome.couldNotRun, failed);
  });

  for (const [what, verdicts, named] of [
    ["misses a governing record", [within("0004")], "0005"],
    ["names a record not governing", [within("0004"), within("0005"), within("0009")], "0009"],
    ["names a path not asked", [within("0004"), departs("0005", ["core/src/z.ts"])], "core/src/z.ts"],
  ] as const) {
    it(`could not run when the verdict ${what}, naming it`, () => {
      const outcome = decideFolder(inside(["0004", "0005"]), [...verdicts], asked, []);
      assert.equal(outcome.outcome, COULD_NOT_RUN);
      assert.ok(outcome.mismatch.join(" ").includes(named), outcome.mismatch.join(" "));
    });
  }
});

describe("decideCheck", () => {
  const asked = (folders: AskedFolder[]): AdrAsked => ({ v: 1, paths: [PLAN("core/src/x.ts"), TASK("core/src/x.ts", 40, "US2")], folders });

  it("gives each folder's lines in the order [shared] adr_folders lists the folders", () => {
    const { lines, exit } = adrStop(
      decideCheck(asked([inside(["0004"]), outside()]), { v: 1, verdicts: [departs("0004", ["core/src/x.ts"])] }, []),
    );
    assert.equal(exit, 1);
    assert.deepEqual(lines, [
      "FAIL: docs/adr: 0004 on core/src/x.ts (story US2): reads env. Next step: change plan.md (the next round writes tasks.md again from it); draft a superseding record into the spec PR (planner ADR-0009 d3); or resume with adr_ruling naming docs/adr, 0004, core/src/x.ts and your reason.",
      "PASS: ../org/docs/adr: no record governs these paths.",
    ]);
    const swapped = adrStop(decideCheck(asked([outside(), inside(["0004"])]), { v: 1, verdicts: [departs("0004", ["core/src/x.ts"])] }, []));
    assert.deepEqual(swapped.lines, [lines[1], lines[0]]);
  });

  it("names the repo that holds an outside folder in its departure's next step", () => {
    const { lines } = adrStop(decideCheck(asked([outside(["0007"])]), { v: 1, verdicts: [departs("0007", ["core/src/x.ts"], "../org/docs/adr")] }, []));
    assert.match(lines[0], /^FAIL: \.\.\/org\/docs\/adr: 0007 on core\/src\/x\.ts .*Next step: change plan\.md .*change record 0007 in the repo that holds \.\.\/org\/docs\/adr; or resume with adr_ruling/);
  });

  it("names the governing records with their titles in full on a pass", () => {
    const { lines, exit } = adrStop(decideCheck(asked([inside(["0004", "0005"])]), { v: 1, verdicts: [within("0004"), within("0005")] }, []));
    assert.equal(exit, 0);
    assert.deepEqual(lines, ["PASS: docs/adr: governing: 0004 Title 0004, 0005 Title 0005."]);
  });

  it("prints a folder that could not run beside the others, its label once", () => {
    const failed = couldNotRun("../org/docs/adr", "not a readable folder, so adr was not called. Next step: make /org/docs/adr a readable folder.");
    const folders = [inside(["0004"]), { entry: "../org/docs/adr", path: "/org/docs/adr", inside: false, outcome: failed }];
    const { lines, exit } = adrStop(decideCheck(asked(folders), { v: 1, verdicts: [within("0004")] }, []));
    assert.equal(exit, 2);
    assert.deepEqual(lines, ["PASS: docs/adr: governing: 0004 Title 0004.", `COULD_NOT_RUN: ${failed.reason}`]);
  });

  it("could not run for a verdict naming a folder the asked record does not hold", () => {
    const { lines, exit } = adrStop(decideCheck(asked([inside(["0004"])]), { v: 1, verdicts: [within("0004"), within("0001", "notes/adr")] }, []));
    assert.equal(exit, 2);
    assert.ok(lines.some((line) => line.startsWith("COULD_NOT_RUN: notes/adr: ")), lines.join("\n"));
  });

  it("gives a broken record its own FAIL line naming file, rule and message", () => {
    const broken = [{ file: "docs/adr/0004-x.md", id: "0004", rule: "status-invalid", message: "status is wrong" }];
    const { lines } = adrStop(decideCheck(asked([inside([], broken)]), { v: 1, verdicts: [] }, []));
    assert.deepEqual(lines, [
      "FAIL: docs/adr: docs/adr/0004-x.md: status-invalid: status is wrong. Next step: fix that record (in the spec PR, or in the repo that holds docs/adr).",
    ]);
  });
});

describe("changedSince", () => {
  it("names what was added and what was removed, compared whole whatever the key order", () => {
    const recorded = [{ path: "a", line: 1, story: null }, { story: "US1", line: 2, path: "b" }];
    const now = [{ path: "b", line: 2, story: "US1" }, { path: "c", line: 3, story: null }];
    assert.deepEqual(changedSince(recorded, now), { added: [{ path: "c", line: 3, story: null }], removed: [{ path: "a", line: 1, story: null }] });
  });

  it("is empty both ways for the same items", () => {
    assert.deepEqual(changedSince([ruling("0004", "a/b.ts")], [ruling("0004", "a/b.ts")]), { added: [], removed: [] });
  });

  it("sees a changed reason as one removed and one added", () => {
    const { added, removed } = changedSince([ruling("0004", "a/b.ts")], [{ ...ruling("0004", "a/b.ts"), reason: "edited" }]);
    assert.equal(added.length, 1);
    assert.equal(removed.length, 1);
  });
});

// One item per row, every row but folder (core's reason, as it is) filled for each placeholder its templates name.
const FILL = {
  entry: "docs/adr",
  record: "0004",
  path: "core/src/x.ts",
  stories: " (story US2)",
  why: "reads env",
  records: "0004 Title",
  file: "docs/adr/0004-x.md",
  rule: "status-invalid",
  message: "status is wrong",
  what: "something is wrong",
  steps: "adr-ask",
  where: "tasks.md:12",
  issue: "7",
  count: "4",
  extra: "#104",
  sub: "acme/gadgets#102",
  position: "2",
  label: "#102",
  spec: "specs/7-x",
  folder: "docs/adr",
  changed: "added core/src/z.ts",
  again: "remove specs/7-x and run it again",
};

const ITEMS: Record<StopKind, StopItem> = Object.fromEntries(
  (Object.keys(ADR_STOPS) as StopKind[]).map((kind) => [
    kind,
    kind === "folder" ? { kind, couldNotRun: couldNotRun("docs/adr", "adr was not found. Next step: install it.") } : { kind, fill: FILL },
  ]),
) as Record<StopKind, StopItem>;

describe("adrStop", () => {
  for (const kind of Object.keys(ADR_STOPS) as StopKind[]) {
    const row = ADR_STOPS[kind];
    it(`renders ${kind} as <OUTCOME>: <label>: <what>${row.outcome === PASS ? "." : ". Next step: <next>."}`, () => {
      const { lines } = adrStop([ITEMS[kind]]);
      assert.equal(lines.length, 1);
      const [line] = lines;
      assert.match(line, new RegExp(`^${row.outcome}: [^ ]+: \\S`));
      if (row.outcome === PASS) assert.ok(!line.includes("Next step"), line);
      else assert.match(line, /\. Next step: .+\.$/);
      assert.doesNotMatch(line, /\{[a-z]+\}/, "a placeholder was left");
      assert.doesNotMatch(line.split("Next step: ")[1] ?? "", /\b(change|edit|correct|fix|write)\b[^.;]*tasks\.md/i, "a next step edits tasks.md");
    });
  }

  it("prints core's CouldNotRun after COULD_NOT_RUN: as it is, so its label appears once", () => {
    const { lines } = adrStop([ITEMS.folder]);
    assert.deepEqual(lines, ["COULD_NOT_RUN: docs/adr: adr was not found. Next step: install it."]);
  });

  it("refuses an item that leaves a placeholder of its row unfilled", () => {
    assert.throws(() => adrStop([{ kind: "governed", fill: {} }]), /entry/);
  });

  it("exits 2 when any line could not run, else 1 when any fails, else 0", () => {
    assert.equal(adrStop([ITEMS.governed, ITEMS.ungoverned]).exit, 0);
    assert.equal(adrStop([ITEMS.governed, ITEMS["departure-inside"]]).exit, 1);
    assert.equal(adrStop([ITEMS["departure-inside"], ITEMS["touches-missing"], ITEMS.governed]).exit, 2);
  });

  it("marks the rows whose stop a model step that did not answer gives", () => {
    const unanswered = Object.entries(ADR_STOPS).flatMap(([kind, row]) => (row.unanswered === null ? [] : [`${kind} ${row.unanswered}`]));
    assert.deepEqual(unanswered.sort(), ["tasks-unfinished adr-tasks", "touches-missing adr-touches", "verdict-unread adr-judge"]);
  });

  it("uses CheckOutcome's values for every row", () => {
    for (const row of Object.values(ADR_STOPS)) assert.ok(CheckOutcome.schema.safeParse(row.outcome).success);
  });
});

describe("roundsStop", () => {
  it("on a new run sends the admin to remove the folder and run issue-spec again", () => {
    const { lines, exit } = adrStop([roundsStop("new", 7, "specs/7-x")]);
    assert.equal(exit, 2);
    assert.deepEqual(lines, [
      "COULD_NOT_RUN: adr-check: the check ran 100 rounds in one run. Next step: discard the run's changes to specs/7-x, then start again: remove specs/7-x and run `/planner:issue-spec #7 [<dir>]`.",
    ]);
  });

  it("on a rescope sends the admin to restore the folder and run the rescope again", () => {
    const { lines } = adrStop([roundsStop("rescope", 7, "specs/7-x")]);
    assert.match(lines[0], /restore specs\/7-x to the branch's last commit and run `\/planner:issue-spec rescope specs\/7-x #7`\.$/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// adr_check.ts, driven in a scratch checkout: a stand-in `adr` first on PATH, a stand-in GitHub, and the files the
// touches step, the tasks command and the judge would write, written by the test in their place.
// ---------------------------------------------------------------------------------------------------------------

const SPEC = "specs/7-retry-budget";
const RUN = ".specify/workflows/runs/r1";
const REPO_URL = "https://api.github.com/repos/acme/widgets";
const ORG = "../org/docs/adr";

function settings(folders: readonly string[]): string {
  return `[shared]
board = "${BOARD}"
validators = []
adr_folders = [${folders.map((folder) => JSON.stringify(folder)).join(", ")}]
session_app_login = "codeworks-session[bot]"
orchestrator_app_login = "codeworks-orchestrator[bot]"
reviewer_app_login = "codeworks-reviewer[bot]"
planner_app_login = "${LOGIN}"

[planner]
app_id = 424242
`;
}

const TASKS = `# Tasks: retry budget

Run \`npm --prefix core test\` before and after; see https://example.test/x.

## Phase 1: Setup

- [ ] T001 Create \`core/src/x.ts\`

## Phase 2: User Story 1 - Retry an upload (Priority: P1)

- [ ] T002 [US1] Change \`core/src/x.ts\` and \`codeworks.toml\`, then run \`adr check\`
`;

const TWO_STORIES = `# Tasks: retry budget

## Phase 3: User Story 1 - Retry an upload (Priority: P1)

- [ ] T010 [US1] Change \`core/src/y.ts\`

## Phase 4: User Story 2 - Cap the retries (Priority: P2)

- [ ] T020 [US2] Change \`core/src/x.ts\`

## Phase 5: Polish

- [ ] T030 Tidy \`core/src/x.ts\`
`;

// What each folder's `adr check` answers: records each governing the paths it lists, findings as adrkit gives them.
type Record_ = { recordId: string; title: string; governs: string[] };
type FolderAnswer = { records?: Record_[]; findings?: unknown[]; ok?: boolean; exit?: number };

const ADR_STAND_IN = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.ADR_CALLS, JSON.stringify(args) + "\\n");
if (args[0] === "--version") { process.stdout.write("0.20.0\\n"); process.exit(0); }
const dir = args[args.indexOf("--dir") + 1];
const paths = args.slice(args.indexOf("--") + 1);
const answer = JSON.parse(readFileSync(process.env.ADR_ANSWERS, "utf8"))[dir] ?? {};
if (answer.exit !== undefined) { process.stderr.write("adr broke\\n"); process.exit(answer.exit); }
const governing = (answer.records ?? []).filter((r) => r.governs.some((p) => paths.includes(p))).map(({ recordId, title }) => ({ recordId, title }));
process.stdout.write(JSON.stringify({ ok: answer.ok ?? true, governing, findings: answer.findings ?? [] }));
process.exit(answer.ok === false ? 1 : 0);
`;

type Ran = { code: number; stdout: string[]; stderr: string[] };

type Scene = Scratch & {
  bin: string;
  answers: Record<string, FolderAnswer>;
  subIssues: unknown[];
  github: () => FakeGitHub;
  /** Each `adr` call's arguments. */
  adrCalls: () => string[][];
  run: (args: string[], adrRuling?: string) => Promise<Ran>;
  at: (path: string) => string;
  read: (path: string) => string;
  write: (files: Readonly<Record<string, string>>) => void;
};

function scene(t: TestContext, folders: readonly string[] = ["docs/adr", ORG], files: Readonly<Record<string, string>> = {}): Scene {
  tempHome(t);
  const scratch = scratchCheckout(t, { "codeworks.toml": settings(folders), "docs/adr/0004-retry.md": "# 0004\n", "core/src/x.ts": "x\n" });
  mkdirSync(join(scratch.root, "org", "docs", "adr"), { recursive: true });
  writeFileSync(join(scratch.root, "org", "docs", "adr", "0007-org.md"), "# 0007\n");
  writeFiles(scratch.checkout, {
    [`${SPEC}/spec.md`]: "# Feature Specification: retry budget\n",
    [`${SPEC}/plan.md`]: "# Plan\n\nChange core/src/x.ts.\n",
    [`${SPEC}/tasks.md`]: TASKS,
    ".specify/memory/constitution.md": "# Constitution\n",
    [`${RUN}/inputs.json`]: "{}",
    ...files,
  });
  storeToken(60);
  const bin = join(scratch.root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "adr"), ADR_STAND_IN);
  chmodSync(join(bin, "adr"), 0o755);
  // The stand-in is the only adr the check can find, and node stays reachable for its shebang.
  symlinkSync(process.execPath, join(bin, "node"));
  const withoutAdr = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir !== "" && !existsSync(join(dir, "adr")));
  const calls = join(scratch.root, "adr-calls.log");
  writeFileSync(calls, "");
  const answersFile = join(scratch.root, "adr-answers.json");
  const saved = { PATH: process.env.PATH, ADR_CALLS: process.env.ADR_CALLS, ADR_ANSWERS: process.env.ADR_ANSWERS };
  process.env.PATH = [bin, ...withoutAdr].join(delimiter);
  process.env.ADR_CALLS = calls;
  process.env.ADR_ANSWERS = answersFile;
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const orgDir = realpathSync(join(scratch.root, "org", "docs", "adr"));
  const s: Scene = {
    ...scratch,
    bin,
    answers: { "docs/adr": {}, [orgDir]: {} },
    subIssues: [],
    github: () =>
      fakeGitHub({
        rest: { "GET /repos/acme/widgets": { url: REPO_URL, default_branch: "main" } },
        restPages: { "/repos/acme/widgets/issues/7/sub_issues": () => s.subIssues },
      }),
    adrCalls: () => readFileSync(calls, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as string[]),
    run: async (args, adrRuling) => {
      writeFileSync(answersFile, JSON.stringify(s.answers));
      const stdout = output();
      const stderr = output();
      const code = await main(args, {
        checkout: scratch.checkout,
        connect: (token) => {
          assert.equal(token, storedToken());
          return s.github();
        },
        mint: fakeMint().mint,
        adrRuling,
        stdout: stdout.write,
        stderr: stderr.write,
      });
      return { code, stdout: stdout.lines, stderr: stderr.lines };
    },
    at: (path) => join(scratch.checkout, path),
    read: (path) => readFileSync(join(scratch.checkout, path), "utf8"),
    write: (files) => writeFiles(scratch.checkout, files),
  };
  return s;
}

const ORG_KEY = (s: Scene) => realpathSync(join(s.root, "org", "docs", "adr"));
const record = (recordId: string, governs: string[]): Record_ => ({ recordId, title: `Title ${recordId}`, governs });

function touches(s: Scene, paths: unknown = ["core/src/x.ts"]): void {
  s.write({ [`${RUN}/touches.json`]: typeof paths === "string" ? paths : JSON.stringify({ v: 1, paths }) });
}

function verdict(s: Scene, verdicts: unknown[]): void {
  s.write({ [`${RUN}/adr-verdict.json`]: JSON.stringify({ v: 1, verdicts }) });
}

function jsonOut(ran: Ran): Record<string, unknown> {
  assert.equal(ran.stdout.length, 1, `stdout: ${ran.stdout.join("\n")}`);
  return JSON.parse(ran.stdout[0]) as Record<string, unknown>;
}

const stopRecord = (s: Scene) => JSON.parse(s.read(`${RUN}/adr-stop.json`)) as { exit: number; lines: string[]; shown: boolean; unanswered: boolean };
const hasStop = (s: Scene) => existsSync(s.at(`${RUN}/adr-stop.json`));
const doneRecord = (s: Scene, step: string) => JSON.parse(s.read(`${RUN}/adr-steps/${step}.json`)) as Record<string, unknown>;

type RoundOptions = {
  kind?: string;
  touchesCode?: string;
  judgeCode?: string;
  /** The judge's verdicts, written after ask when it says judge; null writes none. */
  verdicts?: unknown[] | null;
  adrRuling?: string;
  /** Written in the touches step's place; undefined writes the plan's one path. */
  touchesPaths?: unknown;
  /** Between ask and decide, as a step that writes what it must not would. */
  afterAsk?: () => void;
};

type Round = { ask: Ran; decide: Ran | null; report: Ran; steps: Ran[] };

/** One round of the check loop, every step as the workflow runs it. */
async function round(s: Scene, o: RoundOptions = {}): Promise<Round> {
  const steps: Ran[] = [];
  const step = async (args: string[], ruling?: string) => {
    const ran = await s.run(args, ruling);
    steps.push(ran);
    return ran;
  };
  assert.equal((await step(["clear", SPEC, RUN])).code, 0);
  if (o.touchesPaths !== null) touches(s, o.touchesPaths);
  const due = jsonOut(await step(["tasks-due", SPEC, RUN])).due;
  if (due === true) await step(["tasks-written", RUN, "0"]);
  await step(["stories", "7", o.kind ?? "new", SPEC, RUN]);
  const ask = await step(["ask", SPEC, RUN, o.touchesCode ?? "0"]);
  const asked = jsonOut(ask);
  if (asked.judge === true && o.verdicts !== null) verdict(s, o.verdicts ?? []);
  o.afterAsk?.();
  let decide: Ran | null = null;
  if (asked.decide === true) decide = await step(["decide", SPEC, RUN, String(asked.asked), o.judgeCode ?? "0"], o.adrRuling);
  const report = await step(["report", SPEC, RUN]);
  return { ask, decide, report, steps };
}

const WITHIN = (record: string, folder = "docs/adr") => ({ folder, record, judgment: "WITHIN", paths: [], why: "stays inside" });
const DEPARTS = (record: string, paths: string[], folder = "docs/adr") => ({ folder, record, judgment: "DEPARTS", paths, why: "reads env" });

function assertShown(r: Round, exit: number, ...parts: string[]): void {
  assert.equal(r.report.code, exit, `report exit ${r.report.code}: ${r.report.stderr.join("\n")}`);
  assert.deepEqual(r.report.stdout, []);
  const said = r.report.stderr.join("\n");
  for (const part of parts) assert.ok(said.includes(part), `report does not say ${part}:\n${said}`);
}

function assertPassed(r: Round): void {
  assert.equal(r.report.code, 0, r.report.stderr.join("\n"));
  assert.deepEqual(jsonOut(r.report), { again: false });
}

describe("adr_check.ts: a round's outcome", () => {
  it("passes with every verdict WITHIN, a PASS line per folder naming the governing records (AS1)", async (t) => {
    const s = scene(t);
    s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"])] };
    const r = await round(s, { verdicts: [WITHIN("0004")] });
    assertPassed(r);
    assert.deepEqual(r.decide?.stderr, ["PASS: docs/adr: governing: 0004 Title 0004.", `PASS: ${ORG}: no record governs these paths.`]);
    for (const ran of r.steps) for (const line of ran.stdout) JSON.parse(line);
  });

  it("passes with no judge when no record governs", async (t) => {
    const s = scene(t);
    const r = await round(s, { verdicts: null });
    assert.equal(jsonOut(r.ask).judge, false);
    assertPassed(r);
    assert.ok(r.decide?.stderr.every((line) => line.endsWith("no record governs these paths.")));
  });

  it("stops at report with exit 1 on a departure from an inside record, offering plan, superseding record or ruling (AS2)", async (t) => {
    const s = scene(t);
    s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"])] };
    const r = await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])] });
    assert.equal(r.decide?.code, 0);
    assert.deepEqual(r.decide?.stderr, []);
    assert.equal(stopRecord(s).shown, true);
    assertShown(r, 1, "FAIL: docs/adr: 0004 on core/src/x.ts (story Phase 1: Setup, US1): reads env", "change plan.md", "draft a superseding record into the spec PR", "resume with adr_ruling naming docs/adr, 0004, core/src/x.ts");
  });

  it("names the repo that holds an outside folder in its departure's next step (AS2)", async (t) => {
    const s = scene(t);
    s.answers[ORG_KEY(s)] = { records: [record("0007", ["core/src/x.ts"])] };
    const r = await round(s, { verdicts: [DEPARTS("0007", ["core/src/x.ts"], ORG)] });
    assertShown(r, 1, `FAIL: ${ORG}: 0007 on core/src/x.ts`, `change record 0007 in the repo that holds ${ORG}`);
  });

  it("names every story whose task names a departing path (US3 AS2)", async (t) => {
    const s = scene(t, undefined, { [`${SPEC}/tasks.md`]: TWO_STORIES });
    s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"])] };
    const r = await round(s, { touchesPaths: ["core/src/y.ts"], verdicts: [DEPARTS("0004", ["core/src/x.ts"])] });
    assertShown(r, 1, "0004 on core/src/x.ts (story US2, Phase 5: Polish)", "change plan.md");
  });

  it("fails a record adr answers with its own error, naming file, rule and message (AS8)", async (t) => {
    const s = scene(t);
    s.answers["docs/adr"] = { ok: false, findings: [{ rule: "status-invalid", severity: "error", message: "status is wrong", path: "docs/adr/0004-retry.md", id: "0004" }] };
    const r = await round(s);
    assertShown(r, 1, "FAIL: docs/adr: docs/adr/0004-retry.md: status-invalid: status is wrong", "fix that record");
  });

  it("could not run with adr missing, every folder printed with its label once (AS3)", async (t) => {
    const s = scene(t);
    rmSync(join(s.bin, "adr"));
    const r = await round(s);
    assertShown(r, 2);
    const lines = r.report.stderr;
    assert.equal(lines.length, 2, lines.join("\n"));
    assert.ok(lines[0].startsWith("COULD_NOT_RUN: docs/adr: "), lines[0]);
    assert.ok(lines[1].startsWith(`COULD_NOT_RUN: ${ORG}: `), lines[1]);
    for (const line of lines) assert.equal(line.split(`${line.includes(ORG) ? ORG : "docs/adr"}:`).length, 2, line);
  });

  it("could not run for a folder missing from the checkout, the others still printed (AS3)", async (t) => {
    const s = scene(t);
    rmSync(join(s.root, "org"), { recursive: true });
    const r = await round(s);
    assertShown(r, 2, "PASS: docs/adr: no record governs these paths.", `COULD_NOT_RUN: ${ORG}: `);
  });

  it("could not run when the verdict misses a governing record, naming it (AS3)", async (t) => {
    const s = scene(t);
    s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"]), record("0005", ["core/src/x.ts"])] };
    const r = await round(s, { verdicts: [WITHIN("0004")] });
    assertShown(r, 2, "COULD_NOT_RUN: docs/adr: the verdict misses governing 0005", "resume to run the check again");
  });

  for (const [what, write] of [
    ["missing", null],
    ["not an AdrVerdict", [{ folder: "docs/adr", record: "0004", judgment: "DEPARTS", paths: [], why: "x" }]],
  ] as const) {
    it(`could not run for a verdict file ${what}`, async (t) => {
      const s = scene(t);
      s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"])] };
      const r = await round(s, { verdicts: write === null ? null : [...write] });
      assertShown(r, 2, "COULD_NOT_RUN: adr-verdict.json: ");
    });
  }

  for (const code of ["1", ""]) {
    it(`could not run, verdict-unread recorded unanswered, for a judge exit code ${JSON.stringify(code)} beside a valid verdict`, async (t) => {
      const s = scene(t);
      s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"])] };
      const r = await round(s, { judgeCode: code, verdicts: [WITHIN("0004")] });
      assert.equal(r.decide?.code, 0);
      assert.equal(stopRecord(s).unanswered, true);
      assertShown(r, 2, "COULD_NOT_RUN: adr-verdict.json: the judge did not answer");
    });

    it(`ignores a judge exit code ${JSON.stringify(code)} when ask said no judge`, async (t) => {
      const s = scene(t);
      assertPassed(await round(s, { judgeCode: code }));
    });
  }

  it("passes an empty adr_folders with or without touches.json, reading no path", async (t) => {
    for (const touched of [undefined, null]) {
      const s = scene(t, []);
      rmSync(s.at(`${SPEC}/tasks.md`));
      s.write({ [`${SPEC}/tasks.md`]: TASKS.replace("`core/src/x.ts`", "`a/{b,c}.ts`") });
      const r = await round(s, { touchesPaths: touched });
      assertPassed(r);
      assert.deepEqual(jsonOut(r.ask), { judge: false, decide: true, asked: jsonOut(r.ask).asked });
      assert.deepEqual(r.decide?.stderr, ["PASS: codeworks.toml: No ADR folder is listed in [shared] adr_folders."]);
      assert.deepEqual(s.adrCalls(), []);
    }
  });
});

describe("adr_check.ts: the paths a round checks", () => {
  function askedPaths(s: Scene): { path: string; artifact: string; line: number; story: string | null }[] {
    return (JSON.parse(s.read(`${RUN}/adr-asked.json`)) as { paths: { path: string; artifact: string; line: number; story: string | null }[] }).paths;
  }

  it("asks the plan's paths and the task lines' paths, one entry per artifact, a root file only when tracked or touched", async (t) => {
    const s = scene(t, undefined, { [`${SPEC}/tasks.md`]: `${TASKS}- [ ] T003 [US1] Add \`new.toml\` and \`README.md\` per \`https://example.test/a/b\`\n` });
    await round(s, { touchesPaths: ["core/src/x.ts", "new.toml"] });
    assert.deepEqual(askedPaths(s), [
      { path: "core/src/x.ts", artifact: "plan", line: 1, story: null },
      { path: "new.toml", artifact: "plan", line: 2, story: null },
      { path: "core/src/x.ts", artifact: "tasks", line: 7, story: "Phase 1: Setup" },
      { path: "core/src/x.ts", artifact: "tasks", line: 11, story: "US1" },
      { path: "codeworks.toml", artifact: "tasks", line: 11, story: "US1" },
      { path: "new.toml", artifact: "tasks", line: 12, story: "US1" },
    ]);
    const check = s.adrCalls().find((args) => args[0] === "check");
    assert.deepEqual(check?.slice(check.indexOf("--") + 1), ["core/src/x.ts", "new.toml", "codeworks.toml"]);
  });

  for (const span of ["a/{b,c}.ts", "a/*.ts"]) {
    it(`stops with exit 1 for a task span ${span}, naming tasks.md:<line>`, async (t) => {
      const s = scene(t, undefined, { [`${SPEC}/tasks.md`]: TASKS.replace("Create `core/src/x.ts`", `Create \`${span}\``) });
      const r = await round(s);
      assertShown(r, 1, `FAIL: tasks.md:7: ${JSON.stringify(span)}`, "Next step: delete tasks.md, then resume");
    });
  }

  it("stops with exit 1 for a task line above every ## heading, naming tasks.md:<line>", async (t) => {
    const s = scene(t, undefined, { [`${SPEC}/tasks.md`]: `# Tasks\n- [ ] T000 Seed \`core/src/x.ts\`\n${TASKS.slice("# Tasks: retry budget\n".length)}` });
    const r = await round(s);
    assertShown(r, 1, "FAIL: tasks.md:2: ");
  });

  it("could not run, the next step deleting it, for a tasks.md that names no path", async (t) => {
    const s = scene(t, undefined, { [`${SPEC}/tasks.md`]: TASKS.replace("Create `core/src/x.ts`", "Create it").replace("Change `core/src/x.ts` and `codeworks.toml`, then", "Then") });
    const r = await round(s);
    assertShown(r, 2, "COULD_NOT_RUN: tasks.md: no task line names a path", "Next step: delete tasks.md, then resume");
  });

  for (const [what, paths, said] of [
    ["missing", null, "touches.json"],
    ["with no path", [], "touches.json"],
  ] as const) {
    it(`could not run for a touches.json ${what}, recorded unanswered`, async (t) => {
      const s = scene(t);
      const r = await round(s, { touchesPaths: paths === null ? null : [...paths] });
      assert.deepEqual(jsonOut(r.ask), { judge: false, decide: false, asked: "" });
      assertShown(r, 2, `COULD_NOT_RUN: ${said}: `);
      assert.equal(stopRecord(s).unanswered, true);
    });
  }

  for (const [what, text, named] of [
    ["unparsable", "{", "not JSON"],
    ["with an extra key", JSON.stringify({ v: 1, paths: ["a/b.ts"], why: "x" }), "why"],
    ["with an entry that is no PATH", JSON.stringify({ v: 1, paths: ["a/*.ts"] }), '"a/*.ts"'],
    ["with an entry twice", JSON.stringify({ v: 1, paths: ["a/b.ts", "a/b.ts"] }), '"a/b.ts"'],
  ] as const) {
    it(`stops for a touches.json ${what}, naming touches.json and ${named}`, async (t) => {
      const s = scene(t);
      const r = await round(s, { touchesPaths: text });
      assertShown(r, 2, "COULD_NOT_RUN: touches.json: ", named);
    });
  }

  for (const code of ["1", "", "00"]) {
    it(`records touches-missing for a touches exit code ${JSON.stringify(code)} beside a valid touches.json`, async (t) => {
      const s = scene(t);
      const r = await round(s, { touchesCode: code });
      assert.equal(r.ask.code, 0);
      assertShown(r, 2, "COULD_NOT_RUN: touches.json: the touches step did not answer");
    });
  }

  it("records touches-stale when plan.md changes after clear", async (t) => {
    const s = scene(t);
    await s.run(["clear", SPEC, RUN]);
    touches(s);
    s.write({ [`${SPEC}/plan.md`]: "# Plan, changed\n" });
    jsonOut(await s.run(["tasks-due", SPEC, RUN]));
    await s.run(["tasks-written", RUN, "0"]);
    await s.run(["stories", "7", "new", SPEC, RUN]);
    const ask = await s.run(["ask", SPEC, RUN, "0"]);
    assert.equal(ask.code, 0);
    assert.deepEqual(jsonOut(ask), { judge: false, decide: false, asked: "" });
    assert.ok(stopRecord(s).lines[0].startsWith("COULD_NOT_RUN: touches.json: plan.md or spec.md changed"), stopRecord(s).lines[0]);
  });
});

describe("adr_check.ts: the user's ruling", () => {
  function departing(t: TestContext): Scene {
    const s = scene(t);
    s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"])] };
    return s;
  }
  const RULED = { folder: "docs/adr", record: "0004", path: "core/src/x.ts", reason: "the user accepts it" };
  const rulings = (s: Scene) => (existsSync(s.at(`${SPEC}/adr-rulings.json`)) ? JSON.parse(s.read(`${SPEC}/adr-rulings.json`)).rulings : null);
  const written = (s: Scene) => (existsSync(s.at(`${RUN}/adr-rulings-written.json`)) ? JSON.parse(s.read(`${RUN}/adr-rulings-written.json`)).rulings : null);

  it("appends a ruling that names the round's departure, then a round with no ADR_RULING passes on it (AS5, AS6)", async (t) => {
    const s = departing(t);
    const first = await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])], adrRuling: JSON.stringify([RULED]) });
    assert.deepEqual(rulings(s), [RULED]);
    assert.deepEqual(written(s), [RULED]);
    // The rulings file changed after stories hashed it, so the round asks for another.
    assert.deepEqual(jsonOut(first.report), { again: true });
    assertPassed(await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])] }));
  });

  it("is satisfied, not refused, by a ruling the rulings file already holds", async (t) => {
    const s = departing(t);
    await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])], adrRuling: JSON.stringify([RULED]) });
    const before = s.read(`${SPEC}/adr-rulings.json`);
    assertPassed(await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])], adrRuling: JSON.stringify([RULED]) }));
    assert.equal(s.read(`${SPEC}/adr-rulings.json`), before);
  });

  it("refuses a valid ruling on a key no departure of the round names, appending nothing", async (t) => {
    const s = departing(t);
    const r = await round(s, { verdicts: [WITHIN("0004")], adrRuling: JSON.stringify([RULED]) });
    assertShown(r, 1, "FAIL: adr_ruling: ", "resume with a corrected adr_ruling, or without one");
    assert.equal(rulings(s), null);
    assert.equal(written(s), null);
  });

  for (const [what, ruling] of [
    ["not JSON", "[{"],
    ["an unlisted folder beside a valid one", JSON.stringify([RULED, { ...RULED, folder: "notes/adr" }])],
    ["an unasked path beside a valid one", JSON.stringify([RULED, { ...RULED, path: "core/src/z.ts" }])],
    ["a record not governing its path beside a valid one", JSON.stringify([RULED, { ...RULED, record: "0009" }])],
  ] as const) {
    it(`refuses the whole ADR_RULING with ${what}, appending nothing`, async (t) => {
      const s = departing(t);
      const r = await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])], adrRuling: ruling });
      assertShown(r, 1, "FAIL: adr_ruling: ");
      assert.equal(rulings(s), null);
      assert.equal(written(s), null);
    });
  }

  for (const [what, entry] of [
    ["an entry", { ...RULED, record: "0005" }],
    ["an entry's reason", { ...RULED, reason: "edited by hand" }],
  ] as const) {
    it(`could not run for ${what} neither at HEAD nor in the run record, naming it (AS7)`, async (t) => {
      const s = departing(t);
      await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])], adrRuling: JSON.stringify([RULED]) });
      s.write({ [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [entry] }) });
      const r = await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])] });
      assertShown(r, 2, `COULD_NOT_RUN: adr-rulings.json: entry docs/adr ${entry.record} core/src/x.ts was not written by the check`);
    });
  }

  it("does not stop for an entry removed by hand", async (t) => {
    const s = departing(t);
    await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])], adrRuling: JSON.stringify([RULED]) });
    s.write({ [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [] }) });
    assertPassed(await round(s, { verdicts: [WITHIN("0004")] }));
  });

  it("deletes a run record that does not parse and names every entry the run added", async (t) => {
    const s = departing(t);
    await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])], adrRuling: JSON.stringify([RULED]) });
    s.write({ [`${RUN}/adr-rulings-written.json`]: "{" });
    const r = await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])] });
    assertShown(r, 2, "entry docs/adr 0004 core/src/x.ts was not written by the check");
    assert.equal(existsSync(s.at(`${RUN}/adr-rulings-written.json`)), false);
  });

  it("could not run when the rulings file does not parse, naming it", async (t) => {
    const s = departing(t);
    s.write({ [`${SPEC}/adr-rulings.json`]: "{" });
    const r = await round(s, { verdicts: [WITHIN("0004")] });
    assertShown(r, 1, "FAIL: adr-rulings.json: ", `correct ${SPEC}/adr-rulings.json, then resume`);
  });
});

describe("adr_check.ts: the guards between ask and decide", () => {
  it("could not run when the asked record changed after ask", async (t) => {
    const s = scene(t);
    const r = await round(s, { afterAsk: () => s.write({ [`${RUN}/adr-asked.json`]: `${s.read(`${RUN}/adr-asked.json`)} ` }) });
    assertShown(r, 2, "COULD_NOT_RUN: adr-asked.json: changed after ask");
  });

  it("could not run when touches.json changed after ask, naming the path added", async (t) => {
    const s = scene(t);
    const r = await round(s, { afterAsk: () => touches(s, ["core/src/x.ts", "core/src/z.ts"]) });
    assertShown(r, 2, "COULD_NOT_RUN: touches.json: changed after ask: added core/src/z.ts");
  });

  it("could not run when tasks.md changed after ask, naming the path removed; report then asks for a new round", async (t) => {
    const s = scene(t);
    const r = await round(s, { afterAsk: () => s.write({ [`${SPEC}/tasks.md`]: TASKS.replace(" and `codeworks.toml`", "") }) });
    assert.deepEqual(stopRecord(s).lines, ["COULD_NOT_RUN: tasks.md: changed after ask: removed codeworks.toml. Next step: resume to run the check again."]);
    assert.deepEqual(jsonOut(r.report), { again: true });
  });

  it("could not run when tasks.md was deleted after ask, naming it missing; report then asks for a new round", async (t) => {
    const s = scene(t);
    const r = await round(s, { afterAsk: () => rmSync(s.at(`${SPEC}/tasks.md`)) });
    assert.deepEqual(stopRecord(s).lines, ["COULD_NOT_RUN: tasks.md: changed after ask: tasks.md is missing. Next step: resume to run the check again."]);
    assert.deepEqual(jsonOut(r.report), { again: true });
  });
});

describe("adr_check.ts: each step", () => {
  it("ask prints judge, decide and asked only, asked the sha256 of the record it wrote", async (t) => {
    const s = scene(t);
    const r = await round(s);
    const asked = jsonOut(r.ask);
    assert.deepEqual(Object.keys(asked).sort(), ["asked", "decide", "judge"]);
    assert.equal(asked.asked, createHash("sha256").update(readFileSync(s.at(`${RUN}/adr-asked.json`))).digest("hex"));
    assert.deepEqual(doneRecord(s, "ask"), { v: 1, step: "ask", decide: true });
  });

  it("clear deletes every round file and done record the last round left, and writes touches-from.json", async (t) => {
    const s = scene(t);
    s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"])] };
    await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])] });
    assert.equal((await s.run(["clear", SPEC, RUN])).code, 0);
    for (const name of ["adr-steps", "touches.json", "adr-inputs.json", "adr-asked.json", "adr-verdict.json", "adr-stop.json"]) {
      assert.equal(existsSync(s.at(`${RUN}/${name}`)), false, name);
    }
    assert.deepEqual(Object.keys(JSON.parse(s.read(`${RUN}/touches-from.json`)).files).sort(), [`${SPEC}/plan.md`, `${SPEC}/spec.md`]);
  });

  it("ask after a stories stop prints no judge and no decide and reads nothing", async (t) => {
    const s = scene(t, undefined, { [`${SPEC}/tasks.md`]: TASKS.replace("[US1]", "[US2]") });
    await s.run(["clear", SPEC, RUN]);
    touches(s);
    await s.run(["tasks-due", SPEC, RUN]);
    await s.run(["tasks-written", RUN, "0"]);
    await s.run(["stories", "7", "new", SPEC, RUN]);
    assert.ok(hasStop(s));
    const ask = await s.run(["ask", SPEC, RUN, "0"]);
    assert.deepEqual(jsonOut(ask), { judge: false, decide: false, asked: "" });
    assert.equal(existsSync(s.at(`${RUN}/adr-asked.json`)), false);
    assert.deepEqual(s.adrCalls(), []);
  });

  it("tasks-due is due with no tasks.md, with no tasks-sources.json, after a source changed, and not when none changed", async (t) => {
    const s = scene(t);
    const due = async () => jsonOut(await s.run(["tasks-due", SPEC, RUN])).due;
    assert.equal(await due(), true);
    await s.run(["tasks-written", RUN, "0"]);
    assert.equal(await due(), false);
    assert.equal(doneRecord(s, "tasks-due").due, false);
    s.write({ [`${SPEC}/contracts/api.md`]: "# API\n" });
    assert.equal(await due(), true);
    assert.equal(existsSync(s.at(`${RUN}/tasks-sources.json`)), false);
    await s.run(["tasks-written", RUN, "0"]);
    rmSync(s.at(`${SPEC}/tasks.md`));
    assert.equal(await due(), true);
  });

  it("tasks-written with exit code 0 renames the next hashes into place and writes its done record", async (t) => {
    const s = scene(t);
    await s.run(["tasks-due", SPEC, RUN]);
    const next = s.read(`${RUN}/tasks-sources-next.json`);
    assert.equal((await s.run(["tasks-written", RUN, "0"])).code, 0);
    assert.equal(s.read(`${RUN}/tasks-sources.json`), next);
    assert.equal(existsSync(s.at(`${RUN}/tasks-sources-next.json`)), false);
    assert.deepEqual(doneRecord(s, "tasks-written"), { v: 1, step: "tasks-written" });
  });

  for (const code of ["1", "", "-1"]) {
    it(`tasks-written with exit code ${JSON.stringify(code)} records tasks-unfinished unanswered and renames nothing`, async (t) => {
      const s = scene(t);
      await s.run(["tasks-due", SPEC, RUN]);
      assert.equal((await s.run(["tasks-written", RUN, code])).code, 0);
      assert.equal(existsSync(s.at(`${RUN}/tasks-sources.json`)), false);
      assert.deepEqual(stopRecord(s), {
        v: 1,
        exit: 2,
        lines: ["COULD_NOT_RUN: tasks.md: the tasks command did not answer (its exit code is not 0). Next step: resume to run the check again."],
        shown: false,
        unanswered: true,
      });
      assert.deepEqual(doneRecord(s, "tasks-written"), { v: 1, step: "tasks-written" });
    });
  }

  it("tasks-written with no next hashes fails loud and writes no done record", async (t) => {
    const s = scene(t);
    await assert.rejects(s.run(["tasks-written", RUN, "0"]), { code: "ENOENT" });
    assert.equal(existsSync(s.at(`${RUN}/adr-steps/tasks-written.json`)), false);
  });

  it("stories after a tasks command that failed writes the inputs and its done record, checks nothing, and report shows the stop", async (t) => {
    const s = scene(t, undefined, { [`${SPEC}/tasks.md`]: TASKS.replace("[US1]", "[US2]") });
    await s.run(["clear", SPEC, RUN]);
    touches(s);
    await s.run(["tasks-due", SPEC, RUN]);
    await s.run(["tasks-written", RUN, "1"]);
    assert.equal((await s.run(["stories", "7", "new", SPEC, RUN])).code, 0);
    assert.ok(existsSync(s.at(`${RUN}/adr-inputs.json`)));
    assert.deepEqual(doneRecord(s, "stories"), { v: 1, step: "stories" });
    assert.ok(stopRecord(s).lines[0].includes("the tasks command did not answer"));
    await s.run(["ask", SPEC, RUN, "0"]);
    const report = await s.run(["report", SPEC, RUN]);
    assert.equal(report.code, 2);
    assert.ok(report.stderr[0].startsWith("COULD_NOT_RUN: tasks.md: the tasks command did not answer"), report.stderr.join("\n"));
  });

  for (const [what, tasks] of [
    ["a story plan it breaks", TASKS.replace("[US1]", "[US2]")],
    ["a task-block label it breaks", TASKS.replace("## Phase 1: Setup\n", "## Phase 1: Setup\nStory issue: seven\n")],
  ] as const) {
    it(`stories stops with exit 1 for ${what}, the next step deleting tasks.md`, async (t) => {
      const s = scene(t, undefined, { [`${SPEC}/tasks.md`]: tasks });
      assertShown(await round(s), 1, "FAIL: tasks.md: ", "Next step: delete tasks.md, then resume");
    });
  }

  for (const [what, subIssues, said] of [
    ["extra", [{ id: 1, number: 101, repository_url: REPO_URL }], "FAIL: #7: 1 sub-issues for 1 stories; the extra: #101. Next step: remove them from #7's sub-issues"],
    ["foreign", [{ id: 1, number: 101, repository_url: "https://api.github.com/repos/acme/gadgets" }], "sub-issue acme/gadgets#101 is in another repository"],
  ] as const) {
    it(`stories on a new run stops for ${what} sub-issues; on a rescope it reads none`, async (t) => {
      const s = scene(t, undefined, what === "foreign" ? { [`${SPEC}/tasks.md`]: TWO_STORIES } : {});
      s.subIssues = [...subIssues];
      assertShown(await round(s), 1, said);
      const rescope = scene(t);
      let read = false;
      Object.defineProperty(rescope, "subIssues", { get: () => ((read = true), [...subIssues]) });
      assertPassed(await round(rescope, { kind: "rescope" }));
      assert.equal(read, false, "a rescope read its sub-issues");
    });
  }

  it("stories on a new run stops for a sub-issue out of story order, naming the order to set", async (t) => {
    const labelled = TWO_STORIES.replace("(Priority: P1)\n", "(Priority: P1)\nStory issue: #101\n").replace("(Priority: P2)\n", "(Priority: P2)\nStory issue: #102\n");
    const s = scene(t, undefined, { [`${SPEC}/tasks.md`]: labelled });
    s.subIssues = [{ id: 2, number: 102, repository_url: REPO_URL }, { id: 1, number: 101, repository_url: REPO_URL }];
    assertShown(await round(s, { touchesPaths: ["core/src/y.ts"] }), 1, "sub-issue 1 is #102, but tasks.md labels US1 with #101", "order #7's sub-issues so sub-issue 1 is US1's issue");
  });

  it("stories could not run when GitHub does not answer", async (t) => {
    const s = scene(t);
    s.github = () => fakeGitHub({ rest: { "GET /repos/acme/widgets": new GitHubUnanswered("dummy: the connection closed") } });
    assertShown(await round(s), 2, "COULD_NOT_RUN: GitHub: dummy: the connection closed");
  });
});

describe("adr_check.ts report", () => {
  async function passedRound(t: TestContext): Promise<Scene> {
    const s = scene(t);
    assertPassed(await round(s));
    return s;
  }
  const report = (s: Scene) => s.run(["report", SPEC, RUN]);

  for (const [what, change] of [
    ["plan.md", (s: Scene) => s.write({ [`${SPEC}/plan.md`]: "# Plan, changed\n" })],
    ["a tasks source", (s: Scene) => s.write({ [`${SPEC}/research.md`]: "# Research\n" })],
    ["tasks.md", (s: Scene) => s.write({ [`${SPEC}/tasks.md`]: `${TASKS}\n` })],
    ["the rulings file", (s: Scene) => s.write({ [`${SPEC}/adr-rulings.json`]: JSON.stringify({ v: 1, rulings: [] }) })],
    ["codeworks.toml", (s: Scene) => s.write({ "codeworks.toml": `${settings(["docs/adr", ORG])}\n` })],
    ["a listed folder's file", (s: Scene) => s.write({ "docs/adr/0009-new.md": "# 0009\n" })],
    ["adr-inputs.json not reading", (s: Scene) => s.write({ [`${RUN}/adr-inputs.json`]: "{" })],
    ["a tasks source differing from tasks-sources.json", (s: Scene) => s.write({ [`${RUN}/tasks-sources.json`]: JSON.stringify({ v: 1, files: {} }) })],
  ] as const) {
    it(`asks for another round, showing nothing, when ${what} changed after stories hashed it`, async (t) => {
      const s = await passedRound(t);
      change(s);
      const ran = await report(s);
      assert.equal(ran.code, 0);
      assert.deepEqual(jsonOut(ran), { again: true });
      assert.deepEqual(ran.stderr, []);
    });
  }

  it("keeps an unshown stop record, showing nothing, when a file changed", async (t) => {
    const s = scene(t);
    s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"])] };
    const r = await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])], afterAsk: () => undefined });
    assert.equal(r.report.code, 1);
    // A fresh round up to report, then plan.md changes before report runs.
    await s.run(["clear", SPEC, RUN]);
    touches(s);
    await s.run(["tasks-due", SPEC, RUN]);
    await s.run(["stories", "7", "new", SPEC, RUN]);
    const asked = jsonOut(await s.run(["ask", SPEC, RUN, "0"]));
    verdict(s, [DEPARTS("0004", ["core/src/x.ts"])]);
    await s.run(["decide", SPEC, RUN, String(asked.asked), "0"]);
    s.write({ [`${SPEC}/plan.md`]: "# Plan, changed again\n" });
    const ran = await report(s);
    assert.deepEqual(jsonOut(ran), { again: true });
    assert.equal(stopRecord(s).shown, false);
  });

  for (const step of ["tasks-due", "stories", "ask"]) {
    it(`shows step-unfinished naming adr-${step} when its done record is missing, whatever changed`, async (t) => {
      const s = await passedRound(t);
      rmSync(s.at(`${RUN}/adr-steps/${step}.json`));
      s.write({ [`${SPEC}/plan.md`]: "# Plan, changed\n" });
      const ran = await report(s);
      assert.equal(ran.code, 2);
      assert.ok(ran.stderr[0].startsWith(`COULD_NOT_RUN: adr-check: step adr-${step} did not finish this round`), ran.stderr[0]);
      assert.equal(stopRecord(s).shown, true);
    });
  }

  it("expects tasks-written's record only when tasks-due was due, and decide's when ask said decide", async (t) => {
    const s = await passedRound(t);
    rmSync(s.at(`${RUN}/adr-steps/tasks-written.json`));
    assert.equal((await report(s)).code, 2);
    const again = scene(t);
    await round(again);
    assertPassed(await round(again));
    assert.equal(existsSync(again.at(`${RUN}/adr-steps/tasks-written.json`)), false);
    rmSync(again.at(`${RUN}/adr-steps/decide.json`));
    assert.equal((await report(again)).code, 2);
  });

  it("shows a stop that a model step gave even when a file changed", async (t) => {
    const s = scene(t);
    const r = await round(s, { touchesCode: "1", afterAsk: () => s.write({ [`${SPEC}/plan.md`]: "# Plan, changed\n" }) });
    assertShown(r, 2, "the touches step did not answer");
  });

  it("shows an unshown stop record, exiting with its exit, and rewrites it shown", async (t) => {
    const s = scene(t);
    s.answers["docs/adr"] = { records: [record("0004", ["core/src/x.ts"])] };
    const r = await round(s, { verdicts: [DEPARTS("0004", ["core/src/x.ts"])] });
    assert.equal(r.report.code, 1);
    assert.equal(stopRecord(s).shown, true);
    const resumed = await report(s);
    assert.deepEqual(jsonOut(resumed), { again: true });
    assert.equal(resumed.code, 0);
    await s.run(["clear", SPEC, RUN]);
    assert.equal(hasStop(s), false);
  });

  it("shows a stop record that does not parse as stop-unread, writing it valid and shown", async (t) => {
    const s = await passedRound(t);
    s.write({ [`${RUN}/adr-stop.json`]: "{" });
    const ran = await report(s);
    assert.equal(ran.code, 2);
    assert.deepEqual(ran.stderr, ["COULD_NOT_RUN: adr-stop.json: does not parse. Next step: resume to run the check again."]);
    assert.equal(stopRecord(s).shown, true);
  });
});

describe("adr_check.ts stop rounds", () => {
  for (const [kind, said] of [
    ["new", "remove specs/7-retry-budget and run `/planner:issue-spec #7 [<dir>]`"],
    ["rescope", "restore specs/7-retry-budget to the branch's last commit and run `/planner:issue-spec rescope specs/7-retry-budget #7`"],
  ] as const) {
    it(`for a ${kind} run exits 2 naming the rounds and the way to start again`, async (t) => {
      const s = scene(t);
      const ran = await s.run(["stop", "rounds", kind, "7", SPEC]);
      assert.equal(ran.code, 2);
      assert.equal(ran.stderr.length, 1);
      assert.ok(ran.stderr[0].startsWith("COULD_NOT_RUN: adr-check: the check ran 100 rounds in one run. Next step: "), ran.stderr[0]);
      assert.ok(ran.stderr[0].includes(said), ran.stderr[0]);
    });
  }
});

describe("the root README", () => {
  it("installs the adr CLI at the version the check runs", () => {
    assert.ok(readFileSync(new URL("../../README.md", import.meta.url), "utf8").includes(`\`${ADR_INSTALL}\``));
  });
});

describe("drive_workflow.py", () => {
  it("names as unanswered steps the ones ADR_STOPS does", () => {
    const driver = readFileSync(new URL("../plugin/skills/issue-spec/scripts/drive_workflow.py", import.meta.url), "utf8");
    const named = /^UNANSWERED_STEPS = \(([^)]*)\)$/m.exec(driver)?.[1];
    assert.ok(named !== undefined, "drive_workflow.py declares UNANSWERED_STEPS");
    const unanswered = new Set(Object.values(ADR_STOPS).flatMap((row) => (row.unanswered === null ? [] : [row.unanswered])));
    assert.deepEqual(new Set(named.split(",").map((name) => name.trim().replaceAll('"', "")).filter(Boolean)), unanswered);
  });
});
