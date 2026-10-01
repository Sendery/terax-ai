//! Private `uv` bootstrap.
//!
//! The pinned standalone archive is fetched from the GitHub release, checked
//! against the `.sha256` sidecar the same release publishes, and unpacked with
//! the system `tar` into the private root. No installer script runs and the
//! user's PATH, shell rc files and `~/.local` are never touched.

use sha2::{Digest, Sha256};

pub const UV_VERSION: &str = "0.12.9";
const RELEASE_BASE: &str = "https://github.com/astral-sh/uv/releases/download";

/// The asset published for a host triple. A triple that is not in the table is
/// unsupported rather than guessed at.
pub fn uv_asset_name(target_triple: &str) -> Option<&'static str> {
    match target_triple {
        "aarch64-apple-darwin" => Some("uv-aarch64-apple-darwin.tar.gz"),
        "x86_64-apple-darwin" => Some("uv-x86_64-apple-darwin.tar.gz"),
        "aarch64-unknown-linux-gnu" => Some("uv-aarch64-unknown-linux-gnu.tar.gz"),
        "x86_64-unknown-linux-gnu" => Some("uv-x86_64-unknown-linux-gnu.tar.gz"),
        "x86_64-pc-windows-msvc" => Some("uv-x86_64-pc-windows-msvc.zip"),
        _ => None,
    }
}

pub fn host_triple() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else {
        "unsupported"
    }
}

pub fn host_uv_asset() -> Result<&'static str, String> {
    let triple = host_triple();
    uv_asset_name(triple)
        .ok_or_else(|| format!("no uv {UV_VERSION} build is published for {triple}"))
}

pub fn uv_asset_url(asset: &str) -> String {
    format!("{RELEASE_BASE}/{UV_VERSION}/{asset}")
}

pub fn uv_checksum_url(asset: &str) -> String {
    format!("{RELEASE_BASE}/{UV_VERSION}/{asset}.sha256")
}

/// Reads the digest for `asset` out of a `sha256sum`-style file. The file may
/// name the asset with a `*` binary marker or with a directory prefix, and may
/// hold digests for several assets.
pub fn parse_sha256_file(text: &str, asset: &str) -> Result<String, String> {
    let is_digest = |value: &str| value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit());
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(digest) = parts.next() else { continue };
        if !is_digest(digest) {
            continue;
        }
        match parts.next() {
            None => return Ok(digest.to_ascii_lowercase()),
            Some(name) => {
                let name = name.trim_start_matches('*');
                let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
                if base == asset {
                    return Ok(digest.to_ascii_lowercase());
                }
            }
        }
    }
    Err(format!("no sha256 digest for {asset}"))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    let actual = sha256_hex(bytes);
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "checksum mismatch: expected {expected}, got {actual}"
        ))
    }
}

