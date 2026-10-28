# Contract: core additions

Signatures only; each lands in the story named (R1). Every function refuses invalid input with a typed error;
none falls back.

## US2

```ts
// github.ts
function repositoryOfRemote(url: string): Repository;          // https, scp-like or ssh:// on github.com only
function httpsUrl(repo: Repository): string;                    // https://github.com/<owner>/<name>.git

// gh-config.ts
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
type StoredToken = { value: string; repo: string; expires_at: string };
function writeGhToken(folder: string, token: MintedToken, login: string): void;
function readGhToken(folder: string): StoredToken | null;      // throws on a half-written folder
function needsMint(stored: StoredToken | null, repo: string, now: Date): boolean;

// git.ts
function runGit(checkout: string, args: readonly string[], answers?: readonly number[],
                env?: Readonly<Record<string, string | undefined>>): Promise<GitAnswer>;  // undefined removes a variable
function pushWithGhCredential(checkout: string, ghConfigDir: string, repo: Repository, refspec: string): Promise<void>;
```

## US3

```ts
// contracts/spec-facts.ts
function writeSpecFacts(text: string, facts: SpecFacts): string;   // readSpecFacts(writeSpecFacts(t, f)) deep-equals f

// contracts/premise.ts — the table in data-model.md "Premise vocabulary"
const PremisePick, REPORTS_WRONG_BEHAVIOUR, ROOT_CAUSE;
```

`core/src/generated/premise.json` is written by `node scripts/write-schemas.ts` and checked by
`tests/schemas.test.ts`.

## US4

```ts
// values.ts
const Lane;   // valueSet: Backlog, Ready, In progress, In review, Blocked, Done

// board.ts
function laneOf(reader: GitHubClient, repo: string, issue: number, board: string): Promise<Lane | null>;

// identity.ts
function specBranch(p: number): string;                          // parseBranch(specBranch(p)) deep-equals {spec: p}
type SpecPr = { number: number; state: "open" | "closed" | "merged" };
function pickSpecPr(prs: readonly PullRequestState[], p: number): SpecPr | null;
function specPr(reader: GitHubClient, repo: string, p: number): Promise<SpecPr | null>;
type SpecFolderAnswer = { one: string } | { none: true } | { several: readonly string[] };
function specFolderAnswer(names: readonly string[], p: number): SpecFolderAnswer;  // pickSpecFolder built on it

// contracts/tasks.ts
function taskBlockLabel(issue: number): string;                  // "Story issue: #<n>"
function readTaskBlockLabels(text: string): ReadonlyMap<string, number>;   // phase heading line → issue
```
