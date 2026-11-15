//! libghostty `RenderState` to frame bytes. Owns the render state and both
//! iterators, so it lives on the engine thread with the terminal.

use libghostty_vt::render::{CellIterator, CursorVisualStyle, Dirty, RowIterator};
use libghostty_vt::screen::{CellContentTag, CellWide, RowSemanticPrompt};
use libghostty_vt::style::{Id as StyleId, RgbColor, StyleColor, Underline};
use libghostty_vt::{RenderState, Terminal};

use super::frame::{
    set_rgb, CellStyle, CellWidth, CursorStyle, FrameEncoder, FrameHeader, RowFlags,
    SemanticPrompt, UnderlineKind, ATTR_BLINK, ATTR_BOLD, ATTR_FAINT, ATTR_INVERSE, ATTR_INVISIBLE,
    ATTR_ITALIC, ATTR_OVERLINE, ATTR_STRIKETHROUGH,
};

pub struct Snapshotter {
    render: RenderState<'static>,
    rows: RowIterator<'static>,
    cells: CellIterator<'static>,
    encoder: FrameEncoder,
    last_header: Option<FrameHeader>,
    links: super::links::LinkCache,
    link_scratch: super::links::LinkScratch,
    grapheme_scratch: String,
    graphics: super::graphics::GraphicsSnapshot,
}

fn pack(c: RgbColor) -> u32 {
    set_rgb(c.r, c.g, c.b)
}

fn plain(c: RgbColor) -> u32 {
    super::frame::rgb(c.r, c.g, c.b)
}

fn cursor_style(style: CursorVisualStyle) -> CursorStyle {
    match style {
        CursorVisualStyle::Bar => CursorStyle::Bar,
        CursorVisualStyle::Underline => CursorStyle::Underline,
        CursorVisualStyle::BlockHollow => CursorStyle::HollowBlock,
        _ => CursorStyle::Block,
    }
}

fn underline_kind(u: Underline) -> UnderlineKind {
    match u {
        Underline::None => UnderlineKind::None,
        Underline::Double => UnderlineKind::Double,
        Underline::Curly => UnderlineKind::Curly,
        Underline::Dotted => UnderlineKind::Dotted,
        Underline::Dashed => UnderlineKind::Dashed,
        _ => UnderlineKind::Single,
    }
}

impl Snapshotter {
    pub fn new() -> Result<Self, libghostty_vt::Error> {
        Ok(Self {
            render: RenderState::new()?,
            rows: RowIterator::new()?,
            cells: CellIterator::new()?,
            encoder: FrameEncoder::new(),
            last_header: None,
            links: super::links::LinkCache::default(),
            link_scratch: super::links::LinkScratch::default(),
            grapheme_scratch: String::new(),
            graphics: super::graphics::GraphicsSnapshot::new()?,
        })
    }

    pub fn set_cell_pixels(&mut self, width: u32, height: u32) {
        self.graphics.set_cell_pixels(width, height);
    }

    pub fn link_context(
        &self,
        seq: u32,
        col: u16,
        row: u16,
    ) -> Result<Option<super::links::LinkContext>, String> {
        self.links.query(seq, col, row)
    }

    /// Encodes the rows that changed, or every row when `force_full` is set or
    /// the terminal asks for a full redraw. `None` when nothing changed. Row
    /// dirty flags are cleared only for the rows encoded.
    pub fn build(
        &mut self,
        term: &Terminal<'static, '_>,
        seq: u32,
        force_full: bool,
    ) -> Result<Option<&[u8]>, libghostty_vt::Error> {
        self.build_highlighted(term, seq, force_full, &[])
    }

