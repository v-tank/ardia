use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs_f64()).unwrap_or(0.0)
}

pub fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

pub fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year.rem_euclid(400);
    let month = i64::from(month);
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn utc_day(seconds: f64) -> String {
    let (year, month, day) = civil((seconds.floor() as i64).div_euclid(86_400));
    format!("{year:04}-{month:02}-{day:02}")
}

pub fn iso(seconds: f64) -> String {
    let whole = seconds.floor() as i64;
    let (year, month, day) = civil(whole.div_euclid(86_400));
    let rest = whole.rem_euclid(86_400);
    let millis = ((seconds * 1000.0) as i64).rem_euclid(1000);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

fn digits(text: &str, count: usize) -> Option<i64> {
    if text.len() == count && text.bytes().all(|b| b.is_ascii_digit()) {
        text.parse().ok()
    } else {
        None
    }
}

fn local_offset(seconds: i64) -> i64 {
    let mut parts: libc::tm = unsafe { std::mem::zeroed() };
    let time: libc::time_t = seconds as libc::time_t;
    unsafe { libc::localtime_r(&time, &mut parts) };
    parts.tm_gmtoff as i64
}

pub fn parse_iso(text: &str) -> Option<f64> {
    let text = text.strip_suffix('Z').map(|rest| format!("{rest}+00:00")).unwrap_or_else(|| text.to_string());
    let date = text.get(..10)?;
    let year = digits(date.get(0..4)?, 4)?;
    let month = digits(date.get(5..7)?, 2)? as u32;
    let day = digits(date.get(8..10)?, 2)? as u32;
    if date.as_bytes()[4] != b'-' || date.as_bytes()[7] != b'-' || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut rest = &text[10..];
    let mut seconds = 0.0;
    if !rest.is_empty() {
        let separator = rest.chars().next()?;
        if separator != 'T' && separator != ' ' {
            return None;
        }
        rest = &rest[1..];
        let zone_at = rest.find(['+', '-']).unwrap_or(rest.len());
        let (clock, zone) = rest.split_at(zone_at);
        let (clock, fraction) = clock.split_once('.').unwrap_or((clock, ""));
        let fields: Vec<&str> = clock.split(':').collect();
        if !(2..=3).contains(&fields.len()) {
            return None;
        }
        let hour = digits(fields[0], 2)?;
        let minute = digits(fields[1], 2)?;
        let second = if fields.len() == 3 { digits(fields[2], 2)? } else { 0 };
        if hour > 23 || minute > 59 || second > 59 {
            return None;
        }
        let fraction = if fraction.is_empty() {
            0.0
        } else {
            if fraction.len() > 6 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            format!("0.{fraction}").parse::<f64>().ok()?
        };
        seconds = (hour * 3600 + minute * 60 + second) as f64 + fraction;
        rest = zone;
    }
    let base = days_from_civil(year, month, day) * 86_400;
    if rest.is_empty() {
        let guess = base + seconds as i64;
        return Some((base - local_offset(guess)) as f64 + seconds);
    }
    let sign = if rest.starts_with('-') { -1 } else { 1 };
    let (hours, minutes) = rest[1..].split_once(':').unwrap_or((&rest[1..], "00"));
    let offset = sign * (digits(hours, 2)? * 3600 + digits(minutes, 2)? * 60);
    Some((base - offset) as f64 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc() {
        assert_eq!(iso(0.0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_763_412_345.678), "2025-11-17T20:45:45.678Z");
        assert_eq!(utc_day(951_782_400.0), "2000-02-29");
        assert_eq!(days_from_civil(2000, 2, 29), 11_016);
    }

    #[test]
    fn parses_iso_like_python() {
        assert_eq!(parse_iso("2025-11-17T20:45:45Z"), Some(1_763_412_345.0));
        assert_eq!(parse_iso("2025-11-17T20:45:45.5+01:00"), Some(1_763_408_745.5));
        assert_eq!(parse_iso("2025-11-17"), parse_iso("2025-11-17T00:00:00"));
        assert_eq!(parse_iso("yesterday"), None);
    }
}
