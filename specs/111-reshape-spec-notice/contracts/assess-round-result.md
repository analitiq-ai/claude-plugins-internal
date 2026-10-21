# Contract: `alq-review:assess-round` result

The only change is one added key. Every field that exists today keeps its meaning.

```text
{
  status: 'ASSESSED',
  round_verdict, next_step, user_decision,   // unchanged
  assessment,                               // unchanged: holds rationale and findings[] (kind, mechanism, spec_ref)
  findings,                                 // unchanged
  spec_folder: string | null                // NEW: the PR's bound spec folder (repo-relative), null for spec: null or unbound
}
```

- `spec_folder` is present on `ASSESSED` results whatever the verdict, and from both launch paths: direct, and
  nested in review-round, where review-round spreads the assess result into its own.
- `REFUSED` and `INCOMPLETE` results are unchanged.
- The workflow renders no summary text. A caller reads the reshape fields as `user_decision`,
  `assessment.rationale`, and `assessment.findings` filtered on `kind == 'spec_gap'`.

## Injected args

| Workflow | New injected key | Source |
|---|---|---|
| review-round | `spec_folder` | `briefs.spec_folder(state)` in `briefs.review_args` |
| assess-round (direct) | `spec_folder` | `briefs.spec_folder(state)` in `briefs.assess_args` |
| assess-round (nested) | `spec_folder` | forwarded by `review-round.js` from its own args |
