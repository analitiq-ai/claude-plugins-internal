# Interfaces: the internal review round checks the diff against the decisions that govern it

The check's shapes and refusals are [data-model.md](../data-model.md); this file holds only what crosses the plugin's
edge.

## Environment and settings

| Name | Read by | Meaning |
|---|---|---|
| `ALQ_ORG_ADR_DIR` | `adrkit.py` | absolute path of the org corpus (spec Terms, *Corpus*); unset or empty means no org corpus |
| `ALQ_REVIEW_DECISION_CHECKS` | `hookio.py` | overrides `config.json`'s `decision_checks` (spec FR-021) |
| `max_review_files` | `hookio.py` | `config.json` (spec FR-022) |

## adrkit

`@adrkit/cli` at the one version the plugin is built for; the gate calls only `adr check --json` and `adr --version`
(research R4, R5).

## Injected review-round arguments

Unchanged: `worktree`, `stage`, `round_ref`, `label`, `waves`, `assess`. New for an internal round:

- `waves[0]` ends with the decision reviewer's entry when any record governs the change:
  `{type: 'alq-review:decision-reviewer', short: 'decision-reviewer', prompt, schema}`, `schema` =
  `assessment.findings_schema(round_ref, 'decision-reviewer')`.
- `decisions`: the block in [data-model.md § Round arguments and result](../data-model.md#round-arguments-and-result).

An audit launch injects neither.

### Decision reviewer prompt

```
Review branch <branch> of <slug>.
In <root>, run: git diff <range>
<full: That is the whole change under review. | delta: That is what changed since the previous review round. ...>

These decisions govern files this change touches. Each is named by its corpus and id:
- <corpus> <id> "<title>"
...

Read each record in full, in its corpus, before the diff. Report every place the change does what a decision rejected, contradicts
what it chose, or breaks a consequence it commits to: quote the decision's words in the finding's title and name the
record (corpus and id) in its detail. Report nothing a decision does not settle; other reviewers cover the rest. An
empty findings list is a normal and expected answer.
<_ruled_on(state)>

Answer through StructuredOutput, numbering findings decision-reviewer-1, decision-reviewer-2, ...
```

## Round result

`review-round.js` adds `decisions: args.decisions` to its `INCOMPLETE` and `CLEAN` returns and to the object it returns
after `assess-round`; the key is absent when `args.decisions` is (audit). Nothing else in the result changes.

## Agent

`agents/decision-reviewer.md`: `name: decision-reviewer`, `tools: Read, Glob, Grep, Bash` (read-only git), dispatched
only by the review-round workflow; `gate.on_agent` refuses a direct dispatch as it does for the internal reviewers.

## README and version

README: item 8 under "What it enforces"; Layout rows for the new scripts and `agents/decision-reviewer.md`;
Dependencies names `adr` (the npm-installed command), its install step and node ≥ 22; Mode names `decision_checks`
and `max_review_files`. `plugin.json` `version: 0.14.0`.
