# Quickstart: validate the lineage count

Run from `dev/alq-review/` in the feature worktree. The sequences and their results are in
[contracts/lineage.md](contracts/lineage.md); the shapes in [data-model.md](data-model.md).

## 0. Prerequisite

```bash
python3 -m pip install diff-match-patch
python3 -c "import diff_match_patch"
```

Expected: the import prints nothing. If `pip` refuses because the system manages this Python, note the command
that did work: research R13 needs it for the refusal's wording.

## 1. The mapping alone (no git, no hook)

```bash
python3 -m unittest discover -s tests -p 'test_lineage.py' -v
```

Expected: one passing test per row C1, C4 to C7, C10 to C12, C14 to C17, C19, C20 of the contract.

## 2. Through the gate (git and hook payloads, no model, no network)

```bash
python3 -m unittest discover -s tests -p 'test_*gate.py' -v
python3 -m unittest discover -s tests -p 'test_*check.py' -v
```

Expected: rows C2, C3, C8, C9, C13, C18, B1 to B7 and X1 pass. The two rewritten tests assert that a bug's
count survives a commit of another file and that two bugs overlapped by one change become one.

## 3. Everything

```bash
python3 -m unittest discover -s tests
```

Expected: no failure. Tests of the hunk hold are gone with it.

## 4. Live: #15

1. In a scratch repo with the plugin enabled, stage a README sentence the code contradicts. Run the claim
   check twice, rewording the sentence between: two `WRONG`.
2. Unstage the README, stage and commit another file (its own check passes), stage the README again, reword
   it, run the check: `WRONG`.
3. `git commit` → refused; the refusal lists three versions with their words and rulings and one
   `unlock claim-<id>` line.
4. Type that line → the commit passes. Reword the sentence, run the check, `WRONG` → refused again at once.

## 5. Live: the library missing

1. `python3 -m pip uninstall diff-match-patch`.
2. Launch `alq-review:claim-check` → refused: the check could not run, with the install command.
3. `git commit` → refused the same way. Install it again; both run.
