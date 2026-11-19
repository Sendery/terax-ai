//! RIFF/WAVE parsing and the concatenation behind a Reader export.
//!
//! Chunks are cached per segment, so an export is a walk over many small PCM
//! files that must agree on their format. The writer streams into any
//! `Write + Seek` and patches the RIFF sizes at the end, so an hour of audio
//! never has to sit in memory at once.

use std::io::{Seek, SeekFrom, Write};
use std::ops::Range;

use serde::Serialize;

const FORMAT_PCM: u16 = 1;
const FORMAT_EXTENSIBLE: u16 = 0xFFFE;
/// RIFF sizes are u32; the header fields before the data count against it.
const MAX_RIFF_BYTES: u64 = u32::MAX as u64;
const HEADER_BYTES: u64 = 44;
const CUE_FRAMES_PER_SECOND: u64 = 75;
/// The CUE sheet format numbers tracks 01 to 99.
const MAX_CUE_TRACKS: usize = 99;
const MAX_CHAPTER_TITLE_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmFormat {
    pub channels: u16,
    pub sample_rate: u32,
    pub bits_per_sample: u16,
}

impl PcmFormat {
    pub fn block_align(&self) -> u32 {
        u32::from(self.channels) * u32::from(self.bits_per_sample.div_ceil(8))
    }

    fn describe(&self) -> String {
        format!(
            "{} ch, {} Hz, {} bit",
            self.channels, self.sample_rate, self.bits_per_sample
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedWav {
    pub format: PcmFormat,
    /// Byte range of the sample data, trimmed to whole frames.
    pub data: Range<usize>,
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

pub fn is_riff_wave(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE"
}

fn parse_fmt(body: &[u8]) -> Result<PcmFormat, String> {
    if body.len() < 16 {
        return Err("fmt chunk is too short".into());
    }
    let mut tag = u16_at(body, 0);
    if tag == FORMAT_EXTENSIBLE {
        // WAVEFORMATEXTENSIBLE: the real tag is the first two bytes of the
        // sub-format GUID at offset 24.
        if body.len() < 40 {
            return Err("extensible fmt chunk is too short".into());
        }
        tag = u16_at(body, 24);
    }
    if tag != FORMAT_PCM {
        return Err(format!(
            "unsupported WAV encoding (format tag {tag}), PCM is required"
        ));
    }
    let format = PcmFormat {
        channels: u16_at(body, 2),
        sample_rate: u32_at(body, 4),
        bits_per_sample: u16_at(body, 14),
    };
    if format.channels == 0 || format.sample_rate == 0 {
        return Err("WAV declares zero channels or a zero sample rate".into());
    }
    if !matches!(format.bits_per_sample, 8 | 16 | 24 | 32) {
        return Err(format!(
            "unsupported PCM sample size of {} bits",
            format.bits_per_sample
        ));
    }
    Ok(format)
}

/// Walks the chunk list for `fmt ` and `data`, skipping anything else (LIST,
/// fact, cue). A data chunk that claims more than the file holds is clamped,
/// since streaming encoders write 0xFFFFFFFF or a stale size there.
pub fn parse_wav(bytes: &[u8]) -> Result<ParsedWav, String> {
    if !is_riff_wave(bytes) {
        return Err("not a RIFF/WAVE file".into());
    }
    let mut cursor = 12_usize;
    let mut format: Option<PcmFormat> = None;
    while cursor + 8 <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32_at(bytes, cursor + 4) as usize;
        let body = cursor + 8;
        let available = bytes.len() - body;
        if id == b"data" {
            let format = format.ok_or("WAV data chunk precedes its fmt chunk")?;
            let len = size.min(available);
            let align = format.block_align() as usize;
            let whole = len - len % align;
            return Ok(ParsedWav {
                format,
                data: body..body + whole,
            });
        }
        if size > available {
            return Err("WAV has a truncated chunk".into());
        }
        if id == b"fmt " {
            format = Some(parse_fmt(&bytes[body..body + size])?);
        }
        cursor = body + size + (size & 1);
    }
    Err(if format.is_some() {
        "WAV has no data chunk".into()
    } else {
        "WAV has no fmt chunk".into()
    })
}

/// Canonical 44-byte PCM header for `data_len` bytes of samples.
pub fn pcm_header(format: &PcmFormat, data_len: u32) -> [u8; 44] {
    let block_align = format.block_align();
    let pad = data_len & 1;
    let riff_size = 36 + data_len + pad;
    let mut header = [0_u8; 44];
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&riff_size.to_le_bytes());
    header[8..12].copy_from_slice(b"WAVE");
    header[12..16].copy_from_slice(b"fmt ");
    header[16..20].copy_from_slice(&16_u32.to_le_bytes());
    header[20..22].copy_from_slice(&FORMAT_PCM.to_le_bytes());
    header[22..24].copy_from_slice(&format.channels.to_le_bytes());
    header[24..28].copy_from_slice(&format.sample_rate.to_le_bytes());
    header[28..32].copy_from_slice(&(format.sample_rate * block_align).to_le_bytes());
    header[32..34].copy_from_slice(&(block_align as u16).to_le_bytes());
    header[34..36].copy_from_slice(&format.bits_per_sample.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data_len.to_le_bytes());
    header
}

pub fn silence_frames(format: &PcmFormat, ms: u32) -> u64 {
    u64::from(format.sample_rate) * u64::from(ms) / 1000
}

pub fn frames_to_ms(format: &PcmFormat, frames: u64) -> u64 {
    frames * 1000 / u64::from(format.sample_rate)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub title: String,
    pub start_ms: u64,
}

pub struct ConcatSegment<'a> {
    pub key: &'a str,
    pub pause_after_ms: u32,
    pub chapter: Option<&'a str>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ConcatSummary {
    pub format: PcmFormat,
    pub duration_ms: u64,
    pub chapters: Vec<Chapter>,
}

fn clean_chapter_title(raw: &str) -> Option<String> {
    let collapsed = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>();
    let trimmed = collapsed.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_CHAPTER_TITLE_CHARS).collect())
}