    pub fn build_highlighted(
        &mut self,
        term: &Terminal<'static, '_>,
        seq: u32,
        force_full: bool,
        highlights: &[u8],
    ) -> Result<Option<&[u8]>, libghostty_vt::Error> {
        let scrollbar = term.scrollbar()?;
        let viewport_scrolled = scrollbar.offset.saturating_add(scrollbar.len) < scrollbar.total;

        let snapshot = self.render.update(term)?;
        let dirty = snapshot.dirty()?;
        let cols = snapshot.cols()?;
        let rows = snapshot.rows()?;
        let colors = snapshot.colors()?;
        let full = force_full
            || dirty == Dirty::Full
            || self.last_header.is_none()
            || self.last_header.as_ref().is_some_and(|previous| {
                previous.cols != cols
                    || previous.rows != rows
                    || previous.default_fg != plain(colors.foreground)
                    || previous.default_bg != plain(colors.background)
            });

        let (cursor_style, cursor_x, cursor_y) = match snapshot.cursor_viewport()? {
            Some(c) => {
                // The renderer draws a wide cursor from the head cell.
                let x = if c.at_wide_tail {
                    c.x.saturating_sub(1)
                } else {
                    c.x
                };
                let style = if snapshot.cursor_visible()? {
                    cursor_style(snapshot.cursor_visual_style()?)
                } else {
                    CursorStyle::Hidden
                };
                (style, x, c.y)
            }
            None => (CursorStyle::Hidden, 0, 0),
        };
        let header = FrameHeader {
            seq,
            cols,
            rows,
            cursor_x,
            cursor_y,
            cursor_style,
            cursor_blink: snapshot.cursor_blinking()?,
            viewport_scrolled,
            full,
            default_fg: plain(colors.foreground),
            default_bg: plain(colors.background),
            cursor_color: snapshot.cursor_color()?.map(plain),
        };

        let metadata = FrameHeader {
            seq: 0,
            full: false,
            ..header
        };
        // Cursor-only mode changes can leave native row dirtiness clean.
        if dirty == Dirty::Clean
            && !full
            && self.last_header == Some(metadata)
            && !self.graphics.changed(term)?
        {
            return Ok(None);
        }

        self.links.prepare(cols, rows);
        let encoder = &mut self.encoder;
        encoder.begin();
        let mut row_iter = if full || dirty != Dirty::Clean {
            Some(self.rows.update(&snapshot)?)
        } else {
            None
        };
        let mut y = 0u16;
        while let Some(row) = row_iter.as_mut().and_then(|rows| rows.next()) {
            if full || row.dirty()? {
                let raw = row.raw_row()?;
                let mut link_row = super::links::LinkRowBuilder::new(
                    cols,
                    raw.is_wrapped()?,
                    raw.is_wrap_continuation()?,
                );
                let has_link_graphemes = raw.has_grapheme_cluster()?;
                let has_links = raw.has_hyperlink()?;
                let prompt = match raw.semantic_prompt()? {
                    RowSemanticPrompt::Prompt => SemanticPrompt::Prompt,
                    RowSemanticPrompt::Continuation => SemanticPrompt::Continuation,
                    _ => SemanticPrompt::None,
                };
                encoder.begin_row(
                    y,
                    RowFlags {
                        wrapped: raw.is_wrapped()?,
                        prompt,
                    },
                );
                // Style ids are page local and a row never spans pages, so the
                // resolved style is cached per row.
                let mut cached: Option<(StyleId, CellStyle)> = None;
                let selected_row = row.selection()?.is_some();
                let mut cell_iter = self.cells.update(row)?;
                let mut x = 0usize;
                while let Some(cell) = cell_iter.next() {
                    let raw_cell = cell.raw_cell()?;
                    let wide = raw_cell.wide()?;
                    let (codepoint, width) = match wide {
                        CellWide::SpacerTail => (0, CellWidth::SpacerTail),
                        CellWide::SpacerHead => (0, CellWidth::Narrow),
                        CellWide::Wide => (raw_cell.codepoint()?, CellWidth::WideHead),
                        _ => (raw_cell.codepoint()?, CellWidth::Narrow),
                    };
                    if link_row.valid() {
                        let data = self.link_scratch.rendered(
                            term,
                            libghostty_vt::terminal::PointCoordinate {
                                x: x as u16,
                                y: u32::from(y),
                            },
                            cell,
                            raw_cell,
                            (has_link_graphemes, has_links),
                        );
                        link_row.push(codepoint, wide, data);
                    }
                    let mut style = if raw_cell.has_styling()? {
                        let id = raw_cell.style_id()?;
                        match cached {
                            Some((cached_id, style)) if cached_id == id => style,
                            _ => {
                                let style = resolve_style(cell, &colors.palette)?;
                                cached = Some((id, style));
                                style
                            }
                        }
                    } else {
                        CellStyle::DEFAULT
                    };
                    style.bg = cell.bg_color()?.map_or(0, pack);
                    match highlights.get(usize::from(y) * usize::from(cols) + x) {
                        Some(1) => {
                            style.bg = set_rgb(0x51, 0x5c, 0x6a);
                            style.attrs &= !ATTR_INVERSE;
                        }
                        Some(2) => {
                            style.bg = set_rgb(0xd1, 0x86, 0x16);
                            style.attrs &= !ATTR_INVERSE;
                        }
                        _ => {}
                    }
                    if selected_row && cell.is_selected()? {
                        style.attrs ^= ATTR_INVERSE;
                    }
                    if has_link_graphemes
                        && raw_cell.content_tag()? == CellContentTag::CodepointGrapheme
                        && width != CellWidth::SpacerTail
                    {
                        let count = cell.graphemes_len()?;
                        if count > super::frame::MAX_GRAPHEME_BYTES {
                            return Err(libghostty_vt::Error::OutOfSpace { required: count });
                        }
                        self.grapheme_scratch.clear();
                        cell.graphemes_utf8(&mut self.grapheme_scratch)?;
                        encoder
                            .push_grapheme(&self.grapheme_scratch, width, style)
                            .map_err(|limit| libghostty_vt::Error::OutOfSpace {
                                required: limit.required,
                            })?;
                    } else {
                        encoder.push_cell(codepoint, width, style);
                    }
                    x += 1;
                }
                encoder.end_row();
                self.links.update_row(y, link_row.finish());
                row.set_dirty(false)?;
            }
            y += 1;
        }
        snapshot.set_dirty(Dirty::Clean)?;
        self.links.commit(term, seq)?;
        let graphics = self.graphics.capture(term, full)?;
        self.last_header = Some(metadata);
        Ok(Some(self.encoder.finish_graphics(&header, graphics)))
    }
}

