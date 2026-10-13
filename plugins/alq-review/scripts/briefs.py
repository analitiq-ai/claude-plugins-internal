"""What each agent of a round is told: reviewer prompts, the audit scope packet, and the assessor's brief.

The workflows only orchestrate. Who reviews, what they are asked and what shape they answer in
are decided here, so the hooks that check the answers and the prompts that ask for them cannot drift.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys

import assessment
import claimcheck
import facts
import github
import ledger
import policy
import shimcheck
import specbinding
import worktree

INTERNAL_REVIEWERS = [
    "pr-review-toolkit:code-reviewer",
    "pr-review-toolkit:silent-failure-hunter",
    "pr-review-toolkit:pr-test-analyzer",
    "pr-review-toolkit:comment-analyzer",
    "pr-review-toolkit:type-design-analyzer",
]
# Dispatch order is the anti-pattern PR audit's: semantic-parity reads duplication's parity candidates.
AUDIT_WAVES = [
    ["alq-anti-pattern:history-shape", "alq-anti-pattern:mechanism-depth", "alq-anti-pattern:failure-evasion",
     "alq-anti-pattern:duplication", "alq-anti-pattern:code-shape", "alq-anti-pattern:boundary-trust"],
    ["alq-anti-pattern:semantic-parity"],
]
NEEDS = {"alq-anti-pattern:semantic-parity": "alq-anti-pattern:duplication"}
ASSESSOR = "alq-review:assessor"
# Joins an internal round's wave when a decision record governs the change.
DECISION_REVIEWER = "alq-review:decision-reviewer"
REVIEWERS = frozenset(INTERNAL_REVIEWERS + [DECISION_REVIEWER] + [t for wave in AUDIT_WAVES for t in wave])


def short(agent_type: str) -> str:
    return agent_type.split(":")[1]


# None is a PR no launch has bound: only a launch whose spec was refused in log mode opens a round and binds nothing.
Spec = specbinding.Folder | specbinding.NoSpec | None


def bound_spec(state: dict) -> Spec:
    return specbinding.parse(state["spec"]) if "spec" in state else None


def _ruled_on(state: dict) -> str:
    rulings = ledger.adjudicated(state)
    if not rulings:
        return ""
    lines = [f"- [{r['verdict']}] {r['title']} ({r['file']}): {r['reason']}" for r in rulings]
    return ("\n\nAlready ruled on in earlier rounds. Do not raise these again unless you can show the ruling was "
            "wrong or a FIX was not actually made:\n" + "\n".join(lines))


def _graded_against(spec: Spec, root: str) -> str:
    if spec is None:
        return ""
    if isinstance(spec, specbinding.NoSpec):
        return "\n\nThe caller says this change needs no spec. Raise no finding about an unmet requirement of a spec."
    return (f"\n\nThis change implements the spec in {spec.path}/spec.md of {root}. Read it. Every requirement the "
            "spec states that the change does not meet is a finding: quote the requirement in its title. What the spec "
            "excludes bounds what you may ask for.")


def review_range(decision: policy.Decision, base: str) -> str:
    """The diff range a round reviews: the files its decision check asks about are the ones this range touches."""
    return f"{decision.delta_from}..HEAD" if decision.scope == "delta" else f"{base}...HEAD"


def _scope(where: worktree.Worktree, decision: policy.Decision, base: str) -> str:
    run = f"Review branch {where.branch} of {where.slug}.\nIn {where.root}, run: git diff {review_range(decision, base)}\n"
    if decision.scope == "delta":
        return (run + "That is what changed since the previous review round. The rest of the branch was reviewed then: "
                "read it for context, report on the delta.")
    return run + "That is the whole change under review."


def _numbering(agent_type: str) -> str:
    return f"Answer through StructuredOutput, numbering findings {short(agent_type)}-1, {short(agent_type)}-2, ..."


def _review_prompt(state: dict, where: worktree.Worktree, decision: policy.Decision, base: str, agent_type: str,
                   spec: Spec) -> str:
    return (f"{_scope(where, decision, base)}\n\n"
            "Report only what must change before this merges: a defect, a broken contract, a violated project rule. "
            "No style preferences, no praise, no summary. An empty findings list is a normal and expected answer."
            f"{_graded_against(spec, where.root)}{_ruled_on(state)}\n\n{_numbering(agent_type)}")


def _decision_prompt(state: dict, where: worktree.Worktree, decision: policy.Decision, base: str,
                     governing: list[dict]) -> str:
    records = "\n".join(f'- {g["corpus"]} {g["id"]} "{g["title"]}"' for g in governing)
    return (f"{_scope(where, decision, base)}\n\n"
            "These decisions govern files this change touches. Each is named by its corpus and id:\n"
            f"{records}\n\n"
            "Read each record in full, in its corpus, before the diff. Report every place the change does what a "
            "decision rejected, contradicts what it chose, or breaks a consequence it commits to: quote the decision's "
            "words in the finding's title and name the record (corpus and id) in its detail. Report nothing a decision "
            "does not settle; other reviewers cover the rest. An empty findings list is a normal and expected answer."
            f"{_ruled_on(state)}\n\n{_numbering(DECISION_REVIEWER)}")


def _audit_prompt(where: worktree.Worktree, decision: policy.Decision, base: str, agent_type: str) -> str:
    visibility = github.repo_visibility(where.slug) or "unknown (lookup failed) - treat as public"
    reviewed = review_range(decision, base)
    files = "\n".join(f"  - {f}" for f in worktree.files_in(where.root, reviewed))
    return ("Scope packet\n"
            "mode: delta\n"
            f"repo: {where.slug} at {where.root}\n"
            f"visibility: {visibility}\n"
            "unit: PR delta\n"
            f"files:\n{files}\n"
            f"regions: changed-hunks - the diff is not pasted; in {where.root} run: git diff {reviewed}\n"
            "read_beyond: yes\n"
            f"baseline: {base}\n"
            "suppressions: none\n"
            "standards: [[coding-principles]], [[schema-contracts]]\n\n"
            f"Answer through StructuredOutput, numbering findings {short(agent_type)}-1, {short(agent_type)}-2, ... "
            "A remit that ends in a verdict puts it, with its evidence, in `verdict`. "
            "Put your clean-scope statement in `clean_scope`.")


def churned(state: dict, rnd: dict, root: str) -> bool:
    """A file is at its third edit. The narrowing belongs in the schema, not only in the gate's
    refusal: a verdict the assessor cannot emit costs no round to reject."""
    return bool(facts.round_facts(state, rnd, root)["files_at_third_edit"])


def _assess_args(rnd: dict, churned_files: bool) -> dict:
    return {"prompt": f"Assess the {rnd['stage']} review round {rnd['n']}. Your brief: --ref '{rnd['ref']}'",
            "schema": assessment.assessment_schema(
                rnd["ref"], policy.admissible_verdicts(rnd, churned=churned_files))}


def waves(stage: str, decisions: dict | None) -> list[list[str]]:
    """Who reviews a round, wave by wave; `decisions` is the internal round's decision check result."""
    if stage == "audit":
        return AUDIT_WAVES
    return [INTERNAL_REVIEWERS + ([DECISION_REVIEWER] if decisions["governing"] else [])]


