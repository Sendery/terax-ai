//! Frame format v1 (`docs/architecture/terminal-engine.md`): a plain
//! description of rows and cells in, little endian bytes out. No libghostty
//! types here, so the codec builds and is tested without the engine feature.

use std::collections::HashMap;

pub const MAGIC: u32 = 0x3146_5854;
pub const HEADER_LEN: usize = 36;
pub const STYLE_LEN: usize = 16;
pub const ROW_HEADER_LEN: usize = 8;

pub const FLAG_FULL: u8 = 1;
pub const FLAG_CURSOR_BLINK: u8 = 1 << 1;
pub const FLAG_VIEWPORT_SCROLLED: u8 = 1 << 2;

/// Marks a colour as explicit; without it the renderer uses the default.
pub const COLOR_SET: u32 = 1 << 24;
pub const NO_CURSOR_COLOR: u32 = 0xFFFF_FFFF;

pub const CODEPOINT_MASK: u32 = 0x1F_FFFF;
pub const CELL_SPACER_TAIL: u32 = 1 << 30;
pub const CELL_WIDE_HEAD: u32 = 1 << 31;

pub const ATTR_BOLD: u16 = 1;
pub const ATTR_ITALIC: u16 = 1 << 1;
pub const ATTR_FAINT: u16 = 1 << 2;
pub const ATTR_INVERSE: u16 = 1 << 3;
pub const ATTR_INVISIBLE: u16 = 1 << 4;
pub const ATTR_STRIKETHROUGH: u16 = 1 << 5;
pub const ATTR_OVERLINE: u16 = 1 << 6;
pub const ATTR_BLINK: u16 = 1 << 7;
const UNDERLINE_SHIFT: u16 = 8;
const UNDERLINE_MASK: u16 = 0b111 << UNDERLINE_SHIFT;

const ROW_WRAPPED: u16 = 1;
const PROMPT_SHIFT: u16 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CursorStyle {
    Hidden = 0,
    Block = 1,
    Bar = 2,
    Underline = 3,
    HollowBlock = 4,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u16)]
pub enum UnderlineKind {
    None = 0,
    Single = 1,
    Double = 2,
    Curly = 3,
    Dotted = 4,
    Dashed = 5,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u16)]
pub enum SemanticPrompt {
    #[default]
    None = 0,
    Prompt = 1,
    Continuation = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellWidth {
    Narrow,
    WideHead,
    SpacerTail,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct RowFlags {
    pub wrapped: bool,
    pub prompt: SemanticPrompt,
}

impl RowFlags {
    fn bits(self) -> u16 {
        let wrapped = if self.wrapped { ROW_WRAPPED } else { 0 };
        wrapped | ((self.prompt as u16) << PROMPT_SHIFT)
    }
}

pub const fn rgb(r: u8, g: u8, b: u8) -> u32 {
    r as u32 | (g as u32) << 8 | (b as u32) << 16
}

/// An explicit colour: `0x01BBGGRR`.
pub const fn set_rgb(r: u8, g: u8, b: u8) -> u32 {
    rgb(r, g, b) | COLOR_SET
}

/// One entry of the style table. All zero is the default style, entry 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub struct CellStyle {
    pub fg: u32,
    pub bg: u32,
    pub underline_color: u32,
    pub attrs: u16,
}

impl CellStyle {
    pub const DEFAULT: Self = Self {
        fg: 0,
        bg: 0,
        underline_color: 0,
        attrs: 0,
    };

