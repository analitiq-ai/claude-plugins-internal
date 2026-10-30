import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type FileStat, KeyReadRefused, type Machine, readKey } from "../src/keys.ts";

const HOME = "/home/dummy";
const UID = 1000;
const MANAGED_FOLDER = "/etc/claude-code";
const MANAGED_FILE = "/etc/claude-code/managed-settings.json";
const DROP_IN = "/etc/claude-code/managed-settings.d";
const REMOTE = `${HOME}/.claude/remote-settings.json`;
const KEYS = `${HOME}/.config/codeworks`;
const GH_CONFIG_DIR = `${HOME}/.local/state/codeworks/orchestrator/gh`;
const KEY_BYTES = Buffer.from("-----BEGIN DUMMY KEY-----\n");

const FILE = 0o100000;
const DIRECTORY = 0o040000;

// The required settings, with `<K>`, `<S>` and `<O>` written from `~` where a list holds them, around entries the
// gate leaves alone: a credential folder, a host, a cache.
function inEffect(): Record<string, unknown> {
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      excludedCommands: [],
      filesystem: {
        denyRead: ["~/.config/codeworks", "/srv/creds", "~/.claude/.credentials.json"],
        denyWrite: [
          "~/.config/codeworks",
          "/srv/creds",
          "~/.local/state/codeworks/reviewer",
          "~/.local/state/codeworks/orchestrator",
          "~/.claude",
          "~/.gitconfig",
        ],
        allowManagedReadPathsOnly: true,
        disabled: false,
      },
      allowNestedUserNamespaces: false,
      network: {
        allowedDomains: ["github.com"],
        allowManagedDomainsOnly: true,
        strictAllowlist: true,
        allowAllUnixSockets: false,
      },
    },
    permissions: {
      deny: [
        "TaskStop",
        "Read(~/.config/codeworks/**)",
        "Edit(~/.config/codeworks/**)",
        "Read(//srv/creds/**)",
        "Edit(~/.local/state/codeworks/reviewer/**)",
        "Edit(~/.local/state/codeworks/orchestrator/**)",
        "Read(~/.claude/.credentials.json)",
        "Edit(~/.claude/**)",
        "Edit(~/.gitconfig)",
        "Edit(//**/.claude/settings.json)",
        "Edit(//**/.claude/settings.local.json)",
        "Edit(//**/.claude/workflows/**)",
        "Edit(//**/.claude/agents/**)",
        "Edit(//**/.claude/skills/**)",
        "Edit(//**/.claude/commands/**)",
        "Edit(//**/.claude/hooks/**)",
        "Edit(//**/.mcp.json)",
        "Edit(//**/.git/config)",
        "Edit(//**/.git/hooks/**)",
      ],
    },
    allowedMcpServers: [],
    allowManagedMcpServersOnly: true,
    allowManagedHooksOnly: true,
    enabledPlugins: {
      "orchestrator@codeworks": true,
      "builder@codeworks": true,
      "reviewer@codeworks": true,
      "auditor@codeworks": true,
      "pr-review-toolkit@claude-plugins-official": true,
    },
    env: { PIP_CACHE_DIR: "/tmp/cache/pip", GH_CONFIG_DIR },
  };
}

const EQUALS: [setting: string, value: unknown, other: unknown][] = [
  ["sandbox.enabled", true, false],
  ["sandbox.failIfUnavailable", true, false],
  ["sandbox.allowUnsandboxedCommands", false, true],
  ["sandbox.excludedCommands", [], ["git"]],
  ["sandbox.filesystem.allowManagedReadPathsOnly", true, false],
  ["sandbox.filesystem.disabled", false, true],
  ["sandbox.allowNestedUserNamespaces", false, true],
  ["sandbox.network.allowManagedDomainsOnly", true, false],
  ["sandbox.network.strictAllowlist", true, false],
  ["sandbox.network.allowAllUnixSockets", false, true],
  ["allowedMcpServers", [], ["any"]],
  ["allowManagedMcpServersOnly", true, false],
  ["allowManagedHooksOnly", true, false],
];

