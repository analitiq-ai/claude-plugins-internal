# Interfaces: A PR labelled cleanup gets no alq-review gating

What changes at the plugin's edges. Internal function shapes are in [../data-model.md](../data-model.md).

## Hook refusals (PreToolUse/Bash, `pre_merge_gate.py`, every mode)

- `gh pr ready` / `gh pr merge` refusals (also `gate.py`'s ready refusal) end with the cleanup sentence (research R8).
  When the label could not be read, the refusal is the unread-label refusal alone (FR-007).
- A comment carrying the attestation marker is refused without a clean internal round at the head (or the release),
  labelled or not; its refusal names that round only, with no cleanup sentence (FR-011).

## `scripts/github.py` command line

```
python3 scripts/github.py cleanup <owner/repo> <pr-number>
```

stdout `cleanup` or `gated`, exit 0; the label is unread (gh fails, times out or gives no JSON, or the `labels` field
is malformed): stderr names why, exit 1; usage: exit 2.

## `poll-pr-review.sh`

New exit `5` CLEANUP. Exit `4` also covers a cleanup PR with a failing check. New stdout lines:
`Cleanup PR: <repo>#<pr> carries the cleanup label; no Codex, no internal review, no triage.` and
`CLEANUP: no check is failing; merge once the PR is ready.` The usage and the other exit codes are unchanged.

## Skill (`alq-github-pr-review/SKILL.md`)

Exit table gains `5`; a section *Cleanup PRs* (research R8).

## README

*What it enforces*: the merge and ready gate names the cleanup label beside the version-only release; the commit
checks name the cleanup exemption; an attestation still needs a round. *Requirements*: a rule must be created that
forbids an agent from applying the `cleanup` label; until it exists an agent-added label exempts the PR. Plugin version: MINOR bump in
`.claude-plugin/plugin.json`.
