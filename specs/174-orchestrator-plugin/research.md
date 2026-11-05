# Research: The orchestrator plugin carries core

Every decision below is settled; none is left NEEDS CLARIFICATION. R20 rests on Claude Code behaviour this
plan has not executed, and names the task that runs it first.

## R1: The plugin is a core carrier shaped like the fixture

- **Decision**: `orchestrator/plugin/` holds a `core` symlink to `../../core/src`, a `package.json` with
  `"type": "module"` pinning exactly core's runtime packages (`smol-toml`, `yaml`, `zod` at core's versions), a
  v3 `package-lock.json`, and `.claude-plugin/plugin.json` with a pinned `version` (starting `0.1.0`). Every hook
  entry point first imports `lib/guarded.ts`, which statically imports only `core/guard.ts`, and loads every
  other module with `await import(...)`.
- **Rationale**: FR-001–FR-002; root ADR-0001 d2, ADR-0009 d3–d4. `check-carriers.ts` finds any
  `*/plugin/core` entry, so the plugin is checked the moment the link exists (SC-001).
- **Existing tools**: `core/tests/fixtures/carrier-plugin` (the shape, fits whole); `planner/plugin/lib/guarded.ts`
  (the guard module, copied in shape: it cannot be imported from planner, ADR-0001 d1);
  `core/scripts/check-carriers.ts` (the gate, unchanged).

## R2: TypeScript on Node, tested with node:test against core's fake GitHub

