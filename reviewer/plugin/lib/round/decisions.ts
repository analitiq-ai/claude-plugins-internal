import type { AdrAnswer } from "../../core/adr.ts";
import type { ResolvedAdrFolder } from "../../core/adr-folders.ts";
import type { CouldNotRun } from "../../core/outcomes.ts";

const FAILED = "The decision check failed, not the change";

export type FolderCheck = { folder: ResolvedAdrFolder; answer: AdrAnswer | CouldNotRun };

/** The round's decisions block; `corpus` is the entry of the folder an item is from, as `adr_folders` writes it. */
export type Decisions = {
  corpora: string[];
  governing: { corpus: string; id: string; title: string }[];
  notices: { corpus: string; id: string; matcher: string; reason: string }[];
  broken: ({ corpus: string } & AdrAnswer["broken"][number])[];
  not_checked: { corpus: string; reason: string }[];
};

export type ReviewScope = "full" | "delta";

const unchecked = (answer: AdrAnswer | CouldNotRun): answer is CouldNotRun => "outcome" in answer;

export function checkFolders(
  folders: readonly ResolvedAdrFolder[],
  ask: (folder: ResolvedAdrFolder) => Promise<AdrAnswer | CouldNotRun>,
): Promise<FolderCheck[]> {
  return Promise.all(folders.map(async (folder) => ({ folder, answer: await ask(folder) })));
}

export function decisionsOf(checks: readonly FolderCheck[]): Decisions {
  const decisions: Decisions = { corpora: [], governing: [], notices: [], broken: [], not_checked: [] };
  for (const { folder, answer } of checks) {
    const corpus = folder.entry;
    if (unchecked(answer)) {
      decisions.not_checked.push({ corpus, reason: answer.reason });
      continue;
    }
    decisions.corpora.push(corpus);
    decisions.governing.push(...answer.governing.map(({ recordId, title }) => ({ corpus, id: recordId, title })));
    decisions.notices.push(...answer.notices.map(({ id, matcher, message }) => ({ corpus, id, matcher, reason: message })));
    decisions.broken.push(...answer.broken.map((record) => ({ corpus, ...record })));
  }
  return decisions;
}

export function tooBig(count: number, limit: number, scope: ReviewScope): string {
  const step = scope === "delta" ? "commit in smaller steps and launch after each" : "split the PR";
  return `${FAILED}: this round reviews ${count} files and max_review_files is ${limit}, so no decision was checked. Next step: ${step}.`;
}

export function notCheckedRefusal(checks: readonly FolderCheck[]): string | null {
  // A could-not-run reason names its folder's entry first (core's `couldNotRun`).
  const lines = checks.flatMap(({ answer }) => (unchecked(answer) ? [`- ${answer.reason}`] : []));
  return lines.length === 0 ? null : [`${FAILED}: the decision check could not run, so no round was opened.`, ...lines].join("\n");
}

// A record outside the checkout is corrected where it lies, and no commit of this branch carries it.
const fixIn = ({ inside, path }: ResolvedAdrFolder): string =>
  inside ? "correct the record in this repo, commit and launch again" : `correct the record in ${path}, then launch again`;

export function brokenRefusal(checks: readonly FolderCheck[]): string | null {
  const lines = checks.flatMap(({ folder, answer }) =>
    unchecked(answer)
      ? []
      : answer.broken.map(({ file, id, rule, message }) => {
          const named = `${folder.entry} ${file}${id === undefined ? "" : ` (id ${id})`}`;
          return `- ${named}: ${message} (${rule}). Next step: ${fixIn(folder)}.`;
        }),
  );
  return lines.length === 0 ? null : [`${FAILED}: adr reports these decision records broken.`, ...lines].join("\n");
}
