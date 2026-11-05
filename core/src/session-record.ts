import { linkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { SessionRecord } from "./contracts/session-record.ts";
import { checkSessionId, jsonOf, textIfPresent, writeWhole } from "./files.ts";

/** A session's record that is present but not the contract's; it is never read as absent. */
export class SessionRecordRefused extends Error {
  readonly path: string;

  constructor(path: string, why: string) {
    super(`${path}: ${why}`);
    this.name = "SessionRecordRefused";
    this.path = path;
  }
}

function recordPath(folder: string, sessionId: string): string {
  checkSessionId(sessionId);
  return join(folder, `${sessionId}.json`);
}

// linkSync refuses an existing name, so a second write fails and the session keeps the issue it first took.
export function writeSessionRecord(folder: string, sessionId: string, record: SessionRecord): void {
  const path = recordPath(folder, sessionId);
  const text = `${JSON.stringify(SessionRecord.parse(record))}\n`;
  mkdirSync(folder, { recursive: true });
  writeWhole(path, text, linkSync);
}

export function readSessionRecord(folder: string, sessionId: string): SessionRecord | null {
  const path = recordPath(folder, sessionId);
  const text = textIfPresent(path);
  return text === null ? null : jsonOf(text, SessionRecord, (why) => {
    throw new SessionRecordRefused(path, why);
  });
}
