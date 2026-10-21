# Research: K9, what a test checks

## R1: The judged categories are defined once, in Python, each with its own judge prompt

- **Decision**: `claimcheck.JUDGED` lists the judged categories. `briefs._JUDGE_PROMPTS` maps each to its
  prompt builder, and the gate sends the workflow `args.judges` keyed by category. The workflow takes each
  claim's judge prompt from `args.judges` by its category, so it holds no category literal. K9 is judged against its
  own test's inputs and assertions, never the code under test. The K1 prompt is byte-identical to main's, pinned
  by `tests/fixtures/k1_judge_prompt.txt`.
- **Rationale**: a red test is written before its code, so judging its text against that code can rule it
  WRONG (replayed on 2026-10-04: main's K1 judge ruled a red test's name WRONG for code not yet written).
  Exempting test text was rejected: a test message that claims more than its assertion checks misleads
  every reader of a failure, so it is judged, against the test. A replay of main's reader on a test with
  failure messages labelled them K1, so they reached the code judge. The workflow's `'K1'` literal was a second copy of `JUDGED`, which a
  new judged category would have silently missed.
- **Existing tools**: `claimcheck.JUDGED`: fit, widened from one category to a tuple. The existing judge
  prompt and `verdict_schema`: kept for K1, and the schema is shared by K9.

## R2: A test's name and failure messages are claims, and a hunk holding them is MIXED

- **Decision**: the reader prompt's MIXED label and its "code states no claim" rule name a test's name and
  failure messages, which K9 covers.
- **Rationale**: the reader validator refuses claims from a CODE hunk, and the reader prompt said code
  states no claim. A test name had no label it could be claimed under. A replay of main's reader on a test
  with no docstring or message labelled it CODE with no claims. CODE and MIXED hunks are swept alike by the
  shim check (`shimcheck.SWEPT`), so the relabel changes nothing there.
- **Existing tools**: `claimcheck.validate_reader`'s CODE rule: kept. The fix is the label's definition,
  not a carve-out.

## R3: A cached read or verdict stands only for the brief it answered

- **Decision**: a cached verdict records its claim's category and is reused only for a claim of that category
  (`claimcheck.still_correct`). A cached read records `briefs.READER_BRIEF`, a hash of the reader's task text
  and its kinds and categories, and is reused only under the same brief.
- **Rationale**: K1 and K9 are judged against different evidence, but a verdict was cached by file and quote
  alone, so a K1 `CORRECT` could clear a K9 claim with the same words whose own judge ruled it WRONG (red test:
  `test_a_correct_verdict_is_not_reused_for_the_claim_filed_under_another_category`). Reads were cached by
  patch-id alone, so a hunk read under the old labels (test messages as K1, test names as no claim) kept that
  read after the reader's task changed.
- **Existing tools**: the `claim_verdicts` and `claim_reads` tables: kept, with the category (verdicts) or the
  reader brief (reads) stored in the entry rather than added to the key, so no table changes. An entry from
  before this change has neither, so it is not reused.
