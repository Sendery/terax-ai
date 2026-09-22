//! Subscription sign-in for AI providers (OAuth 2.0, authorization code + PKCE).
//!
//! This is how a user who pays for Claude Pro/Max or ChatGPT Plus/Pro reaches
//! the models through Terax without pasting an API key: the same browser login
//! their vendor's own CLI performs, against the same public client id.
//!
//! The flow lives in Rust rather than the webview for three reasons. It needs a
//! loopback TCP listener the provider can redirect to, which a webview cannot
//! open. The tokens must never enter the renderer, so the webview only ever
//! sees an expiry and an account label. And the refresh has to happen wherever
//! the request is made, which for this app is already the Rust side.
//!
//! Tokens are persisted through `secrets`, i.e. the OS keychain on macOS and
//! Windows and a 0600 file on Linux, under one account per provider.
//!
//! Adding a provider is adding a `ProviderConfig` to `PROVIDERS`. Antigravity
//! (Google) is deliberately absent: every public implementation relies on a
//! client secret lifted out of Google's binary, and Google's terms forbid
//! third-party clients, so connecting one risks the user's account.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::secrets::{delete_secret, get_secret, set_secret, SecretsState};

/// Same service name the API-key store uses, so one keychain entry group holds
/// everything Terax knows about a provider.
const KEYRING_SERVICE: &str = "terax-ai";

/// How long a started login stays open before the listener is torn down.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Refresh this far ahead of the real expiry, so a request that starts just
/// before the boundary does not land just after it.
const REFRESH_SKEW_SECS: i64 = 120;

const MAX_REQUEST_BYTES: usize = 16 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum BodyFormat {
    Form,
    Json,
}

struct ProviderConfig {
    id: &'static str,
    label: &'static str,
    client_id: &'static str,
    authorize_url: &'static str,
    token_url: &'static str,
    scope: &'static str,
    /// Fixed by the provider: the redirect URI is registered with the client
    /// id, so the listener has to take this exact port and path.
    callback_port: u16,
    callback_path: &'static str,
    /// Extra authorize-request parameters this provider expects.
    extra_authorize_params: &'static [(&'static str, &'static str)],
    token_body: BodyFormat,
    /// Whether the code exchange echoes `state` back to the token endpoint.
    exchange_sends_state: bool,
    /// JWT claim holding provider-specific account data, when the access token
    /// is a JWT worth reading.
    account_claim: Option<&'static str>,
}

static PROVIDERS: &[ProviderConfig] = &[
    ProviderConfig {
        id: "anthropic",
        label: "Claude Pro/Max",
        client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        authorize_url: "https://claude.ai/oauth/authorize",
        token_url: "https://platform.claude.com/v1/oauth/token",
        scope: "org:create_api_key user:profile user:inference",
        callback_port: 53692,
        callback_path: "/callback",
        extra_authorize_params: &[("code", "true")],
        token_body: BodyFormat::Json,
        exchange_sends_state: true,
        account_claim: None,
    },
    ProviderConfig {
        id: "openai-codex",
        label: "ChatGPT Plus/Pro",
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        authorize_url: "https://auth.openai.com/oauth/authorize",
        token_url: "https://auth.openai.com/oauth/token",
        scope: "openid profile email offline_access",
        callback_port: 1455,
        callback_path: "/auth/callback",
        extra_authorize_params: &[
            ("id_token_add_organizations", "true"),
            ("codex_cli_simplified_flow", "true"),
            ("originator", "terax"),
        ],
        token_body: BodyFormat::Form,
        exchange_sends_state: false,
        account_claim: Some("https://api.openai.com/auth"),
    },
];

fn find_provider(id: &str) -> Result<&'static ProviderConfig, String> {
    PROVIDERS
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Unknown OAuth provider: {id}"))
}

fn redirect_uri(cfg: &ProviderConfig) -> String {
    // localhost, not 127.0.0.1: the literal string is what the provider has
    // registered for the client id, and they are not interchangeable there.
    format!(
        "http://localhost:{}{}",
        cfg.callback_port, cfg.callback_path
    )
}

fn keyring_account(id: &str) -> String {
    format!("{id}-oauth")
}

// ─── base64url ──────────────────────────────────────────────────────────────

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

fn base64url_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(B64[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            out.push(B64[n as usize & 63] as char);
        }
    }
    out
}

fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    for ch in input.bytes() {
        if ch == b'=' {
            break;
        }
        let v = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'\n' | b'\r' => continue,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

fn random_base64url(len: usize) -> Result<String, String> {
    let mut buf = vec![0u8; len];
    getrandom::fill(&mut buf).map_err(|e| format!("Could not read system randomness: {e}"))?;
    Ok(base64url_encode(&buf))
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64url_encode(&digest)
}

fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn query_string(params: &[(&str, &str)]) -> String {
    params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

// ─── credentials ────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct StoredCredentials {
    access: String,
    refresh: String,
    /// Unix milliseconds.
    expires: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
}

/// What the webview is allowed to know: never a token.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthAccount {
    pub provider: String,
    pub label: String,
    pub connected: bool,
    /// Unix milliseconds, absent when not connected.
    pub expires: Option<i64>,
    pub expired: bool,
    pub email: Option<String>,
    pub account_id: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_credentials(raw: &str) -> Option<StoredCredentials> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let access = v.get("access")?.as_str()?.to_string();
    let refresh = v.get("refresh")?.as_str()?.to_string();
    let expires = v.get("expires")?.as_i64()?;
    Some(StoredCredentials {
        access,
        refresh,
        expires,
        account_id: v
            .get("accountId")
            .and_then(|x| x.as_str())
            .map(str::to_string),
        email: v.get("email").and_then(|x| x.as_str()).map(str::to_string),
    })
}

fn serialize_credentials(c: &StoredCredentials) -> String {
    let mut map = serde_json::Map::new();
    map.insert("access".into(), c.access.clone().into());
    map.insert("refresh".into(), c.refresh.clone().into());
    map.insert("expires".into(), c.expires.into());
    if let Some(a) = &c.account_id {
        map.insert("accountId".into(), a.clone().into());
    }
    if let Some(e) = &c.email {
        map.insert("email".into(), e.clone().into());
    }
    serde_json::Value::Object(map).to_string()
}

fn load(
    app: &AppHandle,
    state: &SecretsState,
    id: &str,
) -> Result<Option<StoredCredentials>, String> {
    let raw = get_secret(app, state, KEYRING_SERVICE, &keyring_account(id))?;
    Ok(raw.as_deref().and_then(parse_credentials))
}

fn save(
    app: &AppHandle,
    state: &SecretsState,
    id: &str,
    creds: &StoredCredentials,
) -> Result<(), String> {
    set_secret(
        app,
        state,
        KEYRING_SERVICE,
        &keyring_account(id),
        &serialize_credentials(creds),
    )
}

fn account_view(cfg: &ProviderConfig, creds: Option<&StoredCredentials>) -> OAuthAccount {
    match creds {
        None => OAuthAccount {
            provider: cfg.id.to_string(),
            label: cfg.label.to_string(),
            connected: false,
            expires: None,
            expired: false,
            email: None,
            account_id: None,
        },
        Some(c) => OAuthAccount {
            provider: cfg.id.to_string(),
            label: cfg.label.to_string(),
            connected: true,
            expires: Some(c.expires),
            // Expiry alone is not a disconnection: the refresh token usually
            // still works, so the UI shows "reconnecting" rather than "signed
            // out" until a refresh actually fails.
            expired: c.expires <= now_ms(),
            email: c.email.clone(),
            account_id: c.account_id.clone(),
        },
    }
}

// ─── JWT ────────────────────────────────────────────────────────────────────

/// Read a JWT payload without verifying it. The token came from the token
/// endpoint over TLS, and nothing here is a security decision -- it is only
/// used to label the account in the UI and to find the ChatGPT account id the
/// Codex backend requires as a header.
fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64url_decode(payload)?;
    serde_json::from_slice(&bytes).ok()
}

fn extract_account(cfg: &ProviderConfig, access: &str) -> (Option<String>, Option<String>) {
    let Some(payload) = decode_jwt_payload(access) else {
        return (None, None);
    };
    let email = payload
        .get("email")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let account_id = cfg.account_claim.and_then(|claim| {
        payload
            .get(claim)?
            .get("chatgpt_account_id")?
            .as_str()
            .map(str::to_string)
    });
    (account_id, email)
}

// ─── loopback callback listener ─────────────────────────────────────────────

struct PendingLogin {
    listener: TcpListener,
    verifier: String,
    state: String,
}