    pub fn set_underline(&mut self, kind: UnderlineKind) {
        self.attrs = (self.attrs & !UNDERLINE_MASK) | ((kind as u16) << UNDERLINE_SHIFT);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameHeader {
    pub seq: u32,
    pub cols: u16,
    pub rows: u16,
    pub cursor_x: u16,
    pub cursor_y: u16,
    pub cursor_style: CursorStyle,
    pub cursor_blink: bool,
    pub viewport_scrolled: bool,
    pub full: bool,
    pub default_fg: u32,
    pub default_bg: u32,
    pub cursor_color: Option<u32>,
}

/// Builds one frame at a time. Every buffer is kept across frames, so steady
/// state encoding does not allocate.
pub struct FrameEncoder {
    out: Vec<u8>,
    rows: Vec<u8>,
    row_count: u16,
    styles: Vec<CellStyle>,
    style_ids: HashMap<CellStyle, u16>,
    last_style: CellStyle,
    last_id: u16,
    row_y: u16,
    row_flags: RowFlags,
    row_cells: Vec<u32>,
    row_styles: Vec<u16>,
}

impl Default for FrameEncoder {
    fn default() -> Self {
        Self::new()
    }
}

impl FrameEncoder {
    pub fn new() -> Self {
        let mut encoder = Self {
            out: Vec::new(),
            rows: Vec::new(),
            row_count: 0,
            styles: Vec::new(),
            style_ids: HashMap::new(),
            last_style: CellStyle::DEFAULT,
            last_id: 0,
            row_y: 0,
            row_flags: RowFlags::default(),
            row_cells: Vec::new(),
            row_styles: Vec::new(),
        };
        encoder.begin();
        encoder
    }

    pub fn begin(&mut self) {
        self.rows.clear();
        self.row_count = 0;
        self.styles.clear();
        self.styles.push(CellStyle::DEFAULT);
        self.style_ids.clear();
        self.style_ids.insert(CellStyle::DEFAULT, 0);
        self.last_style = CellStyle::DEFAULT;
        self.last_id = 0;
    }

    pub fn begin_row(&mut self, y: u16, flags: RowFlags) {
        self.row_y = y;
        self.row_flags = flags;
        self.row_cells.clear();
        self.row_styles.clear();
    }

    #[inline]
    pub fn push_cell(&mut self, codepoint: u32, width: CellWidth, style: CellStyle) {
        let id = if style == self.last_style {
            self.last_id
        } else {
            let id = self.intern(style);
            self.last_style = style;
            self.last_id = id;
            id
        };
        let cell = match width {
            CellWidth::Narrow => codepoint & CODEPOINT_MASK,
            CellWidth::WideHead => (codepoint & CODEPOINT_MASK) | CELL_WIDE_HEAD,
            CellWidth::SpacerTail => CELL_SPACER_TAIL,
        };
        self.row_cells.push(cell);
        self.row_styles.push(id);
    }

    // A frame cannot hold more than u16::MAX styles; past that, cells fall back
    // to the default style rather than corrupting the table.
    fn intern(&mut self, style: CellStyle) -> u16 {
        if let Some(&id) = self.style_ids.get(&style) {
            return id;
        }
        let Ok(id) = u16::try_from(self.styles.len()) else {
            return 0;
        };
        if id == u16::MAX {
            return 0;
        }
        self.styles.push(style);
        self.style_ids.insert(style, id);
        id
    }

    pub fn end_row(&mut self) {
        let mut len = self.row_cells.len();
        while len > 0 && self.row_cells[len - 1] == 0 && self.row_styles[len - 1] == 0 {
            len -= 1;
        }
        let cells = &self.row_cells[..len];
        let styles = &self.row_styles[..len];

        let start = self.rows.len();
        put_u16(&mut self.rows, self.row_y);
        put_u16(&mut self.rows, 0);
        put_u16(&mut self.rows, len as u16);
        put_u16(&mut self.rows, self.row_flags.bits());

        let mut run_count: u16 = 0;
        let mut i = 0;
        while i < styles.len() {
            let id = styles[i];
            let mut j = i + 1;
            while j < styles.len() && styles[j] == id {
                j += 1;
            }
            put_u16(&mut self.rows, id);
            put_u16(&mut self.rows, (j - i) as u16);
            run_count += 1;
            i = j;
        }
        self.rows[start + 2..start + 4].copy_from_slice(&run_count.to_le_bytes());

        self.rows.reserve(cells.len() * 4);
        for &cell in cells {
            self.rows.extend_from_slice(&cell.to_le_bytes());
        }
        self.row_count += 1;
    }

    pub fn finish(&mut self, header: &FrameHeader) -> &[u8] {
        let out = &mut self.out;
        out.clear();
        out.reserve(HEADER_LEN + self.styles.len() * STYLE_LEN + self.rows.len());

        let mut flags = 0u8;
        if header.full {
            flags |= FLAG_FULL;
        }
        if header.cursor_blink {
            flags |= FLAG_CURSOR_BLINK;
        }
        if header.viewport_scrolled {
            flags |= FLAG_VIEWPORT_SCROLLED;
        }
        put_u32(out, MAGIC);
        put_u32(out, header.seq);
        put_u16(out, header.cols);
        put_u16(out, header.rows);
        put_u16(out, header.cursor_x);
        put_u16(out, header.cursor_y);
        out.push(header.cursor_style as u8);
        out.push(flags);
        put_u16(out, self.row_count);
        put_u32(out, header.default_fg);
        put_u32(out, header.default_bg);
        put_u32(out, header.cursor_color.unwrap_or(NO_CURSOR_COLOR));
        put_u16(out, self.styles.len() as u16);
        put_u16(out, 0);

        for style in &self.styles {
            put_u32(out, style.fg);
            put_u32(out, style.bg);
            put_u32(out, style.underline_color);
            put_u16(out, style.attrs);
            put_u16(out, 0);
        }
        out.extend_from_slice(&self.rows);
        &self.out
    }
}

#[inline]
fn put_u16(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

/// Test-side reader for the format, so tests assert on meaning, not offsets.
#[cfg(test)]
pub(crate) mod decode {
    use super::*;

    #[derive(Debug, Clone, PartialEq)]
    pub struct Frame {
        pub seq: u32,
        pub cols: u16,
        pub rows: u16,
        pub cursor_x: u16,
        pub cursor_y: u16,
        pub cursor_style: u8,
        pub flags: u8,
        pub default_fg: u32,
        pub default_bg: u32,
        pub cursor_color: u32,
        pub styles: Vec<CellStyle>,
        pub row_records: Vec<Row>,
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct Row {
        pub y: u16,
        pub flags: u16,
        pub runs: Vec<(u16, u16)>,
        pub cells: Vec<u32>,
    }

    impl Frame {
        pub fn full(&self) -> bool {
            self.flags & FLAG_FULL != 0
        }

        pub fn row(&self, y: u16) -> Option<&Row> {
            self.row_records.iter().find(|r| r.y == y)
        }
    }

    impl Row {
        /// Empty cells read as spaces, trailing spaces trimmed, spacer tails
        /// contribute nothing.
        pub fn text(&self) -> String {
            let mut s = String::new();
            for &cell in &self.cells {
                if cell & CELL_SPACER_TAIL != 0 {
                    continue;
                }
                let cp = cell & CODEPOINT_MASK;
                s.push(if cp == 0 {
                    ' '
                } else {
                    char::from_u32(cp).unwrap_or('\u{fffd}')
                });
            }
            s.truncate(s.trim_end_matches(' ').len());
            s
        }
    }

    struct Reader<'a> {
        bytes: &'a [u8],
        at: usize,
    }

    impl Reader<'_> {
        fn u8(&mut self) -> u8 {
            let v = self.bytes[self.at];
            self.at += 1;
            v
        }
        fn u16(&mut self) -> u16 {
            let v = u16::from_le_bytes([self.bytes[self.at], self.bytes[self.at + 1]]);
            self.at += 2;
            v
        }
        fn u32(&mut self) -> u32 {
            let v = u32::from_le_bytes(self.bytes[self.at..self.at + 4].try_into().unwrap());
            self.at += 4;
            v
        }
    }

    pub fn decode(bytes: &[u8]) -> Frame {
        assert_eq!(bytes.len() % 4, 0, "frame length is a multiple of 4");
        let mut r = Reader { bytes, at: 0 };
        assert_eq!(r.u32(), MAGIC);
        let seq = r.u32();
        let cols = r.u16();
        let rows = r.u16();
        let cursor_x = r.u16();
        let cursor_y = r.u16();
        let cursor_style = r.u8();
        let flags = r.u8();
        let row_count = r.u16();
        let default_fg = r.u32();
        let default_bg = r.u32();
        let cursor_color = r.u32();
        let style_count = r.u16();
        assert_eq!(r.u16(), 0, "header reserved field");
        assert_eq!(r.at, HEADER_LEN);

        let mut styles = Vec::new();
        for _ in 0..style_count {
            let fg = r.u32();
            let bg = r.u32();
            let underline_color = r.u32();
            let attrs = r.u16();
            assert_eq!(r.u16(), 0, "style reserved field");
            styles.push(CellStyle {
                fg,
                bg,
                underline_color,
                attrs,
            });
        }

        let mut row_records = Vec::new();
        for _ in 0..row_count {
            assert_eq!(r.at % 4, 0, "row records are 4 byte aligned");
            let y = r.u16();
            let run_count = r.u16();
            let cell_count = r.u16();
            let flags = r.u16();
            let runs: Vec<(u16, u16)> = (0..run_count).map(|_| (r.u16(), r.u16())).collect();
            let cells: Vec<u32> = (0..cell_count).map(|_| r.u32()).collect();
            let covered: u32 = runs.iter().map(|&(_, len)| u32::from(len)).sum();
            assert_eq!(
                covered,
                u32::from(cell_count),
                "runs cover the encoded cells"
            );
            assert!(
                runs.iter().all(|&(id, _)| id < style_count),
                "run style ids are in the table"
            );
            row_records.push(Row {
                y,
                flags,
                runs,
                cells,
            });
        }
        assert_eq!(r.at, bytes.len(), "no trailing bytes");
        Frame {
            seq,
            cols,
            rows,
            cursor_x,
            cursor_y,
            cursor_style,
            flags,
            default_fg,
            default_bg,
            cursor_color,
            styles,
            row_records,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::decode::decode;
    use super::*;

    fn header(seq: u32, cols: u16, rows: u16, full: bool) -> FrameHeader {
        FrameHeader {
            seq,
            cols,
            rows,
            cursor_x: 3,
            cursor_y: 1,
            cursor_style: CursorStyle::Bar,
            cursor_blink: true,
            viewport_scrolled: false,
            full,
            default_fg: rgb(0xdd, 0xdd, 0xdd),
            default_bg: rgb(0x11, 0x22, 0x33),
            cursor_color: None,
        }
    }

    fn push_str(enc: &mut FrameEncoder, text: &str, style: CellStyle) {
        for ch in text.chars() {
            enc.push_cell(u32::from(ch), CellWidth::Narrow, style);
        }
    }

    fn red() -> CellStyle {
        CellStyle {
            fg: set_rgb(0xff, 0, 0),
            ..CellStyle::DEFAULT
        }
    }

    #[test]
    fn header_layout_is_byte_exact() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        let mut h = header(7, 80, 24, true);
        h.viewport_scrolled = true;
        h.cursor_color = Some(rgb(1, 2, 3));
        let bytes = enc.finish(&h).to_vec();

        assert_eq!(bytes.len(), HEADER_LEN + STYLE_LEN);
        assert_eq!(&bytes[0..4], b"TXF1");
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 7);
        assert_eq!(u16::from_le_bytes([bytes[8], bytes[9]]), 80);
        assert_eq!(u16::from_le_bytes([bytes[10], bytes[11]]), 24);
        assert_eq!(u16::from_le_bytes([bytes[12], bytes[13]]), 3);
        assert_eq!(u16::from_le_bytes([bytes[14], bytes[15]]), 1);
        assert_eq!(bytes[16], CursorStyle::Bar as u8);
        assert_eq!(
            bytes[17],
            FLAG_FULL | FLAG_CURSOR_BLINK | FLAG_VIEWPORT_SCROLLED
        );
        assert_eq!(u16::from_le_bytes([bytes[18], bytes[19]]), 0, "row_count");
        assert_eq!(&bytes[20..24], &[0xdd, 0xdd, 0xdd, 0]);
        assert_eq!(&bytes[24..28], &[0x11, 0x22, 0x33, 0]);
        assert_eq!(&bytes[28..32], &[1, 2, 3, 0]);
        assert_eq!(u16::from_le_bytes([bytes[32], bytes[33]]), 1, "style_count");
        assert_eq!(&bytes[34..36], &[0, 0]);
        assert!(
            bytes[HEADER_LEN..].iter().all(|&b| b == 0),
            "entry 0 is all zero"
        );
    }

    #[test]
    fn missing_cursor_color_is_all_ones() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        let bytes = enc.finish(&header(1, 2, 2, true)).to_vec();
        assert_eq!(&bytes[28..32], &[0xff; 4]);
    }

    #[test]
    fn cursor_styles_encode_as_documented() {
        let cases = [
            (CursorStyle::Hidden, 0),
            (CursorStyle::Block, 1),
            (CursorStyle::Bar, 2),
            (CursorStyle::Underline, 3),
            (CursorStyle::HollowBlock, 4),
        ];
        let mut enc = FrameEncoder::new();
        for (style, byte) in cases {
            enc.begin();
            let mut h = header(1, 2, 2, true);
            h.cursor_style = style;
            h.cursor_blink = false;
            let bytes = enc.finish(&h);
            assert_eq!(bytes[16], byte);
            assert_eq!(bytes[17], FLAG_FULL);
        }
    }

    #[test]
    fn every_section_is_aligned_and_length_is_a_multiple_of_four() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        for (y, text) in ["a", "ab", "abc", "abcd", "abcde"].iter().enumerate() {
            enc.begin_row(y as u16, RowFlags::default());
            push_str(&mut enc, text, red());
            enc.end_row();
        }
        let bytes = enc.finish(&header(1, 10, 5, true)).to_vec();
        assert_eq!(bytes.len() % 4, 0);
        let frame = decode(&bytes);
        assert_eq!(frame.row_records.len(), 5);
        assert_eq!(frame.row(4).unwrap().text(), "abcde");
    }

