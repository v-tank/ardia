import json
import re
import shutil
import tempfile
from pathlib import Path

from ardia_cli import config_files, control
from ardia_cli.control import MethodError, Unreachable
from ardia_cli.endpoint import DATA_DIR_HELP
from ardia_cli.printable import complain, say, shown

MANIFEST = "plugin.json"
SCHEMA = "plugin.schema.json"
NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
MAX_MANIFEST = 1 << 20
MAX_COPY = 200 << 20
CALL_TIMEOUT = 320.0

DESCRIPTION = """\
Install, list and manage Ardia plugins. A plugin is a folder with a plugin.json; it lives in the plugins folder
of the config folder ({folder}, or <data dir>/config/plugins with --data-dir or $ARDIA_DATA_DIR). Ardia sees
a plugin the moment its folder appears, and every plugin starts off: turning one on shows what it gets, in Ardia.
See docs/plugins.md.

Commands:
  list       the plugins, whether they're on and what they add
  install    copy a plugin folder (or a lone plugin.json) into the plugins folder
  check      check plugin manifests against plugin.schema.json
  remove     remove a plugin (through Ardia when it's running)
  enable     ask Ardia to show a plugin's consent sheet
  disable    turn a plugin off
  call       call one of a plugin's tools and print its result as JSON
  path       print the plugins folder
"""


def add_parsers(commands, formatter):
    group = commands.add_parser("plugins", help="install, list and manage plugins", description=DESCRIPTION.format(folder=config_files.default_folder() / "plugins"), formatter_class=formatter)
    sub = group.add_subparsers(dest="plugins_command", metavar="<command>")

    def data_dir(parser):
        parser.add_argument("--data-dir", metavar="DIR", help=DATA_DIR_HELP)
        return parser

    listing = data_dir(sub.add_parser("list", help="list the plugins"))
    listing.add_argument("--json", action="store_true", help="print JSON")
    install = data_dir(sub.add_parser("install", help="install a plugin from a folder or plugin.json"))
    install.add_argument("source", metavar="PATH", help="a plugin's folder, or its plugin.json")
    install.add_argument("--force", action="store_true", help="replace a plugin with the same name")
    check = data_dir(sub.add_parser("check", help="check plugin manifests"))
    check.add_argument("target", nargs="?", metavar="NAME|PATH", help="an installed plugin's name or a path (default: every installed plugin)")
    check.add_argument("--json", action="store_true", help="print JSON")
    for verb, text in (("remove", "remove a plugin"), ("enable", "show a plugin's consent sheet in Ardia"), ("disable", "turn a plugin off")):
        data_dir(sub.add_parser(verb, help=text)).add_argument("name", metavar="NAME")
    call = data_dir(sub.add_parser("call", help="call a plugin's tool"))
    call.add_argument("name", metavar="NAME")
    call.add_argument("tool", metavar="TOOL")
    call.add_argument("input", nargs="?", metavar="JSON", help="the tool's input, a JSON object (default {})")
    data_dir(sub.add_parser("path", help="print the plugins folder"))


def plugins_folder(args) -> Path:
    return config_files.places(args.data_dir).folder / "plugins"


def read_manifest(path: Path):
    if path.is_dir():
        path = path / MANIFEST
    if not path.is_file():
        raise config_files.ConfigError(f"{path} isn't a plugin: it has no {MANIFEST}")
    if path.stat().st_size > MAX_MANIFEST:
        raise config_files.ConfigError(f"{path} is over 1 MB")
    return config_files.read_object(path, str(path))


def manifest_problems(args, manifest: dict) -> list[str]:
    from ardia_cli.schema_check import validate

    schema = config_files.find_schema(config_files.places(args.data_dir), SCHEMA)
    problems = []
    if schema.document is not None and manifest.get("manifest") is not None:
        problems = [f"{p.to_dict()['key'] or 'plugin.json'}: {p.message}" for p in validate(manifest, schema.document)]
    name = manifest.get("name")
    if not isinstance(name, str) or not NAME.match(name):
        problems.append("name must be 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit")
    return problems


def unreachable_exit(error: Unreachable) -> int:
    error.noted()
    complain(f"ardia: {error}")
    return 2


def ask(args, method: str, params=None, timeout: float = 30.0):
    return control.call(args.data_dir, method, params, timeout)


def files_listing(args) -> list[dict]:
    folder = plugins_folder(args)
    out = []
    for entry in sorted(folder.iterdir()) if folder.is_dir() else []:
        if not NAME.match(entry.name):
            continue
        try:
            manifest = read_manifest(entry)
            problems = manifest_problems(args, manifest)
            if manifest.get("name") != entry.name:
                problems.append(f"name is {manifest.get('name')}, but its folder is {entry.name}")
            out.append({"name": entry.name, "title": manifest.get("title") or entry.name, "version": manifest.get("version"), "enabled": None, "problems": problems})
        except (config_files.ConfigError, OSError) as error:
            out.append({"name": entry.name, "title": entry.name, "version": None, "enabled": None, "problems": [str(error)]})
    return out


def cmd_list(args) -> int:
    try:
        plugins = ask(args, "plugins")
    except (Unreachable, MethodError):
        plugins = files_listing(args)
    if args.json:
        say(json.dumps(plugins, indent=2, ensure_ascii=False))
        return 0
    if not plugins:
        say(f"No plugins in {plugins_folder(args)}")
    for plugin in plugins:
        state = "on" if plugin.get("active") else "changed, review it in Ardia" if plugin.get("needsReview") else "off" if plugin.get("enabled") is not None else "installed (Ardia isn't reachable, so on or off is unknown)"
        running = f", program {plugin['process']}" if plugin.get("process") else ""
        adds = f"  adds {', '.join(plugin['contributes'])}" if plugin.get("contributes") else ""
        version = f" {plugin['version']}" if plugin.get("version") else ""
        say(shown(f"{plugin['name']}{version}  {state}{running}{adds}"))
        for problem in plugin.get("problems") or []:
            say(shown(f"  problem: {problem}"))
    return 0


