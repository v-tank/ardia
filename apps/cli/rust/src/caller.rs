use crate::json::Value;
use crate::plist;

pub const FALLBACK: &str = "ardia";
const MAX_NAME: usize = 40;
const MAX_APP_PATH: usize = 1024;
const MAX_DEPTH: usize = 64;
const AGENTS: &[(&str, &str)] = &[
    ("claude", "Claude Code"),
    ("codex", "Codex"),
    ("cursor-agent", "Cursor Agent"),
    ("gemini", "Gemini CLI"),
    ("opencode", "OpenCode"),
    ("aider", "Aider"),
    ("amp", "Amp"),
    ("goose", "Goose"),
    ("crush", "Crush"),
    ("droid", "Droid"),
    ("qwen", "Qwen Code"),
    ("copilot", "Copilot CLI"),
    ("kiro-cli", "Kiro"),
    ("cline", "Cline"),
];
const INTERPRETERS: &[&str] = &["node", "bun", "deno", "python", "ruby"];
const SCRIPT_SUFFIXES: &[&str] = &[".js", ".mjs", ".cjs", ".ts", ".py", ".rb"];

#[derive(Clone, Debug, PartialEq)]
pub struct Process {
    pub pid: u32,
    pub ppid: u32,
    pub path: String,
    pub argv: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Caller {
    pub name: String,
    pub app: Option<String>,
}

impl Caller {
    pub fn wire(&self) -> Value {
        let mut fields = vec![("name", Value::str(&self.name))];
        if let Some(app) = &self.app {
            fields.push(("app", Value::str(app)));
        }
        Value::object(fields)
    }
}

fn is_control(c: char) -> bool {
    let code = c as u32;
    code < 0x20
        || (0x7f..=0x9f).contains(&code)
        || matches!(code, 0xad | 0x600..=0x605 | 0x61c | 0x6dd | 0x70f | 0x180e | 0x200b..=0x200f | 0x202a..=0x202e | 0x2060..=0x2064 | 0x2066..=0x206f | 0xfeff | 0xfff9..=0xfffb)
        || (0xd800..=0xf8ff).contains(&code)
        || (0xe0000..=0xe007f).contains(&code)
        || code >= 0xf0000
}

fn is_separator(c: char) -> bool {
    c.is_whitespace()
        || matches!(c as u32, 0x20 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000)
        || matches!(c as u32, 0x1c..=0x1f)
}

pub fn clean_name(text: &str) -> Option<String> {
    let kept: String = text
        .chars()
        .filter(|c| is_separator(*c) || !is_control(*c))
        .map(|c| if is_separator(c) { ' ' } else { c })
        .collect();
    let joined = kept.split(' ').filter(|word| !word.is_empty()).collect::<Vec<_>>().join(" ");
    let name: String = joined.chars().take(MAX_NAME).collect();
    let name = name.trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn base_name(word: &str) -> &str {
    word.trim_end_matches('/').rsplit('/').next().unwrap_or("")
}

pub fn command_name(word: &str) -> String {
    let base = base_name(word).to_lowercase();
    for suffix in SCRIPT_SUFFIXES {
        if let Some(stem) = base.strip_suffix(suffix) {
            return stem.to_string();
        }
    }
    base
}

fn is_interpreter(word: &str) -> bool {
    let base = command_name(word);
    INTERPRETERS.iter().any(|name| {
        base == *name
            || base.strip_prefix(name).is_some_and(|rest| {
                let digits: String = rest.chars().filter(|c| *c != '.').collect();
                !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
            })
    })
}

pub fn agent_of(process: &Process) -> Option<&'static str> {
    let mut words: Vec<&str> = process.argv.first().map(String::as_str).into_iter().collect();
    words.push(&process.path);
    if words.iter().any(|word| is_interpreter(word)) {
        if let Some(script) = process.argv.get(1).filter(|arg| !arg.starts_with('-')) {
            words.push(script);
        }
    }
    words.iter().find_map(|word| {
        let name = command_name(word);
        AGENTS.iter().find(|(key, _)| *key == name).map(|(_, label)| *label)
    })
}

pub fn outer_bundle(path: &str) -> Option<String> {
    let rooted = path.starts_with('/');
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty() && *part != ".").collect();
    for index in 0..parts.len().saturating_sub(1) {
        let part = parts[index];
        if part.ends_with(".app") && part.len() > 4 && parts[index + 1] == "Contents" {
            let joined = parts[..=index].join("/");
            return Some(if rooted { format!("/{joined}") } else { joined });
        }
    }
    None
}

