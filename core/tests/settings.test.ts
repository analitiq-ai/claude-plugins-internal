import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSection, readSettings, SettingsError, SHARED_SECTION } from "../src/settings.ts";
import { NotInTree, type Tree } from "../src/tree.ts";

const REF = "212-us2-retry-budget";

const EXAMPLE = `[shared]
validators = ["fixture"]
trusted_reviewers = ["alice"]
board = "https://github.com/orgs/example-org/projects/1"
session_app_login = "codeworks-session[bot]"
orchestrator_app_login = "codeworks-orchestrator[bot]"
reviewer_app_login = "codeworks-reviewer[bot]"
planner_app_login = "codeworks-planner[bot]"
adr_folders = []

[reviewer]
# validated by reviewer
`;

const EXAMPLE_SHARED = {
  validators: ["fixture"],
  trusted_reviewers: ["alice"],
  board: "https://github.com/orgs/example-org/projects/1",
  session_app_login: "codeworks-session[bot]",
  orchestrator_app_login: "codeworks-orchestrator[bot]",
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
  adr_folders: [],
};

const REQUIRED_KEYS = [
  "validators",
  "board",
  "session_app_login",
  "orchestrator_app_login",
  "reviewer_app_login",
  "planner_app_login",
  "adr_folders",
];

const APP_LOGIN_KEYS = ["session_app_login", "orchestrator_app_login", "reviewer_app_login", "planner_app_login"];

/** A tree of root-level files at one ref, so it holds no directory. */
function treeAt(files: Record<string, string>, ref = REF): Tree {
  return {
    async listDir(path) {
      throw new NotInTree(path, ref, "directory");
    },
    async readText(path) {
      if (!Object.hasOwn(files, path)) throw new NotInTree(path, ref, "file");
      return files[path];
    },
  };
}

function settingsOf(text: string) {
  return readSettings(treeAt({ "codeworks.toml": text }));
}

/** The example with `[shared]` lines replaced: a key mapped to null is dropped, any other is set. */
function sharedWith(changes: Record<string, string | null>): string {
  const lines = EXAMPLE.split("\n").filter((line) => {
    const key = line.split(" = ")[0];
    return !Object.hasOwn(changes, key);
  });
  const added = Object.entries(changes).flatMap(([key, value]) => (value === null ? [] : [`${key} = ${value}`]));
  lines.splice(1, 0, ...added);
  return lines.join("\n");
}

function settingsError(...named: RegExp[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof SettingsError, `expected SettingsError, got ${String(error)}`);
    for (const part of named) assert.match(error.message, part);
    return true;
  };
}

function sharedSectionError(...named: RegExp[]): (error: unknown) => true {
  return (error) => {
    settingsError(...named)(error);
    assert.equal((error as SettingsError).where, SHARED_SECTION);
    return true;
  };
}

function word(key: string): RegExp {
  return new RegExp(`\\b${key}\\b`);
}

// smol-toml builds its tables with no prototype; a section is graded on its keys and values, not on that choice.
function plain(value: unknown): unknown {
  return structuredClone(value);
}

