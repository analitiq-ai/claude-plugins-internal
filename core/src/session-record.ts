import { linkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { SessionRecord } from "./contracts/session-record.ts";
import { textIfPresent, writeWhole } from "./files.ts";

/** A session's record that is present but not the contract's; it is never read as absent. */
export class SessionRecordRefused extends Error {
  readonly path: string;

  constructor(path: string, why: string) {
    super(`${path}: ${why}`);
    this.name = "SessionRecordRefused";
    this.path = path;
  }
}

const SessionId = z.uuid();

// A UUID is a plain file name, so no session id reaches a file outside the folder.
function recordPath(folder: string, sessionId: string): string {
  if (!SessionId.safeParse(sessionId).success) throw new TypeError(`not a session id: ${JSON.stringify(sessionId)}`);
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
  if (text === null) return null;
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new SessionRecordRefused(path, `not JSON: ${error.message}`);
  }
  const parsed = SessionRecord.safeParse(document);
  if (!parsed.success) throw new SessionRecordRefused(path, z.prettifyError(parsed.error));
  return parsed.data;
}
