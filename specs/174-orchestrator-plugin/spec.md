---
codeworks:
  v: 1
  kind: feature
  root_cause:
    observed: none
---
# Feature Specification: The orchestrator plugin carries core

**Feature Branch**: `174-spec`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "https://github.com/analitiq-ai/claude-plugins-internal/issues/174 — orchestrator:
create the plugin and carry core. `orchestrator/` holds only `docs/` and `README.md`; there is no plugin and it is
not in `.claude-plugin/marketplace.json`. Story 1: plugin, token, claim. Story 2: attest, push, ready, merge (after
reviewer's state lands). Decide in this spec: the orchestrator key file name, which hook pushes, how Stop waits,
where bound counts live, how the token is refreshed within a long turn, how the agent identity is read. Done when
the carrier check lists orchestrator."

## Clarifications

### Session 2026-10-30

- Q: Which language are the orchestrator's hooks and scripts written in? → A: TypeScript, run by Node; no Python.
- Q: How does the Stop hook wait on CI and the external reviewers? → A: One wait inside the Stop hook's run, up to
  `review_timeout`, under a hook timeout fixed above the largest `review_timeout` settings accept. A timeout per
  validator module, read from each module's configuration, is #210.
- Q: What shape does the bound-count comment take? → A: reviewer's state shape (reviewer ADR-0011): a new tagged
  full snapshot whenever a count changes, the orchestrator App's newest wins, and an edit, a missing tag or a
  deletion fails closed.
- Q: What does the Stop hook push while reviewer is off for the session? → A: The session's commits by the agent
  identity, without consulting the passes. It reads `off` from the commit-check pass record, which keys passes by
  branch (#209).
- Q: How does the Stop hook learn that builder stopped? → A: It calls core's stop rule (`storyStop`, #217) on the
  facts builder's step reads. A stop names no step and pushes nothing; the card goes to Blocked with the rule's
  reason unless the story is done or closed or the card is outside In progress and In review.

## User Scenarios & Testing *(mandatory)*

The actor is the admin who starts a session on the agent machine and names one issue with `/codeworks <issue>`
(root ADR-0008 d1). The other readers are builder's model, which acts on GitHub only through the session token,
and reviewer's hooks, which read the session token and the session's issue record.

### User Story 1 - Plugin, session token and claim (Priority: P1)

The orchestrator becomes a plugin carrying core, modelled on `core/tests/fixtures/carrier-plugin`: a `core` link
to `../../core/src`, a module package pinning core's runtime packages exactly with a v3 lockfile, a pinned plugin
version, and entry points that load only core's dependency guard statically. It imports `core/` and no other
plugin (orchestrator ADR-0001 d1) and is listed in the marketplace. Its SessionStart hook mints the session App's
token into the session's gh config folder, and its PreToolUse hook mints a new one before it expires (root
ADR-0007 d1–d2). On `/codeworks <issue>` its UserPromptSubmit hook claims the issue from Ready, or resumes it from
In progress or In review, and records it as the session's issue; any other issue, or a start the rules refuse,
is refused with the reason (orchestrator ADR-0002 d2–d4, d7; ADR-0006 d1–d2).

**Why this priority**: Every later move is a hook of this plugin, and the model has no GitHub token until it
mints one. Until this lands no card leaves Ready on a claim, and reviewer's fence has no session's issue to key on
(reviewer ADR-0015 d1).

**Independent Test**: Run the carrier check against `main`: it lists `orchestrator/plugin` with zero failures.
Against a fake GitHub, start a session and send `/codeworks <s>` for a Ready story with no hold, no blocker and a
merged spec PR: the session's gh config folder holds a session App token for the repository, the card is In
progress by the orchestrator App, and the session's issue record names `<s>` as a claim.

**Acceptance Scenarios**:

1. **Given** this story merged, **When** CI runs the carrier check, **Then** it lists `orchestrator/plugin` and
   reports no failure for it; `.claude-plugin/marketplace.json` lists `orchestrator` at `./orchestrator/plugin`.
2. **Given** a later PR changes `core/src` without bumping the orchestrator's plugin version, **When** CI runs
   the carrier check, **Then** it fails naming the orchestrator's `plugin.json`.
3. **Given** one of core's packages is not installed in the plugin, **When** any orchestrator hook runs, **Then**
   it exits 2 naming the package and the folder, and does nothing else.
4. **Given** a session starts on the agent machine, **When** SessionStart runs, **Then** the session's gh config
   folder holds a token of `codeworks-session` for the checkout's repository alone, with exactly the session
   App's read-only permissions, and the model's `gh` reads GitHub with it.
5. **Given** the stored session token expires within 10 minutes, **When** the model or a subagent makes a Bash
   call, **Then** PreToolUse mints a new one before the call runs.
6. **Given** a mint fails (key missing, managed settings not in effect, GitHub refuses), **When** PreToolUse or
   UserPromptSubmit runs, **Then** it exits 2 naming core's reason; no other credential is tried.
7. **Given** `/codeworks <s>` names a Ready story whose blockers are done, whose spec's issue has a merged spec PR
   and none open, which has no sub-issues, is not done, and whose state reads `startable`, **When**
   UserPromptSubmit runs, **Then** the orchestrator App moves the card from Ready to In progress, records `<s>` as
   the session's issue taken by a claim, and the prompt names `builder:issue-tackle <s>`.
8. **Given** the card is In progress or In review with no open hold, **When** `/codeworks <s>` is sent, **Then**
   it resumes: no lane is written, the record names `<s>` taken by a resume, and no hold is released.
9. **Given** a Ready card whose state is not `startable`, **When** `/codeworks <s>` is sent, **Then** the card
   goes to Blocked with no new comment, nothing is recorded, and the prompt is refused naming the open holds.
10. **Given** a Ready card whose spec's issue has an open spec PR or none merged, **When** `/codeworks <s>` is
    sent, **Then** the reason naming the open spec PR, or saying none merged, is posted, the card goes to
    Blocked, and the prompt is refused with that reason.
11. **Given** a Ready card with sub-issues, **When** it is named, **Then** the card goes to Blocked naming the
    sub-issues to name instead, and the prompt is refused.
12. **Given** a card in Backlog, Blocked or Done, a blocker not done, or a done story, **When** it is named,
    **Then** nothing is written and the prompt is refused naming the reason.
13. **Given** the session already recorded issue `<s>`, **When** a prompt names another issue, **Then** it is
    refused naming `<s>`.
14. **Given** a claim on the same prompt, **When** the orchestrator writes the session's issue record, **Then**
    the record names `claim` and is written after the claim's lane write; reviewer's releases from it are #209's
    acceptance (FR-015).

---

### User Story 2 - Push and open the draft PR (Priority: P2)

Between turns the Stop hook pushes the session's commits by the agent identity from a copy the hooks own, with the
orchestrator App's token held in memory: those the commit-check pass record names under the pushed branch, or all
of them while reviewer is off for the session. After the first push it opens the story PR as a draft carrying
`Closes #s` (orchestrator ADR-0001 d4; ADR-0009 d6). builder's `issue-tackle` stops pushing and opening the PR
itself, leaving both to the Stop hook (builder ADR-0003 d1). When core's stop rule (#217) finds a stop on the
story, the Stop hook pushes nothing and names no step, and the card goes to Blocked with the rule's reason, so
builder's stop reaches the admin (builder ADR-0003 d2).

**Why this priority**: Without it the loop stops at a claimed card: the model's token cannot push. It needs
in core first the commit-check pass record's contract, which #209 adds, and builder's stop rule, which #217
adds.

**Independent Test**: Against a fake GitHub, with a commit-check pass record naming two commits by the agent identity
under the story branch, end a turn: both are pushed from the hooks' copy and a draft PR with `Closes #s` exists. Add
a commit the record names only under a second branch of the same session, or a commit by another author: nothing is
pushed and the stop is refused naming it. Set the record's `off`: the session's commits by the agent identity are
pushed without a pass. Make the story branch differ on GitHub and locally: nothing is pushed, no step is named,
and the card is in Blocked with the stop rule's reason.

**Acceptance Scenarios**:

1. **Given** commits on the story branch that the commit-check pass record names under that branch, each authored and committed by the
   agent identity, **When** the Stop hook runs, **Then** it pushes them, and after the first push opens the
   story PR as a draft whose body carries `Closes #s`.
2. **Given** a new commit that did not pass, or whose author or committer is not the agent identity, **When** the
   Stop hook runs, **Then** it pushes nothing and refuses the stop naming the commit and the cause.
3. **Given** `~/.gitconfig` lacks `user.name` or `user.email`, **When** a push is due, **Then** nothing is pushed
   and the stop is refused naming the missing key.
4. **Given** the Stop input's `background_tasks` lists a running `workflow`, **When** the Stop hook runs, **Then**
   it pushes nothing and names no step; with no `background_tasks` field, the card goes to Blocked naming it.
5. **Given** builder's `issue-tackle` has committed a story's work, **When** it ends its step, **Then** it has
   pushed nothing and opened no PR; the Stop hook does both.
6. **Given** the commit-check pass record's `off` is true, **When** the Stop hook runs, **Then** it pushes the
   session's commits by the agent identity without consulting the passes, and pushes nothing when one is by another
   identity or its change touches a `.github/` folder, refusing the stop naming the commit and the cause.
7. **Given** core's stop rule finds a stop on the session's story, **When** the Stop hook runs, **Then** it pushes
   nothing, names no step and lets the session end; when the card is In progress or In review and the stop is
   neither `done` nor `closed`, the card first goes to Blocked with the rule's reason.

---

### User Story 3 - Attest and flip to ready (Priority: P2)

The orchestrator writes `internal-review` at each open PR's head from reviewer's state through core's `attests`,
marks exempt PRs, and flips an attested draft with no hold to ready (orchestrator ADR-0004; ADR-0005; ADR-0007 d1,
d4–d5).

**Why this priority**: GitHub's ruleset merges nothing without `internal-review`, and no external reviewer runs on
a draft. It needs Story 2's draft PR and core's protected-path matcher.

**Independent Test**: Against a fake GitHub with reviewer's state recording an INTERNAL round CLEAN at the head of
a draft PR: `internal-review` is success at the head from the orchestrator App and the PR is ready. A PR changing
a protected path is not attested and its card goes to Blocked naming the paths.

**Acceptance Scenarios**:

1. **Given** reviewer's state records an INTERNAL or AUDIT round CLEAN or CONVERGED_PUSHBACK that `attests`
   accepts for the head, and no hold, **When** a hook runs, **Then** `internal-review` is success at the head
   from the orchestrator App; otherwise pending.
2. **Given** a PR changing a protected path (ADR-0004 d4) or a fork PR, **When** a hook runs, **Then** it is not
   attested from reviewer's state; a protected-path story's card goes to Blocked naming the paths.
3. **Given** a PR authored by a non-codeworks App touching no protected path, or carrying an `exempt_labels`
   label applied after the head's push by a writer who is not a codeworks App, **When** a hook runs, **Then**
   `internal-review` is success marked "exempt"; an exempt story's card goes to Blocked with "exempt: an admin
   merges".
4. **Given** an attested draft with no hold, **When** a hook runs between turns, **Then** the PR is flipped to
   ready once (again after CONVERTED).

---

### User Story 4 - External review, replies, merge and the wait (Priority: P2)

Once the PR is ready, the orchestrator reads the required checks and each external reviewer's module, moves the
card to In review and triggers each module once per head, writes each `<module>-review`, replies to rulings and
resolves their threads, pushes at stage 2 only FIX commits or a merge of the default branch, waits in the Stop
hook up to `review_timeout`, and squash-merges on GitHub's gate (orchestrator ADR-0007 d2–d4, d6–d7; ADR-0008;
ADR-0009).

