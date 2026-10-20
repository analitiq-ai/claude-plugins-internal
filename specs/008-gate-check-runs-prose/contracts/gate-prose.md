# Contract: what the prose may say about the gate

This prose copies `pr-gate.js` (owner) and the poller's report (derived). Nothing checks it for drift,
so these rules are checked by hand at review (quickstart).

## `.claude/rules/pr-review-loop.md`

- MUST: `codex-review` is a check run that the `analitiq-pr-gate` App posts on the head.
- MUST: point to the `alq-github-pr-review` skill for its states.
- MUST NOT: mention states, the title, the 👍, `WAIVED`, or "commit status".

## `.claude/skills/github-pr-review/SKILL.md`

- MUST: `codex-review` and `internal-review` are check runs from the `analitiq-pr-gate` App.
- MUST: tell agents to act on the run's state and title as the poller prints them under
  *Gate check runs*.
- MUST NOT: list the gate's states or success conditions.
- MUST: say "gate check runs" wherever it refers to the poller's gate output.
- MUST NOT: call a gate run a commit status, or speak of its "description".
- MUST NOT: mention override-merge (neither file does on `main`).
- Unchanged: the DeepSource "no status carries that" sentence.
