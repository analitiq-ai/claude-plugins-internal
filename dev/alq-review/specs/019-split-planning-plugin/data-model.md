# Data model: split alq-review into review, plan and build plugins

## Spec argument (review-round launch)

| Form | Example | Parsed to |
|---|---|---|
| Spec folder, path from the repo root | `dev/alq-review/specs/019-split-planning-plugin` | `Folder(path)` |
| No spec | `null` | `NoSpec()` |

- A string is stripped of surrounding whitespace. An empty string, or any type but a string or `null`, does not parse.
  A missing `spec` key is its own refusal.
- A string such as `none` is read as a folder, and fails the shape step.
- Shape (pure): relative, no `..` segment, the parent folder's name is `specs`, and written in its one spelling (no
  `./`, no trailing or doubled `/`), since git lists it so and the binding compares strings.
- HEAD facts (read by the gate with `git ls-tree -l -z <head sha> -- <path>/spec.md`, at the head sha the round is
  pinned to): `<path>/spec.md` is a non-empty blob, and its id.

## Spec binding (ledger doc, per PR)

`state["spec"]`: the given value, the folder string stripped, or `null`. `state["spec_blob"]`: the blob id of
`<folder>/spec.md` in HEAD, or `null` with no spec. Both are absent until the PR's first review-round launch that opens
a round. `state["spec_held"]`: `{bound, head, at}`, recorded when a changed `spec.md` holds the PR and deleted when the next round opens (R18).

| State | Next review-round launch with value v |
|---|---|
| no `spec` key | v is verified; when the round opens, `spec = v` and `spec_blob` = HEAD's, in the same save |
| `spec != v` | refused; nothing changes |
| `spec == v`, HEAD's blob == `spec_blob` | v is verified again against the current HEAD; the round opens |
| `spec == v`, blobs differ, no `spec_held` or `spec_held.at` >= `unlocked_at` | refused with the diff; in `enforce`, `spec_held` recorded if absent and the PR is locked; in `log`, logged as a would-deny, nothing recorded, the round opens |
| `spec == v`, blobs differ, `spec_held.at` < `unlocked_at` | `spec_blob` = HEAD's; the round opens |

Whether `spec_held` was released is `ledger.released`, the one unlock predicate the verdict lock also uses: only an unlock stamped after
it releases it. The save that opens a round deletes `spec_held`. `spec` never changes after it is set, by any command or by the user.
Readers: the review-round launch, the assess-round launch, `briefs.brief` (the assessor's `spec_folder`) and the reviewer
prompt; `policy.locked` and `_lock_reason` read `spec_held`. A launch whose spec is refused in `log` mode opens a round
and binds nothing; until a later launch binds it, reviewers are given no spec text, the assessor no `spec_folder`, and an unlock
reply the `null` text. A PR
started before this change has no binding either; no code tells the two apart.

## Spec given to reviewers and the assessor

| Binding | Reviewer prompt | Assessor brief `spec_folder` |
|---|---|---|
| `Folder(p)` | the path `p/spec.md`, with the R10 wording; the reviewer reads it | `p`; the assessor reads `p/spec.md` |
| `NoSpec()` | "The caller says this change needs no spec. ..." | none |

Audit rounds carry no spec, as today.

## RESHAPE_SPEC unlock reply

| Binding | Reply after the release line |
|---|---|
| `Folder(p)` | open decision, why, spec gaps (`mechanism (spec_ref)` each), spec folder `p` |
| `NoSpec()` | open decision, then: this PR has no spec; close it and restart on a new PR bound to a spec that settles the decision |

## Planning workflow inputs

| Input | Today | After |
|---|---|---|
| `spec` | the description text | same |
| `spec_dir` | non-empty re-scopes that folder | same |
| `issue` | (none) | required in both entry forms; read by `close-not-worth-doing` (new-spec path only) |
| verdict inputs | premise, grill, critique | same |

Environment: `ALQ_PLAN_ROOT` (was `ALQ_REVIEW_ROOT`), set by the driver to the plugin folder.

## Plugins

| Plugin | Ships | Version |
|---|---|---|
| `alq-review` | hooks, gate, review/assess/claim/shim workflows, agents, `alq-github-pr-review` | 0.13.0 |
| `alq-plan` | `skills/issue-spec`, `scripts/{premise_report,rootcause,settled_design}.py`, `speckit/` | 0.1.0 |
| `alq-build` | `skills/issue-tackle`, `skills/root-cause-check` | 0.1.0 |

None has a `dependencies` field.