const HOLDS: [setting: string, entry: string][] = [
  ...["~/.config/codeworks", "~/.claude/.credentials.json"].map(
    (entry): [string, string] => ["sandbox.filesystem.denyRead", entry],
  ),
  ...[
    "~/.config/codeworks",
    "~/.local/state/codeworks/reviewer",
    "~/.local/state/codeworks/orchestrator",
    "~/.claude",
    "~/.gitconfig",
  ].map(
    (entry): [string, string] => ["sandbox.filesystem.denyWrite", entry],
  ),
  ...(inEffect().permissions as { deny: string[] }).deny
    .filter((rule) => rule !== "Read(//srv/creds/**)")
    .map((rule): [string, string] => ["permissions.deny", rule]),
];

const DROPPED = Symbol("dropped");

/** `inEffect()` with each dotted setting set, or removed when mapped to DROPPED. */
function settingsWith(changes: [setting: string, value: unknown][]): string {
  const document = inEffect();
  for (const [setting, value] of changes) {
    const keys = setting.split(".");
    const last = keys.pop() as string;
    let node = document;
    for (const key of keys) node = node[key] as Record<string, unknown>;
    if (value === DROPPED) delete node[last];
    else node[last] = value;
  }
  return JSON.stringify(document);
}

function listWithout(setting: string, entry: string): [string, unknown] {
  const keys = setting.split(".");
  let node: unknown = inEffect();
  for (const key of keys) node = (node as Record<string, unknown>)[key];
  return [setting, (node as string[]).filter((item) => item !== entry)];
}

type Answer = FileStat | NodeJS.ErrnoException;