fn write_silence<W: Write>(out: &mut W, format: &PcmFormat, bytes: u64) -> Result<(), String> {
    // Unsigned 8-bit PCM is centred on 0x80; every wider size is signed.
    let fill = if format.bits_per_sample == 8 { 0x80 } else { 0 };
    let block = [fill; 8192];
    let mut left = bytes;
    while left > 0 {
        let n = left.min(block.len() as u64) as usize;
        out.write_all(&block[..n]).map_err(|e| e.to_string())?;
        left -= n as u64;
    }
    Ok(())
}

/// Concatenates the segments' PCM data, with `pause_after_ms` of silence
/// after each, into one WAV on `out`. `load` returns a segment's cached bytes
/// or an error naming it.
pub fn concat_wavs<W, L>(
    out: &mut W,
    segments: &[ConcatSegment<'_>],
    mut load: L,
) -> Result<ConcatSummary, String>
where
    W: Write + Seek,
    L: FnMut(&str) -> Result<Vec<u8>, String>,
{
    if segments.is_empty() {
        return Err("nothing to export: no segments".into());
    }
    let start = out.stream_position().map_err(|e| e.to_string())?;
    out.write_all(&[0_u8; HEADER_BYTES as usize])
        .map_err(|e| e.to_string())?;

    let mut format: Option<PcmFormat> = None;
    let mut data_len: u64 = 0;
    let mut frames: u64 = 0;
    let mut chapters = Vec::new();
    let too_large = || "export would exceed the 4 GiB WAV limit".to_string();

    for segment in segments {
        let bytes = load(segment.key)?;
        let parsed =
            parse_wav(&bytes).map_err(|e| format!("chunk {} is unusable: {e}", segment.key))?;
        let fmt = *format.get_or_insert(parsed.format);
        if parsed.format != fmt {
            return Err(format!(
                "chunk {} is {}, but the export started as {}",
                segment.key,
                parsed.format.describe(),
                fmt.describe()
            ));
        }
        if let Some(title) = segment.chapter.and_then(clean_chapter_title) {
            chapters.push(Chapter {
                title,
                start_ms: frames_to_ms(&fmt, frames),
            });
        }
        let align = u64::from(fmt.block_align());
        let pcm = &bytes[parsed.data];
        let silence = silence_frames(&fmt, segment.pause_after_ms) * align;
        let added = pcm.len() as u64 + silence;
        if HEADER_BYTES - 8 + data_len + added + 1 > MAX_RIFF_BYTES {
            return Err(too_large());
        }
        out.write_all(pcm).map_err(|e| e.to_string())?;
        write_silence(out, &fmt, silence)?;
        data_len += added;
        frames += added / align;
    }

    let format = format.expect("at least one segment was written");
    if data_len & 1 == 1 {
        out.write_all(&[0]).map_err(|e| e.to_string())?;
    }
    let data_len32 = u32::try_from(data_len).map_err(|_| too_large())?;
    let end = out.stream_position().map_err(|e| e.to_string())?;
    out.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    out.write_all(&pcm_header(&format, data_len32))
        .map_err(|e| e.to_string())?;
    out.seek(SeekFrom::Start(end)).map_err(|e| e.to_string())?;

    Ok(ConcatSummary {
        format,
        duration_ms: frames_to_ms(&format, frames),
        chapters,
    })
}

fn cue_quote(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '"' => '\'',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect()
}

pub fn cue_timestamp(ms: u64) -> String {
    let minutes = ms / 60_000;
    let seconds = (ms / 1000) % 60;
    let frames = (ms % 1000) * CUE_FRAMES_PER_SECOND / 1000;
    format!("{minutes:02}:{seconds:02}:{frames:02}")
}

/// A CUE sheet with one track per chapter, capped at the format's 99 tracks.
pub fn cue_sheet(wav_file_name: &str, chapters: &[Chapter]) -> String {
    let mut sheet = format!("FILE \"{}\" WAVE\n", cue_quote(wav_file_name));
    for (index, chapter) in chapters.iter().take(MAX_CUE_TRACKS).enumerate() {
        sheet.push_str(&format!(
            "  TRACK {:02} AUDIO\n    TITLE \"{}\"\n    INDEX 01 {}\n",
            index + 1,
            cue_quote(&chapter.title),
            cue_timestamp(chapter.start_ms)
        ));
    }
    sheet
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::Cursor;

    const MONO16: PcmFormat = PcmFormat {
        channels: 1,
        sample_rate: 1000,
        bits_per_sample: 16,
    };

    fn chunk(id: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = id.to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(body);
        if body.len() % 2 == 1 {
            out.push(0);
        }
        out
    }

    fn fmt_body(tag: u16, format: &PcmFormat) -> Vec<u8> {
        let align = format.block_align();
        let mut body = Vec::new();
        body.extend_from_slice(&tag.to_le_bytes());
        body.extend_from_slice(&format.channels.to_le_bytes());
        body.extend_from_slice(&format.sample_rate.to_le_bytes());
        body.extend_from_slice(&(format.sample_rate * align).to_le_bytes());
        body.extend_from_slice(&(align as u16).to_le_bytes());
        body.extend_from_slice(&format.bits_per_sample.to_le_bytes());
        body
    }

    fn wav_from_chunks(chunks: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = chunks.concat();
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(body.len() as u32 + 4).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(&body);
        out
    }

    fn wav(format: &PcmFormat, samples: &[u8]) -> Vec<u8> {
        wav_from_chunks(&[
            chunk(b"fmt ", &fmt_body(1, format)),
            chunk(b"data", samples),
        ])
    }

    #[test]
    fn parses_a_canonical_wav() {
        let bytes = wav(&MONO16, &[1, 0, 2, 0]);
        let parsed = parse_wav(&bytes).unwrap();
        assert_eq!(parsed.format, MONO16);
        assert_eq!(&bytes[parsed.data], &[1, 0, 2, 0]);
    }

    #[test]
    fn skips_list_chunks_and_odd_padding_before_data() {
        let bytes = wav_from_chunks(&[
            chunk(b"LIST", b"INFOabc"),
            chunk(b"fmt ", &fmt_body(1, &MONO16)),
            chunk(b"junk", &[9]),
            chunk(b"data", &[5, 0, 6, 0]),
        ]);
        let parsed = parse_wav(&bytes).unwrap();
        assert_eq!(&bytes[parsed.data], &[5, 0, 6, 0]);
    }

    #[test]
    fn accepts_extensible_pcm_and_rejects_float() {
        let mut body = fmt_body(FORMAT_EXTENSIBLE, &MONO16);
        body.extend_from_slice(&22_u16.to_le_bytes());
        body.extend_from_slice(&16_u16.to_le_bytes());
        body.extend_from_slice(&4_u32.to_le_bytes());
        body.extend_from_slice(&[
            1, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xAA, 0, 0x38, 0x9B, 0x71,
        ]);
        let bytes = wav_from_chunks(&[chunk(b"fmt ", &body), chunk(b"data", &[0, 0])]);
        assert_eq!(parse_wav(&bytes).unwrap().format, MONO16);

        let float = wav_from_chunks(&[
            chunk(b"fmt ", &fmt_body(3, &MONO16)),
            chunk(b"data", &[0, 0]),
        ]);
        assert!(parse_wav(&float).unwrap_err().contains("PCM"));
    }

    #[test]
    fn clamps_an_oversized_data_chunk_and_drops_partial_frames() {
        let mut bytes = wav(&MONO16, &[1, 0, 2, 0, 3]);
        let data_size_at = bytes.len() - 5 - 1 - 4;
        bytes[data_size_at..data_size_at + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        let parsed = parse_wav(&bytes).unwrap();
        assert_eq!(parsed.data.len(), 6);
    }

    #[test]
    fn rejects_malformed_input() {
        assert!(parse_wav(b"RIFF").is_err());
        assert!(parse_wav(b"RIFX\0\0\0\0WAVEfmt ").is_err());
        let no_fmt = wav_from_chunks(&[chunk(b"data", &[0, 0])]);
        assert!(parse_wav(&no_fmt).is_err());
        let no_data = wav_from_chunks(&[chunk(b"fmt ", &fmt_body(1, &MONO16))]);
        assert!(parse_wav(&no_data).unwrap_err().contains("no data"));
        let mut truncated = wav_from_chunks(&[chunk(b"fmt ", &fmt_body(1, &MONO16))]);
        truncated.truncate(truncated.len() - 3);
        assert!(parse_wav(&truncated).unwrap_err().contains("truncated"));
    }

    fn run_concat(
        store: &HashMap<&str, Vec<u8>>,
        segments: &[ConcatSegment<'_>],
    ) -> Result<(Vec<u8>, ConcatSummary), String> {
        let mut out = Cursor::new(Vec::new());
        let summary = concat_wavs(&mut out, segments, |key| {
            store
                .get(key)
                .cloned()
                .ok_or_else(|| format!("missing chunk {key}"))
        })?;
        Ok((out.into_inner(), summary))
    }

    #[test]
    fn concatenates_with_pauses_and_chapters() {
        let store = HashMap::from([
            ("a", wav(&MONO16, &[1, 0, 2, 0])),
            ("b", wav(&MONO16, &[3, 0])),
        ]);
        let segments = [
            ConcatSegment {
                key: "a",
                pause_after_ms: 3,
                chapter: Some("  Intro\n"),
            },
            ConcatSegment {
                key: "b",
                pause_after_ms: 0,
                chapter: Some("Part 2"),
            },
            ConcatSegment {
                key: "a",
                pause_after_ms: 0,
                chapter: Some("   "),
            },
        ];
        let (bytes, summary) = run_concat(&store, &segments).unwrap();
        let parsed = parse_wav(&bytes).unwrap();
        assert_eq!(parsed.format, MONO16);
        assert_eq!(
            &bytes[parsed.data.clone()],
            &[1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 0, 2, 0]
        );
        assert_eq!(u32_at(&bytes, 4) as usize, bytes.len() - 8);
        assert_eq!(summary.duration_ms, 8);
        assert_eq!(
            summary.chapters,
            vec![
                Chapter {
                    title: "Intro".into(),
                    start_ms: 0
                },
                Chapter {
                    title: "Part 2".into(),
                    start_ms: 5
                },
            ]
        );
    }

    #[test]
    fn pads_odd_data_and_uses_unsigned_silence_for_8_bit() {
        let mono8 = PcmFormat {
            channels: 1,
            sample_rate: 1000,
            bits_per_sample: 8,
        };
        let store = HashMap::from([("a", wav(&mono8, &[7]))]);
        let segments = [ConcatSegment {
            key: "a",
            pause_after_ms: 2,
            chapter: None,
        }];
        let (bytes, summary) = run_concat(&store, &segments).unwrap();
        let parsed = parse_wav(&bytes).unwrap();
        assert_eq!(&bytes[parsed.data.clone()], &[7, 0x80, 0x80]);
        assert_eq!(bytes.len(), 44 + 3 + 1);
        assert_eq!(u32_at(&bytes, 40), 3);
        assert_eq!(u32_at(&bytes, 4) as usize, bytes.len() - 8);
        assert_eq!(summary.duration_ms, 3);
    }

    #[test]
    fn names_the_first_mismatching_or_missing_chunk() {
        let stereo = PcmFormat {
            channels: 2,
            ..MONO16
        };
        let store = HashMap::from([
            ("a", wav(&MONO16, &[1, 0])),
            ("b", wav(&stereo, &[1, 0, 2, 0])),
        ]);
        let mismatch = [
            ConcatSegment {
                key: "a",
                pause_after_ms: 0,
                chapter: None,
            },
            ConcatSegment {
                key: "b",
                pause_after_ms: 0,
                chapter: None,
            },
        ];
        let error = run_concat(&store, &mismatch).unwrap_err();
        assert!(error.contains("chunk b"), "{error}");

        let missing = [ConcatSegment {
            key: "zz",
            pause_after_ms: 0,
            chapter: None,
        }];
        assert!(run_concat(&store, &missing).unwrap_err().contains("zz"));
        assert!(run_concat(&store, &[]).is_err());
    }

    #[test]
    fn refuses_exports_past_the_riff_limit() {
        let store = HashMap::from([("a", wav(&MONO16, &[0, 0]))]);
        let segments = [ConcatSegment {
            key: "a",
            pause_after_ms: u32::MAX,
            chapter: None,
        }];
        // 1 kHz mono 16-bit for u32::MAX ms is ~8.6 GB of silence.
        let error = run_concat(&store, &segments).unwrap_err();
        assert!(error.contains("4 GiB"), "{error}");
    }

    #[test]
    fn cue_timestamps_use_75_frames_per_second() {
        assert_eq!(cue_timestamp(0), "00:00:00");
        assert_eq!(cue_timestamp(61_500), "01:01:37");
        assert_eq!(cue_timestamp(6_000_999), "100:00:74");
    }

    #[test]
    fn cue_sheet_lists_one_track_per_chapter() {
        let chapters = vec![
            Chapter {
                title: "One \"quoted\"".into(),
                start_ms: 0,
            },
            Chapter {
                title: "Two".into(),
                start_ms: 2_040,
            },
        ];
        let sheet = cue_sheet("book.wav", &chapters);
        assert_eq!(
            sheet,
            "FILE \"book.wav\" WAVE\n  TRACK 01 AUDIO\n    TITLE \"One 'quoted'\"\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    TITLE \"Two\"\n    INDEX 01 00:02:03\n"
        );
        let many: Vec<_> = (0..120)
            .map(|i| Chapter {
                title: format!("c{i}"),
                start_ms: i,
            })
            .collect();
        assert_eq!(cue_sheet("x.wav", &many).matches("TRACK").count(), 99);
    }
}
