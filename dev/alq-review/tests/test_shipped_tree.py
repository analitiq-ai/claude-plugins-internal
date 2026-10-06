import subprocess
import unittest
from fnmatch import fnmatch
from pathlib import PurePosixPath

from paths import REPO


class ShippedTree(unittest.TestCase):
    def test_no_tracked_file_under_plugins_is_in_a_tests_folder_or_named_test_underscore_py(self):
        tracked = subprocess.run(["git", "ls-files", "-z", "plugins"], cwd=REPO, capture_output=True, text=True,
                                 check=True).stdout.split("\0")
        tests = [f for f in tracked if f and ("tests" in PurePosixPath(f).parts or fnmatch(PurePosixPath(f).name, "test_*.py"))]
        self.assertEqual(tests, [])
