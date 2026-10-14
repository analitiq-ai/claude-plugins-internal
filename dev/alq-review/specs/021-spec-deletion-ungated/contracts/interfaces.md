# Interfaces: A PR labelled cleanup gets no alq-review gating

What changes at the plugin's edges. Internal function shapes are in [../data-model.md](../data-model.md).

## Hook refusals (PreToolUse/Bash, `pre_merge_gate.py`, every mode)

- label add to a PR (`gh pr create --label cleanup` included): names the PR, or the PR to be created, and says
  only the user adds the `cleanup` label, on GitHub; ends "Tell them and stop."
- label add where GitHub cannot say whether N is a PR: names why.
- graphql label mutation: add labels with `gh pr edit --add-label` so the hook can read which.
- `gh pr ready` / `gh pr merge` refusals (also `gate.py`'s ready refusal) end with the cleanup sentence (research R8),
  and start with the unread-label sentence when the label could not be read.

## `scripts/github.py` command line

```
python3 scripts/github.py cleanup <owner/repo> <pr-number>
```

stdout `cleanup` or `gated`, exit 0; gh gives no answer: stderr names why, exit 1; usage: exit 2.

## `poll-pr-review.sh`

New exit `5` CLEANUP. Exit `4` also covers a cleanup PR with a failing check. New stdout lines:
`Cleanup PR: <repo>#<pr> carries the cleanup label; no Codex, no internal review, no triage.` and
`CLEANUP: no check is failing; merge once the PR is ready.` The usage and the other exit codes are unchanged.

## Skill (`alq-github-pr-review/SKILL.md`)

Exit table gains `5`; a section *Cleanup PRs* (research R8).

## README

*What it enforces*: the merge and ready gate names the cleanup label beside the version-only release; the commit
checks name the cleanup exemption. Plugin version: MINOR bump in
`.claude-plugin/plugin.json`.
