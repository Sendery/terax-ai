//! Bounded XTMODKEYS observer matching the existing Terax input policy.
//! Encoding still uses Ghostty; this only distinguishes its legacy Shift+Enter
//! default from a sequence the foreground program explicitly requested.

#[derive(Default)]
pub struct KeyboardModes {
    level: u32,
    carry: Vec<u8>,
}
enum Scan {
    Match {
        resource: u32,
        value: Option<u32>,
        next: usize,
    },
    Incomplete,
    None,
}
fn scan(data: &[u8], start: usize) -> Scan {
    let mut index = start + 1;
    for expected in *b"[>" {
        match data.get(index) {
            None => return Scan::Incomplete,
            Some(value) if *value == expected => index += 1,
            _ => return Scan::None,
        }
    }
    let mut resource = 0;
    let mut digits = 0;
    while let Some(value) = data.get(index).filter(|value| value.is_ascii_digit()) {
        resource = resource * 10 + u32::from(*value - b'0');
        digits += 1;
        index += 1;
        if digits > 6 {
            return Scan::None;
        }
    }
    if digits == 0 {
        return if index == data.len() {
            Scan::Incomplete
        } else {
            Scan::None
        };
    }
    let Some(next) = data.get(index) else {
        return Scan::Incomplete;
    };
    if *next == b'm' {
        return Scan::Match {
            resource,
            value: None,
            next: index + 1,
        };
    }
    if *next != b';' {
        return Scan::None;
    }
    index += 1;
    let mut value = 0;
    digits = 0;
    while let Some(byte) = data.get(index).filter(|byte| byte.is_ascii_digit()) {
        value = value * 10 + u32::from(*byte - b'0');
        digits += 1;
        index += 1;
        if digits > 6 {
            return Scan::None;
        }
    }
    if index == data.len() {
        return Scan::Incomplete;
    }
    if digits == 0 || data[index] != b'm' {
        return Scan::None;
    }
    Scan::Match {
        resource,
        value: Some(value),
        next: index + 1,
    }
}
impl KeyboardModes {
    pub fn modify_other_keys(&self) -> u32 {
        self.level
    }
    pub fn ingest(&mut self, bytes: &[u8]) {
        let joined = if self.carry.is_empty() {
            None
        } else {
            let mut merged = std::mem::take(&mut self.carry);
            merged.extend_from_slice(bytes);
            Some(merged)
        };
        let data = joined.as_deref().unwrap_or(bytes);
        let mut index = 0;
        while index < data.len() {
            if data[index] != 0x1b {
                index += 1;
                continue;
            }
            if data.get(index + 1) == Some(&b'c') {
                self.level = 0;
            }
            match scan(data, index) {
                Scan::Incomplete => {
                    if data.len() - index <= 24 {
                        self.carry.extend_from_slice(&data[index..]);
                    }
                    return;
                }
                Scan::Match {
                    resource,
                    value,
                    next,
                } => {
                    if resource == 4 {
                        self.level = value.unwrap_or(0);
                    }
                    index = next;
                }
                Scan::None => index += 1,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recognizes_chunked_requests_and_resets_without_retaining_large_input() {
        let mut modes = KeyboardModes::default();
        for byte in b"noise\x1b[>4;2m" {
            modes.ingest(&[*byte]);
        }
        assert_eq!(modes.modify_other_keys(), 2);
        modes.ingest(b"\x1b[>4;1m");
        assert_eq!(modes.modify_other_keys(), 1);
        modes.ingest(b"\x1b[>4m");
        assert_eq!(modes.modify_other_keys(), 0);
        modes.ingest(b"\x1b[>4;2m\x1bc");
        assert_eq!(modes.modify_other_keys(), 0);
        modes.ingest(&vec![b'x'; 100_000]);
        assert!(modes.carry.is_empty());
    }
    #[test]
    fn malformed_other_resources_and_excessive_digits_do_not_change_the_mode() {
        let mut modes = KeyboardModes::default();
        for value in [
            b"\x1b[>1;2m".as_slice(),
            b"\x1b[>4;m",
            b"\x1b[>4;1234567m",
            b"\x1b[>4;2x",
        ] {
            modes.ingest(value);
        }
        assert_eq!(modes.modify_other_keys(), 0);
        assert!(modes.carry.len() <= 24);
    }
}
