import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { readCommitPasses, sessionFolder, setReviewerOff } from "../plugin/core/commit-pass.ts";
import { appendGateLog, releasedMarker, type GateLogEntry } from "../plugin/lib/session.ts";
import { gateLog, SESSION_ID, tempSession } from "./support/session.ts";

const ENTRY: GateLogEntry = { at: "2026-10-30T12:00:00.000Z", event: "PreToolUse", call: "Bash", outcome: "deny", reason: "dummy", ms: 3 };
const WRITTEN: GateLogEntry = { at: "2026-10-30T12:00:01.000Z", event: "PostToolUse", call: "writeState", outcome: "written", oid: "a".repeat(40), ms: 412 };

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("the session folder (data-model Session folder)", () => {
  it("is ~/.local/state/codeworks/reviewer/sessions/<session>/, the folder core keeps the pass record in", (t) => {
    const session = tempSession(t);
    const folder = join(session.home, ".local", "state", "codeworks", "reviewer", "sessions", SESSION_ID);
    assert.equal(sessionFolder(session), folder);
    setReviewerOff(session, "acme/widgets", true);
    assert.deepEqual(readdirSync(folder), ["commit-passes.json"]);
    assert.equal(readCommitPasses(session)?.off, true);
  });

  it("appends each gate.log entry as one JSON line, oldest first, in a folder made 0700 and a file made 0600", (t) => {
    const session = tempSession(t);
    appendGateLog(session, ENTRY);
    appendGateLog(session, WRITTEN);
    assert.deepEqual(gateLog(session), [ENTRY, WRITTEN]);
    assert.equal(modeOf(sessionFolder(session)), 0o700);
    assert.equal(modeOf(join(sessionFolder(session), "gate.log")), 0o600);
  });

  it("makes a folder that exists 0700 when it appends", (t) => {
    const session = tempSession(t);
    mkdirSync(sessionFolder(session), { recursive: true });
    chmodSync(sessionFolder(session), 0o755);
    appendGateLog(session, ENTRY);
    assert.deepEqual(gateLog(session), [ENTRY]);
    assert.equal(modeOf(sessionFolder(session)), 0o700);
  });

  it("holds gate.log alone after entries are appended: no write.lock and no file of a round, hold or gates item (FR-004)", (t) => {
    const session = tempSession(t);
    appendGateLog(session, ENTRY);
    appendGateLog(session, WRITTEN);
    assert.deepEqual(readdirSync(sessionFolder(session)), ["gate.log"]);
  });

  it("names a claim's release marker released-<issue>-<at> in the folder, and writes nothing", (t) => {
    const session = tempSession(t);
    const at = "2026-10-30T12:00:00Z";
    assert.equal(releasedMarker(session, 212, at), join(sessionFolder(session), `released-212-${at}`));
    assert.equal(existsSync(sessionFolder(session)), false);
  });

  it("refuses a release marker for an issue that is not a whole number above 0, or an at that is not a time", (t) => {
    const session = tempSession(t);
    for (const issue of [0, -1, 1.5]) assert.throws(() => releasedMarker(session, issue, "2026-10-30T12:00:00Z"), TypeError, String(issue));
    for (const at of ["", "yesterday", "../../escape", "2026-10-30T12:00:00Z/x"]) {
      assert.throws(() => releasedMarker(session, 212, at), TypeError, at);
    }
  });
});
