//! Rich native notifications for agent events.
//!
//! The notification plugin hands only a title and a body to the desktop
//! backend, so every agent notification read as one line. macOS notifications
//! also carry a subtitle and a content image, and a click can be routed back to
//! the pane it is about, which is what this module adds on top.
//!
//! Colour travels as that image: a badge whose ring is the tab's colour and
//! whose centre is the state's, rendered once per pair and cached. Native
//! notification text cannot be coloured, so the title also leads with emoji
//! marks for the tab and the state (built in the webview, see
//! `agents/lib/describeEvent.ts`), which survive the title's truncation.
//!
//! macOS hides a notification's banner while the sending app is frontmost
//! unless its delegate says otherwise. The backend's delegate does not, so the
//! one missing method is added to it at runtime rather than replacing it, which
//! would lose the delivery and click callbacks it relies on.

// Only macOS has the rich path; elsewhere the helpers exist for the tests.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Deserialize;

const MAX_TITLE_CHARS: usize = 120;
const MAX_SUBTITLE_CHARS: usize = 160;
const MAX_BODY_CHARS: usize = 400;
const BADGE_SIZE: u32 = 128;

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Tone {
    Permission,
    Question,
    Idle,
    Attention,
    TurnEnd,
    Subagent,
    Error,
    Exited,
}

impl Tone {
    fn slug(self) -> &'static str {
        match self {
            Tone::Permission => "permission",
            Tone::Question => "question",
            Tone::Idle => "idle",
            Tone::Attention => "attention",
            Tone::TurnEnd => "turn-end",
            Tone::Subagent => "subagent",
            Tone::Error => "error",
            Tone::Exited => "exited",
        }
    }

    fn rgb(self) -> [u8; 3] {
        match self {
            Tone::Permission => [0xF5, 0x9E, 0x0B],
            Tone::Question => [0x8B, 0x5C, 0xF6],
            Tone::Idle => [0x0E, 0xA5, 0xE9],
            Tone::Attention => [0xF9, 0x73, 0x16],
            Tone::TurnEnd => [0x10, 0xB9, 0x81],
            Tone::Subagent => [0x14, 0xB8, 0xA6],
            Tone::Error => [0xF4, 0x3F, 0x5E],
            Tone::Exited => [0x64, 0x74, 0x8B],
        }
    }

    /// Only an event that needs the user makes a sound; a turn ending or a
    /// subagent coming back is information, not an interruption.
    fn audible(self) -> bool {
        matches!(
            self,
            Tone::Permission | Tone::Question | Tone::Idle | Tone::Attention | Tone::Error
        )
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RichNotification {
    pub title: String,
    pub subtitle: Option<String>,
    pub body: Option<String>,
    /// The tab's colour as `#rrggbb`; a neutral ring stands in when absent.
    pub accent: Option<String>,
    pub tone: Tone,
    pub leaf_id: Option<u32>,
    pub tab_id: Option<u32>,
}

fn clip(text: &str, limit: usize) -> String {
    let text: String = text.chars().filter(|c| !c.is_control() || *c == '\n').collect();
    let text = text.trim();
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut out: String = text.chars().take(limit.saturating_sub(1)).collect();
    out.push('\u{2026}');
    out
}

fn parse_hex(color: &str) -> Option<[u8; 3]> {
    let hex = color.strip_prefix('#')?;
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

/// Draws the badge: the tab's colour as an outer disc, a light separator, and
/// the state's colour at the centre, antialiased on a transparent square.
pub fn render_badge(accent: [u8; 3], tone: [u8; 3], size: u32) -> Vec<u8> {
    const SEPARATOR: [u8; 3] = [0xFA, 0xFA, 0xFA];
    let centre = size as f32 / 2.0;
    let outer = size as f32 * 0.47;
    let separator = size as f32 * 0.31;
    let inner = size as f32 * 0.26;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 + 0.5 - centre;
            let dy = y as f32 + 0.5 - centre;
            let distance = (dx * dx + dy * dy).sqrt();
            let coverage = |radius: f32| (radius - distance + 0.5).clamp(0.0, 1.0);
            let outer_cov = coverage(outer);
            if outer_cov <= 0.0 {
                continue;
            }
            let inner_cov = coverage(inner);
            let separator_cov = coverage(separator) - inner_cov;
            let accent_cov = 1.0 - separator_cov - inner_cov;
            let mut pixel = [0f32; 3];
            for (channel, value) in pixel.iter_mut().enumerate() {
                *value = accent[channel] as f32 * accent_cov
                    + SEPARATOR[channel] as f32 * separator_cov
                    + tone[channel] as f32 * inner_cov;
            }
            let at = ((y * size + x) * 4) as usize;
            rgba[at] = pixel[0].round() as u8;
            rgba[at + 1] = pixel[1].round() as u8;
            rgba[at + 2] = pixel[2].round() as u8;
            rgba[at + 3] = (outer_cov * 255.0).round() as u8;
        }
    }
    rgba
}