fn pending() -> &'static Mutex<HashMap<String, PendingLogin>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PendingLogin>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn html_page(title: &str, detail: &str) -> String {
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title>\
         <body style=\"font:15px -apple-system,system-ui,sans-serif;display:grid;\
         place-items:center;height:100vh;margin:0;background:#111;color:#eee\">\
         <div style=\"text-align:center\"><h1 style=\"font-size:17px\">{title}</h1>\
         <p style=\"color:#999\">{detail}</p></div>"
    )
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// The query of the first line of an HTTP request, as `(path, params)`.
fn parse_request_target(line: &str) -> Option<(String, HashMap<String, String>)> {
    let target = line.split_whitespace().nth(1)?;
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };
    let mut params = HashMap::new();
    for pair in query.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        params.insert(percent_decode(k), percent_decode(v));
    }
    Some((path.to_string(), params))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Block until the provider redirects the browser back, or the deadline passes.
///
/// Anything that is not the callback path (a favicon request, a stray probe)
/// gets a 404 and the wait continues, so one noisy browser cannot end a login.
fn wait_for_code(
    listener: &TcpListener,
    cfg: &ProviderConfig,
    expected_state: &str,
) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Could not configure the callback listener: {e}"))?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;

    loop {
        if Instant::now() >= deadline {
            return Err("Timed out waiting for the browser to come back".into());
        }
        let mut stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(format!("Callback listener failed: {e}")),
        };

        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = vec![0u8; MAX_REQUEST_BYTES];
        let read = stream.read(&mut buf).unwrap_or(0);
        let text = String::from_utf8_lossy(&buf[..read]);
        let first_line = text.lines().next().unwrap_or_default();

        let Some((path, params)) = parse_request_target(first_line) else {
            respond(
                &mut stream,
                "400 Bad Request",
                &html_page("Bad request", ""),
            );
            continue;
        };
        if path != cfg.callback_path {
            respond(&mut stream, "404 Not Found", &html_page("Not found", ""));
            continue;
        }
        if let Some(err) = params.get("error") {
            let body = html_page("Sign-in did not complete", err);
            respond(&mut stream, "400 Bad Request", &body);
            return Err(format!("{} returned an error: {err}", cfg.label));
        }
        // A wrong state means this redirect is not the one we started, so it is
        // rejected without ending the wait for the real one.
        if params.get("state").map(String::as_str) != Some(expected_state) {
            let body = html_page("Sign-in could not be verified", "State mismatch.");
            respond(&mut stream, "400 Bad Request", &body);
            continue;
        }
        let Some(code) = params.get("code").filter(|c| !c.is_empty()) else {
            let body = html_page("Sign-in did not complete", "No authorization code.");
            respond(&mut stream, "400 Bad Request", &body);
            continue;
        };

        let body = html_page(
            "You are signed in",
            "You can close this tab and go back to Terax.",
        );
        respond(&mut stream, "200 OK", &body);
        return Ok(code.clone());
    }
}

// ─── token endpoint ─────────────────────────────────────────────────────────

async fn post_token(cfg: &ProviderConfig, params: Vec<(&str, String)>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Could not build the HTTP client: {e}"))?;

    let request = match cfg.token_body {
        BodyFormat::Form => client
            .post(cfg.token_url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(query_string(
                &params
                    .iter()
                    .map(|(k, v)| (*k, v.as_str()))
                    .collect::<Vec<_>>(),
            )),
        BodyFormat::Json => {
            let mut map = serde_json::Map::new();
            for (k, v) in &params {
                map.insert((*k).to_string(), v.clone().into());
            }
            client
                .post(cfg.token_url)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .body(serde_json::Value::Object(map).to_string())
        }
    };

    let response = request
        .send()
        .await
        .map_err(|e| format!("Could not reach {}: {e}", cfg.token_url))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        // Bodies from a token endpoint carry the reason but never the secret we
        // sent, so the status and body are safe to surface to the user.
        return Err(format!(
            "{} rejected the token request ({status}): {}",
            cfg.label,
            body.chars().take(400).collect::<String>()
        ));
    }
    Ok(body)
}

