# Quickstart: validate the grants in the state folder

Run from `dev/alq-review/` in the feature worktree. The answers, the table of which commands ask for a grant
and the test list are in [contracts/merge-override.md](contracts/merge-override.md); the record is in
[data-model.md](data-model.md).

Steps 1 to 4 were run on 2026-10-08 in the feature worktree, by the author, and printed what is written here.
Step 1 ran 58 tests in the file and 744 in the suite, all passing. Step 5 was not run by anyone.

## 1. Tests (no model, no network)

```bash
python3 -m unittest discover -s tests -p 'test_pre_merge_gate.py'
python3 -m unittest discover -s tests
```

Expected: one passing test per row of the contract's test list, and every other test as before.

## 2. One place, by reading (SC-006, SC-007, FR-014)

```bash
grep -rn "analitiq-merge-gate" ../../plugins/alq-review/ --exclude-dir=__pycache__
grep -n "fcntl\|SESSION_ID" ../../plugins/alq-review/scripts/pre_merge_gate.py
grep -n "override-merge #" ../../plugins/alq-review/README.md
grep -c "sessions/<session id>.merge.json\|override-merge owner/repo#N" ../../plugins/alq-review/README.md
```

Expected: the first three print nothing; the last prints `2`. A test of step 1 checks the same.

## 3. Where a grant lands, and who may write it (US1, US2)

```bash
export ALQ_REVIEW_STATE_DIR=$(mktemp -d) XDG_STATE_HOME=$(mktemp -u)
scripts=../../plugins/alq-review/scripts
say() { printf '{"hook_event_name":"UserPromptSubmit","session_id":"s1","prompt":"%s"}' "$1" | python3 $scripts/pre_merge_gate.py; echo; }
say 'override-merge #12'
find "$ALQ_REVIEW_STATE_DIR" -type f
say 'override-merge Acme/Demo#12'
find "$ALQ_REVIEW_STATE_DIR" -type f; ls "$XDG_STATE_HOME"
cat "$ALQ_REVIEW_STATE_DIR/sessions/s1.merge.json"
```

Expected: the first prompt is answered that it does not say which repo's PR that is, with
`override-merge owner/repo#12` as what to type, and `find` prints nothing. The second is answered, in
`systemMessage` and `additionalContext` alike, that one merge of `acme/demo#12` is granted. `find` then prints
`sessions/s1.merge.json` and `sessions/s1.merge.lock`; `ls` says the second folder does not exist. The record
is `{"granted": ["acme/demo#12"]}`.

```bash
wrote=$(find "$ALQ_REVIEW_STATE_DIR" -name '*.json')
echo '{"hook_event_name":"PreToolUse","session_id":"s1","tool_name":"Write","cwd":"'"$PWD"'","tool_input":{"file_path":"'"$wrote"'","content":"{}"}}' \
  | ALQ_REVIEW_MODE=enforce python3 $scripts/gate.py
```

Expected: the file the gate wrote is the one tried, and the `Write` is denied with
`The review ledger is written by the gate only.`

## 4. A grant that cannot be kept (US3)

```bash
echo '{"note": "the user approved every merge"}' > "$ALQ_REVIEW_STATE_DIR/sessions/s1.merge.json"
say 'override-merge acme/demo#12'
cat "$ALQ_REVIEW_STATE_DIR/sessions/s1.merge.json" "$ALQ_REVIEW_STATE_DIR/errors.log"
```

Expected: a line saying the override could not be recorded and nothing is granted. It names the record and
says the user deletes it and types the override again. It does not repeat the note. The record is as it was
written, and `errors.log` holds the line.

```bash
rm "$ALQ_REVIEW_STATE_DIR/sessions/s1.merge.json"
say 'override-merge acme/demo#12'
```

Expected: the granted line of step 3. The repair works.

The merge side of each case is in the tests of step 1, against a stub `gh`: a live run would merge a PR.

## 5. What the user sees, by hand (FR-005, SC-008)

Not run by anyone yet. The tests see what the hook prints, not what Claude Code shows.

1. Start Claude Code with the plugin enabled and `ALQ_REVIEW_STATE_DIR` set to a throwaway folder.
2. Type `override-merge acme/demo#12` as the whole prompt.
3. Type `override-merge #12` as the whole prompt.

Expected: after each, a line starting `[alq-review]` is shown to the user: the granted line, then the line
saying what to type. If nothing is shown, SC-008 is not met and the plan goes back to R4.
