# Contract: core

## `core/src/settings.ts`

`Shared` gains `adr_folders: z.array(z.string().min(1))` with the repeat refusal `validators` uses. Required.

## `core/src/adr-folders.ts`

```ts
export type ResolvedAdrFolder = { entry: string; path: string; inside: boolean; readable: boolean };

/** Each `[shared] adr_folders` entry resolved from `checkout` (R2). Throws SettingsError when two entries are one
 *  folder; GitFailed when `checkout` is not in a git repository. Reads no env var, makes no network call. */
export function adrFolders(checkout: string, shared: Shared): Promise<ResolvedAdrFolder[]>;
```

## `core/src/adr.ts`

```ts
export const ADR_VERSION = "0.20.0";
export const ADR_INSTALL = `npm install -g @adrkit/cli@${ADR_VERSION}`;

export type AdrAnswer = {
  governing: { recordId: string; title: string }[];
  broken: { file: string; id?: string; rule: string; message: string }[];
};

/** `adr --version`, then `adr check --dir <folder> --json -- ...paths` from `cwd`; never throws for the folder. */
export function checkAdrFolder(cwd: string, folder: ResolvedAdrFolder, paths: readonly string[]):
  Promise<AdrAnswer | CouldNotRun>;

/** Pure: `adr check --json`'s output; throws AdrAnswerUnread naming what is not as ADR_VERSION gives it. */
export function readAdrAnswer(raw: unknown, ok: boolean): AdrAnswer;
```

Could not run: `adr` not on PATH; version other than `ADR_VERSION`; exit other than 0/1; exit 1 with stdout not
JSON; an unread answer; a capped-scan finding (`marker-scan-capped`, `marker-declarations-capped`). Each reason
ends with the next step.

## `core/src/values.ts`

```ts
export const AdrJudgment = valueSet({
  WITHIN: "the artifact sits inside the record: it does nothing the record rejected or contradicts",
  DEPARTS: "the artifact does what the record rejected, contradicts what it chose, or breaks a consequence it commits to",
});
export const CheckedArtifact = valueSet({ plan: "the plan step's touches.json", tasks: "tasks.md's task lines" });
```

US5 adds to `HoldKind`: `adr: "a record with its own adr check error, or a story PR changing a spec or a docs/adr
folder; refuses commits and rounds"` (reviewer ADR-0013 d4, amended in the planning PR).

## `core/src/contracts/decision-check.ts`

```ts
export const ADR_RULINGS_FILE = "adr-rulings.json";
export const TOUCHES_FILE = "touches.json";   // in the run folder, written by the plan step

/** Pure: one span against the one path grammar; `rootFiles` answers a span with no `/` (artifact-grammar.md). */
export function artifactPath(span: string, rootFiles: ReadonlySet<string> | "any"): string[] | null;

export const TouchedPaths: z.ZodType;  // {v: 1, paths: string[]}, no entry twice

/** Pure: parsed `touches.json`, each entry through `artifactPath`; throws TouchesRefused naming the entry. */
export function readTouchedPaths(json: unknown): ArtifactPath[];

export const AdrVerdict: z.ZodType;   // verdict file
export const AdrRuling: z.ZodType;    // {folder, record, path, reason}
export const AdrRulings: z.ZodType;   // {v: 1, rulings: AdrRuling[]}, no key twice

/** The spec folder's rulings file; `[]` when absent; throws RulingsRefused when it does not parse. */
export function readRulings(specDir: string): Promise<AdrRuling[]>;
```

`readTouchedPaths` passes `"any"`: a `touches.json` entry is a path by its place. See `artifact-grammar.md`.

## `core/src/contracts/tasks.ts`

`readTaskPaths(tasksText, rootFiles) → ArtifactPath[]` (with `story`), each span through `artifactPath`.
