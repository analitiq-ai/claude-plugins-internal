# Codeworks trust boundary matrix

Sources: the Codeworks design text of 2026-10-20; ADRs (reviewer, orchestrator, planner, builder, root docs/adr) at
commit 68b0fbe2e8 (PR #142); reviewer/plugin hook code; Claude Code and GitHub docs read on 2026-10-20 (see
Citations); read-only `gh` calls on 2026-10-20.

## Actors

| Code | Actor | Credential and process today |
|---|---|---|
| S+ | agent session, reviewer on | the bot user's OAuth token, scopes `repo, workflow, project, read:org, gist`. Org role admin; repo admin on this repo and other org repos. The reviewer hook runs in the same process tree, as the same OS user, with the same environment and gh credential (github.py) |
| S- | agent session, reviewer off | same credential. ADR-0006 d3 and `gate.handle()`: off lifts every rule, ADR-0012's ownership refusals included |
| H | human writer | own account. A human's interactive Claude session runs as the bot user, so it is S+/S- |
| O | outsider, public repo | no role; can open issues and PRs, comment, review, edit or close their own issues |
| F | fork author | O plus their fork head |
| A | orchestrator App | the PR-gate App. Live grants: checks write, statuses read, the rest read. The design adds statuses, PR, contents, issues and project write |
| P | session subprocesses | anything the session's shell starts (scripts, interpreters, background jobs, git hooks, test runners, child `claude` runs). Same token, same files. No PreToolUse hook sees them |

## Legend

Cell = `W · stop · holds`.
- W: **Y** can write, **N** GitHub refuses, **P** partial.
- stop: **H** reviewer hook; **R** ruleset; **G** GitHub permission model; **O** orchestrator predicate or re-derivation; **OS** file permissions; **none**.
- holds: **✓** holds against this actor; **✗** does not; **own** design owner; **trusted** a trusted actor can write it (override, not an attack).

Why **H** is ✗ for S+, S- and P: PreToolUse for Bash sees only the `command` string (hooks doc). The classifier
(shell.py, pre_merge_gate.py) recognises a few `git`/`gh` command shapes. Any other program holding the token, and
any child process, is outside what it parses. Claude Code's docs say a hook is not the place for a hard allow/deny,
Bash argument patterns are "fragile", and Read/Edit deny rules don't apply to subprocesses. No sandbox, no managed
settings on this host (default mode `auto`). Channels are therefore written as **tok** = "any process holding the
session token", **gh**, **git**, **tool** (Claude Edit/Write), **fs** (local file write), **ui**.

## Matrix

