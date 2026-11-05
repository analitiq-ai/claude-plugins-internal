import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, type TestContext } from "node:test";

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
  SourceHashes,
  sourceHashes,
  tasksSourcePaths,
  TouchesRefused,
} from "../src/contracts/decision-check.ts";
import { GitFailed, runGit } from "../src/git.ts";
import { couldNotRun } from "../src/outcomes.ts";
import { AdrJudgment, CheckedArtifact } from "../src/values.ts";

// Spec 177, US3 (T016): contracts/artifact-grammar.md's path grammar, then each run-folder and spec-folder file's
// schema as data-model.md gives it.

const ROOT_FILES: ReadonlySet<string> = new Set(["codeworks.toml", "README.md"]);

// Path-shaped spans naming files the check cannot list: a glob or brace character, or a `.`/`..` segment.
const UNLISTABLE = [
  "a/*.ts",
  "a/b?.ts",
  "a/[ab].ts",
  "a/{b,c}.ts",
  "core/src/**",
  "a/./b.ts",
  "a/../b.ts",
  "../a/b.ts",
  "./a/b.ts",
];

// No PATH, each for a reason the grammar names: the unlistable spans, a trailing `/`, an absolute path, an empty
// segment, a space, a character outside the grammar, a URL, nothing at all.
const NOT_PATHS = [...UNLISTABLE, "core/src/", "/abs/x.ts", "a//b.ts", "a b.ts", "<run>/x", "https://example.test/a", ""];

function refusedNaming<E extends Error>(kind: new (...args: never[]) => E, ...named: string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof kind, `expected ${kind.name}, got ${String(error)}`);
    for (const name of named) assert.ok(error.message.includes(name), `${JSON.stringify(name)} not named: ${error.message}`);
    return true;
  };
}

