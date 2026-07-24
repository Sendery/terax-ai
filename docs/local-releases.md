# Local Releases

Terax releases can be built and uploaded without GitHub Actions. Builds are native: run the staging command on each operating system, then run the publication command once after every required platform fragment has been uploaded.

The scripts publish to `Sendery/terax-ai` by default. **Stable** releases are staged as a draft first: nothing becomes visible to updater clients until the final publish step uploads a complete signed `latest.json` and flips the draft to a published release. **Development** releases skip the draft state entirely and are created directly as published GitHub **Pre-releases** (see Versioning and Development releases below).

## Versioning

Terax carries one visible SemVer identity across every layer and every artifact:

- **Stable**: `X.Y.Z` (for example `0.9.0`), tagged `vX.Y.Z`, published as a full GitHub release.
- **Development**: `X.Y.Z-dev.N` (for example `0.9.0-dev.6`), tagged `vX.Y.Z-dev.N`, published as a GitHub **Pre-release**.

The tag without its leading `v` is the single source of truth. `scripts/set-version.mjs` writes that exact string, in lockstep, to `package.json`, `src-tauri/tauri.conf.json`, the Cargo manifest and lockfile, and `packages/pi-terax/package.json`; every uploaded asset then embeds it verbatim:

- Terax installers: `Terax_X.Y.Z-dev.N_<arch>.<ext>`.
- Companion extension: `pi-terax-extension_X.Y.Z-dev.N.tgz`.

Do not introduce abbreviated forms (such as `X.Y.Z-N`), and never mix version strings across the assets of a single release.

> The unified scheme and the pre-release development flow described below take effect from the next release. The existing `0.9.0-dev.*` releases predate them and may mix an abbreviated `0.9.0-N` form; leave those published assets as they are.

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

## Development releases (published pre-releases, unsigned installers)

Development builds are **published GitHub Pre-releases**, never drafts. They are visible in the releases list as soon as they exist, carry no signed updater manifest, and are filled incrementally per host. Being a pre-release rather than a draft is what makes them safe to publish immediately: there is no partial signed `latest.json` to gate, and every asset is content-independent and replaced idempotently.

Create the pre-release once, pinned to the exact source commit, with no draft step:

```bash
gh release create v0.9.0-dev.6 \
  --repo Sendery/terax-ai \
  --target <40-char-source-commit-sha> \
  --title "Terax v0.9.0-dev.6" \
  --prerelease \
  --generate-notes
```

Then, on each native host, build and upload that release's installers:

```bash
pnpm release:dev 0.9.0-dev.6
```

The command queries `Sendery/terax-ai` for the release's immutable target commit, checks that exact commit out in an isolated cache worktree, builds only the host's native formats, verifies that installers were produced, and uploads them with `--clobber`. It does **not** sign updater artifacts, publish updater manifests, or change the release out of its pre-release state.

Run it on Linux x86_64 for AppImage, DEB, and RPM; on Windows x86_64 for NSIS EXE and MSI; and on macOS for DMG. Each host produces its own architecture, so cover both macOS architectures by running once on Apple Silicon and once on an Intel Mac. Cross-OS packaging is intentionally rejected because the native signing and installer toolchains are not reliably interchangeable.

Useful options:

```bash
pnpm release:dev 0.9.0-dev.6 --no-upload # build and inspect locally
pnpm release:dev 0.9.0-dev.6 --repo Sendery/terax-ai
pnpm release:dev 0.9.0-dev.6 --tag v0.9.0-dev.6
```

Every action is prefixed with `[release-dev]`, including the command, checkout path, selected source commit, discovered artifacts, and a final remediation hint on failure. Preserve that trace in an issue when a build fails.

## Uploaded artifacts

The script uploads native installer formats generated by Tauri:

- Linux: AppImage, DEB, RPM, updater signature.
- Windows: NSIS EXE, MSI, updater signatures.
- macOS: application updater archive, DMG, updater signature.

It also preserves stable aliases used by the Nix package and writes updater URLs under:

```text
https://github.com/Sendery/terax-ai/releases/download/v<version>/...
```

## Companion Pi extension asset

Every published release also carries the companion Pi extension as a single, platform-independent asset:

```text
pi-terax-extension_<version>.tgz
```

The `<version>` is exactly the release version defined in Versioning, so the extension asset always matches its release's installers.

`scripts/publish-extension.mjs` builds `packages/pi-terax`, hardens the manifest (see `docs/pi-terax.md` → Companion extension channel), `npm pack`s it, and uploads it with `--clobber`. Because it is platform-independent, it runs **once per release** from any single host:

- **Stable**: `release:publish` uploads it to the draft before flipping the draft to published.
- **Dev**: run it once against the pre-release, using the same single version as the installers:

  ```bash
  node scripts/publish-extension.mjs 0.9.0-dev.6 --tag v0.9.0-dev.6 --repo Sendery/terax-ai
  ```

Because the upload is idempotent (`--clobber`), rerunning either flow for the same tag simply replaces the asset. The Terax in-app updater discovers this asset for the selected channel and offers it as an independent download with an OS-specific install snippet. To stage or inspect the asset without uploading:

```bash
node scripts/publish-extension.mjs 0.9.0 --no-upload --out-dir ./out
```

The published updater manifest is available at:

```text
https://github.com/Sendery/terax-ai/releases/latest/download/latest.json
```

## Recovery and reruns

Staging is safe to rerun for the same version and platform while the release remains a draft. Content changes produce new digest-qualified asset names, while the per-platform fragment is replaced to point at the newly staged artifact. Stable compatibility aliases may also be replaced inside the draft.

If a platform build fails, fix it and rerun only that platform. The release remains a draft. If final publication reports missing targets, stage them and run the publication command again. Do not manually publish the draft before `latest.json` has been generated and uploaded.
