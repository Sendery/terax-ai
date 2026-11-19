//! The Reader library on disk. Every path is joined from components that
//! passed `validate_id` / `validate_key` or from fixed names, so nothing the
//! webview sends can step outside the root.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::wav::{self, Chapter, ConcatSegment};
use crate::modules::tts::layout::set_private;

pub const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_CHUNK_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_LIST_ENTRIES: usize = 500;
pub const MAX_PRESENT_KEYS: usize = 5000;
pub const MAX_EXPORT_SEGMENTS: usize = 10_000;
pub const MAX_PAUSE_MS: u32 = 60_000;
const MAX_EXPORT_NAME_CHARS: usize = 80;
const DEFAULT_EXPORT_NAME: &str = "reader-export";
const ID_LEN: usize = 12;
const MAX_KEY_LEN: usize = 64;

const SOURCE_FILE: &str = "source.txt";
const MANIFEST_FILE: &str = "manifest.json";
const CHUNKS_DIR: &str = "chunks";
const EXPORTS_DIR: &str = "exports";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDocument {
    pub id: String,
    pub source: String,
    pub manifest: Option<String>,
    pub title: Option<String>,
    pub source_path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReaderEntry {
    pub id: String,
    pub title: Option<String>,
    pub source_path: Option<String>,
    pub updated_at_ms: u64,
    pub word_count: Option<u64>,
    pub last_word_index: Option<u64>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSegment {
    pub key: String,
    #[serde(default)]
    pub pause_after_ms: u32,
    #[serde(default)]
    pub chapter: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub duration_ms: u64,
    pub chapters: Vec<Chapter>,
}

pub fn validate_id(id: &str) -> Result<(), String> {
    let ok = id.len() == ID_LEN && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if ok {
        Ok(())
    } else {
        Err("invalid reader document id".into())
    }
}

pub fn validate_key(value: &str, what: &str) -> Result<(), String> {
    let ok = !value.is_empty()
        && value.len() <= MAX_KEY_LEN
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'z' | b'_' | b'-'));
    if ok {
        Ok(())
    } else {
        Err(format!("invalid reader {what}"))
    }
}

/// LF line endings, no BOM, no trailing whitespace. The id is a hash of this
/// form, so the same text pasted from two editors lands on one document.
pub fn normalize_text(raw: &str) -> Result<String, String> {
    let text = raw.strip_prefix('\u{FEFF}').unwrap_or(raw);
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let text = text.trim_end();
    if text.trim().is_empty() {
        return Err("the text to read is empty".into());
    }
    Ok(text.to_string())
}