pub fn bundle_name(bundle: &str) -> Option<String> {
    let info = std::fs::File::open(format!("{bundle}/Contents/Info.plist")).ok().and_then(|file| {
        use std::io::Read;
        let mut raw = Vec::new();
        file.take(1024 * 1024).read_to_end(&mut raw).ok()?;
        Some(raw)
    });
    if let Some(raw) = info {
        for key in ["CFBundleDisplayName", "CFBundleName"] {
            if let Some(name) = plist::top_level_string(&raw, key).as_deref().and_then(clean_name) {
                return Some(name);
            }
        }
    }
    let folder = base_name(bundle);
    clean_name(folder.strip_suffix(".app").unwrap_or(folder))
}

pub fn from_chain(chain: &[Process], read_bundle_name: impl Fn(&str) -> Option<String>) -> Caller {
    for process in chain {
        if let Some(agent) = agent_of(process) {
            return Caller {
                name: agent.to_string(),
                app: None,
            };
        }
    }
    for process in chain {
        if let Some(bundle) = outer_bundle(&process.path) {
            if let Some(name) = read_bundle_name(&bundle) {
                let app = if bundle.chars().count() <= MAX_APP_PATH { Some(bundle) } else { None };
                return Caller { name, app };
            }
        }
    }
    Caller {
        name: FALLBACK.to_string(),
        app: None,
    }
}

#[cfg(target_os = "macos")]
mod reader {
    use super::Process;

    extern "C" {
        fn proc_pidinfo(pid: libc::c_int, flavor: libc::c_int, arg: u64, buffer: *mut libc::c_void, size: libc::c_int) -> libc::c_int;
        fn proc_pidpath(pid: libc::c_int, buffer: *mut libc::c_void, size: u32) -> libc::c_int;
    }

    const PROC_PIDT_SHORTBSDINFO: libc::c_int = 13;
    const SHORTBSDINFO_SIZE: libc::c_int = 64;
    const MAX_ARGS_READ: usize = 256 * 1024;

    fn parent(pid: u32) -> Option<u32> {
        let mut info = [0u8; 64];
        let got = unsafe { proc_pidinfo(pid as libc::c_int, PROC_PIDT_SHORTBSDINFO, 0, info.as_mut_ptr().cast(), SHORTBSDINFO_SIZE) };
        if got != SHORTBSDINFO_SIZE {
            return None;
        }
        Some(u32::from_ne_bytes([info[4], info[5], info[6], info[7]]))
    }

    fn path(pid: u32) -> String {
        let mut buffer = vec![0u8; 4096];
        let size = unsafe { proc_pidpath(pid as libc::c_int, buffer.as_mut_ptr().cast(), 4096) };
        if size <= 0 {
            return String::new();
        }
        String::from_utf8_lossy(&buffer[..size as usize]).into_owned()
    }

    fn arg_max() -> usize {
        let mut value: libc::c_int = 0;
        let mut size = std::mem::size_of::<libc::c_int>();
        let mut mib = [libc::CTL_KERN, libc::KERN_ARGMAX];
        let result = unsafe { libc::sysctl(mib.as_mut_ptr(), 2, (&mut value as *mut libc::c_int).cast(), &mut size, std::ptr::null_mut(), 0) };
        if result != 0 || value <= 0 {
            return MAX_ARGS_READ;
        }
        (value as usize).min(MAX_ARGS_READ)
    }

    fn argv(pid: u32, capacity: usize) -> Vec<String> {
        let mut raw = vec![0u8; capacity];
        let mut size = capacity;
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as libc::c_int];
        let result = unsafe { libc::sysctl(mib.as_mut_ptr(), 3, raw.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) };
        if result != 0 || size < 4 {
            return Vec::new();
        }
        raw.truncate(size);
        let argc = i32::from_ne_bytes([raw[0], raw[1], raw[2], raw[3]]);
        let rest = &raw[4..];
        let Some(end) = rest.iter().position(|byte| *byte == 0) else {
            return Vec::new();
        };
        let rest = &rest[end..];
        let start = rest.iter().position(|byte| *byte != 0).unwrap_or(rest.len());
        let words = rest[start..].split(|byte| *byte == 0);
        words
            .take(argc.clamp(0, 2) as usize)
            .map(|word| String::from_utf8_lossy(word).into_owned())
            .collect()
    }

    pub fn ancestry(start: u32) -> Vec<Process> {
        let capacity = arg_max();
        let mut chain = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut pid = start;
        while pid > 1 && seen.insert(pid) && chain.len() < super::MAX_DEPTH {
            let Some(ppid) = parent(pid) else { break };
            chain.push(Process {
                pid,
                ppid,
                path: path(pid),
                argv: argv(pid, capacity),
            });
            pid = ppid;
        }
        chain
    }
}

