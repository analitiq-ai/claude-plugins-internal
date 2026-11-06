import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { sessionFolder, type Session } from "../../plugin/core/commit-pass.ts";
import type { GateLogEntry } from "../../plugin/lib/session.ts";

export const SESSION_ID = "315ad922-f2f9-4e13-8101-acdad2093cfc";

export function tempHome(t: TestContext): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "reviewer-home-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

export function tempSession(t: TestContext): Session {
  return { home: tempHome(t), id: SESSION_ID };
}

/** Every line of the session's gate.log, parsed. */
export function gateLog(session: Session): GateLogEntry[] {
  const text = readFileSync(join(sessionFolder(session), "gate.log"), "utf8");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as GateLogEntry);
}
