//! Native wake-up timer for scheduled tasks.
//!
//! The frontend owns all recurrence maths and hands this module a single
//! absolute deadline. A dedicated thread parks on a condition variable until
//! that instant, then emits one event; the frontend decides what is due.
//!
//! A thread on `Condvar::wait_timeout` is used rather than an async timer for two
//! reasons. `tokio` is compiled here without the `time` feature, and a webview
//! `setInterval` is throttled or coalesced while the window is backgrounded, so
//! a task would fire late or not at all.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

pub const TASK_DUE_EVENT: &str = "terax:task-due";

/// Never sleep longer than this in one hop, so a suspended or clock-adjusted
/// machine re-evaluates the deadline instead of overshooting it.
const MAX_SLEEP: Duration = Duration::from_secs(60);

#[derive(Default)]
struct Shared {
    /// Absolute deadline in epoch milliseconds, or None when idle.
    deadline: Mutex<Option<u64>>,
    signal: Condvar,
}

pub struct SchedulerState {
    shared: Arc<Shared>,
    started: AtomicBool,
}

impl Default for SchedulerState {
    fn default() -> Self {
        Self {
            shared: Arc::new(Shared::default()),
            started: AtomicBool::new(false),
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// How long to park given a deadline and the current instant.
///
/// None means park until signalled: there is nothing scheduled. A zero duration
/// means the deadline already passed and the caller must fire now. Waits are
/// capped so a long sleep is re-checked rather than trusted.
pub fn wait_duration(deadline: Option<u64>, now: u64) -> Option<Duration> {
    let deadline = deadline?;
    if deadline <= now {
        return Some(Duration::ZERO);
    }
    let remaining = Duration::from_millis(deadline - now);
    Some(remaining.min(MAX_SLEEP))
}

fn run_loop(app: AppHandle, shared: Arc<Shared>) {
    loop {
        let mut guard = match shared.deadline.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let wait = wait_duration(*guard, now_ms());
        match wait {
            None => {
                // Nothing scheduled: park until armed. Zero cost while unused.
                guard = match shared.signal.wait(guard) {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                drop(guard);
            }
            Some(duration) if duration.is_zero() => {
                *guard = None;
                drop(guard);
                let _ = app.emit(TASK_DUE_EVENT, now_ms());
            }
            Some(duration) => {
                let (next, _timeout) = match shared.signal.wait_timeout(guard, duration) {
                    Ok(pair) => pair,
                    Err(_) => return,
                };
                drop(next);
            }
        }
    }
}

/// Arms or disarms the wake-up. Passing null disarms it entirely.
#[tauri::command]
pub fn scheduler_arm(
    app: AppHandle,
    state: tauri::State<SchedulerState>,
    at_ms: Option<u64>,
) -> Result<(), String> {
    {
        let mut guard = state
            .shared
            .deadline
            .lock()
            .map_err(|_| "Scheduler lock poisoned".to_string())?;
        *guard = at_ms;
    }
    state.shared.signal.notify_all();

    if !state.started.swap(true, Ordering::AcqRel) {
        let shared = Arc::clone(&state.shared);
        std::thread::Builder::new()
            .name("terax-task-scheduler".into())
            .spawn(move || run_loop(app, shared))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parks_indefinitely_when_nothing_is_scheduled() {
        assert!(wait_duration(None, 1_000).is_none());
    }

    #[test]
    fn fires_immediately_for_a_deadline_that_already_passed() {
        assert_eq!(wait_duration(Some(500), 1_000), Some(Duration::ZERO));
        assert_eq!(wait_duration(Some(1_000), 1_000), Some(Duration::ZERO));
    }

    #[test]
    fn waits_exactly_the_remaining_time_for_a_near_deadline() {
        assert_eq!(
            wait_duration(Some(1_500), 1_000),
            Some(Duration::from_millis(500))
        );
    }

    #[test]
    fn caps_a_long_wait_so_the_deadline_is_re_evaluated() {
        let far = 1_000 + 24 * 60 * 60 * 1_000;
        assert_eq!(wait_duration(Some(far), 1_000), Some(MAX_SLEEP));
    }

    #[test]
    fn a_deadline_one_hop_away_is_not_capped() {
        let deadline = 1_000 + MAX_SLEEP.as_millis() as u64;
        assert_eq!(wait_duration(Some(deadline), 1_000), Some(MAX_SLEEP));
    }

    #[test]
    fn now_ms_is_a_plausible_epoch_millisecond_value() {
        // Above 2020-01-01 and below 2100-01-01.
        let value = now_ms();
        assert!(value > 1_577_836_800_000);
        assert!(value < 4_102_444_800_000);
    }
}
