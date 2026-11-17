use crate::json::{self, Value};
use crate::paths::{self, env_set, LINUX};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const NOT_REACHABLE: &str = "Ardia isn't running, or \"Let the ardia command control Ardia\" is off in Settings.";
pub const CONTROL_FILE: &str = "ArdiaControl.json";
const MAX_CONTROL_FILE: usize = 64 * 1024;

#[derive(Debug, PartialEq)]
pub struct EndpointError(pub String);

#[derive(Debug, PartialEq)]
pub struct Endpoint {
    pub ws: String,
    pub source: String,
    pub explicit: bool,
    pub active: Option<String>,
    pub instance: Option<String>,
}

fn xdg_dir(variable: &str, fallback: &[&str]) -> PathBuf {
    match env_set(variable) {
        Some(value) => PathBuf::from(paths::pure_path(&value)),
        None => fallback.iter().fold(paths::home(), |path, part| path.join(part)),
    }
}

pub fn installed_data_dir(linux: bool) -> PathBuf {
    if !linux {
        return paths::home().join("Library").join("Application Support").join("com.ardia.browser");
    }
    match env_set("ARDIA_CONFIG_HOME") {
        Some(value) => PathBuf::from(paths::pure_path(&value)).join("ardia"),
        None => xdg_dir("XDG_CONFIG_HOME", &[".config"]).join("ardia"),
    }
}

pub fn installed() -> PathBuf {
    installed_data_dir(LINUX)
}

pub fn chromium_dir(root: &Path, linux: bool) -> PathBuf {
    if linux {
        root.to_path_buf()
    } else {
        root.join("Chromium")
    }
}

pub fn control_file_path(root: &Path) -> PathBuf {
    chromium_dir(root, LINUX).join(CONTROL_FILE)
}

pub fn data_root(data_dir: Option<&str>) -> PathBuf {
    let root = data_dir.filter(|dir| !dir.is_empty()).map(str::to_string).or_else(|| env_set("ARDIA_DATA_DIR"));
    match root {
        Some(root) => PathBuf::from(paths::pure_path(&paths::expand_user(&root))),
        None => installed(),
    }
}

pub fn resolve(ws: Option<&str>, port: Option<i64>, data_dir: Option<&str>) -> Result<Endpoint, EndpointError> {
    if let Some(ws) = ws.filter(|ws| !ws.is_empty()) {
        return from_ws(ws, "--ws");
    }
    if let Some(port) = port {
        return from_port(port, "--port");
    }
    if let Some(ws) = env_set("ARDIA_WS") {
        return from_ws(&ws, "ARDIA_WS");
    }
    if let Some(port) = env_set("ARDIA_PORT") {
        return from_port(env_port_number(&port)?, "ARDIA_PORT");
    }
    if let Some(cdp) = env_set("ARDIA_CDP_URL") {
        return from_ws(&cdp, "ARDIA_CDP_URL");
    }
    from_control_file(&control_file_path(&data_root(data_dir)))
}

pub fn env_port_number(text: &str) -> Result<i64, EndpointError> {
    let trimmed = text.trim();
    let digits = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    let parsed = if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
        trimmed.parse::<i64>().ok()
    } else {
        None
    };
    parsed.ok_or_else(|| {
        EndpointError(format!(
            "ARDIA_PORT must be a port number, not {}",
            crate::py::repr_str(text).unwrap_or_else(|_| format!("'{text}'"))
        ))
    })
}

struct Url<'a> {
    scheme: String,
    netloc: &'a str,
    path: &'a str,
    query: &'a str,
}

fn split_url(url: &str) -> Option<Url<'_>> {
    let (scheme, rest) = url.split_once(':')?;
    if scheme.is_empty() || !scheme.starts_with(|c: char| c.is_ascii_alphabetic()) || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) {
        return None;
    }
    let rest = rest.strip_prefix("//")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let netloc = &rest[..end];
    let rest = &rest[end..];
    let rest = rest.split('#').next().unwrap_or("");
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    Some(Url {
        scheme: scheme.to_ascii_lowercase(),
        netloc,
        path,
        query,
    })
}

