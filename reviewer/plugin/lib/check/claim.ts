import { join } from "node:path";
import { z } from "zod";

import { sessionFolder, type Session } from "../../core/commit-pass.ts";
import { GitSha } from "../../core/contracts/scalars.ts";
import { jsonOf, textIfPresent, writePrivate } from "../../core/files.ts";
import { ClaimVerdict } from "../../core/values.ts";
import { Category, HunkKind, isClaimId, Judged, Verdict } from "../rules/claim.ts";

const { CORRECT } = ClaimVerdict.schema.enum;

/**
 * A reader's answer for one hunk, kept by the hunk's patch id: the brief it answered, the hunk's label, and each claim
 * with its line as an offset from the hunk's first new line, so the answer holds wherever the hunk moves.
 */
export const ReadMemo = z.strictObject({
  brief: z.string(),
  kind: HunkKind,
  claims: z.array(z.strictObject({ offset: z.int().min(0), quote: z.string().min(1), category: Category })),
});
export type ReadMemo = z.infer<typeof ReadMemo>;

/** A CORRECT verdict kept by its claim's id, with the blob of each file it cited, which must still match to reuse it. */
export const CorrectMemo = z.strictObject({
  category: Judged,
  evidence_blobs: z.record(z.string().min(1), GitSha),
  verdict: Verdict.refine((verdict) => verdict.verdict === CORRECT, { message: `only a ${CORRECT} verdict is kept`, path: ["verdict"] }),
});
export type CorrectMemo = z.infer<typeof CorrectMemo>;

export class MemoRefused extends Error {
  readonly path: string;

  constructor(path: string, why: string) {
    super(`${path}: ${why}`);
    this.name = "MemoRefused";
    this.path = path;
  }
}

const MEMOS = "memos";

function memoFolder(session: Session): string {
  return join(sessionFolder(session), MEMOS);
}

// A key becomes part of a file name, so only a patch id or a claim id, which hold no path separator, is taken.
function readName(patch: string): string {
  if (!GitSha.safeParse(patch).success) throw new TypeError(`not a patch id: ${JSON.stringify(patch)}`);
  return `read-${patch}.json`;
}

function correctName(claim: string): string {
  if (!isClaimId(claim)) throw new TypeError(`not a claim id: ${JSON.stringify(claim)}`);
  return `correct-${claim}.json`;
}

function readFrom<S extends z.ZodType>(session: Session, name: string, schema: S): z.output<S> | null {
  const path = join(memoFolder(session), name);
  const text = textIfPresent(path);
  return text === null ? null : jsonOf(text, schema, (why) => {
    throw new MemoRefused(path, why);
  });
}

function record<S extends z.ZodType>(session: Session, name: string, schema: S, memo: z.input<S>): void {
  writePrivate(memoFolder(session), name, `${JSON.stringify(schema.parse(memo))}\n`);
}

export function readMemo(session: Session, patch: string): ReadMemo | null {
  return readFrom(session, readName(patch), ReadMemo);
}

export function recordRead(session: Session, patch: string, memo: ReadMemo): void {
  record(session, readName(patch), ReadMemo, memo);
}

export function correctMemo(session: Session, claim: string): CorrectMemo | null {
  return readFrom(session, correctName(claim), CorrectMemo);
}

export function recordCorrect(session: Session, claim: string, memo: CorrectMemo): void {
  record(session, correctName(claim), CorrectMemo, memo);
}
