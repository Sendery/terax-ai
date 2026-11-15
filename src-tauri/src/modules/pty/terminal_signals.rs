use super::agent_detect::Transition;
use std::collections::VecDeque;

const MAX_PENDING: usize = 8;
const MAX_TEXT: usize = 160;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub state: u8,
    pub percent: Option<u8>,
}

#[derive(Default)]
struct Notification {
    id: String,
    title: String,
    body: String,
}

#[derive(Default)]
pub struct TerminalSignals {
    pending: VecDeque<Notification>,
    progress: Option<Progress>,
}

fn append(target: &mut String, text: &str) {
    let left = MAX_TEXT.saturating_sub(target.chars().count());
    target.extend(text.chars().filter(|c| !c.is_control()).take(left));
}

fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let bytes = text.as_bytes();
    if bytes.len() > 4096 || !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut output = Vec::with_capacity(bytes.len() / 4 * 3);
    for (index, chunk) in bytes.chunks_exact(4).enumerate() {
        let mut value = 0u32;
        let mut padding = 0;
        for (at, byte) in chunk.iter().enumerate() {
            let digit = match byte {
                b'A'..=b'Z' if padding == 0 => byte - b'A',
                b'a'..=b'z' if padding == 0 => byte - b'a' + 26,
                b'0'..=b'9' if padding == 0 => byte - b'0' + 52,
                b'+' if padding == 0 => 62,
                b'/' if padding == 0 => 63,
                b'=' if at >= 2 && index + 1 == bytes.len() / 4 => {
                    padding += 1;
                    0
                }
                _ => return None,
            };
            value = value << 6 | u32::from(digit);
        }
        output.push((value >> 16) as u8);
        if padding < 2 {
            output.push((value >> 8) as u8);
        }
        if padding == 0 {
            output.push(value as u8);
        }
    }
    Some(output)
}

impl TerminalSignals {
    pub fn reset(&mut self) -> Option<Transition> {
        self.pending.clear();
        self.progress.take().map(|_| Transition::Progress {
            progress: Progress {
                state: 0,
                percent: None,
            },
        })
    }

    pub fn process(&mut self, code: &[u8], payload: &[u8]) -> Option<Transition> {
        match code {
            b"9" if payload.starts_with(b"4;") => {
                let mut parts = std::str::from_utf8(payload).ok()?.split(';');
                parts.next()?;
                let state = parts.next()?.parse::<u8>().ok()?;
                if state > 4 {
                    return None;
                }
                let value = parts.next();
                if parts.next().is_some() {
                    return None;
                }
                let percent = match value {
                    None | Some("") => None,
                    Some(value) => Some(value.parse::<u8>().ok()?.min(100)),
                };
                let progress = Progress {
                    state,
                    percent: if matches!(state, 0 | 3) {
                        None
                    } else {
                        percent
                    },
                };
                if self.progress == Some(progress) {
                    return None;
                }
                self.progress = if state == 0 { None } else { Some(progress) };
                Some(Transition::Progress { progress })
            }
            b"9" if payload != b"4" => {
                let text = std::str::from_utf8(payload).ok()?;
                let mut title = String::new();
                append(&mut title, text);
                if title.trim().is_empty() {
                    return None;
                }
                Some(Transition::Notification {
                    title,
                    body: String::new(),
                })
            }
            b"99" => self.notification(payload),
            _ => None,
        }
    }

    fn notification(&mut self, payload: &[u8]) -> Option<Transition> {
        let (metadata, text) = std::str::from_utf8(payload).ok()?.split_once(';')?;
        if metadata.len() > 1024 || text.len() > 4096 {
            return None;
        }
        let mut id = "";
        let mut part = "title";
        let mut done = true;
        let mut encoded = false;
        for pair in metadata.split(':').filter(|pair| !pair.is_empty()) {
            let (key, value) = pair.split_once('=')?;
            match key {
                "i" => {
                    if value.len() > 128
                        || !value
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"_-+.".contains(&b))
                    {
                        return None;
                    }
                    id = value;
                }
                "p" => part = value,
                "d" => {
                    done = match value {
                        "0" => false,
                        "1" => true,
                        _ => return None,
                    }
                }
                "e" => {
                    encoded = match value {
                        "0" => false,
                        "1" => true,
                        _ => return None,
                    }
                }
                _ => {}
            }
        }
        if part == "close" {
            self.pending.retain(|item| item.id != id);
            return None;
        }
        if !matches!(part, "title" | "body") {
            return None;
        }
        let decoded;
        let text = if encoded {
            decoded = decode_base64(text)?;
            std::str::from_utf8(&decoded).ok()?
        } else {
            text
        };
        let mut notification = self
            .pending
            .iter()
            .position(|item| item.id == id)
            .and_then(|at| self.pending.remove(at))
            .unwrap_or_else(|| Notification {
                id: id.into(),
                ..Notification::default()
            });
        append(
            if part == "title" {
                &mut notification.title
            } else {
                &mut notification.body
            },
            text,
        );
        if !done {
            if self.pending.len() == MAX_PENDING {
                self.pending.pop_front();
            }
            self.pending.push_back(notification);
            return None;
        }
        if notification.title.trim().is_empty() {
            notification.title = std::mem::take(&mut notification.body);
        }
        if notification.title.trim().is_empty() {
            return None;
        }
        Some(Transition::Notification {
            title: notification.title,
            body: notification.body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chunks_are_separated_by_id_and_queries_cannot_become_notifications() {
        let mut signals = TerminalSignals::default();
        assert!(signals.process(b"99", b"i=a:d=0;Build ").is_none());
        assert!(signals.process(b"99", b"i=b:d=0;Other").is_none());
        assert!(signals.process(b"99", b"i=a:p=?;").is_none());
        assert_eq!(
            signals.process(b"99", b"i=a:p=body:e=1;ZG9uZQ=="),
            Some(Transition::Notification {
                title: "Build ".into(),
                body: "done".into()
            })
        );
        assert!(signals.process(b"99", b"p=icon;not text").is_none());
        assert!(signals.process(b"99", b"e=1;////").is_none());
        assert!(signals.process(b"99", b"i=b:p=close;").is_none());
        assert!(signals.pending.is_empty());
    }
    #[test]
    fn progress_never_arms_an_agent_and_duplicates_are_coalesced() {
        let mut signals = TerminalSignals::default();
        let progress = Progress {
            state: 1,
            percent: Some(40),
        };
        assert_eq!(
            signals.process(b"9", b"4;1;40"),
            Some(Transition::Progress { progress })
        );
        assert!(signals.process(b"9", b"4;1;40").is_none());
        assert!(signals.process(b"9", b"4;9;40").is_none());
        assert!(signals.process(b"9", b"4;1;no").is_none());
        assert_eq!(
            signals.reset(),
            Some(Transition::Progress {
                progress: Progress {
                    state: 0,
                    percent: None
                }
            })
        );
        assert!(signals.reset().is_none());
    }
    #[test]
    fn notification_storage_is_bounded_and_terminal_controls_are_not_forwarded() {
        let mut signals = TerminalSignals::default();
        for n in 0..100 {
            signals.process(b"99", format!("i={n}:d=0;{}", "x".repeat(4096)).as_bytes());
        }
        assert_eq!(signals.pending.len(), MAX_PENDING);
        assert!(signals
            .pending
            .iter()
            .all(|entry| entry.title.len() == MAX_TEXT));
        assert_eq!(
            signals.process(b"9", b"hi\n\x1bworld"),
            Some(Transition::Notification {
                title: "hiworld".into(),
                body: String::new()
            })
        );
    }
}
