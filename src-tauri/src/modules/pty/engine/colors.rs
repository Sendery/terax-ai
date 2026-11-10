use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct TerminalColors {
    pub foreground: String,
    pub background: String,
    pub cursor: Option<String>,
    pub palette: [String; 16],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Colors {
    pub foreground: [u8; 3],
    pub background: [u8; 3],
    pub cursor: Option<[u8; 3]>,
    pub palette: [[u8; 3]; 16],
}

fn parse(value: &str) -> Result<[u8; 3], String> {
    let bytes = value.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err("terminal colors must use #rrggbb".into());
    }
    let mut rgb = [0; 3];
    for (index, channel) in rgb.iter_mut().enumerate() {
        let start = 1 + index * 2;
        *channel = u8::from_str_radix(&value[start..start + 2], 16)
            .map_err(|_| "terminal colors must use #rrggbb".to_string())?;
    }
    Ok(rgb)
}

impl TryFrom<TerminalColors> for Colors {
    type Error = String;

    fn try_from(value: TerminalColors) -> Result<Self, String> {
        let mut palette = [[0; 3]; 16];
        for (color, text) in palette.iter_mut().zip(value.palette) {
            *color = parse(&text)?;
        }
        Ok(Self {
            foreground: parse(&value.foreground)?,
            background: parse(&value.background)?,
            cursor: value.cursor.as_deref().map(parse).transpose()?,
            palette,
        })
    }
}

#[cfg(feature = "ghostty-engine")]
impl Colors {
    pub fn apply(
        &self,
        term: &mut libghostty_vt::Terminal<'_, '_>,
    ) -> Result<(), libghostty_vt::Error> {
        use libghostty_vt::style::RgbColor;
        let rgb = |[r, g, b]: [u8; 3]| RgbColor { r, g, b };
        let mut palette = term.default_color_palette()?;
        for (entry, color) in palette.0.iter_mut().zip(self.palette) {
            *entry = rgb(color);
        }
        term.set_default_fg_color(Some(rgb(self.foreground)))?
            .set_default_bg_color(Some(rgb(self.background)))?
            .set_default_cursor_color(self.cursor.map(rgb))?
            .set_default_color_palette(Some(palette))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_rgb_handles_case_and_rejects_invalid_utf8_boundaries() {
        assert_eq!(parse("#aB01fF"), Ok([171, 1, 255]));
        for value in [
            "", "#abc", "ffffff", "#1234567", "#gg0000", " #123456", "#é1234",
        ] {
            assert!(parse(value).is_err(), "{value}");
        }
    }

    #[test]
    fn palette_requires_exactly_sixteen_entries() {
        for count in [0, 15, 17] {
            let value = serde_json::json!({"foreground":"#ffffff","background":"#000000","palette":vec!["#000000"; count]});
            assert!(serde_json::from_value::<TerminalColors>(value).is_err());
        }
    }

    #[test]
    fn every_color_is_validated_before_application() {
        let valid = TerminalColors {
            foreground: "#123456".into(),
            background: "#abcdef".into(),
            cursor: None,
            palette: std::array::from_fn(|_| "#000000".into()),
        };
        let parsed = Colors::try_from(valid.clone()).unwrap();
        assert_eq!(parsed.foreground, [18, 52, 86]);
        assert_eq!(parsed.background, [171, 205, 239]);
        assert_eq!(parsed.cursor, None);
        let mut invalid = valid.clone();
        invalid.cursor = Some("red".into());
        assert!(Colors::try_from(invalid).is_err());
        let mut invalid = valid;
        invalid.palette[15] = "#xyzxyz".into();
        assert!(Colors::try_from(invalid).is_err());
    }

    #[cfg(feature = "ghostty-engine")]
    #[test]
    fn applying_colors_preserves_extended_palette_and_resets_optional_cursor() {
        let mut term = libghostty_vt::Terminal::new(libghostty_vt::TerminalOptions {
            cols: 20,
            rows: 5,
            max_scrollback: 100,
        })
        .unwrap();
        let original = term.default_color_palette().unwrap();
        let mut colors = Colors {
            foreground: [1, 2, 3],
            background: [4, 5, 6],
            cursor: Some([7, 8, 9]),
            palette: [[10, 11, 12]; 16],
        };
        colors.apply(&mut term).unwrap();
        let palette = term.default_color_palette().unwrap();
        assert_eq!(&palette.0[16..], &original.0[16..]);
        assert!(palette.0[..16]
            .iter()
            .all(|c| (c.r, c.g, c.b) == (10, 11, 12)));
        assert!(term.default_cursor_color().unwrap().is_some());
        colors.cursor = None;
        colors.apply(&mut term).unwrap();
        assert_eq!(term.default_cursor_color().unwrap(), None);
    }
}
