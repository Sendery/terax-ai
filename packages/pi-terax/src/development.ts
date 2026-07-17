export const DEVELOPMENT_CAPABILITIES = [
  "orientation",
  "feature",
  "window",
  "setting",
  "shortcut",
  "command",
] as const;

export type DevelopmentCapability = (typeof DEVELOPMENT_CAPABILITIES)[number];

export type DevelopmentGuide = {
  capability: DevelopmentCapability;
  summary: string;
  inspect: string[];
  create: string[];
  modify: string[];
  tests: string[];
  invariants: string[];
  verify: string[];
  /** Durable gotcha catalog reference + the record-as-you-go directive. */
  gotchas: string[];
};

const COMMON_VERIFY = [
  "pnpm lint",
  "pnpm check-types",
  "pnpm test",
  "cd src-tauri && cargo clippy && cargo test --locked",
];

// Applied to every capability guide. The durable catalog is the single place
// where reusable Terax development gotchas and their solutions live.
const GOTCHAS_DIRECTIVE = [
  "Before starting, read the durable gotcha catalog: packages/pi-terax/skills/terax-development/references/gotchas.md.",
  "Directive: every non-obvious failure or constraint you hit during development MUST be recorded as a gotcha together with its solution \u2014 trigger, failure mode, prevention, and verification.",
  "Capture candidates immediately in the run journal (.terax/pi-development/<run>/journal.md), then promote each verified, reusable lesson into references/gotchas.md before finishing. Never leave a fixed gotcha undocumented.",
];

