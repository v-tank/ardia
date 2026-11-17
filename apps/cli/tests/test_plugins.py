import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import cli, control, plugins_cli

FIXTURES = Path(__file__).resolve().parent / "fixtures"
EXAMPLE = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "plugins" / "example"
LEGACY = {
    "name": "compact-command-bar",
    "title": "Compact command bar",
    "description": "Fewer tabs before you type.",
    "requires": "0.2.46-nightly.4",
    "settings": {"commandBarStart": {"openTabs": {"limit": 5}}},
    "reset": {"commandBarStart": {}},
}


class PluginsCliTest(unittest.TestCase):
    def setUp(self):
        self.data = Path(tempfile.mkdtemp(prefix="ardia-plugins-"))
        schema_dir = self.data / "config-schema"
        schema_dir.mkdir()
        shutil.copy(FIXTURES / "plugin.schema.json", schema_dir / "plugin.schema.json")
        self.unreachable = mock.patch.object(control, "call", side_effect=control.unreachable("test"))
        self.unreachable.start()

    def tearDown(self):
        self.unreachable.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    def ardia(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = cli.run(["plugins", *args, "--data-dir", str(self.data)])
        return status, out.getvalue(), err.getvalue()

    def test_install_copies_the_example_and_refuses_a_second_copy(self):
        status, out, _ = self.ardia("install", str(EXAMPLE))
        self.assertEqual(status, 0)
        self.assertIn("It's off", out)
        installed = self.data / "config" / "plugins" / "example"
        self.assertTrue((installed / "plugin.json").is_file())
        self.assertTrue((installed / "page" / "index.html").is_file())
        self.assertEqual(self.ardia("install", str(EXAMPLE))[0], 1)
        self.assertEqual(self.ardia("install", str(EXAMPLE), "--force")[0], 0)

    def test_a_settings_only_plugin_installs_from_its_plugin_json(self):
        source = self.data / "legacy.json"
        source.write_text(json.dumps(LEGACY))
        self.assertEqual(self.ardia("install", str(source))[0], 0)
        self.assertEqual(json.loads((self.data / "config" / "plugins" / "compact-command-bar" / "plugin.json").read_text()), LEGACY)

    def test_check_reports_schema_problems_with_their_path(self):
        bad = self.data / "bad"
        bad.mkdir()
        manifest = json.loads((EXAMPLE / "plugin.json").read_text())
        manifest["process"]["memoryMB"] = 1
        manifest["typo"] = True
        (bad / "plugin.json").write_text(json.dumps(manifest))
        status, out, _ = self.ardia("check", str(bad) + "/")
        self.assertEqual(status, 1)
        self.assertIn("process.memoryMB", out)
        self.assertIn("typo", out)
        status, _, err = self.ardia("install", str(bad))
        self.assertEqual(status, 1)
        self.assertIn("memoryMB", err)

    def test_list_and_remove_work_from_the_files_when_ardia_is_away(self):
        self.ardia("install", str(EXAMPLE))
        status, out, _ = self.ardia("list", "--json")
        self.assertEqual(status, 0)
        listed = json.loads(out)
        self.assertEqual([p["name"] for p in listed], ["example"])
        self.assertEqual(listed[0]["problems"], [])
        self.assertEqual(self.ardia("remove", "example")[0], 0)
        self.assertFalse((self.data / "config" / "plugins" / "example").exists())
        self.assertEqual(self.ardia("remove", "example")[0], 1)

    def test_links_inside_a_plugin_are_refused(self):
        source = self.data / "linked"
        shutil.copytree(EXAMPLE, source)
        (source / "escape").symlink_to(Path.home())
        status, _, err = self.ardia("install", str(source))
        self.assertEqual(status, 1)
        self.assertIn("is a link", err)

    def test_enable_and_call_need_ardia(self):
        self.assertEqual(self.ardia("enable", "example")[0], 2)
        self.assertEqual(self.ardia("call", "example", "hello")[0], 2)

    def test_call_sends_the_tool_and_prints_its_result(self):
        self.unreachable.stop()
        with mock.patch.object(control, "call", return_value={"text": "Hello"}) as call:
            status, out, _ = self.ardia("call", "example", "hello", '{"who": "you"}')
        self.unreachable.start()
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(out), {"text": "Hello"})
        self.assertEqual(call.call_args.args[1:3], ("plugins.call", {"plugin": "example", "tool": "hello", "input": {"who": "you"}}))
        self.assertGreaterEqual(call.call_args.args[3], 300)


if __name__ == "__main__":
    unittest.main()
