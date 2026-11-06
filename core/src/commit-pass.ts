import { join } from "node:path";

import { CommitPasses } from "./contracts/commit-pass.ts";
import { checkSessionId, jsonOf, textIfPresent, writePrivate } from "./files.ts";
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

const FILE = "commit-passes.json";

export function sessionFolder({ home, id }: Session): string {
  checkSessionId(id);
  return join(home, HOME_FOLDERS["<S>"], "sessions", id);
}

function fileOf(session: Session): string {
  return join(sessionFolder(session), FILE);
}

export function readCommitPasses(session: Session): CommitPasses | null {
  const path = fileOf(session);
  const text = textIfPresent(path);
  return text === null ? null : jsonOf(text, CommitPasses, (why) => {
    throw new CommitPassesRefused(path, why);
  });
}

export function recordCommitPasses(session: Session, range: PassedRange): void {
  const path = fileOf(session);
  const head = range.shas.at(-1);
  if (head === undefined) throw new CommitPassesRefused(path, "a range of no commit has no head to pass");
  const record = recordFor(session, range.repository);
  const entry = record.branches[range.branch];
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
  if (record === null) return CommitPasses.parse({ v: 1, repository, off: false, branches: {} });
  if (record.repository !== repository) throw new CommitPassesRefused(fileOf(session), `it is ${record.repository}'s, not ${repository}'s`);
  return record;
}

function write(session: Session, record: CommitPasses): void {
  writePrivate(sessionFolder(session), FILE, `${JSON.stringify(CommitPasses.parse(record))}\n`);
}
