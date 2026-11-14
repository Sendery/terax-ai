use super::engine::{Engine, EngineFailure, EngineHandle, EngineInput, EngineThread};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

#[derive(Default)]
struct State {
    closed: bool,
    failed: bool,
    process_finished: bool,
    failure_reported: bool,
    input_pending: Arc<AtomicUsize>,
    owner: Option<CoreOwner>,
}

#[derive(Default)]
pub struct CoreSlot(Mutex<State>);

pub struct ProcessCore {
    pub handle: EngineHandle,
    pub input: EngineInput,
}

pub struct CoreOwner {
    handle: EngineHandle,
    input: EngineInput,
    thread: Option<EngineThread>,
}

pub struct InputLease {
    input: EngineInput,
    pending: Arc<AtomicUsize>,
}

impl InputLease {
    /// Producer worker only. The receipt timeout starts after ordered enqueue.
    pub fn encode(self, event: super::engine::input::InputEvent) -> Result<Vec<u8>, String> {
        self.input
            .encode_input(event)?
            .recv_timeout(std::time::Duration::from_secs(2))
            .map_err(|error| format!("terminal input encoding failed: {error}"))?
    }
}

impl Drop for InputLease {
    fn drop(&mut self) {
        self.pending.fetch_sub(1, Ordering::AcqRel);
    }
}

pub struct FailureAction {
    pub notify: bool,
    pub retire: bool,
}

impl CoreSlot {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn install(&self, engine: Engine) -> Result<ProcessCore, String> {
        let owner = CoreOwner {
            handle: engine.handle,
            input: engine.input,
            thread: Some(engine.thread),
        };
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.closed || state.failed || state.owner.is_some() {
            drop(state);
            drop(owner);
            return Err("terminal core cannot be initialized".into());
        }
        let process = ProcessCore {
            handle: owner.handle.clone(),
            input: owner.input.clone(),
        };
        state.owner = Some(owner);
        Ok(process)
    }

    pub fn handle(&self) -> Result<EngineHandle, String> {
        let state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.closed || state.failed {
            return Err("terminal core is unavailable".into());
        }
        let owner = state.owner.as_ref().ok_or("terminal core is opening")?;
        if owner.handle.failure().is_some() {
            return Err("terminal core failed".into());
        }
        Ok(owner.handle.clone())
    }

    pub fn reserve_input(&self) -> Result<InputLease, String> {
        let state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.closed || state.failed || state.process_finished {
            return Err("terminal input is unavailable".into());
        }
        let owner = state.owner.as_ref().ok_or("terminal core is opening")?;
        if owner.handle.failure().is_some() {
            return Err("terminal core failed".into());
        }
        if state.input_pending.load(Ordering::Acquire) >= 32 {
            return Err("too many pending terminal input requests".into());
        }
        state.input_pending.fetch_add(1, Ordering::AcqRel);
        Ok(InputLease {
            input: owner.input.clone(),
            pending: state.input_pending.clone(),
        })
    }

    pub fn publish(&self, operation: impl FnOnce()) -> bool {
        let state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.closed
            || state.failed
            || state
                .owner
                .as_ref()
                .is_none_or(|owner| owner.handle.failure().is_some())
        {
            return false;
        }
        operation();
        true
    }

    pub fn close(&self) -> Option<CoreOwner> {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        state.closed = true;
        state.owner.take()
    }

    pub fn record_failure(&self) -> FailureAction {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        let notify = !state.closed && !state.failure_reported;
        state.failed = true;
        state.failure_reported = true;
        FailureAction {
            notify,
            retire: state.process_finished || state.closed,
        }
    }

    pub fn finish_process(&self, healthy: bool) -> FailureAction {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        state.process_finished = true;
        let notify = !healthy && !state.closed && !state.failure_reported;
        if !healthy {
            state.failed = true;
            state.failure_reported = true;
        }
        FailureAction {
            notify,
            retire: state.closed || state.failed,
        }
    }
}

impl ProcessCore {
    pub fn finish(&self) -> Result<(), String> {
        self.input
            .finish()?
            .recv()
            .map_err(|_| "terminal core closed during input finalization")?
            .map_err(|failure| format!("terminal core failed: {failure:?}"))
    }
}

impl CoreOwner {
    pub fn join(mut self) -> Result<(), EngineFailure> {
        self.handle.request_stop();
        self.thread.take().map_or(Ok(()), EngineThread::join)
    }
}

