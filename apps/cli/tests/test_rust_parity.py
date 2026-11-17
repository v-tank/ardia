import json
import os
import select
import shutil
import signal
import site
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CLI = Path(__file__).resolve().parents[1]
CRATE = CLI / "rust"
INSTALL_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
KEPT_ENV = ("PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "USER", "LOGNAME", "SHELL")
VOLATILE = ("uuid", "timestamp")
VOLATILE_PROPERTIES = ("$session_id", "total_ms", "startup_ms", "served_by")

TREE = {
    "profiles": [{"id": "p-1", "name": "Personal"}],
    "windows": [
        {
            "id": "w-1", "kind": "normal", "focused": True, "profile": "p-1",
            "spaces": [{
                "profile": "p-1", "profileName": "Personal", "shown": True,
                "topApps": [{"type": "tab", "id": "tab-9", "url": "https://mail.example/", "title": "Mail", "pin": "tile", "active": False, "muted": False, "asleep": True, "pid": 501, "cpu": 0.25, "memory": 90_500_000}],
                "pinned": [{"type": "group", "id": "g-0", "label": "Pinned é", "icon": "symbol:star", "color": "neutral", "pinned": True, "items": []}],
                "tabs": [
                    {"type": "group", "id": "g-1", "name": "Work", "label": "Work", "icon": "\U0001f680", "color": "blue", "collapsed": False, "pinned": False, "parent": None, "items": [
                        {"type": "tab", "id": "tab-2", "url": "https://b.example/?q=\u0085", "title": "B\u001b[31m red", "pin": None, "active": False, "muted": True, "asleep": False, "pid": 777, "cpu": 87.35, "memory": 412_000_000},
                        {"type": "group", "id": "g-2", "name": "", "label": "Docs \"quoted\"", "icon": None, "color": "neutral", "collapsed": True, "pinned": False, "parent": "g-1", "items": [
                            {"type": "tab", "id": "tab-3", "url": "https://c.example/", "title": "C\ud800", "pin": None, "active": False, "muted": False, "asleep": False, "pid": 777, "cpu": 87.35, "memory": 412_000_000},
                        ]},
                    ]},
                    {"type": "folder", "id": "f-1", "name": "Later", "items": [
                        {"type": "tab", "id": "tab-4", "url": "about:blank", "title": "", "pin": "row", "active": False, "muted": False, "asleep": True, "pid": None, "cpu": None, "memory": None},
                    ]},
                    {"type": "tab", "id": "tab-1", "url": "https://a.example/", "title": "A 日本", "pin": None, "active": True, "muted": False, "asleep": False, "pid": 501, "cpu": 2.5, "memory": 1_500_000.0},
                ],
            }],
        },
        {"id": 2, "kind": "popup", "focused": False, "spaces": [{"profile": "p-2", "profileName": "", "shown": False, "topApps": [], "pinned": None, "tabs": [
            {"type": "tab", "id": "tab-7", "url": "https://d.example/", "title": None, "active": True, "pid": True, "cpu": 0, "memory": 0},
        ]}]},
    ],
}
WINDOWS = [
    {"id": 1, "kind": "normal", "focused": True, "profileName": "Personal", "tabs": [
        {"id": 11, "title": "A é", "url": "https://a.example/", "active": True, "pinned": False, "group": None},
        {"id": 12, "title": None, "url": "https://b.example/\u0007", "active": False, "pinned": True, "group": "g-1"},
        {"id": 13, "active": False},
    ]},
    {"id": 2, "kind": "popup", "focused": False, "profile": "p-2", "tabs": []},
    "not a window",
]
COMMANDS = [
    {"id": "new-tab", "title": "New Tab"},
    {"id": "toggle-sidebar", "title": "Toggle Sidebar", "variants": ["left", "right"]},
    {"id": "a-very-long-command-id-that-goes-past-forty-characters", "title": "Long", "variants": "xy"},
    {"id": 7, "title": 3.0},
    "skipped",
]


def binary():
    named = os.environ.get("ARDIA_RUST_CLI")
    if named:
        return Path(named)
    for profile in ("release", "debug"):
        found = CRATE / "target" / profile / "ardia"
        if found.exists():
            return found
    return None


class FakeArdia:
    def __init__(self, path: Path, replies: dict):
        self.replies = replies
        self.requests = []
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(str(path))
        self.server.listen(8)
        self.server.settimeout(0.2)
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.accept, daemon=True)
        self.thread.start()

    def accept(self):
        while not self.stopped.is_set():
            try:
                connection, _ = self.server.accept()
            except (socket.timeout, OSError):
                continue
            threading.Thread(target=self.talk, args=(connection,), daemon=True).start()

    def talk(self, connection):
        with connection, connection.makefile("rb") as lines:
            for line in lines:
                request = json.loads(line)
                method = request.get("method")
                self.requests.append((method, request.get("params")))
                reply = self.replies.get(method, {"result": None})
                if callable(reply):
                    reply = reply()
                if reply == "close":
                    return
                if isinstance(reply, bytes):
                    connection.sendall(reply)
                    continue
                connection.sendall(json.dumps({"id": request["id"], **reply}).encode() + b"\n")

    def close(self):
        self.stopped.set()
        self.server.close()
        self.thread.join(2)