def review_args(state: dict, rnd: dict, where: worktree.Worktree, decision: policy.Decision, spec: Spec,
                decisions: dict | None) -> dict:
    """Internal reviewers grade the change against `spec`, and the decision reviewer against the records `decisions`
    names as governing; audits ignore both, and get `decisions` None."""

    def reviewer(agent_type: str) -> dict:
        if rnd["stage"] == "audit":
            prompt = _audit_prompt(where, decision, rnd["base_sha"], agent_type)
        elif agent_type == DECISION_REVIEWER:
            prompt = _decision_prompt(state, where, decision, rnd["base_sha"], decisions["governing"])
        else:
            prompt = _review_prompt(state, where, decision, rnd["base_sha"], agent_type, spec)
        entry = {"type": agent_type, "short": short(agent_type), "prompt": prompt,
                 "schema": assessment.findings_schema(rnd["ref"], short(agent_type))}
        if agent_type in NEEDS:
            entry["needs"] = NEEDS[agent_type]
        return entry

    injected = {"worktree": where.root, "stage": rnd["stage"], "round_ref": rnd["ref"],
                "label": f"{rnd['stage']} review round {rnd['n']} ({rnd['scope']})",
                "waves": [[reviewer(t) for t in wave] for wave in waves(rnd["stage"], decisions)],
                "assess": _assess_args(rnd, churned(state, rnd, where.root))}
    if decisions is not None:
        injected["decisions"] = decisions
    return injected


