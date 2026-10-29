import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ghFolder, PlannerSettings } from "../plugin/lib/settings.ts";

describe("PlannerSettings", () => {
  it("accepts a positive integer app_id", () => {
    assert.deepEqual(PlannerSettings.parse({ app_id: 5510825 }), { app_id: 5510825 });
  });

  for (const [what, section] of [
    ["a missing app_id", {}],
    ["a non-integer app_id", { app_id: 1.5 }],
    ["an app_id given as text", { app_id: "5510825" }],
    ["an app_id of 0", { app_id: 0 }],
    ["a negative app_id", { app_id: -1 }],
    ["an unknown key", { app_id: 5510825, app_login: "codeworks-planner[bot]" }],
  ] as const) {
    it(`refuses ${what}`, () => {
      assert.equal(PlannerSettings.safeParse(section).success, false);
    });
  }
});

describe("ghFolder", () => {
  it("is ~/.local/state/codeworks/planner/<owner>/<name>/gh under the HOME in effect", (t) => {
    const home = mkdtempSync(join(tmpdir(), "planner-settings-home-"));
    const saved = process.env.HOME;
    process.env.HOME = home;
    t.after(() => {
      if (saved === undefined) delete process.env.HOME;
      else process.env.HOME = saved;
      rmSync(home, { recursive: true, force: true });
    });
    assert.equal(ghFolder({ owner: "o", name: "n" }), join(home, ".local", "state", "codeworks", "planner", "o", "n", "gh"));
  });
});