#[cfg(not(target_os = "macos"))]
mod reader {
    use super::Process;

    fn parent(root: &str, pid: u32) -> Option<u32> {
        let raw = std::fs::read(format!("{root}/{pid}/stat")).ok()?;
        let close = raw.iter().rposition(|byte| *byte == b')')?;
        let fields: Vec<&[u8]> = raw[close + 1..]
            .split(|byte| byte.is_ascii_whitespace())
            .filter(|field| !field.is_empty())
            .collect();
        std::str::from_utf8(fields.get(1)?).ok()?.parse().ok()
    }

    fn path(root: &str, pid: u32) -> String {
        std::fs::read_link(format!("{root}/{pid}/exe"))
            .map(|target| target.to_string_lossy().trim_end_matches(" (deleted)").to_string())
            .unwrap_or_default()
    }

    fn argv(root: &str, pid: u32) -> Vec<String> {
        let Ok(raw) = std::fs::read(format!("{root}/{pid}/cmdline")) else {
            return Vec::new();
        };
        raw.split(|byte| *byte == 0)
            .take(2)
            .filter(|word| !word.is_empty())
            .map(|word| String::from_utf8_lossy(word).into_owned())
            .collect()
    }

    pub fn ancestry(start: u32) -> Vec<Process> {
        let root = "/proc";
        let mut chain = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut pid = start;
        while pid > 1 && seen.insert(pid) && chain.len() < super::MAX_DEPTH {
            let Some(ppid) = parent(root, pid) else { break };
            chain.push(Process {
                pid,
                ppid,
                path: path(root, pid),
                argv: argv(root, pid),
            });
            pid = ppid;
        }
        chain
    }
}

pub fn current() -> Caller {
    from_chain(&reader::ancestry(std::os::unix::process::parent_id()), bundle_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(path: &str, argv: &[&str]) -> Process {
        Process {
            pid: 10,
            ppid: 1,
            path: path.into(),
            argv: argv.iter().map(|word| word.to_string()).collect(),
        }
    }

    #[test]
    fn finds_agents_like_caller_py() {
        assert_eq!(
            agent_of(&process("/Users/x/.local/share/claude/versions/2.1.0", &["claude"])),
            Some("Claude Code")
        );
        assert_eq!(
            agent_of(&process("/opt/homebrew/bin/node", &["node", "/usr/local/bin/codex.js"])),
            Some("Codex")
        );
        assert_eq!(agent_of(&process("/usr/bin/python3.12", &["python3.12", "-m", "aider"])), None);
        assert_eq!(agent_of(&process("/bin/zsh", &["-zsh"])), None);
        assert!(is_interpreter("python3.13"));
        assert!(!is_interpreter("pythonx"));
    }

    #[test]
    fn names_the_outer_bundle() {
        assert_eq!(
            outer_bundle("/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper"),
            Some("/Applications/Visual Studio Code.app".into())
        );
        assert_eq!(outer_bundle("/usr/bin/ssh"), None);
        let chain = [
            process("/bin/zsh", &["zsh"]),
            process("/Applications/Ghostty.app/Contents/MacOS/ghostty", &["ghostty"]),
        ];
        assert_eq!(
            from_chain(&chain, |_| Some("Ghostty".into())),
            Caller {
                name: "Ghostty".into(),
                app: Some("/Applications/Ghostty.app".into())
            }
        );
        assert_eq!(from_chain(&chain[..1], |_| None).name, FALLBACK);
    }

    #[test]
    fn cleans_names() {
        assert_eq!(clean_name("  Visual\u{200b} Studio\tCode\u{0} "), Some("Visual Studio Code".into()));
        assert_eq!(clean_name(&"x".repeat(50)).map(|name| name.len()), Some(40));
        assert_eq!(clean_name("\u{200b}"), None);
    }

    #[test]
    fn walks_its_own_ancestry() {
        let chain = reader::ancestry(std::process::id());
        assert!(!chain.is_empty());
        assert_eq!(chain[0].pid, std::process::id());
        assert!(!chain[0].path.is_empty());
    }
}