def assess_args(state: dict, rnd: dict, where: worktree.Worktree) -> dict:
    return {"worktree": where.root, "round_ref": rnd["ref"], "findings": rnd["findings"],
            "assess": _assess_args(rnd, churned(state, rnd, where.root))}


def brief_token(rnd: dict) -> str:
    """Proof the assessor read its brief: derived from ledger data that appears in no prompt."""
    return hashlib.sha256(f"{rnd['ref']}|{rnd['opened_at']}|{len(rnd['findings'])}".encode()).hexdigest()[:12]


def brief(state: dict, rnd: dict) -> dict:
    spec = bound_spec(state)
    base = rnd["base_sha"]
    measured = facts.round_facts(state, rnd, rnd["root"])
    return {
        "brief_token": brief_token(rnd),
        "checkout": rnd["root"],
        "change_under_review": f"git -C {rnd['root']} diff {base}...HEAD",
        "history": f"git -C {rnd['root']} log --oneline {base}..HEAD",
        "spec_folder": spec.path if isinstance(spec, specbinding.Folder) else None,
        "facts": measured,
        "admissible_round_verdicts": policy.admissible_verdicts(rnd, churned=bool(measured["files_at_third_edit"])),
        "escalation": rnd["escalation"],
        "earlier_rounds": [{"stage": r["stage"], "n": r["n"], "findings": len(r["findings"]),
                            "round_verdict": (r["assessment"] or {}).get("round_verdict", r["status"]),
                            "invariant": (r["assessment"] or {}).get("invariant")}
                           for r in state["rounds"] if r is not rnd],
        "rulings_so_far": ledger.adjudicated(state),
        "reviewer_verdicts": {t: rep["verdict"] for t, rep in rnd["reports"].items() if rep.get("verdict")},
    }


# --- the claim check -------------------------------------------------------------------------------

CLAIM_READER, CLAIM_JUDGE, CLAIM_CONTEST_JUDGE = ("alq-review:claim-reader", "alq-review:claim-judge",
                                                  "alq-review:claim-contest-judge")
