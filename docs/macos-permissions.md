# macOS permission prompts

Why macOS keeps asking, what Terax does about it, and the two things only you can do once.

## Two systems, two rules

macOS guards two different things, and they recognise an app differently.

| | Privacy grants (TCC) | Keychain items |
|---|---|---|
| Guards | Documents, Desktop, Downloads, other volumes, other apps' data, microphone, camera, Apple Events, local network | Saved passwords and keys |
| Recognises an app by | Its designated requirement: bundle identifier plus signing certificate | The exact code hash that wrote the item, unless the app has an Apple Team ID |
| Survives a new build | Yes, when builds are signed with the same certificate | No, without a Team ID |
| Asks | Once per protected resource | Once per item, for the keychain password |

Development builds are signed with the self-signed `Pi-Terax Local Signing` certificate (`scripts/dev-release-config.mjs`, and `scripts/sandbox.mjs` for sandbox builds), so their designated requirement is the same for every build: `identifier "app.crynta.terax" and certificate root = H"<cert sha1>"`. That keeps privacy grants. It is not a Developer ID and carries no Team ID, so it does nothing for the keychain.

## Privacy grants: one Full Disk Access grant

macOS treats each protected place as its own permission, and it attributes what a child process does to the app responsible for it. Every shell, every agent and every tool running in a Terax pane is Terax to macOS, so the first time any of them touches Documents, then Desktop, then Downloads, then an external volume, Terax is asked again.

Full Disk Access covers all the file permissions with one grant, and every process inside Terax inherits it.

1. The one-time hint and the card in Settings > General both open System Settings > Privacy & Security > Full Disk Access.
2. Turn Terax on in the list (add it with **+** if it is not there).
3. Restart Terax. macOS applies the grant when the app next starts.

The grant cannot be requested from code. Terax only detects it (`modules/privacy.rs`), with reads that are refused without a prompt when the grant is missing: `/Library/Preferences/com.apple.TimeMachine.plist` and a listing of `~/Library/Safari`. The privacy database itself, the usual probe, is avoided because endpoint security tools flag processes that read it.

What Full Disk Access does not cover, each asked once and kept across builds:

- **Microphone and camera**: dictation and voice recording, or a program in a pane that records.
- **Apple Events (Automation)**: a program in a pane that scripts another app (`osascript`), once per target app.
- **Local network**: a program in a pane that reaches a device on the LAN.
- **Notifications**: agent notifications, per app.
- **Accessibility, Screen Recording**: never requested by Terax itself; a tool in a pane that needs them is granted through Terax in System Settings.

`Info.plist` declares usage descriptions for camera, microphone, Apple
Events and local network. `entitlements.plist` supplies the hardened-runtime
entitlements for camera, audio input and Apple Events. macOS manages the
other grants separately through its own prompts or System Settings.

## Keychain: one item per profile

Without a Team ID, a keychain item trusts the code hash of the build that created it. A new build is a stranger, so macOS asks for the keychain password, and it asks per item. Terax used to keep one item per provider key and per OAuth connection, so a build with eight keys asked eight times.

All secrets of a profile now live in one item: service `terax-vault`, account `secrets`, a small JSON document (`modules/secrets_vault.rs`). It is read once per launch and served from memory.

- **A new build asks once.** Answer **Always Allow** and that build does not ask again. One question per build is the floor without a Developer ID certificate.
- **Migration is automatic.** A secret still held in an old per-key item is read when first asked for, written into the vault, and the old item is removed only after the vault write succeeded. The first launch of a build with the vault therefore asks once per old item, for the last time. A refused or failed step leaves the old item in place and is retried on a later launch.
- **A refused prompt is not repeated in the same launch.** Secrets are unavailable until the next start, and nothing is overwritten.
- Windows keeps one credential per secret (Credential Manager does not ask per build, and a credential is limited to 2560 bytes). Linux keeps its `0600` file.

## The sandbox build

The sandbox (`app.crynta.terax.sandbox`, "Pi-Terax Sandbox") is a different app to macOS.

- **Privacy grants are its own.** Give it Full Disk Access once; the grant then holds for every later sandbox build, as long as the build is signed with the local identity. `pnpm build:sandbox` signs with it when the keychain has it. An unsigned build has an ad hoc signature that changes every time, and is asked for everything again.
- **Secrets are copied once.** The sandbox has a vault of its own (`terax-vault.sandbox`). On its first launch it reads the installed app's vault a single time (one prompt, since the sandbox is a stranger to that item) and copies it. After that it never touches the installed app's item, so a new sandbox build asks once, for its own vault. Reading through to the installed app on every launch, as before, cost one prompt per installed key per sandbox build. The cost of copying is that a key changed later in the installed app does not reach the sandbox until **Reset from installed Terax** in Settings > About, which copies again.
- The sandbox can copy installed keys that are still in the old per-key items. It attempts each item once, even if access is refused. Migrate any remaining keys in the installed app before using **Reset from installed Terax**.
- `pnpm dev:sandbox` runs an unsigned binary from your terminal. macOS attributes its file access to the terminal that started it, and its keychain prompts repeat with every rebuild.

## If the build itself asks for a password

`codesign` needs the private key of the signing certificate. A dialog during
the build authorizes use of that key and is separate from the app's access to
its vault. You can select **Always Allow** for the signing tool.

## Removing prompts completely

Only an Apple Developer ID certificate removes the per-build keychain question: with a Team ID, keychain items trust the team rather than one build.