fn credentials_from_token_response(
    cfg: &ProviderConfig,
    body: &str,
    previous_refresh: Option<&str>,
) -> Result<StoredCredentials, String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| {
        format!(
            "{} returned a token response that is not JSON: {e}",
            cfg.label
        )
    })?;
    let access = v
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or_else(|| format!("{} returned no access token", cfg.label))?
        .to_string();
    // Some refresh responses omit the refresh token, meaning "keep the one you
    // have". Dropping it there would sign the user out on the next refresh.
    let refresh = v
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .or_else(|| previous_refresh.map(str::to_string))
        .ok_or_else(|| format!("{} returned no refresh token", cfg.label))?;
    let expires_in = v.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(3600);
    let (account_id, email) = extract_account(cfg, &access);
    Ok(StoredCredentials {
        access,
        refresh,
        expires: now_ms() + expires_in * 1000,
        account_id,
        email,
    })
}

async fn exchange_code(
    cfg: &ProviderConfig,
    code: &str,
    verifier: &str,
    state: &str,
) -> Result<StoredCredentials, String> {
    let mut params: Vec<(&str, String)> = vec![
        ("grant_type", "authorization_code".into()),
        ("client_id", cfg.client_id.into()),
        ("code", code.into()),
        ("redirect_uri", redirect_uri(cfg)),
        ("code_verifier", verifier.into()),
    ];
    if cfg.exchange_sends_state {
        params.push(("state", state.into()));
    }
    let body = post_token(cfg, params).await?;
    credentials_from_token_response(cfg, &body, None)
}

async fn refresh_credentials(
    cfg: &ProviderConfig,
    creds: &StoredCredentials,
) -> Result<StoredCredentials, String> {
    let params: Vec<(&str, String)> = vec![
        ("grant_type", "refresh_token".into()),
        ("client_id", cfg.client_id.into()),
        ("refresh_token", creds.refresh.clone()),
    ];
    let body = post_token(cfg, params).await?;
    let mut next = credentials_from_token_response(cfg, &body, Some(&creds.refresh))?;
    // A refreshed access token is not always a JWT carrying the account; keep
    // what the original login established.
    if next.account_id.is_none() {
        next.account_id = creds.account_id.clone();
    }
    if next.email.is_none() {
        next.email = creds.email.clone();
    }
    Ok(next)
}

// ─── commands ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct LoginStart {
    /// The provider's consent page. The caller opens it; it is also shown in
    /// the UI so a login can be finished in another browser.
    pub url: String,
}

/// Bind the loopback listener and build the consent URL. The listener is held
/// open until `oauth_complete` or `oauth_cancel`.
#[tauri::command]
pub async fn oauth_begin(provider: String) -> Result<LoginStart, String> {
    let cfg = find_provider(&provider)?;
    let verifier = random_base64url(32)?;
    let state = random_base64url(16)?;

    // 127.0.0.1 rather than 0.0.0.0: the redirect comes from this machine's
    // browser, and nothing else should be able to hand us an authorization code.
    let listener = TcpListener::bind(("127.0.0.1", cfg.callback_port)).map_err(|e| {
        format!(
            "Could not listen on port {} for the {} sign-in: {e}. \
             Another app (often the provider's own CLI mid-login) is using it.",
            cfg.callback_port, cfg.label
        )
    })?;

    let mut params: Vec<(&str, &str)> = vec![
        ("response_type", "code"),
        ("client_id", cfg.client_id),
        ("scope", cfg.scope),
        ("code_challenge_method", "S256"),
    ];
    let redirect = redirect_uri(cfg);
    let challenge = pkce_challenge(&verifier);
    params.push(("redirect_uri", &redirect));
    params.push(("code_challenge", &challenge));
    params.push(("state", &state));
    params.extend_from_slice(cfg.extra_authorize_params);
    let url = format!("{}?{}", cfg.authorize_url, query_string(&params));

    let mut guard = pending().lock().map_err(|e| e.to_string())?;
    guard.insert(
        provider.clone(),
        PendingLogin {
            listener,
            verifier,
            state,
        },
    );
    Ok(LoginStart { url })
}

/// Wait for the redirect, exchange the code, and persist the credentials.
#[tauri::command]
pub async fn oauth_complete(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    provider: String,
) -> Result<OAuthAccount, String> {
    let cfg = find_provider(&provider)?;
    let flow = {
        let mut guard = pending().lock().map_err(|e| e.to_string())?;
        guard
            .remove(&provider)
            .ok_or_else(|| "No sign-in is in progress for this provider".to_string())?
    };

    // The wait is a blocking accept loop; keep it off the async runtime.
    let expected_state = flow.state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_code(&flow.listener, cfg, &expected_state)
    })
    .await
    .map_err(|e| format!("Sign-in wait failed: {e}"))??;

    let creds = exchange_code(cfg, &code, &flow.verifier, &flow.state).await?;
    save(&app, &state, &provider, &creds)?;
    Ok(account_view(cfg, Some(&creds)))
}

