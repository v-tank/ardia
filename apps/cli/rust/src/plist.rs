pub fn top_level_string(raw: &[u8], key: &str) -> Option<String> {
    if raw.starts_with(b"bplist00") {
        binary_string(raw, key)
    } else {
        xml_string(std::str::from_utf8(raw).ok()?, key)
    }
}

fn be(bytes: &[u8]) -> Option<u64> {
    if bytes.len() > 8 {
        return None;
    }
    Some(bytes.iter().fold(0u64, |value, byte| (value << 8) | u64::from(*byte)))
}

struct Binary<'a> {
    raw: &'a [u8],
    offsets: Vec<usize>,
    ref_size: usize,
}

impl Binary<'_> {
    fn object(&self, index: usize) -> Option<(u8, usize, usize)> {
        let start = *self.offsets.get(index)?;
        let marker = *self.raw.get(start)?;
        let kind = marker >> 4;
        let mut count = usize::from(marker & 0x0f);
        let mut body = start + 1;
        if count == 0x0f && matches!(kind, 0x5 | 0x6 | 0xa | 0xd) {
            let size_marker = *self.raw.get(body)?;
            if size_marker >> 4 != 0x1 {
                return None;
            }
            let width = 1usize << (size_marker & 0x0f);
            count = usize::try_from(be(self.raw.get(body + 1..body + 1 + width)?)?).ok()?;
            body += 1 + width;
        }
        Some((kind, count, body))
    }

    fn reference(&self, at: usize) -> Option<usize> {
        usize::try_from(be(self.raw.get(at..at + self.ref_size)?)?).ok()
    }

    fn string(&self, index: usize) -> Option<String> {
        let (kind, count, body) = self.object(index)?;
        match kind {
            0x5 => Some(self.raw.get(body..body + count)?.iter().map(|byte| char::from(*byte)).collect()),
            0x6 => {
                let units: Vec<u16> = self
                    .raw
                    .get(body..body + count * 2)?
                    .chunks(2)
                    .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                    .collect();
                Some(String::from_utf16_lossy(&units))
            }
            _ => None,
        }
    }
}

fn binary_string(raw: &[u8], key: &str) -> Option<String> {
    if raw.len() < 40 {
        return None;
    }
    let trailer = &raw[raw.len() - 32..];
    let offset_size = usize::from(trailer[6]);
    let ref_size = usize::from(trailer[7]);
    let count = usize::try_from(be(&trailer[8..16])?).ok()?;
    let top = usize::try_from(be(&trailer[16..24])?).ok()?;
    let table = usize::try_from(be(&trailer[24..32])?).ok()?;
    if offset_size == 0 || ref_size == 0 || count > raw.len() {
        return None;
    }
    let mut offsets = Vec::with_capacity(count);
    for index in 0..count {
        let at = table + index * offset_size;
        offsets.push(usize::try_from(be(raw.get(at..at + offset_size)?)?).ok()?);
    }
    let plist = Binary { raw, offsets, ref_size };
    let (kind, entries, body) = plist.object(top)?;
    if kind != 0xd {
        return None;
    }
    for entry in 0..entries {
        let key_ref = plist.reference(body + entry * ref_size)?;
        if plist.string(key_ref).as_deref() == Some(key) {
            let value_ref = plist.reference(body + (entries + entry) * ref_size)?;
            return plist.string(value_ref);
        }
    }
    None
}

fn unescape(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let Some(semi) = rest.find(';') else { break };
        let entity = &rest[1..semi];
        let decoded = match entity {
            "lt" => Some('<'),
            "gt" => Some('>'),
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|dec| dec.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(ch) => {
                out.push(ch);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn xml_string(text: &str, key: &str) -> Option<String> {
    let mut depth = 0i32;
    let mut at = 0;
    let mut pending_key: Option<String> = None;
    while let Some(open) = text[at..].find('<') {
        let start = at + open;
        if text[start..].starts_with("<!--") {
            at = start + text[start..].find("-->")? + 3;
            continue;
        }
        let close = start + text[start..].find('>')?;
        let tag = &text[start + 1..close];
        at = close + 1;
        if tag.starts_with('?') || tag.starts_with('!') {
            continue;
        }
        let name = tag.trim_end_matches('/').split_whitespace().next().unwrap_or("");
        let empty = tag.ends_with('/');
        match name {
            "dict" | "array" if !empty => {
                depth += 1;
                if depth > 1 {
                    pending_key = None;
                }
            }
            "/dict" | "/array" => depth -= 1,
            "key" if depth == 1 && !empty => {
                let end = at + text[at..].find("</key>")?;
                pending_key = Some(unescape(&text[at..end]));
                at = end + 6;
            }
            "string" if depth == 1 => {
                let value = if empty {
                    String::new()
                } else {
                    let end = at + text[at..].find("</string>")?;
                    let value = unescape(&text[at..end]);
                    at = end + 9;
                    value
                };
                if pending_key.take().as_deref() == Some(key) {
                    return Some(value);
                }
            }
            "plist" | "/plist" => {}
            _ if depth == 1 && !name.starts_with('/') => pending_key = None,
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_xml_plists() {
        let text = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleURLTypes</key><array><dict><key>CFBundleName</key><string>Inner</string></dict></array>
  <key>CFBundleDisplayName</key><string/>
  <key>LSMinimumSystemVersion</key><string>13</string>
  <key>CFBundleName</key><string>Tom &amp; Jerry&#x2122;</string>
</dict></plist>"#;
        assert_eq!(top_level_string(text.as_bytes(), "CFBundleName").as_deref(), Some("Tom & Jerry™"));
        assert_eq!(top_level_string(text.as_bytes(), "CFBundleDisplayName").as_deref(), Some(""));
        assert_eq!(top_level_string(text.as_bytes(), "Missing"), None);
    }

    #[test]
    fn reads_binary_plists() {
        let mut raw = b"bplist00".to_vec();
        let mut offsets = Vec::new();
        offsets.push(raw.len());
        raw.extend_from_slice(&[0xd2, 1, 2, 3, 4]);
        offsets.push(raw.len());
        raw.push(0x5b);
        raw.extend_from_slice(b"CFBundleKey");
        offsets.push(raw.len());
        raw.push(0x5c);
        raw.extend_from_slice(b"CFBundleName");
        offsets.push(raw.len());
        raw.push(0x53);
        raw.extend_from_slice(b"one");
        offsets.push(raw.len());
        raw.push(0x62);
        raw.extend_from_slice(&[0x00, 0x54, 0x00, 0xe9]);
        let table = raw.len();
        for offset in &offsets {
            raw.push(*offset as u8);
        }
        raw.extend_from_slice(&[0, 0, 0, 0, 0, 0, 1, 1]);
        raw.extend_from_slice(&(offsets.len() as u64).to_be_bytes());
        raw.extend_from_slice(&0u64.to_be_bytes());
        raw.extend_from_slice(&(table as u64).to_be_bytes());
        assert_eq!(top_level_string(&raw, "CFBundleName").as_deref(), Some("Té"));
        assert_eq!(top_level_string(&raw, "CFBundleKey").as_deref(), Some("one"));
    }
}
