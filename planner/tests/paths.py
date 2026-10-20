import sys
from pathlib import Path

# The tests sit outside the folder an install copies, so they cannot find the plugin beside themselves.
REPO = Path(__file__).resolve().parents[2]
PLUGIN = REPO / "planner" / "plugin"
SCRIPTS = PLUGIN / "scripts"
sys.path.insert(0, str(SCRIPTS))