def copy_tree(source: Path, target: Path) -> None:
    total = 0
    for path in source.rglob("*"):
        if path.is_symlink():
            raise config_files.ConfigError(f"{path} is a link; a plugin's files must be real files")
        if path.is_file():
            total += path.stat().st_size
    if total > MAX_COPY:
        raise config_files.ConfigError(f"{source} is over 200 MB")
    shutil.copytree(source, target, symlinks=True)


def cmd_install(args) -> int:
    source = Path(args.source).expanduser()
    try:
        manifest = read_manifest(source)
    except (config_files.ConfigError, OSError) as error:
        complain(f"ardia plugins install: {error}")
        return 1
    problems = manifest_problems(args, manifest)
    if problems:
        for problem in problems:
            complain(f"ardia plugins install: {problem}")
        return 1
    name = manifest["name"]
    folder = plugins_folder(args)
    target = folder / name
    if (target.exists() or target.is_symlink()) and not args.force:
        complain(f"ardia plugins install: {name} is already installed (--force replaces it)")
        return 1
    replacing = target.exists() or target.is_symlink()
    if replacing:
        try:
            ask(args, "plugins.disable", {"name": name})
        except (Unreachable, MethodError):
            complain(f"ardia plugins install: Ardia isn't reachable, so if {name} was on it stays on with the new files until its plugin.json changes")
    folder.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{name}.", dir=folder))
    try:
        staged = staging / name
        if source.is_dir():
            copy_tree(source, staged)
        else:
            staged.mkdir()
            shutil.copy2(source, staged / MANIFEST)
        if target.is_symlink() or target.is_file():
            target.unlink()
        elif target.exists():
            shutil.rmtree(target)
        staged.rename(target)
    except (config_files.ConfigError, OSError) as error:
        complain(f"ardia plugins install: {error}")
        return 1
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    state = "Replaced" if replacing else "Installed"
    say(f"{state} {name} in {target}. It's off: turn it on in Ardia's Settings › Plugins, or with ardia plugins enable {name}.")
    return 0


def cmd_check(args) -> int:
    targets = []
    if args.target and ("/" in args.target or args.target.endswith(".json")):
        targets = [Path(args.target).expanduser()]
    elif args.target:
        targets = [plugins_folder(args) / args.target]
    else:
        folder = plugins_folder(args)
        targets = sorted(p for p in folder.iterdir() if NAME.match(p.name)) if folder.is_dir() else []
    report = []
    for target in targets:
        try:
            problems = manifest_problems(args, read_manifest(target))
        except (config_files.ConfigError, OSError) as error:
            problems = [str(error)]
        report.append({"file": str(target), "problems": problems})
    ok = all(not r["problems"] for r in report)
    if args.json:
        say(json.dumps({"ok": ok, "plugins": report}, indent=2, ensure_ascii=False))
    else:
        for entry in report:
            say(shown(f"{entry['file']}: {'ok' if not entry['problems'] else ''}"))
            for problem in entry["problems"]:
                say(shown(f"  {problem}"))
    return 0 if ok else 1


def cmd_remove(args) -> int:
    try:
        ask(args, "plugins.remove", {"name": args.name})
        say(f"Removed {args.name}.")
        return 0
    except MethodError as error:
        complain(f"ardia plugins remove: {error.message}")
        return 1
    except Unreachable:
        pass
    target = plugins_folder(args) / args.name
    if not NAME.match(args.name) or not (target.exists() or target.is_symlink()):
        complain(f"ardia plugins remove: there's no plugin {args.name}")
        return 1
    if target.is_symlink():
        target.unlink()
    else:
        shutil.rmtree(target)
    say(f"Removed {args.name}.")
    return 0


def cmd_toggle(args) -> int:
    method = "plugins.enable" if args.plugins_command == "enable" else "plugins.disable"
    try:
        result = ask(args, method, {"name": args.name})
    except Unreachable as error:
        return unreachable_exit(error)
    except MethodError as error:
        complain(f"ardia plugins {args.plugins_command}: {error.message}")
        return 1
    if isinstance(result, dict) and result.get("waiting"):
        say(f"Ardia is showing what {args.name} gets; turn it on there.")
    else:
        say(f"{args.name} is {'on' if args.plugins_command == 'enable' else 'off'}.")
    return 0


def cmd_call(args) -> int:
    try:
        payload = config_files.parse_json(args.input) if args.input is not None else {}
    except ValueError as error:
        complain(f"ardia plugins call: the input isn't JSON ({error})")
        return 1
    try:
        result = ask(args, "plugins.call", {"plugin": args.name, "tool": args.tool, "input": payload}, CALL_TIMEOUT)
    except Unreachable as error:
        return unreachable_exit(error)
    except MethodError as error:
        complain(f"ardia plugins call: {error.message}")
        return 1
    say(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def run(args, parser) -> int:
    handlers = {"list": cmd_list, "install": cmd_install, "check": cmd_check, "remove": cmd_remove, "enable": cmd_toggle, "disable": cmd_toggle, "call": cmd_call}
    if args.plugins_command == "path":
        say(str(plugins_folder(args)))
        return 0
    handler = handlers.get(args.plugins_command)
    if handler is None:
        parser.parse_args(["plugins", "--help"])
        return 0
    return handler(args)