**Why this priority**: The merge ends the loop. It needs Story 3, and in core: rulings, replies and FIX commits in
reviewer's snapshot, the conflict-with-main finding, and the validator request time.

**Independent Test**: Against a fake GitHub with a ready, attested PR whose required checks pass: the card moves
to In review and each module is triggered once; with every module's verdict success, the PR is squash-merged
naming its head; with a module silent past `review_timeout`, the card goes to Blocked naming it.

**Acceptance Scenarios**:

1. **Given** a ready PR attested, GREEN, with no findings and no hold, **When** a hook runs, **Then** the card
   moves to In review and each module is triggered once for the head.
2. **Given** a ruling reviewer's state records on a trusted thread, **When** a hook runs, **Then** the
   orchestrator App posts its reply and resolves the thread: a FIX once its commits are pushed, a PUSH_BACK or
   DEFER at once; a thread no trusted reviewer started is resolved unread with a reply saying so.
3. **Given** stage 2, **When** the Stop hook pushes, **Then** it adds only commits a FIX ruling names or a merge
   of the default branch.
4. **Given** an In review card with no hold, every module's verdict success at the head and GitHub allowing the
   merge, **When** a hook runs, **Then** the orchestrator squash-merges naming the head it evaluated.
5. **Given** a module SILENT or a required check missing or pending, **When** the Stop hook runs before
   `review_timeout`, **Then** it waits within its own run, polling GitHub, and the session stays open; past
   `review_timeout`, the card goes to Blocked naming the reporter.

