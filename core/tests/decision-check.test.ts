import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import {
  AdrAsked,
  AdrRuling,
  AdrRulings,
  AdrStopRecord,
  AdrVerdict,
  artifactPath,
  PathRefused,
  readRulings,
  readTouchedPaths,
  RulingsRefused,
  stopFile,
  TouchesRefused,
} from "../src/contracts/decision-check.ts";
import { couldNotRun } from "../src/outcomes.ts";
import { AdrJudgment } from "../src/values.ts";

// Spec 177, US3: contracts/artifact-grammar.md's path grammar, then each run-folder and spec-folder file's schema
// as data-model.md gives it.

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

function specFolder(t: TestContext): string {
  const folder = mkdtempSync(join(tmpdir(), "core-decision-check-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

const RULING = { folder: "docs/adr", record: "0004", path: "core/src/adr.ts", reason: "the user keeps tracked discovery here" };
const OTHER_RULING = { folder: "../org/docs/adr", record: "0001", path: "codeworks.toml", reason: "an org record the user overrules" };

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
      ["a command naming a path", "node planner/plugin/scripts/adr_check.ts ask plan"],
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
  it("reads each entry with its 1-based index as its line and no story", () => {
    assert.deepEqual(readTouchedPaths({ v: 1, paths: ["core/src/adr-folders.ts", "codeworks.toml"] }), [
      { path: "core/src/adr-folders.ts", line: 1, story: null },
      { path: "codeworks.toml", line: 2, story: null },
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
  const asked = { v: 1, artifact: "plan", paths: [{ path: "core/src/x.ts", line: 1, story: null }], folders: [answered, notRun] };

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

  it("reads the record an empty adr_folders writes: no path and no folder", () => {
    const empty = { v: 1, artifact: "plan", paths: [], folders: [] };
    assert.deepEqual(AdrAsked.parse(empty), empty);
  });

  it("reads a tasks record, each path with its story", () => {
    const tasks = { ...asked, artifact: "tasks", paths: [{ path: "core/src/x.ts", line: 12, story: "US2" }] };
    assert.deepEqual(AdrAsked.parse(tasks), tasks);
  });

  for (const [what, record] of [
    ["an answered folder with no inside", { ...asked, folders: [{ ...answered, inside: undefined }] }],
    ["a folder not run with no inside", { ...asked, folders: [{ ...notRun, inside: undefined }] }],
    ["an inside that is not a boolean", { ...asked, folders: [{ ...answered, inside: "yes" }] }],
    ["an artifact that is no CheckedArtifact", { ...asked, artifact: "spec" }],
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
  const verdict = { v: 1, artifact: "plan", verdicts: [departs, within] };

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
    ["an artifact that is no CheckedArtifact", { ...verdict, artifact: "spec" }],
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

describe("stopFile", () => {
  it("names each check's stop record in the run folder", () => {
    assert.deepEqual([stopFile("plan"), stopFile("tasks")], ["adr-plan-stop.json", "adr-tasks-stop.json"]);
  });
});

describe("AdrStopRecord", () => {
  const record = {
    v: 1,
    exit: 1,
    lines: ["FAIL: docs/adr: 0004 on core/src/x.ts: it reads the folders from discovery. Next step: change plan.md."],
    shown: false,
  };

  it("reads a stop not yet shown, and one shown, exiting 1 or 2", () => {
    for (const read of [record, { ...record, exit: 2, shown: true }]) assert.deepEqual(AdrStopRecord.parse(read), read);
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
    ["a v other than 1", { ...record, v: 2 }],
    ["another key", { ...record, step: "adr-plan-decide" }],
  ] as const) {
    it(`refuses ${what}`, () => {
      assert.equal(AdrStopRecord.safeParse(value).success, false);
    });
  }
});

describe("readRulings", () => {
  it("reads no file as no ruling", async (t) => {
    assert.deepEqual(await readRulings(specFolder(t)), []);
  });

  it("reads the spec folder's adr-rulings.json", async (t) => {
    const folder = specFolder(t);
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
      const folder = specFolder(t);
      writeFileSync(join(folder, "adr-rulings.json"), text);
      await assert.rejects(readRulings(folder), refusedNaming(RulingsRefused, "adr-rulings.json"));
    });
  }
});
