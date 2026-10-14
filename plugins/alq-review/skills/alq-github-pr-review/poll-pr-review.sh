#!/usr/bin/env bash
# Wait until a PR's review round has settled, then report everything that
# blocks it, once.
#
# This script decides nothing about Codex's verdict and nothing about merging.
# The org-wide pr-gate turns Codex's answer into the `codex-review` check run
# (WAIVED included) and an internal-review attestation into `internal-review`,
# both posted by the analitiq-pr-gate App; GitHub's mergeStateStatus weighs
# those against the branch rules. The poller waits for that picture to be complete and prints it.
#
# SETTLED means every one of:
#   - Codex is not reviewing. Its status card's Code Review row, read only
#     when its status time is after the trigger, is waited on while Running.
#     Completed for the head is Codex's answer, at that status time; Completed
#     for another commit settles the round with the re-request, never CLEAN.
#     With no such row the round waits for one, unless Codex posted something
#     not on scripts/codexstate.py's list: that settles it, never CLEAN, and
#     beside a row is a WARNING. pr-gate's WAIVED run on the head stands in
#     for the missing answer in those two cases only;
#   - no check is running except the gate runs and those passed to
#     --ignore-check (a gate run is a verdict, not work: its pending state is
#     waited on only under the next rule);
#   - with nothing to triage, `codex-review` is not older than the row's status
#     time, so a verdict has reached the gate before the round is judged — for
#     GATE_SWEEP_MINUTES after the answer only: pr-gate does not re-post an
#     unchanged run, so past that an older run is the verdict;
#   - GitHub has finished computing mergeability.
# A draft settles at once: Codex does not review drafts.
#
# CodeRabbit findings outside the diff live only in its review body, with no
# thread to resolve. Each is reported until a PR comment quotes its id (the
# report's URL carries it), whichever commit it was posted on: CodeRabbit
# reviews each push incrementally and does not repeat it on a later commit.
#
# Everything comes from one GraphQL snapshot per poll, so the threads, the
# checks and Codex's answer in a report are one consistent picture.
#
# Usage: poll-pr-review.sh <owner/repo> <pr-number> [trigger-comment-id]
#                          [--minutes N] [--interval S] [--ignore-check <name>]...
#
# The trigger is the given comment id, else the newest `@codex review` comment,
# else the PR's creation (a new non-draft PR reviews itself with no comment).
#
# A PR labelled `cleanup` (ADR-0021) waits on no reviewer: it settles
# once no check is running (the gate runs and ignored checks aside) and GitHub
# has computed mergeability, a draft included. Its report names failing checks
# only; no thread is a finding, and nothing is handed to the alq-review gate.
# scripts/github.py decides whether the PR is one, as the hooks do; when it
# cannot read the label, the PR is polled as unlabelled, with a WARNING.
#
# --ignore-check leaves one check out of the failing/running buckets for this
# invocation only — for a check red for reasons outside the PR and outside the
# branch's required set. GitHub then reports UNSTABLE, which counts as clean
# when every check not passing is ignored. Ignored checks that are not passing
# are listed in every report, so the exemption is never silent.
#
# Exit codes: 0 CLEAN · 2 FINDINGS · 3 TIMEOUT · 4 BLOCKED · 5 CLEANUP · 1 usage/error
set -euo pipefail

CODEX="chatgpt-codex-connector"
TRIGGER_TEXT="@codex review"
GATE_CONTEXTS='["codex-review","internal-review"]'
# Only the App's runs are the gate's word: anything else may carry the same name.
GATE_APP="analitiq-pr-gate"
# Codex's verdict comment triggers pr-gate within minutes; a 👍 or a PR review
# triggers nothing, so for those the poller dispatches a sweep. Its 15-min
# schedule is not relied on: GitHub runs it hours apart.
GATE_SWEEP_MINUTES=20
READER="$(dirname "${BASH_SOURCE[0]}")/../../scripts/codexstate.py"
LABELS="$(dirname "${BASH_SOURCE[0]}")/../../scripts/github.py"
IGNORE_CHECKS=""
MINUTES=15
INTERVAL=60

