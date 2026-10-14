# Quickstart: validating the cleanup label

## Automated

```bash
cd dev/alq-review/tests && python -m unittest -v
```

Each spec scenario maps to a test (research R11): US1 → `test_policy`, `test_gate`, `test_pre_merge_gate`;
US2 → `test_pre_merge_gate` (every form in [data-model.md](data-model.md) § Label-adding command); US3 →
`test_poll_pr_review`, `test_poller_contract`; FR-002 → `test_github`. SC-003: every existing ready/merge refusal test
passes unchanged.

## By hand, in `claude-plugins-internal` (alq-review installed from the branch)

1. Open a draft PR that deletes one file under a `specs/` folder. No internal round on the branch.
2. As the agent: `gh pr edit <n> --add-label cleanup` → refused, saying only the user adds it.
   `gh issue edit <m> --add-label cleanup` on an issue that is not a PR → allowed.
3. As the user, add `cleanup` to PR `<n>` on GitHub.
4. Commit and push one more change on the branch: no claim-check or shim-check refusal.
5. `gh pr ready <n>` → allowed. Run `poll-pr-review.sh analitiq-ai/claude-plugins-internal <n>` → `Cleanup PR:` line,
   no `@codex review`, exit `5` once CI is green; no inbox file for the PR under the state dir.
6. `gh pr merge <n>` → allowed with no attestation comment.
7. On a second PR, remove the label and run `gh pr ready` → refused as today, naming the internal review.