/// The arguments handed to the system `tar`. The Windows asset is a zip, which
/// bsdtar (shipped with Windows since 1809) unpacks with `-xf`; the Unix
/// tarballs nest everything under one directory, hence `--strip-components`.
pub fn extract_args(archive: &str, dest: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![
            "-xf".to_string(),
            archive.to_string(),
            "-C".to_string(),
            dest.to_string(),
        ]
    } else {
        vec![
            "-xzf".to_string(),
            archive.to_string(),
            "-C".to_string(),
            dest.to_string(),
            "--strip-components=1".to_string(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_name_per_triple() {
        assert_eq!(
            uv_asset_name("aarch64-apple-darwin"),
            Some("uv-aarch64-apple-darwin.tar.gz")
        );
        assert_eq!(
            uv_asset_name("x86_64-apple-darwin"),
            Some("uv-x86_64-apple-darwin.tar.gz")
        );
        assert_eq!(
            uv_asset_name("aarch64-unknown-linux-gnu"),
            Some("uv-aarch64-unknown-linux-gnu.tar.gz")
        );
        assert_eq!(
            uv_asset_name("x86_64-unknown-linux-gnu"),
            Some("uv-x86_64-unknown-linux-gnu.tar.gz")
        );
        assert_eq!(
            uv_asset_name("x86_64-pc-windows-msvc"),
            Some("uv-x86_64-pc-windows-msvc.zip")
        );
        assert_eq!(uv_asset_name("riscv64gc-unknown-linux-gnu"), None);
        assert_eq!(uv_asset_name(""), None);
        assert_eq!(uv_asset_name("x86_64-unknown-linux-musl"), None);
    }

    #[test]
    fn the_host_triple_is_supported_on_every_platform_terax_ships() {
        assert!(host_uv_asset().is_ok(), "{}", host_triple());
        assert_eq!(uv_asset_name(host_triple()), host_uv_asset().ok());
    }

    #[test]
    fn urls_point_at_the_pinned_release() {
        let asset = "uv-aarch64-apple-darwin.tar.gz";
        assert_eq!(
            uv_asset_url(asset),
            "https://github.com/astral-sh/uv/releases/download/0.12.9/uv-aarch64-apple-darwin.tar.gz"
        );
        assert_eq!(
            uv_checksum_url(asset),
            "https://github.com/astral-sh/uv/releases/download/0.12.9/uv-aarch64-apple-darwin.tar.gz.sha256"
        );
        assert!(
            uv_asset_url(asset).starts_with("https://github.com/astral-sh/uv/releases/download/")
        );
    }

    #[test]
    fn sha256_file_parsing_handles_the_shapes_releases_publish() {
        let digest = "a".repeat(64);
        let asset = "uv-aarch64-apple-darwin.tar.gz";
        assert_eq!(
            parse_sha256_file(&format!("{digest}  {asset}\n"), asset).unwrap(),
            digest
        );
        assert_eq!(
            parse_sha256_file(&format!("{digest} *{asset}"), asset).unwrap(),
            digest
        );
        assert_eq!(
            parse_sha256_file(&format!("{digest}  ./dist/{asset}\n"), asset).unwrap(),
            digest
        );
        assert_eq!(
            parse_sha256_file(&format!("{digest}\n"), asset).unwrap(),
            digest
        );
        let upper = "A".repeat(64);
        assert_eq!(
            parse_sha256_file(&format!("{upper}  {asset}"), asset).unwrap(),
            digest
        );
        let other = "b".repeat(64);
        let multi = format!("{other}  uv-x86_64-apple-darwin.tar.gz\n{digest}  {asset}\n");
        assert_eq!(parse_sha256_file(&multi, asset).unwrap(), digest);
    }

    #[test]
    fn sha256_file_parsing_rejects_garbage_and_the_wrong_asset() {
        let digest = "a".repeat(64);
        let asset = "uv-aarch64-apple-darwin.tar.gz";
        assert!(parse_sha256_file("", asset).is_err());
        assert!(parse_sha256_file("not a checksum file", asset).is_err());
        assert!(parse_sha256_file(&format!("{digest}  other.tar.gz"), asset).is_err());
        assert!(parse_sha256_file(&format!("{}  {asset}", "a".repeat(63)), asset).is_err());
        assert!(parse_sha256_file(&format!("{}  {asset}", "z".repeat(64)), asset).is_err());
        assert!(parse_sha256_file("<html>404</html>", asset).is_err());
    }

    #[test]
    fn sha256_matches_the_published_test_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn verify_is_case_insensitive_and_rejects_a_mismatch() {
        let expected = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD";
        assert!(verify_sha256(b"abc", expected).is_ok());
        assert!(verify_sha256(b"abd", expected).is_err());
        assert!(verify_sha256(b"abc", "").is_err());
    }

    #[test]
    fn extract_args_are_platform_correct() {
        let args = extract_args("/tmp/uv.tar.gz", "/data/tts/runtime/uv");
        if cfg!(windows) {
            assert_eq!(args[0], "-xf");
            assert!(!args.iter().any(|a| a.starts_with("--strip-components")));
        } else {
            assert_eq!(args[0], "-xzf");
            assert_eq!(args.last().unwrap(), "--strip-components=1");
        }
        assert!(args.contains(&"-C".to_string()));
        assert!(args.contains(&"/data/tts/runtime/uv".to_string()));
    }
}
