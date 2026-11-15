use libghostty_vt::style::StyleColor;

pub const PLACEHOLDER: u32 = 0x10eeee;

#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    pub image: u32,
    pub placement: u32,
    pub col: u32,
    pub row: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
}

fn color_id(color: StyleColor) -> u32 {
    match color {
        StyleColor::None => 0,
        StyleColor::Palette(index) => u32::from(index.0),
        StyleColor::Rgb(rgb) => u32::from(rgb.r) << 16 | u32::from(rgb.g) << 8 | u32::from(rgb.b),
    }
}

pub fn append(
    runs: &mut Vec<Run>,
    x: u32,
    y: u32,
    fg: StyleColor,
    underline: StyleColor,
    text: &str,
) {
    let mut chars = text
        .chars()
        .filter(|c| u32::from(*c) != PLACEHOLDER)
        .take(3);
    let mut index = || {
        chars
            .next()
            .and_then(|c| DIACRITICS.binary_search(&u32::from(c)).ok())
            .map(|v| v as u32)
    };
    let row = index();
    let col = index();
    let high = index().filter(|v| *v < 256);
    let low = color_id(fg);
    let placement = color_id(underline);
    if let Some(previous) = runs.last_mut() {
        if previous.x + previous.width == x
            && previous.y == y
            && previous.image & 0xffffff == low
            && previous.placement == placement
            && row.is_none_or(|row| row == previous.row)
            && col.is_none_or(|col| col == previous.col + previous.width)
            && high.is_none_or(|high| high == previous.image >> 24)
        {
            previous.width += 1;
            return;
        }
    }
    runs.push(Run {
        image: low | high.unwrap_or(0) << 24,
        placement,
        col: col.unwrap_or(0),
        row: row.unwrap_or(0),
        x,
        y,
        width: 1,
    });
}

pub fn fragment(
    run: &Run,
    image: (u32, u32),
    grid: (u32, u32),
    cell: (u32, u32),
) -> Option<[f32; 8]> {
    if image.0 == 0 || image.1 == 0 || cell.0 == 0 || cell.1 == 0 {
        return None;
    }
    let cols = if grid.0 == 0 {
        image.0.div_ceil(cell.0)
    } else {
        grid.0
    };
    let rows = if grid.1 == 0 {
        image.1.div_ceil(cell.1)
    } else {
        grid.1
    };
    if run.col >= cols || run.row >= rows {
        return None;
    }
    let w = f64::from(cols) * f64::from(cell.0);
    let h = f64::from(rows) * f64::from(cell.1);
    let scale = (w / f64::from(image.0)).min(h / f64::from(image.1));
    let image_left = (w - f64::from(image.0) * scale) / 2.0;
    let image_top = (h - f64::from(image.1) * scale) / 2.0;
    let left = f64::from(run.col) * f64::from(cell.0);
    let top = f64::from(run.row) * f64::from(cell.1);
    let right = f64::from((run.col + run.width).min(cols)) * f64::from(cell.0);
    let bottom = f64::from(run.row + 1) * f64::from(cell.1);
    let x0 = left.max(image_left);
    let y0 = top.max(image_top);
    let x1 = right.min(image_left + f64::from(image.0) * scale);
    let y1 = bottom.min(image_top + f64::from(image.1) * scale);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    Some([
        (x0 - left) as f32,
        (y0 - top) as f32,
        ((x0 - image_left) / scale) as f32,
        ((y0 - image_top) / scale) as f32,
        ((x1 - x0) / scale) as f32,
        ((y1 - y0) / scale) as f32,
        (x1 - x0) as f32,
        (y1 - y0) as f32,
    ])
}

