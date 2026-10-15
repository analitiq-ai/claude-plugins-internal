# Quickstart: validating the cleanup label

## Automated

```bash
cd dev/alq-review/tests && python3 -m unittest -v
```

US1 → `test_shell`, `test_gate`, `test_pre_merge_gate`; US2 → `test_poll_pr_review`, `test_poller_contract`;
FR-002 → `test_github`. SC-003: every existing ready/merge refusal test passes unchanged.

## By hand, in `claude-plugins-internal` (alq-review installed from the branch)

1. Open a draft PR that deletes one file under a `specs/` folder. No internal round on the branch.
2. As the user, add `cleanup` to PR `<n>` on GitHub.
3. Commit and push one more change on the branch: no claim-check or shim-check refusal.
4. Run `poll-pr-review.sh analitiq-ai/claude-plugins-internal <n>`: the `Cleanup PR:` line, no `@codex review`,
   exit `4` with `mergeStateStatus=DRAFT`. Mark the PR ready: allowed. Run the poller again: it waits for CI,
   then exits `0`. No inbox file for the PR under the state dir.
5. Merge PR `<n>`: allowed with no attestation comment.
6. On a second PR without the label, mark it ready: refused as today, naming the internal review.
