import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkCarriers, describeFailure, pinsOf, readCarrierFiles } from "../scripts/check-carriers.ts";

// check-carriers.ts finds carriers only at `*/plugin/core`, which does not reach this fixture, so it is graded here.
const FIXTURE = "tests/fixtures/carrier-plugin";
const coreDir = fileURLToPath(new URL("../", import.meta.url));
const fixture = readCarrierFiles(join(coreDir, FIXTURE));
const corePins = pinsOf(readFileSync(join(coreDir, "package.json"), "utf8"), "core/package.json");

it("links core to ../../../src, which is core/src seen from the fixture", () => {
  assert.equal(fixture.link, "../../../src");
});

it("holds core's runtime pins in package.json and its lockfile, as a carrier must", () => {
  const failures = checkCarriers({
    changedPaths: [],
    corePins,
    baseCorePins: corePins,
    carriers: [{ plugin: FIXTURE, head: fixture, basePluginJson: null }],
  });
  // The fixture sits one folder deeper than a carrier, so its link is graded by the test above instead.
  assert.deepEqual(failures.filter((failure) => failure.file !== `${FIXTURE}/core`).map(describeFailure), []);
});
