# Terax Contribution Points

## Product feature

- Domain and UI module: `src/modules/<area>/`
- Top-level composition: `src/app/App.tsx`
- Native OS boundary: `src-tauri/src/modules/<area>.rs`
- Native command registration: `src-tauri/src/lib.rs`
- Frontend native wrapper pattern: `src/modules/ai/lib/native.ts`

Keep domain logic pure and dependency-light. App and Tauri commands should coordinate existing services rather than contain business logic.

## Tab or pane type

- Tagged union and lifecycle: `src/modules/tabs/lib/useTabs.ts`
- Tab labels: `src/modules/tabs/lib/tabLabel.ts`
- Rendering coordinator: `src/app/App.tsx`
- Header and tab interactions: `src/modules/tabs/TabBar.tsx`

Tabs stay mounted when switched. New tab kinds must preserve that lifecycle rule and define cleanup behavior.

## Side panel

- Layout composition: `src/app/App.tsx` (`ResizablePanelGroup`)
- Visibility and width hook: `src/modules/<area>/lib/use<Area>Panel.ts`
- Header toggle: `src/modules/header/Header.tsx`
- Existing peers: `src/modules/notes`, `src/modules/tasks`

Visibility mounts and unmounts the panel together with its handle. Do not leave a
hidden panel collapsed: the group still has to fill its axis, so the solver
re-expands a sibling and ignores its `maxSize`. Give the panel a
`data-capture-target` anchor and decide its privacy scope.

## Scheduled or background native work

- Native timer: `src-tauri/src/modules/scheduler.rs`
- OS-level registration: `src-tauri/src/modules/waker.rs`
- Frontend arming and due dispatch: `src/modules/tasks/lib/useTasksScheduler.ts`

Keep the schedule maths pure in the frontend and give the native side a single
absolute deadline; a webview timer is throttled in the background. `tokio` here is
built without the `time` feature, so park a `std::thread` on
`Condvar::wait_timeout` rather than adding an async timer. Anything the OS invokes
on a cadence must exit cheaply and must not start a second app instance.

## Native window

- Existing opener pattern: `open_settings_window` in `src-tauri/src/lib.rs`
- Frontend wrapper: `src/modules/settings/openSettingsWindow.ts`
- HTML entry: `settings.html`
- Vite entry configuration: `vite.config.ts`
- Settings frontend entry: `src/settings/main.tsx`
- Capability allowlist: `src-tauri/capabilities/default.json`

Use one stable label per singleton window. If the window already exists, emit updated navigation state, show it, and focus it.

## Setting

- Persisted schema and defaults: `src/modules/settings/store.ts`
- Reactive frontend preference state: `src/modules/settings/preferences.ts`
- Settings shell and tab registry: `src/settings/SettingsApp.tsx`
- Existing controls: `src/settings/sections/`

Do not store secrets here. Provider keys use the keychain layer.

## Keyboard shortcut

- IDs, labels, groups, and defaults: `src/modules/shortcuts/shortcuts.ts`
- Global matching: `src/modules/shortcuts/useGlobalShortcuts.ts`
- Semantic handlers: `src/app/App.tsx`
- User overrides UI: `src/settings/sections/ShortcutsSection.tsx`

Add one semantic ID. Do not add a second independent key listener for the same action.

## App command and Pi exposure

- Typed registry: `src/modules/commands/lib/registry.ts`
- Registry tests: `src/modules/commands/lib/registry.test.ts`
- React handlers: `src/app/App.tsx`
- Rust bridge allowlist: `src-tauri/src/modules/pi.rs`
- Pi package allowlist: `packages/pi-terax/src/commands.ts`
- Palette presentation, when relevant: `src/modules/command-palette/commands.ts`

The registry is the semantic command API. The command palette is presentation and must not become the external control contract.

## In-app visual capture

- Capture module: `src/modules/capture` (targets, guard rules, rasterizer)
- Surface anchors: `data-capture-target` attributes on Header, TabBar, StatusBar, the sidebar container, and every per-tab stack wrapper (`data-capture-tab-id`)
- Rust persistence: `src-tauri/src/modules/capture.rs` (`capture_persist`)
- Pi native backend: `packages/pi-terax/src/visual-native.ts`
- Command id: `app.capture` through the standard command-and-Pi-exposure rows above

New visible surfaces should add a `data-capture-target` anchor when they must be capturable in isolation. New targets require a privacy classification (see the capture gotchas section) and end-to-end refusal tests with a private terminal open.

## Required checks

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri
cargo clippy
cargo test --locked
```

For a new window or frontend entry, also run eager graph and production build checks:

```bash
pnpm analyze:eager
pnpm build
```
