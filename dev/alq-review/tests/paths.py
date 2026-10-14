from pathlib import Path

# The tests sit outside the folder an install copies, so they cannot find the plugin beside themselves.
REPO = Path(__file__).resolve().parents[3]
PLUGIN = REPO / "plugins" / "alq-review"
# Runs a workflow script with stand-in agents.
HARNESS = Path(__file__).resolve().parent / "workflow_harness.mjs"
