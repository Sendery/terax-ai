use std::collections::VecDeque;
use std::sync::Arc;

use libghostty_vt::render::CellIteration;
use libghostty_vt::screen::{Cell, CellContentTag, CellWide, GridRef};
use libghostty_vt::terminal::{Point, PointCoordinate};
use libghostty_vt::{Error, Terminal};
use serde::Serialize;

const FRAME_COUNT: usize = 3;
const WINDOW_UNITS: usize = 4096;
const MAX_ROW_BYTES: usize = 16384;
const MAX_CLUSTER_CHARS: usize = 4096;
const MAX_URI_BYTES: usize = 8192;
const MAX_ROW_URI_BYTES: usize = 32768;
const BLOCKED_URI: u16 = u16::MAX;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LinkRange {
    pub row: u16,
    pub start: u16,
    pub end: u16,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Osc8Link {
    pub uri: String,
    pub ranges: Vec<LinkRange>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkContextRow {
    pub row: u16,
    pub start_col: u16,
    pub cells: Vec<[u32; 2]>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkContext {
    pub seq: u32,
    pub cols: u16,
    pub viewport_rows: u16,
    pub text: String,
    pub offset: u32,
    pub start_clipped: bool,
    pub end_clipped: bool,
    pub rows: Vec<LinkContextRow>,
    pub osc8: Option<Osc8Link>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CellMap {
    start: u16,
    end: u16,
    uri: u16,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LinkRow {
    text: String,
    units: u16,
    cells: Vec<CellMap>,
    uris: Vec<Arc<str>>,
    wrapped: bool,
    continuation: bool,
}
impl LinkRow {
    fn uri(&self, col: usize) -> Option<&str> {
        let cell = self.cells.get(col)?;
        match cell.uri {
            0 => None,
            BLOCKED_URI => Some(""),
            id => Some(self.uris.get(usize::from(id) - 1)?.as_ref()),
        }
    }
}

enum Uri<'a> {
    None,
    Value(&'a str),
    Blocked,
}
pub struct CellData<'a> {
    cluster: Option<&'a str>,
    uri: Uri<'a>,
    valid: bool,
}
#[derive(Default)]
pub struct LinkScratch {
    cluster: String,
    chars: Vec<char>,
    uri: Vec<u8>,
}
impl LinkScratch {
    fn read_uri<'a>(grid: &GridRef<'_>, buf: &'a mut Vec<u8>) -> Uri<'a> {
        if buf.is_empty() {
            buf.resize(256, 0);
        }
        let len = match grid.hyperlink_uri(buf) {
            Ok(len) => len,
            Err(Error::OutOfSpace { required }) if required <= MAX_URI_BYTES => {
                buf.resize(required, 0);
                match grid.hyperlink_uri(buf) {
                    Ok(len) => len,
                    Err(_) => return Uri::Blocked,
                }
            }
            Err(_) => return Uri::Blocked,
        };
        if len == 0 {
            return Uri::Blocked;
        }
        if len > MAX_URI_BYTES || len > buf.len() {
            return Uri::Blocked;
        }
        match std::str::from_utf8(&buf[..len]) {
            Ok(uri) => Uri::Value(uri),
            Err(_) => Uri::Blocked,
        }
    }
    pub fn rendered<'a>(
        &'a mut self,
        term: &Terminal<'_, '_>,
        point: PointCoordinate,
        cell: &CellIteration<'_, '_>,
        raw: Cell,
        features: (bool, bool),
    ) -> CellData<'a> {
        self.cluster.clear();
        let (has_graphemes, has_links) = features;
        let complex =
            has_graphemes && raw.content_tag().ok() == Some(CellContentTag::CodepointGrapheme);
        if complex {
            let Some(len) = cell
                .graphemes_len()
                .ok()
                .filter(|&n| n <= MAX_CLUSTER_CHARS)
            else {
                return CellData {
                    cluster: None,
                    uri: Uri::None,
                    valid: false,
                };
            };
            if len > 0 && cell.graphemes_utf8(&mut self.cluster).is_err() {
                return CellData {
                    cluster: None,
                    uri: Uri::None,
                    valid: false,
                };
            }
        }
        let uri = if has_links && raw.has_hyperlink().unwrap_or(false) {
            match term.grid_ref(Point::Viewport(point)) {
                Ok(grid) => Self::read_uri(&grid, &mut self.uri),
                Err(_) => Uri::Blocked,
            }
        } else {
            Uri::None
        };
        CellData {
            cluster: complex.then_some(self.cluster.as_str()),
            uri,
            valid: true,
        }
    }
    fn grid<'a>(&'a mut self, grid: &GridRef<'_>, raw: Cell) -> CellData<'a> {
        self.cluster.clear();
        let complex = raw.content_tag().ok() == Some(CellContentTag::CodepointGrapheme);
        if complex {
            if self.chars.is_empty() {
                self.chars.resize(32, '\0');
            }
            let len = match grid.graphemes(&mut self.chars) {
                Ok(len) => len,
                Err(Error::OutOfSpace { required }) if required <= MAX_CLUSTER_CHARS => {
                    self.chars.resize(required, '\0');
                    match grid.graphemes(&mut self.chars) {
                        Ok(len) => len,
                        Err(_) => {
                            return CellData {
                                cluster: None,
                                uri: Uri::None,
                                valid: false,
                            }
                        }
                    }
                }
                Err(_) => {
                    return CellData {
                        cluster: None,
                        uri: Uri::None,
                        valid: false,
                    }
                }
            };
            if len > self.chars.len() || len > MAX_CLUSTER_CHARS {
                return CellData {
                    cluster: None,
                    uri: Uri::None,
                    valid: false,
                };
            }
            self.cluster.extend(&self.chars[..len]);
        }
        let uri = if raw.has_hyperlink().unwrap_or(false) {
            Self::read_uri(grid, &mut self.uri)
        } else {
            Uri::None
        };
        CellData {
            cluster: complex.then_some(self.cluster.as_str()),
            uri,
            valid: true,
        }
    }
}
pub struct LinkRowBuilder {
    row: LinkRow,
    meaningful_bytes: usize,
    meaningful_units: u16,
    uri_bytes: usize,
    cols: u16,
    valid: bool,
}
impl LinkRowBuilder {
    pub fn new(cols: u16, wrapped: bool, continuation: bool) -> Self {
        Self {
            row: LinkRow {
                text: String::new(),
                units: 0,
                cells: Vec::with_capacity(usize::from(cols)),
                uris: Vec::new(),
                wrapped,
                continuation,
            },
            meaningful_bytes: 0,
            meaningful_units: 0,
            uri_bytes: 0,
            cols,
            valid: true,
        }
    }
    pub fn valid(&self) -> bool {
        self.valid
    }
    pub fn push(&mut self, codepoint: u32, wide: CellWide, data: CellData<'_>) {
        if !self.valid {
            return;
        }
        if !data.valid {
            self.valid = false;
            return;
        }
        if wide == CellWide::SpacerTail {
            let cell = self.row.cells.last().copied().unwrap_or(CellMap {
                start: self.row.units,
                end: self.row.units,
                uri: 0,
            });
            self.row.cells.push(cell);
            return;
        }
        if wide == CellWide::SpacerHead {
            self.row.cells.push(CellMap {
                start: self.row.units,
                end: self.row.units,
                uri: 0,
            });
            return;
        }
        let start = self.row.units;
        let bytes = self.row.text.len();
        if let Some(cluster) = data.cluster {
            if self.row.text.len().saturating_add(cluster.len()) > MAX_ROW_BYTES {
                self.valid = false;
                return;
            }
            self.row.text.push_str(cluster);
            self.row.units += cluster.encode_utf16().count() as u16;
        } else {
            let Some(ch) = char::from_u32(if codepoint == 0 { 32 } else { codepoint }) else {
                self.valid = false;
                return;
            };
            if self.row.text.len() + ch.len_utf8() > MAX_ROW_BYTES {
                self.valid = false;
                return;
            }
            self.row.text.push(ch);
            self.row.units += ch.len_utf16() as u16;
        }
        let uri = match data.uri {
            Uri::None => 0,
            Uri::Blocked => BLOCKED_URI,
            Uri::Value(value) => {
                if let Some(id) = self
                    .row
                    .uris
                    .iter()
                    .position(|known| known.as_ref() == value)
                {
                    (id + 1) as u16
                } else if value.len() > MAX_URI_BYTES
                    || self.uri_bytes.saturating_add(value.len()) > MAX_ROW_URI_BYTES
                {
                    BLOCKED_URI
                } else {
                    self.uri_bytes += value.len();
                    self.row.uris.push(Arc::from(value));
                    self.row.uris.len() as u16
                }
            }
        };
        self.row.cells.push(CellMap {
            start,
            end: self.row.units,
            uri,
        });
        if codepoint != 0 || data.cluster.is_some_and(|cluster| !cluster.is_empty()) {
            self.meaningful_bytes = self.row.text.len();
            self.meaningful_units = self.row.units;
        }
        if self.row.text.len() == bytes {
            self.valid = false;
        }
    }
    pub fn finish(mut self) -> Option<LinkRow> {
        if !self.valid || self.row.cells.len() != usize::from(self.cols) {
            return None;
        }
        if !self.row.wrapped {
            self.row.text.truncate(self.meaningful_bytes);
            self.row.units = self.meaningful_units;
        }
        Some(self.row)
    }
}
struct LinkView {
    seq: u32,
    cols: u16,
    viewport_rows: u16,
    viewport_start: usize,
    rows: Vec<Option<Arc<LinkRow>>>,
    before_clipped: bool,
    after_clipped: bool,
}
#[derive(Default)]
pub struct LinkCache {
    cols: u16,
    rows: u16,
    working: Vec<Option<Arc<LinkRow>>>,
    frames: VecDeque<LinkView>,
    scratch: LinkScratch,
}
impl LinkCache {
    pub fn prepare(&mut self, cols: u16, rows: u16) {
        if (cols, rows) != (self.cols, self.rows) {
            self.cols = cols;
            self.rows = rows;
            self.working = vec![None; usize::from(rows)];
        }
    }
    pub fn update_row(&mut self, y: u16, row: Option<LinkRow>) {
        let slot = &mut self.working[usize::from(y)];
        if slot.as_deref() == row.as_ref() {
            return;
        }
        *slot = row.map(Arc::new);
    }
    fn grid_row(&mut self, term: &Terminal<'_, '_>, y: u32) -> Option<Arc<LinkRow>> {
        let raw_row = term
            .grid_ref(Point::Screen(PointCoordinate { x: 0, y }))
            .ok()?
            .row()
            .ok()?;
        let mut builder = LinkRowBuilder::new(
            self.cols,
            raw_row.is_wrapped().ok()?,
            raw_row.is_wrap_continuation().ok()?,
        );
        for x in 0..self.cols {
            let grid = term
                .grid_ref(Point::Screen(PointCoordinate { x, y }))
                .ok()?;
            let raw = grid.cell().ok()?;
            let wide = raw.wide().ok()?;
            let codepoint = if matches!(wide, CellWide::SpacerHead | CellWide::SpacerTail) {
                0
            } else {
                raw.codepoint().ok()?
            };
            let data = self.scratch.grid(&grid, raw);
            builder.push(codepoint, wide, data);
            if !builder.valid() {
                return None;
            }
        }
        builder.finish().map(Arc::new)
    }
    pub fn commit(&mut self, term: &Terminal<'_, '_>, seq: u32) -> Result<(), Error> {
        let scrollbar = term.scrollbar()?;
        let total = term.total_rows()?;
        let offset = usize::try_from(scrollbar.offset).map_err(|_| Error::InvalidValue)?;
        let mut above = Vec::new();
        let mut used = 0usize;
        let mut before_clipped = false;
        let continuation = self
            .working
            .first()
            .and_then(Option::as_ref)
            .is_some_and(|row| row.continuation);
        if continuation {
            let mut y = offset;
            while y > 0 {
                if used >= WINDOW_UNITS || above.len() >= WINDOW_UNITS {
                    before_clipped = true;
                    break;
                }
                y -= 1;
                let row = self.grid_row(term, u32::try_from(y).map_err(|_| Error::InvalidValue)?);
                let Some(row) = row else {
                    before_clipped = true;
                    break;
                };
                if !row.wrapped {
                    break;
                }
                used += usize::from(row.units);
                let more = row.continuation;
                above.push(Some(row));
                if !more {
                    break;
                }
            }
        }
        above.reverse();
        let viewport_start = above.len();
        above.extend(self.working.iter().cloned());
        let mut after_clipped = false;
        used = 0;
        let mut more = above
            .last()
            .and_then(Option::as_ref)
            .is_some_and(|row| row.wrapped);
        let mut y = offset + usize::from(self.rows);
        let mut extra = 0;
        while more && y < total {
            if used >= WINDOW_UNITS || extra >= WINDOW_UNITS {
                after_clipped = true;
                break;
            }
            let row = self.grid_row(term, u32::try_from(y).map_err(|_| Error::InvalidValue)?);
            let Some(row) = row else {
                after_clipped = true;
                break;
            };
            used += usize::from(row.units);
            more = row.wrapped;
            above.push(Some(row));
            extra += 1;
            y += 1;
        }
        self.frames.push_back(LinkView {
            seq,
            cols: self.cols,
            viewport_rows: self.rows,
            viewport_start,
            rows: above,
            before_clipped,
            after_clipped,
        });
        while self.frames.len() > FRAME_COUNT {
            self.frames.pop_front();
        }
        Ok(())
    }
    pub fn query(&self, seq: u32, col: u16, row: u16) -> Result<Option<LinkContext>, String> {
        if seq == 0 || col >= super::MAX_COLS || row >= super::MAX_ROWS {
            return Err("invalid terminal link coordinates".into());
        }
        let Some(frame) = self.frames.iter().rev().find(|frame| frame.seq == seq) else {
            return Ok(None);
        };
        if col >= frame.cols || row >= frame.viewport_rows {
            return Err("terminal link coordinates are outside the frame".into());
        }
        frame.query(col, row)
    }
}
fn byte_at_units(text: &str, units: usize) -> usize {
    let mut count = 0;
    for (at, ch) in text.char_indices() {
        if count == units {
            return at;
        }
        count += ch.len_utf16();
    }
    text.len()
}
impl LinkView {
    fn visible_row(&self, row: usize) -> Option<&LinkRow> {
        self.rows.get(self.viewport_start + row)?.as_deref()
    }
    fn osc8(&self, col: u16, row: u16) -> Option<Osc8Link> {
        let uri = self.visible_row(usize::from(row))?.uri(usize::from(col))?;
        let cols = usize::from(self.cols);
        let total = cols * usize::from(self.viewport_rows);
        let at = usize::from(row) * cols + usize::from(col);
        let matches = |at: usize| {
            self.visible_row(at / cols)
                .and_then(|row| row.uri(at % cols))
                == Some(uri)
        };
        let mut start = at;
        let mut end = at + 1;
        while start > 0 && matches(start - 1) {
            start -= 1;
        }
        while end < total && matches(end) {
            end += 1;
        }
        let mut ranges = Vec::new();
        for y in start / cols..=(end - 1) / cols {
            ranges.push(LinkRange {
                row: y as u16,
                start: if y == start / cols {
                    (start % cols) as u16
                } else {
                    0
                },
                end: if y == (end - 1) / cols {
                    ((end - 1) % cols + 1) as u16
                } else {
                    self.cols
                },
            });
        }
        Some(Osc8Link {
            uri: uri.into(),
            ranges,
        })
    }
    fn query(&self, col: u16, row: u16) -> Result<Option<LinkContext>, String> {
        let index = self.viewport_start + usize::from(row);
        let Some(hit_row) = self.rows.get(index).and_then(Option::as_deref) else {
            return Ok(None);
        };
        let Some(hit) = hit_row
            .cells
            .get(usize::from(col))
            .filter(|cell| cell.end > cell.start && cell.start < hit_row.units)
        else {
            return Ok(None);
        };
        let mut first = index;
        let mut last = index + 1;
        while first > 0 && self.rows[first - 1].as_ref().is_some_and(|row| row.wrapped) {
            first -= 1;
        }
        while last < self.rows.len()
            && self.rows[last - 1].as_ref().is_some_and(|row| row.wrapped)
            && self.rows[last].is_some()
        {
            last += 1;
        }
        let selected = &self.rows[first..last];
        let mut prefix = Vec::with_capacity(selected.len() + 1);
        prefix.push(0usize);
        for row in selected {
            prefix.push(
                prefix.last().copied().unwrap()
                    + row.as_ref().map_or(0, |row| usize::from(row.units)),
            );
        }
        let total = *prefix.last().unwrap();
        let offset = prefix[index - first] + usize::from(hit.start);
        let mut lower = offset.saturating_sub(WINDOW_UNITS / 2);
        let mut upper = (lower + WINDOW_UNITS).min(total);
        if upper == total {
            lower = total.saturating_sub(WINDOW_UNITS);
        }
        for (i, row) in selected.iter().enumerate() {
            let Some(row) = row else {
                continue;
            };
            for cell in &row.cells {
                let start = prefix[i] + usize::from(cell.start);
                let end = prefix[i] + usize::from(cell.end);
                if start < lower && lower < end {
                    lower = start;
                }
                if start < upper && upper < end {
                    upper = end;
                }
            }
        }
        let mut text = String::new();
        let mut maps = Vec::new();
        for (i, row) in selected.iter().enumerate() {
            let Some(row) = row else {
                continue;
            };
            let base = prefix[i];
            let units = usize::from(row.units);
            if base >= upper || base + units <= lower {
                continue;
            }
            let local_start = lower.saturating_sub(base);
            let local_end = upper.saturating_sub(base).min(units);
            text.push_str(
                &row.text
                    [byte_at_units(&row.text, local_start)..byte_at_units(&row.text, local_end)],
            );
            let absolute_row = first + i;
            if absolute_row < self.viewport_start
                || absolute_row >= self.viewport_start + usize::from(self.viewport_rows)
            {
                continue;
            }
            let matches = |cell: &&CellMap| {
                base + usize::from(cell.end) > lower
                    && base + usize::from(cell.start) < upper
                    && cell.end > cell.start
            };
            let Some(start_col) = row.cells.iter().position(|cell| matches(&cell)) else {
                continue;
            };
            let end_col = row.cells.iter().rposition(|cell| matches(&cell)).unwrap();
            let cells = row.cells[start_col..=end_col]
                .iter()
                .map(|cell| {
                    [
                        (base + usize::from(cell.start))
                            .saturating_sub(lower)
                            .min(upper - lower) as u32,
                        (base + usize::from(cell.end))
                            .saturating_sub(lower)
                            .min(upper - lower) as u32,
                    ]
                })
                .collect();
            maps.push(LinkContextRow {
                row: (absolute_row - self.viewport_start) as u16,
                start_col: start_col as u16,
                cells,
            });
        }
        Ok(Some(LinkContext {
            seq: self.seq,
            cols: self.cols,
            viewport_rows: self.viewport_rows,
            text,
            offset: (offset - lower) as u32,
            start_clipped: lower > 0
                || selected
                    .first()
                    .and_then(Option::as_ref)
                    .is_some_and(|row| row.continuation)
                || (first == 0 && self.before_clipped),
            end_clipped: upper < total
                || (last < self.rows.len()
                    && self.rows[last].is_none()
                    && selected
                        .last()
                        .and_then(Option::as_ref)
                        .is_some_and(|row| row.wrapped))
                || (last == self.rows.len() && self.after_clipped),
            rows: maps,
            osc8: self.osc8(col, row),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::super::snapshot::Snapshotter;
    use super::*;
    use libghostty_vt::terminal::ScrollViewport;
    use libghostty_vt::{Terminal, TerminalOptions};

    fn terminal(cols: u16, rows: u16) -> Terminal<'static, 'static> {
        Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: 1024 * 1024,
        })
        .unwrap()
    }
    fn capture(snapshot: &mut Snapshotter, term: &Terminal<'static, 'static>, seq: u32) {
        assert!(snapshot.build(term, seq, true).unwrap().is_some());
    }
    #[test]
    fn queries_the_drawn_frame_instead_of_later_pty_text_or_hyperlinks() {
        let mut term = terminal(24, 3);
        term.vt_write(b"\x1b]8;;https://one.test\x1b\\label\x1b]8;;\x1b\\");
        let mut snapshot = Snapshotter::new().unwrap();
        capture(&mut snapshot, &term, 1);
        let original = snapshot.link_context(1, 2, 0).unwrap().unwrap();
        assert_eq!(original.osc8.as_ref().unwrap().uri, "https://one.test");
        term.vt_write(b"\r\x1b]8;;https://two.test\x1b\\label\x1b]8;;\x1b\\");
        assert_eq!(
            snapshot.link_context(1, 2, 0).unwrap(),
            Some(original.clone())
        );
        capture(&mut snapshot, &term, 2);
        assert_eq!(snapshot.link_context(1, 2, 0).unwrap(), Some(original));
        assert_eq!(
            snapshot
                .link_context(2, 2, 0)
                .unwrap()
                .unwrap()
                .osc8
                .unwrap()
                .uri,
            "https://two.test"
        );
    }
    #[test]
    fn keeps_three_frames_for_final_input_supersession_and_evicts_older_ones() {
        let mut term = terminal(24, 3);
        let mut snapshot = Snapshotter::new().unwrap();
        for seq in 1..=3 {
            term.vt_write(format!("\rframe{seq}").as_bytes());
            capture(&mut snapshot, &term, seq);
        }
        assert!(snapshot
            .link_context(1, 0, 0)
            .unwrap()
            .unwrap()
            .text
            .contains("frame1"));
        term.vt_write(b"\rframe4");
        capture(&mut snapshot, &term, 4);
        assert!(snapshot.link_context(1, 0, 0).unwrap().is_none());
        assert!(snapshot
            .link_context(2, 0, 0)
            .unwrap()
            .unwrap()
            .text
            .contains("frame2"));
        assert!(snapshot.link_context(0, 0, 0).is_err());
        assert!(snapshot.link_context(4, 24, 0).is_err());
    }
    #[test]
    fn maps_utf16_offsets_to_native_graphemes_and_wide_tail_cells() {
        let mut term = terminal(40, 3);
        term.vt_write("e\u{301} 中 😀 file.ts:12:3".as_bytes());
        let mut snapshot = Snapshotter::new().unwrap();
        capture(&mut snapshot, &term, 1);
        let context = snapshot.link_context(1, 8, 0).unwrap().unwrap();
        assert_eq!(context.offset, 8);
        assert!(context.text.starts_with("e\u{301} 中 😀 file.ts:12:3"));
        let head = snapshot.link_context(1, 2, 0).unwrap().unwrap();
        let tail = snapshot.link_context(1, 3, 0).unwrap().unwrap();
        assert_eq!(head.offset, tail.offset);
        assert_eq!(head.rows[0].cells[2], head.rows[0].cells[3]);
    }
    #[test]
    fn soft_wrapped_context_includes_history_above_the_viewport_without_hard_breaks() {
        let mut term = terminal(8, 3);
        term.vt_write(b"https://example.test/long/route\r\nseparate.ts");
        term.scroll_viewport(ScrollViewport::Top);
        term.scroll_viewport(ScrollViewport::Delta(1));
        let mut snapshot = Snapshotter::new().unwrap();
        capture(&mut snapshot, &term, 1);
        let context = snapshot.link_context(1, 2, 0).unwrap().unwrap();
        assert!(
            context.text.contains("https://example.test/long/route"),
            "{}",
            context.text
        );
        assert!(!context.text.contains("separate.ts"));
        assert!(context.rows.iter().all(|row| row.row < 3));
        assert!(!context.start_clipped);
    }
    #[test]
    fn hard_breaks_and_empty_padding_never_create_file_or_url_text() {
        let mut term = terminal(12, 3);
        term.vt_write(b"one.ts\r\ntwo.ts");
        let mut snapshot = Snapshotter::new().unwrap();
        capture(&mut snapshot, &term, 1);
        assert_eq!(
            snapshot.link_context(1, 1, 0).unwrap().unwrap().text,
            "one.ts"
        );
        assert_eq!(
            snapshot.link_context(1, 1, 1).unwrap().unwrap().text,
            "two.ts"
        );
        assert!(snapshot.link_context(1, 10, 0).unwrap().is_none());
    }
    #[test]
    fn osc8_ranges_cover_only_the_contiguous_visible_label() {
        let mut term = terminal(10, 3);
        term.vt_write(b"x \x1b]8;;https://one.test\x1b\\abcdefghijk\x1b]8;;\x1b\\ plain");
        let mut snapshot = Snapshotter::new().unwrap();
        capture(&mut snapshot, &term, 1);
        let link = snapshot
            .link_context(1, 4, 0)
            .unwrap()
            .unwrap()
            .osc8
            .unwrap();
        assert_eq!(
            link.ranges,
            vec![
                LinkRange {
                    row: 0,
                    start: 2,
                    end: 10
                },
                LinkRange {
                    row: 1,
                    start: 0,
                    end: 3
                }
            ]
        );
    }
    #[test]
    fn unavailable_rows_inside_soft_wraps_mark_both_context_edges_as_clipped() {
        fn row(text: &str, wrapped: bool, continuation: bool) -> LinkRow {
            let mut row = LinkRowBuilder::new(8, wrapped, continuation);
            for ch in text.chars().chain(std::iter::repeat(' ')).take(8) {
                row.push(
                    ch as u32,
                    CellWide::Narrow,
                    CellData {
                        cluster: None,
                        uri: Uri::None,
                        valid: true,
                    },
                );
            }
            row.finish().unwrap()
        }
        let mut cache = LinkCache::default();
        cache.prepare(8, 3);
        cache.update_row(0, Some(row("prefix/", true, false)));
        cache.update_row(1, None);
        cache.update_row(2, Some(row("tail.ts", false, true)));
        cache.commit(&terminal(8, 3), 1).unwrap();
        assert!(cache.query(1, 1, 0).unwrap().unwrap().end_clipped);
        assert!(cache.query(1, 1, 2).unwrap().unwrap().start_clipped);
    }
    #[test]
    fn uri_limits_stay_explicit_and_unchanged_rows_share_their_storage() {
        fn row(uri: &str) -> LinkRow {
            let mut builder = LinkRowBuilder::new(8, false, false);
            for ch in "file.ts ".chars() {
                builder.push(
                    ch as u32,
                    CellWide::Narrow,
                    CellData {
                        cluster: None,
                        uri: Uri::Value(uri),
                        valid: true,
                    },
                );
            }
            builder.finish().unwrap()
        }
        let oversized = "x".repeat(MAX_URI_BYTES + 1);
        let mut cache = LinkCache::default();
        cache.prepare(8, 2);
        cache.update_row(0, Some(row(&oversized)));
        cache.commit(&terminal(8, 2), 1).unwrap();
        assert_eq!(cache.query(1, 1, 0).unwrap().unwrap().osc8.unwrap().uri, "");
        let before = cache.working[0].clone().unwrap();
        cache.update_row(0, Some(row(&oversized)));
        assert!(Arc::ptr_eq(&before, cache.working[0].as_ref().unwrap()));
        let mut builder = LinkRowBuilder::new(1, false, false);
        let cluster = "x".repeat(MAX_ROW_BYTES + 1);
        builder.push(
            'x' as u32,
            CellWide::Narrow,
            CellData {
                cluster: Some(&cluster),
                uri: Uri::None,
                valid: true,
            },
        );
        assert!(builder.finish().is_none());
    }
}