pub fn doc_id_for(normalized: &str) -> String {
    let digest = Sha256::digest(normalized.as_bytes());
    digest
        .iter()
        .take(ID_LEN / 2)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Reads a user-chosen file: absolute, regular, bounded and strict UTF-8.
pub fn read_source_file(path: &str) -> Result<String, String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("the file path must be absolute".into());
    }
    let meta = fs::metadata(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a regular file", path.display()));
    }
    if meta.len() > MAX_SOURCE_BYTES {
        return Err("the file is larger than the 2 MiB Reader limit".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|f| f.take(MAX_SOURCE_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err("the file is larger than the 2 MiB Reader limit".into());
    }
    String::from_utf8(bytes).map_err(|_| format!("{} is not UTF-8 text", path.display()))
}

/// Temp file in the target's directory, then rename, so a reader never sees a
/// half-written file and a crash leaves the old one in place.
pub fn write_atomic(target: &Path, content: &[u8]) -> Result<(), String> {
    let parent = target.parent().ok_or("path has no parent")?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    tmp.as_file_mut()
        .write_all(content)
        .and_then(|()| tmp.as_file_mut().sync_all())
        .map_err(|e| e.to_string())?;
    tmp.persist(target).map_err(|e| e.error.to_string())?;
    set_private(target);
    Ok(())
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    set_private(dir);
    Ok(())
}

fn mtime_ms(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn read_manifest_raw(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
        Ok(meta) if meta.len() > MAX_MANIFEST_BYTES as u64 => {
            return Err("manifest.json exceeds the 8 MiB limit".into())
        }
        Ok(_) => {}
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Default, PartialEq)]
struct ManifestFields {
    title: Option<String>,
    source_path: Option<String>,
    word_count: Option<u64>,
    last_word_index: Option<u64>,
}

fn manifest_fields(raw: Option<&str>) -> ManifestFields {
    let Some(value) = raw.and_then(|r| serde_json::from_str::<Value>(r).ok()) else {
        return ManifestFields::default();
    };
    let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    ManifestFields {
        title: text("title"),
        source_path: text("source_path"),
        word_count: value.get("word_count").and_then(Value::as_u64),
        last_word_index: value
            .get("playback_state")
            .and_then(|p| p.get("last_word_index"))
            .and_then(Value::as_u64),
    }
}

pub struct ReaderStore {
    root: PathBuf,
}

impl ReaderStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn doc_dir(&self, id: &str) -> Result<PathBuf, String> {
        validate_id(id)?;
        Ok(self.root.join(id))
    }

    fn existing_doc_dir(&self, id: &str) -> Result<PathBuf, String> {
        let dir = self.doc_dir(id)?;
        if !dir.join(SOURCE_FILE).is_file() {
            return Err(format!("reader document {id} does not exist"));
        }
        Ok(dir)
    }

    fn chunk_dir(&self, id: &str, voice_key: &str) -> Result<PathBuf, String> {
        validate_key(voice_key, "voice key")?;
        Ok(self.doc_dir(id)?.join(CHUNKS_DIR).join(voice_key))
    }

    fn chunk_path(&self, id: &str, voice_key: &str, key: &str) -> Result<PathBuf, String> {
        validate_key(key, "chunk key")?;
        Ok(self.chunk_dir(id, voice_key)?.join(format!("{key}.wav")))
    }

    /// Exactly one of `text` / `path`. The source is written once: the id is
    /// its hash, so an existing `source.txt` already holds the same text.
    pub fn open(
        &self,
        text: Option<String>,
        path: Option<String>,
        title: Option<String>,
    ) -> Result<ReaderDocument, String> {
        let raw = match (text, path.as_deref()) {
            (Some(text), None) => {
                if text.len() as u64 > MAX_SOURCE_BYTES {
                    return Err("the text is larger than the 2 MiB Reader limit".into());
                }
                text
            }
            (None, Some(path)) => read_source_file(path)?,
            _ => return Err("give exactly one of text or path".into()),
        };
        let source = normalize_text(&raw)?;
        let id = doc_id_for(&source);
        let dir = self.doc_dir(&id)?;
        ensure_dir(&self.root)?;
        ensure_dir(&dir)?;
        let source_file = dir.join(SOURCE_FILE);
        if !source_file.is_file() {
            write_atomic(&source_file, source.as_bytes())?;
        }
        let manifest = read_manifest_raw(&dir.join(MANIFEST_FILE))?;
        let fields = manifest_fields(manifest.as_deref());
        let file_name = path.as_deref().and_then(|p| {
            Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
        });
        let title = title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .or(file_name)
            .or(fields.title);
        Ok(ReaderDocument {
            id,
            source,
            manifest,
            title,
            source_path: path,
        })
    }

    pub fn load(&self, id: &str) -> Result<ReaderDocument, String> {
        let dir = self.existing_doc_dir(id)?;
        let source = fs::read_to_string(dir.join(SOURCE_FILE)).map_err(|e| e.to_string())?;
        let manifest = read_manifest_raw(&dir.join(MANIFEST_FILE))?;
        let fields = manifest_fields(manifest.as_deref());
        Ok(ReaderDocument {
            id: id.to_string(),
            source,
            manifest,
            title: fields.title,
            source_path: fields.source_path,
        })
    }

    pub fn save_manifest(&self, id: &str, manifest: &str) -> Result<(), String> {
        if manifest.len() > MAX_MANIFEST_BYTES {
            return Err("manifest exceeds the 8 MiB limit".into());
        }
        let parsed: Value =
            serde_json::from_str(manifest).map_err(|e| format!("manifest is not JSON: {e}"))?;
        if !parsed.is_object() {
            return Err("manifest must be a JSON object".into());
        }
        let dir = self.existing_doc_dir(id)?;
        write_atomic(&dir.join(MANIFEST_FILE), manifest.as_bytes())
    }

    pub fn list(&self) -> Result<Vec<ReaderEntry>, String> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.to_string()),
        };
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let Ok(id) = entry.file_name().into_string() else {
                continue;
            };
            if validate_id(&id).is_err() {
                continue;
            }
            let dir = self.root.join(&id);
            let Some(source_mtime) = mtime_ms(&dir.join(SOURCE_FILE)) else {
                continue;
            };
            let manifest_path = dir.join(MANIFEST_FILE);
            let manifest = read_manifest_raw(&manifest_path).ok().flatten();
            let fields = manifest_fields(manifest.as_deref());
            out.push(ReaderEntry {
                id,
                title: fields.title,
                source_path: fields.source_path,
                updated_at_ms: mtime_ms(&manifest_path).unwrap_or(source_mtime),
                word_count: fields.word_count,
                last_word_index: fields.last_word_index,
            });
        }
        out.sort_by(|a, b| {
            b.updated_at_ms
                .cmp(&a.updated_at_ms)
                .then_with(|| a.id.cmp(&b.id))
        });
        out.truncate(MAX_LIST_ENTRIES);
        Ok(out)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let dir = self.doc_dir(id)?;
        match fs::remove_dir_all(&dir) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }

    pub fn chunks_present(
        &self,
        id: &str,
        voice_key: &str,
        keys: &[String],
    ) -> Result<Vec<String>, String> {
        if keys.len() > MAX_PRESENT_KEYS {
            return Err(format!("at most {MAX_PRESENT_KEYS} keys per call"));
        }
        let dir = self.chunk_dir(id, voice_key)?;
        let mut present = Vec::new();
        for key in keys {
            validate_key(key, "chunk key")?;
            if dir.join(format!("{key}.wav")).is_file() {
                present.push(key.clone());
            }
        }
        Ok(present)
    }

    pub fn chunk_get(&self, id: &str, voice_key: &str, key: &str) -> Result<Vec<u8>, String> {
        let path = self.chunk_path(id, voice_key, key)?;
        let meta = fs::metadata(&path).map_err(|_| format!("chunk {key} is not cached"))?;
        if meta.len() > MAX_CHUNK_BYTES as u64 {
            return Err(format!("chunk {key} exceeds the 20 MiB limit"));
        }
        fs::read(&path).map_err(|_| format!("chunk {key} is not cached"))
    }

    pub fn chunk_put(
        &self,
        id: &str,
        voice_key: &str,
        key: &str,
        bytes: &[u8],
    ) -> Result<(), String> {
        if bytes.len() > MAX_CHUNK_BYTES {
            return Err("chunk exceeds the 20 MiB limit".into());
        }
        if !wav::is_riff_wave(bytes) {
            return Err("chunk is not a RIFF/WAVE file".into());
        }
        let path = self.chunk_path(id, voice_key, key)?;
        self.existing_doc_dir(id)?;
        let dir = self.chunk_dir(id, voice_key)?;
        ensure_dir(dir.parent().expect("chunk dir has a parent"))?;
        ensure_dir(&dir)?;
        write_atomic(&path, bytes)
    }

    pub fn export(
        &self,
        id: &str,
        voice_key: &str,
        segments: &[ExportSegment],
        file_name: &str,
    ) -> Result<ExportResult, String> {
        if segments.is_empty() {
            return Err("nothing to export: no segments".into());
        }
        if segments.len() > MAX_EXPORT_SEGMENTS {
            return Err(format!("at most {MAX_EXPORT_SEGMENTS} segments per export"));
        }
        for segment in segments {
            validate_key(&segment.key, "chunk key")?;
            if segment.pause_after_ms > MAX_PAUSE_MS {
                return Err(format!(
                    "pause after {} exceeds {MAX_PAUSE_MS} ms",
                    segment.key
                ));
            }
        }
        let doc = self.existing_doc_dir(id)?;
        let chunks = self.chunk_dir(id, voice_key)?;
        let exports = doc.join(EXPORTS_DIR);
        ensure_dir(&exports)?;

        let name = sanitize_export_name(file_name);
        let wav_name = format!("{name}.wav");
        let wav_path = exports.join(&wav_name);
        let plan: Vec<ConcatSegment<'_>> = segments
            .iter()
            .map(|s| ConcatSegment {
                key: &s.key,
                pause_after_ms: s.pause_after_ms,
                chapter: s.chapter.as_deref(),
            })
            .collect();

        let tmp = tempfile::NamedTempFile::new_in(&exports).map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::new(tmp);
        let summary = wav::concat_wavs(&mut writer, &plan, |key| {
            let path = chunks.join(format!("{key}.wav"));
            fs::read(&path).map_err(|_| format!("chunk {key} is not cached for this voice"))
        })?;
        let tmp = writer.into_inner().map_err(|e| e.error().to_string())?;
        tmp.as_file().sync_all().map_err(|e| e.to_string())?;
        tmp.persist(&wav_path).map_err(|e| e.error.to_string())?;
        set_private(&wav_path);

        let chapters_path = exports.join(format!("{name}.chapters.json"));
        let cue_path = exports.join(format!("{name}.cue"));
        if summary.chapters.is_empty() {
            let _ = fs::remove_file(&chapters_path);
            let _ = fs::remove_file(&cue_path);
        } else {
            let json = serde_json::to_vec_pretty(&summary.chapters).map_err(|e| e.to_string())?;
            write_atomic(&chapters_path, &json)?;
            write_atomic(
                &cue_path,
                wav::cue_sheet(&wav_name, &summary.chapters).as_bytes(),
            )?;
        }

        Ok(ExportResult {
            path: wav_path.to_string_lossy().into_owned(),
            duration_ms: summary.duration_ms,
            chapters: summary.chapters,
        })
    }
}

