use std::collections::HashSet;
use std::io::Cursor;

use libghostty_vt::alloc::{Allocator, Bytes};
use libghostty_vt::kitty::graphics::{
    self, DecodePng, DecodedImage, ImageFormat, PlacementIterator,
};
use libghostty_vt::{Error, Terminal};

const STORAGE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PLACEMENTS: usize = 4096;
const MAX_DIMENSION: u32 = 8192;

pub fn configure(term: &mut Terminal<'_, '_>) -> Result<(), Error> {
    if !libghostty_vt::build_info::supports_kitty_graphics()? {
        return Err(Error::InvalidValue);
    }
    graphics::set_png_decoder(Some(Box::new(PngDecoder)))?;
    enforce(term)
}

fn enforce(term: &mut Terminal<'_, '_>) -> Result<(), Error> {
    if term.kitty_image_storage_limit()? != STORAGE_BYTES {
        term.set_kitty_image_storage_limit(STORAGE_BYTES)?;
    }
    if term.is_kitty_image_from_file_allowed()? {
        term.set_kitty_image_from_file_allowed(false)?;
    }
    if term.is_kitty_image_from_temp_file_allowed()? {
        term.set_kitty_image_from_temp_file_allowed(false)?;
    }
    if term.is_kitty_image_from_shared_mem_allowed()? {
        term.set_kitty_image_from_shared_mem_allowed(false)?;
    }
    term.set_apc_max_bytes_kitty(Some(24 * 1024 * 1024))?;
    Ok(())
}

pub fn write(term: &mut Terminal<'_, '_>, bytes: &[u8]) -> Result<(), Error> {
    enforce(term)?;
    let mut start = 0;
    // Native escape state survives C0/DEL, so split conservatively before APC payloads.
    for (at, byte) in bytes.iter().copied().enumerate() {
        if matches!(byte, b'_' | b'X' | b'^' | 0x98..=0x9f) {
            term.vt_write(&bytes[start..=at]);
            enforce(term)?;
            start = at + 1;
        }
    }
    term.vt_write(&bytes[start..]);
    enforce(term)
}

fn rgba_len(width: u32, height: u32) -> Option<usize> {
    if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
        return None;
    }
    let size = (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(4)?;
    (size <= MAX_IMAGE_BYTES).then_some(size)
}

fn decode_png(data: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let mut decoder = png::Decoder::new(Cursor::new(data));
    decoder.set_limits(png::Limits {
        bytes: MAX_IMAGE_BYTES,
    });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().ok()?;
    let size = rgba_len(reader.info().width, reader.info().height)?;
    if reader.output_buffer_size() > size {
        return None;
    }
    let mut raw = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut raw).ok()?;
    reader.finish().ok()?;
    let channels = match info.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Grayscale => 1,
        _ => return None,
    };
    if info.bit_depth != png::BitDepth::Eight || info.buffer_size() != size / 4 * channels {
        return None;
    }
    let mut rgba = Vec::with_capacity(size);
    for pixel in raw[..info.buffer_size()].chunks_exact(channels) {
        match channels {
            4 => rgba.extend_from_slice(pixel),
            3 => rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]),
            2 => rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]]),
            _ => rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], 255]),
        }
    }
    Some((info.width, info.height, rgba))
}

struct PngDecoder;
impl DecodePng for PngDecoder {
    fn decode_png<'a>(
        &mut self,
        alloc: &'a Allocator<'_>,
        data: &[u8],
    ) -> Option<DecodedImage<'a>> {
        let (width, height, rgba) = decode_png(data)?;
        let mut data = Bytes::new_with_alloc(alloc, rgba.len()).ok()?;
        data.copy_from_slice(&rgba);
        Some(DecodedImage {
            width,
            height,
            data,
        })
    }
}

fn word(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}
fn generation(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}

pub struct GraphicsSnapshot {
    cell: (u32, u32),
    iterator: PlacementIterator<'static>,
    visible: HashSet<u64>,
    generation: u64,
    active: bool,
    out: Vec<u8>,
}

