# Interfaces: A PR labelled cleanup gets no alq-review gating

What changes at the plugin's edges. How each consumer decides is in
[../data-model.md](../data-model.md) § Decisions per consumer (rows D1–D5).

## Hook refusals (PreToolUse/Bash, `gate.py` and `pre_merge_gate.py`, every mode)

The text of each refusal is the data-model.md cell that decides it (rows D1–D4); `Cleanup.refusal()` and
`CLEANUP_EXEMPTION` are stated in § Cleanup.

## `scripts/github.py` command line

```
python3 scripts/github.py cleanup <owner/repo> <pr-number>
```

stdout `cleanup` or `gated`, exit 0; unread (data-model.md § Cleanup): stderr names why, exit 1; usage: exit 2.

## `poll-pr-review.sh`

New exit `5` CLEANUP; exit `4` also covers a cleanup PR with a failing check or a merge state GitHub does not
report mergeable. The lines, exits and the `WARNING:` line are row D5 and § D5 cleanup mode. The usage and the
other exit codes are unchanged.

## Skill (`alq-github-pr-review/SKILL.md`)

Exit table gains `5`: take the step the `CLEANUP:` line names. A section *Cleanup PRs* (research R8).

## README

*What it enforces*: the merge and ready gate names the cleanup label beside the version-only release; the commit
checks name the cleanup exemption; an attestation still needs a round. *Requirements*: a rule must be created that
forbids an agent from applying the `cleanup` label; until it exists an agent-added label exempts the PR. Plugin
version: MINOR bump in `.claude-plugin/plugin.json`.