/// `[A-Za-z0-9 ._-]` only, no leading dots, at most 80 chars, and without a
/// `.wav` the caller may have typed, since the extension is added here.
pub fn sanitize_export_name(raw: &str) -> String {
    let kept: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'))
        .collect();
    let mut name = kept.trim().trim_start_matches('.').trim().to_string();
    if name.to_ascii_lowercase().ends_with(".wav") {
        name.truncate(name.len() - 4);
    }
    let name: String = name.chars().take(MAX_EXPORT_NAME_CHARS).collect();
    let name = name.trim_end_matches([' ', '.']).to_string();
    if name.is_empty() {
        DEFAULT_EXPORT_NAME.to_string()
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, ReaderStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ReaderStore::new(dir.path().join("reader"));
        (dir, store)
    }

    fn mono16_wav(samples: &[i16]) -> Vec<u8> {
        let format = wav::PcmFormat {
            channels: 1,
            sample_rate: 1000,
            bits_per_sample: 16,
        };
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut out = wav::pcm_header(&format, data.len() as u32).to_vec();
        out.extend_from_slice(&data);
        out
    }

    #[test]
    fn ids_and_keys_reject_traversal_and_bad_shapes() {
        assert!(validate_id("0123456789ab").is_ok());
        for bad in [
            "0123456789AB",
            "0123456789a",
            "0123456789abc",
            "../../etc/pa",
            "",
        ] {
            assert!(validate_id(bad).is_err(), "{bad}");
        }
        assert!(validate_key("kokoro_af-1", "k").is_ok());
        for bad in ["", "..", "a/b", "A", "a.wav", &"x".repeat(65)] {
            assert!(validate_key(bad, "k").is_err(), "{bad}");
        }
    }

    #[test]
    fn normalizes_line_endings_bom_and_trailing_space() {
        assert_eq!(
            normalize_text("\u{FEFF}a\r\nb\rc  \n\n").unwrap(),
            "a\nb\nc"
        );
        assert_eq!(normalize_text("  lead kept").unwrap(), "  lead kept");
        assert!(normalize_text("\u{FEFF} \r\n\t").is_err());
    }

    #[test]
    fn id_is_the_sha256_prefix_of_the_normalized_text() {
        // sha256("abc") = ba7816bf8f01cfea...
        assert_eq!(doc_id_for("abc"), "ba7816bf8f01");
        assert_eq!(
            doc_id_for(&normalize_text("x\r\n").unwrap()),
            doc_id_for(&normalize_text("x\n").unwrap())
        );
    }

    #[test]
    fn open_requires_exactly_one_source() {
        let (_tmp, store) = store();
        assert!(store.open(None, None, None).is_err());
        assert!(store
            .open(Some("a".into()), Some("/x".into()), None)
            .is_err());
        assert!(store.open(Some("   ".into()), None, None).is_err());
        assert!(store
            .open(Some("x".repeat(2 * 1024 * 1024 + 1)), None, None)
            .is_err());
    }

    #[test]
    fn open_from_text_writes_source_once_and_round_trips_through_load() {
        let (_tmp, store) = store();
        let doc = store
            .open(
                Some("Hello\r\nworld  ".into()),
                None,
                Some(" Notes ".into()),
            )
            .unwrap();
        assert_eq!(doc.source, "Hello\nworld");
        assert_eq!(doc.title.as_deref(), Some("Notes"));
        assert_eq!(doc.manifest, None);

        store
            .save_manifest(
                &doc.id,
                r#"{"title":"Saved","source_path":"/a.md","word_count":2}"#,
            )
            .unwrap();
        let again = store.open(Some("Hello\nworld".into()), None, None).unwrap();
        assert_eq!(again.id, doc.id);
        assert_eq!(again.title.as_deref(), Some("Saved"));
        assert!(again.manifest.unwrap().contains("word_count"));

        let loaded = store.load(&doc.id).unwrap();
        assert_eq!(loaded.source, "Hello\nworld");
        assert_eq!(loaded.title.as_deref(), Some("Saved"));
        assert_eq!(loaded.source_path.as_deref(), Some("/a.md"));
        assert!(store.load("000000000000").is_err());
    }

    #[test]
    fn open_from_path_checks_the_file() {
        let (tmp, store) = store();
        let file = tmp.path().join("chapter one.md");
        fs::write(&file, "\u{FEFF}# Title\r\n").unwrap();
        let doc = store
            .open(None, Some(file.to_string_lossy().into_owned()), None)
            .unwrap();
        assert_eq!(doc.source, "# Title");
        assert_eq!(doc.title.as_deref(), Some("chapter one.md"));
        assert_eq!(doc.source_path.as_deref(), file.to_str());

        assert!(store.open(None, Some("relative.txt".into()), None).is_err());
        let dir_path = tmp.path().to_string_lossy().into_owned();
        assert!(store
            .open(None, Some(dir_path), None)
            .unwrap_err()
            .contains("regular"));
        let latin1 = tmp.path().join("latin1.txt");
        fs::write(&latin1, [b'c', b'a', 0xE9]).unwrap();
        let error = store
            .open(None, Some(latin1.to_string_lossy().into_owned()), None)
            .unwrap_err();
        assert!(error.contains("UTF-8"), "{error}");
        let big = tmp.path().join("big.txt");
        fs::write(&big, vec![b'a'; MAX_SOURCE_BYTES as usize + 1]).unwrap();
        assert!(store
            .open(None, Some(big.to_string_lossy().into_owned()), None)
            .unwrap_err()
            .contains("2 MiB"));
    }

    #[test]
    fn save_manifest_requires_an_object_and_an_existing_doc() {
        let (_tmp, store) = store();
        let doc = store.open(Some("text".into()), None, None).unwrap();
        assert!(store.save_manifest(&doc.id, "[1]").is_err());
        assert!(store.save_manifest(&doc.id, "{nope").is_err());
        assert!(store.save_manifest("aaaaaaaaaaaa", "{}").is_err());
        let huge = format!("{{\"a\":\"{}\"}}", "x".repeat(MAX_MANIFEST_BYTES));
        assert!(store.save_manifest(&doc.id, &huge).is_err());
        store.save_manifest(&doc.id, "{}").unwrap();
    }

    #[test]
    fn list_reads_manifest_fields_and_tolerates_bad_manifests() {
        let (_tmp, store) = store();
        assert!(store.list().unwrap().is_empty());
        let a = store.open(Some("first".into()), None, None).unwrap();
        let b = store.open(Some("second".into()), None, None).unwrap();
        store
            .save_manifest(
                &a.id,
                r#"{"title":"A","word_count":10,"playback_state":{"last_word_index":4}}"#,
            )
            .unwrap();
        fs::write(store.root.join(&b.id).join(MANIFEST_FILE), "not json").unwrap();
        fs::create_dir_all(store.root.join("not-an-id")).unwrap();
        fs::create_dir_all(store.root.join("abcdefabcdef")).unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 2);
        let entry_a = list.iter().find(|e| e.id == a.id).unwrap();
        assert_eq!(entry_a.title.as_deref(), Some("A"));
        assert_eq!(entry_a.word_count, Some(10));
        assert_eq!(entry_a.last_word_index, Some(4));
        let entry_b = list.iter().find(|e| e.id == b.id).unwrap();
        assert_eq!(entry_b.title, None);
        assert!(list[0].updated_at_ms >= list[1].updated_at_ms);
    }

    #[test]
    fn delete_removes_the_doc_and_is_idempotent() {
        let (_tmp, store) = store();
        let doc = store.open(Some("bye".into()), None, None).unwrap();
        store.delete(&doc.id).unwrap();
        assert!(store.load(&doc.id).is_err());
        store.delete(&doc.id).unwrap();
        assert!(store.delete("../x").is_err());
    }

    #[test]
    fn chunks_round_trip_and_reject_non_wav() {
        let (_tmp, store) = store();
        let doc = store.open(Some("chunks".into()), None, None).unwrap();
        let bytes = mono16_wav(&[1, 2]);
        assert!(store
            .chunk_put(&doc.id, "v1", "k1", b"not a wav file")
            .is_err());
        assert!(store.chunk_put("aaaaaaaaaaaa", "v1", "k1", &bytes).is_err());
        assert!(store.chunk_put(&doc.id, "../v", "k1", &bytes).is_err());
        store.chunk_put(&doc.id, "v1", "k1", &bytes).unwrap();
        assert_eq!(store.chunk_get(&doc.id, "v1", "k1").unwrap(), bytes);
        assert!(store.chunk_get(&doc.id, "v1", "k2").is_err());
        let keys = vec!["k1".to_string(), "k2".to_string()];
        assert_eq!(
            store.chunks_present(&doc.id, "v1", &keys).unwrap(),
            vec!["k1"]
        );
        assert!(store
            .chunks_present(&doc.id, "v1", &["a/b".to_string()])
            .is_err());
        let too_many = vec!["k".to_string(); MAX_PRESENT_KEYS + 1];
        assert!(store.chunks_present(&doc.id, "v1", &too_many).is_err());
    }

    #[test]
    fn export_writes_wav_chapters_and_cue() {
        let (_tmp, store) = store();
        let doc = store.open(Some("export me".into()), None, None).unwrap();
        store
            .chunk_put(&doc.id, "v1", "a", &mono16_wav(&[1, 2]))
            .unwrap();
        store
            .chunk_put(&doc.id, "v1", "b", &mono16_wav(&[3]))
            .unwrap();
        let segments = vec![
            ExportSegment {
                key: "a".into(),
                pause_after_ms: 1000,
                chapter: Some("One".into()),
            },
            ExportSegment {
                key: "b".into(),
                pause_after_ms: 0,
                chapter: Some("Two".into()),
            },
        ];
        let result = store
            .export(&doc.id, "v1", &segments, "My Book.wav")
            .unwrap();
        assert!(
            result.path.ends_with("exports/My Book.wav"),
            "{}",
            result.path
        );
        assert_eq!(result.duration_ms, 1003);
        assert_eq!(result.chapters[1].start_ms, 1002);
        let written = fs::read(&result.path).unwrap();
        assert_eq!(written.len(), 44 + (2 + 1000 + 1) * 2);
        let exports = store.root.join(&doc.id).join(EXPORTS_DIR);
        let cue = fs::read_to_string(exports.join("My Book.cue")).unwrap();
        assert!(cue.starts_with("FILE \"My Book.wav\" WAVE\n"));
        let chapters: Value =
            serde_json::from_slice(&fs::read(exports.join("My Book.chapters.json")).unwrap())
                .unwrap();
        assert_eq!(chapters[1]["startMs"], 1002);
        assert_eq!(chapters[0]["title"], "One");

        let plain = vec![ExportSegment {
            key: "a".into(),
            pause_after_ms: 0,
            chapter: None,
        }];
        store.export(&doc.id, "v1", &plain, "My Book").unwrap();
        assert!(!exports.join("My Book.cue").exists());
    }

    #[test]
    fn export_validates_segments_and_names_missing_chunks() {
        let (_tmp, store) = store();
        let doc = store.open(Some("checks".into()), None, None).unwrap();
        let seg = |key: &str, pause| ExportSegment {
            key: key.into(),
            pause_after_ms: pause,
            chapter: None,
        };
        assert!(store.export(&doc.id, "v1", &[], "x").is_err());
        assert!(store
            .export(&doc.id, "v1", &[seg("a", MAX_PAUSE_MS + 1)], "x")
            .is_err());
        assert!(store.export(&doc.id, "v1", &[seg("../a", 0)], "x").is_err());
        let error = store
            .export(&doc.id, "v1", &[seg("gone", 0)], "x")
            .unwrap_err();
        assert!(error.contains("gone"), "{error}");
        let many = vec![seg("a", 0); MAX_EXPORT_SEGMENTS + 1];
        assert!(store.export(&doc.id, "v1", &many, "x").is_err());
        let exports = store.root.join(&doc.id).join(EXPORTS_DIR);
        let leftovers: Vec<_> = fs::read_dir(exports).unwrap().collect();
        assert!(leftovers.is_empty(), "failed export left files behind");
    }

    #[test]
    fn export_names_are_sanitized() {
        assert_eq!(sanitize_export_name("My Book"), "My Book");
        assert_eq!(sanitize_export_name("../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_export_name("..."), DEFAULT_EXPORT_NAME);
        assert_eq!(sanitize_export_name("caf\u{e9}: part/1.WAV"), "caf part1");
        assert_eq!(sanitize_export_name(""), DEFAULT_EXPORT_NAME);
        assert_eq!(
            sanitize_export_name(&"a".repeat(200)).len(),
            MAX_EXPORT_NAME_CHARS
        );
    }
}