READ_BATCH = 16  # hunks per reader, in the order git lists them; a larger commit gets more readers
# The claim categories: K1 to K8 from the claim check's study of 28 commits, and K9 (engineering#57); the judged ones
# are `claimcheck.JUDGED`, each with its own judge prompt in `_JUDGE_PROMPTS`.
CATEGORY_MEANINGS = {
    "K1": "what our own code, contracts, validator or CI does",
    "K2": "how a vendor tool, cloud platform, language or standard behaves",
    "K3": 'a list, a count, or an "every / the only / complete" claim',
    "K4": "a task tick or a PASS/FAIL status mark",
    "K5": "a recorded observation, such as a date, run ID, commit, count or approval",
    "K6": "a command or code block and what it does",
    "K7": "a citation of a file, field, symbol, rule or requirement",
    "K8": "planned behaviour, meaning what a proposal or design says the system will do once it's built",
    "K9": "what a test checks: a test's name, description or failure message (a comment in a test about the code "
          "it tests is K1)",
}
# The judge prompt the study's 30-claim replay ran, unchanged below its first paragraph, which names
# the staged checkout instead of a commit. {{file}}, {{line}} and {{claim}} are filled in per claim by the workflow.
_JUDGE_TAIL = """
Readers will rely on every word of this claim, so a claim that is mostly
true is not correct. Past checkers failed by confirming the easiest part
of a claim (a library is used, a model exists, a counter starts at 1) and
marking the whole claim correct. Your job is to try to break the claim,
and to call it correct only if you can't.

Work in this order:

1. Split the claim into every separate assertion it makes. Include the
   implied ones: words like "exactly", "always", "the same", "already",
   "not", or a list of items each assert something, and so does naming
   which component does the work. If the claim has the form "X, so Y",
   X and Y are separate assertions and Y is the one that matters.

2. For each assertion, read the code that implements the behaviour. Names,
   docstrings, comments and other docs are not evidence: open the function
   or test body and read what it does. If a docstring or comment disagrees
   with the claim, treat that as a lead to follow, not something to explain
   away.

3. For each assertion, look for the case where it fails: empty or zero
   input, optional or omitted fields, items in a list that are handled
   differently from the others, a different component doing the work than
   the one named, paths that skip the check.

4. Give your verdict last, after the evidence:
   - CORRECT: every assertion is confirmed by code you read, and you found
     no failing case.
   - WRONG: at least one assertion is false or has a failing case.
   - UNSURE: you could not find or read the code that would settle at
     least one assertion.

For each assertion, give the file and line that settle it, and for WRONG,
the failing case."""
# A test is often written before the code it drives, so what it says it checks is judged against the test alone.
_TEST_JUDGE_TAIL = """
Judge the claim against its own test only: its assertions and inputs,
and the fixtures and helpers the test body calls. The code under test is
not evidence either way. A test is often written before that code
exists, so code that is missing or behaves differently does not make
the claim wrong.

Readers rely on the claim to know what the test proves, so a test that
checks less than its name or message says makes the claim wrong. Your
job is to try to break the claim, and to call it correct only if you
can't.

Work in this order:

1. Find the test the claim belongs to: the test function, case or
   assertion whose name, description or failure message it is.

2. Split the claim into every separate assertion it makes about what
   the test checks. Include the implied ones: a named value, error or
   outcome, and words like "every", "only", "not" or "rejects".

3. For each assertion, find the input the test passes and the assertion
   that checks it. An outcome the test never asserts, an input it never
   passes, or an assertion weaker than the claim (checking that a call
   fails, where the claim names the error) is a failing case.

4. Give your verdict last, after the evidence:
   - CORRECT: the test's own inputs and assertions check every
     assertion of the claim.
   - WRONG: at least one assertion is not checked by the test, or is
     checked more weakly than the claim says.
   - UNSURE: you could not find the test the claim belongs to.

For each assertion, give the file and line of the test that settle it,
and for WRONG, the failing case."""
_EVIDENCE_RULE = ("\n\nRead and search only, never modify files. Evidence is a path:line of a file the commit will "
                  "record, relative to the checkout root; an untracked or ignored file is not evidence.")


_READER_TASK = ("For each hunk, read its file around the hunk, then:\n"
                "1. Label it CODE (only code), PROSE (only text for people: docs, comments, docstrings, messages) or "
                "MIXED (code with comments, docstrings, or a test's name or failure message in it), judging by its "
                "content, not the file's extension.\n"
                "2. List the claims its text makes: every statement a reader could rely on and that could be false. A "
                "removed line counts through the sentence it leaves behind. Quote each claim verbatim from the staged "
                "file, give the line it starts on, and give it the one category that fits best:\n"
                + "\n".join(f"- {k}: {meaning}" for k, meaning in CATEGORY_MEANINGS.items()) + "\n"
                "Code itself states no claim; its comments and docstrings do, and so do a test's name and failure "
                "messages. A hunk with no claim has an empty list.\n\n"
                "Read only, never modify files. Answer through StructuredOutput.")
# A stored read stands only for the task and labels it answered: a changed task, kind or category re-reads the hunk.
READER_BRIEF = hashlib.sha256(json.dumps([_READER_TASK, claimcheck.KINDS, claimcheck.CATEGORIES]).encode()).hexdigest()[:16]