// Protocol data from pinned Ghostty graphics_unicode.zig, covered by its MIT notice.
const DIACRITICS: &[u32] = &[
    0x0305, 0x030D, 0x030E, 0x0310, 0x0312, 0x033D, 0x033E, 0x033F, 0x0346, 0x034A, 0x034B, 0x034C,
    0x0350, 0x0351, 0x0352, 0x0357, 0x035B, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
    0x036A, 0x036B, 0x036C, 0x036D, 0x036E, 0x036F, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
    0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059C, 0x059D, 0x059E, 0x059F, 0x05A0, 0x05A1,
    0x05A8, 0x05A9, 0x05AB, 0x05AC, 0x05AF, 0x05C4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615,
    0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065A, 0x065B, 0x065D, 0x065E, 0x06D6, 0x06D7, 0x06D8,
    0x06D9, 0x06DA, 0x06DB, 0x06DC, 0x06DF, 0x06E0, 0x06E1, 0x06E2, 0x06E4, 0x06E7, 0x06E8, 0x06EB,
    0x06EC, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736, 0x073A, 0x073D, 0x073F, 0x0740, 0x0741, 0x0743,
    0x0745, 0x0747, 0x0749, 0x074A, 0x07EB, 0x07EC, 0x07ED, 0x07EE, 0x07EF, 0x07F0, 0x07F1, 0x07F3,
    0x0816, 0x0817, 0x0818, 0x0819, 0x081B, 0x081C, 0x081D, 0x081E, 0x081F, 0x0820, 0x0821, 0x0822,
    0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082A, 0x082B, 0x082C, 0x082D, 0x0951, 0x0953, 0x0954,
    0x0F82, 0x0F83, 0x0F86, 0x0F87, 0x135D, 0x135E, 0x135F, 0x17DD, 0x193A, 0x1A17, 0x1A75, 0x1A76,
    0x1A77, 0x1A78, 0x1A79, 0x1A7A, 0x1A7B, 0x1A7C, 0x1B6B, 0x1B6D, 0x1B6E, 0x1B6F, 0x1B70, 0x1B71,
    0x1B72, 0x1B73, 0x1CD0, 0x1CD1, 0x1CD2, 0x1CDA, 0x1CDB, 0x1CE0, 0x1DC0, 0x1DC1, 0x1DC3, 0x1DC4,
    0x1DC5, 0x1DC6, 0x1DC7, 0x1DC8, 0x1DC9, 0x1DCB, 0x1DCC, 0x1DD1, 0x1DD2, 0x1DD3, 0x1DD4, 0x1DD5,
    0x1DD6, 0x1DD7, 0x1DD8, 0x1DD9, 0x1DDA, 0x1DDB, 0x1DDC, 0x1DDD, 0x1DDE, 0x1DDF, 0x1DE0, 0x1DE1,
    0x1DE2, 0x1DE3, 0x1DE4, 0x1DE5, 0x1DE6, 0x1DFE, 0x20D0, 0x20D1, 0x20D4, 0x20D5, 0x20D6, 0x20D7,
    0x20DB, 0x20DC, 0x20E1, 0x20E7, 0x20E9, 0x20F0, 0x2CEF, 0x2CF0, 0x2CF1, 0x2DE0, 0x2DE1, 0x2DE2,
    0x2DE3, 0x2DE4, 0x2DE5, 0x2DE6, 0x2DE7, 0x2DE8, 0x2DE9, 0x2DEA, 0x2DEB, 0x2DEC, 0x2DED, 0x2DEE,
    0x2DEF, 0x2DF0, 0x2DF1, 0x2DF2, 0x2DF3, 0x2DF4, 0x2DF5, 0x2DF6, 0x2DF7, 0x2DF8, 0x2DF9, 0x2DFA,
    0x2DFB, 0x2DFC, 0x2DFD, 0x2DFE, 0x2DFF, 0xA66F, 0xA67C, 0xA67D, 0xA6F0, 0xA6F1, 0xA8E0, 0xA8E1,
    0xA8E2, 0xA8E3, 0xA8E4, 0xA8E5, 0xA8E6, 0xA8E7, 0xA8E8, 0xA8E9, 0xA8EA, 0xA8EB, 0xA8EC, 0xA8ED,
    0xA8EE, 0xA8EF, 0xA8F0, 0xA8F1, 0xAAB0, 0xAAB2, 0xAAB3, 0xAAB7, 0xAAB8, 0xAABE, 0xAABF, 0xAAC1,
    0xFE20, 0xFE21, 0xFE22, 0xFE23, 0xFE24, 0xFE25, 0xFE26, 0x10A0F, 0x10A38, 0x1D185, 0x1D186,
    0x1D187, 0x1D188, 0x1D189, 0x1D1AA, 0x1D1AB, 0x1D1AC, 0x1D1AD, 0x1D242, 0x1D243, 0x1D244,
];

#[cfg(test)]
mod tests {
    use super::*;
    fn color(id: u8) -> StyleColor {
        StyleColor::Rgb(libghostty_vt::style::RgbColor { r: 0, g: 0, b: id })
    }
    #[test]
    fn omitted_diacritics_continue_only_adjacent_matching_placeholders() {
        let mut runs = Vec::new();
        append(
            &mut runs,
            0,
            0,
            color(42),
            StyleColor::None,
            "\u{10eeee}\u{0305}\u{030d}\u{030e}",
        );
        append(&mut runs, 1, 0, color(42), StyleColor::None, "\u{10eeee}");
        assert_eq!(runs.len(), 1);
        assert_eq!(
            (runs[0].image, runs[0].row, runs[0].col, runs[0].width),
            (42 | 2 << 24, 0, 1, 2)
        );
        append(&mut runs, 3, 0, color(42), StyleColor::None, "\u{10eeee}");
        assert_eq!(runs.len(), 2);
        assert_eq!((runs[1].col, runs[1].image), (0, 42));
    }
    #[test]
    fn aspect_fit_retains_subpixel_source_fragments_when_one_pixel_spans_rows() {
        let run = Run {
            image: 1,
            placement: 0,
            col: 0,
            row: 0,
            x: 0,
            y: 0,
            width: 2,
        };
        let top = fragment(&run, (1, 1), (2, 2), (8, 8)).unwrap();
        assert_eq!(top, [0.0, 0.0, 0.0, 0.0, 1.0, 0.5, 16.0, 8.0]);
        let bottom = fragment(&Run { row: 1, ..run }, (1, 1), (2, 2), (8, 8)).unwrap();
        assert_eq!(bottom, [0.0, 0.0, 0.0, 0.5, 1.0, 0.5, 16.0, 8.0]);
    }
}
