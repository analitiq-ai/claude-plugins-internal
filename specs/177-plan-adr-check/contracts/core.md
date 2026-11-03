# Contract: core

## `core/src/settings.ts`

`Shared` gains `adr_folders: z.array(z.string().min(1))` with the repeat refusal `validators` uses. Required.

## `core/src/adr-folders.ts`

```ts
export type ResolvedAdrFolder = { entry: string; path: string; inside: boolean; readable: boolean };

/** Each `[shared] adr_folders` entry resolved from `checkout` (R2), in list order. Throws SettingsError
 *  (SHARED_SECTION) when two entries are one folder, naming both; GitFailed when `checkout` is not in a git
 *  repository.
 *  Reads no env var, makes no network call. */
export function adrFolders(checkout: string, shared: Shared): Promise<ResolvedAdrFolder[]>;
```

- `path`: the realpath when the folder exists, else the normalised absolute path.
- `inside`: `path` lies under the realpath of `checkout`'s `git rev-parse --show-toplevel`; both sides compared as
  realpaths, so a symlinked checkout or folder answers the same (ported from `adrkit.py`'s corpora).
- `readable`: a directory with read and search access.

## `core/src/adr.ts`

```ts
export const ADR_VERSION = "0.20.0";
export const ADR_INSTALL = `npm install -g @adrkit/cli@${ADR_VERSION}`;

export type AdrAnswer = {
  governing: { recordId: string; title: string }[];   // never a record `broken` names
  broken: { file: string; id?: string; rule: string; message: string }[];
  notices: { id: string; matcher: string; message: string }[];   // affects-unresolvable, affects-repo-not-applicable
};
export type AdrScanCapped = { capped: { rule: string; message: string }[] };

/** `adr --version`, then `adr check --dir <folder> --json -- ...paths` from `cwd`, killed at `deadlineMs`;
 *  never throws for the folder. `cwd` is the realpath of the checkout's toplevel; `--dir` is relative to it
 *  when `folder.inside`, else absolute. */
export function checkAdrFolder(cwd: string, folder: ResolvedAdrFolder, paths: readonly string[], deadlineMs: number):
  Promise<AdrAnswer | CouldNotRun>;

/** Pure: `adr check --json`'s output, reading its own `ok`; throws AdrAnswerUnread naming what is not as
 *  ADR_VERSION gives it. */
export function readAdrAnswer(raw: unknown): AdrAnswer | AdrScanCapped;
```

`readAdrAnswer`, ported case for case from `adrkit.py` `parse`/`_finding` and `decisions.py` `judge`:

- Unread (throws `AdrAnswerUnread`): not an object or no boolean `ok`; `governing` not a list of
  `{recordId, title}` strings; `findings` not a list; a finding with no string `rule`, `severity` or `message`;
  an optional field (`id`, `path`, `field`, `pattern`) that is not a string; a NOTICE finding with no `id`,
  `field` or `pattern`; an `error` finding with no `path`; `ok: false` with no `error` finding.
- A `marker-scan-capped` or `marker-declarations-capped` finding: `AdrScanCapped` listing each, nothing else read.
- `broken`: every `error` finding when `ok` is false (adrkit fails only on a changed record), `file` from its
  `path`, `id` when given. `governing` leaves out every record a `broken` entry names by `id`.
- `notices`: each NOTICE finding, `matcher` = `<field> "<pattern>"`. Every other finding is ignored.

`checkAdrFolder` returns `couldNotRun(folder.entry, why)` (`core/src/outcomes.ts`), `why` ending with the next
step, when:

| Case | Next step |
|---|---|
| `!folder.readable` (`adr` not called) | "make <path> a readable folder, or remove the entry from [shared] adr_folders" |
| `adr` not on `PATH`, or cannot be started | `ADR_INSTALL` |
| `--version` exits non-zero or prints another version | `ADR_INSTALL` |
| `check` exits other than 0/1, or 1 with stdout not JSON | adrkit's stderr, "fix what adr says" |
| exit 0 with stdout not JSON, or `AdrAnswerUnread` | `ADR_INSTALL` |
| `AdrScanCapped` | each capped finding's message and rule, "split the change" |
| past `deadlineMs` | the deadline and each step's seconds, "rerun the check" |

The reason names the folder once, through `couldNotRun`'s `source`; callers print it as it is (workflow-steps.md).

## `core/src/values.ts`

```ts
export const AdrJudgment = valueSet({
  WITHIN: "the artifact sits inside the record: it does nothing the record rejected or contradicts",
  DEPARTS: "the artifact does what the record rejected, contradicts what it chose, or breaks a consequence it commits to",
});
export const CheckedArtifact = valueSet({ plan: "the touches step's touches.json", tasks: "tasks.md's task lines" });
```

## `core/src/contracts/decision-check.ts`

Every file planner's check reads or writes in the run folder or the spec folder, as one Zod schema each
(data-model.md gives the fields):

```ts
export const ADR_RULINGS_FILE = "adr-rulings.json";              // in the spec folder
export const TOUCHES_FILE = "touches.json";                      // in the run folder, written by the touches step
export const ADR_RULINGS_WRITTEN_FILE = "adr-rulings-written.json";
export const askedFile = (artifact: CheckedArtifactName) => `adr-${artifact}-asked.json`;
export const verdictFile = (artifact: CheckedArtifactName) => `adr-${artifact}-verdict.json`;

export type ArtifactPath = { path: string; line: number; story: string | null };

/** Pure: one span against the path grammar (artifact-grammar.md). `null`: the span is not a path. Throws
 *  PathRefused naming the span when it reads as a path but breaks the grammar. */
export function artifactPath(span: string, rootFiles: ReadonlySet<string> | "any"): string | null;

export const TouchedPaths: z.ZodType;   // {v: 1, paths: PATH[]}, no entry twice
/** Pure: parsed `touches.json`; throws TouchesRefused naming `touches.json` and the entry. */
export function readTouchedPaths(json: unknown): ArtifactPath[];

export const AdrAsked: z.ZodType;       // asked record
export const AdrVerdict: z.ZodType;     // verdict file; `folder` is the entry as written
export const AdrRuling: z.ZodType;      // {folder, record, path}, plus `reason`; `path` a PATH
export const AdrRulings: z.ZodType;     // {v: 1, rulings: AdrRuling[]}, no (folder, record, path) twice;
                                        // the rulings file and the rulings-written record alike

/** The spec folder's rulings file; `[]` when absent; throws RulingsRefused naming the file when it does not parse. */
export function readRulings(specDir: string): Promise<AdrRuling[]>;

export const REVIEW_QUESTIONS_FILE = "review-questions.json"; // in the run folder, on a rescope only
export const ReviewQuestions: z.ZodType; // {v: 1, questions: {issue, hold, question}[]}, no (issue, hold) twice
export const AdrDeparture: z.ZodType;   // {folder, record, path, what}: `folder` and `record` with no whitespace,
                                        // `path` a PATH, `what` one non-empty line
/** Pure: one departure as its line, `ADR departure: <folder> <record> <path> — <what>` (artifact-grammar.md).
 *  Throws DepartureRefused naming the field that breaks it. */
export function renderAdrDeparture(departure: AdrDeparture): string;
/** Pure: every departure line in a hold's question, `[]` when it has none. Throws DepartureRefused naming a line
 *  that opens with `ADR departure: ` but breaks the grammar. */
export function readAdrDepartures(question: string): AdrDeparture[];
```

`readTouchedPaths` passes `"any"`: a `touches.json` entry is a path by its place. `renderAdrDeparture` and
`readAdrDepartures` are the line's one writer and one reader: reviewer writes a departure ruled ESCALATE into the
`escalation-<issue>` hold's question (reviewer ADR-0013 d4, ADR-0017 d2), planner's rescope reads it back
(planner ADR-0009 d9). The rest of a question is text for the admin and for grill.

## `core/src/contracts/snapshot.ts`, `core/src/state.ts`, `core/src/values.ts` (existing)

`Hold.question` is set exactly when `kind` is `escalation` or `claim`, or `rescope` with `spec_pr` null (#209
T010a); `placeRescopeHold` takes `{question} | {specPr}` (#209 T010b); `FindingRuling` gains `ESCALATE` (#209
T010c). This feature changes none of them.

## `core/src/attest.ts` (existing, orchestrator ADR-0004 d1; US6)

`governingDiff` also compares the story's spec folder's `adr-rulings.json` (`ADR_RULINGS_FILE`), so a ruling
landing on the default branch lapses every story's round under that spec.

## `core/src/contracts/tasks.ts`

```ts
/** Pure: each task line's paths (artifact-grammar.md), `story` its `[US<k>]` tag, else its phase heading's text.
 *  Throws PathRefused as `tasks.md:<line>`, and refuses a task line above the first phase heading. */
export function readTaskPaths(tasksText: string, rootFiles: ReadonlySet<string>): ArtifactPath[];

/** Pure: TICK_ONLY (reviewer ADR-0010 d1). True only when every line that differs between the two texts flips
 *  `- [ ]` to `- [x]` on a task line inside the task block `readTaskBlockLabels` labels with `issue`. */
export function isTickOnly(baseText: string, headText: string, issue: number): boolean;
```

`isTickOnly` is false for: a line added or removed; `[x]` to `[ ]`; `[ ]` to `[X]`; any change to a label line or
to a task line's text; a tick outside that block; a text with no block labelled `issue`. Equal texts: true.

## `core/src/protected-paths.ts` (existing, orchestrator ADR-0004 d4)

```ts
export type ProtectedPathsInput = {
  /** The one root `specs/<name>/tasks.md` the caller found TICK_ONLY through `isTickOnly`, else null. */
  tickOnly: string | null;
  /** The `inside` folders of `adrFolders`, each relative to the repo root. */
  adrFolders: readonly string[];
};

/** The protected paths `changedFiles` touch, as today (`docs/adr` at any depth among them), plus each listed ADR
 *  folder holding a changed file, and each spec folder `specs/<name>` at the repo root (any letter case) holding a
 *  changed file other than `tickOnly` (orchestrator ADR-0004 d4; root ADR-0011 d1). */
export function protectedPaths(changedFiles: readonly string[], input: ProtectedPathsInput): string[];
```

A listed folder matches from the repo root only, in folded case, as the existing segments do; `docs/adr` at any
depth stays protected whether listed or not. Only the root `specs/` is protected: `src/specs/x.ts` touches nothing.
`specs/<name>` is the first two segments of the changed file. The callers are orchestrator's attestation (#174) and
reviewer's after-commit check (#209 US2), which today pass changed files only; each reads `tasks.md` at the merge
base and at the head for `tickOnly`, and settings through `adrFolders` for `adrFolders`.
