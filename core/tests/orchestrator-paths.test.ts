import assert from "node:assert/strict";
import { it } from "node:test";

import { ghFolder, pushCopy, sessionsFolder, stateFolder } from "../src/orchestrator-paths.ts";

const HOME = "/home/dummy";

// The folder the managed settings write-deny to the model and point GH_CONFIG_DIR into (SECURITY.md §5).
it("roots the orchestrator's state folder at ~/.local/state/codeworks/orchestrator of the home it is given", () => {
  assert.equal(stateFolder(HOME), "/home/dummy/.local/state/codeworks/orchestrator");
});

it("keeps the session token in gh/, the session records in sessions/ and the push copies in push/<owner>/<name>.git", () => {
  assert.equal(ghFolder(HOME), "/home/dummy/.local/state/codeworks/orchestrator/gh");
  assert.equal(sessionsFolder(HOME), "/home/dummy/.local/state/codeworks/orchestrator/sessions");
  assert.equal(pushCopy(HOME, { owner: "acme", name: "widgets" }), "/home/dummy/.local/state/codeworks/orchestrator/push/acme/widgets.git");
});