impl GraphicsSnapshot {
    pub fn new() -> Result<Self, Error> {
        Ok(Self {
            cell: (8, 16),
            iterator: PlacementIterator::new()?,
            visible: HashSet::new(),
            generation: 0,
            active: false,
            out: Vec::new(),
        })
    }

    pub fn set_cell_pixels(&mut self, width: u32, height: u32) {
        self.cell = (width, height);
    }

    pub fn changed(&self, term: &Terminal<'_, '_>) -> Result<bool, Error> {
        match term.kitty_graphics() {
            Ok(storage) => Ok(storage.generation()? != self.generation),
            Err(_) if !self.active => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn capture(&mut self, term: &Terminal<'_, '_>, full: bool) -> Result<Option<&[u8]>, Error> {
        let storage = match term.kitty_graphics() {
            Ok(value) => value,
            Err(_) if !self.active => return Ok(None),
            Err(error) => return Err(error),
        };
        let storage_generation = storage.generation()?;
        if storage_generation == 0 && !self.active {
            return Ok(None);
        }
        let (cell_width, cell_height) = self.cell;
        let mut uploads = Vec::new();
        let mut placements = Vec::new();
        let mut next_visible = HashSet::new();
        let mut placement_count = 0;
        let mut upload_count = 0;
        let mut current = self.iterator.update(&storage)?;
        while let Some(placement) = current.next() {
            let id = placement.image_id()?;
            let image = storage.image(id).ok_or(Error::InvalidValue)?;
            let info = placement.placement_render_info(&image, term)?;
            if !info.viewport_visible {
                continue;
            }
            placement_count += 1;
            if placement_count > MAX_PLACEMENTS {
                return Err(Error::OutOfSpace {
                    required: placement_count,
                });
            }
            let stamp = image.generation()?;
            let first = next_visible.insert(stamp);
            if first && (full || !self.visible.contains(&stamp)) {
                let width = image.width()?;
                let height = image.height()?;
                let len = rgba_len(width, height).ok_or(Error::OutOfSpace {
                    required: MAX_IMAGE_BYTES + 1,
                })?;
                let data = image.data()?;
                let channels = match image.format()? {
                    ImageFormat::Rgb => 3,
                    ImageFormat::Rgba => 4,
                    ImageFormat::Gray => 1,
                    ImageFormat::GrayAlpha => 2,
                    _ => return Err(Error::InvalidValue),
                };
                if data.len() != len / 4 * channels {
                    return Err(Error::InvalidValue);
                }
                if uploads.len() + len + 24 > MAX_IMAGE_BYTES {
                    return Err(Error::OutOfSpace {
                        required: uploads.len() + len + 24,
                    });
                }
                word(&mut uploads, id);
                generation(&mut uploads, stamp);
                word(&mut uploads, width);
                word(&mut uploads, height);
                word(&mut uploads, len as u32);
                if channels == 4 {
                    uploads.extend_from_slice(data);
                } else {
                    for pixel in data.chunks_exact(channels) {
                        match channels {
                            4 => uploads.extend_from_slice(pixel),
                            3 => uploads.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]),
                            2 => {
                                uploads.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]])
                            }
                            _ => uploads.extend_from_slice(&[pixel[0], pixel[0], pixel[0], 255]),
                        }
                    }
                }
                upload_count += 1;
            }
            word(&mut placements, id);
            generation(&mut placements, stamp);
            word(&mut placements, placement.z()? as u32);
            word(&mut placements, info.viewport_col as u32);
            word(&mut placements, info.viewport_row as u32);
            word(&mut placements, placement.x_offset()?);
            word(&mut placements, placement.y_offset()?);
            for value in [
                info.source_x,
                info.source_y,
                info.source_width,
                info.source_height,
                info.pixel_width,
                info.pixel_height,
            ] {
                word(&mut placements, value);
            }
        }
        self.out.clear();
        for value in [
            1,
            cell_width,
            cell_height,
            upload_count,
            placement_count as u32,
        ] {
            word(&mut self.out, value);
        }
        self.out.extend_from_slice(&uploads);
        self.out.extend_from_slice(&placements);
        self.visible = next_visible;
        self.generation = storage_generation;
        self.active = true;
        Ok(Some(&self.out))
    }
}