/// Drop a started login, releasing the port.
#[tauri::command]
pub async fn oauth_cancel(provider: String) -> Result<(), String> {
    let mut guard = pending().lock().map_err(|e| e.to_string())?;
    guard.remove(&provider);
    Ok(())
}

/// Every provider Terax can sign into, connected or not.
#[tauri::command]
pub async fn oauth_status(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
) -> Result<Vec<OAuthAccount>, String> {
    let mut out = Vec::with_capacity(PROVIDERS.len());
    for cfg in PROVIDERS {
        let creds = load(&app, &state, cfg.id)?;
        out.push(account_view(cfg, creds.as_ref()));
    }
    Ok(out)
}

#[tauri::command]
pub async fn oauth_logout(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    provider: String,
) -> Result<(), String> {
    let cfg = find_provider(&provider)?;
    delete_secret(&app, &state, KEYRING_SERVICE, &keyring_account(cfg.id))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessToken {
    pub token: String,
    pub account_id: Option<String>,
    pub expires: i64,
}

/// A token good to use right now, refreshing first when it is about to expire.
///
/// This is the one command that hands a token to the renderer, because the AI
/// SDK builds its requests there. It is called per request rather than cached
/// in JS, so a revoked or rotated credential takes effect immediately.
#[tauri::command]
pub async fn oauth_access_token(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    provider: String,
) -> Result<AccessToken, String> {
    let cfg = find_provider(&provider)?;
    let creds =
        load(&app, &state, cfg.id)?.ok_or_else(|| format!("Not signed in to {}", cfg.label))?;

    if creds.expires - REFRESH_SKEW_SECS * 1000 > now_ms() {
        return Ok(AccessToken {
            token: creds.access,
            account_id: creds.account_id,
            expires: creds.expires,
        });
    }
    let refreshed = refresh_credentials(cfg, &creds).await?;
    save(&app, &state, cfg.id, &refreshed)?;
    Ok(AccessToken {
        token: refreshed.access,
        account_id: refreshed.account_id,
        expires: refreshed.expires,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_encodes_without_padding_or_unsafe_chars() {
        assert_eq!(base64url_encode(b""), "");
        assert_eq!(base64url_encode(b"f"), "Zg");
        assert_eq!(base64url_encode(b"fo"), "Zm8");
        assert_eq!(base64url_encode(b"foo"), "Zm9v");
        assert_eq!(base64url_encode(b"foob"), "Zm9vYg");
        let encoded = base64url_encode(&[251, 255, 190]);
        assert!(!encoded.contains('+') && !encoded.contains('/') && !encoded.contains('='));
    }

    #[test]
    fn base64url_roundtrips_arbitrary_bytes() {
        let bytes: Vec<u8> = (0u8..=255).collect();
        let decoded = base64url_decode(&base64url_encode(&bytes)).unwrap();
        assert_eq!(decoded, bytes);
    }

    #[test]
    fn base64url_decode_accepts_standard_alphabet_and_padding() {
        // JWTs are base64url, but a payload copied from elsewhere may not be.
        assert_eq!(base64url_decode("Zm9v").unwrap(), b"foo");
        assert_eq!(base64url_decode("Zm9vYg==").unwrap(), b"foob");
        assert!(base64url_decode("not base64!").is_none());
    }

    #[test]
    fn pkce_challenge_matches_the_rfc_7636_test_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            pkce_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn random_verifiers_differ_between_logins() {
        let a = random_base64url(32).unwrap();
        let b = random_base64url(32).unwrap();
        assert_ne!(a, b);
        assert_eq!(a.len(), 43, "32 bytes base64url is 43 chars unpadded");
    }

    #[test]
    fn percent_encoding_escapes_everything_outside_the_unreserved_set() {
        assert_eq!(percent_encode("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(percent_encode("a b"), "a%20b");
        assert_eq!(percent_encode("org:create_api_key"), "org%3Acreate_api_key");
        assert_eq!(percent_encode("é"), "%C3%A9");
    }

    #[test]
    fn request_target_splits_path_from_decoded_params() {
        let (path, params) =
            parse_request_target("GET /callback?code=ab%20c&state=xyz HTTP/1.1").unwrap();
        assert_eq!(path, "/callback");
        assert_eq!(params.get("code").unwrap(), "ab c");
        assert_eq!(params.get("state").unwrap(), "xyz");
    }

    #[test]
    fn request_target_without_query_has_no_params() {
        let (path, params) = parse_request_target("GET /favicon.ico HTTP/1.1").unwrap();
        assert_eq!(path, "/favicon.ico");
        assert!(params.is_empty());
    }

    #[test]
    fn redirect_uri_uses_localhost_and_the_registered_port() {
        let anthropic = find_provider("anthropic").unwrap();
        assert_eq!(redirect_uri(anthropic), "http://localhost:53692/callback");
        let codex = find_provider("openai-codex").unwrap();
        assert_eq!(redirect_uri(codex), "http://localhost:1455/auth/callback");
    }

    #[test]
    fn unknown_provider_is_rejected() {
        assert!(find_provider("antigravity").is_err());
    }

    #[test]
    fn credentials_roundtrip_through_storage_form() {
        let creds = StoredCredentials {
            access: "at".into(),
            refresh: "rt".into(),
            expires: 1_700_000_000_000,
            account_id: Some("acct".into()),
            email: Some("a@b.c".into()),
        };
        let parsed = parse_credentials(&serialize_credentials(&creds)).unwrap();
        assert_eq!(parsed.access, "at");
        assert_eq!(parsed.refresh, "rt");
        assert_eq!(parsed.expires, 1_700_000_000_000);
        assert_eq!(parsed.account_id.as_deref(), Some("acct"));
        assert_eq!(parsed.email.as_deref(), Some("a@b.c"));
    }

    #[test]
    fn credentials_missing_required_fields_are_not_parsed() {
        assert!(parse_credentials("{}").is_none());
        assert!(parse_credentials(r#"{"access":"a","refresh":"b"}"#).is_none());
        assert!(parse_credentials("not json").is_none());
    }

    #[test]
    fn refresh_response_without_a_refresh_token_keeps_the_stored_one() {
        let cfg = find_provider("anthropic").unwrap();
        let creds = credentials_from_token_response(
            cfg,
            r#"{"access_token":"new","expires_in":3600}"#,
            Some("old-refresh"),
        )
        .unwrap();
        assert_eq!(creds.access, "new");
        assert_eq!(creds.refresh, "old-refresh");
        assert!(creds.expires > now_ms());
    }

    #[test]
    fn token_response_without_any_refresh_token_is_an_error() {
        let cfg = find_provider("anthropic").unwrap();
        assert!(credentials_from_token_response(cfg, r#"{"access_token":"a"}"#, None).is_err());
    }

    #[test]
    fn codex_account_id_comes_from_the_jwt_claim() {
        let cfg = find_provider("openai-codex").unwrap();
        let payload = serde_json::json!({
            "email": "user@example.com",
            "https://api.openai.com/auth": { "chatgpt_account_id": "acct-123" }
        })
        .to_string();
        let token = format!("header.{}.signature", base64url_encode(payload.as_bytes()));
        let (account_id, email) = extract_account(cfg, &token);
        assert_eq!(account_id.as_deref(), Some("acct-123"));
        assert_eq!(email.as_deref(), Some("user@example.com"));
    }

    #[test]
    fn a_non_jwt_access_token_yields_no_account_rather_than_failing() {
        let cfg = find_provider("openai-codex").unwrap();
        let (account_id, email) = extract_account(cfg, "opaque-token");
        assert!(account_id.is_none() && email.is_none());
    }

    #[test]
    fn an_expired_credential_is_still_reported_as_connected() {
        // The refresh token normally outlives the access token, so an expired
        // access token must not present as a signed-out account.
        let cfg = find_provider("anthropic").unwrap();
        let creds = StoredCredentials {
            access: "a".into(),
            refresh: "r".into(),
            expires: now_ms() - 1000,
            account_id: None,
            email: None,
        };
        let view = account_view(cfg, Some(&creds));
        assert!(view.connected);
        assert!(view.expired);
    }

    #[test]
    fn a_missing_credential_reports_a_disconnected_account() {
        let cfg = find_provider("anthropic").unwrap();
        let view = account_view(cfg, None);
        assert!(!view.connected);
        assert!(!view.expired);
        assert_eq!(view.provider, "anthropic");
        assert_eq!(view.label, "Claude Pro/Max");
    }
}