describe("readSettings", () => {
  it("reads every [shared] key and an empty [reviewer] section", async () => {
    const settings = await settingsOf(EXAMPLE);
    assert.deepEqual(settings.shared, EXAMPLE_SHARED);
    assert.deepEqual(plain(settings.section("reviewer")), {});
  });

  for (const key of ["extra", "review_timeout", "reviewer_app_id"]) {
    it(`refuses an unknown [shared] key, ${key}, naming it`, async () => {
      await assert.rejects(settingsOf(sharedWith({ [key]: "1" })), settingsError(/\[shared\]/, word(key)));
    });
  }

  for (const key of REQUIRED_KEYS) {
    it(`refuses a [shared] without ${key}, naming it and no other key`, async () => {
      await assert.rejects(settingsOf(sharedWith({ [key]: null })), (error) => {
        settingsError(/\[shared\]/, word(key))(error);
        for (const other of REQUIRED_KEYS.filter((name) => name !== key)) {
          assert.doesNotMatch((error as Error).message, word(other));
        }
        return true;
      });
    });
  }

  it("refuses a file with no [shared] section", async () => {
    await assert.rejects(settingsOf("[reviewer]\nmax_rounds = 3\n"), settingsError(/\[shared\]/));
  });

  it("reads a [shared] without trusted_reviewers", async () => {
    const { shared } = await settingsOf(sharedWith({ trusted_reviewers: null }));
    assert.equal(Object.hasOwn(shared, "trusted_reviewers"), false);
    assert.deepEqual(shared.validators, ["fixture"]);
  });

  it("reads trusted reviewers as REST writes their logins, a user's or an App's", async () => {
    const reviewers = ["alice", "a-1", "alice_acme", "chatgpt-codex-connector[bot]"];
    const { shared } = await settingsOf(sharedWith({ trusted_reviewers: JSON.stringify(reviewers) }));
    assert.deepEqual(shared.trusted_reviewers, reviewers);
  });

  for (const login of ["", "al ice", "alice ", "-alice", "alice[bot][bot]", "[bot]"]) {
    it(`refuses the trusted reviewer ${JSON.stringify(login)}, naming trusted_reviewers`, async () => {
      const text = sharedWith({ trusted_reviewers: JSON.stringify(["alice", login]) });
      await assert.rejects(settingsOf(text), settingsError(word("trusted_reviewers")));
    });
  }

  it("reads an empty validators list", async () => {
    assert.deepEqual((await settingsOf(sharedWith({ validators: "[]" }))).shared.validators, []);
  });

  it("reads several validators, in their order", async () => {
    const { shared } = await settingsOf(sharedWith({ validators: '["fixture", "a-1"]' }));
    assert.deepEqual(shared.validators, ["fixture", "a-1"]);
  });

  for (const entry of ["Fixture", "bad_name", "1x", "-x", "", "threads", "required-checks"]) {
    it(`refuses a validators entry outside ModuleName: ${JSON.stringify(entry)}`, async () => {
      const text = sharedWith({ validators: JSON.stringify(["fixture", entry]) });
      await assert.rejects(settingsOf(text), settingsError(word("validators")));
    });
  }

  it("refuses validators that is not a list", async () => {
    await assert.rejects(settingsOf(sharedWith({ validators: '"fixture"' })), settingsError(word("validators")));
  });

  it("refuses a validators entry listed twice, naming it", async () => {
    const text = sharedWith({ validators: '["fixture", "a-1", "fixture"]' });
    await assert.rejects(settingsOf(text), settingsError(word("validators"), /"fixture"/));
  });

  for (const [what, value, named] of [
    ["missing", null, []],
    ["not a list", '"docs/adr"', []],
    ["holding an empty entry", '["docs/adr", ""]', []],
    ["with an entry written twice", '["docs/adr", "../engineering/docs/adr", "docs/adr"]', [/"docs\/adr"/]],
  ] as const) {
    it(`refuses adr_folders ${what}, on [shared], naming adr_folders, where a list of paths is read`, async () => {
      // A [shared] that does not know the key refuses it too, naming it, so a refusal alone would grade nothing.
      assert.deepEqual((await settingsOf(sharedWith({ adr_folders: '["docs/adr"]' }))).shared.adr_folders, ["docs/adr"]);
      await assert.rejects(settingsOf(sharedWith({ adr_folders: value })), sharedSectionError(word("adr_folders"), ...named));
    });
  }

  it("reads required_checks as the check names it lists, in their order, and its absence as no list", async () => {
    const { shared } = await settingsOf(sharedWith({ required_checks: '["ci", "lint"]' }));
    assert.deepEqual(shared.required_checks, ["ci", "lint"]);
    assert.equal(Object.hasOwn((await settingsOf(EXAMPLE)).shared, "required_checks"), false);
  });

  for (const [what, value, named] of [
    ["empty", "[]", []],
    ["with a name written twice", '["ci", "lint", "ci"]', [/"ci"/]],
    ["holding an empty name", '["ci", ""]', []],
    ["not a list", '"ci"', []],
  ] as const) {
    it(`refuses required_checks ${what}, on [shared], naming required_checks`, async () => {
      // A [shared] that does not know the key refuses it too, naming it, so a refusal alone would grade nothing.
      assert.deepEqual((await settingsOf(sharedWith({ required_checks: '["ci"]' }))).shared.required_checks, ["ci"]);
      await assert.rejects(settingsOf(sharedWith({ required_checks: value })), sharedSectionError(word("required_checks"), ...named));
    });
  }

  it("reads an empty adr_folders as no folder", async () => {
    assert.deepEqual((await settingsOf(sharedWith({ adr_folders: "[]" }))).shared.adr_folders, []);
  });

  for (const board of [
    "https://github.com/orgs/example-org/projects/1",
    "https://github.com/users/alice/projects/12",
    "https://github.com/users/alice_acme/projects/3",
  ]) {
    it(`reads the board ${board}`, async () => {
      assert.equal((await settingsOf(sharedWith({ board: JSON.stringify(board) }))).shared.board, board);
    });
  }

  for (const board of [
    "https://github.com/example-org/projects/1",
    "https://github.com/enterprises/example/projects/1",
    "http://github.com/orgs/example-org/projects/1",
    "https://www.github.com/orgs/example-org/projects/1",
    "https://github.example.test/orgs/example-org/projects/1",
    "https://github.com/orgs/example-org/projects/1/",
    "https://github.com/orgs/example-org/projects/1/views/2",
    "https://github.com/orgs/example-org/projects/1?pane=info",
    "https://github.com/orgs//projects/1",
    "https://github.com/orgs/-example/projects/1",
    "https://github.com/orgs/example-org/projects/",
    "https://github.com/orgs/example-org/projects/0",
    "https://github.com/orgs/example-org/projects/01",
    "https://github.com/orgs/example-org/projects/x",
    "https://github.com/orgs/example-org/repo/projects/1",
    "",
  ]) {
    it(`refuses the board ${JSON.stringify(board)}`, async () => {
      await assert.rejects(settingsOf(sharedWith({ board: JSON.stringify(board) })), settingsError(word("board")));
    });
  }

  it("refuses a board that is not a string", async () => {
    await assert.rejects(settingsOf(sharedWith({ board: "1" })), settingsError(word("board")));
  });

  for (const key of APP_LOGIN_KEYS) {
    for (const login of ["codeworks-app", "[bot]", "codeworks app[bot]", "codeworks-app[bot] ", "-app[bot]"]) {
      it(`refuses ${key} ${JSON.stringify(login)}, not <slug>[bot], naming it`, async () => {
        await assert.rejects(settingsOf(sharedWith({ [key]: JSON.stringify(login) })), settingsError(word(key)));
      });
    }
  }

  it("fails naming the ref when the tree has no codeworks.toml", async () => {
    await assert.rejects(readSettings(treeAt({ "README.md": "# dummy\n" }, "feature-ref-7f3a")), (error) => {
      settingsError(/codeworks\.toml/, /feature-ref-7f3a/)(error);
      assert.ok((error as Error).cause instanceof NotInTree);
      return true;
    });
  });

  it("lets an error other than a missing file through as it is", async () => {
    const unreadable: Tree = {
      async listDir() {
        throw new Error("dummy transport failure");
      },
      async readText() {
        throw new Error("dummy transport failure");
      },
    };
    await assert.rejects(readSettings(unreadable), (error) => {
      assert.ok(!(error instanceof SettingsError));
      assert.match((error as Error).message, /dummy transport failure/);
      return true;
    });
  });

  it("refuses a file that is not TOML", async () => {
    await assert.rejects(settingsOf(`${EXAMPLE}\n[shared\n`), settingsError(/codeworks\.toml/));
  });

  it("refuses a __proto__ or constructor key, which a component's own reading could take for the object's", async () => {
    await assert.rejects(settingsOf(`${EXAMPLE}\n[orchestrator]\n__proto__ = 1\n`), settingsError(/codeworks\.toml/));
    await assert.rejects(settingsOf(`${EXAMPLE}\nconstructor = 1\n`), settingsError(/codeworks\.toml/));
  });

  it("hands each other section over parsed and unvalidated, {} when the file has none", async () => {
    const text = [
      EXAMPLE,
      "max_rounds = 3",
      'k_topic = "dummy"',
      "",
      "[reviewer.nested]",
      "deep = [1, 2]",
      "",
      "[orchestrator]",
      'anything = { goes = "here" }',
      "review_timeout = -1",
      "",
    ].join("\n");
    const settings = await settingsOf(text);
    assert.deepEqual(plain(settings.section("reviewer")), { max_rounds: 3, k_topic: "dummy", nested: { deep: [1, 2] } });
    assert.deepEqual(plain(settings.section("orchestrator")), { anything: { goes: "here" }, review_timeout: -1 });
    assert.deepEqual(plain(settings.section("planner")), {});
    assert.deepEqual(plain(settings.section("toString")), {});
  });

  it("reads no environment variable named like a key", async () => {
    const names = REQUIRED_KEYS.concat("trusted_reviewers").flatMap((key) => [
      key,
      key.toUpperCase(),
      `CODEWORKS_${key.toUpperCase()}`,
      `CODEWORKS_SHARED_${key.toUpperCase()}`,
      `SHARED_${key.toUpperCase()}`,
    ]);
    const saved = new Map(names.map((name) => [name, process.env[name]]));
    try {
      for (const name of names) {
        process.env[name] = /board/i.test(name) ? "https://github.com/orgs/env-org/projects/9" : "env-value[bot]";
      }
      assert.deepEqual((await settingsOf(EXAMPLE)).shared, EXAMPLE_SHARED);
      await assert.rejects(settingsOf(sharedWith({ board: null })), settingsError(word("board")));
      await assert.rejects(settingsOf(sharedWith({ validators: null })), settingsError(word("validators")));
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("readSection", () => {
  it("hands one section over parsed and unvalidated, judging no [shared] key", async () => {
    const text = `[shared]\nunknown = 1\n\n[orchestrator]\napp_id = 7\n`;
    assert.deepEqual(plain(await readSection(treeAt({ "codeworks.toml": text }), "orchestrator")), { app_id: 7 });
  });

  it("hands over {} when the file has no such section", async () => {
    assert.deepEqual(plain(await readSection(treeAt({ "codeworks.toml": EXAMPLE }), "orchestrator")), {});
  });

  it("refuses as readSettings does: no file, naming the ref, or a file that is not TOML", async () => {
    await assert.rejects(readSection(treeAt({}, "feature-ref-7f3a"), "orchestrator"), settingsError(/codeworks\.toml/, /feature-ref-7f3a/));
    await assert.rejects(readSection(treeAt({ "codeworks.toml": "[orchestrator\n" }), "orchestrator"), settingsError(/codeworks\.toml/));
  });
});