function tempFolder(t: TestContext): string {
  const folder = mkdtempSync(join(tmpdir(), "core-decision-check-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const RULING = { folder: "docs/adr", record: "0004", path: "core/src/adr.ts", reason: "the user keeps tracked discovery here" };
const OTHER_RULING = { folder: "../org/docs/adr", record: "0001", path: "codeworks.toml", reason: "an org record the user overrules" };

describe("CheckedArtifact", () => {
  it("names the two artifacts a path can come from: plan and tasks", () => {
    assert.deepEqual(new Set(CheckedArtifact.schema.options), new Set(["plan", "tasks"]));
  });
});

describe("artifactPath", () => {
  describe('a touches.json entry ("any")', () => {
    for (const span of ["core/src/adr-folders.ts", "codeworks.toml", "planner/plugin/scripts/adr_check.ts", ".specify/x.md"]) {
      it(`returns the PATH ${span}`, () => {
        assert.equal(artifactPath(span, "any"), span);
      });
    }

    for (const span of NOT_PATHS) {
      it(`refuses ${JSON.stringify(span)}, no PATH, naming it`, () => {
        assert.throws(() => artifactPath(span, "any"), refusedNaming(PathRefused, span));
      });
    }
  });

  describe("a tasks.md span", () => {
    it("returns a PATH with a /", () => {
      assert.equal(artifactPath("core/src/contracts/decision-check.ts", ROOT_FILES), "core/src/contracts/decision-check.ts");
    });

    it("returns a PATH with no / that rootFiles holds", () => {
      assert.equal(artifactPath("codeworks.toml", ROOT_FILES), "codeworks.toml");
    });

    it("reads a PATH with no / that rootFiles does not hold as no path", () => {
      assert.equal(artifactPath("package.json", ROOT_FILES), null);
    });

    for (const span of UNLISTABLE) {
      it(`refuses ${JSON.stringify(span)}, which names paths the check cannot list, naming it`, () => {
        assert.throws(() => artifactPath(span, ROOT_FILES), refusedNaming(PathRefused, span));
      });
    }

    for (const [what, span] of [
      ["a command", "adr check"],
      ["a command naming a path", "node planner/plugin/scripts/adr_check.ts ask"],
      ["a command naming a glob", "rm -f a/*.ts"],
      ["a URL", "https://github.com/acme/widgets/issues/7"],
      ["a placeholder", "<run>/x"],
      ["a word", "adr_folders"],
    ]) {
      it(`reads ${what}, ${JSON.stringify(span)}, as no path`, () => {
        assert.equal(artifactPath(span, ROOT_FILES), null);
      });
    }
  });
});

describe("readTouchedPaths", () => {
  it("reads each entry as the plan's, with its 1-based index as its line and no story", () => {
    assert.deepEqual(readTouchedPaths({ v: 1, paths: ["core/src/adr-folders.ts", "codeworks.toml"] }), [
      { path: "core/src/adr-folders.ts", artifact: "plan", line: 1, story: null },
      { path: "codeworks.toml", artifact: "plan", line: 2, story: null },
    ]);
  });

  // No path is the script's to stop on, as could not run, not the reader's to refuse.
  it("reads an empty list as no path", () => {
    assert.deepEqual(readTouchedPaths({ v: 1, paths: [] }), []);
  });

  const refusals: [string, unknown, string][] = [
    ["an extra key", { v: 1, paths: ["core/src/x.ts"], extra: true }, "extra"],
    ["no paths", { v: 1 }, "paths"],
    // zod names the key after "→ at"; a bare "v" would be found in "Invalid".
    ["no v", { paths: ["core/src/x.ts"] }, "→ at v"],
    ["a v other than 1", { v: 2, paths: ["core/src/x.ts"] }, "→ at v"],
    ["paths that are not a list", { v: 1, paths: "core/src/x.ts" }, "paths"],
    ["an entry that is not text", { v: 1, paths: ["core/src/x.ts", 3] }, "paths"],
    ["an entry twice", { v: 1, paths: ["core/src/x.ts", "lib/y.ts", "core/src/x.ts"] }, "core/src/x.ts"],
    ...NOT_PATHS.filter((entry) => entry !== "").map(
      (entry): [string, unknown, string] => [`the entry ${JSON.stringify(entry)}, no PATH`, { v: 1, paths: [entry] }, entry],
    ),
  ];
  for (const [what, json, named] of refusals) {
    it(`refuses ${what}, naming touches.json and it`, () => {
      assert.throws(() => readTouchedPaths(json), refusedNaming(TouchesRefused, "touches.json", named));
    });
  }

  for (const json of [null, [], "core/src/x.ts"]) {
    it(`refuses ${JSON.stringify(json)}, no object, naming touches.json`, () => {
      assert.throws(() => readTouchedPaths(json), refusedNaming(TouchesRefused, "touches.json"));
    });
  }
});

describe("AdrAsked", () => {
  const answered = {
    entry: "docs/adr",
    path: "/work/widgets/docs/adr",
    inside: true,
    governing: [{ recordId: "0004", title: "Read the folders from settings" }],
    broken: [
      { file: "docs/adr/0009-new.md", rule: "frontmatter-fence", message: "ADR files must start with a leading --- YAML frontmatter fence" },
    ],
  };
  const notRun = {
    entry: "../org/docs/adr",
    path: "/work/org/docs/adr",
    inside: false,
    outcome: couldNotRun(
      "../org/docs/adr",
      "not a readable folder, so adr was not called. Next step: make /work/org/docs/adr a readable folder, or remove " +
        "the entry from [shared] adr_folders.",
    ),
  };
  const planPath = { path: "core/src/x.ts", artifact: "plan", line: 1, story: null };
  const taskPath = { path: "core/src/x.ts", artifact: "tasks", line: 12, story: "US2" };
  const asked = { v: 1, paths: [planPath, taskPath], folders: [answered, notRun] };

  it("reads each folder, answered or not run, with whether it lies inside the checkout", () => {
    const read = AdrAsked.parse(asked) as typeof asked;
    assert.deepEqual(
      read.folders.map((folder) => [folder.entry, folder.inside]),
      [
        ["docs/adr", true],
        ["../org/docs/adr", false],
      ],
    );
    assert.deepEqual(read, asked);
  });

  it("reads one path named by both artifacts as one entry per artifact, a task's with its story", () => {
    const read = AdrAsked.parse(asked) as typeof asked;
    assert.deepEqual(
      read.paths.map(({ path, artifact, story }) => [path, artifact, story]),
      [
        ["core/src/x.ts", "plan", null],
        ["core/src/x.ts", "tasks", "US2"],
      ],
    );
  });

  it("reads the record an empty adr_folders writes: no path and no folder", () => {
    const empty = { v: 1, paths: [], folders: [] };
    assert.deepEqual(AdrAsked.parse(empty), empty);
  });

  for (const [what, record] of [
    ["an answered folder with no inside", { ...asked, folders: [{ ...answered, inside: undefined }] }],
    ["a folder not run with no inside", { ...asked, folders: [{ ...notRun, inside: undefined }] }],
    ["an inside that is not a boolean", { ...asked, folders: [{ ...answered, inside: "yes" }] }],
    ["a path with no artifact", { ...asked, paths: [{ ...planPath, artifact: undefined }] }],
    ["a path whose artifact is no CheckedArtifact", { ...asked, paths: [{ ...planPath, artifact: "spec" }] }],
    ["a key the record does not hold", { ...asked, artifact: "plan" }],
    ["a v other than 1", { ...asked, v: 2 }],
  ] as const) {
    it(`refuses ${what}`, () => {
      assert.equal(AdrAsked.safeParse(record).success, false);
    });
  }
});

describe("AdrVerdict", () => {
  const departs = {
    folder: "docs/adr",
    record: "0004",
    judgment: "DEPARTS",
    paths: ["core/src/x.ts"],
    why: "it reads the folders from tracked discovery",
  };
  const within = { folder: "../org/docs/adr", record: "0001", judgment: "WITHIN", paths: [], why: "it keeps the org records where they are" };
  const verdict = { v: 1, verdicts: [departs, within] };

  it("reads one verdict per record, each folder the entry as written", () => {
    assert.deepEqual(AdrVerdict.parse(verdict), verdict);
  });

  it("reads one record id judged in two folders", () => {
    const twoFolders = { ...verdict, verdicts: [departs, { ...within, record: departs.record }] };
    assert.deepEqual(AdrVerdict.parse(twoFolders), twoFolders);
  });

  it("refuses one record of one folder judged twice", () => {
    const twice = { ...verdict, verdicts: [departs, { ...within, folder: departs.folder, record: departs.record }] };
    assert.equal(AdrVerdict.safeParse(twice).success, false);
  });

  it("judges by the AdrJudgment value set: WITHIN or DEPARTS", () => {
    assert.deepEqual(new Set(AdrJudgment.schema.options), new Set(["WITHIN", "DEPARTS"]));
  });

  for (const [what, record] of [
    ["a judgment that is no AdrJudgment", { ...verdict, verdicts: [{ ...within, judgment: "PASS" }] }],
    ["a DEPARTS on no path", { ...verdict, verdicts: [{ ...departs, paths: [] }] }],
    ["a WITHIN naming a path", { ...verdict, verdicts: [{ ...within, paths: ["core/src/x.ts"] }] }],
    ["an empty why", { ...verdict, verdicts: [{ ...within, why: "" }] }],
    ["no why", { ...verdict, verdicts: [{ ...within, why: undefined }] }],
    ["a v other than 1", { ...verdict, v: 2 }],
    // One verdict covers plan.md and tasks.md together, so it names no artifact.
    ["an artifact key", { ...verdict, artifact: "plan" }],
  ] as const) {
    it(`refuses ${what}`, () => {
      assert.equal(AdrVerdict.safeParse(record).success, false);
    });
  }
});

describe("AdrRuling", () => {
  it("reads four non-empty strings", () => {
    assert.deepEqual(AdrRuling.parse(RULING), RULING);
  });

  for (const key of ["folder", "record", "path", "reason"] as const) {
    it(`refuses an empty ${key}`, () => {
      assert.equal(AdrRuling.safeParse({ ...RULING, [key]: "" }).success, false);
    });

    it(`refuses no ${key}`, () => {
      assert.equal(AdrRuling.safeParse({ ...RULING, [key]: undefined }).success, false);
    });

    it(`refuses a ${key} that is not text`, () => {
      assert.equal(AdrRuling.safeParse({ ...RULING, [key]: 4 }).success, false);
    });
  }

  for (const path of NOT_PATHS.filter((entry) => entry !== "")) {
    it(`refuses the path ${JSON.stringify(path)}, no PATH`, () => {
      assert.equal(AdrRuling.safeParse({ ...RULING, path }).success, false);
    });
  }

  it("refuses another key", () => {
    assert.equal(AdrRuling.safeParse({ ...RULING, story: "US2" }).success, false);
  });
});

describe("AdrRulings", () => {
  it("reads v 1 and the rulings, one folder, record and path each", () => {
    const rulings = {
      v: 1,
      rulings: [
        RULING,
        OTHER_RULING,
        { ...RULING, path: "core/src/adr-folders.ts" },
        { ...RULING, folder: OTHER_RULING.folder },
        { ...RULING, record: "0005" },
      ],
    };
    assert.deepEqual(AdrRulings.parse(rulings), rulings);
  });

  it("refuses one folder, record and path twice, whatever the reasons", () => {
    assert.equal(AdrRulings.safeParse({ v: 1, rulings: [RULING, { ...RULING, reason: "said again" }] }).success, false);
  });

  it("refuses a v other than 1", () => {
    assert.equal(AdrRulings.safeParse({ v: 2, rulings: [RULING] }).success, false);
  });

  it("refuses a ruling that is no AdrRuling", () => {
    assert.equal(AdrRulings.safeParse({ v: 1, rulings: [{ ...RULING, reason: "" }] }).success, false);
  });
});

describe("AdrStopRecord", () => {
  const record = {
    v: 1,
    exit: 1,
    lines: ["FAIL: docs/adr: 0004 on core/src/x.ts: it reads the folders from discovery. Next step: change plan.md."],
    shown: false,
    unanswered: false,
  };

  it("reads an exit of 1 or 2, shown or not, unanswered or not", () => {
    for (const exit of [1, 2]) {
      for (const shown of [false, true]) {
        for (const unanswered of [false, true]) {
          const read = { ...record, exit, shown, unanswered };
          assert.deepEqual(AdrStopRecord.parse(read), read);
        }
      }
    }
  });

  for (const [what, value] of [
    ["an exit of 0, which is no stop", { ...record, exit: 0 }],
    ["an exit of 3", { ...record, exit: 3 }],
    ["an exit that is not a number", { ...record, exit: "1" }],
    ["no line", { ...record, lines: [] }],
    ["no lines", { ...record, lines: undefined }],
    ["a line that is not text", { ...record, lines: [1] }],
    ["no shown", { ...record, shown: undefined }],
    ["a shown that is not a boolean", { ...record, shown: "no" }],
    ["no unanswered", { ...record, unanswered: undefined }],
    ["an unanswered that is not a boolean", { ...record, unanswered: "no" }],
    ["a v other than 1", { ...record, v: 2 }],
    ["another key", { ...record, step: "adr-decide" }],
  ] as const) {
    it(`refuses ${what}`, () => {
      assert.equal(AdrStopRecord.safeParse(value).success, false);
    });
  }
});

describe("AdrStepDone", () => {
  const records = [
    { v: 1, step: "tasks-due", due: true },
    { v: 1, step: "tasks-due", due: false },
    { v: 1, step: "tasks-written" },
    { v: 1, step: "stories" },
    { v: 1, step: "ask", decide: true },
    { v: 1, step: "ask", decide: false },
    { v: 1, step: "decide" },
  ];
  for (const record of records) {
    it(`reads ${JSON.stringify(record)}`, () => {
      assert.deepEqual(AdrStepDone.parse(record), record);
    });
  }

  for (const [what, value] of [
    ["tasks-due with no due", { v: 1, step: "tasks-due" }],
    ["tasks-due with a due that is not a boolean", { v: 1, step: "tasks-due", due: "yes" }],
    ["ask with no decide", { v: 1, step: "ask" }],
    ["ask with a decide that is not a boolean", { v: 1, step: "ask", decide: 1 }],
    ["tasks-written with a due", { v: 1, step: "tasks-written", due: true }],
    ["stories with another key", { v: 1, step: "stories", story: "US1" }],
    ["decide with a decide", { v: 1, step: "decide", decide: true }],
    // clear and report write no done record, and a model step's outcome is recorded by the shell step after it.
    ["clear", { v: 1, step: "clear" }],
    ["report", { v: 1, step: "report" }],
    ["a model step", { v: 1, step: "touches" }],
    ["no step", { v: 1 }],
    ["a v other than 1", { v: 2, step: "stories" }],
  ] as const) {
    it(`refuses ${what}`, () => {
      assert.equal(AdrStepDone.safeParse(value).success, false);
    });
  }
});

describe("SourceHashes", () => {
  const hashes = { v: 1, files: { "specs/7-x/plan.md": sha256("plan"), "/elsewhere/org/docs/adr/0001-x.md": sha256("record") } };

  it("reads v 1 and a map from each path to its sha256", () => {
    assert.deepEqual(SourceHashes.parse(hashes), hashes);
  });

  it("reads no file as an empty map", () => {
    assert.deepEqual(SourceHashes.parse({ v: 1, files: {} }), { v: 1, files: {} });
  });

  for (const [what, value] of [
    ["no files", { v: 1 }],
    ["files that are a list", { v: 1, files: ["specs/7-x/plan.md"] }],
    ["a hash that is not text", { v: 1, files: { "specs/7-x/plan.md": 7 } }],
    ["another key", { ...hashes, at: "2026-11-04" }],
    ["a v other than 1", { ...hashes, v: 2 }],
  ] as const) {
    it(`refuses ${what}`, () => {
      assert.equal(SourceHashes.safeParse(value).success, false);
    });
  }
});

describe("sourceHashes", () => {
  /** cwd `project` of a checkout, its top by default; `outside` a folder outside the checkout. */
  async function checkout(t: TestContext, project = "."): Promise<{ cwd: string; outside: string }> {
    const root = tempFolder(t);
    const top = join(root, "widgets");
    const cwd = join(top, project);
    const outside = join(root, "org", "docs", "adr");
    mkdirSync(join(cwd, "specs", "7-x"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    await runGit(top, ["init", "-q", "-b", "main"]);
    writeFileSync(join(cwd, "specs", "7-x", "plan.md"), "# Plan\n");
    writeFileSync(join(cwd, "specs", "7-x", "spec.md"), "# Spec\n");
    writeFileSync(join(outside, "0001-x.md"), "# ADR-0001\n");
    return { cwd, outside };
  }

  it("keys each file in the checkout repo-relative and one outside it by its absolute path, each the sha256 of its bytes", async (t) => {
    const { cwd, outside } = await checkout(t);
    const record = join(outside, "0001-x.md");
    assert.deepEqual(await sourceHashes(cwd, ["specs/7-x/plan.md", join(cwd, "specs", "7-x", "spec.md"), record]), {
      v: 1,
      files: { "specs/7-x/plan.md": sha256("# Plan\n"), "specs/7-x/spec.md": sha256("# Spec\n"), [record]: sha256("# ADR-0001\n") },
    });
  });

  // data-model.md Source hashes: "the path repo-relative under the checkout".
  it("keys a file repo-relative from the checkout's top when cwd is a project below it", async (t) => {
    const { cwd } = await checkout(t, "tools");
    assert.deepEqual(await sourceHashes(cwd, ["specs/7-x/plan.md"]), {
      v: 1,
      files: { "tools/specs/7-x/plan.md": sha256("# Plan\n") },
    });
  });

  it("keys a file repo-relative by its realpath or through cwd when cwd reaches the checkout through a symlink", async (t) => {
    const { cwd } = await checkout(t);
    const link = join(dirname(cwd), "link");
    symlinkSync(cwd, link);
    assert.deepEqual(await sourceHashes(link, ["specs/7-x/plan.md", join(cwd, "specs", "7-x", "spec.md")]), {
      v: 1,
      files: { "specs/7-x/plan.md": sha256("# Plan\n"), "specs/7-x/spec.md": sha256("# Spec\n") },
    });
  });

  it("is GitFailed outside a git checkout", async (t) => {
    const folder = tempFolder(t);
    const ceiling = process.env.GIT_CEILING_DIRECTORIES;
    // git stops looking for a checkout at the folder's parent, wherever the temp folder lies.
    process.env.GIT_CEILING_DIRECTORIES = dirname(folder);
    t.after(() => {
      if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = ceiling;
    });
    await assert.rejects(sourceHashes(folder, []), GitFailed);
  });

  it("leaves an absent file out", async (t) => {
    const { cwd } = await checkout(t);
    assert.deepEqual(await sourceHashes(cwd, ["specs/7-x/plan.md", "specs/7-x/research.md"]), {
      v: 1,
      files: { "specs/7-x/plan.md": sha256("# Plan\n") },
    });
  });

  it("is equal for files whose bytes are unchanged", async (t) => {
    const { cwd, outside } = await checkout(t);
    const paths = ["specs/7-x/plan.md", "specs/7-x/spec.md", join(outside, "0001-x.md")];
    const before = await sourceHashes(cwd, paths);
    writeFileSync(join(cwd, "specs", "7-x", "plan.md"), "# Plan\n");
    assert.deepEqual(await sourceHashes(cwd, paths), before);
  });

  it("is unequal once a file changes, inside cwd or out", async (t) => {
    const { cwd, outside } = await checkout(t);
    const paths = ["specs/7-x/plan.md", join(outside, "0001-x.md")];
    const before = await sourceHashes(cwd, paths);
    writeFileSync(join(cwd, "specs", "7-x", "plan.md"), "# Plan, changed\n");
    assert.notDeepEqual(await sourceHashes(cwd, paths), before);
    writeFileSync(join(cwd, "specs", "7-x", "plan.md"), "# Plan\n");
    writeFileSync(join(outside, "0001-x.md"), "# ADR-0001, changed\n");
    assert.notDeepEqual(await sourceHashes(cwd, paths), before);
  });

  it("is unequal once a file is removed", async (t) => {
    const { cwd } = await checkout(t);
    const paths = ["specs/7-x/plan.md", "specs/7-x/spec.md"];
    const before = await sourceHashes(cwd, paths);
    rmSync(join(cwd, "specs", "7-x", "spec.md"));
    assert.notDeepEqual(await sourceHashes(cwd, paths), before);
  });
});

describe("tasksSourcePaths and roundInputPaths", () => {
  const SPEC = "specs/7-x";
  const RUN = ".specify/workflows/runs/r1";
  const TASKS_SOURCES = [
    `${SPEC}/spec.md`,
    `${SPEC}/plan.md`,
    `${SPEC}/research.md`,
    `${SPEC}/data-model.md`,
    `${SPEC}/quickstart.md`,
    `${SPEC}/contracts/a.md`,
    `${SPEC}/contracts/nested/b.md`,
    ".specify/memory/constitution.md",
  ];

  /** cwd `path` of a checkout; `settings` the realpath of its top's codeworks.toml. */
  async function project(t: TestContext, path: string): Promise<{ cwd: string; settings: string }> {
    const top = tempFolder(t);
    await runGit(top, ["init", "-q", "-b", "main"]);
    const cwd = join(top, path);
    for (const folder of [join(SPEC, "contracts", "nested"), join("docs", "adr", "drafts")]) mkdirSync(join(cwd, folder), { recursive: true });
    for (const file of [`${SPEC}/contracts/a.md`, `${SPEC}/contracts/nested/b.md`, "docs/adr/0004-x.md", "docs/adr/drafts/0005-y.md"]) {
      writeFileSync(join(cwd, file), "# x\n");
    }
    return { cwd, settings: join(realpathSync(top), "codeworks.toml") };
  }

  it("lists every file the tasks command reads, each spec-folder file whether or not it exists", async (t) => {
    const { cwd } = await project(t, ".");
    for (const file of ["spec.md", "plan.md"]) writeFileSync(join(cwd, SPEC, file), "# x\n");
    assert.deepEqual(await tasksSourcePaths(cwd, SPEC), TASKS_SOURCES);
  });

  for (const [where, path] of [
    ["at the checkout's top", "."],
    ["in a project below the checkout's top", "planner"],
  ] as const) {
    it(`lists the tasks sources, tasks.md, the rulings file, the checkout's settings, review questions and each listed folder's files: ${where}`, async (t) => {
      const { cwd, settings } = await project(t, path);
      assert.deepEqual(await roundInputPaths(cwd, SPEC, RUN, ["docs/adr"]), [
        ...TASKS_SOURCES,
        `${SPEC}/tasks.md`,
        `${SPEC}/adr-rulings.json`,
        settings,
        `${RUN}/review-questions.json`,
        "docs/adr/0004-x.md",
        "docs/adr/drafts/0005-y.md",
      ]);
    });
  }

  for (const [what, make] of [
    ["missing", () => {}],
    ["a symlink loop", (folder: string) => symlinkSync("unreachable", folder)],
  ] as const) {
    it(`lists no file of a listed folder that is ${what}`, async (t) => {
      const { cwd, settings } = await project(t, ".");
      make(join(cwd, "docs", "unreachable"));
      assert.deepEqual(await roundInputPaths(cwd, SPEC, RUN, ["docs/unreachable"]), [
        ...TASKS_SOURCES,
        `${SPEC}/tasks.md`,
        `${SPEC}/adr-rulings.json`,
        settings,
        `${RUN}/review-questions.json`,
      ]);
    });
  }

  it(
    "lists no file of a listed folder it can read but not search",
    { skip: process.getuid?.() === 0 && "root searches a chmod 444 folder" },
    async (t) => {
      const { cwd, settings } = await project(t, ".");
      const unsearchable = join(cwd, "docs", "adr");
      chmodSync(unsearchable, 0o444);
      try {
        assert.deepEqual(await roundInputPaths(cwd, SPEC, RUN, ["docs/adr"]), [
          ...TASKS_SOURCES,
          `${SPEC}/tasks.md`,
          `${SPEC}/adr-rulings.json`,
          settings,
          `${RUN}/review-questions.json`,
        ]);
      } finally {
        chmodSync(unsearchable, 0o755);
      }
    },
  );

  it(
    "refuses a listed folder holding a folder it cannot read, naming that folder",
    { skip: process.getuid?.() === 0 && "root reads a chmod 000 folder" },
    async (t) => {
      const { cwd } = await project(t, ".");
      const locked = join(cwd, "docs", "adr", "locked");
      mkdirSync(locked);
      chmodSync(locked, 0o000);
      try {
        await assert.rejects(roundInputPaths(cwd, SPEC, RUN, ["docs/adr"]), (error: NodeJS.ErrnoException) => {
          assert.equal(error.code, "EACCES", String(error));
          assert.equal(error.path, locked);
          return true;
        });
      } finally {
        chmodSync(locked, 0o755);
      }
    },
  );

  it("is GitFailed outside a git checkout", async (t) => {
    const folder = tempFolder(t);
    const ceiling = process.env.GIT_CEILING_DIRECTORIES;
    // git stops looking for a checkout at the folder's parent, wherever the temp folder lies.
    process.env.GIT_CEILING_DIRECTORIES = dirname(folder);
    t.after(() => {
      if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = ceiling;
    });
    await assert.rejects(roundInputPaths(folder, SPEC, RUN, []), GitFailed);
  });
});

describe("readRulings", () => {
  it("reads no file as no ruling", async (t) => {
    assert.deepEqual(await readRulings(tempFolder(t)), []);
  });

  it("reads the spec folder's adr-rulings.json", async (t) => {
    const folder = tempFolder(t);
    writeFileSync(join(folder, "adr-rulings.json"), JSON.stringify({ v: 1, rulings: [RULING, OTHER_RULING] }));
    assert.deepEqual(await readRulings(folder), [RULING, OTHER_RULING]);
  });

  for (const [what, text] of [
    ["an empty file", ""],
    ["text that is not JSON", "{ v: 1, rulings: [] "],
    ["JSON that is no AdrRulings", JSON.stringify({ v: 1, rulings: [{ ...RULING, path: "core/src/*.ts" }] })],
    ["one key twice", JSON.stringify({ v: 1, rulings: [RULING, RULING] })],
  ]) {
    it(`refuses ${what}, never reading it as empty, naming the file`, async (t) => {
      const folder = tempFolder(t);
      writeFileSync(join(folder, "adr-rulings.json"), text);
      await assert.rejects(readRulings(folder), refusedNaming(RulingsRefused, "adr-rulings.json"));
    });
  }
});
