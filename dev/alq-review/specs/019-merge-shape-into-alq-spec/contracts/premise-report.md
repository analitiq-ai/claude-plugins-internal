# Contract: `premise_report.py`

`python3 scripts/premise_report.py <command>` from `plugins/alq-review/`. Exit 0 ok, 1 problems (one per line, each with its next step), 2 cannot run.

## `form`

Prints the empty report. The question wording lives only here.

```text
Reports wrong behaviour: <yes | no>

## harm
Question: What goes wrong if this issue is never done? Name the state or input and the wrong outcome.
Answer:
Source:

## reachable
Question: Can that happen on the default branch? Start the answer with observed or predicted.
Answer:
Source:

## change-alters
Question: Does the proposed change alter that outcome? Walk the scenario through the change.
Answer:
Source:

## owner
Question: Does something already own this risk (a guard, test, CI job, rule, procedure)?
Answer:
Source:

## inherited
Question: Is the premise inherited from another spec's decision? If so, put the questions above to that decision.
Answer:
Source:

## needs-spec
Question: Does the work have decisions in it, or does the request fix the outcome?
Answer:
Source:

Recommendation: <write the spec | no spec needed | not worth doing>
Pick: <write the spec | no spec needed | not worth doing>
Rests on: <the heading of the question a stop pick rests on; required unless the pick is write the spec>
Reason: <one line; required unless the pick is write the spec>
```

## `check <report> <pick>`

For `write the spec`, all six questions are graded. For a stop pick, only the questions up to and including the one
`Rests on:` names are graded; later ones may be left empty.

Fails when: the file is missing; a question section is missing; a graded `Answer:` or `Source:` is empty; a graded `Source:` does not
start `code:`, `reproduction:` or `user:` with text after it; the `reachable` answer does not start `observed` or `predicted`;
`Recommendation:` or `Pick:` is not one of the three outcomes; `Pick:` differs from `<pick>`; the pick is not `write the spec`
and `Reason:` is empty or `Rests on:` names no question; `Reports wrong behaviour: yes` and the recommendation is `no spec needed`.

## `record <report> <pick>`

For `no spec needed`: posts the location comment `spec: none` with the report's `Reason:` (`speclocation.post_none`). For
`not worth doing`: posts `spec: not worth doing` with the `Reason:` (`speclocation.post_not_worth_doing`). For `write the spec`: does nothing.
Prints the comment URL. Run from the project in the issue's worktree.
