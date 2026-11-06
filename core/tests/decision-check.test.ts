import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  AdrAsked,
  AdrRuling,
  AdrRulings,
  AdrStepDone,
  AdrStopRecord,
  AdrVerdict,
  artifactPath,
  PathRefused,
  readRulings,
  readTouchedPaths,
  roundInputPaths,
  RulingsRefused,
  sourceHashes,
  SourceHashes,
  tasksSourcePaths,
  TouchesRefused,
} from "../src/contracts/decision-check.ts";

const scratch = mkdtempSync(join(tmpdir(), "decision-check-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function folder(name: string): string {
  const path = join(scratch, name);
  mkdirSync(path, { recursive: true });
  return path;
}

function refusedNaming(Refused: new (...args: never[]) => Error, ...named: string[]) {
  return (error: unknown) => {
    assert.ok(error instanceof Refused, String(error));
    for (const name of named) assert.ok(error.message.includes(name), `${error.message} does not name ${name}`);
    return true;
  };
}

describe("artifactPath", () => {
  describe('under "any", a touches.json entry', () => {
    for (const span of ["core/src/adr.ts", "codeworks.toml", ".github/workflows/tests.yml", "a-b_c.d/e"]) {
      it(`returns ${span}`, () => assert.equal(artifactPath(span, "any"), span));
    }
    for (const span of ["", "core/src/", "/abs/x.ts", "a//b", "a/./b", "a/../b", "..", "a/*.ts", "a/{b,c}.ts", "a b.ts", "<run>/x"]) {
      it(`refuses ${JSON.stringify(span)}, naming it`, () => {
        assert.throws(() => artifactPath(span, "any"), refusedNaming(PathRefused, JSON.stringify(span)));
      });
    }
  });

  describe("a tasks.md span", () => {
    const rootFiles = new Set(["codeworks.toml", "new.toml"]);
    for (const span of ["core/src/adr.ts", "planner/plugin/scripts/adr_check.ts"]) {
      it(`returns ${span}, which has a /`, () => assert.equal(artifactPath(span, rootFiles), span));
    }
    it("returns a span with no / that rootFiles holds", () => assert.equal(artifactPath("codeworks.toml", rootFiles), "codeworks.toml"));
    it("is null for a span with no / that rootFiles does not hold", () => assert.equal(artifactPath("README.md", rootFiles), null));
    for (const span of ["adr check", "https://github.com/x/y", "<run>/x", "npm --prefix core test", "x", "--dir"]) {
      it(`is null for ${JSON.stringify(span)}, which is no path`, () => assert.equal(artifactPath(span, rootFiles), null));
    }
    for (const span of ["a/{b,c}.ts", "a/*.ts", "a/b?.ts", "a/[bc].ts", "a/./b.ts", "a/../b.ts", "../engineering/docs/adr"]) {
      it(`refuses ${JSON.stringify(span)}, which names paths the check cannot list`, () => {
        assert.throws(() => artifactPath(span, rootFiles), refusedNaming(PathRefused, JSON.stringify(span)));
      });
    }
  });
});

describe("readTouchedPaths", () => {
  it("reads each entry with its 1-based index as line, artifact plan and no story", () => {
    assert.deepEqual(readTouchedPaths({ v: 1, paths: ["core/src/a.ts", "codeworks.toml"] }), [
      { path: "core/src/a.ts", artifact: "plan", line: 1, story: null },
      { path: "codeworks.toml", artifact: "plan", line: 2, story: null },
    ]);
  });

  it("returns [] for no paths, which the check makes could not run", () => {
    assert.deepEqual(readTouchedPaths({ v: 1, paths: [] }), []);
  });

  const refused: [string, unknown, string][] = [
    ["an extra key", { v: 1, paths: [], why: "x" }, "why"],
    ["no paths key", { v: 1 }, "paths"],
    ["v other than 1", { v: 2, paths: [] }, "v"],
    ["an entry that is no PATH", { v: 1, paths: ["a/*.ts"] }, '"a/*.ts"'],
    ["an entry twice", { v: 1, paths: ["a/b.ts", "a/b.ts"] }, '"a/b.ts"'],
    ["no object", ["a/b.ts"], "touches.json"],
  ];
  for (const [what, json, named] of refused) {
    it(`refuses ${what}, naming touches.json and ${named}`, () => {
      assert.throws(() => readTouchedPaths(json), refusedNaming(TouchesRefused, "touches.json", named));
    });
  }
});

const PLAN_PATH = { path: "core/src/a.ts", artifact: "plan", line: 1, story: null };
const TASK_PATH = { path: "core/src/a.ts", artifact: "tasks", line: 40, story: "US2" };

describe("AdrAsked", () => {
  const asked = {
    v: 1,
    paths: [PLAN_PATH, TASK_PATH],
    folders: [
      { entry: "docs/adr", path: "/r/docs/adr", inside: true, governing: [{ recordId: "0004", title: "T" }], broken: [] },
      { entry: "../org/docs/adr", path: "/org/docs/adr", inside: false, outcome: { outcome: "COULD_NOT_RUN", reason: "../org/docs/adr: x" } },
    ],
  };
  it("reads each folder's answer or could-not-run, with inside, and each path's artifact", () => {
    assert.deepEqual(AdrAsked.parse(asked), asked);
  });
  it("reads an empty record, as an empty adr_folders writes it", () => {
    assert.ok(AdrAsked.safeParse({ v: 1, paths: [], folders: [] }).success);
  });
  it("refuses a path with an unknown artifact", () => {
    assert.equal(AdrAsked.safeParse({ ...asked, paths: [{ ...PLAN_PATH, artifact: "spec" }] }).success, false);
  });
  it("refuses a folder with no inside", () => {
    const { inside: _, ...folder } = asked.folders[0];
    assert.equal(AdrAsked.safeParse({ ...asked, folders: [folder] }).success, false);
  });
});

describe("AdrVerdict", () => {
  const departs = { folder: "docs/adr", record: "0004", judgment: "DEPARTS", paths: ["core/src/a.ts"], why: "it reads env" };
  const within = { folder: "docs/adr", record: "0005", judgment: "WITHIN", paths: [], why: "it stays inside" };
  it("reads a DEPARTS with paths and a WITHIN without", () => {
    assert.ok(AdrVerdict.safeParse({ v: 1, verdicts: [departs, within] }).success);
  });
  const refused: [string, unknown][] = [
    ["a DEPARTS with no path", { ...departs, paths: [] }],
    ["a WITHIN with a path", { ...within, paths: ["core/src/a.ts"] }],
    ["an empty why", { ...within, why: "" }],
    ["an artifact key", { ...departs, artifact: "plan" }],
    ["a judgment outside AdrJudgment", { ...within, judgment: "MAYBE" }],
    ["a path that is no PATH", { ...departs, paths: ["a/*.ts"] }],
  ];
  for (const [what, verdict] of refused) {
    it(`refuses ${what}`, () => assert.equal(AdrVerdict.safeParse({ v: 1, verdicts: [verdict] }).success, false));
  }
  it("refuses v other than 1", () => assert.equal(AdrVerdict.safeParse({ v: 2, verdicts: [] }).success, false));
});

const RULING = { folder: "docs/adr", record: "0004", path: "core/src/a.ts", reason: "the user says so" };

describe("AdrRuling and AdrRulings", () => {
  it("reads four non-empty strings", () => assert.deepEqual(AdrRuling.parse(RULING), RULING));
  for (const key of ["folder", "record", "path", "reason"] as const) {
    it(`refuses an empty ${key}`, () => assert.equal(AdrRuling.safeParse({ ...RULING, [key]: "" }).success, false));
  }
  it("refuses a path that is no PATH", () => assert.equal(AdrRuling.safeParse({ ...RULING, path: "a/{b,c}.ts" }).success, false));
  it("refuses another key", () => assert.equal(AdrRuling.safeParse({ ...RULING, by: "me" }).success, false));
  it("reads a rulings file", () => assert.ok(AdrRulings.safeParse({ v: 1, rulings: [RULING] }).success));
  it("refuses one (folder, record, path) twice, whatever the reason", () => {
    assert.equal(AdrRulings.safeParse({ v: 1, rulings: [RULING, { ...RULING, reason: "again" }] }).success, false);
  });
  it("reads the same record on two paths", () => {
    assert.ok(AdrRulings.safeParse({ v: 1, rulings: [RULING, { ...RULING, path: "core/src/b.ts" }] }).success);
  });
});

describe("AdrStopRecord", () => {
  const stop = { v: 1, exit: 1, lines: ["FAIL: docs/adr: x. Next step: y."], shown: false, unanswered: false };
  it("reads a stop", () => assert.deepEqual(AdrStopRecord.parse(stop), stop));
  for (const exit of [0, 3]) {
    it(`refuses exit ${exit}`, () => assert.equal(AdrStopRecord.safeParse({ ...stop, exit }).success, false));
  }
  it("refuses no line", () => assert.equal(AdrStopRecord.safeParse({ ...stop, lines: [] }).success, false));
  it("refuses another key", () => assert.equal(AdrStopRecord.safeParse({ ...stop, step: "ask" }).success, false));
  it("refuses a missing unanswered", () => {
    const { unanswered: _, ...rest } = stop;
    assert.equal(AdrStopRecord.safeParse(rest).success, false);
  });
});

describe("AdrStepDone", () => {
  for (const done of [
    { v: 1, step: "tasks-due", due: true },
    { v: 1, step: "tasks-written" },
    { v: 1, step: "stories" },
    { v: 1, step: "ask", decide: false },
    { v: 1, step: "decide" },
  ]) {
    it(`reads ${done.step}'s record`, () => assert.deepEqual(AdrStepDone.parse(done), done));
  }
  for (const [what, done] of [
    ["tasks-due without due", { v: 1, step: "tasks-due" }],
    ["ask without decide", { v: 1, step: "ask" }],
    ["stories with due", { v: 1, step: "stories", due: true }],
    ["a step it does not name", { v: 1, step: "report" }],
  ] as const) {
    it(`refuses ${what}`, () => assert.equal(AdrStepDone.safeParse(done).success, false));
  }
});

describe("sourceHashes", () => {
  const cwd = folder("hashes/checkout");
  const outside = folder("hashes/outside");
  writeFileSync(join(cwd, "a.md"), "a\n");
  mkdirSync(join(cwd, "s"));
  writeFileSync(join(cwd, "s", "b.md"), "b\n");
  writeFileSync(join(outside, "0001.md"), "r\n");

  it("keys each present file repo-relative under cwd, absolute outside it, and leaves an absent one out", async () => {
    const hashes = await sourceHashes(cwd, ["a.md", "s/b.md", "gone.md", join(outside, "0001.md")]);
    assert.deepEqual(Object.keys(hashes.files).sort(), ["a.md", join(outside, "0001.md"), "s/b.md"].sort());
    assert.match(hashes.files["a.md"], /^[0-9a-f]{64}$/);
    assert.ok(SourceHashes.safeParse(hashes).success);
  });

  it("is equal for unchanged bytes and unequal for a changed or removed file", async () => {
    const before = await sourceHashes(cwd, ["a.md", "s/b.md"]);
    assert.deepEqual(await sourceHashes(cwd, ["s/b.md", "a.md"]), before);
    writeFileSync(join(cwd, "a.md"), "a changed\n");
    assert.notDeepEqual(await sourceHashes(cwd, ["a.md", "s/b.md"]), before);
    rmSync(join(cwd, "s", "b.md"));
    assert.deepEqual(Object.keys((await sourceHashes(cwd, ["a.md", "s/b.md"])).files), ["a.md"]);
  });

  it("refuses a hash that is no sha256", () => {
    assert.equal(SourceHashes.safeParse({ v: 1, files: { "a.md": "x" } }).success, false);
  });
});

describe("tasksSourcePaths and roundInputPaths", () => {
  const cwd = folder("sources/checkout");
  const spec = "specs/7-x";
  mkdirSync(join(cwd, spec, "contracts", "deep"), { recursive: true });
  mkdirSync(join(cwd, ".specify", "memory"), { recursive: true });
  for (const name of ["spec.md", "plan.md", "tasks.md", "notes.md", "contracts/a.md", "contracts/deep/b.md"]) {
    writeFileSync(join(cwd, spec, name), name);
  }
  const adr = folder("sources/org/docs/adr");
  mkdirSync(join(adr, "sub"));
  writeFileSync(join(adr, "0001-x.md"), "r");
  writeFileSync(join(adr, "sub", "0002-y.md"), "r");
  const run = ".specify/workflows/runs/r1";
  mkdirSync(join(cwd, run), { recursive: true });

  it("lists every file the tasks command reads, contracts/ in full, present or not", async () => {
    assert.deepEqual(
      (await tasksSourcePaths(cwd, spec)).sort(),
      [
        `${spec}/spec.md`,
        `${spec}/plan.md`,
        `${spec}/research.md`,
        `${spec}/data-model.md`,
        `${spec}/quickstart.md`,
        `${spec}/contracts/a.md`,
        `${spec}/contracts/deep/b.md`,
        ".specify/memory/constitution.md",
      ].sort(),
    );
  });

  it("adds tasks.md, the rulings file, codeworks.toml and every file of each folder; review-questions.json only when present", async () => {
    const without = await roundInputPaths(cwd, spec, run, [adr]);
    for (const path of [`${spec}/tasks.md`, `${spec}/adr-rulings.json`, "codeworks.toml", join(adr, "0001-x.md"), join(adr, "sub", "0002-y.md")]) {
      assert.ok(without.includes(path), `${path} not in ${without.join(", ")}`);
    }
    assert.ok(!without.some((path) => path.endsWith("review-questions.json")));
    writeFileSync(join(cwd, run, "review-questions.json"), "{}");
    assert.ok((await roundInputPaths(cwd, spec, run, [adr])).includes(`${run}/review-questions.json`));
  });

  it("lists no file of a folder that cannot be read, which ask reports as could not run", async () => {
    const paths = await roundInputPaths(cwd, spec, run, [join(scratch, "sources", "missing")]);
    assert.ok(!paths.some((path) => path.includes("missing")));
  });

  it("follows a listed folder given through a symlink", async () => {
    const link = join(scratch, "sources", "linked");
    symlinkSync(adr, link);
    assert.ok((await roundInputPaths(cwd, spec, run, [link])).includes(join(link, "0001-x.md")));
  });
});

describe("readRulings", () => {
  const spec = folder("rulings/specs/7-x");
  it("is [] when the file is absent", async () => assert.deepEqual(await readRulings(spec), []));
  it("reads the rulings", async () => {
    writeFileSync(join(spec, "adr-rulings.json"), JSON.stringify({ v: 1, rulings: [RULING] }));
    assert.deepEqual(await readRulings(spec), [RULING]);
  });
  for (const [what, text] of [
    ["not JSON", "{"],
    ["not rulings", JSON.stringify({ v: 1, rulings: [{ ...RULING, reason: "" }] })],
  ] as const) {
    it(`refuses a file that is ${what}, naming it, never reading it as empty`, async () => {
      writeFileSync(join(spec, "adr-rulings.json"), text);
      await assert.rejects(readRulings(spec), refusedNaming(RulingsRefused, "adr-rulings.json"));
    });
  }
});