const GUIDES: Record<DevelopmentCapability, Omit<DevelopmentGuide, "gotchas">> = {
  orientation: {
    capability: "orientation",
    summary:
      "Pick the right domain before acting. a) Control a running Terax with tools only. b) Develop a Terax product feature in source. c) Extend the Pi bridge itself (a new command or tool), which spans the frontend registry, the Rust allowlist, and this package together.",
    inspect: [
      "Call terax_status to learn whether this session runs inside a Terax terminal and which tools are available.",
      "Control domain: terax_get_state, terax_call, terax_wait, and app.commands (read supported payloads). No source changes.",
      "Develop domain: this guide's feature/window/setting/shortcut/command capabilities plus terax_visual_qa.",
      "Provenance: app.buildInfo returns repository, branch, commit, and channel of the running binary so you can develop against the exact source.",
    ],
    create: [],
    modify: [
      "a) Control: send allowlisted commands only; never edit source for control tasks.",
      "b) Feature: React 19 + TypeScript under src/ and Rust/Tauri under src-tauri/.",
      "c) Extend the Pi bridge: TypeScript + typebox + Node TCP in packages/pi-terax, together with src/modules/commands/lib/registry.ts and src-tauri/src/modules/pi.rs.",
    ],
    tests: [
      "Only the develop and extend-Pi domains add tests; the control domain runs no build.",
    ],
    invariants: [
      "Host awareness: control and development tools are exposed only when TERAX_TERMINAL=1 (or TERM_PROGRAM=Terax), unless TERAX_FORCE=1 opts in from another shell.",
      "Bootstrap only when a development task requires source and no checkout is present: git clone the app's repository at its commit, then create an isolated branch and worktree. Pi performs this with its own bash under workspace authorization; the bridge never clones.",
      "Do not turn Terax into a runtime plugin host; extend it through reviewed source changes only.",
    ],
    verify: [
      "terax_status reports availability and, when unavailable, how to enable it.",
      "app.buildInfo matches the repository and commit you cloned for development.",
    ],
  },
  feature: {
    capability: "feature",
    summary: "Add a self-contained Terax module and keep App.tsx as coordinator.",
    inspect: ["TERAX.md", "src/app/App.tsx", "src/modules/"],
    create: [
      "src/modules/<feature>/index.ts",
      "src/modules/<feature>/lib/<core>.ts",
      "src/modules/<feature>/lib/<core>.test.ts",
      "src/modules/<feature>/components/<Surface>.tsx",
    ],
    modify: ["src/app/App.tsx only for top-level composition and wiring"],
    tests: [
      "Test pure domain logic before adding React wiring.",
      "Add component tests only for behavior that pure tests cannot cover.",
    ],
    invariants: [
      "Keep OS access in Rust and cross the boundary through registered Tauri commands.",
      "Use @/ imports across frontend modules.",
      "Do not add comments unless the reason is non-obvious.",
    ],
    verify: COMMON_VERIFY,
  },
  window: {
    capability: "window",
    summary: "Add a labeled Tauri window with a dedicated frontend entry point.",
    inspect: [
      "src-tauri/src/lib.rs",
      "src/modules/settings/openSettingsWindow.ts",
      "src/settings/main.tsx",
      "src/settings/SettingsApp.tsx",
      "vite.config.ts",
      "src-tauri/capabilities/default.json",
    ],
    create: [
      "src/<window>/main.tsx",
      "src/<window>/<WindowApp>.tsx",
      "src/modules/<feature>/open<Window>Window.ts",
      "<window>.html",
    ],
    modify: [
      "Register the HTML entry in vite.config.ts.",
      "Register the Rust opener in src-tauri/src/lib.rs.",
      "Add only the Tauri capabilities required by the new window.",
    ],
    tests: [
      "Test pure window option and deep-link selection logic.",
      "Add an eager-budget assertion when the new entry could pull heavy modules.",
    ],
    invariants: [
      "Reuse and focus an existing labeled window before creating another one.",
      "Validate route or tab parameters before constructing the window URL.",
      "Keep heavy feature stacks out of the main and settings eager graphs.",
    ],
    verify: COMMON_VERIFY,
  },
  setting: {
    capability: "setting",
    summary: "Add a persisted preference and expose it through a settings section.",
    inspect: [
      "src/modules/settings/store.ts",
      "src/modules/settings/preferences.ts",
      "src/settings/SettingsApp.tsx",
      "src/settings/sections/GeneralSection.tsx",
    ],
    create: ["src/settings/sections/<Feature>Section.tsx when a new section is justified"],
    modify: [
      "Add the type, default, hydration, setter, and event synchronization in the settings store.",
      "Add the control to the smallest existing settings section when possible.",
    ],
    tests: [
      "Test default values, persisted hydration, invalid stored values, and reset behavior.",
    ],
    invariants: [
      "Define each preference default once.",
      "Never store API keys or secrets in the settings store.",
      "Keep the settings window eager budget green.",
    ],
    verify: COMMON_VERIFY,
  },
  shortcut: {
    capability: "shortcut",
    summary: "Add a shortcut ID, default binding, handler, and settings visibility.",
    inspect: [
      "src/modules/shortcuts/shortcuts.ts",
      "src/modules/shortcuts/useGlobalShortcuts.ts",
      "src/app/App.tsx",
      "src/settings/sections/ShortcutsSection.tsx",
    ],
    create: [],
    modify: [
      "Add the ShortcutId and SHORTCUTS metadata in the single shortcut registry.",
      "Wire the handler through App.tsx without duplicating key matching.",
    ],
    tests: [
      "Test matching on macOS and Ctrl-based platforms.",
      "Test disabled conditions and editable-target behavior.",
    ],
    invariants: [
      "Use metaKey or ctrlKey semantics where the action is cross-platform.",
      "Do not shadow terminal readline bindings on non-macOS platforms.",
      "Keep user overrides compatible with the new ShortcutId.",
    ],
    verify: COMMON_VERIFY,
  },
  command: {
    capability: "command",
    summary: "Add a validated app command and optionally expose it to Pi.",
    inspect: [
      "src/modules/commands/lib/registry.ts",
      "src/modules/commands/lib/registry.test.ts",
      "src/modules/command-palette/commands.ts",
      "src/app/App.tsx",
      "src-tauri/src/modules/pi.rs",
      "packages/pi-terax/src/commands.ts",
    ],
    create: [],
    modify: [
      "Add the typed command ID, payload validation, handler contract, and dispatch case.",
      "Wire the handler to an existing semantic App API.",
      "Update every Pi allowlist only when external execution is intended.",
    ],
    tests: [
      "Test invalid payloads and unknown command rejection before handler execution.",
      "Test security and privacy boundaries for externally visible results.",
    ],
    invariants: [
      "Do not expose raw Tauri commands or arbitrary callbacks.",
      "Do not expose AI approval internals.",
      "Require explicit validation at both the Rust bridge and frontend registry boundaries.",
    ],
    verify: COMMON_VERIFY,
  },
};

export function isDevelopmentCapability(
  value: unknown,
): value is DevelopmentCapability {
  return (
    typeof value === "string" &&
    DEVELOPMENT_CAPABILITIES.includes(value as DevelopmentCapability)
  );
}

export function getDevelopmentGuide(
  capability: DevelopmentCapability,
): DevelopmentGuide {
  return {
    ...structuredClone(GUIDES[capability]),
    gotchas: [...GOTCHAS_DIRECTIVE],
  };
}