fn resolve_style(
    cell: &libghostty_vt::render::CellIteration<'_, '_>,
    palette: &[RgbColor; 256],
) -> Result<CellStyle, libghostty_vt::Error> {
    let s = cell.style()?;
    let mut attrs = 0u16;
    for (on, bit) in [
        (s.bold, ATTR_BOLD),
        (s.italic, ATTR_ITALIC),
        (s.faint, ATTR_FAINT),
        (s.inverse, ATTR_INVERSE),
        (s.invisible, ATTR_INVISIBLE),
        (s.strikethrough, ATTR_STRIKETHROUGH),
        (s.overline, ATTR_OVERLINE),
        (s.blink, ATTR_BLINK),
    ] {
        if on {
            attrs |= bit;
        }
    }
    let mut style = CellStyle {
        fg: cell.fg_color()?.map_or(0, pack),
        bg: 0,
        underline_color: match s.underline_color {
            StyleColor::None => 0,
            StyleColor::Palette(i) => pack(palette[usize::from(i.0)]),
            StyleColor::Rgb(c) => pack(c),
        },
        attrs,
    };
    style.set_underline(underline_kind(s.underline));
    Ok(style)
}

#[cfg(test)]
mod grapheme_tests {
    use super::*;
    use crate::modules::pty::engine::frame::{decode, CELL_SPACER_TAIL, CELL_WIDE_HEAD};
    use libghostty_vt::TerminalOptions;
    #[test]
    fn actual_native_cells_preserve_combining_marks_zwj_and_frame_local_replacements() {
        let mut term = Terminal::new(TerminalOptions {
            cols: 20,
            rows: 3,
            max_scrollback: 0,
        })
        .unwrap();
        let mut snapshot = Snapshotter::new().unwrap();
        term.vt_write("e\u{301}e\u{300}\u{1f469}\u{200d}\u{1f4bb}".as_bytes());
        let frame = decode::decode(snapshot.build(&term, 1, true).unwrap().unwrap());
        assert_eq!(
            frame.row(0).unwrap().text(),
            "e\u{301}e\u{300}\u{1f469}\u{200d}\u{1f4bb}"
        );
        assert_ne!(frame.row(0).unwrap().cells[2] & CELL_WIDE_HEAD, 0);
        assert_ne!(frame.row(0).unwrap().cells[3] & CELL_SPACER_TAIL, 0);
        term.vt_write("\r\x1b[2Ke\u{308}".as_bytes());
        let changed = decode::decode(snapshot.build(&term, 2, false).unwrap().unwrap());
        assert_eq!(changed.row(0).unwrap().text(), "e\u{308}");
        assert_eq!(&*changed.graphemes, &["e\u{308}"]);
    }
}

#[cfg(test)]
mod cursor_header_tests {
    use super::*;
    use crate::modules::pty::engine::{
        cursor,
        frame::{decode::decode, FLAG_CURSOR_BLINK, FLAG_FULL},
    };
    use libghostty_vt::TerminalOptions;

    #[test]
    fn clean_native_rows_still_publish_cursor_only_metadata_once() {
        let mut term = Terminal::new(TerminalOptions {
            cols: 20,
            rows: 3,
            max_scrollback: 0,
        })
        .unwrap();
        cursor::apply(&mut term, true).unwrap();
        let mut snapshot = Snapshotter::new().unwrap();
        let first = decode(snapshot.build(&term, 1, true).unwrap().unwrap());
        assert_ne!(first.flags & FLAG_CURSOR_BLINK, 0);
        term.vt_write(b"\x1b[2 q");
        {
            let state = snapshot.render.update(&term).unwrap();
            assert_eq!(state.dirty().unwrap(), Dirty::Clean);
            assert!(!state.cursor_blinking().unwrap());
        }
        let changed = decode(
            snapshot
                .build(&term, 2, false)
                .unwrap()
                .expect("cursor-only negotiation requires a frame even when core rows are clean"),
        );
        assert_eq!(changed.flags & (FLAG_CURSOR_BLINK | FLAG_FULL), 0);
        assert!(
            changed.row_records.is_empty(),
            "clean rows need no retransmission"
        );
        assert!(
            snapshot.build(&term, 3, false).unwrap().is_none(),
            "unchanged metadata remains idle"
        );
    }
}
