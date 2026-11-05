import { chmodSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { CommitPasses } from "./contracts/commit-pass.ts";
import { textIfPresent, writeWhole } from "./files.ts";
import { HOME_FOLDERS } from "./keys.ts";

export type Session = { home: string; id: string };

/** A range the commit check passed: `shas` oldest to newest, graded from `from`. */
export type PassedRange = { repository: string; issue: number; branch: string; from: string; shas: readonly string[]; at: string };

export class CommitPassesRefused extends Error {
  readonly path: string;

  constructor(path: string, why: string) {
    super(`${path}: ${why}`);
    this.name = "CommitPassesRefused";
    this.path = path;
  }
}

const SessionId = z.uuid();

function folderOf({ home, id }: Session): string {
  if (!SessionId.safeParse(id).success) throw new TypeError(`not a session id: ${JSON.stringify(id)}`);
  return join(home, HOME_FOLDERS["<S>"], "sessions", id);
}

function fileOf(session: Session): string {
  return join(folderOf(session), "commit-passes.json");
}

export function readCommitPasses(session: Session): CommitPasses | null {
  const path = fileOf(session);
  const text = textIfPresent(path);
  if (text === null) return null;
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new CommitPassesRefused(path, `not JSON: ${error.message}`);
  }
  const parsed = CommitPasses.safeParse(document);
  if (!parsed.success) throw new CommitPassesRefused(path, z.prettifyError(parsed.error));
  return parsed.data;
}

export function recordCommitPasses(session: Session, range: PassedRange): void {
  const path = fileOf(session);
  const head = range.shas.at(-1);
  if (head === undefined) throw new CommitPassesRefused(path, "a range of no commit has no head to pass");
  const record = recordFor(session, range.repository);
  // Own keys only: a branch named like an Object.prototype member is still a branch.
  const entry = Object.hasOwn(record.branches, range.branch) ? record.branches[range.branch] : undefined;
  if (entry !== undefined && entry.issue !== range.issue) {
    throw new CommitPassesRefused(path, `branch ${range.branch} is #${entry.issue}'s, not #${range.issue}'s`);
  }
  const passes = entry?.passes ?? [];
  const passed = new Set(passes.map(({ sha }) => sha));
  const added = range.shas.filter((sha) => !passed.has(sha)).map((sha) => ({ sha, range_from: range.from, at: range.at }));
  write(session, {
    ...record,
    branches: { ...record.branches, [range.branch]: { issue: range.issue, head: { sha: head, range_from: range.from, at: range.at }, passes: [...passes, ...added] } },
  });
}

export function setReviewerOff(session: Session, repository: string, off: boolean): void {
  write(session, { ...recordFor(session, repository), off });
}

function recordFor(session: Session, repository: string): CommitPasses {
  const record = readCommitPasses(session);
  if (record === null) return { v: 1, repository, off: false, branches: {} };
  if (record.repository !== repository) throw new CommitPassesRefused(fileOf(session), `it is ${record.repository}'s, not ${repository}'s`);
  return record;
}

function write(session: Session, record: CommitPasses): void {
  const folder = folderOf(session);
  const text = `${JSON.stringify(CommitPasses.parse(record))}\n`;
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // mkdir's mode does not reach a folder that already exists.
  chmodSync(folder, 0o700);
  writeWhole(fileOf(session), text, renameSync);
}
