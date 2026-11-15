use super::shell::{ShellEvent, ShellIntegration};
use libghostty_vt::fmt::Format;
use libghostty_vt::screen::{Screen, TrackedGridRef};
use libghostty_vt::selection::{FormatOptions, Selection};
use libghostty_vt::terminal::{Point, PointCoordinate, PointSpace};
use libghostty_vt::{Error, Terminal};
use serde::Serialize;
use std::collections::VecDeque;

const MAX_BLOCKS: usize = 1000;
const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockMeta {
    pub id: String,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub running: bool,
    pub start_line: u32,
    pub end_line: u32,
    pub started_at: u64,
    pub finished_at: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSnapshot {
    pub metadata_version: u64,
    pub has_any: bool,
    pub alternate_screen: bool,
    pub viewport_offset: u64,
    pub viewport_rows: u16,
    pub blocks: Vec<BlockMeta>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockOutput {
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub output: String,
}
struct Entry {
    id: u64,
    command: String,
    cwd: String,
    exit_code: Option<i32>,
    started_at: u64,
    finished_at: u64,
    running: bool,
    empty: bool,
    start: TrackedGridRef,
    end: Option<TrackedGridRef>,
}
impl Entry {
    fn bytes(&self) -> usize {
        std::mem::size_of::<Self>() + self.command.capacity() + self.cwd.capacity()
    }
    fn meta(&self, start: PointCoordinate, end: PointCoordinate) -> BlockMeta {
        BlockMeta {
            id: format!("b{}", self.id),
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            exit_code: self.exit_code,
            running: self.running,
            start_line: start.y,
            end_line: end.y,
            started_at: self.started_at,
            finished_at: self.finished_at,
        }
    }
}
pub struct BlockStore {
    entries: VecDeque<Entry>,
    live: Option<Entry>,
    next_id: u64,
    version: u64,
    has_any: bool,
    metadata_bytes: usize,
    max_entries: usize,
    max_metadata_bytes: usize,
    max_output_bytes: usize,
}
impl Default for BlockStore {
    fn default() -> Self {
        Self::with_limits(MAX_BLOCKS, MAX_METADATA_BYTES, MAX_OUTPUT_BYTES)
    }
}
fn primary(term: &Terminal<'_, '_>) -> Result<bool, String> {
    term.active_screen()
        .map(|s| s == Screen::Primary)
        .map_err(|e| e.to_string())
}
fn cursor(term: &Terminal<'_, '_>) -> Result<Point, String> {
    Ok(Point::Active(PointCoordinate {
        x: term.cursor_x().map_err(|e| e.to_string())?,
        y: u32::from(term.cursor_y().map_err(|e| e.to_string())?),
    }))
}
fn screen_cursor(term: &Terminal<'_, '_>) -> Result<Option<PointCoordinate>, String> {
    let reference = term.grid_ref(cursor(term)?).map_err(|e| e.to_string())?;
    term.point_from_grid_ref(&reference, PointSpace::Screen)
        .map_err(|e| e.to_string())
}
fn last_text_col(term: &Terminal<'_, '_>, row: u32) -> Result<Option<u16>, String> {
    let cols = term.cols().map_err(|e| e.to_string())?;
    for x in (0..cols).rev() {
        if term
            .grid_ref(Point::Screen(PointCoordinate { x, y: row }))
            .and_then(|r| r.cell())
            .and_then(|c| c.has_text())
            .map_err(|e| e.to_string())?
        {
            return Ok(Some(x));
        }
    }
    Ok(None)
}
fn output_end(term: &Terminal<'_, '_>, start: PointCoordinate) -> Result<Option<Point>, String> {
    let end = screen_cursor(term)?.ok_or("terminal block cursor is unavailable")?;
    if end.y < start.y {
        return Err("terminal block cursor precedes its output".into());
    }
    if let Some(x) = last_text_col(term, end.y)? {
        return Ok(Some(Point::Screen(PointCoordinate { x, y: end.y })));
    }
    if end.y == start.y {
        return Ok(None);
    }
    let y = end.y - 1;
    let x = last_text_col(term, y)?.unwrap_or(term.cols().map_err(|e| e.to_string())? - 1);
    Ok(Some(Point::Screen(PointCoordinate { x, y })))
}
fn ordered(start: PointCoordinate, end: PointCoordinate) -> bool {
    end.y > start.y || (end.y == start.y && end.x >= start.x)
}
pub(super) fn validate_id(id: &str) -> Result<(), String> {
    id_number(id).map(|_| ())
}
fn id_number(id: &str) -> Result<u64, String> {
    let value = id.strip_prefix('b').ok_or("invalid block id")?;
    if value.is_empty()
        || value.len() > 20
        || value.starts_with('0')
        || !value.bytes().all(|b| b.is_ascii_digit())
    {
        return Err("invalid block id".into());
    }
    value.parse().map_err(|_| "invalid block id".into())
}
impl BlockStore {
    fn with_limits(max_entries: usize, max_metadata_bytes: usize, max_output_bytes: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            live: None,
            next_id: 0,
            version: 0,
            has_any: false,
            metadata_bytes: 0,
            max_entries,
            max_metadata_bytes,
            max_output_bytes,
        }
    }
    pub fn metadata_version(&self) -> u64 {
        self.version
    }
    fn changed(&mut self) -> Result<(), String> {
        self.version = self
            .version
            .checked_add(1)
            .ok_or("terminal block version exhausted")?;
        Ok(())
    }
    pub fn feed(
        &mut self,
        term: &mut Terminal<'_, '_>,
        shell: &mut ShellIntegration,
        bytes: &[u8],
        now: u64,
    ) -> Result<(), String> {
        let mut failure = None;
        shell.ingest_segments(bytes, |segment, event| {
            term.vt_write(segment);
            if failure.is_none() {
                if let Some(event) = event {
                    let result = match event {
                        ShellEvent::CommandStart { command, cwd } => {
                            self.start(term, command, cwd.unwrap_or_default(), now)
                        }
                        ShellEvent::CommandEnd { exit_code } => {
                            self.finish(term, Some(exit_code), now)
                        }
                    };
                    if let Err(error) = result {
                        failure = Some(error)
                    }
                }
            }
            Ok(())
        })?;
        failure.map_or(Ok(()), Err)
    }
    fn start(
        &mut self,
        term: &Terminal<'_, '_>,
        command: String,
        cwd: String,
        now: u64,
    ) -> Result<(), String> {
        if self.live.is_some() {
            self.finish(term, None, now)?;
        }
        if !primary(term)? {
            return Ok(());
        }
        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or("terminal block id exhausted")?;
        let entry = Entry {
            id: self.next_id,
            command,
            cwd,
            exit_code: None,
            started_at: now,
            finished_at: 0,
            running: true,
            empty: false,
            start: term
                .track_grid_ref(Point::Active(PointCoordinate {
                    x: 0,
                    y: u32::from(term.cursor_y().map_err(|e| e.to_string())?),
                }))
                .map_err(|e| e.to_string())?,
            end: None,
        };
        self.metadata_bytes += entry.bytes();
        self.live = Some(entry);
        self.has_any = true;
        self.changed()?;
        self.enforce_limits();
        Ok(())
    }
    fn finish(
        &mut self,
        term: &Terminal<'_, '_>,
        exit_code: Option<i32>,
        now: u64,
    ) -> Result<(), String> {
        let Some(mut entry) = self.live.take() else {
            return Ok(());
        };
        self.changed()?;
        if !primary(term)? {
            self.metadata_bytes = self.metadata_bytes.saturating_sub(entry.bytes());
            return Ok(());
        }
        let Some(start) = entry
            .start
            .point(PointSpace::Screen)
            .map_err(|e| e.to_string())?
        else {
            self.metadata_bytes = self.metadata_bytes.saturating_sub(entry.bytes());
            return Ok(());
        };
        if screen_cursor(term)?.is_none_or(|end| end.y < start.y) {
            self.metadata_bytes = self.metadata_bytes.saturating_sub(entry.bytes());
            return Ok(());
        }
        let end = output_end(term, start)?;
        entry.empty = end.is_none();
        entry.end = end
            .map(|point| term.track_grid_ref(point).map_err(|e| e.to_string()))
            .transpose()?;
        entry.running = false;
        entry.exit_code = exit_code;
        entry.finished_at = now.max(entry.started_at);
        self.entries.push_back(entry);
        self.enforce_limits();
        Ok(())
    }
    pub fn finish_input(&mut self, term: &Terminal<'_, '_>, now: u64) -> Result<(), String> {
        self.finish(term, None, now)
    }
    fn enforce_limits(&mut self) {
        while self.entries.len() > self.max_entries || self.metadata_bytes > self.max_metadata_bytes
        {
            let Some(entry) = self.entries.pop_front() else {
                break;
            };
            self.metadata_bytes = self.metadata_bytes.saturating_sub(entry.bytes());
        }
        if self.metadata_bytes > self.max_metadata_bytes {
            if let Some(entry) = self.live.take() {
                self.metadata_bytes = self.metadata_bytes.saturating_sub(entry.bytes());
            }
        }
    }
    fn range(
        entry: &Entry,
        term: &Terminal<'_, '_>,
    ) -> Result<Option<(PointCoordinate, PointCoordinate)>, String> {
        let Some(start) = entry
            .start
            .point(PointSpace::Screen)
            .map_err(|e| e.to_string())?
        else {
            return Ok(None);
        };
        let end = match &entry.end {
            Some(end) => end.point(PointSpace::Screen).map_err(|e| e.to_string())?,
            None if entry.running => screen_cursor(term)?,
            None if entry.empty => Some(start),
            None => None,
        };
        Ok(end
            .filter(|end| ordered(start, *end))
            .map(|end| (start, end)))
    }
    pub fn snapshot(&self, term: &Terminal<'_, '_>) -> Result<BlockSnapshot, String> {
        let is_primary = primary(term)?;
        let viewport = term.scrollbar().map_err(|e| e.to_string())?;
        let mut blocks = Vec::new();
        if is_primary {
            for entry in self.entries.iter().chain(self.live.iter()) {
                if let Some((start, end)) = Self::range(entry, term)? {
                    blocks.push(entry.meta(start, end));
                }
            }
        }
        Ok(BlockSnapshot {
            metadata_version: self.version,
            has_any: self.has_any,
            alternate_screen: !is_primary,
            viewport_offset: viewport.offset,
            viewport_rows: term.rows().map_err(|e| e.to_string())?,
            blocks,
        })
    }
    pub fn read(&self, term: &Terminal<'_, '_>, id: &str) -> Result<Option<BlockOutput>, String> {
        let id = id_number(id)?;
        if !primary(term)? {
            return Ok(None);
        }
        let Some(entry) = self.entries.iter().find(|e| e.id == id) else {
            return Ok(None);
        };
        if Self::range(entry, term)?.is_none() {
            return Ok(None);
        }
        if entry.empty {
            return Ok(Some(BlockOutput {
                command: entry.command.clone(),
                cwd: entry.cwd.clone(),
                exit_code: entry.exit_code,
                output: String::new(),
            }));
        }
        let Some(end) = &entry.end else {
            return Ok(None);
        };
        let Some(start) = entry.start.snapshot(term).map_err(|e| e.to_string())? else {
            return Ok(None);
        };
        let Some(end) = end.snapshot(term).map_err(|e| e.to_string())? else {
            return Ok(None);
        };
        let selection = Selection::new(start, end, false);
        let options = || {
            FormatOptions::new()
                .with_emit_format(Format::Plain)
                .with_unwrap(false)
                .with_trim(true)
                .with_selection(&selection)
        };
        let required = match term.format_selection_buf(options(), &mut []) {
            Ok(Some(0)) => 0,
            Err(Error::OutOfSpace { required }) => required,
            Err(e) => return Err(e.to_string()),
            _ => return Err("terminal block text is unavailable".into()),
        };
        if required > self.max_output_bytes {
            return Err("terminal block output exceeds its byte limit".into());
        }
        let mut bytes = vec![0; required];
        if required > 0 {
            let len = term
                .format_selection_buf(options(), &mut bytes)
                .map_err(|e| e.to_string())?
                .ok_or("terminal block text is unavailable")?;
            if len > bytes.len() {
                return Err("invalid terminal block output size".into());
            }
            bytes.truncate(len);
        }
        let mut output =
            String::from_utf8(bytes).map_err(|_| "invalid UTF-8 in terminal block output")?;
        while output.ends_with('\n') {
            output.pop();
        }
        Ok(Some(BlockOutput {
            command: entry.command.clone(),
            cwd: entry.cwd.clone(),
            exit_code: entry.exit_code,
            output,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::pty::engine::shell::ShellIntegration;
    use libghostty_vt::{Terminal, TerminalOptions};
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn term(cols: u16, rows: u16) -> Terminal<'static, 'static> {
        Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: 64 * 1024,
        })
        .unwrap()
    }
    fn shell() -> ShellIntegration {
        ShellIntegration::new(Some(TOKEN.into()))
    }
    fn c(command: &str) -> String {
        format!("\x1b]133;C;aid={TOKEN};cmdline_url={command}\x07")
    }
    fn d(code: i32) -> String {
        format!("\x1b]133;D;{code};aid={TOKEN}\x1b\\")
    }
    #[test]
    fn boundaries_inside_one_batch_exclude_command_echo_and_neighbor_output() {
        let mut term = term(40, 6);
        let mut shell = shell();
        let mut blocks = BlockStore::default();
        let bytes=format!("\x1b]133;A;aid={TOKEN}\x07\x1b]7;file://host/tmp/project\x07echo alpha\r\n{}first\r\nsecond{}\r\nneighbor",c("echo%20alpha"),d(7));
        blocks
            .feed(&mut term, &mut shell, bytes.as_bytes(), 100)
            .unwrap();
        let snapshot = blocks.snapshot(&term).unwrap();
        assert_eq!(snapshot.blocks.len(), 1);
        let b = &snapshot.blocks[0];
        assert_eq!((b.start_line, b.end_line), (1, 2));
        assert_eq!(
            (&*b.command, &*b.cwd, b.exit_code, b.running),
            ("echo alpha", "/tmp/project", Some(7), false)
        );
        assert_eq!(
            blocks.read(&term, &b.id).unwrap().unwrap().output,
            "first\nsecond"
        );
        assert_eq!(snapshot.metadata_version, 2);
        assert!(snapshot.has_any);
    }
    #[test]
    fn fragmented_markers_keep_the_same_block_identity_and_output() {
        let bytes = format!(
            "echo\r\n{}e\u{301}界\r\nend{}\r\nneighbor",
            c("unicode"),
            d(0)
        )
        .into_bytes();
        for cut in 0..=bytes.len() {
            let mut term = term(20, 5);
            let mut shell = shell();
            let mut blocks = BlockStore::default();
            blocks
                .feed(&mut term, &mut shell, &bytes[..cut], 100)
                .unwrap();
            blocks
                .feed(&mut term, &mut shell, &bytes[cut..], 120)
                .unwrap();
            let meta = blocks.snapshot(&term).unwrap().blocks.remove(0);
            assert_eq!(meta.id, "b1");
            assert_eq!(
                blocks.read(&term, &meta.id).unwrap().unwrap().output,
                "e\u{301}界\nend",
                "cut {cut}"
            );
        }
    }
    #[test]
    fn tracked_rows_follow_reflow_without_reading_the_next_command() {
        let mut term = term(8, 4);
        let mut shell = shell();
        let mut blocks = BlockStore::default();
        let bytes = format!("before\r\n{}abcdefghijklmno{}\r\nneighbor", c("long"), d(0));
        blocks
            .feed(&mut term, &mut shell, bytes.as_bytes(), 100)
            .unwrap();
        term.resize(5, 4, 0, 0).unwrap();
        let meta = blocks.snapshot(&term).unwrap().blocks.remove(0);
        assert_eq!(meta.id, "b1");
        let text = blocks.read(&term, &meta.id).unwrap().unwrap().output;
        assert_eq!(text.replace('\n', ""), "abcdefghijklmno");
    }
    #[test]
    fn pruned_or_reset_rows_are_unaddressable_not_retargeted() {
        for reset in [false, true] {
            let mut term = term(12, 3);
            let mut shell = shell();
            let mut blocks = BlockStore::default();
            let bytes = format!("{}old output{}", c("old"), d(0));
            blocks
                .feed(&mut term, &mut shell, bytes.as_bytes(), 100)
                .unwrap();
            if reset {
                blocks
                    .feed(&mut term, &mut shell, b"\x1bcnew output", 110)
                    .unwrap();
            } else {
                let mut previous = term.total_rows().unwrap();
                let mut grew = false;
                let mut pruned = false;
                for _ in 0..1024 {
                    blocks
                        .feed(
                            &mut term,
                            &mut shell,
                            "new line\r\n".repeat(200).as_bytes(),
                            110,
                        )
                        .unwrap();
                    let current = term.total_rows().unwrap();
                    if grew && current <= previous {
                        pruned = true;
                        break;
                    }
                    grew |= current > previous;
                    previous = current;
                }
                assert!(pruned, "fixture must observe actual history reclamation");
            }
            assert!(
                blocks.snapshot(&term).unwrap().blocks.is_empty(),
                "reset {reset}"
            );
            assert!(blocks.read(&term, "b1").unwrap().is_none(), "reset {reset}");
        }
    }
    #[test]
    fn alternate_screen_never_retargets_primary_block_reads() {
        let mut term = term(20, 4);
        let mut shell = shell();
        let mut blocks = BlockStore::default();
        blocks
            .feed(
                &mut term,
                &mut shell,
                format!("{}normal{}", c("one"), d(0)).as_bytes(),
                100,
            )
            .unwrap();
        blocks
            .feed(&mut term, &mut shell, b"\x1b[?1049halternate", 110)
            .unwrap();
        assert!(blocks.snapshot(&term).unwrap().alternate_screen);
        assert!(blocks.read(&term, "b1").unwrap().is_none());
        blocks
            .feed(&mut term, &mut shell, b"\x1b[?1049l", 120)
            .unwrap();
        assert_eq!(blocks.read(&term, "b1").unwrap().unwrap().output, "normal");
    }
    #[test]
    fn completed_blocks_are_bounded_and_live_blocks_finish_on_eof() {
        let mut term = term(40, 12);
        let mut shell = shell();
        let mut blocks = BlockStore::with_limits(2, 4096, 1024);
        for n in 0..4 {
            blocks
                .feed(
                    &mut term,
                    &mut shell,
                    format!("{}value{n}{}\r\n", c("one"), d(0)).as_bytes(),
                    100 + n,
                )
                .unwrap();
        }
        let snapshot = blocks.snapshot(&term).unwrap();
        assert_eq!(
            snapshot
                .blocks
                .iter()
                .map(|b| b.id.as_str())
                .collect::<Vec<_>>(),
            ["b3", "b4"]
        );
        assert!(blocks.read(&term, "b1").unwrap().is_none());
        blocks
            .feed(
                &mut term,
                &mut shell,
                format!("{}last", c("live")).as_bytes(),
                200,
            )
            .unwrap();
        assert!(
            blocks
                .snapshot(&term)
                .unwrap()
                .blocks
                .last()
                .unwrap()
                .running
        );
        assert!(blocks.read(&term, "b5").unwrap().is_none());
        blocks.finish_input(&term, 210).unwrap();
        let meta = blocks.snapshot(&term).unwrap().blocks.pop().unwrap();
        assert_eq!(
            (
                meta.id.as_str(),
                meta.exit_code,
                meta.running,
                meta.finished_at
            ),
            ("b5", None, false, 210)
        );
        assert_eq!(blocks.read(&term, "b5").unwrap().unwrap().output, "last");
    }
    #[test]
    fn read_limits_are_explicit_and_do_not_change_user_selection() {
        let mut term = term(40, 4);
        let mut shell = shell();
        let mut blocks = BlockStore::with_limits(2, 4096, 8);
        blocks
            .feed(
                &mut term,
                &mut shell,
                format!("{}more than eight{}", c("long"), d(0)).as_bytes(),
                100,
            )
            .unwrap();
        let selected = term.select_all().unwrap().unwrap();
        term.set_selection(Some(&selected)).unwrap();
        let mut before = [0; 256];
        let before_len = term
            .format_selection_buf(libghostty_vt::selection::FormatOptions::new(), &mut before)
            .unwrap()
            .unwrap();
        assert!(blocks.read(&term, "b1").unwrap_err().contains("byte limit"));
        let mut after = [0; 256];
        let after_len = term
            .format_selection_buf(libghostty_vt::selection::FormatOptions::new(), &mut after)
            .unwrap()
            .unwrap();
        assert_eq!(&after[..after_len], &before[..before_len]);
    }
    #[test]
    fn newline_and_empty_output_never_read_a_later_prompt() {
        for (output, suffix, expected) in [
            ("hello\r\n", "PROMPT", "hello"),
            ("", "PROMPT", ""),
            ("hello\rXY", "\r\nPROMPT", "XYllo"),
        ] {
            let mut term = term(20, 5);
            let mut shell = shell();
            let mut blocks = BlockStore::default();
            blocks
                .feed(
                    &mut term,
                    &mut shell,
                    format!("{}{}{}{suffix}", c("one"), output, d(0)).as_bytes(),
                    100,
                )
                .unwrap();
            assert_eq!(
                blocks.read(&term, "b1").unwrap().unwrap().output,
                expected,
                "output {output:?}"
            );
        }
    }
    #[test]
    fn reset_does_not_retarget_a_saved_block() {
        let mut term = term(12, 3);
        let mut shell = shell();
        let mut blocks = BlockStore::default();
        blocks
            .feed(
                &mut term,
                &mut shell,
                format!("{}old output{}", c("old"), d(0)).as_bytes(),
                100,
            )
            .unwrap();
        blocks
            .feed(&mut term, &mut shell, b"\x1bcnew output", 110)
            .unwrap();
        let snapshot = blocks.snapshot(&term).unwrap();
        assert!(
            snapshot.blocks.is_empty(),
            "state {snapshot:?}; read {:?}",
            blocks.read(&term, "b1")
        );
        assert!(blocks.read(&term, "b1").unwrap().is_none());
    }
    #[test]
    fn clearing_back_before_the_block_start_does_not_fail_the_terminal() {
        let mut term = term(20, 6);
        let mut shell = shell();
        let mut blocks = BlockStore::default();
        blocks
            .feed(
                &mut term,
                &mut shell,
                format!("one\r\ntwo\r\n{}live", c("clear")).as_bytes(),
                100,
            )
            .unwrap();
        blocks
            .feed(
                &mut term,
                &mut shell,
                format!("\x1b[2J\x1b[Hnew{}", d(0)).as_bytes(),
                110,
            )
            .unwrap();
        assert!(blocks.read(&term, "b1").unwrap().is_none());
        assert!(blocks.snapshot(&term).unwrap().blocks.is_empty());
    }
    #[test]
    fn metadata_budget_accounts_for_allocated_command_capacity() {
        let mut term = term(20, 4);
        let mut shell = shell();
        let mut blocks = BlockStore::with_limits(1000, std::mem::size_of::<Entry>() + 2000, 1024);
        blocks
            .feed(
                &mut term,
                &mut shell,
                format!("{}x{}", c(&"%61".repeat(1000)), d(0)).as_bytes(),
                100,
            )
            .unwrap();
        assert!(blocks.snapshot(&term).unwrap().blocks.is_empty());
        assert!(blocks.metadata_bytes <= blocks.max_metadata_bytes);
    }

    #[test]
    fn metadata_failure_still_feeds_every_original_byte_to_the_core() {
        let mut term = term(20, 4);
        let mut shell = shell();
        let mut blocks = BlockStore {
            version: u64::MAX,
            ..BlockStore::default()
        };
        assert!(blocks
            .feed(
                &mut term,
                &mut shell,
                format!("{}AFTER", c("one")).as_bytes(),
                100
            )
            .is_err());
        let text = crate::modules::pty::engine::text::read_text(&term, 4).unwrap();
        assert!(text.contains("AFTER"), "{text:?}");
    }
}