def _reader_prompt(check: dict, hunks: list[dict]) -> str:
    shown = "\n\n".join(
        f"{h['id']}: {h['file']}, staged lines {h['new_start']}-{h['new_start'] + max(h['new_count'], 1) - 1}\n"
        + "".join(f"- {line}\n" for line in h["removed"]) + "".join(f"+ {line}\n" for line in h["added"])
        for h in hunks)
    return (f"These are hunks of a change staged for commit in the checkout at {check['root']} ({check['repo']}). "
            "The files there are as they will be committed.\n\n"
            f"{shown}\n\n" + _READER_TASK)


def _reader_schema(check: dict, batch: int, hunks: list[dict]) -> dict:
    claim = {"type": "object", "additionalProperties": False, "required": ["line", "quote", "category"],
             "properties": {"line": {"type": "integer", "minimum": 1}, "quote": {"type": "string", "minLength": 1},
                            "category": {"enum": list(claimcheck.CATEGORIES)}}}
    hunk = {"type": "object", "additionalProperties": False, "required": ["id", "kind", "claims"],
            "properties": {"id": {"enum": [h["id"] for h in hunks]}, "kind": {"enum": list(claimcheck.KINDS)},
                           "claims": {"type": "array", "items": claim}}}
    return {"type": "object", "additionalProperties": False, "required": ["check_ref", "batch", "hunks"],
            "properties": {"check_ref": {"enum": [check["ref"]]}, "batch": {"enum": [batch]},
                           "hunks": {"type": "array", "items": hunk}}}


def verdict_schema(check: dict, file: str | None = None, quote: str | None = None) -> dict:
    """A judge's answer; the workflow pins `file` and `quote` to the claim it hands each judge."""
    assertion = {"type": "object", "additionalProperties": False, "required": ["text", "confirmed", "evidence"],
                 "properties": {"text": {"type": "string"}, "confirmed": {"type": "boolean"},
                                "evidence": {"type": "string"}}}
    pinned = (lambda value: {"enum": [value]} if value is not None else {"type": "string"})
    return {"type": "object", "additionalProperties": False,
            "required": ["check_ref", "file", "quote", "verdict", "basis", "assertions"],
            "properties": {"check_ref": {"enum": [check["ref"]]}, "file": pinned(file), "quote": pinned(quote),
                           "verdict": {"enum": list(claimcheck.VERDICTS)}, "basis": {"type": "string"},
                           "assertions": {"type": "array", "minItems": 1, "items": assertion},
                           "failing_case": {"type": "string"}, "gap": {"type": "string"}}}


def _judge_prompt(check: dict) -> str:
    return ("You are checking a claim made in the documentation of the codebase checked\n"
            f"out at {check['root']} ({check['repo']}), as staged for its next commit.\n"
            "That checkout is the source of truth. The claim comes from `{{file}}`\n"
            "line {{line}}.\n\nClaim: {{claim}}\n" + _JUDGE_TAIL + _EVIDENCE_RULE)


def _test_judge_prompt(check: dict) -> str:
    return ("You are checking what a test says it checks, in the codebase checked\n"
            f"out at {check['root']} ({check['repo']}), as staged for its next commit.\n"
            "That checkout is the source of truth. The claim is a test's name,\n"
            "description or failure message, from `{{file}}` line {{line}}.\n\nClaim: {{claim}}\n"
            + _TEST_JUDGE_TAIL + _EVIDENCE_RULE)


_JUDGE_PROMPTS = {"K1": _judge_prompt, "K9": _test_judge_prompt}


def _contest_prompt(check: dict, claim: dict, contest: dict) -> str:
    ruled = check["verdicts"][claim["id"]]
    return (_JUDGE_PROMPTS[claim["category"]](check).replace("{{file}}", claim["file"]).replace("{{line}}", str(claim["line"]))
            .replace("{{claim}}", claim["quote"])
            + f"\n\nAn earlier checker ruled this claim WRONG. Its failing case: {ruled['failing_case']}. Its basis: "
            f"{ruled['basis']}\nThe author contests that ruling with this evidence: {contest['evidence']}\n"
            "Weigh the evidence against the code yourself; it decides nothing by being offered. You may read a cited "
            "https:// page, and cite it as evidence beside the path:line it bears on.")