@unittest.skipUnless(binary(), "build apps/cli/rust first (cargo build) or set ARDIA_RUST_CLI")
class RustParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = Path(tempfile.mkdtemp(prefix="arp", dir="/tmp"))
        cls.root = cls.scratch / "cli"
        (cls.root / "bin").mkdir(parents=True)
        shutil.copy2(binary(), cls.root / "bin" / "ardia")
        subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(cls.root / "python")], check=True)
        packages = subprocess.run([str(cls.root / "python" / "bin" / "python3"), "-I", "-c", "import site; print(site.getsitepackages()[0])"],
                                  check=True, capture_output=True, text=True).stdout.strip()
        (Path(packages) / "ardia-checkout.pth").write_text("\n".join([str(CLI), *site.getsitepackages()]) + "\n")
        cls.python = cls.root / "python" / "bin" / "python3"

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.scratch, True)

    def setUp(self):
        self.case = Path(tempfile.mkdtemp(prefix="c", dir=self.scratch))

    def environment(self, extra: dict) -> dict:
        env = {key: os.environ[key] for key in KEPT_ENV if key in os.environ}
        env.update({
            "HOME": str(self.case / "home"),
            "ARDIA_CLI_HOME": str(self.case / "cli-home"),
            "ARDIA_DATA_DIR": str(self.case / "data"),
            "ARDIA_TELEMETRY_URL": "http://127.0.0.1:9/v1/logs",
            "COLUMNS": "100",
            "LINES": "40",
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        env.update(extra)
        return env

    def run_side(self, side, argv, replies, extra, stdin, socket_ok, hello, consent):
        data = self.case / "data"
        data.mkdir(parents=True)
        (self.case / "home").mkdir(exist_ok=True)
        (data / "telemetry.json").write_text(json.dumps({"sharing": True, "installId": INSTALL_ID, **consent}))
        (data / "Telemetry").mkdir(mode=0o700)
        (data / "Telemetry" / "cli-flush.json").write_text(json.dumps({"failures": 0, "next_at": 9e12}))
        fake = None
        if socket_ok:
            fake = FakeArdia(data / "ArdiaControl.sock", {"hello": hello, **replies})
        command = [str(self.root / "bin" / "ardia")] if side == "rust" else [str(self.python), "-I", "-m", "ardia_cli"]
        try:
            done = subprocess.run(command + list(argv), input=stdin, capture_output=True, env=self.environment(extra), timeout=60)
        finally:
            if fake:
                fake.close()
        kept = self.case / side
        kept.mkdir()
        for name in ("data", "cli-home"):
            if (self.case / name).exists():
                (self.case / name).rename(kept / name)
        return done, (fake.requests if fake else []), kept / "data"

    def telemetry(self, data: Path):
        local = data / "Telemetry" / "local"
        records = []
        for path in sorted(local.glob("cli-*.jsonl")) if local.exists() else []:
            records += [json.loads(line) for line in path.read_text().splitlines()]
        spool = data / "Telemetry" / "cli-queue.jsonl"
        queued = [json.loads(line) for line in spool.read_text().splitlines()] if spool.exists() else []
        served = [record["properties"].get("served_by") for record in records if record["event"] == "cli_command"]
        for record in records + queued:
            for key in VOLATILE:
                record.pop(key, None)
            for key in VOLATILE_PROPERTIES:
                record["properties"].pop(key, None)
        return records, queued, served

    def usage(self, side: str):
        path = self.case / side / "cli-home" / "Usage" / "usage.json"
        return json.loads(path.read_text()) if path.exists() else None

    def check(self, *argv, replies=None, extra=None, stdin=b"", socket_ok=True, hello=None, served="rust", consent=None):
        replies = replies or {}
        hello = hello or {"result": {"app": "Ardia", "version": "1.0"}}
        sides = [self.run_side(side, argv, replies, extra or {}, stdin, socket_ok, hello, consent or {}) for side in ("rust", "python")]
        (rust, rust_requests, rust_data), (python, python_requests, python_data) = sides
        label = " ".join(argv) or "(no arguments)"
        self.assertEqual(rust.stdout, python.stdout, f"stdout of {label}")
        self.assertEqual(rust.stderr, python.stderr, f"stderr of {label}")
        self.assertEqual(rust.returncode, python.returncode, f"exit code of {label}")
        rust_records, rust_queue, rust_served = self.telemetry(rust_data)
        python_records, python_queue, python_served = self.telemetry(python_data)
        if served == "rust":
            self.assertEqual(rust_requests, python_requests, f"requests of {label}")
        else:
            self.assertEqual(rust_requests[-len(python_requests):] if python_requests else rust_requests, python_requests, f"requests of {label}")
        self.assertEqual(rust_records, python_records, f"telemetry of {label}")
        self.assertEqual(rust_queue, python_queue, f"queued telemetry of {label}")
        self.assertEqual(self.usage("rust"), self.usage("python"), f"usage of {label}")
        if python_served:
            self.assertEqual(python_served, ["python"])
            self.assertEqual(rust_served, [served], f"who served {label}")
        self.case = Path(tempfile.mkdtemp(prefix="c", dir=self.scratch))
        return rust

    def test_listings_match(self):
        workspace = {"workspace": {"result": TREE}}
        for argv in (
            ["tabs"], ["tabs", "--json"], ["tabs", "--flat"], ["tabs", "--flat", "--json"], ["tabs", "--usage"],
            ["tabs", "--usage", "--json"], ["tabs", "--pid", "777"], ["tabs", "--pid=501", "--json"], ["tabs", "--pid", "1"],
            ["--json", "tabs", "--window", "w-1", "--profile=p-1"], ["tabs", "--window", ""], ["groups"], ["groups", "--json"],
        ):
            self.check(*argv, replies=workspace)
        self.check("windows", replies={"windows": {"result": WINDOWS}})
        self.check("windows", "--json", replies={"windows": {"result": WINDOWS}})
        self.check("commands", replies={"commands": {"result": COMMANDS}})
        self.check("--json", "commands", replies={"commands": {"result": COMMANDS}})
        self.check("windows", replies={"windows": {"result": None}})
        self.check("windows", replies={"windows": {"result": [{"id": 1, "profileName": "p\u001c \u0085", "tabs": []}]}})
        self.check("commands", "--json", replies={"commands": {"result": [{"memory": 807960295084425.2, "cpu": 0.30000000000000004, "big": 1e300}]}})

    def test_the_data_dir_flag_wins(self):
        other = self.case / "elsewhere"
        other.mkdir()
        rust = self.check("tabs", "--data-dir", str(other), replies={"workspace": {"result": TREE}})
        self.assertEqual(rust.returncode, 2)

    def test_failures_match(self):
        self.check("tabs", replies={"workspace": {"error": {"code": "unknown_method", "message": "no"}}})
        self.check("groups", replies={"workspace": {"error": {"code": "refused", "message": "private \u001b window"}}})
        self.check("tabs", "--usage", replies={"workspace": {"error": {"code": "bad_request", "message": "params: not usage"}}})
        self.check("windows", replies={"windows": {"error": {"message": "broken"}}})
        self.check("commands", replies={"commands": {"error": None}})
        self.check("tabs", "--pid", "5", replies={"workspace": {"result": {"windows": []}}})
        self.check("windows", replies={"windows": "close"})
        self.check("windows", replies={"windows": b"not json\n"})
        self.check("windows", socket_ok=False)
        self.check("tabs", hello={"result": {"app": "Something"}})
        self.check("tabs", hello={"error": {"code": "x", "message": "go away"}})
        self.check("windows", replies={"windows": {"error": {"code": 7, "message": ["a", 1.5]}}})

    def test_consent_matches(self):
        for until in ("2020-01-01T00:00:00+0000", "20200101T000000Z", "2999-01-01 10", "2020-01-01T08:05.5Z", "2999-01-01T08.5+05.5", 1_000, 99_999_999_999_999):
            self.check("windows", replies={"windows": {"result": []}}, consent={"sharingUntil": until})
        self.check("windows", replies={"windows": {"result": []}}, consent={"sharing": False})
        self.check("windows", replies={"windows": {"result": []}}, consent={"sessionOpen": True, "sessionId": INSTALL_ID, "watchReport": "FB-AB12"})

    def test_an_expiry_it_cannot_read_keeps_the_event_local(self):
        for until in ("2999-W01-1", "2020-02-30T00:00:00Z", "not a date"):
            run, _, data = self.run_side("rust", ["windows"], {"windows": {"result": []}}, {}, b"", True, {"result": {"app": "Ardia"}}, {"sharingUntil": until})
            records, queued, _ = self.telemetry(data)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual([(record["distinct_id"], record["sent"]) for record in records], [("local", False)], until)
            self.assertEqual(queued, [], until)
            self.case = Path(tempfile.mkdtemp(prefix="c", dir=self.scratch))

    def test_opt_outs_match(self):
        for name, value in (("ARDIA_TELEMETRY", "off\u001c"), ("ARDIA_TELEMETRY", " No\u001f"), ("DO_NOT_TRACK", "0\u001f"), ("DO_NOT_TRACK", "\u001c")):
            self.check("windows", replies={"windows": {"result": []}}, extra={name: value})

    def test_an_ignored_interrupt_stays_ignored_after_the_hand_off(self):
        data = self.case / "data"
        data.mkdir()
        fake = FakeArdia(data / "ArdiaControl.sock", {"hello": {"result": {"app": "Ardia"}}, "subscribe": {"result": {}}})
        try:
            events = subprocess.Popen([str(self.root / "bin" / "ardia"), "events"], env=self.environment({}), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      preexec_fn=lambda: signal.signal(signal.SIGINT, signal.SIG_IGN))
            deadline = time.monotonic() + 20
            while not any(method == "subscribe" for method, _ in fake.requests) and time.monotonic() < deadline:
                time.sleep(0.05)
            events.send_signal(signal.SIGINT)
            time.sleep(1)
            self.assertIsNone(events.poll(), events.stderr.read() if events.poll() is not None else "")
        finally:
            events.kill()
            events.communicate()
            fake.close()

    def test_shapes_it_cannot_mirror_go_to_python(self):
        self.check("tabs", replies={"workspace": {"result": 3}}, served="python")
        self.check("tabs", replies={"workspace": {"result": "oops"}}, served="python")
        self.check("windows", replies={"windows": {"result": [{"id": 1, "tabs": ["x"]}]}}, served="python")
        self.check("commands", replies={"commands": {"result": [{"id": "a", "variants": 5}]}}, served="python")
        self.check("commands", replies={"commands": {"error": {"code": "failed", "message": ["\u00e9"]}}}, served="python")

    def test_other_commands_pass_through(self):
        ops = {"apply": {"result": {"ok": True, "applied": 1, "results": [{"op": "open", "tabs": ["tab-8"]}], "tabs": [{"id": "tab-8", "title": "New"}]}}}
        self.check("tabs", "open", "https://example.com", replies=ops, served="python")
        self.check("apply", replies=ops, stdin=b'[{"op": "tab.close", "tabs": ["tab-1"]}]', served="python")
        self.check("tabs", "--win", "w-1", replies={"workspace": {"result": TREE}}, served="python")
        self.check("tabs", "--bogus", served="python")
        self.check("bogus", served="python")
        self.check("--port", "1", "tabs", served="python")
        self.check("skills", "list", served="python")
        self.check("config", "path", served="python")
        self.check("tabs", "--help", served="python")

    def test_version_and_help_match(self):
        self.check("--version")
        for columns in ("200", "100", "80", "60", "56", "0", "abc", " 70 ", "-3"):
            self.check("--help", extra={"COLUMNS": columns})
        self.check("-h", extra={"COLUMNS": "120"})
        self.check(extra={"COLUMNS": "90"})
        self.check("--help", extra={"COLUMNS": "40"}, served="python")

    def test_its_events_reach_the_collector_through_the_python_flusher(self):
        collector = ThreadingHTTPServer(("127.0.0.1", 0), Collector)
        threading.Thread(target=collector.serve_forever, daemon=True).start()
        Collector.bodies.clear()
        data = self.case / "data"
        data.mkdir()
        (self.case / "home").mkdir()
        (data / "telemetry.json").write_text(json.dumps({"sharing": True, "installId": INSTALL_ID}))
        fake = FakeArdia(data / "ArdiaControl.sock", {"hello": {"result": {"app": "Ardia"}}, "windows": {"result": []}})
        reader, writer = os.pipe()
        try:
            url = f"http://127.0.0.1:{collector.server_address[1]}/v1/logs"
            done = subprocess.run([str(self.root / "bin" / "ardia"), "windows"], capture_output=True, pass_fds=(writer,),
                                  env=self.environment({"ARDIA_TELEMETRY_URL": url}), timeout=30)
            os.close(writer)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertTrue(select.select([reader], [], [], 1.5)[0], "the flusher kept a descriptor it inherited")
            self.assertEqual(os.read(reader, 1), b"")
            deadline = time.monotonic() + 20
            while not Collector.bodies and time.monotonic() < deadline:
                time.sleep(0.1)
            self.assertTrue(Collector.bodies, "the flusher never posted")
            attributes = {item["key"]: item["value"] for item in json.loads(Collector.bodies[0])["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]["attributes"]}
            self.assertEqual(attributes["served_by"], {"stringValue": "rust"})
            self.assertEqual(attributes["command"], {"stringValue": "windows"})
            self.assertEqual(attributes["distinct_id"], {"stringValue": INSTALL_ID})
            while (data / "Telemetry" / "cli-queue.jsonl").exists() and time.monotonic() < deadline:
                time.sleep(0.1)
            self.assertFalse((data / "Telemetry" / "cli-queue.jsonl").exists())
        finally:
            os.close(reader)
            fake.close()
            collector.shutdown()
            collector.server_close()

    def test_a_lease_is_held_while_it_runs(self):
        leases = self.root / ".leases"
        leases.mkdir(exist_ok=True)
        seen = []

        def listing():
            seen.extend(os.listdir(leases))
            return {"result": []}

        data = self.case / "data"
        data.mkdir()
        fake = FakeArdia(data / "ArdiaControl.sock", {"hello": {"result": {"app": "Ardia"}}, "windows": listing})
        try:
            done = subprocess.run([str(self.root / "bin" / "ardia"), "windows"], capture_output=True, env=self.environment({}), timeout=30)
        finally:
            fake.close()
            leftover = os.listdir(leases)
            shutil.rmtree(leases, True)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(len(seen), 1)
        self.assertTrue(seen[0].isdigit())
        self.assertEqual(leftover, [])


class BuildSmoke(unittest.TestCase):
    def test_the_packaging_smoke_runs_leave_no_history_or_telemetry_behind(self):
        script = (CLI / "scripts" / "build.sh").read_text().splitlines()
        runs = [line for line in script if '"$root/bin/ardia"' in line and not line.startswith(("cp ", "chmod ")) and "--version" not in line]
        self.assertTrue(runs)
        for line in runs:
            self.assertRegex(line, r'^ARDIA_CLI_HOME="\$work/[^"]+" ARDIA_TELEMETRY=off "\$root/bin/ardia" ', line)


class Collector(BaseHTTPRequestHandler):
    bodies: list = []

    def do_POST(self):
        Collector.bodies.append(self.rfile.read(int(self.headers["Content-Length"])))
        time.sleep(3)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    unittest.main()