fn encode_png(rgba: &[u8], size: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, size, size);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// The cached badge for an accent and tone, written once and reused.
fn badge_path(accent: Option<[u8; 3]>, tone: Tone) -> Result<std::path::PathBuf, String> {
    const NEUTRAL: [u8; 3] = [0x52, 0x52, 0x5B];
    let accent = accent.unwrap_or(NEUTRAL);
    let dir = dirs::cache_dir()
        .ok_or("no cache dir")?
        .join("terax-ai")
        .join("notify-badges");
    let name = format!(
        "{:02x}{:02x}{:02x}-{}.png",
        accent[0],
        accent[1],
        accent[2],
        tone.slug()
    );
    let path = dir.join(name);
    if path.exists() {
        return Ok(path);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let png = encode_png(&render_badge(accent, tone.rgb(), BADGE_SIZE), BADGE_SIZE)?;
    // Written beside the target and renamed, so a notification never reads a
    // half-written image.
    let tmp = path.with_extension(format!("png.{}.tmp", std::process::id()));
    std::fs::write(&tmp, png).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(path)
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Once;

    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use tauri::{Emitter, Manager};

    use super::{badge_path, clip, parse_hex, RichNotification, MAX_BODY_CHARS, MAX_SUBTITLE_CHARS, MAX_TITLE_CHARS};

    /// A click is only reported to a sender that is waiting, and a banner the
    /// user never touches keeps its waiter until it leaves Notification
    /// Center. Beyond this many, notifications are sent without click routing
    /// so waiting threads stay bounded.
    const MAX_WAITERS: usize = 8;
    static WAITERS: AtomicUsize = AtomicUsize::new(0);
    static SETUP: Once = Once::new();

    extern "C-unwind" fn present_while_frontmost(
        _this: *mut AnyObject,
        _cmd: Sel,
        _center: *mut AnyObject,
        _notification: *mut AnyObject,
    ) -> Bool {
        Bool::YES
    }

    pub(super) fn present_in_foreground() {
        let Some(class) = AnyClass::get(c"NotificationCenterDelegate") else {
            return;
        };
        let sel = Sel::register(c"userNotificationCenter:shouldPresentNotification:");
        #[cfg(target_arch = "aarch64")]
        let types = c"B@:@@";
        #[cfg(not(target_arch = "aarch64"))]
        let types = c"c@:@@";
        // SAFETY: the IMP matches the selector's signature (receiver, selector,
        // two object arguments, BOOL return). `class_addMethod` leaves the
        // class untouched when the method already exists.
        unsafe {
            let imp: Imp = std::mem::transmute(
                present_while_frontmost
                    as extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject) -> Bool,
            );
            objc2::ffi::class_addMethod(class as *const AnyClass as *mut AnyClass, sel, imp, types.as_ptr());
        }
    }

    pub fn show(app: &tauri::AppHandle, notification: RichNotification) -> Result<(), String> {
        SETUP.call_once(|| {
            let identifier = app.config().identifier.clone();
            // An unbundled dev binary has no identity of its own to post as.
            let _ = mac_notification_sys::set_application(if tauri::is_dev() {
                "com.apple.Terminal"
            } else {
                &identifier
            });
            present_in_foreground();
        });

        let title = clip(&notification.title, MAX_TITLE_CHARS);
        let subtitle = notification
            .subtitle
            .as_deref()
            .map(|s| clip(s, MAX_SUBTITLE_CHARS))
            .filter(|s| !s.is_empty());
        let body = clip(notification.body.as_deref().unwrap_or(""), MAX_BODY_CHARS);
        let accent = notification.accent.as_deref().and_then(parse_hex);
        let image = badge_path(accent, notification.tone).ok();
        let tone = notification.tone;
        let target = (notification.leaf_id, notification.tab_id);
        let wait = WAITERS.fetch_add(1, Ordering::SeqCst) < MAX_WAITERS;
        if !wait {
            WAITERS.fetch_sub(1, Ordering::SeqCst);
        }
        let app = app.clone();

        std::thread::Builder::new()
            .name("terax-notify".into())
            .spawn(move || {
                let image = image.as_ref().and_then(|p| p.to_str());
                let mut n = mac_notification_sys::Notification::default();
                n.title(&title).message(&body).maybe_subtitle(subtitle.as_deref());
                if let Some(image) = image {
                    n.content_image(image);
                }
                if tone.audible() {
                    n.sound(mac_notification_sys::Sound::Default);
                }
                if wait {
                    n.wait_for_click(true);
                } else {
                    n.asynchronous(true);
                }
                let response = n.send();
                if wait {
                    WAITERS.fetch_sub(1, Ordering::SeqCst);
                }
                if matches!(response, Ok(mac_notification_sys::NotificationResponse::Click)) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    let _ = app.emit(
                        "terax:notification-activated",
                        serde_json::json!({ "leafId": target.0, "tabId": target.1 }),
                    );
                }
            })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// Posts a rich notification. Returns false where the rich path does not exist,
/// so the webview falls back to the plain plugin notification.
#[tauri::command]
pub fn agent_notify(app: tauri::AppHandle, notification: RichNotification) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        mac::show(&app, notification)?;
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, notification);
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(rgba: &[u8], size: u32, x: u32, y: u32) -> [u8; 4] {
        let at = ((y * size + x) * 4) as usize;
        [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]]
    }

    #[test]
    fn the_badge_rings_the_state_with_the_tab_colour() {
        let size = 64;
        let rgba = render_badge([0xFF, 0x00, 0x00], [0x00, 0x00, 0xFF], size);
        // Centre carries the state, the ring carries the tab, corners are clear.
        assert_eq!(pixel(&rgba, size, 32, 32), [0x00, 0x00, 0xFF, 0xFF]);
        assert_eq!(pixel(&rgba, size, 32, 4), [0xFF, 0x00, 0x00, 0xFF]);
        assert_eq!(pixel(&rgba, size, 0, 0)[3], 0);
    }

    #[test]
    fn the_badge_edge_is_antialiased() {
        let size = 64;
        let rgba = render_badge([0xFF, 0x00, 0x00], [0x00, 0x00, 0xFF], size);
        let alphas: Vec<u8> = (0..size / 2).map(|x| pixel(&rgba, size, x, size / 2)[3]).collect();
        assert!(alphas.iter().any(|a| *a > 0 && *a < 255));
    }

    #[test]
    fn encodes_a_valid_png() {
        let png = encode_png(&render_badge([1, 2, 3], [4, 5, 6], 16), 16).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn accepts_only_six_digit_hex_colours() {
        assert_eq!(parse_hex("#10b981"), Some([0x10, 0xB9, 0x81]));
        assert_eq!(parse_hex("10b981"), None);
        assert_eq!(parse_hex("#fff"), None);
        assert_eq!(parse_hex("#zzzzzz"), None);
        assert_eq!(parse_hex("#10b981; rm -rf /"), None);
    }

    #[test]
    fn bounds_and_strips_the_text() {
        assert_eq!(clip("a\u{7}b", 10), "ab");
        assert_eq!(clip("  line one\nline two  ", 50), "line one\nline two");
        assert_eq!(clip("abcdef", 4), "abc\u{2026}");
    }

    #[test]
    fn only_events_that_need_the_user_are_audible() {
        assert!(Tone::Question.audible());
        assert!(Tone::Permission.audible());
        assert!(!Tone::TurnEnd.audible());
        assert!(!Tone::Subagent.audible());
    }

    #[test]
    fn deserializes_the_webview_payload() {
        let n: RichNotification = serde_json::from_value(serde_json::json!({
            "title": "HACKATHON-MERGE needs permission",
            "subtitle": "slot-5 \u{b7} Claude Code",
            "body": "Bash: pnpm test",
            "accent": "#f97316",
            "tone": "permission",
            "leafId": 7,
            "tabId": 3
        }))
        .unwrap();
        assert_eq!(n.tone, Tone::Permission);
        assert_eq!(n.leaf_id, Some(7));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod mac_tests {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};

    #[test]
    fn the_backend_delegate_learns_to_present_while_frontmost() {
        // Referencing the backend keeps its Objective-C class linked into the
        // test binary.
        let _ = mac_notification_sys::Notification::default();
        super::mac::present_in_foreground();
        // Idempotent: a second call leaves the method as it is.
        super::mac::present_in_foreground();

        let class = AnyClass::get(c"NotificationCenterDelegate").expect("backend delegate class");
        let sel = Sel::register(c"userNotificationCenter:shouldPresentNotification:");
        assert!(class.instance_method(sel).is_some());

        // Calling it through the runtime checks the signature and the BOOL ABI,
        // not just that a method with that name exists.
        let instance: *mut AnyObject = unsafe { msg_send![class, new] };
        assert!(!instance.is_null());
        let present: Bool = unsafe {
            msg_send![
                instance,
                userNotificationCenter: std::ptr::null_mut::<AnyObject>(),
                shouldPresentNotification: std::ptr::null_mut::<AnyObject>()
            ]
        };
        assert!(present.as_bool());
        let _: () = unsafe { msg_send![instance, release] };
    }
}
