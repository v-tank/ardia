use crate::paths::{self, env_set, LINUX};
use std::path::PathBuf;

pub const NOT_REACHABLE: &str = "Ardia isn't running, or \"Let the ardia command control Ardia\" is off in Settings.";

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

pub fn data_root(data_dir: Option<&str>) -> PathBuf {
    let root = data_dir.filter(|dir| !dir.is_empty()).map(str::to_string).or_else(|| env_set("ARDIA_DATA_DIR"));
    match root {
        Some(root) => PathBuf::from(paths::pure_path(&paths::expand_user(&root))),
        None => installed(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_data_dir() {
        assert_eq!(data_root(Some("/tmp//x/")), PathBuf::from("/tmp/x"));
        assert!(installed_data_dir(false).ends_with("Library/Application Support/com.ardia.browser"));
        assert!(installed_data_dir(true).ends_with("ardia"));
    }
}
