import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { SHARED } from "../../core/tests/fixtures/state/issue.ts";
import { readSettings, SettingsError, type Settings } from "../plugin/core/settings.ts";
import { NotInTree, type Tree } from "../plugin/core/tree.ts";
import { REVIEWER_SECTION, reviewerSettings } from "../plugin/lib/settings.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG_JSON = join(ROOT, "reviewer", "plugin", "config.json");

// None is the repository's own value, so a value taken from anywhere but the section shows.
const SECTION = {
  app_id: 7654321,
  mode: "log",
  claim_checks: "log",
  shim_checks: "log",
  decision_checks: "log",
  claim_warn_over: 11,
  max_review_files: 9,
  escalate_to: "dummy-admin",
  max_rounds: 6,
  max_audits: 5,
  k_topic: 7,
  claim_hold_at: 8,
  shim_deep_at: 2,
  shim_hold_at: 10,
  state_write_attempts: 12,
  char_diff_budget: 13,
  edits_before_redesign: 14,
  near_fix_lines: 15,
  same_unit_lines: 16,
};

const MODES = ["mode", "claim_checks", "shim_checks", "decision_checks"] as const;
const COUNTS = [
  "app_id",
  "claim_warn_over",
  "max_review_files",
  "max_rounds",
  "max_audits",
  "k_topic",
  "claim_hold_at",
  "shim_deep_at",
  "shim_hold_at",
  "state_write_attempts",
  "char_diff_budget",
  "edits_before_redesign",
  "near_fix_lines",
  "same_unit_lines",
] as const;

function settingsWith(section: unknown): Settings {
  return { shared: SHARED, section: (name) => (name === "reviewer" ? section : {}) };
}

function refusedNaming(section: unknown, named: string): void {
  assert.throws(
    () => reviewerSettings(settingsWith(section)),
    (error: unknown) => {
      assert.ok(error instanceof SettingsError, String(error));
      assert.equal(error.where, REVIEWER_SECTION);
      assert.ok(error.message.includes(named), error.message);
      return true;
    },
  );
}

// The checkout's files as they are on disk, so the section is read before it is committed.
const workingTree: Tree = {
  listDir: (path) => Promise.reject(new NotInTree(path, "the working tree", "directory")),
  readText: (path) => Promise.resolve(readFileSync(join(ROOT, path), "utf8")),
};

describe("reviewerSettings", () => {
  it("reads every key of [reviewer] as written", () => {
    assert.deepEqual(reviewerSettings(settingsWith(SECTION)), SECTION);
    // The modes share two values, so each is told from the others by being the one that differs.
    for (const key of MODES) {
      const section = { ...SECTION, [key]: "enforce" };
      assert.deepEqual(reviewerSettings(settingsWith(section)), section, key);
    }
  });

  it("names its section codeworks.toml [reviewer]", () => {
    assert.equal(REVIEWER_SECTION, "codeworks.toml [reviewer]");
  });

  for (const key of Object.keys(SECTION)) {
    it(`refuses a section without ${key}`, () => {
      const { [key as keyof typeof SECTION]: _, ...rest } = SECTION;
      refusedNaming(rest, key);
    });
  }

  it("refuses a key it does not know", () => {
    refusedNaming({ ...SECTION, max_round: 4 }, "max_round");
  });

  for (const key of MODES) {
    it(`refuses a ${key} other than enforce or log`, () => {
      for (const value of ["off", "ENFORCE", "", 1]) refusedNaming({ ...SECTION, [key]: value }, key);
    });
  }

  for (const key of COUNTS) {
    it(`refuses a ${key} that is not a whole number above 0`, () => {
      for (const value of [0, -1, 1.5, "3"]) refusedNaming({ ...SECTION, [key]: value }, key);
    });
  }

  it("refuses an empty escalate_to", () => {
    refusedNaming({ ...SECTION, escalate_to: "" }, "escalate_to");
  });

  it("refuses a shim_deep_at at or above shim_hold_at, at which the deep check could never be due", () => {
    refusedNaming({ ...SECTION, shim_deep_at: 4, shim_hold_at: 4 }, "shim_deep_at");
    refusedNaming({ ...SECTION, shim_deep_at: 5, shim_hold_at: 4 }, "shim_deep_at");
  });

  it("takes no key from the environment, REVIEWER_MODE among them (root ADR-0002 d3)", (t) => {
    const set: Record<string, string> = { REVIEWER_MODE: "enforce" };
    for (const key of Object.keys(SECTION)) set[`REVIEWER_${key.toUpperCase()}`] = key === "escalate_to" ? "dummy-other" : "1";
    for (const [name, value] of Object.entries(set)) {
      const saved = process.env[name];
      process.env[name] = value;
      t.after(() => {
        if (saved === undefined) delete process.env[name];
        else process.env[name] = saved;
      });
    }
    assert.deepEqual(reviewerSettings(settingsWith(SECTION)), SECTION);
  });
});

describe("the repository's own [reviewer]", () => {
  it("parses", async () => {
    reviewerSettings(await readSettings(workingTree));
  });

  // config.json holds the Python hooks' settings until the cutover; [reviewer] must change none when it takes them over.
  it("holds every key of reviewer/plugin/config.json at the value it holds there", async () => {
    const reviewer: Record<string, unknown> = reviewerSettings(await readSettings(workingTree));
    const config = JSON.parse(readFileSync(CONFIG_JSON, "utf8")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(config)) assert.equal(reviewer[key], value, key);
  });
});