- **Decision**: `orchestrator/package.json` and `tsconfig.json` copy planner's: `tsc -p . && node --test
  'tests/**/*.test.ts'`, `@types/node` and `typescript` as dev pins, Node ≥ 22.18 type stripping, no build step.
  Tests import `core/tests/support/fake-github.ts` for GitHub and drive each hook by piping a recorded hook
  input into the entry file.
- **Rationale**: FR-003a, FR-005. `.github/workflows/tests.yml` already discovers `orchestrator/tests/`, runs
  `npm ci` in `orchestrator/plugin` when its lock exists and `npm test` in `orchestrator/`; no workflow change.
- **Existing tools**: `planner/package.json`, `planner/tsconfig.json` (fit); `core/tests/support/fake-github.ts`
  (fits; planner's tests already import it); `tests.yml` (fits unchanged).

## R3: One entry file per hook event; rules are pure, entry files do I/O

- **Decision**: `hooks/<event>.ts` reads stdin as JSON, validates the fields it uses with a Zod schema
  (`session_id`, `cwd`, `hook_event_name`, `prompt`, `tool_name`, `background_tasks`), gathers facts through core,
  calls a pure decision in `lib/`, and performs its answer. A refusal is exit 2 with one stderr line prefixed
  `orchestrator: `; context for the model is stdout `{"hookSpecificOutput": {"hookEventName", "additionalContext"}}`.
  Every hook but Stop declares `"onFailure": "block"`; Stop exits 1 on a crash (contracts/hooks.md).
- **Rationale**: FR-002; testable by construction (Principle IV): `decideStart`, `decidePush`, `decideBounds` take
  facts and return answers with no GitHub or file access.
- **Existing tools**: the fixture's `hooks/identity.ts` (guard, then dynamic import: fits); reviewer's
  `scripts/hookio.py` and `gate.py` (same output shape, Python: the shape is reused, the code cannot be).

## R4: Key file names

- **Decision**: `orchestrator-app.pem` and `session-app.pem` in `~/.config/codeworks/`, read only through core's
  `readKey(file, "orchestrator")` inside `mintToken`.
- **Rationale**: FR-006, SECURITY.md §3; core's `<app>-app.pem` convention.
- **Existing tools**: `core/src/keys.ts` (`readKey`, its managed-settings check; fits);
  `core/tests/keys.test.ts` already reads `session-app.pem` for `orchestrator`.

## R5: Settings are read once, at the checkout's HEAD

- **Decision**: `lib/settings.ts` defines `OrchestratorSettings` as a strict Zod object (contracts/
  orchestrator-settings.md) and reads `[shared]` and `[orchestrator]` with core's `readSettings` over
  `gitTree(checkout, "HEAD")`, the one read every component makes (root ADR-0002 d4: the branch the work is on;
  #217 R7 reads the same).
  Every key, the App IDs among them, comes from that read. PreToolUse reads
  settings only when `needsMint` holds; otherwise it reads the gh folder and the repository alone.
- **Rationale**: root ADR-0002 d3–d4 make the file at the ref the one source, and one read keeps one source for
  every hook and builder. The model's writes to the file are refused (reviewer ADR-0012 d1); a branch switch in
  the checkout is not, and is refused only once a session is seen doing it. A forged App ID makes the mint fail
  loud: a key signs only for its own App. Story 1 adds
  `app_id`, `session_app_id`, `status_issue`; Story 3 `exempt_labels`; Story 4 `review_timeout` (≤ 3600,
  FR-021); Story 5 `max_turns`, `k_deaths`.
- **Existing tools**: `core/src/settings.ts` (`readSettings`; fits); `core/src/tree.ts` (`gitTree`; fits);
  `planner/plugin/lib/settings.ts` (the section-validation pattern and the same HEAD read).

## R6: The session's gh config folder

- **Decision**: `~/.local/state/codeworks/orchestrator/gh/`, written with core's `writeGhToken(folder, token,
  shared.session_app_login)` and read with `readGhToken`; `GH_CONFIG_DIR` points at it from the managed
  settings' `env` (the managed-settings PR, below).
- **Rationale**: FR-009. One folder per machine because one session runs there (SECURITY.md §2); planner's
  per-repository folders exist because planner runs in several checkouts at once.
- **Existing tools**: `core/src/gh-config.ts` (format, atomic replace, modes, `needsMint`; fits whole);
  `planner/plugin/lib/github.ts` `plannerToken` (the read–check–mint–write sequence; reused in shape).

## R7: Refresh within a long turn

- **Decision**: one `ensureSessionToken(checkout, now)` in `lib/session-token.ts`, called by SessionStart,
  UserPromptSubmit and PreToolUse (matcher `Bash`, timeout 60 s), mints when core's `needsMint` says so. A
  failure refuses the prompt or call naming `MintError`'s cause; SessionStart cannot refuse, so it posts the
  keyed status-issue comment (FR-008) and exits 0.
- **Rationale**: FR-010–FR-011; Bash is the only tool reaching GitHub with the token (SECURITY.md §5).
  PreToolUse fires for subagents' tool calls too.
- **Existing tools**: core `needsMint` and `REFRESH_MARGIN_MS` (fit); reviewer's `PreToolUse` Bash matcher
  (the hooks.json shape).

## R8: The session's issue record is a core contract in a write-once file

- **Decision**: core gains `contracts/session-record.ts` (Zod) and `session-record.ts` with
  `writeSessionRecord(folder, sessionId, record)` and `readSessionRecord(folder, sessionId)`. The write creates
  the file once: text to a temp file, then `link` to the final name, which fails on an existing file, so a
  second write cannot replace the first. The session id must be a UUID, so it is a plain file name. The atomic
  replace in `gh-config.ts` moves to a shared `core/src/files.ts` that both call.
- **Rationale**: FR-014; reviewer and builder read it, so it is core's (define once, Principle I). One writer
  (P6): the orchestrator's UserPromptSubmit hook; the model is write-denied the folder.
- **Existing tools**: `gh-config.ts` `replaceFile` (rename replaces, so it cannot give write-once; it is
  extracted for the temp-file half); reviewer's session files (reviewer ADR-0011 d5; Python, its own folder).

## R9: The start decision is one pure function over one state read

- **Decision**: UserPromptSubmit gathers, with the orchestrator App's client: `laneOf`, the `blockedBy`
  issues and `isDone` of each, `specIssue` then `specPr`, the sub-issues, `isDone(s)`, and one `readState`.
  `decideStart(facts)` returns `start`, `resume`, or `refuse {reason, move, post}`. A start posts nothing and
  moves the card Ready → In progress (the commit point), then writes the record `taken: claim`; a refusal posts
  the keyed reason first (when its record says to), then moves the card (FR-013).
- **Rationale**: FR-012–FR-013; ADR-0002 d2–d5, ADR-0006 d1–d2. A crash after the lane write and before the
  record leaves open holds unreleased, so the next `/codeworks <s>` reads the state held and refuses: it fails
  closed, released by a Ready move (P2).
- **Existing tools**: core `laneOf`, `specIssue`, `specPr`, `isDone`, `readState` (fit). Missing in core:
  `blockedBy` and sub-issue reads, and the lane write (C3, C4 below). planner's `land.ts` reads sub-issues in its
  own script; it is not moved onto core's read here (deferred, see plan).

## R10: Claim ordered against reviewer's release

- **Decision**: as FR-015 settles: the record is written only after the lane write; reviewer (#209) calls
  core's `releaseOnClaim` at its first hook run that reads a record with `taken: claim`, and never otherwise.
  The orchestrator does not wait for it.
- **Rationale**: parallel UserPromptSubmit hooks (reviewer ADR-0013 d2).
- **Existing tools**: core `releaseOnClaim` (fits); `readSessionRecord` (R8).

## R11: Blocked reasons and status-issue comments are keyed

- **Decision**: `lib/keyed.ts` `postKeyed(writer, repo, issue, key, text)` posts a comment whose first line is
  `<!-- codeworks:orchestrator-reason <key> -->` only when no comment of the orchestrator App starts with it.
- **Rationale**: orchestrator ADR-0003 d3–d4 (HANDLED); FR-008, FR-013. Keys are grammar (P7).
- **Existing tools**: core `state.ts` `questionTag` (the tag-line pattern; not exported for reasons);
  `IssueComment` reading in `state.ts` (internal). None fit as a call; the comment read is the same GraphQL
  page read `state.ts` makes, which C6 below exports.

## R12: The orchestrator App's token is held in memory and re-minted

- **Decision**: `lib/app-token.ts` holds the `MintedToken` in a closure and returns a client; before each write
  it re-mints when core's `needsMint` (which accepts the `MintedToken`'s `value/repo/expires_at`) says so.
- **Rationale**: FR-016a, root ADR-0007 d3: the token never touches disk.
- **Existing tools**: core `mintToken`, `needsMint`, `gitHub` (fit).

## R13: The Stop hook pushes, from a copy the hooks own (Story 2)

- **Decision**: Stop fetches the story branch from the model's clone into a bare repository at
  `~/.local/state/codeworks/orchestrator/push/<owner>/<name>.git` with `--no-tags` through `runGit`, checks each
  new commit with `decidePush` against the pushed branch's passes in the commit-check pass record (core's
  `readCommitPasses`, #209), or none while its `off` is true, and the agent identity, and pushes the
  branch only when every commit passes. Core gains a push that hands an in-memory token to
  `gh auth git-credential` through the child's `GH_TOKEN` alone (C7).
- **Rationale**: FR-016; ADR-0001 d4, SECURITY.md §6.6, §8. `pushWithGhCredential` reads a gh config folder,
  which would put the orchestrator's token on disk (R12).
- **Existing tools**: core `runGit`, `pushWithGhCredential` (the credential path is reused; its token source
  does not fit); `fetchWithGhCredential` (fetches from GitHub, not the local clone).
- **Not run**: whether a sandboxed command can read a hook child's environment through `/proc`. The Story 2
  task that adds C7 tests it on the agent machine before the push lands, with a reader the model started with
  `run_in_background` before the turn ended, still running through the Stop hook's wait (`TaskStop` is denied,
  SECURITY.md §5): it tries `/proc/<pid>/environ` of the git child and of the Stop hook's own process.

## R14: The agent identity is read as data (Story 2)

- **Decision**: `runGit(checkout, ["config", "--file", "~/.gitconfig" resolved, "--no-includes", "--get",
  "user.name"])` and the same for `user.email`, exit 1 read as missing; an empty value is missing.
- **Rationale**: FR-017, root ADR-0008 d8: `runGit` sets `GIT_CONFIG_GLOBAL=/dev/null`, so the global file is
  read only by naming it.
- **Existing tools**: core `runGit` (fits).

## R15: How Stop waits (Story 4)

- **Decision**: as FR-021 settles: a loop in the Stop run, polling every 30 s with an injected clock and sleep,
  ending on a named step, a merge or `review_timeout`; hooks.json gives Stop `"timeout": 3900`.
- **Rationale**: FR-021; ADR-0001 d3.
- **Existing tools**: core `status` (`StatusWindow`, SILENT after the timeout; fits); `node:timers/promises`.

## R16: A running workflow is read from Stop's `background_tasks` (Story 2)

- **Decision**: Stop reads its input's `background_tasks`; an entry of type `workflow` with a running status
  means push nothing and name no step (FR-016b). No input field is a Blocked reason and the session ends.
- **Rationale**: ADR-0001 d3. Claude Code's Stop input lists each in-flight task with its type, `workflow`
  among them, "to distinguish session is done from session is paused waiting for background work"
  (https://code.claude.com/docs/en/hooks, Stop input). The four hooks ADR-0001 d3 names drive the loop alone.
- **Rejected**: a SubagentStart/SubagentStop ledger in a state file, as reviewer's `gate.py` keeps: two more
  hooks and a file for a fact Stop is handed.

## R17: Bound counts share reviewer's tagged-snapshot channel (Story 5)

- **Decision**: core's state-comment read and post (`judge`, `post`, tamper causes) become one function set
  parameterised by tag, App login and schema (C6); reviewer's state and the orchestrator's counts
  (contracts/counts-comment.md) are two uses of it.
- **Rationale**: FR-022's last sentence; P2's tamper rule.
- **Existing tools**: core `state.ts` (fits once parameterised; today the tag and App are fixed to reviewer's).

## R18: Attest, exempt, ready, In review, replies, merge (Stories 3–4)

- **Decision**: pure `decideAttest`, `decideReady`, `decideReview`, `decideMerge` over core's `attests`,
  `requiredChecks`, `threadsModule`, `trigger`/`status`/`findings` answers; the writes are REST check runs,
  `markPullRequestReadyForReview`, review-thread replies/resolve and the squash merge naming `sha`.
- **Rationale**: FR-019–FR-020; ADR-0004, ADR-0005, ADR-0007–ADR-0009.
- **Existing tools**: core `attest.ts`, `validation/*` (fit); missing pieces are listed as C8–C11.

## R19: builder stops pushing and marking ready (Story 2)

- **Decision**: `issue-tackle` Step 4 reads "commit, then end the turn; the orchestrator pushes and opens the
  draft PR"; Step 6's "Mark the PR ready" goes too, since the orchestrator flips it (ADR-0007).
- **Rationale**: FR-024, builder ADR-0003 d1. Shipped in Story 2's PR: before then nothing else pushes.
- **Existing tools**: the skill file (edited, not replaced).

## R20: `/codeworks <issue>` reaches UserPromptSubmit as typed

- **Decision**: the plugin ships `commands/codeworks.md` so `/codeworks` is a known command, and the hook
  matches the raw prompt against `^/codeworks ([1-9][0-9]*)$`. The command body tells the model only to take
  the hook's context as its step; every fact comes from the hook.
- **Rationale**: an unknown slash command may never reach the model or the hook.
- **Existing tools**: reviewer reads `/reviewer` keywords from `prompt` (shimgate.py), with no command file.
- **Run (T018, 2026-10-30, Claude Code 2.1.314)**: `claude --setting-sources "" --plugin-dir <throwaway> -p
  "/codeworks 212"` with a throwaway `orchestrator` plugin whose UserPromptSubmit hook saved its stdin and whose
  `commands/codeworks.md` body asked for one word. The hook's `prompt` was `/codeworks 212` as typed; `-p`
  accepted the command, and the model received the command's body. The input also carried `prompt_id` and
  `permission_mode`. Saved as `orchestrator/tests/fixtures/hooks/user-prompt-submit.json`, `cwd` and
  `transcript_path` replaced. The decision stands.

## R21: Stop reads builder's stop through core's stop rule (Story 2)

- **Decision**: after FR-016b's check and before the push, Stop reads the facts of #217's stop rule for the
  session's issue through core's `readStoryStopFacts`, passing as its `fetch` `(refspecs) => fetchWithGhCredential(checkout, ghFolder(home), repo, refspecs)`, `checkout` the hook's `cwd`
  (core resolves the main checkout from it, #217 R8), so it decides on the same fresh tip builder does, and calls `storyStop`. The gh folder holds the session App's token,
  so no orchestrator token is written (R12); the fetch updates only `refs/remotes/origin/<default>` in the
  checkout, the remote-tracking ref builder's own run fetches, no branch, worktree or index. A stop pushes nothing and names no step, and the session
  ends; when the card is In progress or In review and the stop is neither `done` nor `closed`, the rule's reason
  is posted keyed (R11) and the card moves to Blocked first.
- **Rationale**: FR-016c; builder ADR-0003 d2: builder ends its turn at a stop with a message naming why, and only
  the Blocked reason carries it to the admin. Without the rule, Stop names `issue-tackle <s>` again after every
  builder stop until REPEAT (FR-023), and the Blocked reason names the bound.
- **Existing tools**: none on main. #217's core PR adds `storyStop` and `StopState`; the read of its facts is core's
  too, so this hook and builder's step script read the same facts, not two readers.
- **Rejected**: a file builder writes for the hook to read: the model may not write a hook's folder (root ADR-0008
  d6). Parsing the turn's last message: a fact read from prose (P7).

## R22: Required checks from `[shared]` where the plan offers no rulesets (Story 4)

- **Decision**: `required_checks`, a non-empty list of distinct check names under `[shared]`. When it is set,
  core's `requiredChecks` reads it from the `[shared]` it is given and takes it in place of the rules' required status checks
  and makes no rules read; every step after is unchanged: the orchestrator's own checks dropped, could not run when
  nothing is left, each name read at the head from any App, the conflict finding. When it is not set, the reader
  reads the rules as now, and a refused read is could not run.
- **Rationale**: GitHub refuses rulesets, branch protection and the rules read on a private repo of a free plan
  (`403 Upgrade to GitHub Pro or make this repository public to enable this feature`, seen on this repo on
  2026-10-31). With no list, core's reader is could not run at every head, by design, so that nothing merges with
  no CI check read; nothing would merge. A key is data (constitution P7); it is `[shared]`'s because the orchestrator
  and builder (#217 B6) both read the required checks (root ADR-0002 d2; ADR-0009 d2).
- **Rejected**: a refused rules read taken as no required checks: a head would merge with no CI check read, and
  telling the plan apart from another refusal means reading the error text (P7).
- **Existing tools**: core `validation/required-checks.ts` and `settings.ts` `Shared` (fit, with the key: C14, landed by #217's US1 PR since builder reads it too).