pub fn from_ws(url: &str, source: &str) -> Result<Endpoint, EndpointError> {
    let refuse = || EndpointError(format!("{source} must be a ws://host:port/devtools/browser/<id> URL"));
    let parts = split_url(url).ok_or_else(refuse)?;
    if !matches!(parts.scheme.as_str(), "ws" | "wss") || parts.netloc.is_empty() || !parts.path.starts_with("/devtools/browser/") {
        return Err(refuse());
    }
    let _ = parts.query;
    Ok(Endpoint {
        ws: url.to_string(),
        source: source.to_string(),
        explicit: true,
        active: None,
        instance: Some(format!("{}{}", parts.netloc, parts.path)),
    })
}

fn http_version(port: u16) -> Result<Vec<u8>, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let timeout = Duration::from_secs(3);
    let failed = |error: std::io::Error| match error.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => "timed out".to_string(),
        _ => match error.raw_os_error() {
            Some(code) => format!("[Errno {code}] {}", paths::strerror(code)),
            None => error.to_string(),
        },
    };
    let mut stream = TcpStream::connect_timeout(&address, timeout).map_err(failed)?;
    stream.set_read_timeout(Some(timeout)).map_err(failed)?;
    stream.set_write_timeout(Some(timeout)).map_err(failed)?;
    let request = format!("GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).map_err(failed)?;
    let mut raw = Vec::new();
    stream.take((MAX_CONTROL_FILE * 2) as u64).read_to_end(&mut raw).map_err(failed)?;
    let split = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("Remote end closed connection without response")?;
    let head = String::from_utf8_lossy(&raw[..split]).into_owned();
    let mut body = raw[split + 4..].to_vec();
    let status_line = head.lines().next().unwrap_or("");
    let mut fields = status_line.splitn(3, ' ');
    let _ = fields.next();
    let status: u16 = fields.next().and_then(|code| code.parse().ok()).ok_or("bad status line")?;
    if !(200..300).contains(&status) {
        return Err(fields.next().unwrap_or("").to_string());
    }
    let chunked = head.lines().any(|line| {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("transfer-encoding:") && lower.contains("chunked")
    });
    if chunked {
        body = dechunk(&body);
    }
    body.truncate(MAX_CONTROL_FILE);
    Ok(body)
}

fn dechunk(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(line_end) = body[at..].windows(2).position(|window| window == b"\r\n") {
        let size_text = String::from_utf8_lossy(&body[at..at + line_end]).into_owned();
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16).unwrap_or(0);
        at += line_end + 2;
        if size == 0 || at + size > body.len() {
            break;
        }
        out.extend_from_slice(&body[at..at + size]);
        at += size + 2;
    }
    out
}

pub fn from_port(port: i64, source: &str) -> Result<Endpoint, EndpointError> {
    if !(1..65536).contains(&port) {
        return Err(EndpointError(format!("{source} must be between 1 and 65535, not {port}")));
    }
    let body = http_version(port as u16).map_err(|reason| EndpointError(format!("no DevTools server answers on 127.0.0.1:{port} ({reason})")))?;
    let info = json::parse(&body).ok_or_else(|| EndpointError(format!("no DevTools server answers on 127.0.0.1:{port} (its answer isn't JSON)")))?;
    match info.get("webSocketDebuggerUrl") {
        Some(Value::Str(ws)) => from_ws(ws, &format!("{source} {port}")),
        _ => Err(EndpointError(format!("127.0.0.1:{port}/json/version has no webSocketDebuggerUrl"))),
    }
}

fn full_match(text: &str, valid: impl Fn(&str) -> bool) -> bool {
    valid(text.strip_suffix('\n').unwrap_or(text))
}

