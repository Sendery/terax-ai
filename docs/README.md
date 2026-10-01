# Terax contributor documentation

This directory holds long-form contributor and maintainer guides. `TERAX.md` at the repo root is the living architecture doc and the source of truth; these guides elaborate on specific areas without duplicating it.

If a guide conflicts with `TERAX.md`, `TERAX.md` wins.

## Getting started

- [TERAX.md](../TERAX.md) - the architecture source of truth; read this first
- [CHANGELOG.md](../CHANGELOG.md) - what landed on `qa`, by commit
- [CONTRIBUTING.md](../CONTRIBUTING.md) - how to contribute, quality bar, project layout

## Architecture guides

- [Two-process model and IPC command reference](architecture/two-process-model.md) - Rust owns all OS access; the webview talks through `invoke()`. Command catalog and how to add a new command.
- [PTY shell integration](architecture/pty-shell-integration.md) - PTY sessions, shell init scripts, OSC 7 / 133, ConPTY, SPAWN_LOCK, Job Object, WSL.
- [Security model](architecture/security-model.md) - deny-list, SSRF guard, workspace authorization, AI tool approval, IPC allowlist, OSC trust, keychain handling.
- [AI subsystem](architecture/ai-subsystem.md) - providers, agent, sub-agents, sessions, composer, tools, edit diffs, live context bridge. Includes a walkthrough for adding a new provider.
- [Terminal renderer pool](architecture/terminal-renderer-pool.md) - slot pooling, the DormantRing, and the never-serialize-mid-command invariant.

## Feature guides

- [Reviewing a branch locally](branch-review.md) - the Review branch button, what it compares, and the two diff view toggles.
- [Mermaid diagrams](mermaid-diagrams.md) - the Mermaid tab, Source and Visual modes, the visual editing subset, and how positions are stored.
- [Scheduled tasks](scheduled-tasks.md) - waking Pi sessions on a schedule, run targets, accounting, and the recovery, overlap and failure policies.
- [Reading text aloud](tts.md) - local speech output: the private directory, engines and models, voice profiles, the read-aloud surfaces, and the Pi commands.

## Contributing guides

- [Testing](contributing/testing.md) - the testing contract, how to run checks, and what makes a good core-subsystem test.

## Fork guides (Sendery/terax-ai)

- [Pi Terax bridge](pi-terax.md) - usage, protocol, and security details of the `@crynta/pi-terax` package.
- [Pi visual QA](pi-visual-qa.md) - semantic state checks, screenshots, recording, and SSIM baselines.
- [Local releases](local-releases.md) - signing setup and cross-platform local release builds.
