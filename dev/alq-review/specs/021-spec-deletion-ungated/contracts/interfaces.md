# Interfaces: A PR labelled cleanup gets no alq-review gating

What changes at the plugin's edges. What each consumer does is in [../data-model.md](../data-model.md).

## Hook refusals (`gate.py` and `pre_merge_gate.py`)

The refusal texts are unchanged. A ready refusal given while the label could not be read ends with
`The cleanup label could not be read (<why>).`

## `scripts/github.py` command line

```
python3 scripts/github.py cleanup <owner/repo> <pr-number>
```

stdout `cleanup` or `gated`, exit 0; the read failed: stderr names why, exit 1; usage: exit 2.

## `poll-pr-review.sh`

Usage and exit codes are unchanged. On a cleanup PR: no wait on Codex, the `Cleanup PR:` line, the report
and the exits of data-model.md § Poller cleanup mode. An unread label: the `WARNING:` line, then today's poll.

## Skill (`alq-github-pr-review/SKILL.md`)

A section *Cleanup PRs* (research R8).

## README

*What it enforces*: the ready and merge gate names the cleanup label beside the version-only release; the commit
checks name the cleanup exemption; an attestation still needs a round. *Requirements*: a rule must be created that
forbids an agent from applying the `cleanup` label; until it exists an agent-added label exempts the PR. Plugin
version: MINOR bump in `.claude-plugin/plugin.json`.