impl Drop for CoreOwner {
    fn drop(&mut self) {
        self.handle.request_stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    const WAIT: Duration = Duration::from_secs(5);

    fn engine() -> Engine {
        super::super::engine::start(16, 2, Box::new(|_| true), Box::new(|_| {})).unwrap()
    }

    fn assert_stopped(handle: &EngineHandle) {
        if let Ok(reply) = handle.read_text(2) {
            match reply.recv_timeout(WAIT) {
                Ok(result) => assert!(result.is_err()),
                Err(mpsc::RecvTimeoutError::Disconnected) => {}
                Err(error) => panic!("actor did not stop: {error}"),
            }
        }
    }

    #[test]
    fn finished_process_keeps_a_readable_core_until_the_slot_is_closed() {
        let slot = CoreSlot::new();
        let process = slot.install(engine()).unwrap();
        assert!(process.input.feed(b"one\r\ntwo\r\nthree".to_vec()));
        process.finish().unwrap();
        slot.finish_process(true);
        let handle = slot.handle().unwrap();
        assert_eq!(
            handle
                .read_text(2)
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap(),
            "two\nthree"
        );
        let owner = slot.close().unwrap();
        assert!(slot.handle().is_err());
        assert!(slot.close().is_none());
        owner.join().unwrap();
        assert_stopped(&handle);
    }

    #[test]
    fn close_before_install_prevents_late_actor_publication_and_stops_it() {
        let slot = CoreSlot::new();
        assert!(slot.close().is_none());
        let actor = engine();
        let handle = actor.handle.clone();
        assert!(slot.install(actor).is_err());
        let mut published = false;
        assert!(!slot.publish(|| published = true));
        assert!(!published);
        assert_stopped(&handle);
    }

    #[test]
    fn duplicate_install_keeps_the_original_and_retires_the_rejected_actor() {
        let slot = CoreSlot::new();
        let process = slot.install(engine()).unwrap();
        let duplicate = engine();
        let rejected = duplicate.handle.clone();
        assert!(slot.install(duplicate).is_err());
        assert_eq!(
            slot.handle()
                .unwrap()
                .read_text(2)
                .unwrap()
                .recv_timeout(WAIT)
                .unwrap()
                .unwrap(),
            ""
        );
        assert_stopped(&rejected);
        slot.close().unwrap().join().unwrap();
        assert_stopped(&process.handle);
    }

    #[test]
    fn failure_invalidates_queries_but_defers_retirement_until_process_drain() {
        let slot = CoreSlot::new();
        let process = slot.install(engine()).unwrap();
        let first = slot.record_failure();
        assert!(first.notify);
        assert!(!first.retire);
        assert!(slot.handle().is_err());
        assert!(!slot.record_failure().notify);
        let finished = slot.finish_process(false);
        assert!(finished.retire);
        assert!(!finished.notify);
        slot.close().unwrap().join().unwrap();
        assert_stopped(&process.handle);
    }

    #[test]
    fn post_process_failure_is_reported_independently_and_requests_retirement() {
        let slot = CoreSlot::new();
        let process = slot.install(engine()).unwrap();
        process.finish().unwrap();
        assert!(!slot.finish_process(true).retire);
        let failed = slot.record_failure();
        assert!(failed.notify);
        assert!(failed.retire);
        assert!(!slot.record_failure().notify);
        slot.close().unwrap().join().unwrap();
    }

    #[test]
    fn input_admission_is_bounded_before_worker_spawn_and_released_on_drop_or_error() {
        let slot = CoreSlot::new();
        let process = slot.install(engine()).unwrap();
        let mut permits: Vec<_> = (0..32).map(|_| slot.reserve_input().unwrap()).collect();
        assert!(slot.reserve_input().is_err());
        drop(permits.pop());
        let released = slot.reserve_input().unwrap();
        assert!(slot.reserve_input().is_err());
        process.finish().unwrap();
        let event =
            serde_json::from_value(serde_json::json!({"kind":"focus","focused":true})).unwrap();
        assert!(released.encode(event).is_err());
        assert!(
            slot.reserve_input().is_ok(),
            "failed request releases admission"
        );
        slot.close().unwrap().join().unwrap();
        assert!(slot.reserve_input().is_err());
        drop(permits);
    }

    #[test]
    fn dropping_the_slot_cannot_leave_an_actor_alive_through_external_handles() {
        let slot = CoreSlot::new();
        let process = slot.install(engine()).unwrap();
        drop(slot);
        assert_stopped(&process.handle);
    }
}
