# Research: the issue spec in every internal reviewer prompt

## R1: The gate inlines the whole spec into each internal reviewer prompt

- **Decision**: at launch, the gate reads the spec of the issue the branch is named for and quotes its full
  body in every internal reviewer prompt, full and delta rounds, with the instruction that each unmet
  Acceptance criterion is a finding. No issue in the branch name, or no spec on the issue, leaves the prompt
  byte-identical. Audit rounds are unchanged.
- **Rationale**: the gate replaces the workflow's args, so the caller cannot pass the spec; the prompt is
  the only channel. Inlining assumes nothing about the reviewer agents' tools, as claim-check already does
  with hunks. Quoting the whole spec avoids a parser keyed to `alq-shape`'s heading names, and keeps Out of
  scope in front of the reviewer. Acceptance criteria are graded on the whole change, so delta rounds carry
  it too.
- **Existing tools**: `briefs._reader_prompt` (claim-check's inline-content pattern): fit, followed.
  `briefs.issue_number`: fit, reused. A fetch command in the prompt (as the assessor brief had): rejected,
  it depends on the reviewer having Bash and gh.

## R2: `github.issue_spec` is the one selector of the spec comment

- **Decision**: `github.issue_spec(slug, n)` lists the issue's comments through `gh api --paginate` and
  selects those carrying `SPEC_MARKER` in Python. `briefs.branch_spec` applies it to a branch; the reviewer
  prompts and the assessor brief both use it, and the brief's printed `gh ... --jq` command is removed.
- **Rationale**: define once, reuse everywhere: reviewers and assessor grade against the same text with the
  same "none" and "more than one" handling.
- **Existing tools**: `github.SPEC_MARKER`: fit, the one marker constant. `github.released` (gh `--paginate`
  with one JSON object per line): fit, the same reading pattern.

## R3: An unreadable or ambiguous spec refuses the launch

- **Decision**: when gh cannot read the issue's comments, or finds more than one spec comment, the launch is
  refused with gh's error or the comment ids, before any round is opened, under the plugin's enforce/log
  mode like every other refusal.
- **Rationale**: running the round without the spec is a silent downgrade; the gate already refuses what it
  was deciding when a check cannot run (`gate._spec_problems`, spec 004 FR-021), and `alq-shape` posts
  exactly one spec per issue, so two leave no spec to grade against.
- **Existing tools**: `github._answer` (RuntimeError in gh's own words): fit, reused. `hookio.refuse`: fit,
  reused.
