---
schemaVersion: 0.1.0
id: "0007"
title: "Name each spec folder by its issue, one folder per issue"
status: draft
date: 2026-10-12
deciders: []
tags: [spec-folder, workflow, skills, rescope]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0004", "0005", "0008"]
affects:
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
  - type: path
    pattern: "plugins/alq-plan/scripts/*.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
review:
  tier: async
externalRefs:
  - type: issue
    id: "79"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
    label: "alq-plan: name spec folders by their issue, land the spec through its own reviewed PR"
  - type: doc
    id: "engineering ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "One spec per issue, at specs/<issue>-<slug>/"
---

# ADR-0007: Name each spec folder by its issue, one folder per issue

## Context

Spec Kit names a new scope's spec folder. The workflow's `specify` step gives `speckit.specify` the issue text and
the premise report, and no folder. `speckit.specify` then picks `specs/<NNN>-<short-name>`: `<NNN>` is the next free
3-digit number, because the project's `init-options.json` sets `feature_numbering` to `sequential`, and the agent
picks the short name. Given `SPECIFY_FEATURE_DIRECTORY`, it uses that folder as it is. Spec Kit's
`create-new-feature.sh` takes a `--number`, but pads it to three digits, and the `speckit.specify` skill does not call
that script.

So nothing ties a folder to the issue it scopes. In `dev/alq-review/specs/` the numbers are Spec Kit's: `016`
scopes #35, `017` #36, `018` #17 and `019` #63. Nothing stops a second scope of one issue from making a second
folder, and a rescope's `select-spec` step takes any `specs/<feature>` that holds a `spec.md`, whatever issue it is
given.

Two of this log's records allowed this. ADR-0001 lists as a trade-off that a folder's name need not carry the issue
number. ADR-0005 lists that more than one spec folder per issue is allowed, and names "an issue scoped twice by
mistake because nothing showed it had been" as how we would know it was wrong.

The organisation's git workflow (`analitiq-ai/engineering`, `docs/engineering/git-workflow.md`, ADR-0002) now wants
exactly one spec per issue, at `specs/<issue>-<slug>/`.

Why now: issue #79, part of #80, which adopts that workflow in alq-plan, alq-review and alq-build. The spec is
`dev/alq-plan/specs/79-one-spec-per-issue/`, named by this rule.

## Decision

1. We will name every spec folder alq-plan creates `specs/<issue>-<short-name>` under the run's project. `<issue>`
   is the number of the issue in the repo that holds the folder. `<short-name>` is lowercase kebab-case.
2. We will keep one spec folder per issue. A new scope of an issue that already has `specs/<issue>-*` is refused,
   and the refusal names the rescope form with that folder. A rescope must name a folder whose name starts with
   `<issue>-`, and no other `specs/<issue>-*` may exist.
3. We will have `/alq-plan:issue-spec` pick `<short-name>` once, at the start of a new scope, as 2 to 4 words of the
   issue title, and pass the whole folder to the alq-spec workflow as one input, on every run. The workflow checks
   it with one pure function before anything is written. It passes the folder to `specify` as
   `SPECIFY_FEATURE_DIRECTORY`, and after `specify` checks that `.specify/feature.json` names it. Every step takes the
   folder from that input, the no-spec folder of a `no spec needed` pick (ADR-0008) included.
4. We will not use Spec Kit's default numbering for the folders alq-plan creates.

This record changes the text of no earlier decision. It ends two trade-offs that earlier records accepted:

- ADR-0001: "A spec folder's name need not carry the issue number." It now does.
- ADR-0005: more than one spec folder per issue is allowed. It is not. ADR-0005's rescope form,
  `rescope <spec folder> #<issue>`, stays, and gains the check of decision 2.

It does not amend ADR-0004. What counts as a spec folder is unchanged: `specs/<feature>/` beside a committed
`.specify/`. This record narrows which spec folders alq-plan writes and rescopes.

## Options considered

### Option A: The skill names the folder by its issue, and the workflow checks it (chosen)

| Dimension | Assessment |
|---|---|
| Folder name | `specs/<issue>-<short-name>` |
| Who picks it | The skill, once, before the workflow starts |
| Who checks it | One pure function in the workflow, before any folder is written |
| Second scope of an issue | Refused, naming the rescope form |
| Rescope of another issue's folder | Refused |
| Folder `specify` writes against the one it was given | Checked after `specify`, through `.specify/feature.json` |

### Option B: Do nothing

Spec Kit keeps numbering folders. An issue's folder is found only from planning's last message or the PR that
binds it, and one issue can have several.

### Option C: Spec Kit's number set to the issue number

`create-new-feature.sh --number 79` gives `specs/079-<short-name>` for #79: a name that does not start with `79-`,
and whose width changes past issue 999. `speckit.specify` does not call the script, so the workflow would still not
choose the folder.

### Option D: The issue number as a prefix, the short name left to `specify`

The workflow would tell `specify` the prefix and take whatever folder it writes. Rejected: no folder is known before
`specify` runs, so the run has nothing to check the written folder against.

## Trade-offs

- The agent picks the short name from the issue title, so it is not repeatable. Only its form is checked.
- The check sees the `specs/` of the run's project. A second Spec Kit project in the same repo can hold a folder for
  the same issue, and the folder check does not refuse it.
- An issue whose scope turns out to be two pieces of work cannot have two folders. The second piece needs an issue
  of its own (engineering ADR-0002: a parent issue with sub-issues).
- `speckit.specify` is a prompt, and decides from its text whether it was given `SPECIFY_FEATURE_DIRECTORY`.
  Whether the headless agent honours it was not run when this record was written. The check after `specify` is
  what holds the folder.
- Existing folders do not follow the rule until they are renamed or deleted, as the spec's Story 4 does.

## Consequences

- Easier: an issue's spec folder is found from the issue number alone. A second scope of an issue is stopped before
  anything is written. A rescope cannot be pointed at another issue's folder.
- Harder: the skill has to pick a short name before the run. A rescope that names a folder of the old form is
  refused until the folder is renamed.
- **How we would know this was wrong:** two folders `specs/<issue>-*` for one issue in one project; a run that
  completes on a folder other than the one it was given; or users who rescope to get past the one-folder refusal.
- Revisit if: `speckit.specify` stops honouring `SPECIFY_FEATURE_DIRECTORY`, or specs have to be written for issues
  held in another repo.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
