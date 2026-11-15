use std::collections::BTreeMap;
use std::ops::Range;

use libghostty_vt::fmt::Format;
use libghostty_vt::screen::{CellWide, Screen, TrackedGridRef};
use libghostty_vt::selection::{FormatOptions, Selection};
use libghostty_vt::terminal::{Point, PointCoordinate, PointSpace, ScrollViewport};
use libghostty_vt::{Error, Terminal};
use serde::{Deserialize, Serialize};

const MAX_QUERY_BYTES: usize = 4096;
const MAX_INDEX_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SearchCommand {
    Find {
        query: String,
        forward: bool,
        incremental: bool,
    },
    Clear,
}
impl SearchCommand {
    pub fn validate(&self) -> Result<(), String> {
        if let Self::Find { query, .. } = self {
            if query.len() > MAX_QUERY_BYTES || query.chars().any(char::is_control) {
                return Err(
                    "terminal search requires at most 4096 UTF-8 bytes without controls".into(),
                );
            }
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct SearchState {
    query: String,
    index: Option<Index>,
    active: Option<Anchor>,
    active_range: Option<Range<usize>>,
}
struct Anchor {
    start: TrackedGridRef,
    end: TrackedGridRef,
    screen: Screen,
}
struct RowText {
    row: u32,
    first_col: u16,
    range: Range<usize>,
}
struct Index {
    text: String,
    rows: Vec<RowText>,
}
struct CellText {
    range: Range<usize>,
    col: u16,
    width: u16,
}

fn folded(text: &str) -> String {
    text.to_lowercase()
}
fn matches<'a>(text: &'a str, query: &'a str) -> impl Iterator<Item = usize> + 'a {
    let mut offset = 0;
    std::iter::from_fn(move || {
        let start = offset + text.get(offset..)?.find(query)?;
        offset = start + text[start..].chars().next()?.len_utf8();
        Some(start)
    })
}
fn grid_point(term: &Terminal<'_, '_>, x: u16, y: u32) -> Result<Point, String> {
    let viewport = term.scrollbar().map_err(|e| e.to_string())?;
    let row = u64::from(y);
    Ok(
        if row >= viewport.offset && row < viewport.offset + viewport.len {
            Point::Viewport(PointCoordinate {
                x,
                y: (row - viewport.offset) as u32,
            })
        } else {
            Point::Screen(PointCoordinate { x, y })
        },
    )
}
fn wrapped(term: &Terminal<'_, '_>, row: u32) -> Result<bool, String> {
    term.grid_ref(grid_point(term, 0, row)?)
        .and_then(|r| r.row())
        .and_then(|r| r.is_wrapped())
        .map_err(|e| e.to_string())
}
fn row_text(term: &Terminal<'_, '_>, row: u32, first: u16, last: u16) -> Result<String, String> {
    let start = term
        .grid_ref(grid_point(term, first, row)?)
        .map_err(|e| e.to_string())?;
    let end = term
        .grid_ref(grid_point(term, last, row)?)
        .map_err(|e| e.to_string())?;
    let selection = Selection::new(start, end, false);
    let options = || {
        FormatOptions::new()
            .with_emit_format(Format::Plain)
            .with_unwrap(false)
            .with_trim(false)
            .with_selection(&selection)
    };
    let required = match term.format_selection_buf(options(), &mut []) {
        Ok(Some(0)) => 0,
        Err(Error::OutOfSpace { required }) => required,
        Err(error) => return Err(error.to_string()),
        _ => return Err("invalid search text sizing reply".into()),
    };
    if required > MAX_INDEX_BYTES {
        return Err("terminal search row exceeds its byte limit".into());
    }
    let mut bytes = vec![0; required];
    if required > 0 {
        let len = term
            .format_selection_buf(options(), &mut bytes)
            .map_err(|e| e.to_string())?
            .ok_or("terminal search text is unavailable")?;
        if len > bytes.len() {
            return Err("invalid search text output size".into());
        }
        bytes.truncate(len);
    }
    let mut text = String::from_utf8(bytes).map_err(|_| "invalid UTF-8 in terminal search text")?;
    if wrapped(term, row)? {
        let mut blanks = 0;
        for col in (first..=last).rev() {
            let cell = term
                .grid_ref(grid_point(term, col, row)?)
                .and_then(|r| r.cell())
                .map_err(|e| e.to_string())?;
            match cell.wide().map_err(|e| e.to_string())? {
                CellWide::SpacerHead | CellWide::SpacerTail => continue,
                _ if cell.has_text().map_err(|e| e.to_string())? => break,
                _ => blanks += 1,
            }
        }
        text.extend(std::iter::repeat_n(' ', blanks));
    }
    Ok(text)
}
fn cell_text(term: &Terminal<'_, '_>, row: u32, first: u16) -> Result<Vec<CellText>, String> {
    let cols = term.cols().map_err(|e| e.to_string())?;
    let mut result = Vec::with_capacity(usize::from(cols));
    let mut offset = 0;
    let mut buf = vec!['\0'; 32];
    for col in first..cols {
        let grid = term
            .grid_ref(grid_point(term, col, row)?)
            .map_err(|e| e.to_string())?;
        let cell = grid.cell().map_err(|e| e.to_string())?;
        let width = match cell.wide().map_err(|e| e.to_string())? {
            CellWide::SpacerHead | CellWide::SpacerTail => continue,
            CellWide::Wide => 2,
            _ => 1,
        };
        let len = match grid.graphemes(&mut buf) {
            Ok(len) => len,
            Err(Error::OutOfSpace { required }) if required <= MAX_INDEX_BYTES / 4 => {
                buf.resize(required, '\0');
                grid.graphemes(&mut buf).map_err(|e| e.to_string())?
            }
            Err(error) => return Err(error.to_string()),
        };
        let bytes = if len == 0 {
            1
        } else {
            buf[..len]
                .iter()
                .flat_map(|c| c.to_lowercase())
                .map(char::len_utf8)
                .sum()
        };
        result.push(CellText {
            range: offset..offset + bytes,
            col,
            width,
        });
        offset += bytes;
    }
    Ok(result)
}
impl Index {
    fn read(term: &Terminal<'_, '_>, range: Range<u32>) -> Result<Self, String> {
        Self::read_clipped(term, range, None)
    }
    fn read_clipped(
        term: &Terminal<'_, '_>,
        range: Range<u32>,
        clip: Option<(PointCoordinate, PointCoordinate)>,
    ) -> Result<Self, String> {
        let cols = term.cols().map_err(|e| e.to_string())?;
        let mut index = Self {
            text: String::new(),
            rows: Vec::new(),
        };
        let mut normalized_len = 0usize;
        for row in range {
            let first = clip
                .filter(|(start, _)| start.y == row)
                .map_or(0, |(start, _)| start.x);
            let last = clip
                .filter(|(_, end)| end.y == row)
                .map_or(cols - 1, |(_, end)| end.x);
            if first > last || last >= cols {
                return Err("invalid terminal search range".into());
            }
            let text = row_text(term, row, first, last)?;
            let bytes = text
                .chars()
                .flat_map(char::to_lowercase)
                .map(char::len_utf8)
                .sum::<usize>();
            if index
                .text
                .len()
                .saturating_add(text.len())
                .saturating_add(1)
                > MAX_INDEX_BYTES
                || normalized_len.saturating_add(bytes).saturating_add(1) > MAX_INDEX_BYTES
            {
                return Err("terminal search history exceeds its byte limit".into());
            }
            let start = normalized_len;
            normalized_len += bytes;
            index.text.push_str(&text);
            index.rows.push(RowText {
                row,
                first_col: first,
                range: start..normalized_len,
            });
            if !wrapped(term, row)? {
                index.text.push('\n');
                normalized_len += 1;
            }
        }
        // Contextual sigma casing crosses soft wraps but preserves UTF-8 width.
        index.text = folded(&index.text);
        if index.text.len() != normalized_len {
            return Err("terminal search normalization changed cell offsets".into());
        }
        Ok(index)
    }
    fn point(
        &self,
        term: &Terminal<'_, '_>,
        byte: usize,
        end: bool,
        cells: &mut BTreeMap<u32, Vec<CellText>>,
    ) -> Result<PointCoordinate, String> {
        let row = self
            .rows
            .get(self.rows.partition_point(|r| r.range.end <= byte))
            .filter(|r| r.range.contains(&byte))
            .ok_or("invalid terminal search text position")?;
        if let std::collections::btree_map::Entry::Vacant(entry) = cells.entry(row.row) {
            entry.insert(cell_text(term, row.row, row.first_col)?);
        }
        let cell = cells[&row.row]
            .iter()
            .find(|c| c.range.contains(&(byte - row.range.start)))
            .ok_or("terminal search text does not match the grid")?;
        Ok(PointCoordinate {
            x: cell.col + if end { cell.width - 1 } else { 0 },
            y: row.row,
        })
    }
    fn offset(
        &self,
        term: &Terminal<'_, '_>,
        point: PointCoordinate,
    ) -> Result<Option<usize>, String> {
        let Some(row) = self.rows.iter().find(|r| r.row == point.y) else {
            return Ok(None);
        };
        let cells = cell_text(term, point.y, row.first_col)?;
        Ok(cells
            .iter()
            .find(|c| c.col == point.x)
            .map(|c| row.range.start + c.range.start.min(row.range.len())))
    }
}
impl SearchState {
    pub fn is_active(&self) -> bool {
        !self.query.is_empty()
    }
    pub fn apply(
        &mut self,
        term: &mut Terminal<'_, '_>,
        command: &SearchCommand,
    ) -> Result<bool, String> {
        let result = match command {
            SearchCommand::Find {
                query,
                forward,
                incremental,
            } => self.find(term, query, *forward, *incremental),
            SearchCommand::Clear => {
                self.clear();
                Ok(false)
            }
        };
        if result.is_err() {
            self.clear();
        }
        result
    }
    pub fn invalidate(&mut self) {
        self.index = None;
        self.active_range = None;
    }
    pub fn clear(&mut self) {
        *self = Self::default();
    }
    pub fn active_start(&self, term: &Terminal<'_, '_>) -> Result<Option<PointCoordinate>, String> {
        let Some(active) = &self.active else {
            return Ok(None);
        };
        if term.active_screen().map_err(|e| e.to_string())? != active.screen {
            return Ok(None);
        }
        active
            .start
            .point(PointSpace::Screen)
            .map_err(|e| e.to_string())
    }
    pub fn find(
        &mut self,
        term: &mut Terminal<'_, '_>,
        query: &str,
        forward: bool,
        incremental: bool,
    ) -> Result<bool, String> {
        SearchCommand::Find {
            query: query.into(),
            forward,
            incremental,
        }
        .validate()?;
        if query.is_empty() {
            self.clear();
            return Ok(false);
        }
        let query = folded(query);
        let same_query = query == self.query;
        if !same_query {
            self.active_range = None;
        }
        self.query = query;
        if self.index.is_none() {
            let rows = u32::try_from(term.total_rows().map_err(|e| e.to_string())?)
                .map_err(|_| "terminal search row range is too large")?;
            self.index = Some(Index::read(term, 0..rows)?);
        }
        let index = self.index.as_ref().unwrap();
        let anchor = if same_query || incremental {
            self.active_start(term)?
        } else {
            None
        };
        let offset = if let Some(range) = &self.active_range {
            Some(range.start)
        } else if let Some(point) = anchor {
            index.offset(term, point)?
        } else {
            None
        };
        let origin = if let Some(offset) = offset {
            offset
        } else {
            let viewport = term.scrollbar().map_err(|e| e.to_string())?;
            let y = if forward {
                viewport.offset
            } else {
                viewport.offset.saturating_add(viewport.len)
            };
            index
                .rows
                .iter()
                .find(|r| u64::from(r.row) == y)
                .map_or(index.text.len(), |r| r.range.start)
        };
        let mut first = None;
        let mut last = None;
        let mut chosen = None;
        for start in matches(&index.text, &self.query) {
            first.get_or_insert(start);
            last = Some(start);
            if forward {
                if chosen.is_none()
                    && (start > origin || ((incremental || offset.is_none()) && start == origin))
                {
                    chosen = Some(start);
                }
            } else if start < origin || (incremental && start == origin) {
                chosen = Some(start);
            }
        }
        let Some(start) = chosen.or(if forward { first } else { last }) else {
            self.active = None;
            self.active_range = None;
            return Ok(false);
        };
        let range = start..start + self.query.len();
        let mut cells = BTreeMap::new();
        let start = index.point(term, range.start, false, &mut cells)?;
        let end = index.point(term, range.end - 1, true, &mut cells)?;
        self.active = Some(Anchor {
            start: term
                .track_grid_ref(Point::Screen(start))
                .map_err(|e| e.to_string())?,
            end: term
                .track_grid_ref(Point::Screen(end))
                .map_err(|e| e.to_string())?,
            screen: term.active_screen().map_err(|e| e.to_string())?,
        });
        self.active_range = Some(range);

        let rows = usize::from(term.rows().map_err(|e| e.to_string())?);
        term.scroll_viewport(ScrollViewport::Row(
            (start.y as usize).saturating_sub(rows / 2),
        ));
        Ok(true)
    }
    pub fn highlights(&self, term: &Terminal<'_, '_>) -> Result<Vec<u8>, String> {
        if self.query.is_empty() {
            return Ok(Vec::new());
        }
        let viewport = term.scrollbar().map_err(|e| e.to_string())?;
        let total = term.total_rows().map_err(|e| e.to_string())?;
        let cols = term.cols().map_err(|e| e.to_string())?;
        let rows = term.rows().map_err(|e| e.to_string())?;
        let mut start =
            u32::try_from(viewport.offset).map_err(|_| "terminal search row range is too large")?;
        let mut end = u32::try_from(
            viewport
                .offset
                .saturating_add(viewport.len)
                .min(total as u64),
        )
        .map_err(|_| "terminal search row range is too large")?;
        let context_rows = if self.query.contains(['σ', 'ς']) {
            total
        } else {
            self.query.len()
        };
        for _ in 0..context_rows {
            if start == 0 || !wrapped(term, start - 1)? {
                break;
            }
            start -= 1;
        }
        for _ in 0..context_rows {
            if end == 0 || end as usize >= total || !wrapped(term, end - 1)? {
                break;
            }
            end += 1;
        }
        let index = Index::read(term, start..end)?;
        let active_start = self.active_start(term)?;
        let active_end = if active_start.is_some() {
            self.active
                .as_ref()
                .unwrap()
                .end
                .point(PointSpace::Screen)
                .map_err(|e| e.to_string())?
        } else {
            None
        };

        let mut highlights = vec![0u8; usize::from(cols) * usize::from(rows)];
        let mut cells = BTreeMap::new();
        for at in matches(&index.text, &self.query) {
            let start = index.point(term, at, false, &mut cells)?;
            let end = index.point(term, at + self.query.len() - 1, true, &mut cells)?;
            let active = active_start == Some(start) && active_end == Some(end);
            for row in start.y..=end.y {
                let Some(y) = (row as usize)
                    .checked_sub(
                        usize::try_from(viewport.offset)
                            .map_err(|_| "terminal search row is too large")?,
                    )
                    .filter(|&y| y < usize::from(rows))
                else {
                    continue;
                };
                let left = if row == start.y { start.x } else { 0 };
                let right = if row == end.y {
                    end.x.saturating_add(1).min(cols)
                } else {
                    cols
                };
                for cell in &mut highlights[y * usize::from(cols) + usize::from(left)
                    ..y * usize::from(cols) + usize::from(right)]
                {
                    *cell = (*cell).max(if active { 2 } else { 1 });
                }
            }
        }
        Ok(highlights)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::pty::engine::selection::{SelectionCommand, SelectionState};
    use libghostty_vt::{Terminal, TerminalOptions};

    fn terminal(cols: u16, rows: u16) -> Terminal<'static, 'static> {
        Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: 1024 * 1024,
        })
        .unwrap()
    }
    fn find(
        state: &mut SearchState,
        term: &mut Terminal<'_, '_>,
        query: &str,
        forward: bool,
        incremental: bool,
    ) -> bool {
        state.find(term, query, forward, incremental).unwrap()
    }
    fn active(state: &SearchState, term: &Terminal<'_, '_>) -> (u16, u32) {
        let point = state.active_start(term).unwrap().unwrap();
        (point.x, point.y)
    }
    #[test]
    fn navigates_both_directions_wraps_and_incremental_keeps_the_result() {
        let mut term = terminal(24, 3);
        term.vt_write(b"one ONE one");
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "one", true, true));
        assert_eq!(active(&state, &term), (0, 0));
        assert!(find(&mut state, &mut term, "ONE", true, true));
        assert_eq!(active(&state, &term), (0, 0));
        assert!(find(&mut state, &mut term, "one", true, false));
        assert_eq!(active(&state, &term), (4, 0));
        assert!(find(&mut state, &mut term, "one", false, false));
        assert_eq!(active(&state, &term), (0, 0));
        assert!(find(&mut state, &mut term, "one", false, false));
        assert_eq!(active(&state, &term), (8, 0));
        assert_eq!(
            &state.highlights(&term).unwrap()[..11],
            &[1, 1, 1, 0, 1, 1, 1, 0, 2, 2, 2]
        );
    }
    #[test]
    fn finds_retained_history_before_the_text_api_tail_and_scrolls_to_it() {
        let mut term = terminal(32, 3);
        term.vt_write(b"old-needle\r\n");
        for _ in 0..1200 {
            term.vt_write(b"ordinary row\r\n");
        }
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "old-needle", true, false));
        assert_eq!(active(&state, &term), (0, 0));
        assert_eq!(term.scrollbar().unwrap().offset, 0);
    }
    #[test]
    fn maps_combining_wide_and_case_expanding_text_across_soft_wraps() {
        let mut term = terminal(8, 4);
        term.vt_write("xx e\u{301}中AbCd".as_bytes());
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "E\u{301}中abcd", true, false));
        assert_eq!(active(&state, &term), (3, 0));
        let highlights = state.highlights(&term).unwrap();
        assert_eq!(&highlights[3..8], &[2, 2, 2, 2, 2]);
        assert_eq!(&highlights[8..10], &[2, 2]);
        state.clear();
        assert!(state.find(&mut term, "中ab\nc", true, false).is_err());
    }
    #[test]
    fn respects_hard_breaks_gaps_and_wide_wrap_spacers() {
        let mut term = terminal(4, 4);
        term.vt_write("abc中de".as_bytes());
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "c中d", true, false));
        term.vt_write(b"\x1bcab\r\ncd");
        state.invalidate();
        assert!(!find(&mut state, &mut term, "abcd", true, false));
        term.vt_write(b"\x1bcab  cd");
        state.invalidate();
        assert!(!find(&mut state, &mut term, "abcd", true, false));
        assert!(find(&mut state, &mut term, "ab  cd", true, false));
    }
    #[test]
    fn anchors_follow_reflow_and_output_and_alternate_screens_are_separate() {
        let mut term = terminal(16, 3);
        term.vt_write(b"prefix needle needle");
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "needle", true, true));
        term.resize(8, 3, 0, 0).unwrap();
        state.invalidate();
        assert!(find(&mut state, &mut term, "needle", true, true));
        assert_eq!(active(&state, &term), (7, 0));
        assert!(find(&mut state, &mut term, "needle", true, false));
        assert_eq!(active(&state, &term), (6, 1));
        term.vt_write(b"\x1b[?1049h\x1b[Halternate");
        state.invalidate();
        assert!(!find(&mut state, &mut term, "needle", true, true));
        term.vt_write(b"\x1b[?1049l");
        state.invalidate();
        assert!(find(&mut state, &mut term, "needle", true, true));
    }
    #[test]
    fn clearing_and_failed_matches_preserve_the_user_selection() {
        let mut term = terminal(24, 3);
        term.vt_write(b"selected and searchable");
        let mut selection = SelectionState::default();
        let selected = selection.apply(&term, &SelectionCommand::All).unwrap();
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "search", true, true));
        assert!(!find(&mut state, &mut term, "missing", true, true));
        assert!(state.highlights(&term).unwrap().iter().all(|&n| n == 0));
        state.clear();
        assert!(state.highlights(&term).unwrap().is_empty());
        assert_eq!(
            selection.apply(&term, &SelectionCommand::Read).unwrap(),
            selected
        );
        selection.reset(&term);
    }
    #[test]
    fn overlapping_matches_and_case_expansion_keep_exact_cell_positions() {
        let mut term = terminal(24, 3);
        term.vt_write("banana İ i\u{307}".as_bytes());
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "ana", true, true));
        assert_eq!(active(&state, &term), (1, 0));
        assert_eq!(&state.highlights(&term).unwrap()[..6], &[0, 2, 2, 2, 1, 1]);
        assert!(find(&mut state, &mut term, "ana", true, false));
        assert_eq!(active(&state, &term), (3, 0));
        assert!(find(&mut state, &mut term, "i\u{307}", true, true));
        assert_eq!(active(&state, &term), (7, 0));
        assert_eq!(state.highlights(&term).unwrap()[7], 2);
    }
    #[test]
    fn an_anchor_in_erased_text_cannot_skip_matches_in_the_following_rows() {
        let mut term = terminal(24, 4);
        term.vt_write(b"long-prefix needle\r\nneedle\r\nneedle");
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "needle", true, true));
        assert_eq!(active(&state, &term), (12, 0));
        term.vt_write(b"\x1b[H\x1b[2K");
        state.invalidate();
        assert!(find(&mut state, &mut term, "needle", true, true));
        assert_eq!(active(&state, &term), (0, 1));
    }
    #[test]
    fn unicode_contextual_lowercase_is_preserved_across_soft_wraps() {
        let mut term = terminal(4, 4);
        term.vt_write("xxxΟΣ İ".as_bytes());
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "ος", true, true));
        assert_eq!(active(&state, &term), (3, 0));
        let highlights = state.highlights(&term).unwrap();
        assert_eq!(highlights[3], 2);
        assert_eq!(highlights[4], 2);
        assert!(find(&mut state, &mut term, "i\u{307}", true, true));
        assert_eq!(active(&state, &term), (2, 1));
    }
    #[test]
    fn visible_sigma_matches_use_context_beyond_the_query_length() {
        let mut term = terminal(4, 2);
        term.vt_write(format!("AΣ{}B", "'".repeat(40)).as_bytes());
        let mut state = SearchState::default();
        assert!(find(&mut state, &mut term, "σ", true, true));
        assert_eq!(active(&state, &term), (1, 0));
        assert_eq!(state.highlights(&term).unwrap()[1], 2);
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockMatch {
    pub index: u16,
    pub line: u32,
    pub col: u16,
    pub len: u16,
}
#[derive(Default)]
pub(super) struct BlockSearchState {
    version: u64,
    query: String,
    matches: Vec<Anchor>,
    active: Option<usize>,
}
impl BlockSearchState {
    fn next_version(&self) -> Result<u64, String> {
        self.version
            .checked_add(1)
            .filter(|value| *value <= 9_007_199_254_740_991)
            .ok_or_else(|| "terminal block search version exhausted".into())
    }
    pub fn is_active(&self) -> bool {
        !self.query.is_empty()
    }
    pub fn clear(&mut self) -> Result<(), String> {
        let next = self.next_version()?;
        self.query.clear();
        self.matches.clear();
        self.active = None;
        self.version = next;
        Ok(())
    }
    pub fn find(
        &mut self,
        term: &Terminal<'_, '_>,
        bounds: Option<(PointCoordinate, PointCoordinate)>,
        query: &str,
    ) -> Result<(u64, Vec<BlockMatch>), String> {
        SearchCommand::Find {
            query: query.into(),
            forward: true,
            incremental: true,
        }
        .validate()?;
        let next = self.next_version()?;
        let query = folded(query);
        let mut anchors = Vec::new();
        let mut result = Vec::new();
        if let Some(bounds) = bounds.filter(|_| !query.is_empty()) {
            let end = bounds
                .1
                .y
                .checked_add(1)
                .ok_or("terminal block search range is too large")?;
            let index = Index::read_clipped(term, bounds.0.y..end, Some(bounds))?;
            let mut cells = BTreeMap::new();
            for at in matches(&index.text, &query).take(500) {
                let start = index.point(term, at, false, &mut cells)?;
                let end = index.point(term, at + query.len() - 1, true, &mut cells)?;
                let len = if start.y == end.y {
                    end.x - start.x + 1
                } else {
                    term.cols().map_err(|error| error.to_string())? - start.x
                };
                result.push(BlockMatch {
                    index: result.len() as u16,
                    line: start.y,
                    col: start.x,
                    len,
                });
                anchors.push(Anchor {
                    start: term
                        .track_grid_ref(Point::Screen(start))
                        .map_err(|error| error.to_string())?,
                    end: term
                        .track_grid_ref(Point::Screen(end))
                        .map_err(|error| error.to_string())?,
                    screen: term.active_screen().map_err(|error| error.to_string())?,
                });
            }
        }
        self.query = query;
        self.matches = anchors;
        self.active = None;
        self.version = next;
        Ok((next, result))
    }
    pub fn reveal(
        &mut self,
        term: &mut Terminal<'_, '_>,
        version: u64,
        index: u16,
    ) -> Result<bool, String> {
        if version != self.version {
            return Ok(false);
        }
        let Some(anchor) = self.matches.get(usize::from(index)) else {
            return Ok(false);
        };
        if term.active_screen().map_err(|error| error.to_string())? != anchor.screen {
            return Ok(false);
        }
        let Some(start) = anchor
            .start
            .point(PointSpace::Screen)
            .map_err(|error| error.to_string())?
        else {
            return Ok(false);
        };
        if anchor
            .end
            .point(PointSpace::Screen)
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok(false);
        }
        self.active = Some(usize::from(index));
        let rows = usize::from(term.rows().map_err(|error| error.to_string())?);
        term.scroll_viewport(ScrollViewport::Row(
            (start.y as usize).saturating_sub(rows / 2),
        ));
        Ok(true)
    }
    pub fn highlights(&self, term: &Terminal<'_, '_>) -> Result<Vec<u8>, String> {
        if !self.is_active() {
            return Ok(Vec::new());
        }
        let screen = term.active_screen().map_err(|error| error.to_string())?;
        let viewport = term.scrollbar().map_err(|error| error.to_string())?;
        let cols = term.cols().map_err(|error| error.to_string())?;
        let rows = term.rows().map_err(|error| error.to_string())?;
        let mut result = vec![0; usize::from(cols) * usize::from(rows)];
        for (index, anchor) in self.matches.iter().enumerate() {
            if anchor.screen != screen {
                continue;
            }
            let Some(start) = anchor
                .start
                .point(PointSpace::Screen)
                .map_err(|error| error.to_string())?
            else {
                continue;
            };
            let Some(end) = anchor
                .end
                .point(PointSpace::Screen)
                .map_err(|error| error.to_string())?
            else {
                continue;
            };
            if end.y < start.y || (end.y == start.y && end.x < start.x) {
                continue;
            }
            let from = u64::from(start.y).max(viewport.offset);
            let until = u64::from(end.y)
                .saturating_add(1)
                .min(viewport.offset + u64::from(rows));
            for row in from..until {
                let first = if row == u64::from(start.y) {
                    start.x
                } else {
                    0
                };
                let last = if row == u64::from(end.y) {
                    end.x.min(cols - 1)
                } else {
                    cols - 1
                };
                for col in first..=last {
                    let slot =
                        ((row - viewport.offset) as usize) * usize::from(cols) + usize::from(col);
                    if let Some(value) = result.get_mut(slot) {
                        *value = (*value).max(if self.active == Some(index) { 2 } else { 1 });
                    }
                }
            }
        }
        Ok(result)
    }
}