---

### User Story 5 - Bound the loop (Priority: P2)

The orchestrator counts a story's turns, the sessions on it that ended without their Stop hook, and the head and
findings REPEAT compares, in tagged snapshots on the story issue, and sends the card to Blocked at a bound
(orchestrator ADR-0001 d7–d8; ADR-0003 d5).

**Why this priority**: Without it a story that never converges loops without end. It needs Story 2's Stop hook,
which names the builder steps it counts, and core's tagged-snapshot read and post.

**Independent Test**: Against a fake GitHub: each builder step a hook names posts a new counts snapshot; at
`max_turns` the card goes to Blocked naming the bound; an edited snapshot sends the card to Blocked; a session the
next one finds not marked ended counts toward `k_deaths`.

**Acceptance Scenarios**:

1. **Given** REPEAT, two turns in a row from a working lane each ending with an unattested head, `max_turns`
   turns or `k_deaths` sessions ended without their Stop hook, **When** a hook runs, **Then** the card goes to
   Blocked naming the bound; a Ready move or `/codeworks reset` restarts every count.
2. **Given** the newest counts snapshot was edited or lacks its tag, or an orchestrator App comment was deleted
   after it, **When** a hook runs, **Then** the card goes to Blocked naming it.

---

### Edge Cases

- **Two `/codeworks` prompts in one session**: the same issue resumes (US1 #8); another issue is refused (US1 #13).
- **SessionStart's mint fails**: SessionStart cannot block a session, so the next UserPromptSubmit or PreToolUse
  mints again and refuses on failure (US1 #6).
- **One tool call outlives the token**: a call longer than the 10-minute margin can see the token expire
  mid-call; the token is read-only, so `gh` fails loud and the next call mints a new one.
- **A Stop while a workflow runs, or a task notification**: the Stop hook names no step, and a notification is no
  `/codeworks` prompt (orchestrator ADR-0001 d3).
- **The Stop hook crashes or times out**: it exits 1 and fails open; nothing is attested, flipped, pushed or
  merged, the session's comment is left unmarked, and the next session counts it toward `k_deaths`.
- **The session's comment edited by an account other than the orchestrator App**: the counts are not read; the
  card goes to Blocked naming the comment.
- **A repo switch on the agent machine**: the stored token names another repository, so the next mint replaces
  it (core's `needsMint`).

## Requirements *(mandatory)*

### Functional Requirements

**Plugin (US1)**

- **FR-001**: `orchestrator/plugin` MUST carry core as root ADR-0001 d2 and ADR-0009 d3–d4 define a carrier: a
  `core` link to `../../core/src`; a module package pinning exactly core's runtime packages with a v3 lockfile; a
  pinned `plugin.json` version, bumped on every change to `core/src` or core's pins.
- **FR-002**: Every hook entry point MUST import only core's dependency guard statically and MUST exit 2 naming
  the package on a missing dependency. Every hook but Stop MUST declare `"onFailure": "block"` and exit 2 on a
  refusal; the Stop hook MUST exit 1 on a crash and fail open.
- **FR-003**: The plugin MUST import `core/` and no other plugin's code (orchestrator ADR-0001 d1); it runs no LLM
  and parses no prose but through core.
- **FR-003a**: Every orchestrator hook and script MUST be TypeScript run by Node; the plugin holds no Python.
- **FR-004**: `.claude-plugin/marketplace.json` MUST list `orchestrator` with source `./orchestrator/plugin`.
- **FR-005**: CI MUST run the orchestrator's TypeScript tests, and a failing one MUST fail the build.

**Keys and settings (US1)**

- **FR-006** *(decides the key file names, SECURITY.md §3)*: The orchestrator App's key MUST be
  `~/.config/codeworks/orchestrator-app.pem` and the session App's `~/.config/codeworks/session-app.pem`, each
  read only through core's key reader by the orchestrator's hooks. The names follow core's `<app>-app.pem`
  convention (`planner-app.pem` in `core/src/keys.ts`; `session-app.pem` and `reviewer-app.pem` in its tests).
- **FR-007**: The orchestrator MUST read `[shared]` and its own `[orchestrator]` section of `codeworks.toml`
  through core's settings reader and MUST refuse, naming the file and key, when one is missing or invalid.
  `[orchestrator]` holds `app_id`, `session_app_id`, `status_issue`, `exempt_labels`, `max_turns`, `k_deaths` and
  `review_timeout`; each story adds the keys it reads: Story 1 `app_id`, `session_app_id` and `status_issue`, Story
  3 `exempt_labels`, Story 4 `review_timeout`, Story 5 `max_turns` and `k_deaths`.
- **FR-008**: A failure that names no issue (a SessionStart failure) MUST be posted on `status_issue` with the
  orchestrator App, keyed by its cause and posted only when no orchestrator App comment with that key exists.

**Session token (US1)**

- **FR-009** *(decides the folder's path and format, root ADR-0007 d2)*: The session's gh config folder MUST be
  `~/.local/state/codeworks/orchestrator/gh/`, one per agent machine, since one session at a time runs there
  (SECURITY.md §2), in core's gh-config format: gh's
  `hosts.yml` with the `github.com` token and the session App's login, and `codeworks-token.json` with the
  token's repository and expiry; folder mode 0700, files 0600, each replaced whole. The model's `gh` and git read
  GitHub only through it: the session's environment sets `GH_CONFIG_DIR` to it and sets none of core's
  `GH_TOKEN_VARIABLES`. The folder and its parent are readable by the model and write-denied to it.
- **FR-010**: SessionStart MUST mint a `codeworks-session` token for the checkout's repository alone into that
  folder through core, unless the stored one is for that repository and expires in 10 minutes or more.
- **FR-011** *(decides how the token is refreshed within a long turn)*: PreToolUse MUST run on every Bash call,
  subagents' included, and UserPromptSubmit on every prompt, each minting first under the same rule as FR-010; a
  failed mint MUST refuse the call or prompt naming core's reason. A single tool call longer than the 10-minute
  margin is the accepted gap. Bash is the one tool that reaches GitHub with the token: the managed settings load no
  MCP server (SECURITY.md §5), and WebFetch uses no gh credential (root ADR-0007 d2, orchestrator ADR-0001 d3).

**Claim and the session's issue (US1)**

- **FR-012**: On `/codeworks <s>` the orchestrator MUST start `<s>` only when its card is Ready on the board, every
  issue in its `blockedBy` is done, its spec's issue has a merged spec PR and no open one, it has no sub-issues,
  it is not done, and core's `readState` answers `startable`; and MUST resume, writing no lane, a card In progress
  or In review whose state is not held (orchestrator ADR-0002 d2–d4, d7; ADR-0006 d1). Any other prompt naming
  an issue MUST claim nothing and be refused with the reason.
- **FR-013**: A refused start or resume MUST move the card as its record says: to Blocked with no new comment for
  an open hold; to Blocked after posting the keyed reason for the spec-PR rule or a parent. The reason MUST be
  posted before the lane write, which is the commit point (orchestrator ADR-0002 d5, ADR-0003 d3).
- **FR-014** *(decides where the session's issue lives)*: After the lane write, the orchestrator MUST record the
  session's issue at `~/.local/state/codeworks/orchestrator/sessions/<session id>.json`, through core: the
  repository, the issue, whether it was a claim or a resume, and the claim's time. It is a file because it lasts
  one session: only state that outlives a session lives on GitHub (orchestrator ADR-0003 d1), and reviewer keeps
  its session-scoped state in files the same way (reviewer ADR-0011 d5). It is written once per session; a prompt
  naming another issue is refused naming the recorded one. reviewer and builder read it; the model cannot write it.
- **FR-015** *(decides the claim's order against reviewer's release)*: The orchestrator MUST decide the start from
  `startable` over one state read and MUST write the record only after the claim's lane write. reviewer MUST write
  the releases (core's `releaseOnClaim`) at its first hook run that finds the record naming a claim, before it lets
  a commit or round through, and never for a resume or with no record. Two plugins' hooks on one prompt run in
  parallel, so reviewer cannot see the claim on the prompt that makes it (reviewer ADR-0013 d2).

**Push and draft PR (US2)**

- **FR-016** *(decides which hook pushes, ADR-0001 d4, SECURITY.md §8)*: The Stop hook MUST push, at the end of
  each turn and before it attests or names a step, from a copy the hooks own, fetched from the model's clone with
  `--no-tags` (SECURITY.md §6.6), with the orchestrator App's token. It MUST push only commits whose author and
  committer are the agent identity and that the commit-check pass record (#209) names under the pushed branch, and
  at stage 2 FR-020b's commits alone. While the record's `off` is true (reviewer ADR-0006), it MUST push those
  commits without consulting the passes, refusing any whose change touches a `.github/` folder as reviewer ADR-0002
  d4 grades it: the App's workflows write is for merges of the default branch alone (ADR-0001 d1). One commit
  failing a condition MUST push nothing. Stop is the
  one hook sure to see each pass: reviewer's check workflow records it later in the turn (reviewer ADR-0002 d2,
  ADR-0003 d2), Stop ignores a stop while a workflow runs (orchestrator ADR-0001 d3), and builder ends the turn at
  an attested draft (builder ADR-0003 d2).
- **FR-016a**: A hook run that writes as the orchestrator App MUST mint that App's token through core and hold it
  in memory only, never on disk where the model's commands could read it (root ADR-0007 d3), and MUST mint again
  before a write once the token has under core's 10-minute margin left, so the Stop hook's wait (FR-021) never
  writes with an expired token.
- **FR-016b** *(decides how Stop sees a running workflow, ADR-0001 d3)*: While the Stop input's `background_tasks`
  lists a running task of type `workflow`, the Stop hook MUST push nothing and name no step. When the input has no
  `background_tasks` field, it MUST push nothing, move the card to Blocked naming the missing field, and let the
  session end. No other hook tracks running agents.
- **FR-016c** *(decides how Stop sees builder's stop, builder ADR-0003 d2)*: After FR-016b and before it pushes,
  the Stop hook MUST call core's stop rule (`storyStop`, #217) on the facts builder's step reads for the session's
  issue. On a stop it MUST push nothing, name no step and let the session end. When the card is In progress or In
  review and the stop is neither `done` nor `closed`, it MUST first post the rule's reason and move the card to
  Blocked (ADR-0002 d5); a card outside those lanes is an admin's (ADR-0002 d6).
- **FR-017** *(decides how the agent identity is read, root ADR-0008 d8)*: The agent identity MUST be `user.name`
  and `user.email` read from `~/.gitconfig` as data with `git config --file`, following no include, through core's
  git runner; a missing or empty value refuses the push naming the key.
- **FR-018**: After the first push the orchestrator MUST open the story PR as a draft whose body carries
  `Closes #s` and, as each session first pushes, that session's id trailer (ADR-0009 d6).
- **FR-024**: builder's `issue-tackle` skill MUST commit and end its turn, and MUST NOT push or open the PR
  (builder ADR-0003 d1); its step 4 says otherwise today (`builder/plugin/skills/issue-tackle/SKILL.md:58`).

**Attest, exempt and ready (US3)**

- **FR-019**: The orchestrator MUST write `internal-review` at each open PR's head with its App from core's
  `attests`, as ADR-0004 d1–d5 decide, and EXEMPT as ADR-0005 d1–d3 decide, rewriting only values that changed.
- **FR-020**: The orchestrator MUST flip an attested story PR with no hold open to ready, once per PR and again
  after CONVERTED, as ADR-0007 d1, d4–d5 decide.

**External review, replies, merge and the wait (US4)**

- **FR-020a**: The orchestrator MUST move to In review, trigger modules, write `<module>-review`, reply to and
  resolve threads, and merge exactly as ADR-0007 d2–d4, d6–d7, ADR-0008 d2–d4 and ADR-0009 d1, d4 decide.
- **FR-020b**: At stage 2 the Stop hook MUST push only commits a FIX ruling names or a merge of the default branch
  (FR-016).
- **FR-021** *(decides how Stop waits, ADR-0001 d3)*: While a module or required check is pending and
  `review_timeout` has not passed, the Stop hook MUST wait within its own run: it polls GitHub every 30 seconds,
  makes the writes each reading calls for (FR-019 to FR-020a), and returns when a hook names a builder step, the story
  has merged, or `review_timeout` passes, when the card goes to Blocked naming the reporter. The Stop hook's
  timeout in `hooks.json` MUST be 3900 seconds, and settings MUST refuse a `review_timeout` above 3600 seconds, so
  the wait always ends before the hook is cancelled. A wait refuses no stop, so it spends no model turn and never
  meets Claude Code's cap of 8 consecutive Stop continuations, which resets at every tool call
  (https://code.claude.com/docs/en/hooks, Stop input), so the builder steps Stop names do not reach it either.

**Bounds (US5)**

- **FR-022** *(decides where bound counts live, ADR-0003 d5)*: Bound counts MUST live on the story issue in
  comments tagged `<!-- codeworks:orchestrator-counts -->`, each the full snapshot: every session on the story with
  its id and whether it ended, the turn count, and the head and findings REPEAT compares. The orchestrator App MUST
  post a new snapshot whenever one of them changes: at the claim or resume, each time a hook names a builder step,
  and just before the Stop hook lets the session end. Its newest such comment wins. When that comment lacks the tag
  or was edited, or the issue's timeline shows an orchestrator App comment deleted after it, the card MUST go to
  Blocked naming it, as reviewer ADR-0011 d2 reads reviewer's state. Counts run from the newer of the last Ready
  move and the last admin `/codeworks reset`: deaths are the sessions not marked ended but the current one.
  reviewer's state and these counts MUST be read and written by one core function, given the tag and the App,
  rather than two parallel readers.
- **FR-023**: The orchestrator MUST move the card to Blocked naming the bound on REPEAT, on two turns in a row
  from a working lane each ending with an unattested head, or at `max_turns` or `k_deaths` (ADR-0001 d7–d8).

### Key Entities

- **Carrier**: a plugin with a `core` link, pinned packages and lockfile, and a pinned version.
- **Session token**: a one-hour, one-repository, read-only `codeworks-session` token in the session's gh config
  folder.
- **Session's issue record**: one file per session naming the repository, the issue, claim or resume, and the
  claim's time; written by the orchestrator, read by reviewer and builder.
- **Counts snapshot**: the orchestrator App's tagged comment on the story issue holding every session on the story
  and whether it ended, the turn count, and REPEAT's last head and findings; the newest wins.
- **Agent identity**: the name and email in the agent machine's `~/.gitconfig`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The carrier check on `main` lists orchestrator among its carriers with 0 failures.
- **SC-002**: In a test session, 100% of the model's GitHub calls carry a session App token, and 0 calls fail on
  an expired token across a turn longer than the token's hour made of calls under 10 minutes each.
- **SC-003**: 0 claims are written for a prompt the start rules refuse, and 0 holds are released on a resume or a
  refused prompt.
- **SC-004**: 0 pushed commits lack a pass in reviewer's record or carry an author or committer other than the
  agent identity.
- **SC-005**: 0 merges happen without `internal-review` and every `<module>-review` success at the merged head.
- **SC-006**: A session that ends without its Stop hook is counted by the next session on the issue every time.

## Assumptions

- All cited records are accepted (PR #176); the issue calls them draft, and this spec follows them as written.
- Core already provides, on `main`: the token mint and its permission sets (`tokens.ts`), the gh-config write, read
  and refresh rule (`gh-config.ts`), the key reader, the lane read (`board.ts`), the spec-PR and story-PR lookups
  and `isDone` (`identity.ts`), `readState` with `startable` and `releaseOnClaim` (`state.ts`), `attests`
  (`attest.ts`), and the push through gh's credential (`git.ts`). Each missing capability lands in core no later
  than the story PR that first uses it. Story 1 needs: the session's issue record, the state folder's paths, which
  builder's step script reads too (#217), and an issue number to its story branch and PR. Story 2: the commit-check
  pass record, which #209's core PR adds, and builder's stop rule, which #217's core PR adds. Story 3: the
  protected-path matcher. Story 4: rulings, replies and FIX commits in the snapshot; the conflict-with-main finding;
  the validator request time.
- SECURITY.md §5's managed settings, and core's managed-settings check, gain the folder
  `~/.local/state/codeworks/orchestrator` (write-denied to the model) and `GH_CONFIG_DIR` in `env`, replacing
  the `/tmp/verify-b-ghsess` placeholder, in their own PR before Story 1's (constitution Principle VI).
- reviewer writing its state through core, reading the session's issue record and writing the claim's releases
  (FR-014, FR-015) is #209, reviewer's rebuild on core. Stories 2–5 are built and tested against a fake GitHub;
  they run live only once #209 lands. Until Story 2 lands, a session on the agent machine cannot push.
- Open records: reviewer ADR-0011 d3 already says the orchestrator reads rulings from reviewer's state, and
  ADR-0007 d2, d6–d7 need them per thread; the records agree, and the snapshot gaining rulings, replies and FIX
  commits is Story 4's core need. The spec-PR label (ADR-0005 d4) is any `exempt_labels` label; a spec PR is found
  by its `<p>-spec` branch (root ADR-0005), never by a label. npm install under managed settings (SECURITY.md
  §8) stays open: the admin installs the plugin outside a session, and the guard (FR-002) refuses while a package
  is missing.
- Defaults: the refresh margin is core's 10 minutes; `review_timeout` is core's 1800 seconds (its module
  contract's default), at most 3600; the Stop hook polls every 30 seconds under a 3900-second hook timeout.
- Not here: the validators link; no `validators/` is tracked yet.

## Why this is worth doing

### harm
Answer: No code does the GitHub writes the records give the orchestrator: the session token, the claim, the lanes, the internal-review attestation, pushes, the draft PR, review requests and the squash merge. builder's issue-tackle skill pushes and opens the draft PR itself, with whatever gh login the session has, since no session token is minted; no card leaves Ready on a claim, no head is attested, and nothing merges on GitHub's gate.
Source: code: orchestrator/ holds only README.md and docs/adr on main 4c68778; builder/plugin/skills/issue-tackle/SKILL.md:58; root ADR-0007 d2-d3 (the SessionStart hook mints the session token; hooks alone act as codeworks-orchestrator); orchestrator ADR-0002 (the orchestrator alone writes the working lanes).

### reachable
Answer: observed: on main 4c68778 there is no orchestrator/plugin, and .claude-plugin/marketplace.json lists reviewer, planner, builder and auditor but no orchestrator.
Source: code: `git ls-tree origin/main -- orchestrator`; .claude-plugin/marketplace.json.

### change-alters
Answer: Yes. With the plugin installed, `/codeworks <issue>` starts a session whose SessionStart hook mints the session token, whose UserPromptSubmit hook claims the issue from Ready, and whose hooks attest a reviewed head, push it, open and mark the PR, request the external reviewers and squash-merge on GitHub's gate.
Source: code: orchestrator ADR-0001 to ADR-0010; issue #174 Stories 1 and 2.

### owner
Answer: No. No other plugin writes a lane or merges (orchestrator ADR-0002, ADR-0009); core/scripts/check-carriers.ts checks 1 carrier (planner) on main.
Source: code: orchestrator ADR-0002, ADR-0009; `node core/scripts/check-carriers.ts --base origin/main` prints "1 carriers checked".

### inherited
Answer: Yes: from the accepted codeworks records (root ADR-0001, ADR-0007, ADR-0008; orchestrator ADR-0001 to ADR-0010), ratified in PR #176. They give the orchestrator these writes, and no record assigns them elsewhere, so the questions above hold for those decisions too.
Source: code: docs/adr and orchestrator/docs/adr on main 4c68778; PR #176.

### needs-spec
Answer: It has decisions. #174 lists six to make in the spec (the orchestrator key file name, which hook pushes, how Stop waits, where bound counts live, how the token is refreshed within a long turn, how the agent identity is read) and records to reconcile (reviewer ADR-0011 d3 against orchestrator ADR-0007, npm install under managed settings).
Source: code: issue #174 "Decide in this spec" and "Open records".

## Root cause

Not a defect report.