def claim_check_args(check: dict, *, to_read: list[dict], contests: list[dict], warn_over: int) -> dict:
    """What the claim-check workflow runs: readers for the hunks no earlier check read, a judge for each claim of a
    judged category with no verdict, briefed by its category, and a fresh judge per contest."""
    batches = [to_read[i:i + READ_BATCH] for i in range(0, len(to_read), READ_BATCH)]
    check["batches"] = [[h["id"] for h in batch] for batch in batches]
    by_id = {c["id"]: c for c in check["claims"].values()}
    return {"worktree": check["root"], "check_ref": check["ref"], "warn_over": warn_over,
            "reader_type": CLAIM_READER, "judge_type": CLAIM_JUDGE, "contest_type": CLAIM_CONTEST_JUDGE,
            "readers": [{"batch": i, "hunks": batch, "prompt": _reader_prompt(check, batch),
                         "schema": _reader_schema(check, i, batch)} for i, batch in enumerate(batches)],
            "judges": {category: {"prompt": _JUDGE_PROMPTS[category](check), "schema": verdict_schema(check)}
                       for category in claimcheck.JUDGED},
            "claims": [{"file": c["file"], "line": c["line"], "quote": c["quote"], "category": c["category"]}
                       for c in claimcheck.to_judge(check)],
            "contests": [{"claim_id": claimcheck.claim_ref(c["claim"]), "prompt": _contest_prompt(check, by_id[c["claim"]], c),
                          "schema": verdict_schema(check, by_id[c["claim"]]["file"], by_id[c["claim"]]["quote"])}
                         for c in contests],
            "not_judged": claimcheck.not_judged(check)}


_SWEEP_TASK = {
    False: ("A. Every other site in the codebase that implements the same operation as the code the commit changes "
            "(the pre-fix code). Judge by behaviour, not by name.\n\n"
            "B. Every caller and consumer of the mechanism the commit touches. Follow the chain until it leaves the "
            "repo."),
    # The replay's one costly miss was a duplicate filed under callers; starting from the callers reaches the
    # operation from the other side.
    True: ("A. Every caller and consumer of the mechanism the commit touches. Follow the chain until it leaves the "
           "repo.\n\n"
           "B. Then, starting from those callers and consumers, search outward for every other site that does the "
           "same operation as the code the commit changes (the pre-fix code), whatever it is called. Judge by "
           "behaviour, not by name."),
}


def sweep_prompt(check: dict, diff: str, snapshot_dir: str, *, callers_first: bool = False) -> str:
    """The sweep task, with the diff inline: the sweeper has no tool that runs git."""
    return ("Inputs (read-only; do not modify anything):\n"
            f"- A commit diff, below.\n- The complete source tree before that commit: {snapshot_dir}/\n\n"
            f"COMMIT DIFF\n{diff}\n\n"
            "Read the diff. Then, in the tree, find:\n\n"
            f"{_SWEEP_TASK[callers_first]}\n\n"
            "Verify each item by reading the code. Give each site's file relative to the tree, the line it starts "
            "on, its function, and one short sentence on what it does (for a caller: what it does with the "
            "mechanism). Answer through StructuredOutput: the first list is SAME OPERATION, the second "
            "CALLERS/CONSUMERS, nothing else.")


def sweep_schema(check: dict) -> dict:
    entry = {"type": "object", "additionalProperties": False, "required": ["file", "line", "function", "does"],
             "properties": {"file": {"type": "string", "minLength": 1}, "line": {"type": "integer", "minimum": 1},
                            "function": {"type": "string", "minLength": 1}, "does": {"type": "string", "minLength": 1}}}
    return {"type": "object", "additionalProperties": False, "required": ["check_ref", *shimcheck.LISTS],
            "properties": {"check_ref": {"enum": [check["ref"]]},
                           **{name: {"type": "array", "items": entry} for name in shimcheck.LISTS}}}


