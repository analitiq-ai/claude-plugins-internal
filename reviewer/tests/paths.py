from pathlib import Path

# The tests sit outside the folder an install copies, so they cannot find the plugin beside themselves.
REPO = Path(__file__).resolve().parents[2]
PLUGIN = REPO / "reviewer" / "plugin"
# Runs a workflow script with stand-in agents.
HARNESS = Path(__file__).resolve().parent / "workflow_harness.mjs"


def tracked_text(file: Path, errors: str | None = None) -> str:
    """What git holds for a tracked path: a link's target (a carrier's `core` link is one), else the file's text."""
    return str(file.readlink()) if file.is_symlink() else file.read_text(errors=errors)