#[cfg(test)]
mod tests {
    use libghostty_vt::kitty::graphics::PlacementIterator;
    use libghostty_vt::{Terminal, TerminalOptions};

    #[test]
    fn pinned_prebuilt_stores_direct_rgba_and_native_placement() {
        assert!(libghostty_vt::build_info::supports_kitty_graphics().unwrap());
        let mut term = Terminal::new(TerminalOptions {
            cols: 20,
            rows: 10,
            max_scrollback: 65536,
        })
        .unwrap();
        term.resize(20, 10, 8, 16).unwrap();
        term.set_kitty_image_storage_limit(1024 * 1024).unwrap();
        term.vt_write(b"\x1b_Ga=T,f=32,s=1,v=1,i=42,c=2,r=2,q=2;/wAA/w==\x1b\\");
        let storage = term.kitty_graphics().unwrap();
        let image = storage.image(42).expect("stored direct RGBA image");
        assert_eq!(image.data().unwrap(), &[255, 0, 0, 255]);
        let mut iter = PlacementIterator::new().unwrap();
        let mut placements = iter.update(&storage).unwrap();
        let placement = placements.next().expect("visible placement");
        assert_eq!(placement.image_id().unwrap(), 42);
        let info = placement.placement_render_info(&image, &term).unwrap();
        assert!(info.viewport_visible);
        assert_eq!((info.pixel_width, info.pixel_height), (16, 32));
        assert!(placements.next().is_none());
        let mut snapshot = super::super::snapshot::Snapshotter::new().unwrap();
        let frame = snapshot.build(&term, 1, true).unwrap().unwrap();
        assert_ne!(frame[17] & 16, 0, "image placements must reach the frame");
        check_fixture(frame);
    }
    fn check_fixture(frame: &[u8]) {
        let mut actual = frame.to_vec();
        let u16_at = |at: usize| u16::from_le_bytes(frame[at..at + 2].try_into().unwrap()) as usize;
        let u32_at = |at: usize| u32::from_le_bytes(frame[at..at + 4].try_into().unwrap()) as usize;
        let mut at = 36 + u16_at(32) * 16;
        for _ in 0..u16_at(18) {
            at += 8 + u16_at(at + 2) * 4 + u16_at(at + 4) * 4;
        }
        assert_eq!(frame[17] & 8, 0);
        assert_eq!(u32_at(at + 12), 1);
        assert_eq!(u32_at(at + 16), 1);
        let image = at + 20;
        let placement = image + 24 + u32_at(image + 20);
        for stamp in [image + 4, placement + 4] {
            actual[stamp..stamp + 8].copy_from_slice(&1u64.to_le_bytes());
        }
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        let path = root.join("tests/fixtures/terminal-graphics/direct-rgba.frame");
        if std::env::var("UPDATE_FIXTURES").as_deref() == Ok("1") {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &actual).unwrap();
        }
        assert_eq!(actual, std::fs::read(path).unwrap());
    }

    fn terminal() -> Terminal<'static, 'static> {
        let mut term = Terminal::new(TerminalOptions {
            cols: 20,
            rows: 10,
            max_scrollback: 65536,
        })
        .unwrap();
        term.resize(20, 10, 8, 16).unwrap();
        super::configure(&mut term).unwrap();
        term
    }

    fn words(data: &[u8]) -> Vec<u32> {
        data.chunks_exact(4)
            .map(|v| u32::from_le_bytes(v.try_into().unwrap()))
            .collect()
    }

    #[test]
    fn native_generations_upload_once_replace_and_clear_on_screen_switch() {
        let mut term = terminal();
        let mut snapshot = super::GraphicsSnapshot::new().unwrap();
        assert!(snapshot.capture(&term, true).unwrap().is_none());
        term.vt_write(b"\x1b_Ga=T,f=32,s=1,v=1,i=42,c=2,r=2,q=2;/wAA/w==\x1b\\");
        assert!(snapshot.changed(&term).unwrap());
        let full = words(snapshot.capture(&term, true).unwrap().unwrap());
        assert_eq!((full[3], full[4]), (1, 1));
        assert_eq!(full[11], 0xff0000ff);
        let delta = words(snapshot.capture(&term, false).unwrap().unwrap());
        assert_eq!((delta[3], delta[4]), (0, 1));
        term.vt_write(b"\x1b_Ga=T,f=32,s=1,v=1,i=42,c=2,r=2,q=2;AP8A/w==\x1b\\");
        let replaced = words(snapshot.capture(&term, false).unwrap().unwrap());
        assert_eq!(replaced[3], 1);
        assert_eq!(replaced[11], 0xff00ff00);
        assert_ne!(&full[6..8], &replaced[6..8]);
        term.vt_write(b"\x1b[?1049h");
        let alternate = words(snapshot.capture(&term, false).unwrap().unwrap());
        assert_eq!((alternate[3], alternate[4]), (0, 0));
        term.vt_write(b"\x1b[?1049l");
        let restored = words(snapshot.capture(&term, false).unwrap().unwrap());
        assert_eq!(restored[3], 1);
        term.vt_write(b"\x1b_Ga=d,d=A,q=2\x1b\\");
        let deleted = words(snapshot.capture(&term, false).unwrap().unwrap());
        assert_eq!((deleted[3], deleted[4]), (0, 0));
    }

    #[test]
    fn terminal_graphics_cannot_read_files_temporary_files_or_shared_memory() {
        let mut term = terminal();
        for screen in [b"".as_slice(), b"\x1b[?1049h", b"\x1b[?1049l", b"\x1bc"] {
            super::write(&mut term, screen).unwrap();
            assert!(!term.is_kitty_image_from_file_allowed().unwrap());
            assert!(!term.is_kitty_image_from_temp_file_allowed().unwrap());
            assert!(!term.is_kitty_image_from_shared_mem_allowed().unwrap());
            assert_eq!(
                term.kitty_image_storage_limit().unwrap(),
                super::STORAGE_BYTES
            );
        }
    }

    fn png(color: png::ColorType, pixels: &[u8], width: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, 1);
            encoder.set_color(color);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(pixels)
                .unwrap();
        }
        bytes
    }

    #[test]
    fn png_decoder_preserves_alpha_and_converts_rgb_and_gray_with_bounds() {
        for (color, input, output) in [
            (png::ColorType::Rgba, vec![1, 2, 3, 4], vec![1, 2, 3, 4]),
            (png::ColorType::Rgb, vec![1, 2, 3], vec![1, 2, 3, 255]),
            (png::ColorType::Grayscale, vec![7], vec![7, 7, 7, 255]),
            (png::ColorType::GrayscaleAlpha, vec![7, 8], vec![7, 7, 7, 8]),
        ] {
            let data = png(color, &input, 1);
            assert_eq!(super::decode_png(&data).unwrap(), (1, 1, output));
            assert!(super::decode_png(&data[..data.len() / 2]).is_none());
        }
        let huge = png(png::ColorType::Grayscale, &vec![0; 8193], 8193);
        assert!(super::decode_png(&huge).is_none());
        assert!(super::decode_png(b"not a PNG").is_none());
        assert!(super::rgba_len(u32::MAX, u32::MAX).is_none());
    }
    #[test]
    fn reset_and_screen_changes_before_inline_data_preserve_policy_at_every_boundary() {
        use std::sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        };
        let prefixes: [&[u8]; 5] = [b"\x1b_", b"\x1b\0_", b"\x1b\x7f_", b"\x1bX", b"\x1b^"];
        for prefix in prefixes {
            let mut bytes = b"\x1b[?1049h\x1bc".to_vec();
            bytes.extend_from_slice(prefix);
            bytes.extend_from_slice(b"Ga=T,f=32,s=1,v=1,i=42,c=2,r=2,q=0;/wAA/w==\x1b\\");
            for split in 0..=bytes.len() {
                let observed = Arc::new(AtomicU64::new(0));
                let seen = observed.clone();
                let mut term = terminal();
                term.on_pty_write(move |term, _| {
                    seen.store(term.kitty_image_storage_limit().unwrap(), Ordering::Relaxed);
                })
                .unwrap();
                super::write(&mut term, &bytes[..split]).unwrap();
                super::write(&mut term, &bytes[split..]).unwrap();
                let storage = term.kitty_graphics().unwrap();
                let image = storage.image(42).unwrap_or_else(|| {
                    panic!("inline image missing prefix {prefix:?}, split {split}")
                });
                assert_eq!(image.data().unwrap(), &[255, 0, 0, 255]);
                assert_eq!(
                    observed.load(Ordering::Relaxed),
                    super::STORAGE_BYTES,
                    "quota at image reply, prefix {prefix:?}, split {split}"
                );
                assert_eq!(
                    term.kitty_image_storage_limit().unwrap(),
                    super::STORAGE_BYTES
                );
                assert!(!term.is_kitty_image_from_file_allowed().unwrap());
            }
        }
    }
    fn base64(data: &[u8]) -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in data.chunks(3) {
            let value = u32::from(chunk[0]) << 16
                | u32::from(*chunk.get(1).unwrap_or(&0)) << 8
                | u32::from(*chunk.get(2).unwrap_or(&0));
            for shift in [18, 12] {
                out.push(ALPHABET[((value >> shift) & 63) as usize] as char);
            }
            out.push(if chunk.len() > 1 {
                ALPHABET[((value >> 6) & 63) as usize] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                ALPHABET[(value & 63) as usize] as char
            } else {
                '='
            });
        }
        out
    }

    #[test]
    fn actual_png_callback_and_conservative_splits_preserve_all_pixels() {
        let pixels: Vec<u8> = (0..1024).map(|value| value as u8).collect();
        let payload = base64(&png(png::ColorType::Rgba, &pixels, 256));
        assert!(payload.contains('X'));
        let packet = format!("\x1b_Ga=T,f=100,i=42,q=2;{payload}\x1b\\");
        let mut term = terminal();
        for chunk in packet.as_bytes().chunks(7) {
            super::write(&mut term, chunk).unwrap();
        }
        let storage = term.kitty_graphics().unwrap();
        let image = storage
            .image(42)
            .expect("decoded PNG retained across conservative feed splits");
        assert_eq!(image.data().unwrap(), pixels);
    }
    #[test]
    fn raw_c1_variants_preserve_the_pinned_utf8_core_behavior() {
        for prefix in [0x98, 0x9e, 0x9f] {
            let mut bytes = b"\x1bc".to_vec();
            bytes.push(prefix);
            bytes.extend_from_slice(b"Ga=T,f=32,s=1,v=1,i=42,q=2;/wAA/w==\x1b\\");
            let mut reference = terminal();
            reference.vt_write(&bytes);
            assert!(reference.kitty_graphics().unwrap().image(42).is_none());
            for split in 0..=bytes.len() {
                let mut guarded = terminal();
                super::write(&mut guarded, &bytes[..split]).unwrap();
                super::write(&mut guarded, &bytes[split..]).unwrap();
                assert!(guarded.kitty_graphics().unwrap().image(42).is_none());
                assert_eq!(
                    super::super::text::read_text(&guarded, 10).unwrap(),
                    super::super::text::read_text(&reference, 10).unwrap()
                );
                assert_eq!(
                    guarded.kitty_image_storage_limit().unwrap(),
                    super::STORAGE_BYTES
                );
            }
        }
    }
}
