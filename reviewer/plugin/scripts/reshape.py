"""A RESHAPE_SPEC ruling on a PR bound to a spec folder: its summary, the notice it owes the spec's issue, and what
is said when that notice failed. Pure: the gate makes the GitHub calls and the ledger keeps their answers."""
from __future__ import annotations

import re
from pathlib import PurePosixPath

LABEL = "reshape_spec"
_ISSUE = re.compile(r"([1-9][0-9]*)-")
# Per call: what it is, what its failure means, what the user does by hand, and what they check for.
_CALLS = {"comment": ("the comment", "the comment was not posted", "post it", "it is"),
          "edit": (f"the {LABEL} label and assignee", f"the {LABEL} label and assignee were not added", "add them",
                   "they are")}


def summary(folder: str, ruling: dict) -> str:
    """The ruling as the user carries it to planning: the open decision, why, the spec's gaps, and the folder."""
    gaps = "; ".join(f"{f['mechanism']} ({f['spec_ref']})" for f in ruling["findings"] if f["kind"] == "spec_gap")
    return (f"Open decision: {ruling['user_decision']} Why: {ruling['rationale']} Spec gaps: {gaps or 'none named'}. "
            f"Spec folder: {folder}.")


def issue_of(folder: str) -> int | None:
    """The issue a spec folder is for: the number its own name starts with, as `<issue>-<name>`."""
    named = _ISSUE.match(PurePosixPath(folder).name)
    return int(named.group(1)) if named else None


def notice(folder: str) -> dict:
    """The notice a ruling owes `folder`'s issue, each call's answer still unknown. A folder that names no issue
    has nowhere to post, so both calls have failed before they are made."""
    issue = issue_of(folder)
    if issue is not None:
        return {"issue": issue, "comment": None, "edit": None}
    unposted = {"error": f"spec folder {folder} names no issue"}
    return {"issue": None, "comment": unposted, "edit": dict(unposted)}


def comment(folder: str, pr: int, rnd: dict) -> str:
    """The comment on the spec's issue. It names only what GitHub already shows: a local path is nobody else's."""
    return (f"reviewer ruled #{pr}, {rnd['stage']} round {rnd['n']} RESHAPE_SPEC: the spec has to be reshaped "
            f"before this PR's code may change.\n\n{summary(folder, rnd['assessment'])}")


def notice_failures(slug: str, rnd: dict) -> str:
    """What the user is told of `rnd`'s notice: each call that failed, or whose answer was never recorded; "" when
    there is no notice or both calls were done."""
    owed = rnd.get("notice")
    if owed is None:
        return ""
    if owed["issue"] is None:
        return f"The RESHAPE_SPEC notice was not posted: {owed['comment']['error']}. Tell the spec's issue by hand."
    said = []
    on = f"The RESHAPE_SPEC notice on {slug}#{owed['issue']}"
    for call, (what, failed, by_hand, missing) in _CALLS.items():
        answer = owed[call]
        if answer is None:
            said.append(f"{on}: GitHub's answer to {what} was not recorded. Check the issue and {by_hand} by hand if "
                        f"{missing} missing.")
        elif "error" in answer:
            said.append(f"{on} failed: {failed} ({answer['error']}). {by_hand.capitalize()} by hand.")
    return " ".join(said)
