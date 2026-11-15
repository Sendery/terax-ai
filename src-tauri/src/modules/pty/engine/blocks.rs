use super::shell::{ShellEvent, ShellIntegration};
use libghostty_vt::fmt::Format;
use libghostty_vt::screen::{Screen, TrackedGridRef};
use libghostty_vt::selection::{FormatOptions, Selection};
use libghostty_vt::terminal::{Point, PointCoordinate, PointSpace};
use libghostty_vt::{Error, Terminal};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;

const MAX_BLOCKS: usize = 1000;
const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_CONTENT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockMeta {
    pub id: String,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub running: bool,
    pub header_line: Option<u32>,
    pub start_line: u32,
    pub end_line: u32,
    pub started_at: u64,
    pub finished_at: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSnapshot {
    pub seq: Option<u32>,
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
    output_stamp: Option<[u8; 32]>,
    header: Option<TrackedGridRef>,
    start: TrackedGridRef,
    end: Option<TrackedGridRef>,
}
impl Entry {
    fn bytes(&self) -> usize {
        std::mem::size_of::<Self>() + self.command.capacity() + self.cwd.capacity()
    }
    fn meta(
        &self,
        start: PointCoordinate,
        end: PointCoordinate,
        header: Option<PointCoordinate>,
    ) -> BlockMeta {
        BlockMeta {
            id: format!("b{}", self.id),
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            exit_code: self.exit_code,
            running: self.running,
            header_line: header
                .filter(|point| point.y <= start.y)
                .map(|point| point.y),
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
    prompt_header: Option<TrackedGridRef>,
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
            prompt_header: None,
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
            super::graphics::write(term, segment).map_err(|error| error.to_string())?;
            if failure.is_none() {
                if let Some(event) = event {
                    let result = match event {
                        ShellEvent::PromptStart => {
                            self.prompt_header = None;
                            Ok(())
                        }
                        ShellEvent::PromptEnd => self.prompt_end(term),
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
    fn prompt_end(&mut self, term: &Terminal<'_, '_>) -> Result<(), String> {
        self.prompt_header = None;
        if primary(term)? {
            let row = u32::from(term.cursor_y().map_err(|e| e.to_string())?);
            if let Some(y) = row.checked_sub(1) {
                self.prompt_header = Some(
                    term.track_grid_ref(Point::Active(PointCoordinate { x: 0, y }))
                        .map_err(|e| e.to_string())?,
                );
            }
        }
        Ok(())
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
            output_stamp: None,
            header: self.prompt_header.take(),
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
        entry.output_stamp = content_stamp(term, &entry)?;
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
                    let header = entry
                        .header
                        .as_ref()
                        .map(|reference| {
                            reference
                                .point(PointSpace::Screen)
                                .map_err(|e| e.to_string())
                        })
                        .transpose()?
                        .flatten();
                    let visible_bottom = viewport
                        .offset
                        .saturating_add(u64::from(term.rows().map_err(|e| e.to_string())?));
                    let header = match header {
                        Some(point)
                            if u64::from(point.y) >= viewport.offset
                                && u64::from(point.y) < visible_bottom
                                && last_text_col(term, point.y)?.is_some() =>
                        {
                            None
                        }
                        header => header,
                    };
                    blocks.push(entry.meta(start, end, header));
                }
            }
        }
        Ok(BlockSnapshot {
            seq: None,
            metadata_version: self.version,
            has_any: self.has_any,
            alternate_screen: !is_primary,
            viewport_offset: viewport.offset,
            viewport_rows: term.rows().map_err(|e| e.to_string())?,
            blocks,
        })
    }
    pub(super) fn verified_range(
        &self,
        term: &Terminal<'_, '_>,
        id: &str,
    ) -> Result<Option<(PointCoordinate, PointCoordinate)>, String> {
        let id = id_number(id)?;
        if !primary(term)? {
            return Ok(None);
        }
        let Some(entry) = self.entries.iter().find(|entry| entry.id == id) else {
            return Ok(None);
        };
        let Some(range) = Self::range(entry, term)? else {
            return Ok(None);
        };
        if entry.output_stamp.is_none() || content_stamp(term, entry)? != entry.output_stamp {
            return Ok(None);
        }
        Ok(Some(range))
    }
    pub(super) fn output_selection<'t>(
        &self,
        term: &'t Terminal<'_, '_>,
        id: &str,
    ) -> Result<Option<VerifiedOutput<'t>>, String> {
        let Some((start, end)) = self.verified_range(term, id)? else {
            return Ok(None);
        };
        let number = id_number(id)?;
        let entry = self
            .entries
            .iter()
            .find(|entry| entry.id == number)
            .ok_or("terminal block disappeared")?;
        let selection = if entry.empty {
            None
        } else {
            let Some(selection) = entry_selection(term, entry)? else {
                return Ok(None);
            };
            Some(selection)
        };
        Ok(Some(VerifiedOutput {
            start,
            end,
            selection,
        }))
    }
    pub fn prune_visible(&mut self, term: &Terminal<'_, '_>) -> Result<bool, String> {
        if !primary(term)? {
            return Ok(false);
        }
        let viewport = term.scrollbar().map_err(|error| error.to_string())?;
        let bottom = viewport
            .offset
            .saturating_add(u64::from(term.rows().map_err(|error| error.to_string())?));
        let mut changed = false;
        let mut at = 0;
        while at < self.entries.len() {
            let entry = &self.entries[at];
            let range = Self::range(entry, term)?;
            let valid = match range {
                None => false,
                Some((start, end))
                    if u64::from(end.y) >= viewport.offset && u64::from(start.y) < bottom =>
                {
                    entry.output_stamp.is_some()
                        && content_stamp(term, entry)? == entry.output_stamp
                }
                Some(_) => true,
            };
            if valid {
                at += 1;
            } else if let Some(entry) = self.entries.remove(at) {
                self.metadata_bytes = self.metadata_bytes.saturating_sub(entry.bytes());
                changed = true;
            }
        }
        Ok(changed)
    }
    pub fn read(&self, term: &Terminal<'_, '_>, id: &str) -> Result<Option<BlockOutput>, String> {
        let number = id_number(id)?;
        if !primary(term)? {
            return Ok(None);
        }
        let Some(entry) = self.entries.iter().find(|entry| entry.id == number) else {
            return Ok(None);
        };
        if Self::range(entry, term)?.is_none() {
            return Ok(None);
        }
        let bytes = match entry_text(term, entry, self.max_output_bytes, false)? {
            BlockText::Unavailable => return Ok(None),
            BlockText::TooLarge => {
                return Err("terminal block output exceeds its byte limit".into())
            }
            BlockText::Text(bytes) => bytes,
        };
        if self.verified_range(term, id)?.is_none() {
            return Ok(None);
        }
        let output =
            String::from_utf8(bytes).map_err(|_| "invalid UTF-8 in terminal block output")?;
        Ok(Some(BlockOutput {
            command: entry.command.clone(),
            cwd: entry.cwd.clone(),
            exit_code: entry.exit_code,
            output,
        }))
    }
}

pub(super) struct VerifiedOutput<'t> {
    pub start: PointCoordinate,
    pub end: PointCoordinate,
    pub selection: Option<Selection<'t>>,
}