positional=()
while [ $# -gt 0 ]; do
  case "$1" in
    --minutes)      MINUTES=${2:?--minutes needs a value}; shift 2;;
    --interval)     INTERVAL=${2:?--interval needs a value}; shift 2;;
    --ignore-check) IGNORE_CHECKS="${IGNORE_CHECKS}${2:?--ignore-check needs a check name}"$'\n'; shift 2;;
    -*) echo "unknown flag: $1" >&2; exit 1;;
    *) positional+=("$1"); shift;;
  esac
done
repo=${positional[0]:-}; pr=${positional[1]:-}; trigger_id=${positional[2]:-}
if [ -z "$repo" ] || [ -z "$pr" ]; then
  echo "usage: poll-pr-review.sh <owner/repo> <pr-number> [trigger-comment-id] [--minutes N] [--interval S] [--ignore-check NAME]..." >&2
  exit 1
fi
owner=${repo%%/*}; name=${repo##*/}
ignore_json=$(printf '%s' "$IGNORE_CHECKS" | jq -R . | jq -s 'map(select(length > 0))')

# One page of each connection. A PR past a page fails loud in ANALYZE rather
# than being reported from a partial read.
SNAPSHOT_QUERY='
query($owner:String!, $name:String!, $pr:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$pr) {
      createdAt headRefOid mergeStateStatus reviewDecision
      author { login }
      reactions(content:THUMBS_UP, last:100) {
        pageInfo { hasPreviousPage } nodes { createdAt user { login } }
      }
      comments(last:100) {
        pageInfo { hasPreviousPage }
        nodes {
          databaseId createdAt url body author { login }
          reactions(content:THUMBS_UP, last:100) {
            pageInfo { hasPreviousPage } nodes { createdAt user { login } }
          }
        }
      }
      reviews(last:100) {
        pageInfo { hasPreviousPage } nodes { submittedAt url body author { login } }
      }
      reviewThreads(first:100) {
        pageInfo { hasNextPage }
        nodes {
          isResolved isOutdated path line
          comments(first:1) { nodes { author { login } createdAt url body } }
        }
      }
      commits(last:1) {
        nodes { commit { statusCheckRollup { contexts(first:100) {
          pageInfo { hasNextPage }
          nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl title startedAt checkSuite { app { slug } } }
            ... on StatusContext { context state description targetUrl createdAt }
          }
        } } } }
      }
    }
  }
}'

# The round's trigger, read the same way by CODEX_ITEMS and ANALYZE.
TRIGGER_DEFS='
def bare: sub("\\[bot\\]$"; "");
.data.repository.pullRequest as $pr
| ($pr.comments.nodes) as $comments
| (if $trigger_id != "" then [$comments[] | select((.databaseId | tostring) == $trigger_id)]
   else [$comments[] | select(.body | ascii_downcase | gsub("^\\s+|\\s+$"; "") == $trigger_text)] end
   | last) as $trigger
