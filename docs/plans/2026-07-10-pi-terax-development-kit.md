# Pi Terax Development Kit Implementation Plan

> **For Hermes:** Use test-driven development task-by-task.

**Goal:** Let Pi extend Terax source code safely and consistently, including features, native windows, settings, shortcuts, and command-registry commands.

**Architecture:** Keep the running-app bridge focused on control. Add a first-party Pi development skill and one compact project-aware guide tool that teaches Pi the current contribution points, test requirements, and verification commands. Pi continues to use its built-in read, edit, write, and bash tools to implement code, so Terax does not load arbitrary third-party runtime code. The guide data is pure and tested, and the skill is bundled through the standard Pi package manifest.

**Tech Stack:** Pi Agent extension API, TypeBox, TypeScript, Vitest, Tauri 2, React 19, Rust.

---

### Task 1: Audit and correct Pi package metadata

**Files:**
- Modify: `packages/pi-terax/package.json`
- Test: `packages/pi-terax/test/package.test.ts`

**Steps:**
1. Write a failing test asserting Pi host packages are peer dependencies and the development skill is declared.
2. Run the test and confirm it fails.
3. Move Pi-provided packages to `peerDependencies`, declare the skill path, and include skills in the published files.
4. Run the test and confirm it passes.

### Task 2: Add the tested development contribution map

**Files:**
- Create: `packages/pi-terax/src/development.ts`
- Create: `packages/pi-terax/test/development.test.ts`
- Modify: `packages/pi-terax/src/index.ts`

**Steps:**
1. Write failing tests for feature, window, setting, shortcut, and command guides.
2. Confirm the tests fail because the module is absent.
3. Implement the smallest typed contribution map with exact Terax paths, invariants, tests, and verification commands.
4. Confirm targeted tests pass.

### Task 3: Register the Pi development guide tool

**Files:**
- Modify: `packages/pi-terax/src/extension.ts`
- Modify: `packages/pi-terax/test/extension.test.ts`

**Steps:**
1. Write a failing test expecting `terax_development_guide` and checking a window guide result.
2. Confirm the expected failure.
3. Register the tool with a compact schema and pure guide lookup.
4. Confirm the extension tests pass.

### Task 4: Bundle the Terax development skill

**Files:**
- Create: `packages/pi-terax/skills/terax-development/SKILL.md`
- Create: `packages/pi-terax/skills/terax-development/references/contribution-points.md`
- Modify: `packages/pi-terax/README.md`
- Modify: `docs/pi-terax.md`
- Modify: `TERAX.md`

**Steps:**
1. Add the skill with triggers for features, windows, settings, shortcuts, and commands.
2. Document the source-extension workflow and security boundary.
3. Document that runtime arbitrary-code plugins remain out of scope.

### Task 5: Verify the full change

**Steps:**
1. Run package type checks, tests, and build.
2. Run root type checks and tests.
3. Run Biome on touched TypeScript files.
4. Run `git diff --check` and review the final diff for secrets, MCP code, and unrelated changes.