fn browser_path_ok(text: &str) -> bool {
    full_match(text, |text| {
        text.strip_prefix("/devtools/browser/")
            .is_some_and(|id| (1..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
    })
}

fn token_ok(text: &str) -> bool {
    full_match(text, |text| {
        (16..=1024).contains(&text.len()) && text.bytes().all(|b| (0x21..=0x7e).contains(&b))
    })
}

fn quote_all(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"_.-~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn alive(pid: i64) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else { return false };
    unsafe { libc::kill(pid, 0) == 0 }
}

fn as_int(value: Option<&Value>) -> Option<i128> {
    match value {
        Some(Value::Int(number)) => Some(*number),
        Some(Value::Bool(flag)) => Some(i128::from(*flag)),
        _ => None,
    }
}

pub fn from_control_file(path: &Path) -> Result<Endpoint, EndpointError> {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let fail = |detail: &str| EndpointError(format!("{NOT_REACHABLE} ({name} {detail})"));
    let fd = match paths::open(path, libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK) {
        Ok(fd) => fd,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(EndpointError(NOT_REACHABLE.to_string())),
        Err(error) => {
            let code = error.raw_os_error().unwrap_or(0);
            let reason = if code == libc::ELOOP {
                "is a symbolic link".to_string()
            } else {
                paths::strerror(code)
            };
            return Err(fail(&reason));
        }
    };
    let info = paths::metadata(&fd).map_err(|_| fail("isn't a regular file"))?;
    if !info.is_file() {
        return Err(fail("isn't a regular file"));
    }
    if info.uid() != paths::uid() {
        return Err(fail("belongs to another user"));
    }
    if info.permissions().mode() & 0o7777 != 0o600 {
        return Err(fail("must be mode 0600"));
    }
    let raw = paths::read_fd(&fd, MAX_CONTROL_FILE + 1).map_err(|error| fail(&paths::strerror(error.raw_os_error().unwrap_or(0))))?;
    let control = json::parse(&raw).ok_or_else(|| fail("isn't valid JSON"))?;
    let Value::Object(control) = control else { return Err(fail("isn't valid")) };
    let port = as_int(control.get("port"))
        .filter(|port| (1..65536).contains(port))
        .ok_or_else(|| fail("has no valid port"))?;
    let browser = control
        .get("browser")
        .and_then(Value::as_str)
        .filter(|path| browser_path_ok(path))
        .ok_or_else(|| fail("has no valid browser path"))?;
    let token = control
        .get("token")
        .and_then(Value::as_str)
        .filter(|token| token_ok(token))
        .ok_or_else(|| fail("has no valid token"))?;
    let pid = as_int(control.get("pid")).filter(|pid| *pid > 1 && i64::try_from(*pid).is_ok_and(alive));
    if pid.is_none() {
        return Err(EndpointError(NOT_REACHABLE.to_string()));
    }
    let generation = match control.get("generation") {
        Some(Value::Bool(flag)) => if *flag { "True" } else { "False" }.to_string(),
        Some(Value::Int(number)) => number.to_string(),
        _ => "0".to_string(),
    };
    let query = format!("token={}", quote_all(token));
    Ok(Endpoint {
        ws: format!("ws://127.0.0.1:{port}{browser}?{query}"),
        source: path.to_string_lossy().into_owned(),
        explicit: false,
        active: Some(format!("http://127.0.0.1:{port}/ardia/active?{query}")),
        instance: Some(format!("{}:{generation}:{browser}", pid.unwrap_or_default())),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    struct Scratch(PathBuf);

    impl std::ops::Deref for Scratch {
        type Target = PathBuf;

        fn deref(&self) -> &PathBuf {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn scratch(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("ardia-endpoint-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }

    fn control(dir: &Path, text: &str, mode: u32) -> PathBuf {
        let path = dir.join(CONTROL_FILE);
        std::fs::write(&path, text).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
        path
    }

    #[test]
    fn reads_a_valid_control_file() {
        let dir = scratch("valid");
        let pid = std::process::id();
        let path = control(
            &dir,
            &format!(r#"{{"port":9333,"browser":"/devtools/browser/ab-12","token":"abcdefghijklmnop+/","pid":{pid},"generation":4}}"#),
            0o600,
        );
        let found = from_control_file(&path).unwrap();
        assert_eq!(found.ws, "ws://127.0.0.1:9333/devtools/browser/ab-12?token=abcdefghijklmnop%2B%2F");
        assert_eq!(found.active.as_deref(), Some("http://127.0.0.1:9333/ardia/active?token=abcdefghijklmnop%2B%2F"));
        assert_eq!(found.instance, Some(format!("{pid}:4:/devtools/browser/ab-12")));
        assert!(!found.explicit);
    }

    #[test]
    fn refuses_unsafe_or_stale_control_files() {
        let dir = scratch("refuse");
        let pid = std::process::id();
        let good = format!(r#"{{"port":9333,"browser":"/devtools/browser/x","token":"abcdefghijklmnop","pid":{pid}}}"#);
        let path = control(&dir, &good, 0o644);
        assert_eq!(
            from_control_file(&path).unwrap_err().0,
            format!("{NOT_REACHABLE} (ArdiaControl.json must be mode 0600)")
        );
        let path = control(&dir, "[1]", 0o600);
        assert_eq!(
            from_control_file(&path).unwrap_err().0,
            format!("{NOT_REACHABLE} (ArdiaControl.json isn't valid)")
        );
        let path = control(&dir, "{", 0o600);
        assert_eq!(
            from_control_file(&path).unwrap_err().0,
            format!("{NOT_REACHABLE} (ArdiaControl.json isn't valid JSON)")
        );
        let path = control(&dir, &good.replace("abcdefghijklmnop", "short"), 0o600);
        assert_eq!(
            from_control_file(&path).unwrap_err().0,
            format!("{NOT_REACHABLE} (ArdiaControl.json has no valid token)")
        );
        let path = control(&dir, &good.replace(&pid.to_string(), "999999999"), 0o600);
        assert_eq!(from_control_file(&path).unwrap_err().0, NOT_REACHABLE);
        std::fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", &path).unwrap();
        assert_eq!(
            from_control_file(&path).unwrap_err().0,
            format!("{NOT_REACHABLE} (ArdiaControl.json is a symbolic link)")
        );
        assert_eq!(from_control_file(&dir.join("missing.json")).unwrap_err().0, NOT_REACHABLE);
    }

    #[test]
    fn checks_websocket_urls() {
        let found = from_ws("ws://127.0.0.1:9/devtools/browser/x?token=t", "--ws").unwrap();
        assert_eq!(found.instance.as_deref(), Some("127.0.0.1:9/devtools/browser/x"));
        assert!(found.explicit);
        for bad in ["http://h/devtools/browser/x", "ws:///devtools/browser/x", "ws://h/devtools/page/x", "nothing"] {
            assert_eq!(from_ws(bad, "--ws").unwrap_err().0, "--ws must be a ws://host:port/devtools/browser/<id> URL");
        }
    }

    #[test]
    fn asks_a_devtools_port() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 1024];
            let _ = stream.read(&mut buffer);
            let body = r#"{"webSocketDebuggerUrl":"ws://127.0.0.1:1/devtools/browser/abc"}"#;
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        });
        let found = from_port(i64::from(port), "--port").unwrap();
        server.join().unwrap();
        assert_eq!(found.source, format!("--port {port}"));
        assert_eq!(found.ws, "ws://127.0.0.1:1/devtools/browser/abc");
        assert_eq!(from_port(0, "--port").unwrap_err().0, "--port must be between 1 and 65535, not 0");
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = closed.local_addr().unwrap().port();
        drop(closed);
        assert!(from_port(i64::from(port), "--port")
            .unwrap_err()
            .0
            .starts_with(&format!("no DevTools server answers on 127.0.0.1:{port} ([Errno ")));
    }

    #[test]
    fn finds_the_data_dir() {
        assert_eq!(data_root(Some("/tmp//x/")), PathBuf::from("/tmp/x"));
        assert!(installed_data_dir(false).ends_with("Library/Application Support/com.ardia.browser"));
        assert!(installed_data_dir(true).ends_with("ardia"));
        assert_eq!(
            control_file_path(Path::new("/d")),
            if LINUX {
                PathBuf::from("/d/ArdiaControl.json")
            } else {
                PathBuf::from("/d/Chromium/ArdiaControl.json")
            }
        );
        assert!(env_port_number("x").unwrap_err().0.contains("'x'"));
        assert_eq!(env_port_number(" 9222 ").unwrap(), 9222);
    }
}
