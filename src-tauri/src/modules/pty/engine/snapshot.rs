//! libghostty `RenderState` to frame bytes. Owns the render state and both
//! iterators, so it lives on the engine thread with the terminal.

use libghostty_vt::render::{CellIterator, CursorVisualStyle, Dirty, RowIterator};
use libghostty_vt::screen::{CellWide, RowSemanticPrompt};
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
        })
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
        let scrollbar = term.scrollbar()?;
        let viewport_scrolled = scrollbar.offset.saturating_add(scrollbar.len) < scrollbar.total;

        let snapshot = self.render.update(term)?;
        let dirty = snapshot.dirty()?;
        if dirty == Dirty::Clean && !force_full {
            return Ok(None);
        }
        let full = force_full || dirty == Dirty::Full;
        let cols = snapshot.cols()?;
        let rows = snapshot.rows()?;
        let colors = snapshot.colors()?;

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

        let encoder = &mut self.encoder;
        encoder.begin();
        let mut row_iter = self.rows.update(&snapshot)?;
        let mut y = 0u16;
        while let Some(row) = row_iter.next() {
            if full || row.dirty()? {
                let raw = row.raw_row()?;
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
                let mut cell_iter = self.cells.update(row)?;
                while let Some(cell) = cell_iter.next() {
                    let raw_cell = cell.raw_cell()?;
                    let (codepoint, width) = match raw_cell.wide()? {
                        CellWide::SpacerTail => (0, CellWidth::SpacerTail),
                        CellWide::SpacerHead => (0, CellWidth::Narrow),
                        CellWide::Wide => (raw_cell.codepoint()?, CellWidth::WideHead),
                        _ => (raw_cell.codepoint()?, CellWidth::Narrow),
                    };
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
                    encoder.push_cell(codepoint, width, style);
                }
                encoder.end_row();
                row.set_dirty(false)?;
            }
            y += 1;
        }
        snapshot.set_dirty(Dirty::Clean)?;
        Ok(Some(self.encoder.finish(&header)))
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