enum BlockText {
    Unavailable,
    TooLarge,
    Text(Vec<u8>),
}
fn entry_selection<'t>(
    term: &'t Terminal<'_, '_>,
    entry: &Entry,
) -> Result<Option<Selection<'t>>, String> {
    let Some(end) = &entry.end else {
        return Ok(None);
    };
    let Some(start) = entry
        .start
        .snapshot(term)
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    let Some(end) = end.snapshot(term).map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    Ok(Some(Selection::new(start, end, false)))
}
fn entry_text(
    term: &Terminal<'_, '_>,
    entry: &Entry,
    limit: usize,
    unwrap: bool,
) -> Result<BlockText, String> {
    if entry.empty {
        return Ok(BlockText::Text(Vec::new()));
    }
    let Some(selection) = entry_selection(term, entry)? else {
        return Ok(BlockText::Unavailable);
    };
    let options = || {
        FormatOptions::new()
            .with_emit_format(Format::Plain)
            .with_unwrap(unwrap)
            .with_trim(true)
            .with_selection(&selection)
    };
    let required = match term.format_selection_buf(options(), &mut []) {
        Ok(Some(0)) => 0,
        Err(Error::OutOfSpace { required }) => required,
        Err(error) => return Err(error.to_string()),
        _ => return Err("terminal block text is unavailable".into()),
    };
    if required > limit {
        return Ok(BlockText::TooLarge);
    }
    let mut bytes = vec![0; required];
    if required > 0 {
        let len = term
            .format_selection_buf(options(), &mut bytes)
            .map_err(|error| error.to_string())?
            .ok_or("terminal block text is unavailable")?;
        if len > bytes.len() {
            return Err("invalid terminal block output size".into());
        }
        bytes.truncate(len);
    }
    while bytes.last() == Some(&b'\n') {
        bytes.pop();
    }
    Ok(BlockText::Text(bytes))
}
fn content_stamp(term: &Terminal<'_, '_>, entry: &Entry) -> Result<Option<[u8; 32]>, String> {
    Ok(match entry_text(term, entry, MAX_CONTENT_BYTES, true)? {
        BlockText::Text(bytes) => Some(Sha256::digest(&bytes).into()),
        _ => None,
    })
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

#[cfg(test)]
mod presentation_tests {
    use super::*;
    fn snapshot(version: u64, offset: u64) -> BlockSnapshot {
        BlockSnapshot {
            seq: None,
            metadata_version: version,
            has_any: true,
            alternate_screen: false,
            viewport_offset: offset,
            viewport_rows: 5,
            blocks: vec![BlockMeta {
                id: "b1".into(),
                command: "printf one".into(),
                cwd: "/workspace".into(),
                exit_code: Some(0),
                running: false,
                header_line: Some(0),
                start_line: 2,
                end_line: 3,
                started_at: 1,
                finished_at: 2,
            }],
        }
    }
    #[test]
    fn presented_blocks_remain_immutable_and_geometry_is_not_metadata_version() {
        let mut cache = BlockFrames::default();
        cache.commit(1, snapshot(2, 0));
        cache.commit(2, snapshot(2, 2));
        assert_eq!(cache.query(1).unwrap().viewport_offset, 0);
        assert_eq!(cache.query(2).unwrap().viewport_offset, 2);
        assert_eq!(cache.query(1).unwrap().seq, Some(1));
        let mut external = cache.query(1).unwrap();
        external.blocks[0].command = "mutated reply".into();
        assert_eq!(cache.query(1).unwrap().blocks[0].command, "printf one");
    }
    #[test]
    fn presented_block_cache_has_count_and_allocated_byte_limits() {
        let mut cache = BlockFrames::default();
        for seq in 1..=4 {
            cache.commit(seq, snapshot(2, 0));
        }
        assert!(cache.query(1).is_none());
        assert!(cache.query(2).is_some());
        assert!(cache.query(4).is_some());
        let mut oversized = snapshot(2, 0);
        oversized.blocks[0].command = String::with_capacity(17 * 1024 * 1024);
        cache.commit(5, oversized);
        assert!(cache.query(5).is_none());
        assert!(cache.retained_bytes() <= 16 * 1024 * 1024);
    }
}

const MAX_BLOCK_FRAMES: usize = 3;
const MAX_FRAME_METADATA_BYTES: usize = 16 * 1024 * 1024;
struct BlockProjection {
    seq: u32,
    snapshot: std::sync::Arc<BlockSnapshot>,
    bytes: usize,
}
#[derive(Default)]
pub(super) struct BlockFrames {
    frames: VecDeque<BlockProjection>,
    bytes: usize,
}
impl BlockFrames {
    pub fn metadata_version(&self) -> Option<u64> {
        self.frames
            .back()
            .map(|frame| frame.snapshot.metadata_version)
    }
    pub fn commit(&mut self, seq: u32, snapshot: BlockSnapshot) {
        let bytes = std::mem::size_of::<BlockSnapshot>()
            + snapshot.blocks.capacity() * std::mem::size_of::<BlockMeta>()
            + snapshot
                .blocks
                .iter()
                .map(|block| block.id.capacity() + block.command.capacity() + block.cwd.capacity())
                .sum::<usize>();
        if bytes > MAX_FRAME_METADATA_BYTES {
            return;
        }
        let snapshot = self
            .frames
            .back()
            .filter(|frame| frame.snapshot.as_ref() == &snapshot)
            .map(|frame| std::sync::Arc::clone(&frame.snapshot))
            .unwrap_or_else(|| std::sync::Arc::new(snapshot));
        self.bytes += bytes;
        self.frames.push_back(BlockProjection {
            seq,
            snapshot,
            bytes,
        });
        while self.frames.len() > MAX_BLOCK_FRAMES || self.bytes > MAX_FRAME_METADATA_BYTES {
            if let Some(frame) = self.frames.pop_front() {
                self.bytes -= frame.bytes;
            }
        }
    }
    pub fn query(&self, seq: u32) -> Option<BlockSnapshot> {
        let frame = self.frames.iter().find(|frame| frame.seq == seq)?;
        let mut snapshot = frame.snapshot.as_ref().clone();
        snapshot.seq = Some(seq);
        Some(snapshot)
    }
    #[cfg(test)]
    pub fn retained_bytes(&self) -> usize {
        self.bytes
    }
}

#[cfg(test)]
mod content_integrity_tests {
    use super::*;
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn fixture() -> (Terminal<'static, 'static>, ShellIntegration, BlockStore) {
        let mut term = Terminal::new(libghostty_vt::TerminalOptions {
            cols: 12,
            rows: 5,
            max_scrollback: 1024 * 1024,
        })
        .unwrap();
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut blocks = BlockStore::default();
        blocks.feed(&mut term,&mut shell,
            format!("\x1b]133;C;aid={TOKEN};cmdline_url=one\x07one\r\ntwo\x1b]133;D;0;aid={TOKEN}\x07\r\nPROMPT").as_bytes(),1).unwrap();
        (term, shell, blocks)
    }
    #[test]
    fn completed_reads_reject_cell_replacement_or_erasure_without_mutating_user_selection() {
        for damage in [
            b"\x1b[1;1HNEW".as_slice(),
            b"\x1b[2J".as_slice(),
            b"\x1b[1;1H\x1b[P".as_slice(),
            b"\x1b[1;1H\x1b[@X".as_slice(),
        ] {
            let (mut term, mut shell, mut blocks) = fixture();
            blocks.feed(&mut term, &mut shell, damage, 2).unwrap();
            term.vt_write(b"\x1b[5;1HKEEP");
            let all = term.select_all().unwrap().unwrap();
            term.set_selection(Some(&all)).unwrap();
            let before = term
                .format_selection_alloc(None, FormatOptions::new().with_emit_format(Format::Plain))
                .unwrap()
                .unwrap()
                .to_vec();
            assert!(
                blocks.read(&term, "b1").unwrap().is_none(),
                "damage {damage:?}"
            );
            let after = term
                .format_selection_alloc(None, FormatOptions::new().with_emit_format(Format::Plain))
                .unwrap()
                .unwrap()
                .to_vec();
            assert_eq!(before, after);
        }
    }
    #[test]
    fn invalid_visible_blocks_are_retired_without_changing_command_metadata_revision() {
        let (mut term, mut shell, mut blocks) = fixture();
        let version = blocks.metadata_version();
        blocks
            .feed(&mut term, &mut shell, b"\x1b[2Jnew command output", 2)
            .unwrap();
        assert!(blocks.prune_visible(&term).unwrap());
        assert!(blocks.snapshot(&term).unwrap().blocks.is_empty());
        assert_eq!(blocks.metadata_version(), version);
        assert!(!blocks.prune_visible(&term).unwrap());
    }
    #[test]
    fn content_guards_preserve_real_reflow_and_hide_only_primary_blocks_during_alternate_screen() {
        let (mut term, mut shell, mut blocks) = fixture();
        term.resize(3, 5, 0, 0).unwrap();
        assert_eq!(
            blocks
                .read(&term, "b1")
                .unwrap()
                .unwrap()
                .output
                .replace('\n', ""),
            "onetwo"
        );
        assert!(!blocks.prune_visible(&term).unwrap());
        blocks
            .feed(&mut term, &mut shell, b"\x1b[?1049hALT", 2)
            .unwrap();
        assert!(!blocks.prune_visible(&term).unwrap());
        blocks
            .feed(&mut term, &mut shell, b"\x1b[?1049l", 3)
            .unwrap();
        assert!(blocks.read(&term, "b1").unwrap().is_some());
    }
}

#[cfg(test)]
mod header_anchor_tests {
    use super::*;
    use libghostty_vt::TerminalOptions;
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn terminal() -> Terminal<'static, 'static> {
        Terminal::new(TerminalOptions {
            cols: 8,
            rows: 8,
            max_scrollback: 64 * 1024,
        })
        .unwrap()
    }
    #[test]
    fn header_tracks_the_reserved_prompt_row_across_command_wrap_and_reflow() {
        let mut term = terminal();
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut blocks = BlockStore::default();
        let input = format!("\x1b]133;A;aid={TOKEN}\x07\r\n\x1b]133;B;aid={TOKEN}\x07{}\r\n\x1b]133;C;aid={TOKEN};cmdline_url=long-command\x07body\x1b]133;D;0;aid={TOKEN}\x07", "x".repeat(25));
        blocks
            .feed(&mut term, &mut shell, input.as_bytes(), 1)
            .unwrap();
        let meta = blocks.snapshot(&term).unwrap().blocks.remove(0);
        assert_eq!(meta.header_line, Some(0));
        assert_eq!(meta.start_line, 5);
        assert_eq!(
            blocks.read(&term, &meta.id).unwrap().unwrap().output,
            "body"
        );
        term.resize(4, 8, 0, 0).unwrap();
        let reflowed = blocks.snapshot(&term).unwrap().blocks.remove(0);
        assert_eq!(reflowed.header_line, Some(0));
        assert!(reflowed.start_line > reflowed.header_line.unwrap() + 2);
        assert_eq!(
            blocks.read(&term, &meta.id).unwrap().unwrap().output,
            "body"
        );
    }
    #[test]
    fn long_command_markers_pass_through_the_actual_vt_without_becoming_output() {
        let mut term = terminal();
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut blocks = BlockStore::default();
        let command = "x".repeat(16 * 1024);
        let input = format!(
            "\x1b]133;C;aid={TOKEN};cmdline_url={command}\x1b\\body\x1b]133;D;0;aid={TOKEN}\x07"
        );
        for chunk in input.as_bytes().chunks(1024) {
            blocks.feed(&mut term, &mut shell, chunk, 1).unwrap();
        }
        let meta = blocks.snapshot(&term).unwrap().blocks.remove(0);
        assert_eq!(meta.command, command);
        assert_eq!(
            blocks.read(&term, &meta.id).unwrap().unwrap().output,
            "body"
        );
        assert_eq!(
            crate::modules::pty::engine::text::read_text(&term, 8)
                .unwrap()
                .trim(),
            "body"
        );
    }
    #[test]
    fn overwritten_reserved_row_hides_only_the_header_and_preserves_output() {
        let mut term = terminal();
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut blocks = BlockStore::default();
        let input = format!("\x1b]133;A;aid={TOKEN}\x07\r\n\x1b]133;B;aid={TOKEN}\x07echo\r\n\x1b]133;C;aid={TOKEN};cmdline_url=echo\x07\x1b[1;1HHEADER\x1b[3;1Hbody\x1b]133;D;0;aid={TOKEN}\x07");
        blocks
            .feed(&mut term, &mut shell, input.as_bytes(), 1)
            .unwrap();
        let meta = blocks.snapshot(&term).unwrap().blocks.remove(0);
        assert_eq!(meta.header_line, None);
        assert_eq!(
            blocks.read(&term, &meta.id).unwrap().unwrap().output,
            "body"
        );
    }
    #[test]
    fn missing_unsigned_or_invalidated_prompt_never_guesses_a_header() {
        for prompt in [
            String::new(),
            "\r\n\x1b]133;B\x07".into(),
            format!("\r\n\x1b]133;B;aid={TOKEN}\x07\x1b]133;A;aid={TOKEN}\x07"),
            format!("\x1b]133;B;aid={TOKEN}\x07"),
        ] {
            let mut term = terminal();
            let mut shell = ShellIntegration::new(Some(TOKEN.into()));
            let mut blocks = BlockStore::default();
            let input = format!("{prompt}echo\r\n\x1b]133;C;aid={TOKEN};cmdline_url=echo\x07body\x1b]133;D;0;aid={TOKEN}\x07");
            blocks
                .feed(&mut term, &mut shell, input.as_bytes(), 1)
                .unwrap();
            assert_eq!(blocks.snapshot(&term).unwrap().blocks[0].header_line, None);
        }
    }
}
