# Terminal migration: user priority update

The user explicitly clarified on 2026-11-14 that 60 FPS is an aspirational
optimization target, not a mandatory migration gate. The objective is to
renew the usable Terax terminal while preserving or improving the current
product's capabilities. Further benchmarks and laboratories are not the
priority; performance optimization can follow delivery.

This decision supersedes earlier instructions to stop phases 2 to 5 when the
Phase 1 Channel measurement is below 60 FPS. The recorded negative results
remain accurate evidence and are not relabeled as passing. They no longer
block functional migration. Do not launch additional performance experiments
for this work unless the user changes this priority or a concrete functional
regression requires a scoped diagnostic.

The window-frame experiment is deferred. Its reviewed codec preparation at
`b5db7bb` remains inert. The uncommitted native queue tests and module patch
were preserved in the ignored M2 development area, then only those owned
changes were restored to the green base. No window transport was implemented
or measured, and no red test scaffold remains in the tracked source.

## Delivery sequence

1. Connect the native engine to ordinary terminal tabs and split panes through
   a shared TerminalEngine/session facade, retaining the existing xterm path
   while migration is incomplete. Exercise a real shell in the normal sandbox
   UI, not Terminal Lab.
2. Complete negotiated keyboard input, IME/dead keys, paste, focus, selection,
   history/reflow and current terminal settings. Preserve the shared renderer
   and hidden-pane lifecycle without losing output or running agents.
3. Connect cwd/shell readiness, blocks, search/links, selection actions, agent
   restoration, scheduled handoff, AI context and Pi/MCP consumers to the new
   session surface. Use the parity matrix to verify each observable behavior.
4. Deliver the applicable requested improvements and validate platform and
   failure/privacy behavior. Move the development default after functional
   parity, then the release default and cleanup after the planned review/soak.

The completion condition is a runnable normal-terminal version with current
capabilities preserved or improved. Compilation, fixtures, a basic shell,
FPS results or an adapter alone do not establish that outcome. The full
parity matrix remains the acceptance inventory, with FPS as informational.
All native work stays on M2; no native build on the protected original Mac,
no antivirus bypass and no GitHub Actions. Commits use Sendery only.
