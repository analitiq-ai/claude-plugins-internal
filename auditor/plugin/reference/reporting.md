# Output discipline

Read by both orchestrating skills. The report is the deliverable; everything
before it is working.

## Stay silent while the detectors run

From the moment you dispatch until the report is ready, **say nothing**. No
announcement of what you are dispatching, no note as each detector returns, no
running tally, no relay of an individual detector's findings, no interim summary.

This is not a style preference. **A detector's claim is not a finding.** It
becomes one only after you have verified it against the code, deduped it against
the other detectors, and decided its severity. Narrating claims as they arrive
publishes conclusions that have not survived synthesis — including ones you are
about to drop as unverified, merge into another entry, or re-rank. The invoker
then holds two versions of the audit and has to reconcile them, which is worse
than having waited.

Wait for every detector, synthesize, then speak once.

## The report is the whole output

No preamble, no description of the method, no list of what was dispatched, no
account of how long anything took, no closing offer of next steps. Open with the
process verdict where the skill defines one, otherwise with the findings.

Do not explain this plugin's own structure. The invoker does not need to know
which detector produced which finding, unless naming it is what makes the finding
comprehensible.

## Verbosity floor

Every finding gets exactly the fields
`${CLAUDE_PLUGIN_ROOT}/reference/finding-format.md` defines, and nothing else.
One sentence per field. A finding that needs three sentences of setup is a finding
you have not yet reduced to its claim.

Enough to act on, and not one line more: what it is, what it costs, what replaces
it. Cut restatement, cut hedging, cut anything the `Correct fix` line already
implies.

## The two exceptions to brevity

- **The clean-scope statement is never trimmed.** It is what makes an absence of
  findings a checked claim, and a short one is a weaker claim.
- **A detector that failed or was skipped is always reported** — one line, inside
  the report, never as it happens. A silent gap reads as clean.
