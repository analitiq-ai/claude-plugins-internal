# Interfaces: A PR labelled cleanup gets no alq-review gating

What changes at the plugin's edges. How each consumer decides is in
[../data-model.md](../data-model.md) § Decisions per consumer (rows D1–D5).

## Hook refusals (PreToolUse/Bash, `gate.py` and `pre_merge_gate.py`, every mode)

- The missing-review refusal of `gh pr ready` / `gh pr merge` ends with `github.CLEANUP_EXEMPTION` (D1, D3 step 4).
  Refusals for a hold the label keeps (D1–D3 step 1) carry no cleanup sentence.
- An unread label: the refusal is `Cleanup.refusal()` alone (D1, D3 step 3).
- A comment carrying the attestation marker is refused as D2 says, labelled or not.

## `scripts/github.py` command line

```
python3 scripts/github.py cleanup <owner/repo> <pr-number>
```

stdout `cleanup` or `gated`, exit 0; any unread fact (data-model.md § Cleanup): stderr names why, exit 1;
usage: exit 2.

## `poll-pr-review.sh`

New exit `5` CLEANUP; exit `4` also covers a cleanup PR that is not mergeable (D5 cleanup mode). New stdout lines:
`Cleanup PR: <repo>#<pr> carries the cleanup label; no Codex, no internal review, no triage.` and
`CLEANUP: GitHub reports the PR mergeable and no check is failing; merge once the PR is ready.` A label not read
prints D5's `WARNING:` line on stderr. The usage and the other exit codes are unchanged.

## Skill (`alq-github-pr-review/SKILL.md`)

Exit table gains `5`; a section *Cleanup PRs* (research R8).

## README

*What it enforces*: the merge and ready gate names the cleanup label beside the version-only release; the commit
checks name the cleanup exemption; an attestation still needs a round. *Requirements*: a rule must be created that
forbids an agent from applying the `cleanup` label; until it exists an agent-added label exempts the PR. Plugin
version: MINOR bump in `.claude-plugin/plugin.json`.
