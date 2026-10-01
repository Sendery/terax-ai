//! Voice sample import.
//!
//! The bytes arrive from the webview, so the RIFF container is parsed before
//! anything is written and the stored file name is a generated id: the
//! user-supplied name only ever reaches the metadata sidecar.

use serde::Serialize;

pub const MAX_SAMPLE_BYTES: usize = 16 * 1024 * 1024;
const MIN_WAV_BYTES: usize = 44;
const MIN_SAMPLE_RATE: u32 = 8_000;
const MAX_SAMPLE_RATE: u32 = 96_000;
const MAX_NAME_CHARS: usize = 80;

/// WAVE format tags we accept: 1 is uncompressed PCM, 3 is IEEE float.
const FORMAT_PCM: u16 = 1;
const FORMAT_FLOAT: u16 = 3;
const FORMAT_EXTENSIBLE: u16 = 0xFFFE;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WavInfo {
    pub format: u16,
    pub channels: u16,
    pub sample_rate: u32,
    pub bits_per_sample: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleImport {
    pub sample_id: String,
    pub path: String,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleMeta {
    pub sample_id: String,
    pub name: String,
    pub created_at: u64,
    pub info: WavInfo,
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Walks the RIFF chunk list looking for `fmt ` and `data`. A chunk header is
/// 8 bytes and chunk bodies are word-aligned, so a malformed size must never
/// be trusted for indexing.
pub fn validate_wav(bytes: &[u8]) -> Result<WavInfo, String> {
    if bytes.len() > MAX_SAMPLE_BYTES {
        return Err("sample exceeds the 16 MiB limit".into());
    }
    if bytes.len() < MIN_WAV_BYTES {
        return Err("sample is not a WAV file".into());
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("sample is not a RIFF/WAVE file".into());
    }
    let riff_size = u32_at(bytes, 4) as usize;
    if riff_size < 4 || riff_size > bytes.len() - 8 {
        return Err("sample has an inconsistent RIFF size".into());
    }

    let mut cursor = 12_usize;
    let mut fmt: Option<WavInfo> = None;
    let mut has_data = false;
    while cursor + 8 <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32_at(bytes, cursor + 4) as usize;
        let body = cursor + 8;
        if size > bytes.len() - body {
            return Err("sample has a truncated chunk".into());
        }
        if id == b"fmt " {
            if size < 16 {
                return Err("sample has a truncated format chunk".into());
            }
            fmt = Some(WavInfo {
                format: u16_at(bytes, body),
                channels: u16_at(bytes, body + 2),
                sample_rate: u32_at(bytes, body + 4),
                bits_per_sample: u16_at(bytes, body + 14),
            });
        } else if id == b"data" {
            has_data = size > 0;
        }
        cursor = body + size + (size & 1);
    }

    let info = fmt.ok_or_else(|| "sample has no format chunk".to_string())?;
    if !matches!(info.format, FORMAT_PCM | FORMAT_FLOAT | FORMAT_EXTENSIBLE) {
        return Err("sample is not uncompressed PCM or float WAV".into());
    }
    if !matches!(info.channels, 1 | 2) {
        return Err("sample must be mono or stereo".into());
    }
    if !(MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&info.sample_rate) {
        return Err("sample rate must be between 8 kHz and 96 kHz".into());
    }
    if !matches!(info.bits_per_sample, 8 | 16 | 24 | 32 | 64) {
        return Err("sample bit depth is not supported".into());
    }
    if !has_data {
        return Err("sample has no audio data".into());
    }
    Ok(info)
}

/// Collapses whitespace, drops control characters and caps the length. Only
/// used for the metadata label; the file on disk is named by its id.
pub fn sanitize_sample_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed.chars().take(MAX_NAME_CHARS).collect();
    if trimmed.is_empty() {
        "Voice sample".to_string()
    } else {
        trimmed
    }
}

/// Sample ids are generated, never supplied, but the id is also read back from
/// a remove call, so its shape is enforced there too.
pub fn validate_sample_id(id: &str) -> Result<(), String> {
    if id.len() != 32 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid sample id".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(format: u16, channels: u16, sample_rate: u32, bits: u16, data_len: usize) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&0_u32.to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16_u32.to_le_bytes());
        out.extend_from_slice(&format.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&sample_rate.to_le_bytes());
        let byte_rate = sample_rate * u32::from(channels) * u32::from(bits) / 8;
        out.extend_from_slice(&byte_rate.to_le_bytes());
        out.extend_from_slice(&(channels * bits / 8).to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data_len as u32).to_le_bytes());
        out.resize(out.len() + data_len, 0);
        let size = (out.len() - 8) as u32;
        out[4..8].copy_from_slice(&size.to_le_bytes());
        out
    }

    #[test]
    fn accepts_a_well_formed_mono_pcm_sample() {
        let info = validate_wav(&wav(FORMAT_PCM, 1, 24_000, 16, 480)).unwrap();
        assert_eq!(
            info,
            WavInfo {
                format: 1,
                channels: 1,
                sample_rate: 24_000,
                bits_per_sample: 16,
            }
        );
        assert!(validate_wav(&wav(FORMAT_FLOAT, 2, 48_000, 32, 64)).is_ok());
        assert!(validate_wav(&wav(FORMAT_EXTENSIBLE, 1, 16_000, 16, 64)).is_ok());
    }

    #[test]
    fn rejects_a_wrong_magic() {
        let mut bad = wav(FORMAT_PCM, 1, 24_000, 16, 64);
        bad[0..4].copy_from_slice(b"RIFX");
        assert!(validate_wav(&bad).is_err());
        let mut bad = wav(FORMAT_PCM, 1, 24_000, 16, 64);
        bad[8..12].copy_from_slice(b"AVI ");
        assert!(validate_wav(&bad).is_err());
        assert!(validate_wav(b"").is_err());
        assert!(validate_wav(b"RIFF").is_err());
        assert!(validate_wav(&[0_u8; 64]).is_err());
    }

    #[test]
    fn rejects_an_oversized_payload_before_parsing() {
        let huge = vec![0_u8; MAX_SAMPLE_BYTES + 1];
        assert_eq!(
            validate_wav(&huge).unwrap_err(),
            "sample exceeds the 16 MiB limit"
        );
    }

    #[test]
    fn rejects_an_odd_channel_count_and_out_of_range_rates() {
        assert!(validate_wav(&wav(FORMAT_PCM, 0, 24_000, 16, 64)).is_err());
        assert!(validate_wav(&wav(FORMAT_PCM, 3, 24_000, 16, 64)).is_err());
        assert!(validate_wav(&wav(FORMAT_PCM, 8, 24_000, 16, 64)).is_err());
        assert!(validate_wav(&wav(FORMAT_PCM, 1, 4_000, 16, 64)).is_err());
        assert!(validate_wav(&wav(FORMAT_PCM, 1, 192_000, 16, 64)).is_err());
        assert!(validate_wav(&wav(FORMAT_PCM, 1, 0, 16, 64)).is_err());
    }

    #[test]
    fn rejects_a_compressed_format_and_a_missing_or_empty_data_chunk() {
        assert!(validate_wav(&wav(0x0011, 1, 24_000, 16, 64)).is_err());
        assert!(validate_wav(&wav(FORMAT_PCM, 1, 24_000, 16, 0)).is_err());
        assert!(validate_wav(&wav(FORMAT_PCM, 1, 24_000, 7, 64)).is_err());
    }

    #[test]
    fn rejects_a_chunk_size_that_points_past_the_buffer() {
        let mut bad = wav(FORMAT_PCM, 1, 24_000, 16, 64);
        let data_at = bad.windows(4).position(|w| w == b"data").unwrap();
        bad[data_at + 4..data_at + 8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(validate_wav(&bad).is_err());
        let mut bad = wav(FORMAT_PCM, 1, 24_000, 16, 64);
        bad[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(validate_wav(&bad).is_err());
    }

    #[test]
    fn names_are_collapsed_bounded_and_never_empty() {
        assert_eq!(sanitize_sample_name("  Ana\t\tVoice \n"), "Ana Voice");
        assert_eq!(sanitize_sample_name(""), "Voice sample");
        assert_eq!(sanitize_sample_name("\u{0}\u{7}"), "Voice sample");
        assert_eq!(sanitize_sample_name("a".repeat(200).as_str()).len(), 80);
        assert_eq!(sanitize_sample_name("../../etc/passwd"), "../../etc/passwd");
    }

    #[test]
    fn sample_ids_must_be_thirty_two_hex_characters() {
        assert!(validate_sample_id(&"a".repeat(32)).is_ok());
        for bad in [
            "",
            "abc",
            &"a".repeat(31),
            &"a".repeat(33),
            "../../etc/passwd",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaz",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/",
        ] {
            assert!(validate_sample_id(bad).is_err(), "{bad:?} must be rejected");
        }
    }
}