    #[test]
    fn style_table_dedups_and_keeps_default_at_zero() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        let blue_bg = CellStyle {
            bg: set_rgb(0, 0, 0xff),
            ..CellStyle::DEFAULT
        };
        enc.begin_row(0, RowFlags::default());
        push_str(&mut enc, "ab", red());
        push_str(&mut enc, "cd", CellStyle::DEFAULT);
        push_str(&mut enc, "ef", blue_bg);
        push_str(&mut enc, "gh", red());
        enc.end_row();
        enc.begin_row(1, RowFlags::default());
        push_str(&mut enc, "ij", blue_bg);
        push_str(&mut enc, "kl", red());
        enc.end_row();
        let frame = decode(enc.finish(&header(1, 10, 2, true)));

        assert_eq!(frame.styles, vec![CellStyle::DEFAULT, red(), blue_bg]);
        assert_eq!(
            frame.row(0).unwrap().runs,
            vec![(1, 2), (0, 2), (2, 2), (1, 2)]
        );
        assert_eq!(frame.row(1).unwrap().runs, vec![(2, 2), (1, 2)]);
    }

    #[test]
    fn style_table_resets_between_frames() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(0, RowFlags::default());
        push_str(&mut enc, "x", red());
        enc.end_row();
        assert_eq!(decode(enc.finish(&header(1, 4, 1, true))).styles.len(), 2);

