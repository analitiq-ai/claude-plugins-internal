"""The plugin's settings file, config.json."""
from __future__ import annotations

import json
from pathlib import Path


def load() -> dict:
    return json.loads((Path(__file__).resolve().parent.parent / "config.json").read_text())
