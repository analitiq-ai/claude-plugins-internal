# Quickstart: validate the split

Prerequisites: Python 3.13, git, `pip install specify-cli==1.0.7 diff-match-patch==20241021`, as in CI.

## Suites

```bash
for s in dev/*/tests; do (cd "$s" && python -m unittest -v) || exit 1; done
```

Expected: every suite green, including each suite's two guard tests (scripts load from a copy of that plugin alone;
no file names another plugin's command). See [contracts/interfaces.md](contracts/interfaces.md) for the refusal table
and binding cases the review suite covers.

## Standalone load (by hand, PR 2)

```bash
for p in alq-review alq-plan alq-build; do
  t=$(mktemp -d); cp -r "plugins/$p" "$t/"
  for f in "$t/$p"/scripts/*.py "$t/$p"/skills/*/scripts/*.py; do
    [ -e "$f" ] || continue
    (cd "$(dirname "$f")" && python3 -c "import $(basename "$f" .py)") || { echo "FAIL $p: $f"; exit 1; }
  done
done
```

Expected: no `ModuleNotFoundError`.

## End to end (manual, after PR 2)

1. Install only `alq-plan`. Run `/alq-plan:issue-spec #<throwaway issue>` and pick "write the spec". The run completes,
   the last message gives the folder and branch, and the issue has no new comment.
2. On another throwaway issue, pick "not worth doing" with a reason. The issue is closed as not planned with that
   reason.
3. Install `alq-review`. In a draft PR's worktree, launch review-round without `spec`: refused with the full call.
   Launch with the folder from step 1: the round opens. Launch again with another folder: refused.
   Commit a change to that folder's `spec.md` and launch: refused with the diff, and edits are refused. Type
   `unlock #<pr>` and launch: the round opens.
4. Install `alq-build` without `alq-review`, and run `/alq-build:issue-tackle <n> spec=<folder> branch=<branch>` to its
   review step. It stops and names alq-review.
