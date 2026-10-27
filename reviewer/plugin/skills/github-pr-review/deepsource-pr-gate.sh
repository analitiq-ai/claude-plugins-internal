#!/usr/bin/env bash
# Is DeepSource's Code Review grade A on the PR's head commit?
#
# The grade exists only in DeepSource's PR summary comment, which it edits in
# place per run: no commit status carries it. That comment names the range it
# reviewed as BASE...HEAD (short SHAs), so it counts only when HEAD is the PR's
# head. The verdict needs an Overall Grade of A AND every analyzer in the Code
# Review Summary passed: an analyzer that failed or timed out graded nothing.
#
# Usage: deepsource-pr-gate.sh <owner/repo> <pr-number>
# Exit codes: 0 A on the head · 2 below A · 3 no summary for the head yet ·
#             1 usage/error, including a summary this script cannot read
set -euo pipefail

repo=${1:-}; pr=${2:-}
if [ -z "$repo" ] || [ -z "$pr" ]; then
  echo "usage: deepsource-pr-gate.sh <owner/repo> <pr-number>" >&2
  exit 1
fi

head=$(gh pr view "$pr" --repo "$repo" --json headRefOid | jq -r '.headRefOid')

# The analyzer icon vocabulary DeepSource has been seen to use. Anything else
# fails loud, so a new state is classified by an admin, not guessed here.
summary=$(gh api "repos/$repo/issues/$pr/comments" --paginate | jq -s --arg head "$head" '
  def grades:
    [scan("(?s)<strong>([^<]+)</strong>&nbsp;&nbsp;(?:<a [^>]*>)?<picture>(?:(?!</picture>).)*?light/grade_([a-z])\\.svg")
     | {label: .[0], grade: (.[1] | ascii_upcase)}];
  def analyzers:
    [scan("(?s)<td><strong>([^<]+)</strong></td>\\s*<td[^>]*><picture>(?:(?!</picture>).)*?light/status_([a-z_]+)\\.svg")
     | {name: .[0], status: .[1]}];
  # Every row of the summary table, read or not: a row the analyzer pattern
  # misses would otherwise drop out of the verdict unseen.
  def analyzer_rows:
    [scan("(?s)<h3>Code Review Summary</h3>.*?<tbody>(.*?)</tbody>")[0] | scan("<tr>")] | length;

  [add[] | select(.user.login == "deepsource-io[bot]" and (.body | test("We reviewed changes in <code>")))] | last
  | if . == null then {found: false} else
      .body as $b
      | ($b | [scan("changes in <code>([0-9a-f]+)\\.\\.\\.([0-9a-f]+)</code>")][0]) as $range
      | ($b | grades) as $grades
      | ($b | analyzers) as $analyzers
      | { found: true, url: .html_url, range: ($range | join("...")), reviewed: $range[1],
          on_head: ($head | startswith($range[1])),
          run: ($b | [scan("https://app\\.deepsource\\.com/gh/[^\"/]+/[^\"/]+/run/[0-9a-f-]+/")][0]),
          overall: ($grades | map(select(.label == "Overall Grade")) | first | .grade),
          dimensions: [$grades[] | select(.label != "Overall Grade")],
          analyzers: $analyzers,
          errors: ( (if ($grades | map(select(.label == "Overall Grade")) | length) == 0
                     then ["no Overall Grade in the summary; its format changed"] else [] end)
                  + (if ($analyzers | length) == 0
                     then ["no analyzer rows in the Code Review Summary; its format changed"]
                     elif ($analyzers | length) != ($b | analyzer_rows)
                     then ["the Code Review Summary has \($b | analyzer_rows) analyzer row(s) but \($analyzers | length) were read; its format changed"]
                     else [] end)
                  + [$analyzers[] | select(.status | IN("passed", "failed", "timed_out") | not)
                     | "unrecognised analyzer status \(.status) for \(.name)"] ) }
    end')

if [ "$(jq -r '.found' <<<"$summary")" = false ]; then
  echo "NOT YET: no DeepSource summary comment on $repo#$pr."
  exit 3
fi
if [ "$(jq '.errors | length' <<<"$summary")" -gt 0 ]; then
  jq -r '.errors[] | "ERROR: " + .' <<<"$summary" >&2
  echo "Read the summary by hand: $(jq -r '.url' <<<"$summary")" >&2
  exit 1
fi
if [ "$(jq -r '.on_head' <<<"$summary")" != true ]; then
  echo "NOT YET: DeepSource's summary covers $(jq -r '.range' <<<"$summary"); the head is ${head:0:7}."
  exit 3
fi

jq -r --arg target "$repo#$pr" '
  "DeepSource on \($target) @ \(.reviewed) (run \(.run // "url not found"))",
  "  Overall Grade: \(.overall)",
  "  " + (.dimensions | map("\(.label): \(.grade)") | join("  ")),
  "  Analyzers: " + (.analyzers | map("\(.name) \(.status)") | join(", "))' <<<"$summary"

if [ "$(jq -r '.overall == "A" and all(.analyzers[]; .status == "passed")' <<<"$summary")" = true ]; then
  echo "PASS: grade A and every analyzer passed on ${head:0:7}."
  exit 0
fi
cat <<'EOF'
BELOW A: find what to fix with the deepsource MCP tools —
  get_pull_request (this PR) -> get_run_report (the run above) for the grades,
  list_analysis_issues (pr_number) for the occurrences behind them.
EOF
exit 2