function errno(code: string, path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: dummy error, stat '${path}'`), { code });
}

type Fake = Machine & { touched: string[] };

/**
 * A Linux machine with the managed settings in effect and each key held by its owner at 0600; `answers` replaces
 * or adds the stat of a path, an absent path answers ENOENT.
 */
function machine(options: { platform?: string; uid?: number; text?: string; answers?: Record<string, Answer> } = {}): Fake {
  const answers: Record<string, Answer> = {
    [MANAGED_FOLDER]: { uid: 0, mode: DIRECTORY | 0o755 },
    [MANAGED_FILE]: { uid: 0, mode: FILE | 0o644 },
    ...Object.fromEntries(
      ["session-app.pem", "reviewer-app.pem", "planner-app.pem", "deepsource-token"].map((name) => [
        `${KEYS}/${name}`,
        { uid: UID, mode: FILE | 0o600 },
      ]),
    ),
    ...options.answers,
  };
  const touched: string[] = [];
  const answer = (path: string): FileStat => {
    touched.push(path);
    const found = answers[path] ?? errno("ENOENT", path);
    if (found instanceof Error) throw found;
    return found;
  };
  return {
    platform: options.platform ?? "linux",
    uid: "uid" in options ? options.uid : UID,
    home: HOME,
    touched,
    stat: answer,
    lstat: answer,
    readText(path) {
      answer(path);
      assert.equal(path, MANAGED_FILE, `read text of ${path}`);
      return options.text ?? JSON.stringify(inEffect());
    },
    readBytes(path) {
      answer(path);
      return KEY_BYTES;
    },
  };
}

function refusal(read: () => unknown): KeyReadRefused {
  let refused: unknown;
  assert.throws(read, (error) => {
    refused = error;
    return error instanceof KeyReadRefused;
  });
  return refused as KeyReadRefused;
}

/** Each part names one reason; every reason must be named by one. */
function assertReasons(refused: KeyReadRefused, ...parts: string[]): void {
  assert.equal(refused.reasons.length, parts.length, `reasons: ${refused.reasons.join(" | ")}`);
  for (const part of parts) {
    assert.ok(
      refused.reasons.some((reason) => reason.includes(part)),
      `no reason names ${part}: ${refused.reasons.join(" | ")}`,
    );
  }
  for (const reason of refused.reasons) assert.ok(refused.message.includes(reason), `message lacks: ${reason}`);
}

describe("readKey", () => {
  it("reads a key held by its owner at 0600 or 0400 while the managed settings are in effect", () => {
    assert.deepEqual(readKey("reviewer-app.pem", "reviewer", machine()), KEY_BYTES);
    const readOnly = machine({ answers: { [`${KEYS}/reviewer-app.pem`]: { uid: UID, mode: FILE | 0o400 } } });
    assert.deepEqual(readKey("reviewer-app.pem", "reviewer", readOnly), KEY_BYTES);
  });

  it("reads with <K>, <S> and <O> written as absolute paths, a permission rule's starting //", () => {
    const text = settingsWith([
      ["sandbox.filesystem.denyRead", [`${HOME}/.config/codeworks`, "~/.claude/.credentials.json"]],
      [
        "sandbox.filesystem.denyWrite",
        [
          `${HOME}/.config/codeworks`,
          `${HOME}/.local/state/codeworks/reviewer`,
          `${HOME}/.local/state/codeworks/orchestrator`,
          "~/.claude",
          "~/.gitconfig",
        ],
      ],
      [
        "permissions.deny",
        (inEffect().permissions as { deny: string[] }).deny.map((rule) =>
          rule
            .replace("~/.config/codeworks", `/${HOME}/.config/codeworks`)
            .replace("~/.local/state/codeworks/reviewer", `/${HOME}/.local/state/codeworks/reviewer`)
            .replace("~/.local/state/codeworks/orchestrator", `/${HOME}/.local/state/codeworks/orchestrator`),
        ),
      ],
    ]);
    assert.deepEqual(readKey("session-app.pem", "orchestrator", machine({ text })), KEY_BYTES);
  });

  for (const file of ["", ".", "..", "../reviewer-app.pem", "keys/reviewer-app.pem", "/etc/shadow", "a\0b"]) {
    it(`refuses the file ${JSON.stringify(file)}, not a bare file name, touching nothing`, () => {
      const fake = machine();
      const refused = refusal(() => readKey(file, "reviewer", fake));
      assertReasons(refused, "bare file name");
      assert.equal(refused.path, `${KEYS}/${file}`);
      assert.deepEqual(fake.touched, []);
    });
  }

  it("refuses a key another user owns, naming the owner", () => {
    const fake = machine({ answers: { [`${KEYS}/reviewer-app.pem`]: { uid: 1001, mode: FILE | 0o600 } } });
    const refused = refusal(() => readKey("reviewer-app.pem", "reviewer", fake));
    assertReasons(refused, "1001");
    assert.equal(refused.path, `${KEYS}/reviewer-app.pem`);
  });

  for (const mode of [0o640, 0o604, 0o610, 0o601, 0o660, 0o644]) {
    const octal = `0${mode.toString(8)}`;
    it(`refuses a key at mode ${octal}, naming the mode`, () => {
      const fake = machine({ answers: { [`${KEYS}/reviewer-app.pem`]: { uid: UID, mode: FILE | mode } } });
      assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), octal);
    });
  }

  it("refuses a missing key, naming its path", () => {
    const refused = refusal(() => readKey("absent.pem", "reviewer", machine()));
    assertReasons(refused, "does not exist");
    assert.equal(refused.path, `${KEYS}/absent.pem`);
  });

  it("lets a key stat error other than ENOENT through", () => {
    const denied = errno("EACCES", `${KEYS}/reviewer-app.pem`);
    assert.throws(() => readKey("reviewer-app.pem", "reviewer", machine({ answers: { [`${KEYS}/reviewer-app.pem`]: denied } })), denied);
  });

  it("refuses on a platform whose processes have no user id, naming it", () => {
    const fake = machine({ platform: "win32", uid: undefined });
    assertReasons(refusal(() => readKey("planner-app.pem", "planner", fake)), "win32");
  });
});

describe("readKey's managed-settings gate", () => {
  it("refuses with no managed settings file, naming it", () => {
    const fake = machine({ answers: { [MANAGED_FILE]: errno("ENOENT", MANAGED_FILE) } });
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), `${MANAGED_FILE} does not exist`);
  });

  it("refuses a managed settings file root does not own, naming the owner", () => {
    const fake = machine({ answers: { [MANAGED_FILE]: { uid: UID, mode: FILE | 0o644 } } });
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), `${MANAGED_FILE} is owned by uid 1000`);
  });

  it("refuses a managed settings folder root does not own, naming it", () => {
    const fake = machine({ answers: { [MANAGED_FOLDER]: { uid: UID, mode: DIRECTORY | 0o755 } } });
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), `${MANAGED_FOLDER} is owned by uid 1000`);
  });

  for (const mode of [0o664, 0o646]) {
    const octal = `0${mode.toString(8)}`;
    it(`refuses a managed settings file at ${octal}, which group or other can write`, () => {
      const fake = machine({ answers: { [MANAGED_FILE]: { uid: 0, mode: FILE | mode } } });
      assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), `${MANAGED_FILE} has mode ${octal}`);
    });
  }

  for (const mode of [0o775, 0o757, 0o777]) {
    const octal = `0${mode.toString(8)}`;
    it(`refuses a managed settings folder at ${octal}, which group or other can write`, () => {
      const fake = machine({ answers: { [MANAGED_FOLDER]: { uid: 0, mode: DIRECTORY | mode } } });
      assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), `${MANAGED_FOLDER} has mode ${octal}`);
    });
  }

  it("refuses a managed settings file that is not JSON, naming it", () => {
    const fake = machine({ text: "{sandbox: true" });
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), `${MANAGED_FILE} is not JSON`);
  });

  it("refuses a managed settings file whose JSON is not an object", () => {
    const fake = machine({ text: "[]" });
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), MANAGED_FILE);
  });

  for (const [setting, , other] of EQUALS) {
    it(`refuses without ${setting}, naming it`, () => {
      const fake = machine({ text: settingsWith([[setting, DROPPED]]) });
      assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), `${setting} is missing`);
    });

    it(`refuses ${setting} set to ${JSON.stringify(other)}, naming it`, () => {
      const fake = machine({ text: settingsWith([[setting, other]]) });
      assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), `${setting} is ${JSON.stringify(other)}`);
    });
  }

  for (const [setting, entry] of HOLDS) {
    it(`refuses ${setting} without ${entry}, naming both`, () => {
      const fake = machine({ text: settingsWith([listWithout(setting, entry)]) });
      const refused = refusal(() => readKey("reviewer-app.pem", "reviewer", fake));
      assertReasons(refused, setting);
      assert.ok(refused.reasons[0].includes(entry), refused.reasons[0]);
    });
  }

  it("refuses without env.GH_CONFIG_DIR, naming it", () => {
    const fake = machine({ text: settingsWith([["env.GH_CONFIG_DIR", DROPPED]]) });
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), "env.GH_CONFIG_DIR is missing");
  });

  // gh reads GH_CONFIG_DIR as written: `~/…` names a folder called `~` in the working directory.
  for (const other of [
    "~/.local/state/codeworks/orchestrator/gh",
    "/tmp/verify-b-ghsess",
    `${HOME}/.local/state/codeworks/orchestrator`,
  ]) {
    it(`refuses env.GH_CONFIG_DIR set to ${other}, naming it`, () => {
      const fake = machine({ text: settingsWith([["env.GH_CONFIG_DIR", other]]) });
      assertReasons(
        refusal(() => readKey("reviewer-app.pem", "reviewer", fake)),
        `env.GH_CONFIG_DIR is ${JSON.stringify(other)}, not ${JSON.stringify(GH_CONFIG_DIR)}`,
      );
    });
  }

  for (const setting of ["sandbox.filesystem.denyRead", "sandbox.filesystem.denyWrite", "permissions.deny"]) {
    it(`refuses ${setting} that is no list, naming it`, () => {
      const fake = machine({ text: settingsWith([[setting, "~/.config/codeworks"]]) });
      assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), setting);
    });
  }

  it("refuses <K> in a permission rule written with one leading slash, which is not the absolute form", () => {
    const deny = (inEffect().permissions as { deny: string[] }).deny.map((rule) =>
      rule === "Read(~/.config/codeworks/**)" ? `Read(${HOME}/.config/codeworks/**)` : rule,
    );
    const fake = machine({ text: settingsWith([["permissions.deny", deny]]) });
    const refused = refusal(() => readKey("reviewer-app.pem", "reviewer", fake));
    assertReasons(refused, "permissions.deny");
    assert.ok(refused.reasons[0].includes("Read(~/.config/codeworks/**)"), refused.reasons[0]);
  });

  for (const value of [false, DROPPED]) {
    it(`refuses when the caller's plugin is ${value === DROPPED ? "absent from" : "false in"} enabledPlugins`, () => {
      const fake = machine({ text: settingsWith([["enabledPlugins.reviewer@codeworks", value]]) });
      assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), "reviewer@codeworks");
    });
  }

  it("refuses with no enabledPlugins, naming it", () => {
    const fake = machine({ text: settingsWith([["enabledPlugins", DROPPED]]) });
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), "enabledPlugins");
  });

  it("refuses a plugin enabled that SECURITY.md §5 does not list, naming it", () => {
    const fake = machine({ text: settingsWith([["enabledPlugins.helper@elsewhere", true]]) });
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), "helper@elsewhere");
  });

  it("reads with an unlisted plugin present but not enabled", () => {
    const fake = machine({ text: settingsWith([["enabledPlugins.helper@elsewhere", false]]) });
    assert.deepEqual(readKey("reviewer-app.pem", "reviewer", fake), KEY_BYTES);
  });

  for (const second of [DROP_IN, REMOTE]) {
    it(`refuses while ${second} exists, naming it`, () => {
      const fake = machine({ answers: { [second]: { uid: 0, mode: FILE | 0o644 } } });
      assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), second);
    });

    it(`throws an lstat error of ${second} other than ENOENT`, () => {
      const denied = errno("EACCES", second);
      const fake = machine({ answers: { [second]: denied } });
      assert.throws(() => readKey("reviewer-app.pem", "reviewer", fake), (error) => error === denied);
    });
  }

  it("names every reason at once: owner, modes, second sources, settings and plugins", () => {
    const fake = machine({
      answers: {
        [MANAGED_FILE]: { uid: UID, mode: FILE | 0o666 },
        [MANAGED_FOLDER]: { uid: 0, mode: DIRECTORY | 0o777 },
        [DROP_IN]: { uid: 0, mode: DIRECTORY | 0o755 },
        [REMOTE]: { uid: UID, mode: FILE | 0o600 },
      },
      text: settingsWith([
        ["allowManagedHooksOnly", DROPPED],
        ["sandbox.enabled", false],
        ["enabledPlugins.reviewer@codeworks", DROPPED],
        ["enabledPlugins.helper@elsewhere", true],
      ]),
    });
    assertReasons(
      refusal(() => readKey("reviewer-app.pem", "reviewer", fake)),
      `${MANAGED_FILE} is owned by uid 1000`,
      `${MANAGED_FILE} has mode 0666`,
      `${MANAGED_FOLDER} has mode 0777`,
      DROP_IN,
      REMOTE,
      "allowManagedHooksOnly is missing",
      "sandbox.enabled is false",
      "reviewer@codeworks",
      "helper@elsewhere",
    );
  });

  it("checks the settings before the key: a refusal names no key mode", () => {
    const fake = machine({
      answers: { [MANAGED_FILE]: errno("ENOENT", MANAGED_FILE), [`${KEYS}/reviewer-app.pem`]: { uid: 1001, mode: FILE | 0o644 } },
    });
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", fake)), "does not exist");
    assert.equal(fake.touched.includes(`${KEYS}/reviewer-app.pem`), false);
  });

  it("refuses a checked read on a platform other than Linux, naming it", () => {
    assertReasons(refusal(() => readKey("reviewer-app.pem", "reviewer", machine({ platform: "darwin" }))), "darwin");
  });

  describe("which reads it checks", () => {
    const noSettings = (platform = "linux") =>
      machine({ platform, answers: { [MANAGED_FILE]: errno("ENOENT", MANAGED_FILE) } });

    it("skips it for planner's read of planner-app.pem, on Linux or elsewhere", () => {
      for (const platform of ["linux", "darwin"]) {
        const fake = noSettings(platform);
        assert.deepEqual(readKey("planner-app.pem", "planner", fake), KEY_BYTES);
        assert.deepEqual(
          fake.touched.filter((path) => path !== `${KEYS}/planner-app.pem`),
          [],
          "planner's read looked at the managed settings",
        );
      }
    });

    it("still checks planner's key file's owner and mode", () => {
      const fake = machine({ answers: { [`${KEYS}/planner-app.pem`]: { uid: UID, mode: FILE | 0o640 } } });
      assertReasons(refusal(() => readKey("planner-app.pem", "planner", fake)), "0640");
    });

    for (const [file, plugin] of [
      ["session-app.pem", "orchestrator"],
      ["reviewer-app.pem", "reviewer"],
      ["deepsource-token", "reviewer"],
      ["deepsource-token", "orchestrator"],
      ["deepsource-token", "planner"],
      ["planner-app.pem", "reviewer"],
    ]) {
      it(`checks it for ${plugin}'s read of ${file}`, () => {
        assertReasons(refusal(() => readKey(file, plugin, noSettings())), `${MANAGED_FILE} does not exist`);
      });
    }
  });
});
