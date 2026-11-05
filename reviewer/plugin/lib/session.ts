import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { sessionFolder, type Session } from "../core/commit-pass.ts";
import { makePrivateFolder } from "../core/files.ts";
import { assertIssueNumber } from "../core/github.ts";
import type { HookEvent } from "./hook-io.ts";

/** One line of gate.log: a refusal, or a core write and how it ended. */
export type GateLogEntry = {
  at: string;
  event: HookEvent;
  call: string;
  /** `deny` or `would_deny` for a refusal, `written` for a write that landed, else the name of what the write threw. */
  outcome: string;
  oid?: string;
  reason?: string;
  ms: number;
};

const GATE_LOG = "gate.log";

export function appendGateLog(session: Session, entry: GateLogEntry): void {
  const folder = sessionFolder(session);
  makePrivateFolder(folder);
  // One append per line: two hook runs' lines never interleave within a line.
  appendFileSync(join(folder, GATE_LOG), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

const At = z.iso.datetime();

/** The path of the marker a hook leaves once it released `issue`'s holds on the claim at `at`. */
export function releasedMarker(session: Session, issue: number, at: string): string {
  assertIssueNumber(issue);
  // `at` is part of a file name, so only a time, which holds no path separator, is taken.
  if (!At.safeParse(at).success) throw new TypeError(`not a time: ${JSON.stringify(at)}`);
  return join(sessionFolder(session), `released-${issue}-${at}`);
}