SHIM_SWEEPER, SHIM_SITE_JUDGE = "alq-review:shim-sweeper", "alq-review:shim-site-judge"


SHIM_SWEEPS = {"sweep": ("standard",), "deep": ("standard", "standard", "callers-first")}


def shim_check_args(check: dict, mode: str) -> dict:
    """What the shim-check workflow runs: a sweeper per expected brief while the check sweeps, a judge per contested
    site while it is ruled, else nothing."""
    sweepers = [{"type": SHIM_SWEEPER, "schema": sweep_schema(check),
                 "prompt": sweep_prompt(check, check["diff"], check["snapshot"], callers_first=brief == "callers-first")}
                for brief in check["expected"]] if check["status"] == "sweeping" else []
    sites = {shimcheck.site_id(s["file"], s["function"]): s for s in check["same_operation"]}
    judges = [{"type": SHIM_SITE_JUDGE, "site": sid, "schema": ruling_schema(check, sid),
               "prompt": site_judge_prompt(check, check["diff"], sites[sid], reason,
                                           [s for other, s in sites.items() if other != sid])}
              for sid, reason in check["contests"].items()] if check["status"] == "ruling" else []
    return {"worktree": check["root"], "check_ref": check["ref"], "mode": mode, "head": check["head"],
            "snapshot": check.get("snapshot"), "sweepers": sweepers, "judges": judges}


def site_judge_prompt(check: dict, diff: str, site: dict, reason: str, others: list[dict]) -> str:
    listed = "".join(f"- {s['file']}:{s['line']} {s['function']} — {s['does']}\n" for s in others) or "- none\n"
    return (f"A fix is staged for commit in the checkout at {check['root']}. A sweep listed the site below as doing "
            "the same operation as the code the fix changes, so the fix must reach it too. The author contests that.\n\n"
            f"COMMIT DIFF\n{diff}\n\n"
            f"CONTESTED SITE\n- {site['file']}:{site['line']} {site['function']} — {site['does']}\n\n"
            f"THE AUTHOR'S REASON\n{reason}\n\n"
            f"THE OTHER LISTED SITES\n{listed}\n"
            "Read the fixed code and the site. Decide whether the site has the defect the fix removes, judging by "
            "behaviour, not by name. The author's reason decides nothing by being offered.\n"
            "- shares: the site has the defect; the fix must reach it.\n"
            "- not_shared: the site does not have the defect; say what makes it differ.\n"
            "- deferred: the site has the defect, but its fix belongs in another change; give the number of the open "
            "issue it moves to.\n\n"
            "Give the path:line evidence your ruling rests on, relative to the checkout root, and a short reason."
            + _EVIDENCE_RULE + " Answer through StructuredOutput.")


def ruling_schema(check: dict, site_id: str) -> dict:
    return {"type": "object", "additionalProperties": False,
            "required": ["check_ref", "site", "ruling", "evidence", "reason"],
            "properties": {"check_ref": {"enum": [check["ref"]]}, "site": {"enum": [site_id]},
                           "ruling": {"enum": list(shimcheck.RULINGS)}, "issue": {"type": "integer", "minimum": 1},
                           "evidence": {"type": "array", "minItems": 1, "items": {"type": "string"}},
                           "reason": {"type": "string", "minLength": 1}}}


def main() -> None:
    parser = argparse.ArgumentParser(description="Print the assessor's brief for one review round.")
    parser.add_argument("--ref", required=True)
    ref = parser.parse_args().ref
    with ledger.open_ledger(*ledger.parse_ref(ref)) as state:
        rnd = ledger.find_round(state, ref)
        if rnd["status"] != "awaiting_assessment":
            sys.exit(f"{ref} is {rnd['status']}, not awaiting assessment")
        try:
            print(json.dumps(brief(state, rnd), indent=1))
        except RuntimeError as exc:
            sys.exit(f"The brief for {ref} cannot be built: {exc}")


if __name__ == "__main__":
    main()
