"""Asks Jev through OpenRouter. A failed call or a malformed reply raises JevError with the reason."""
from __future__ import annotations

import http.client
import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

ENDPOINT = "https://openrouter.ai/api/v1/systemone"
MODEL = "typesafe/jev-1.13"
TIMEOUT = 30  # nearly 50 times the slowest measured call, so a slow network is not read as a failure
KIND = {"kind": {"type": "choice", "instructions": "Does this change correct a defect in existing behaviour?",
                 "criteria": {"fix": "the change corrects a defect in existing behaviour",
                              "not_fix": "it adds, restructures or removes behaviour without correcting a defect"}}}
# The questions of the replay script jev_fix.py; test_jev compares them when that script is present.
FIX = {
    "level": {"type": "choice", "instructions": "Where does the fix act relative to the defect's cause?",
              "criteria": {"cause": "it changes the mechanism that produces the wrong value, so the wrong value is never produced",
                           "symptom": "it leaves the mechanism producing the wrong value and corrects the value afterwards"}},
    "coverage": {"type": "choice", "instructions": "Consider the SAME OPERATION sites. Does the fix reach every site that has the same defect?",
                 "criteria": {"all": "every site with the same defect is fixed by this change",
                              "edited_only": "at least one listed site has the same defect and is not fixed by this change",
                              "none_other": "no listed site has the same defect"}},
}
LANGUAGES = {".py": "Python", ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".mjs": "JavaScript",
             ".go": "Go", ".tf": "Terraform", ".sh": "shell"}
_DIFF_FILE = re.compile(r"^\+\+\+ b/(.+)$", re.M)


class JevError(Exception):
    pass


class TooLarge(JevError):
    """Jev refused the request as over its token limit."""


def _key() -> str:
    path = Path(os.environ.get("JEV_KEY_FILE") or Path.home() / ".config/openrouter/key")
    try:
        return path.read_text().strip()
    except (OSError, UnicodeDecodeError) as exc:
        raise JevError(f"the OpenRouter key file {path} cannot be read: {exc}") from exc


def ask(state: str, questions: dict, deadline: float | None = None) -> tuple[dict[str, str], float]:
    """Each question's choice, and the call's cost. Once `deadline`, a `time.monotonic()`, has passed, no call is
    made; before it, the socket timeout is at most the time left."""
    key = _key()
    timeout = TIMEOUT if deadline is None else min(TIMEOUT, deadline - time.monotonic())
    if timeout <= 0:
        raise JevError("the time for asking Jev ran out")
    try:
        request = urllib.request.Request(os.environ.get("JEV_ENDPOINT") or ENDPOINT, method="POST",
                                         data=json.dumps({"model": MODEL, "state": state, "questions": questions}).encode(),
                                         headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            reply = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        said = _body(exc)
        if exc.code == 400 and "max_tokens_exceeded" in said:
            raise TooLarge(f"Jev's request limit is about 33k tokens: {said}") from exc
        raise JevError(f"Jev returned HTTP {exc.code}: {said}") from exc
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError, ValueError) as exc:
        raise JevError(f"Jev could not be asked: {exc}") from exc
    return _answers(reply, questions)


def _body(failed: urllib.error.HTTPError) -> str:
    try:
        return failed.read().decode(errors="replace")
    except (http.client.HTTPException, TimeoutError, OSError) as exc:
        return f"(its body could not be read: {exc})"


def _answers(reply, questions: dict) -> tuple[dict[str, str], float]:
    try:
        chosen = {name: reply["answers"][name]["choice"] for name in questions}
        cost = float(reply["usage"]["cost"])
    except (KeyError, TypeError, ValueError) as exc:
        raise JevError(f"Jev's reply lacks an answer to every question or its cost: {reply}") from exc
    for name, choice in chosen.items():
        if not isinstance(choice, str) or choice not in questions[name]["criteria"]:
            raise JevError(f"Jev answered {name} with {choice!r}, not one of {list(questions[name]['criteria'])}")
    return chosen, cost


# Asked once per check, Jev labelled 619ff3b6, a real fix in tests/fixtures/shim-replay, `not_fix` in 1 of 5 asks,
# and a change labelled so is not swept. One `fix` in this many asks makes it a fix.
KIND_ASKS = 3


def ask_kind(diff: str, deadline: float | None = None) -> tuple[str, float]:
    """`fix` or `not_fix` for `diff`, and the total cost."""
    spent = 0.0
    for _ in range(KIND_ASKS):
        chosen, cost = ask(f"COMMIT DIFF\n{diff}", KIND, deadline)
        spent += cost
        if chosen["kind"] == "fix":
            return "fix", spent
    return "not_fix", spent


def _sites(sites: list[dict]) -> str:
    return "\n".join(f"- {s['file']}:{s['line']} {s['function']} — {s['does']}" for s in sites) or "- none"


def _language(diff: str) -> str | None:
    found = Counter(LANGUAGES.get(Path(path).suffix) for path in _DIFF_FILE.findall(diff))
    found.pop(None, None)
    return found.most_common(1)[0][0] if found else None


def fix_state(diff: str, sweep: str) -> str:
    language = _language(diff)
    lead = f"A fix commit from a {language} repository." if language else "A fix commit."
    return f"{lead}\n\nCOMMIT DIFF\n{diff}\n\n{sweep}"


def ask_fix(diff: str, same_operation: list[dict], callers: list[dict],
            deadline: float | None = None) -> tuple[dict[str, str], float]:
    """`level` and `coverage` for a fix over the given sites, and the cost."""
    sweep = f"SAME OPERATION\n{_sites(same_operation)}\n\nCALLERS/CONSUMERS\n{_sites(callers)}"
    return ask(fix_state(diff, sweep), FIX, deadline)
