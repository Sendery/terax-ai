export const DEVELOPMENT_CAPABILITIES = [
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
};

const COMMON_VERIFY = [
  "pnpm lint",
  "pnpm check-types",
  "pnpm test",
  "cd src-tauri && cargo clippy && cargo test --locked",
];

const GUIDES: Record<DevelopmentCapability, DevelopmentGuide> = {
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
  return structuredClone(GUIDES[capability]);
}
