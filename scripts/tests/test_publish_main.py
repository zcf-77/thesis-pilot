"""使用一次性仓库验证恢复流程；不访问真实远端或真实项目元数据。"""

import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("publish_main", Path(__file__).parents[1] / "publish_main.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MainRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parents[2] / "work")
        self.repo = Path(self.temp.name) / "target"
        self.source = Path(self.temp.name) / "source"
        self.repo.mkdir()
        MODULE.git(self.repo, "init", "--initial-branch=main")
        MODULE.git(self.repo, "config", "user.name", "Recovery test")
        MODULE.git(self.repo, "config", "user.email", "test@example.invalid")
        MODULE.git(self.repo, "remote", "add", "origin", "https://example.invalid/test.git")
        (self.repo / ".gitignore").write_text("work/\n", encoding="utf-8")
        (self.repo / "sample.txt").write_text("base\n", encoding="utf-8")
        MODULE.git(self.repo, "add", "--", ".gitignore", "sample.txt")
        MODULE.git(self.repo, "commit", "-m", "test: baseline")
        shutil.copytree(self.repo, self.source)
        (self.source / "sample.txt").write_text("updated\n", encoding="utf-8")
        MODULE.git(self.source, "add", "--", "sample.txt")
        MODULE.git(self.source, "commit", "-m", "test: change")
        (self.repo / "sample.txt").write_text("updated\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_attach_preserves_files_and_history(self):
        before = (self.repo / "sample.txt").read_bytes()
        old = MODULE.git(self.repo, "rev-parse", "HEAD")
        tip = MODULE.attach(self.repo, self.source)
        self.assertEqual(MODULE.git(self.repo, "rev-parse", "HEAD"), tip)
        self.assertEqual(MODULE.git(self.repo, "status", "--porcelain"), "")
        self.assertEqual((self.repo / "sample.txt").read_bytes(), before)
        MODULE.git(self.repo, "merge-base", "--is-ancestor", old, tip)
        self.assertEqual(len(list((self.repo / "work").glob("main-recovery-*/index.before"))), 1)

    def test_new_edit_stops_before_changing_head(self):
        old = MODULE.git(self.repo, "rev-parse", "HEAD")
        (self.repo / "sample.txt").write_text("another session\n", encoding="utf-8")
        with self.assertRaises(MODULE.Stop):
            MODULE.attach(self.repo, self.source)
        self.assertEqual(MODULE.git(self.repo, "rev-parse", "HEAD"), old)
        self.assertEqual((self.repo / "sample.txt").read_text(), "another session\n")

    def test_extra_file_stops(self):
        (self.repo / "new.txt").write_text("keep me", encoding="utf-8")
        with self.assertRaises(MODULE.Stop):
            MODULE.inspect(self.repo, self.source)
        self.assertTrue((self.repo / "new.txt").exists())

    def test_staged_change_stops(self):
        MODULE.git(self.repo, "add", "--", "sample.txt")
        with self.assertRaises(MODULE.Stop):
            MODULE.attach(self.repo, self.source)
        self.assertEqual(MODULE.git(self.repo, "diff", "--cached", "--name-only"), "sample.txt")


if __name__ == "__main__":
    unittest.main()
