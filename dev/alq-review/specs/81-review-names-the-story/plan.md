# Implementation Plan: The review launch names the user story

**Branch**: `81-us1-story-argument` (#81, part of #80) | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Decision record**: ADR-0019 (`81-adr-name-the-user-story`), extending ADR-0016 decisions 1, 4 and 5 and
superseding ADR-0017 decision 2. ADR-0016 decision 6 and ADR-0018 stand.

## Summary

Every review-round launch, audits included, takes `spec` (a folder or `null`, checked as today) and a separate
`story` (a JSON integer of 1 or more, not a boolean). `story` is required beside a folder and absent beside `null`.
The PR is bound at its first round to `spec`, `story` and the `spec.md` blob, or to `null`. A later launch whose
`spec` or `story` differs is refused. After the changed-`spec.md` hold, a launch is refused when `spec.md` at the
commit it checks has no line starting `### User Story <N>` with the number ending at a word boundary. Internal
reviewers are told to grade the change against that story's section and the spec's exclusions only; the assessor
brief carries `user_story` beside `spec_folder`. Nothing is read from the PR body or the branch name.

## Constitution Check

| Principle | Answer |
|---|---|
| I. Contract-first | The binding is read in one place, `specbinding.bound(state)`, and the heading in one place, `specbinding.has_story`. Pass. |
| II. Ownership & trust boundaries | `story` is outside input, validated where it enters (`specbinding.parse_story`). Callers outside this repo adapt in #82 and the engineering repo. Pass. |
| III. Fail loud, no backwards compatibility | A folder binding with no `story` is not read as anything: `specbinding.bound` raises `KeyError` on one. The ship-time step below stands in for a migration. Pass. |
| IV. Test-first | Every scenario, edge case and pinned case below is a failing test before the code. Pass. |
| V. Smallest complete change | `briefs.bound_spec` is replaced by `specbinding.bound`, not kept beside it. Pass. |
| VI. Governing rule ships apart | ADR-0019 ships in its own PR. The README describes the plugin and changes with it. Pass. |
| P1. Code decides | Each refusal names its next step through `policy.review_call`. Pass. |
| P2. Only the user releases a hold | Unchanged: a changed `spec.md` is released by `unlock` only. The heading check is a refusal, not a hold. Pass. |
| P3. Rules are pure | `parse_story`, `bound`, `bind`, `has_story` are pure in `specbinding.py`; the gate reads git. Pass. |
| P4. A check that could not run is its own outcome | git failing to read `spec.md` for the heading is a `Step "spec.md"` refusal naming git's error. Pass. |

## Decisions

### D1. The arguments

The checks run in this order; the first that fails is the refusal. Today's checks keep their messages.

1. `spec` missing → refused as today.
2. `spec` neither null nor a non-empty string → refused as today.
3. Folder shape (`specbinding.shape_problem`, unchanged) → refused as today, `Step "shape"`.
4. `story` (`specbinding.parse_story`):
   - with a folder, `story` absent or `null` → "a spec folder needs a story";
   - with a folder, `0`, `-1` → "the story is 1 or more";
   - with a folder, `"2"`, `2.5`, `true` → "the story is a JSON integer";
   - with `spec: null`, any `story` key present (`null`, `2`, `"2"`, anything) → "no spec has no story". The null
     rule wins over the story's form.
5. Binding compare (D2).
6. `spec.md` at the round's head read (today's `_head_spec_md`).
7. Changed-blob hold (today's `_spec_text`, ADR-0016 d6 / ADR-0018).
8. Story heading (D3).

### D2. The binding

- Bound to a folder: the ledger doc has `spec`, `story`, `spec_blob`.
- Bound to null: `{spec: None, spec_blob: None}`, no `story` key (today's shape).
- Unbound: no `spec` key.

`specbinding.bound(state)` is the one reader: `None` (unbound), `NoSpec()`, or `Folder(path, story)`. `story` is
read only when `spec` is a folder. A folder binding with no `story` raises `KeyError`: no fallback (constitution
III). A launch whose `(spec, story)` differs from the binding is refused, naming the bound and the given arguments
and the launch to make. Binds and `spec_held` spending happen only when the spec step did not refuse (today's
`_admit_spec`, unchanged).

### D3. The story heading

`specbinding.has_story(text, story)`: some line of `text` starts with `### User Story <N>` and the number ends at a
word boundary (`re.M`, `^### User Story <N>\b`). `### User Story 12` is no heading for `1`;
`### User Story 1: Sign in` and `### User Story 1 - Sign in (Priority: P1)` are. Textual: a heading inside a fenced
code block counts. The gate reads the text at the checked commit by `<commit>:<folder>/spec.md`, never by the bound
blob id. One function, `gate._story_step`, applies it for review-round and assess-round launches alike (FR-002).

The heading is checked after the hold, so a `spec.md` change that also removed the heading is held first and shown
to the user (scenario 9). After the user's `unlock`, a launch refused for the missing heading binds nothing and
keeps `spec_held`; once the heading is committed back the next launch binds and spends the hold with no second
`unlock` (scenario 10), since `specbinding.text_step` binds any text after a later unlock.

### D4. Assess-round launches

The assess-round takes only `worktree`. Bound to a folder: today's `spec.md` read and hold, then the bound story's
heading at the commit it checks. Bound to null or unbound: no spec and no heading check.

### D5. Next steps (FR-005, scenario 11)

`policy.review_call(state, stage)` renders the launch from `specbinding.bound(state)`:

| Binding | `args` tail |
|---|---|
| folder `F`, story `N` | `spec: 'F', story: N` |
| `null` | `spec: null` |
| unbound, or no state (`gate.on_agent`, `gate.on_skill` pass `None`) | `spec: '<spec folder>', story: <N> \| spec: null` |

### D6. Briefs

- Internal reviewer, bound to a folder: "This change implements User Story `N` of the spec in `F/spec.md` of
  `<root>`. Read the section under its heading, `### User Story N`, and what the spec excludes. Every acceptance
  scenario of that story that the change does not meet is a finding: quote the scenario in its title. What the spec
  excludes bounds what you may ask for. Raise nothing about another story of the spec." The prompt names no other
  story (SC-002).
- Bound to null: unchanged ("The caller says this change needs no spec...").
- Unbound: unchanged (nothing).
- Audit reviewers: unchanged, no spec.
- Assessor brief: `user_story` beside `spec_folder`, both `null` when bound to null or unbound.
  `agents/assessor.md` says so.

### D7. Mode

Every new refusal follows the plugin's `mode` through `hookio.refuse`, like the other spec refusals: `enforce`
blocks; `log` records `would_deny`, the round opens, and the binding and `spec_held` stay as they were.

## Callers of what changes

Found with `grep -rn` over `plugins/` and `dev/`; read, not run.

| Function | Change | Callers |
|---|---|---|
| `specbinding.parse` | returns the folder path or `None`; no longer builds `Folder` | `gate._spec_step` (`briefs.bound_spec`, its other caller, is deleted) |
| `specbinding.parse_story` | new | `gate._spec_step` |
| `specbinding.bound` | new, replaces `briefs.bound_spec` | `policy.review_call`, `policy._holds`, `briefs.brief`, `gate._reshape_brief`, `gate.on_workflow` (→ `briefs.review_args`), `gate._spec_step`, `gate._assess_spec_step`, `gate._spec_text` |
| `specbinding.bind` | compares `Folder`/`NoSpec` values; the next step is appended by its caller | `gate._spec_step` |
| `specbinding.has_story`, `story_heading` | new | `gate._story_step` |
| `specbinding.Folder` | gains `story` | `specbinding.bound`, `gate._spec_step`; read by `briefs._graded_against`, `briefs.brief`, `policy.review_call`, `policy._holds`, `gate._reshape_brief` |
| `briefs.bound_spec` | deleted | was: `briefs.brief`, `gate._reshape_brief` (← `gate._unlock` ← `_on_release` ← `on_prompt` ← `handle`), `gate.on_workflow` |
| `briefs._graded_against` | names the story | `briefs._review_prompt` ← `briefs.review_args` ← `gate.on_workflow` |
| `briefs.brief` | adds `user_story` | `briefs.main`, the CLI the assessor runs |
| `policy.review_call` | renders `story` | `gate.on_agent`, `gate.on_skill`, `gate._spec_step`, `policy._obstacle` (← `mutation`, `launch_round`, `rerequest`, `mark_ready`), `policy._cap_refusal` (← `launch_round`, `rerequest`), `policy.mark_ready` |
| `policy._holds` | the spec hold names `F/spec.md` and `User Story N` | `policy.locked` (← `gate._unlock`), `policy._lock_reason` (← `_obstacle`, `launch_round`) |
| `gate._spec_step` | story checks, binding of `story`, heading | `gate.on_workflow` |
| `gate._assess_spec_step` | heading of the bound story | `gate.on_workflow` |
| `gate._spec_text` | the launch hold names `User Story N` | `gate._spec_step`, `gate._assess_spec_step` |
| `gate._story_step` | new | `gate._spec_step`, `gate._assess_spec_step` |
| `worktree.text_at` | new: a file's text at a commit, unstripped, `RuntimeError` in git's words | `gate._story_step` |

## Next-step sites

Every refusal that names a review-round launch as its next step, found with `grep -n "review_call(\|launch with\|Next step"`:

| Site | Next step after this change |
|---|---|
| `gate.on_agent` | `review_call(None, 'internal')`: both forms |
| `gate.on_skill` | `review_call(None, stage)`: both forms |
| `gate._spec_step`: `spec` missing, not a value, shape, story, binding, `spec.md` missing, heading | `review_call(state, stage)` |
| `specbinding.bind` (today "launch with spec <recorded>") | the text ends at the binding; `gate._spec_step` appends `Next step: review_call(state, stage)` |
| `policy._obstacle`: a dead round's relaunch | `review_call(state, rnd['stage'])` |
| `policy._cap_refusal` | `review_call(state, 'audit')` |
| `policy.mark_ready` | `review_call(state, 'internal')` |

Not changed, since they name no arguments but "the same call again": `policy.launch_round` (dirty tree: "commit,
then launch again"), `gate._open_pr` ("then launch again"), and `review-round.js` INCOMPLETE ("Launch this workflow
again with the same args"). `gate._head_spec_md` takes its next step from its caller, which passes
`review_call(state, stage)` on a review launch and "ask the user" on an assess launch.

## Outcomes by binding, launch and mode

`F`/`N`: the bound folder and story. "Call" is `review_call(state, stage)` per D5.

| Binding | Launch | `enforce` | `log` |
|---|---|---|---|
| unbound | review-round | D1 checks 1–4, 6, 8 on the given arguments (no compare, no hold). Each refusal denies and names the call with both forms. Passing binds `{spec, story, spec_blob}`, or `{spec: None, spec_blob: None}` for null. | Each refusal is logged `would_deny`; the round opens; nothing is bound; reviewers are told nothing of a spec. |
| unbound | assess-round | No spec or heading check; opens as today. | Same. |
| bound null | review-round | `spec: null` with no `story` opens. A `story` key → "no spec has no story", call `spec: null`. A folder with a valid story → binding refusal naming `spec null` and the given arguments, call `spec: null`. | Logged; opens; binding unchanged. |
| bound null | assess-round | No check; opens. | Same. |
| bound `F`, `N` | review-round | D1 in order. Other `spec` or `story` → binding refusal naming `spec 'F', story N`. Changed blob, no unlock since → held: refusal names `F/spec.md`, `User Story N` and the diff, records `spec_held`. Missing heading → `Step "story"` refusal naming `### User Story N`, next step "commit the heading to `F/spec.md`, then <call>"; `spec_held` stays. Passing re-binds `spec_blob` after an unlock and spends `spec_held`. | Each refusal logged `would_deny`; the round opens; `spec`, `story`, `spec_blob`, `spec_held` unchanged. |
| bound `F`, `N` | assess-round | `spec.md` read, hold, then the bound heading at the checked commit; a missing heading's next step is "stop and ask the user to restore it with a commit of their own". | Logged; opens; binding and `spec_held` unchanged. |

An edit or git move on a held PR is refused by `policy._holds`, naming `F/spec.md`, `User Story N`, both blobs and
the `git diff` that shows the change (scenario 8).

## Tests

In `dev/alq-review/tests`, written first and run to fail for the expected reason:

- `test_specbinding.py`: `parse` returns the value; `parse_story` for every row of the arguments table and the
  null-wins case; `bound` for the three states and the `KeyError` of a folder binding with no story; `bind`
  comparing story too; `has_story` (`12` vs `1`, `: `, ` - `, inside a code fence, not at a line start).
- `test_policy.py`: `review_call` per D5; the spec hold names `F/spec.md` and `User Story N`.
- `test_gate.py` (`SpecArgument`): scenarios 1–11 through the hook; the arguments table row by row; the null-wins
  order; the hold before the heading (scenarios 9, 10, including a heading-refused launch between unlock and fix);
  the heading inside a fence; audit launches checked like review rounds; a new refusal in log mode; no PR-body read.
- `test_agents.py`: `review-round.js` `whenToUse` names `args.story`; `assessor.md` names `user_story`.

## Ship-time step

The gate does not read a folder binding with no `story` (D2). Before shipping, query the ledger for any open PR
bound to a folder with no story:

```
sqlite3 "${ALQ_REVIEW_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/alq-review}/ledger.db" \
  "SELECT repo, pr FROM ledgers WHERE json_extract(doc, '$.spec') IS NOT NULL AND json_type(doc, '$.story') IS NULL"
```

and `gh pr view <pr> --repo <repo> --json state` each row. Wait for every open one to merge or close before
shipping. On 2026-10-13 that is #96 (`88-spec`).
