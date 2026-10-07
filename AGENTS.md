TERAX.md

## Pi agents: pick a domain first

If you reach Terax through the `@crynta/pi-terax` extension, orientation is discoverable at runtime and does not depend on this file:

- Call `terax_status` to check whether you are inside a Terax terminal and which tools are available. Outside a Terax terminal only `terax_status` is exposed; it explains how to enable the rest.
- Call `terax_development_guide` with `orientation` for the control vs develop-feature vs extend-Pi-bridge domain map.
- a) Control a running Terax: tools only (`terax_get_state`, `terax_call`, `terax_wait`, `app.commands`). No source changes.
- b) Develop a Terax feature: skill `terax-development`, React/TS + Rust/Tauri under `src/` and `src-tauri/`.
- c) Extend the Pi bridge: edit `packages/pi-terax` together with `src/modules/commands` and `src-tauri/src/modules/pi.rs`.

For development without a local checkout, `app.buildInfo` gives the repository and commit to clone into an isolated worktree, only when the task needs source. See `docs/pi-terax.md`.

## Repository identity: always Sendery

This repository (`Sendery/terax-ai`) is operated with the **Sendery** credentials only, for every write: commits, pushes, tags, releases, pull requests and comments. Never use another account, the work account included.

- **git:** remotes under `Sendery/**` already commit and push as Sendery through the machine's `includeIf` git config (author and SSH key). Do not override `user.name`, `user.email` or `core.sshCommand` in this repository.
- **GitHub API (`gh`, `pnpm release:dev`):** run `gh auth status` first. If Sendery is not the active account, run `gh auth switch -u Sendery`. A `GH_TOKEN` in the environment, for example from a direnv `.envrc`, overrides the keyring account. Run `gh` and release scripts with `env -u GH_TOKEN` unless that token belongs to Sendery.
- If the Sendery account cannot authenticate, stop and ask. Never fall back to another identity.
