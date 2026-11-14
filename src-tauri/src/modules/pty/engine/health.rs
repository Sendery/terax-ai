use std::sync::{Mutex, PoisonError};

pub const ENGINE_FAILED_EXIT: i32 = -2;

pub fn final_exit_code(child: i32, reader_drained: bool, engine_healthy: bool) -> i32 {
    if reader_drained && engine_healthy {
        child
    } else {
        ENGINE_FAILED_EXIT
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineFailure {
    FrameChannelClosed,
    SnapshotFailed,
    Panicked,
}

type Listener = Box<dyn FnOnce(EngineFailure) + Send>;

#[derive(Default)]
struct State {
    failure: Option<EngineFailure>,
    listeners: Vec<Listener>,
}

#[derive(Default)]
pub struct EngineHealth(Mutex<State>);

impl EngineHealth {
    pub fn failure(&self) -> Option<EngineFailure> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .failure
    }

    pub fn subscribe(&self, listener: Listener) {
        let ready = {
            let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
            match state.failure {
                Some(failure) => Some((listener, failure)),
                None => {
                    state.listeners.push(listener);
                    None
                }
            }
        };
        if let Some((listener, failure)) = ready {
            Self::notify(listener, failure);
        }
    }

    pub fn fail(&self, failure: EngineFailure) {
        let listeners = {
            let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
            if state.failure.is_some() {
                return;
            }
            state.failure = Some(failure);
            std::mem::take(&mut state.listeners)
        };
        for listener in listeners {
            Self::notify(listener, failure);
        }
    }

    fn notify(listener: Listener, failure: EngineFailure) {
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| listener(failure))).is_err() {
            log::error!("terminal engine failure observer panicked");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn first_failure_is_sticky_and_late_subscribers_are_not_missed() {
        let health = EngineHealth::default();
        health.fail(EngineFailure::FrameChannelClosed);
        health.fail(EngineFailure::Panicked);
        let got = Arc::new(Mutex::new(Vec::new()));
        let output = got.clone();
        health.subscribe(Box::new(move |failure| {
            output.lock().unwrap().push(failure)
        }));
        assert_eq!(
            *got.lock().unwrap(),
            vec![EngineFailure::FrameChannelClosed]
        );
        assert_eq!(health.failure(), Some(EngineFailure::FrameChannelClosed));
    }

    #[test]
    fn failure_and_subscription_races_deliver_exactly_once() {
        for _ in 0..50 {
            let health = Arc::new(EngineHealth::default());
            let barrier = Arc::new(Barrier::new(2));
            let count = Arc::new(Mutex::new(0));
            let other_health = health.clone();
            let other_barrier = barrier.clone();
            let other_count = count.clone();
            let subscriber = thread::spawn(move || {
                other_barrier.wait();
                other_health.subscribe(Box::new(move |_| *other_count.lock().unwrap() += 1));
            });
            barrier.wait();
            health.fail(EngineFailure::Panicked);
            subscriber.join().unwrap();
            assert_eq!(*count.lock().unwrap(), 1);
        }
    }

    #[test]
    fn callbacks_are_outside_the_lock_and_one_panic_cannot_skip_the_others() {
        let health = Arc::new(EngineHealth::default());
        health.subscribe(Box::new(|_| panic!("injected observer failure")));
        let inner = health.clone();
        let got = Arc::new(Mutex::new(Vec::new()));
        let output = got.clone();
        health.subscribe(Box::new(move |failure| {
            assert_eq!(inner.failure(), Some(failure));
            inner.subscribe(Box::new(move |late| output.lock().unwrap().push(late)));
        }));
        health.fail(EngineFailure::SnapshotFailed);
        assert_eq!(*got.lock().unwrap(), vec![EngineFailure::SnapshotFailed]);
    }

    #[test]
    fn success_requires_confirmed_reader_drain_and_a_healthy_engine() {
        assert_eq!(final_exit_code(0, true, true), 0);
        assert_eq!(final_exit_code(3, true, true), 3);
        assert_eq!(final_exit_code(0, false, true), ENGINE_FAILED_EXIT);
        assert_eq!(final_exit_code(3, false, true), ENGINE_FAILED_EXIT);
        assert_eq!(final_exit_code(0, true, false), ENGINE_FAILED_EXIT);
    }
}
