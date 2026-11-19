//! Reader: read-along text-to-speech documents.
//!
//! Each document lives in `<app_local_data_dir>/reader/<id>/` with its
//! source text, a manifest owned by the webview, cached per-segment audio and
//! exports. The commands are thin: validation and file work live in `store`,
//! WAV handling in `wav`, and `terax --read` in `cli`.
//!
//! The library sits beside the speech directory rather than inside it, so
//! removing the speech engines and models never deletes what was read.

pub mod cli;
pub mod store;
pub mod wav;

use tauri::{AppHandle, Manager};

use store::{ExportResult, ExportSegment, ReaderDocument, ReaderEntry, ReaderStore};

const READER_DIR: &str = "reader";

fn reader_store(app: &AppHandle) -> Result<ReaderStore, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join(READER_DIR);
    Ok(ReaderStore::new(root))
}

async fn blocking<T, F>(app: AppHandle, work: F) -> Result<T, String>
where
    F: FnOnce(ReaderStore) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let store = reader_store(&app)?;
    tauri::async_runtime::spawn_blocking(move || work(store))
        .await
        .map_err(|e| e.to_string())?
}

fn header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("reader_chunk_put: missing {name} header"))
}

#[tauri::command]
pub async fn reader_open(
    app: AppHandle,
    text: Option<String>,
    path: Option<String>,
    title: Option<String>,
) -> Result<ReaderDocument, String> {
    blocking(app, move |store| store.open(text, path, title)).await
}

#[tauri::command]
pub async fn reader_load(app: AppHandle, id: String) -> Result<ReaderDocument, String> {
    blocking(app, move |store| store.load(&id)).await
}

#[tauri::command]
pub async fn reader_save_manifest(
    app: AppHandle,
    id: String,
    manifest: String,
) -> Result<(), String> {
    blocking(app, move |store| store.save_manifest(&id, &manifest)).await
}

#[tauri::command]
pub async fn reader_list(app: AppHandle) -> Result<Vec<ReaderEntry>, String> {
    blocking(app, |store| store.list()).await
}

#[tauri::command]
pub async fn reader_delete(app: AppHandle, id: String) -> Result<(), String> {
    blocking(app, move |store| store.delete(&id)).await
}

#[tauri::command]
pub async fn reader_chunks_present(
    app: AppHandle,
    id: String,
    voice_key: String,
    keys: Vec<String>,
) -> Result<Vec<String>, String> {
    blocking(app, move |store| {
        store.chunks_present(&id, &voice_key, &keys)
    })
    .await
}

/// Raw bytes, so the webview receives an ArrayBuffer instead of a JSON array.
#[tauri::command]
pub async fn reader_chunk_get(
    app: AppHandle,
    id: String,
    voice_key: String,
    key: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = blocking(app, move |store| store.chunk_get(&id, &voice_key, &key)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// `invoke("reader_chunk_put", bytes, { headers: { "x-reader-id",
/// "x-reader-voice", "x-reader-key" } })`.
#[tauri::command]
pub async fn reader_chunk_put(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let id = header(&request, "x-reader-id")?.to_string();
    let voice_key = header(&request, "x-reader-voice")?.to_string();
    let key = header(&request, "x-reader-key")?.to_string();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("reader_chunk_put: expected a raw byte body".into());
    };
    if bytes.len() > store::MAX_CHUNK_BYTES {
        return Err("chunk exceeds the 20 MiB limit".into());
    }
    let bytes = bytes.clone();
    blocking(app, move |store| {
        store.chunk_put(&id, &voice_key, &key, &bytes)
    })
    .await
}

#[tauri::command]
pub async fn reader_export(
    app: AppHandle,
    id: String,
    voice_key: String,
    segments: Vec<ExportSegment>,
    file_name: String,
) -> Result<ExportResult, String> {
    blocking(app, move |store| {
        store.export(&id, &voice_key, &segments, &file_name)
    })
    .await
}