| # | State (design owner) | S+ | S- | H | O | F | A | P |
|---|---|---|---|---|---|---|---|---|
| 1 | Lane Ready (human) | Y tok (`project`) · H · ✗ | Y · none · ✗ | own | N · G ✓ | N ✓ | Y trusted | Y · ✗ |
| 2 | Lane In progress / In review (orchestrator) | Y · O re-derives each tick · ✓ | Y · O ✓ | Y · O ✓ | N ✓ | N ✓ | own | Y · O ✓ |
| 3 | Lane Blocked/Backlog (orchestrator; human drag = stop) | Y · H · ✗ (reads as a human stop; PARKED) | Y · ✗ | own | N ✓ | N ✓ | own | Y · ✗ |
| 4 | Lane Done (GitHub on close; human) | Y · H · ✗ (closes the issue) | Y · ✗ | own | N ✓ | N ✓ | trusted | Y · ✗ |
| 5 | Assignee = claim (orchestrator) | Y · H · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | own | Y · ✗ |
| 6 | Exempt label applied (human writer; EXEMPT sender = User ≠ bot) | Y · O sender filter · ✓ while sessions run as the bot user; ✗ if sessions move to another User and EXEMPT is unchanged. Removal: Y · ✗ (stall) | Y · O ✓ | own | N · G ✓ | N ✓ | Y · O ✓ | Y · O ✓ |
| 6b | Exemption bound to the approved head | Y push after the label · none (EXEMPT is per PR, not per head) · ✗ | Y · ✗ | trusted | — | Y own fork head after a label · ✗ | — | Y · ✗ |
| 6c | Bot-author exemption (author.type = Bot) | Y via a workflow-created PR (`workflow` scope) · none · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | n/a | Y · ✗ |
| 7 | Label definitions (human) | Y (repo; fine-grained: Issues or PRs write) · H · ✗ (rename into an exempt name — assumption: event resolves current label name) | Y · ✗ | own | N ✓ | N ✓ | n/a | Y · ✗ |
| 8 | Status internal-review (A) | Y tok (push access) · R pinned to the App's id · ✓ for the ruleset; ✗ for the orchestrator's own "differs?" read unless it filters by creator | Y · R ✓ | Y · R ✓ | N · G ✓ | N ✓ | own | Y · R ✓ |
| 9 | Status codex-review (A) | as 8 · ✓ (Codex review author is fixed) | ✓ | ✓ | N ✓ | N ✓ | own | ✓ |
| 10 | Other required checks (CI, CodeRabbit) | Y tok · R only where pinned; live: 4 CI contexts and `CodeRabbit` unpinned · ✗. Also the branch's own `pull_request` workflows define what pinned Actions checks run · ✗ | Y · ✗ | trusted | N ✓ | P fork workflow runs (read token) · ✗ for GREEN; merge still needs a label | n/a | Y · ✗ |
| 11 | Draft PR opened (builder/planner) | own | own | trusted | P fork PR only · O same-repo head · ✓ | Y · O ✓ | n/a | own-equivalent |
| 12 | draft → ready (A, once) | Y tok/GraphQL · H matches only `gh pr ready` / non-draft create · ✗ | Y · ✗ | own-equivalent | N ✓ | own fork PR | own | Y · ✗ |
| 13 | ready → draft = CONVERTED (human) | Y · not in ADR-0012 · ✗ | Y · ✗ | own | N ✓ | n/a | trusted | Y · ✗ |
| 14 | PR body after creation (builder, once) | Y · H · ✗ (extra `Closes #x`) | Y · ✗ | trusted | N ✓ | P own PR; merge is human · ✓ | trusted | Y · ✗ |
| 15 | Merge to default (A; human bypass list) | Y tok · H + R · ✗: live bypass is OrganizationAdmin (pull_request mode), `current_user_can_bypass: pull_requests_only`. Ruleset knows no HOLD/lane | Y · ✗ | own if on bypass list | N ✓ | N ✓ | own | Y · ✗ |
| 16 | PR close/reopen = CLOSED (human) | Y · not listed · ✗ | Y · ✗ | own | N ✓ | n/a | trusted | Y · ✗ |
| 17 | Review thread created (any reviewer) | Y · accepted · ✓ | ✓ | ✓ | Y · resolved unread · ✓ trust, ✗ availability (each new untrusted thread = FINDINGS relaunch; fingerprint changes, REPEAT never trips) | own PR | n/a | ✓ |
| 18 | Thread reply → TRUSTED keys on the latest author | own; reply outside a round freeze · ✗ | own | trusted | Y reply on a trusted reviewer's thread → latest author untrusted → resolved unread · none · ✗ | own PR | n/a | Y · ✗ |
| 19 | Thread resolved (session per ruling) | Y GraphQL · H checks rounds, not "resolved with a ruling" · ✗ | Y · ✗ | trusted | N ✓ | P own PR · ✓ partial | trusted | Y · ✗ |
| 20 | Review dismissed (human) | Y (PRs write) · not listed · ✗ (unverified for a COMMENTED review) | Y · ✗ | own | N ✓ | N ✓ | trusted | Y · ✗ |
| 21 | `@codex review` request (A; REQUESTED counts A only) | Y · H + O filter · ✓ (cost only) | ✓ | ✓ | Y comment · O ✓ (Codex's policy unverified) | ✓ | own | ✓ |
| 22 | Tagged state comment create (reviewer in-session; planner rescope hold) | Y tok, MCP tools (matcher names built-ins only) · H + O author filter = the bot user, the same identity · ✗ | Y · none · ✗ | Y · O author filter ✓ | Y · O ✓ | Y · O ✓ | trusted (not counted) | Y · ✗ |
| 23 | Tagged state comment edit (nobody) | Y · H + O checks author not editor · ✗ | Y · ✗ | Y — write access edits any comment, author unchanged · ✗ | N ✓ | N ✓ | trusted; any other App with issues write ✗ | Y · ✗ |
| 24 | Tagged state comment delete → rollback | Y · H · ✗ (deleting the snapshot that placed a hold releases it; design's "only blocks more" is false) | Y · ✗ | Y · ✗ | N ✓ | N ✓ | trusted | Y · ✗ |
| 25 | App comments: blocked reasons (HANDLED), escalation, Codex request | Y edit/delete (write access) · not listed · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | own | Y · ✗ |
| 26 | Escalation answer (WRITER) | Y · O WRITER ≠ bot · ✓; editing a writer's answer · ✗ | ✓ / ✗ | own | Y · O association ✓ | Y · O ✓ | n/a | ✓ / ✗ |
| 27 | Issue body (human; planner rescope; requirement for `no_spec`) | Y · H · ✗ | Y · ✗ | own | Y own issue · none · ✗ | Y own issue · ✗ | trusted | Y · ✗ |
| 28 | Issue close (GitHub via Closes; A for parent; human) | Y gh, Done drag, closing keyword in PR body or any squashed commit message · H blind to keywords · ✗ | Y · ✗ | own | Y own issue · ✗ | Y own issue · ✗ | own | Y · ✗ |
| 29 | Issue reopen (human) | Y · O "starts nothing" · ✓ | ✓ | own | P · ✓ | P · ✓ | n/a | ✓ |
| 30 | Sub-issues = PARENT (planner) | Y · not listed · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | n/a | Y · ✗ |
| 31 | blockedBy = order (planner) | Y · not listed · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | n/a | Y · ✗ |
| 32 | codeworks.toml on default | P via its PR · rides on the attestation · ✗ if 22 is forged | P · ✗ | own | P fork PR + label · ✓ | P · ✓ | n/a | P · ✗ |
| 33 | codeworks.toml on a PR head (A reads `[orchestrator]`/`[shared]` from head; reviewer reads `[reviewer]` from branch) | Y fs+git · H Edit/Write only · ✗ | Y · ✗ | trusted | N ✓ | Y own fork; A reads base for forks · ✓ | n/a | Y · ✗ |
| 34 | Own story branch commits (builder; FENCE, claim, shim, TICK_ONLY at commit) | own; commit gate parses only `git commit`, other commit-creating git commands and scripts skip it · ✗ (gate) | own, no gates | Y push → relaunch · ✓ | N ✓ | N ✓ | n/a | Y · ✗ |
| 35 | Another story's branch, `<p>-spec` | Y push to any ref · H FENCE checks local branch, not pushed ref · ✗ (and row 6b) | Y · ✗ | trusted | N ✓ | N ✓ | n/a | Y · ✗ |
| 36 | Default branch direct push | N · R ✓ | N ✓ | N ✓ | N ✓ | N ✓ | N ✓ | N ✓ |
| 37 | Force-push/delete a story branch | Y · no non-default ruleset · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | n/a | Y · ✗ |
| 38 | Spec folder on a story branch (planner; builder ticks only) | Y fs + any commit route · H Edit + TICK_ONLY at `git commit` · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | n/a | Y · ✗ |
| 39 | `.github/workflows` on any branch (human) | Y git (`workflow`) · none · ✗ | Y · ✗ | own | N ✓ | P read token, no secrets · ✓ partial | n/a | Y · ✗ |
| 40 | Rulesets (human/org owner) | Y repo-level (repo admin) · none · ✗; N org-level (live 404, needs admin:org) · ✓ | Y repo · ✗ | own | N ✓ | N ✓ | N ✓ | Y repo · ✗ |
| 41 | Repo settings: merge options, auto-merge, environments + branch policies, collaborators, hooks (human) | Y (repo admin) · none · ✗, including the protection of the environment holding today's App key | Y · ✗ | own | N ✓ | N ✓ | N ✓ | Y · ✗ |
| 42 | Board configuration (human) | P (`project`) · none · ✗ low | P · ✗ | own | N ✓ | N ✓ | trusted | P · ✗ |
| 43 | App private key (A, "host only") | Y fs if the session runs on the orchestrator host as the same OS user (host layout unspecified) · none · ✗. Today's second copy in an Actions environment secret is reachable through rows 39+41 · ✗ | Y · ✗ | owners make keys in the UI · trusted | N ✓ | N ✓ | own | Y · ✗ |
| 44 | Launch log / process lock (A host) | Y fs on a shared host/user · none · ✗ (defeats REPEAT/HANDLED/RUNNING) | Y · ✗ | trusted | N ✓ | N ✓ | own | Y · ✗ |
| 45 | Reviewer off switch (`sessions/<id>.off.json`; user prompt) | Y fs (on_bash doesn't guard state_root; on_edit does) or a child `claude` given the prompt · ✗ | own | own | N ✓ | N ✓ | n/a | Y · ✗ |
| 46 | ledger.db, grants (override-merge), session-issue file | Y fs · H Edit only · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | n/a | Y · ✗ |
| 47 | Reviewer plugin code, hooks.json | Y fs (user-owned plugin cache) · none · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | n/a | Y · ✗ |
| 48 | Claude settings: user `~/.claude/settings.json`, project `.claude/settings.json` (`disableAllHooks`, `enabledPlugins`) | Y fs/commit · none · ✗ (next launch on that branch); child `claude` with `--bare`/`--settings`/`--safe-mode` has no reviewer hooks · ✗ | Y · ✗ | trusted | N ✓ | P fork PR's project settings never launch · ✓ | n/a | Y · ✗ |
| 49 | Env overrides `REVIEWER_MODE`, `REVIEWER_STATE_DIR` (forbidden by design; honoured by hookio.py) | Y for any child `claude` it starts · none · ✗ | Y · ✗ | — | N ✓ | N ✓ | n/a | Y · ✗ |
| 50 | Reports / audit artefacts in the issue (auditor) | Y edit/delete · not listed · ✗ | Y · ✗ | trusted | N ✓ | N ✓ | trusted | Y · ✗ |

## Violated cells by root cause

A cell is violated when the design names one owner, another actor can write it, and the stop does not hold.

**RC1 — the session credential is over-scoped and shared.** Every session, the hook and every human interactive
session act as the bot user: org admin, repo admin, `repo workflow project` scopes, on the ruleset bypass list.
Cells: 1, 3, 4, 5, 6c, 7, 10, 12, 13, 14, 15, 16, 19, 20, 25, 27, 28, 30, 31, 35, 37, 39, 40, 41, 42, 43 (Actions copy),
50 — for S+, S-, P. Only commit statuses (8, 9) are protected, by the integration pin.

**RC2 — the attestation's evidence is a comment the graded session's own identity can create, edit or delete.**
The orchestrator's "newest tagged comment by the bot" cannot tell the hook from the agent, does not check the editor,
and treats deletion as a safe rollback. Cells: 22, 23, 24 (S+, S-, P; 23 and 24 also H and any App with issues write),
and through them 8, 32 and 15.

**RC3 — the hook shares process, OS user, filesystem and environment with the agent.** Whatever the hook guards
locally, the agent can rewrite or bypass. Off also lifts ADR-0012's ownership refusals (conflation). Cells: 34, 38,
45, 46, 47, 48, 49; it is also why every H stop in RC1/RC2 fails.

**RC4 — session-controlled config governs the reviewer and orchestrator for that session's own PR.** Cells: 33, and
via `trusted_reviewers` 18/19.

**RC5 — the orchestrator host is co-tenant with the sessions it launches, and the App key also lives in Actions.**
Cells: 43, 44.

**RC6 — exemption and trust are not bound to content or to an exact identity.** Cells: 6b, 6c, 7, 17 (availability),
18, 26 (edit).

## Options and recommendation per root cause

### RC1 — credential
1. **Separate session identity with least privilege.** A second GitHub App ("codeworks-session"), installed on the
   target repos; the orchestrator mints a per-launch installation token downscoped to one repo and the permission
   set below (installation tokens: 1 h, `repositories` + `permissions` downscoping, cannot exceed the App's grants —
   rest/apps/apps). No Administration, Workflows, Statuses, Checks, Actions, Secrets, Environments, Projects write.
   Closes 39, 40, 41, 42, 43 (Actions path), 10 (workflow path), 15 (bypass), 1/3/4 (no project write). Trade-off:
   the session's comments become type Bot, so EXEMPT's "author is Bot" and the "by the bot" filter must name App
   slugs; token refresh for sessions over 1 h.
   *Alternative:* a non-admin machine-user fine-grained PAT (single repo, same permissions). Simpler, but long-lived
   (default max 366 days), one token shared by concurrent sessions, and needs org approval (PAT policy doc).
2. **Ruleset hardening.** Replace `OrganizationAdmin` bypass with a named human team (bypass actors: roles, teams,
   apps; API also `User` — rest/repos/rules). Pin every required context to its integration (available-rules doc).
   Add `non_fast_forward` + `deletion` on `*-us*-*` and `*-spec`. Make HOLD and lane gating part of internal-review
   (pending while HOLD), so the ruleset enforces holds. Closes 15, 10, 37. Leaves 12–14, 19, 27–31 open.
3. **Move ownership writes to the orchestrator.** Ready flip, body, close, sub-issues/blockedBy, label writes go
   through A only; the session asks via a tagged request. Closes 12, 14, 30, 31 only if combined with option 1
   (otherwise the session still can).
   **Recommend 1 + 2.** Option 1 is the only one that takes the capability away; 2 is cheap and also stops humans'
   own bot-user sessions from bypassing. Remaining residue with a least-privilege token (Issues/PR write still
   allow 5, 12, 13, 14, 16, 19, 25, 27, 28, 30, 31 on its own repo) is closed by the orchestrator re-deriving from
   history: treat any such write whose actor is the session App as void (events carry the actor), not by the hook.

### RC2 — attestation evidence
1. **Move the round and the state write out of the session.** The orchestrator (or a reviewer service with its own
   App) runs the review round in its own process and writes the snapshot under its own identity. Closes 22–24 fully.
   Trade-off: substantial redesign of reviewer ADR-0011/0012; review latency moves to the orchestrator.
2. **Split credentials inside the session.** Bash runs sandboxed (`allowUnsandboxedCommands:false`,
   `failIfUnavailable`, credential paths denied) with a push-only token; the hook (outside the sandbox — sandboxing
   doc) holds the comment-capable token. Plus managed settings (`allowManagedHooksOnly`, reviewer force-enabled) and
   MCP GitHub tools disallowed. Closes 22–24 for S+/P as far as the sandbox holds; the docs call it "not a complete
   isolation boundary" and allowing github.com egress allows exfiltration of what Bash can read.
3. **Orchestrator verification of the comment.** Count only comments authored by the reviewer's own identity (from
   1 or 2), reject any with `lastEditedAt`/`editor` set (GraphQL fields confirmed live), and make holds monotonic:
   a hold is released only by a later snapshot that names it, never by deletion. Closes 23, 24 against everyone,
   22 only together with 1 or 2.
   **Recommend 3 now + 1 as the target.** 3 is small and removes the edit/delete class for every actor; 1 is the
   only real fix for create. Use 2 only as an interim if 1 is far off.

### RC3 — hook co-tenancy
1. **OS isolation of the session** (separate OS user or container/VM per launch): plugin code, managed settings,
   reviewer state and credentials not writable by the session user. Closes 45–49 and 43/44. Trade-off: launch
   infrastructure.
2. **Managed settings + sandbox on the same host:** root-owned managed `allowManagedHooksOnly`, reviewer in managed
   `enabledPlugins`, plugin in a root-owned dir, state dir outside the sandbox write set, sandbox mandatory. Closes
   45–48 for sandboxed Bash; `--bare`/managed-hook interaction unverified.
3. **Design fixes (needed with either):** delete the `REVIEWER_MODE`/`REVIEWER_STATE_DIR` overrides (49); decouple
   ADR-0012 ownership refusals from the off switch; move FENCE/TICK_ONLY/claim checks to the orchestrator over the
   pushed diff (34, 35, 38) — the server sees every commit regardless of how it was made.
   **Recommend 1 + 3.** 3's server-side diff check is what makes 34/35/38 hold at all.

### RC4 — config
1. Orchestrator and reviewer read `codeworks.toml` from the default branch via the API, never from the head. Closes 33.
2. Orchestrator refuses to attest a PR whose diff touches `codeworks.toml`, `.github/**`, `.claude/**`, or `specs/**`
   beyond TICK_ONLY (computed server-side), unless a human label bound to the head (RC6) exempts it. Closes 32, 38, 48 (project).
   **Recommend both;** 1 alone leaves the config-change PR itself attested by the old rules.

### RC5 — orchestrator host
1. Orchestrator runs as its own OS user; key mode 0600 to that user (or in a KMS/agent that signs JWTs); launch log and
   lock in that user's directory; sessions launched as another user with a scrubbed environment. Closes 43, 44.
2. Orchestrator on a separate host; sessions elsewhere. Same closure, more ops.
3. Remove the App's private-key secret from the Actions environment as soon as the orchestrator owns the statuses. Closes 43's second copy.
   **Recommend 1 + 3.**

### RC6 — binding
1. EXEMPT requires the labeled event to be newer than the head's latest push (head-bound); any push voids it.
2. Bot-author exemption limited to an allowlist of App slugs; github-actions excluded.
3. TRUSTED keys on whether any trusted reviewer's unresolved comment remains in the thread, not on the latest
   author; an untrusted thread is resolved without relaunching (no FINDINGS) to remove the griefing loop.
   **Recommend all three;** each is a predicate change in the orchestrator/reviewer with no new infra.

## What a session must legitimately write

- builder: push its own story branch, incl. merging the default branch into it (git; Contents write).
- builder: open one draft PR with body `Closes #s` (Pull requests write).
- reply to and resolve review threads per its rulings (Pull requests write; GraphQL `addPullRequestReviewThreadReply`
  / `resolveReviewThread` mapping not documented per mutation — verify).
- post its tagged state comment on the story issue/PR (Issues or Pull requests write) — only while RC2 option 1 is not done.
- planner: push `<p>-spec`, open its draft PR, create sub-issues and blockedBy links, post the rescope hold
  (Contents, Pull requests, Issues write).
- reads: metadata, contents, PRs, issues, checks, statuses, actions (CI logs); Projects read for PARKED checks.
- Not needed: Statuses, Checks, Administration, Workflows, Actions write, Secrets, Environments, Projects write,
  org permissions, merge.

## Recommended session credential

Per-launch installation token of a dedicated "codeworks-session" GitHub App, minted by the orchestrator:
- `repositories: [<the one repo>]`
- repo permissions: `contents: write`, `pull_requests: write`, `issues: write`, `metadata: read`,
  `checks: read`, `statuses: read`, `actions: read`
- org permissions: `projects: read`
- absent: administration, workflows, statuses write, checks write, actions write, secrets, environments,
  deployments, projects write, members.
- App not on any ruleset bypass list; App id excluded from EXEMPT, WRITER, TRUSTED and the orchestrator's App-only
  predicates (REQUESTED, HANDLED).
Caveat: `contents: write` also authorises the merge endpoint (fine-grained permissions doc), so option RC1-2
(bypass list without the session; HOLD in internal-review) is what stops a merge; GitHub has no merge-only permission.
With a token lacking `workflows`, pushes that change `.github/workflows` are refused.

## Citations

- Fine-grained permissions per endpoint: https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
  (statuses → Commit statuses; merge → Contents; pulls/reviews → Pull requests; issue comments, labels, assignees,
  issue state → Issues or Pull requests; sub-issues/blocked_by → Issues; rulesets, environments, branch policies,
  collaborators → Administration; workflow files → Workflows; Projects v2 → org Projects).
- Check runs App-only; statuses by anyone with push access: https://docs.github.com/en/rest/checks/runs ,
  https://docs.github.com/en/rest/commits/statuses
- Integration pin on required checks: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- Bypass actors: https://docs.github.com/en/rest/repos/rules ,
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository
- Installation tokens: https://docs.github.com/en/rest/apps/apps
- App private keys: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps
- PAT policy: https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization
- Comment edit/delete by write access: https://docs.github.com/en/communities/moderating-comments-and-conversations/managing-disruptive-comments
- Hooks: https://code.claude.com/docs/en/hooks ; permissions: https://code.claude.com/docs/en/permissions ;
  sandboxing: https://code.claude.com/docs/en/sandboxing ; CLI flags: https://code.claude.com/docs/en/cli-reference

## Unverified (assumptions)

- GraphQL mutation → fine-grained permission mapping (thread reply/resolve, ready/draft).
- Whether a renamed label satisfies EXEMPT (row 7).
- Whether a COMMENTED Codex review can be dismissed (row 20).
- Whether `--bare` skips managed hooks.
- Whether Codex honours an outsider's `@codex review`.
- Whether "Restrict updates" blocks PR merges (needed if merges are to be App-only via ruleset).