| ($trigger.createdAt // $pr.createdAt) as $since
| '

# What codexstate.py reads: every Codex comment and review, whenever posted, since
# the card is created before the trigger it answers.
CODEX_ITEMS='
{ since: $since, head: $pr.headRefOid,
  items: ([$comments[] | select((.author.login | bare) == $codex) | {kind: "comment", url, at: .createdAt, body}]
          + [$pr.reviews.nodes[] | select((.author.login | bare) == $codex and .submittedAt != null)
             | {kind: "review", url, at: .submittedAt, body}]) }'

# Reduces one snapshot to the facts the loop and the report need.
ANALYZE='
def strip_markup: gsub("(?s)<!--.*?-->"; "") | gsub("!\\[[^\\]]*\\]\\([^)]*\\)"; "") | gsub("</?[A-Za-z][^>]*>"; "");
def squash: gsub("\\s+"; " ") | sub("^ "; "") | sub(" $"; "");
def first_line: split("\n") | map(squash) | map(select(length > 0)) | first // "(no description)";
def clip: .[0:120];

# Each bot has its own comment format; read the title and severity from where
# that bot writes them. The title is the first line of text, except that
# CodeRabbit leads with a category line and puts the title in bold below it.
def gist($by):
  (if $by == "coderabbitai" then [scan("\\*\\*([^*\\n]+)\\*\\*") | .[0]] else [] end) as $titled
  | ($titled[0] // (strip_markup | gsub("[*]"; "") | first_line)) | gsub("`"; "") | squash | clip;
def severity($by):
  (if $by == $codex then [scan("P[0-9](?=\\s*Badge)")][0]
   elif $by == "coderabbitai" then (split("\n")[0] | split(" | ")[1] // "" | gsub("_"; "") | sub("^[^A-Za-z]+"; ""))
   elif $by == "deepsource-io" then [scan("severity_indicator_([a-z]+)\\.svg") | .[0]][0]
   else null end) // "";

# CodeRabbit puts findings it cannot anchor to the diff in the review body
# only, as <summary><em>SEVERITY</em> · TITLE · <code>FILE</code></summary>, the
# full path:line in backticks, then a cr-comment id. The id keeps each
# finding url unique and stable across polls, and is what an answer quotes.
def body_findings:
  . as $r
  | [ $r.body | scan("(?s)<summary><em>([^<]*)</em> · (.*?) · <code>[^<]*</code></summary>(?:(?!<summary><em>).)*?`([^`\\n]+?):([0-9]+)(?:-[0-9]+)?`(?:(?!<summary><em>).)*?cr-comment:v1:([0-9a-f]+)")
      | { id: .[4], by: "coderabbitai", severity: (.[0] | sub("^[^A-Za-z]+"; "")), gist: (.[1] | strip_markup | squash | clip),
          path: .[2], line: (.[3] | tonumber), outdated: false, url: ($r.url + "-cr-" + .[4]) } ];
def declared_outside: [scan("Outside diff range comments \\(([0-9]+)\\)") | .[0] | tonumber] | add // 0;

($pr.commits.nodes[0].commit.statusCheckRollup.contexts // {pageInfo: {}, nodes: []}) as $rollup
| [ (["reactions", $pr.reactions], ["comments", $pr.comments], ["reviews", $pr.reviews],
     ["reviewThreads", $pr.reviewThreads], ["status check contexts", $rollup])
      | select(.[1].pageInfo.hasNextPage or .[1].pageInfo.hasPreviousPage) | .[0] ]
  + [ $pr.comments.nodes[] | select(.reactions.pageInfo.hasPreviousPage) | "reactions on \(.url)" ]
  | map("more than 100 \(.) on the PR; the poller reads one page and will not report from part of it") as $overflow

| [$pr.reactions.nodes[] | select((.user.login | bare) == $codex and .createdAt > $since)] as $thumbs_on_body
| [($trigger.reactions.nodes // [])[] | select((.user.login | bare) == $codex)] as $thumbs_on_trigger
| (if $codex_state.state == "answered" then $codex_state.status_at else null end) as $codex_answered_at

| [ $rollup.nodes[]
    | if .__typename == "CheckRun" and .checkSuite.app.slug == $gate_app and (.name as $n | $gates | index($n))
      then { name, url: (.detailsUrl // ""), description: .title, createdAt: .startedAt, gate: true,
             state: (if .status == "COMPLETED" then (.conclusion // "UNKNOWN") else "PENDING" end) }
      elif .__typename == "CheckRun"
      then { name, url: (.detailsUrl // ""), description: null, createdAt: null, gate: false,
             state: (if .status == "COMPLETED" then (.conclusion // "UNKNOWN") else "RUNNING" end) }
      else { name: .context, url: (.targetUrl // ""), description, createdAt, state, gate: false } end
    | .ignored = (.name as $n | $ignore | index($n) != null)
    | .passing = (.state | IN("SUCCESS", "NEUTRAL", "SKIPPED"))
    | .unfinished = (.state | IN("RUNNING", "PENDING", "EXPECTED")) ] as $all_contexts
| [$all_contexts[] | select(.ignored | not)] as $contexts
| [$all_contexts[] | select(.ignored and (.passing | not)) | {name, state, url}] as $ignored_not_passing
| [$contexts[] | select(.gate)] as $gate_runs
| ($gate_runs | map(select(.name == "codex-review")) | first) as $codex_gate
# pr-gate waives a head Codex cannot review: that stands in for an answer only where Codex has none
# (not_started, declined). A Running row is still waited on and a superseded row still blocks.
| ($codex_gate != null and $codex_gate.state == "SUCCESS"
   and (($codex_gate.description // "") | startswith("WAIVED:"))) as $waived
| [$contexts[] | select(.unfinished) | select(.gate | not)] as $running
| [$contexts[] | select((.passing or .unfinished) | not) | {name, state, url, gate}] as $failing

| [ $pr.reviewThreads.nodes[]
    | select(.isResolved | not)
    | .comments.nodes[0] as $c
    | select($c.author.login != $pr.author.login)
    | ($c.author.login | bare) as $by
    | { by: $by, severity: ($c.body | severity($by)), gist: ($c.body | gist($by)),
        path, line, outdated: .isOutdated, url: $c.url } ] as $inline
| [$pr.reviews.nodes[] | select((.author.login | bare) == "coderabbitai")] as $rabbit_reviews
| [ $rabbit_reviews[] | select((body_findings | length) < (.body | declared_outside))
    | "CodeRabbit review \(.url) declares \(.body | declared_outside) Outside diff range comment(s) but \(body_findings | length) parsed; its body format changed" ] as $unparsed
| ([$comments[] | select((.author.login | bare) != "coderabbitai") | .body] | join("\n")) as $answers
| [ $rabbit_reviews[] | body_findings[] | select(.id as $id | $answers | contains($id) | not) | del(.id) ] as $outside
| ($inline + $outside | sort_by(.by != $codex, .by, .path, .line)) as $threads

# Why the round is not clean, once nothing is left to triage: the state of Codex, the merge state, or both.
| [ (if $codex_state.state == "answered" or ($waived and ($codex_state.state | IN("not_started", "declined"))) then empty
     elif $codex_state.state == "superseded" then "Codex reviewed \($codex_state.commit), not the head \($pr.headRefOid[0:10])"
     elif $codex_state.state == "declined" then "Codex'"'"'s reply is not one the poller knows"
     elif $codex_state.state == "reviewing" then "Codex is reviewing \($codex_state.commit)"
     else "Codex has not answered since \($since)" end),
    (if $pr.mergeStateStatus == "CLEAN"
        or ($pr.mergeStateStatus == "UNSTABLE" and ($ignored_not_passing | length) > 0 and all($contexts[]; .passing))
     then empty else "GitHub reports mergeStateStatus=\($pr.mergeStateStatus)" end) ] as $blocked_by

| { codex: $codex_state, head: $pr.headRefOid, merge: $pr.mergeStateStatus, decision: $pr.reviewDecision,
    clean: ($blocked_by | length == 0), blocked_by: $blocked_by,
    since: $since, trigger_found: ($trigger != null), waived: $waived,
    thumbs_on_trigger_only: (($thumbs_on_trigger | length) > 0 and ($thumbs_on_body | length) == 0
                             and ($codex_state.spoke | not)),
    gate_lags: ($codex_answered_at != null and $codex_gate != null and $codex_gate.state == "PENDING"
                and $codex_gate.createdAt < $codex_answered_at
                and (now - ($codex_answered_at | fromdateiso8601)) < $sweep_minutes * 60),
    codex_gate_missing: ([$all_contexts[] | select(.gate and .name == "codex-review")] | length == 0),
    gates: $gate_runs, running: $running, failing: $failing, ignored: $ignored_not_passing, threads: $threads,
    gate_comments: [ $codex_state.comments[] | { url, at, gist: (.body | strip_markup | first_line | clip),
                                                approves: ($codex_gate.state == "SUCCESS") } ],
    errors: ($overflow + $unparsed + $codex_state.errors
             + (if $trigger_id != "" and $trigger == null then ["comment \($trigger_id) is not among the PR comments"] else [] end)) }
| .findings = ((.threads | length) + (.failing | length))'

# Why the round is not settled yet, one reason per line; empty once settled.
WAITING_ON='
if .merge == "DRAFT" then empty else
  (if .codex.state == "not_started" and (.waived | not) then "Codex has not answered since \(.since)"
   elif .codex.state == "reviewing" then "Codex is reviewing \(.codex.commit) since \(.codex.status_at)"
   else empty end),
  (if (.running | length) > 0 then "\(.running | length) check(s) running: \(.running | map(.name) | join(", "))" else empty end),
  (if .findings == 0 and .gate_lags then "codex-review has not caught up with Codex'"'"'s answer" else empty end),
  (if .merge == "UNKNOWN" then "GitHub is still computing mergeability" else empty end)
end'

# A cleanup PR waits only for its checks and for GitHub.
CLEANUP_WAITING_ON='
(if (.running | length) > 0 then "\(.running | length) check(s) running: \(.running | map(.name) | join(", "))" else empty end),
(if .merge == "UNKNOWN" then "GitHub is still computing mergeability" else empty end)'

CLEANUP_REPORT='
([.failing[] | select(.gate | not)]) as $failing |
"== \($repo)#\($pr) @ \(.head[0:10]): mergeStateStatus=\(.merge)",
(if ($failing | length) > 0 then "Failing CI checks:",
   ($failing[] | "  - \(.name) [\(.state)]" + (if .url != "" then "\n    \(.url)" else "" end)) else empty end),
(if (.ignored | length) > 0 then "Ignored by explicit instruction, not passing:",
   (.ignored[] | "  - \(.name) [\(.state)]") else empty end)'

REPORT='
"== \($repo)#\($pr) @ \(.head[0:10]): mergeStateStatus=\(.merge), reviewDecision=\(.decision // "none")",
"Codex: \(.codex.state | gsub("_"; " "))"
  + (if .codex.commit == null then ""
     else " \(.codex.commit) \(if .codex.state == "reviewing" then "since" else "at" end) \(.codex.status_at)" end),
(if (.gates | length) > 0 then "Gate check runs:", (.gates[] | "  \(.name): \(.state) — \(.description // "")") else empty end),
(if .codex.state == "superseded" then "Codex reviewed \(.codex.commit), not the head \(.head[0:10]): comment `@codex review`" else empty end),
(if .codex.state == "declined" and (.waived | not)
 then (.codex.unknown[] | "Codex'"'"'s reply is not one the poller knows (\(.url), \(.at)): Codex declined or changed what it posts; read it.")
 elif .codex.state != "declined"
 then (.codex.unknown[] | "WARNING: Codex'"'"'s reply is not one the poller knows (\(.url), \(.at)); read it.")
 else empty end),
(if .codex_gate_missing then "WARNING: no codex-review check run from the \($gate_app) App on \(.head[0:10])." else empty end),
(if .thumbs_on_trigger_only then "Codex answered with only a 👍 on the @codex review comment. The gate reads Codex'"'"'s reactions on the PR description only: comment `@codex review` to get a verdict comment." else empty end),
(.gate_comments | map(select(.approves | not)) | if length > 0 then
   "Codex comments since the trigger (codex-review is not success):",
   (.[] | "  - \(.at)\n    \(.gist)\n    \(.url)") else empty end),
(if (.failing | length) > 0 then "Failing CI checks:",
   (.failing[] | "  - \(.name) [\(.state)]" + (if .url != "" then "\n    \(.url)" else "" end)) else empty end),
(if (.ignored | length) > 0 then "Ignored by explicit instruction, not passing:",
   (.ignored[] | "  - \(.name) [\(.state)]") else empty end),
(if (.threads | length) > 0 then "Unresolved findings:",
   (.threads | group_by(.by)[] | "  \(.[0].by):",
     (.[] | "    - \(.path):\(.line // "?")" + (if .severity != "" then " [\(.severity)]" else "" end)
            + (if .outdated then " (outdated)" else "" end) + "\n      \(.gist)\n      \(.url)"))
 else empty end)'

# Command substitution does not inherit set -e, so each step returns its own failure.
snapshot() {
  local raw items codex_state
  raw=$(gh api graphql -f query="$SNAPSHOT_QUERY" -F owner="$owner" -F name="$name" -F pr="$pr") || return
  items=$(jq --arg codex "$CODEX" --arg trigger_text "$TRIGGER_TEXT" --arg trigger_id "$trigger_id" \
             "$TRIGGER_DEFS$CODEX_ITEMS" <<<"$raw") || return
  if ! codex_state=$(python3 "$READER" <<<"$items"); then
    echo "ERROR: the Codex reader failed" >&2
    return 1
  fi
  jq --arg codex "$CODEX" --arg trigger_text "$TRIGGER_TEXT" --arg trigger_id "$trigger_id" \
     --argjson gates "$GATE_CONTEXTS" --arg gate_app "$GATE_APP" --argjson ignore "$ignore_json" \
     --argjson sweep_minutes "$GATE_SWEEP_MINUTES" --argjson codex_state "$codex_state" \
     "$TRIGGER_DEFS$ANALYZE" <<<"$raw"
}

report() {
  if [ "$cleanup" = true ]; then
    jq -r --arg repo "$repo" --arg pr "$pr" "$CLEANUP_REPORT" <<<"$1"
  else
    jq -r --arg repo "$repo" --arg pr "$pr" --arg gate_app "$GATE_APP" "$REPORT" <<<"$1"
  fi
}

# Hand the outcome to the alq-review gate: one inbox file per PR, naming its branch and head.
# A failure here is announced and never changes this script's own verdict.
hand_to_gate() {
  local status=$1 threads=$2 checks=$3 gcomments=$4 inbox file
  inbox="${ALQ_REVIEW_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/alq-review}/inbox"
  file="$inbox/${repo//\//__}__${pr}.json"
  if ! { mkdir -p "$inbox" \
      && gh pr view "$pr" --repo "$repo" --json headRefName,headRefOid \
         | jq --arg repo "$repo" --argjson pr "$pr" --arg status "$status" --arg at "$(date -u +%FT%TZ)" \
              --argjson threads "$threads" --argjson checks "$checks" --argjson gcomments "$gcomments" \
             '{repo: $repo, pr: $pr, status: $status, at: $at, head_ref: .headRefName, head_sha: .headRefOid,
               threads: $threads, failing_checks: $checks.failing,
               gate_comments: [$gcomments[] | select(.approves | not)]}' > "$file.tmp" \
      && mv "$file.tmp" "$file"; }; then
    echo "WARNING: could not hand this result to the alq-review gate ($file)" >&2
  fi
}

# The consuming repo's pr-gate sweeps every open PR on any repository_dispatch.
dispatch_sweep() {
  if gh api "repos/$repo/dispatches" -f event_type=pr-gate >/dev/null; then
    echo "codex-review is older than Codex's answer: dispatched a pr-gate sweep of $repo."
  else
    echo "WARNING: could not dispatch a pr-gate sweep of $repo; codex-review may lag until its schedule runs." >&2
  fi
}

hand_over() {
  hand_to_gate "$2" "$(jq -c '.threads' <<<"$1")" "$(jq -c '{failing, running}' <<<"$1")" \
    "$(jq -c '[.gate_comments[] | {url, gist, approves}]' <<<"$1")"
}

settle_cleanup() {
  local state=$1
  report "$state"
  local failing
  failing=$(jq -r '[.failing[] | select(.gate | not) | .name] | join(", ")' <<<"$state")
  if [ -n "$failing" ]; then
    echo "BLOCKED: $failing failing on a cleanup PR."
    exit 4
  fi
  echo "CLEANUP: no check is failing; merge once the PR is ready."
  exit 5
}

settle() {
  local state=$1 findings
  findings=$(jq -r '.findings' <<<"$state")
  report "$state"
  if [ "$findings" -gt 0 ]; then
    echo "FINDINGS: $findings to triage — every failing check and unresolved finding above, from every reviewer."
    hand_over "$state" findings
    exit 2
  fi
  if [ "$(jq -r '.clean' <<<"$state")" = true ]; then
    echo "CLEAN: GitHub reports the PR mergeable, every check not ignored is passing, and no reviewer has an unresolved finding."
    hand_over "$state" clean
    exit 0
  fi
  echo "BLOCKED: nothing to triage, but $(jq -r '.blocked_by | join("; ")' <<<"$state"). Act on the gate check runs and notes above."
  exit 4
}

cleanup=false
if verdict=$(python3 "$LABELS" cleanup "$repo" "$pr" 2>&1); then
  [ "$verdict" = cleanup ] && cleanup=true
else
  echo "WARNING: the cleanup label of $repo#$pr could not be read ($verdict); polling it as unlabelled." >&2
fi
if [ "$cleanup" = true ]; then
  echo "Cleanup PR: $repo#$pr carries the cleanup label; no Codex, no internal review, no triage."
  waiting_on=$CLEANUP_WAITING_ON
else
  waiting_on=$WAITING_ON
fi

deadline=$(( $(date +%s) + MINUTES * 60 ))
poll=0
dispatched=false
while :; do
  poll=$(( poll + 1 ))
  # gh's and jq's own exit codes overlap the poller's (gh exits 4 when it needs authentication).
  state=$(snapshot) || { echo "ERROR: could not read $repo#$pr; the lines above say why" >&2; exit 1; }
  if [ "$(jq '.errors | length' <<<"$state")" -gt 0 ]; then
    jq -r '.errors[] | "ERROR: " + .' <<<"$state" >&2
    exit 1
  fi
  if [ "$poll" -eq 1 ]; then
    if [ "$cleanup" = false ] && [ "$(jq -r '.trigger_found' <<<"$state")" = false ]; then
      echo "No '$TRIGGER_TEXT' comment on $repo#$pr; assuming the auto-triggered review at PR creation."
    fi
    echo "Watching $repo#$pr since $(jq -r '.since' <<<"$state"); polling every ${INTERVAL}s for up to ${MINUTES} min."
    if [ "$(jq 'length' <<<"$ignore_json")" -gt 0 ]; then
      echo "Ignoring CI check(s) by explicit instruction: $(jq -r 'join(", ")' <<<"$ignore_json")"
    fi
  fi
  waiting=$(jq -r "$waiting_on" <<<"$state")
  if [ -z "$waiting" ]; then
    if [ "$cleanup" = true ]; then settle_cleanup "$state"; fi
    settle "$state"
  fi
  if [ "$cleanup" = false ] && [ "$dispatched" = false ] && [ "$(jq -r '.gate_lags' <<<"$state")" = true ]; then
    dispatch_sweep
    dispatched=true
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    report "$state"
    echo "TIMEOUT after ${MINUTES} min, still waiting on:"
    sed 's/^/  - /' <<<"$waiting"
    exit 3
  fi
  echo "[poll $poll] waiting on: $(paste -sd ';' <<<"$waiting" | sed 's/;/; /g'); sleeping ${INTERVAL}s..."
  sleep "$INTERVAL"
done
