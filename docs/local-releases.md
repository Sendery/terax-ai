# Local Releases

Terax releases can be built and uploaded without GitHub Actions. Builds are native: run the staging command on each operating system, then run the publication command once after every required platform fragment has been uploaded.

The scripts publish to `Sendery/terax-ai` by default and create a draft release first. Nothing becomes visible to updater clients until the final publish step uploads a complete `latest.json` and changes the draft to a published release.

## Endpoint migration limitation

Builds containing the previous `crynta/terax-ai` endpoint do not learn about the new repository automatically. The current Sendery account has read-only access to that upstream repository, so this script cannot publish a bridge manifest there. Existing installations compiled with the old endpoint must be upgraded once through a newly distributed Sendery installer, or the upstream owner must publish a signed `latest.json` that points to the Sendery assets. New Sendery builds use the new endpoint directly.

## Requirements

Install the normal Tauri prerequisites for the host platform, then:

```bash
pnpm install --frozen-lockfile
gh auth login
gh auth status
```

The authenticated GitHub account needs permission to create releases in `Sendery/terax-ai`.

Tauri updater signatures are mandatory. Configure the private key matching the public key in `src-tauri/tauri.conf.json`:

### Linux and macOS

```bash
export TAURI_SIGNING_PRIVATE_KEY="/absolute/path/to/terax.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-key-password"
```

### Windows PowerShell

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "C:\absolute\path\to\terax.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-key-password"
```

Do not commit the key or password. If the matching private key has been lost, it is impossible to publish updates accepted by clients containing the current public key. Rotating the public key requires distributing a new trusted installer through another channel first.

## Inspect the plan without side effects

```bash
pnpm release:local 0.9.0 --dry-run
pnpm release:publish 0.9.0 --dry-run
```

Dry-run does not build, create a tag, create a release, or upload files.

## Stage native builds

Run on Linux x86_64:

```bash
pnpm release:local 0.9.0
```

Run on Windows x86_64 in PowerShell:

```powershell
pnpm release:local 0.9.0
```

Run on Apple Silicon macOS for ARM64:

```bash
pnpm release:local 0.9.0
```

On the same Mac, stage the Intel build when the Rust target and Apple toolchain support it:

```bash
rustup target add x86_64-apple-darwin
pnpm release:local 0.9.0 --target x86_64-apple-darwin
```

On an Intel Mac, use the native command for Intel and explicitly target ARM64 if the toolchain supports it:

```bash
rustup target add aarch64-apple-darwin
pnpm release:local 0.9.0 --target aarch64-apple-darwin
```

Each invocation:

1. Accepts stable semantic versions only.
2. Requires a completely clean working tree, including no untracked files.
3. Requires branch `develop` and verifies `HEAD` exactly matches `origin/develop`.
4. Removes the platform bundle output before building so stale artifacts cannot be selected.
5. Temporarily applies the requested version to `package.json`, Tauri config, Cargo manifest, and lockfile.
6. Builds the native installers and signed updater artifact.
7. Restores the source version files.
8. Verifies that the generated signature key ID matches the updater public key compiled into Terax.
9. Refuses a version that is not strictly newer than the latest stable release.
10. Creates or reuses draft release `v<version>` pinned to the exact 40-character source commit SHA; it refuses to modify a published release or a draft targeting other source code.
11. Uploads content-addressed platform assets whose names include the first 16 hexadecimal characters of their SHA-256 digest.
12. Uploads `latest.<os>-<arch>.json` containing the source commit, artifact URL, and signature content.

Local staging files are placed under `.terax/releases/` and ignored by Git.

## Publish the complete release

After staging all four updater targets, run from any authenticated machine:

```bash
pnpm release:publish 0.9.0
```

Required targets:

- `linux-x86_64`
- `windows-x86_64`
- `darwin-aarch64`
- `darwin-x86_64`

The command downloads the platform fragments from the draft release and verifies that every fragment references the requested version, the same exact source commit, an existing release asset, and a non-empty signature. It then generates `latest.json`, uploads it, and publishes the draft.

To intentionally publish only the available platforms:

```bash
pnpm release:publish 0.9.0 --allow-partial
```

This option is explicit because omitted targets cannot update. Use it only when the unsupported platforms are intentionally excluded from that release.

## Alternate repository

Both commands accept an explicit repository:

```bash
pnpm release:local 0.9.0 --repo Sendery/terax-ai
pnpm release:publish 0.9.0 --repo Sendery/terax-ai
```

The repository must match the updater endpoint compiled into the application unless the release is only for testing.

## Uploaded artifacts

The script uploads native installer formats generated by Tauri:

- Linux: AppImage, DEB, RPM, updater signature.
- Windows: NSIS EXE, MSI, updater signatures.
- macOS: application updater archive, DMG, updater signature.

It also preserves stable aliases used by the Nix package and writes updater URLs under:

```text
https://github.com/Sendery/terax-ai/releases/download/v<version>/...
```

The published updater manifest is available at:

```text
https://github.com/Sendery/terax-ai/releases/latest/download/latest.json
```

## Recovery and reruns

Staging is safe to rerun for the same version and platform while the release remains a draft. Content changes produce new digest-qualified asset names, while the per-platform fragment is replaced to point at the newly staged artifact. Stable compatibility aliases may also be replaced inside the draft.

If a platform build fails, fix it and rerun only that platform. The release remains a draft. If final publication reports missing targets, stage them and run the publication command again. Do not manually publish the draft before `latest.json` has been generated and uploaded.
