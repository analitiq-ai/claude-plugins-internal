"""Replays the shim check's Jev questions over the evidence fixes in tests/fixtures/shim-replay (spec 006 SC-001,
quickstart §7): `kind`, then `level` and `coverage` over the recorded sweep when it is a fix, composed into a verdict.
Live: it calls OpenRouter with the key jev.py reads. Exits 1 unless every evidence fix gets its expected verdict."""
import json
import sys
from pathlib import Path

import helpers  # noqa: F401  (puts scripts/ on the path)

import jev
import shimcheck

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "shim-replay"


def replay(entry: dict) -> dict:
    diff = (FIXTURES / entry["diff"]).read_text()
    kind, cost = jev.ask_kind(diff)
    level = coverage = None
    if kind == "fix":
        answers, more = jev.ask(jev.fix_state(diff, (FIXTURES / entry["sweep"]).read_text()), jev.FIX)
        level, coverage, cost = answers["level"], answers["coverage"], cost + more
    return {"kind": kind, "level": level, "coverage": coverage, "verdict": shimcheck.verdict(kind, level, coverage),
            "cost": cost}


def main() -> int:
    manifest = json.loads((FIXTURES / "manifest.json").read_text())
    failed, spent = [], 0.0
    for entry in manifest["commits"]:
        result = replay(entry)
        spent += result["cost"]
        ok = result["verdict"] == entry["expected"]
        if not ok:
            failed.append(entry["sha"])
        print(f"{entry['sha']}  {entry['kind']:7}  expected {entry['expected']:11}  kind {result['kind']:7}  "
              f"level {result.get('level')}  coverage {result.get('coverage')}  verdict {result['verdict']}  "
              f"{'ok' if ok else 'MISMATCH'}")
    print(f"SC-001 {'fails on ' + ', '.join(failed) if failed else 'holds'}; Jev cost ${spent:.4f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