        enc.begin();
        enc.begin_row(0, RowFlags::default());
        push_str(&mut enc, "x", CellStyle::DEFAULT);
        enc.end_row();
        let frame = decode(enc.finish(&header(2, 4, 1, false)));
        assert_eq!(frame.styles, vec![CellStyle::DEFAULT]);
        assert_eq!(frame.row(0).unwrap().runs, vec![(0, 1)]);
    }

    #[test]
    fn attributes_and_underline_kind_pack_into_attrs() {
        let mut style = CellStyle {
            attrs: ATTR_BOLD | ATTR_STRIKETHROUGH | ATTR_BLINK,
            underline_color: set_rgb(9, 8, 7),
            ..CellStyle::DEFAULT
        };
        style.set_underline(UnderlineKind::Curly);
        assert_eq!(style.attrs, 0b1 | 0b10_0000 | 0b1000_0000 | (3 << 8));
        style.set_underline(UnderlineKind::Dashed);
        assert_eq!(style.attrs >> 8, 5);
        style.set_underline(UnderlineKind::None);
        assert_eq!(style.attrs, ATTR_BOLD | ATTR_STRIKETHROUGH | ATTR_BLINK);

        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(0, RowFlags::default());
        style.set_underline(UnderlineKind::Double);
        push_str(&mut enc, "u", style);
        enc.end_row();
        let bytes = enc.finish(&header(1, 4, 1, true)).to_vec();
        let entry = &bytes[HEADER_LEN + STYLE_LEN..HEADER_LEN + 2 * STYLE_LEN];
        assert_eq!(&entry[8..12], &[9, 8, 7, 1]);
        assert_eq!(u16::from_le_bytes([entry[12], entry[13]]), style.attrs);
        assert_eq!(&entry[14..16], &[0, 0]);
    }

    #[test]
    fn rows_are_run_length_encoded() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(2, RowFlags::default());
        push_str(&mut enc, "aaaa", red());
        push_str(&mut enc, "bb", CellStyle::DEFAULT);
        enc.end_row();
        let frame = decode(enc.finish(&header(1, 10, 3, false)));
        let row = frame.row(2).unwrap();
        assert_eq!(row.runs, vec![(1, 4), (0, 2)]);
        assert_eq!(row.cells.len(), 6);
        assert_eq!(row.text(), "aaaabb");
    }

    #[test]
    fn trailing_blank_cells_are_elided() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(0, RowFlags::default());
        push_str(&mut enc, "hi", CellStyle::DEFAULT);
        for _ in 0..8 {
            enc.push_cell(0, CellWidth::Narrow, CellStyle::DEFAULT);
        }
        enc.end_row();
        let frame = decode(enc.finish(&header(1, 10, 1, true)));
        let row = frame.row(0).unwrap();
        assert_eq!(row.cells.len(), 2);
        assert_eq!(row.runs, vec![(0, 2)]);
    }

    #[test]
    fn trailing_blanks_with_a_background_are_kept() {
        let bg = CellStyle {
            bg: set_rgb(0, 0x80, 0),
            ..CellStyle::DEFAULT
        };
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(0, RowFlags::default());
        push_str(&mut enc, "x", CellStyle::DEFAULT);
        for _ in 0..3 {
            enc.push_cell(0, CellWidth::Narrow, bg);
        }
        for _ in 0..4 {
            enc.push_cell(0, CellWidth::Narrow, CellStyle::DEFAULT);
        }
        enc.end_row();
        let frame = decode(enc.finish(&header(1, 8, 1, true)));
        let row = frame.row(0).unwrap();
        assert_eq!(row.cells, vec![u32::from('x'), 0, 0, 0]);
        assert_eq!(row.runs, vec![(0, 1), (1, 3)]);
    }

    #[test]
    fn interior_blank_cells_are_kept() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(0, RowFlags::default());
        enc.push_cell(0, CellWidth::Narrow, CellStyle::DEFAULT);
        push_str(&mut enc, "a", CellStyle::DEFAULT);
        enc.end_row();
        let row = decode(enc.finish(&header(1, 8, 1, true))).row_records[0].clone();
        assert_eq!(row.cells, vec![0, u32::from('a')]);
        assert_eq!(row.text(), " a");
    }

    #[test]
    fn a_blank_row_is_an_empty_record() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(5, RowFlags::default());
        for _ in 0..80 {
            enc.push_cell(0, CellWidth::Narrow, CellStyle::DEFAULT);
        }
        enc.end_row();
        let bytes = enc.finish(&header(1, 80, 6, false)).to_vec();
        assert_eq!(bytes.len(), HEADER_LEN + STYLE_LEN + ROW_HEADER_LEN);
        let frame = decode(&bytes);
        assert_eq!(
            frame.row_records,
            vec![decode::Row {
                y: 5,
                flags: 0,
                runs: vec![],
                cells: vec![]
            }]
        );
    }

    #[test]
    fn wide_head_and_spacer_tail_bits() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(0, RowFlags::default());
        enc.push_cell(0x4e2d, CellWidth::WideHead, CellStyle::DEFAULT);
        enc.push_cell(0, CellWidth::SpacerTail, CellStyle::DEFAULT);
        push_str(&mut enc, "a", CellStyle::DEFAULT);
        enc.end_row();
        let frame = decode(enc.finish(&header(1, 8, 1, true)));
        let row = frame.row(0).unwrap();
        assert_eq!(
            row.cells,
            vec![0x4e2d | CELL_WIDE_HEAD, CELL_SPACER_TAIL, u32::from('a')]
        );
        assert_eq!(row.text(), "\u{4e2d}a");
    }

    #[test]
    fn a_trailing_spacer_tail_is_not_elided() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(0, RowFlags::default());
        enc.push_cell(0x1f680, CellWidth::WideHead, CellStyle::DEFAULT);
        enc.push_cell(0, CellWidth::SpacerTail, CellStyle::DEFAULT);
        enc.end_row();
        let row = decode(enc.finish(&header(1, 2, 1, true))).row_records[0].clone();
        assert_eq!(row.cells.len(), 2);
    }

    #[test]
    fn codepoints_are_masked_to_21_bits() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(0, RowFlags::default());
        enc.push_cell(0xFFFF_FFFF, CellWidth::Narrow, CellStyle::DEFAULT);
        enc.end_row();
        let row = decode(enc.finish(&header(1, 2, 1, true))).row_records[0].clone();
        assert_eq!(row.cells, vec![CODEPOINT_MASK]);
    }

    #[test]
    fn row_flags_carry_wrap_and_semantic_prompt() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        let cases = [
            (false, SemanticPrompt::None, 0u16),
            (true, SemanticPrompt::None, 1),
            (false, SemanticPrompt::Prompt, 2),
            (true, SemanticPrompt::Continuation, 1 | 4),
        ];
        for (y, (wrapped, prompt, _)) in cases.iter().enumerate() {
            enc.begin_row(
                y as u16,
                RowFlags {
                    wrapped: *wrapped,
                    prompt: *prompt,
                },
            );
            push_str(&mut enc, "p", CellStyle::DEFAULT);
            enc.end_row();
        }
        let frame = decode(enc.finish(&header(1, 4, 4, true)));
        for (y, (_, _, bits)) in cases.iter().enumerate() {
            assert_eq!(frame.row(y as u16).unwrap().flags, *bits);
        }
    }

    #[test]
    fn partial_and_full_frames_differ_only_in_the_flag() {
        let mut enc = FrameEncoder::new();
        for full in [true, false] {
            enc.begin();
            enc.begin_row(1, RowFlags::default());
            push_str(&mut enc, "z", CellStyle::DEFAULT);
            enc.end_row();
            let frame = decode(enc.finish(&header(1, 4, 3, full)));
            assert_eq!(frame.full(), full);
            assert_eq!(frame.row_records.len(), 1);
            assert_eq!(frame.row_records[0].y, 1);
        }
    }

    #[test]
    fn style_table_overflow_falls_back_to_default() {
        let mut enc = FrameEncoder::new();
        enc.begin();
        enc.begin_row(0, RowFlags::default());
        for i in 0..70_000u32 {
            let style = CellStyle {
                fg: i | COLOR_SET,
                ..CellStyle::DEFAULT
            };
            enc.push_cell(u32::from('x'), CellWidth::Narrow, style);
            if enc.row_cells.len() == 1000 {
                enc.end_row();
                enc.begin_row(0, RowFlags::default());
            }
        }
        enc.end_row();
        let bytes = enc.finish(&header(1, 1000, 1, true)).to_vec();
        let style_count = u16::from_le_bytes([bytes[32], bytes[33]]);
        assert_eq!(style_count, u16::MAX);
        decode(&bytes);
    }

    #[test]
    fn encoder_reuses_its_buffers() {
        let mut enc = FrameEncoder::new();
        let frame = |enc: &mut FrameEncoder| {
            enc.begin();
            for y in 0..60 {
                enc.begin_row(y, RowFlags::default());
                for x in 0..200u32 {
                    let style = CellStyle {
                        fg: (x % 7) | COLOR_SET,
                        ..CellStyle::DEFAULT
                    };
                    enc.push_cell(u32::from('a') + x % 26, CellWidth::Narrow, style);
                }
                enc.end_row();
            }
            enc.finish(&header(1, 200, 60, true)).len()
        };
        frame(&mut enc);
        let capacity = (
            enc.out.capacity(),
            enc.rows.capacity(),
            enc.row_cells.capacity(),
        );
        let len = frame(&mut enc);
        assert_eq!(
            capacity,
            (
                enc.out.capacity(),
                enc.rows.capacity(),
                enc.row_cells.capacity()
            )
        );
        assert_eq!(len, enc.out.len());
    }
}
